import asyncio
import base64
import binascii
import contextlib
import hashlib
import hmac
import json
import os
import time
import logging
from collections import OrderedDict
from typing import Optional, Dict, Any, Tuple
import httpx
from fastapi import Header, HTTPException, Depends

logger = logging.getLogger("ChroniXAuth")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Access tokens are verified LOCALLY (HS256 project secret and/or the project's JWKS) whenever
# possible, so steady-state auth makes no network call (SC-01). GoTrue `/auth/v1/user` is the
# fallback for tokens we can't check locally, behind the LRU + single-flight cache below.

# --- GoTrue fallback cache -------------------------------------------------------------------
# sha256(token) -> (user_dict, expire_timestamp). A real LRU so active users don't evict each other.
_TOKEN_CACHE: "OrderedDict[str, Tuple[Dict[str, Any], float]]" = OrderedDict()
CACHE_TTL = 300  # 5 minutes, and never past the token's own `exp` (S-10)
_DEFAULT_TOKEN_CACHE_ENTRIES = 20_000
# Short-lived negative cache for invalid bearer tokens (token_sha256 -> expire_timestamp)
_NEGATIVE_TOKEN_CACHE: "OrderedDict[str, float]" = OrderedDict()
NEGATIVE_CACHE_TTL = 30  # 30 seconds
_MAX_NEGATIVE_CACHE_ENTRIES = 4096
# Single-flight: concurrent requests carrying the same token share one GoTrue call.
_INFLIGHT: Dict[str, "asyncio.Task"] = {}

# ADMIN_EMAILS needs a confirmed email, which the JWT does not carry: one GoTrue lookup per user,
# cached briefly. sub -> (confirmed_at or None, expires_at)
_ADMIN_CONFIRM_CACHE: "OrderedDict[str, Tuple[Optional[str], float]]" = OrderedDict()
ADMIN_CONFIRM_TTL = 300
_MAX_ADMIN_CONFIRM_ENTRIES = 256

# Accounts deleted through this process. Local verification would otherwise keep accepting their
# unexpired access tokens. sub -> deleted_at; kept longer than any access-token lifetime.
_REVOKED_SUBS: "OrderedDict[str, float]" = OrderedDict()
_REVOKED_SUB_TTL = 24 * 3600
_MAX_REVOKED_SUBS = 10_000

# JWKS (asymmetric Supabase signing keys): kid -> (alg, public_key). Refreshed on TTL or unknown kid.
_JWKS_KEYS: Dict[str, Tuple[str, Any]] = {}
_JWKS_FETCHED_AT = 0.0
_JWKS_LAST_ATTEMPT = 0.0
_JWKS_MIN_REFRESH_INTERVAL = 30.0
_JWKS_INFLIGHT: Optional["asyncio.Task"] = None
# Set when GoTrue accepts a token that failed our HS256 check, i.e. the configured secret is wrong.
_LOCAL_HS256_DISABLED = False

_AUTH_HTTP_TIMEOUT = httpx.Timeout(8.0, connect=3.0, pool=3.0)
AUTH_UNAVAILABLE_RETRY_AFTER = "3"
_ALLOWED_TOKEN_ROLES = ("authenticated", "anon")

_ORIG_ASYNC_CLIENT = httpx.AsyncClient
_SHARED_HTTP_CLIENT: Optional[httpx.AsyncClient] = None
_SHARED_HTTP_CLIENT_LOOP = None


class AuthServiceUnavailableError(Exception):
    """Supabase Auth could not be reached (transport error, timeout, 429/5xx): no verdict on the token."""


class _InvalidToken(Exception):
    """Definitive local rejection."""


class _BadHs256Signature(_InvalidToken):
    """HS256 signature mismatch: either a forged token or a wrong SUPABASE_JWT_SECRET."""


class _Unverifiable(Exception):
    """The token can't be checked locally (no secret / unsupported alg / unknown key): ask GoTrue."""


@contextlib.asynccontextmanager
async def _auth_http_client():
    global _SHARED_HTTP_CLIENT, _SHARED_HTTP_CLIENT_LOOP
    if httpx.AsyncClient is not _ORIG_ASYNC_CLIENT:
        client_cls = httpx.AsyncClient
        async with client_cls(timeout=10.0) as client:
            yield client
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if (
        _SHARED_HTTP_CLIENT is None
        or _SHARED_HTTP_CLIENT.is_closed
        or _SHARED_HTTP_CLIENT_LOOP is not loop
    ):
        prev_client = _SHARED_HTTP_CLIENT
        prev_loop = _SHARED_HTTP_CLIENT_LOOP
        _SHARED_HTTP_CLIENT = _ORIG_ASYNC_CLIENT(
            timeout=_AUTH_HTTP_TIMEOUT,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
        _SHARED_HTTP_CLIENT_LOOP = loop
        if prev_client is not None and not prev_client.is_closed and prev_loop is loop:
            try:
                await prev_client.aclose()
            except Exception:
                pass
    yield _SHARED_HTTP_CLIENT

def get_admin_emails() -> set[str]:
    raw = os.getenv("ADMIN_EMAILS", "")
    return {email.strip().lower() for email in raw.split(",") if email.strip()}

def is_admin_user(user_data: Optional[Dict[str, Any]]) -> bool:
    """
    Determines admin status strictly from server-controlled / verified attributes.
    NEVER trusts client-writable `user_metadata` or anonymous guest sessions.
    """
    if not user_data or not isinstance(user_data, dict):
        return False
    if bool(user_data.get("is_anonymous", False)):
        return False

    app_meta = user_data.get("app_metadata")
    if isinstance(app_meta, dict):
        role = str(app_meta.get("role") or "").strip().lower()
        if role == "admin" or app_meta.get("is_admin") is True:
            return True

    admin_emails = get_admin_emails()
    email = (user_data.get("email") or "").strip().lower()
    if not email or email not in admin_emails:
        return False

    # Require email confirmation when Supabase Auth includes confirmation metadata.
    # GoTrue `/auth/v1/user` always includes `email_confirmed_at` (or `confirmed_at`), and users
    # built from JWT claims carry both keys as None until GoTrue confirms them.
    if "email_confirmed_at" in user_data or "confirmed_at" in user_data:
        confirmed = user_data.get("email_confirmed_at") or user_data.get("confirmed_at")
        if not confirmed:
            return False

    return True

def is_guest_user(user_data: Optional[Dict[str, Any]]) -> bool:
    """True for anonymous/guest Supabase sessions (signInAnonymously) or unauthenticated visitors."""
    if not user_data or not isinstance(user_data, dict):
        return True
    return bool(user_data.get("is_anonymous", False))

def _token_fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8", errors="ignore")).hexdigest()


# --- Config -----------------------------------------------------------------------------------

def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _local_verify_enabled() -> bool:
    return _env_flag("SUPABASE_JWT_LOCAL_VERIFY", True)


def _jwt_secret() -> str:
    return os.getenv("SUPABASE_JWT_SECRET", "").strip()


def _expected_audiences() -> set:
    raw = os.getenv("SUPABASE_JWT_AUDIENCE", "").strip() or "authenticated"
    return {a.strip() for a in raw.split(",") if a.strip()}


def _allowed_issuers() -> set:
    raw = os.getenv("SUPABASE_JWT_ISSUER", "").strip()
    if raw:
        return {i.strip().rstrip("/") for i in raw.split(",") if i.strip()}
    return {f"{SUPABASE_URL}/auth/v1"} if SUPABASE_URL else set()


def _jwt_leeway() -> int:
    return max(0, _env_int("AUTH_JWT_LEEWAY_SECONDS", 30))


def _token_cache_max_entries() -> int:
    return max(16, _env_int("AUTH_TOKEN_CACHE_MAX_ENTRIES", _DEFAULT_TOKEN_CACHE_ENTRIES))


def _jwks_url() -> str:
    explicit = os.getenv("SUPABASE_JWKS_URL", "").strip()
    if explicit:
        return explicit
    return f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else ""


def _jwks_ttl() -> int:
    return max(60, _env_int("SUPABASE_JWKS_CACHE_SECONDS", 600))


# --- JWT parsing / local verification ---------------------------------------------------------

def _b64url_decode(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def _split_jwt(token: str) -> Optional[Tuple[Dict[str, Any], Dict[str, Any], bytes, bytes]]:
    """(header, claims, signing_input, signature) WITHOUT verifying anything, or None if malformed."""
    parts = token.split(".")
    if len(parts) != 3 or not all(parts[:2]):
        return None
    try:
        header = json.loads(_b64url_decode(parts[0]))
        claims = json.loads(_b64url_decode(parts[1]))
        signature = _b64url_decode(parts[2])
    except (ValueError, binascii.Error, UnicodeDecodeError):
        return None
    if not isinstance(header, dict) or not isinstance(claims, dict):
        return None
    return header, claims, f"{parts[0]}.{parts[1]}".encode("ascii", errors="ignore"), signature


def _unverified_exp(token: str) -> Optional[float]:
    """The token's `exp`, decoded WITHOUT signature verification: only ever used to cap cache TTLs."""
    parsed = _split_jwt(token)
    if not parsed:
        return None
    exp = parsed[1].get("exp")
    if isinstance(exp, (int, float)) and not isinstance(exp, bool):
        return float(exp)
    return None


def authorization_header_plausible(authorization: Optional[str]) -> bool:
    """
    Cheap pre-check (no signature verification, no network) used before a large upload body is
    parsed (SC-06): a `Bearer <JWT>` header whose `exp` has not passed. The route dependency still
    verifies the token fully; this only stops anonymous floods from costing a multipart parse.
    """
    if not authorization:
        return False
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer" or len(parts[1]) > 8192:
        return False
    parsed = _split_jwt(parts[1])
    if not parsed:
        return False
    exp = parsed[1].get("exp")
    if isinstance(exp, (int, float)) and not isinstance(exp, bool):
        return float(exp) + _jwt_leeway() >= time.time()
    return True


def _crypto_modules():
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa, utils
    except ImportError:  # pragma: no cover - cryptography ships with google-auth
        return None
    return InvalidSignature, hashes, ec, padding, rsa, utils


def _public_key_from_jwk(jwk: Dict[str, Any]) -> Optional[Tuple[str, Any]]:
    mods = _crypto_modules()
    if not mods or not isinstance(jwk, dict):
        return None
    _, _, ec, _, rsa, _ = mods
    if jwk.get("use") not in (None, "sig"):
        return None
    try:
        if jwk.get("kty") == "EC" and jwk.get("crv") == "P-256":
            x = int.from_bytes(_b64url_decode(jwk["x"]), "big")
            y = int.from_bytes(_b64url_decode(jwk["y"]), "big")
            return "ES256", ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1()).public_key()
        if jwk.get("kty") == "RSA":
            n = int.from_bytes(_b64url_decode(jwk["n"]), "big")
            e = int.from_bytes(_b64url_decode(jwk["e"]), "big")
            return "RS256", rsa.RSAPublicNumbers(e, n).public_key()
    except (KeyError, ValueError, TypeError, binascii.Error):
        return None
    return None


async def _refresh_jwks() -> None:
    global _JWKS_KEYS, _JWKS_FETCHED_AT, _JWKS_LAST_ATTEMPT
    _JWKS_LAST_ATTEMPT = time.time()
    url = _jwks_url()
    if not url:
        return
    headers = {"apikey": SUPABASE_ANON_KEY} if SUPABASE_ANON_KEY else {}
    try:
        async with _auth_http_client() as client:
            resp = await client.get(url, headers=headers)
        if resp.status_code != 200:
            logger.warning(f"Supabase JWKS fetch returned HTTP {resp.status_code}")
            return
        keys: Dict[str, Tuple[str, Any]] = {}
        for jwk in (resp.json() or {}).get("keys") or []:
            parsed = _public_key_from_jwk(jwk)
            kid = jwk.get("kid") if isinstance(jwk, dict) else None
            if parsed and isinstance(kid, str) and kid:
                keys[kid] = parsed
        _JWKS_KEYS = keys
        _JWKS_FETCHED_AT = time.time()
    except Exception as e:
        logger.warning(f"Supabase JWKS fetch failed ({type(e).__name__})")


async def _refresh_jwks_single_flight() -> None:
    global _JWKS_INFLIGHT
    loop = asyncio.get_running_loop()
    task = _JWKS_INFLIGHT
    if task is None or task.done() or task.get_loop() is not loop:
        task = loop.create_task(_refresh_jwks())
        _JWKS_INFLIGHT = task
    await asyncio.shield(task)


async def _jwks_key(kid: Optional[str]) -> Optional[Tuple[str, Any]]:
    now = time.time()
    fresh = bool(_JWKS_KEYS) and (now - _JWKS_FETCHED_AT) < _jwks_ttl()
    known = _JWKS_KEYS.get(kid) if kid else None
    if known and fresh:
        return known
    # Stale cache, or a kid we haven't seen (key rotation): refetch, but never more than every 30 s.
    needs_refresh = not fresh or (kid is not None and known is None)
    if needs_refresh and (now - _JWKS_LAST_ATTEMPT) >= _JWKS_MIN_REFRESH_INTERVAL:
        await _refresh_jwks_single_flight()
    if kid:
        return _JWKS_KEYS.get(kid)
    return None


def _verify_asymmetric(alg: str, key: Any, signing_input: bytes, signature: bytes) -> bool:
    mods = _crypto_modules()
    if not mods:
        return False
    InvalidSignature, hashes, ec, padding, _, utils = mods
    try:
        if alg == "ES256":
            if len(signature) != 64:
                return False
            r = int.from_bytes(signature[:32], "big")
            s = int.from_bytes(signature[32:], "big")
            key.verify(utils.encode_dss_signature(r, s), signing_input, ec.ECDSA(hashes.SHA256()))
            return True
        if alg == "RS256":
            key.verify(signature, signing_input, padding.PKCS1v15(), hashes.SHA256())
            return True
    except (InvalidSignature, ValueError, TypeError):
        return False
    return False


def _validate_claims(claims: Dict[str, Any]) -> None:
    now = time.time()
    leeway = _jwt_leeway()
    exp = claims.get("exp")
    if not isinstance(exp, (int, float)) or isinstance(exp, bool) or now > float(exp) + leeway:
        raise _InvalidToken("expired")
    nbf = claims.get("nbf")
    if isinstance(nbf, (int, float)) and not isinstance(nbf, bool) and now + leeway < float(nbf):
        raise _InvalidToken("not yet valid")
    aud = claims.get("aud")
    auds = {aud} if isinstance(aud, str) else {a for a in aud if isinstance(a, str)} if isinstance(aud, list) else set()
    if not auds & _expected_audiences():
        raise _InvalidToken("audience")
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub.strip():
        raise _InvalidToken("subject")
    if claims.get("role") not in _ALLOWED_TOKEN_ROLES:
        raise _InvalidToken("role")
    iss = claims.get("iss")
    issuers = _allowed_issuers()
    if iss is not None and issuers and str(iss).rstrip("/") not in issuers:
        # Signed by our own key, so most likely a URL mismatch (custom domain): let GoTrue decide
        # rather than locking everyone out. Set SUPABASE_JWT_ISSUER to fix the config.
        logger.warning("JWT issuer does not match SUPABASE_URL; falling back to Supabase Auth (set SUPABASE_JWT_ISSUER)")
        raise _Unverifiable("issuer")


async def _verify_locally(token: str) -> Dict[str, Any]:
    """Verified claims, or raises _InvalidToken (reject) / _Unverifiable (ask GoTrue)."""
    parsed = _split_jwt(token)
    if not parsed:
        raise _InvalidToken("malformed")
    header, claims, signing_input, signature = parsed
    alg = header.get("alg")
    if not isinstance(alg, str) or not alg or alg.strip().lower() == "none":
        raise _InvalidToken("alg")
    if alg == "HS256":
        secret = _jwt_secret()
        if not secret or _LOCAL_HS256_DISABLED:
            raise _Unverifiable("no secret")
        expected = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
        if not hmac.compare_digest(expected, signature):
            raise _BadHs256Signature("signature")
    elif alg in ("ES256", "RS256"):
        if not _crypto_modules() or not _jwks_url():
            raise _Unverifiable("no jwks")
        kid = header.get("kid") if isinstance(header.get("kid"), str) else None
        entry = await _jwks_key(kid)
        if not entry:
            raise _Unverifiable("unknown kid")
        key_alg, key = entry
        if key_alg != alg:
            raise _InvalidToken("alg/key mismatch")
        if not _verify_asymmetric(alg, key, signing_input, signature):
            raise _InvalidToken("signature")
    else:
        raise _Unverifiable("unsupported alg")
    _validate_claims(claims)
    return claims


def _user_from_claims(claims: Dict[str, Any]) -> Dict[str, Any]:
    """User dict shaped like GoTrue's `/auth/v1/user` for every field the app reads."""
    aud = claims.get("aud")
    app_meta = claims.get("app_metadata")
    user_meta = claims.get("user_metadata")
    return {
        "id": claims["sub"],
        "aud": aud if isinstance(aud, str) else (aud[0] if isinstance(aud, list) and aud else None),
        "role": claims.get("role"),
        "email": claims.get("email") or "",
        "phone": claims.get("phone") or "",
        "is_anonymous": bool(claims.get("is_anonymous", False)),
        "app_metadata": app_meta if isinstance(app_meta, dict) else {},
        "user_metadata": user_meta if isinstance(user_meta, dict) else {},
        "session_id": claims.get("session_id"),
        # Not in the JWT. Present-but-None keeps is_admin_user's ADMIN_EMAILS path closed until
        # GoTrue confirms the email (see _apply_admin_status).
        "email_confirmed_at": None,
        "confirmed_at": None,
        "auth_source": "jwt",
    }


def _is_revoked(sub: str) -> bool:
    revoked_at = _REVOKED_SUBS.get(sub)
    if revoked_at is None:
        return False
    if time.time() - revoked_at > _REVOKED_SUB_TTL:
        _REVOKED_SUBS.pop(sub, None)
        return False
    return True


async def _admin_email_confirmed_at(user: Dict[str, Any], token: str) -> Optional[str]:
    """email_confirmed_at from GoTrue for an ADMIN_EMAILS match, cached per user for <= 5 minutes."""
    sub = str(user.get("id") or "")
    now = time.time()
    hit = _ADMIN_CONFIRM_CACHE.get(sub)
    if hit and now < hit[1]:
        return hit[0]
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None
    try:
        full = await _gotrue_user_single_flight(token, _token_fingerprint(token))
    except AuthServiceUnavailableError:
        return None  # fail closed for privilege, but don't cache the outage
    confirmed: Optional[str] = None
    if (
        isinstance(full, dict)
        and str(full.get("id") or "") == sub
        and (full.get("email") or "").strip().lower() == (user.get("email") or "").strip().lower()
    ):
        confirmed = full.get("email_confirmed_at") or full.get("confirmed_at") or None
    _ADMIN_CONFIRM_CACHE[sub] = (confirmed, now + ADMIN_CONFIRM_TTL)
    _ADMIN_CONFIRM_CACHE.move_to_end(sub)
    while len(_ADMIN_CONFIRM_CACHE) > _MAX_ADMIN_CONFIRM_ENTRIES:
        _ADMIN_CONFIRM_CACHE.popitem(last=False)
    return confirmed


async def _apply_admin_status(user: Dict[str, Any], token: str) -> Dict[str, Any]:
    """
    Admin from signed `app_metadata.role` is authoritative (only the service role can write it).
    ADMIN_EMAILS additionally needs a confirmed email, which only GoTrue knows.
    """
    if not is_admin_user(user) and not user.get("is_anonymous"):
        email = (user.get("email") or "").strip().lower()
        if email and email in get_admin_emails():
            confirmed = await _admin_email_confirmed_at(user, token)
            if confirmed:
                user["email_confirmed_at"] = confirmed
                user["confirmed_at"] = confirmed
    user["is_admin"] = is_admin_user(user)
    return user


# --- GoTrue fallback (LRU + single-flight) ----------------------------------------------------

def _cache_positive(fp: str, user_data: Dict[str, Any], token: str) -> None:
    now = time.time()
    expires_at = now + CACHE_TTL
    exp = _unverified_exp(token)
    if exp is not None:
        expires_at = min(expires_at, exp)
    if expires_at <= now:
        return
    _TOKEN_CACHE[fp] = (user_data, expires_at)
    _TOKEN_CACHE.move_to_end(fp)
    limit = _token_cache_max_entries()
    while len(_TOKEN_CACHE) > limit:
        _TOKEN_CACHE.popitem(last=False)


def _cache_negative(fp: str) -> None:
    _NEGATIVE_TOKEN_CACHE[fp] = time.time() + NEGATIVE_CACHE_TTL
    _NEGATIVE_TOKEN_CACHE.move_to_end(fp)
    while len(_NEGATIVE_TOKEN_CACHE) > _MAX_NEGATIVE_CACHE_ENTRIES:
        _NEGATIVE_TOKEN_CACHE.popitem(last=False)


async def _fetch_and_cache_gotrue_user(token: str, fp: str) -> Optional[Dict[str, Any]]:
    """GoTrue's verdict: user dict, None (definitively invalid) or AuthServiceUnavailableError."""
    url = f"{SUPABASE_URL}/auth/v1/user"
    headers = {"Authorization": f"Bearer {token}", "apikey": SUPABASE_ANON_KEY}
    try:
        async with _auth_http_client() as client:
            resp = await client.get(url, headers=headers)
    except Exception as e:
        logger.error(f"Supabase auth check failed ({type(e).__name__})")
        raise AuthServiceUnavailableError() from e
    status_code = resp.status_code
    if status_code == 200:
        try:
            user_data = resp.json()
        except Exception as e:
            raise AuthServiceUnavailableError() from e
        if not isinstance(user_data, dict) or not user_data.get("id"):
            raise AuthServiceUnavailableError()
        user_data["is_admin"] = is_admin_user(user_data)
        _cache_positive(fp, user_data, token)
        _NEGATIVE_TOKEN_CACHE.pop(fp, None)
        return user_data
    if status_code in (400, 401, 403, 404):
        _cache_negative(fp)
        logger.warning(f"Supabase auth check returned {status_code}")
        return None
    logger.warning(f"Supabase auth check returned {status_code}; treating as unavailable")
    raise AuthServiceUnavailableError()


def _inflight_done(fp: str, task: "asyncio.Task") -> None:
    if _INFLIGHT.get(fp) is task:
        _INFLIGHT.pop(fp, None)
    if not task.cancelled():
        task.exception()  # mark retrieved even if every waiter went away


async def _gotrue_user_single_flight(token: str, fp: str) -> Optional[Dict[str, Any]]:
    loop = asyncio.get_running_loop()
    task = _INFLIGHT.get(fp)
    if task is None or task.done() or task.get_loop() is not loop:
        task = loop.create_task(_fetch_and_cache_gotrue_user(token, fp))
        _INFLIGHT[fp] = task
        task.add_done_callback(lambda t, key=fp: _inflight_done(key, t))
    # shield: one caller disconnecting must not cancel the shared lookup for the others.
    return await asyncio.shield(task)


async def _verify_via_gotrue(token: str, fp: str) -> Optional[Dict[str, Any]]:
    now = time.time()
    hit = _TOKEN_CACHE.get(fp)
    if hit is not None:
        user_info, expires_at = hit
        if now < expires_at:
            _TOKEN_CACHE.move_to_end(fp)
            copy_info = dict(user_info)
            copy_info["is_admin"] = is_admin_user(copy_info)
            return copy_info
        _TOKEN_CACHE.pop(fp, None)

    neg_exp = _NEGATIVE_TOKEN_CACHE.get(fp)
    if neg_exp is not None:
        if now < neg_exp:
            return None
        _NEGATIVE_TOKEN_CACHE.pop(fp, None)

    user_data = await _gotrue_user_single_flight(token, fp)
    return dict(user_data) if user_data else None


async def _confirm_bad_hs256_with_gotrue(token: str, fp: str) -> Optional[Dict[str, Any]]:
    """
    A token that fails our HS256 check is normally forged. If GoTrue nevertheless accepts it, the
    configured SUPABASE_JWT_SECRET is wrong: stop verifying HS256 locally instead of locking users out.
    """
    global _LOCAL_HS256_DISABLED
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None
    try:
        user = await _verify_via_gotrue(token, fp)
    except AuthServiceUnavailableError:
        return None
    if user and not _LOCAL_HS256_DISABLED:
        _LOCAL_HS256_DISABLED = True
        logger.critical(
            "SUPABASE_JWT_SECRET does not match this project's signing secret (Supabase Auth accepted a "
            "token that failed local HS256 verification). Local HS256 verification is now DISABLED; "
            "fix the secret and restart."
        )
    return user


async def verify_supabase_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Verifies a Supabase access token. Returns the user dict if valid, None if invalid, and raises
    AuthServiceUnavailableError when the answer depends on an unreachable Supabase Auth.
    """
    if not token or len(token) > 8192:
        return None
    fp = _token_fingerprint(token)

    if _local_verify_enabled():
        try:
            claims = await _verify_locally(token)
        except _BadHs256Signature:
            return await _confirm_bad_hs256_with_gotrue(token, fp)
        except _InvalidToken:
            return None
        except _Unverifiable:
            pass
        else:
            if _is_revoked(claims["sub"]):
                return None
            return await _apply_admin_status(_user_from_claims(claims), token)

    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None
    return await _verify_via_gotrue(token, fp)


def _auth_unavailable_http_error() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail="Sign-in service is temporarily unavailable. Please try again in a moment.",
        headers={"Retry-After": AUTH_UNAVAILABLE_RETRY_AFTER},
    )


async def resolve_guest_session_user(
    access_token: Optional[str], refresh_token: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Proves possession of an anonymous (guest) session. Tries the access token first and,
    if it has expired, exchanges the refresh token. Returns the guest user only if it is
    anonymous; registered accounts are never resolvable through this path.
    Raises HTTP 503 when Supabase Auth is unreachable, so the client keeps its handoff and retries.
    """
    unavailable = False
    guest = None
    if access_token:
        try:
            guest = await verify_supabase_token(access_token)
        except AuthServiceUnavailableError:
            unavailable = True
    if not guest and refresh_token and SUPABASE_URL and SUPABASE_ANON_KEY:
        try:
            async with _auth_http_client() as client:
                resp = await client.post(
                    f"{SUPABASE_URL}/auth/v1/token",
                    params={"grant_type": "refresh_token"},
                    headers={"apikey": SUPABASE_ANON_KEY},
                    json={"refresh_token": refresh_token},
                )
            if resp.status_code == 200:
                guest = resp.json().get("user")
                unavailable = False
            elif resp.status_code >= 500 or resp.status_code == 429:
                unavailable = True
            else:
                logger.info(f"Guest refresh-token exchange returned {resp.status_code}")
                unavailable = False
        except Exception as e:
            logger.warning(f"Guest refresh-token exchange failed ({type(e).__name__})")
            unavailable = True
    if guest and guest.get("id") and guest.get("is_anonymous"):
        return guest
    if unavailable and not guest:
        raise _auth_unavailable_http_error()
    return None

async def get_current_user_optional(
    authorization: Optional[str] = Header(None)
) -> Optional[Dict[str, Any]]:
    """
    Optional authentication dependency: returns user dict if valid token provided, else None.
    A presented token that can't be checked because Supabase Auth is down yields HTTP 503.
    """
    if not authorization:
        return None

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None

    token = parts[1]
    try:
        return await verify_supabase_token(token)
    except AuthServiceUnavailableError:
        raise _auth_unavailable_http_error()

async def get_current_user_required(
    authorization: Optional[str] = Header(None)
) -> Dict[str, Any]:
    """
    Required authentication dependency: raises 401 if missing or invalid token.
    """
    user = await get_current_user_optional(authorization)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Please sign in."
        )
    return user

async def list_all_users(per_page: int = 200) -> list:
    """
    Admin-only helper: lists Supabase auth users (including anonymous/guest accounts)
    with signup/login metadata, via the Supabase Admin REST API (service role key).
    Callers MUST verify is_admin_user() before exposing this data.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return []
    url = f"{SUPABASE_URL}/auth/v1/admin/users"
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
    }
    users: list = []
    page = 1
    try:
        async with _auth_http_client() as client:
            while True:
                resp = await client.get(url, headers=headers, params={"page": page, "per_page": per_page})
                if resp.status_code != 200:
                    logger.warning(f"Supabase admin list users status {resp.status_code}: {resp.text}")
                    break
                payload = resp.json()
                batch = payload.get("users", [])
                if not batch:
                    break
                for u in batch:
                    users.append({
                        "id": u.get("id"),
                        "email": u.get("email"),
                        "is_anonymous": bool(u.get("is_anonymous", False)),
                        "created_at": u.get("created_at"),
                        "last_sign_in_at": u.get("last_sign_in_at"),
                        "providers": (u.get("app_metadata") or {}).get("providers", []),
                    })
                if len(batch) < per_page:
                    break
                page += 1
                if page > 20:  # safety cap (~4000 users)
                    break
    except Exception as e:
        logger.error(f"Error listing Supabase users: {e}")
    users.sort(key=lambda u: u.get("last_sign_in_at") or "", reverse=True)
    return users


def purge_cached_user(user_id: str) -> None:
    """Drops every cached session of `user_id` and rejects its still-unexpired JWTs from now on."""
    if not user_id:
        return
    for fp in [fp for fp, (u_info, _) in _TOKEN_CACHE.items() if u_info.get("id") == user_id]:
        _TOKEN_CACHE.pop(fp, None)
    _ADMIN_CONFIRM_CACHE.pop(user_id, None)
    _REVOKED_SUBS[user_id] = time.time()
    _REVOKED_SUBS.move_to_end(user_id)
    while len(_REVOKED_SUBS) > _MAX_REVOKED_SUBS:
        _REVOKED_SUBS.popitem(last=False)


async def delete_supabase_user(user_id: str) -> bool:
    """
    Deletes a user from Supabase Auth using the admin service role key.
    Also clears any cached session token for this user.
    """
    if not user_id or not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        logger.warning("delete_supabase_user called with missing config or user_id")
        return False

    url = f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
    }

    try:
        async with _auth_http_client() as client:
            resp = await client.delete(url, headers=headers)
            if resp.status_code in (200, 204):
                purge_cached_user(user_id)
                logger.info(f"User {user_id} successfully deleted from Supabase Auth")
                return True
            else:
                logger.warning(f"Supabase delete user status {resp.status_code}: {resp.text}")
                return False
    except Exception as e:
        logger.error(f"Error deleting user {user_id} from Supabase: {e}")
        return False


def reset_auth_caches_for_tests() -> None:
    """Clears every in-process auth cache (test isolation)."""
    global _JWKS_KEYS, _JWKS_FETCHED_AT, _JWKS_LAST_ATTEMPT, _JWKS_INFLIGHT, _LOCAL_HS256_DISABLED
    _TOKEN_CACHE.clear()
    _NEGATIVE_TOKEN_CACHE.clear()
    _INFLIGHT.clear()
    _ADMIN_CONFIRM_CACHE.clear()
    _REVOKED_SUBS.clear()
    _JWKS_KEYS = {}
    _JWKS_FETCHED_AT = 0.0
    _JWKS_LAST_ATTEMPT = 0.0
    _JWKS_INFLIGHT = None
    _LOCAL_HS256_DISABLED = False
