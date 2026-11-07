"""Story Studio AI overview: facts brief, credit charging, refunds, limits and BYOK/admin exemptions."""
import pytest
from fastapi.testclient import TestClient

import main
from services import quota_service
from services.auth_service import get_current_user_required
from services.gemini_service import _story_overview_facts

USER = {"id": "overview-user-1", "email": "writer@example.com"}
ADMIN = {"id": "overview-admin-1", "email": "admin@example.com"}

STORY = {
    "title": "Claire & Ethan",
    "kind": "Couple & wedding",
    "people": ["Claire", "Ethan"],
    "lanes": ["Claire's path", "Together"],
    "chapters": [{"title": "Together", "from": "2019", "to": "2024"}],
    "moments": [
        {"title": "We meet", "date": "summer 2019", "place": "Lisbon", "lane": "Together",
         "note": "At a friend's wedding", "story": "danced all night\nmissed the last tram"},
        {"title": "Wedding", "date": "June 2023"},
    ],
    "language": "en",
}


def test_facts_brief_lists_everything_the_user_entered():
    brief = _story_overview_facts(STORY)
    assert "Title: Claire & Ethan" in brief
    assert "People: Claire, Ethan" in brief
    assert "- Together (2019 - 2024)" in brief
    assert "- We meet [summer 2019, Lisbon, Together]" in brief
    assert "Summary: At a friend's wedding" in brief
    # Multi-line notes are kept on one line so the brief stays a clean list.
    assert "What happened: danced all night / missed the last tram" in brief
    assert "- Wedding [June 2023]" in brief


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

    async def fake_overview(**kwargs):
        calls.append(kwargs)
        if kwargs["story"]["title"] == "boom":
            raise RuntimeError("model failed")
        return {"overview": "## Our story\n\nIt began in Lisbon."}

    monkeypatch.setattr(main, "draft_story_overview", fake_overview)
    current = {"user": USER}
    main.app.dependency_overrides[get_current_user_required] = lambda: current["user"]
    yield {"client": TestClient(main.app), "calls": calls, "current": current}
    main.app.dependency_overrides.pop(get_current_user_required, None)


def _used(user_id):
    return quota_service.get_user_daily_usage(user_id)


def test_overview_charges_one_text_credit(env):
    res = env["client"].post("/api/story/overview", json=STORY)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["overview"].startswith("## Our story")
    assert body["credits"] == 1
    assert _used(USER["id"]) == 1
    call = env["calls"][0]
    assert call["language"] == "en"
    assert call["story"]["chapters"][0]["from"] == "2019"
    assert "api_key" not in call["story"] or call["story"].get("api_key") is None


def test_long_stories_cost_two_credits(env):
    story = {**STORY, "moments": [{"title": f"Moment {i}", "story": "x" * 500} for i in range(15)]}
    res = env["client"].post("/api/story/overview", json=story)
    assert res.status_code == 200, res.text
    assert res.json()["credits"] == 2
    assert _used(USER["id"]) == 2


def test_too_long_stories_are_refused_without_charge(env):
    story = {**STORY, "moments": [{"title": f"Moment {i}", "story": "x" * 5000} for i in range(15)]}
    res = env["client"].post("/api/story/overview", json=story)
    assert res.status_code == 413
    assert _used(USER["id"]) == 0


def test_failed_overview_refunds_credit(env):
    res = env["client"].post("/api/story/overview", json={**STORY, "title": "boom"})
    assert res.status_code == 500
    assert _used(USER["id"]) == 0


def test_needs_at_least_one_moment(env):
    res = env["client"].post("/api/story/overview", json={**STORY, "moments": []})
    assert res.status_code == 422
    assert _used(USER["id"]) == 0


def test_admin_and_byok_are_not_charged(env):
    env["current"]["user"] = ADMIN
    res = env["client"].post("/api/story/overview", json=STORY)
    assert res.status_code == 200
    assert res.json()["credits"] == 0
    assert _used(ADMIN["id"]) == 0

    env["current"]["user"] = USER
    res = env["client"].post("/api/story/overview", json=STORY, headers={"X-Gemini-Api-Key": "MY_OWN_KEY"})
    assert res.status_code == 200
    assert res.json()["credits"] == 0
    assert _used(USER["id"]) == 0
    assert env["calls"][-1]["api_key"] == "MY_OWN_KEY"


def test_overview_passes_the_occasion_but_not_into_the_facts(env):
    res = env["client"].post("/api/story/overview", json={**STORY, "occasion": "memorial"})
    assert res.status_code == 200
    call = env["calls"][-1]
    assert call["occasion"] == "memorial"
    assert "occasion" not in call["story"]


def test_overview_without_occasion_still_works_and_rejects_unknown_ones(env):
    res = env["client"].post("/api/story/overview", json=STORY)
    assert res.status_code == 200
    assert env["calls"][-1]["occasion"] is None
    bad = env["client"].post("/api/story/overview", json={**STORY, "occasion": "roast"})
    assert bad.status_code == 422


def test_every_occasion_has_a_tone():
    from typing import get_args
    from models import StoryOccasion
    from services.gemini_service import STORY_OCCASION_TONES
    assert set(get_args(StoryOccasion)) == set(STORY_OCCASION_TONES)
