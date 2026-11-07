"""P-03: a generation's parsed timeline (no Wikipedia media yet) is put on the pending job and
returned by the status poll as `partial`; the `done` result replaces it."""
import asyncio

import pytest
from fastapi.testclient import TestClient

import main
from models import GeminiEventItem, GeminiLaneItem, GeminiTimelineOutput
from services import gemini_service as gs
from services.auth_service import get_current_user_optional, get_current_user_required

USER = {"id": "partial-user", "email": "partial@example.com", "is_anonymous": False}


@pytest.fixture(autouse=True)
def isolated_jobs():
    saved = dict(main._AI_JOBS)
    main._AI_JOBS.clear()
    main.app.dependency_overrides[get_current_user_required] = lambda: USER
    main.app.dependency_overrides[get_current_user_optional] = lambda: USER
    yield
    main.app.dependency_overrides.pop(get_current_user_required, None)
    main.app.dependency_overrides.pop(get_current_user_optional, None)
    main._AI_JOBS.clear()
    main._AI_JOBS.update(saved)


def _parsed():
    return GeminiTimelineOutput(
        title="Apollo program",
        description="Crewed missions to the Moon",
        overview="NASA's lunar program.",
        lanes=[GeminiLaneItem(id="main", title="Main")],
        events=[
            GeminiEventItem(id="ev-1", title="Apollo 8", from_year=1968, lane="main", wikipedia_title="Apollo 8"),
            GeminiEventItem(id="ev-2", title="Apollo 11", from_year=1969, lane="main", wikipedia_title="Apollo 11"),
        ],
    )


@pytest.mark.asyncio
async def test_partial_published_before_enrichment_and_replaced_by_final(monkeypatch):
    release = asyncio.Event()
    enrich_started = asyncio.Event()

    async def slow_enrich(events, **kwargs):
        enrich_started.set()
        await release.wait()
        for ev in events:
            ev["imageUrl"] = f"https://upload.wikimedia.org/{ev['id']}.jpg"
            ev["wikiUrl"] = f"https://en.wikipedia.org/wiki/{ev['id']}"
        return events

    monkeypatch.setattr(gs, "enrich_events_with_wikipedia", slow_enrich)

    async def operation():
        tl = await gs.finalize_timeline_from_parsed(_parsed(), "Apollo program")
        return tl.model_dump(by_alias=True)

    job_id = main._create_ai_job(USER)
    task = asyncio.create_task(main._run_ai_job(job_id, operation, USER, label="generate"))
    await asyncio.wait_for(enrich_started.wait(), 5)

    pending = await main.ai_job_status(job_id, partial_rev=0, user=USER)
    assert pending["status"] == "pending"
    assert pending["partial_rev"] == 1
    partial = pending["partial"]
    assert partial["isPartial"] is True
    assert [a["title"] for a in partial["articles"]] == ["Apollo 8", "Apollo 11"]
    assert all(not a.get("imageUrl") and not a.get("wikiUrl") for a in partial["articles"])
    assert partial["lanes"][0]["id"] == "main"

    # The client already has revision 1: the preview isn't sent again.
    again = await main.ai_job_status(job_id, partial_rev=1, user=USER)
    assert again["status"] == "pending" and again["partial_rev"] == 1 and "partial" not in again

    release.set()
    await asyncio.wait_for(task, 5)
    done = await main.ai_job_status(job_id, partial_rev=1, user=USER)
    assert done["status"] == "done"
    assert done["result"]["id"] == partial["id"]  # same id: the client swaps the preview in place
    assert "isPartial" not in done["result"]
    assert all(a["imageUrl"] for a in done["result"]["articles"])
    assert "partial" not in main._AI_JOBS[job_id]  # the preview is dropped once finished


@pytest.mark.asyncio
async def test_failure_after_partial_drops_it_and_reports_error(monkeypatch):
    async def failing_enrich(events, **kwargs):
        raise ValueError("enrichment exploded")

    monkeypatch.setattr(gs, "enrich_events_with_wikipedia", failing_enrich)
    monkeypatch.setattr(main, "_refund_job_quota_and_limits", lambda job, user: None)

    async def operation():
        tl = await gs.finalize_timeline_from_parsed(_parsed(), "Apollo program")
        return tl.model_dump(by_alias=True)

    job_id = main._create_ai_job(USER)
    await main._run_ai_job(job_id, operation, USER, label="generate")
    status = await main.ai_job_status(job_id, partial_rev=0, user=USER)
    assert status["status"] == "error"
    assert "partial" not in status
    assert "partial" not in main._AI_JOBS[job_id]


@pytest.mark.asyncio
async def test_no_hook_means_no_partial_work(monkeypatch):
    built = []
    monkeypatch.setattr(gs, "_build_timeline_articles", lambda items, fic: built.append(len(items)) or [])

    async def no_enrich(events, **kwargs):
        return events

    monkeypatch.setattr(gs, "enrich_events_with_wikipedia", no_enrich)
    await gs.finalize_timeline_from_parsed(_parsed(), "Apollo program")
    assert built == [2]  # only the final articles were built


def test_status_endpoint_partial_rev_query():
    job_id = main._create_ai_job(USER)
    client = TestClient(main.app)
    assert client.get(f"/api/timeline/job/status/{job_id}").json() == {"status": "pending"}

    main._note_job_partial(job_id, {"id": "tl-1", "articles": [{"id": "a"}], "isPartial": True})
    body = client.get(f"/api/timeline/job/status/{job_id}").json()
    assert body["partial_rev"] == 1 and body["partial"]["id"] == "tl-1"
    body = client.get(f"/api/timeline/job/status/{job_id}?partial_rev=1").json()
    assert body == {"status": "pending", "partial_rev": 1}

    # A finished job never carries a preview, even if one was noted late.
    main._AI_JOBS[job_id].update(status="done", result={"id": "tl-1"})
    main._note_job_partial(job_id, {"id": "tl-1", "articles": []})
    body = client.get(f"/api/timeline/job/status/{job_id}").json()
    assert body["status"] == "done" and "partial" not in body
