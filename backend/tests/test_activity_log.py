import asyncio

import pytest

import main
from models import GameCompletedRequest
from services import activity_log


USER = {"id": "11111111-1111-1111-1111-111111111111", "is_anonymous": False, "is_admin": False}
GUEST = {"id": "22222222-2222-2222-2222-222222222222", "is_anonymous": True}


@pytest.fixture
def rows(monkeypatch):
    captured = []
    monkeypatch.setattr(activity_log, "submit_row", lambda row: captured.append(row))
    return captured


@pytest.mark.asyncio
async def test_success_row_accumulates_tokens_images_and_modes(rows):
    async with activity_log.track_ai_activity(
        "generate_timeline", USER,
        content_mode="kids", search_mode="web_search", key_tier="free", prompt="  Roman Empire  ",
    ) as rec:
        activity_log.record_token_usage({
            "model": "gemini-x", "promptTokens": 100, "candidatesTokens": 50,
            "thoughtsTokens": 10, "estimatedCostUsd": 0.0012, "breakdown": {"grounding": 0.01},
        })
        # Nested tasks share the record (context is copied, dict is shared).
        await asyncio.gather(
            asyncio.to_thread(activity_log.record_token_usage, {"promptTokens": 5, "candidatesTokens": 5}),
            asyncio.create_task(asyncio.sleep(0)),
        )
        activity_log.record_ai_image("imagen-y")
        activity_log.record_key_rotation()
        activity_log.apply_timeline_result(rec, {"id": "tl-1", "articles": [1, 2, 3], "detectedLanguage": "en"})

    assert len(rows) == 1
    row = rows[0]
    assert row["action"] == "generate_timeline"
    assert row["status"] == "success"
    assert row["user_id"] == USER["id"] and row["is_guest"] is False
    assert row["content_mode"] == "kids" and row["search_mode"] == "web_search"
    assert row["prompt"] == "Roman Empire"
    assert row["timeline_id"] == "tl-1" and row["result_count"] == 3 and row["language"] == "en"
    assert row["input_tokens"] == 105 and row["output_tokens"] == 55 and row["thinking_tokens"] == 10
    assert row["cost_usd"] == pytest.approx(0.0012)
    assert row["model"] == "gemini-x"
    assert row["ai_images"] == 1
    assert row["details"] == {"key_rotations": 1, "image_model": "imagen-y", "web_search_used": True}


@pytest.mark.asyncio
async def test_usage_outside_tracked_action_is_ignored(rows):
    activity_log.record_token_usage({"promptTokens": 10})
    activity_log.record_ai_image("m")
    assert rows == []


@pytest.mark.asyncio
async def test_error_is_logged_and_reraised(rows):
    with pytest.raises(ValueError):
        async with activity_log.track_ai_activity("refine_timeline", GUEST, search_mode="fast"):
            raise ValueError("boom")
    assert rows[0]["status"] == "error"
    assert "boom" in rows[0]["error"]
    assert rows[0]["is_guest"] is True
    assert "details" not in rows[0] or "web_search_used" not in (rows[0]["details"] or {})


@pytest.mark.asyncio
async def test_cancellation_and_no_info_statuses(rows):
    with pytest.raises(asyncio.CancelledError):
        async with activity_log.track_ai_activity("chat", USER):
            raise asyncio.CancelledError()

    class InsufficientSubjectInfoError(Exception):
        pass

    with pytest.raises(InsufficientSubjectInfoError):
        async with activity_log.track_ai_activity("generate_timeline", USER):
            raise InsufficientSubjectInfoError("unknown subject")

    assert [r["status"] for r in rows] == ["cancelled", "no_info"]


@pytest.mark.asyncio
async def test_long_prompt_is_truncated(rows):
    async with activity_log.track_ai_activity("generate_timeline", USER, prompt="x" * 2000):
        pass
    assert len(rows[0]["prompt"]) == activity_log.MAX_PROMPT_CHARS


def test_submit_row_respects_disable_flag(monkeypatch):
    submitted = []

    class _Exec:
        def submit(self, fn, *args):
            submitted.append(args)

    monkeypatch.setattr(activity_log, "_executor", _Exec())
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "key")

    monkeypatch.setenv("ACTIVITY_LOG_ENABLED", "false")
    activity_log.submit_row({"action": "chat"})
    assert submitted == []

    monkeypatch.setenv("ACTIVITY_LOG_ENABLED", "true")
    monkeypatch.setattr(activity_log, "_disabled_until", 0.0)
    activity_log.submit_row({"action": "chat", "prompt": None})
    assert submitted == [({"action": "chat"},)]


def test_search_mode_helper():
    assert activity_log.search_mode_for(True) == "web_search"
    assert activity_log.search_mode_for(False) == "fast"
    assert activity_log.search_mode_for(None) == "fast"


def test_input_method_helper():
    assert activity_log.normalize_input_method("voice") == "voice"
    assert activity_log.normalize_input_method("url") == "url"
    assert activity_log.normalize_input_method(None) == "typed"
    assert activity_log.normalize_input_method("bogus") == "typed"
    # Photo-only generation / file attachment without a message: no prompt was entered at all.
    assert activity_log.normalize_input_method("voice", has_text=False) is None


def test_requests_accept_input_method():
    from models import GenerateTimelineRequest
    assert GenerateTimelineRequest(prompt="Moon landing", input_method="voice").input_method == "voice"
    assert GenerateTimelineRequest(prompt="Moon landing").input_method is None
    with pytest.raises(Exception):
        GenerateTimelineRequest(prompt="Moon landing", input_method="telepathy")


@pytest.mark.asyncio
async def test_game_completed_endpoint_logs_scores(rows):
    payload = GameCompletedRequest(
        game="wordle", timeline_id="tl-9", content_mode="classic",
        correct=4, total=5, points=1800, ratio=0.8, stars=2, duration_ms=95000,
    )
    response = await main.report_game_completed(payload, user=GUEST)

    assert response.status_code == 204
    row = rows[0]
    assert row["action"] == "game_completed"
    assert row["status"] == "success"
    assert row["is_guest"] is True
    assert row["timeline_id"] == "tl-9"
    assert row["content_mode"] == "classic"
    assert row["result_count"] == 5
    assert row["duration_ms"] == 95000
    assert "input_tokens" not in row or row["input_tokens"] is None
    assert row["details"] == {"game": "wordle", "correct": 4, "total": 5, "points": 1800, "ratio": 0.8, "stars": 2}


def test_game_request_rejects_unknown_game():
    with pytest.raises(Exception):
        GameCompletedRequest(game="poker")
