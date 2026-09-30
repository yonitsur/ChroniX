"""YouTube Data API search for the event drawer's Videos tab (server-side so the API key stays private)."""
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
CACHE_MAX_ENTRIES = 1000
CACHE_TABLE = "youtube_search_cache"
MAX_RESULTS = 8
MAX_QUERY_CHARS = 150
_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_LANG_RE = re.compile(r"^[a-z]{2,3}$")
_REMOTE_TIMEOUT = httpx.Timeout(6.0, connect=4.0)
_REMOTE_FAILURE_COOLDOWN = 300.0
_remote_disabled_until = 0.0

# Each uncached search costs 100 of the default 10,000 daily quota units, so cache in two layers:
# process memory (fast, lost on restart) and Supabase (survives Render redeploys/spin-downs).
_cache: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()


def _api_key() -> str:
    return (os.getenv("YOUTUBE_API_KEY") or "").strip()


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


def _parse_items(payload: dict) -> list[dict]:
    items = []
    for raw in payload.get("items") or []:
        video_id = (raw.get("id") or {}).get("videoId") or ""
        if not _VIDEO_ID_RE.match(video_id):
            continue
        snippet = raw.get("snippet") or {}
        thumbs = snippet.get("thumbnails") or {}
        thumb = (thumbs.get("medium") or thumbs.get("default") or {}).get("url") or ""
        items.append({
            "videoId": video_id,
            "title": html.unescape(snippet.get("title") or ""),
            "channel": html.unescape(snippet.get("channelTitle") or ""),
            "publishedAt": snippet.get("publishedAt") or "",
            "thumbnail": thumb if thumb.startswith("https://") else "",
        })
    return items


async def search_youtube_videos(query: str, lang: str | None = None) -> dict:
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

    params = {
        "part": "snippet",
        "type": "video",
        "maxResults": MAX_RESULTS,
        "q": q,
        "safeSearch": "strict",
        "videoEmbeddable": "true",
        "key": api_key,
    }
    if lang:
        params["relevanceLanguage"] = lang

    async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=5.0)) as client:
        stored = await _remote_get(client, key)
        if stored is not None:
            _cache_put(key, stored)
            return stored

        try:
            resp = await client.get(SEARCH_URL, params=params)
        except httpx.HTTPError as e:
            # Log only the type: httpx error messages can include the request URL (and thus the key).
            logger.warning("YouTube search request failed: %s", type(e).__name__)
            return {"configured": True, "items": [], "error": "unavailable"}

        if resp.status_code != 200:
            logger.warning("YouTube search returned HTTP %s", resp.status_code)
            # 403 is almost always the daily quota being exhausted.
            return {"configured": True, "items": [], "error": "quota" if resp.status_code == 403 else "unavailable"}

        result = {"configured": True, "items": _parse_items(resp.json())}
        _cache_put(key, result)
        await _remote_put(client, key, q, lang, result["items"])
        return result
