import pytest
import os
from unittest.mock import MagicMock, patch
from fastapi import HTTPException

from services.auth_service import is_admin_user, get_admin_emails, get_current_user_required
from services.quota_service import (
    get_user_daily_usage,
    record_prompt_usage,
    get_user_quota_info,
    resolve_gemini_key,
    resolve_refine_gemini_key,
    resolve_event_suggest_gemini_key,
    resolve_chat_gemini_key,
    get_quota_identifier,
    get_timeline_ai_usage,
    get_all_free_keys,
    get_next_free_key,
    mark_key_exhausted,
    clear_key_cooldown,
    is_key_available,
    get_candidate_free_keys,
)
import services.quota_service as quota_module
from main import SimpleRateLimiter

@pytest.fixture(autouse=True)
def reset_free_key_state(monkeypatch):
    quota_module._free_key_rr_counter = 0
    quota_module._KEY_COOLDOWNS.clear()
    for var in list(os.environ.keys()):
        if var.startswith("GEMINI_API_KEY_FREE_"):
            monkeypatch.delenv(var, raising=False)

def test_admin_email_parsing(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com, YonitSur@gmail.com , test@test.org")
    emails = get_admin_emails()
    assert "admin@example.com" in emails
    assert "yonitsur@gmail.com" in emails
    assert "test@test.org" in emails

def test_is_admin_user(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "yonitsur@gmail.com")
    
    # Admin by primary email
    assert is_admin_user({"id": "u1", "email": "yonitsur@gmail.com"}) is True
    assert is_admin_user({"id": "u1", "email": "YONITSUR@GMAIL.COM"}) is True
    
    # Admin by user_metadata email
    assert is_admin_user({"id": "u2", "email": "other@gmail.com", "user_metadata": {"email": "yonitsur@gmail.com"}}) is True
    
    # Regular user
    assert is_admin_user({"id": "u3", "email": "regular@gmail.com"}) is False
    assert is_admin_user(None) is False

@pytest.mark.asyncio
async def test_get_current_user_required_raises_401():
    with pytest.raises(HTTPException) as exc:
        await get_current_user_required(authorization=None)
    assert exc.value.status_code == 401

@pytest.mark.asyncio
async def test_rate_limiter_3_per_minute():
    limiter = SimpleRateLimiter(max_requests=3, window_seconds=60, name="test_3_rpm")
    mock_req = MagicMock()
    mock_req.headers.get.return_value = None
    mock_req.client.host = "10.0.0.1"

    # 3 calls from regular user should succeed
    user_regular = {"id": "user-reg-1", "is_admin": False}
    for _ in range(3):
        await limiter(mock_req, x_gemini_api_key=None, user=user_regular)

    # 4th call should be blocked with 429
    with pytest.raises(HTTPException) as exc_info:
        await limiter(mock_req, x_gemini_api_key=None, user=user_regular)
    assert exc_info.value.status_code == 429

@pytest.mark.asyncio
async def test_rate_limiter_admin_bypass():
    limiter = SimpleRateLimiter(max_requests=3, window_seconds=60, name="test_admin_bypass")
    mock_req = MagicMock()
    mock_req.headers.get.return_value = None
    mock_req.client.host = "10.0.0.2"

    admin_user = {"id": "admin-1", "email": "yonitsur@gmail.com", "is_admin": True}
    
    # Admin can make 10 requests without hitting 429
    for _ in range(10):
        await limiter(mock_req, x_gemini_api_key=None, user=admin_user)

def test_quota_service_routing(monkeypatch, tmp_path):
    # Set up temporary environment & keys
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")
    monkeypatch.setenv("DAILY_PAID_PROMPTS_PER_USER", "3")
    monkeypatch.setenv("ADMIN_EMAILS", "admin@test.com")

    # Isolate usage storage file
    test_usage_file = tmp_path / "daily_usage.json"
    monkeypatch.setattr("services.quota_service.USAGE_FILE", test_usage_file)

    test_user_id = "test-user-quota-99"
    test_user = {"id": test_user_id, "email": "regular@test.com"}

    # Mock the usage count for date 2099-01-01 to avoid affecting other tests
    test_date = "2099-01-01"

    # 1. First 3 prompts should get PAID key
    for i in range(3):
        key, tier, is_admin = resolve_gemini_key(test_user, increment_usage=False)
        record_prompt_usage(test_user_id, date_str=test_date)
        # Verify usage on this test date
        usage = get_user_daily_usage(test_user_id, date_str=test_date)
        assert usage == i + 1

    # Now verify that resolve_gemini_key with custom mock date switches to FREE key
    with patch("services.quota_service._get_today_str", return_value=test_date):
        # 4th prompt should get FREE key
        key, tier, is_admin = resolve_gemini_key(test_user, increment_usage=False)
        assert key == "FREE_KEY_456"
        assert tier == "free"
        assert is_admin is False

        # Admin user should ALWAYS get PAID key even when limit is exceeded
        admin_user = {"id": "admin-id", "email": "admin@test.com"}
        admin_key, admin_tier, admin_is_admin = resolve_gemini_key(admin_user, increment_usage=False)
        assert admin_key == "PAID_KEY_123"
        assert admin_tier == "admin_paid"
        assert admin_is_admin is True

        # Custom API key takes precedence
        custom_key, custom_tier, _ = resolve_gemini_key(test_user, custom_api_key="MY_OWN_KEY")
        assert custom_key == "MY_OWN_KEY"
        assert custom_tier == "custom"

        # Quota info
        info = get_user_quota_info(test_user)
        assert info["daily_paid_limit"] == 3
        assert info["used_today"] == 3
        assert info["remaining_paid"] == 0
        assert info["tier"] == "free"

        admin_info = get_user_quota_info(admin_user)
        assert admin_info["is_admin"] is True
        assert admin_info["tier"] == "admin_unlimited"

def test_timeline_refine_quota_routing(monkeypatch, tmp_path):
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")
    monkeypatch.setenv("DAILY_PAID_PROMPTS_PER_USER", "20")
    monkeypatch.setenv("TIMELINE_PAID_REFINE_LIMIT", "3")
    monkeypatch.setenv("ADMIN_EMAILS", "admin@test.com")

    # Isolate storage files
    test_usage_file = tmp_path / "daily_usage.json"
    test_tl_file = tmp_path / "timeline_usage.json"
    monkeypatch.setattr("services.quota_service.USAGE_FILE", test_usage_file)
    monkeypatch.setattr("services.quota_service.TIMELINE_USAGE_FILE", test_tl_file)

    user = {"id": "user-tl-test", "email": "user@test.com"}
    admin = {"id": "admin-tl-test", "email": "admin@test.com"}

    tl_1 = "timeline-alpha-123"
    tl_2 = "timeline-beta-456"

    # Refine 1, 2, 3 on tl_1 should get PAID key
    for i in range(3):
        key, tier, is_admin, remaining = resolve_refine_gemini_key(user, timeline_id=tl_1, increment_usage=True)
        assert key == "PAID_KEY_123"
        assert tier == "paid"
        assert is_admin is False
        assert remaining == 2 - i

    # Refine 4 on tl_1 exceeds limit (3) -> switches to FREE key
    key, tier, is_admin, remaining = resolve_refine_gemini_key(user, timeline_id=tl_1, increment_usage=True)
    assert key == "FREE_KEY_456"
    assert tier == "free"
    assert is_admin is False
    assert remaining == 0

    # tl_2 is a different timeline, so its first refine should still get PAID key
    key, tier, is_admin, remaining = resolve_refine_gemini_key(user, timeline_id=tl_2, increment_usage=True)
    assert key == "PAID_KEY_123"
    assert tier == "paid"
    assert remaining == 2

    # Admin on tl_1 always gets PAID key without limit
    admin_key, admin_tier, admin_is_admin, admin_rem = resolve_refine_gemini_key(admin, timeline_id=tl_1, increment_usage=True)
    assert admin_key == "PAID_KEY_123"
    assert admin_tier == "admin_paid"
    assert admin_is_admin is True

    # Custom BYOK key
    cust_key, cust_tier, _, _ = resolve_refine_gemini_key(user, timeline_id=tl_1, custom_api_key="CUSTOM_USER_KEY")
    assert cust_key == "CUSTOM_USER_KEY"
    assert cust_tier == "custom"

def test_timeline_event_suggest_quota_routing(monkeypatch, tmp_path):
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")
    monkeypatch.setenv("DAILY_PAID_PROMPTS_PER_USER", "20")
    monkeypatch.setenv("TIMELINE_PAID_EVENT_ADD_LIMIT", "2")
    monkeypatch.setenv("ADMIN_EMAILS", "admin@test.com")

    test_usage_file = tmp_path / "daily_usage.json"
    test_tl_file = tmp_path / "timeline_usage.json"
    monkeypatch.setattr("services.quota_service.USAGE_FILE", test_usage_file)
    monkeypatch.setattr("services.quota_service.TIMELINE_USAGE_FILE", test_tl_file)

    user = {"id": "user-event-test", "email": "user@test.com"}
    admin = {"id": "admin-event-test", "email": "admin@test.com"}
    tl_id = "tl-event-suggest-101"

    # First 2 suggestions get PAID key
    for i in range(2):
        key, tier, is_admin, remaining = resolve_event_suggest_gemini_key(user, timeline_id=tl_id, increment_usage=True)
        assert key == "PAID_KEY_123"
        assert tier == "paid"
        assert is_admin is False
        assert remaining == 1 - i

    # 3rd suggestion exceeds limit of 2 -> switches to FREE key
    key, tier, is_admin, remaining = resolve_event_suggest_gemini_key(user, timeline_id=tl_id, increment_usage=True)
    assert key == "FREE_KEY_456"
    assert tier == "free"
    assert is_admin is False
    assert remaining == 0

    # Admin is exempt
    a_key, a_tier, a_admin, _ = resolve_event_suggest_gemini_key(admin, timeline_id=tl_id, increment_usage=True)
    assert a_key == "PAID_KEY_123"
    assert a_tier == "admin_paid"
    assert a_admin is True

def test_free_mode_routing(monkeypatch, tmp_path):
    monkeypatch.setenv("API_KEY_MODE", "free")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")
    monkeypatch.setenv("ADMIN_EMAILS", "admin@test.com")

    monkeypatch.setattr("services.quota_service.USAGE_FILE", tmp_path / "daily_usage.json")
    monkeypatch.setattr("services.quota_service.TIMELINE_USAGE_FILE", tmp_path / "timeline_usage.json")

    user = {"id": "user-free-mode", "email": "user@test.com"}
    admin = {"id": "admin-free-mode", "email": "admin@test.com"}
    tl_id = "tl-free-mode-1"

    # Regular users always get the FREE key, no usage recorded
    key, tier, is_admin = resolve_gemini_key(user, increment_usage=True)
    assert key == "FREE_KEY_456"
    assert tier == "free"
    assert is_admin is False
    assert get_user_daily_usage(user["id"]) == 0

    r_key, r_tier, _, _ = resolve_refine_gemini_key(user, timeline_id=tl_id, increment_usage=True)
    assert r_key == "FREE_KEY_456"
    assert r_tier == "free"

    e_key, e_tier, _, _ = resolve_event_suggest_gemini_key(user, timeline_id=tl_id, increment_usage=True)
    assert e_key == "FREE_KEY_456"
    assert e_tier == "free"

    # Admins still get the PAID key
    a_key, a_tier, a_admin = resolve_gemini_key(admin, increment_usage=True)
    assert a_key == "PAID_KEY_123"
    assert a_tier == "admin_paid"
    assert a_admin is True

    # Custom BYOK still takes precedence
    c_key, c_tier, _ = resolve_gemini_key(user, custom_api_key="MY_KEY")
    assert c_key == "MY_KEY"
    assert c_tier == "custom"

    # Quota info reports free mode
    info = get_user_quota_info(user)
    assert info["mode"] == "free"
    assert info["tier"] == "free"
    assert info["is_admin"] is False

    admin_info = get_user_quota_info(admin)
    assert admin_info["is_admin"] is True
    assert admin_info["tier"] == "admin_unlimited"


def test_guest_routing_limited_paid_mode(monkeypatch, tmp_path):
    # Under 'unlimited' mode, guests get limited daily paid prompts (default 15), then fallback to free
    monkeypatch.setenv("API_KEY_MODE", "unlimited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")
    monkeypatch.setenv("ADMIN_EMAILS", "admin@test.com")
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "2")

    monkeypatch.setattr("services.quota_service.USAGE_FILE", tmp_path / "daily_usage.json")
    monkeypatch.setattr("services.quota_service.TIMELINE_USAGE_FILE", tmp_path / "timeline_usage.json")

    guest = {"id": "guest-1", "is_anonymous": True}
    client_ip = "192.168.1.100"
    tl_id = "tl-guest-1"

    # 1st request: uses paid key
    key, tier, is_admin = resolve_gemini_key(guest, increment_usage=True, client_ip=client_ip)
    assert key == "PAID_KEY_123"
    assert tier == "paid"
    assert is_admin is False
    assert get_user_daily_usage(f"guest_ip:{client_ip}") == 1

    # 2nd request: uses paid key (refine)
    r_key, r_tier, _, _ = resolve_refine_gemini_key(guest, timeline_id=tl_id, increment_usage=True, client_ip=client_ip)
    assert r_key == "PAID_KEY_123"
    assert r_tier == "paid"
    assert get_user_daily_usage(f"guest_ip:{client_ip}") == 2

    # 3rd request: quota exhausted, falls back to free key
    key3, tier3, _ = resolve_gemini_key(guest, increment_usage=True, client_ip=client_ip)
    assert key3 == "FREE_KEY_456"
    assert tier3 == "free"

    # Check quota info
    info = get_user_quota_info(guest, client_ip=client_ip)
    assert info["is_guest"] is True
    assert info["tier"] == "free"
    assert info["mode"] == "limited"
    assert info["daily_paid_limit"] == 2
    assert info["used_today"] == 3
    assert info["remaining_paid"] == 0


def test_guest_ip_quota_sharing(monkeypatch, tmp_path):
    """
    Two guest accounts on the same IP (e.g. user clears cookies or opens incognito)
    must share the exact same daily quota, preventing infinite quota resets.
    """
    monkeypatch.setenv("API_KEY_MODE", "unlimited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "2")

    monkeypatch.setattr("services.quota_service.USAGE_FILE", tmp_path / "daily_usage.json")
    monkeypatch.setattr("services.quota_service.TIMELINE_USAGE_FILE", tmp_path / "timeline_usage.json")

    shared_ip = "203.0.113.50"
    guest_a = {"id": "guest-session-alpha", "is_anonymous": True}
    guest_b = {"id": "guest-session-beta", "is_anonymous": True}

    # Guest A uses prompt 1
    k1, t1, _ = resolve_gemini_key(guest_a, increment_usage=True, client_ip=shared_ip)
    assert t1 == "paid"

    # Guest A uses prompt 2 (reaches limit)
    k2, t2, _ = resolve_gemini_key(guest_a, increment_usage=True, client_ip=shared_ip)
    assert t2 == "paid"

    # Guest B connects from SAME IP (simulating incognito / cleared cookies)
    # Checking quota for Guest B immediately reflects 0 remaining!
    info_b = get_user_quota_info(guest_b, client_ip=shared_ip)
    assert info_b["remaining_paid"] == 0
    assert info_b["used_today"] == 2
    assert info_b["tier"] == "free"

    # Guest B attempts a generation: falls back to free tier!
    k3, t3, _ = resolve_gemini_key(guest_b, increment_usage=True, client_ip=shared_ip)
    assert k3 == "FREE_KEY_456"
    assert t3 == "free"


def test_guest_chat_quota_and_fallback(monkeypatch, tmp_path):
    """
    Timeline chat: guests get GUEST_DAILY_PAID_CHAT_PROMPTS (3) on paid key,
    after which it falls back seamlessly to the free Gemini key.
    """
    monkeypatch.setenv("API_KEY_MODE", "unlimited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")
    monkeypatch.setenv("GUEST_DAILY_PAID_CHAT_PROMPTS", "3")
    monkeypatch.setenv("TIMELINE_PAID_CHAT_LIMIT", "3")

    monkeypatch.setattr("services.quota_service.USAGE_FILE", tmp_path / "daily_usage.json")
    monkeypatch.setattr("services.quota_service.TIMELINE_USAGE_FILE", tmp_path / "timeline_usage.json")

    guest = {"id": "guest-chat-1", "is_anonymous": True}
    client_ip = "198.51.100.22"
    tl_id = "tl-chat-demo"

    # Turns 1, 2, 3: paid key
    for i in range(3):
        key, tier, is_admin = resolve_chat_gemini_key(
            guest, timeline_id=tl_id, client_ip=client_ip, increment_usage=True
        )
        assert key == "PAID_KEY_123"
        assert tier == "paid"
        assert is_admin is False

    # Turn 4 on the same timeline: falls back seamlessly to free key
    key4, tier4, _ = resolve_chat_gemini_key(
        guest, timeline_id=tl_id, client_ip=client_ip, increment_usage=True
    )
    assert key4 == "FREE_KEY_456"
    assert tier4 == "free"

    # Turn 5: guest creates a NEW timeline tl-chat-new, but IP daily chat limit (3) is exhausted!
    key5, tier5, _ = resolve_chat_gemini_key(
        guest, timeline_id="tl-chat-new", client_ip=client_ip, increment_usage=True
    )
    assert key5 == "FREE_KEY_456"
    assert tier5 == "free"


def test_saved_timeline_chat_quota_retention(monkeypatch, tmp_path):
    """
    Opening a timeline via 'Saved Timelines' retains its timeline_id,
    preventing users from resetting the per-timeline chat limit.
    """
    monkeypatch.setenv("API_KEY_MODE", "unlimited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")
    monkeypatch.setenv("GUEST_DAILY_PAID_CHAT_PROMPTS", "10")  # plenty of daily IP quota
    monkeypatch.setenv("TIMELINE_PAID_CHAT_LIMIT", "3")

    monkeypatch.setattr("services.quota_service.USAGE_FILE", tmp_path / "daily_usage.json")
    monkeypatch.setattr("services.quota_service.TIMELINE_USAGE_FILE", tmp_path / "timeline_usage.json")

    guest = {"id": "guest-saved-1", "is_anonymous": True}
    client_ip = "198.51.100.33"
    saved_tl_id = "tl_roman_empire_12345"

    # Chat 3 times on the saved timeline
    for _ in range(3):
        k, t, _ = resolve_chat_gemini_key(
            guest, timeline_id=saved_tl_id, client_ip=client_ip, increment_usage=True
        )
        assert t == "paid"

    # User navigates to 'Saved Timelines' and reopens the exact same timeline
    # The timeline_id is still tl_roman_empire_12345:
    k_reopen, t_reopen, _ = resolve_chat_gemini_key(
        guest, timeline_id=saved_tl_id, client_ip=client_ip, increment_usage=True
    )
    assert k_reopen == "FREE_KEY_456"
    assert t_reopen == "free"


def test_guest_explicit_free_mode(monkeypatch, tmp_path):
    # If GUEST_API_KEY_MODE=free or global API_KEY_MODE=free, guests strictly get free key
    monkeypatch.setenv("API_KEY_MODE", "unlimited")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "free")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")

    monkeypatch.setattr("services.quota_service.USAGE_FILE", tmp_path / "daily_usage.json")
    monkeypatch.setattr("services.quota_service.TIMELINE_USAGE_FILE", tmp_path / "timeline_usage.json")

    guest = {"id": "guest-2", "is_anonymous": True}
    key, tier, is_admin = resolve_gemini_key(guest, increment_usage=True)
    assert key == "FREE_KEY_456"
    assert tier == "free"

    info = get_user_quota_info(guest)
    assert info["is_guest"] is True
    assert info["mode"] == "free"



def test_multi_key_collection_and_rotation(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "KEY_BASE_1, KEY_BASE_2")
    monkeypatch.setenv("GEMINI_API_KEY_FREE_1", "KEY_SUFF_1")
    monkeypatch.setenv("GEMINI_API_KEY_FREE_2", "KEY_SUFF_2")

    all_keys = get_all_free_keys()
    assert all_keys == ["KEY_BASE_1", "KEY_BASE_2", "KEY_SUFF_1", "KEY_SUFF_2"]

    # Round robin should cycle through keys
    picked = [get_next_free_key() for _ in range(4)]
    assert picked == ["KEY_BASE_1", "KEY_BASE_2", "KEY_SUFF_1", "KEY_SUFF_2"]

    # Cooldown check
    mark_key_exhausted("KEY_BASE_1", cooldown_seconds=60)
    assert is_key_available("KEY_BASE_1") is False
    assert is_key_available("KEY_BASE_2") is True
    # In candidate list, healthy keys come before cooling keys
    candidates = get_candidate_free_keys("KEY_BASE_1")
    assert candidates[-1] == "KEY_BASE_1"
    assert "KEY_BASE_2" in candidates[:3]
    clear_key_cooldown("KEY_BASE_1")
    assert is_key_available("KEY_BASE_1") is True


def test_format_api_error_for_guest_and_user():
    from main import format_api_error_for_user

    guest = {"id": "guest-err-1", "is_anonymous": True}
    reg_user = {"id": "reg-user-1", "is_anonymous": False}

    err_quota = Exception("Gemini API prepayment credits are depleted or quota was exceeded.")
    err_other = Exception("Something unrelated went wrong.")

    # Guest should receive helpful guidance to sign in for standard AI tier
    guest_msg = format_api_error_for_user(err_quota, user=guest)
    assert "The guest free AI tier is temporarily at capacity" in guest_msg
    assert "Sign in to access the standard high-speed AI tier" in guest_msg

    # Unrelated errors should remain untouched
    assert format_api_error_for_user(err_other, user=guest) == str(err_other)

    # Regular user should receive standard error message
    assert format_api_error_for_user(err_quota, user=reg_user) == str(err_quota)


@pytest.mark.asyncio
async def test_run_with_key_failover_rotates_on_quota(monkeypatch):
    from main import run_with_key_failover

    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FK1")
    monkeypatch.setenv("GEMINI_API_KEY_FREE_1", "FK2")
    monkeypatch.setenv("GEMINI_API_KEY_FREE_2", "FK3")

    attempted = []

    async def op(key):
        attempted.append(key)
        # First two free keys are "exhausted"; the third succeeds.
        if key in ("FK1", "FK2"):
            raise Exception("RESOURCE_EXHAUSTED: quota exceeded")
        return f"ok:{key}"

    result = await run_with_key_failover(op, "FK1", "free", label="test")
    assert result == "ok:FK3"
    assert attempted == ["FK1", "FK2", "FK3"]
    # Exhausted keys were put on cooldown; the winning key stays available.
    assert is_key_available("FK1") is False
    assert is_key_available("FK2") is False
    assert is_key_available("FK3") is True


@pytest.mark.asyncio
async def test_run_with_key_failover_non_quota_error_no_rotation(monkeypatch):
    from main import run_with_key_failover

    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FK1")
    monkeypatch.setenv("GEMINI_API_KEY_FREE_1", "FK2")

    attempted = []

    async def op(key):
        attempted.append(key)
        raise Exception("Some JSON parsing error in the response")

    with pytest.raises(Exception, match="parsing error"):
        await run_with_key_failover(op, "FK1", "free", label="test")
    # A non-quota error must NOT rotate keys or mark any key exhausted.
    assert attempted == ["FK1"]
    assert is_key_available("FK1") is True


@pytest.mark.asyncio
async def test_run_with_key_failover_paid_tier_single_key(monkeypatch):
    from main import run_with_key_failover

    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FK1")
    monkeypatch.setenv("GEMINI_API_KEY_FREE_1", "FK2")

    attempted = []

    async def op(key):
        attempted.append(key)
        raise Exception("RESOURCE_EXHAUSTED: quota exceeded")

    # Paid tier uses only its own key even on quota error (no free-key rotation).
    with pytest.raises(Exception, match="RESOURCE_EXHAUSTED"):
        await run_with_key_failover(op, "PAID_KEY", "paid", label="test")
    assert attempted == ["PAID_KEY"]


def test_prompt_generation_quota_deduction_for_limited_modes(monkeypatch, tmp_path):
    # Set up isolated usage file
    test_usage_file = tmp_path / "daily_usage.json"
    monkeypatch.setattr("services.quota_service.USAGE_FILE", test_usage_file)

    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY")
    monkeypatch.setenv("DAILY_PAID_PROMPTS_PER_USER", "5")
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "3")
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")

    # 1. Test authenticated regular user
    reg_user = {"id": "user-quota-123", "email": "regular@example.com"}
    initial_info = get_user_quota_info(reg_user)
    assert initial_info["daily_paid_limit"] == 5
    assert initial_info["remaining_paid"] == 5
    assert initial_info["used_today"] == 0

    # Simulate generating a timeline with increment_usage=True
    key, tier, is_admin = resolve_gemini_key(reg_user, increment_usage=True)
    assert key == "PAID_KEY"
    assert tier == "paid"
    assert is_admin is False

    updated_info = get_user_quota_info(reg_user)
    assert updated_info["used_today"] == 1
    assert updated_info["remaining_paid"] == 4

    # 2. Test guest user (anonymous)
    guest_user = {"id": "guest-anon-999", "is_anonymous": True}
    client_ip = "192.168.1.50"
    guest_initial = get_user_quota_info(guest_user, client_ip=client_ip)
    assert guest_initial["is_guest"] is True
    assert guest_initial["daily_paid_limit"] == 3
    assert guest_initial["remaining_paid"] == 3
    assert guest_initial["used_today"] == 0

    # Simulate guest generating a timeline
    g_key, g_tier, g_admin = resolve_gemini_key(guest_user, increment_usage=True, client_ip=client_ip)
    assert g_key == "PAID_KEY"
    assert g_tier == "paid"
    assert g_admin is False

    guest_updated = get_user_quota_info(guest_user, client_ip=client_ip)
    assert guest_updated["used_today"] == 1
    assert guest_updated["remaining_paid"] == 2



