"""AI-first photo import: full drafts (caption, story, cover, kind...) and the whole-import story pass."""
import pytest
from fastapi.testclient import TestClient

import main
from services import quota_service
from services.auth_service import get_current_user_optional, get_current_user_required
from services.byok_verification import mark_custom_key_verified
from services.entitlements import get_entitlements, photo_import_limits
from services.gemini_service import normalize_photo_drafts, normalize_photo_story
from services.quota_service import calculate_photo_draft_credit_cost, calculate_photo_story_credit_cost

USER = {"id": "photo-ai-user-1", "email": "photos-ai@example.com"}
ADMIN = {"id": "photo-ai-admin-1", "email": "admin@example.com"}
GUEST = {"id": "photo-ai-guest-1", "is_anonymous": True}


def _events(n):
    return [
        {"id": f"e{i}", "place": "Lisbon, Portugal", "date_text": f"{i + 1} May 2023", "photo_count": 12}
        for i in range(n)
    ]


def _story_events(n):
    return [
        {"id": f"e{i}", "date_text": f"{i + 1} May 2023", "place": "Lisbon", "title": f"Day {i}", "caption": "Walks.",
         "story": "We walked up the hills.", "photo_count": 10}
        for i in range(n)
    ]


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "25")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "10")
    for var in ("PHOTO_DRAFT_EVENTS_PER_CREDIT", "PHOTO_DRAFT_FULL_EVENTS_PER_CREDIT", "PHOTO_STORY_EVENTS_PER_CREDIT"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.delenv("GEMINI_API_KEY_FREE", raising=False)
    monkeypatch.setattr(quota_service, "is_spend_capped", lambda *a, **k: False)
    monkeypatch.setattr(quota_service, "reserve_community_paid_prompt", lambda credits=1: True)
    main.photo_draft_rate_limiter.records.clear()

    draft_calls = []
    story_calls = []

    async def fake_draft(**kwargs):
        draft_calls.append(kwargs)
        return {"drafts": [
            {"id": e["id"], "title": "Hills of Lisbon", "description": "Walks.", "caption": "Walks.", "story": "Long walk.",
             "cover_index": 0, "kind": "moment", "category": "Travel", "importance": 6, "occasion": ""}
            for e in kwargs["events"]
        ]}

    async def fake_story(**kwargs):
        story_calls.append(kwargs)
        if kwargs.get("story_context") == "boom":
            raise RuntimeError("model failed")
        return {"timeline_title": "Two weeks in Portugal", "story_type": "trip", "subject_names": ["Portugal"],
                "lane_title": "The journey", "chapters": [], "merges": [], "titles": [], "highlights": [],
                "tokenUsage": {"total": 1}}

    monkeypatch.setattr(main, "draft_photo_events", fake_draft)
    monkeypatch.setattr(main, "draft_photo_story", fake_story)
    current = {"user": USER}
    main.app.dependency_overrides[get_current_user_required] = lambda: current["user"]
    yield {"client": TestClient(main.app), "draft_calls": draft_calls, "story_calls": story_calls, "current": current}
    main.app.dependency_overrides.pop(get_current_user_required, None)
    main.photo_draft_rate_limiter.records.clear()


def _used(user_id):
    return quota_service.get_user_daily_usage(user_id)


# ---- Pricing & plans --------------------------------------------------------------------------

def test_full_drafts_cost_one_credit_per_eight_events(monkeypatch):
    for var in ("PHOTO_DRAFT_EVENTS_PER_CREDIT", "PHOTO_DRAFT_FULL_EVENTS_PER_CREDIT"):
        monkeypatch.delenv(var, raising=False)
    assert calculate_photo_draft_credit_cost(8, "full") == 1
    assert calculate_photo_draft_credit_cost(9, "full") == 2
    assert calculate_photo_draft_credit_cost(12, "full") == 2
    assert calculate_photo_draft_credit_cost(12, "brief") == 1
    monkeypatch.setenv("PHOTO_DRAFT_FULL_EVENTS_PER_CREDIT", "4")
    assert calculate_photo_draft_credit_cost(12, "full") == 3


def test_story_pass_cost(monkeypatch):
    monkeypatch.delenv("PHOTO_STORY_EVENTS_PER_CREDIT", raising=False)
    assert calculate_photo_story_credit_cost(1) == 1
    assert calculate_photo_story_credit_cost(120) == 1
    assert calculate_photo_story_credit_cost(121) == 2
    monkeypatch.setenv("PHOTO_STORY_EVENTS_PER_CREDIT", "50")
    assert calculate_photo_story_credit_cost(120) == 3


def test_plans_for_the_ai_first_import():
    guest = photo_import_limits(get_entitlements(GUEST))
    reg = photo_import_limits(get_entitlements(USER))
    mark_custom_key_verified("AI_FIRST_KEY")
    byok = photo_import_limits(get_entitlements(USER, "AI_FIRST_KEY"))
    # Registered users run two drafting calls at once (speed, not cost); guests one.
    assert reg["draft_parallel_calls"] == 2 and guest["draft_parallel_calls"] == 1
    assert guest["story_max_events"] == 150 and reg["story_max_events"] == 250
    assert byok["story_max_events"] == 600 and byok["draft_parallel_calls"] == 3


def test_limits_endpoint_reports_ai_first_prices(env):
    main.app.dependency_overrides[get_current_user_optional] = lambda: USER
    try:
        body = env["client"].get("/api/story/photo-import/limits").json()
    finally:
        main.app.dependency_overrides.pop(get_current_user_optional, None)
    assert body["full_events_per_credit"] == 8
    assert body["story_events_per_credit"] == 120
    assert body["story_max_events"] == 250


# ---- Full drafts ------------------------------------------------------------------------------

def test_full_drafts_are_priced_and_forwarded(env):
    res = env["client"].post("/api/story/photo-drafts", json={
        "events": [dict(e, time_text="09:10-18:40", sequence="day 2 of 12 of a trip") for e in _events(12)],
        "detail": "full",
        "story_context": "Our honeymoon in Portugal - Dana and me",
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["credits"] == 2  # 12 full events at 8 per credit
    assert _used(USER["id"]) == 2
    call = env["draft_calls"][-1]
    assert call["detail"] == "full"
    assert call["story_context"] == "Our honeymoon in Portugal - Dana and me"
    assert call["events"][0]["time_text"] == "09:10-18:40"
    assert call["events"][0]["sequence"] == "day 2 of 12 of a trip"
    assert body["drafts"][0]["story"] == "Long walk."


def test_brief_is_still_the_default(env):
    res = env["client"].post("/api/story/photo-drafts", json={"events": _events(12)})
    assert res.status_code == 200, res.text
    assert res.json()["credits"] == 1
    assert env["draft_calls"][-1]["detail"] == "brief"


def test_unknown_detail_is_rejected(env):
    res = env["client"].post("/api/story/photo-drafts", json={"events": _events(1), "detail": "epic"})
    assert res.status_code == 422


def test_full_draft_normalisation():
    items = [
        {"id": "a", "title": "\"Sunset over Lisbon.\"", "caption": "Golden light  on the river.", "story": "We  watched\nthe sun.",
         "cover_index": 7, "kind": "MEME", "category": "Travel.", "importance": 42, "occasion": ""},
        {"id": "b", "title": "Birthday at home", "caption": "Cake.", "story": "", "cover_index": -3, "kind": "document",
         "importance": "x", "occasion": "Birthday", "place_guess": "Somewhere", "place_confidence": "high"},
        {"id": "zzz", "title": "Not asked for", "caption": "", "story": ""},
    ]
    out = {d["id"]: d for d in normalize_photo_drafts(items, {"a", "b"}, needs_place=set(), full=True, image_counts={"a": 3, "b": 0})}
    assert set(out) == {"a", "b"}
    a = out["a"]
    assert a["title"] == "Sunset over Lisbon"
    assert a["caption"] == a["description"] == "Golden light on the river."
    assert a["story"] == "We watched the sun."
    assert a["cover_index"] == 2          # clamped to the 3 photos actually sent
    assert a["kind"] == "moment"          # unknown kind -> moment
    assert a["importance"] == 10 and a["category"] == "Travel"
    b = out["b"]
    assert b["cover_index"] == 0 and b["kind"] == "document" and b["importance"] == 5
    assert b["occasion"] == "Birthday"
    assert "place_guess" not in b         # the event didn't ask for a place


# ---- Story pass endpoint ------------------------------------------------------------------------

def test_story_pass_charges_and_forwards(env):
    res = env["client"].post("/api/story/photo-story", json={
        "events": _story_events(30), "story_context": "Two weeks in Portugal", "people": ["Dana"],
        "home": "Tel Aviv", "lang": "en",
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["credits"] == 1 and _used(USER["id"]) == 1
    assert body["timeline_title"] == "Two weeks in Portugal"
    assert "tokenUsage" not in body
    call = env["story_calls"][-1]
    assert call["home"] == "Tel Aviv" and call["mode"] == "new" and len(call["events"]) == 30
    assert call["events"][0]["caption"] == "Walks."


def test_story_pass_tier_ceilings(env):
    env["current"]["user"] = GUEST
    assert env["client"].post("/api/story/photo-story", json={"events": _story_events(151)}).status_code == 400
    assert env["story_calls"] == []
    env["current"]["user"] = ADMIN
    res = env["client"].post("/api/story/photo-story", json={"events": _story_events(400)})
    assert res.status_code == 200, res.text
    assert res.json()["credits"] == 0 and _used(ADMIN["id"]) == 0


def test_story_pass_byok_is_free(env):
    mark_custom_key_verified("STORY_KEY")
    res = env["client"].post("/api/story/photo-story", json={"events": _story_events(300)}, headers={"X-Gemini-Api-Key": "STORY_KEY"})
    assert res.status_code == 200, res.text
    assert res.json()["credits"] == 0 and _used(USER["id"]) == 0
    assert env["story_calls"][-1]["api_key"] == "STORY_KEY"


def test_story_pass_rejects_duplicates_and_refunds_failures(env):
    events = _story_events(3)
    events[2]["id"] = "e0"
    assert env["client"].post("/api/story/photo-story", json={"events": events}).status_code == 400
    failed = env["client"].post("/api/story/photo-story", json={"events": _story_events(3), "story_context": "boom"})
    assert failed.status_code == 500
    assert _used(USER["id"]) == 0


# ---- Story pass normalisation ----------------------------------------------------------------------

EV = [{"id": f"e{i}", "people_tagged": ["Avi"] if i == 3 else []} for i in range(8)]


def test_story_chapters_must_be_ordered_and_not_overlap():
    raw = {
        "timeline_title": "Our year", "story_type": "custom",
        "chapters": [
            {"title": "Spring", "first_event_id": "e0", "last_event_id": "e2"},
            {"title": "Overlap", "first_event_id": "e2", "last_event_id": "e4"},
            {"title": "Summer", "first_event_id": "e5", "last_event_id": "e3"},   # reversed -> e3..e5
            {"title": "Ghost", "first_event_id": "e9", "last_event_id": "e7"},    # unknown id
            {"title": "", "first_event_id": "e6", "last_event_id": "e7"},         # no title
        ],
    }
    out = normalize_photo_story(raw, EV)
    assert [(c["title"], c["first_event_id"], c["last_event_id"]) for c in out["chapters"]] == [
        ("Spring", "e0", "e2"), ("Summer", "e3", "e5"),
    ]


def test_story_needs_six_events_for_chapters():
    raw = {"timeline_title": "Short", "chapters": [{"title": "All", "first_event_id": "e0", "last_event_id": "e2"}]}
    assert normalize_photo_story(raw, EV[:3])["chapters"] == []


def test_story_merges_only_neighbours():
    raw = {"timeline_title": "T", "merges": [
        {"event_ids": ["e2", "e1"], "title": "Late night", "caption": "Past midnight."},
        {"event_ids": ["e4", "e6"]},           # not neighbours
        {"event_ids": ["e2", "e3"]},           # e2 already merged
        {"event_ids": ["e7"]},                 # one event
    ]}
    out = normalize_photo_story(raw, EV)
    assert out["merges"] == [{"event_ids": ["e1", "e2"], "title": "Late night", "caption": "Past midnight."}]


def test_story_never_changes_user_titles():
    events = [dict(e, user_titled=(e["id"] == "e1")) for e in EV]
    raw = {"timeline_title": "T", "titles": [{"id": "e1", "title": "Changed"}, {"id": "e2", "title": "Better title."},
                                              {"id": "e2", "title": "Twice"}, {"id": "nope", "title": "x"}]}
    assert normalize_photo_story(raw, events)["titles"] == [{"id": "e2", "title": "Better title"}]


def test_story_names_must_come_from_the_user():
    invented = normalize_photo_story({"timeline_title": "T", "story_type": "child", "subject_names": ["Noa"]}, EV, story_context="Our kid's first year")
    assert invented["story_type"] == "custom" and invented["subject_names"] == []
    given = normalize_photo_story({"timeline_title": "T", "story_type": "child", "subject_names": ["Noa"]}, EV, story_context="Noa's first year")
    assert given["story_type"] == "child" and given["subject_names"] == ["Noa"]
    tagged = normalize_photo_story({"timeline_title": "T", "story_type": "couple", "subject_names": ["Dana", "Avi"]}, EV, people=["Dana"])
    assert tagged["story_type"] == "couple" and tagged["subject_names"] == ["Dana", "Avi"]
    half = normalize_photo_story({"timeline_title": "T", "story_type": "couple", "subject_names": ["Dana", "Moshe"]}, EV, people=["Dana"])
    assert half["story_type"] == "custom"
    trip = normalize_photo_story({"timeline_title": "T", "story_type": "trip", "subject_names": ["Portugal", "Spain"]}, EV)
    assert trip["story_type"] == "trip" and trip["subject_names"] == ["Portugal"]
    bad = normalize_photo_story({"timeline_title": "T", "story_type": "epic"}, EV)
    assert bad["story_type"] == "custom"


def test_story_add_mode_keeps_the_existing_story():
    raw = {"timeline_title": "Something new", "story_type": "trip", "subject_names": ["Japan"], "lane_title": "X",
           "highlights": ["e1", "e1", "e9", "e2"]}
    out = normalize_photo_story(raw, EV, mode="add", existing_title="Claire & Ethan")
    assert out["timeline_title"] == "Claire & Ethan"
    assert out["story_type"] == "custom" and out["subject_names"] == [] and out["lane_title"] == ""
    assert out["highlights"] == ["e1", "e2"]


# ---- The user's own instructions for the AI ---------------------------------------------------

def test_instructions_ceiling_per_plan():
    assert photo_import_limits(get_entitlements(GUEST))["instructions_max_chars"] == 2800
    assert photo_import_limits(get_entitlements(USER))["instructions_max_chars"] == 2800
    mark_custom_key_verified("INSTRUCTIONS_KEY")
    assert photo_import_limits(get_entitlements(USER, "INSTRUCTIONS_KEY"))["instructions_max_chars"] == 10_000


def test_instructions_are_forwarded_and_capped_by_plan(env):
    ok = env["client"].post("/api/story/photo-drafts", json={
        "events": _events(2), "detail": "full", "instructions": "Write in the first person.",
    })
    assert ok.status_code == 200, ok.text
    assert env["draft_calls"][-1]["instructions"] == "Write in the first person."
    story = env["client"].post("/api/story/photo-story", json={"events": _story_events(3), "instructions": "Short titles."})
    assert story.status_code == 200, story.text
    assert env["story_calls"][-1]["instructions"] == "Short titles."

    # Over the registered ceiling: rejected before any credit is charged.
    used = _used(USER["id"])
    long_text = "x" * 2801
    assert env["client"].post("/api/story/photo-drafts", json={"events": _events(2), "detail": "full", "instructions": long_text}).status_code == 400
    assert env["client"].post("/api/story/photo-story", json={"events": _story_events(3), "instructions": long_text}).status_code == 400
    assert _used(USER["id"]) == used

    # Admins get the unlimited ceiling.
    env["current"]["user"] = ADMIN
    res = env["client"].post("/api/story/photo-story", json={"events": _story_events(3), "instructions": "y" * 9000})
    assert res.status_code == 200, res.text


def test_instructions_go_into_the_prompts_without_lifting_the_rules():
    from services.gemini_service import (
        _photo_draft_full_system_instruction, _photo_story_system_instruction, _clean_photo_instructions,
    )
    full = _photo_draft_full_system_instruction("English", [], "", "", "Write in the first person.")
    assert "THE USER'S INSTRUCTIONS" in full and "Write in the first person." in full
    assert "never override the FACTS" in full
    story = _photo_story_system_instruction("English", "new", "", "", "Name chapters by city.")
    assert "Name chapters by city." in story
    # No instructions: no block at all.
    assert "THE USER'S INSTRUCTIONS" not in _photo_draft_full_system_instruction("English", [], "", "")
    assert "THE USER'S INSTRUCTIONS" not in _photo_story_system_instruction("English", "new", "", "")
    assert _clean_photo_instructions("  a   b\n\n\n\nc  ") == "a b\n\nc"
    assert len(_clean_photo_instructions("z" * 20_000)) == 10_000


def test_story_names_may_come_from_the_instructions():
    named = normalize_photo_story(
        {"timeline_title": "T", "story_type": "child", "subject_names": ["Noa"]}, EV,
        instructions="This is about our daughter Noa's first year.",
    )
    assert named["story_type"] == "child" and named["subject_names"] == ["Noa"]
