"""S-11: production never uses the public default salts (guest-IP hashes, photo owner folders)."""
import hashlib
import hmac
import logging

import pytest

from services import photo_store, quota_service as qs, runtime_env

SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret-part-of-the-key.signature"
SUPABASE_URL = "https://abc.supabase.co"


@pytest.fixture
def prod(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_URL)
    monkeypatch.delenv("QUOTA_IP_HASH_SALT", raising=False)
    monkeypatch.delenv("PHOTO_STORAGE_SALT", raising=False)


@pytest.fixture
def dev(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_URL)
    monkeypatch.delenv("QUOTA_IP_HASH_SALT", raising=False)
    monkeypatch.delenv("PHOTO_STORAGE_SALT", raising=False)


def _legacy_ip_hash(ip, day):
    digest = hashlib.sha256(f"{SERVICE_KEY[:16]}:{day}:{ip}".encode()).hexdigest()[:24]
    return f"guest_ip:h_{digest}"


def test_production_ip_salt_is_derived_secret_not_public_default(prod):
    salt = qs._ip_hash_salt()
    assert salt != SERVICE_KEY[:16] and salt != "eyJhbGciOiJIUzI1"
    expected = hmac.new(SERVICE_KEY.encode(), b"chronix:" + qs.IP_HASH_SALT_LABEL.encode(), hashlib.sha256).hexdigest()
    assert salt == expected
    assert qs._ip_hash_salt() == salt  # deterministic across calls / restarts
    assert SERVICE_KEY not in salt
    assert qs._hash_guest_ip("203.0.113.9", "2099-01-01") != _legacy_ip_hash("203.0.113.9", "2099-01-01")


def test_explicit_ip_salt_wins_everywhere(prod, monkeypatch):
    monkeypatch.setenv("QUOTA_IP_HASH_SALT", "explicit-random-salt")
    assert qs._ip_hash_salt() == "explicit-random-salt"


def test_development_keeps_the_legacy_ip_salt(dev):
    assert qs._ip_hash_salt() == SERVICE_KEY[:16]
    assert qs._hash_guest_ip("203.0.113.9", "2099-01-01") == _legacy_ip_hash("203.0.113.9", "2099-01-01")


def test_production_without_service_key_falls_back_to_constant(prod, monkeypatch):
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "")
    assert qs._ip_hash_salt() == "chronix-quota-v1"


def _legacy_prefix(user_id):
    return "u/" + hashlib.sha256(f"{SUPABASE_URL}:photos:{user_id}".encode()).hexdigest()[:20]


def test_production_photo_folder_is_not_derived_from_the_public_url(prod):
    prefix = photo_store.owner_prefix("user-1")
    assert prefix != _legacy_prefix("user-1")
    assert photo_store.owner_prefix("user-1") == prefix
    assert photo_store.is_valid_key(photo_store.new_key("user-1", "webp"))
    assert photo_store.owner_prefixes("user-1") == [prefix, _legacy_prefix("user-1")]


def test_development_photo_folder_is_unchanged(dev):
    assert photo_store.owner_prefix("user-1") == _legacy_prefix("user-1")
    assert _legacy_prefix("user-1") in photo_store.owner_prefixes("user-1")


def test_explicit_photo_salt_still_finds_older_folders(prod, monkeypatch):
    derived_prefix = photo_store.owner_prefix("user-1")
    monkeypatch.setenv("PHOTO_STORAGE_SALT", "explicit-photo-salt")
    explicit_prefix = photo_store.owner_prefix("user-1")
    assert explicit_prefix not in (derived_prefix, _legacy_prefix("user-1"))
    assert photo_store.owner_prefixes("user-1") == [explicit_prefix, derived_prefix, _legacy_prefix("user-1")]


def test_account_deletion_removes_photos_in_legacy_and_new_folders(prod, monkeypatch, tmp_path):
    monkeypatch.setenv("PHOTO_STORAGE_BACKEND", "local")
    monkeypatch.setattr(photo_store, "LOCAL_DIR", tmp_path / "photos")
    legacy_key = f"{_legacy_prefix('user-1')}/{'a' * 32}.webp"
    photo_store.put_photo(legacy_key, b"old")
    new_key = photo_store.new_key("user-1", "webp")
    photo_store.put_photo(new_key, b"new")
    other_key = photo_store.new_key("user-2", "webp")
    photo_store.put_photo(other_key, b"other")

    assert photo_store.get_local_photo(legacy_key) is not None  # old URLs keep serving
    assert photo_store.delete_owner_photos("user-1") == 2
    assert photo_store.get_local_photo(legacy_key) is None
    assert photo_store.get_local_photo(new_key) is None
    assert photo_store.get_local_photo(other_key) is not None


def test_startup_logs_critical_when_salts_are_unset_in_production(prod, caplog):
    with caplog.at_level(logging.CRITICAL, logger="services.runtime_env"):
        runtime_env.log_secret_salt_startup_warnings()
    assert "QUOTA_IP_HASH_SALT" in caplog.text and "PHOTO_STORAGE_SALT" in caplog.text
    assert SERVICE_KEY not in caplog.text


def test_startup_is_quiet_when_salts_are_set_or_in_dev(prod, monkeypatch, caplog):
    monkeypatch.setenv("QUOTA_IP_HASH_SALT", "a")
    monkeypatch.setenv("PHOTO_STORAGE_SALT", "b")
    with caplog.at_level(logging.CRITICAL, logger="services.runtime_env"):
        runtime_env.log_secret_salt_startup_warnings()
        monkeypatch.setenv("APP_ENV", "development")
        monkeypatch.delenv("QUOTA_IP_HASH_SALT")
        runtime_env.log_secret_salt_startup_warnings()
    assert caplog.text == ""
