"""API tests for podcast episodes: authorization, server-side audio rendering, caching, quota."""
import time

import pytest
from fastapi.testclient import TestClient

import main
from services import podcast_audio, podcast_store, quota_service
from services.auth_service import get_current_user_optional, get_current_user_required
from services.podcast_tts_service import SynthesisResult, mp3_duration_seconds, pcm_to_mp3, silence_pcm

OWNER = {"id": "owner-1", "email": "owner@example.com"}
VIEWER = {"id": "viewer-1", "email": "viewer@example.com"}
STRANGER = {"id": "stranger-1", "email": "stranger@example.com"}

TIMELINE = {
    "id": "tl-1",
    "title": "Space Race",
    "detectedLanguage": "en",
    "articles": [
        {"id": "evt-1", "title": "Sputnik", "from": {"year": 1957}},
        {"id": "evt-2", "title": "Apollo 11", "from": {"year": 1969}},
    ],
}

LONG_TIMELINE = {
    "id": "tl-1",
    "title": "Space Race Extended",
    "detectedLanguage": "en",
    "articles": [
        {"id": f"evt-{i}", "title": f"Milestone {i}", "from": {"year": 1955 + i}}
        for i in range(1, 16)
    ],
}

SCRIPT = {
    "title": "Race to the Moon",
    "format": "single",
    "voice_gender": "male",
    "length": "full",
    "content_mode": "classic",
    "host1_name": "Michael",
    "host2_name": None,
    "detected_language": "en",
    "music_mood": "sunrise_piano",
    "segments": [
        {"id": "seg-1", "type": "intro", "event_id": None, "chapter_title": "Intro", "turns": [{"speaker": "host1", "text": "Welcome aboard."}]},
        {"id": "seg-2", "type": "event", "event_id": "evt-1", "chapter_title": "Sputnik", "turns": [{"speaker": "host1", "text": "A beep from orbit."}]},
        {"id": "seg-3", "type": "outro", "event_id": None, "chapter_title": "Outro", "turns": [{"speaker": "host1", "text": "Goodbye."}]},
    ],
}


class FakeTts:
    def __init__(self):
        self.calls = []
        self.fail_engines = set()

    async def __call__(self, engine, turns, **kwargs):
        self.calls.append((engine, turns[0].text))
        audio = pcm_to_mp3(silence_pcm(0.5))
        used = "edge" if engine in self.fail_engines else engine
        result = SynthesisResult(audio=audio, duration=mp3_duration_seconds(audio), engine=used, turn_starts=[0.0], cost_usd=0.001)
        if engine in self.fail_engines:
            result.fallback_from = engine
        return result


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    podcast_store.clip_cache.clear()
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "25")
    monkeypatch.delenv("CREDIT_COST_TEXT", raising=False)
    monkeypatch.delenv("CREDIT_COST_UPLOAD_MEDIUM", raising=False)
    monkeypatch.delenv("CREDIT_COST_UPLOAD_HEAVY", raising=False)
    monkeypatch.delenv("CREDIT_COST_GEMINI_IMAGE", raising=False)
    monkeypatch.delenv("CREDIT_COST_GEMINI_AUDIO", raising=False)
    monkeypatch.delenv("CREDIT_COST_GEMINI_AUDIO_FULL", raising=False)
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.delenv("GEMINI_API_KEY_FREE", raising=False)

    meta = {"tl-1": {"data": dict(TIMELINE), "owner_id": OWNER["id"], "is_shared": False}}
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: meta.get(tid))

    async def fake_generate(**kwargs):
        s = dict(SCRIPT)
        req_len = kwargs.get("length") or "full"
        s["length"] = req_len
        cur_tl = kwargs.get("current_timeline")
        articles = getattr(cur_tl, "articles", None) or []
        if len(articles) > 2:
            cap = 12 if req_len == "focused" else min(25, len(articles))
            segs = [dict(SCRIPT["segments"][0])]
            for idx, art in enumerate(articles[:cap], start=2):
                art_id = getattr(art, "id", None) or f"evt-{idx}"
                art_title = getattr(art, "title", None) or f"Event {idx}"
                segs.append(
                    {
                        "id": f"seg-{idx}",
                        "type": "event",
                        "event_id": art_id,
                        "chapter_title": art_title,
                        "turns": [{"speaker": "host1", "text": f"Story of {art_title}."}],
                    }
                )
            outro = dict(SCRIPT["segments"][-1])
            outro["id"] = f"seg-{len(segs) + 1}"
            segs.append(outro)
            s["segments"] = segs
        return {"script": s, "detected_language": "en", "tokenUsage": {}, "estimates": {"chapters": len(s["segments"])}}

    monkeypatch.setattr(main, "generate_timeline_podcast", fake_generate)
    fake_tts = FakeTts()
    monkeypatch.setattr(podcast_audio, "synthesize_segment", fake_tts)

    for limiter in (
        main.timeline_rate_limiter, main.podcast_audio_rate_limiter, main.podcast_stream_rate_limiter,
        main.podcast_activity_rate_limiter, main.podcast_view_rate_limiter,
    ):
        limiter.records.clear()

    current = {"user": OWNER}
    main.app.dependency_overrides[get_current_user_optional] = lambda: current["user"]
    main.app.dependency_overrides[get_current_user_required] = lambda: current["user"]
    with TestClient(main.app) as client:
        yield {"client": client, "meta": meta, "tts": fake_tts, "as_user": lambda u: current.__setitem__("user", u)}
    main.app.dependency_overrides.clear()


def _create_episode(client, engine="edge", length="full", timeline=None):
    tl = timeline or TIMELINE
    res = client.post(
        f"/api/timelines/{tl['id']}/podcasts/start",
        json={"timeline": tl, "format": "single", "voice_gender": "male", "length": length, "tts_engine": engine},
    )
    assert res.status_code == 200, res.text
    job_id = res.json()["job_id"]
    for _ in range(100):
        status = client.get(f"/api/timeline/job/status/{job_id}").json()
        if status["status"] != "pending":
            break
        time.sleep(0.02)
    assert status["status"] == "done", status
    return status["result"]


def _wait_variant(client, episode_id, engine="edge"):
    for _ in range(150):
        ep = client.get(f"/api/timelines/tl-1/podcasts/{episode_id}").json()
        if ep["audio"].get(engine, {}).get("status") in ("ready", "error", "partial"):
            return ep
        time.sleep(0.02)
    raise AssertionError("variant never finished rendering")


def test_old_arbitrary_text_tts_endpoint_is_gone(env):
    res = env["client"].post("/api/timeline/podcast/tts", json={"turns": [{"speaker": "host1", "text": "anything"}]})
    assert res.status_code in (404, 405)


def test_create_episode_renders_all_chapters_once_and_serves_cached_audio(env):
    client = env["client"]
    result = _create_episode(client)
    ep = result["episode"]
    assert ep["title"] == "Race to the Moon" and ep["is_mine"] and ep["default_engine"] == "edge"

    ready = _wait_variant(client, ep["id"])
    assert ready["audio"]["edge"]["status"] == "ready"
    assert set(ready["audio"]["edge"]["clips"]) == {"seg-1", "seg-2", "seg-3"}
    assert env["tts"].calls[0][1] == "Welcome aboard."  # intro rendered first
    renders_after_variant = len(env["tts"].calls)
    assert renders_after_variant == 3

    clip = client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/segments/seg-2/clip?engine=edge").json()
    assert clip["duration"] > 0 and clip["turn_starts"] == [0.0]
    assert len(env["tts"].calls) == renders_after_variant  # served from cache

    audio = client.get(f"/api/podcast-audio/{clip['key']}.mp3")
    assert audio.status_code == 200 and audio.headers["content-type"] == "audio/mpeg"
    assert "immutable" in audio.headers["cache-control"]
    partial = client.get(f"/api/podcast-audio/{clip['key']}.mp3", headers={"Range": "bytes=0-99"})
    assert partial.status_code == 206 and len(partial.content) == 100
    assert partial.headers["content-range"].endswith(f"/{len(audio.content)}")
    assert client.get(f"/api/podcast-audio/{clip['key']}.mp3", headers={"Range": "bytes=999999999-"}).status_code == 416
    assert client.get("/api/podcast-audio/not-a-key.mp3").status_code == 404


def test_download_is_one_mp3_with_title_tag(env):
    client = env["client"]
    ep = _create_episode(client)["episode"]
    res = client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/download?engine=edge")
    assert res.status_code == 200
    assert res.content[:3] == b"ID3"
    assert mp3_duration_seconds(res.content) > 1.4  # 3 chapters of 0.5s + pauses
    assert "attachment" in res.headers["content-disposition"]


def test_episode_audio_is_one_continuous_stream_with_chapter_offsets(env):
    client = env["client"]
    ep = _create_episode(client)["episode"]
    _wait_variant(client, ep["id"])
    renders = len(env["tts"].calls)

    res = client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/episode-audio?engine=edge")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ready"] is True
    assert [c["id"] for c in body["chapters"]] == ["seg-1", "seg-2", "seg-3"]
    starts = [c["start"] for c in body["chapters"]]
    assert starts[0] == 0.0 and starts == sorted(starts)
    assert all(c["turn_starts"] == [0.0] for c in body["chapters"])
    assert len(env["tts"].calls) == renders  # joining never re-renders speech

    stream = client.get(body["url"])
    assert stream.status_code == 200 and stream.headers["content-type"] == "audio/mpeg"
    assert abs(mp3_duration_seconds(stream.content) - body["duration"]) < 0.01
    assert client.get(body["url"], headers={"Range": "bytes=0-99"}).status_code == 206

    again = client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/episode-audio?engine=edge").json()
    assert again["key"] == body["key"]


def test_episode_audio_not_ready_until_every_chapter_is_rendered(env):
    client = env["client"]
    ep = _create_episode(client)["episode"]
    _wait_variant(client, ep["id"])
    assert client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/episode-audio?engine=gcloud").json() == {"ready": False}
    assert client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/episode-audio?engine=gemini").status_code == 402
    env["as_user"](STRANGER)
    assert client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/episode-audio?engine=edge").status_code == 404


def test_chapters_from_an_older_provider_version_are_replaced_as_they_are_played(env):
    client = env["client"]
    ep = _create_episode(client)["episode"]
    _wait_variant(client, ep["id"])

    # Simulate an episode rendered before a PROVIDER_VERSION bump: its recorded clip keys are stale.
    doc = podcast_store.get_episode("tl-1", ep["id"])
    for state in (doc["audio"]["edge"], doc["audio"]["edge"]["by_gender"]["male"]):
        for summary in state["clips"].values():
            summary["key"] = "0" * 64
    doc["audio"]["edge"]["by_gender"]["male"].pop("episode_audio", None)
    podcast_store.save_episode(doc)
    url = f"/api/timelines/tl-1/podcasts/{ep['id']}/episode-audio?engine=edge"
    assert client.get(url).json() == {"ready": False}

    for seg in ("seg-1", "seg-2", "seg-3"):
        assert client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/segments/{seg}/clip?engine=edge").status_code == 200
    assert client.get(url).json()["ready"] is True


def test_private_timeline_episodes_are_hidden_from_strangers(env):
    client = env["client"]
    ep = _create_episode(client)["episode"]
    env["as_user"](STRANGER)
    assert client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}").status_code == 404
    assert client.get("/api/timelines/tl-1/podcasts").status_code == 404
    assert client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/segments/seg-1/clip").status_code == 404
    res = client.post("/api/timelines/tl-1/podcasts/start", json={"timeline": TIMELINE})
    assert res.status_code == 404


def test_shared_timeline_publishes_owner_episodes_only(env):
    client = env["client"]
    owner_ep = _create_episode(client)["episode"]
    env["meta"]["tl-1"]["is_shared"] = True

    env["as_user"](VIEWER)
    listed = client.get("/api/timelines/tl-1/podcasts").json()["episodes"]
    assert [e["id"] for e in listed] == [owner_ep["id"]]
    assert listed[0]["is_mine"] is False and listed[0]["can_manage"] is False
    viewer_ep = _create_episode(client)["episode"]
    assert client.delete(f"/api/timelines/tl-1/podcasts/{owner_ep['id']}").status_code == 403

    env["as_user"](STRANGER)
    ids = [e["id"] for e in client.get("/api/timelines/tl-1/podcasts").json()["episodes"]]
    assert owner_ep["id"] in ids and viewer_ep["id"] not in ids

    env["as_user"](OWNER)
    ids = [e["id"] for e in client.get("/api/timelines/tl-1/podcasts").json()["episodes"]]
    assert viewer_ep["id"] in ids
    assert client.delete(f"/api/timelines/tl-1/podcasts/{viewer_ep['id']}").status_code == 200


def test_legacy_embedded_podcast_is_migrated(env):
    client = env["client"]
    env["meta"]["tl-1"]["data"]["podcast"] = {
        "title": "Old show", "format": "duo", "tts_engine": "gemini",
        "segments": [{"type": "intro", "turns": [{"speaker": "host2", "text": "x" * 5000}, {"speaker": "host1", "text": "Hi"}]}],
    }
    episodes = client.get("/api/timelines/tl-1/podcasts").json()["episodes"]
    legacy = next(e for e in episodes if e["id"] == "legacy")
    assert legacy["source"] == "legacy" and legacy["default_engine"] == "edge"
    assert len(legacy["segments"][0]["turns"][0]["text"]) <= 1500


def test_premium_audio_clip_refused_until_unlocked_and_unlock_charges_20_credits_for_full_story(env):
    client = env["client"]
    env["meta"]["tl-1"]["data"] = dict(LONG_TIMELINE)
    used_before = quota_service.get_user_daily_usage(OWNER["id"])
    ep = _create_episode(client, engine="edge", length="full", timeline=LONG_TIMELINE)["episode"]
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 1
    assert client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/segments/seg-1/clip?engine=gemini").status_code == 402

    res = client.post(f"/api/timelines/tl-1/podcasts/{ep['id']}/audio", json={"engine": "gemini"})
    assert res.status_code == 200
    assert res.json()["audio"]["gemini"]["unlocked"] is True
    # Full story (> 12 events) charges 20 credits for Gemini audio (1 script + 20 audio = 21 total)
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 21


def test_full_story_gemini_generation_charges_21_credits_on_long_timeline(env):
    client = env["client"]
    env["meta"]["tl-1"]["data"] = dict(LONG_TIMELINE)
    used_before = quota_service.get_user_daily_usage(OWNER["id"])
    result = _create_episode(client, engine="gemini", length="full", timeline=LONG_TIMELINE)
    assert result.get("notice") is None
    assert result["episode"]["default_engine"] == "gemini"
    assert result["episode"]["audio"]["gemini"]["unlocked"] is True
    # 1 credit for script + 20 credits for full-story (> 12 events) Gemini audio = 21 credits
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 21


def test_full_story_gemini_audio_on_short_timeline_charges_10_credits_not_20(env):
    """Short timelines (<= 12 events) have identical event coverage in 'full' and 'focused', so charge 10 audio credits."""
    client = env["client"]
    used_before = quota_service.get_user_daily_usage(OWNER["id"])
    result = _create_episode(client, engine="gemini", length="full", timeline=TIMELINE)
    assert result.get("notice") is None
    assert result["episode"]["default_engine"] == "gemini"
    assert result["episode"]["audio"]["gemini"]["unlocked"] is True
    # 1 credit for script + 10 credits for Gemini audio (short timeline safeguard) = 11 credits
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 11


def test_guest_gemini_audio_allowed_for_focused_length(env):
    client = env["client"]
    used_before = quota_service.get_user_daily_usage(OWNER["id"])
    result = _create_episode(client, engine="gemini", length="focused")
    assert result.get("notice") is None
    assert result["episode"]["default_engine"] == "gemini"
    assert result["episode"]["audio"]["gemini"]["unlocked"] is True
    # Consumes 11 credits: 1 for script + 10 for Gemini audio
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 11


def test_gemini_audio_switch_on_focused_episode_consumes_extra_credit(env):
    client = env["client"]
    used_before = quota_service.get_user_daily_usage(OWNER["id"])
    # 1 credit for script with edge (0 for free audio)
    ep = _create_episode(client, engine="edge", length="focused")["episode"]
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 1

    # Switch to gemini on focused episode without personal key -> succeeds, takes 10 extra credits
    res = client.post(f"/api/timelines/tl-1/podcasts/{ep['id']}/audio", json={"engine": "gemini"})
    assert res.status_code == 200
    assert res.json()["audio"]["gemini"]["unlocked"] is True
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 11


def test_full_story_gemini_audio_falls_back_or_rejects_with_402_when_under_20_credits(env, monkeypatch):
    client = env["client"]
    env["meta"]["tl-1"]["data"] = dict(LONG_TIMELINE)
    # 15 daily credits: enough for Highlights (1 + 10 = 11), NOT enough for Full story (1 + 20 = 21)
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "15")

    used_before = quota_service.get_user_daily_usage(OWNER["id"])
    result = _create_episode(client, engine="gemini", length="full", timeline=LONG_TIMELINE)
    assert result["notice"] == "premium_quota_exhausted"
    ep = result["episode"]
    assert ep["default_engine"] == "edge"
    assert not ep["audio"].get("gemini", {}).get("unlocked")
    # Only the 1 script credit was charged; all 14 remaining credits are preserved!
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 1

    res = client.post(f"/api/timelines/tl-1/podcasts/{ep['id']}/audio", json={"engine": "gemini"})
    assert res.status_code == 402
    assert "requires 20 credits" in res.json().get("detail", "")
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 1


def test_premium_audio_unlocks_with_personal_key_and_allows_listeners(env):
    client = env["client"]
    ep = _create_episode(client, engine="edge")["episode"]
    custom_headers = {"X-Gemini-Api-Key": "AIzaSy_CUSTOM_USER_KEY"}

    unlocked_res = client.post(
        f"/api/timelines/tl-1/podcasts/{ep['id']}/audio",
        json={"engine": "gemini"},
        headers=custom_headers,
    )
    assert unlocked_res.status_code == 200, unlocked_res.text
    unlocked = unlocked_res.json()
    assert unlocked["audio"]["gemini"]["unlocked"] is True
    _wait_variant(client, ep["id"], "gemini")

    env["meta"]["tl-1"]["is_shared"] = True
    env["as_user"](VIEWER)
    clip = client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/segments/seg-1/clip?engine=gemini")
    assert clip.status_code == 200 and clip.json()["engine"] == "gemini"


def test_admin_can_unlock_gemini_without_custom_key(env):
    client = env["client"]
    admin_user = {"id": "admin-1", "email": "admin@example.com", "role": "admin"}
    env["as_user"](admin_user)
    ep = _create_episode(client, engine="edge")["episode"]
    unlocked_res = client.post(f"/api/timelines/tl-1/podcasts/{ep['id']}/audio", json={"engine": "gemini"})
    assert unlocked_res.status_code == 200
    assert unlocked_res.json()["audio"]["gemini"]["unlocked"] is True


def test_clip_endpoint_is_rate_limited(env):
    client = env["client"]
    ep = _create_episode(client)["episode"]
    main.podcast_audio_rate_limiter.records.clear()
    url = f"/api/timelines/tl-1/podcasts/{ep['id']}/segments/seg-1/clip?engine=edge"
    codes = [client.get(url).status_code for _ in range(main.podcast_audio_rate_limiter.max_requests + 1)]
    assert codes[-1] == 429 and codes[0] == 200


def test_listen_report_is_accepted(env):
    res = env["client"].post(
        "/api/activity/podcast",
        json={"event": "session_end", "timeline_id": "tl-1", "listened_seconds": 30, "episode_seconds": 60, "chapters_total": 3},
    )
    assert res.status_code == 204


def test_episode_exposes_music_mood_with_safe_default(env):
    client = env["client"]
    ep = _create_episode(client)["episode"]
    assert ep["music_mood"] == "sunrise_piano"
    _wait_variant(client, ep["id"])

    stored = podcast_store.get_episode("tl-1", ep["id"])
    stored["music_mood"] = "dubstep"
    stored["content_mode"] = "kids"
    podcast_store.save_episode(stored)
    assert client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}").json()["music_mood"] == "indie_groove"

    # Legacy mood strings on stored episodes map deterministically into the 9 curated scores.
    stored["music_mood"] = "epic"
    stored["content_mode"] = "classic"
    podcast_store.save_episode(stored)
    mapped = client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}").json()["music_mood"]
    assert mapped in ("cinematic_orchestra", "modern_tension")


def test_listen_report_records_music_settings(env, monkeypatch):
    logged = []
    monkeypatch.setattr(main, "log_podcast_listen", lambda user, **kw: logged.append(kw))
    res = env["client"].post(
        "/api/activity/podcast",
        json={"event": "session_end", "listened_seconds": 30, "episode_seconds": 60, "music_enabled": True, "music_mood": "cinematic_orchestra"},
    )
    assert res.status_code == 204
    assert logged[-1]["details"]["music_enabled"] is True
    assert logged[-1]["details"]["music_mood"] == "cinematic_orchestra"

    env["client"].post("/api/activity/podcast", json={"event": "session_end", "music_mood": "<script>"})
    assert logged[-1]["details"]["music_mood"] is None


def test_switch_voice_gender_on_existing_episode_reuses_script_and_caches_per_gender(env):
    client = env["client"]
    ep = _create_episode(client, engine="edge")["episode"]
    _wait_variant(client, ep["id"], "edge")
    assert ep["voice_gender"] == "male"
    assert ep["host1_name"] == "Michael"
    calls_after_male = len(env["tts"].calls)
    assert calls_after_male == 3

    used_before = quota_service.get_user_daily_usage(OWNER["id"])
    res = client.post(
        f"/api/timelines/tl-1/podcasts/{ep['id']}/audio",
        json={"engine": "edge", "voice_gender": "female"},
    )
    assert res.status_code == 200
    switched = res.json()
    assert switched["voice_gender"] == "female"
    assert switched["host1_name"] == "Maya"

    done_female = _wait_variant(client, ep["id"], "edge")
    assert done_female["voice_gender"] == "female"
    assert done_female["audio"]["edge"]["status"] == "ready"
    assert len(env["tts"].calls) == calls_after_male + 3
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before

    # Switching back to male restores already-rendered male clips immediately without new TTS calls
    res_back = client.post(
        f"/api/timelines/tl-1/podcasts/{ep['id']}/audio",
        json={"engine": "edge", "voice_gender": "male"},
    )
    assert res_back.status_code == 200
    back_ep = res_back.json()
    assert back_ep["voice_gender"] == "male"
    assert back_ep["host1_name"] == "Michael"
    assert back_ep["audio"]["edge"]["status"] == "ready"
    assert len(back_ep["audio"]["edge"]["clips"]) == 3
    assert len(env["tts"].calls) == calls_after_male + 3


def test_start_podcast_with_different_voice_gender_reuses_existing_script_without_extra_quota(env, monkeypatch):
    client = env["client"]
    gen_calls = []

    async def counting_generate(**kwargs):
        gen_calls.append(kwargs)
        return {"script": SCRIPT, "detected_language": "en", "tokenUsage": {}, "estimates": {"chapters": 3}}

    monkeypatch.setattr(main, "generate_timeline_podcast", counting_generate)

    first = _create_episode(client, engine="edge")
    ep1 = first["episode"]
    _wait_variant(client, ep1["id"], "edge")
    assert len(gen_calls) == 1
    used_after_first = quota_service.get_user_daily_usage(OWNER["id"])

    # Starting again with female voice reuses the script without calling generate_timeline_podcast or spending script quota
    res = client.post(
        "/api/timelines/tl-1/podcasts/start",
        json={"timeline": TIMELINE, "format": "single", "voice_gender": "female", "length": "full", "tts_engine": "edge"},
    )
    assert res.status_code == 200
    job_id = res.json()["job_id"]
    for _ in range(100):
        status = client.get(f"/api/timeline/job/status/{job_id}").json()
        if status["status"] != "pending":
            break
        time.sleep(0.02)
    assert status["status"] == "done", status
    second = status["result"]
    assert second.get("reused_script") is True
    assert second["episode"]["id"] == ep1["id"]
    assert second["episode"]["voice_gender"] == "female"
    assert second["episode"]["host1_name"] == "Maya"
    assert len(gen_calls) == 1
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_after_first


def test_generate_event_image_premium_allowed_without_custom_key_and_consumes_credit(env, monkeypatch):
    client = env["client"]
    captured = {}

    async def fake_image_gen(**kwargs):
        captured.update(kwargs)
        return {"imageUrl": "data:image/jpeg;base64,123", "model": "gemini:imagen", "promptUsed": "test"}

    monkeypatch.setattr(main, "generate_event_image_with_gemini", fake_image_gen)

    used_before = quota_service.get_user_daily_usage(OWNER["id"])
    res = client.post(
        "/api/timeline/generate-event-image",
        json={"title": "Moon Landing", "year": 1969, "engine": "premium"},
    )
    assert res.status_code == 200
    assert captured.get("prefer_free") is False
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 6


def test_generate_event_image_refunds_quota_on_failure(env, monkeypatch):
    client = env["client"]

    async def failing_image_gen(**kwargs):
        raise RuntimeError("Image generation failed")

    monkeypatch.setattr(main, "generate_event_image_with_gemini", failing_image_gen)

    # Pre-record 2 credits so we verify only the 6 image credits are refunded back to 2 (not 0 or 5)
    quota_service.record_prompt_usage(OWNER["id"], credits=2)
    used_before = quota_service.get_user_daily_usage(OWNER["id"])
    assert used_before == 2
    res = client.post(
        "/api/timeline/generate-event-image",
        json={"title": "Moon Landing", "year": 1969, "engine": "premium"},
    )
    assert res.status_code == 500
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before


def test_generate_event_image_auto_defaults_to_free_without_custom_key(env, monkeypatch):
    client = env["client"]
    captured = {}

    async def fake_image_gen(**kwargs):
        captured.update(kwargs)
        return {"imageUrl": "data:image/jpeg;base64,123", "model": "pollinations:flux", "promptUsed": "test"}

    monkeypatch.setattr(main, "generate_event_image_with_gemini", fake_image_gen)

    res = client.post(
        "/api/timeline/generate-event-image",
        json={"title": "Moon Landing", "year": 1969, "engine": "auto"},
    )
    assert res.status_code == 200
    assert captured.get("prefer_free") is True


def test_generate_event_image_premium_allowed_with_custom_key(env, monkeypatch):
    client = env["client"]
    captured = {}

    async def fake_image_gen(**kwargs):
        captured.update(kwargs)
        return {"imageUrl": "data:image/jpeg;base64,123", "model": "gemini:imagen", "promptUsed": "test"}

    monkeypatch.setattr(main, "generate_event_image_with_gemini", fake_image_gen)

    res = client.post(
        "/api/timeline/generate-event-image",
        json={"title": "Moon Landing", "year": 1969, "engine": "premium"},
        headers={"X-Gemini-Api-Key": "AIzaSyCustomPersonalKey"},
    )
    assert res.status_code == 200
    assert captured.get("prefer_free") is False
    assert captured.get("api_key") == "AIzaSyCustomPersonalKey"


def test_podcast_episode_persists_and_exposes_script_and_gemini_audio_costs(env, monkeypatch):
    client = env["client"]

    async def fake_generate_with_cost(**kwargs):
        s = dict(SCRIPT)
        s["length"] = kwargs.get("length") or "focused"
        return {
            "script": s,
            "detected_language": "en",
            "tokenUsage": {
                "model": "gemini-3.8-flash",
                "promptTokens": 4000,
                "candidatesTokens": 1200,
                "thoughtsTokens": 300,
                "totalTokens": 5500,
                "estimatedCostUsd": 0.0024,
            },
            "estimates": {"chapters": 3},
        }

    monkeypatch.setattr(main, "generate_timeline_podcast", fake_generate_with_cost)

    created = _create_episode(client, engine="gemini", length="focused")
    ep = created["episode"]
    assert ep["script_cost_usd"] == pytest.approx(0.0024)
    assert ep["tokenUsage"]["estimatedCostUsd"] == pytest.approx(0.0024)

    done = _wait_variant(client, ep["id"], "gemini")
    assert done["script_cost_usd"] == pytest.approx(0.0024)
    # FakeTts records cost_usd=0.001 per chapter across 3 chapters
    assert done["audio"]["gemini"]["rendered_clips"] == 3
    assert done["audio"]["gemini"]["cost_usd"] == pytest.approx(0.003)

    listed = client.get("/api/timelines/tl-1/podcasts").json()["episodes"]
    assert listed[0]["script_cost_usd"] == pytest.approx(0.0024)
    assert listed[0]["audio"]["gemini"]["cost_usd"] == pytest.approx(0.003)

    clip = client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/segments/seg-1/clip?engine=gemini").json()
    assert clip["cost_usd"] == pytest.approx(0.001)


def test_generate_event_image_exposes_cost_and_timeline_article_preserves_it(env, monkeypatch):
    from models import TimelineArticle

    client = env["client"]

    async def fake_gemini_image(**kwargs):
        return {
            "imageUrl": "data:image/jpeg;base64,abc",
            "imageSource": "ai",
            "model": "gemini-3.1-flash-image",
            "promptUsed": "moon",
            "imageCostUsd": 0.03912,
            "tokenUsage": {
                "operation": "Generate Event Image",
                "model": "gemini-3.1-flash-image",
                "totalTokens": 1350,
                "estimatedCostUsd": 0.03912,
            },
        }

    monkeypatch.setattr(main, "generate_event_image_with_gemini", fake_gemini_image)

    res = client.post(
        "/api/timeline/generate-event-image",
        json={"title": "Moon Landing", "year": 1969, "engine": "premium"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["imageCostUsd"] == pytest.approx(0.03912)
    assert body["tokenUsage"]["estimatedCostUsd"] == pytest.approx(0.03912)

    article = TimelineArticle.model_validate(
        {
            "id": "evt-1",
            "title": "Moon Landing",
            "from": {"year": 1969},
            "imageUrl": body["imageUrl"],
            "imageSource": "ai",
            "imageModel": body["model"],
            "imageCostUsd": body["imageCostUsd"],
        }
    )
    dumped = article.model_dump(by_alias=True)
    assert dumped["imageCostUsd"] == pytest.approx(0.03912)


def test_gemini_image_blocked_when_premium_credits_exhausted_while_free_remains_open(env, monkeypatch):
    client = env["client"]
    monkeypatch.setenv("API_KEY_MODE", "limited")
    # 8 credits: enough for 1 Gemini image (6 credits) + 2 credits left over (< 6 for a second image)
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "8")

    calls = []

    async def fake_image_gen(**kwargs):
        calls.append(kwargs)
        return {
            "imageUrl": "data:image/jpeg;base64,123",
            "model": "pollinations-flux" if kwargs.get("prefer_free") else "gemini-3.1-flash-image",
            "promptUsed": "moon",
        }

    monkeypatch.setattr(main, "generate_event_image_with_gemini", fake_image_gen)

    # First premium image uses 6 credits -> succeeds, leaving 2 credits.
    first = client.post(
        "/api/timeline/generate-event-image",
        json={"title": "Moon Landing", "year": 1969, "engine": "premium"},
    )
    assert first.status_code == 200
    assert calls[-1]["prefer_free"] is False

    quota_now = client.get("/api/user/quota").json()
    assert quota_now["used_today"] == 6
    assert quota_now["remaining_paid"] == 2
    assert quota_now["tier"] == "paid"
    assert quota_now["credit_costs"] == {
        "text": 1,
        "upload_medium": 2,
        "upload_heavy": 3,
        "gemini_image": 6,
        "gemini_audio": 10,
        "gemini_audio_full": 20,
    }

    # Second premium image requires 6 credits (> 2 remaining) -> blocked (402) WITHOUT deducting the 2 remaining credits!
    calls_before = len(calls)
    used_before = quota_service.get_user_daily_usage(OWNER["id"])
    blocked = client.post(
        "/api/timeline/generate-event-image",
        json={"title": "Apollo 12", "year": 1969, "engine": "premium"},
    )
    assert blocked.status_code == 402
    assert "requires 6 credits" in blocked.json().get("detail", "")
    assert len(calls) == calls_before
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before

    # Free engine remains open (0 credits) and keeps the 2 remaining credits intact.
    free_ok = client.post(
        "/api/timeline/generate-event-image",
        json={"title": "Apollo 12", "year": 1969, "engine": "free"},
    )
    assert free_ok.status_code == 200
    assert calls[-1]["prefer_free"] is True
    assert quota_service.get_user_daily_usage(OWNER["id"]) == 6

    # Personal Gemini API key still unlocks premium image generation without touching server credits.
    byok_ok = client.post(
        "/api/timeline/generate-event-image",
        json={"title": "Apollo 13", "year": 1970, "engine": "premium"},
        headers={"X-Gemini-Api-Key": "AIzaSyCustomPersonalKey"},
    )
    assert byok_ok.status_code == 200
    assert calls[-1]["prefer_free"] is False
    assert calls[-1]["api_key"] == "AIzaSyCustomPersonalKey"
    assert quota_service.get_user_daily_usage(OWNER["id"]) == 6


def test_gemini_podcast_audio_blocked_when_premium_credits_exhausted(env, monkeypatch):
    client = env["client"]
    monkeypatch.setenv("API_KEY_MODE", "limited")
    # 5 credits: script takes 1 credit -> 4 remaining (< 10 required for Gemini audio)
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "5")

    # Generating the script consumes 1 credit, leaving 4 credits (< 10 needed for Gemini audio)
    # -> falls back to 'edge' with notice='premium_quota_exhausted' and preserves all 4 remaining credits!
    created = _create_episode(client, engine="gemini", length="focused")
    assert created["notice"] == "premium_quota_exhausted"
    ep = created["episode"]
    assert ep["default_engine"] == "edge"
    assert not ep["audio"].get("gemini", {}).get("unlocked")

    quota_now = client.get("/api/user/quota").json()
    assert quota_now["used_today"] == 1
    assert quota_now["remaining_paid"] == 4
    assert quota_now["tier"] == "paid"

    # Unlocking Gemini audio on the focused episode with 4 credits left (< 10) is rejected with 402 without deducting.
    used_before = quota_service.get_user_daily_usage(OWNER["id"])
    blocked = client.post(f"/api/timelines/tl-1/podcasts/{ep['id']}/audio", json={"engine": "gemini"})
    assert blocked.status_code == 402
    assert "requires 10 credits" in blocked.json().get("detail", "")
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before

    # Free voice engine ('edge') remains open (0 credits).
    free_audio = client.post(f"/api/timelines/tl-1/podcasts/{ep['id']}/audio", json={"engine": "edge"})
    assert free_audio.status_code == 200
    assert quota_service.get_user_daily_usage(OWNER["id"]) == 1

    # Personal API key still unlocks Gemini audio even with insufficient server credits.
    byok_audio = client.post(
        f"/api/timelines/tl-1/podcasts/{ep['id']}/audio",
        json={"engine": "gemini"},
        headers={"X-Gemini-Api-Key": "AIzaSyCustomPersonalKey"},
    )
    assert byok_audio.status_code == 200
    assert byok_audio.json()["audio"]["gemini"]["unlocked"] is True


def test_gemini_podcast_audio_refunds_all_10_credits_if_every_chapter_falls_back(env):
    client = env["client"]
    env["tts"].fail_engines.add("gemini")

    used_before = quota_service.get_user_daily_usage(OWNER["id"])
    created = _create_episode(client, engine="gemini", length="focused")
    ep = created["episode"]
    _wait_variant(client, ep["id"], "gemini")
    stored = None
    for _ in range(50):
        stored = podcast_store.get_episode("tl-1", ep["id"])
        if stored["audio"]["gemini"].get("refunded"):
            break
        time.sleep(0.02)
    # Script cost (1 credit) stays charged, while all 10 Gemini audio credits are refunded!
    assert stored["audio"]["gemini"].get("refunded") is True
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 1


def test_gemini_podcast_audio_refunds_all_20_credits_on_full_story_if_every_chapter_falls_back(env):
    client = env["client"]
    env["meta"]["tl-1"]["data"] = dict(LONG_TIMELINE)
    env["tts"].fail_engines.add("gemini")

    used_before = quota_service.get_user_daily_usage(OWNER["id"])
    created = _create_episode(client, engine="gemini", length="full", timeline=LONG_TIMELINE)
    ep = created["episode"]
    _wait_variant(client, ep["id"], "gemini")
    stored = None
    for _ in range(50):
        stored = podcast_store.get_episode("tl-1", ep["id"])
        if stored["audio"]["gemini"].get("refunded"):
            break
        time.sleep(0.02)
    # Script cost (1 credit) stays charged, while all 20 full-story Gemini audio credits are refunded!
    assert stored["audio"]["gemini"].get("refunded") is True
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 1


def test_hebrew_podcast_defaults_to_gcloud_while_english_defaults_to_edge(env, monkeypatch):
    client = env["client"]
    monkeypatch.setenv("GOOGLE_CLOUD_TTS_API_KEY", "gcloud-test-key")

    he_timeline = {
        "id": "tl-he",
        "title": "המרוץ לחלל",
        "detectedLanguage": "he",
        "articles": [
            {"id": "evt-1", "title": "ספוטניק", "from": {"year": 1957}},
            {"id": "evt-2", "title": "אפולו 11", "from": {"year": 1969}},
        ],
    }
    env["meta"]["tl-he"] = {"data": he_timeline, "owner_id": OWNER["id"], "is_shared": False}

    async def fake_generate_he(**kwargs):
        cur_tl = kwargs.get("current_timeline")
        lang = getattr(cur_tl, "detectedLanguage", None) or "en"
        s = dict(SCRIPT)
        s["detected_language"] = lang
        return {"script": s, "detected_language": lang, "tokenUsage": {}, "estimates": {"chapters": 3}}

    monkeypatch.setattr(main, "generate_timeline_podcast", fake_generate_he)

    # Hebrew timeline with no explicit tts_engine defaults to Google Cloud ('gcloud')
    res_he = client.post(
        "/api/timelines/tl-he/podcasts/start",
        json={"timeline": he_timeline, "format": "single", "voice_gender": "male", "length": "focused"},
    )
    assert res_he.status_code == 200
    job_he = res_he.json()["job_id"]
    for _ in range(100):
        status = client.get(f"/api/timeline/job/status/{job_he}").json()
        if status["status"] != "pending":
            break
        time.sleep(0.02)
    assert status["status"] == "done"
    assert status["result"]["episode"]["default_engine"] == "gcloud"

    # English timeline with no explicit tts_engine stays on Edge-TTS ('edge')
    res_en = client.post(
        "/api/timelines/tl-1/podcasts/start",
        json={"timeline": TIMELINE, "format": "single", "voice_gender": "male", "length": "focused"},
    )
    assert res_en.status_code == 200
    job_en = res_en.json()["job_id"]
    for _ in range(100):
        status = client.get(f"/api/timeline/job/status/{job_en}").json()
        if status["status"] != "pending":
            break
        time.sleep(0.02)
    assert status["status"] == "done"
    assert status["result"]["episode"]["default_engine"] == "edge"





