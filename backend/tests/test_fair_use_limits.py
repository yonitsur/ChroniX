"""
Fair-use protection for the server's paid Gemini key:
- per-tier entitlements (guest / registered / unlimited = admin or BYOK)
- hidden real-cost (USD) backstop per identity and system-wide
- event ceilings, refine context budget, auto AI image gating
- unlimited podcasts over every event via multi-part scripting
"""
import json
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest

import services.quota_service as quota
from models import GeminiTimelineOutput, TimelineData, TimelinePodcastRequest
from services import gemini_service
from services.activity_log import record_extra_cost, track_ai_activity
from services.byok_verification import mark_custom_key_verified
from services.entitlements import (
    TIER_GUEST,
    TIER_REGISTERED,
    TIER_UNLIMITED,
    effective_auto_ai_images,
    get_entitlements,
)

ADMIN_EMAIL = "owner@example.com"
REGISTERED = {"id": "user-1", "email": "someone@example.com"}
GUEST = {"id": "anon-1", "is_anonymous": True}
ADMIN = {"id": "admin-1", "email": ADMIN_EMAIL}


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for var in list(os.environ.keys()):
        if var.startswith("GEMINI_API_KEY_FREE") or var.startswith("DAILY_USD_CAP") or var.endswith("_USD_LIMIT"):
            monkeypatch.delenv(var, raising=False)
    for var in ("API_KEY_MODE", "GUEST_API_KEY_MODE", "DAILY_PAID_PROMPTS", "GUEST_DAILY_PAID_PROMPTS",
                "GUEST_IP_DAILY_PAID_PROMPTS", "GUEST_IP_DAILY_USD_CAP", "DAILY_COMMUNITY_PAID_LIMIT",
                "MONTHLY_COMMUNITY_PAID_LIMIT"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("ADMIN_EMAILS", ADMIN_EMAIL)
    monkeypatch.setenv("GEMINI_API_KEY", "paid-key")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "free-key")
    quota._KEY_COOLDOWNS.clear()
    quota._free_key_rr_counter = 0


# --- entitlements -------------------------------------------------------------------

def test_entitlement_tiers():
    assert get_entitlements(GUEST).tier == TIER_GUEST
    assert get_entitlements(REGISTERED).tier == TIER_REGISTERED
    assert get_entitlements(ADMIN).tier == TIER_UNLIMITED
    # S-04: an unverified personal key keeps the caller's own tier ...
    assert get_entitlements(REGISTERED, custom_api_key="my-own-key").tier == TIER_REGISTERED
    assert get_entitlements(GUEST, custom_api_key="my-own-key").tier == TIER_GUEST
    # ... and unlocks unlimited once it has completed a Gemini call.
    mark_custom_key_verified("my-own-key")
    assert get_entitlements(REGISTERED, custom_api_key="my-own-key").tier == TIER_UNLIMITED
    assert get_entitlements(GUEST, custom_api_key="my-own-key").tier == TIER_UNLIMITED
    assert get_entitlements(REGISTERED, custom_api_key="   ").tier == TIER_REGISTERED


def test_limited_tiers_have_ceilings_and_unlimited_has_none():
    guest, reg, unl = get_entitlements(GUEST), get_entitlements(REGISTERED), get_entitlements(ADMIN)
    assert guest.max_file_events < reg.max_file_events
    assert guest.podcast_full_max_events == reg.podcast_full_max_events == 25
    assert unl.max_prompt_events is None and unl.max_file_events is None
    assert unl.podcast_full_max_events is None and unl.max_refine_context_chars is None


def test_entitlement_env_override_and_disable(monkeypatch):
    monkeypatch.setenv("REGISTERED_MAX_FILE_EVENTS", "200")
    monkeypatch.setenv("GUEST_MAX_FILE_EVENTS", "0")
    assert get_entitlements(REGISTERED).max_file_events == 200
    assert get_entitlements(GUEST).max_file_events is None


def test_auto_ai_images_only_honoured_for_unlimited():
    assert effective_auto_ai_images(get_entitlements(REGISTERED), True) is False
    assert effective_auto_ai_images(get_entitlements(GUEST), None) is False
    assert effective_auto_ai_images(get_entitlements(ADMIN), True) is True
    mark_custom_key_verified("byok")
    assert effective_auto_ai_images(get_entitlements(REGISTERED, "byok"), None) is None


def test_api_key_mode_fails_closed():
    assert quota.get_api_key_mode() == "limited"
    os.environ["API_KEY_MODE"] = "unlimitd"  # typo must not open the floodgates
    try:
        assert quota.get_api_key_mode() == "limited"
    finally:
        del os.environ["API_KEY_MODE"]


# --- real-cost backstop -------------------------------------------------------------

def test_registered_spend_cap_falls_back_to_free_key_and_keeps_credits():
    key, tier, _ = quota.resolve_gemini_key(REGISTERED, client_ip="1.2.3.4")
    assert (key, tier) == ("paid-key", "paid")
    assert quota.get_user_daily_usage("user-1") == 1

    quota.record_identity_spend_usd(REGISTERED, "1.2.3.4", 0.51)  # above the $0.50 default cap
    assert quota.is_spend_capped(REGISTERED, "1.2.3.4")

    key, tier, _ = quota.resolve_gemini_key(REGISTERED, client_ip="1.2.3.4")
    assert (key, tier) == ("free-key", "free")
    # The capped request must not burn a credit.
    assert quota.get_user_daily_usage("user-1") == 1

    info = quota.get_user_quota_info(REGISTERED, "1.2.3.4")
    assert info["daily_spend_capped"] is True
    assert info["remaining_paid"] == 0 and info["tier"] == "free"


def test_spend_cap_declines_premium_features():
    quota.record_identity_spend_usd(REGISTERED, None, 1.0)
    allowed, key, tier, inc, pool = quota.charge_premium_credits(REGISTERED, None, None, credits=6)
    assert allowed is False and key is None
    assert quota.get_user_daily_usage("user-1") == 0


def test_guest_spend_cap_is_shared_across_sessions_on_same_ip(monkeypatch):
    # SC-12: the per-IP cap defaults to 5x the per-guest cap; pin it to the guest cap here.
    monkeypatch.setenv("GUEST_IP_DAILY_USD_CAP", "0.20")
    quota.record_identity_spend_usd(GUEST, "5.6.7.8", 0.25)  # above the $0.20 guest default
    other_session = {"id": "anon-2", "is_anonymous": True}
    assert quota.is_spend_capped(other_session, "5.6.7.8")
    assert not quota.is_spend_capped(other_session, "9.9.9.9")


def test_admin_and_byok_ignore_spend_caps():
    quota.record_identity_spend_usd(ADMIN, None, 50.0)
    assert quota.is_spend_capped(ADMIN) is False
    assert quota.resolve_gemini_key(ADMIN)[1] == "admin_paid"

    quota.record_identity_spend_usd(REGISTERED, None, 5.0)
    key, tier, _ = quota.resolve_gemini_key(REGISTERED, custom_api_key="their-key")
    assert (key, tier) == ("their-key", "custom")


def test_community_daily_usd_limit(monkeypatch):
    monkeypatch.setenv("DAILY_COMMUNITY_USD_LIMIT", "1.00")
    for i in range(3):
        quota.record_identity_spend_usd({"id": f"u-{i}"}, None, 0.40)
    status = quota.get_spend_status({"id": "fresh-user"})
    assert status == {"capped": True, "reason": "community"}


def test_spend_caps_can_be_disabled(monkeypatch):
    monkeypatch.setenv("DAILY_USD_CAP_REGISTERED", "0")
    monkeypatch.setenv("DAILY_COMMUNITY_USD_LIMIT", "-1")
    quota.record_identity_spend_usd(REGISTERED, None, 100.0)
    assert quota.is_spend_capped(REGISTERED) is False


@pytest.mark.asyncio
async def test_track_ai_activity_meters_only_paid_tier_spend():
    quota.set_request_client_ip("1.2.3.4")
    async with track_ai_activity("generate_timeline", REGISTERED, key_tier="paid"):
        record_extra_cost(0.30, model="gemini-test")
    async with track_ai_activity("generate_timeline", REGISTERED, key_tier="free"):
        record_extra_cost(5.00, model="gemini-test")
    async with track_ai_activity("generate_timeline", REGISTERED, key_tier="custom"):
        record_extra_cost(5.00, model="gemini-test")
    spent = quota.get_user_daily_usage("spend:user-1")
    assert spent == 300_000  # micro-dollars: only the paid-key operation counts


@pytest.mark.asyncio
async def test_failed_operation_spend_is_still_metered():
    """Credits are refunded on failure for a friendly UX, but real spend is never refunded."""
    with pytest.raises(RuntimeError):
        async with track_ai_activity("generate_timeline", REGISTERED, key_tier="paid"):
            record_extra_cost(0.60, model="gemini-test")
            raise RuntimeError("model output could not be parsed")
    assert quota.is_spend_capped(REGISTERED)


# --- event ceilings -----------------------------------------------------------------

def _parsed_with_events(n: int) -> GeminiTimelineOutput:
    events = [
        {"title": f"Event {i}", "from_year": 1900 + i, "importance_rank": (10 if i in (3, 7) else 4)}
        for i in range(n)
    ]
    return GeminiTimelineOutput(title="T", description="", overview="", events=events)


def test_cap_parsed_events_keeps_bookends_and_top_ranked_in_order():
    parsed = gemini_service.cap_parsed_events(_parsed_with_events(10), 4)
    titles = [e.title for e in parsed.events]
    assert titles == ["Event 0", "Event 3", "Event 7", "Event 9"]


def test_cap_parsed_events_noop_when_unlimited_or_under_cap():
    assert len(gemini_service.cap_parsed_events(_parsed_with_events(10), None).events) == 10
    assert len(gemini_service.cap_parsed_events(_parsed_with_events(3), 5).events) == 3


def test_event_budget_directive():
    assert "AT MOST 50 events" in gemini_service.event_budget_directive(50)
    assert "LARGE TIMELINES ALLOWED" in gemini_service.event_budget_directive(None, allow_large=True)
    assert gemini_service.event_budget_directive(None) == ""


def _timeline(n_events: int, subtitle: str = "A short subtitle.") -> TimelineData:
    return TimelineData(
        id="tl-1",
        title="Big timeline",
        lanes=[{"id": "main", "title": "Main"}],
        articles=[
            {"id": f"e{i}", "title": f"Event {i}", "subtitle": subtitle, "lane": "main", "from": {"year": 1000 + i}}
            for i in range(n_events)
        ],
    )


@pytest.mark.asyncio
async def test_refine_rejects_oversized_context_before_calling_the_model():
    big = _timeline(300, subtitle="x" * 2000)
    with patch.object(gemini_service, "get_gemini_client", return_value=SimpleNamespace()), \
            patch.object(gemini_service, "_generate_with_retry") as gen:
        with pytest.raises(gemini_service.RefineContextTooLargeError):
            await gemini_service.refine_timeline_with_gemini(
                big, "add more events", api_key="k", max_context_chars=200_000,
            )
        gen.assert_not_called()


# --- podcasts -----------------------------------------------------------------------

def _podcast_response(events, intro=True, outro=True):
    segs = []
    if intro:
        segs.append({"type": "intro", "chapter_title": "Intro", "turns": [{"speaker": "host1", "text": "Welcome."}]})
    for ev in events:
        segs.append({
            "type": "event", "event_id": ev["id"], "chapter_title": ev["title"],
            "turns": [{"speaker": "host1", "text": f"Story of {ev['title']}."}],
        })
    if outro:
        segs.append({"type": "outro", "chapter_title": "Outro", "turns": [{"speaker": "host1", "text": "Goodbye."}]})
    return SimpleNamespace(
        parsed=None,
        text=json.dumps({"episode_title": "Ep", "detected_language": "en", "segments": segs}),
        candidates=None,
        usage_metadata=None,
    )


@pytest.mark.asyncio
async def test_unlimited_podcast_covers_every_event_in_multiple_parts(monkeypatch):
    timeline = _timeline(90)
    prompts = []

    async def fake_generate(client, **kwargs):
        prompts.append(kwargs["contents"])
        payload = kwargs["contents"].split("Timeline Chronological Milestones")[1]
        events = json.loads(payload[payload.index("["):])
        # The model "forgets" the multi-part rules and always writes intro + outro.
        return _podcast_response(events)

    monkeypatch.setattr(gemini_service, "extract_response_text", lambda r: r.text)
    with patch.object(gemini_service, "get_gemini_client", return_value=SimpleNamespace()), \
            patch.object(gemini_service, "_generate_with_retry", side_effect=fake_generate):
        result = await gemini_service.generate_timeline_podcast(timeline, length="full", api_key="k", max_events=90)

    segments = result["script"]["segments"]
    assert len(prompts) == 3  # 90 events / 40 per part
    assert "part 1 of 3" in prompts[0] and "part 3 of 3" in prompts[2]
    assert [s["type"] for s in segments].count("intro") == 1 and segments[0]["type"] == "intro"
    assert [s["type"] for s in segments].count("outro") == 1 and segments[-1]["type"] == "outro"
    assert [s["event_id"] for s in segments if s["type"] == "event"] == [f"e{i}" for i in range(90)]


@pytest.mark.asyncio
async def test_default_podcast_is_single_call_capped_at_25(monkeypatch):
    timeline = _timeline(90)
    calls = []

    async def fake_generate(client, **kwargs):
        calls.append(kwargs["contents"])
        payload = kwargs["contents"].split("Timeline Chronological Milestones")[1]
        return _podcast_response(json.loads(payload[payload.index("["):]))

    monkeypatch.setattr(gemini_service, "extract_response_text", lambda r: r.text)
    with patch.object(gemini_service, "get_gemini_client", return_value=SimpleNamespace()), \
            patch.object(gemini_service, "_generate_with_retry", side_effect=fake_generate):
        result = await gemini_service.generate_timeline_podcast(timeline, length="full", api_key="k")

    assert len(calls) == 1 and "MULTI-PART" not in calls[0]
    assert sum(1 for s in result["script"]["segments"] if s["type"] == "event") == 25


def test_podcast_max_events_for_tiers():
    from main import _podcast_max_events_for

    req = TimelinePodcastRequest(timeline=_timeline(90), length="full")
    assert _podcast_max_events_for(ADMIN, None, req) == 90
    assert _podcast_max_events_for(REGISTERED, "byok-key", req) == 25  # unverified key (S-04)
    mark_custom_key_verified("byok-key")
    assert _podcast_max_events_for(REGISTERED, "byok-key", req) == 90
    assert _podcast_max_events_for(REGISTERED, None, req) == 25
    focused = TimelinePodcastRequest(timeline=_timeline(90), length="focused")
    assert _podcast_max_events_for(ADMIN, None, focused) is None


def test_generation_limit_kwargs_by_tier():
    from main import _generation_limit_kwargs

    reg = _generation_limit_kwargs(REGISTERED, "paid", True, source="files")
    assert reg == {"max_events": 120, "allow_large": False, "enable_ai_fallback_images": False}
    unverified = _generation_limit_kwargs(REGISTERED, "custom", True, source="prompt", api_key="byok-key")
    assert unverified["allow_large"] is False  # S-04: not unlimited until the key has worked once
    mark_custom_key_verified("byok-key")
    byok = _generation_limit_kwargs(REGISTERED, "custom", True, source="prompt", api_key="byok-key")
    assert byok == {"max_events": None, "allow_large": True, "enable_ai_fallback_images": True}
