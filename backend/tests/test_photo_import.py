"""Story Studio photo import: per-tier plans, AI draft credits/refunds, image checks, reverse geocoding."""
import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
from services import quota_service, wiki_enricher
from services.auth_service import get_current_user_required
from services.byok_verification import mark_custom_key_verified
from services.entitlements import get_entitlements, photo_import_limits
from services.quota_service import calculate_photo_draft_credit_cost

USER = {"id": "photo-user-1", "email": "photos@example.com"}
ADMIN = {"id": "photo-admin-1", "email": "admin@example.com"}
GUEST = {"id": "photo-guest-1", "is_anonymous": True}


def _jpeg_b64(w=1200, h=900, color=(200, 120, 40)) -> str:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _png_b64() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (20, 20)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _events(n, images=None):
    return [
        {"id": f"e{i}", "place": "Lisbon, Portugal", "date_text": "12 May 2023", "photo_count": 30,
         "images": list(images or [])}
        for i in range(n)
    ]


# ---- Plans & pricing -------------------------------------------------------------------------

def test_plans_per_tier():
    guest = photo_import_limits(get_entitlements(GUEST))
    reg = photo_import_limits(get_entitlements(USER))
    # S-04: a key that hasn't completed a Gemini call yet keeps the caller's own plan.
    assert photo_import_limits(get_entitlements(USER, "MY_KEY"))["unlimited"] is False
    mark_custom_key_verified("MY_KEY")
    byok = photo_import_limits(get_entitlements(USER, "MY_KEY"))

    assert guest["tier"] == "guest" and guest["draft_events_per_call"] == 8 and guest["draft_images_per_event"] == 2
    assert reg["tier"] == "registered" and reg["draft_events_per_call"] == 12 and reg["draft_images_per_event"] == 3
    assert reg["draft_image_max_px"] == 384 and reg["draft_parallel_calls"] == 2
    assert reg["max_photos"] == 2000 and reg["max_places"] == 80

    assert byok["unlimited"] is True
    assert byok["draft_events_per_call"] == 40 and byok["draft_images_per_event"] == 6
    assert byok["draft_image_max_px"] == 768 and byok["draft_parallel_calls"] == 3
    assert byok["max_photos"] is None and byok["max_places"] is None


def test_admin_gets_unlimited_plan(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    assert photo_import_limits(get_entitlements(ADMIN))["unlimited"] is True


def test_draft_credit_cost_scales_with_events(monkeypatch):
    monkeypatch.delenv("PHOTO_DRAFT_EVENTS_PER_CREDIT", raising=False)
    assert calculate_photo_draft_credit_cost(1) == 1
    assert calculate_photo_draft_credit_cost(12) == 1
    assert calculate_photo_draft_credit_cost(13) == 2
    assert calculate_photo_draft_credit_cost(0) == 1
    monkeypatch.setenv("PHOTO_DRAFT_EVENTS_PER_CREDIT", "5")
    assert calculate_photo_draft_credit_cost(12) == 3


# ---- Draft endpoint ----------------------------------------------------------------------------

@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "25")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "10")
    monkeypatch.delenv("PHOTO_DRAFT_EVENTS_PER_CREDIT", raising=False)
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.delenv("GEMINI_API_KEY_FREE", raising=False)
    monkeypatch.setattr(quota_service, "is_spend_capped", lambda *a, **k: False)
    monkeypatch.setattr(quota_service, "reserve_community_paid_prompt", lambda credits=1: True)
    main.photo_draft_rate_limiter.records.clear()
    main.reverse_geocode_rate_limiter.records.clear()

    calls = []

    async def fake_draft(**kwargs):
        calls.append(kwargs)
        if kwargs["story_title"] == "boom":
            raise RuntimeError("model failed")
        return {"drafts": [{"id": e["id"], "title": f"Day in {e['place']}", "description": "Walks."} for e in kwargs["events"]]}

    monkeypatch.setattr(main, "draft_photo_events", fake_draft)
    current = {"user": USER}
    main.app.dependency_overrides[get_current_user_required] = lambda: current["user"]
    yield {"client": TestClient(main.app), "calls": calls, "current": current}
    main.app.dependency_overrides.pop(get_current_user_required, None)
    main.photo_draft_rate_limiter.records.clear()
    main.reverse_geocode_rate_limiter.records.clear()


def _used(user_id):
    return quota_service.get_user_daily_usage(user_id)


def test_registered_pays_one_credit_per_twelve_events(env):
    res = env["client"].post("/api/story/photo-drafts", json={"events": _events(12), "lang": "en"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["drafts"]) == 12
    assert body["credits"] == 1
    assert _used(USER["id"]) == 1


def test_registered_batch_ceiling(env):
    res = env["client"].post("/api/story/photo-drafts", json={"events": _events(13)})
    assert res.status_code == 400
    assert "max 12" in res.json()["detail"]
    assert _used(USER["id"]) == 0
    assert env["calls"] == []


def test_guest_batch_ceiling_and_charge(env):
    env["current"]["user"] = GUEST
    assert env["client"].post("/api/story/photo-drafts", json={"events": _events(9)}).status_code == 400
    res = env["client"].post("/api/story/photo-drafts", json={"events": _events(8)})
    assert res.status_code == 200, res.text
    assert res.json()["credits"] == 1


def test_byok_is_unlimited_and_free(env):
    # Unverified key (S-04): registered-size limits apply until the key has worked once.
    unverified = env["client"].post(
        "/api/story/photo-drafts",
        json={"events": _events(40)},
        headers={"X-Gemini-Api-Key": "MY_OWN_KEY"},
    )
    assert unverified.status_code == 400
    mark_custom_key_verified("MY_OWN_KEY")
    res = env["client"].post(
        "/api/story/photo-drafts",
        json={"events": _events(40, images=[_jpeg_b64(700, 500)] * 6)},
        headers={"X-Gemini-Api-Key": "MY_OWN_KEY"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["credits"] == 0
    assert _used(USER["id"]) == 0
    call = env["calls"][-1]
    assert call["api_key"] == "MY_OWN_KEY"
    assert len(call["events"]) == 40
    assert all(len(e["images"]) == 6 for e in call["events"])


def test_admin_is_unlimited_and_free(env):
    env["current"]["user"] = ADMIN
    res = env["client"].post("/api/story/photo-drafts", json={"events": _events(40)})
    assert res.status_code == 200, res.text
    assert res.json()["credits"] == 0
    assert _used(ADMIN["id"]) == 0


def test_failed_draft_refunds_credits(env):
    res = env["client"].post("/api/story/photo-drafts", json={"events": _events(5), "story_title": "boom"})
    assert res.status_code == 500
    assert _used(USER["id"]) == 0


def test_limited_images_are_capped_and_downsized(env):
    big = _jpeg_b64(2000, 1500)
    res = env["client"].post(
        "/api/story/photo-drafts",
        json={"events": [{"id": "a", "photo_count": 5, "images": [big, big, big, big, _png_b64(), "not-base64!"]}]},
    )
    assert res.status_code == 200, res.text
    images = env["calls"][-1]["events"][0]["images"]
    # Only the registered per-event cap (3) is considered; all three are big JPEGs -> downsized.
    assert len(images) == 3
    for data in images:
        with Image.open(io.BytesIO(data)) as img:
            assert max(img.size) <= 384


def test_non_jpeg_images_are_dropped(env):
    res = env["client"].post(
        "/api/story/photo-drafts",
        json={"events": [{"id": "a", "images": [_png_b64(), "%%%"]}]},
    )
    assert res.status_code == 200, res.text
    assert env["calls"][-1]["events"][0]["images"] == []


def test_duplicate_event_ids_rejected(env):
    events = _events(2)
    events[1]["id"] = events[0]["id"]
    assert env["client"].post("/api/story/photo-drafts", json={"events": events}).status_code == 400


def test_limits_endpoint_reflects_key(env):
    reg = env["client"].get("/api/story/photo-import/limits").json()
    assert reg["unlimited"] is False and reg["events_per_credit"] == 12
    unverified = env["client"].get("/api/story/photo-import/limits", headers={"X-Gemini-Api-Key": "K"}).json()
    assert unverified["unlimited"] is False
    mark_custom_key_verified("K")
    byok = env["client"].get("/api/story/photo-import/limits", headers={"X-Gemini-Api-Key": "K"}).json()
    assert byok["unlimited"] is True and byok["draft_events_per_call"] == 40


# ---- Reverse geocoding -------------------------------------------------------------------------

def test_round_reverse_geocode_point():
    assert wiki_enricher.round_reverse_geocode_point(38.71234, -9.13999) == (38.71, -9.14)
    assert wiki_enricher.round_reverse_geocode_point(91, 0) is None
    assert wiki_enricher.round_reverse_geocode_point("x", 0) is None


def test_reverse_hit_mapping():
    place = wiki_enricher._reverse_hit_to_place({
        "name": "Alfama",
        "display_name": "Alfama, Lisboa, Portugal",
        "address": {"suburb": "Alfama", "city": "Lisboa", "state": "Lisboa", "country": "Portugal", "country_code": "pt"},
    })
    assert place["city"] == "Lisboa" and place["area"] == "Alfama" and place["countryCode"] == "PT"
    assert wiki_enricher._reverse_hit_to_place({"error": "Unable to geocode"}) is None


def test_reverse_geocode_dedupes_cells_and_caps_points(env, monkeypatch):
    looked_up = []

    async def fake_reverse(lat, lng, lang=None):
        looked_up.append((lat, lng))
        return {"city": "Lisboa", "country": "Portugal"}

    monkeypatch.setattr(main, "reverse_geocode_point", fake_reverse)
    pts = [
        {"id": "a", "lat": 38.71231, "lng": -9.13991},
        {"id": "b", "lat": 38.71249, "lng": -9.14004},  # same ~1 km cell as "a"
        {"id": "c", "lat": 41.15, "lng": -8.61},
    ]
    res = env["client"].post("/api/timeline/reverse-geocode", json={"points": pts, "lang": "en"})
    assert res.status_code == 200, res.text
    assert [r["id"] for r in res.json()["results"]] == ["a", "b", "c"]
    assert len(looked_up) == 2

    many = [{"id": f"p{i}", "lat": 10 + i, "lng": 10} for i in range(11)]
    assert env["client"].post("/api/timeline/reverse-geocode", json={"points": many}).status_code == 400
    unverified = env["client"].post(
        "/api/timeline/reverse-geocode", json={"points": many}, headers={"X-Gemini-Api-Key": "K"},
    )
    assert unverified.status_code == 400  # S-04: an unverified key doesn't widen the place lookup
    mark_custom_key_verified("K")
    ok = env["client"].post(
        "/api/timeline/reverse-geocode", json={"points": many}, headers={"X-Gemini-Api-Key": "K"},
    )
    assert ok.status_code == 200


def test_tagged_people_reach_the_model_bounded(env):
    names = ["Dana", "Avi", "", 7] + [f"P{i}" for i in range(20)]
    res = env["client"].post("/api/story/photo-drafts", json={"events": [{"id": "a", "people_tagged": names[:10]}]})
    assert res.status_code == 422  # 7 is not a string
    res = env["client"].post("/api/story/photo-drafts", json={"events": [{"id": "a", "people_tagged": ["Dana", "Avi"]}]})
    assert res.status_code == 200, res.text
    assert env["calls"][-1]["events"][0]["people_tagged"] == ["Dana", "Avi"]
    too_many = env["client"].post("/api/story/photo-drafts", json={"events": [{"id": "a", "people_tagged": [f"P{i}" for i in range(11)]}]})
    assert too_many.status_code == 422



def test_place_guesses_only_for_events_that_asked_and_with_confidence():
    from services.gemini_service import normalize_photo_drafts
    items = [
        {"id": "a", "title": "Eiffel Tower at dusk", "description": "x", "place_guess": "Eiffel Tower, Paris, France", "place_confidence": "high"},
        {"id": "b", "title": "Beach day", "description": "x", "place_guess": "Some beach", "place_confidence": "none"},
        {"id": "c", "title": "Dinner", "description": "x", "place_guess": "Lisbon", "place_confidence": "medium"},
    ]
    out = {d["id"]: d for d in normalize_photo_drafts(items, {"a", "b", "c"}, needs_place={"a", "b"})}
    assert out["a"]["place_guess"] == "Eiffel Tower, Paris, France" and out["a"]["place_confidence"] == "high"
    assert "place_guess" not in out["b"]   # no confidence -> no guess
    assert "place_guess" not in out["c"]   # had a place already -> never guessed


def test_needs_place_is_forwarded(env):
    res = env["client"].post("/api/story/photo-drafts", json={"events": [{"id": "a", "needs_place": True}, {"id": "b"}]})
    assert res.status_code == 200, res.text
    sent = env["calls"][-1]["events"]
    assert sent[0]["needs_place"] is True and sent[1]["needs_place"] is False
