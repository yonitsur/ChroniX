"""Batch 5C: podcast audio served without buffering (SC-05), on-demand chapter rendering, bounded
TTS waiters and executors (SC-15), and O(1) wiki cache eviction (P-11)."""
import asyncio
import tempfile
import time
from collections import OrderedDict

import httpx
import pytest
from fastapi.testclient import TestClient

import main
from services import podcast_audio, podcast_store, wiki_enricher
from services.podcast_tts_service import pcm_to_mp3, silence_pcm
from test_podcast_api import LONG_TIMELINE, OWNER, _create_episode, _wait_variant, env  # noqa: F401 (fixture)

SUPABASE = "https://proj.supabase.co"


def _texts(tts):
    return [text for _engine, text in tts.calls]


def _wait_until(predicate, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


# --- on-demand rendering (SC-15) ---------------------------------------------------------------

def _long_episode(client, monkeypatch, engine="edge"):
    return _create_episode(client, engine=engine, length="full", timeline=LONG_TIMELINE)["episode"]


def test_only_the_prefetch_window_renders_when_an_episode_is_created(env, monkeypatch):
    monkeypatch.setenv("PODCAST_BACKGROUND_FILL_ENGINES", "")
    ep = _long_episode(env["client"], monkeypatch)
    assert len(ep["segments"]) > 10
    done = _wait_variant(env["client"], ep["id"])
    assert done["audio"]["edge"]["status"] == "partial"
    # Intro + the next PODCAST_PREFETCH_CHAPTERS (2) chapters, nothing else.
    assert _texts(env["tts"]) == ["Welcome aboard.", "Story of Milestone 1.", "Story of Milestone 2."]


def test_playing_chapter_n_renders_the_next_two(env, monkeypatch):
    monkeypatch.setenv("PODCAST_BACKGROUND_FILL_ENGINES", "")
    client, tts = env["client"], env["tts"]
    ep = _long_episode(client, monkeypatch)
    _wait_variant(client, ep["id"])
    seg_ids = [s["id"] for s in ep["segments"]]
    target = seg_ids[8]
    res = client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/segments/{target}/clip?engine=edge")
    assert res.status_code == 200
    expected = [f"Story of Milestone {i}." for i in (8, 9, 10)]
    assert _wait_until(lambda: all(t in _texts(tts) for t in expected)), _texts(tts)
    time.sleep(0.1)
    assert "Story of Milestone 11." not in _texts(tts), "only the window after the played chapter"
    assert len(_texts(tts)) == 6


def test_download_renders_the_remaining_chapters_and_serves_the_whole_file(env, monkeypatch):
    monkeypatch.setenv("PODCAST_BACKGROUND_FILL_ENGINES", "")
    client, tts = env["client"], env["tts"]
    ep = _long_episode(client, monkeypatch)
    _wait_variant(client, ep["id"])
    res = client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/download?engine=edge")
    assert res.status_code == 200
    assert res.headers["content-type"] == "audio/mpeg"
    assert "attachment" in res.headers["content-disposition"]
    assert res.content[:3] == b"ID3"
    assert len(set(_texts(tts))) == len(ep["segments"])
    episode_audio = client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/episode-audio?engine=edge").json()
    assert episode_audio["ready"] is True


def test_idle_capacity_fills_in_the_rest_of_a_free_voice_episode(env, monkeypatch):
    client, tts = env["client"], env["tts"]
    ep = _long_episode(client, monkeypatch)
    assert _wait_until(lambda: client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}").json()["audio"]["edge"]["status"] == "ready")
    assert len(set(_texts(tts))) == len(ep["segments"])


def test_premium_charge_is_unchanged_by_on_demand_rendering(env, monkeypatch):
    from services import quota_service

    client = env["client"]
    env["meta"]["tl-1"]["data"] = dict(LONG_TIMELINE)
    before = quota_service.get_user_daily_usage(OWNER["id"])
    ep = _create_episode(client, engine="gemini", length="full", timeline=LONG_TIMELINE)["episode"]
    _wait_variant(client, ep["id"], "gemini")
    events = sum(1 for s in ep["segments"] if s.get("type") == "event")
    cost = main._resolve_podcast_gemini_audio_cost(length="full", event_count=events)
    # Script (1 credit) + the whole episode's premium price, even though only 3 chapters rendered yet.
    assert quota_service.get_user_daily_usage(OWNER["id"]) == before + 1 + cost
    assert len(env["tts"].calls) == 3
    stored = podcast_store.get_episode("tl-1", ep["id"])
    assert not stored["audio"]["gemini"].get("refunded")


@pytest.mark.asyncio
async def test_completion_hook_meters_each_clip_once_across_passes(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    recorded = []
    monkeypatch.setattr(main, "record_extra_cost", lambda cost, **kw: recorded.append(round(cost, 4)))
    doc = {
        "id": "ep-m", "timeline_id": "tl-m", "voice_gender": "male", "segments": [],
        "audio": {"edge": {"by_gender": {"male": {"status": "partial", "clips": {
            "a": {"key": "k1", "cost_usd": 0.01}, "b": {"key": "k2", "cost_usd": 0.02},
        }}}}},
    }
    podcast_store.save_episode(dict(doc))
    hook = main._variant_completion_hook({"id": "u"}, None, "edge", False, voice_gender="male")
    await hook(doc, rendered={"a": {}, "b": {}})
    doc = podcast_store.get_episode("tl-m", "ep-m")
    doc["audio"]["edge"]["by_gender"]["male"]["clips"]["c"] = {"key": "k3", "cost_usd": 0.04}
    await hook(doc, rendered={"c": {}})
    await hook(podcast_store.get_episode("tl-m", "ep-m"), rendered={})
    assert recorded == [0.03, 0.04]


def test_interactive_clip_beyond_the_waiter_bound_is_a_503(env, monkeypatch):
    client = env["client"]
    ep = _create_episode(client)["episode"]
    _wait_variant(client, ep["id"])

    async def busy(*a, **k):
        raise podcast_audio.TtsBusyError("queue full")

    monkeypatch.setattr(podcast_audio, "render_clip", busy)
    res = client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/segments/seg-2/clip?engine=edge")
    assert res.status_code == 503
    assert res.headers["Retry-After"]


@pytest.mark.asyncio
async def test_render_clip_refuses_interactive_requests_past_the_waiter_bound(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    monkeypatch.setenv("PODCAST_MAX_TTS_WAITERS", "2")
    gate = podcast_audio._get_engine_gate("edge")
    monkeypatch.setattr(type(gate), "waiting", property(lambda self: 2))
    ep = {"id": "e", "format": "single", "voice_gender": "male", "detected_language": "en"}
    seg = {"id": "s", "turns": [{"speaker": "host1", "text": "busy"}]}
    with pytest.raises(podcast_audio.TtsBusyError):
        await podcast_audio.render_clip(ep, seg, "edge", priority=podcast_audio.PRIORITY_INTERACTIVE)


def test_podcast_thread_work_uses_the_dedicated_pools():
    import inspect

    from services import podcast_tts_service

    assert "asyncio.to_thread" not in inspect.getsource(podcast_audio)
    assert "asyncio.to_thread" not in inspect.getsource(podcast_tts_service)


# --- serving audio without buffering (SC-05) ---------------------------------------------------

class _SignClient:
    def __init__(self, status=200):
        self.status = status
        self.posts = []

    def post(self, url, headers=None, json=None):
        self.posts.append((url, json))
        return httpx.Response(self.status, json={"signedURL": "/object/sign/podcasts/clips/ab/x.mp3?token=t0k"},
                              request=httpx.Request("POST", url))


@pytest.fixture
def remote_store(monkeypatch):
    signer = _SignClient()

    import contextlib

    @contextlib.contextmanager
    def fake_http_client():
        yield signer

    monkeypatch.setattr(podcast_store, "_http_client", fake_http_client)
    monkeypatch.setattr(podcast_store, "remote_enabled", lambda: True)
    monkeypatch.setattr(podcast_store, "_supabase", lambda: (SUPABASE, "service-key"))
    monkeypatch.setattr(podcast_store, "local_clip_file", lambda key: None)
    monkeypatch.setattr(podcast_store, "get_clip_audio", lambda key: (_ for _ in ()).throw(AssertionError("buffered")))
    podcast_store.clear_signed_url_cache()
    main.podcast_stream_rate_limiter.records.clear()
    yield signer
    podcast_store.clear_signed_url_cache()


KEY = "ab" + "c" * 62


def test_clip_url_redirects_to_a_cached_signed_storage_url(remote_store):
    client = TestClient(main.app)
    res = client.get(f"/api/podcast-audio/{KEY}.mp3", follow_redirects=False, headers={"Range": "bytes=0-99"})
    assert res.status_code == 302
    assert res.headers["location"] == f"{SUPABASE}/storage/v1/object/sign/podcasts/clips/ab/x.mp3?token=t0k"
    assert "max-age" in res.headers["cache-control"]
    url, body = remote_store.posts[0]
    assert url == f"{SUPABASE}/storage/v1/object/sign/podcasts/clips/ab/{KEY}.mp3"
    assert body == {"expiresIn": 3600}
    assert client.get(f"/api/podcast-audio/{KEY}.mp3", follow_redirects=False).status_code == 302
    assert len(remote_store.posts) == 1, "the signature is reused for most of its lifetime"


def test_missing_clip_is_a_404(remote_store):
    remote_store.status = 400
    assert TestClient(main.app).get(f"/api/podcast-audio/{KEY}.mp3", follow_redirects=False).status_code == 404


def test_signing_failure_streams_from_storage_passing_range_through(remote_store, monkeypatch):
    remote_store.status = 500
    seen = {}
    payload = bytes(range(256)) * 4

    def handler(request):
        seen["range"] = request.headers.get("range")
        seen["url"] = str(request.url)
        return httpx.Response(206, content=payload[10:20], headers={
            "Content-Range": f"bytes 10-19/{len(payload)}", "Content-Length": "10",
        })

    real_async_client = httpx.AsyncClient

    class MockAsyncClient(real_async_client):
        def __init__(self, **kwargs):
            super().__init__(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", MockAsyncClient)
    res = TestClient(main.app).get(f"/api/podcast-audio/{KEY}.mp3", headers={"Range": "bytes=10-19"})
    assert res.status_code == 206
    assert res.content == payload[10:20]
    assert res.headers["content-range"] == f"bytes 10-19/{len(payload)}"
    assert seen["range"] == "bytes=10-19"
    assert seen["url"].endswith(f"/storage/v1/object/authenticated/podcasts/clips/ab/{KEY}.mp3")


def test_local_backend_serves_ranges_from_disk_without_loading_the_clip(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    main.podcast_stream_rate_limiter.records.clear()
    data = bytes(range(256)) * 1024  # 256 KB
    podcast_store.put_clip(KEY, data, {"key": KEY})
    podcast_store.clip_cache.clear()
    monkeypatch.setattr(podcast_store, "get_clip_audio", lambda key: (_ for _ in ()).throw(AssertionError("buffered")))
    res = TestClient(main.app).get(f"/api/podcast-audio/{KEY}.mp3", headers={"Range": "bytes=1000-1999"})
    assert res.status_code == 206
    assert res.content == data[1000:2000]
    assert res.headers["content-range"] == f"bytes 1000-1999/{len(data)}"
    full = TestClient(main.app).get(f"/api/podcast-audio/{KEY}.mp3")
    assert full.status_code == 200 and full.content == data
    assert full.headers["accept-ranges"] == "bytes"


@pytest.mark.asyncio
async def test_download_returns_a_signed_url_or_redirects_only_header_free_requests(remote_store, monkeypatch):
    doc = {"id": "ep", "timeline_id": "tl", "title": "Moon / Race", "voice_gender": "male", "segments": []}

    async def visible(*a, **k):
        return doc, {}

    async def manifest(*a, **k):
        return {"key": KEY, "url": "x", "duration": 1.0, "chapters": []}

    monkeypatch.setattr(main, "_load_visible_episode", visible)
    monkeypatch.setattr(podcast_audio, "get_episode_audio", manifest)
    main.podcast_audio_rate_limiter.records.clear()
    client = TestClient(main.app)
    as_url = client.get("/api/timelines/tl/podcasts/ep/download?engine=edge&format=url")
    assert as_url.status_code == 200
    body = as_url.json()
    assert body["filename"] == "Moon  Race.mp3"
    assert body["url"].endswith("&download=Moon%20%20Race.mp3")
    plain = client.get("/api/timelines/tl/podcasts/ep/download?engine=edge", follow_redirects=False)
    assert plain.status_code == 302

    streamed = {}

    async def fake_stream(key, range_header, extra_headers=None):
        streamed["headers"] = extra_headers
        return main.Response(content=b"ID3", media_type="audio/mpeg", headers=extra_headers)

    monkeypatch.setattr(main, "_stream_clip_from_storage", fake_stream)
    with_key = client.get("/api/timelines/tl/podcasts/ep/download?engine=edge", headers={"X-Gemini-Api-Key": "AIzaUser"},
                          follow_redirects=False)
    assert with_key.status_code == 200, "a request carrying a personal key is never redirected cross-origin"
    assert "attachment" in streamed["headers"]["Content-Disposition"]


@pytest.mark.asyncio
async def test_episode_file_is_joined_in_a_spooled_file_not_in_memory(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    clip = pcm_to_mp3(silence_pcm(0.3))
    ep = {"id": "e", "timeline_id": "t", "title": "T", "format": "single", "voice_gender": "male", "detected_language": "en",
          "segments": [{"id": f"s{i}", "turns": [{"speaker": "host1", "text": f"t{i}"}]} for i in range(3)]}
    for seg in ep["segments"]:
        key = podcast_audio.clip_key("edge", ep, seg)
        podcast_store.put_clip(key, clip, {"key": key, "engine": "edge", "duration": 0.3})
    stored = {}
    real_put_file = podcast_store.put_clip_file

    def spy_put_file(key, fileobj, size, meta):
        stored["type"] = type(fileobj)
        stored["size"] = size
        return real_put_file(key, fileobj, size, meta)

    monkeypatch.setattr(podcast_store, "put_clip_file", spy_put_file)
    monkeypatch.setattr(podcast_store, "put_clip", lambda *a, **k: (_ for _ in ()).throw(AssertionError("bytes upload")))
    manifest = await podcast_audio.build_episode_audio(ep, "edge")
    assert manifest and len(manifest["chapters"]) == 3
    assert stored["type"] is tempfile.SpooledTemporaryFile
    on_disk = podcast_store.local_clip_file(manifest["key"]).read_bytes()
    assert len(on_disk) == stored["size"] and on_disk[:3] == b"ID3"


# --- wiki caches (P-11) ------------------------------------------------------------------------

def test_wiki_caches_are_lru_ordered_dicts_with_o1_eviction(monkeypatch):
    assert isinstance(wiki_enricher._RAW_SUMMARY_CACHE, OrderedDict)
    store = OrderedDict()
    sweeps = []
    real_sweep = wiki_enricher._cache_sweep_expired
    monkeypatch.setattr(wiki_enricher, "_cache_sweep_expired", lambda s, now: (sweeps.append(1), real_sweep(s, now)))
    for i in range(5):
        wiki_enricher._cache_put(store, i, i, max_entries=5)
    assert wiki_enricher._cache_get(store, 0) == 0  # 0 becomes most recently used
    wiki_enricher._CACHE_LAST_SWEEP.pop(id(store), None)
    for i in range(5, 50):
        wiki_enricher._cache_put(store, i, i, max_entries=5)
    assert len(store) == 5
    assert list(store)[-1] == 49
    assert 1 not in store
    assert len(sweeps) == 45 and wiki_enricher._CACHE_LAST_SWEEP[id(store)] > 0


def test_full_cache_sweeps_expired_entries_at_most_once_a_minute(monkeypatch):
    store = OrderedDict()
    scans = []

    class CountingItems(OrderedDict):
        def items(self):
            scans.append(1)
            return super().items()

    store = CountingItems()
    for i in range(3):
        wiki_enricher._cache_put(store, i, i, max_entries=3)
    for i in range(3, 200):
        wiki_enricher._cache_put(store, i, i, max_entries=3)
    assert len(scans) <= 1, "inserting into a full cache no longer scans every entry"
