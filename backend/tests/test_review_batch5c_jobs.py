"""Batch 5C: long-polled job status (SC-02), the per-instance text-job budget and queue (SC-07),
the server deadline and refund-cap exemptions (SC-19), pre-encoded large results and the
health-check sampler (P-11)."""
import asyncio
import gzip
import json
import time
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import main
from services.auth_service import get_current_user_optional, get_current_user_required

USER = {"id": "batch5c-user", "email": "b5c@example.com", "is_anonymous": False}
OTHER = {"id": "batch5c-other", "email": "b5c-other@example.com", "is_anonymous": False}
ADMIN = {"id": "batch5c-admin", "email": "admin5c@example.com", "is_anonymous": False}


@pytest.fixture(autouse=True)
def isolated_jobs(monkeypatch):
    saved = dict(main._AI_JOBS)
    main._AI_JOBS.clear()
    main._TEXT_JOB_QUEUE.clear()
    main._TEXT_JOBS_RUNNING.clear()
    main._CANCEL_REFUND_HISTORY.clear()
    monkeypatch.setenv("ADMIN_EMAILS", "admin5c@example.com")
    refunds = []

    def fake_refund(job, user):
        if job and (job.get("incremented_quota") or job.get("rate_limit_identifier")):
            refunds.append(job.get("user_id"))
        if job:
            job["incremented_quota"] = False
            job["rate_limit_identifier"] = None

    monkeypatch.setattr(main, "_refund_job_quota_and_limits", fake_refund)
    yield refunds
    main._AI_JOBS.clear()
    main._AI_JOBS.update(saved)
    main._TEXT_JOB_QUEUE.clear()
    main._TEXT_JOBS_RUNNING.clear()
    main._CANCEL_REFUND_HISTORY.clear()


def _charged_job(user=USER):
    return main._create_ai_job(user, client_ip="10.0.0.5", rate_limit_identifier=f"user:{user['id']}", incremented_quota=True)


def _request():
    req = MagicMock()
    req.headers.get.return_value = None
    req.client.host = "10.0.0.5"
    return req


def _blocking_operation(release: asyncio.Event, result=None):
    async def op():
        await release.wait()
        return result if result is not None else {"ok": True}
    return op


# --- long poll (SC-02) -------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_long_poll_returns_as_soon_as_the_job_finishes():
    release = asyncio.Event()
    job_id = _charged_job()
    main._launch_ai_job(job_id, _blocking_operation(release, {"id": "tl"}), USER, label="generate")
    poll = asyncio.create_task(main.ai_job_status(job_id, wait=20, user=USER))
    await asyncio.sleep(0.05)
    assert not poll.done(), "nothing changed yet: the request is held"
    started = time.monotonic()
    release.set()
    payload = await asyncio.wait_for(poll, 2)
    assert payload["status"] == "done" and payload["result"] == {"id": "tl"}
    assert time.monotonic() - started < 1.0


@pytest.mark.asyncio
async def test_long_poll_returns_early_on_a_new_partial_revision():
    release = asyncio.Event()
    job_id = _charged_job()
    main._launch_ai_job(job_id, _blocking_operation(release), USER, label="generate")
    poll = asyncio.create_task(main.ai_job_status(job_id, wait=20, user=USER))
    await asyncio.sleep(0.05)
    main._note_job_partial(job_id, {"id": "p", "articles": []})
    payload = await asyncio.wait_for(poll, 2)
    assert payload["status"] == "pending" and payload["partial_rev"] == 1 and payload["partial"]["id"] == "p"
    # A client that already has revision 1 is held again until the next change.
    held = asyncio.create_task(main.ai_job_status(job_id, partial_rev=1, wait=20, user=USER))
    await asyncio.sleep(0.05)
    assert not held.done()
    release.set()
    assert (await asyncio.wait_for(held, 2))["status"] == "done"


@pytest.mark.asyncio
async def test_long_poll_times_out_with_pending_and_reports_the_hold():
    release = asyncio.Event()
    job_id = _charged_job()
    main._launch_ai_job(job_id, _blocking_operation(release), USER, label="generate")
    payload = await main.ai_job_status(job_id, wait=0.2, user=USER)
    assert payload["status"] == "pending"
    assert payload["waited_ms"] >= 150
    release.set()


@pytest.mark.asyncio
async def test_without_wait_the_status_answers_at_once_as_before():
    release = asyncio.Event()
    job_id = _charged_job()
    main._launch_ai_job(job_id, _blocking_operation(release), USER, label="generate")
    started = time.monotonic()
    payload = await main.ai_job_status(job_id, user=USER)
    assert payload == {"status": "pending"}, "old clients see exactly the old payload"
    assert time.monotonic() - started < 0.1
    release.set()


def test_long_poll_wait_is_capped_and_validated():
    main.app.dependency_overrides[get_current_user_required] = lambda: USER
    try:
        client = TestClient(main.app)
        assert client.get("/api/timeline/job/status/nope?wait=-1").status_code == 422
        jid = main._create_ai_job(USER)
        main._AI_JOBS[jid]["status"] = "done"
        main._AI_JOBS[jid]["result"] = {"x": 1}
        # A finished job answers at once even with a (capped) wait.
        res = client.get(f"/api/timeline/job/status/{jid}?wait=999")
        assert res.status_code == 200 and res.json()["status"] == "done"
    finally:
        main.app.dependency_overrides.pop(get_current_user_required, None)
    assert main._MAX_JOB_STATUS_WAIT_SECONDS <= 25


# --- text-job budget and queue (SC-07) ---------------------------------------------------------

@pytest.mark.asyncio
async def test_budget_full_queues_jobs_with_positions_and_starts_them_as_slots_free(monkeypatch):
    monkeypatch.setenv("MAX_CONCURRENT_TEXT_JOBS", "1")
    gates = [asyncio.Event() for _ in range(3)]
    ids = [_charged_job() for _ in range(3)]
    started = []

    def op(i):
        async def run():
            started.append(i)
            await gates[i].wait()
            return {"n": i}
        return run

    first = main._launch_ai_job(ids[0], op(0), USER, label="generate")
    second = main._launch_ai_job(ids[1], op(1), USER, label="generate")
    third = main._launch_ai_job(ids[2], op(2), USER, label="generate")
    assert first == {"job_id": ids[0], "status": "pending"}
    assert second["status"] == "queued" and second["position"] == 1 and second["ahead"] == 0
    assert third["status"] == "queued" and third["position"] == 2 and third["ahead"] == 1
    await asyncio.sleep(0.01)
    assert started == [0]
    assert await main.ai_job_status(ids[2], user=USER) == {"status": "queued", "position": 2, "ahead": 1}

    # A long poll on the second job wakes when it starts.
    poll = asyncio.create_task(main.ai_job_status(ids[2], position=2, wait=5, user=USER))
    await asyncio.sleep(0.02)
    gates[0].set()
    moved = await asyncio.wait_for(poll, 2)
    assert moved.pop("waited_ms") < 2000
    assert moved == {"status": "queued", "position": 1, "ahead": 0}, "the place in line moved up"
    await asyncio.sleep(0.01)
    assert started == [0, 1]
    assert (await main.ai_job_status(ids[1], user=USER))["status"] == "pending"

    gates[1].set()
    await asyncio.sleep(0.05)
    assert started == [0, 1, 2]
    gates[2].set()
    await asyncio.sleep(0.05)
    assert all(main._AI_JOBS[j]["status"] == "done" for j in ids)
    assert not main._TEXT_JOB_QUEUE and not main._TEXT_JOBS_RUNNING


@pytest.mark.asyncio
async def test_a_queued_job_runs_with_its_own_request_context(monkeypatch):
    from services import quota_service

    monkeypatch.setenv("MAX_CONCURRENT_TEXT_JOBS", "1")
    gate = asyncio.Event()
    seen = []

    async def record_ip():
        seen.append(quota_service._request_client_ip.get())
        return {}

    quota_service._request_client_ip.set("198.51.100.1")
    main._launch_ai_job(_charged_job(OTHER), _blocking_operation(gate), OTHER, label="generate")
    quota_service._request_client_ip.set("203.0.113.7")
    assert main._launch_ai_job(_charged_job(), record_ip, USER, label="generate")["status"] == "queued"
    quota_service._request_client_ip.set(None)
    gate.set()  # the first job's completion starts the queued one from the first job's task
    await asyncio.sleep(0.05)
    assert seen == ["203.0.113.7"]


@pytest.mark.asyncio
async def test_queue_overflow_is_a_503_with_retry_after_before_anything_is_charged(monkeypatch):
    monkeypatch.setenv("MAX_CONCURRENT_TEXT_JOBS", "1")
    monkeypatch.setenv("MAX_QUEUED_TEXT_JOBS", "1")
    monkeypatch.setenv("MAX_CONCURRENT_JOBS_PER_USER", "0")
    gate = asyncio.Event()
    main._launch_ai_job(_charged_job(), _blocking_operation(gate), USER, label="generate")
    main._launch_ai_job(_charged_job(OTHER), _blocking_operation(gate), OTHER, label="generate")
    with pytest.raises(main.HTTPException) as exc:
        main._enforce_concurrent_job_limit({"id": "third"}, "10.0.0.9")
    assert exc.value.status_code == 503
    assert exc.value.headers["Retry-After"]
    # Admins bypass the queue; upload routes use their own cap.
    main._enforce_concurrent_job_limit(ADMIN, "10.0.0.9")
    main._enforce_concurrent_job_limit({"id": "third"}, "10.0.0.9", text_budget=False)
    gate.set()


@pytest.mark.asyncio
async def test_admin_jobs_bypass_the_queue(monkeypatch):
    monkeypatch.setenv("MAX_CONCURRENT_TEXT_JOBS", "1")
    gate = asyncio.Event()
    main._launch_ai_job(_charged_job(), _blocking_operation(gate), USER, label="generate")
    queued = main._launch_ai_job(_charged_job(OTHER), _blocking_operation(gate), OTHER, label="generate")
    admin = main._launch_ai_job(main._create_ai_job(ADMIN), _blocking_operation(gate), ADMIN, label="generate")
    assert queued["status"] == "queued"
    assert admin["status"] == "pending"
    gate.set()
    await asyncio.sleep(0.05)


@pytest.mark.asyncio
async def test_cancelling_a_queued_job_always_refunds_without_using_the_cap(monkeypatch, isolated_jobs):
    monkeypatch.setenv("MAX_CONCURRENT_TEXT_JOBS", "1")
    gate = asyncio.Event()
    main._launch_ai_job(_charged_job(OTHER), _blocking_operation(gate), OTHER, label="generate")
    # The caller already used up the cancel-refund cap.
    main._CANCEL_REFUND_HISTORY[f"user:{USER['id']}"] = [time.time()] * main._MAX_CANCEL_REFUNDS_PER_WINDOW
    queued_id = _charged_job()
    assert main._launch_ai_job(queued_id, _blocking_operation(gate), USER, label="generate")["status"] == "queued"

    res = await main.cancel_ai_job(queued_id, _request(), user=USER)
    assert res["message"] == "Job cancelled and quota refunded."
    assert isolated_jobs == [USER["id"]]
    assert main._TEXT_JOB_QUEUE == main.deque() or queued_id not in main._live_queued_job_ids()
    gate.set()
    await asyncio.sleep(0.05)
    assert main._AI_JOBS[queued_id]["status"] == "cancelled", "a cancelled queued job never starts"


@pytest.mark.asyncio
async def test_a_normal_user_cancel_is_still_capped(isolated_jobs):
    main._CANCEL_REFUND_HISTORY[f"user:{USER['id']}"] = [time.time()] * main._MAX_CANCEL_REFUNDS_PER_WINDOW
    gate = asyncio.Event()
    job_id = _charged_job()
    main._launch_ai_job(job_id, _blocking_operation(gate), USER, label="generate")
    await asyncio.sleep(0.01)
    res = await main.cancel_ai_job(job_id, _request(), user=USER)
    assert res["message"] == "Job cancelled."
    assert isolated_jobs == []


@pytest.mark.asyncio
async def test_cancel_of_a_job_running_past_the_server_deadline_is_exempt_from_the_cap(monkeypatch, isolated_jobs):
    monkeypatch.setenv("AI_JOB_SERVER_DEADLINE_SECONDS", "240")
    main._CANCEL_REFUND_HISTORY[f"user:{USER['id']}"] = [time.time()] * main._MAX_CANCEL_REFUNDS_PER_WINDOW
    gate = asyncio.Event()
    job_id = _charged_job()
    main._launch_ai_job(job_id, _blocking_operation(gate), USER, label="generate")
    main._AI_JOBS[job_id]["started_at"] = time.time() - 300  # overran because the server was slow
    res = await main.cancel_ai_job(job_id, _request(), user=USER)
    assert res["message"] == "Job cancelled and quota refunded."
    assert isolated_jobs == [USER["id"]]


@pytest.mark.asyncio
async def test_queued_job_timing_out_in_line_fails_with_server_timeout_and_is_refunded(monkeypatch, isolated_jobs):
    monkeypatch.setenv("MAX_CONCURRENT_TEXT_JOBS", "1")
    monkeypatch.setenv("AI_JOB_QUEUE_TIMEOUT_SECONDS", "60")
    gate = asyncio.Event()
    main._launch_ai_job(_charged_job(OTHER), _blocking_operation(gate), OTHER, label="generate")
    queued_id = _charged_job()
    main._launch_ai_job(queued_id, _blocking_operation(gate), USER, label="generate")
    assert main._expire_queued_text_jobs(now=time.time() + 30) == 0
    assert main._expire_queued_text_jobs(now=time.time() + 61) == 1
    await asyncio.sleep(0.02)
    payload = await main.ai_job_status(queued_id, user=USER)
    assert payload["status"] == "error" and payload["code"] == "server_timeout"
    assert isolated_jobs == [USER["id"]]
    gate.set()


# --- server deadline (SC-19) ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_job_past_the_server_deadline_is_stopped_and_refunded(monkeypatch, isolated_jobs):
    monkeypatch.setenv("AI_JOB_SERVER_DEADLINE_SECONDS", "0.05")
    never = asyncio.Event()
    job_id = _charged_job()
    main._launch_ai_job(job_id, _blocking_operation(never), USER, label="generate")
    payload = await asyncio.wait_for(main.ai_job_status(job_id, wait=5, user=USER), 3)
    assert payload["status"] == "error"
    assert payload["code"] == "server_timeout"
    assert "refunded" in payload["detail"]
    await asyncio.sleep(0.05)
    assert isolated_jobs == [USER["id"]], "refunded once, without touching the cancel cap"
    assert main._AI_JOBS[job_id]["status"] == "error", "the task's cancellation does not overwrite it"
    assert not main._CANCEL_REFUND_HISTORY


@pytest.mark.asyncio
async def test_deadline_after_the_model_answered_stops_without_refund_after_a_grace(monkeypatch, isolated_jobs):
    monkeypatch.setenv("AI_JOB_SERVER_DEADLINE_SECONDS", "0.05")
    monkeypatch.setattr(main, "_POST_MODEL_DEADLINE_GRACE_SECONDS", 0.1)
    never = asyncio.Event()
    job_id = _charged_job()

    async def op():
        main._mark_job_non_refundable_on_cancel(job_id)  # the model has answered (B-16)
        await never.wait()

    main._launch_ai_job(job_id, op, USER, label="generate")
    await asyncio.sleep(0.09)
    assert main._AI_JOBS[job_id]["status"] == "pending", "enrichment gets a grace period"
    await asyncio.sleep(0.15)
    job = main._AI_JOBS[job_id]
    assert job["status"] == "error" and job["code"] == "server_timeout"
    assert isolated_jobs == []
    assert job["incremented_quota"] is False


@pytest.mark.asyncio
async def test_deadline_never_interrupts_a_save_in_progress(monkeypatch):
    monkeypatch.setenv("AI_JOB_SERVER_DEADLINE_SECONDS", "0.05")
    release = asyncio.Event()
    job_id = _charged_job()

    async def op():
        main._note_job_phase("persisting")
        await release.wait()
        return {"saved": True}

    main._launch_ai_job(job_id, op, USER, label="generate")
    await asyncio.sleep(0.1)
    assert main._AI_JOBS[job_id]["status"] == "pending"
    release.set()
    await asyncio.sleep(0.02)
    assert main._AI_JOBS[job_id]["status"] == "done"


# --- large results are encoded off the loop (P-11) -----------------------------------------------

def test_large_done_result_is_pre_encoded_and_gzipped(monkeypatch):
    monkeypatch.setenv("AI_JOB_PREENCODE_MIN_BYTES", "1000")
    encoded_in = []
    real_encode = main._encode_json_body

    def spy(payload, gzip_body):
        import threading
        encoded_in.append(threading.current_thread().name)
        return real_encode(payload, gzip_body)

    monkeypatch.setattr(main, "_encode_json_body", spy)
    result = {"id": "big", "articles": [{"id": f"a{i}", "title": "Ω" * 50} for i in range(100)]}
    jid = main._create_ai_job(USER)
    asyncio.run(main._run_ai_job(jid, lambda: _ready(result), USER, label="generate"))
    assert main._AI_JOBS[jid]["result_bytes"] > 1000
    main.app.dependency_overrides[get_current_user_required] = lambda: USER
    try:
        res = TestClient(main.app).get(f"/api/timeline/job/status/{jid}", headers={"Accept-Encoding": "gzip"})
    finally:
        main.app.dependency_overrides.pop(get_current_user_required, None)
    assert res.status_code == 200
    assert res.headers.get("content-encoding") == "gzip"
    assert res.json() == {"status": "done", "result": result}
    assert encoded_in and encoded_in[0].startswith("chronix-cpu"), encoded_in


async def _ready(value):
    return value


def test_result_size_is_estimated_without_serializing_on_the_loop(monkeypatch):
    result = {"id": "t", "articles": [{"id": f"a{i}", "imageUrl": "data:image/jpeg;base64," + "A" * 50_000,
                                       "from": {"year": 1900 + i}, "flag": True} for i in range(40)]}
    exact = len(json.dumps(result, ensure_ascii=False))
    approx = main._approx_result_bytes(result)
    assert 0.9 * exact <= approx <= 1.2 * exact
    assert main._approx_result_bytes(list(range(10)), node_budget=5) is None

    def no_dumps(*a, **k):
        raise AssertionError("a normal result is never serialized just to be measured")

    monkeypatch.setattr(main, "_estimate_result_bytes", no_dumps)
    jid = main._create_ai_job(USER)
    asyncio.run(main._run_ai_job(jid, lambda: _ready(result), USER, label="generate"))
    assert main._AI_JOBS[jid]["result_bytes"] == approx


def test_pre_encoded_body_matches_the_regular_json_encoding():
    payload = {"status": "done", "result": {"t": "שלום", "n": [1, 2.5, None, True]}}
    assert json.loads(main._encode_json_body(payload, False)) == payload
    assert json.loads(gzip.decompress(main._encode_json_body(payload, True))) == payload


# --- health check sampler (P-11 flake) ---------------------------------------------------------

def test_health_ignores_a_stale_tick_from_another_loop(monkeypatch):
    # An earlier lifespan / test loop left an ancient tick behind: that is not this loop lagging.
    monkeypatch.setitem(main._LOOP_HEALTH, "last_tick", 1.0)
    monkeypatch.setitem(main._LOOP_HEALTH, "lag_seconds", 0.0)
    monkeypatch.setitem(main._LOOP_SAMPLER_OWNER, "loop", object())
    res = TestClient(main.app).get("/api/health")
    assert res.status_code == 200, res.json()
    assert res.json()["event_loop_lag_ms"] is None


def test_sampler_marks_itself_started_and_clears_its_tick_when_stopped(monkeypatch):
    monkeypatch.setattr(main, "_LOOP_LAG_SAMPLE_SECONDS", 10.0)

    async def scenario():
        task = asyncio.create_task(main._event_loop_lag_sampler())
        await asyncio.sleep(0)
        lag_while_running = main._current_event_loop_lag()
        tick = main._LOOP_HEALTH["last_tick"]
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return lag_while_running, tick

    lag, tick = asyncio.run(scenario())
    assert tick is not None, "a started sampler records a tick right away"
    assert lag is not None and lag < 1.0, "not overdue before its first sleep finishes"
    assert main._LOOP_HEALTH["last_tick"] is None


def test_health_with_a_lifespan_client_and_after_it_is_ok():
    with TestClient(main.app) as client:
        assert client.get("/api/health").status_code == 200
    main._SERVER_DRAINING = False
    assert TestClient(main.app).get("/api/health").status_code == 200
