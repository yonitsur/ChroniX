"""B-03 / SC-03 (backend): job -> timeline_id in status payloads, byte-capped finished results,
shutdown drain + refunds, throttled cleanup."""
import asyncio
import time

import pytest
from fastapi.testclient import TestClient

import main
from services import quota_service
from services.auth_service import get_current_user_optional, get_current_user_required

USER = {"id": "job-life-user", "email": "job-life@example.com", "is_anonymous": False}


@pytest.fixture(autouse=True)
def isolated_jobs(monkeypatch):
    saved = dict(main._AI_JOBS)
    main._AI_JOBS.clear()
    main.timeline_rate_limiter.records.clear()
    main.app.dependency_overrides[get_current_user_required] = lambda: USER
    main.app.dependency_overrides[get_current_user_optional] = lambda: USER
    stored = {}

    def fake_save(timeline, user_id=None, existing_meta=None):
        stored[timeline["id"]] = dict(timeline)
        return dict(timeline)

    monkeypatch.setattr(main, "save_timeline_data", fake_save)
    yield stored
    main.app.dependency_overrides.pop(get_current_user_required, None)
    main.app.dependency_overrides.pop(get_current_user_optional, None)
    main._AI_JOBS.clear()
    main._AI_JOBS.update(saved)


def _status(job_id):
    return TestClient(main.app).get(f"/api/timeline/job/status/{job_id}").json()


def _persisting_operation(timeline_id, then_raise=None):
    async def op():
        await main._persist_timeline_dict(
            {"id": timeline_id, "title": "T", "articles": [{"id": "a1"}]},
            user=USER, target_owner=USER["id"], existing_meta=None, id_is_server_generated=True,
        )
        if then_raise is not None:
            raise then_raise
        return {"id": timeline_id, "title": "T"}
    return op


# --- timeline_id in status payloads ------------------------------------------------------

def test_pending_job_with_fixed_timeline_id_reports_it_unpersisted():
    jid = main._create_ai_job(USER, timeline_id="tl-refine-1")
    assert _status(jid) == {"status": "pending", "timeline_id": "tl-refine-1", "persisted": False}


def test_pending_job_without_known_timeline_has_no_timeline_fields():
    jid = main._create_ai_job(USER)
    assert _status(jid) == {"status": "pending"}


def test_done_job_reports_persisted_timeline_id(isolated_jobs):
    jid = main._create_ai_job(USER)
    asyncio.run(main._run_ai_job(jid, _persisting_operation("tl-gen-1"), USER, label="generate"))

    payload = _status(jid)
    assert payload["status"] == "done"
    assert payload["timeline_id"] == "tl-gen-1"
    assert payload["persisted"] is True
    assert payload["result"]["id"] == "tl-gen-1"
    assert "tl-gen-1" in isolated_jobs


def test_error_after_persist_still_reports_timeline_id_and_persisted():
    jid = main._create_ai_job(USER)
    op = _persisting_operation("tl-gen-err", then_raise=RuntimeError("boom after save"))
    asyncio.run(main._run_ai_job(jid, op, USER, label="generate"))

    payload = _status(jid)
    assert payload["status"] == "error"
    assert payload["timeline_id"] == "tl-gen-err"
    assert payload["persisted"] is True


def test_error_before_persist_with_fixed_id_is_marked_unpersisted():
    jid = main._create_ai_job(USER, timeline_id="tl-refine-2")

    async def op():
        raise ValueError("bad instruction")

    asyncio.run(main._run_ai_job(jid, op, USER, label="refine"))
    payload = _status(jid)
    assert payload["status"] == "error"
    assert payload["timeline_id"] == "tl-refine-2"
    assert payload["persisted"] is False


def test_cancelled_job_after_persist_keeps_timeline_fields():
    jid = main._create_ai_job(USER)
    asyncio.run(main._run_ai_job(jid, _persisting_operation("tl-gen-c"), USER, label="generate"))
    main._AI_JOBS[jid].update(status="cancelled", detail="Cancelled by user")
    payload = _status(jid)
    assert payload["status"] == "cancelled"
    assert payload["timeline_id"] == "tl-gen-c" and payload["persisted"] is True


def test_refine_and_chat_start_store_the_timeline_id(monkeypatch):
    monkeypatch.setattr(main, "resolve_gemini_key", lambda *a, **k: ("KEY", "custom", False))

    async def verify(timeline_id, user):
        return user["id"], None

    async def never_finishes(*args, **kwargs):
        await asyncio.sleep(3600)

    monkeypatch.setattr(main, "_verify_timeline_mutation_target", verify)
    monkeypatch.setattr(main, "_execute_refine", never_finishes)
    monkeypatch.setattr(main, "_execute_chat", never_finishes)
    timeline = {"id": "tl-fixed", "title": "Fixed", "articles": []}
    with TestClient(main.app) as client:
        r1 = client.post("/api/timeline/refine/start", json={"timeline": timeline, "instruction": "add more"})
        r2 = client.post("/api/timeline/chat/start", json={"timeline": timeline, "message": "hi"})
        assert r1.status_code == 200, r1.text
        assert r2.status_code == 200, r2.text
        for res in (r1, r2):
            status_payload = client.get(f"/api/timeline/job/status/{res.json()['job_id']}").json()
            assert status_payload["timeline_id"] == "tl-fixed"
            assert status_payload["persisted"] is False


# --- byte-capped finished results ---------------------------------------------------------

def _finished(jid, user_id, size, age, delivered=False):
    now = time.time()
    main._AI_JOBS[jid] = {
        "status": "done", "user_id": user_id, "result": {}, "result_bytes": size,
        "updated": now - age,
    }
    if delivered:
        main._AI_JOBS[jid]["delivered_at"] = now - 1


def test_result_bytes_are_measured_once_at_completion():
    jid = main._create_ai_job(USER)

    async def op():
        return {"blob": "x" * 5000}

    asyncio.run(main._run_ai_job(jid, op, USER, label="generate"))
    assert main._AI_JOBS[jid]["result_bytes"] >= 5000


def test_byte_cap_evicts_delivered_then_oldest(monkeypatch):
    monkeypatch.setenv("AI_JOBS_MAX_FINISHED_BYTES", "1000")
    _finished("delivered-old", "u1", 500, age=100, delivered=True)
    _finished("undelivered-old", "u2", 500, age=200)
    _finished("undelivered-young", "u3", 500, age=5)
    main._cleanup_ai_jobs()
    assert set(main._AI_JOBS) == {"undelivered-old", "undelivered-young"}

    # Still over the byte cap: now the oldest undelivered result goes, never the newest first.
    _finished("undelivered-newest", "u4", 500, age=1)
    main._cleanup_ai_jobs()
    assert set(main._AI_JOBS) == {"undelivered-young", "undelivered-newest"}


def test_byte_cap_may_evict_young_undelivered_only_when_over_memory(monkeypatch):
    monkeypatch.setenv("AI_JOBS_MAX_FINISHED_BYTES", "1000")
    _finished("young-a", "u1", 800, age=2)
    _finished("young-b", "u2", 800, age=1)
    main._cleanup_ai_jobs()
    assert set(main._AI_JOBS) == {"young-b"}


def test_count_ceiling_spares_young_undelivered_results(monkeypatch):
    monkeypatch.setenv("AI_JOBS_MAX_FINISHED_BYTES", str(10 * 1024 * 1024))
    monkeypatch.setattr(main, "_MAX_FINISHED_AI_JOBS", 2)
    _finished("old-undelivered", "u1", 10, age=120)
    _finished("old-delivered", "u2", 10, age=90, delivered=True)
    for i in range(3):
        _finished(f"young-{i}", f"y{i}", 10, age=5)
    main._cleanup_ai_jobs()
    # Count ceiling evicts delivered, then old undelivered; young undelivered ones survive.
    assert set(main._AI_JOBS) == {"young-0", "young-1", "young-2"}


def test_count_ceiling_is_high_by_default():
    assert main._MAX_FINISHED_AI_JOBS >= 1000
    assert main._max_finished_ai_job_bytes() == 64 * 1024 * 1024


def test_finishing_job_over_byte_cap_triggers_eviction_immediately(monkeypatch):
    monkeypatch.setenv("AI_JOBS_MAX_FINISHED_BYTES", "3000")
    _finished("delivered-big", "u1", 2500, age=10, delivered=True)
    main._ai_jobs_last_cleanup = time.time()  # throttled cleanup would not run on its own
    jid = main._create_ai_job(USER)

    async def op():
        return {"blob": "y" * 1000}

    asyncio.run(main._run_ai_job(jid, op, USER, label="generate"))
    assert "delivered-big" not in main._AI_JOBS
    assert jid in main._AI_JOBS


# --- shutdown drain ------------------------------------------------------------------------

def _charged_job(credits_used_id):
    quota_service.record_prompt_usage(credits_used_id, credits=1)
    return main._create_ai_job(USER, client_ip="198.51.100.9", incremented_quota=True, quota_credits=1)


def test_shutdown_refunds_pending_jobs_then_rejects_new_starts(monkeypatch):
    monkeypatch.setenv("API_KEY_MODE", "limited")
    refundable = _charged_job(USER["id"])
    locked = _charged_job(USER["id"])
    main._mark_job_non_refundable_on_cancel(locked)
    done = main._create_ai_job(USER)
    main._AI_JOBS[done].update(status="done", result={"ok": True})
    assert quota_service.get_user_daily_usage(USER["id"]) == 2

    refunded = asyncio.run(main._drain_ai_jobs_on_shutdown(budget_seconds=2))

    assert refunded == 1
    assert main._AI_JOBS[refundable]["status"] == "cancelled"
    assert main._AI_JOBS[locked]["status"] == "cancelled"
    assert main._AI_JOBS[done]["status"] == "done"
    # Only the job whose model call hadn't finished is refunded.
    assert quota_service.get_user_daily_usage(USER["id"]) == 1

    client = TestClient(main.app)
    res = client.post("/api/timeline/generate/start", json={"prompt": "History of tea"})
    assert res.status_code == 503
    assert res.headers.get("retry-after")
    assert quota_service.get_user_daily_usage(USER["id"]) == 1
    status_payload = client.get(f"/api/timeline/job/status/{refundable}").json()
    assert status_payload["status"] == "cancelled"


def test_shutdown_cancels_running_task_without_double_refund(monkeypatch):
    monkeypatch.setenv("API_KEY_MODE", "limited")
    calls = []
    real_refund = main._refund_job_quota_and_limits
    monkeypatch.setattr(main, "_refund_job_quota_and_limits", lambda job, user: (calls.append(1), real_refund(job, user)))

    async def scenario():
        jid = _charged_job(USER["id"])

        async def slow():
            await asyncio.sleep(3600)

        task = asyncio.create_task(main._run_ai_job(jid, slow, USER, label="generate"))
        main._AI_JOBS[jid]["task"] = task
        await asyncio.sleep(0)
        await main._drain_ai_jobs_on_shutdown(budget_seconds=2)
        with pytest.raises(asyncio.CancelledError):
            await task
        return jid

    jid = asyncio.run(scenario())
    assert len(calls) == 1
    assert main._AI_JOBS[jid]["status"] == "cancelled"
    assert quota_service.get_user_daily_usage(USER["id"]) == 0


def test_lifespan_shutdown_runs_the_drain(monkeypatch):
    monkeypatch.setenv("API_KEY_MODE", "limited")
    with TestClient(main.app):
        jid = _charged_job(USER["id"])
    assert main._AI_JOBS[jid]["status"] == "cancelled"
    assert quota_service.get_user_daily_usage(USER["id"]) == 0
    assert main._SERVER_DRAINING is True


# --- throttled cleanup ---------------------------------------------------------------------

def test_status_polls_do_not_run_cleanup_every_time(monkeypatch):
    calls = []
    real_cleanup = main._cleanup_ai_jobs
    monkeypatch.setattr(main, "_cleanup_ai_jobs", lambda: (calls.append(1), real_cleanup()))
    jid = main._create_ai_job(USER)
    main._ai_jobs_last_cleanup = 0.0
    client = TestClient(main.app)
    for _ in range(5):
        assert client.get(f"/api/timeline/job/status/{jid}").json()["status"] == "pending"
    assert len(calls) == 1

    main._ai_jobs_last_cleanup = time.time() - main._AI_JOBS_CLEANUP_INTERVAL_SECONDS - 1
    client.get(f"/api/timeline/job/status/{jid}")
    assert len(calls) == 2


def test_polled_job_expiry_is_exact_even_when_cleanup_is_throttled():
    jid = main._create_ai_job(USER)
    main._AI_JOBS[jid].update(status="done", result={"ok": 1}, updated=time.time() - main._JOB_TTL_SECONDS - 5)
    main._ai_jobs_last_cleanup = time.time()
    res = TestClient(main.app).get(f"/api/timeline/job/status/{jid}")
    assert res.status_code == 404
    assert jid not in main._AI_JOBS
