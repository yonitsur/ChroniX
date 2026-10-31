"""Unit tests for ChroniX memory optimizations (Render 512 MB OOM prevention)."""
import asyncio
import base64
import io
import time
from typing import Any, Dict, List

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
from models import PodcastTurn, TimelineData
from services import gemini_service, podcast_audio, podcast_store, podcast_tts_service, storage, wiki_enricher
from services.auth_service import get_current_user_required


def test_gemini_client_lru_cache_reuses_and_evicts(monkeypatch):
    created: List["FakeClient"] = []

    class FakeAio:
        def __init__(self) -> None:
            self.closed = False

        async def aclose(self) -> None:
            self.closed = True

    class FakeClient:
        def __init__(self, api_key: str) -> None:
            self.api_key = api_key
            self.closed = False
            self.aio = FakeAio()
            created.append(self)

        def close(self) -> None:
            self.closed = True

    monkeypatch.setattr(gemini_service.genai, "Client", FakeClient)
    monkeypatch.setattr(gemini_service, "_ORIG_GENAI_CLIENT", FakeClient)
    monkeypatch.setattr(gemini_service, "_GEMINI_CLIENT_CACHE", gemini_service.OrderedDict())
    monkeypatch.setattr(gemini_service, "_MAX_CACHED_GEMINI_CLIENTS", 3)

    c1 = gemini_service.get_gemini_client("key-1")
    c1_again = gemini_service.get_gemini_client("key-1")
    assert c1 is c1_again
    assert len(created) == 1

    c2 = gemini_service.get_gemini_client("key-2")
    c3 = gemini_service.get_gemini_client("key-3")
    # Touch key-1 so key-2 becomes least-recently-used
    assert gemini_service.get_gemini_client("key-1") is c1

    c4 = gemini_service.get_gemini_client("key-4")
    assert c4.api_key == "key-4"
    assert len(gemini_service._GEMINI_CLIENT_CACHE) == 3
    assert c2.closed is True
    assert c1.closed is False
    assert c3.closed is False


def test_pillow_image_compression_reduces_large_png():
    img = Image.new("RGBA", (1400, 1400), (40, 90, 160, 255))
    # Add non-uniform bands so PNG stays large enough (> 80 KB base64)
    for y in range(0, 1400, 3):
        for x in range(0, 1400, 7):
            img.putpixel((x, y), ((x * 13 + y * 7) % 256, (x * 5) % 256, (y * 11) % 256, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG", compress_level=0)
    raw_png = buf.getvalue()
    raw_data_url = "data:image/png;base64," + base64.b64encode(raw_png).decode("ascii")
    assert len(raw_data_url) > 100_000

    compressed_gemini = gemini_service._compress_image_bytes_to_data_url(raw_png, "image/png")
    assert compressed_gemini.startswith("data:image/jpeg;base64,")
    assert len(compressed_gemini) < len(raw_data_url) // 3

    compressed_storage = storage._compress_data_image_url(raw_data_url)
    assert compressed_storage.startswith("data:image/jpeg;base64,")
    assert len(compressed_storage) < len(raw_data_url) // 3


def test_wiki_summary_compact_payload_strips_heavy_fields():
    bloated = {
        "type": "standard",
        "title": "Apollo 11",
        "displaytitle": "<i>Apollo 11</i>",
        "description": "First crewed Moon landing",
        "extract": "Apollo 11 was the American spaceflight that first landed humans on the Moon.",
        "extract_html": "<p><b>Apollo 11</b> was the American spaceflight...</p>" * 50,
        "titles": {"canonical": "Apollo_11", "normalized": "Apollo 11", "display": "Apollo 11"},
        "api_urls": {"summary": "https://en.wikipedia.org/api/rest_v1/page/summary/Apollo_11"},
        "thumbnail": {"source": "https://upload.wikimedia.org/thumb.jpg", "width": 320, "height": 240},
        "originalimage": {"source": "https://upload.wikimedia.org/orig.jpg", "width": 1600, "height": 1200},
        "coordinates": {"lat": 0.674, "lon": 23.473, "globe": "moon"},
        "content_urls": {
            "desktop": {"page": "https://en.wikipedia.org/wiki/Apollo_11", "revisions": "https://..."},
            "mobile": {"page": "https://en.m.wikipedia.org/wiki/Apollo_11"},
        },
    }
    compact = wiki_enricher._compact_summary_payload(bloated, "Apollo 11")
    assert "extract_html" not in compact
    assert "api_urls" not in compact
    assert "titles" not in compact
    assert compact["title"] == "Apollo 11"
    assert compact["extract"].startswith("Apollo 11")
    assert compact["thumbnail"]["source"].endswith("thumb.jpg")
    assert compact["coordinates"] == {"lat": 0.674, "lon": 23.473, "globe": "moon"}
    assert compact["content_urls"] == {"desktop": {"page": "https://en.wikipedia.org/wiki/Apollo_11"}}


def test_get_timeline_access_meta_avoids_select_star_and_falls_back(monkeypatch):
    seen_selects: List[str] = []

    class FakeResp:
        def __init__(self, status_code: int, payload: Any) -> None:
            self.status_code = status_code
            self._payload = payload
            self.text = str(payload)

        def json(self) -> Any:
            return self._payload

    class FakeClient:
        def __init__(self, **kwargs: Any) -> None:
            pass

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def get(self, url: str, headers: Any = None, params: Any = None) -> FakeResp:
            sel = (params or {}).get("select", "")
            seen_selects.append(sel)
            if "article_count" in sel:
                # Simulate pre-migration DB without article_count / is_shared columns
                return FakeResp(400, {"message": "column article_count does not exist"})
            return FakeResp(
                200,
                [{
                    "id": "tl-mem",
                    "user_id": "owner-42",
                    "is_public": True,
                    "is_deleted": "false",
                    "is_deleted_alt": None,
                    "legacy_podcast_seg": "seg-1",
                }],
            )

    monkeypatch.setattr(storage, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(storage, "SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setattr(storage.httpx, "Client", FakeClient)

    meta = storage.get_timeline_access_meta("tl-mem")
    assert len(seen_selects) == 2
    for sel in seen_selects:
        assert sel != "*"
        assert ",data," not in f",{sel},"
    assert meta == {
        "data": None,
        "owner_id": "owner-42",
        "is_shared": True,
        "is_deleted": False,
        "article_count": None,
        "has_legacy_podcast": True,
    }


@pytest.mark.asyncio
async def test_podcast_timeline_meta_uses_lightweight_lookup_and_migrates_legacy_on_demand(monkeypatch, tmp_path):
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path)
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)

    access_calls: List[str] = []
    full_calls: List[str] = []

    def fake_access_meta(tid: str):
        access_calls.append(tid)
        return {
            "data": None,
            "owner_id": "owner-1",
            "is_shared": True,
            "is_deleted": False,
            "article_count": 3,
            "has_legacy_podcast": True,
        }

    def fake_full_meta(tid: str):
        full_calls.append(tid)
        return {
            "data": {
                "id": tid,
                "title": "Legacy Timeline",
                "detectedLanguage": "en",
                "podcast": {
                    "title": "Legacy Show",
                    "format": "single",
                    "segments": [{"id": "seg-1", "type": "intro", "turns": [{"speaker": "host1", "text": "Hello world."}]}],
                },
            },
            "owner_id": "owner-1",
            "is_shared": True,
        }

    monkeypatch.setattr(main, "get_timeline_access_meta", fake_access_meta)
    monkeypatch.setattr(main, "get_timeline_with_meta", fake_full_meta)
    monkeypatch.setattr(main, "_ORIG_GET_TIMELINE_WITH_META", fake_full_meta)

    # First list: sees has_legacy_podcast=True and migrates once via full_meta
    res1 = await main.list_podcast_episodes("tl-leg", user=None)
    assert len(res1["episodes"]) == 1
    assert res1["episodes"][0]["id"] == "legacy"
    assert access_calls == ["tl-leg"]
    assert full_calls == ["tl-leg"]

    # Second list: legacy episode is now in podcast_store, so full_meta is NOT fetched again!
    res2 = await main.list_podcast_episodes("tl-leg", user=None)
    assert len(res2["episodes"]) == 1
    assert access_calls == ["tl-leg", "tl-leg"]
    assert full_calls == ["tl-leg"]


def test_strip_heavy_media_from_timeline_removes_inline_images_and_blobs(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_CACHE_DIR", str(tmp_path))
    raw = {
        "id": "tl-heavy",
        "title": "Heavy Timeline",
        "detectedLanguage": "en",
        "quiz": [{"id": "q1", "question": "Q?", "options": ["A", "B", "C", "D"], "correct_index": 0, "explanation": "E"}],
        "whoami": [{"id": "w1", "target_event_id": "e1", "target_title": "Event 1", "clues": ["1", "2", "3", "4", "5"], "fun_fact": "F"}],
        "grounding": {"is_grounded": True, "search_queries": ["q"], "sources": []},
        "articles": [
            {
                "id": "e1",
                "title": "Event 1",
                "from": {"year": 2000},
                "imageUrl": "data:image/png;base64," + ("A" * 200_000),
                "additionalImages": ["data:image/png;base64," + ("B" * 100_000)],
                "videos": [{"videoId": "abc", "title": "Vid"}],
            }
        ],
    }
    tl = TimelineData(**raw)
    main._strip_heavy_media_from_timeline(tl)
    assert tl.grounding is None
    assert getattr(tl, "quiz", None) is None
    assert getattr(tl, "whoami", None) is None
    assert tl.articles[0].imageUrl is None
    assert tl.articles[0].videos is None
    assert "additionalImages" not in (tl.articles[0].__pydantic_extra__ or {})


def test_audio_range_response_zero_copy_on_full_range():
    payload = b"ID3" + (b"\xff\xf3\x84\xc4" * 1024)
    full_range_resp = main._audio_range_response(payload, "bytes=0-")
    assert full_range_resp.status_code == 206
    assert full_range_resp.headers["Content-Range"] == f"bytes 0-{len(payload) - 1}/{len(payload)}"
    assert full_range_resp.body is payload

    partial_resp = main._audio_range_response(payload, "bytes=10-29")
    assert partial_resp.status_code == 206
    assert partial_resp.headers["Content-Range"] == f"bytes 10-29/{len(payload)}"
    assert partial_resp.body == payload[10:30]


def test_ai_jobs_evicts_delivered_jobs_quickly_and_caps_finished(monkeypatch):
    saved_jobs = dict(main._AI_JOBS)
    main._AI_JOBS.clear()
    user = {"id": "u-mem", "email": "u@example.com"}
    main.app.dependency_overrides[get_current_user_required] = lambda: user
    try:
        client = TestClient(main.app)
        jid = main._create_ai_job(user)
        main._AI_JOBS[jid].update(status="done", result={"ok": True}, updated=time.time())

        resp = client.get(f"/api/timeline/job/status/{jid}")
        assert resp.status_code == 200
        assert main._AI_JOBS[jid].get("delivered_at") is not None

        # Simulate 35s elapsed (> _DELIVERED_JOB_TTL_SECONDS=30, < _JOB_TTL_SECONDS=300)
        main._AI_JOBS[jid]["delivered_at"] -= (main._DELIVERED_JOB_TTL_SECONDS + 5)
        undelivered_id = main._create_ai_job(user)
        main._AI_JOBS[undelivered_id].update(status="done", result={"ok": 2}, updated=time.time() - 60)

        main._cleanup_ai_jobs()
        assert jid not in main._AI_JOBS
        assert undelivered_id in main._AI_JOBS

        # Cap total finished jobs to _MAX_FINISHED_AI_JOBS
        for idx in range(10):
            extra_id = main._create_ai_job(user)
            main._AI_JOBS[extra_id].update(status="done", result={"i": idx}, updated=time.time() + idx)
        main._cleanup_ai_jobs()
        finished_remaining = [j for j in main._AI_JOBS.values() if j.get("status") != "pending"]
        assert len(finished_remaining) <= main._MAX_FINISHED_AI_JOBS
    finally:
        main.app.dependency_overrides.pop(get_current_user_required, None)
        main._AI_JOBS.clear()
        main._AI_JOBS.update(saved_jobs)


def test_clip_cache_skips_oversized_full_episode_buffers():
    cache = podcast_store._ClipCache(max_bytes=4 * 1024 * 1024)
    chapter_bytes = b"x" * (200 * 1024)
    cache.put("chapter-1", chapter_bytes)
    assert cache.get("chapter-1") == chapter_bytes

    huge_episode = b"y" * (3 * 1024 * 1024)
    cache.put("full-episode", huge_episode)
    # Oversized full-episode MP3s (> max_item_bytes) don't evict hot chapter clips from RAM
    assert cache.get("full-episode") is None
    assert cache.get("chapter-1") == chapter_bytes


@pytest.mark.asyncio
async def test_gemini_render_clip_enforces_single_concurrency_and_interactive_priority(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    podcast_store.clip_cache.clear()
    monkeypatch.setenv("GEMINI_TTS_CONCURRENCY", "1")

    active = 0
    max_active = 0
    call_order: List[str] = []
    first_started = asyncio.Event()
    release_first = asyncio.Event()
    sample_mp3 = podcast_tts_service.pcm_to_mp3(podcast_tts_service.silence_pcm(0.2))

    async def fake_synthesize(engine, turns, **kwargs):
        nonlocal active, max_active
        text = turns[0].text
        active += 1
        max_active = max(max_active, active)
        call_order.append(text)
        try:
            if text == "seg-1":
                first_started.set()
                await release_first.wait()
            else:
                await asyncio.sleep(0.01)
            return podcast_tts_service.SynthesisResult(
                audio=sample_mp3,
                duration=0.2,
                engine="gemini",
                model="gemini-3.8-flash-tts",
                cost_usd=0.01,
            )
        finally:
            active -= 1

    monkeypatch.setattr(podcast_audio, "synthesize_segment", fake_synthesize)

    ep = {
        "id": "ep-prio",
        "timeline_id": "tl-prio",
        "format": "single",
        "voice_gender": "male",
        "detected_language": "en",
        "content_mode": "classic",
    }
    segs = {
        name: {"id": name, "type": "event", "turns": [{"speaker": "host1", "text": name}]}
        for name in ("seg-1", "seg-2", "seg-3", "seg-skipped", "seg-jump")
    }

    t1 = asyncio.create_task(
        podcast_audio.render_clip(ep, segs["seg-1"], "gemini", priority=podcast_audio.PRIORITY_BACKGROUND)
    )
    await first_started.wait()

    # Queue background chapters seg-2 and seg-3 while seg-1 holds the single Gemini slot
    t2 = asyncio.create_task(
        podcast_audio.render_clip(ep, segs["seg-2"], "gemini", priority=podcast_audio.PRIORITY_BACKGROUND)
    )
    t3 = asyncio.create_task(
        podcast_audio.render_clip(ep, segs["seg-3"], "gemini", priority=podcast_audio.PRIORITY_BACKGROUND)
    )
    await asyncio.sleep(0.01)

    # Queue an interactive chapter that the user immediately skips past (cancels before synthesis starts)
    t_skip = asyncio.create_task(
        podcast_audio.render_clip(ep, segs["seg-skipped"], "gemini", priority=podcast_audio.PRIORITY_INTERACTIVE)
    )
    await asyncio.sleep(0.01)
    t_skip.cancel()
    with pytest.raises(asyncio.CancelledError):
        await t_skip

    # Queue the chapter the user landed on interactively — must jump ahead of seg-2 and seg-3!
    t_jump = asyncio.create_task(
        podcast_audio.render_clip(ep, segs["seg-jump"], "gemini", priority=podcast_audio.PRIORITY_INTERACTIVE)
    )
    await asyncio.sleep(0.01)

    release_first.set()
    await asyncio.gather(t1, t2, t3, t_jump)

    assert max_active == 1
    assert "seg-skipped" not in call_order
    assert call_order == ["seg-1", "seg-jump", "seg-2", "seg-3"]


@pytest.mark.asyncio
async def test_superseded_gemini_variant_render_cancels_previous_episode_cleanly(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    podcast_store.clip_cache.clear()
    monkeypatch.setenv("GEMINI_TTS_CONCURRENCY", "1")

    ep1_first_started = asyncio.Event()
    allow_ep1_first_finish = asyncio.Event()
    rendered_Log: List[str] = []
    sample_mp3 = podcast_tts_service.pcm_to_mp3(podcast_tts_service.silence_pcm(0.2))

    async def fake_synthesize(engine, turns, **kwargs):
        label = turns[0].text
        rendered_Log.append(label)
        if label == "ep1-seg-1":
            ep1_first_started.set()
            await allow_ep1_first_finish.wait()
        else:
            await asyncio.sleep(0.01)
        return podcast_tts_service.SynthesisResult(
            audio=sample_mp3,
            duration=0.2,
            engine="gemini",
            model="gemini-3.8-flash-tts",
            cost_usd=0.01,
        )

    monkeypatch.setattr(podcast_audio, "synthesize_segment", fake_synthesize)

    def _make_ep(ep_id: str) -> Dict[str, Any]:
        return {
            "id": ep_id,
            "timeline_id": "tl-cancel",
            "owner_id": "owner-same",
            "format": "single",
            "voice_gender": "male",
            "detected_language": "en",
            "content_mode": "classic",
            "segments": [
                {"id": f"seg-{i}", "type": "intro" if i == 1 else "event", "turns": [{"speaker": "host1", "text": f"{ep_id}-seg-{i}"}]}
                for i in range(1, 5)
            ],
            "audio": {
                "gemini": {
                    "status": "rendering",
                    "charged": True,
                    "clips": {},
                    "by_gender": {"male": {"status": "rendering", "clips": {}}},
                }
            },
        }

    podcast_store.save_episode(_make_ep("ep1"))
    podcast_store.save_episode(_make_ep("ep2"))

    podcast_audio.ensure_variant_render("tl-cancel", "ep1", "gemini", voice_gender="male", owner_id="owner-same")
    await ep1_first_started.wait()

    # Starting ep2 for the same owner cancels ep1's background variant loop
    podcast_audio.ensure_variant_render("tl-cancel", "ep2", "gemini", voice_gender="male", owner_id="owner-same")
    allow_ep1_first_finish.set()

    for _ in range(100):
        if not podcast_audio.is_variant_rendering("ep1", "gemini") and not podcast_audio.is_variant_rendering("ep2", "gemini"):
            break
        await asyncio.sleep(0.02)

    ep1_doc = podcast_store.get_episode("tl-cancel", "ep1")
    ep2_doc = podcast_store.get_episode("tl-cancel", "ep2")
    assert ep1_doc["audio"]["gemini"]["status"] in ("partial", "pending")
    assert ep2_doc["audio"]["gemini"]["status"] == "ready"
    # ep1 never rendered chapters 2, 3, or 4 after being superseded
    assert "ep1-seg-2" not in rendered_Log
    assert "ep1-seg-3" not in rendered_Log
    assert "ep1-seg-4" not in rendered_Log


@pytest.mark.asyncio
async def test_gemini_provider_timeout_and_direct_pcm_decode_without_wav_roundtrip(monkeypatch):
    raw_pcm = b"\x10\x00\xf0\xff" * 2400  # 0.1 s at 24 kHz mono
    b64_pcm = base64.b64encode(raw_pcm).decode("ascii")

    def forbid_wav(*args, **kwargs):
        raise AssertionError("Direct PCM decode must not wrap or unwrap RIFF WAV")

    monkeypatch.setattr(podcast_tts_service, "_pcm_to_wav_bytes", forbid_wav)
    audio_bytes, kind, rate, channels = podcast_tts_service._decode_audio_to_pcm_or_mp3(
        b64_pcm, "audio/pcm;rate=24000"
    )
    assert kind == "pcm"
    assert rate == 24000
    assert channels == 1
    assert audio_bytes == raw_pcm

    # Enforce hard timeout on hung Gemini TTS calls and fall back cleanly
    monkeypatch.setattr(podcast_tts_service, "GEMINI_TTS_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(
        podcast_tts_service,
        "get_gemini_tts_models_to_try",
        lambda: ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"],
    )

    class FakeOutAudio:
        data = b64_pcm
        mime_type = "audio/pcm;rate=24000"

    class FakeInteraction:
        output_audio = FakeOutAudio()
        usage = None

    class FakeInteractions:
        def __init__(self) -> None:
            self.models_called: List[str] = []

        async def create(self, model: str, **kwargs: Any) -> FakeInteraction:
            self.models_called.append(model)
            if model == "gemini-3.8-flash-tts":
                await asyncio.sleep(5.0)
            return FakeInteraction()

    fake_inter = FakeInteractions()

    class FakeAio:
        interactions = fake_inter

    class FakeClient:
        aio = FakeAio()

    monkeypatch.setattr(podcast_tts_service, "get_gemini_client", lambda api_key=None: FakeClient())
    provider = podcast_tts_service.GeminiProvider()
    t0 = time.monotonic()
    res = await provider.synthesize([PodcastTurn(speaker="host1", text="Testing fast timeout fallback.")])
    elapsed = time.monotonic() - t0

    assert elapsed < 1.5
    assert fake_inter.models_called == ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]
    assert res.model == "gemini-3.8-flash-lite-tts"
    assert res.duration > 0
