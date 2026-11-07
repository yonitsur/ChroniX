"""Personal-timeline enrichment: place links, checked historical links, illustrative pictures (no network)."""

import asyncio
import urllib.parse
from typing import Any, Dict, List

from models import TimelineArticle
from services import personal_enrichment as pe
from services.personal_enrichment import EventHistoryRefs, HistoryRef, HistoryRefsOutput, PersonalEvent


class Resp:
    def __init__(self, body, status=200):
        self.status_code = status
        self._body = body

    def json(self):
        return self._body


class FakeWiki:
    """MediaWiki title queries (`pages[lang][title]`, `redirects`), Wikidata entities and SPARQL facts."""

    def __init__(self, pages=None, redirects=None, entities=None, facts=None, sparql_status=200):
        self.pages: Dict[str, Dict[str, Dict[str, Any]]] = pages or {}
        self.redirects: Dict[str, Dict[str, str]] = redirects or {}
        self.entities = entities or {}
        self.facts = facts or {}
        self.sparql_status = sparql_status
        self.urls: List[str] = []

    async def get(self, url, headers=None, timeout=None):
        self.urls.append(url)
        u = urllib.parse.urlparse(url)
        q = urllib.parse.parse_qs(u.query)
        if u.netloc == "query.wikidata.org":
            if self.sparql_status != 200:
                return Resp({}, self.sparql_status)
            rows = []
            for qid, f in self.facts.items():
                if f"wd:{qid} " not in q["query"][0] + " ":
                    continue
                row = {"item": {"value": f"http://www.wikidata.org/entity/{qid}"}}
                for k in ("start", "end"):
                    if f.get(k) is not None:
                        row[k] = {"value": str(f[k])}
                if f.get("person"):
                    row["person"] = {"value": "1"}
                if f.get("place"):
                    row["geo"] = {"value": "123"}
                rows.append(row)
            return Resp({"results": {"bindings": rows}})
        if u.netloc == "www.wikidata.org":
            return Resp({"entities": {qid: self.entities.get(qid, {"id": qid, "missing": ""}) for qid in q["ids"][0].split("|")}})
        lang = u.netloc.split(".")[0]
        titles = q["titles"][0].split("|")
        red = self.redirects.get(lang, {})
        pages = {}
        for n, t in enumerate(titles):
            landed = red.get(t, t)
            page = self.pages.get(lang, {}).get(landed)
            pages[str(n + 1) if page else str(-n - 1)] = {"title": landed, **(page or {"missing": ""})}
        return Resp({"query": {"redirects": [{"from": t, "to": red[t]} for t in titles if t in red], "pages": pages}})


def _page(qid, lat=None, lon=None, disambig=False, image=None):
    p = {"pageprops": {"wikibase_item": qid, **({"disambiguation": ""} if disambig else {})}}
    if lat is not None:
        p["coordinates"] = [{"lat": lat, "lon": lon, "primary": "", "globe": "earth"}]
    if image:
        p["thumbnail"] = {"source": f"https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/{image}/1280px-{image}"}
        p["pageimage"] = image
    return p


def _entity(qid, **titles):
    return {"id": qid, "sitelinks": {f"{l}wiki": {"title": t, "url": f"https://{l}.wikipedia.org/wiki/{urllib.parse.quote(t)}"}
                                     for l, t in titles.items()}, "descriptions": {}}


def _ask(mapping):
    """A fake AI: {event id: [(title_en, name, mentioned)]}."""
    calls = []

    async def ask(system, user):
        calls.append((system, user))
        return HistoryRefsOutput(events=[
            EventHistoryRefs(id=eid, refs=[HistoryRef(title_en=t, name=n, mentioned=m) for t, n, m in refs])
            for eid, refs in mapping.items()
        ])

    ask.calls = calls
    return ask


def _run(events, fake, lang="en", **kw):
    return asyncio.run(pe.enrich_personal_events(events, lang, client=fake, **kw))


HISTORY_FAKE = dict(
    pages={"en": {
        "Third Aliyah": _page("Q1"),
        "Kishinev pogrom": _page("Q2"),
        "World War II": _page("Q3"),
        "Theodor Herzl": _page("Q4"),
        "Pinsk": _page("Q5", 52.1, 26.1),
        "Aliyah": _page("Q6", disambig=True),
        "Bund": _page("Q7"),
    }},
    redirects={"en": {"The Third Aliyah": "Third Aliyah"}},
    entities={q: _entity(q, en=t, he=t + " (he)") for q, t in
              (("Q1", "Third Aliyah"), ("Q2", "Kishinev pogrom"), ("Q3", "World War II"), ("Q7", "Bund"))},
    facts={
        "Q1": {"start": 1919, "end": 1923},
        "Q2": {"start": 1903, "end": 1903},
        "Q3": {"start": 1939, "end": 1945},
        "Q4": {"person": True},
        "Q5": {"start": 1097, "place": True},
        "Q7": {"start": 1897},  # an organization with only an inception
    },
)


# ---------------------------------------------------------------- historical links

def test_history_candidates_must_be_real_dated_and_not_people_or_places():
    events = [
        PersonalEvent(id="e1", title="Emigrated to Palestine", year=1921),
        PersonalEvent(id="e2", title="Born", year=1950),
        PersonalEvent(id="e3", title="Joined the Bund", year=1950),
    ]
    ask = _ask({
        "e1": [("The Third Aliyah", "העלייה השלישית", True), ("Theodor Herzl", "הרצל", False)],
        "e2": [("Kishinev pogrom", "פוגרום קישינב", False), ("Pinsk", "פינסק", True), ("Aliyah", "עלייה", False),
               ("Made-up article", "x", False)],
        "e3": [("Bund", "הבונד", True)],
        "nope": [("World War II", "x", False)],  # an id that isn't an event
    })
    res = _run(events, FakeWiki(**HISTORY_FAKE), lang="he", places=False, history=ask)
    assert [(l["kind"], l["title"], l["name"]) for l in res.links["e1"]] == [("event", "Third Aliyah (he)", "העלייה השלישית")]
    assert res.links["e1"][0]["url"].startswith("https://he.wikipedia.org/wiki/")
    # 1903 pogrom on a 1950 birth: dates don't overlap. Pinsk: a place. Aliyah: disambiguation. Made up: missing.
    assert "e2" not in res.links
    assert [l["title"] for l in res.links["e3"]] == ["Bund (he)"]  # still active: an inception is enough
    assert "Hebrew" in ask.calls[0][0]


def test_one_entity_is_shown_on_a_few_events_only():
    events = [PersonalEvent(id=f"e{i}", title=f"War year {i}", year=1940 + i % 5, rank=5 + (i == 9)) for i in range(12)]
    ask = _ask({f"e{i}": [("World War II", "WWII", i in (3, 7))] for i in range(12)})
    res = _run(events, FakeWiki(**HISTORY_FAKE), places=False, history=ask)
    kept = sorted(res.links)
    assert len(kept) == pe.HISTORY_MAX_EVENTS_PER_ENTITY
    assert {"e3", "e7", "e9"} <= set(kept)  # events that name it, then the most important


def test_history_links_are_dropped_when_wikidata_cannot_be_checked():
    ask = _ask({"e1": [("Third Aliyah", "x", True)]})
    res = _run([PersonalEvent(id="e1", title="t", year=1921)], FakeWiki(**HISTORY_FAKE, sparql_status=503),
               places=False, history=ask)
    assert res.links == {} and res.stats["history_check"] == "unavailable"


def test_a_failing_ai_pass_is_reported_for_refund():
    async def broken(system, user):
        raise RuntimeError("quota")

    res = _run([PersonalEvent(id="e1", title="t", year=1921)], FakeWiki(), places=False, history=broken)
    assert res.links == {} and res.stats["history_failed"] is True


# ---------------------------------------------------------------- places and pictures

def test_studio_places_link_the_most_specific_nearby_part_and_skip_addresses():
    fake = FakeWiki(
        pages={"en": {"Montmartre": _page("Q10", 48.886, 2.343, image="Sacre_Coeur.jpg"),
                      "Haifa": _page("Q11", 32.79, 34.99, image="Haifa_map.svg")}},
        entities={"Q10": _entity("Q10", en="Montmartre"), "Q11": _entity("Q11", en="Haifa")},
    )
    events = [
        PersonalEvent(id="a", title="Paris trip", place="Montmartre, Paris, France", lat=48.887, lng=2.341),
        PersonalEvent(id="b", title="Sunset", place="Montmartre, Paris, France", lat=48.887, lng=2.341, has_image=True),
        PersonalEvent(id="c", title="New flat", place="12 Herzl St, Haifa", lat=32.80, lng=34.99),
        PersonalEvent(id="d", title="No coordinates", place="Paris"),
    ]
    res = _run(events, fake, images=True)
    assert res.links["a"][0]["title"] == "Montmartre" and res.links["b"][0]["title"] == "Montmartre"
    assert res.links["c"][0]["title"] == "Haifa"
    assert "d" not in res.links
    assert not any("Herzl" in urllib.parse.unquote(u) for u in fake.urls)  # house numbers never leave
    # Pictures: only events without a photo, and never maps/flags (svg).
    assert set(res.images) == {"a"}
    assert res.images["a"]["fileUrl"] == "https://commons.wikimedia.org/wiki/File:Sacre_Coeur.jpg"
    assert sum("Montmartre" in u for u in fake.urls if "query" in u and "pageimages" not in u) == 2  # one lookup, one check


def test_existing_place_links_are_kept_and_reused_for_pictures():
    link = {"kind": "place", "name": "Pinsk", "title": "Pinsk", "url": "https://en.wikipedia.org/wiki/Pinsk", "lang": "en", "qid": "Q5"}
    fake = FakeWiki(pages={"en": {"Pinsk": _page("Q5", 52.1, 26.1, image="Pinsk_1912.jpg")}})
    res = _run([PersonalEvent(id="e", title="Born", place="Pinsk", lat=52.1, lng=26.1, place_link=link)], fake, images=True)
    assert "e" not in res.links  # nothing new
    assert res.images["e"]["place"] == "Pinsk"


def test_apply_and_round_trip_through_the_timeline_model():
    res = pe.EnrichmentResult(
        links={"e": [{"kind": "event", "name": "Third Aliyah", "title": "Third Aliyah", "url": "https://en.wikipedia.org/wiki/Third_Aliyah", "lang": "en", "qid": "Q1"}]},
        images={"e": {"url": "https://upload.wikimedia.org/x/Pinsk.jpg", "file": "Pinsk.jpg", "place": "Pinsk",
                      "fileUrl": "https://commons.wikimedia.org/wiki/File:Pinsk.jpg", "article": "https://en.wikipedia.org/wiki/Pinsk"}},
    )
    art = {"id": "e", "title": "Emigrated", "from": {"year": 1921},
           "contextLinks": [{"kind": "place", "title": "Pinsk", "url": "https://en.wikipedia.org/wiki/Pinsk"}]}
    out = pe.apply_to_article(art, res)
    assert [l["kind"] for l in out["contextLinks"]] == ["place", "event"]
    assert out["imageSource"] == "wikimedia" and out["imageIllustrative"]["place"] == "Pinsk"
    assert out["enrichV"] == pe.ENRICH_VERSION
    model = TimelineArticle.model_validate(out)
    assert model.imageIllustrative["fileUrl"].startswith("https://commons.wikimedia.org/wiki/File:")
    assert TimelineArticle.model_validate({**out, "imageIllustrative": {"fileUrl": "javascript:x"}}).imageIllustrative is None
    # An event that already has a cover keeps it.
    kept = pe.apply_to_article({"id": "e", "imageUrl": "https://cdn.example/me.webp"}, res)
    assert kept["imageUrl"] == "https://cdn.example/me.webp" and "imageIllustrative" not in kept


def test_events_from_articles():
    evs = pe.events_from_articles([
        {"id": "a", "title": "T", "subtitle": "S", "extract": "X", "from": {"year": 1921}, "to": {"year": 1923},
         "locationName": "Pinsk", "lat": 52.1, "lng": 26.1, "imageUrl": "u", "rank": 8,
         "contextLinks": [{"kind": "place", "url": "https://en.wikipedia.org/wiki/Pinsk", "title": "Pinsk"}]},
        {"title": "no id"},
    ])
    assert len(evs) == 1
    e = evs[0]
    assert (e.text, e.year, e.to_year, e.has_image, e.rank, e.place_link["title"]) == ("S X", 1921, 1923, True, 8, "Pinsk")


# ---------------------------------------------------------------- the endpoint

def test_endpoint_charges_only_the_history_pass(monkeypatch):
    import main
    from fastapi.testclient import TestClient

    seen = {}

    async def fake_enrich(events, lang, *, places, history, images, client=None):
        seen.update(lang=lang, places=places, history=history is not None, images=images, n=len(events))
        return pe.EnrichmentResult(links={"e1": []}, stats={"events": len(events)})

    async def fake_quota(fn, *a, **kw):
        seen["credits"] = kw.get("credits")
        return ("key", "paid", False)

    monkeypatch.setattr(pe, "enrich_personal_events", fake_enrich)
    monkeypatch.setattr(main, "run_quota", fake_quota)
    main.app.dependency_overrides[main.get_current_user_required] = lambda: {"id": "u1", "email": "u@example.com"}
    try:
        client = TestClient(main.app)
        body = {"events": [{"id": f"e{i}", "title": "t"} for i in range(61)], "lang": "he", "images": True}
        r = client.post("/api/timeline/personal-enrichment", json=body)
        assert r.status_code == 200, r.text
        assert r.json()["credits"] == 2 and seen["credits"] == 2  # 61 events, 60 per credit
        assert seen == {**seen, "lang": "he", "places": True, "history": True, "images": True, "n": 61}
        r = client.post("/api/timeline/personal-enrichment", json={**body, "history": False})
        assert r.json()["credits"] == 0 and seen["history"] is False
        dup = client.post("/api/timeline/personal-enrichment", json={"events": [{"id": "x"}, {"id": "x"}]})
        assert dup.status_code == 400
    finally:
        main.app.dependency_overrides.clear()


def test_a_town_wins_over_its_country_even_when_the_country_article_sits_nearby():
    # Moldova's article coordinates are near its capital: it must not stand in for Chișinău.
    fake = FakeWiki(
        pages={"en": {"Chișinău": _page("Q21197", 47.02, 28.83), "Moldova": _page("Q217", 47.0, 28.9)}},
        entities={"Q21197": _entity("Q21197", en="Chișinău", he="קישינב"), "Q217": _entity("Q217", en="Moldova", he="מולדובה")},
    )
    res = _run([PersonalEvent(id="e", title="Fled", place="Chișinău, Moldova", lat=47.01, lng=28.86)], fake, lang="he")
    assert res.links["e"][0]["title"] == "קישינב"
    assert not any("Moldova" in urllib.parse.unquote(u) for u in fake.urls)
    # A country alone is still linked.
    res = _run([PersonalEvent(id="e", title="Moved", place="Moldova", lat=47.0, lng=28.9)], fake, lang="he")
    assert res.links["e"][0]["title"] == "מולדובה"


def test_pictures_skip_coats_of_arms_and_fall_back_to_the_english_article():
    fake = FakeWiki(
        pages={"he": {"חיפה": _page("Q41621", 32.79, 34.99, image="Coat_of_arms_of_Haifa.png")},
               "en": {"Haifa": {**_page("Q41621", 32.79, 34.99), "thumbnail": {
                   "source": "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/dd/Gardens.jpg/1280px-Gardens.jpg?utm_source=x"},
                   "pageimage": "Gardens.jpg"}}},
        entities={"Q41621": _entity("Q41621", he="חיפה", en="Haifa")},
    )
    res = _run([PersonalEvent(id="e", title="Moved", place="חיפה", lat=32.8, lng=34.99)], fake, lang="he", images=True)
    assert res.links["e"][0]["title"] == "חיפה"
    assert res.images["e"]["url"] == "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Gardens.jpg/1280px-Gardens.jpg"
    assert res.images["e"]["file"] == "Gardens.jpg"
