import pytest
import os
from unittest.mock import MagicMock, patch
from fastapi import HTTPException

from services.auth_service import is_admin_user, get_admin_emails, get_current_user_required
from services.quota_service import (
    get_user_daily_usage,
    record_prompt_usage,
    get_user_quota_info,
    resolve_gemini_key
)
from main import SimpleRateLimiter

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
