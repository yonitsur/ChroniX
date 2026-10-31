"""YouTube Data API search for the event drawer's Videos tab (server-side so the API key stays private)."""
import asyncio
import contextlib
import hashlib
import html
import logging
import os
import re
import time
from collections import OrderedDict
from datetime import datetime, timezone

import httpx

logger = logging.getLogger("ChroniXYouTube")

SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
MEMORY_TTL_SECONDS = 24 * 3600
PERSISTENT_TTL_SECONDS = 30 * 24 * 3600
CACHE_MAX_ENTRIES = 128
CACHE_TABLE = "youtube_search_cache"
MAX_RESULTS = 8
FETCH_RESULTS = 15
MAX_QUERY_CHARS = 150
_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_LANG_RE = re.compile(r"^[a-z]{2,3}$")
_NON_ASCII_RE = re.compile(r"[^\x00-\x7F]")
_LATIN_WORD_RE = re.compile(r"[A-Za-z]{4,}")
_MK_TOKEN_RE = re.compile(r"^mk\d+$", re.IGNORECASE)
_SHORTS_RE = re.compile(r"#(?:shorts|youtubeshorts)\b", re.IGNORECASE)
_DISAMBIG_PAREN_RE = re.compile(r"\s*\([^)]+\)\s*$")
_APOSTROPHE_RE = re.compile(r"['’׳״\"]+")
_REMOTE_TIMEOUT = httpx.Timeout(6.0, connect=4.0)
_WIKI_TIMEOUT = httpx.Timeout(3.5, connect=2.5)
_REMOTE_FAILURE_COOLDOWN = 300.0
_remote_disabled_until = 0.0

_WIKI_HEADERS = {
    "User-Agent": "ChroniX/1.0 (https://chronix.app; contact@chronix.app) httpx/0.27"
}

_STOP_WORDS = {
    "the", "and", "for", "with", "from", "into", "upon", "of", "in", "on", "at", "to", "by", "a", "an",
    "של", "על", "את", "עם", "אל", "או", "ידי", "בין", "דור", "ראשון", "שני",
}
_GENERIC_TAIL_WORDS = {"city", "סיטי", "island", "אי", "mount", "הר"}

# Each uncached search costs 100 of the default 10,000 daily quota units, so cache in two layers:
# process memory (fast, lost on restart) and Supabase (survives Render redeploys/spin-downs).
_cache: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()
_langlink_cache: "OrderedDict[str, str | None]" = OrderedDict()

_ORIG_ASYNC_CLIENT = httpx.AsyncClient
_SHARED_HTTP_CLIENT: httpx.AsyncClient | None = None
_SHARED_HTTP_CLIENT_LOOP = None


@contextlib.asynccontextmanager
async def _http_client_scope():
    global _SHARED_HTTP_CLIENT, _SHARED_HTTP_CLIENT_LOOP
    if httpx.AsyncClient is not _ORIG_ASYNC_CLIENT:
        client_cls = httpx.AsyncClient
        async with client_cls(timeout=httpx.Timeout(8.0, connect=5.0)) as client:
            yield client
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if (
        _SHARED_HTTP_CLIENT is None
        or _SHARED_HTTP_CLIENT.is_closed
        or _SHARED_HTTP_CLIENT_LOOP is not loop
    ):
        _SHARED_HTTP_CLIENT = _ORIG_ASYNC_CLIENT(
            timeout=httpx.Timeout(8.0, connect=5.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
        _SHARED_HTTP_CLIENT_LOOP = loop
    yield _SHARED_HTTP_CLIENT


def _api_key() -> str:
    return (os.getenv("GCLOUD_API_KEY") or "").strip()


def _supabase_config():
    """Returns (url, key) when the persistent cache is usable; read lazily because main.py loads .env late."""
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key or time.time() < _remote_disabled_until:
        return None
    return url, key


def _disable_remote(operation: str, detail: str) -> None:
    global _remote_disabled_until
    _remote_disabled_until = time.time() + _REMOTE_FAILURE_COOLDOWN
    logger.warning(
        "YouTube search cache %s failed (%s); using memory cache only for %.0fs. "
        "Ensure the '%s' table exists (see README).",
        operation, detail, _REMOTE_FAILURE_COOLDOWN, CACHE_TABLE,
    )


def _remote_headers(key: str) -> dict:
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _cache_key(q: str, lang: str) -> str:
    return hashlib.sha256(f"{lang}|{q.lower()}".encode("utf-8")).hexdigest()


def _cache_get(key):
    hit = _cache.get(key)
    if not hit:
        return None
    stored_at, value = hit
    if time.time() - stored_at > MEMORY_TTL_SECONDS:
        _cache.pop(key, None)
        return None
    _cache.move_to_end(key)
    return value


def _cache_put(key, value):
    _cache[key] = (time.time(), value)
    _cache.move_to_end(key)
    while len(_cache) > CACHE_MAX_ENTRIES:
        _cache.popitem(last=False)


async def _remote_get(client: httpx.AsyncClient, key: str):
    config = _supabase_config()
    if not config:
        return None
    url, service_key = config
    try:
        resp = await client.get(
            f"{url}/rest/v1/{CACHE_TABLE}",
            params={"cache_key": f"eq.{key}", "select": "items,fetched_at"},
            headers=_remote_headers(service_key),
            timeout=_REMOTE_TIMEOUT,
        )
    except httpx.HTTPError as e:
        _disable_remote("read", type(e).__name__)
        return None
    if resp.status_code != 200:
        _disable_remote("read", f"HTTP {resp.status_code}")
        return None
    rows = resp.json()
    if not rows:
        return None
    try:
        fetched_at = datetime.fromisoformat(rows[0]["fetched_at"])
    except (KeyError, TypeError, ValueError):
        return None
    if (datetime.now(timezone.utc) - fetched_at).total_seconds() > PERSISTENT_TTL_SECONDS:
        return None
    return {"configured": True, "items": rows[0].get("items") or []}


async def _remote_put(client: httpx.AsyncClient, key: str, q: str, lang: str, items: list) -> None:
    config = _supabase_config()
    if not config:
        return
    url, service_key = config
    row = {
        "cache_key": key,
        "query": q,
        "lang": lang,
        "items": items,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        resp = await client.post(
            f"{url}/rest/v1/{CACHE_TABLE}",
            json=row,
            headers={**_remote_headers(service_key), "Prefer": "resolution=merge-duplicates,return=minimal"},
            timeout=_REMOTE_TIMEOUT,
        )
    except httpx.HTTPError as e:
        _disable_remote("write", type(e).__name__)
        return
    if resp.status_code not in (200, 201, 204):
        _disable_remote("write", f"HTTP {resp.status_code}")


def _parse_candidates(payload: dict) -> list[dict]:
    items = []
    seen_ids = set()
    for raw in payload.get("items") or []:
        video_id = (raw.get("id") or {}).get("videoId") or ""
        if not _VIDEO_ID_RE.match(video_id) or video_id in seen_ids:
            continue
        seen_ids.add(video_id)
        snippet = raw.get("snippet") or {}
        thumbs = snippet.get("thumbnails") or {}
        thumb = (thumbs.get("medium") or thumbs.get("default") or {}).get("url") or ""
        items.append({
            "videoId": video_id,
            "title": html.unescape(snippet.get("title") or ""),
            "channel": html.unescape(snippet.get("channelTitle") or ""),
            "publishedAt": snippet.get("publishedAt") or "",
            "thumbnail": thumb if thumb.startswith("https://") else "",
            "_description": html.unescape(snippet.get("description") or ""),
        })
    return items


def _strip_internal_fields(items: list[dict]) -> list[dict]:
    return [
        {k: v for k, v in item.items() if not k.startswith("_")}
        for item in items[:MAX_RESULTS]
    ]


def _parse_items(payload: dict) -> list[dict]:
    return _strip_internal_fields(_parse_candidates(payload))


def _normalize_for_match(text: str) -> str:
    if not text:
        return ""
    cleaned = _APOSTROPHE_RE.sub("", text.lower())
    return re.sub(r"[^\w\u0590-\u05FF]+", " ", cleaned).strip()


def _tokenize_phrase(phrase: str) -> list[str]:
    norm = _normalize_for_match(phrase)
    if not norm:
        return []
    tokens = []
    for tok in norm.split():
        if tok in _STOP_WORDS:
            continue
        if len(tok) >= 3 or (len(tok) == 2 and any(c.isdigit() for c in tok)) or tok in {"gt", "v8", "rs"}:
            if tok not in tokens:
                tokens.append(tok)
    return tokens


def _token_in_text(token: str, normalized_text: str) -> bool:
    if not token or not normalized_text:
        return False
    if re.search(r"[\u0590-\u05FF]", token):
        base = re.sub(r"^[הבלמוכש]", "", token) if len(token) >= 4 else token
        return bool(re.search(rf"(?:^|\s|[הבלמוכש]){re.escape(base)}", normalized_text))
    if len(token) <= 4 or any(c.isdigit() for c in token):
        return bool(re.search(rf"\b{re.escape(token)}s?\b", normalized_text))
    return bool(re.search(rf"\b{re.escape(token)}", normalized_text))


def _matches_focus_variant(tokens: list[str], text_norm: str) -> bool:
    """Checks whether candidate text genuinely matches the event's focus entity (not just a brand or Mk1 tag)."""
    if not tokens:
        return False
    # Exclude generation tags like 'mk1' when determining the required entity core so 'Mk1 Scirocco' cannot match 'Golf Mk1'.
    core = [t for t in tokens if not _MK_TOKEN_RE.match(t)] or tokens
    if len(core) == 1:
        return _token_in_text(core[0], text_norm)

    # If the entity ends with a model number/code (e.g. 'Alfa Romeo 159', 'BMW M1', 'Nikon F3'), that code is mandatory.
    last_tok = core[-1]
    if any(c.isdigit() for c in last_tok) or len(last_tok) <= 2:
        return _token_in_text(last_tok, text_norm) and any(_token_in_text(t, text_norm) for t in core[:-1])

    # For multi-word names ('Volkswagen Golf', 'Fiat Punto', 'Lancia Delta'), require the specific head noun
    # (unless the trailing word is a generic geographic term like 'Panama City'), or at least 2 core tokens.
    specific_tok = core[-2] if last_tok in _GENERIC_TAIL_WORDS and len(core) >= 2 else last_tok
    if _token_in_text(specific_tok, text_norm):
        return True
    matched_count = sum(1 for t in core if _token_in_text(t, text_norm))
    return matched_count >= 2


def _rank_candidates(
    candidates: list[dict],
    subject_variants: list[str],
    focus_variants: list[str],
) -> tuple[list[dict], int]:
    """
    Ranks candidates so videos connecting the timeline subject AND the event focus come first,
    while filtering out videos that only mention the timeline subject without the event focus.
    Returns (ranked_items, focus_match_count).
    """
    if not candidates:
        return [], 0

    # Deduplicate identical titles (e.g. re-uploaded commercials)
    deduped = []
    seen_titles = set()
    for cand in candidates:
        title_key = _normalize_for_match(cand.get("title") or "")
        if title_key and title_key in seen_titles:
            continue
        if title_key:
            seen_titles.add(title_key)
        deduped.append(cand)

    subj_token_sets = [_tokenize_phrase(v) for v in subject_variants if v]
    subj_token_sets = [ts for ts in subj_token_sets if ts]
    focus_token_sets = [_tokenize_phrase(v) for v in focus_variants if v]
    focus_token_sets = [ts for ts in focus_token_sets if ts]

    if not subj_token_sets and not focus_token_sets:
        return _strip_internal_fields(deduped), len(deduped)

    all_subj_tokens = list(dict.fromkeys(t for ts in subj_token_sets for t in ts))
    all_focus_tokens = list(dict.fromkeys(t for ts in focus_token_sets for t in ts))

    scored = []
    for idx, cand in enumerate(deduped):
        raw_title = cand.get("title") or ""
        raw_desc = cand.get("_description") or ""
        raw_chan = cand.get("channel") or ""

        title_norm = _normalize_for_match(raw_title)
        desc_norm = _normalize_for_match(f"{raw_desc} {raw_chan}")
        combined_norm = f"{title_norm} {desc_norm}".strip()

        matches_focus = (
            any(_matches_focus_variant(ts, combined_norm) for ts in focus_token_sets)
            if focus_token_sets else True
        )
        matches_subject = (
            any(_token_in_text(t, combined_norm) for t in all_subj_tokens)
            if all_subj_tokens else False
        )

        focus_title_hits = sum(1 for t in all_focus_tokens if _token_in_text(t, title_norm))
        focus_desc_hits = sum(1 for t in all_focus_tokens if _token_in_text(t, desc_norm))
        subj_title_hits = sum(1 for t in all_subj_tokens if _token_in_text(t, title_norm))
        subj_desc_hits = sum(1 for t in all_subj_tokens if _token_in_text(t, desc_norm))
        is_short = bool(_SHORTS_RE.search(f"{raw_title} {raw_desc}") or len(re.findall(r"#\w+", raw_title)) >= 2)

        if matches_focus and matches_subject:
            tier = 3
        elif matches_focus:
            tier = 2
        elif matches_subject:
            tier = 1
        else:
            tier = 0

        score = (
            tier * 100
            + subj_title_hits * 14
            + subj_desc_hits * 5
            + focus_title_hits * 9
            + focus_desc_hits * 2
            - (12 if is_short else 0)
            - idx
        )
        scored.append((score, matches_focus, idx, cand))

    focus_match_count = sum(1 for _, mf, _, _ in scored if mf)

    # When searching a combined (subject + focus) query, drop off-topic videos that only match the general
    # timeline subject (e.g. Triumph TR7 on a Volkswagen Golf event) whenever at least 2 videos match the event.
    if subj_token_sets and focus_token_sets and focus_match_count >= 2:
        scored = [entry for entry in scored if entry[1]]

    scored.sort(key=lambda entry: (-entry[0], entry[2]))
    ranked = [entry[3] for entry in scored]
    return _strip_internal_fields(ranked), focus_match_count


def _infer_wiki_lang(text: str, default_lang: str) -> str:
    if re.search(r"[\u0590-\u05FF]", text):
        return "he"
    if re.search(r"[\u0600-\u06FF]", text):
        return "ar"
    if re.search(r"[\u0400-\u04FF]", text):
        return "ru"
    if re.search(r"[\u0370-\u03FF]", text):
        return "el"
    if re.search(r"[\u3040-\u30FF]", text):
        return "ja"
    if re.search(r"[\uAC00-\uD7AF]", text):
        return "ko"
    if re.search(r"[\u4E00-\u9FFF]", text):
        return "zh"
    return default_lang if default_lang and default_lang != "en" else ""


async def _resolve_to_english(titles: list[str], default_lang: str, client: httpx.AsyncClient) -> dict[str, str]:
    """Resolves non-ASCII Wikipedia entity titles to their canonical English counterparts via batched langlinks."""
    to_fetch_by_lang: dict[str, list[str]] = {}
    resolved: dict[str, str] = {}

    for raw in titles:
        t = (raw or "").strip()
        if not t or not _NON_ASCII_RE.search(t):
            continue
        wlang = _infer_wiki_lang(t, default_lang)
        if not wlang:
            continue
        ck = f"{wlang}|{t}"
        if ck in _langlink_cache:
            val = _langlink_cache[ck]
            if val:
                resolved[t] = val
            continue
        if t not in to_fetch_by_lang.setdefault(wlang, []):
            to_fetch_by_lang[wlang].append(t)

    for wlang, batch in to_fetch_by_lang.items():
        try:
            resp = await client.get(
                f"https://{wlang}.wikipedia.org/w/api.php",
                params={
                    "action": "query",
                    "prop": "langlinks",
                    "lllang": "en",
                    "redirects": 1,
                    "format": "json",
                    "titles": "|".join(batch),
                },
                headers=_WIKI_HEADERS,
                timeout=_WIKI_TIMEOUT,
            )
            if resp.status_code != 200:
                continue
            data = (resp.json() or {}).get("query") or {}
        except Exception:
            continue

        norm_map = {n["from"]: n["to"] for n in data.get("normalized") or [] if "from" in n and "to" in n}
        redir_map = {r["from"]: r["to"] for r in data.get("redirects") or [] if "from" in r and "to" in r}
        page_en = {}
        for page in (data.get("pages") or {}).values():
            ll = page.get("langlinks") or []
            if ll and isinstance(ll[0], dict) and ll[0].get("*"):
                en_title = _DISAMBIG_PAREN_RE.sub("", ll[0]["*"]).strip()
                if en_title:
                    page_en[page.get("title") or ""] = en_title

        for orig in batch:
            target = norm_map.get(orig, orig)
            target = redir_map.get(target, target)
            en_val = page_en.get(target)
            _langlink_cache[f"{wlang}|{orig}"] = en_val
            while len(_langlink_cache) > CACHE_MAX_ENTRIES:
                _langlink_cache.popitem(last=False)
            if en_val:
                resolved[orig] = en_val

    return resolved


def _split_subject_and_focus(q: str, context: str | None) -> tuple[str, str]:
    subj = " ".join((context or "").split())[:MAX_QUERY_CHARS]
    if not subj:
        return "", q
    if q.lower().startswith(subj.lower()):
        remainder = q[len(subj):].strip()
        if remainder:
            return subj, remainder
    return subj, q


async def _fetch_youtube_candidates(
    client: httpx.AsyncClient,
    q: str,
    lang: str,
    api_key: str,
) -> tuple[list[dict] | None, str | None]:
    params = {
        "part": "snippet",
        "type": "video",
        "maxResults": FETCH_RESULTS,
        "q": q,
        "safeSearch": "strict",
        "videoEmbeddable": "true",
        "key": api_key,
    }
    if lang:
        params["relevanceLanguage"] = lang

    try:
        resp = await client.get(SEARCH_URL, params=params)
    except httpx.HTTPError as e:
        # Log only the type: httpx error messages can include the request URL (and thus the key).
        logger.warning("YouTube search request failed: %s", type(e).__name__)
        return None, "unavailable"

    if resp.status_code != 200:
        logger.warning("YouTube search returned HTTP %s", resp.status_code)
        # 403 is almost always the daily quota being exhausted.
        return None, ("quota" if resp.status_code == 403 else "unavailable")

    return _parse_candidates(resp.json()), None


async def search_youtube_videos(query: str, lang: str | None = None, context: str | None = None) -> dict:
    """Returns {configured, items[, error]}; never raises so the UI can always fall back to a YouTube link."""
    api_key = _api_key()
    if not api_key:
        return {"configured": False, "items": []}

    q = " ".join((query or "").split())[:MAX_QUERY_CHARS]
    if not q:
        return {"configured": True, "items": []}

    lang = (lang or "").strip().lower()
    if not _LANG_RE.match(lang):
        lang = ""

    key = _cache_key(q, lang)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    subject, focus = _split_subject_and_focus(q, context)

    async with _http_client_scope() as client:
        stored = await _remote_get(client, key)
        if stored is not None:
            _cache_put(key, stored)
            return stored

        search_q = q
        search_lang = lang
        subject_variants = [subject] if subject else []
        focus_variants = [focus] if focus else []

        # Pre-search normalization: if timeline subject is in non-Latin script (e.g. Hebrew) while the
        # event focus is an English Wikipedia title ('Maserati Ghibli'), resolve the subject to English
        # before calling YouTube so we don't waste quota on a mixed-script query that yields 0 hits.
        if (
            subject
            and _NON_ASCII_RE.search(subject)
            and not _NON_ASCII_RE.search(focus)
            and _LATIN_WORD_RE.search(focus)
        ):
            en_map = await _resolve_to_english([subject], lang, client)
            subj_en = en_map.get(subject)
            if subj_en:
                subject_variants.append(subj_en)
                search_q = f"{subj_en} {focus}"[:MAX_QUERY_CHARS]
                search_lang = "en"

        candidates, err = await _fetch_youtube_candidates(client, search_q, search_lang, api_key)
        if err:
            return {"configured": True, "items": [], "error": err}

        # When the query is non-ASCII (e.g. Hebrew) and YouTube returned either <2 items or predominantly
        # Latin-titled videos (via YouTube's cross-lingual KG), resolve English entity counterparts so we can
        # accurately filter out off-topic videos and fall back to an English search if <2 items match the event.
        if context and _NON_ASCII_RE.search(search_q):
            non_ascii_titles = sum(1 for c in (candidates or []) if _NON_ASCII_RE.search(c.get("title") or ""))
            needs_en_context = len(candidates or []) < 2 or non_ascii_titles * 2 <= len(candidates or [])
            if needs_en_context:
                en_map = await _resolve_to_english([subject, focus], lang, client)
                subj_en = en_map.get(subject)
                focus_en = en_map.get(focus)
                if subj_en and subj_en not in subject_variants:
                    subject_variants.append(subj_en)
                if focus_en and focus_en not in focus_variants:
                    focus_variants.append(focus_en)

                ranked_items, focus_matches = _rank_candidates(candidates or [], subject_variants, focus_variants)
                if focus_matches < 2 and focus_en:
                    fb_subj = subj_en or (subject if not _NON_ASCII_RE.search(subject) else "")
                    fb_q = f"{fb_subj} {focus_en}".strip()[:MAX_QUERY_CHARS]
                    if fb_q and fb_q.lower() != search_q.lower():
                        fb_candidates, fb_err = await _fetch_youtube_candidates(client, fb_q, "en", api_key)
                        if not fb_err and fb_candidates:
                            ranked_items, _ = _rank_candidates(fb_candidates, subject_variants, focus_variants)

                result = {"configured": True, "items": ranked_items}
                _cache_put(key, result)
                await _remote_put(client, key, q, lang, result["items"])
                return result

        if context:
            ranked_items, _ = _rank_candidates(candidates or [], subject_variants, focus_variants)
        else:
            ranked_items = _strip_internal_fields(candidates or [])

        result = {"configured": True, "items": ranked_items}
        _cache_put(key, result)
        await _remote_put(client, key, q, lang, result["items"])
        return result
