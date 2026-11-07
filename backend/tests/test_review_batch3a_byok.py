"""Batch 3A - S-04: a BYOK header unlocks unlimited / x4 only after the key has served a Gemini call."""
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from google.genai import errors as genai_errors
from starlette.requests import Request

import main
from services import byok_verification, gemini_service
from services.auth_service import get_current_user_optional, get_current_user_required
from services.byok_verification import is_custom_key_verified, mark_custom_key_verified
from services.entitlements import get_entitlements
from services.upload_security import get_upload_policy

USER = {"id": "byok-user-1", "email": "byok@example.com"}


def _fake_gemini_client(api_key):
    async def generate_content(**kwargs):
        return SimpleNamespace(text="ok", usage_metadata=None)
    return SimpleNamespace(
        _api_client=SimpleNamespace(api_key=api_key),
        aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content)),
    )


def _request(peer="203.0.113.50"):
    return Request({"type": "http", "method": "POST", "path": "/", "query_string": b"", "headers": [],
                    "client": (peer, 1234)})


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "0")
    monkeypatch.delenv("BYOK_VERIFIED_TTL_SECONDS", raising=False)


# --- verification lifecycle ---------------------------------------------------------------------

@pytest.mark.asyncio
async def test_successful_gemini_call_with_the_custom_key_verifies_it():
    async def op(key):
        return await gemini_service._generate_with_retry(_fake_gemini_client(key), model="m", contents="hi")

    assert not is_custom_key_verified("MY_KEY")
    await main.run_with_key_failover(op, "MY_KEY", "custom")
    assert is_custom_key_verified("MY_KEY")


@pytest.mark.asyncio
async def test_operation_without_a_gemini_response_does_not_verify():
    async def swallowed(key):
        return {"fallback": True}  # e.g. a degraded result produced without Gemini

    async def served_by_server_key(key):
        return await gemini_service._generate_with_retry(_fake_gemini_client("SERVER_FREE_KEY"), model="m")

    await main.run_with_key_failover(swallowed, "JUNK", "custom")
    await main.run_with_key_failover(served_by_server_key, "JUNK", "custom")
    assert not is_custom_key_verified("JUNK")


@pytest.mark.asyncio
async def test_invalid_key_error_drops_the_verdict():
    mark_custom_key_verified("REVOKED")
    invalid = genai_errors.ClientError(400, {"error": {
        "code": 400, "status": "INVALID_ARGUMENT", "message": "API key not valid.",
        "details": [{"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "API_KEY_INVALID"}],
    }})

    async def op(key):
        raise invalid

    with pytest.raises(genai_errors.ClientError):
        await main.run_with_key_failover(op, "REVOKED", "custom")
    assert not is_custom_key_verified("REVOKED")


def test_verdict_is_cached_by_hash_with_ttl(monkeypatch):
    mark_custom_key_verified("  SECRET_KEY  ")
    assert is_custom_key_verified("SECRET_KEY")
    stored = list(byok_verification._VERIFIED.keys())
    assert stored == [byok_verification.key_fingerprint("SECRET_KEY")]
    assert all("SECRET_KEY" not in k for k in stored)
    real_time = time.time
    monkeypatch.setattr(byok_verification.time, "time", lambda: real_time() + 25 * 3600)
    assert not is_custom_key_verified("SECRET_KEY")


# --- what an unverified key does and doesn't unlock -----------------------------------------------

def test_junk_key_gets_normal_tier_until_verified():
    assert get_entitlements(USER, "JUNK").tier == "registered"
    assert get_entitlements({"id": "g", "is_anonymous": True}, "JUNK").tier == "guest"
    mark_custom_key_verified("JUNK")
    assert get_entitlements(USER, "JUNK").is_unlimited


def test_upload_route_uses_verified_flag_for_policy(monkeypatch):
    seen = []

    async def fake_validate(files, raw_text="", **kwargs):
        seen.append(kwargs.get("has_custom_key"))
        raise HTTPException(status_code=418, detail="stop")

    monkeypatch.setattr(main, "validate_and_read_uploads", fake_validate)
    main.timeline_rate_limiter.records.clear()
    main.file_upload_rate_limiter.records.clear()
    main.app.dependency_overrides[get_current_user_optional] = lambda: USER
    main.app.dependency_overrides[get_current_user_required] = lambda: USER
    try:
        with TestClient(main.app) as client:
            def post():
                return client.post(
                    "/api/timeline/generate-from-files/start",
                    files=[("files", ("a.txt", b"hello", "text/plain"))],
                    headers={"X-Gemini-Api-Key": "UPLOAD_KEY"},
                )
            assert post().status_code == 418
            mark_custom_key_verified("UPLOAD_KEY")
            assert post().status_code == 418
    finally:
        main.app.dependency_overrides.clear()
    assert seen == [False, True]
    assert get_upload_policy(USER, has_custom_key=False).max_pdf_pages < get_upload_policy(USER, has_custom_key=True).max_pdf_pages


# --- rate limits ------------------------------------------------------------------------------

async def _hits_allowed(limiter, key, user=USER, attempts=12):
    ok = 0
    for _ in range(attempts):
        try:
            await limiter(_request(), x_gemini_api_key=key, user=user)
            ok += 1
        except HTTPException as exc:
            assert exc.status_code == 429
    return ok


@pytest.mark.asyncio
async def test_junk_key_gets_no_x4_until_verified():
    assert await _hits_allowed(main.SimpleRateLimiter(max_requests=2, name="a"), "JUNK") == 2
    mark_custom_key_verified("JUNK")
    assert await _hits_allowed(main.SimpleRateLimiter(max_requests=2, name="b"), "JUNK") == 8


@pytest.mark.asyncio
async def test_unverified_key_keeps_guest_limit():
    guest = {"id": "g-1", "is_anonymous": True}
    limiter = main.SimpleRateLimiter(max_requests=4, guest_max_requests=1, name="c")
    assert await _hits_allowed(limiter, "JUNK", user=guest) == 1


@pytest.mark.asyncio
async def test_third_party_limiters_never_get_x4():
    mark_custom_key_verified("GOOD")
    assert await _hits_allowed(main.SimpleRateLimiter(max_requests=2, name="d", byok_multiplier=False), "GOOD") == 2
    for limiter in (
        main.reverse_geocode_rate_limiter, main.google_photos_rate_limiter, main.google_photos_media_rate_limiter,
        main.media_search_rate_limiter, main.wiki_lookup_rate_limiter, main.geocode_rate_limiter,
        main.free_image_rate_limiter,
    ):
        assert limiter.byok_multiplier is False, limiter.name
        assert limiter.effective_limit_for_user(USER, has_custom_key=True) == limiter.effective_max_requests
    assert main.timeline_rate_limiter.byok_multiplier is True
    assert main.photo_draft_rate_limiter.byok_multiplier is True
