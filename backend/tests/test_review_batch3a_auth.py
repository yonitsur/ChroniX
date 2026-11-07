"""Batch 3A - SC-01 / S-10: local Supabase JWT verification and the hardened GoTrue fallback."""
import asyncio
import base64
import hashlib
import hmac
import json
import time

import httpx
import pytest
from fastapi import HTTPException

from services import auth_service

SECRET = "test-jwt-secret-for-chronix"
PROJECT_URL = "https://proj.supabase.co"
ISSUER = f"{PROJECT_URL}/auth/v1"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _claims(**overrides):
    now = int(time.time())
    claims = {
        "sub": "user-123",
        "aud": "authenticated",
        "role": "authenticated",
        "iss": ISSUER,
        "exp": now + 3600,
        "iat": now,
        "email": "someone@example.com",
        "is_anonymous": False,
        "app_metadata": {"provider": "email"},
        "user_metadata": {"full_name": "Some One"},
        "session_id": "sess-1",
    }
    claims.update(overrides)
    return claims


def make_hs256(claims, secret=SECRET, header=None):
    head = _b64(json.dumps(header or {"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64(json.dumps(claims).encode())
    sig = hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
    return f"{head}.{body}.{_b64(sig)}"


class FakeAuthClient:
    """Stands in for httpx.AsyncClient; `handler(method, url, headers)` returns an httpx.Response."""
    handler = None
    calls = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def _call(self, method, url, headers=None, **kwargs):
        FakeAuthClient.calls.append((method, url))
        result = FakeAuthClient.handler(method, url, headers or {})
        if asyncio.iscoroutine(result):
            result = await result
        return result

    async def get(self, url, headers=None, params=None):
        return await self._call("GET", url, headers)

    async def delete(self, url, headers=None):
        return await self._call("DELETE", url, headers)

    async def post(self, url, headers=None, params=None, json=None):
        return await self._call("POST", url, headers)


def _no_network(method, url, headers):
    raise AssertionError(f"unexpected network call: {method} {url}")


@pytest.fixture
def auth_env(monkeypatch):
    monkeypatch.setattr(auth_service, "SUPABASE_URL", PROJECT_URL)
    monkeypatch.setattr(auth_service, "SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setattr(auth_service, "SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    for var in ("SUPABASE_JWT_LOCAL_VERIFY", "SUPABASE_JWT_AUDIENCE", "SUPABASE_JWT_ISSUER",
                "AUTH_TOKEN_CACHE_MAX_ENTRIES", "SUPABASE_JWKS_URL"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("ADMIN_EMAILS", "boss@example.com")
    FakeAuthClient.calls = []
    FakeAuthClient.handler = _no_network
    monkeypatch.setattr(httpx, "AsyncClient", FakeAuthClient)
    return FakeAuthClient


# --- Local HS256 verification -------------------------------------------------------------------

@pytest.mark.asyncio
async def test_valid_hs256_token_verifies_locally_without_network(auth_env):
    user = await auth_service.verify_supabase_token(make_hs256(_claims()))
    assert auth_env.calls == []
    assert user["id"] == "user-123"
    assert user["email"] == "someone@example.com"
    assert user["is_anonymous"] is False
    assert user["app_metadata"] == {"provider": "email"}
    assert user["user_metadata"] == {"full_name": "Some One"}
    assert user["role"] == "authenticated" and user["aud"] == "authenticated"
    assert user["is_admin"] is False
    assert "email_confirmed_at" in user and "confirmed_at" in user


@pytest.mark.asyncio
async def test_anonymous_claims_map_to_guest(auth_env):
    user = await auth_service.verify_supabase_token(make_hs256(_claims(sub="anon-9", email="", is_anonymous=True)))
    assert user["id"] == "anon-9"
    assert user["is_anonymous"] is True
    assert auth_service.is_guest_user(user) is True


@pytest.mark.asyncio
@pytest.mark.parametrize("token_factory", [
    lambda: make_hs256(_claims(exp=int(time.time()) - 600)),            # expired
    lambda: make_hs256(_claims(aud="other-audience")),                   # wrong aud
    lambda: make_hs256(_claims(role="service_role")),                    # role not allowed
    lambda: make_hs256(_claims(sub="")),                                 # no subject
    lambda: make_hs256({k: v for k, v in _claims().items() if k != "exp"}),  # no exp
    lambda: "not-a-jwt",
])
async def test_invalid_tokens_rejected_locally(auth_env, token_factory):
    assert await auth_service.verify_supabase_token(token_factory()) is None
    assert auth_env.calls == []


@pytest.mark.asyncio
async def test_alg_none_rejected_without_network(auth_env):
    head = _b64(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    body = _b64(json.dumps(_claims()).encode())
    assert await auth_service.verify_supabase_token(f"{head}.{body}.") is None
    head_upper = _b64(json.dumps({"alg": "NONE"}).encode())
    assert await auth_service.verify_supabase_token(f"{head_upper}.{body}.") is None
    assert auth_env.calls == []


@pytest.mark.asyncio
async def test_bad_signature_rejected(auth_env):
    auth_env.handler = lambda m, u, h: httpx.Response(401, json={"msg": "invalid JWT"})
    forged = make_hs256(_claims(), secret="attacker-secret")
    assert await auth_service.verify_supabase_token(forged) is None
    assert auth_service._LOCAL_HS256_DISABLED is False


@pytest.mark.asyncio
async def test_wrong_configured_secret_self_heals_via_gotrue(auth_env, monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "a-wrong-secret")
    auth_env.handler = lambda m, u, h: httpx.Response(200, json={"id": "user-123", "email": "someone@example.com"})
    user = await auth_service.verify_supabase_token(make_hs256(_claims()))
    assert user["id"] == "user-123"
    assert auth_service._LOCAL_HS256_DISABLED is True


@pytest.mark.asyncio
async def test_issuer_mismatch_falls_back_to_gotrue(auth_env):
    auth_env.handler = lambda m, u, h: httpx.Response(200, json={"id": "user-123"})
    user = await auth_service.verify_supabase_token(make_hs256(_claims(iss="https://elsewhere/auth/v1")))
    assert user["id"] == "user-123"
    assert [c[1] for c in auth_env.calls] == [f"{PROJECT_URL}/auth/v1/user"]


# --- Admin safety ---------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_admin_email_requires_gotrue_confirmation(auth_env):
    confirmed = {"value": None}
    auth_env.handler = lambda m, u, h: httpx.Response(
        200, json={"id": "boss-1", "email": "boss@example.com", "email_confirmed_at": confirmed["value"]}
    )
    token = make_hs256(_claims(sub="boss-1", email="boss@example.com"))
    user = await auth_service.verify_supabase_token(token)
    assert user["is_admin"] is False and auth_service.is_admin_user(user) is False
    # The confirmation verdict is cached per user (<= 5 min): no second lookup.
    await auth_service.verify_supabase_token(token)
    assert len(auth_env.calls) == 1

    auth_service.reset_auth_caches_for_tests()
    confirmed["value"] = "2026-01-01T00:00:00Z"
    user = await auth_service.verify_supabase_token(token)
    assert user["is_admin"] is True and auth_service.is_admin_user(user) is True


@pytest.mark.asyncio
async def test_admin_email_not_granted_when_gotrue_unreachable(auth_env):
    def boom(m, u, h):
        raise httpx.ConnectError("down")
    auth_env.handler = boom
    user = await auth_service.verify_supabase_token(make_hs256(_claims(sub="boss-1", email="boss@example.com")))
    assert user["id"] == "boss-1" and user["is_admin"] is False


@pytest.mark.asyncio
async def test_signed_app_metadata_admin_role_is_authoritative(auth_env):
    user = await auth_service.verify_supabase_token(
        make_hs256(_claims(sub="staff-1", email="staff@example.com", app_metadata={"role": "admin"}))
    )
    assert user["is_admin"] is True
    assert auth_env.calls == []


# --- GoTrue fallback: LRU, single-flight, TTL, 503 ---------------------------------------------------

@pytest.fixture
def gotrue_only(auth_env, monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    return auth_env


@pytest.mark.asyncio
async def test_gotrue_fallback_single_flight(gotrue_only):
    async def slow_ok(m, u, h):
        await asyncio.sleep(0.05)
        return httpx.Response(200, json={"id": "user-123", "email": "someone@example.com"})
    gotrue_only.handler = slow_ok
    token = make_hs256(_claims())
    users = await asyncio.gather(*[auth_service.verify_supabase_token(token) for _ in range(10)])
    assert all(u["id"] == "user-123" for u in users)
    assert len(gotrue_only.calls) == 1
    # Cache keyed by sha256(token), never the raw token.
    assert token not in auth_service._TOKEN_CACHE
    assert hashlib.sha256(token.encode()).hexdigest() in auth_service._TOKEN_CACHE
    await auth_service.verify_supabase_token(token)
    assert len(gotrue_only.calls) == 1


@pytest.mark.asyncio
async def test_gotrue_cache_is_lru(gotrue_only, monkeypatch):
    monkeypatch.setenv("AUTH_TOKEN_CACHE_MAX_ENTRIES", "16")
    gotrue_only.handler = lambda m, u, h: httpx.Response(200, json={"id": "user-x"})
    tokens = [make_hs256(_claims(sub=f"user-{i}", session_id=f"s{i}")) for i in range(17)]
    for tok in tokens[:16]:
        await auth_service.verify_supabase_token(tok)
    await auth_service.verify_supabase_token(tokens[0])  # hit -> most recently used
    assert len(gotrue_only.calls) == 16
    await auth_service.verify_supabase_token(tokens[16])  # evicts the LRU entry (tokens[1])
    await auth_service.verify_supabase_token(tokens[0])
    assert len(gotrue_only.calls) == 17
    await auth_service.verify_supabase_token(tokens[1])
    assert len(gotrue_only.calls) == 18


@pytest.mark.asyncio
async def test_gotrue_cache_ttl_capped_at_token_exp(gotrue_only):
    gotrue_only.handler = lambda m, u, h: httpx.Response(200, json={"id": "user-123"})
    exp = int(time.time()) + 60
    token = make_hs256(_claims(exp=exp))
    await auth_service.verify_supabase_token(token)
    _, expires_at = auth_service._TOKEN_CACHE[hashlib.sha256(token.encode()).hexdigest()]
    assert expires_at <= exp


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["transport", "timeout", "5xx"])
async def test_gotrue_unavailable_is_503_not_401(gotrue_only, failure):
    def handler(m, u, h):
        if failure == "transport":
            raise httpx.ConnectError("refused")
        if failure == "timeout":
            raise httpx.PoolTimeout("pool exhausted")
        return httpx.Response(502, text="bad gateway")
    gotrue_only.handler = handler
    token = make_hs256(_claims())
    with pytest.raises(auth_service.AuthServiceUnavailableError):
        await auth_service.verify_supabase_token(token)
    for dep in (auth_service.get_current_user_optional, auth_service.get_current_user_required):
        with pytest.raises(HTTPException) as exc:
            await dep(f"Bearer {token}")
        assert exc.value.status_code == 503
        assert exc.value.headers.get("Retry-After")


@pytest.mark.asyncio
async def test_gotrue_definitive_401_is_invalid(gotrue_only):
    gotrue_only.handler = lambda m, u, h: httpx.Response(401, json={})
    with pytest.raises(HTTPException) as exc:
        await auth_service.get_current_user_required(f"Bearer {make_hs256(_claims())}")
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_local_verify_can_be_disabled(auth_env, monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_LOCAL_VERIFY", "false")
    auth_env.handler = lambda m, u, h: httpx.Response(200, json={"id": "user-123"})
    await auth_service.verify_supabase_token(make_hs256(_claims()))
    assert len(auth_env.calls) == 1


# --- Account deletion, guest claim --------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_user_purges_cache_and_rejects_local_tokens(auth_env, monkeypatch):
    local_token = make_hs256(_claims(sub="doomed"))
    assert (await auth_service.verify_supabase_token(local_token))["id"] == "doomed"

    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    auth_env.handler = lambda m, u, h: httpx.Response(200, json={"id": "doomed"})
    cached_token = make_hs256(_claims(sub="doomed", session_id="other"))
    await auth_service.verify_supabase_token(cached_token)
    assert any(u["id"] == "doomed" for u, _ in auth_service._TOKEN_CACHE.values())

    auth_env.handler = lambda m, u, h: httpx.Response(204)
    assert await auth_service.delete_supabase_user("doomed") is True
    assert not any(u["id"] == "doomed" for u, _ in auth_service._TOKEN_CACHE.values())

    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    assert await auth_service.verify_supabase_token(local_token) is None


@pytest.mark.asyncio
async def test_claim_guest_resolver_proves_anonymous_session_locally(auth_env):
    guest_token = make_hs256(_claims(sub="anon-7", email="", is_anonymous=True))
    guest = await auth_service.resolve_guest_session_user(guest_token)
    assert guest["id"] == "anon-7" and guest["is_anonymous"] is True
    assert await auth_service.resolve_guest_session_user(make_hs256(_claims())) is None
    assert auth_env.calls == []


@pytest.mark.asyncio
async def test_claim_guest_resolver_503_when_auth_down(auth_env):
    def boom(m, u, h):
        raise httpx.ConnectError("down")
    auth_env.handler = boom
    expired = make_hs256(_claims(sub="anon-7", is_anonymous=True, exp=int(time.time()) - 600))
    with pytest.raises(HTTPException) as exc:
        await auth_service.resolve_guest_session_user(expired, "refresh-token")
    assert exc.value.status_code == 503


# --- JWKS (asymmetric signing keys) -----------------------------------------------------------------

def _ec_key_and_jwk(kid):
    from cryptography.hazmat.primitives.asymmetric import ec
    priv = ec.generate_private_key(ec.SECP256R1())
    nums = priv.public_key().public_numbers()
    jwk = {
        "kty": "EC", "crv": "P-256", "kid": kid, "use": "sig", "alg": "ES256",
        "x": _b64(nums.x.to_bytes(32, "big")), "y": _b64(nums.y.to_bytes(32, "big")),
    }
    return priv, jwk


def make_es256(claims, priv, kid):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec, utils
    head = _b64(json.dumps({"alg": "ES256", "typ": "JWT", "kid": kid}).encode())
    body = _b64(json.dumps(claims).encode())
    der = priv.sign(f"{head}.{body}".encode(), ec.ECDSA(hashes.SHA256()))
    r, s = utils.decode_dss_signature(der)
    return f"{head}.{body}.{_b64(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"


@pytest.mark.asyncio
async def test_jwks_es256_verification_and_kid_rotation(auth_env):
    priv1, jwk1 = _ec_key_and_jwk("kid-1")
    priv2, jwk2 = _ec_key_and_jwk("kid-2")
    served = {"keys": [jwk1]}

    def handler(m, u, h):
        assert u == f"{PROJECT_URL}/auth/v1/.well-known/jwks.json"
        return httpx.Response(200, json=served)
    auth_env.handler = handler

    user = await auth_service.verify_supabase_token(make_es256(_claims(), priv1, "kid-1"))
    assert user["id"] == "user-123"
    await auth_service.verify_supabase_token(make_es256(_claims(sub="u2"), priv1, "kid-1"))
    assert len(auth_env.calls) == 1  # JWKS cached

    # Key rotation: an unknown kid triggers one refetch.
    served["keys"] = [jwk1, jwk2]
    auth_service._JWKS_LAST_ATTEMPT = 0.0
    user2 = await auth_service.verify_supabase_token(make_es256(_claims(sub="u3"), priv2, "kid-2"))
    assert user2["id"] == "u3"
    assert len(auth_env.calls) == 2

    # Signed by the wrong key for that kid -> rejected.
    assert await auth_service.verify_supabase_token(make_es256(_claims(), priv2, "kid-1")) is None
