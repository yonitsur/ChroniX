"""Wikipedia enrichment for personal timelines (documents, photos and Story Studio templates alike).

Personal events are not Wikipedia articles, so the general timeline enrichment (one article per
event) does not apply. What does: links to the things an event mentions, each one checked.

- Places (no AI): the event's place -> its article (services/place_links.py), checked against the
  event's coordinates. Book imports already have these from the geocoding step.
- Historical events (one text-only AI pass): public events, periods, movements and organizations an
  event mentions or clearly happens against ("Third Aliyah", "Kishinev pogrom"). The model only
  names candidates; each must be an exact English Wikipedia title (or redirect), not a
  disambiguation page, not a person or a place, and its Wikidata dates must overlap the event's
  years. A wrong guess is dropped, never shown. One entity is shown on at most a few events.
- Illustrative pictures (no AI, opt-in): for events without a photo, the free lead image of the
  place's article, marked as illustrative so it never passes for the family's own photo.

`enrich_personal_events` returns per-event results; callers apply them (the book import on the
server, the app for Studio timelines through /api/timeline/personal-enrichment).
"""

from __future__ import annotations

import asyncio
import logging
import re
import urllib.parse
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from pydantic import BaseModel, Field

from services import place_links as pl
from services import wiki_enricher as we

logger = logging.getLogger("ChroniXEnrichment")

HISTORY_BATCH = 120               # events per AI call
HISTORY_MAX_REFS_PER_EVENT = 2
HISTORY_MAX_EVENTS_PER_ENTITY = 6  # "World War II" on 40 events is noise: keep the clearest few
HISTORY_YEAR_SLACK = 10           # an emigration in 1921 may still be "after the Balfour Declaration"
HISTORY_MAX_ENTITIES = 120
SPARQL_BATCH = 60
EVENT_TEXT_CHARS = 600
IMAGE_THUMB_PX = 1280
_DIGITS_RE = re.compile(r"\d")
_UPLOAD_URL_RE = re.compile(r"^https://upload\.wikimedia\.org/[^\s<>\"']{1,1500}$")


# ---------------------------------------------------------------- input / output

@dataclass
class PersonalEvent:
    id: str
    title: str
    text: str = ""                  # summary / story, any length (trimmed for the model)
    year: Optional[int] = None
    to_year: Optional[int] = None
    place: str = ""
    lat: Optional[float] = None
    lng: Optional[float] = None
    has_image: bool = False
    place_link: Optional[Dict[str, Any]] = None  # already linked (book import)
    rank: int = 5


@dataclass
class EnrichmentResult:
    links: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)   # event id -> contextLinks
    images: Dict[str, Dict[str, Any]] = field(default_factory=dict)        # event id -> illustrative image
    stats: Dict[str, Any] = field(default_factory=dict)


class HistoryRef(BaseModel):
    title_en: str = Field(description="Exact title of the English Wikipedia article, e.g. 'Kishinev pogrom', 'Third Aliyah'.")
    name: str = Field(description="Its usual short name in the timeline's language.")
    mentioned: bool = Field(default=False, description="True when the event's own text names it (not only the backdrop).")


class EventHistoryRefs(BaseModel):
    id: str = Field(description="The event id exactly as given.")
    refs: List[HistoryRef] = Field(default_factory=list)


class HistoryRefsOutput(BaseModel):
    events: List[EventHistoryRefs] = Field(default_factory=list)


HISTORY_SYSTEM = """You link a personal (family) timeline to public history.

For each event below, name AT MOST 2 public historical events, periods, movements or organizations
that the event's text mentions, or that it clearly and directly happens because of (a family flees
because of a named pogrom; a man is drafted into a named war; a couple emigrates with the Third
Aliyah). They must have their own English Wikipedia article.

Rules:
- `title_en`: the exact English Wikipedia article title. If you are not sure the article exists
  under that title, leave it out.
- Never people (no famous or private persons), never places (towns, countries, streets, buildings),
  never families, never generic topics ("Immigration", "Judaism", "Wedding").
- Only what this specific event is about. Most events (births, weddings, jobs, trips) have no
  historical reference: return an empty list for them. Do not attach a long war to every event that
  happens during it; only to the events the war directly shapes.
- `name`: the reference's usual name in {lang_name}.
- `mentioned`: true only when the event's text names it.
- Return only events that have at least one reference, with their ids exactly as given."""


# ---------------------------------------------------------------- places

def _place_parts(place: str) -> List[str]:
    """'Montmartre, Paris, France' -> ['Montmartre', 'Paris']: most specific first. The last part
    (usually the country) only counts when it is the only one: a country's article sits near its
    capital, so it would pass the distance check for any place there. Parts with digits (house
    numbers, postcodes) are never sent anywhere."""
    parts = [p.strip() for p in (place or "").split(",") if p.strip() and not _DIGITS_RE.search(p)]
    if len(parts) > 1:
        parts = parts[:-1]
    return parts[:3]


def _place_key(ev: PersonalEvent) -> Optional[str]:
    if ev.lat is None or ev.lng is None or not _place_parts(ev.place):
        return None
    return f"{ev.place.strip().lower()}|{round(ev.lat, 2)}|{round(ev.lng, 2)}"


async def _event_place_links(client: Any, events: Sequence[PersonalEvent], lang: str) -> Dict[str, Dict[str, Any]]:
    """{event id: place link} for events with a place and coordinates but no link yet."""
    groups: Dict[str, List[PersonalEvent]] = {}
    for ev in events:
        if ev.place_link:
            continue
        key = _place_key(ev)
        if key:
            groups.setdefault(key, []).append(ev)
    if not groups:
        return {}
    queries = []
    for key, evs in groups.items():
        parts = _place_parts(evs[0].place)
        # The most specific named part that is close by wins (a landmark, else the town).
        queries.append(pl.PlaceQuery(key=key, name=parts[0], alt_names=parts[1:], english_names=parts,
                                     lat=evs[0].lat, lng=evs[0].lng, kind="city", verified=True))
    links = await pl.resolve_place_links(queries, lang, names_lang=lang, client=client)
    out: Dict[str, Dict[str, Any]] = {}
    for key, link in links.items():
        for ev in groups[key]:
            out[ev.id] = {"kind": "place", "name": _place_parts(ev.place)[0], **link}
    return out


# ---------------------------------------------------------------- historical events

def _event_line(ev: PersonalEvent) -> str:
    when = f"{ev.year}" if ev.year is not None else "?"
    if ev.to_year is not None and ev.to_year != ev.year:
        when += f"-{ev.to_year}"
    text = re.sub(r"\s+", " ", ev.text or "").strip()[:EVENT_TEXT_CHARS]
    place = f" @ {ev.place.strip()[:120]}" if ev.place else ""
    return f"[{ev.id}] {when}{place} | {ev.title.strip()[:200]}" + (f" | {text}" if text else "")


HistoryAsk = Callable[[str, str], Awaitable[Any]]  # (system_instruction, user_text) -> HistoryRefsOutput


async def _ask_history(ask: HistoryAsk, events: Sequence[PersonalEvent], lang: str) -> Dict[str, List[HistoryRef]]:
    lang_name = _LANG_NAMES.get(pl.wiki_lang(lang) or "en", lang or "English")
    system = HISTORY_SYSTEM.replace("{lang_name}", lang_name)
    batches = [list(events[i:i + HISTORY_BATCH]) for i in range(0, len(events), HISTORY_BATCH)]
    sem = asyncio.Semaphore(4)
    valid = {ev.id for ev in events}
    failed: List[str] = []

    async def one(batch: List[PersonalEvent]) -> Dict[str, List[HistoryRef]]:
        async with sem:
            user = f"{len(batch)} events (id, years, place, title, text):\n" + "\n".join(_event_line(e) for e in batch)
            try:
                out = await ask(system, user)
            except Exception as e:
                logger.info(f"[enrichment] history pass failed: {e}")
                failed.append(str(e)[:200])
                return {}
        if isinstance(out, dict):
            try:
                out = HistoryRefsOutput.model_validate(out)
            except Exception:
                return {}
        if not isinstance(out, HistoryRefsOutput):
            return {}
        found: Dict[str, List[HistoryRef]] = {}
        for item in out.events:
            if item.id not in valid:
                continue
            refs = [r for r in item.refs if (r.title_en or "").strip()][:HISTORY_MAX_REFS_PER_EVENT]
            if refs:
                found[item.id] = refs
        return found

    merged: Dict[str, List[HistoryRef]] = {}
    for part in await asyncio.gather(*(one(b) for b in batches)):
        merged.update(part)
    if failed and len(failed) == len(batches):
        raise HistoryPassFailed(failed[0])
    return merged


class HistoryPassFailed(Exception):
    """Every AI call of the historical pass failed (the caller refunds it)."""


async def _entity_facts(client: Any, qids: Sequence[str]) -> Optional[Dict[str, Dict[str, Any]]]:
    """{qid: {start, end, person, place}} from the Wikidata Query Service; None when it can't answer
    (the caller then drops every historical link: precision first)."""
    out: Dict[str, Dict[str, Any]] = {}
    for i in range(0, len(qids), SPARQL_BATCH):
        chunk = [q for q in qids[i:i + SPARQL_BATCH] if pl.clean_qid(q)]
        if not chunk:
            continue
        values = " ".join(f"wd:{q}" for q in chunk)
        query = f"""SELECT ?item (MIN(YEAR(?s)) AS ?start) (MAX(YEAR(?e)) AS ?end) (SAMPLE(?h) AS ?person) (SAMPLE(?g) AS ?geo) WHERE {{
  VALUES ?item {{ {values} }}
  OPTIONAL {{ ?item wdt:P580|wdt:P585|wdt:P571 ?s }}
  OPTIONAL {{ ?item wdt:P582|wdt:P585|wdt:P576 ?e }}
  OPTIONAL {{ ?item wdt:P31 wd:Q5 . BIND(1 AS ?h) }}
  OPTIONAL {{ ?item wdt:P1566 ?g }}
}} GROUP BY ?item"""
        url = "https://query.wikidata.org/sparql?format=json&query=" + urllib.parse.quote(query)
        try:
            resp = await client.get(url, headers={**we.HEADERS, "Accept": "application/sparql-results+json"}, timeout=20.0)
            if getattr(resp, "status_code", None) != 200:
                return None
            rows = ((resp.json() or {}).get("results") or {}).get("bindings") or []
        except Exception as e:
            logger.info(f"[enrichment] Wikidata query failed: {e}")
            return None
        for row in rows:
            qid = str(((row.get("item") or {}).get("value") or "")).rsplit("/", 1)[-1]
            if not pl.clean_qid(qid):
                continue

            def year(k: str) -> Optional[int]:
                try:
                    return int(float((row.get(k) or {}).get("value")))
                except (TypeError, ValueError):
                    return None

            out[qid] = {
                "start": year("start"),
                "end": year("end"),
                "person": bool(row.get("person")),
                "place": bool(row.get("geo")),  # has a GeoNames id: a settlement, country, region...
            }
    return out


def _overlaps(facts: Dict[str, Any], ev: PersonalEvent) -> bool:
    start, end = facts.get("start"), facts.get("end")
    if start is None and end is None:
        return True  # undated movements/organizations: the exact title already matched
    if ev.year is None:
        return False
    lo, hi = ev.year, ev.to_year if ev.to_year is not None else ev.year
    first = start if start is not None else end
    last = end if end is not None else 10 ** 6  # still active (an organization with only an inception)
    return lo <= last + HISTORY_YEAR_SLACK and hi >= first - HISTORY_YEAR_SLACK


async def _history_links(
    client: Any,
    ask: HistoryAsk,
    events: Sequence[PersonalEvent],
    lang: str,
    stats: Dict[str, Any],
) -> Dict[str, List[Dict[str, Any]]]:
    try:
        refs = await _ask_history(ask, events, lang)
    except HistoryPassFailed:
        stats["history_failed"] = True
        return {}
    stats["history_candidates"] = sum(len(v) for v in refs.values())
    if not refs:
        return {}
    titles = list(dict.fromkeys(r.title_en.strip() for rs in refs.values() for r in rs))[: HISTORY_MAX_ENTITIES * 2]
    pages = await pl._query_pages(client, "en", titles, "pageprops&ppprop=disambiguation|wikibase_item")
    qid_of_title: Dict[str, str] = {}
    for t in titles:
        page = pages.get(t)
        if not isinstance(page, dict) or "missing" in page or "invalid" in page:
            continue
        props = page.get("pageprops") or {}
        qid = pl.clean_qid(props.get("wikibase_item"))
        if qid and "disambiguation" not in props:
            qid_of_title[t] = qid
    if not qid_of_title:
        return {}
    qids = list(dict.fromkeys(qid_of_title.values()))[:HISTORY_MAX_ENTITIES]
    facts = await _entity_facts(client, qids)
    if facts is None:
        stats["history_check"] = "unavailable"
        return {}
    by_id = {ev.id: ev for ev in events}

    # (qid -> [(event, ref)]) for the candidates that pass every check.
    hits: Dict[str, List[Tuple[PersonalEvent, HistoryRef]]] = {}
    for eid, rs in refs.items():
        ev = by_id[eid]
        place_qid = (ev.place_link or {}).get("qid")
        for r in rs:
            qid = qid_of_title.get(r.title_en.strip())
            f = facts.get(qid or "")
            if not qid or f is None or f["person"] or f["place"] or qid == place_qid or not _overlaps(f, ev):
                continue
            if any(e.id == eid for e, _ in hits.get(qid, [])):
                continue
            hits.setdefault(qid, []).append((ev, r))
    if not hits:
        return {}
    langs = pl.link_langs(lang)
    articles, _ = await pl._articles_for_qids(client, hits.keys(), langs)
    out: Dict[str, List[Dict[str, Any]]] = {}
    for qid, pairs in hits.items():
        link = articles.get(qid)
        if not link:
            continue
        # Events that name it first, then the most important ones.
        pairs.sort(key=lambda p: (not p[1].mentioned, -(p[0].rank or 5), p[0].year or 0))
        for ev, r in pairs[:HISTORY_MAX_EVENTS_PER_ENTITY]:
            name = (r.name or "").strip()[:200] or link["title"]
            out.setdefault(ev.id, []).append({"kind": "event", "name": name, **link})
    stats["history_links"] = sum(len(v) for v in out.values())
    return out


# ---------------------------------------------------------------- illustrative pictures

def _usable_image(page: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The page's free lead image as {url, file, fileUrl}, unless it is a map, flag or coat of arms."""
    raw = str(((page or {}).get("thumbnail") or {}).get("source") or "")
    # Same normalization as the general enrichment: the thumb host serves the same paths.
    thumb = raw.replace("https://thumb.wikimedia.org/", "https://upload.wikimedia.org/").split("?")[0]
    name = str((page or {}).get("pageimage") or "").strip()
    lowered = name.lower()
    if not _UPLOAD_URL_RE.match(thumb) or not name or lowered.endswith((".svg", ".gif")):
        return None
    if any(w in lowered for w in ("coat_of_arms", "flag_of", "locator", "location_map", "_map.", "emblem", "seal_of")):
        return None
    return {
        "url": thumb,
        "file": name[:300],
        "fileUrl": "https://commons.wikimedia.org/wiki/File:" + urllib.parse.quote(name.replace(" ", "_")),
    }


_PAGEIMAGE_PROP = f"pageimages&piprop=thumbnail|name&pithumbsize={IMAGE_THUMB_PX}&pilicense=free&pilimit=50"


async def _place_images(client: Any, links: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """{article url: {url, fileUrl, file}}: the free lead image of each place article, else of the
    English article about the same place (a Hebrew town page often leads with its coat of arms)."""
    links = list(links)
    by_lang: Dict[str, List[Dict[str, Any]]] = {}
    for link in links:
        by_lang.setdefault(link["lang"], []).append(link)
    out: Dict[str, Dict[str, Any]] = {}
    for lang, items in by_lang.items():
        pages = await pl._query_pages(client, lang, list(dict.fromkeys(l["title"] for l in items)), _PAGEIMAGE_PROP)
        for l in items:
            pic = _usable_image(pages.get(l["title"]) or {})
            if pic:
                out[l["url"]] = pic
    missing = [l for l in links if l["url"] not in out and l["lang"] != "en" and pl.clean_qid(l.get("qid"))]
    if missing:
        en_articles, _ = await pl._articles_for_qids(client, [l["qid"] for l in missing], ["en"])
        en_titles = {l["url"]: en_articles[l["qid"]]["title"] for l in missing if l["qid"] in en_articles}
        if en_titles:
            pages = await pl._query_pages(client, "en", list(dict.fromkeys(en_titles.values())), _PAGEIMAGE_PROP)
            for url, title in en_titles.items():
                pic = _usable_image(pages.get(title) or {})
                if pic:
                    out[url] = pic
    return out


# ---------------------------------------------------------------- entry point

async def enrich_personal_events(
    events: Sequence[PersonalEvent],
    lang: Optional[str],
    *,
    places: bool = True,
    history: Optional[HistoryAsk] = None,
    images: bool = False,
    client: Any = None,
) -> EnrichmentResult:
    """Links (and optionally pictures) for `events`. `history` is the AI call for the historical
    pass (None skips it). Never raises: whatever fails is left out."""
    res = EnrichmentResult(stats={"events": len(events)})
    lang = pl.wiki_lang(lang) or "en"

    async def run(c: Any) -> None:
        place_of: Dict[str, Dict[str, Any]] = {ev.id: ev.place_link for ev in events if ev.place_link}
        if places:
            try:
                new_places = await _event_place_links(c, events, lang)
            except Exception:
                logger.warning("[enrichment] place links failed", exc_info=True)
                new_places = {}
            place_of.update(new_places)
            for eid, link in new_places.items():
                res.links.setdefault(eid, []).append(link)
            res.stats["place_links"] = len(new_places)
        if history is not None:
            evs = [ev if ev.id not in place_of else _with_place(ev, place_of[ev.id]) for ev in events]
            try:
                for eid, links in (await _history_links(c, history, evs, lang, res.stats)).items():
                    res.links.setdefault(eid, []).extend(links)
            except Exception:
                logger.warning("[enrichment] history links failed", exc_info=True)
        if images:
            wanted = {ev.id: place_of[ev.id] for ev in events if not ev.has_image and ev.id in place_of}
            try:
                pics = await _place_images(c, {l["url"]: l for l in wanted.values()}.values()) if wanted else {}
            except Exception:
                logger.warning("[enrichment] place pictures failed", exc_info=True)
                pics = {}
            for eid, link in wanted.items():
                pic = pics.get(link["url"])
                if pic:
                    res.images[eid] = {**pic, "place": link.get("name") or link["title"], "article": link["url"]}
            res.stats["images"] = len(res.images)

    try:
        if client is not None:
            await run(client)
        else:
            async with we.wikimedia_http_client(lane=we.WIKIMEDIA_LANE_BACKGROUND) as c:
                await run(c)
    except Exception:
        logger.warning("[enrichment] failed", exc_info=True)
    return res


def _with_place(ev: PersonalEvent, link: Dict[str, Any]) -> PersonalEvent:
    if ev.place_link:
        return ev
    return PersonalEvent(**{**ev.__dict__, "place_link": link})


def structured_history_ask(
    *,
    api_key: Optional[str],
    models: Sequence[str],
    call: Optional[Callable[..., Awaitable[Any]]] = None,
    meter: Any = None,
    limiter: Any = None,
) -> HistoryAsk:
    """The historical pass as one schema-constrained Gemini call (book-import retry policy)."""
    from google.genai import types

    from services.book_import.gemini_calls import call_structured

    fn = call or call_structured

    async def ask(system: str, user: str) -> Any:
        return await fn(
            api_key=api_key, schema=HistoryRefsOutput, parts=[types.Part.from_text(text=user)],
            system_instruction=system, models=list(models), thinking_budget=0, temperature=0.1,
            max_output_tokens=16384, limiter=limiter, meter=meter, label="history_links",
        )

    return ask


# ---------------------------------------------------------------- applying results to articles

def apply_to_article(art: Dict[str, Any], result: EnrichmentResult) -> Dict[str, Any]:
    """Adds an event's new links (and illustrative picture) to a timeline article dict."""
    eid = str(art.get("id"))
    new_links = result.links.get(eid) or []
    if new_links:
        existing = [l for l in (art.get("contextLinks") or []) if isinstance(l, dict)]
        seen = {l.get("url") for l in existing}
        art["contextLinks"] = existing + [l for l in new_links if l.get("url") not in seen]
    pic = result.images.get(eid)
    if pic and not art.get("imageUrl"):
        art["imageUrl"] = pic["url"]
        art["imageSource"] = "wikimedia"
        art["mediaType"] = "image"
        art["imageIllustrative"] = {"url": pic["url"], "place": pic["place"][:200], "file": pic["file"], "fileUrl": pic["fileUrl"]}
    art["enrichV"] = ENRICH_VERSION
    return art


ENRICH_VERSION = 1


def events_from_articles(articles: Sequence[Dict[str, Any]]) -> List[PersonalEvent]:
    out = []
    for a in articles:
        if not isinstance(a, dict) or not a.get("id"):
            continue
        frm, to = a.get("from") or {}, a.get("to") or {}
        place_link = next((l for l in (a.get("contextLinks") or []) if isinstance(l, dict) and l.get("kind") == "place"), None)
        out.append(PersonalEvent(
            id=str(a["id"]),
            title=str(a.get("title") or ""),
            text=" ".join(str(a.get(k) or "") for k in ("subtitle", "extract")).strip(),
            year=frm.get("year") if isinstance(frm.get("year"), int) else None,
            to_year=to.get("year") if isinstance(to, dict) and isinstance(to.get("year"), int) else None,
            place=str(a.get("locationName") or ""),
            lat=a.get("lat") if isinstance(a.get("lat"), (int, float)) else None,
            lng=a.get("lng") if isinstance(a.get("lng"), (int, float)) else None,
            has_image=bool(a.get("imageUrl")),
            place_link=place_link,
            rank=int(a.get("rank") or 5) if str(a.get("rank") or "5").isdigit() else 5,
        ))
    return out


_LANG_NAMES = {
    "en": "English", "he": "Hebrew", "ar": "Arabic", "ru": "Russian", "fr": "French", "de": "German",
    "es": "Spanish", "it": "Italian", "pt": "Portuguese", "pl": "Polish", "uk": "Ukrainian", "yi": "Yiddish",
    "nl": "Dutch", "hu": "Hungarian", "ro": "Romanian", "cs": "Czech", "tr": "Turkish", "fa": "Persian",
    "zh": "Chinese", "ja": "Japanese", "ko": "Korean",
}
