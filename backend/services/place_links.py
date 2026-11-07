"""Wikipedia links for the places of a personal timeline: each unique place -> one article.

Personal events are not Wikipedia articles, but the towns they happen in usually are. Precision
first: a place is linked only when it is certainly the same place.

1. Identity. Every link goes through a Wikidata id (Q-number):
   - OpenStreetMap's own `wikidata` tag on the geocoder hit (the book import asks Nominatim for it), or
   - an exact title (or redirect) lookup by the place's name whose article coordinates lie within a
     radius set by the place kind of the geocoded point; a same-named town elsewhere, a
     disambiguation page or an article without coordinates is rejected.
2. Language. One batched Wikidata call turns the ids into articles: the timeline's language first,
   then English, then the language the place names are written in.
3. Check. Every chosen article's coordinates must lie within that radius of the geocoded point, so a
   wrong OSM tag (or a stale id) never shows up as a link.

Street addresses are never looked up (private, and not what the link is for); institutions are linked
only through the OSM tag. No AI calls: about one Wikidata request per 50 places, one or two
Wikipedia requests per 40 places without an OSM id, and one per 40 links for the check. Failures just
leave places unlinked.
"""

from __future__ import annotations

import logging
import math
import re
import urllib.parse
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from services import wiki_enricher as we

logger = logging.getLogger("ChroniXPlaceLinks")

MAX_PLACES = 150
WIKIDATA_BATCH = 50          # wbgetentities limit
TITLES_BATCH = 40            # MediaWiki allows 50 titles per query
MAX_DESCRIPTION = 200

# How far an article's coordinates may be from the geocoded point, by place kind.
RADIUS_KM = {"village": 15.0, "city": 30.0, "region": 400.0, "country": 1500.0, "institution": 5.0, "other": 15.0}
SKIP_KINDS = frozenset({"address"})
NAME_LOOKUP_KINDS = frozenset(RADIUS_KM) - {"institution"}  # institutions only via OSM (name collisions)

_QID_RE = re.compile(r"^Q[1-9][0-9]{0,11}$")
_WIKI_URL_RE = re.compile(r"^https://[a-z0-9-]{2,24}\.wikipedia\.org/wiki/[^\s<>\"']{1,1500}$")


@dataclass
class PlaceQuery:
    key: str
    name: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    kind: str = "other"
    qid: Optional[str] = None
    alt_names: Sequence[str] = ()
    # True when lat/lng came from the geocoder; a model's guess is not good enough to confirm a name match.
    verified: bool = False
    # Names to try on English Wikipedia, in order (default: the alternative names, then the name).
    english_names: Optional[Sequence[str]] = None


def clean_qid(raw: Any) -> Optional[str]:
    s = str(raw or "").strip().upper()
    return s if _QID_RE.match(s) else None


def is_wikipedia_url(url: Any) -> bool:
    return isinstance(url, str) and bool(_WIKI_URL_RE.match(url))


def clean_link(raw: Any) -> Optional[Dict[str, Any]]:
    """A stored link as the app trusts it (the draft and the timeline accept nothing else)."""
    if not isinstance(raw, dict):
        return None
    url = str(raw.get("url") or "").strip()
    title = str(raw.get("title") or "").strip()[:400]
    if not is_wikipedia_url(url) or not title:
        return None
    out: Dict[str, Any] = {
        "title": title,
        "url": url,
        "lang": we.normalize_wiki_lang(str(raw.get("lang") or ""), default="en"),
    }
    qid = clean_qid(raw.get("qid"))
    if qid:
        out["qid"] = qid
    desc = str(raw.get("description") or "").strip()[:MAX_DESCRIPTION]
    if desc:
        out["description"] = desc
    return out


def _km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(h)))


def _site(lang: str) -> str:
    return lang.replace("-", "_") + "wiki"


async def _get_json(client: Any, url: str) -> Optional[Dict[str, Any]]:
    try:
        resp = await client.get(url, headers=we.HEADERS, timeout=10.0)
    except Exception as e:  # network, throttle wait budget
        logger.info(f"[place_links] request failed: {e}")
        return None
    return we._parse_mediawiki_json(resp)


def _page_coords(page: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    for c in page.get("coordinates") or []:
        if isinstance(c, dict) and c.get("globe") in (None, "", "earth") and "lat" in c and "lon" in c:
            try:
                return float(c["lat"]), float(c["lon"])
            except (TypeError, ValueError):
                continue
    return None


def _near(page: Optional[Dict[str, Any]], place: PlaceQuery) -> bool:
    """The article exists, is not a disambiguation page, and sits close to the place's point."""
    if not isinstance(page, dict) or "missing" in page or "invalid" in page:
        return False
    if "disambiguation" in (page.get("pageprops") or {}):
        return False
    coords = _page_coords(page)
    if coords is None or place.lat is None or place.lng is None:
        return False
    return _km(coords, (place.lat, place.lng)) <= RADIUS_KM.get(place.kind, RADIUS_KM["other"])


def _name_match_qid(page: Optional[Dict[str, Any]], place: PlaceQuery) -> Optional[str]:
    return clean_qid((page.get("pageprops") or {}).get("wikibase_item")) if _near(page, place) else None


async def _query_pages(client: Any, lang: str, titles: List[str], prop: str) -> Dict[str, Optional[Dict[str, Any]]]:
    """{requested title: page} through redirects, batched."""
    pages: Dict[str, Optional[Dict[str, Any]]] = {}
    titles = list(dict.fromkeys(t for t in titles if t and "|" not in t and len(t) <= 255))
    for i in range(0, len(titles), TITLES_BATCH):
        chunk = titles[i:i + TITLES_BATCH]
        url = (
            f"https://{lang}.wikipedia.org/w/api.php?action=query&format=json&redirects=1"
            f"&titles={urllib.parse.quote('|'.join(chunk))}&prop={prop}&colimit=max"
        )
        body = await _get_json(client, url)
        if body and isinstance(body.get("query"), dict):
            pages.update(we._resolve_query_title_map(body["query"], chunk))
    return pages


async def _keep_nearby(
    client: Any,
    links: Dict[str, Dict[str, Any]],
    editions: Dict[str, List[Tuple[str, str]]],
    by_key: Dict[str, PlaceQuery],
) -> Dict[str, Dict[str, Any]]:
    """Drops links whose place is not where the geocoder put it (step 3). Any language edition of the
    entity may carry the coordinates: some wikis leave them out (Hebrew "Poland" has none)."""
    titles_by_lang: Dict[str, List[str]] = {}
    for key in links:
        for lang, title in editions.get(key, []):
            titles_by_lang.setdefault(lang, []).append(title)
    pages: Dict[Tuple[str, str], Optional[Dict[str, Any]]] = {}
    for lang, titles in titles_by_lang.items():
        found = await _query_pages(client, lang, titles, "coordinates|pageprops&ppprop=disambiguation")
        pages.update({(lang, t): pg for t, pg in found.items()})
    return {
        key: link for key, link in links.items()
        if any(_near(pages.get(ed), by_key[key]) for ed in editions.get(key, []))
    }


async def _qids_by_name(client: Any, places: List[PlaceQuery], lang: str, names_of) -> Dict[str, str]:
    """{place key: qid} for places whose name (in `lang`'s Wikipedia) lands on an article close by."""
    wanted: List[Tuple[PlaceQuery, List[str]]] = []
    for p in places:
        names = [n for n in dict.fromkeys(n.strip() for n in names_of(p)) if n and "|" not in n and len(n) <= 200]
        if names:
            wanted.append((p, names))
    titles = [n for _, names in wanted for n in names]
    pages = await _query_pages(client, lang, titles, "coordinates|pageprops&ppprop=disambiguation|wikibase_item")
    out: Dict[str, str] = {}
    for p, names in wanted:
        for n in names:
            qid = _name_match_qid(pages.get(n), p)
            if qid:
                out[p.key] = qid
                break
    return out


async def _articles_for_qids(
    client: Any, qids: Iterable[str], langs: Sequence[str],
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, List[Tuple[str, str]]]]:
    """({qid: link} with the article in the first of `langs` that has one,
    {qid: [(lang, title) of every edition in `langs`]})."""
    ids = list(dict.fromkeys(qids))
    sites = [_site(l) for l in langs]
    out: Dict[str, Dict[str, Any]] = {}
    editions: Dict[str, List[Tuple[str, str]]] = {}
    for i in range(0, len(ids), WIKIDATA_BATCH):
        chunk = ids[i:i + WIKIDATA_BATCH]
        url = (
            "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json"
            f"&ids={'|'.join(chunk)}&props=sitelinks/urls|descriptions"
            f"&sitefilter={urllib.parse.quote('|'.join(sites))}"
            f"&languages={urllib.parse.quote('|'.join(langs))}"
        )
        body = await _get_json(client, url)
        entities = (body or {}).get("entities") or {}
        if not isinstance(entities, dict):
            continue
        for key, ent in entities.items():
            if not isinstance(ent, dict) or "missing" in ent:
                continue
            requested = str(((ent.get("redirects") or {}).get("from")) or key).upper()
            sitelinks = ent.get("sitelinks") or {}
            descriptions = ent.get("descriptions") or {}
            editions[requested] = [
                (lang, sitelinks[site]["title"]) for lang, site in zip(langs, sites)
                if isinstance(sitelinks.get(site), dict) and sitelinks[site].get("title")
            ]
            for lang, site in zip(langs, sites):
                sl = sitelinks.get(site)
                if not isinstance(sl, dict) or not sl.get("title"):
                    continue
                link = clean_link({
                    "title": sl["title"],
                    "url": sl.get("url") or "",
                    "lang": lang,
                    "qid": ent.get("id") or requested,
                    "description": ((descriptions.get(lang) or {}).get("value")) or "",
                })
                if link:
                    out[requested] = link
                break
    return out, editions


def link_langs(*langs: Optional[str]) -> List[str]:
    """Wikipedia editions to try, in order, deduplicated (always ends with English)."""
    out: List[str] = []
    for l in list(langs) + ["en"]:
        code = wiki_lang(l)
        if code and code not in out:
            out.append(code)
    return out


def wiki_lang(raw: Optional[str]) -> str:
    """A Wikipedia edition code from an ISO tag ('he', 'en-GB' -> 'en'), or '' when there is none."""
    s = str(raw or "").strip().lower().replace("_", "-")
    parts = s.split("-")
    if len(parts) == 2 and len(parts[1]) == 2:  # a region tag (en-GB, pt-BR), not an edition (zh-yue)
        s = parts[0]
    return we.normalize_wiki_lang(s, default="")


async def resolve_place_links(
    places: Iterable[PlaceQuery],
    lang: Optional[str],
    *,
    names_lang: Optional[str] = None,
    client: Any = None,
) -> Dict[str, Dict[str, Any]]:
    """{place key: {title, url, lang, qid, description}} for the places that could be linked surely.

    `lang` is the timeline's language (the article language wanted); `names_lang` the language the
    place names are written in (the source's), when different."""
    todo = [p for p in places if p.kind not in SKIP_KINDS and (p.name or "").strip()][:MAX_PLACES]
    if not todo:
        return {}
    langs = link_langs(lang, names_lang)
    names_wiki = wiki_lang(names_lang) or langs[0]

    async def run(c: Any) -> Dict[str, Dict[str, Any]]:
        qid_of: Dict[str, str] = {p.key: q for p in todo if (q := clean_qid(p.qid))}
        by_name = [p for p in todo if p.key not in qid_of and p.verified and p.kind in NAME_LOOKUP_KINDS]
        if by_name:
            # Names as written, in the source's Wikipedia; then the geocoder query's head
            # ("Pinsk, Belarus" -> "Pinsk", usually the modern name) in English.
            qid_of.update(await _qids_by_name(c, by_name, names_wiki, lambda p: [p.name, *p.alt_names]))
            rest = [p for p in by_name if p.key not in qid_of]
            if rest and names_wiki != "en":
                qid_of.update(await _qids_by_name(
                    c, rest, "en", lambda p: list(p.english_names) if p.english_names is not None else [*p.alt_names, p.name],
                ))
        if not qid_of:
            return {}
        articles, editions = await _articles_for_qids(c, qid_of.values(), langs)
        links = {key: articles[q] for key, q in qid_of.items() if q in articles}
        return await _keep_nearby(c, links, {key: editions.get(qid_of[key], []) for key in links}, {p.key: p for p in todo})

    try:
        if client is not None:
            return await run(client)
        async with we.wikimedia_http_client(lane=we.WIKIMEDIA_LANE_BACKGROUND) as c:
            return await run(c)
    except Exception:
        logger.warning("[place_links] resolve failed", exc_info=True)
        return {}
