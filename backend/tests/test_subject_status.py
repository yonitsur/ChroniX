"""Tests for the anti-hallucination subject check (`subject_status` / insufficient_info)."""
import pytest
from unittest.mock import MagicMock, AsyncMock

import services.gemini_service as gs
from services.gemini_service import InsufficientSubjectInfoError, get_system_instruction
from models import GeminiTimelineOutput, GeminiEventItem, GeminiLaneItem
from prompts.timeline import AUTONOMOUS_CURATOR_GUIDELINE, build_grounding_research_prompt


def _mock_client(parsed: GeminiTimelineOutput) -> MagicMock:
    client = MagicMock()
    response = MagicMock()
    response.parsed = parsed
    client.aio.models.generate_content = AsyncMock(return_value=response)
    return client


def test_subject_status_is_first_schema_field():
    # Field order drives generation order: the verdict must come before any events.
    assert list(GeminiTimelineOutput.model_fields)[0] == "subject_status"
    assert GeminiTimelineOutput(title="t", description="d", overview="o").subject_status == "documented"


def test_prompts_no_longer_force_a_minimum_event_count():
    system = get_system_instruction()
    assert "0 events is strictly prohibited" not in system
    assert "scale the count down honestly to what is verified (10 to 16 events)" not in system
    assert "subject_status" in system
    assert "private figures" not in AUTONOMOUS_CURATOR_GUIDELINE.split("4b.")[0]
    assert "NO RELIABLE PUBLIC INFORMATION FOUND" in build_grounding_research_prompt("Jane Doe")


@pytest.mark.asyncio
async def test_unknown_subject_raises_and_is_not_retried_on_other_models(monkeypatch):
    client = _mock_client(GeminiTimelineOutput(
        subject_status="unknown",
        title="Alma Cohen Vardi",
        description="No reliable public information found.",
        overview="No reliable public information found.",
        events=[],
    ))
    monkeypatch.setattr(gs, "get_gemini_client", lambda api_key=None: client)

    with pytest.raises(InsufficientSubjectInfoError) as exc_info:
        await gs.generate_timeline_with_gemini(prompt="Alma Cohen Vardi")

    assert exc_info.value.code == "insufficient_info"
    assert exc_info.value.subject == "Alma Cohen Vardi"
    # Exactly one model call: an honest "unknown" must not fall through to fallback models.
    assert client.aio.models.generate_content.await_count == 1


@pytest.mark.asyncio
async def test_unknown_subject_with_events_is_still_rejected(monkeypatch):
    # If the model admits it doesn't know the subject, any events it produced are suspect.
    client = _mock_client(GeminiTimelineOutput(
        subject_status="unknown",
        title="X", description="d", overview="o",
        events=[GeminiEventItem(id="ev-1", title="Invented", from_year=1990)],
    ))
    monkeypatch.setattr(gs, "get_gemini_client", lambda api_key=None: client)

    with pytest.raises(InsufficientSubjectInfoError):
        await gs.generate_timeline_with_gemini(prompt="Some Private Person")


@pytest.mark.asyncio
async def test_sparse_subject_with_zero_events_raises(monkeypatch):
    client = _mock_client(GeminiTimelineOutput(
        subject_status="sparse", title="X", description="d", overview="o", events=[],
    ))
    monkeypatch.setattr(gs, "get_gemini_client", lambda api_key=None: client)

    with pytest.raises(InsufficientSubjectInfoError):
        await gs.generate_timeline_with_gemini(prompt="Obscure Subject")


@pytest.mark.asyncio
async def test_sparse_subject_with_few_events_builds_a_timeline(monkeypatch):
    client = _mock_client(GeminiTimelineOutput(
        subject_status="sparse",
        title="Minor Local Figure",
        description="Public information is limited.",
        overview="Only a few facts are documented.",
        lanes=[GeminiLaneItem(id="main", title="Main")],
        events=[
            GeminiEventItem(id="ev-1", title="Born", from_year=1901, lane="main"),
            GeminiEventItem(id="ev-2", title="Elected mayor", from_year=1950, lane="main"),
        ],
    ))
    monkeypatch.setattr(gs, "get_gemini_client", lambda api_key=None: client)

    async def _no_enrich(events, *args, **kwargs):
        return events

    monkeypatch.setattr(gs, "enrich_events_with_wikipedia", _no_enrich)

    tl = await gs.generate_timeline_with_gemini(prompt="Minor Local Figure")
    assert len(tl.articles) == 2


@pytest.mark.asyncio
async def test_run_with_key_failover_does_not_rotate_on_insufficient_info(monkeypatch):
    import main

    calls = []

    async def op(key):
        calls.append(key)
        # Message deliberately contains a quota-ish keyword; must still not rotate keys.
        raise InsufficientSubjectInfoError("credit quota 429")

    monkeypatch.setattr(main, "get_candidate_keys_for_request", lambda k: ["k1", "k2", "k3"])
    with pytest.raises(InsufficientSubjectInfoError):
        await main.run_with_key_failover(op, "k1", "paid", label="test")
    assert calls == ["k1"]


@pytest.mark.asyncio
async def test_ai_job_maps_insufficient_info_to_coded_error_and_refunds(monkeypatch):
    import main

    refunds = []
    monkeypatch.setattr(main, "_refund_job_quota_and_limits", lambda job, user: refunds.append(job))

    user = {"id": "u1"}
    job_id = main._create_ai_job(user, incremented_quota=True)

    async def op():
        raise InsufficientSubjectInfoError("Liad Sikorel")

    await main._run_ai_job(job_id, op, user, label="generate")

    job = main._AI_JOBS[job_id]
    assert job["status"] == "error"
    assert job["code"] == "insufficient_info"
    assert job["subject"] == "Liad Sikorel"
    assert len(refunds) == 1

    status = await main.ai_job_status(job_id, user=user)
    assert status == {
        "status": "error",
        "detail": "No reliable public information found about 'Liad Sikorel'.",
        "code": "insufficient_info",
        "subject": "Liad Sikorel",
    }
