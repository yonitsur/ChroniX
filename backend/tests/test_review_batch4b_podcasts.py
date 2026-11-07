"""Batch 4B podcast fixes: premium billing (B-10), stuck renders and delete races (B-22) and guest
claims during a podcast job (B-24)."""
import asyncio
import copy
import time
from datetime import datetime, timezone

import pytest

import main
from services import podcast_audio, podcast_store, quota_service
from test_podcast_api import (  # noqa: F401  (env is a fixture)
    OWNER,
    SCRIPT,
    TIMELINE,
    VIEWER,
    _create_episode,
    _wait_variant,
    env,
)


def _wait_refunded(episode_id, gender):
    for _ in range(100):
        doc = podcast_store.get_episode("tl-1", episode_id)
        if ((doc["audio"]["gemini"].get("by_gender") or {}).get(gender) or {}).get("refunded"):
            return doc
        time.sleep(0.02)
    raise AssertionError("never refunded")


def _seed(episode_id, owner, audio, voice_gender="male"):
    doc = copy.deepcopy(SCRIPT)
    now = datetime.now(timezone.utc).isoformat()
    doc.update({
        "id": episode_id, "timeline_id": "tl-1", "owner_id": owner, "created_at": now, "updated_at": now,
        "source": "generated", "default_engine": "edge", "voice_gender": voice_gender, "audio": audio,
    })
    podcast_store.save_episode(doc)
    return doc


# --- B-10 (a) -----------------------------------------------------------------------------

def test_recharging_resets_refund_markers_at_both_levels():
    doc = {"voice_gender": "male", "audio": {"gemini": {"refunded": True, "by_gender": {"male": {"refunded": True}}}}}
    main._mark_gemini_gender_charged(doc, "male", paid_with="credits", charge={"credits": 10})
    state = doc["audio"]["gemini"]
    assert "refunded" not in state and "refunded" not in state["by_gender"]["male"]
    assert state["by_gender"]["male"]["paid_with"] == "credits"
    # Re-marking an already-paid variant (no new charge) leaves its payment record alone.
    main._mark_gemini_gender_charged(doc, "male")
    assert state["by_gender"]["male"]["charge"] == {"credits": 10}


def test_each_failed_premium_render_is_refunded_not_only_the_first(env):
    client = env["client"]
    env["tts"].fail_engines.add("gemini")
    used_before = quota_service.get_user_daily_usage(OWNER["id"])
    ep = _create_episode(client, engine="gemini", length="focused")["episode"]
    _wait_variant(client, ep["id"], "gemini")
    _wait_refunded(ep["id"], "male")
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 1  # only the script

    # The other voice: a fresh charge (refund markers reset) that also fails, and is refunded too.
    res = client.post(f"/api/timelines/tl-1/podcasts/{ep['id']}/audio", json={"engine": "gemini", "voice_gender": "female"})
    assert res.status_code == 200, res.text
    _wait_refunded(ep["id"], "female")
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 1

    # And the first voice again, after its earlier refund.
    res = client.post(f"/api/timelines/tl-1/podcasts/{ep['id']}/audio", json={"engine": "gemini", "voice_gender": "male"})
    assert res.status_code == 200
    for _ in range(100):
        if quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 1 and podcast_store.get_episode(
            "tl-1", ep["id"]
        )["audio"]["gemini"]["by_gender"]["male"].get("refunded"):
            break
        time.sleep(0.02)
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used_before + 1


# --- B-10 (b) -----------------------------------------------------------------------------

def test_public_episode_reports_unlock_per_gender():
    doc = {
        "id": "e1", "timeline_id": "tl-1", "voice_gender": "male",
        "audio": {"gemini": {"charged": True, "by_gender": {"male": {"charged": True, "status": "ready", "clips": {}}}},
                  "edge": {"status": "ready", "clips": {}}},
    }
    pub = main._public_episode(doc, OWNER, {"owner_id": OWNER["id"]})
    assert pub["audio"]["gemini"]["unlocked_genders"] == {"male": True, "female": False}
    assert pub["audio"]["edge"]["unlocked_genders"] == {"male": True, "female": True}


# --- B-10 (c) -----------------------------------------------------------------------------

def test_byok_unlocked_variant_never_renders_on_the_server_key_for_viewers(env):
    client = env["client"]
    env["meta"]["tl-1"]["is_shared"] = True
    ep = _create_episode(client, engine="edge")["episode"]
    byok = client.post(
        f"/api/timelines/tl-1/podcasts/{ep['id']}/audio",
        json={"engine": "gemini"}, headers={"X-Gemini-Api-Key": "AIzaSyCustomPersonalKey"},
    )
    assert byok.status_code == 200
    _wait_variant(client, ep["id"], "gemini")
    stored = podcast_store.get_episode("tl-1", ep["id"])
    assert stored["audio"]["gemini"]["by_gender"]["male"]["paid_with"] == "byok"
    assert main._is_gemini_gender_server_paid(stored, "male") is False

    # A provider bump makes every stored chapter stale; a viewer without a key must not re-render it.
    env["as_user"](VIEWER)
    gemini_calls = len([c for c in env["tts"].calls if c[0] == "gemini"])
    clip = client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/segments/seg-2/clip?engine=gemini")
    assert clip.status_code == 200
    assert clip.json()["engine"] == "gemini"  # what exists is served
    stored["segments"][1]["turns"][0]["text"] = "Changed text, so no Gemini clip exists for it."
    podcast_store.save_episode(stored)
    clip = client.get(f"/api/timelines/tl-1/podcasts/{ep['id']}/segments/seg-2/clip?engine=gemini")
    assert clip.status_code == 200
    assert len([c for c in env["tts"].calls if c[0] == "gemini"]) == gemini_calls
    assert clip.json()["engine"] != "gemini" or clip.json().get("key") == stored["audio"]["gemini"]["by_gender"]["male"]["clips"]["seg-2"]["key"]

    # And requesting the variant doesn't start a server-key background render either.
    res = client.post(f"/api/timelines/tl-1/podcasts/{ep['id']}/audio", json={"engine": "gemini"})
    assert res.status_code == 200
    assert not podcast_audio.is_variant_rendering(ep["id"], "gemini", "male")
    assert res.json()["audio"]["gemini"]["status"] != "rendering"


def test_credit_paid_variant_still_renders_for_viewers():
    doc = {"voice_gender": "male", "audio": {"gemini": {"charged": True, "by_gender": {"male": {"charged": True, "paid_with": "credits"}}}}}
    assert main._is_gemini_gender_server_paid(doc, "male") is True
    legacy = {"voice_gender": "male", "audio": {"gemini": {"charged": True, "by_gender": {"male": {"charged": True}}}}}
    assert main._is_gemini_gender_server_paid(legacy, "male") is True
    admin = {"voice_gender": "male", "audio": {"gemini": {"charged": True, "by_gender": {"male": {"charged": True, "paid_with": "admin"}}}}}
    assert main._is_gemini_gender_server_paid(admin, "male") is False


# --- B-22 ---------------------------------------------------------------------------------

def test_rendering_without_a_live_task_or_lease_reads_as_partial():
    base = {"id": "stuck-1", "timeline_id": "tl-1", "voice_gender": "male"}
    expired = dict(base, audio={"edge": {"by_gender": {"male": {"status": "rendering", "clips": {}, "render_lease_until": 0}}}})
    assert main._public_episode(expired, OWNER, None)["audio"]["edge"]["status"] == "partial"
    leased = dict(base, audio={"edge": {"by_gender": {"male": {"status": "rendering", "clips": {}, "render_lease_until": time.time() + 60}}}})
    assert main._public_episode(leased, OWNER, None)["audio"]["edge"]["status"] == "rendering"


def test_stalled_premium_render_is_refunded_when_the_payer_looks(env):
    client = env["client"]
    quota_service.record_prompt_usage(OWNER["id"], credits=10)
    used = quota_service.get_user_daily_usage(OWNER["id"])
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    _seed("stalled-1", OWNER["id"], {"gemini": {"charged": True, "charged_genders": ["male"], "by_gender": {"male": {
        "status": "rendering", "clips": {}, "charged": True, "paid_with": "credits", "render_lease_until": 0,
        "charge": {"credits": 10, "user_id": OWNER["id"], "pool": False, "day": today},
    }}}})
    res = client.get("/api/timelines/tl-1/podcasts/stalled-1")
    assert res.status_code == 200
    assert res.json()["audio"]["gemini"]["status"] in ("pending", "partial")
    assert res.json()["audio"]["gemini"]["unlocked"] is False
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used - 10
    client.get("/api/timelines/tl-1/podcasts/stalled-1")  # never twice
    assert quota_service.get_user_daily_usage(OWNER["id"]) == used - 10


@pytest.mark.asyncio
async def test_delete_during_render_is_not_recreated_by_a_late_update(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    podcast_store.clip_cache.clear()
    _seed("racing-1", OWNER["id"], {})
    cleanup_ran = asyncio.Event()

    async def fake_render():
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            # The render's clean-up records state on the episode after it was cancelled.
            await podcast_audio.update_episode("tl-1", "racing-1", lambda d: d.update(late=True))
            cleanup_ran.set()
            raise

    task = asyncio.create_task(fake_render())
    podcast_audio._variant_tasks[("racing-1", "edge", "male")] = task
    await asyncio.sleep(0)
    try:
        await podcast_audio.delete_episode("tl-1", "racing-1")
        assert cleanup_ran.is_set()
        assert podcast_store.get_episode("tl-1", "racing-1") is None
        # Any later write is refused too.
        assert podcast_store.save_episode({"id": "racing-1", "timeline_id": "tl-1", "owner_id": OWNER["id"]}) is False
        assert podcast_store.get_episode("tl-1", "racing-1") is None
    finally:
        podcast_audio._variant_tasks.pop(("racing-1", "edge", "male"), None)


# --- B-24 ---------------------------------------------------------------------------------

def test_episode_saved_after_a_guest_claim_belongs_to_the_account(env):
    guest = {"id": "guest-4b", "is_anonymous": True}
    job_id = main._create_ai_job(guest)
    main._transfer_ai_jobs(guest["id"], OWNER["id"])  # the guest signed in while the script was written
    req = main.TimelinePodcastRequest.model_validate({"timeline": TIMELINE, "tts_engine": "edge"})

    async def run():
        out = await main._execute_podcast_episode("tl-1", req, None, "free", guest, None, None, job_id=job_id)
        podcast_audio.cancel_episode_renders(out["episode"]["id"])
        return out

    result = asyncio.run(run())
    stored = podcast_store.get_episode("tl-1", result["episode"]["id"])
    assert stored["owner_id"] == OWNER["id"]
    main._AI_JOBS.pop(job_id, None)


@pytest.mark.asyncio
async def test_owner_transfer_goes_through_the_episode_lock_and_index(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    podcast_store.clip_cache.clear()
    _seed("claimed-1", "guest-x", {})
    podcast_store.save_episode({"id": "u-elsewhere", "timeline_id": "other-tl", "owner_id": "guest-x", "created_at": "2026"})
    locked = []
    real_lock = podcast_audio._episode_lock

    def spy(eid):
        locked.append(eid)
        return real_lock(eid)

    monkeypatch.setattr(podcast_audio, "_episode_lock", spy)
    moved = await podcast_audio.transfer_episodes_owner(["tl-1"], "guest-x", "user-y")
    assert moved == 2
    assert set(locked) == {"claimed-1", "u-elsewhere"}
    assert podcast_store.get_episode("tl-1", "claimed-1")["owner_id"] == "user-y"
    assert [e["owner_id"] for e in podcast_store.get_episode_index("other-tl")] == ["user-y"]
    assert podcast_store.list_owner_episode_refs("guest-x") == []
    assert {r["id"] for r in podcast_store.list_owner_episode_refs("user-y")} == {"claimed-1", "u-elsewhere"}
