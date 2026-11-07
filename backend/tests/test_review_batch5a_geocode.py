"""SC-11: Nominatim behind one shared client and a two-lane 1 req/s scheduler, a bounded batch
queue, request deadlines with partial results, and the persistent cell cache."""
import asyncio
import time

import httpx
import pytest
from fastapi.testclient import TestClient

import main
from services import enrichment_cache, wiki_enricher
from services.auth_service import get_current_user_optional
from services.wiki_enricher import NOMINATIM_LANE_BATCH, NOMINATIM_LANE_INTERACTIVE, NominatimBusyError

USER = {"id": "geo-user", "email": "geo@example.com", "is_anonymous": False}


@pytest.fixture(autouse=True)
def fast_nominatim(monkeypatch):
    monkeypatch.setenv("NOMINATIM_MIN_INTERVAL_SEC", "0.05")
    wiki_enricher._REVERSE_GEOCODE_CACHE.clear()
    wiki_enricher._GEOCODE_CACHE.clear()
    yield
    wiki_enricher._REVERSE_GEOCODE_CACHE.clear()
    wiki_enricher._GEOCODE_CACHE.clear()


def _mock_nominatim(monkeypatch, handler):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(wiki_enricher, "_get_nominatim_client", lambda: client)
    return client


@pytest.mark.asyncio
async def test_interactive_search_goes_before_queued_batch_lookups(monkeypatch):
    monkeypatch.setenv("NOMINATIM_MIN_INTERVAL_SEC", "0.1")
    order = []

    def handler(request):
        order.append(request.url.path)
        if request.url.path == "/search":
            return httpx.Response(200, json=[{"display_name": "Rome", "name": "Rome", "lat": "41.9", "lon": "12.5"}])
        return httpx.Response(200, json={"address": {"city": "C"}, "display_name": "C"})

    client = _mock_nominatim(monkeypatch, handler)
    try:
        batch = [asyncio.create_task(wiki_enricher.reverse_geocode_point(10 + i, 10)) for i in range(4)]
        await asyncio.sleep(0.02)
        search = asyncio.create_task(wiki_enricher.search_geocode_candidates("Rome"))
        await asyncio.gather(search, *batch)
    finally:
        await client.aclose()
    # The first batch lookup was already granted; the search jumps the remaining queue.
    assert order[:2] == ["/reverse", "/search"]
    assert order.count("/reverse") == 4


@pytest.mark.asyncio
async def test_scheduler_paces_requests_and_bounds_the_batch_queue(monkeypatch):
    monkeypatch.setenv("NOMINATIM_MAX_QUEUE", "2")
    sched = wiki_enricher._NominatimScheduler()
    granted = []

    async def take(lane, timeout=5.0):
        await sched.acquire(lane, timeout)
        granted.append(time.monotonic())

    t1 = asyncio.create_task(take(NOMINATIM_LANE_BATCH))
    t2 = asyncio.create_task(take(NOMINATIM_LANE_BATCH))
    await asyncio.sleep(0)
    with pytest.raises(NominatimBusyError):
        await sched.acquire(NOMINATIM_LANE_BATCH, 5.0)  # queue full: fail fast instead of waiting
    await asyncio.gather(t1, t2)
    assert granted[1] - granted[0] >= 0.04  # at most one request per interval

    monkeypatch.setenv("NOMINATIM_MIN_INTERVAL_SEC", "5")
    sched2 = wiki_enricher._NominatimScheduler()
    await sched2.acquire(NOMINATIM_LANE_BATCH, 1.0)  # first slot is immediate
    with pytest.raises(NominatimBusyError):
        await sched2.acquire(NOMINATIM_LANE_BATCH, 0.1)  # next one is 5 s away: deadline passes
    assert sched2.queued(NOMINATIM_LANE_BATCH) == 0  # the timed-out waiter left the queue


@pytest.mark.asyncio
async def test_shared_nominatim_client_is_reused():
    c1 = wiki_enricher._get_nominatim_client()
    c2 = wiki_enricher._get_nominatim_client()
    assert c1 is c2 and not c1.is_closed
    await c1.aclose()
    assert wiki_enricher._get_nominatim_client() is not c1  # a closed client is replaced


def _geo_client(monkeypatch, fake_reverse):
    monkeypatch.setattr(main, "reverse_geocode_point", fake_reverse)
    main.app.dependency_overrides[get_current_user_optional] = lambda: USER
    return TestClient(main.app)


def test_reverse_geocode_endpoint_returns_partial_on_deadline(monkeypatch):
    monkeypatch.setenv("REVERSE_GEOCODE_REQUEST_DEADLINE_SEC", "1")

    async def fake_reverse(lat, lng, lang=None):
        if lat > 40:
            await asyncio.sleep(10)  # stuck behind a busy queue
        return {"city": f"C{lat}"}

    try:
        client = _geo_client(monkeypatch, fake_reverse)
        t0 = time.monotonic()
        res = client.post("/api/timeline/reverse-geocode", json={"points": [
            {"id": "fast", "lat": 10, "lng": 10},
            {"id": "slow", "lat": 50, "lng": 10},
        ]})
        elapsed = time.monotonic() - t0
    finally:
        main.app.dependency_overrides.pop(get_current_user_optional, None)
    assert res.status_code == 200
    body = res.json()
    assert elapsed < 5
    assert body["partial"] is True and body["deferred"] == ["slow"]
    places = {r["id"]: r["place"] for r in body["results"]}
    assert places == {"fast": {"city": "C10.0"}, "slow": None}


def test_reverse_geocode_endpoint_busy_queue_is_partial(monkeypatch):
    async def fake_reverse(lat, lng, lang=None):
        if lat > 40:
            raise NominatimBusyError("geocoding queue is full")
        return None  # a genuine miss (point in the sea)

    try:
        client = _geo_client(monkeypatch, fake_reverse)
        body = client.post("/api/timeline/reverse-geocode", json={"points": [
            {"id": "sea", "lat": 10, "lng": 10},
            {"id": "busy", "lat": 50, "lng": 10},
        ]}).json()
        complete = client.post("/api/timeline/reverse-geocode", json={"points": [{"id": "sea", "lat": 10, "lng": 10}]}).json()
    finally:
        main.app.dependency_overrides.pop(get_current_user_optional, None)
    assert body["partial"] is True and body["deferred"] == ["busy"]
    assert "partial" not in complete and complete["results"] == [{"id": "sea", "place": None}]


@pytest.mark.asyncio
async def test_persistent_cell_cache_warms_memory_and_records_new_cells(monkeypatch):
    stored = {"geo:38.71:-9.14:en": {"city": "Lisboa"}}
    written = []

    async def fake_get_many(keys):
        return {k: stored[k] for k in keys if k in stored}

    monkeypatch.setattr(enrichment_cache, "is_enabled", lambda: True)
    monkeypatch.setattr(enrichment_cache, "get_many", fake_get_many)
    monkeypatch.setattr(enrichment_cache, "put_many", lambda items: written.extend(items))
    hits = []

    def handler(request):
        hits.append(str(request.url))
        return httpx.Response(200, json={"address": {"city": "Porto"}, "display_name": "Porto"})

    client = _mock_nominatim(monkeypatch, handler)
    try:
        await wiki_enricher.warm_reverse_geocode_cells([(38.71, -9.14), (41.15, -8.61)], lang="en")
        lisbon = await wiki_enricher.reverse_geocode_point(38.71, -9.14, lang="en")
        porto = await wiki_enricher.reverse_geocode_point(41.15, -8.61, lang="en")
    finally:
        await client.aclose()
    assert lisbon == {"city": "Lisboa"}
    assert porto["city"] == "Porto"
    assert len(hits) == 1  # only the unknown cell went to Nominatim
    assert [k for k, _v, _ttl in written] == ["geo:41.15:-8.61:en"]


@pytest.mark.asyncio
async def test_enrichment_cache_disables_itself_when_table_missing(monkeypatch):
    enrichment_cache.reset_for_tests()
    monkeypatch.setenv("ENRICHMENT_CACHE_ENABLED", "true")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    calls = []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(404, json={"code": "PGRST205", "message": "Could not find the table"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(enrichment_cache, "_shared_client", lambda: client)
    try:
        assert await enrichment_cache.get_many(["geo:1.00:2.00:en"]) == {}
        assert enrichment_cache.is_enabled() is False  # backs off instead of failing every lookup
        assert await enrichment_cache.get_many(["geo:1.00:2.00:en"]) == {}
    finally:
        await client.aclose()
        enrichment_cache.reset_for_tests()
    assert calls == ["/rest/v1/enrichment_cache"]
