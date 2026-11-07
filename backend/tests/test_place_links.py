"""Place links: each unique place of a personal timeline -> its Wikipedia article (no network)."""

import asyncio
import urllib.parse
from typing import Any, Dict, List

from models import TimelineArticle
from services import place_links as pl
from services.book_import import geocode
from services.book_import.reconcile import ReconcileInputs, reconcile
from services.book_import.schemas.artifacts import ChunkPlan, UnitParse
from services.book_import.schemas.draft import BookDraft, DraftPlace
from services.book_import.schemas.model_io import (
    BookMapOutput, DateParts, Evidence, ExtractedEvent, ExtractOutput, MapChapter, MapPlace,
)
from services.book_import.timeline_build import draft_to_timeline

PINSK = (52.11, 26.10)


class FakeResp:
    def __init__(self, body, status=200):
        self.status_code = status
        self._body = body

    def json(self):
        return self._body


class FakeWiki:
    """Answers MediaWiki title queries from `pages[lang][title]` and Wikidata from `entities`."""

    def __init__(self, pages=None, entities=None, redirects=None):
        self.pages: Dict[str, Dict[str, Dict[str, Any]]] = pages or {}
        self.entities: Dict[str, Dict[str, Any]] = entities or {}
        self.redirects: Dict[str, Dict[str, str]] = redirects or {}
        self.urls: List[str] = []

    async def get(self, url, headers=None, timeout=None):
        self.urls.append(url)
        parsed = urllib.parse.urlparse(url)
        q = urllib.parse.parse_qs(parsed.query)
        if parsed.netloc == "www.wikidata.org":
            out = {}
            for qid in q["ids"][0].split("|"):
                out[qid] = self.entities.get(qid, {"id": qid, "missing": ""})
            return FakeResp({"entities": out})
        lang = parsed.netloc.split(".")[0]
        titles = q["titles"][0].split("|")
        redirects = [{"from": t, "to": self.redirects.get(lang, {})[t]} for t in titles if t in self.redirects.get(lang, {})]
        pages = {}
        for n, t in enumerate(titles):
            landed = self.redirects.get(lang, {}).get(t, t)
            page = self.pages.get(lang, {}).get(landed)
            pages[str(-n - 1) if page is None else str(n + 1)] = {"title": landed, **(page or {"missing": ""})}
        return FakeResp({"query": {"redirects": redirects, "pages": pages}})


def _page(lat, lon, qid, disambig=False):
    props = {"wikibase_item": qid}
    if disambig:
        props["disambiguation"] = ""
    return {"coordinates": [{"lat": lat, "lon": lon, "primary": "", "globe": "earth"}], "pageprops": props}


def _entity(qid, **sites):
    return {
        "id": qid,
        "sitelinks": {
            f"{lang}wiki": {"site": f"{lang}wiki", "title": title, "url": f"https://{lang}.wikipedia.org/wiki/{urllib.parse.quote(title)}"}
            for lang, title in sites.items()
        },
        "descriptions": {"en": {"language": "en", "value": "city in Brest Region, Belarus"}},
    }


def _resolve(places, lang="en", names_lang=None, fake=None):
    return asyncio.run(pl.resolve_place_links(places, lang, names_lang=names_lang, client=fake))


# ---------------------------------------------------------------- resolver

def test_osm_wikidata_id_links_in_the_timeline_language():
    fake = FakeWiki(entities={"Q19235": _entity("Q19235", he="פינסק", en="Pinsk")},
                    pages={"he": {"פינסק": _page(52.12, 26.09, "Q19235")}})
    out = _resolve([pl.PlaceQuery(key="pl1", name="Pinsk", qid="Q19235", kind="city", lat=PINSK[0], lng=PINSK[1], verified=True)],
                   lang="he", fake=fake)
    assert out["pl1"]["title"] == "פינסק" and out["pl1"]["lang"] == "he"
    assert out["pl1"]["url"].startswith("https://he.wikipedia.org/wiki/")
    assert out["pl1"]["qid"] == "Q19235"
    # Wikidata, then the location check (one batch per edition); no name search when OSM named the entity.
    assert [urllib.parse.urlparse(u).netloc for u in fake.urls] == ["www.wikidata.org", "he.wikipedia.org", "en.wikipedia.org"]
    assert all("prop=coordinates" in u for u in fake.urls[1:])


def test_a_wrong_osm_id_is_caught_by_the_location_check():
    # The id points at an article with no coordinates (e.g. a year), or at a town far away.
    fake = FakeWiki(entities={"Q1": _entity("Q1", en="1008"), "Q2": _entity("Q2", en="Pinsk, Ohio")},
                    pages={"en": {"1008": {"pageprops": {"wikibase_item": "Q1"}}, "Pinsk, Ohio": _page(40.0, -83.0, "Q2")}})
    out = _resolve([
        pl.PlaceQuery(key="a", name="Pinsk", qid="Q1", kind="city", lat=PINSK[0], lng=PINSK[1], verified=True),
        pl.PlaceQuery(key="b", name="Pinsk", qid="Q2", kind="city", lat=PINSK[0], lng=PINSK[1], verified=True),
    ], fake=fake)
    assert out == {}


def test_coordinates_may_come_from_another_edition_of_the_same_place():
    # Hebrew Wikipedia's "Poland" has no coordinates; the English edition of the same entity does.
    fake = FakeWiki(entities={"Q36": _entity("Q36", he="פולין", en="Poland")},
                    pages={"he": {"פולין": {"pageprops": {"wikibase_item": "Q36"}}}, "en": {"Poland": _page(52.0, 20.0, "Q36")}})
    out = _resolve([pl.PlaceQuery(key="pl", name="Poland", qid="Q36", kind="country", lat=52.1, lng=19.4, verified=True)],
                   lang="he", fake=fake)
    assert out["pl"]["title"] == "פולין" and out["pl"]["lang"] == "he"


def test_falls_back_to_english_when_the_language_has_no_article():
    fake = FakeWiki(entities={"Q1": _entity("Q1", en="Motal")}, pages={"en": {"Motal": _page(52.31, 25.61, "Q1")}})
    out = _resolve([pl.PlaceQuery(key="pl1", name="מוטל", qid="Q1", kind="village", lat=52.31, lng=25.61, verified=True)],
                   lang="he", fake=fake)
    assert out["pl1"]["lang"] == "en" and out["pl1"]["title"] == "Motal"
    assert out["pl1"]["description"] == "city in Brest Region, Belarus"


def test_name_match_needs_nearby_coordinates():
    fake = FakeWiki(
        pages={"en": {"Pinsk": _page(52.12, 26.09, "Q19235"), "Lida": _page(53.89, 25.30, "Q2")}},
        entities={"Q19235": _entity("Q19235", en="Pinsk"), "Q2": _entity("Q2", en="Lida")},
    )
    out = _resolve([
        pl.PlaceQuery(key="near", name="Pinsk", lat=PINSK[0], lng=PINSK[1], kind="city", verified=True),
        # Same name, but the geocoded point is ~400 km away: a different Lida.
        pl.PlaceQuery(key="far", name="Lida", lat=50.45, lng=30.52, kind="village", verified=True),
    ], fake=fake)
    assert set(out) == {"near"}


def test_rejects_disambiguation_pages_and_articles_without_coordinates():
    fake = FakeWiki(pages={"en": {
        "Georgia": _page(42.0, 43.5, "Q230", disambig=True),
        "Somewhere": {"pageprops": {"wikibase_item": "Q3"}},
    }}, entities={"Q230": _entity("Q230", en="Georgia"), "Q3": _entity("Q3", en="Somewhere")})
    out = _resolve([
        pl.PlaceQuery(key="a", name="Georgia", lat=42.0, lng=43.5, kind="country", verified=True),
        pl.PlaceQuery(key="b", name="Somewhere", lat=1.0, lng=1.0, kind="city", verified=True),
    ], fake=fake)
    assert out == {}


def test_name_lookup_follows_redirects_and_tries_english_for_other_languages():
    fake = FakeWiki(
        pages={"en": {"Lviv": _page(49.84, 24.03, "Q36036")}},
        redirects={"en": {"Lemberg": "Lviv"}},
        entities={"Q36036": _entity("Q36036", en="Lviv")},
    )
    out = _resolve([pl.PlaceQuery(key="pl1", name="למברג", alt_names=["Lemberg"], lat=49.84, lng=24.03, kind="city", verified=True)],
                   lang="he", names_lang="he", fake=fake)
    assert out["pl1"]["title"] == "Lviv"


def test_skips_addresses_unverified_points_and_institution_names():
    fake = FakeWiki(pages={"en": {"Herzl St 5": _page(32.0, 34.8, "Q9"), "Technion": _page(32.77, 35.02, "Q10")}},
                    entities={"Q9": _entity("Q9", en="x"), "Q10": _entity("Q10", en="Technion")})
    out = _resolve([
        pl.PlaceQuery(key="addr", name="Herzl St 5", lat=32.0, lng=34.8, kind="address", verified=True, qid="Q9"),
        pl.PlaceQuery(key="guess", name="Herzl St 5", lat=32.0, lng=34.8, kind="city", verified=False),
        pl.PlaceQuery(key="inst", name="Technion", lat=32.77, lng=35.02, kind="institution", verified=True),
    ], fake=fake)
    assert out == {}
    assert fake.urls == []  # nothing was sent anywhere


def test_network_failure_leaves_places_unlinked():
    class Down:
        async def get(self, *a, **k):
            raise OSError("down")

    assert _resolve([pl.PlaceQuery(key="pl1", name="Pinsk", qid="Q19235", lat=PINSK[0], lng=PINSK[1])], fake=Down()) == {}


def test_link_language_codes():
    assert pl.link_langs("he", "he") == ["he", "en"]
    assert pl.link_langs("en-GB", None) == ["en"]
    assert pl.link_langs("auto", "pl") == ["pl", "en"]
    assert pl.wiki_lang("zh-yue") == "zh-yue"


# ---------------------------------------------------------------- geocoding

def test_geocode_keeps_the_osm_wikidata_id(monkeypatch):
    hits = {
        "Pinsk, Belarus": [{"lat": "52.11", "lon": "26.10", "extratags": {"wikidata": "Q19235"}}],
        "Lida, Belarus": [{"lat": "-33.0", "lon": "151.0", "extratags": {"wikidata": "Q99"}}],  # wrong continent
    }

    class R:
        def __init__(self, body):
            self.status_code = 200
            self._b = body

        def json(self):
            return self._b

    async def fake_get(path, params, headers, **kw):
        assert params["extratags"] == 1
        return R(hits.get(params["q"], []))

    from services import wiki_enricher as we
    monkeypatch.setattr(we, "_nominatim_get", fake_get)
    out = asyncio.run(geocode.geocode_places([
        MapPlace(id="a", name="Pinsk", geocode_query="Pinsk, Belarus"),
        MapPlace(id="b", name="Lida", geocode_query="Lida, Belarus", lat=53.9, lng=25.3),
    ]))
    assert out["a"] == (52.11, 26.10, "nominatim", "Q19235")
    assert out["b"] == (53.9, 25.3, "model", None)  # a rejected hit's id is a different place's


# ---------------------------------------------------------------- draft -> timeline

LINK = {"title": "Pinsk", "url": "https://en.wikipedia.org/wiki/Pinsk", "lang": "en", "qid": "Q19235",
        "description": "city in Brest Region, Belarus"}


def test_reconcile_and_build_carry_the_link_to_the_event():
    bm = BookMapOutput(title="t", description="d", overview="o", language="en", narrator_perspective="n",
                       chapters=[MapChapter(id="ch1", title="Life", first_unit=0, last_unit=0)],
                       places=[MapPlace(id="pl1", name="Pinsk", geocode_query="Pinsk, Belarus")])
    ev = ExtractedEvent(local_id="c000-e001", title="Born in Pinsk", evidence=[Evidence(unit=0, quote="q")],
                        start=DateParts(year=1901, precision="year"), place_ids=["pl1"])
    draft = asyncio.run(reconcile(ReconcileInputs(
        import_id="imp", book_map=bm, units=[UnitParse(index=0, source_id="s0", kind="born_digital", label="p1")],
        reads={}, extracts=[(ChunkPlan(id="c000", chapter_id="ch1", units=[0]), ExtractOutput(events=[ev]))],
        place_coords={"pl1": (52.11, 26.10, "nominatim")}, place_links={"pl1": LINK},
    )))
    assert draft.places[0].wiki.url == LINK["url"]
    assert draft.events[0].place.wiki.title == "Pinsk"
    # The draft round-trips through JSON (stored, then edited by the client).
    draft = BookDraft.model_validate(draft.to_json_dict())
    tl = draft_to_timeline(draft, {}, import_id="imp")
    links = tl["articles"][0]["contextLinks"]
    assert links == [{"kind": "place", "name": "Pinsk", **LINK}]


def test_draft_drops_links_that_are_not_wikipedia_articles():
    for bad in ({"title": "x", "url": "javascript:alert(1)"}, {"title": "x", "url": "https://evil.example/wiki/x"}, "junk"):
        assert DraftPlace.model_validate({"name": "Pinsk", "wiki": bad}).wiki is None


def test_saved_timelines_keep_only_valid_context_links():
    art = TimelineArticle.model_validate({"id": "a", "title": "t", "from": {"year": 1900}, "contextLinks": [
        {"kind": "place", **LINK, "name": "Pinsk"},
        {"kind": "place", "title": "x", "url": "https://evil.example/wiki/x"},
        {"kind": "script", "title": "x", "url": "https://en.wikipedia.org/wiki/x"},
        {"kind": "place", "title": "", "url": "https://en.wikipedia.org/wiki/y"},
        {"kind": "place", "title": "q", "url": "https://en.wikipedia.org/wiki/q", "qid": "<b>"},
    ]})
    assert [l["title"] for l in art.contextLinks] == ["Pinsk", "q"]
    assert "qid" not in art.contextLinks[1]
    assert TimelineArticle.model_validate({"id": "a", "title": "t", "from": {"year": 1900}, "contextLinks": "x"}).contextLinks is None


# ---------------------------------------------------------------- pipeline checkpoint

def test_pipeline_resolves_once_and_reuses_the_checkpoint(monkeypatch):
    from types import SimpleNamespace

    from services.book_import import pipeline

    class Store:
        def __init__(self):
            self.data = {}

        async def get_json(self, key):
            return self.data.get(key)

        async def put_json(self, key, value):
            self.data[key] = value

    calls = []

    async def fake_resolve(queries, lang, names_lang=None):
        calls.append((list(queries), lang, names_lang))
        return {"pl1": LINK}

    monkeypatch.setattr(pl, "resolve_place_links", fake_resolve)
    bm = BookMapOutput(title="t", description="d", overview="o", language="he", narrator_perspective="n",
                       places=[MapPlace(id="pl1", name="פינסק", geocode_query="Pinsk, Belarus", kind="city")])
    ctx = SimpleNamespace(
        host=SimpleNamespace(geocode_enabled=True, place_links_enabled=True),
        store=Store(), paths=pipeline.Paths("b/x/imp"), row={"output_language": "en"},
    )
    coords = {"pl1": [52.11, 26.10, "nominatim", "Q19235"]}
    assert asyncio.run(pipeline._place_links(ctx, bm, coords)) == {"pl1": LINK}
    assert asyncio.run(pipeline._place_links(ctx, bm, coords)) == {"pl1": LINK}
    assert len(calls) == 1
    (q,), lang, names_lang = calls[0]
    assert (q.qid, q.verified, q.alt_names, lang, names_lang) == ("Q19235", True, ["Pinsk"], "en", "he")
    # A geocode checkpoint from before this feature (3 values) still works, just without an id.
    ctx.store = Store()
    asyncio.run(pipeline._place_links(ctx, bm, {"pl1": [52.11, 26.10, "nominatim"]}))
    assert calls[-1][0][0].qid is None

    ctx.host.geocode_enabled = False  # no verified points -> nothing to check matches against
    ctx.store = Store()
    assert asyncio.run(pipeline._place_links(ctx, bm, coords)) == {}
