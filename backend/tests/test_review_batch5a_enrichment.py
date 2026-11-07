"""P-03 / P-13 / SC-04: adjudicator and GIF gating, per-call repair counting, Wikimedia priority
lanes, batched Wikidata P18 and the overlapped image prewarm."""
import asyncio
import urllib.parse

import httpx
import pytest

from services import wiki_enricher
from services.wiki_enricher import _PriorityGate, _WikimediaPoliteTransport


@pytest.fixture
def isolated_wiki_caches():
    caches = (
        wiki_enricher._RAW_SUMMARY_CACHE, wiki_enricher._SEARCH_CACHE, wiki_enricher._LANGLINK_CACHE,
        wiki_enricher._PROBE_CACHE, wiki_enricher._COMMONS_GIF_CACHE, wiki_enricher._WIKIDATA_IMAGE_CACHE,
        wiki_enricher._COMMONS_FALLBACK_CACHE, wiki_enricher._PAGE_IMAGES_RAW_CACHE,
        wiki_enricher._FILE_IMAGEINFO_CACHE, wiki_enricher._ARTICLE_IMAGES_CACHE,
    )
    for c in caches:
        c.clear()
    yield
    for c in caches:
        c.clear()


def _img(name, caption="", lead=False, animated=False):
    return {
        "url": f"https://upload.wikimedia.org/wikipedia/commons/a/aa/{name}",
        "filename": name, "caption": caption, "width": 800,
        "mime": "image/gif" if animated else "image/jpeg", "isLead": lead,
        "source": "article", "key": name.lower(), "is_animated": animated, "frame_count": 8 if animated else 1,
    }


# --- adjudicator gating (P-03) ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_adjudicator_skips_clear_events_and_only_sends_ambiguous_ones(monkeypatch):
    sent = {}

    async def fake_adjudicator(payload, api_key, preferred_model=None):
        sent["events"] = [e["event_index"] for e in payload["events"]]
        return {"decisions": []}

    monkeypatch.setattr(wiki_enricher, "_call_gemini_adjudicator_json", fake_adjudicator)
    clear_res = {
        "wikiTitle": "Apollo 11", "lang": "en", "_resolution_mode": "direct",
        "description": "1969 crewed lunar landing mission",
        "extract": "Apollo 11 was the American spaceflight that first landed humans on the Moon in 1969.",
    }
    events = [
        # 0: direct match, one clearly-best image (gap > 25), dated -> previously always checked
        {"title": "Apollo 11 Moon landing", "subtitle": "Humans land on the Moon", "wikipedia_title": "Apollo 11", "from": {"year": 1969}},
        # 1: resolved through search -> real ambiguity
        {"title": "Saturn V first launch", "subtitle": "Rocket test", "wikipedia_title": "Saturn V", "from": {"year": 1967}},
        # 2: close image scores -> real ambiguity
        {"title": "Apollo 11 Moon landing", "subtitle": "Humans land on the Moon", "wikipedia_title": "Apollo 11", "from": {"year": 1969}},
    ]
    results = [
        {"res": dict(clear_res), "article_candidates": [], "candidates": [
            _img("Apollo_11_Moon_landing_Aldrin.jpg", "Apollo 11 Moon landing", lead=True),
            _img("Generic_rocket.jpg", "rocket"),
        ], "image_context": "Apollo 11 Moon landing Apollo 11 1969", "anchors": ["Apollo 11"], "event_year": 1969},
        {"res": {"wikiTitle": "Saturn V", "lang": "en", "_resolution_mode": "search",
                 "description": "American rocket", "extract": "Saturn V was a rocket used for launch from 1967."},
         "article_candidates": [{"wikiTitle": "Saturn V", "lang": "en"}], "candidates": [],
         "image_context": "Saturn V", "anchors": ["Saturn V"], "event_year": 1967},
        {"res": dict(clear_res), "article_candidates": [], "candidates": [
            _img("Apollo_11_landing_a.jpg", "Apollo 11 Moon landing"),
            _img("Apollo_11_landing_b.jpg", "Apollo 11 Moon landing"),
        ], "image_context": "Apollo 11 Moon landing Apollo 11 1969", "anchors": ["Apollo 11"], "event_year": 1969},
    ]
    ranked0 = wiki_enricher._rank_image_candidates(results[0]["candidates"], results[0]["image_context"], ["Apollo 11"])
    assert ranked0[0]["score"] - ranked0[1]["score"] > 25  # precondition: a clear winner

    await wiki_enricher._llm_adjudicate_enrichment(
        events_data=events, results=results, client=None, semaphore=asyncio.Semaphore(4),
        lang="en", timeline_topic="Space race", api_key="k",
    )
    assert sent["events"] == [1, 2]


@pytest.mark.asyncio
async def test_adjudicator_not_called_when_nothing_is_ambiguous(monkeypatch):
    calls = []

    async def fake_adjudicator(payload, api_key, preferred_model=None):
        calls.append(payload)
        return {"decisions": []}

    monkeypatch.setattr(wiki_enricher, "_call_gemini_adjudicator_json", fake_adjudicator)
    events = [{"title": "Apollo 11 Moon landing", "subtitle": "Humans land on the Moon", "wikipedia_title": "Apollo 11", "from": {"year": 1969}}]
    results = [{"res": {"wikiTitle": "Apollo 11", "lang": "en", "_resolution_mode": "direct",
                        "description": "1969 lunar landing", "extract": "Apollo 11 landed humans on the Moon in 1969."},
                "article_candidates": [], "candidates": [_img("Apollo_11_Moon_landing.jpg", "Apollo 11 Moon landing", lead=True)],
                "image_context": "Apollo 11 Moon landing 1969", "anchors": ["Apollo 11"], "event_year": 1969}]
    await wiki_enricher._llm_adjudicate_enrichment(
        events_data=events, results=results, client=None, semaphore=asyncio.Semaphore(4), api_key="k",
    )
    assert calls == []


@pytest.mark.asyncio
async def test_adjudicator_single_attempt_within_budget_and_cheap_model(monkeypatch):
    from types import SimpleNamespace
    from google import genai

    called = []

    class SlowModels:
        async def generate_content(self, *, model, contents, config):
            called.append(model)
            await asyncio.sleep(5)

    class FakeClient:
        def __init__(self, api_key=None):
            self.aio = SimpleNamespace(models=SlowModels())

    monkeypatch.setattr(genai, "Client", FakeClient)
    monkeypatch.setenv("ADJUDICATOR_TIMEOUT_SEC", "1")
    monkeypatch.setenv("ADJUDICATOR_MODEL", "gemini-test-flash-lite")
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    res = await wiki_enricher._call_gemini_adjudicator_json({"events": [{"event_index": 0}]}, api_key="k")
    assert res is None
    assert called == ["gemini-test-flash-lite"]  # one model, one attempt
    assert loop.time() - t0 < 2.5

    monkeypatch.delenv("ADJUDICATOR_MODEL")
    monkeypatch.delenv("GEMINI_ADJUDICATOR_MODEL", raising=False)
    monkeypatch.setenv("GEMINI_MODEL", "gemini-9-flash-lite")
    assert wiki_enricher._adjudicator_model() == "gemini-9-flash-lite"  # a configured flash-lite wins
    monkeypatch.delenv("GEMINI_MODEL")
    assert wiki_enricher._adjudicator_model() == "gemini-3.6-flash"


# --- GIF gating (P-03 / SC-04) ----------------------------------------------------------------

def test_gif_search_mode_for_event(monkeypatch):
    monkeypatch.delenv("WIKI_GIF_SEARCH", raising=False)
    f = wiki_enricher._gif_search_mode_for_event
    assert f({"title": "Treaty of Versailles", "category": "Diplomacy"}, "World War I", "classic") == "auto"
    assert f({"title": "Treaty of Versailles"}, "World War I", "kids") == "always"
    assert f({"title": "Discovery of DNA structure", "category": "Biology"}, "History of genetics", "classic") == "always"
    monkeypatch.setenv("WIKI_GIF_SEARCH", "off")
    assert f({"title": "Plate tectonics"}, "Geology", "kids") == "off"


def _image_handler(stats, files_per_article):
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        params = dict(urllib.parse.parse_qsl(request.url.query.decode("utf-8")))
        if "filemime" in url:
            stats["gif"] += 1
            return httpx.Response(200, json={"query": {"pages": {}}})
        if "list=search" in url or "generator=search" in url:
            stats["commons_search"] += 1
            return httpx.Response(200, json={"query": {"pages": {}}})
        if "prop" in params and "pageimages" in params["prop"]:
            title = params["titles"]
            slug = title.replace(" ", "_")
            return httpx.Response(200, json={"query": {"pages": {"1": {
                "title": title, "pageimage": f"{slug}.jpg",
                "thumbnail": {"source": f"https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/{slug}.jpg/800px-{slug}.jpg", "width": 800},
                "images": [{"ns": 6, "title": f"File:{slug}_{i}.jpg"} for i in range(files_per_article)],
            }}}})
        if params.get("prop") == "imageinfo":
            pages = {}
            for i, ft in enumerate(params.get("titles", "").split("|")):
                fname = ft.split(":", 1)[-1]
                pages[str(-i - 1)] = {"title": ft, "imageinfo": [{
                    "url": f"https://upload.wikimedia.org/wikipedia/commons/2/22/{fname}",
                    "thumburl": f"https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/{fname}/800px-{fname}",
                    "thumbwidth": 800, "width": 1600, "mime": "image/jpeg",
                }]}
            return httpx.Response(200, json={"query": {"pages": pages}})
        return httpx.Response(200, json={"query": {"pages": {}}})
    return handler


@pytest.mark.asyncio
async def test_auto_gif_search_runs_only_for_image_poor_articles(isolated_wiki_caches):
    sem = asyncio.Semaphore(4)
    for files, expected_gif_calls in ((5, 0), (0, 1)):
        stats = {"gif": 0, "commons_search": 0}
        transport = _WikimediaPoliteTransport(httpx.MockTransport(_image_handler(stats, files)), max_concurrency=4, max_rps=0)
        async with httpx.AsyncClient(transport=transport) as client:
            await wiki_enricher.fetch_image_candidates(
                f"Article with {files} files", client, sem, lang="en", gif_search="auto",
            )
        assert stats["gif"] == expected_gif_calls, (files, stats)

    stats = {"gif": 0, "commons_search": 0}
    transport = _WikimediaPoliteTransport(httpx.MockTransport(_image_handler(stats, 5)), max_concurrency=4, max_rps=0)
    async with httpx.AsyncClient(transport=transport) as client:
        await wiki_enricher.fetch_image_candidates("Science article", client, sem, lang="en", gif_search="always")
    assert stats["gif"] == 1


@pytest.mark.asyncio
async def test_commons_fallback_limited_to_top_ranked_events(isolated_wiki_caches, monkeypatch):
    monkeypatch.setattr(wiki_enricher, "_llm_adjudicate_enrichment", lambda **_kw: asyncio.sleep(0))
    monkeypatch.setenv("WIKI_COMMONS_FALLBACK_TOP_N", "1")
    seen = []

    async def fake_candidates(title, client, semaphore, **kwargs):
        seen.append((title, kwargs.get("allow_commons_fallback"), kwargs.get("gif_search")))
        return []

    mock_client = httpx.AsyncClient(transport=_WikimediaPoliteTransport(
        httpx.MockTransport(lambda r: httpx.Response(200, json={"query": {"pages": {}}})), max_concurrency=4, max_rps=0,
    ))
    monkeypatch.setattr(wiki_enricher, "_get_shared_http_client", lambda: mock_client)
    monkeypatch.setattr(wiki_enricher, "_DEFAULT_FETCH_IMAGE_CANDIDATES", fake_candidates)
    monkeypatch.setattr(wiki_enricher, "fetch_image_candidates", fake_candidates)

    async def fake_summary(title, client, semaphore, **kwargs):
        return {"wikiTitle": title, "lang": "en", "wikiUrl": f"https://en.wikipedia.org/wiki/{title}"}

    monkeypatch.setattr(wiki_enricher, "fetch_wikipedia_summary", fake_summary)
    events = [
        {"id": "low", "title": "Minor", "wikipedia_title": "Minor", "rank": 2},
        {"id": "high", "title": "Major", "wikipedia_title": "Major", "rank": 9},
    ]
    try:
        await wiki_enricher.enrich_events_with_wikipedia(events, lang="en", timeline_topic="Treaties")
    finally:
        await mock_client.aclose()
    flags = {t: allow for t, allow, _g in seen}
    assert flags == {"Major": True, "Minor": False}
    assert all(g == "auto" for _t, _a, g in seen)


# --- per-call repair counting (P-13) ----------------------------------------------------------

@pytest.mark.asyncio
async def test_error_scope_is_per_call_and_repairs_only_errored_events(monkeypatch):
    monkeypatch.setattr(wiki_enricher, "_llm_adjudicate_enrichment", lambda **_kw: asyncio.sleep(0))
    calls = []
    fail_once = {"Broken": True}

    async def fake_summary(title, client, semaphore, **kwargs):
        calls.append((title, wiki_enricher._WIKIMEDIA_LANE.get()))
        if fail_once.get(title):
            fail_once[title] = False
            wiki_enricher._note_transient_enrichment_error()  # this event's own request was throttled
            return {}
        if title.startswith("Missing"):
            return {}  # a genuine miss: no error, so never repaired
        return {"wikiTitle": title, "lang": "en", "wikiUrl": f"https://en.wikipedia.org/wiki/{title}"}

    async def no_images(*a, **k):
        return []

    monkeypatch.setattr(wiki_enricher, "fetch_wikipedia_summary", fake_summary)
    monkeypatch.setattr(wiki_enricher, "fetch_image_candidates", no_images)

    events = [
        {"id": "a", "title": "Fine", "wikipedia_title": "Fine"},
        {"id": "b", "title": "Broken", "wikipedia_title": "Broken"},
        {"id": "c", "title": "Missing page", "wikipedia_title": "Missing page"},
    ]

    async def other_users_429s():
        # Another user's errors in another task must not leak into this call's scope.
        for _ in range(5):
            wiki_enricher._note_transient_enrichment_error()
            await asyncio.sleep(0)

    out, _ = await asyncio.gather(
        wiki_enricher.enrich_events_with_wikipedia(events, lang="en"),
        other_users_429s(),
    )
    titles = [t for t, _lane in calls]
    assert titles.count("Broken") == 2  # first pass + repair
    assert titles.count("Missing page") == 1  # incomplete but error-free: not repaired
    assert titles.count("Fine") == 1
    repair_lanes = [lane for t, lane in calls if t == "Broken"]
    assert repair_lanes[-1] == wiki_enricher.WIKIMEDIA_LANE_BACKGROUND
    assert out[1]["wikiUrl"] == "https://en.wikipedia.org/wiki/Broken"


@pytest.mark.asyncio
async def test_coalesced_request_failure_counts_for_every_waiter():
    gate = asyncio.Event()

    async def handler(request):
        await gate.wait()
        raise httpx.ConnectError("down")

    transport = _WikimediaPoliteTransport(httpx.MockTransport(handler), max_concurrency=4, max_rps=0, max_attempts=1)
    scopes = [wiki_enricher._EnrichmentErrorScope(), wiki_enricher._EnrichmentErrorScope()]
    async with httpx.AsyncClient(transport=transport) as client:
        async def fetch(scope):
            wiki_enricher._ENRICHMENT_ERROR_SCOPE.set(scope)
            with pytest.raises(httpx.ConnectError):
                await client.get("https://en.wikipedia.org/w/api.php?same=1")

        tasks = [asyncio.create_task(fetch(s)) for s in scopes]
        await asyncio.sleep(0.05)
        gate.set()
        await asyncio.gather(*tasks)
    assert all(s.count >= 1 for s in scopes)


# --- priority lanes (SC-04) -------------------------------------------------------------------

@pytest.mark.asyncio
async def test_priority_gate_serves_interactive_first_and_ages_background(monkeypatch):
    monkeypatch.setenv("WIKIMEDIA_LANE_AGING_SEC", "100")
    gate = _PriorityGate(1)
    order = []
    await gate.acquire(wiki_enricher.WIKIMEDIA_LANE_GENERATION)  # occupy the only slot

    async def worker(name, lane):
        await gate.acquire(lane)
        order.append(name)
        gate.release()

    tasks = [
        asyncio.create_task(worker("background", wiki_enricher.WIKIMEDIA_LANE_BACKGROUND)),
        asyncio.create_task(worker("generation", wiki_enricher.WIKIMEDIA_LANE_GENERATION)),
        asyncio.create_task(worker("interactive", wiki_enricher.WIKIMEDIA_LANE_INTERACTIVE)),
    ]
    await asyncio.sleep(0.01)
    gate.release()
    await asyncio.gather(*tasks)
    assert order == ["interactive", "generation", "background"]

    # Aging: a background request that has waited long enough goes before a fresh interactive one.
    monkeypatch.setenv("WIKIMEDIA_LANE_AGING_SEC", "0.1")
    order.clear()
    await gate.acquire(wiki_enricher.WIKIMEDIA_LANE_GENERATION)
    old = asyncio.create_task(worker("old-background", wiki_enricher.WIKIMEDIA_LANE_BACKGROUND))
    await asyncio.sleep(0.35)
    fresh = asyncio.create_task(worker("fresh-interactive", wiki_enricher.WIKIMEDIA_LANE_INTERACTIVE))
    await asyncio.sleep(0.01)
    gate.release()
    await asyncio.gather(old, fresh)
    assert order == ["old-background", "fresh-interactive"]


@pytest.mark.asyncio
async def test_transport_uses_caller_lane(monkeypatch):
    monkeypatch.setenv("WIKIMEDIA_LANE_AGING_SEC", "100")
    release = asyncio.Event()
    served = []

    async def handler(request):
        if "blocker" in str(request.url):
            await release.wait()
        served.append(request.url.params.get("who"))
        return httpx.Response(200, json={})

    transport = _WikimediaPoliteTransport(httpx.MockTransport(handler), max_concurrency=1, max_rps=0)
    async with httpx.AsyncClient(transport=transport) as client:
        blocker = asyncio.create_task(client.get("https://en.wikipedia.org/w/api.php?who=blocker&blocker=1"))
        await asyncio.sleep(0.01)

        async def get(who, lane):
            with wiki_enricher.wikimedia_lane(lane):
                await client.get(f"https://en.wikipedia.org/w/api.php?who={who}")

        bg = asyncio.create_task(get("generation", wiki_enricher.WIKIMEDIA_LANE_GENERATION))
        await asyncio.sleep(0.01)
        fg = asyncio.create_task(get("interactive", wiki_enricher.WIKIMEDIA_LANE_INTERACTIVE))
        await asyncio.sleep(0.01)
        release.set()
        await asyncio.gather(blocker, bg, fg)
    assert served == ["blocker", "interactive", "generation"]


# --- batched Wikidata P18 (SC-04) -------------------------------------------------------------

@pytest.mark.asyncio
async def test_wikidata_p18_batched_with_wbgetentities(isolated_wiki_caches):
    stats = {"wbgetentities": 0, "wbgetclaims": 0, "imageinfo": 0}

    def handler(request):
        params = dict(urllib.parse.parse_qsl(request.url.query.decode("utf-8")))
        if params.get("action") == "wbgetentities":
            stats["wbgetentities"] += 1
            ids = params["ids"].split("|")
            assert len(ids) <= 50
            ents = {}
            for q in ids:
                claims = {} if q == "Q3" else {"P18": [{"mainsnak": {"datavalue": {"value": f"Depiction {q}.jpg"}}}]}
                ents[q] = {"id": q, "claims": claims}
            return httpx.Response(200, json={"entities": ents})
        if params.get("action") == "wbgetclaims":
            stats["wbgetclaims"] += 1
        if params.get("prop") == "imageinfo":
            stats["imageinfo"] += 1
            pages = {}
            for i, ft in enumerate(params["titles"].split("|")):
                name = ft.split(":", 1)[1]
                pages[str(-i - 1)] = {"title": ft.replace("_", " "), "imageinfo": [{
                    "url": f"https://upload.wikimedia.org/x/{name}", "thumburl": f"https://upload.wikimedia.org/thumb/{name}",
                    "thumbwidth": 1280, "mime": "image/jpeg",
                }]}
            return httpx.Response(200, json={"query": {"pages": pages}})
        return httpx.Response(200, json={})

    transport = _WikimediaPoliteTransport(httpx.MockTransport(handler), max_concurrency=4, max_rps=0)
    async with httpx.AsyncClient(transport=transport) as client:
        await wiki_enricher._batch_prewarm_wikidata_p18(["Q1", "Q2", "Q3"], client)
        assert stats == {"wbgetentities": 1, "wbgetclaims": 0, "imageinfo": 1}
        img, ok = await wiki_enricher._fetch_wikidata_image_checked("Q1", client)
        none, ok3 = await wiki_enricher._fetch_wikidata_image_checked("Q3", client)
    assert ok and img["url"] == "https://upload.wikimedia.org/thumb/Depiction Q1.jpg"
    assert ok3 and none is None
    assert stats["wbgetclaims"] == 0  # served from the batch
