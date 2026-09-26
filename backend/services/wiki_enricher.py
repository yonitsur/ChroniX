import asyncio
import logging
import re
import time
import urllib.parse
from typing import Dict, Any, Optional, List
import httpx

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "ChroniXApp/1.0 (https://github.com/yonitsur/VisualTimeLine; yonitsur@gmail.com)"
}

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

    # Subtitle prefix: "Title: Subtitle" -> "Title"
    for sep in [":", " - ", " – ", " — "]:
        if q_base.startswith(f"{c_base}{sep}") or c_base.startswith(f"{q_base}{sep}"):
            return True

    # Entity containment inside descriptive query:
    # 1. Multi-word entity contained inside query or vice-versa
    #    (e.g. "Mount Everest" inside "First ascent of Mount Everest")
    if len(c_base.split()) >= 2 and (c_base in q_base or q_base in c_base):
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

    # 1. Prefix attachment (e.g. prepositions/articles un-/re-):
    if len1 > len2 and (len1 - len2) <= 2 and t1.endswith(t2):
        return True
    if len2 > len1 and (len2 - len1) <= 2 and t2.endswith(t1):
        return True

    # 2. Suffix attachment (e.g. plurals -s, -es, gender/case inflections):
    if len1 > len2 and (len1 - len2) <= 3 and t1.startswith(t2):
        return True
    if len2 > len1 and (len2 - len1) <= 3 and t2.startswith(t1):
        return True

    # 3. Common root/stem for words (length >= 4): share common prefix of at least len - 1 (or >= 4 chars)
    # Handles morphological inflections where final consonant or vowel changes (e.g. y->i, city->cities)
    if min(len1, len2) >= 4:
        common_len = 0
        for c1, c2 in zip(t1, t2):
            if c1 == c2:
                common_len += 1
            else:
                break
        if common_len >= 3 and common_len >= min(len1, len2) - 1:
            return True

    return False


def generic_token_overlap(text1: str, text2: str) -> int:
    """
    Count overlapping or root-related words of 3+ characters between two texts, language-agnostic.
    Computes exact intersections first, then matches morphological variations.
    """
    if not text1 or not text2:
        return 0
    t1 = set(re.findall(r'\w{3,}', text1.lower()))
    t2 = set(re.findall(r'\w{3,}', text2.lower()))
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
    paren_match = re.search(r'\(([^)]+)\)', snippet)
    if paren_match:
        content = paren_match.group(1)
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
    return set(re.findall(r'\w{3,}', (text or "").lower()))


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
    q_token_count = len(_content_tokens(q_base))

    if c == q:
        score += 100
    elif c_base == q_base:
        score += 80
    elif c.startswith(f"{q} (") or q.startswith(f"{c} ("):
        score += 75
    elif any(q_base.startswith(f"{c_base}{sep}") or c_base.startswith(f"{q_base}{sep}") for sep in [":", " - ", " – ", " — "]):
        score += 55
    elif len(c_base.split()) >= 2 and c_base in q_base:
        score += 30  # candidate is a sub-phrase of the query: usually the broader parent topic
    elif len(c_base.split()) >= 2 and q_base in c_base:
        score += 15  # candidate merely contains the query: usually a different, more specific work
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
    paren_match = re.search(r'\(([^)]+)\)', c)
    if paren_match:
        qualifier_text = paren_match.group(1).lower()
        q_overlap = generic_token_overlap(qualifier_text, q_base)
        if q_overlap:
            score += q_overlap * 25
        if context_text:
            ctx_overlap = generic_token_overlap(qualifier_text, context_text)
            if ctx_overlap:
                score += min(ctx_overlap * 20, 50)

    # 3. Temporal verification (crucial for distinguishing figures with shared names)
    if year is not None and isinstance(year, int):
        span = extract_temporal_span(f"{cand_desc} {cand_extract}")
        if span:
            if is_temporally_compatible(year, span):
                score += 50
            else:
                score -= 300  # Strict disqualification for candidate from the wrong era
        # Exact year match bonus
        if re.search(rf'\b{abs(year)}\b', f"{cand_desc} {cand_extract}"):
            score += 25

    # 4. Context overlap (timeline topic, subtitle, lane)
    if context_text:
        overlap = generic_token_overlap(f"{c} {cand_desc} {cand_extract}", context_text)
        score += min(overlap * 15, 60)

    # 5. Image bonus (quality indicator)
    if cand.get("imageUrl"):
        score += 10

    return score


MIN_CONFIDENCE_THRESHOLD = 60


async def _resolve_disambiguation(
    title: str,
    client: httpx.AsyncClient,
    lang: str = "en",
    context_text: str = "",
    year: Optional[int] = None
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
        for line in wt.split("\n"):
            m = re.findall(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]', line)
            if m:
                link = m[0].strip()
                if link in mainspace_links or (not mainspace_links and ":" not in link):
                    clean_line = re.sub(r'\[\[(?:[^\]|]+\|)?([^\]]+)\]\]', r'\1', line)
                    candidates.append((link, clean_line))

        if not candidates:
            return None

        # Every option repeats the ambiguous name itself, so those tokens carry no evidence.
        name_tokens = _content_tokens(re.sub(r'\s*\([^)]*\)', '', title))

        def discriminative_text(text: str) -> str:
            return " ".join(
                t for t in re.findall(r'\w{3,}', text.lower())
                if not any(are_tokens_related(t, nt) for nt in name_tokens)
            )

        def score_disambig_candidate(link: str, desc: str) -> int:
            sc = generic_token_overlap(discriminative_text(f"{link} {desc}"), context_text) * 15
            if year is not None and isinstance(year, int):
                if title_year_conflicts(link, year):
                    return -200
                span = extract_temporal_span(f"{link} {desc}")
                if span:
                    if is_temporally_compatible(year, span):
                        sc += 60
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
        if top_score >= 15 and (runner_up is None or top_score > runner_up):
            return await _get_summary_direct(top_title, client, lang=lang, resolve_disambig=False, year=year)

    except Exception as e:
        logger.debug(f"Failed to resolve disambiguation for '{title}': {e}")

    return None


async def _get_summary_direct(
    title: str,
    client: httpx.AsyncClient,
    lang: str = "en",
    resolve_disambig: bool = True,
    context_text: str = "",
    year: Optional[int] = None
) -> Optional[Dict[str, Any]]:
    """
    Fetch Wikipedia summary using REST API.
    Follows canonical server-side redirects automatically.
    Resolves disambiguation pages using context and year if resolve_disambig is True.
    Verifies temporal compatibility before returning standard articles.
    """
    clean = title.strip().replace(" ", "_")
    url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(clean, safe='')}"
    for attempt in range(2):
        try:
            resp = await client.get(url, headers=HEADERS, timeout=5.0)
            if resp.status_code == 429 and attempt == 0:
                await asyncio.sleep(0.5)
                continue
            if resp.status_code == 200:
                data = resp.json()
                if data.get("type") == "disambiguation":
                    if resolve_disambig and (context_text or year is not None):
                        return await _resolve_disambiguation(title, client, lang=lang, context_text=context_text, year=year)
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

                img_url = None
                if "thumbnail" in data and "source" in data["thumbnail"]:
                    img_url = data["thumbnail"]["source"]
                elif "originalimage" in data and "source" in data["originalimage"]:
                    img_url = data["originalimage"]["source"]

                coords = data.get("coordinates")
                lat = None
                lng = None
                if coords and isinstance(coords, dict):
                    lat = coords.get("lat")
                    lng = coords.get("lon")

                return {
                    "wikiTitle": data.get("title", title),
                    "wikiUrl": data.get("content_urls", {}).get("desktop", {}).get("page"),
                    "extract": ext,
                    "description": desc,
                    "imageUrl": img_url,
                    "lat": lat,
                    "lng": lng,
                    "lang": lang,
                    "type": data.get("type", "standard")
                }
            break
        except (httpx.TimeoutException, httpx.NetworkError):
            if attempt == 0:
                await asyncio.sleep(0.3)
                continue
            break
        except Exception:
            break
    return None


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
                return data[1]
    except Exception:
        pass

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
    try:
        clean = title.strip().replace(" ", "_")
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
                        return links[0]["*"]
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
                return {"exists": False, "langlink": None}
            links = page.get("langlinks") or []
            return {"exists": True, "langlink": links[0].get("*") if links else None}
    except Exception:
        return None
    return None


async def _lookup_direct(
    title: str,
    client: httpx.AsyncClient,
    lang: str,
    context_text: str = "",
    year: Optional[int] = None,
    skip_exact: bool = False
) -> Optional[Dict[str, Any]]:
    """
    Direct REST lookup over the title and its simplified variations. When a variation drops a
    parenthetical qualifier ('Ur (continent)' -> 'Ur'), the landed article must still reflect that
    qualifier, otherwise the bare name has resolved to a different sense (e.g. 'Ur' the city).
    """
    for cand in generate_title_variations(title, lang=lang):
        if skip_exact and cand == title.strip():
            continue
        qualifier, subtitle = _dropped_parts(title, cand)
        ctx = " ".join(p for p in (context_text, qualifier, subtitle) if p)
        res = await _get_summary_direct(cand, client, lang=lang, resolve_disambig=True, context_text=ctx, year=year)
        if not res:
            continue
        if qualifier and not qualifier_supported(qualifier, res):
            logger.debug(f"'{cand}' -> '{res.get('wikiTitle')}' rejected: does not reflect qualifier '{qualifier}'")
            continue
        return res
    return None


async def _find_best_search_candidate(
    query: str,
    candidate_queries: List[str],
    client: httpx.AsyncClient,
    lang: str = "en",
    context_text: str = "",
    year: Optional[int] = None,
    min_confidence: int = MIN_CONFIDENCE_THRESHOLD
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

    # Filter out titles that have zero lexical relevance to any variation
    relevant_titles = [
        t for t in collected_titles
        if any(is_title_relevant(t, q) for q in candidate_queries)
    ]
    if not relevant_titles:
        return None

    # Fetch summaries for candidate titles in parallel
    tasks = [
        _get_summary_direct(t, client, lang=lang, resolve_disambig=False, year=year)
        for t in relevant_titles[:5]
    ]
    summaries = await asyncio.gather(*tasks, return_exceptions=True)

    scored_candidates = []
    for s in summaries:
        if isinstance(s, dict) and s.get("wikiTitle"):
            sc = score_candidate(s, query, context_text=context_text, year=year)
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

    return scored_candidates[0][1]


async def fetch_wikipedia_summary(
    title: str,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    lang: str = "en",
    context_text: str = "",
    year: Optional[int] = None,
    is_prehistoric: bool = False,
    fallback_lang: str = "en",
    fallback_title: Optional[str] = None
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

    async with semaphore:
        candidates = generate_title_variations(title, lang=lang)
        fb_target = (fallback_title or "").strip()
        if not fb_target and cross_lingual and is_likely_searchable_entity(title):
            fb_target = title.strip()

        # 1. Primary language: Direct REST lookup
        primary_res = await _lookup_direct(title, client, lang, context_text, year)

        # 2. Cross-lingual exact bridge, before any fuzzy search: an exact fallback-language title
        #    beats a loose primary-language search hit (e.g. the city 'Mantinea' for the battle).
        if not primary_res and cross_lingual and fb_target:
            probe = await _probe_title(fb_target, fallback_lang, lang, client)
            linked_title = probe.get("langlink") if probe else await _get_langlink(
                fb_target, from_lang=fallback_lang, to_lang=lang, client=client
            )
            if linked_title:
                primary_res = await _get_summary_direct(
                    linked_title, client, lang=lang, resolve_disambig=True, context_text=context_text, year=year
                )
            if not primary_res:
                res = await _lookup_direct(
                    fb_target, client, fallback_lang, context_text, year,
                    skip_exact=probe is not None and not probe.get("exists"),
                )
                if res:
                    return res

        # 2b. The primary-language title itself may be a fallback-language title (e.g. an English
        #     game name inside a Hebrew timeline).
        if not primary_res and cross_lingual and fallback_title and title.strip() != fb_target:
            linked_title = await _get_langlink(title, from_lang=fallback_lang, to_lang=lang, client=client)
            if linked_title:
                primary_res = await _get_summary_direct(
                    linked_title, client, lang=lang, resolve_disambig=True, context_text=context_text, year=year
                )

        # 3. Primary language: Multi-candidate search fallback
        if not primary_res:
            primary_res = await _find_best_search_candidate(
                query=title,
                candidate_queries=candidates,
                client=client,
                lang=lang,
                context_text=context_text,
                year=year,
                min_confidence=MIN_CONFIDENCE_THRESHOLD
            )

        # 4. If primary language article found: supplement missing thumbnail / coordinates from fallback language
        if primary_res:
            if lang != fallback_lang and (not primary_res.get("imageUrl") or primary_res.get("lat") is None):
                supplement_target = (fallback_title or "").strip()
                if not supplement_target and primary_res.get("wikiTitle"):
                    # Use native interlanguage links to find canonical article in fallback language
                    supplement_target = await _get_langlink(
                        primary_res["wikiTitle"],
                        from_lang=lang,
                        to_lang=fallback_lang,
                        client=client
                    ) or ""
                if not supplement_target and is_likely_searchable_entity(title):
                    supplement_target = title.strip()

                if supplement_target:
                    # Guarded lookup so a stripped qualifier can't borrow another sense's photo/coords.
                    sup_res = await _lookup_direct(supplement_target, client, fallback_lang, context_text, year)
                    if sup_res:
                        if not primary_res.get("imageUrl") and sup_res.get("imageUrl"):
                            primary_res["imageUrl"] = sup_res["imageUrl"]
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
                min_confidence=MIN_CONFIDENCE_THRESHOLD
            )
            if res:
                return res

        return {}


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
    "portal", "padlock", "seal_of", "emblem", "locator_map_of", "location_map_of", "blank_map_of", "topographic",
    "reliefkarte", "positionskarte", "pictogram", "text_document",
)
IMAGE_REJECT_EXT = (".ogg", ".oga", ".ogv", ".wav", ".mid", ".midi", ".webm", ".pdf")

# Minimum composite score for an image to be shown at all (below it we prefer no image).
MIN_IMAGE_CONFIDENCE = 5

_ARTICLE_IMAGES_CACHE: Dict[tuple, Any] = {}   # (lang, title_lower) -> (expires_at, raw_candidates)
_IMAGE_CACHE_TTL = 1800  # seconds


def _cache_get(store: dict, key):
    entry = store.get(key)
    if not entry:
        return None
    expires_at, value = entry
    if expires_at < time.monotonic():
        store.pop(key, None)
        return None
    return value


def _cache_put(store: dict, key, value, ttl: int = _IMAGE_CACHE_TTL):
    store[key] = (time.monotonic() + ttl, value)


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


def score_image(
    cand: Dict[str, Any],
    event_context: str = "",
    animation_context=None,
) -> Optional[int]:
    """
    Composite confidence score for a candidate image relative to the event context.
    Returns None if the candidate is disqualified (junk type, wrong MIME, unusable).
    Rewards: Wikidata canonical depiction (P18), editorial lead image, caption/context
    overlap, and adequate resolution. Penalizes tiny thumbnails.

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

    candidate_text = _normalize_media_text(
        f"{cand.get('filename') or _filename_from_url(cand.get('url') or '')} {cand.get('caption') or ''}"
    )
    anchors = animation_context if animation_context is not None else event_context
    if isinstance(anchors, str):
        anchors = [anchors]
    needs_subject_evidence = cand.get("is_animated") or source == "commons"
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
        score += 25  # editorially chosen lead image
    if source == "article":
        score += 8
    if source == "commons_gif":
        # Commons GIF candidates must be verified multi-frame animations with context overlap
        if not cand.get("is_animated"):
            return None  # Disqualify static 1-frame GIFs from Commons search
        if event_context:
            overlap = generic_token_overlap(candidate_text, event_context)
            if overlap >= 2:
                score += 25  # Strong contextual match for authentic motion diagram
            elif overlap == 1:
                score += 10  # Modest boost; cannot beat an article's verified lead image
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
        overlap = generic_token_overlap(candidate_text, event_context)
        score += min(overlap * 12, 48)
    if cand.get("is_animated"):
        score += 20  # elevate verified multi-frame animations (battle maps, drift models)
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
            f"&iiprop=url|size|mime|extmetadata&iiurlwidth=400"
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
            f"&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=400"
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
            fname = (page.get("title", "") or "")[5:]  # strip "File:"
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
    "record of", "payroll"
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
    results: List[Dict[str, Any]] = []
    try:
        search_query = f"{clean} filemime:image/gif"
        url = (
            f"https://commons.wikimedia.org/w/api.php?action=query&format=json"
            f"&generator=search&gsrsearch={urllib.parse.quote(search_query)}&gsrnamespace=6&gsrlimit={limit}"
            f"&prop=imageinfo&iiprop=url|size|mime|metadata|extmetadata&iiurlwidth=400"
        )
        resp = await client.get(url, headers=HEADERS, timeout=5.0)
        if resp.status_code != 200:
            return []
        pages = resp.json().get("query", {}).get("pages", {})
        for _pid, page in pages.items():
            ii = page.get("imageinfo") or []
            if not ii:
                continue
            info = ii[0]
            fname = (page.get("title", "") or "")[5:]  # strip "File:"
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
            # keep one entry but merge in the richer metadata.
            existing = by_key.get(key)
            if existing is not None:
                existing["isLead"] = existing["isLead"] or is_lead
                if caption and not existing["caption"]:
                    existing["caption"] = caption
                if width and not existing["width"]:
                    existing["width"] = width
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
                f"&piprop=name|thumbnail&pithumbsize=400&imlimit=40&ppprop=wikibase_item"
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
                        if t.lower().startswith("file:"):
                            fname = t[5:]
                            low = fname.lower()
                            if low.endswith(IMAGE_REJECT_EXT) or any(k in low for k in IMAGE_JUNK_KEYWORDS):
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
                    f"&iiprop=url|size|mime|metadata|extmetadata&iiurlwidth=400"
                )
                resp = await client.get(url, headers=HEADERS, timeout=7.0)
                if resp.status_code == 200:
                    pages = resp.json().get("query", {}).get("pages", {})
                    for _pid, page in pages.items():
                        ii = page.get("imageinfo") or []
                        if not ii:
                            continue
                        info = ii[0]
                        fname = (page.get("title", "") or "")[5:]  # strip "File:"
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

    # What the article itself yielded (raster only). The lead counts double: it is editorially
    # confirmed, and this keeps P18/Commons lookup volume unchanged now that it is de-duplicated.
    def _illustration_weight() -> int:
        raster = [c for c in candidates if not c["key"].endswith(IMAGE_REJECT_EXT)]
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
                commons = await fetch_commons_fallback_images(title, client, limit=4)
            for c in commons:
                _add(c["url"], filename=c.get("filename"), caption=c.get("caption", ""),
                     width=c.get("width", 0), mime=c.get("mime", ""), source="commons")
        except Exception:
            pass

    _cache_put(_ARTICLE_IMAGES_CACHE, cache_key, candidates)
    return candidates


async def enrich_events_with_wikipedia(
    events_data: list,
    lang: str = "en",
    timeline_topic: str = "",
    is_timeline_fictional: bool = False
) -> list:
    """
    Given a list of event dictionaries, asynchronously fetch Wikipedia data with precision-first guarantees.
    Supports any language edition with automatic fallback to English Wikipedia.
    Images are gathered as ranked multi-source candidates and assigned in a second pass with
    timeline-wide de-duplication so the same picture never repeats and weak images are suppressed.
    """
    semaphore = asyncio.Semaphore(10)
    lang = (lang or "en").strip().lower()

    async with httpx.AsyncClient(follow_redirects=True) as client:
        async def fetch_for_event(event: dict):
            wiki_key = (event.get("wikipedia_title") or "").strip()
            wiki_key_en = (event.get("wikipedia_title_en") or "").strip()
            regular_title = (event.get("title") or "").strip()
            subtitle = (event.get("subtitle") or "").strip()
            lane = (event.get("lane") or "").strip()

            from_dict = event.get("from")
            event_year = None
            if isinstance(from_dict, dict) and "year" in from_dict:
                event_year = from_dict.get("year")
            elif isinstance(event.get("from_year"), int):
                event_year = event.get("from_year")

            category = (event.get("category") or "").strip()
            context_parts = [timeline_topic, regular_title, category, subtitle, lane]
            if event_year is not None:
                context_parts.append(str(event_year))
            context_text = " ".join([p for p in context_parts if p]).strip()

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
                    fallback_title=wiki_key_en or (regular_title if lang == "en" else None)
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
                    fallback_title=wiki_key_en
                )

            # 3. If still not found and we have an English fallback key, query English directly
            if not res and wiki_key_en and lang != "en":
                res = await fetch_wikipedia_summary(
                    wiki_key_en,
                    client,
                    semaphore,
                    lang="en",
                    context_text=context_text,
                    year=event_year
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
                # If non-English article yielded fewer than 2 candidates, supplement from English counterpart
                if len(candidates) < 2 and res.get("fallbackWikiTitle") and lang != "en":
                    fb_cands = await fetch_image_candidates(
                        res["fallbackWikiTitle"],
                        client,
                        semaphore,
                        lang="en",
                        lead_url=res.get("imageUrl"),
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
                "candidates": candidates,
                "image_context": image_context,
                "anchors": anchors,
            }

        tasks = [fetch_for_event(event) for event in events_data]
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

        # Normalize (exceptions -> empty result)
        results = [
            r if isinstance(r, dict) else {"res": {}, "candidates": [], "image_context": "", "anchors": []}
            for r in raw_results
        ]

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

        # Second pass: ensure events with a resolved Wikipedia article are not left imageless.
        # If an event could not claim a unique image during the first pass, fall back to its verified lead image.
        for i in order:
            ev = events_data[i]
            if not ev.get("imageUrl"):
                res = results[i].get("res")
                if isinstance(res, dict) and res.get("imageUrl"):
                    ev["imageUrl"] = res["imageUrl"]
                    stats["assigned"] += 1

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

