import asyncio
import logging
import re
import urllib.parse
from typing import Dict, Any, Optional, List
import httpx

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "ChroniXApp/1.0 (https://github.com/yonitsur/VisualTimeLine; yonitsur@gmail.com)"
}


def generate_title_variations(raw_title: str, lang: str = "he") -> List[str]:
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
    2. Parenthetical disambiguation qualifiers (e.g. 'יפתחאל' -> 'יפתחאל (אתר ארכאולוגי)')
    3. Subtitle prefix matches (e.g. 'מערת קסם: מוקדי אש' -> 'מערת קסם')
    4. Multi-word entity containment (e.g. 'המאובן במערת מיסליה' -> 'מערת מיסליה')
    Rejects completely different subjects/names without hardcoded word lists.
    """
    c = candidate_title.strip().lower()
    q = query_title.strip().lower()

    if not c or not q:
        return False

    if c == q:
        return True

    # Disambiguation parenthetical: "יפתחאל (אתר ארכאולוגי)" matching "יפתחאל"
    if c.startswith(f"{q} (") or q.startswith(f"{c} ("):
        return True

    # Base without parentheticals
    c_base = re.sub(r'\s*\([^)]*\)', '', c).strip()
    q_base = re.sub(r'\s*\([^)]*\)', '', q).strip()
    if c_base == q_base:
        return True

    # Subtitle prefix: "מערת קסם: מוקדי אש" -> "מערת קסם"
    for sep in [":", " - ", " – ", " — "]:
        if q_base.startswith(f"{c_base}{sep}") or c_base.startswith(f"{q_base}{sep}"):
            return True

    # Multi-word entity contained inside descriptive query
    # (e.g. "מערת מיסליה" inside "המאובן במערת מיסליה", or "Mount Everest" inside "First ascent of Mount Everest")
    if len(c_base.split()) >= 2 and (c_base in q_base or re.sub(r'^[ובלכמ]+', '', c_base) in q_base):
        return True

    return False


def generic_token_overlap(text1: str, text2: str) -> int:
    """Count overlapping words of 3+ characters between two texts, language-agnostic."""
    if not text1 or not text2:
        return 0
    t1 = set(re.findall(r'\w{3,}', text1.lower()))
    t2 = set(re.findall(r'\w{3,}', text2.lower()))
    return len(t1.intersection(t2))


async def _resolve_disambiguation(
    title: str,
    client: httpx.AsyncClient,
    lang: str = "en",
    context_text: str = ""
) -> Optional[Dict[str, Any]]:
    """
    Parse a disambiguation page and select the option with the highest
    semantic token overlap with the event/timeline context.
    Universal across all Wikipedia language editions by using MediaWiki's
    native mainspace filter (ns == 0), completely eliminating hardcoded namespace strings.
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
        # MediaWiki namespace 0 is the universal content/article namespace across all 300+ Wikipedia editions
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
                # Accept links that belong to the main article space (ns == 0)
                if link in mainspace_links or (not mainspace_links and ":" not in link):
                    clean_line = re.sub(r'\[\[(?:[^\]|]+\|)?([^\]]+)\]\]', r'\1', line)
                    candidates.append((link, clean_line))

        if not candidates:
            return None

        # Score candidates by generic token overlap with context
        scored = [(generic_token_overlap(f"{link} {desc}", context_text), link) for link, desc in candidates]
        scored.sort(key=lambda x: x[0], reverse=True)

        top_score, top_title = scored[0]
        if top_score > 0:
            return await _get_summary_direct(top_title, client, lang=lang, resolve_disambig=False)

    except Exception as e:
        logger.debug(f"Failed to resolve disambiguation for '{title}': {e}")

    return None


async def _get_summary_direct(
    title: str,
    client: httpx.AsyncClient,
    lang: str = "en",
    resolve_disambig: bool = True,
    context_text: str = ""
) -> Optional[Dict[str, Any]]:
    """
    Fetch Wikipedia summary using REST API.
    Follows canonical server-side redirects automatically.
    Resolves disambiguation pages using context if resolve_disambig is True.
    """
    clean = title.strip().replace(" ", "_")
    url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(clean, safe='')}"
    try:
        resp = await client.get(url, headers=HEADERS, timeout=5.0)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("type") == "disambiguation":
                if resolve_disambig and context_text:
                    return await _resolve_disambiguation(title, client, lang=lang, context_text=context_text)
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
                "extract": data.get("extract", ""),
                "description": data.get("description", ""),
                "imageUrl": img_url,
                "lat": lat,
                "lng": lng,
                "lang": lang
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
    Fetch the canonical page title in another language edition using Wikipedia's
    native interlanguage links (langlinks / Wikidata).
    Enables precise cross-language article resolution (e.g. 'French Directory' -> 'حكومة المديرين الفرنسية 1795–1799').
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
    Universal multilingual architecture with graceful English fallback:
    1. Direct REST lookup and search fallback on the target language Wikipedia edition (e.g. fr, es, de, he, ar).
    2. Interlanguage bridge: Uses MediaWiki langlinks on English fallback to resolve exact canonical local title.
    3. Media supplementation: If found locally but lacks thumbnail or coords, supplements from English Wikipedia.
    4. Fallback: If not found in target language at all, falls back to English Wikipedia.
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
            res = await _get_summary_direct(cand, client, lang=lang, resolve_disambig=True, context_text=context_text)
            if res:
                primary_res = res
                break

        # 2. Primary language: Search fallback
        if not primary_res:
            for cand in candidates:
                search_hits = await _search_wikipedia_titles(cand, client, lang=lang, limit=5)
                for hit in search_hits:
                    if is_title_relevant(hit, cand) or is_title_relevant(hit, title):
                        res = await _get_summary_direct(hit, client, lang=lang, resolve_disambig=False)
                        if res:
                            primary_res = res
                            break
                if primary_res:
                    break

        # 3. Interlanguage Links Bridge (MediaWiki langlinks):
        # If primary language direct & search lookups failed, check if the fallback language (e.g. English)
        # has a verified interlanguage link pointing to the exact canonical title in the target language!
        if not primary_res and lang != fallback_lang:
            potential_sources = [fallback_title, title]
            for src in potential_sources:
                if not src:
                    continue
                for src_cand in generate_title_variations(src, lang=fallback_lang):
                    linked_title = await _get_langlink(src_cand, from_lang=fallback_lang, to_lang=lang, client=client)
                    if linked_title:
                        res = await _get_summary_direct(linked_title, client, lang=lang, resolve_disambig=True, context_text=context_text)
                        if res:
                            primary_res = res
                            break
                if primary_res:
                    break

        # 4. If primary language found: supplement missing thumbnail / coordinates from fallback language (en)
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

        # 5. Fallback to English Wikipedia only if the article does not exist in the primary language at all
        if lang != fallback_lang:
            fb_target = (fallback_title or title).strip()
            if fb_target:
                fb_candidates = generate_title_variations(fb_target, lang=fallback_lang)
                # 5a. Fallback direct REST
                for fb_cand in fb_candidates:
                    res = await _get_summary_direct(fb_cand, client, lang=fallback_lang, resolve_disambig=True, context_text=context_text)
                    if res:
                        return res

                # 5b. Fallback search
                for fb_cand in fb_candidates:
                    search_hits = await _search_wikipedia_titles(fb_cand, client, lang=fallback_lang, limit=5)
                    for hit in search_hits:
                        if is_title_relevant(hit, fb_cand) or is_title_relevant(hit, fb_target):
                            res = await _get_summary_direct(hit, client, lang=fallback_lang, resolve_disambig=False)
                            if res:
                                return res

        return {}


async def search_wikipedia_candidates(
    query: str,
    client: httpx.AsyncClient,
    lang: str = "en",
    context_text: str = "",
    limit: int = 5,
    fallback_lang: str = "en"
) -> List[Dict[str, Any]]:
    """
    Search Wikipedia for multiple candidate articles matching a query and optional timeline context.
    Universal across languages with English fallback candidates.
    """
    clean = query.strip()
    if not clean:
        return []

    lang = (lang or "en").strip().lower()
    fallback_lang = (fallback_lang or "en").strip().lower()
    titles_set: List[str] = []

    # 1. If context_text is provided, search combined query first to prioritize domain-relevant articles
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

    # 4. Fetch rich summary for the top candidates
    candidates_to_fetch = titles_set[:limit + 3]
    tasks = [_get_summary_direct(t, client, lang=lang, resolve_disambig=False) for t in candidates_to_fetch]
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
    if len(valid_candidates) < 2 and lang != fallback_lang:
        try:
            fb_direct = await _search_wikipedia_titles(clean, client, lang=fallback_lang, limit=limit)
            fb_fetch = [t for t in fb_direct if t not in seen_titles][:limit]
            fb_tasks = [_get_summary_direct(t, client, lang=fallback_lang, resolve_disambig=False) for t in fb_fetch]
            fb_results = await asyncio.gather(*fb_tasks, return_exceptions=True)
            for res in fb_results:
                if isinstance(res, dict) and res.get("wikiTitle"):
                    wt = res["wikiTitle"]
                    if wt not in seen_titles:
                        seen_titles.add(wt)
                        valid_candidates.append(res)
        except Exception:
            pass

    # 6. Score and sort candidates
    def score_candidate(cand: Dict[str, Any]) -> int:
        score = 0
        cand_title = cand.get("wikiTitle", "").lower()
        cand_desc = cand.get("description", "").lower()
        cand_extract = cand.get("extract", "").lower()
        q_lower = clean.lower()

        # Heavily penalize hits that don't match the query entity in title or extract
        if q_lower not in cand_title and not is_title_relevant(cand_title, q_lower) and q_lower not in cand_extract:
            score -= 200

        # Penalize generic given name / disambiguation / surname pages when query might be a specific entity
        if any(term in cand_desc for term in ["given name", "name list", "disambiguation", "surname"]):
            score -= 80

        if q_lower == cand_title:
            score += 80
        elif is_title_relevant(cand_title, q_lower):
            score += 70
        elif q_lower in cand_title:
            score += 40

        if context_text:
            score += generic_token_overlap(f"{cand_title} {cand_desc} {cand_extract}", context_text) * 20
        if cand.get("imageUrl"):
            score += 10
        return score

    valid_candidates.sort(key=score_candidate, reverse=True)
    return valid_candidates[:limit]


async def enrich_events_with_wikipedia(
    events_data: list,
    lang: str = "en",
    timeline_topic: str = ""
) -> list:
    """
    Given a list of event dictionaries, asynchronously fetch Wikipedia data for all of them.
    Supports any language edition with automatic fallback to English Wikipedia.
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

            context_parts = [timeline_topic, subtitle, lane]
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
                    fallback_lang="en",
                    fallback_title=wiki_key_en or (regular_title if lang == "en" else None)
                )

            # 2. If not found, try regular title
            if not res and regular_title and regular_title != wiki_key:
                res = await fetch_wikipedia_summary(
                    regular_title,
                    client,
                    semaphore,
                    lang=lang,
                    context_text=context_text,
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
                    context_text=context_text
                )

            return res

        tasks = [fetch_for_event(event) for event in events_data]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for i, res in enumerate(results):
            if isinstance(res, dict) and res:
                if not events_data[i].get("imageUrl") and res.get("imageUrl"):
                    events_data[i]["imageUrl"] = res["imageUrl"]
                if not events_data[i].get("wikiUrl") and res.get("wikiUrl"):
                    events_data[i]["wikiUrl"] = res["wikiUrl"]
                if not events_data[i].get("wikiExtract") and res.get("extract"):
                    events_data[i]["wikiExtract"] = res["extract"]
                    events_data[i]["extract"] = res["extract"]
                elif not events_data[i].get("extract") and res.get("extract"):
                    events_data[i]["extract"] = res["extract"]
                if not events_data[i].get("wikiTitle") and res.get("wikiTitle"):
                    events_data[i]["wikiTitle"] = res["wikiTitle"]
                if (events_data[i].get("lat") is None or events_data[i].get("lng") is None) and res.get("lat") is not None and res.get("lng") is not None:
                    events_data[i]["lat"] = res["lat"]
                    events_data[i]["lng"] = res["lng"]

        # Geocoding fallback for events with location_name but without coordinates
        async def geocode_fallback(event: dict):
            if event.get("lat") is not None and event.get("lng") is not None:
                return
            loc = event.get("location_name") or event.get("locationName")
            if not loc or len(loc.strip()) < 2:
                return
            try:
                url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(loc.strip())}&format=json&limit=1"
                resp = await client.get(url, headers=HEADERS, timeout=3.5)
                if resp.status_code == 200:
                    hits = resp.json()
                    if hits and len(hits) > 0:
                        event["lat"] = float(hits[0]["lat"])
                        event["lng"] = float(hits[0]["lon"])
            except Exception:
                pass

        geo_tasks = [
            geocode_fallback(event)
            for event in events_data
            if (event.get("lat") is None or event.get("lng") is None) and (event.get("location_name") or event.get("locationName"))
        ]
        if geo_tasks:
            await asyncio.gather(*geo_tasks, return_exceptions=True)

    return events_data

