import asyncio
import contextlib
import json
import logging
import os
import re
import time
import unicodedata
import urllib.parse
from typing import Dict, Any, Optional, List
import httpx

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "ChroniXApp/1.0 (https://github.com/yonitsur/VisualTimeLine; yonitsur@gmail.com)"
}

_WIKI_CACHE_TTL = 1800  # 30 minutes
_RAW_SUMMARY_CACHE: Dict[tuple, Any] = {}   # (lang, clean_title_lower) -> (expires_at, (status_code, json_dict))
_SEARCH_CACHE: Dict[tuple, Any] = {}        # (lang, query_lower, limit) -> (expires_at, List[str])
_LANGLINK_CACHE: Dict[tuple, Any] = {}      # (from_lang, to_lang, clean_title_lower) -> (expires_at, Optional[str])
_PROBE_CACHE: Dict[tuple, Any] = {}         # (from_lang, to_lang, clean_title_lower) -> (expires_at, Optional[Dict])
_COMMONS_GIF_CACHE: Dict[tuple, Any] = {}   # (query_lower, limit) -> (expires_at, List[Dict])

_ORIG_ASYNC_CLIENT = httpx.AsyncClient
_SHARED_HTTP_CLIENT: Optional[httpx.AsyncClient] = None
_SHARED_HTTP_CLIENT_LOOP = None


def _is_real_http_client(client: Any) -> bool:
    """True when `client` is a genuine httpx.AsyncClient (false for unit-test FakeClient doubles)."""
    return isinstance(client, _ORIG_ASYNC_CLIENT) and httpx.AsyncClient is _ORIG_ASYNC_CLIENT


def _get_shared_http_client() -> httpx.AsyncClient:
    """Return a loop-bound persistent httpx.AsyncClient with keep-alive connection pooling."""
    global _SHARED_HTTP_CLIENT, _SHARED_HTTP_CLIENT_LOOP
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
            follow_redirects=True,
            limits=httpx.Limits(max_connections=60, max_keepalive_connections=30),
        )
        _SHARED_HTTP_CLIENT_LOOP = loop
    return _SHARED_HTTP_CLIENT


@contextlib.asynccontextmanager
async def _http_client_scope():
    """Yield the shared keep-alive httpx.AsyncClient in production, or a scoped client if monkeypatched."""
    if httpx.AsyncClient is _ORIG_ASYNC_CLIENT:
        yield _get_shared_http_client()
    else:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            yield client


def _cache_get(store: dict, key):
    entry = store.get(key)
    if not entry:
        return None
    expires_at, value = entry
    if expires_at < time.monotonic():
        store.pop(key, None)
        return None
    return value


def _cache_put(store: dict, key, value, ttl: int = _WIKI_CACHE_TTL):
    store[key] = (time.monotonic() + ttl, value)

def generate_title_variations(raw_title: str, lang: str = "en") -> List[str]:
    """
    Generate clean candidate titles by stripping subtitles and parentheticals.
    Universal across languages without hardcoded dictionaries or heuristic rules.
    """
    if not raw_title:
        return []

    clean = raw_title.strip()
    variations = [clean]

    # 1. Subtitle separators (e.g. "Title: Subtitle" or "Title - Subtitle")
    for sep in [":", " - ", " – ", " — "]:
        if sep in clean:
            prefix = clean.split(sep, 1)[0].strip()
            if prefix and prefix not in variations:
                variations.append(prefix)

    # 2. Parenthetical qualifier stripping (e.g. "Title (qualifier)" -> "Title")
    no_parens = re.sub(r'\s*\([^)]*\)', '', clean).strip()
    if no_parens and no_parens not in variations:
        variations.append(no_parens)

    return variations


def is_title_relevant(candidate_title: str, query_title: str) -> bool:
    """
    Generic relevance validation between a candidate Wikipedia title and the requested title.
    Accepts:
    1. Exact matches (case-insensitive)
    2. Parenthetical disambiguation qualifiers (e.g. 'Sparta' -> 'Sparta (mythology)')
    3. Subtitle prefix matches (e.g. 'Battle of Midway: Pacific Theatre' -> 'Battle of Midway')
    4. Multi-word entity containment (e.g. 'Mount Everest' inside 'First ascent of Mount Everest')
    Rejects completely different subjects/names without hardcoded word lists.
    """
    c = candidate_title.strip().lower()
    q = query_title.strip().lower()

    if not c or not q:
        return False

    if c == q:
        return True

    # Disambiguation parenthetical: "Title (qualifier)" matching "Title"
    if c.startswith(f"{q} (") or q.startswith(f"{c} ("):
        return True

    # Base without parentheticals
    c_base = re.sub(r'\s*\([^)]*\)', '', c).strip()
    q_base = re.sub(r'\s*\([^)]*\)', '', q).strip()
    if c_base == q_base:
        return True

    # Hyphen/whitespace-insensitive compound match (e.g. 'Hakuba-kai' vs 'Hakubakai', 'Ukiyo-e' vs 'Ukiyoe')
    c_dehyph = re.sub(r'[\s\-–—]+', '', c_base)
    q_dehyph = re.sub(r'[\s\-–—]+', '', q_base)
    if len(c_dehyph) >= 4 and c_dehyph == q_dehyph:
        return True

    # Subtitle prefix: "Title: Subtitle" -> "Title"
    for sep in [":", " - ", " – ", " — "]:
        if q_base.startswith(f"{c_base}{sep}") or c_base.startswith(f"{q_base}{sep}"):
            return True

    # Entity containment inside descriptive query:
    # 1. Multi-word entity contained inside query, or multi-word query contained inside candidate
    #    (e.g. "Mount Everest" inside "First ascent of Mount Everest")
    if (len(c_base.split()) >= 2 and c_base in q_base) or (len(q_base.split()) >= 2 and q_base in c_base):
        return True

    # 1b. Morphological multi-word token subset (e.g. "National Industrial Exhibitions" inside
    #     "First National Industrial Exhibition")
    c_tokens = _content_tokens(c_base)
    q_tokens = _content_tokens(q_base)
    if len(c_tokens) >= 2 and len(q_tokens) >= 2:
        matched_c = sum(1 for ct in c_tokens if any(are_tokens_related(ct, qt) for qt in q_tokens))
        matched_q = sum(1 for qt in q_tokens if any(are_tokens_related(qt, ct) for ct in c_tokens))
        if matched_c == len(c_tokens) or matched_q == len(q_tokens):
            return True

    # 2. Single-word entity (length >= 3) contained as a distinct token or with a single-character prefix
    #    (e.g. "Cambrian" inside "The Cambrian Period", or prefixed grammatical forms)
    if len(c_base.split()) == 1 and len(c_base) >= 3:
        tokens = set(re.findall(r'[\w]+', q_base))
        if c_base in tokens:
            return True
        for t in tokens:
            if len(t) == len(c_base) + 1 and t.endswith(c_base):
                return True

    return False


def is_likely_searchable_entity(text: str) -> bool:
    """
    Determine if a title string represents a plausible named entity or article title
    rather than a full sentence, action phrase, or narrative clause.
    Universal across languages: relies on token count and sentence punctuation.
    """
    if not text:
        return False
    clean = text.strip()
    if any(p in clean for p in [".", "!", "?", ";"]):
        return False
    words = clean.split()
    if len(words) > 6:
        return False
    return True


_STOPWORDS = frozenset({
    "the", "and", "for", "was", "were", "with", "from", "that", "this", "into",
    "over", "after", "before", "under", "between", "through", "during", "about",
    "against", "among", "within", "without", "but", "not", "are", "has", "had",
    "have", "its", "his", "her", "their", "our", "your", "who", "whom", "whose",
    "which", "what", "where", "when", "why", "how", "all", "any", "both", "each",
    "some", "such", "than", "too", "very", "can", "will", "just", "should", "also",
    # Common European grammatical function words
    "les", "des", "une", "dans", "pour", "par", "sur", "avec", "plus", "sont",
    "los", "las", "una", "del", "por", "con", "para", "como", "fue", "son",
    "der", "die", "das", "und", "von", "mit", "auf", "für", "ist", "war", "den", "dem", "ein", "eine",
    # Common Hebrew grammatical function words
    "את", "של", "על", "עם", "או", "גם", "רק", "כי", "אם", "לא", "כן", "זה", "זו", "אלה", "אלו",
    "הוא", "היא", "הם", "הן", "היה", "היתה", "הייתה", "היו", "כמו", "אחר", "אחרי", "לפני", "בין",
})


def are_tokens_related(t1: str, t2: str) -> bool:
    """
    Check if two tokens share a common stem or morphological relationship.
    Language-agnostic: handles prefix attachments (prepositions/articles),
    suffix attachments (plurals/inflections), and stem consonant/vowel shifts.
    """
    if t1 == t2:
        return True
    len1, len2 = len(t1), len(t2)
    if len1 < 3 or len2 < 3:
        return False
    # Numeric tokens (years, model numbers) must match exactly — '1908' is not an inflection of '1907'
    if any(ch.isdigit() for ch in t1) or any(ch.isdigit() for ch in t2):
        return False

    short_len = min(len1, len2)
    # 1. Prefix attachment (e.g. prepositions/articles un-/re-, Hebrew/Arabic 1-letter prefixes):
    # Require base token >= 4 chars (or non-ASCII script with 1-char prefix) so 3-letter English
    # words like "art"/"era"/"war" do not falsely match "part"/"start"/"opera"/"award".
    if short_len >= 4 or (abs(len1 - len2) == 1 and not (t1.isascii() and t2.isascii())):
        if len1 > len2 and (len1 - len2) <= 2 and t1.endswith(t2):
            return True
        if len2 > len1 and (len2 - len1) <= 2 and t2.endswith(t1):
            return True

    # 2. Suffix attachment (e.g. plurals -s, -es, gender/case inflections):
    if short_len >= 4 or (abs(len1 - len2) == 1 and (t1.endswith("s") or t2.endswith("s"))):
        if len1 > len2 and (len1 - len2) <= 3 and t1.startswith(t2):
            return True
        if len2 > len1 and (len2 - len1) <= 3 and t2.startswith(t1):
            return True

    # 3. Common root/stem for words (length >= 4): share common prefix of at least len - 1 (or >= 4 chars)
    # Handles morphological inflections where final consonant or vowel changes (e.g. y->i, city->cities)
    if short_len >= 4:
        common_len = 0
        for c1, c2 in zip(t1, t2):
            if c1 == c2:
                common_len += 1
            else:
                break
        if common_len >= 3 and common_len >= short_len - 1:
            return True

    return False


def _fold_latin_diacritics(text: str) -> str:
    """Fold Latin combining accents ('zürich' -> 'zurich', 'gödel' -> 'godel') while preserving non-Latin scripts."""
    return re.sub(r'[\u0300-\u036f]', '', unicodedata.normalize('NFKD', text or ''))


def generic_token_overlap(text1: str, text2: str) -> int:
    """
    Count overlapping or root-related content words of 3+ characters between two texts, language-agnostic.
    Filters universal function stopwords so common words ('the', 'and', 'was') do not inflate scores.
    """
    if not text1 or not text2:
        return 0
    s1 = _fold_latin_diacritics(text1.lower())
    s2 = _fold_latin_diacritics(text2.lower())
    t1 = {w for w in re.findall(r'\w{3,}', s1) if w not in _STOPWORDS}
    t2 = {w for w in re.findall(r'\w{3,}', s2) if w not in _STOPWORDS}
    if not t1 or not t2:
        return 0

    exact = t1.intersection(t2)
    matched_t1 = set(exact)
    matched_t2 = set(exact)

    rem1 = t1 - matched_t1
    rem2 = t2 - matched_t2
    for w1 in rem1:
        for w2 in rem2:
            if w2 not in matched_t2 and are_tokens_related(w1, w2):
                matched_t1.add(w1)
                matched_t2.add(w2)
                break

    return len(matched_t1)


def extract_temporal_span(text: str) -> Optional[tuple]:
    """
    Extract birth/death years or active era from Wikipedia summary/description.
    Language-agnostic extraction of parenthetical year ranges and birth years.
    Returns (start_year, end_year) or None.
    """
    if not text:
        return None
    snippet = text[:350]

    # Universal BC / BCE markers
    is_bc = bool(re.search(r'\b(BC|BCE|B\.C\.|B\.C\.E\.|av\. J\.-C\.|v\. Chr\.)\b', snippet, re.IGNORECASE))

    # 1. Inspect parenthetical content for dates: e.g. (1809–1865), (15 August 1769 – 5 May 1821), (born 1948)
    for content in re.findall(r'\(([^)]+)\)', snippet):
        sep_match = re.search(r'[–—\-]|(\s+(?:to|until)\s+)', content)
        if sep_match:
            parts = re.split(r'[–—\-]|(?:\s+(?:to|until)\s+)', content, maxsplit=1)
            left_part, right_part = parts[0], parts[1]

            left_years = re.findall(r'\b(\d{3,4})\b', left_part)
            right_years = re.findall(r'\b(\d{3,4})\b', right_part)

            if is_bc:
                left_bc = re.findall(r'\b(\d{1,4})\b', left_part)
                right_bc = re.findall(r'\b(\d{1,4})\b', right_part)
                if left_bc and right_bc:
                    y1 = int(left_bc[-1])
                    y2 = int(right_bc[-1])
                    return (-max(y1, y2), -min(y1, y2))

            if left_years and right_years:
                y1 = int(left_years[-1])
                y2 = int(right_years[-1])
                if is_bc:
                    return (-max(y1, y2), -min(y1, y2))
                return (min(y1, y2), max(y1, y2))
            elif left_years and any(w in right_part.lower() for w in ['present', 'actuel']):
                return (int(left_years[-1]), None)

        all_years = re.findall(r'\b(\d{3,4})\b', content)
        if all_years:
            if any(w in content.lower() for w in ['born', 'b.', 'né', 'geboren', 'present']):
                return (int(all_years[-1]), None)

    # 2. Free-standing year range: e.g. 1809–1865
    loose = re.search(r'\b(\d{3,4})\s*[–\-—]\s*(\d{3,4})\b', snippet)
    if loose:
        y1, y2 = int(loose.group(1)), int(loose.group(2))
        if 10 <= abs(y2 - y1) <= 125:
            if is_bc:
                return (-max(y1, y2), -min(y1, y2))
            return (min(y1, y2), max(y1, y2))

    return None


def is_temporally_compatible(event_year: int, span: tuple) -> bool:
    """
    Check if an event year is temporally compatible with a candidate entity's lifetime or active era.
    Allows a reasonable buffer for early career / posthumous immediate references.
    """
    start_year, end_year = span
    if end_year is not None:
        return (start_year - 20) <= event_year <= (end_year + 25)
    else:
        return (start_year - 5) <= event_year <= (start_year + 110)


# Calendar-year / decade pages ('1792', '1990s', '79 BC', 'AD 79') are never an event's subject.
_YEAR_TITLE_RE = re.compile(r'^(?:\d{1,4}s?|\d{1,4}\s+[^\d\s]{1,6}|[^\d\s]{1,3}\s+\d{1,4})$')


def _content_tokens(text: str) -> set:
    return {w for w in re.findall(r'\w{3,}', (text or "").lower()) if w not in _STOPWORDS}


def _paren_qualifiers(title: str) -> List[str]:
    return [q.strip() for q in re.findall(r'\(([^)]*)\)', title or "") if q.strip()]


def is_year_article_title(title: str) -> bool:
    return bool(_YEAR_TITLE_RE.match((title or "").strip()))


def title_year_conflicts(title: str, year: Optional[int]) -> bool:
    """
    True when a year inside the title's parenthetical qualifier is far from the event year,
    e.g. 'Siege of Jerusalem (1099)' for a 63 BCE event. Only qualifier years count: numbers in
    the title body are usually part of the name ('STS-114', 'Intel 4004'). Magnitudes are
    compared so BCE markers in any language don't need parsing.
    """
    if year is None or not isinstance(year, int):
        return False
    years = [int(y) for q in _paren_qualifiers(title) for y in re.findall(r'(?<!\d)\d{3,4}(?!\d)', q)]
    if not years:
        return False
    target = abs(year)
    tol = 20 if target < 3000 else target * 0.05
    if len(years) >= 2 and min(years) - tol <= target <= max(years) + tol:
        return False
    return all(abs(y - target) > tol for y in years)


def qualifier_supported(qualifier: str, cand: Dict[str, Any]) -> bool:
    """
    A requested disambiguation qualifier (e.g. 'continent', 'king of Israel') must be reflected in
    the candidate's title/description/extract; otherwise the candidate is a different sense.
    """
    q_tokens = _content_tokens(qualifier)
    if not q_tokens:
        return True
    cand_text = f"{cand.get('wikiTitle') or ''} {cand.get('description') or ''} {cand.get('extract') or ''}"
    need = len(q_tokens) if len(q_tokens) <= 2 else len(q_tokens) - 1
    return generic_token_overlap(qualifier, cand_text) >= need


def _dropped_parts(original: str, variation: str) -> tuple:
    """Return (dropped parenthetical qualifier text, dropped subtitle text) for a title variation."""
    var_quals = _paren_qualifiers(variation)
    dropped_quals = [q for q in _paren_qualifiers(original) if q not in var_quals]
    orig_np = re.sub(r'\s*\([^)]*\)', '', original or "").strip()
    var_np = re.sub(r'\s*\([^)]*\)', '', variation or "").strip()
    subtitle = ""
    if var_np and orig_np != var_np and orig_np.startswith(var_np):
        subtitle = orig_np[len(var_np):].strip(" :-–—")
    return " ".join(dropped_quals), subtitle


def score_candidate(
    cand: Dict[str, Any],
    query: str,
    context_text: str = "",
    year: Optional[int] = None
) -> int:
    """
    Compute a composite confidence score for a candidate Wikipedia article.
    Penalizes disambiguation/meta pages and temporal conflicts. Rewards exact matches,
    temporal compatibility, and contextual alignment.
    """
    score = 0
    cand_title = cand.get("wikiTitle") or ""
    cand_desc = cand.get("description") or ""
    cand_extract = cand.get("extract") or ""
    cand_type = cand.get("type") or ""

    q = query.strip().lower()
    c = cand_title.strip().lower()

    if not q or not c:
        return -500

    # 1. Disambiguation or Meta Page Penalty
    if cand_type == "disambiguation":
        return -500
    meta_indicators = ["disambiguation", "surname", "given name", "name list", "family name", "homonymie", "begriffsklärung"]
    if any(m in cand_desc.lower() for m in meta_indicators):
        return -500

    # 2. Title matching
    c_base = re.sub(r'\s*\([^)]*\)', '', c).strip()
    q_base = re.sub(r'\s*\([^)]*\)', '', q).strip()
    c_dehyph = re.sub(r'[\s\-–—]+', '', c_base)
    q_dehyph = re.sub(r'[\s\-–—]+', '', q_base)
    c_tokens_list = _content_tokens(c_base)
    q_tokens_list = _content_tokens(q_base)
    q_token_count = len(q_tokens_list)
    matched_c_tokens = (
        sum(1 for ct in c_tokens_list if any(are_tokens_related(ct, qt) for qt in q_tokens_list))
        if c_tokens_list and q_tokens_list else 0
    )
    matched_q_tokens = (
        sum(1 for qt in q_tokens_list if any(are_tokens_related(qt, ct) for ct in c_tokens_list))
        if c_tokens_list and q_tokens_list else 0
    )

    if c == q:
        score += 100
    elif c_base == q_base:
        score += 80
    elif len(c_dehyph) >= 4 and c_dehyph == q_dehyph:
        score += 85
    elif c.startswith(f"{q} (") or q.startswith(f"{c} ("):
        score += 75
    elif any(q_base.startswith(f"{c_base}{sep}") or c_base.startswith(f"{q_base}{sep}") for sep in [":", " - ", " – ", " — "]):
        score += 55
    elif len(c_base.split()) >= 2 and c_base in q_base:
        score += 30  # candidate is a sub-phrase of the query: usually the broader parent topic
    elif len(q_base.split()) >= 2 and q_base in c_base:
        score += 15  # candidate contains a multi-word query: usually a more specific work
    elif len(c_tokens_list) >= 2 and matched_c_tokens == len(c_tokens_list):
        score += 30  # morphological multi-word subset (e.g. 'National Industrial Exhibitions' in 'First National Industrial Exhibition')
    elif len(q_tokens_list) >= 2 and matched_q_tokens == len(q_tokens_list):
        score += 15
    elif len(c_base.split()) == 1 and len(c_base) >= 3 and (
        c_base in set(re.findall(r'[\w]+', q_base))
        or any(len(t) == len(c_base) + 1 and t.endswith(c_base) for t in re.findall(r'[\w]+', q_base))
    ):
        # One word of the query: strong only when it IS most of the query ('The Cambrian Period').
        score += 70 if q_token_count <= 2 else (45 if q_token_count == 3 else 20)
    else:
        score -= 50

    # A requested qualifier ('Tethys (ocean)') must not resolve to another sense ('Tethys' the goddess).
    q_quals = " ".join(_paren_qualifiers(query))
    if q_quals:
        c_quals = " ".join(_paren_qualifiers(cand_title))
        if c_quals:
            if not generic_token_overlap(q_quals, c_quals):
                score -= 150
        elif not qualifier_supported(q_quals, cand):
            score -= 150

    # Disambiguation qualifier token overlap with query and context (e.g. 'Mercury (planet)' in astronomy context)
    q_tokens_set = _content_tokens(q_base)
    non_query_ctx = " ".join(
        t for t in re.findall(r'\w{3,}', (context_text or "").lower())
        if t not in _STOPWORDS and not any(are_tokens_related(t, qt) for qt in q_tokens_set)
    )
    paren_match = re.search(r'\(([^)]+)\)', c)
    if paren_match:
        qualifier_text = paren_match.group(1).lower()
        q_overlap = generic_token_overlap(qualifier_text, q_base)
        if q_overlap:
            score += q_overlap * 25
        ctx_overlap = generic_token_overlap(qualifier_text, context_text) if context_text else 0
        if ctx_overlap:
            score += min(ctx_overlap * 20, 50)
        elif not q_quals and not q_overlap and not re.search(r'\b\d{3,4}\b', qualifier_text):
            # Candidate has a parenthetical sense disambiguator (e.g. "Gerhard Frey (politician)")
            # that was NOT requested in the query and does not overlap context.
            body_ctx_overlap = generic_token_overlap(f"{cand_desc} {cand_extract}", non_query_ctx) if non_query_ctx else 0
            if non_query_ctx and body_ctx_overlap == 0:
                score -= 35

    # 3. Temporal verification (crucial for distinguishing figures with shared names)
    if year is not None and isinstance(year, int):
        if title_year_conflicts(cand_title, year):
            score -= 200
        span = extract_temporal_span(f"{cand_desc} {cand_extract}")
        if span:
            if is_temporally_compatible(year, span):
                score += 50
            else:
                score -= 300  # Strict disqualification for candidate from the wrong era
        # Exact year match bonus
        if re.search(rf'\b{abs(year)}\b', f"{cand_desc} {cand_extract}"):
            score += 25

    # 4. Context overlap (timeline topic, subtitle, lane) excluding tokens already in the query
    if non_query_ctx:
        overlap = generic_token_overlap(f"{c} {cand_desc} {cand_extract}", non_query_ctx)
        score += min(overlap * 15, 60)

    # 5. Image bonus (quality indicator)
    if cand.get("imageUrl"):
        score += 10

    return score


MIN_CONFIDENCE_THRESHOLD = 60


def _record_article_candidate(
    sink: Optional[List[Dict[str, Any]]],
    cand: Optional[Dict[str, Any]],
) -> None:
    """Append a unique candidate article summary to `sink` for optional batch LLM adjudication."""
    if sink is None or not isinstance(cand, dict):
        return
    wt = (cand.get("wikiTitle") or "").strip()
    if not wt:
        return
    lg = (cand.get("lang") or "en").strip().lower()
    key = (lg, wt.lower())
    for existing in sink:
        if (
            (existing.get("lang") or "en").strip().lower() == key[0]
            and (existing.get("wikiTitle") or "").strip().lower() == key[1]
        ):
            return
    if len(sink) < 6:
        sink.append(dict(cand))


async def _resolve_disambiguation(
    title: str,
    client: httpx.AsyncClient,
    lang: str = "en",
    context_text: str = "",
    year: Optional[int] = None,
    candidate_sink: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Parse a disambiguation page and select the option with the highest
    relevance and temporal compatibility with the event context.
    """
    try:
        url = (
            f"https://{lang}.wikipedia.org/w/api.php?action=parse&page="
            f"{urllib.parse.quote(title.strip())}&prop=links|wikitext&format=json"
        )
        resp = await client.get(url, headers=HEADERS, timeout=5.0)
        if resp.status_code != 200:
            return None

        parse_data = resp.json().get("parse", {})
        mainspace_links = {
            l.get("*", "").strip()
            for l in parse_data.get("links", [])
            if l.get("ns") == 0 and l.get("*")
        }

        wt = parse_data.get("wikitext", {}).get("*", "")
        candidates = []
        see_also_re = re.compile(
            r'^==+\s*(?:see also|ראו גם|voir aussi|siehe auch|véase también|vedi anche|ver também|см\.\s*также)\s*==+',
            re.IGNORECASE,
        )
        for line in wt.split("\n"):
            if see_also_re.match(line.strip()):
                break
            matches = re.findall(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]', line)
            if matches:
                clean_line = re.sub(r'\[\[(?:[^\]|]+\|)?([^\]]+)\]\]', r'\1', line)
                for raw_link in matches:
                    # MediaWiki prop=links strips section fragments (#Section), so strip them here too
                    link = raw_link.split("#", 1)[0].strip()
                    if not link:
                        continue
                    if link in mainspace_links or (not mainspace_links and ":" not in link):
                        candidates.append((link, clean_line))
                        break  # Only the first valid mainspace link on a disambiguation bullet is the target

        if not candidates:
            return None

        # Every option repeats the ambiguous name itself, so those tokens carry no evidence.
        name_tokens = _content_tokens(re.sub(r'\s*\([^)]*\)', '', title))
        non_name_ctx = " ".join(
            t for t in re.findall(r'\w{3,}', (context_text or "").lower())
            if t not in _STOPWORDS and not any(are_tokens_related(t, nt) for nt in name_tokens)
        )

        def discriminative_text(text: str) -> str:
            return " ".join(
                t for t in re.findall(r'\w{3,}', text.lower())
                if t not in _STOPWORDS and not any(are_tokens_related(t, nt) for nt in name_tokens)
            )

        def score_disambig_candidate(link: str, desc: str) -> int:
            topical_overlap = generic_token_overlap(discriminative_text(f"{link} {desc}"), context_text)
            sc = topical_overlap * 15

            # Check parenthetical sense qualifier on the link (e.g. "Mercury (planet)")
            link_quals = [
                q for q in _paren_qualifiers(link)
                if not re.fullmatch(r'[\d\s–\-—bcadce.]+', q.lower())
            ]
            if link_quals and context_text:
                qual_ov = generic_token_overlap(" ".join(link_quals), context_text)
                if qual_ov >= 1:
                    sc += min(qual_ov * 20, 40)
                else:
                    sc -= 15

            if year is not None and isinstance(year, int):
                if title_year_conflicts(link, year):
                    return -200
                span = extract_temporal_span(f"{link} {desc}")
                if span:
                    if is_temporally_compatible(year, span):
                        if span[1] is None or year <= span[1]:
                            if not context_text:
                                sc += 30
                            elif topical_overlap >= 1:
                                sc += 10
                    else:
                        sc -= 200
                if re.search(rf'\b{abs(year)}\b', desc):
                    sc += 30
            return sc

        best_by_link: Dict[str, int] = {}
        for link, desc in candidates:
            sc = score_disambig_candidate(link, desc)
            if sc > best_by_link.get(link, -10**9):
                best_by_link[link] = sc
        scored = sorted(((sc, link) for link, sc in best_by_link.items()), key=lambda x: x[0], reverse=True)

        top_score, top_title = scored[0]
        runner_up = scored[1][0] if len(scored) > 1 else None
        viable = [link for sc, link in scored if sc >= -15][:4]

        if top_score >= 15 and (runner_up is None or top_score > runner_up):
            top_res = await _get_summary_direct(top_title, client, lang=lang, resolve_disambig=False, year=year)
            if top_res:
                top_res["_resolution_mode"] = "disambig"
                _record_article_candidate(candidate_sink, top_res)
                if candidate_sink is not None and _is_real_http_client(client) and len(viable) > 1:
                    extra_summaries = await asyncio.gather(
                        *[_get_summary_direct(lk, client, lang=lang, resolve_disambig=False, year=year) for lk in viable[1:4]],
                        return_exceptions=True,
                    )
                    for es in extra_summaries:
                        if isinstance(es, dict) and es.get("wikiTitle"):
                            _record_article_candidate(candidate_sink, es)
                if not non_name_ctx or not _is_real_http_client(client) or len(viable) <= 1 or top_score >= 30:
                    return top_res
                top_body_ov = generic_token_overlap(
                    discriminative_text(f"{top_res.get('wikiTitle', '')} {top_res.get('description', '')} {top_res.get('extract', '')}"),
                    non_name_ctx,
                )
                if top_body_ov >= 2:
                    return top_res

        # Tie-breaker when short disambiguation bullets lack context keywords (e.g. "Gerhard Frey (mathematician)"
        # vs "Gerhard Frey (politician)" where "Fermat" / "elliptic curve" appear in the article summary, not the bullet):
        if (non_name_ctx or candidate_sink is not None) and len(viable) >= 1 and _is_real_http_client(client):
            summaries = await asyncio.gather(
                *[_get_summary_direct(lk, client, lang=lang, resolve_disambig=False, year=year) for lk in viable],
                return_exceptions=True,
            )
            best_sum = None
            best_sum_score = -10**9
            runner_up_sum_score = -10**9
            for s in summaries:
                if not isinstance(s, dict) or not s.get("wikiTitle"):
                    continue
                _record_article_candidate(candidate_sink, s)
                if not non_name_ctx:
                    continue
                body_ov = generic_token_overlap(
                    discriminative_text(f"{s.get('wikiTitle', '')} {s.get('description', '')} {s.get('extract', '')}"),
                    non_name_ctx,
                )
                if body_ov <= 0:
                    continue
                full_sc = max(
                    score_candidate(s, title, context_text=context_text, year=year),
                    score_candidate(s, s["wikiTitle"], context_text=context_text, year=year),
                )
                if full_sc > best_sum_score:
                    runner_up_sum_score = best_sum_score
                    best_sum_score = full_sc
                    best_sum = s
                elif full_sc > runner_up_sum_score:
                    runner_up_sum_score = full_sc
            if best_sum and best_sum_score >= MIN_CONFIDENCE_THRESHOLD and best_sum_score > runner_up_sum_score:
                best_sum["_resolution_mode"] = "disambig"
                return best_sum

    except Exception as e:
        logger.debug(f"Failed to resolve disambiguation for '{title}': {e}")

    return None


async def _get_summary_direct(
    title: str,
    client: httpx.AsyncClient,
    lang: str = "en",
    resolve_disambig: bool = True,
    context_text: str = "",
    year: Optional[int] = None,
    candidate_sink: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Fetch Wikipedia summary using REST API.
    Follows canonical server-side redirects automatically.
    Resolves disambiguation pages using context and year if resolve_disambig is True.
    Verifies temporal compatibility before returning standard articles.
    """
    clean = title.strip().replace(" ", "_")
    use_cache = _is_real_http_client(client)
    cache_key = (lang, clean.lower())
    data = None
    if use_cache:
        cached_raw = _cache_get(_RAW_SUMMARY_CACHE, cache_key)
        if cached_raw is not None:
            cached_status, cached_data = cached_raw
            if cached_status != 200 or not cached_data:
                return None
            data = cached_data

    if data is None:
        url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(clean, safe='')}"
        for attempt in range(2):
            try:
                resp = await client.get(url, headers=HEADERS, timeout=5.0)
                if resp.status_code == 429 and attempt == 0:
                    await asyncio.sleep(0.5)
                    continue
                if resp.status_code == 200:
                    data = resp.json()
                    if use_cache:
                        _cache_put(_RAW_SUMMARY_CACHE, cache_key, (200, data))
                elif use_cache and resp.status_code == 404:
                    _cache_put(_RAW_SUMMARY_CACHE, cache_key, (404, None))
                break
            except (httpx.TimeoutException, httpx.NetworkError):
                if attempt == 0:
                    await asyncio.sleep(0.3)
                    continue
                break
            except Exception:
                break

    if not data:
        return None

    if data.get("type") == "disambiguation":
        if resolve_disambig and (context_text or year is not None):
            disambig_kwargs = {"candidate_sink": candidate_sink} if candidate_sink is not None else {}
            return await _resolve_disambiguation(
                title, client, lang=lang, context_text=context_text, year=year, **disambig_kwargs
            )
        return None

    desc = data.get("description", "")
    ext = data.get("extract", "")
    landed_title = data.get("title", title)

    if is_year_article_title(landed_title) or title_year_conflicts(landed_title, year):
        logger.debug(f"Wikipedia summary '{landed_title}' rejected: year page or qualifier year far from {year}")
        return None

    # If year is provided, verify temporal compatibility for direct matches
    if year is not None and isinstance(year, int):
        span = extract_temporal_span(f"{desc} {ext}")
        if span and not is_temporally_compatible(year, span):
            logger.debug(
                f"Direct Wikipedia summary for '{title}' rejected due to temporal incompatibility "
                f"(event year: {year}, entity span: {span})"
            )
            return None

    thumb_info = data.get("thumbnail") if isinstance(data.get("thumbnail"), dict) else {}
    orig_info = data.get("originalimage") if isinstance(data.get("originalimage"), dict) else {}
    img_url = _upgrade_wikimedia_thumb_url(
        thumb_info.get("source"),
        orig_info.get("source"),
        orig_info.get("width"),
    )

    coords = data.get("coordinates")
    lat = None
    lng = None
    if coords and isinstance(coords, dict):
        lat = coords.get("lat")
        lng = coords.get("lon")

    out = {
        "wikiTitle": data.get("title", title),
        "wikiUrl": data.get("content_urls", {}).get("desktop", {}).get("page"),
        "extract": ext,
        "description": desc,
        "imageUrl": img_url,
        "lat": lat,
        "lng": lng,
        "lang": lang,
        "type": data.get("type", "standard"),
    }
    _record_article_candidate(candidate_sink, out)
    return out


async def _search_wikipedia_titles(
    query: str,
    client: httpx.AsyncClient,
    lang: str = "en",
    limit: int = 5
) -> List[str]:
    """Search Wikipedia titles using full-text CirrusSearch with OpenSearch fallback."""
    clean = query.strip()
    if not clean:
        return []

    use_cache = _is_real_http_client(client)
    cache_key = (lang, clean.lower(), limit)
    if use_cache:
        cached = _cache_get(_SEARCH_CACHE, cache_key)
        if cached is not None:
            return list(cached)

    # 1. CirrusSearch full-text search
    url = (
        f"https://{lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch="
        f"{urllib.parse.quote(clean)}&srlimit={limit}&format=json"
    )
    for attempt in range(2):
        try:
            resp = await client.get(url, headers=HEADERS, timeout=5.0)
            if resp.status_code == 429 and attempt == 0:
                await asyncio.sleep(0.5)
                continue
            if resp.status_code == 200:
                hits = resp.json().get("query", {}).get("search", [])
                titles = [h["title"] for h in hits if "title" in h]
                if titles:
                    if use_cache:
                        _cache_put(_SEARCH_CACHE, cache_key, titles)
                    return titles
            break
        except (httpx.TimeoutException, httpx.NetworkError):
            if attempt == 0:
                await asyncio.sleep(0.3)
                continue
            break
        except Exception:
            break

    # 2. OpenSearch prefix fallback
    try:
        url = (
            f"https://{lang}.wikipedia.org/w/api.php?action=opensearch&search="
            f"{urllib.parse.quote(clean)}&limit={limit}&namespace=0&format=json"
        )
        resp = await client.get(url, headers=HEADERS, timeout=4.0)
        if resp.status_code == 200:
            data = resp.json()
            if len(data) > 1 and data[1]:
                if use_cache:
                    _cache_put(_SEARCH_CACHE, cache_key, data[1])
                return data[1]
    except Exception:
        pass

    if use_cache:
        _cache_put(_SEARCH_CACHE, cache_key, [])
    return []


async def _get_langlink(
    title: str,
    from_lang: str,
    to_lang: str,
    client: httpx.AsyncClient
) -> Optional[str]:
    """
    Fetch canonical page title in another language edition using Wikipedia's
    native interlanguage links (langlinks / Wikidata).
    """
    if not title or not from_lang or not to_lang or from_lang == to_lang:
        return None
    clean = title.strip().replace(" ", "_")
    use_cache = _is_real_http_client(client)
    cache_key = (from_lang, to_lang, clean.lower())
    if use_cache:
        cached = _cache_get(_LANGLINK_CACHE, cache_key)
        if cached is not None:
            return cached if cached != "" else None
    try:
        url = (
            f"https://{from_lang}.wikipedia.org/w/api.php?action=query&titles="
            f"{urllib.parse.quote(clean)}&prop=langlinks&lllang={to_lang}&redirects=1&format=json"
        )
        resp = await client.get(url, headers=HEADERS, timeout=4.0)
        if resp.status_code == 200:
            pages = resp.json().get("query", {}).get("pages", {})
            for pid, page in pages.items():
                if pid != "-1":
                    links = page.get("langlinks", [])
                    if links and "*" in links[0]:
                        res = links[0]["*"]
                        if use_cache:
                            _cache_put(_LANGLINK_CACHE, cache_key, res)
                        return res
            if use_cache:
                _cache_put(_LANGLINK_CACHE, cache_key, "")
    except Exception:
        pass
    return None


async def _probe_title(
    title: str,
    from_lang: str,
    to_lang: str,
    client: httpx.AsyncClient
) -> Optional[Dict[str, Any]]:
    """
    One call: does `title` exist on `from_lang` Wikipedia (following redirects), and what is its
    `to_lang` interlanguage link? Returns None when the probe itself failed (unknown).
    """
    clean_key = (from_lang, to_lang, title.strip().lower())
    use_cache = _is_real_http_client(client)
    if use_cache:
        cached = _cache_get(_PROBE_CACHE, clean_key)
        if cached is not None:
            return dict(cached)
    try:
        url = (
            f"https://{from_lang}.wikipedia.org/w/api.php?action=query&format=json&redirects=1"
            f"&titles={urllib.parse.quote(title.strip())}&prop=langlinks&lllang={to_lang}"
        )
        resp = await client.get(url, headers=HEADERS, timeout=4.0)
        if resp.status_code != 200:
            return None
        pages = resp.json().get("query", {}).get("pages", {})
        for _pid, page in pages.items():
            if "missing" in page or "invalid" in page:
                out = {"exists": False, "langlink": None}
                if use_cache:
                    _cache_put(_PROBE_CACHE, clean_key, out)
                return out
            links = page.get("langlinks") or []
            out = {"exists": True, "langlink": links[0].get("*") if links else None}
            if use_cache:
                _cache_put(_PROBE_CACHE, clean_key, out)
            return out
    except Exception:
        return None
    return None


async def _lookup_direct(
    title: str,
    client: httpx.AsyncClient,
    lang: str,
    context_text: str = "",
    year: Optional[int] = None,
    skip_exact: bool = False,
    candidate_sink: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Direct REST lookup over the title and its simplified variations. When a variation drops a
    parenthetical qualifier ('Ur (continent)' -> 'Ur'), the landed article must still reflect that
    qualifier, otherwise the bare name has resolved to a different sense (e.g. 'Ur' the city).
    """
    sink_kw = {"candidate_sink": candidate_sink} if candidate_sink is not None else {}
    for cand in generate_title_variations(title, lang=lang):
        if skip_exact and cand == title.strip():
            continue
        qualifier, subtitle = _dropped_parts(title, cand)
        ctx = " ".join(p for p in (context_text, qualifier, subtitle) if p)
        res = await _get_summary_direct(
            cand, client, lang=lang, resolve_disambig=True, context_text=ctx, year=year, **sink_kw
        )
        if not res:
            continue
        if qualifier and not qualifier_supported(qualifier, res):
            logger.debug(f"'{cand}' -> '{res.get('wikiTitle')}' rejected: does not reflect qualifier '{qualifier}'")
            continue
        res.setdefault("_resolution_mode", "direct")
        return res
    return None


async def _find_best_search_candidate(
    query: str,
    candidate_queries: List[str],
    client: httpx.AsyncClient,
    lang: str = "en",
    context_text: str = "",
    year: Optional[int] = None,
    min_confidence: int = MIN_CONFIDENCE_THRESHOLD,
    candidate_sink: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Search Wikipedia across candidate query variations, score all candidate articles
    multi-dimensionally, and return the highest-scoring candidate ONLY if it meets
    the confidence threshold.
    """
    seen_titles = set()
    collected_titles: List[str] = []

    for q in candidate_queries:
        if not q:
            continue
        hits = await _search_wikipedia_titles(q, client, lang=lang, limit=5)
        for h in hits:
            if h not in seen_titles:
                seen_titles.add(h)
                collected_titles.append(h)
        if len(collected_titles) >= 7:
            break

    if not collected_titles:
        return None

    # Filter out titles that have zero lexical relevance to any variation for the deterministic scorer
    relevant_titles = [
        t for t in collected_titles
        if any(is_title_relevant(t, q) for q in candidate_queries)
    ]
    top_relevant = relevant_titles[:5]
    relevant_set = set(top_relevant)

    # When collecting candidates for the batch semantic LLM adjudicator on a real HTTP client,
    # also fetch summaries for the top 3 raw CirrusSearch hits even when their title shares 0
    # lexical tokens with the query (e.g. romaji/alias 'Monbushō Bijutsu Tenrankai' -> 'Japan Fine Arts Exhibition').
    titles_to_fetch = list(top_relevant)
    if candidate_sink is not None and _is_real_http_client(client):
        for raw_t in collected_titles[:3]:
            if raw_t not in relevant_set and len(titles_to_fetch) < 6:
                titles_to_fetch.append(raw_t)

    if not titles_to_fetch:
        return None

    sink_kw = {"candidate_sink": candidate_sink} if candidate_sink is not None else {}
    tasks = [
        _get_summary_direct(
            t, client, lang=lang, resolve_disambig=bool(context_text), context_text=context_text, year=year, **sink_kw
        )
        for t in titles_to_fetch
    ]
    summaries = await asyncio.gather(*tasks, return_exceptions=True)

    scored_candidates = []
    for req_title, s in zip(titles_to_fetch, summaries):
        if isinstance(s, dict) and s.get("wikiTitle"):
            _record_article_candidate(candidate_sink, s)
            if req_title not in relevant_set:
                continue
            sc = score_candidate(s, query, context_text=context_text, year=year)
            # When a relevant search hit `req_title` (e.g. 'Bunten' inside 'Bunten Exhibition') redirected
            # or disambiguated to its canonical article (e.g. 'Japan Fine Arts Exhibition'), also evaluate
            # against `req_title` / landed title if the landed article shares tokens with the query.
            if s["wikiTitle"].lower() != req_title.lower() and generic_token_overlap(
                f"{s.get('wikiTitle', '')} {s.get('description', '')} {s.get('extract', '')}",
                query,
            ) >= 1:
                sc = max(sc, score_candidate(s, s["wikiTitle"], context_text=context_text, year=year) - 15)
            if sc >= min_confidence:
                scored_candidates.append((sc, s))

    if not scored_candidates:
        return None

    scored_candidates.sort(key=lambda x: x[0], reverse=True)

    # Check for ambiguity tie between distinct entities
    if len(scored_candidates) > 1:
        top_score, top_cand = scored_candidates[0]
        second_score, second_cand = scored_candidates[1]
        if top_cand.get("wikiTitle") != second_cand.get("wikiTitle") and abs(top_score - second_score) <= 5:
            top_span = extract_temporal_span(f"{top_cand.get('description', '')} {top_cand.get('extract', '')}")
            second_span = extract_temporal_span(f"{second_cand.get('description', '')} {second_cand.get('extract', '')}")
            if not top_span and not second_span:
                logger.info(
                    f"Ambiguous Wikipedia match between '{top_cand.get('wikiTitle')}' and "
                    f"'{second_cand.get('wikiTitle')}' for query '{query}'. Returning no link."
                )
                return None

    winner = scored_candidates[0][1]
    winner["_resolution_mode"] = "search"
    return winner


async def fetch_wikipedia_summary(
    title: str,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    lang: str = "en",
    context_text: str = "",
    year: Optional[int] = None,
    is_prehistoric: bool = False,
    fallback_lang: str = "en",
    fallback_title: Optional[str] = None,
    candidate_sink: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Fetch summary, thumbnail image, and page URL from Wikipedia REST API.
    Precision-first multilingual architecture (exact matches always before fuzzy ones):
    1. Direct REST lookup on the title and qualifier-safe variations with temporal validation.
    2. Cross-lingual exact bridge: the exact fallback-language title's interlanguage link to the
       primary language, else the exact fallback-language article itself.
    3. Multi-candidate scored search in the primary language with strict confidence gating.
    4. Scored search in the fallback language.
    """
    if not title:
        return {}

    lang = (lang or "en").strip().lower()
    fallback_lang = (fallback_lang or "en").strip().lower()
    cross_lingual = lang != fallback_lang
    sink_kw = {"candidate_sink": candidate_sink} if candidate_sink is not None else {}

    async with semaphore:
        candidates = generate_title_variations(title, lang=lang)
        fb_target = (fallback_title or "").strip()
        if not fb_target and cross_lingual and is_likely_searchable_entity(title):
            fb_target = title.strip()

        # When cross-lingual and an explicit fallback_title is provided on a real HTTP client,
        # prefetch the fallback-language summary in parallel with the primary lookup so step 2
        # and step 4 (coordinate/thumbnail supplementation) don't pay a second serial round-trip.
        fb_prefetch_task = None
        if cross_lingual and (fallback_title or "").strip() and _is_real_http_client(client):
            fb_prefetch_task = asyncio.create_task(
                _lookup_direct(fb_target, client, fallback_lang, context_text, year)
            )

        try:
            # 1. Primary language: Direct REST lookup
            primary_res = await _lookup_direct(title, client, lang, context_text, year, **sink_kw)
            pre_probed = None

            # 1b. Guard against cross-lingual false homographs (e.g. Hebrew 'גיאה' = Moshav Ge'a vs
            #     fallback_title='Carrozzeria Ghia', or 'מיקרוגרפיה' = Jewish calligraphy vs 'Micrographia'):
            #     when the primary article has zero non-title context overlap with the event and the
            #     explicit fallback_title exists on fallback_lang without linking to this primary page,
            #     prefer the cross-lingual bridge (Step 2) over the unrelated local homograph.
            if primary_res and cross_lingual and (fallback_title or "").strip() and fb_target.lower() != title.strip().lower():
                title_tokens = _content_tokens(title)
                non_title_ctx = " ".join(
                    t for t in re.findall(r'\w{3,}', (context_text or "").lower())
                    if t not in _STOPWORDS and not any(are_tokens_related(t, tt) for tt in title_tokens)
                )
                primary_text = f"{primary_res.get('description') or ''} {primary_res.get('extract') or ''}"
                if non_title_ctx and generic_token_overlap(non_title_ctx, primary_text) == 0:
                    pre_probed = await _probe_title(fb_target, fallback_lang, lang, client)
                    if pre_probed and pre_probed.get("exists") and pre_probed.get("langlink") != primary_res.get("wikiTitle"):
                        primary_res = None

            # 2. Cross-lingual exact bridge, before any fuzzy search: an exact fallback-language title
            #    beats a loose primary-language search hit (e.g. the city 'Mantinea' for the battle).
            if not primary_res and cross_lingual and fb_target:
                probe = pre_probed if pre_probed is not None else await _probe_title(fb_target, fallback_lang, lang, client)
                linked_title = probe.get("langlink") if probe else await _get_langlink(
                    fb_target, from_lang=fallback_lang, to_lang=lang, client=client
                )
                if linked_title:
                    primary_res = await _get_summary_direct(
                        linked_title, client, lang=lang, resolve_disambig=True, context_text=context_text, year=year, **sink_kw
                    )
                    if primary_res:
                        primary_res.setdefault("_resolution_mode", "bridge")
                if not primary_res:
                    skip_ex = probe is not None and not probe.get("exists")
                    if fb_prefetch_task is not None and not skip_ex:
                        res = await fb_prefetch_task
                        _record_article_candidate(candidate_sink, res)
                    else:
                        res = await _lookup_direct(
                            fb_target, client, fallback_lang, context_text, year,
                            skip_exact=skip_ex,
                            **sink_kw,
                        )
                    if res:
                        res.setdefault("_resolution_mode", "bridge")
                        return res

            # 2b. The primary-language title itself may be a fallback-language title (e.g. an English
            #     game name inside a Hebrew timeline).
            if not primary_res and cross_lingual and fallback_title and title.strip() != fb_target:
                linked_title = await _get_langlink(title, from_lang=fallback_lang, to_lang=lang, client=client)
                if linked_title:
                    primary_res = await _get_summary_direct(
                        linked_title, client, lang=lang, resolve_disambig=True, context_text=context_text, year=year, **sink_kw
                    )
                    if primary_res:
                        primary_res.setdefault("_resolution_mode", "bridge")

            # 3. Primary language: Multi-candidate search fallback
            if not primary_res:
                primary_res = await _find_best_search_candidate(
                    query=title,
                    candidate_queries=candidates,
                    client=client,
                    lang=lang,
                    context_text=context_text,
                    year=year,
                    min_confidence=MIN_CONFIDENCE_THRESHOLD,
                    **sink_kw,
                )

            # 4. If primary language article found: supplement missing thumbnail / coordinates / English title from fallback language
            if primary_res:
                need_supplement = not primary_res.get("imageUrl") or primary_res.get("lat") is None
                if lang != fallback_lang and (need_supplement or fb_prefetch_task is not None):
                    supplement_target = (fallback_title or "").strip()
                    if not supplement_target and need_supplement and primary_res.get("wikiTitle"):
                        # Use native interlanguage links to find canonical article in fallback language
                        supplement_target = await _get_langlink(
                            primary_res["wikiTitle"],
                            from_lang=lang,
                            to_lang=fallback_lang,
                            client=client
                        ) or ""
                    if not supplement_target and need_supplement and is_likely_searchable_entity(title):
                        supplement_target = title.strip()

                    if supplement_target:
                        # Guarded lookup so a stripped qualifier can't borrow another sense's photo/coords.
                        if fb_prefetch_task is not None and supplement_target == fb_target:
                            sup_res = await fb_prefetch_task
                        else:
                            sup_res = await _lookup_direct(supplement_target, client, fallback_lang, context_text, year)
                        if sup_res:
                            if not primary_res.get("imageUrl") and sup_res.get("imageUrl"):
                                primary_res["imageUrl"] = sup_res["imageUrl"]
                            elif sup_res.get("imageUrl"):
                                primary_res["fallbackImageUrl"] = sup_res["imageUrl"]
                            if primary_res.get("lat") is None and sup_res.get("lat") is not None:
                                primary_res["lat"] = sup_res["lat"]
                                primary_res["lng"] = sup_res.get("lng")
                            primary_res["fallbackWikiTitle"] = sup_res.get("wikiTitle")
                return primary_res

            # 4. Fallback-language scored search (its exact/direct lookup already ran in step 2)
            if cross_lingual and fb_target:
                res = await _find_best_search_candidate(
                    query=fb_target,
                    candidate_queries=generate_title_variations(fb_target, lang=fallback_lang),
                    client=client,
                    lang=fallback_lang,
                    context_text=context_text,
                    year=year,
                    min_confidence=MIN_CONFIDENCE_THRESHOLD,
                    **sink_kw,
                )
                if res:
                    return res

            return {}
        finally:
            if fb_prefetch_task is not None and not fb_prefetch_task.done():
                fb_prefetch_task.cancel()


_DEFAULT_FETCH_WIKIPEDIA_SUMMARY = fetch_wikipedia_summary


async def search_wikipedia_candidates(
    query: str,
    client: httpx.AsyncClient,
    lang: str = "en",
    context_text: str = "",
    limit: int = 5,
    fallback_lang: str = "en",
    year: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Search Wikipedia for multiple candidate articles matching a query, scored and ranked
    with temporal and contextual awareness.
    """
    clean = query.strip()
    if not clean:
        return []

    lang = (lang or "en").strip().lower()
    fallback_lang = (fallback_lang or "en").strip().lower()
    titles_set: List[str] = []

    # 1. Search combined query if context is provided
    if context_text and context_text.lower() not in clean.lower():
        combined_query = f"{clean} {context_text}"
        context_hits = await _search_wikipedia_titles(combined_query, client, lang=lang, limit=limit)
        for t in context_hits:
            if t not in titles_set:
                titles_set.append(t)

    # 2. Search direct query
    direct_hits = await _search_wikipedia_titles(clean, client, lang=lang, limit=limit)
    for t in direct_hits:
        if t not in titles_set:
            titles_set.append(t)

    # 3. OpenSearch prefix fallback
    try:
        url = (
            f"https://{lang}.wikipedia.org/w/api.php?action=opensearch&search="
            f"{urllib.parse.quote(clean)}&limit={limit}&namespace=0&format=json"
        )
        resp = await client.get(url, headers=HEADERS, timeout=3.0)
        if resp.status_code == 200:
            data = resp.json()
            if len(data) > 1 and data[1]:
                for t in data[1]:
                    if t not in titles_set:
                        titles_set.append(t)
    except Exception:
        pass

    # 4. Fetch rich summaries for candidates
    candidates_to_fetch = titles_set[:limit + 3]
    tasks = [_get_summary_direct(t, client, lang=lang, resolve_disambig=False, year=year) for t in candidates_to_fetch]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    valid_candidates = []
    seen_titles = set()
    for res in results:
        if isinstance(res, dict) and res.get("wikiTitle"):
            wt = res["wikiTitle"]
            if wt not in seen_titles:
                seen_titles.add(wt)
                valid_candidates.append(res)

    # 5. English candidate fallback if primary language found fewer than 2 hits
    if len(valid_candidates) < 2 and lang != fallback_lang and is_likely_searchable_entity(clean):
        try:
            fb_direct = await _search_wikipedia_titles(clean, client, lang=fallback_lang, limit=limit)
            fb_fetch = [t for t in fb_direct if t not in seen_titles][:limit]
            fb_tasks = [_get_summary_direct(t, client, lang=fallback_lang, resolve_disambig=False, year=year) for t in fb_fetch]
            fb_results = await asyncio.gather(*fb_tasks, return_exceptions=True)
            for res in fb_results:
                if isinstance(res, dict) and res.get("wikiTitle"):
                    wt = res["wikiTitle"]
                    if wt not in seen_titles:
                        seen_titles.add(wt)
                        valid_candidates.append(res)
        except Exception:
            pass

    # 6. Rank candidates by composite score
    valid_candidates.sort(
        key=lambda cand: score_candidate(cand, clean, context_text=context_text, year=year),
        reverse=True
    )
    # Filter out completely disqualified candidates (e.g. severe temporal contradiction or disambiguation)
    filtered = [
        c for c in valid_candidates
        if score_candidate(c, clean, context_text=context_text, year=year) > -150
    ]
    return filtered[:limit] if filtered else valid_candidates[:limit]


# ---------------------------------------------------------------------------
# Multi-source image retrieval, ranking & timeline-wide de-duplication
# ---------------------------------------------------------------------------

# Files that are almost never a meaningful illustration of a specific subject.
IMAGE_JUNK_KEYWORDS = (
    "flag", "coat_of_arms", "coat-of-arms", "logo", "icon", "symbol",
    "locator", "location_map", "locationmap", "location-map", "orthographic",
    "blank_map", "blankmap", "wikidata", "commons-logo", "wikimedia",
    "edit-icon", "ambox", "question_book", "disambig", "red_pointer",
    "gnome-", "nuvola", "crystal_clear", "star_full", "star_empty",
    "sound-icon", "speaker", "loudspeaker", "wiktionary", "wikisource",
    "portal", "padlock", "seal_of", "_seal", "-seal", "emblem", "locator_map_of", "location_map_of", "blank_map_of", "topographic",
    "reliefkarte", "positionskarte", "pictogram", "text_document",
    "voting_box", "voting box", "kit_body", "kit_left_arm", "kit_right_arm", "kit_shorts", "kit_socks",
    "shackle", "pending-protection", "socrates.png", "merge-arrow", "mergefrom", "mergeto",
    "splitsection", "oojs_ui", "p_philosophy", "p_history", "p_science", "p_literature", "p_religion", "p_mathematics",
    "blue_pencil", "blue pencil", "green_globe", "green globe", "graduation_hat", "graduation hat",
    "grey_point", "grey point", "red_point", "red point", "grey_star", "grey star", "wappen",
)
IMAGE_REJECT_EXT = (".ogg", ".oga", ".ogv", ".wav", ".mid", ".midi", ".webm", ".pdf", ".djvu")

# Minimum composite score for an image to be shown at all (below it we prefer no image).
MIN_IMAGE_CONFIDENCE = 5

# Standard Wikimedia CDN thumbnail width step for high-resolution drawer/map/diagram viewing.
DEFAULT_IMAGE_THUMB_WIDTH = 1280

_ARTICLE_IMAGES_CACHE: Dict[tuple, Any] = {}   # (lang, title_lower) -> (expires_at, raw_candidates)
_IMAGE_CACHE_TTL = _WIKI_CACHE_TTL


def _filename_from_url(url: str) -> str:
    """Extract the underlying Commons file name from a Wikimedia (thumb or original) URL."""
    if not url:
        return ""
    try:
        segs = [s for s in urllib.parse.urlparse(url).path.split("/") if s]
        # Thumb URLs are .../thumb/<h>/<hh>/<Original_name>/<render>; the render segment can be a
        # generic 'NNNpx-thumbnail.jpg' or carry 'langhe-'/'lossy-page1-' prefixes.
        if "thumb" in segs:
            i = segs.index("thumb")
            if len(segs) > i + 3:
                return urllib.parse.unquote(segs[i + 3])
        seg = urllib.parse.unquote(segs[-1]) if segs else ""
        return re.sub(r'^\d+px-', '', seg)
    except Exception:
        return ""


def _upgrade_wikimedia_thumb_url(
    thumb_url: Optional[str],
    original_url: Optional[str] = None,
    original_width: Optional[int] = None,
    target_width: int = DEFAULT_IMAGE_THUMB_WIDTH,
) -> Optional[str]:
    """
    Upgrade a Wikimedia REST / MediaWiki thumbnail URL (typically 320px/330px/400px)
    to a higher standard Wikimedia thumbnail step (default 1280px) without extra HTTP calls.
    Respects original_width when known so raster images smaller than target_width use
    original_url instead of requesting an upscaled thumbnail that Wikimedia's CDN rejects.
    """
    url = thumb_url or original_url
    if not url or not isinstance(url, str):
        return None
    if "/thumb/" not in url or ("wikimedia.org" not in url and "wikipedia.org" not in url):
        return url

    fn = _filename_from_url(url).lower()
    is_svg = fn.endswith(".svg")
    is_web_safe_raster = fn.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))

    if (
        not is_svg
        and is_web_safe_raster
        and original_url
        and isinstance(original_width, int)
        and 0 < original_width <= target_width
    ):
        return original_url

    last_slash = url.rfind("/")
    if last_slash == -1:
        return url
    tail = url[last_slash + 1 :]
    new_tail, count = re.subn(r"(^|-)(\d+)px-", rf"\g<1>{target_width}px-", tail, count=1)
    if count:
        return url[: last_slash + 1] + new_tail
    return url


def _image_key(name: str) -> str:
    """Dedup key for a file name: API titles use spaces, URLs use underscores."""
    return (name or "").strip().replace(" ", "_").lower()


def _split_glued_tokens(text: str) -> str:
    """Insert word boundaries in PascalCase/camelCase and letter<->digit runs.

    Commons filenames are frequently glued (e.g. 'QuantumHarmonicOscillatorAnimation',
    'DoubleSlitExperiment'); without this they collapse to a single token that cannot
    match the event subject.
    """
    text = re.sub(r'(?<=[A-Z])(?=[A-Z][a-z])', ' ', text)   # 'HOWave' -> 'HO Wave'
    text = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', text)      # 'camelCase' -> 'camel Case'
    text = re.sub(r'(?<=[A-Za-z])(?=[0-9])', ' ', text)      # 'word2013' -> 'word 2013'
    text = re.sub(r'(?<=[0-9])(?=[A-Za-z])', ' ', text)      # '2013word' -> '2013 word'
    return text


def _normalize_media_text(text: str) -> str:
    """Split glued tokens, flatten separators, and lowercase for token matching."""
    return _split_glued_tokens(text or "").replace("_", " ").replace("-", " ").lower()


def _meaningful_tokens(normalized_text: str) -> set:
    return {
        token
        for token in normalized_text.split()
        if len(token) >= 4 or (token.isdigit() and len(token) >= 2)
    }


def _animation_matches_subject(candidate_text: str, subject_context: str) -> bool:
    """Require strong literal subject evidence before an animation can be selected."""
    candidate_normalized = re.sub(r'[^\w]+', ' ', _normalize_media_text(candidate_text)).strip()
    subject_normalized = re.sub(r'[^\w]+', ' ', _normalize_media_text(subject_context)).strip()
    if not candidate_normalized or not subject_normalized:
        return False
    if len(subject_normalized) >= 5 and subject_normalized in candidate_normalized:
        return True

    subject_tokens = _meaningful_tokens(subject_normalized)
    candidate_tokens = _meaningful_tokens(candidate_normalized)
    overlap = subject_tokens.intersection(candidate_tokens)
    if len(subject_tokens) == 1:
        return bool(overlap)
    return len(overlap) >= 2


def _search_media_is_specific(candidate_text: str, anchors: List[str], event_context: str) -> bool:
    """
    Commons *search* hits echo the search term by construction, so matching a one-word subject
    ('Pangaea', 'Mars') proves little. Require a multi-word subject match, or one extra
    event-specific token (e.g. 'breakup', a year) beyond the one-word subject.
    """
    cand_tokens = _meaningful_tokens(re.sub(r'[^\w]+', ' ', _normalize_media_text(candidate_text)))
    ctx_tokens = _meaningful_tokens(re.sub(r'[^\w]+', ' ', _normalize_media_text(event_context)))
    for anchor in anchors:
        if not anchor or not _animation_matches_subject(candidate_text, anchor):
            continue
        anchor_tokens = _meaningful_tokens(re.sub(r'[^\w]+', ' ', _normalize_media_text(anchor)))
        if len(anchor_tokens) >= 2 or (ctx_tokens - anchor_tokens) & cand_tokens:
            return True
    return False


_CAMERA_DATE_RE = re.compile(r'\b\d{4}[-_]\d{2}[-_]\d{2}\b|\b(?:19|20)\d{6}\b')


def score_image(
    cand: Dict[str, Any],
    event_context: str = "",
    animation_context=None,
) -> Optional[int]:
    """
    Composite confidence score for a candidate image relative to the event context.
    Returns None if the candidate is disqualified (junk type, wrong MIME, unusable).
    Rewards: Wikidata canonical depiction (P18), editorial lead image, caption/context
    overlap, period year match, and adequate resolution. Penalizes tiny thumbnails and
    anachronistic modern photos when historical alternatives exist.

    `animation_context` is the subject anchor (a string, or a list of canonical titles of which
    any one may match). Candidates not embedded in the article itself (animations, Commons
    search hits) must literally name that subject.
    """
    fname = (cand.get("filename") or "").lower()
    caption = (cand.get("caption") or "").lower()
    mime = (cand.get("mime") or "").lower()
    width = cand.get("width") or 0
    source = cand.get("source") or "article"
    is_lead = bool(cand.get("isLead"))

    if mime and not mime.startswith("image/"):
        return None

    key_name = fname or _filename_from_url(cand.get("url") or "").lower()
    if not key_name:
        return None
    if key_name.endswith(IMAGE_REJECT_EXT):
        return None
    if any(k in key_name for k in IMAGE_JUNK_KEYWORDS):
        return None

    low_norm = f"{key_name} {caption}".replace("-", " ").replace("_", " ")
    if cand.get("is_animated") or source == "commons_gif" or mime == "image/gif":
        if any(k in low_norm for k in GIF_JUNK_KEYWORDS):
            return None

    candidate_text = _normalize_media_text(
        f"{cand.get('filename') or _filename_from_url(cand.get('url') or '')} {cand.get('caption') or ''}"
    )
    overlap = generic_token_overlap(candidate_text, event_context) if event_context else 0

    # Non-lead SVG diagrams on an article with zero context overlap are almost always sidebar/template/navbox icons
    if not is_lead and (".svg" in key_name or mime == "image/svg+xml") and event_context and overlap == 0:
        return None

    anchors = animation_context if animation_context is not None else event_context
    if isinstance(anchors, str):
        anchors = [anchors]
    needs_subject_evidence = source in ("commons", "commons_gif") or (cand.get("is_animated") and not is_lead and source != "article")
    if needs_subject_evidence and not any(
        _animation_matches_subject(candidate_text, anchor) for anchor in anchors if anchor
    ):
        return None
    if source in ("commons", "commons_gif") and not _search_media_is_specific(candidate_text, anchors, event_context):
        return None

    score = 0
    if source == "wikidata":
        score += 35  # canonical depiction (Wikidata P18) — best for artworks/people
    if is_lead:
        # Full +35 when context is absent or overlaps; +20 when lead has 0 overlap with event_context
        # so an in-article photo that explicitly names the subject can outrank an accidental navbox lead.
        score += 35 if (not event_context or overlap >= 1) else 20
    if source == "article":
        score += 10
    if source == "commons_gif":
        # Commons GIF candidates must be verified multi-frame animations with context overlap
        if not cand.get("is_animated"):
            return None  # Disqualify static 1-frame GIFs from Commons search
        if event_context:
            if overlap >= 2:
                score += 15  # Contextual match for authentic motion diagram
            elif overlap == 1:
                score += 5   # Modest boost
            else:
                return None  # Disqualify unrelated GIFs with 0 context match
        else:
            return None  # Disqualify if no context to verify relevance

    if width:
        if width < 150:
            score -= 45
        elif width >= 500:
            score += 12
        elif width >= 320:
            score += 6
    if event_context:
        score += min(overlap * 12, 48)
    if cand.get("is_animated"):
        score += 20 if source == "article" else 10  # elevate verified multi-frame animations

    # Temporal alignment between image subject years and event year:
    # Reward period-accurate illustrations and penalize anachronistic modern photos on historical events.
    if event_context and not cand.get("is_animated"):
        ctx_years = [int(y) for y in re.findall(r'(?<!\d)(1[5-9]\d{2}|20[0-2]\d)(?!\d)', event_context)]
        if ctx_years:
            ev_year = ctx_years[-1]
            cleaned_key = _CAMERA_DATE_RE.sub("", key_name)
            img_years = [int(y) for y in re.findall(r'(?<!\d)(1[5-9]\d{2}|20[0-2]\d)(?!\d)', cleaned_key)]
            if img_years:
                if any(y == ev_year for y in img_years):
                    score += 22
                elif any(abs(y - ev_year) <= 5 for y in img_years):
                    score += 14
                elif min(img_years) > ev_year + 8 and score >= MIN_IMAGE_CONFIDENCE:
                    penalty = 50 if (min(img_years) - ev_year) > 15 else 28
                    score = max(MIN_IMAGE_CONFIDENCE, score - penalty)

    return score


def _rank_image_candidates(
    raw_candidates: List[Dict[str, Any]],
    event_context: str = "",
    animation_context=None,
) -> List[Dict[str, Any]]:
    """Score, filter, and sort candidate images (best first) for a given event context."""
    scored = []
    for c in raw_candidates:
        s = score_image(c, event_context, animation_context)
        if s is None:
            continue
        cc = dict(c)
        cc["score"] = s
        scored.append(cc)
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored


async def _resolve_commons_file(fname: str, client: httpx.AsyncClient) -> Optional[Dict[str, Any]]:
    """Resolve a Commons File name to a thumbnail URL + metadata via imageinfo."""
    if not fname:
        return None
    try:
        url = (
            f"https://commons.wikimedia.org/w/api.php?action=query&format=json"
            f"&titles=File:{urllib.parse.quote(fname)}&prop=imageinfo"
            f"&iiprop=url|size|mime|extmetadata&iiurlwidth={DEFAULT_IMAGE_THUMB_WIDTH}"
        )
        resp = await client.get(url, headers=HEADERS, timeout=6.0)
        if resp.status_code != 200:
            return None
        pages = resp.json().get("query", {}).get("pages", {})
        for _pid, page in pages.items():
            ii = page.get("imageinfo") or []
            if not ii:
                continue
            info = ii[0]
            meta = info.get("extmetadata", {}) or {}
            caption = (
                (meta.get("ObjectName", {}) or {}).get("value", "")
                or (meta.get("ImageDescription", {}) or {}).get("value", "")
            )
            caption = re.sub(r"<[^>]+>", " ", caption or "")
            return {
                "url": info.get("thumburl") or info.get("url"),
                "filename": fname,
                "caption": caption,
                "width": info.get("thumbwidth") or info.get("width") or 0,
                "mime": info.get("mime", ""),
            }
    except Exception:
        return None
    return None


async def fetch_wikidata_image(qid: str, client: httpx.AsyncClient) -> Optional[Dict[str, Any]]:
    """Fetch the Wikidata P18 (image) canonical depiction for an entity, resolved to a URL."""
    if not qid:
        return None
    try:
        url = (
            f"https://www.wikidata.org/w/api.php?action=wbgetclaims"
            f"&entity={urllib.parse.quote(qid)}&property=P18&format=json"
        )
        resp = await client.get(url, headers=HEADERS, timeout=5.0)
        if resp.status_code != 200:
            return None
        claims = resp.json().get("claims", {}).get("P18", [])
        if not claims:
            return None
        fname = claims[0].get("mainsnak", {}).get("datavalue", {}).get("value")
        if not fname:
            return None
        return await _resolve_commons_file(fname, client)
    except Exception:
        return None


def _strip_file_namespace(title: str) -> str:
    """Strip any localized MediaWiki File namespace prefix ('File:', 'קובץ:', 'Fichier:', 'Datei:', etc.)."""
    raw = (title or "").strip()
    return raw.split(":", 1)[1].strip() if ":" in raw else raw


async def fetch_commons_fallback_images(
    query: str,
    client: httpx.AsyncClient,
    limit: int = 4
) -> List[Dict[str, Any]]:
    """Last-resort image source: search Wikimedia Commons directly for a named subject."""
    clean = (query or "").strip()
    if not clean:
        return []
    results: List[Dict[str, Any]] = []
    try:
        url = (
            f"https://commons.wikimedia.org/w/api.php?action=query&format=json"
            f"&generator=search&gsrsearch={urllib.parse.quote(clean)}&gsrnamespace=6&gsrlimit={limit}"
            f"&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth={DEFAULT_IMAGE_THUMB_WIDTH}"
        )
        resp = await client.get(url, headers=HEADERS, timeout=6.0)
        if resp.status_code != 200:
            return []
        pages = resp.json().get("query", {}).get("pages", {})
        for _pid, page in pages.items():
            ii = page.get("imageinfo") or []
            if not ii:
                continue
            info = ii[0]
            fname = _strip_file_namespace(page.get("title", "") or "")
            low = fname.lower()
            if low.endswith(IMAGE_REJECT_EXT) or any(k in low for k in IMAGE_JUNK_KEYWORDS):
                continue
            meta = info.get("extmetadata", {}) or {}
            caption = (
                (meta.get("ObjectName", {}) or {}).get("value", "")
                or (meta.get("ImageDescription", {}) or {}).get("value", "")
            )
            caption = re.sub(r"<[^>]+>", " ", caption or "")
            results.append({
                "url": info.get("thumburl") or info.get("url"),
                "filename": fname,
                "caption": caption,
                "width": info.get("thumbwidth") or info.get("width") or 0,
                "mime": info.get("mime", ""),
            })
    except Exception:
        return []
    return results


GIF_JUNK_KEYWORDS = (
    "draft registration", "registration card", "certificate", "census",
    "signature", "document", "manuscript", "newspaper", "scan", "declaration",
    "passport", "death certificate", "birth certificate", "receipt",
    "treaty", "archive", "nara", "affidavit", "indenture",
    "record of", "payroll",
    # Non-encyclopedic cartoons, mascots, clipart, stickers, memes
    "traveler and friends", "friends gifs", "cartoon", "clipart", "clip art",
    "sticker", "emoji", "emoticon", "meme", "challenge", "funny",
    # Meteorological radar / satellite loops accidentally matching human or event names
    "satellite loop", "radar loop", "infrared loop", "visible infrared", "satellite imagery loop",
    "blowing dust", "cira ", "(cira",
    # Demographic / statistical charts matching ancient monuments
    "population pyramid",
    # Typography puzzles / stock promos / game assets
    "ambigram", "knowledge is human", "speed dreams",
    # Celestial 3D constellations accidentally matching particle / animal subjects
    "constellation 3d", "constellation_3d",
)


async def fetch_commons_gif_candidates(
    query: str,
    client: httpx.AsyncClient,
    limit: int = 4
) -> List[Dict[str, Any]]:
    """
    Search Wikimedia Commons directly for authentic animated GIFs matching a topic.
    Filters out scanned historical text documents, certificates, and junk.
    """
    clean = (query or "").strip()
    if not clean:
        return []
    use_cache = _is_real_http_client(client)
    cache_key = (clean.lower(), limit)
    if use_cache:
        cached = _cache_get(_COMMONS_GIF_CACHE, cache_key)
        if cached is not None:
            return cached
    results: List[Dict[str, Any]] = []
    try:
        search_query = f"{clean} filemime:image/gif"
        url = (
            f"https://commons.wikimedia.org/w/api.php?action=query&format=json"
            f"&generator=search&gsrsearch={urllib.parse.quote(search_query)}&gsrnamespace=6&gsrlimit={limit}"
            f"&prop=imageinfo&iiprop=url|size|mime|metadata|extmetadata&iiurlwidth=400"
        )
        resp = await client.get(url, headers=HEADERS, timeout=3.5)
        if resp.status_code != 200:
            if use_cache:
                _cache_put(_COMMONS_GIF_CACHE, cache_key, [])
            return []
        pages = resp.json().get("query", {}).get("pages", {})
        for _pid, page in pages.items():
            ii = page.get("imageinfo") or []
            if not ii:
                continue
            info = ii[0]
            fname = _strip_file_namespace(page.get("title", "") or "")
            low = fname.lower()
            mime = (info.get("mime") or "").lower()
            if not low.endswith(".gif") and mime != "image/gif":
                continue
            low_norm = low.replace("-", " ").replace("_", " ")
            if any(k in low for k in IMAGE_JUNK_KEYWORDS) or any(k in low_norm for k in GIF_JUNK_KEYWORDS):
                continue

            # Verify multi-frame animation: reject static 1-frame GIFs (seals, scanned records, diagrams)
            raw_meta = info.get("metadata") or []
            meta_dict = {m["name"]: m["value"] for m in raw_meta if isinstance(m, dict) and "name" in m and "value" in m}
            try:
                frame_count = int(meta_dict.get("frameCount") or 1)
            except (ValueError, TypeError):
                frame_count = 1
            if frame_count <= 1:
                continue

            meta = info.get("extmetadata", {}) or {}
            caption = (
                (meta.get("ObjectName", {}) or {}).get("value", "")
                or (meta.get("ImageDescription", {}) or {}).get("value", "")
            )
            caption = re.sub(r"<[^>]+>", " ", caption or "")
            cap_norm = caption.lower().replace("-", " ").replace("_", " ")
            if any(k in cap_norm for k in GIF_JUNK_KEYWORDS):
                continue
            orig_url = info.get("url") or ""
            thumb_url = info.get("thumburl") or ""
            final_url = orig_url or thumb_url
            if final_url and "/thumb/" in final_url and ("wikimedia.org" in final_url or "wikipedia.org" in final_url):
                final_url = re.sub(r"/thumb/([^/]+/[^/]+/[^/]+)/.*", r"/\1", final_url.replace("thumb.wikimedia.org", "upload.wikimedia.org")).split("?")[0]

            results.append({
                "url": final_url,
                "filename": fname,
                "caption": caption,
                "width": info.get("width") or info.get("thumbwidth") or 0,
                "mime": "image/gif",
                "source": "commons_gif",
                "is_animated": True,
                "frame_count": frame_count,
            })
    except Exception:
        return []
    if use_cache:
        _cache_put(_COMMONS_GIF_CACHE, cache_key, results)
    return results


async def fetch_image_candidates(
    title: str,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    lang: str = "en",
    lead_url: Optional[str] = None,
    wikidata_qid: Optional[str] = None,
    fallback_title: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Collect a de-duplicated set of raw (unscored) image candidates for a resolved article:
      1. MediaWiki pageimages (lead) + images list, resolved via a single batched imageinfo call.
      2. Concurrent Commons search specifically for authentic motion GIFs matching the topic.
      3. Wikidata P18 canonical depiction (great for artworks/people/specific works).
      4. Wikimedia Commons search as a last resort when the article is image-poor.
    Scoring/ranking is per-event (context differs); results are cached per (lang, title).
    """
    title = (title or "").strip()
    if not title:
        return []

    cache_key = (lang, title.lower(), (fallback_title or "").lower())
    cached = _cache_get(_ARTICLE_IMAGES_CACHE, cache_key)
    if cached is not None:
        return cached

    candidates: List[Dict[str, Any]] = []
    seen_keys = set()
    by_key: Dict[str, Dict[str, Any]] = {}

    def _add(url, filename=None, caption="", width=0, mime="", is_lead=False, source="article", is_animated=False, frame_count=1):
        if not url:
            return
        fn = filename or _filename_from_url(url)
        key = _image_key(fn or url)
        if not key:
            return
        if key in seen_keys:
            # Same file seen again (e.g. the bare REST lead seed, then its imageinfo record):
            # keep one entry but merge in the richer metadata and higher-resolution URL.
            existing = by_key.get(key)
            if existing is not None:
                existing["isLead"] = existing["isLead"] or is_lead
                if caption and not existing["caption"]:
                    existing["caption"] = caption
                if width and width >= (existing.get("width") or 0):
                    existing["width"] = width
                    if not existing.get("is_animated"):
                        existing["url"] = url
                if mime and not existing["mime"]:
                    existing["mime"] = mime
                if is_animated and not existing["is_animated"]:
                    existing.update(is_animated=True, frame_count=frame_count, url=url)
            return
        seen_keys.add(key)
        entry = {
            "url": url,
            "filename": fn,
            "caption": caption or "",
            "width": width or 0,
            "mime": mime or "",
            "isLead": is_lead,
            "source": source,
            "key": key,
            "is_animated": is_animated,
            "frame_count": frame_count,
        }
        by_key[key] = entry
        candidates.append(entry)

    # Seed with the REST lead thumbnail so we never regress if the API calls fail.
    if lead_url:
        _add(lead_url, is_lead=True, source="article")

    async with semaphore:
        lead_name = None
        file_titles: List[str] = []

        # Kick off concurrent Commons GIF search in parallel with MediaWiki calls
        gif_query = fallback_title or title
        commons_gif_task = asyncio.create_task(
            fetch_commons_gif_candidates(gif_query, client, limit=4)
        )

        # 1. pageimages (lead) + images list + Wikidata item id
        try:
            url = (
                f"https://{lang}.wikipedia.org/w/api.php?action=query&format=json&redirects=1"
                f"&titles={urllib.parse.quote(title)}&prop=pageimages|images|pageprops"
                f"&piprop=name|thumbnail&pithumbsize={DEFAULT_IMAGE_THUMB_WIDTH}&imlimit=40&ppprop=wikibase_item"
            )
            resp = await client.get(url, headers=HEADERS, timeout=6.0)
            if resp.status_code == 200:
                pages = resp.json().get("query", {}).get("pages", {})
                for _pid, page in pages.items():
                    lead_name = page.get("pageimage")
                    thumb = page.get("thumbnail", {}) or {}
                    if thumb.get("source"):
                        _add(thumb["source"], filename=lead_name, width=thumb.get("width", 0), is_lead=True, source="article")
                    for im in page.get("images", []):
                        t = im.get("title", "") or ""
                        # Non-English Wikipedias return localized namespace prefixes ('קובץ:', 'Fichier:', 'Datei:') with ns=6
                        if im.get("ns") == 6 or t.lower().startswith("file:") or ":" in t:
                            fname = _strip_file_namespace(t)
                            low = fname.lower()
                            if not low or low.endswith(IMAGE_REJECT_EXT) or any(k in low for k in IMAGE_JUNK_KEYWORDS):
                                continue
                            file_titles.append(t)
                    if not wikidata_qid:
                        wikidata_qid = (page.get("pageprops", {}) or {}).get("wikibase_item")
        except Exception:
            pass

        # 2. Batched imageinfo for all candidate files in one request
        if file_titles:
            try:
                batch = "|".join(file_titles[:40])
                url = (
                    f"https://{lang}.wikipedia.org/w/api.php?action=query&format=json"
                    f"&titles={urllib.parse.quote(batch)}&prop=imageinfo"
                    f"&iiprop=url|size|mime|metadata|extmetadata&iiurlwidth={DEFAULT_IMAGE_THUMB_WIDTH}"
                )
                resp = await client.get(url, headers=HEADERS, timeout=7.0)
                if resp.status_code == 200:
                    pages = resp.json().get("query", {}).get("pages", {})
                    for _pid, page in pages.items():
                        ii = page.get("imageinfo") or []
                        if not ii:
                            continue
                        info = ii[0]
                        fname = _strip_file_namespace(page.get("title", "") or "")
                        meta = info.get("extmetadata", {}) or {}
                        caption = (
                            (meta.get("ObjectName", {}) or {}).get("value", "")
                            or (meta.get("ImageDescription", {}) or {}).get("value", "")
                        )
                        caption = re.sub(r"<[^>]+>", " ", caption or "")
                        is_lead = bool(
                            lead_name
                            and fname.replace(" ", "_").lower() == lead_name.replace(" ", "_").lower()
                        )
                        file_mime = info.get("mime", "")
                        is_gif = file_mime == "image/gif" or fname.lower().endswith(".gif")
                        is_animated = False
                        frame_count = 1
                        if is_gif:
                            raw_meta = info.get("metadata") or []
                            meta_dict = {m["name"]: m["value"] for m in raw_meta if isinstance(m, dict) and "name" in m and "value" in m}
                            try:
                                frame_count = int(meta_dict.get("frameCount") or 1)
                            except (ValueError, TypeError):
                                frame_count = 1
                            is_animated = bool(frame_count > 1)

                        file_url = (info.get("url") if is_gif else (info.get("thumburl") or info.get("url"))) or ""
                        if is_gif and "/thumb/" in file_url and ("wikimedia.org" in file_url or "wikipedia.org" in file_url):
                            file_url = re.sub(r"/thumb/([^/]+/[^/]+/[^/]+)/.*", r"/\1", file_url.replace("thumb.wikimedia.org", "upload.wikimedia.org")).split("?")[0]
                        _add(
                            file_url,
                            filename=fname,
                            caption=caption,
                            width=info.get("width") if is_gif else (info.get("thumbwidth") or info.get("width") or 0),
                            mime=file_mime,
                            is_lead=is_lead,
                            source="article",
                            is_animated=is_animated,
                            frame_count=frame_count,
                        )
            except Exception:
                pass

        # 3. Incorporate concurrent Commons GIF candidates
        try:
            commons_gifs = await commons_gif_task
            for g in commons_gifs:
                _add(
                    g["url"],
                    filename=g.get("filename"),
                    caption=g.get("caption", ""),
                    width=g.get("width", 0),
                    mime=g.get("mime", "image/gif"),
                    is_lead=False,
                    source="commons_gif",
                    is_animated=g.get("is_animated", True),
                    frame_count=g.get("frame_count", 2),
                )
        except Exception:
            pass

    # What the article itself yielded (raster only, excluding external commons_gif and .svg icons).
    # The lead counts double: it is editorially confirmed.
    def _illustration_weight() -> int:
        raster = [
            c for c in candidates
            if c.get("source") == "article"
            and not c["key"].endswith(IMAGE_REJECT_EXT)
            and not c["key"].endswith(".svg")
        ]
        return len(raster) + (1 if any(c["isLead"] for c in raster) else 0)

    # 3. Wikidata P18 canonical depiction (best-effort). Only when the article is
    #    image-poor (also the common case for specific artworks/works), to limit API volume.
    if wikidata_qid and _illustration_weight() < 3:
        try:
            async with semaphore:
                p18 = await fetch_wikidata_image(wikidata_qid, client)
            if p18 and p18.get("url"):
                _add(p18["url"], filename=p18.get("filename"), caption=p18.get("caption", ""),
                     width=p18.get("width", 0), mime=p18.get("mime", ""), source="wikidata")
        except Exception:
            pass

    # 4. Commons fallback when the article yielded almost nothing usable
    if _illustration_weight() < 2:
        try:
            async with semaphore:
                commons = await fetch_commons_fallback_images(fallback_title or title, client, limit=4)
            for c in commons:
                _add(c["url"], filename=c.get("filename"), caption=c.get("caption", ""),
                     width=c.get("width", 0), mime=c.get("mime", ""), source="commons")
        except Exception:
            pass

    _cache_put(_ARTICLE_IMAGES_CACHE, cache_key, candidates)
    return candidates


def _resolve_adjudicator_api_key(api_key: Optional[str] = None) -> Optional[str]:
    """Resolve a Gemini API key for batch enrichment adjudication, falling back to configured env keys."""
    if api_key and api_key.strip():
        return api_key.strip()
    env_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if env_key:
        return env_key
    try:
        from services.quota_service import get_next_free_key
        free_key = get_next_free_key()
        if free_key and free_key.strip():
            return free_key.strip()
    except Exception:
        pass
    return None


async def _call_gemini_adjudicator_json(
    payload: Dict[str, Any],
    api_key: str,
    preferred_model: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Execute a single fast, zero-thinking JSON batch call to Gemini Flash to adjudicate
    ambiguous Wikipedia article candidates and image selections across the timeline.
    """
    try:
        from google import genai
        from google.genai import types
    except Exception:
        return None

    default_models = ["gemini-3.6-flash", "gemini-3.8-flash"]
    if preferred_model and preferred_model.strip():
        pm = preferred_model.strip()
        models_to_try = [pm] + [m for m in default_models if m != pm]
    else:
        models_to_try = default_models

    system_instruction = (
        "You are an encyclopedic historian and visual curator adjudicating Wikipedia articles and "
        "Wikimedia Commons images for an interactive timeline.\n"
        "For each event in `events`, return a JSON object in `decisions` with:\n"
        "1. `event_index` (integer matching the input event)\n"
        "2. `article_id`: Pick the candidate ID ('A0', 'A1', ...) from `article_candidates` whose Wikipedia "
        "article genuinely represents the event's PRIMARY SUBJECT in the right historical era/context "
        "(including when the event uses a local nickname, abbreviation, or romaji alias like 'Bunten' or "
        "'Monbushō Bijutsu Tenrankai' for 'Japan Fine Arts Exhibition'). "
        "Reject namesakes, wrong-era people/events, false cross-lingual homographs (e.g. an unrelated village "
        "sharing a name with an Italian design firm, or a WWII battle on a prehistoric/geological timeline), "
        "or generic city/country/venue pages mentioned only in passing. "
        "If NO candidate in `article_candidates` is genuinely relevant and accurate for the event, return \"NONE\". "
        "If `article_candidates` is empty, return null.\n"
        "3. `image_id`: Pick the candidate ID ('I0', 'I1', ...) from `image_candidates` that most accurately "
        "and period-appropriately illustrates the specific event. "
        "Prioritize historical/period accuracy (e.g. a 1974 Mk1 car or period artwork over a modern 2019 model photo). "
        "Prefer animated GIFs (`is_animated: true`) ONLY when they genuinely depict the specific scientific or "
        "historical phenomenon of the event; a relevant static image is always better than an irrelevant GIF. "
        "Avoid picking the exact same filename for multiple events when another relevant image is available. "
        "If ALL image candidates depict the wrong subject or are misleadingly anachronistic, return \"NONE\". "
        "If `image_candidates` is empty, return null.\n"
        "Respond ONLY with compact valid JSON matching: "
        "{\"decisions\": [{\"event_index\": 0, \"article_id\": \"A0\", \"image_id\": \"I0\"}]}"
    )

    prompt_text = json.dumps(payload, ensure_ascii=False)
    client = genai.Client(api_key=api_key)

    for model_name in models_to_try:
        try:
            resp = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=model_name,
                    contents=prompt_text,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        temperature=0.0,
                        max_output_tokens=2048,
                        thinking_config=types.ThinkingConfig(thinking_budget=0),
                    ),
                ),
                timeout=6.5,
            )
            raw_text = ""
            if getattr(resp, "candidates", None):
                parts = getattr(resp.candidates[0].content, "parts", None) or []
                raw_text = "".join(
                    (getattr(p, "text", "") or "")
                    for p in parts
                    if not getattr(p, "thought", False)
                ).strip()
            if not raw_text:
                raw_text = (getattr(resp, "text", None) or "").strip()
            if not raw_text:
                continue
            if raw_text.startswith("```"):
                raw_text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_text, flags=re.DOTALL).strip()
            parsed = json.loads(raw_text)
            if isinstance(parsed, dict) and isinstance(parsed.get("decisions"), list):
                return parsed
        except Exception as e:
            logger.debug(f"Batch LLM enrichment adjudicator attempt on {model_name} failed: {e}")
            continue

    return None


async def _llm_adjudicate_enrichment(
    events_data: list,
    results: List[Dict[str, Any]],
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    lang: str = "en",
    timeline_topic: str = "",
    api_key: Optional[str] = None,
    preferred_model: Optional[str] = None,
) -> None:
    """
    Inspect all events after parallel Wikipedia/Commons candidate collection.
    For any event with ambiguous article resolution (disambiguation, search, zero non-title
    context overlap, or unresolved with search candidates) or competing image candidates,
    run a single fast batch LLM adjudication call and update `results` in-place.
    """
    effective_key = _resolve_adjudicator_api_key(api_key)
    if not effective_key:
        return

    batch_events = []
    event_art_maps: Dict[int, Dict[str, Dict[str, Any]]] = {}
    event_img_maps: Dict[int, Dict[str, Dict[str, Any]]] = {}

    for i, (ev, r) in enumerate(zip(events_data, results)):
        if not isinstance(ev, dict) or not isinstance(r, dict):
            continue
        res = r.get("res") if isinstance(r.get("res"), dict) else {}
        raw_art_cands = list(r.get("article_candidates") or [])

        # Guarantee the currently resolved article (if any) is A0 in the candidate list
        ordered_art_cands: List[Dict[str, Any]] = []
        if res and res.get("wikiTitle"):
            _record_article_candidate(ordered_art_cands, res)
        for ac in raw_art_cands:
            _record_article_candidate(ordered_art_cands, ac)

        zero_ctx_overlap = False
        if res and res.get("wikiTitle"):
            title_ref = (
                f"{ev.get('wikipedia_title') or ''} "
                f"{ev.get('wikipedia_title_en') or ''} "
                f"{res.get('wikiTitle') or ''}"
            )
            t_tokens = _content_tokens(title_ref)
            ev_ctx_raw = (
                f"{timeline_topic} {ev.get('title') or ''} "
                f"{ev.get('subtitle') or ''} {ev.get('category') or ''}"
            )
            non_t_ctx = " ".join(
                t for t in re.findall(r'\w{3,}', ev_ctx_raw.lower())
                if t not in _STOPWORDS and not any(are_tokens_related(t, tt) for tt in t_tokens)
            )
            art_body = f"{res.get('description') or ''} {res.get('extract') or ''}"
            if non_t_ctx and generic_token_overlap(non_t_ctx, art_body) == 0:
                zero_ctx_overlap = True

        needs_article_check = bool(ordered_art_cands) and (
            not (res and res.get("wikiTitle"))
            or len(ordered_art_cands) >= 2
            or res.get("_resolution_mode") in ("disambig", "search")
            or zero_ctx_overlap
        )

        ranked_imgs = _rank_image_candidates(
            r.get("candidates") or [],
            r.get("image_context") or "",
            r.get("anchors") or [],
        )
        viable_imgs = [c for c in ranked_imgs if c["score"] >= MIN_IMAGE_CONFIDENCE][:5]
        needs_image_check = len(viable_imgs) >= 2 and (
            any(c.get("is_animated") for c in viable_imgs)
            or r.get("event_year") is not None
            or (viable_imgs[0]["score"] - viable_imgs[1]["score"] <= 25)
        )

        if not needs_article_check and not needs_image_check:
            continue

        art_map: Dict[str, Dict[str, Any]] = {}
        art_payload = []
        for a_idx, ac in enumerate(ordered_art_cands[:5]):
            aid = f"A{a_idx}"
            art_map[aid] = ac
            art_payload.append({
                "id": aid,
                "lang": ac.get("lang", lang),
                "title": ac.get("wikiTitle", ""),
                "description": (ac.get("description") or "")[:140],
                "extract": (ac.get("extract") or "")[:280],
            })
        event_art_maps[i] = art_map

        img_map: Dict[str, Dict[str, Any]] = {}
        img_payload = []
        for m_idx, ic in enumerate(viable_imgs[:5]):
            iid = f"I{m_idx}"
            img_map[iid] = ic
            img_payload.append({
                "id": iid,
                "filename": ic.get("filename") or _filename_from_url(ic.get("url") or ""),
                "caption": (ic.get("caption") or "")[:160],
                "is_animated": bool(ic.get("is_animated")),
                "is_lead": bool(ic.get("isLead")),
                "source": ic.get("source", "article"),
            })
        event_img_maps[i] = img_map

        batch_events.append({
            "event_index": i,
            "year": r.get("event_year"),
            "title": (ev.get("title") or "")[:140],
            "subtitle": (ev.get("subtitle") or "")[:260],
            "requested_wiki_title": (ev.get("wikipedia_title") or "")[:100],
            "requested_wiki_title_en": (ev.get("wikipedia_title_en") or "")[:100],
            "article_candidates": art_payload,
            "image_candidates": img_payload,
        })

    if not batch_events:
        return

    t0 = time.time()
    payload = {
        "timeline_topic": timeline_topic,
        "timeline_language": lang,
        "events": batch_events,
    }
    adjudicated = await _call_gemini_adjudicator_json(
        payload,
        api_key=effective_key,
        preferred_model=preferred_model,
    )
    if not adjudicated or not isinstance(adjudicated.get("decisions"), list):
        return

    switched_indices: List[int] = []
    for dec in adjudicated["decisions"]:
        if not isinstance(dec, dict):
            continue
        idx = dec.get("event_index")
        if not isinstance(idx, int) or idx < 0 or idx >= len(results):
            continue

        r = results[idx]
        ev = events_data[idx]
        cur_res = r.get("res") if isinstance(r.get("res"), dict) else {}
        art_map = event_art_maps.get(idx) or {}
        img_map = event_img_maps.get(idx) or {}

        article_id = dec.get("article_id")
        article_switched = False

        if article_id == "NONE" and art_map:
            logger.info(
                "LLM adjudicator suppressed false Wikipedia match '%s' for event '%s'",
                cur_res.get("wikiTitle"), ev.get("title"),
            )
            r["res"] = {}
            r["candidates"] = []
            r["_suppress_lead_fallback"] = True
            continue

        if isinstance(article_id, str) and article_id in art_map:
            chosen_art = dict(art_map[article_id])
            same_bilingual_pair = bool(
                cur_res
                and cur_res.get("wikiTitle")
                and cur_res.get("fallbackWikiTitle")
                and chosen_art.get("lang") == "en"
                and cur_res.get("fallbackWikiTitle", "").strip().lower() == chosen_art.get("wikiTitle", "").strip().lower()
            )
            if not same_bilingual_pair and (
                not cur_res
                or not cur_res.get("wikiTitle")
                or chosen_art.get("wikiTitle") != cur_res.get("wikiTitle")
                or chosen_art.get("lang") != cur_res.get("lang")
            ):
                # If timeline is non-English and LLM selected an English candidate, check for its canonical local langlink
                if lang != "en" and chosen_art.get("lang") == "en" and _is_real_http_client(client):
                    local_title = await _get_langlink(
                        chosen_art["wikiTitle"], from_lang="en", to_lang=lang, client=client
                    )
                    if local_title:
                        local_res = await _get_summary_direct(
                            local_title, client, lang=lang, resolve_disambig=False, year=r.get("event_year")
                        )
                        if local_res and local_res.get("wikiTitle"):
                            if not local_res.get("imageUrl") and chosen_art.get("imageUrl"):
                                local_res["imageUrl"] = chosen_art["imageUrl"]
                            elif chosen_art.get("imageUrl"):
                                local_res["fallbackImageUrl"] = chosen_art["imageUrl"]
                            if local_res.get("lat") is None and chosen_art.get("lat") is not None:
                                local_res["lat"] = chosen_art["lat"]
                                local_res["lng"] = chosen_art.get("lng")
                            local_res["fallbackWikiTitle"] = chosen_art["wikiTitle"]
                            chosen_art = local_res

                logger.info(
                    "LLM adjudicator selected Wikipedia article '%s' (was '%s') for event '%s'",
                    chosen_art.get("wikiTitle"), cur_res.get("wikiTitle"), ev.get("title"),
                )
                r["res"] = chosen_art
                article_switched = True
                switched_indices.append(idx)

        if not article_switched:
            image_id = dec.get("image_id")
            if image_id == "NONE" and img_map:
                r["candidates"] = []
                r["_suppress_lead_fallback"] = True
            elif isinstance(image_id, str) and image_id in img_map:
                r["llm_preferred_image_key"] = _image_key(img_map[image_id]["key"])

    if switched_indices:
        async def _refresh_images_for_switched(idx: int):
            r = results[idx]
            ev = events_data[idx]
            res = r.get("res") or {}
            if not res.get("wikiTitle"):
                r["candidates"] = []
                return
            wiki_key = (ev.get("wikipedia_title") or "").strip()
            wiki_key_en = (ev.get("wikipedia_title_en") or "").strip()
            regular_title = (ev.get("title") or "").strip()
            fb_title = res.get("fallbackWikiTitle") or wiki_key_en or (regular_title if lang != "en" else None)
            cands = await fetch_image_candidates(
                res["wikiTitle"],
                client,
                semaphore,
                lang=res.get("lang", lang),
                lead_url=res.get("imageUrl"),
                fallback_title=fb_title,
            )
            r["candidates"] = cands
            anchor_parts = [wiki_key, wiki_key_en, res.get("wikiTitle") or "", res.get("fallbackWikiTitle") or ""]
            anchors = list(dict.fromkeys(p for p in anchor_parts if p)) or ([regular_title] if regular_title else [])
            r["anchors"] = anchors
            image_parts = [regular_title, *anchors]
            if r.get("event_year") is not None:
                image_parts.append(str(r["event_year"]))
            r["image_context"] = " ".join(dict.fromkeys(p for p in image_parts if p)).strip()

        await asyncio.gather(*[_refresh_images_for_switched(idx) for idx in switched_indices], return_exceptions=True)

    logger.info(
        "Batch LLM enrichment adjudication completed in %.2fs (%d/%d events checked, %d articles updated)",
        time.time() - t0, len(batch_events), len(events_data), len(switched_indices),
    )


async def enrich_events_with_wikipedia(
    events_data: list,
    lang: str = "en",
    timeline_topic: str = "",
    is_timeline_fictional: bool = False,
    api_key: Optional[str] = None,
    preferred_model: Optional[str] = None,
) -> list:
    """
    Given a list of event dictionaries, asynchronously fetch Wikipedia data with precision-first guarantees.
    Supports any language edition with automatic fallback to English Wikipedia.
    Images are gathered as ranked multi-source candidates and assigned in a second pass with
    timeline-wide de-duplication so the same picture never repeats and weak images are suppressed.
    """
    semaphore = asyncio.Semaphore(30)
    lang = (lang or "en").strip().lower()
    timeline_en_context = ""
    if lang != "en":
        en_titles = list(dict.fromkeys(
            (ev.get("wikipedia_title_en") or "").strip()
            for ev in events_data
            if isinstance(ev, dict) and (ev.get("wikipedia_title_en") or "").strip()
        ))[:12]
        timeline_en_context = " ".join(en_titles)

    async with _http_client_scope() as client:
        use_candidate_sink = (
            fetch_wikipedia_summary is _DEFAULT_FETCH_WIKIPEDIA_SUMMARY
            and _is_real_http_client(client)
        )

        async def fetch_for_event(event: dict):
            wiki_key = (event.get("wikipedia_title") or "").strip()
            wiki_key_en = (event.get("wikipedia_title_en") or "").strip()
            regular_title = (event.get("title") or "").strip()
            subtitle = (event.get("subtitle") or "").strip()
            lane = (event.get("lane") or "").strip()
            yt_query_en = (event.get("youtube_query_en") or "").strip()

            # On non-English timelines, if wikipedia_title_en is missing, extract any concise
            # parenthetical English entity from the title (e.g. "חוק המפעלים הבריטי (Factory Act 1833)")
            if lang != "en" and not wiki_key_en:
                for src_text in (regular_title, wiki_key):
                    m = re.search(r'\(([A-Za-z][A-Za-z0-9\s\-\'’.,&:]{2,60})\)', src_text or "")
                    if m:
                        cand_en = m.group(1).strip()
                        if is_likely_searchable_entity(cand_en):
                            wiki_key_en = cand_en
                            break

            from_dict = event.get("from")
            event_year = None
            if isinstance(from_dict, dict) and "year" in from_dict:
                event_year = from_dict.get("year")
            elif isinstance(event.get("from_year"), int):
                event_year = event.get("from_year")

            category = (event.get("category") or "").strip()
            context_parts = [timeline_topic, regular_title, category, subtitle, lane, wiki_key_en, yt_query_en, timeline_en_context]
            if event_year is not None:
                context_parts.append(str(event_year))
            context_text = " ".join([p for p in context_parts if p]).strip()

            article_candidates: List[Dict[str, Any]] = []
            sink_kw = {"candidate_sink": article_candidates} if use_candidate_sink else {}

            res = {}
            # 1. Try with canonical local wikipedia_title
            if wiki_key:
                res = await fetch_wikipedia_summary(
                    wiki_key,
                    client,
                    semaphore,
                    lang=lang,
                    context_text=context_text,
                    year=event_year,
                    fallback_lang="en",
                    fallback_title=wiki_key_en or (regular_title if lang == "en" else None),
                    **sink_kw,
                )

            # 2. If not found or not provided, try regular title ONLY if it represents a concise searchable entity
            if not res and regular_title and regular_title != wiki_key and is_likely_searchable_entity(regular_title):
                res = await fetch_wikipedia_summary(
                    regular_title,
                    client,
                    semaphore,
                    lang=lang,
                    context_text=context_text,
                    year=event_year,
                    fallback_lang="en",
                    fallback_title=wiki_key_en,
                    **sink_kw,
                )

            # 3. If still not found and we have an English fallback key, query English directly
            if not res and wiki_key_en and lang != "en":
                res = await fetch_wikipedia_summary(
                    wiki_key_en,
                    client,
                    semaphore,
                    lang="en",
                    context_text=context_text,
                    year=event_year,
                    **sink_kw,
                )

            # Gather ranked image candidates for the resolved article (multi-source).
            candidates: List[Dict[str, Any]] = []
            if isinstance(res, dict) and res.get("wikiTitle"):
                fb_title = res.get("fallbackWikiTitle") or wiki_key_en or (regular_title if lang != "en" else None)
                candidates = await fetch_image_candidates(
                    res["wikiTitle"],
                    client,
                    semaphore,
                    lang=res.get("lang", lang),
                    lead_url=res.get("imageUrl"),
                    fallback_title=fb_title,
                )
                # Supplement from English counterpart when non-English article has few static article photos
                en_img_title = res.get("fallbackWikiTitle") or wiki_key_en
                article_photo_count = sum(
                    1 for c in candidates
                    if c.get("source") == "article"
                    and not c.get("is_animated")
                    and not (c.get("key") or "").endswith((".svg", ".gif"))
                )
                if article_photo_count < 4 and en_img_title and res.get("lang", lang) != "en":
                    fb_cands = await fetch_image_candidates(
                        en_img_title,
                        client,
                        semaphore,
                        lang="en",
                        lead_url=res.get("fallbackImageUrl") or res.get("imageUrl"),
                    )
                    seen_keys = {c.get("key") for c in candidates}
                    for fc in fb_cands:
                        if fc.get("key") not in seen_keys:
                            seen_keys.add(fc.get("key"))
                            candidates.append(fc)

            # Subject anchors are canonical titles only: the AI's narrative event title contains
            # generic words ('wave', 'equation') that let unrelated animations match.
            anchor_parts = [wiki_key, wiki_key_en]
            if isinstance(res, dict):
                anchor_parts.extend([res.get("wikiTitle") or "", res.get("fallbackWikiTitle") or ""])
            anchors = list(dict.fromkeys(p for p in anchor_parts if p)) or ([regular_title] if regular_title else [])

            # Image ranking context is event-specific: timeline topic/lane/category words are shared by
            # every event, so they only reward generic on-theme images over the article's own photo.
            image_parts = [regular_title, *anchors]
            if event_year is not None:
                image_parts.append(str(event_year))
            image_context = " ".join(dict.fromkeys(p for p in image_parts if p)).strip()
            return {
                "res": res,
                "article_candidates": article_candidates,
                "candidates": candidates,
                "image_context": image_context,
                "anchors": anchors,
                "event_year": event_year,
            }

        tasks = [fetch_for_event(event) for event in events_data]
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

        # Normalize (exceptions -> empty result)
        results = [
            r if isinstance(r, dict) else {
                "res": {},
                "article_candidates": [],
                "candidates": [],
                "image_context": "",
                "anchors": [],
                "event_year": None,
            }
            for r in raw_results
        ]

        # --- Hybrid Batch Semantic LLM Adjudicator for ambiguous Wikipedia/image candidates ---
        if use_candidate_sink:
            try:
                await _llm_adjudicate_enrichment(
                    events_data=events_data,
                    results=results,
                    client=client,
                    semaphore=semaphore,
                    lang=lang,
                    timeline_topic=timeline_topic,
                    api_key=api_key,
                    preferred_model=preferred_model,
                )
            except Exception as adj_err:
                logger.debug(f"Batch LLM enrichment adjudicator skipped due to error: {adj_err}")

        stats = {"resolved": 0, "assigned": 0, "deduped": 0, "suppressed": 0}

        # --- Metadata writeback (links, extract, coordinates) ---
        for i, r in enumerate(results):
            res = r.get("res")
            if isinstance(res, dict) and res:
                stats["resolved"] += 1
                if not events_data[i].get("wikiUrl") and res.get("wikiUrl"):
                    events_data[i]["wikiUrl"] = res["wikiUrl"]
                if not events_data[i].get("wikiExtract") and res.get("extract"):
                    events_data[i]["wikiExtract"] = res["extract"]
                    events_data[i]["extract"] = res["extract"]
                elif not events_data[i].get("extract") and res.get("extract"):
                    events_data[i]["extract"] = res["extract"]
                if not events_data[i].get("wikiTitle") and res.get("wikiTitle"):
                    events_data[i]["wikiTitle"] = res["wikiTitle"]
                wiki_title_en = (
                    (res.get("fallbackWikiTitle") or "").strip()
                    or ((res.get("wikiTitle") or "").strip() if res.get("lang") == "en" else "")
                    or (events_data[i].get("wikipedia_title_en") or "").strip()
                )
                if wiki_title_en and not events_data[i].get("wikiTitleEn"):
                    events_data[i]["wikiTitleEn"] = wiki_title_en

                event_is_fictional = (
                    is_timeline_fictional
                    or bool(events_data[i].get("is_fictional"))
                )
                if event_is_fictional:
                    events_data[i]["lat"] = None
                    events_data[i]["lng"] = None
                    events_data[i]["is_fictional"] = True
                else:
                    if (events_data[i].get("lat") is None or events_data[i].get("lng") is None) and res.get("lat") is not None and res.get("lng") is not None:
                        events_data[i]["lat"] = res["lat"]
                        events_data[i]["lng"] = res["lng"]

        # --- Image assignment with timeline-wide de-duplication ---
        # Higher-ranked events get first pick of the best image; already-used images
        # are skipped so the same picture never repeats across the timeline.
        used_image_keys = set()
        for ev in events_data:
            if ev.get("imageUrl"):
                used_image_keys.add(_image_key(_filename_from_url(ev["imageUrl"]) or ev["imageUrl"]))

        order = sorted(range(len(events_data)), key=lambda i: -(events_data[i].get("rank") or 5))
        for i in order:
            ev = events_data[i]
            if ev.get("imageUrl"):
                continue  # respect a pre-existing/manual image
            ranked = _rank_image_candidates(
                results[i].get("candidates") or [],
                results[i].get("image_context") or "",
                results[i].get("anchors") or [],
            )
            pref_key = results[i].get("llm_preferred_image_key")
            if pref_key:
                ranked.sort(key=lambda c: (0 if _image_key(c["key"]) == pref_key else 1, -c["score"]))
            chosen = None
            had_candidate = False
            for c in ranked:
                if c["score"] < MIN_IMAGE_CONFIDENCE:
                    continue
                had_candidate = True
                if _image_key(c["key"]) not in used_image_keys:
                    chosen = c
                    break
            if chosen:
                ev["imageUrl"] = chosen["url"]
                if chosen.get("is_animated"):
                    ev["mediaType"] = "gif"
                used_image_keys.add(_image_key(chosen["key"]))
                stats["assigned"] += 1
            elif had_candidate:
                stats["deduped"] += 1  # all acceptable candidates already used elsewhere
            else:
                stats["suppressed"] += 1  # prefer no image over an unrelated one

        # Second pass: if an event could not claim a candidate during the first pass, fall back to
        # its article's lead image ONLY if it passes score_image quality filtering and has not
        # already been used on another event (preventing rejected junk icons or duplicate portraits).
        for i in order:
            ev = events_data[i]
            if not ev.get("imageUrl") and not results[i].get("_suppress_lead_fallback"):
                res = results[i].get("res")
                if isinstance(res, dict):
                    for fallback_url in (res.get("imageUrl"), res.get("fallbackImageUrl")):
                        if not fallback_url:
                            continue
                        fn = _filename_from_url(fallback_url) or fallback_url
                        lead_key = _image_key(fn)
                        if not lead_key or lead_key in used_image_keys:
                            continue
                        lead_cand = {
                            "url": fallback_url,
                            "filename": fn,
                            "caption": "",
                            "width": 400,
                            "mime": "",
                            "isLead": True,
                            "source": "article",
                            "key": lead_key,
                        }
                        lead_score = score_image(
                            lead_cand,
                            results[i].get("image_context") or "",
                            results[i].get("anchors") or [],
                        )
                        if lead_score is not None and lead_score >= MIN_IMAGE_CONFIDENCE:
                            ev["imageUrl"] = fallback_url
                            used_image_keys.add(lead_key)
                            stats["assigned"] += 1
                            break

        # Determine mediaType and guarantee animated GIF URLs are unscaled original files
        for ev in events_data:
            raw_img = (ev.get("imageUrl") or "")
            low_img = raw_img.lower()
            if ev.get("mediaType") == "gif":
                # Strip Wikimedia /thumb/ prefix from GIFs to ensure multi-frame animation is delivered
                if "/thumb/" in raw_img and ("wikimedia.org" in raw_img or "wikipedia.org" in raw_img):
                    ev["imageUrl"] = re.sub(
                        r"/thumb/([^/]+/[^/]+/[^/]+)/.*", r"/\1",
                        raw_img.replace("thumb.wikimedia.org", "upload.wikimedia.org")
                    ).split("?")[0]
            elif ".mp4" in low_img or ".webm" in low_img:
                ev["mediaType"] = "video"
            elif ev.get("imageUrl") and not ev.get("mediaType"):
                ev["mediaType"] = "image"

        # Final sweep: guarantee that any fictional event has lat/lng strictly set to None
        for event in events_data:
            if is_timeline_fictional or bool(event.get("is_fictional")):
                event["lat"] = None
                event["lng"] = None
                event["is_fictional"] = True

    logger.info(
        "Wikipedia enrichment: %d events | %d resolved | %d images assigned | %d deduped | %d without image",
        len(events_data), stats["resolved"], stats["assigned"], stats["deduped"], stats["suppressed"]
    )
    return events_data


async def search_geocode_candidates(query: str, limit: int = 5, lang: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Search OpenStreetMap/Nominatim for place-name candidates so the user can pick
    the correct location (and its coordinates) for a manually added/edited event,
    mirroring the Wikipedia disambiguation search used for event titles.
    """
    clean = (query or "").strip()
    if not clean or len(clean) < 2:
        return []

    headers = dict(HEADERS)
    if lang:
        headers["Accept-Language"] = lang

    params = {
        "q": clean,
        "format": "jsonv2",
        "addressdetails": 1,
        "limit": max(1, min(limit, 10)),
    }
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params=params,
                headers=headers,
                timeout=5.0,
            )
            if resp.status_code != 200:
                return []
            hits = resp.json()
    except Exception:
        logger.warning("Geocode search failed for query=%r", clean, exc_info=True)
        return []

    results = []
    for hit in hits or []:
        try:
            results.append({
                "displayName": hit.get("display_name"),
                "name": hit.get("name") or hit.get("display_name"),
                "lat": float(hit["lat"]),
                "lng": float(hit["lon"]),
                "type": hit.get("type"),
                "placeClass": hit.get("class"),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return results

