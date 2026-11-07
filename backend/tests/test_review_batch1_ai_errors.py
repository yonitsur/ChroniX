"""B-01: Gemini errors are classified structurally; 5xx and user/wrapper text never bench a key."""
import os

import httpx
import pytest
from google.genai import errors as genai_errors

import services.quota_service as quota_module
from services import ai_errors
from services.ai_errors import AiErrorKind, classify_ai_error, key_cooldown_seconds, retry_after_seconds
from services.quota_service import is_key_available


def _api_error(code, status, message, details=None, cls=None):
    body = {"error": {"code": code, "status": status, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    if cls is None:
        cls = genai_errors.ClientError if code < 500 else genai_errors.ServerError
    return cls(code, body)


def _quota_failure(quota_id):
    return {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        "violations": [
            {"quotaMetric": "generativelanguage.googleapis.com/generate_content_free_tier_requests", "quotaId": quota_id}
        ],
    }


def _retry_info(delay):
    return {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": delay}


def _wrapped(message, cause):
    try:
        raise RuntimeError(message) from cause
    except RuntimeError as exc:
        return exc


# Google's normal 429 text mentions "billing details": must still be a rate limit, not billing.
_GOOGLE_429_MSG = (
    "You exceeded your current quota, please check your plan and billing details. "
    "For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits."
)


# --- classifier -------------------------------------------------------------------------------

def test_429_per_minute_is_rate_limit_with_retry_delay():
    err = _api_error(
        429, "RESOURCE_EXHAUSTED", _GOOGLE_429_MSG,
        [_quota_failure("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"), _retry_info("33s")],
    )
    assert classify_ai_error(err) == AiErrorKind.RATE_LIMIT
    assert retry_after_seconds(err) == 33.0


def test_429_without_details_is_rate_limit():
    assert classify_ai_error(_api_error(429, "RESOURCE_EXHAUSTED", "Too many requests")) == AiErrorKind.RATE_LIMIT


def test_429_per_day_is_daily_quota():
    err = _api_error(
        429, "RESOURCE_EXHAUSTED", _GOOGLE_429_MSG,
        [_quota_failure("GenerateRequestsPerDayPerProjectPerModel-FreeTier"), _retry_info("13.5s")],
    )
    assert classify_ai_error(err) == AiErrorKind.DAILY_QUOTA
    assert retry_after_seconds(err) == 13.5


def test_prepayment_credits_message_is_billing():
    err = _api_error(
        429, "RESOURCE_EXHAUSTED",
        "Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.",
    )
    assert classify_ai_error(err) == AiErrorKind.BILLING


def test_billing_disabled_error_info_is_billing():
    err = _api_error(
        403, "PERMISSION_DENIED", "This API method requires billing to be enabled.",
        [{"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "BILLING_DISABLED"}],
    )
    assert classify_ai_error(err) == AiErrorKind.BILLING


def test_invalid_key_variants():
    invalid = _api_error(
        400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.",
        [{"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "API_KEY_INVALID"}],
    )
    assert classify_ai_error(invalid) == AiErrorKind.INVALID_KEY
    assert classify_ai_error(_api_error(401, "UNAUTHENTICATED", "Request had invalid credentials.")) == AiErrorKind.INVALID_KEY
    assert classify_ai_error(_api_error(403, "PERMISSION_DENIED", "Permission denied.")) == AiErrorKind.INVALID_KEY


def test_other_400_is_other():
    err = _api_error(400, "INVALID_ARGUMENT", "Request contains an invalid argument.")
    assert classify_ai_error(err) == AiErrorKind.OTHER


@pytest.mark.parametrize("code,status", [(503, "UNAVAILABLE"), (500, "INTERNAL"), (504, "DEADLINE_EXCEEDED")])
def test_server_errors_are_transient(code, status):
    err = _api_error(code, status, "The model is overloaded. Please try again later.")
    assert classify_ai_error(err) == AiErrorKind.TRANSIENT


def test_chained_runtime_error_is_classified_from_cause():
    cause = _api_error(429, "RESOURCE_EXHAUSTED", _GOOGLE_429_MSG)
    assert classify_ai_error(_wrapped("Failed to generate timeline with Gemini: ...", cause)) == AiErrorKind.RATE_LIMIT
    transient = _api_error(503, "UNAVAILABLE", "overloaded")
    # Our wrapper text used to say "not an account or quota issue", which read as a quota error.
    wrapped = _wrapped("Gemini's servers are temporarily overloaded. Not an account or quota issue.", transient)
    assert classify_ai_error(wrapped) == AiErrorKind.TRANSIENT


def test_implicit_context_chain_and_cycles_are_safe():
    try:
        try:
            raise _api_error(429, "RESOURCE_EXHAUSTED", "quota")
        except Exception:
            raise ValueError("while handling")
    except ValueError as exc:
        err = exc
    assert classify_ai_error(err) == AiErrorKind.RATE_LIMIT

    a, b = RuntimeError("a"), RuntimeError("b")
    a.__cause__, b.__cause__ = b, a
    assert classify_ai_error(a) == AiErrorKind.OTHER


@pytest.mark.parametrize(
    "text",
    [
        "Generation for 'history of credit cards' returned 0 events.",
        "Expecting ',' delimiter: line 1 column 14290 (char 14290)",
        "quota 429 billing RESOURCE_EXHAUSTED prepayment credits are depleted",
        "503 UNAVAILABLE overloaded",
    ],
)
def test_free_text_never_classifies(text):
    assert classify_ai_error(ValueError(text)) == AiErrorKind.OTHER
    assert classify_ai_error(RuntimeError(text)) == AiErrorKind.OTHER


def test_httpx_fallback_only_for_google_hosts():
    def status_error(url, code, body="{}", headers=None):
        req = httpx.Request("POST", url)
        resp = httpx.Response(code, request=req, text=body, headers=headers or {})
        return httpx.HTTPStatusError("err", request=req, response=resp)

    google = status_error(
        "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent", 429, headers={"Retry-After": "7"}
    )
    assert classify_ai_error(google) == AiErrorKind.RATE_LIMIT
    assert retry_after_seconds(google) == 7.0
    assert classify_ai_error(status_error("https://en.wikipedia.org/w/api.php", 429)) == AiErrorKind.OTHER


def test_timeouts_are_transient():
    assert classify_ai_error(TimeoutError()) == AiErrorKind.TRANSIENT
    assert classify_ai_error(_wrapped("timed out", httpx.ReadTimeout("slow"))) == AiErrorKind.TRANSIENT


def test_cooldown_policy():
    rl = _api_error(429, "RESOURCE_EXHAUSTED", "x", [_retry_info("20s")])
    assert 20.0 <= key_cooldown_seconds(AiErrorKind.RATE_LIMIT, rl, is_paid_key=True) <= 23.0
    no_hint = key_cooldown_seconds(AiErrorKind.RATE_LIMIT, _api_error(429, "RESOURCE_EXHAUSTED", "x"), is_paid_key=False)
    assert 30.0 <= no_hint <= 60.0
    assert key_cooldown_seconds(AiErrorKind.DAILY_QUOTA, None, is_paid_key=False) == ai_errors.DAILY_QUOTA_COOLDOWN_SECONDS
    assert key_cooldown_seconds(AiErrorKind.BILLING, None, is_paid_key=True) == 600.0
    assert key_cooldown_seconds(AiErrorKind.INVALID_KEY, None, is_paid_key=False) == ai_errors.INVALID_KEY_COOLDOWN_SECONDS
    assert key_cooldown_seconds(AiErrorKind.TRANSIENT, None, is_paid_key=True) is None
    assert key_cooldown_seconds(AiErrorKind.OTHER, None, is_paid_key=True) is None


def test_format_gemini_error_uses_classifier():
    from services.gemini_service import format_gemini_error

    assert "temporarily overloaded" in format_gemini_error(_api_error(503, "UNAVAILABLE", "overloaded"))
    assert "rate limit" in format_gemini_error(_api_error(429, "RESOURCE_EXHAUSTED", _GOOGLE_429_MSG))
    assert "prepayment credits" in format_gemini_error(
        _api_error(429, "RESOURCE_EXHAUSTED", "Your prepayment credits are depleted.")
    )
    # A plain error mentioning "quota" is not a quota error.
    assert format_gemini_error(ValueError("quota of events")).startswith("Failed to generate timeline with Gemini")


# --- run_with_key_failover ------------------------------------------------------------------

@pytest.fixture
def key_env(monkeypatch):
    quota_module._KEY_COOLDOWNS.clear()
    quota_module._free_key_rr_counter = 0
    for var in list(os.environ):
        if var.startswith("GEMINI_API_KEY_FREE"):
            monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FK1")
    monkeypatch.setenv("GEMINI_API_KEY_FREE_1", "FK2")
    marks = []
    real_mark = quota_module.mark_key_exhausted

    def spy(key, cooldown_seconds=300.0):
        marks.append((key, cooldown_seconds))
        real_mark(key, cooldown_seconds=cooldown_seconds)

    import main

    monkeypatch.setattr(main, "mark_key_exhausted", spy)
    yield marks
    quota_module._KEY_COOLDOWNS.clear()


@pytest.mark.asyncio
async def test_failover_503_does_not_bench_and_raises(key_env):
    from main import run_with_key_failover

    attempted = []

    async def op(key):
        attempted.append(key)
        raise _wrapped("Gemini's servers are temporarily overloaded.", _api_error(503, "UNAVAILABLE", "overloaded"))

    with pytest.raises(RuntimeError):
        await run_with_key_failover(op, "PAID_KEY", "paid", label="test")
    assert attempted == ["PAID_KEY"]
    assert key_env == []
    assert is_key_available("PAID_KEY") is True


@pytest.mark.asyncio
async def test_failover_user_text_never_rotates(key_env):
    from main import run_with_key_failover

    async def op(key):
        raise ValueError("Generation for 'Battle of 1429 credit quota billing' returned 0 events.")

    with pytest.raises(ValueError):
        await run_with_key_failover(op, "PAID_KEY", "paid", label="test")
    assert key_env == []


@pytest.mark.asyncio
async def test_failover_429_short_cooldown_and_rotation(key_env):
    from main import run_with_key_failover

    attempted = []

    async def op(key):
        attempted.append(key)
        if key == "PAID_KEY":
            raise _wrapped("rate limited", _api_error(429, "RESOURCE_EXHAUSTED", _GOOGLE_429_MSG))
        return f"ok:{key}"

    assert await run_with_key_failover(op, "PAID_KEY", "paid", label="test") == "ok:FK1"
    assert attempted == ["PAID_KEY", "FK1"]
    assert len(key_env) == 1
    key, cooldown = key_env[0]
    assert key == "PAID_KEY" and 30.0 <= cooldown <= 60.0


@pytest.mark.asyncio
async def test_failover_billing_benches_paid_key_600s(key_env):
    from main import run_with_key_failover

    async def op(key):
        if key == "PAID_KEY":
            raise _api_error(429, "RESOURCE_EXHAUSTED", "Your prepayment credits are depleted.")
        return f"ok:{key}"

    assert await run_with_key_failover(op, "PAID_KEY", "paid", label="test") == "ok:FK1"
    assert key_env == [("PAID_KEY", 600.0)]
    assert is_key_available("PAID_KEY") is False


@pytest.mark.asyncio
async def test_failover_daily_quota_benches_for_an_hour(key_env):
    from main import run_with_key_failover

    async def op(key):
        if key == "FK1":
            raise _api_error(
                429, "RESOURCE_EXHAUSTED", _GOOGLE_429_MSG,
                [_quota_failure("GenerateRequestsPerDayPerProjectPerModel-FreeTier")],
            )
        return f"ok:{key}"

    assert await run_with_key_failover(op, "FK1", "free", label="test") == "ok:FK2"
    assert key_env == [("FK1", ai_errors.DAILY_QUOTA_COOLDOWN_SECONDS)]


@pytest.mark.asyncio
async def test_failover_custom_key_never_rotates_or_benches(key_env):
    from main import run_with_key_failover

    attempted = []

    async def op(key):
        attempted.append(key)
        raise _api_error(429, "RESOURCE_EXHAUSTED", _GOOGLE_429_MSG)

    with pytest.raises(genai_errors.ClientError):
        await run_with_key_failover(op, "CUSTOM_KEY", "custom", label="test")
    assert attempted == ["CUSTOM_KEY"]
    assert key_env == []


def test_byok_suggestion_uses_classifier(monkeypatch):
    from main import format_api_error_for_user

    monkeypatch.setenv("ADMIN_EMAILS", "admin@chronix.app")
    user = {"id": "u1", "is_anonymous": False}
    for err in (
        _api_error(429, "RESOURCE_EXHAUSTED", _GOOGLE_429_MSG),
        _api_error(503, "UNAVAILABLE", "overloaded"),
        _api_error(429, "RESOURCE_EXHAUSTED", "Your prepayment credits are depleted."),
    ):
        assert "personal Gemini API key" in format_api_error_for_user(_wrapped("x", err), user=user)
    plain = ValueError("history of credit cards: quota 429")
    assert format_api_error_for_user(plain, user=user) == str(plain)


def test_tts_pinned_retry_does_not_break_on_quota_text():
    from services import podcast_tts_service

    assert podcast_tts_service._is_gemini_quota_or_rate_error(_api_error(429, "RESOURCE_EXHAUSTED", "x")) is True
    assert podcast_tts_service._is_gemini_quota_or_rate_error(RuntimeError("429 quota spending cap")) is False
