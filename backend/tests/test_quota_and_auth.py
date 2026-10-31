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
    get_quota_identifier,
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
    # Tests rely on these defaulting to "unlimited"/"limited" unless a test explicitly
    # sets them — clear any value leaked from the real .env (loaded via `from main import ...`).
    monkeypatch.delenv("API_KEY_MODE", raising=False)
    monkeypatch.delenv("GUEST_API_KEY_MODE", raising=False)
    monkeypatch.delenv("CREDIT_COST_TEXT", raising=False)
    monkeypatch.delenv("CREDIT_COST_UPLOAD_MEDIUM", raising=False)
    monkeypatch.delenv("CREDIT_COST_UPLOAD_HEAVY", raising=False)
    monkeypatch.delenv("CREDIT_COST_GEMINI_IMAGE", raising=False)
    monkeypatch.delenv("CREDIT_COST_GEMINI_AUDIO", raising=False)
    monkeypatch.delenv("CREDIT_COST_GEMINI_AUDIO_FULL", raising=False)
    monkeypatch.delenv("GOOGLE_SEARCH_GROUNDING_MONTHLY_QUERY_LIMIT", raising=False)

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
async def test_rate_limiter_admin_bypass(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "yonitsur@gmail.com")
    limiter = SimpleRateLimiter(max_requests=3, window_seconds=60, name="test_admin_bypass")
    mock_req = MagicMock()
    mock_req.headers.get.return_value = None
    mock_req.client.host = "10.0.0.2"

    admin_user = {"id": "admin-1", "email": "yonitsur@gmail.com", "is_admin": True}
    
    # Admin can make 10 requests without hitting 429
    for _ in range(10):
        await limiter(mock_req, x_gemini_api_key=None, user=admin_user)

@pytest.mark.asyncio
async def test_rate_limiter_env_var_and_refund(monkeypatch):
    monkeypatch.setenv("CUSTOM_RATE_LIMIT", "2")
    limiter = SimpleRateLimiter(max_requests=10, window_seconds=60, name="test_env", env_var="CUSTOM_RATE_LIMIT")
    mock_req = MagicMock()
    mock_req.headers.get.return_value = None
    mock_req.client.host = "10.0.0.3"
    user = {"id": "user-refund-test", "is_admin": False}

    # First 2 requests pass
    await limiter(mock_req, x_gemini_api_key=None, user=user)
    await limiter(mock_req, x_gemini_api_key=None, user=user)

    # 3rd request hits 429
    with pytest.raises(HTTPException) as exc_info:
        await limiter(mock_req, x_gemini_api_key=None, user=user)
    assert exc_info.value.status_code == 429

    # Now refund 1 request
    identifier = limiter.get_identifier(mock_req, user)
    limiter.refund(identifier)

    # Now another request should succeed!
    await limiter(mock_req, x_gemini_api_key=None, user=user)

@pytest.mark.asyncio
async def test_rate_limiter_disabled_with_zero(monkeypatch):
    monkeypatch.setenv("ZERO_LIMIT", "0")
    limiter = SimpleRateLimiter(max_requests=1, window_seconds=60, name="test_zero", env_var="ZERO_LIMIT")
    mock_req = MagicMock()
    mock_req.headers.get.return_value = None
    mock_req.client.host = "10.0.0.4"
    user = {"id": "user-zero-test", "is_admin": False}

    # Should never raise 429 because limit <= 0 disables it
    for _ in range(15):
        await limiter(mock_req, x_gemini_api_key=None, user=user)


def test_quota_service_routing(monkeypatch, tmp_path):
    # Set up temporary environment & keys
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "3")
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

def test_timeline_refine_shares_daily_quota_with_generate(monkeypatch, tmp_path):
    """
    Refine, generate, event-suggest, and chat all draw from the SAME single daily
    AI-operation quota bucket — no separate per-timeline or per-operation limits.
    """
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "3")
    monkeypatch.setenv("ADMIN_EMAILS", "admin@test.com")

    monkeypatch.setattr("services.quota_service.USAGE_FILE", tmp_path / "daily_usage.json")

    user = {"id": "user-tl-test", "email": "user@test.com"}
    admin = {"id": "admin-tl-test", "email": "admin@test.com"}

    # Operation 1 (a "generate"): paid key, 1/3 used
    key, tier, is_admin = resolve_gemini_key(user, increment_usage=True)
    assert (key, tier, is_admin) == ("PAID_KEY_123", "paid", False)

    # Operation 2 (a "refine" on a DIFFERENT timeline): still paid — same bucket, 2/3 used
    key, tier, is_admin = resolve_gemini_key(user, increment_usage=True)
    assert (key, tier, is_admin) == ("PAID_KEY_123", "paid", False)

    # Operation 3 (an "event suggestion"): still paid, 3/3 used — quota now exhausted
    key, tier, is_admin = resolve_gemini_key(user, increment_usage=True)
    assert (key, tier, is_admin) == ("PAID_KEY_123", "paid", False)

    # Operation 4 (a "chat" turn): quota exhausted — falls back to free key
    key, tier, is_admin = resolve_gemini_key(user, increment_usage=True)
    assert (key, tier, is_admin) == ("FREE_KEY_456", "free", False)

    assert get_user_daily_usage(user["id"]) == 4

    # Admin is exempt regardless of how many operations were performed
    admin_key, admin_tier, admin_is_admin = resolve_gemini_key(admin, increment_usage=True)
    assert admin_key == "PAID_KEY_123"
    assert admin_tier == "admin_paid"
    assert admin_is_admin is True

    # Custom BYOK key always takes precedence
    cust_key, cust_tier, _ = resolve_gemini_key(user, custom_api_key="CUSTOM_USER_KEY")
    assert cust_key == "CUSTOM_USER_KEY"
    assert cust_tier == "custom"

    info = get_user_quota_info(user)
    assert info["daily_paid_limit"] == 3
    assert info["used_today"] == 4
    assert info["remaining_paid"] == 0
    assert info["tier"] == "free"

def test_free_mode_routing(monkeypatch, tmp_path):
    monkeypatch.setenv("API_KEY_MODE", "free")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")
    monkeypatch.setenv("ADMIN_EMAILS", "admin@test.com")

    monkeypatch.setattr("services.quota_service.USAGE_FILE", tmp_path / "daily_usage.json")

    user = {"id": "user-free-mode", "email": "user@test.com"}
    admin = {"id": "admin-free-mode", "email": "admin@test.com"}

    # Regular users always get the FREE key, no usage recorded
    key, tier, is_admin = resolve_gemini_key(user, increment_usage=True)
    assert key == "FREE_KEY_456"
    assert tier == "free"
    assert is_admin is False
    assert get_user_daily_usage(user["id"]) == 0

    r_key, r_tier, _ = resolve_gemini_key(user, increment_usage=True)
    assert r_key == "FREE_KEY_456"
    assert r_tier == "free"

    e_key, e_tier, _ = resolve_gemini_key(user, increment_usage=True)
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

    guest = {"id": "guest-1", "is_anonymous": True}
    client_ip = "192.168.1.100"

    # 1st request (e.g. a "generate"): uses paid key
    key, tier, is_admin = resolve_gemini_key(guest, increment_usage=True, client_ip=client_ip)
    assert key == "PAID_KEY_123"
    assert tier == "paid"
    assert is_admin is False
    assert get_user_daily_usage(f"guest_ip:{client_ip}") == 1

    # 2nd request (e.g. a "refine"): still the SAME shared bucket, still paid
    r_key, r_tier, _ = resolve_gemini_key(guest, increment_usage=True, client_ip=client_ip)
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


def test_guest_chat_shares_daily_quota_with_other_operations(monkeypatch, tmp_path):
    """
    Chat turns are just another AI operation now — they draw from the SAME single
    GUEST_DAILY_PAID_PROMPTS bucket as generate/refine/event-suggest, with no separate
    chat-specific limit or per-timeline cap.
    """
    monkeypatch.setenv("API_KEY_MODE", "unlimited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "3")

    monkeypatch.setattr("services.quota_service.USAGE_FILE", tmp_path / "daily_usage.json")

    guest = {"id": "guest-chat-1", "is_anonymous": True}
    client_ip = "198.51.100.22"

    # Turns 1, 2, 3 (chat/generate/refine mixed): paid key
    for _ in range(3):
        key, tier, is_admin = resolve_gemini_key(guest, increment_usage=True, client_ip=client_ip)
        assert key == "PAID_KEY_123"
        assert tier == "paid"
        assert is_admin is False

    # Turn 4 (a chat turn): daily quota now exhausted — falls back to free key
    key4, tier4, _ = resolve_gemini_key(guest, increment_usage=True, client_ip=client_ip)
    assert key4 == "FREE_KEY_456"
    assert tier4 == "free"

    info = get_user_quota_info(guest, client_ip=client_ip)
    assert info["used_today"] == 4
    assert info["remaining_paid"] == 0


def test_guest_explicit_free_mode(monkeypatch, tmp_path):
    # If GUEST_API_KEY_MODE=free or global API_KEY_MODE=free, guests strictly get free key
    monkeypatch.setenv("API_KEY_MODE", "unlimited")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "free")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")

    monkeypatch.setattr("services.quota_service.USAGE_FILE", tmp_path / "daily_usage.json")

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


def test_format_api_error_for_guest_and_user(monkeypatch):
    from main import format_api_error_for_user

    monkeypatch.setenv("ADMIN_EMAILS", "admin@chronix.app")

    guest = {"id": "guest-err-1", "is_anonymous": True}
    reg_user = {"id": "reg-user-1", "is_anonymous": False}
    admin = {"id": "admin-err-1", "is_anonymous": False, "email": "admin@chronix.app"}

    err_quota = Exception("Gemini API prepayment credits are depleted or quota was exceeded.")
    err_transient = Exception("All models returned 503 UNAVAILABLE — servers overloaded.")
    err_other = Exception("Something unrelated went wrong.")

    # Guest should receive helpful guidance to sign in for standard AI tier
    guest_msg = format_api_error_for_user(err_quota, user=guest)
    assert "The guest AI service is temporarily at capacity" in guest_msg
    assert "Sign in to access the standard high-speed AI tier" in guest_msg

    # Unrelated errors should remain untouched
    assert format_api_error_for_user(err_other, user=guest) == str(err_other)

    # Regular (non-admin) users should also get a BYOK suggestion on quota/transient errors,
    # isolated from the guest-specific "sign in" copy — never the raw Gemini error text.
    reg_quota_msg = format_api_error_for_user(err_quota, user=reg_user)
    assert "paid personal Gemini API key in Settings" in reg_quota_msg
    assert "Sign in" not in reg_quota_msg
    reg_transient_msg = format_api_error_for_user(err_transient, user=reg_user)
    assert "paid personal Gemini API key in Settings" in reg_transient_msg

    # Unrelated errors for regular users also remain untouched
    assert format_api_error_for_user(err_other, user=reg_user) == str(err_other)

    # Admins always see the raw error (they're never on a shared/limited key)
    assert format_api_error_for_user(err_quota, user=admin) == str(err_quota)


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
async def test_run_with_key_failover_paid_tier_falls_back_on_quota(monkeypatch):
    from main import run_with_key_failover

    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FK1")
    monkeypatch.setenv("GEMINI_API_KEY_FREE_1", "FK2")

    attempted = []

    async def op(key):
        attempted.append(key)
        if key == "PAID_KEY":
            raise Exception("Gemini API prepayment credits are depleted or quota was exceeded.")
        return f"ok:{key}"

    # Paid tier seamlessly falls back to free keys when quota or billing credits run out
    result = await run_with_key_failover(op, "PAID_KEY", "paid", label="test")
    assert result == "ok:FK1"
    assert attempted == ["PAID_KEY", "FK1"]
    assert is_key_available("PAID_KEY") is False
    assert is_key_available("FK1") is True


@pytest.mark.asyncio
async def test_run_with_key_failover_billing_error_falls_back(monkeypatch):
    from main import run_with_key_failover

    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY")

    attempted = []

    async def op(key):
        attempted.append(key)
        if key == "PAID_KEY":
            raise Exception("Google Cloud Error 403: Billing account has been disabled or budget reached.")
        return f"ok:{key}"

    result = await run_with_key_failover(op, "PAID_KEY", "paid", label="test")
    assert result == "ok:FREE_KEY"
    assert attempted == ["PAID_KEY", "FREE_KEY"]
    assert is_key_available("PAID_KEY") is False


@pytest.mark.asyncio
async def test_run_with_key_failover_custom_key_does_not_failover(monkeypatch):
    from main import run_with_key_failover

    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FK1")

    attempted = []

    async def op(key):
        attempted.append(key)
        raise Exception("RESOURCE_EXHAUSTED: quota exceeded")

    # Custom user BYOK key only uses its own key
    with pytest.raises(Exception, match="RESOURCE_EXHAUSTED"):
        await run_with_key_failover(op, "CUSTOM_KEY", "custom", label="test")
    assert attempted == ["CUSTOM_KEY"]


def test_prompt_generation_quota_deduction_for_limited_modes(monkeypatch, tmp_path):
    # Set up isolated usage file
    test_usage_file = tmp_path / "daily_usage.json"
    monkeypatch.setattr("services.quota_service.USAGE_FILE", test_usage_file)

    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "5")
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
    assert guest_updated["registered_mode"] == "limited"
    assert guest_updated["registered_daily_limit"] == 5


@pytest.mark.asyncio
async def test_guest_policy_endpoint_reflects_modes_and_quotas(monkeypatch):
    from main import get_guest_policy

    # Case A: API_KEY_MODE=limited, GUEST_API_KEY_MODE=limited
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "25")
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "7")

    policy = await get_guest_policy()
    assert policy["guest_mode"] == "limited"
    assert policy["guest_daily_limit"] == 7
    assert policy["registered_mode"] == "limited"
    assert policy["registered_daily_limit"] == 25
    assert policy["mode"] == "limited"
    assert policy["daily_paid_limit"] == 7

    # Case B: API_KEY_MODE=unlimited, GUEST_API_KEY_MODE=limited
    monkeypatch.setenv("API_KEY_MODE", "unlimited")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "5")

    policy_b = await get_guest_policy()
    assert policy_b["guest_mode"] == "limited"
    assert policy_b["guest_daily_limit"] == 5
    assert policy_b["registered_mode"] == "unlimited"
    assert policy_b["registered_daily_limit"] == -1
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


def test_format_api_error_for_guest_and_user(monkeypatch):
    from main import format_api_error_for_user

    monkeypatch.setenv("ADMIN_EMAILS", "admin@chronix.app")

    guest = {"id": "guest-err-1", "is_anonymous": True}
    reg_user = {"id": "reg-user-1", "is_anonymous": False}
    admin = {"id": "admin-err-1", "is_anonymous": False, "email": "admin@chronix.app"}

    err_quota = Exception("Gemini API prepayment credits are depleted or quota was exceeded.")
    err_transient = Exception("All models returned 503 UNAVAILABLE — servers overloaded.")
    err_other = Exception("Something unrelated went wrong.")

    # Guest should receive helpful guidance to sign in for standard AI tier
    guest_msg = format_api_error_for_user(err_quota, user=guest)
    assert "The guest AI service is temporarily at capacity" in guest_msg
    assert "Sign in to access the standard high-speed AI tier" in guest_msg

    # Unrelated errors should remain untouched
    assert format_api_error_for_user(err_other, user=guest) == str(err_other)

    # Regular (non-admin) users should also get a BYOK suggestion on quota/transient errors,
    # isolated from the guest-specific "sign in" copy — never the raw Gemini error text.
    reg_quota_msg = format_api_error_for_user(err_quota, user=reg_user)
    assert "paid personal Gemini API key in Settings" in reg_quota_msg
    assert "Sign in" not in reg_quota_msg
    reg_transient_msg = format_api_error_for_user(err_transient, user=reg_user)
    assert "paid personal Gemini API key in Settings" in reg_transient_msg

    # Unrelated errors for regular users also remain untouched
    assert format_api_error_for_user(err_other, user=reg_user) == str(err_other)

    # Admins always see the raw error (they're never on a shared/limited key)
    assert format_api_error_for_user(err_quota, user=admin) == str(err_quota)


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
async def test_resolve_gemini_key_falls_back_when_paid_key_cooling_down(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY")
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")

    admin = {"id": "admin-1", "email": "admin@example.com"}

    # Initially healthy paid key
    k1, t1, _ = resolve_gemini_key(admin, increment_usage=False)
    assert k1 == "PAID_KEY"

    # Mark paid key in cooldown (quota or billing exhausted)
    mark_key_exhausted("PAID_KEY", cooldown_seconds=600)
    assert is_key_available("PAID_KEY") is False

    # Now resolve_gemini_key automatically routes to the healthy free key
    k2, t2, _ = resolve_gemini_key(admin, increment_usage=False)
    assert k2 == "FREE_KEY"


def test_prompt_generation_quota_deduction_for_limited_modes(monkeypatch, tmp_path):
    # Set up isolated usage file
    test_usage_file = tmp_path / "daily_usage.json"
    monkeypatch.setattr("services.quota_service.USAGE_FILE", test_usage_file)

    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "5")
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
    assert guest_updated["registered_mode"] == "limited"
    assert guest_updated["registered_daily_limit"] == 5


@pytest.mark.asyncio
async def test_guest_policy_endpoint_reflects_modes_and_quotas(monkeypatch):
    from main import get_guest_policy

    # Case A: API_KEY_MODE=limited, GUEST_API_KEY_MODE=limited
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "25")
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "7")

    policy = await get_guest_policy()
    assert policy["guest_mode"] == "limited"
    assert policy["guest_daily_limit"] == 7
    assert policy["registered_mode"] == "limited"
    assert policy["registered_daily_limit"] == 25
    assert policy["mode"] == "limited"
    assert policy["daily_paid_limit"] == 7

    # Case B: API_KEY_MODE=unlimited, GUEST_API_KEY_MODE=limited
    monkeypatch.setenv("API_KEY_MODE", "unlimited")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "5")

    policy_b = await get_guest_policy()
    assert policy_b["guest_mode"] == "limited"
    assert policy_b["guest_daily_limit"] == 5
    assert policy_b["registered_mode"] == "unlimited"
    assert policy_b["registered_daily_limit"] == -1
    assert policy_b["mode"] == "limited"
    assert policy_b["daily_paid_limit"] == 5

    # Case C: API_KEY_MODE=free -> forces guest to free
    monkeypatch.setenv("API_KEY_MODE", "free")
    policy_c = await get_guest_policy()
    assert policy_c["guest_mode"] == "free"
    assert policy_c["guest_daily_limit"] == -1
    assert policy_c["registered_mode"] == "free"
    assert policy_c["registered_daily_limit"] == -1


@pytest.mark.asyncio
async def test_cancel_ai_job_refunds_quota_and_rate_limit(monkeypatch, tmp_path):
    import asyncio
    from main import _create_ai_job, cancel_ai_job, _AI_JOBS, timeline_rate_limiter
    from services.quota_service import record_prompt_usage, get_user_daily_usage

    test_usage_file = tmp_path / "daily_usage.json"
    monkeypatch.setattr("services.quota_service.USAGE_FILE", test_usage_file)

    user = {"id": "user-cancel-1", "is_admin": False}
    ip = "192.168.1.50"
    rate_limit_id = f"user:{user['id']}"

    # Record 1 daily usage and 1 rate limit entry
    record_prompt_usage(user["id"])
    assert get_user_daily_usage(user["id"]) == 1

    timeline_rate_limiter.records[rate_limit_id].append(1000.0)
    assert len(timeline_rate_limiter.records[rate_limit_id]) == 1

    # Create AI job
    job_id = _create_ai_job(
        user,
        client_ip=ip,
        rate_limit_identifier=rate_limit_id,
        incremented_quota=True
    )

    # Attach a long-running dummy task
    async def dummy_work():
        await asyncio.sleep(10)

    task = asyncio.create_task(dummy_work())
    _AI_JOBS[job_id]["task"] = task

    mock_req = MagicMock()
    mock_req.headers.get.return_value = None
    mock_req.client.host = ip

    # Cancel the job
    res = await cancel_ai_job(job_id, mock_req, user=user)
    assert res["status"] == "cancelled"

    # Verify task was cancelled
    assert task.cancelling() > 0 or task.cancelled()

    # Verify rate limit was refunded
    assert len(timeline_rate_limiter.records[rate_limit_id]) == 0

    # Verify quota was refunded
    assert get_user_daily_usage(user["id"]) == 0

    # Second cancel call shouldn't double-refund
    res2 = await cancel_ai_job(job_id, mock_req, user=user)
    assert res2["status"] == "cancelled"
    assert get_user_daily_usage(user["id"]) == 0


def test_normalize_client_ip():
    from services.quota_service import normalize_client_ip
    assert normalize_client_ip("127.0.0.1") == "127.0.0.1"
    assert normalize_client_ip("::1") == "127.0.0.1"
    assert normalize_client_ip("localhost") == "127.0.0.1"
    assert normalize_client_ip("192.168.1.50:8080") == "192.168.1.50"
    # IPv6 privacy extensions: different temporary addresses on same /64 subnet normalize to the same prefix
    ip1 = "2a02:ed0:6d28:a100:1234:5678:9abc:def0"
    ip2 = "2a02:ed0:6d28:a100:ffff:eeee:dddd:cccc"
    assert normalize_client_ip(ip1) == normalize_client_ip(ip2)
    assert normalize_client_ip("") == "unknown"
    assert normalize_client_ip(None) == "unknown"


def test_guest_dual_tracking(tmp_path, monkeypatch):
    import services.quota_service as qs
    monkeypatch.setattr(qs, "USAGE_FILE", tmp_path / "daily_usage.json")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "5")

    guest_user = {"id": "anon-uuid-12345", "is_anonymous": True}
    client_ip = "2a02:ed0:6d28:a100:1111:2222:3333:4444"

    # Initial usage should be 0
    info = qs.get_user_quota_info(guest_user, client_ip=client_ip)
    assert info["used_today"] == 0
    assert info["remaining_paid"] == 5

    # Record usage
    qs.record_guest_usage(guest_user, client_ip=client_ip)
    info2 = qs.get_user_quota_info(guest_user, client_ip=client_ip)
    assert info2["used_today"] == 1
    assert info2["remaining_paid"] == 4

    # Different temporary IPv6 on same /64 subnet should still see used_today == 1
    client_ip_temp = "2a02:ed0:6d28:a100:9999:8888:7777:6666"
    info3 = qs.get_user_quota_info(guest_user, client_ip=client_ip_temp)
    assert info3["used_today"] == 1
    assert info3["remaining_paid"] == 4

    # Even if client_ip changes completely, session-based tracking retains usage
    different_ip = "185.200.50.10"
    info4 = qs.get_user_quota_info(guest_user, client_ip=different_ip)
    assert info4["used_today"] == 1
    assert info4["remaining_paid"] == 4

    # And even if session ID is cleared (e.g. incognito), original IP ceiling retains usage
    fresh_guest = {"id": "anon-uuid-brand-new", "is_anonymous": True}
    info5 = qs.get_user_quota_info(fresh_guest, client_ip=client_ip)
    assert info5["used_today"] == 1
    assert info5["remaining_paid"] == 4


@pytest.mark.asyncio
async def test_unauthenticated_user_quota_endpoint(tmp_path, monkeypatch):
    import services.quota_service as qs
    from main import get_current_user_quota
    monkeypatch.setattr(qs, "USAGE_FILE", tmp_path / "daily_usage.json")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "5")

    mock_req = MagicMock()
    mock_req.headers.get.return_value = None
    mock_req.client.host = "127.0.0.1"

    mock_resp = MagicMock()
    mock_resp.headers = {}

    # Called with user=None (unauthenticated visitor / initial load)
    res = await get_current_user_quota(request=mock_req, response=mock_resp, user=None)
    assert res["is_guest"] is True
    assert res["is_admin"] is False
    assert res["daily_paid_limit"] == 5
    assert res["remaining_paid"] == 5


class _FakeSupabaseUsageDB:
    """Minimal in-memory stand-in for the Supabase `ai_usage` table + increment RPC."""

    def __init__(self, fail=False):
        self.rows: dict = {}
        self.fail = fail
        self.requests: list = []

    def _response(self, status_code, payload):
        resp = MagicMock()
        resp.status_code = status_code
        resp.text = str(payload)
        resp.json.return_value = payload
        return resp

    def get(self, url, headers=None, params=None):
        self.requests.append(("get", params))
        if self.fail:
            return self._response(404, {"message": "relation does not exist"})
        date_key = params["usage_date"].removeprefix("eq.")
        raw_ids = params["identifier"].removeprefix("in.(").removesuffix(")")
        wanted = [part.strip('"') for part in raw_ids.split(",")]
        rows = [
            {"identifier": ident, "count": self.rows[(date_key, ident)]}
            for ident in wanted
            if (date_key, ident) in self.rows
        ]
        return self._response(200, rows)

    def post(self, url, headers=None, json=None):
        self.requests.append(("post", json))
        if self.fail:
            return self._response(404, {"message": "function does not exist"})
        key = (json["p_date"], json["p_identifier"])
        self.rows[key] = max(0, self.rows.get(key, 0) + json["p_delta"])
        return self._response(200, self.rows[key])

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


@pytest.fixture
def fake_supabase_usage(monkeypatch):
    """Routes quota_service's usage store at an in-memory fake Supabase."""
    import services.quota_service as qs

    def _install(fail=False):
        db = _FakeSupabaseUsageDB(fail=fail)
        monkeypatch.setattr(qs, "usage_store_is_durable", lambda: True)
        monkeypatch.setattr(qs, "_supabase_config", lambda: ("https://fake.supabase.co", "svc-key"))
        monkeypatch.setattr(qs.httpx, "Client", lambda *a, **kw: db)
        qs._remote_disabled_until = 0.0
        return db

    yield _install
    quota_module._remote_disabled_until = 0.0


def test_usage_is_persisted_remotely_not_in_ephemeral_file(fake_supabase_usage, tmp_path, monkeypatch):
    """
    Regression test for the quota-reset bug: counts used to live ONLY in a local JSON file
    on the app server's ephemeral disk, so a restart/redeploy wiped them. With Supabase
    configured, counts must go to the database and survive the local file disappearing.
    """
    import services.quota_service as qs
    db = fake_supabase_usage()
    usage_file = tmp_path / "daily_usage.json"
    monkeypatch.setattr(qs, "USAGE_FILE", usage_file)

    assert qs.record_prompt_usage("user-abc", date_str="2099-05-05") == 1
    assert qs.record_prompt_usage("user-abc", date_str="2099-05-05") == 2
    assert qs.get_user_daily_usage("user-abc", date_str="2099-05-05") == 2

    # Nothing was written to the ephemeral file, and the count survives losing it.
    assert not usage_file.exists()
    assert qs.get_user_daily_usage("user-abc", date_str="2099-05-05") == 2

    # Refunds (cancelled jobs) decrement the same durable counter, clamped at zero.
    assert qs.refund_prompt_usage("user-abc", date_str="2099-05-05") == 1
    assert db.rows[("2099-05-05", "user-abc")] == 1


def test_guest_usage_reads_all_identifiers_in_one_request(fake_supabase_usage, monkeypatch):
    import services.quota_service as qs
    db = fake_supabase_usage()
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "5")

    guest = {"id": "anon-1", "is_anonymous": True}
    qs.record_guest_usage(guest, client_ip="203.0.113.9", date_str="2099-05-06")
    db.requests.clear()

    assert qs.get_guest_usage(guest, client_ip="203.0.113.9", date_str="2099-05-06") == 1
    assert len([r for r in db.requests if r[0] == "get"]) == 1


def test_usage_falls_back_to_local_file_when_supabase_unavailable(fake_supabase_usage, tmp_path, monkeypatch):
    import services.quota_service as qs
    fake_supabase_usage(fail=True)
    usage_file = tmp_path / "daily_usage.json"
    monkeypatch.setattr(qs, "USAGE_FILE", usage_file)

    assert qs.record_prompt_usage("user-xyz", date_str="2099-05-07") == 1
    assert qs.get_user_daily_usage("user-xyz", date_str="2099-05-07") == 1
    assert usage_file.exists()


def test_local_usage_file_keeps_only_recent_days(tmp_path, monkeypatch):
    import services.quota_service as qs
    usage_file = tmp_path / "daily_usage.json"
    monkeypatch.setattr(qs, "USAGE_FILE", usage_file)

    for day in ("2099-01-01", "2099-01-02", "2099-01-03", "2099-01-04", "2099-01-05"):
        qs.record_prompt_usage("u1", date_str=day)

    import json as _json
    stored = _json.loads(usage_file.read_text(encoding="utf-8"))
    assert sorted(stored.keys()) == ["2099-01-03", "2099-01-04", "2099-01-05"]


def test_community_pool_daily_and_monthly_guardrail(tmp_path, monkeypatch):
    import services.quota_service as qs
    usage_file = tmp_path / "daily_usage.json"
    monkeypatch.setattr(qs, "USAGE_FILE", usage_file)
    monkeypatch.setattr(qs, "usage_store_is_durable", lambda: False)

    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "5")
    monkeypatch.setenv("DAILY_COMMUNITY_PAID_LIMIT", "2")
    monkeypatch.setenv("COMMUNITY_DONATION_URL", "https://ko-fi.com/chronix")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY")

    u1 = {"id": "user-pool-1", "is_anonymous": False}
    u2 = {"id": "user-pool-2", "is_anonymous": False}
    u3 = {"id": "user-pool-3", "is_anonymous": False}

    # First two paid prompts across the community pool succeed on PAID_KEY
    k1, t1, _ = resolve_gemini_key(u1, increment_usage=True)
    k2, t2, _ = resolve_gemini_key(u2, increment_usage=True)
    assert (k1, t1) == ("PAID_KEY", "paid")
    assert (k2, t2) == ("PAID_KEY", "paid")

    # Third user still has personal quota (0/5), but global community pool (2/2) is exhausted -> falls back to FREE_KEY
    info_u3 = get_user_quota_info(u3)
    assert info_u3["community_pool_exhausted"] is True
    assert info_u3["tier"] == "free"
    assert info_u3["remaining_paid"] == 0
    assert info_u3["donation_url"] == "https://ko-fi.com/chronix"
    assert info_u3["community_pool"]["daily_used"] == 2
    assert info_u3["community_pool"]["daily_remaining"] == 0

    k3, t3, _ = resolve_gemini_key(u3, increment_usage=True)
    assert (k3, t3) == ("FREE_KEY", "free")

    # Refunding u2 (whose request held a pool slot - tier "paid") frees 1 slot in the community pool
    qs.refund_user_quota(u2, refund_pool=qs.community_pool_reserved_for_tier(t2))
    info_after = get_user_quota_info(u3)
    assert info_after["community_pool_exhausted"] is False
    assert info_after["tier"] == "paid"
    k3_retry, t3_retry, _ = resolve_gemini_key(u3, increment_usage=True)
    assert (k3_retry, t3_retry) == ("PAID_KEY", "paid")


def test_match_existing_timelines_endpoint(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    import services.storage as st
    from main import app

    timelines_file = tmp_path / "timelines.json"
    monkeypatch.setattr(st, "TIMELINES_FILE", timelines_file)
    monkeypatch.setattr(st, "_supabase_is_configured", lambda: False)
    st._LOCAL_TIMELINES_CACHE_KEY = None
    st._LOCAL_TIMELINES_CACHE_DATA = None

    sample_timelines = [
        {
            "id": "tl-french-rev",
            "title": "המהפכה הצרפתית (1789–1799)",
            "description": "אירועי מפתח במהפכה הצרפתית",
            "contentMode": "classic",
            "isPersonal": False,
            "articles": [{"id": "e1", "title": "נפילת הבסטיליה", "from": {"year": 1789}}],
            "updatedAt": "2026-10-01T10:00:00Z",
        },
        {
            "id": "tl-personal-secret",
            "title": "המהפכה הצרפתית",
            "description": "ציר אישי פרטי",
            "contentMode": "classic",
            "isPersonal": True,
            "articles": [{"id": "e2", "title": "אירוע", "from": {"year": 1789}}],
            "updatedAt": "2026-10-02T10:00:00Z",
        },
    ]
    st._save_local_timelines(sample_timelines)

    client = TestClient(app)
    resp = client.get("/api/timelines/match", params={"q": "תולדות המהפכה הצרפתית"})
    assert resp.status_code == 200
    matches = resp.json()
    assert len(matches) == 1
    assert matches[0]["id"] == "tl-french-rev"
    assert matches[0]["articleCount"] == 1


def test_community_transparency_ledger_and_kofi_webhook(tmp_path, monkeypatch):
    import json as _json
    from fastapi.testclient import TestClient
    import services.quota_service as qs
    from main import app

    usage_file = tmp_path / "daily_usage.json"
    monkeypatch.setattr(qs, "USAGE_FILE", usage_file)
    monkeypatch.setattr(qs, "usage_store_is_durable", lambda: False)
    monkeypatch.setattr(qs, "_supabase_config", lambda: ("", ""))
    monkeypatch.setenv("KOFI_VERIFICATION_TOKEN", "kofi-secret-token-123")

    # 1. Record AI spend ($2.50)
    qs.record_community_spend_usd(2.50)
    ledger = qs.get_community_ledger()
    assert ledger["spent_usd"] == 2.5
    assert ledger["donated_usd"] == 0.0
    assert ledger["coverage_percent"] == 0

    client = TestClient(app)

    # 2. Invalid Ko-fi verification token is rejected with 403
    bad_resp = client.post(
        "/api/webhooks/kofi",
        data={"data": _json.dumps({"verification_token": "wrong-token", "amount": "5.00", "currency": "USD"})},
    )
    assert bad_resp.status_code == 403

    # 3. Valid Ko-fi webhook records $5.00 donation and deduplicates retries by kofi_transaction_id
    kofi_payload = {
        "verification_token": "kofi-secret-token-123",
        "kofi_transaction_id": "tx-abc-001",
        "amount": "5.00",
        "currency": "USD",
        "type": "Donation",
    }
    ok_resp = client.post("/api/webhooks/kofi", data={"data": _json.dumps(kofi_payload)})
    assert ok_resp.status_code == 200
    body = ok_resp.json()
    assert body["recorded"] is True
    assert body["duplicate"] is False
    assert body["donated_usd"] == 5.0
    assert body["donations_count"] == 1
    assert body["coverage_percent"] == 200
    assert body["balance_usd"] == 2.5

    # Duplicate webhook with same transaction ID does not double-count
    dup_resp = client.post("/api/webhooks/kofi", data={"data": _json.dumps(kofi_payload)})
    assert dup_resp.status_code == 200
    assert dup_resp.json()["duplicate"] is True
    assert dup_resp.json()["donated_usd"] == 5.0
    assert dup_resp.json()["donations_count"] == 1

    # 4. Public ledger endpoint returns accurate totals
    get_resp = client.get("/api/community/ledger")
    assert get_resp.status_code == 200
    pub_ledger = get_resp.json()
    assert pub_ledger["spent_usd"] == 2.5
    assert pub_ledger["donated_usd"] == 5.0
    assert pub_ledger["donations_count"] == 1
    assert pub_ledger["kofi_webhook_configured"] is True

    # 5. Admin manual adjustment updates exact totals
    updated = qs.set_community_ledger_totals(spent_usd=10.0, donated_usd=8.0, donations_count=3)
    assert updated["spent_usd"] == 10.0
    assert updated["donated_usd"] == 8.0
    assert updated["donations_count"] == 3
    assert updated["coverage_percent"] == 80
    assert updated["balance_usd"] == -2.0



# --- Regression tests: community-branch review fixes -------------------------------------


def _isolated_ledger_store(tmp_path, monkeypatch):
    import services.quota_service as qs
    monkeypatch.setattr(qs, "USAGE_FILE", tmp_path / "daily_usage.json")
    monkeypatch.setattr(qs, "usage_store_is_durable", lambda: False)
    monkeypatch.setattr(qs, "_supabase_config", lambda: ("", ""))
    monkeypatch.setattr(qs, "_last_seed_failure_at", 0.0)
    for var in ("COMMUNITY_SPENT_USD_BASE", "COMMUNITY_DONATED_USD_BASE"):
        monkeypatch.delenv(var, raising=False)
    return qs


def test_refund_without_pool_reservation_keeps_pool_counter(tmp_path, monkeypatch):
    """#4: refunding a request that never reserved a pool slot must not free a pool slot."""
    qs = _isolated_ledger_store(tmp_path, monkeypatch)
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "1")
    monkeypatch.setenv("DAILY_COMMUNITY_PAID_LIMIT", "2")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY")

    a = {"id": "refund-a", "is_anonymous": False}
    b = {"id": "refund-b", "is_anonymous": False}
    assert resolve_gemini_key(a, increment_usage=True)[1] == "paid"
    assert resolve_gemini_key(b, increment_usage=True)[1] == "paid"
    _, tier, _ = resolve_gemini_key(a, increment_usage=True)  # over personal limit
    assert tier == "free"
    assert qs.community_pool_reserved_for_tier(tier) is False

    qs.refund_user_quota(a, refund_pool=qs.community_pool_reserved_for_tier(tier))
    assert qs.get_community_pool_status()["daily_used"] == 2

    # Default is to NOT touch the pool (e.g. increment_user_quota-based charges).
    qs.refund_user_quota(b)
    assert qs.get_community_pool_status()["daily_used"] == 2


def test_job_refund_releases_pool_slot_only_when_reserved(tmp_path, monkeypatch):
    """#4: async-job refunds release the pool slot only if the job reserved one."""
    import main as main_module
    qs = _isolated_ledger_store(tmp_path, monkeypatch)
    monkeypatch.setenv("API_KEY_MODE", "unlimited")
    monkeypatch.setenv("DAILY_COMMUNITY_PAID_LIMIT", "5")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    user = {"id": "job-user", "is_anonymous": False}

    _, tier, _ = resolve_gemini_key(user, increment_usage=True)
    assert tier == "paid"
    assert qs.get_community_pool_status()["daily_used"] == 1

    # Unlimited mode records no per-user usage, but the pool slot must still be released.
    reserved_job = {"incremented_quota": False, "pool_reserved": True, "user": user}
    main_module._refund_job_quota_and_limits(reserved_job, user)
    assert qs.get_community_pool_status()["daily_used"] == 0
    assert reserved_job["pool_reserved"] is False

    resolve_gemini_key(user, increment_usage=True)
    unreserved_job = {"incremented_quota": True, "pool_reserved": False, "user": user}
    main_module._refund_job_quota_and_limits(unreserved_job, user)
    assert qs.get_community_pool_status()["daily_used"] == 1


def test_force_sync_never_wipes_spend_when_activity_log_unavailable(tmp_path, monkeypatch):
    """#3: an unavailable/failed activity_log read must leave the ledger untouched."""
    qs = _isolated_ledger_store(tmp_path, monkeypatch)
    qs.record_community_spend_usd(12.34)

    ledger, error = qs.admin_sync_historical_spend()
    assert error and "not configured" in error
    assert ledger["spent_usd"] == 12.34

    # Supabase configured but the query fails -> error, nothing written, cooldown armed.
    monkeypatch.setattr(qs, "usage_store_is_durable", lambda: True)
    monkeypatch.setattr(qs, "_usage_remote_available", lambda: False)
    monkeypatch.setattr(qs, "_fetch_historical_spend_micro", lambda: (None, "activity_log query failed (HTTP 500)"))
    ledger, error = qs.admin_sync_historical_spend()
    assert error and "HTTP 500" in error
    assert ledger["spent_usd"] == 12.34


def test_force_sync_only_raises_spend(tmp_path, monkeypatch):
    """#3: sync ensures spend is AT LEAST the historical sum; it never lowers the counter."""
    qs = _isolated_ledger_store(tmp_path, monkeypatch)
    qs.record_community_spend_usd(10.0)

    monkeypatch.setattr(qs, "_fetch_historical_spend_micro", lambda: (4_000_000, None))  # $4 < $10
    ledger, error = qs.admin_sync_historical_spend()
    assert error is None and ledger["spent_usd"] == 10.0

    monkeypatch.setattr(qs, "_fetch_historical_spend_micro", lambda: (25_123_456, None))  # $25.123456
    ledger, error = qs.admin_sync_historical_spend()
    assert error is None and ledger["spent_usd"] == 25.1235
    assert ledger["spend_seeded"] is True


def test_admin_sync_endpoint_returns_502_and_keeps_ledger(tmp_path, monkeypatch):
    """#3: the admin endpoint surfaces sync failures instead of silently zeroing totals."""
    from fastapi.testclient import TestClient
    import main as main_module
    qs = _isolated_ledger_store(tmp_path, monkeypatch)
    qs.record_community_spend_usd(3.21)
    admin = {"id": "admin-1", "email": "admin@example.com", "is_anonymous": False}
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    main_module.app.dependency_overrides[main_module.get_current_user_required] = lambda: admin
    try:
        client = TestClient(main_module.app)
        resp = client.post("/api/admin/community/ledger", json={"sync_from_activity_log": True})
        assert resp.status_code == 502
        assert "Ledger not changed" in resp.json()["detail"]
        assert qs.get_community_ledger()["spent_usd"] == 3.21

        bad = client.post("/api/admin/community/ledger", json={"spent_usd": 1e12})
        assert bad.status_code == 400
        assert qs.get_community_ledger()["spent_usd"] == 3.21
    finally:
        main_module.app.dependency_overrides.pop(main_module.get_current_user_required, None)


def test_activity_log_sync_pages_through_all_rows(tmp_path, monkeypatch):
    """#3: historical spend is summed across pages (keyset pagination), skipping BYOK/admin rows."""
    qs = _isolated_ledger_store(tmp_path, monkeypatch)
    monkeypatch.setattr(qs, "_supabase_config", lambda: ("https://example.supabase.co", "service-key"))
    monkeypatch.setattr(qs, "_ACTIVITY_LOG_PAGE_SIZE", 2)
    rows = [
        {"id": 1, "cost_usd": 1.0, "key_tier": "paid", "is_admin": False},
        {"id": 2, "cost_usd": 2.0, "key_tier": "custom", "is_admin": False},
        {"id": 3, "cost_usd": 0.5, "key_tier": "paid", "is_admin": False},
        {"id": 4, "cost_usd": 0.25, "key_tier": None, "is_admin": False},
        {"id": 5, "cost_usd": 9.0, "key_tier": "admin_paid", "is_admin": False},
    ]

    class _Resp:
        status_code = 200
        text = ""
        def __init__(self, data):
            self._data = data
        def json(self):
            return self._data

    class _FakeClient:
        def __init__(self, *a, **k):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def get(self, url, headers=None, params=None):
            after = int(params["id"].split(".", 1)[1])
            page = [r for r in rows if r["id"] > after][: int(params["limit"])]
            return _Resp(page)

    monkeypatch.setattr(qs.httpx, "Client", _FakeClient)
    total_micro, error = qs._fetch_historical_spend_micro()
    assert error is None
    assert total_micro == 1_750_000  # 1.0 + 0.5 + 0.25


def test_ledger_totals_stay_within_postgres_int_range(tmp_path, monkeypatch):
    """#2: stored counters must fit a Postgres `integer` even for totals far above $2,147."""
    qs = _isolated_ledger_store(tmp_path, monkeypatch)
    int4_max = 2_147_483_647

    updated = qs.set_community_ledger_totals(spent_usd=1_234_567.891234, donated_usd=50_000.0, donations_count=3)
    assert updated["spent_usd"] == 1234567.8912
    assert updated["donated_usd"] == 50000.0

    qs.record_community_spend_usd(5_000.0)
    res = qs.record_community_donation_usd(9_999.99, tx_id="tx-big-1", currency="USD")
    assert res["recorded"] is True and res["donated_usd"] == 59999.99

    raw = qs.get_usage_for_identifiers(qs._LEDGER_IDS, date_str=qs.COMMUNITY_LEDGER_DATE)
    assert all(0 <= v <= int4_max for v in raw.values()), raw
    assert raw[qs.COMMUNITY_SPENT_REMAINDER_MICRO_ID] < qs._MICRO_PER_CENT


def test_sub_cent_spend_carries_into_cents_exactly(tmp_path, monkeypatch):
    """#2: many tiny per-call costs accumulate without loss via the remainder -> cents carry."""
    qs = _isolated_ledger_store(tmp_path, monkeypatch)
    # In-memory store: this test exercises the carry arithmetic, not file I/O (thousands of
    # fsync'd os.replace calls are flaky on Windows when AV/indexers briefly lock the file).
    mem: dict = {}
    monkeypatch.setattr(qs, "_load_usage_data", lambda: mem)
    monkeypatch.setattr(qs, "_save_usage_data", lambda data: None)
    for _ in range(1000):
        qs.record_community_spend_usd(0.000337)  # 337 micro-dollars each
    raw = qs.get_usage_for_identifiers(qs._LEDGER_IDS, date_str=qs.COMMUNITY_LEDGER_DATE)
    assert raw[qs.COMMUNITY_SPENT_CENTS_ID] * qs._MICRO_PER_CENT + raw[qs.COMMUNITY_SPENT_REMAINDER_MICRO_ID] == 337_000
    assert raw[qs.COMMUNITY_SPENT_REMAINDER_MICRO_ID] < qs._MICRO_PER_CENT
    assert qs.get_community_ledger()["spent_usd"] == 0.337


def test_ledger_rejects_non_finite_and_out_of_range_values(tmp_path, monkeypatch):
    """#2: inf/NaN/huge inputs are rejected instead of overflowing the store."""
    qs = _isolated_ledger_store(tmp_path, monkeypatch)
    for bad in (float("inf"), float("nan"), -1.0, 1e12):
        with pytest.raises(ValueError):
            qs.set_community_ledger_totals(spent_usd=bad)
    assert qs.record_community_spend_usd(float("inf")) <= qs.MAX_COMMUNITY_LEDGER_USD
    res = qs.record_community_donation_usd(float("inf"), tx_id="tx-inf")
    assert res["recorded"] is False


def test_legacy_microdollar_ledger_is_migrated_once(tmp_path, monkeypatch):
    """#2: totals written by the old micro-dollar format are converted into cents exactly once."""
    qs = _isolated_ledger_store(tmp_path, monkeypatch)
    qs._change_usage_delta(qs.COMMUNITY_LEDGER_DATE, qs._LEGACY_SPENT_MICRO_ID, 2_500_123)   # $2.500123
    qs._change_usage_delta(qs.COMMUNITY_LEDGER_DATE, qs._LEGACY_DONATED_MICRO_ID, 5_000_000)  # $5.00

    first = qs.get_community_ledger()
    second = qs.get_community_ledger()
    assert first["spent_usd"] == second["spent_usd"] == 2.5001
    assert first["donated_usd"] == second["donated_usd"] == 5.0
    raw = qs.get_usage_for_identifiers(qs._LEDGER_IDS, date_str=qs.COMMUNITY_LEDGER_DATE)
    assert raw[qs._LEGACY_SPENT_MICRO_ID] == 0 and raw[qs._LEGACY_DONATED_MICRO_ID] == 0


def test_match_never_exposes_other_users_private_local_timelines(tmp_path, monkeypatch):
    """#1: with Supabase configured (but failing), local fallback obeys owner/share visibility."""
    import services.storage as st

    monkeypatch.setattr(st, "TIMELINES_FILE", tmp_path / "timelines.json")
    st._LOCAL_TIMELINES_CACHE_KEY = None
    st._LOCAL_TIMELINES_CACHE_DATA = None
    base = {"contentMode": "classic", "isPersonal": False, "articles": [{"id": "e1", "title": "x"}]}
    st._save_local_timelines([
        {**base, "id": "tl-private-other", "title": "French Revolution", "user_id": "someone-else"},
        {**base, "id": "tl-private-unowned", "title": "French Revolution", "updatedAt": "2026-10-03T00:00:00Z"},
        {**base, "id": "tl-public", "title": "French Revolution", "is_public": True},
        {**base, "id": "tl-mine", "title": "French Revolution", "user_id": "me"},
    ])

    class _FailingClient:
        def __init__(self, *a, **k):
            raise RuntimeError("supabase unreachable")

    monkeypatch.setattr(st, "_supabase_is_configured", lambda: True)
    monkeypatch.setattr(st.httpx, "Client", _FailingClient)

    anon_ids = {m["id"] for m in st.find_matching_timelines("French Revolution", limit=10)}
    assert anon_ids == {"tl-public"}

    mine_ids = {m["id"] for m in st.find_matching_timelines("French Revolution", user_id="me", limit=10)}
    assert mine_ids == {"tl-public", "tl-mine"}

    admin_ids = {m["id"] for m in st.find_matching_timelines("French Revolution", is_admin=True, limit=10)}
    assert admin_ids == {"tl-private-other", "tl-private-unowned", "tl-public", "tl-mine"}


def test_match_skips_local_file_when_supabase_query_succeeds(tmp_path, monkeypatch):
    """#1: a healthy Supabase query is the only source; the local fallback file is not searched."""
    import services.storage as st

    monkeypatch.setattr(st, "TIMELINES_FILE", tmp_path / "timelines.json")
    st._LOCAL_TIMELINES_CACHE_KEY = None
    st._LOCAL_TIMELINES_CACHE_DATA = None
    st._save_local_timelines([{
        "id": "tl-local-leak", "title": "French Revolution", "contentMode": "classic",
        "is_public": True, "articles": [{"id": "e1"}],
    }])

    class _Resp:
        status_code = 200
        text = ""
        def json(self):
            return [
                {"id": "tl-remote", "title": "French Revolution", "article_count": 3, "is_public": True,
                 "user_id": "u1", "content_mode": "classic"},
                # A row the query should never return; must still be dropped by the re-check.
                {"id": "tl-remote-private", "title": "French Revolution", "article_count": 3,
                 "is_public": False, "user_id": "u2", "content_mode": "classic"},
            ]

    class _OkClient:
        def __init__(self, *a, **k):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
        def get(self, *a, **k):
            return _Resp()

    monkeypatch.setattr(st, "_supabase_is_configured", lambda: True)
    monkeypatch.setattr(st.httpx, "Client", _OkClient)
    ids = [m["id"] for m in st.find_matching_timelines("French Revolution", limit=10)]
    assert ids == ["tl-remote"]


def test_weighted_credits_defaults_and_charge_premium_credits(fake_supabase_usage, monkeypatch):
    import services.quota_service as qs

    db = fake_supabase_usage()
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")
    monkeypatch.delenv("DAILY_PAID_PROMPTS", raising=False)
    monkeypatch.delenv("GUEST_DAILY_PAID_PROMPTS", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_123")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_456")

    reg_user = {"id": "weighted-reg-1", "is_anonymous": False}
    guest_user = {"id": "weighted-guest-1", "is_anonymous": True}

    reg_info = qs.get_user_quota_info(reg_user)
    guest_info = qs.get_user_quota_info(guest_user, client_ip="203.0.113.77")
    assert reg_info["daily_paid_limit"] == 25
    assert guest_info["daily_paid_limit"] == 10
    assert reg_info["credit_costs"] == {
        "text": 1,
        "upload_medium": 2,
        "upload_heavy": 3,
        "gemini_image": 6,
        "gemini_audio": 10,
        "gemini_audio_full": 20,
    }
    assert guest_info["credit_costs"] == {
        "text": 1,
        "upload_medium": 2,
        "upload_heavy": 3,
        "gemini_image": 6,
        "gemini_audio": 10,
        "gemini_audio_full": 20,
    }

    # Guest has 10 credits: 1 Gemini image (6 credits) succeeds -> 4 left
    ok, key, tier, inc, pool = qs.charge_premium_credits(guest_user, client_ip="203.0.113.77", credits=6)
    assert (ok, key, tier, inc, pool) == (True, "PAID_KEY_123", "paid", True, True)
    assert qs.get_user_quota_info(guest_user, client_ip="203.0.113.77")["remaining_paid"] == 4

    # 2nd Gemini image (6 > 4) is rejected without touching the remaining 4 credits
    ok2, key2, tier2, inc2, pool2 = qs.charge_premium_credits(guest_user, client_ip="203.0.113.77", credits=6)
    assert (ok2, key2, tier2, inc2, pool2) == (False, None, "free", False, False)
    assert qs.get_user_quota_info(guest_user, client_ip="203.0.113.77")["remaining_paid"] == 4

    # A 1-credit text action still succeeds on the paid key -> 3 left!
    t_key, t_tier, _ = qs.resolve_gemini_key(guest_user, increment_usage=True, client_ip="203.0.113.77")
    assert (t_key, t_tier) == ("PAID_KEY_123", "paid")
    assert qs.get_user_quota_info(guest_user, client_ip="203.0.113.77")["remaining_paid"] == 3

    # Verify durable Supabase RPC received exact integer p_delta (+6 and +1)
    deltas = [req[1]["p_delta"] for req in db.requests if req[0] == "post"]
    assert 6 in deltas and 1 in deltas

    # Refunding 6 credits restores 6 credits cleanly
    qs.refund_user_quota(guest_user, client_ip="203.0.113.77", refund_pool=True, credits=6)
    assert qs.get_user_quota_info(guest_user, client_ip="203.0.113.77")["remaining_paid"] == 9


def test_calculate_upload_credit_cost_volume_tiers():
    import services.quota_service as qs
    from services.upload_security import ValidatedUploads

    # 1 credit: empty/text-only, 1-5 images, <= 10 PDF pages, <= 15,000 text chars
    assert qs.calculate_upload_credit_cost(None, raw_text="Short voice or typed text") == 1
    assert qs.calculate_upload_credit_cost(ValidatedUploads(image_count=1)) == 1
    assert qs.calculate_upload_credit_cost(ValidatedUploads(image_count=5)) == 1
    assert qs.calculate_upload_credit_cost(ValidatedUploads(total_pdf_pages=10, pdf_count=1)) == 1
    assert qs.calculate_upload_credit_cost(
        ValidatedUploads(extracted_documents=[("notes.txt", "a" * 15_000)], text_file_count=1)
    ) == 1

    # 2 credits: 6-20 images, 11-25 PDF pages, > 15,000 chars, or Chat file attachment
    assert qs.calculate_upload_credit_cost(ValidatedUploads(image_count=6)) == 2
    assert qs.calculate_upload_credit_cost(ValidatedUploads(image_count=20)) == 2
    assert qs.calculate_upload_credit_cost(ValidatedUploads(total_pdf_pages=11, pdf_count=1)) == 2
    assert qs.calculate_upload_credit_cost(ValidatedUploads(total_pdf_pages=25, pdf_count=1)) == 2
    assert qs.calculate_upload_credit_cost(
        ValidatedUploads(extracted_documents=[("book.md", "a" * 15_001)], text_file_count=1)
    ) == 2
    assert qs.calculate_upload_credit_cost(None, raw_text="a" * 15_001) == 2
    assert qs.calculate_upload_credit_cost(
        ValidatedUploads(image_count=1), is_chat_or_refine=True
    ) == 2

    # 3 credits: 26+ PDF pages, or heavy Chat file merges (>=20 PDF pages, >=12 images, >30k chars)
    assert qs.calculate_upload_credit_cost(ValidatedUploads(total_pdf_pages=26, pdf_count=1)) == 3
    assert qs.calculate_upload_credit_cost(ValidatedUploads(total_pdf_pages=50, pdf_count=1)) == 3
    assert qs.calculate_upload_credit_cost(
        ValidatedUploads(total_pdf_pages=20, pdf_count=1), is_chat_or_refine=True
    ) == 3
    assert qs.calculate_upload_credit_cost(
        ValidatedUploads(image_count=12), is_chat_or_refine=True
    ) == 3
    assert qs.calculate_upload_credit_cost(
        ValidatedUploads(extracted_documents=[("big.txt", "a" * 30_001)]), is_chat_or_refine=True
    ) == 3


def test_google_search_grounding_monthly_cap_and_overage_cost(fake_supabase_usage, monkeypatch):
    import services.quota_service as qs

    fake_supabase_usage()
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_ABC")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY_XYZ")

    assert qs.is_server_paid_gemini_key("PAID_KEY_ABC") is True
    assert qs.is_server_paid_gemini_key(None) is True
    assert qs.is_server_paid_gemini_key("FREE_KEY_XYZ") is False
    assert qs.is_server_paid_gemini_key("CUSTOM_BYOK") is False
    assert qs.get_dedicated_free_key_for_grounding() == "FREE_KEY_XYZ"

    # Default cap is 4,750 (safely below Google's 5,000 free monthly queries)
    assert qs.get_google_search_grounding_monthly_limit() == 4_750
    assert qs.is_paid_grounding_within_monthly_cap("2026-10-01") is True

    # Queries inside the 5,000 free tier incur $0.00 overage
    total, cost = qs.record_google_search_grounding_queries(4_750, month_str="2026-10-01")
    assert (total, cost) == (4_750, 0.0)
    assert qs.is_paid_grounding_within_monthly_cap("2026-10-01") is False

    # Still free up to 4,999
    total2, cost2 = qs.record_google_search_grounding_queries(249, month_str="2026-10-01")
    assert (total2, cost2) == (4_999, 0.0)

    # Crossing 5,000: 4,999 + 3 = 5,002 -> 1 free query + 2 billable queries @ $0.014 = $0.028
    total3, cost3 = qs.record_google_search_grounding_queries(3, month_str="2026-10-01")
    assert total3 == 5_002
    assert cost3 == pytest.approx(0.028)

    # Subsequent queries above 5,000 are billed in full @ $0.014/query
    total4, cost4 = qs.record_google_search_grounding_queries(2, month_str="2026-10-01")
    assert total4 == 5_004
    assert cost4 == pytest.approx(0.028)

    admin_info = qs.get_user_quota_info({"id": "adm", "email": "admin@example.com"})
    assert "grounding_monthly" in admin_info
    assert admin_info["grounding_monthly"]["free_tier_queries"] == 5_000


