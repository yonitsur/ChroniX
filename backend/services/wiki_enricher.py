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

    # Multi-word entity contained inside descriptive query
    # (e.g. "Mount Everest" inside "First ascent of Mount Everest")
    if len(c_base.split()) >= 2 and (c_base in q_base or q_base in c_base):
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


def generic_token_overlap(text1: str, text2: str) -> int:
    """Count overlapping words of 3+ characters between two texts, language-agnostic."""
    if not text1 or not text2:
        return 0
    t1 = set(re.findall(r'\w{3,}', text1.lower()))
    t2 = set(re.findall(r'\w{3,}', text2.lower()))
    return len(t1.intersection(t2))


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

    if c == q:
        score += 100
    elif c_base == q_base:
        score += 80
    elif c.startswith(f"{q} (") or q.startswith(f"{c} ("):
        score += 75
    elif any(q_base.startswith(f"{c_base}{sep}") or c_base.startswith(f"{q_base}{sep}") for sep in [":", " - ", " – ", " — "]):
        score += 55
    elif len(c_base.split()) >= 2 and (c_base in q_base or q_base in c_base):
        score += 35
    else:
        score -= 50

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

        def score_disambig_candidate(link: str, desc: str) -> int:
            sc = generic_token_overlap(f"{link} {desc}", context_text) * 15
            if year is not None and isinstance(year, int):
                span = extract_temporal_span(f"{link} {desc}")
                if span:
                    if is_temporally_compatible(year, span):
                        sc += 60
                    else:
                        sc -= 200
                if re.search(rf'\b{abs(year)}\b', desc):
                    sc += 30
            return sc

        scored = [(score_disambig_candidate(link, desc), link) for link, desc in candidates]
        scored.sort(key=lambda x: x[0], reverse=True)

        top_score, top_title = scored[0]
        if top_score > 0:
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
    try:
        resp = await client.get(url, headers=HEADERS, timeout=5.0)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("type") == "disambiguation":
                if resolve_disambig and (context_text or year is not None):
                    return await _resolve_disambiguation(title, client, lang=lang, context_text=context_text, year=year)
                return None

            desc = data.get("description", "")
            ext = data.get("extract", "")

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
    except Exception:
        pass
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
    try:
        url = (
            f"https://{lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch="
            f"{urllib.parse.quote(clean)}&srlimit={limit}&format=json"
        )
        resp = await client.get(url, headers=HEADERS, timeout=5.0)
        if resp.status_code == 200:
            hits = resp.json().get("query", {}).get("search", [])
            titles = [h["title"] for h in hits if "title" in h]
            if titles:
                return titles
    except Exception:
        pass

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
            f"{urllib.parse.quote(clean)}&prop=langlinks&lllang={to_lang}&format=json"
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
    Precision-first multilingual architecture:
    1. Direct REST lookup on canonical variations with temporal validation.
    2. Multi-candidate scored search fallback with strict confidence gating.
    3. Interlanguage bridge using MediaWiki langlinks.
    4. Optional English fallback only if query represents a valid searchable entity.
    """
    if not title:
        return {}

    lang = (lang or "en").strip().lower()
    fallback_lang = (fallback_lang or "en").strip().lower()

    async with semaphore:
        primary_res: Optional[Dict[str, Any]] = None
        candidates = generate_title_variations(title, lang=lang)

        # 1. Primary language: Direct REST lookup
        for cand in candidates:
            res = await _get_summary_direct(cand, client, lang=lang, resolve_disambig=True, context_text=context_text, year=year)
            if res:
                primary_res = res
                break

        # 2. Primary language: Multi-candidate search fallback
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

        # 3. Interlanguage Links Bridge (MediaWiki langlinks):
        if not primary_res and lang != fallback_lang:
            potential_sources = [fallback_title, title]
            for src in potential_sources:
                if not src:
                    continue
                for src_cand in generate_title_variations(src, lang=fallback_lang):
                    linked_title = await _get_langlink(src_cand, from_lang=fallback_lang, to_lang=lang, client=client)
                    if linked_title:
                        res = await _get_summary_direct(linked_title, client, lang=lang, resolve_disambig=True, context_text=context_text, year=year)
                        if res:
                            primary_res = res
                            break
                if primary_res:
                    break

        # 4. If primary language article found: supplement missing thumbnail / coordinates from fallback language
        if primary_res:
            if lang != fallback_lang and (not primary_res.get("imageUrl") or primary_res.get("lat") is None):
                supplement_target = (fallback_title or primary_res.get("wikiTitle") or title).strip()
                if supplement_target:
                    sup_candidates = generate_title_variations(supplement_target, lang=fallback_lang)
                    for sup_cand in sup_candidates:
                        sup_res = await _get_summary_direct(sup_cand, client, lang=fallback_lang, resolve_disambig=False)
                        if sup_res:
                            if not primary_res.get("imageUrl") and sup_res.get("imageUrl"):
                                primary_res["imageUrl"] = sup_res["imageUrl"]
                            if primary_res.get("lat") is None and sup_res.get("lat") is not None:
                                primary_res["lat"] = sup_res["lat"]
                                primary_res["lng"] = sup_res.get("lng")
                            break
            return primary_res

        # 5. Fallback to English Wikipedia
        if lang != fallback_lang:
            fb_target = (fallback_title or "").strip()
            if not fb_target and is_likely_searchable_entity(title):
                fb_target = title.strip()

            if fb_target:
                fb_candidates = generate_title_variations(fb_target, lang=fallback_lang)
                # 5a. Fallback direct REST
                for fb_cand in fb_candidates:
                    res = await _get_summary_direct(fb_cand, client, lang=fallback_lang, resolve_disambig=True, context_text=context_text, year=year)
                    if res:
                        return res

                # 5b. Fallback multi-candidate search
                res = await _find_best_search_candidate(
                    query=fb_target,
                    candidate_queries=fb_candidates,
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
    "portal", "padlock", "seal_of", "emblem", "map_of", "topographic",
    "reliefkarte", "positionskarte", "pictogram", "text_document",
)
IMAGE_REJECT_EXT = (".svg", ".ogg", ".oga", ".ogv", ".wav", ".mid", ".midi", ".webm", ".gif", ".pdf")

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
        path = urllib.parse.urlparse(url).path
        seg = urllib.parse.unquote(path.split("/")[-1])
        # Strip a leading thumbnail size prefix like "330px-".
        return re.sub(r'^\d+px-', '', seg)
    except Exception:
        return ""


def score_image(cand: Dict[str, Any], event_context: str = "") -> Optional[int]:
    """
    Composite confidence score for a candidate image relative to the event context.
    Returns None if the candidate is disqualified (junk type, wrong MIME, unusable).
    Rewards: Wikidata canonical depiction (P18), editorial lead image, caption/context
    overlap, and adequate resolution. Penalizes tiny thumbnails.
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

    score = 0
    if source == "wikidata":
        score += 35  # canonical depiction (Wikidata P18) — best for artworks/people
    if is_lead:
        score += 25  # editorially chosen lead image
    if source == "article":
        score += 8
    if width:
        if width < 150:
            score -= 45
        elif width >= 500:
            score += 12
        elif width >= 320:
            score += 6
    if event_context:
        overlap = generic_token_overlap(f"{key_name} {caption}".replace("_", " ").replace("-", " "), event_context)
        score += min(overlap * 12, 48)
    return score


def _rank_image_candidates(raw_candidates: List[Dict[str, Any]], event_context: str = "") -> List[Dict[str, Any]]:
    """Score, filter, and sort candidate images (best first) for a given event context."""
    scored = []
    for c in raw_candidates:
        s = score_image(c, event_context)
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


async def fetch_image_candidates(
    title: str,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    lang: str = "en",
    lead_url: Optional[str] = None,
    wikidata_qid: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Collect a de-duplicated set of raw (unscored) image candidates for a resolved article:
      1. MediaWiki pageimages (lead) + images list, resolved via a single batched imageinfo call.
      2. Wikidata P18 canonical depiction (great for artworks/people/specific works).
      3. Wikimedia Commons search as a last resort when the article is image-poor.
    Scoring/ranking is per-event (context differs); results are cached per (lang, title).
    """
    title = (title or "").strip()
    if not title:
        return []

    cache_key = (lang, title.lower())
    cached = _cache_get(_ARTICLE_IMAGES_CACHE, cache_key)
    if cached is not None:
        return cached

    candidates: List[Dict[str, Any]] = []
    seen_keys = set()

    def _add(url, filename=None, caption="", width=0, mime="", is_lead=False, source="article"):
        if not url:
            return
        fn = filename or _filename_from_url(url)
        key = (fn or url).lower()
        if not key or key in seen_keys:
            return
        seen_keys.add(key)
        candidates.append({
            "url": url,
            "filename": fn,
            "caption": caption or "",
            "width": width or 0,
            "mime": mime or "",
            "isLead": is_lead,
            "source": source,
            "key": key,
        })

    # Seed with the REST lead thumbnail so we never regress if the API calls fail.
    if lead_url:
        _add(lead_url, is_lead=True, source="article")

    async with semaphore:
        lead_name = None
        file_titles: List[str] = []
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
                    f"&iiprop=url|size|mime|extmetadata&iiurlwidth=400"
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
                        _add(
                            info.get("thumburl") or info.get("url"),
                            filename=fname,
                            caption=caption,
                            width=info.get("thumbwidth") or info.get("width") or 0,
                            mime=info.get("mime", ""),
                            is_lead=is_lead,
                            source="article",
                        )
            except Exception:
                pass

    # What the article itself yielded (raster only)
    raster = [c for c in candidates if not c["key"].endswith(IMAGE_REJECT_EXT)]

    # 3. Wikidata P18 canonical depiction (best-effort). Only when the article is
    #    image-poor (also the common case for specific artworks/works), to limit API volume.
    if wikidata_qid and len(raster) < 3:
        try:
            async with semaphore:
                p18 = await fetch_wikidata_image(wikidata_qid, client)
            if p18 and p18.get("url"):
                _add(p18["url"], filename=p18.get("filename"), caption=p18.get("caption", ""),
                     width=p18.get("width", 0), mime=p18.get("mime", ""), source="wikidata")
                raster = [c for c in candidates if not c["key"].endswith(IMAGE_REJECT_EXT)]
        except Exception:
            pass

    # 4. Commons fallback when the article yielded almost nothing usable
    if len(raster) < 2:
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

            context_parts = [timeline_topic, subtitle, lane]
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
                candidates = await fetch_image_candidates(
                    res["wikiTitle"],
                    client,
                    semaphore,
                    lang=res.get("lang", lang),
                    lead_url=res.get("imageUrl"),
                )

            return {"res": res, "candidates": candidates, "context": context_text}

        tasks = [fetch_for_event(event) for event in events_data]
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

        # Normalize (exceptions -> empty result)
        results = [
            r if isinstance(r, dict) else {"res": {}, "candidates": [], "context": ""}
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
                used_image_keys.add((_filename_from_url(ev["imageUrl"]).lower() or ev["imageUrl"]))

        order = sorted(range(len(events_data)), key=lambda i: -(events_data[i].get("rank") or 5))
        for i in order:
            ev = events_data[i]
            if ev.get("imageUrl"):
                continue  # respect a pre-existing/manual image
            ranked = _rank_image_candidates(results[i].get("candidates") or [], results[i].get("context") or "")
            chosen = None
            had_candidate = False
            for c in ranked:
                if c["score"] < MIN_IMAGE_CONFIDENCE:
                    continue
                had_candidate = True
                if c["key"] not in used_image_keys:
                    chosen = c
                    break
            if chosen:
                ev["imageUrl"] = chosen["url"]
                used_image_keys.add(chosen["key"])
                stats["assigned"] += 1
            elif had_candidate:
                stats["deduped"] += 1  # all acceptable candidates already used elsewhere
            else:
                stats["suppressed"] += 1  # prefer no image over an unrelated one

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

