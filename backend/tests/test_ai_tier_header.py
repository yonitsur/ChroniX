"""X-ChroniX-AI-Tier response header: lets the UI notice the fast -> basic mode switch on the spot."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import main
from services import quota_service
from services.auth_service import get_current_user_required

USER = {"id": "tier-header-user-1", "email": "tier@example.com"}
HEADER = quota_service.AI_TIER_HEADER


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "2")
    monkeypatch.delenv("CREDIT_COST_TEXT", raising=False)
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY")
    monkeypatch.setattr(quota_service, "is_spend_capped", lambda *a, **k: False)
    monkeypatch.setattr(quota_service, "reserve_community_paid_prompt", lambda credits=1: True)

    async def fake_polish(**kwargs):
        return {"text": "Polished: " + kwargs["text"]}

    monkeypatch.setattr(main, "polish_user_text", fake_polish)
    main.app.dependency_overrides[get_current_user_required] = lambda: USER
    yield TestClient(main.app)
    main.app.dependency_overrides.pop(get_current_user_required, None)


def _polish(client, **headers):
    return client.post("/api/text/polish", json={"text": "draft", "field": "event_subtitle"}, headers=headers)


def test_header_reports_fast_then_basic_mode(env):
    for _ in range(2):
        res = _polish(env)
        assert res.status_code == 200, res.text
        assert res.headers.get(HEADER) == "paid"
    # Credits used up -> served by the backup key, and the header says so.
    res = _polish(env)
    assert res.status_code == 200, res.text
    assert res.headers.get(HEADER) == "free"


def test_header_reports_custom_key(env):
    res = _polish(env, **{"X-Gemini-Api-Key": "AIzaSyPersonal"})
    assert res.status_code == 200, res.text
    assert res.headers.get(HEADER) == "custom"


def test_non_ai_requests_carry_no_tier_header(env):
    res = env.get("/api/user/quota")
    assert res.status_code == 200
    assert HEADER not in res.headers


def test_quota_info_includes_next_utc_reset(env):
    body = env.get("/api/user/quota").json()
    resets_at = datetime.fromisoformat(body["resets_at"].replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    assert resets_at > now
    assert (resets_at - now).total_seconds() <= 24 * 3600
    assert (resets_at.hour, resets_at.minute) == (0, 0)


def test_free_tier_is_sticky_within_one_request():
    holder = quota_service.begin_request_ai_tier_tracking()
    quota_service.note_request_ai_tier("free")
    quota_service.note_request_ai_tier("paid")
    assert holder["tier"] == "free"
