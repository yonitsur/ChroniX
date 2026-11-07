"""SC-09: the quota store fails closed in production (no ephemeral local file), with a circuit breaker."""
import asyncio
import json
import logging

import pytest
from fastapi import HTTPException

from _quota_store_fakes import FakeUsageDB, install_fake_store
from services import quota_service as qs

GUEST = {"id": "g-3b", "is_anonymous": True}
USER = {"id": "u-3b", "email": "u3b@example.com"}


@pytest.fixture
def prod_store(monkeypatch, tmp_path):
    """Production, Supabase configured, store reachable until a test flips `db.mode`."""
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("QUOTA_LOCAL_FALLBACK", raising=False)
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY")
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "10")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "25")
    monkeypatch.delenv("ADMIN_EMAILS", raising=False)
    usage_file = tmp_path / "daily_usage.json"
    monkeypatch.setattr(qs, "USAGE_FILE", usage_file)
    db = install_fake_store(monkeypatch, qs, FakeUsageDB())
    yield db, usage_file
    qs.reset_usage_store_breaker()


def _no_free_keys(monkeypatch):
    for name in ("GEMINI_API_KEY_FREE", "GEMINI_API_KEY_FREE_1", "GEMINI_API_KEY_FREE_2", "GEMINI_API_KEYS_FREE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(qs, "get_next_free_key", lambda: "")


def test_production_store_failure_serves_basic_mode_and_never_writes_local_file(prod_store):
    db, usage_file = prod_store
    db.mode = "error"
    for user in (GUEST, USER):
        key, tier, is_admin = qs.resolve_gemini_key(user, increment_usage=True, client_ip="203.0.113.7")
        assert tier == "free" and is_admin is False
        assert key and key != "PAID_KEY"
    assert not usage_file.exists()


def test_production_store_timeout_without_free_key_is_503(prod_store, monkeypatch):
    db, usage_file = prod_store
    db.mode = "timeout"
    _no_free_keys(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        qs.resolve_gemini_key(USER, increment_usage=True, client_ip="203.0.113.7")
    assert exc.value.status_code == 503
    assert exc.value.headers.get("Retry-After")
    assert not usage_file.exists()


def test_production_store_failure_declines_premium_charges(prod_store):
    db, usage_file = prod_store
    db.mode = "error"
    for user in (GUEST, USER):
        allowed, key, tier, incremented, pool = qs.charge_premium_credits(
            user, None, client_ip="203.0.113.7", credits=6, require_paid_key=True
        )
        assert (allowed, key, tier, incremented, pool) == (False, None, qs.QUOTA_STORE_UNAVAILABLE_TIER, False, False)
    assert not usage_file.exists()


def test_byok_and_admin_are_unaffected_by_a_store_outage(prod_store, monkeypatch):
    db, _ = prod_store
    db.mode = "error"
    assert qs.resolve_gemini_key(USER, custom_api_key="MY_KEY")[:2] == ("MY_KEY", "custom")
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    admin = {"id": "a-3b", "email": "admin@example.com", "email_confirmed_at": "2024-01-01T00:00:00Z",
             "app_metadata": {"role": "admin"}}
    assert qs.charge_premium_credits(admin, None, credits=6)[0] is True


def test_server_paid_counters_are_skipped_gracefully(prod_store):
    db, usage_file = prod_store
    db.mode = "error"
    assert qs.is_paid_grounding_within_monthly_cap() is False
    assert qs.record_google_search_grounding_queries(3) == (0, 0.0)
    assert qs.reserve_google_cloud_tts_chars(500) is False
    assert qs.refund_google_cloud_tts_chars(500) == 0
    assert qs.reserve_youtube_search() is False
    qs.refund_youtube_search()
    qs.refund_daily_counters(["free_image:user:x"])
    qs.refund_user_quota(USER, client_ip="203.0.113.7", refund_pool=True, credits=1)
    assert qs.record_identity_spend_usd(USER, "203.0.113.7", 0.01) == 0
    assert qs.record_community_spend_usd(0.01) == 0.0
    with pytest.raises(qs.UsageStoreUnavailable):
        qs.reserve_free_image_generation(USER, "203.0.113.7")
    with pytest.raises(qs.UsageStoreUnavailable):
        qs.change_hosted_photo_count(USER["id"], 1)
    assert not usage_file.exists()


def test_quota_payload_degrades_to_unknown_and_basic_mode(prod_store):
    db, _ = prod_store
    db.mode = "error"
    for user, guest in ((GUEST, True), (USER, False)):
        info = qs.get_user_quota_info(user, client_ip="203.0.113.7")
        assert info["quota_unavailable"] is True
        assert info["tier"] == "free" and info["remaining_paid"] == 0
        assert info["used_today"] is None and info["community_pool"] is None
        assert info["daily_paid_limit"] == (10 if guest else 25)
        assert info.get("is_guest", False) is guest
        assert info["resets_at"]
        json.dumps(info)


def test_usage_store_unavailable_maps_to_503_with_retry_after():
    import main

    handler = main.app.exception_handlers[qs.UsageStoreUnavailable]
    resp = asyncio.run(handler(None, qs.UsageStoreUnavailable("down")))
    assert resp.status_code == 503
    assert resp.headers["retry-after"] == str(qs.QUOTA_STORE_RETRY_AFTER_SECONDS)
    assert b"briefly unavailable" in resp.body


def test_quota_endpoint_returns_degraded_payload_during_outage(prod_store):
    from fastapi.testclient import TestClient
    import main

    db, _ = prod_store
    db.mode = "error"
    main.app.dependency_overrides[main.get_current_user_optional] = lambda: USER
    try:
        res = TestClient(main.app).get("/api/user/quota")
    finally:
        main.app.dependency_overrides.pop(main.get_current_user_optional, None)
    assert res.status_code == 200
    assert res.json()["quota_unavailable"] is True


def test_breaker_skips_remote_during_cooldown_then_half_open_probe_recovers(prod_store, monkeypatch):
    db, usage_file = prod_store
    clock = {"t": 1_000_000.0}
    monkeypatch.setattr(qs.time, "time", lambda: clock["t"])
    monkeypatch.setenv("QUOTA_STORE_COOLDOWN_SECONDS", "20")

    db.mode = "error"
    with pytest.raises(qs.UsageStoreUnavailable):
        qs.record_prompt_usage(USER["id"])
    calls_after_trip = len(db.requests)
    assert calls_after_trip == 1

    # Store is healthy again, but the breaker is open: no remote calls during the cooldown.
    db.mode = "ok"
    clock["t"] += 10
    for _ in range(5):
        with pytest.raises(qs.UsageStoreUnavailable):
            qs.get_user_daily_usage(USER["id"])
    assert len(db.requests) == calls_after_trip

    # Half-open: exactly one probe may go out; concurrent callers keep failing closed meanwhile.
    clock["t"] += 11
    assert qs._remote_call_permitted() is True
    assert qs._remote_call_permitted() is False
    qs.reset_usage_store_breaker()
    db.mode = "error"
    with pytest.raises(qs.UsageStoreUnavailable):
        qs.record_prompt_usage(USER["id"])
    clock["t"] += 21
    db.mode = "ok"
    assert qs.record_prompt_usage(USER["id"]) == 1  # the probe succeeds and closes the breaker
    assert qs._breaker_open is False
    assert qs.get_user_daily_usage(USER["id"]) == 1
    assert not usage_file.exists()


def test_failed_probe_reopens_the_breaker(prod_store, monkeypatch):
    db, _ = prod_store
    clock = {"t": 2_000_000.0}
    monkeypatch.setattr(qs.time, "time", lambda: clock["t"])
    monkeypatch.setenv("QUOTA_STORE_COOLDOWN_SECONDS", "20")
    db.mode = "error"
    with pytest.raises(qs.UsageStoreUnavailable):
        qs.get_user_daily_usage(USER["id"])
    clock["t"] += 21
    with pytest.raises(qs.UsageStoreUnavailable):
        qs.get_user_daily_usage(USER["id"])  # the probe fails
    assert len(db.requests) == 2
    clock["t"] += 5
    db.mode = "ok"
    with pytest.raises(qs.UsageStoreUnavailable):
        qs.get_user_daily_usage(USER["id"])  # cooling down again
    assert len(db.requests) == 2


def test_slow_success_from_before_the_failure_does_not_close_the_breaker(prod_store, monkeypatch):
    clock = {"t": 3_000_000.0}
    monkeypatch.setattr(qs.time, "time", lambda: clock["t"])
    qs._disable_remote_temporarily("read", "test")
    qs._note_remote_success()
    assert qs._breaker_open is True


def test_dev_mode_still_falls_back_to_the_local_file(monkeypatch, tmp_path):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("QUOTA_LOCAL_FALLBACK", raising=False)
    usage_file = tmp_path / "daily_usage.json"
    monkeypatch.setattr(qs, "USAGE_FILE", usage_file)
    db = install_fake_store(monkeypatch, qs, FakeUsageDB())
    db.mode = "error"
    assert qs.record_prompt_usage("dev-user", date_str="2099-03-03") == 1
    assert qs.get_user_daily_usage("dev-user", date_str="2099-03-03") == 1
    assert usage_file.exists()
    qs.reset_usage_store_breaker()


def test_dev_without_supabase_uses_local_file(monkeypatch, tmp_path):
    usage_file = tmp_path / "daily_usage.json"
    monkeypatch.setattr(qs, "USAGE_FILE", usage_file)
    monkeypatch.setenv("APP_ENV", "production")  # no Supabase configured: the file is the store
    assert qs.record_prompt_usage("local-user", date_str="2099-03-04") == 1
    assert usage_file.exists()


def test_explicit_local_fallback_flag_in_production(prod_store, monkeypatch):
    db, usage_file = prod_store
    monkeypatch.setenv("QUOTA_LOCAL_FALLBACK", "true")
    db.mode = "error"
    assert qs.record_prompt_usage("flag-user", date_str="2099-03-05") == 1
    assert usage_file.exists()


def test_quota_local_fallback_false_forces_fail_closed_in_dev(monkeypatch, tmp_path):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setenv("QUOTA_LOCAL_FALLBACK", "false")
    usage_file = tmp_path / "daily_usage.json"
    monkeypatch.setattr(qs, "USAGE_FILE", usage_file)
    db = install_fake_store(monkeypatch, qs, FakeUsageDB())
    db.mode = "error"
    with pytest.raises(qs.UsageStoreUnavailable):
        qs.record_prompt_usage("x", date_str="2099-03-06")
    assert not usage_file.exists()
    qs.reset_usage_store_breaker()


def test_outage_log_says_fail_closed_in_production(prod_store, caplog):
    db, _ = prod_store
    db.mode = "error"
    with caplog.at_level(logging.ERROR, logger="services.quota_service"):
        with pytest.raises(qs.UsageStoreUnavailable):
            qs.get_user_daily_usage(USER["id"])
    assert "Failing closed" in caplog.text
    assert "EPHEMERAL" not in caplog.text


def test_quota_http_client_has_a_short_pool_timeout():
    assert qs._REMOTE_TIMEOUT.pool is not None and qs._REMOTE_TIMEOUT.pool <= 3.0
    assert qs._REMOTE_TIMEOUT.read == 10.0
