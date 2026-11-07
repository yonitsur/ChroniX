"""AI text polish: output normalisation, credit charging, refunds and BYOK/admin exemptions."""
import pytest
from fastapi.testclient import TestClient

import main
from services import quota_service
from services.auth_service import get_current_user_required
from services.gemini_service import _clean_polished_text

USER = {"id": "polish-user-1", "email": "writer@example.com"}
ADMIN = {"id": "polish-admin-1", "email": "admin@example.com"}


def test_clean_polished_text_single_line_fields():
    assert _clean_polished_text('"Moon landing."', "event_title", None) == "Moon landing"
    assert _clean_polished_text("First line\n\nsecond line", "moment_title", None) == "First line second line"
    # Subtitles keep their sentence punctuation.
    assert _clean_polished_text("It happened.\nThen more.", "event_subtitle", None) == "It happened. Then more."


def test_clean_polished_text_keeps_markdown_and_respects_max_length():
    md = "## Heading\n\n- one\n- two"
    assert _clean_polished_text(md, "event_description", None) == md
    out = _clean_polished_text("word " * 50, "timeline_description", 42)
    assert len(out) <= 42
    assert not out.endswith(" ")


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "25")
    monkeypatch.delenv("CREDIT_COST_TEXT", raising=False)
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.delenv("GEMINI_API_KEY_FREE", raising=False)
    monkeypatch.setattr(quota_service, "is_spend_capped", lambda *a, **k: False)
    monkeypatch.setattr(quota_service, "reserve_community_paid_prompt", lambda credits=1: True)

    calls = []

    async def fake_polish(**kwargs):
        calls.append(kwargs)
        if kwargs["text"] == "boom":
            raise RuntimeError("model failed")
        return {"text": "Polished: " + kwargs["text"]}

    monkeypatch.setattr(main, "polish_user_text", fake_polish)
    current = {"user": USER}
    main.app.dependency_overrides[get_current_user_required] = lambda: current["user"]
    yield {"client": TestClient(main.app), "calls": calls, "current": current}
    main.app.dependency_overrides.pop(get_current_user_required, None)


def _used(user_id):
    return quota_service.get_user_daily_usage(user_id)


def test_polish_charges_one_text_credit(env):
    res = env["client"].post("/api/text/polish", json={
        "text": "we went to rome, saw colosseum", "field": "event_subtitle", "context": "Family trips", "max_length": 600,
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["text"] == "Polished: we went to rome, saw colosseum"
    assert body["credits"] == 1
    assert _used(USER["id"]) == 1
    call = env["calls"][0]
    assert call["field"] == "event_subtitle"
    assert call["context"] == "Family trips"
    assert call["max_length"] == 600


def test_long_drafts_cost_two_credits(env):
    res = env["client"].post("/api/text/polish", json={"text": "x" * 4500, "field": "timeline_overview"})
    assert res.status_code == 200, res.text
    assert res.json()["credits"] == 2
    assert _used(USER["id"]) == 2


def test_failed_polish_refunds_credit(env):
    res = env["client"].post("/api/text/polish", json={"text": "boom", "field": "event_title"})
    assert res.status_code == 500
    assert _used(USER["id"]) == 0


def test_rejects_unknown_field_and_blank_text(env):
    assert env["client"].post("/api/text/polish", json={"text": "hi", "field": "chat"}).status_code == 422
    assert env["client"].post("/api/text/polish", json={"text": "   ", "field": "event_title"}).status_code == 400
    assert _used(USER["id"]) == 0


def test_admin_and_byok_are_not_charged(env):
    env["current"]["user"] = ADMIN
    res = env["client"].post("/api/text/polish", json={"text": "notes", "field": "event_description"})
    assert res.status_code == 200
    assert res.json()["credits"] == 0
    assert _used(ADMIN["id"]) == 0

    env["current"]["user"] = USER
    res = env["client"].post(
        "/api/text/polish",
        json={"text": "notes", "field": "event_description"},
        headers={"X-Gemini-Api-Key": "MY_OWN_KEY"},
    )
    assert res.status_code == 200
    assert res.json()["credits"] == 0
    assert _used(USER["id"]) == 0
    assert env["calls"][-1]["api_key"] == "MY_OWN_KEY"


def test_moment_story_is_written_out_not_just_tidied(env):
    res = env["client"].post("/api/text/polish", json={"text": "met at a wedding, danced", "field": "moment_story"})
    assert res.status_code == 200, res.text
    assert env["calls"][-1]["field"] == "moment_story"
