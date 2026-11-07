"""
Structured classification of Gemini / Google API errors.

Key rotation and cooldowns must be driven by what Google actually returned (HTTP code, RPC status,
ErrorInfo / QuotaFailure / RetryInfo details), never by substrings of our own wrapper messages or of
user text: a routine 503 or a prompt like "history of credit cards" must not bench the shared paid key.
"""
import asyncio
import json
import random
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Iterator, List, Optional

import httpx

try:
    from google.genai.errors import APIError as _GenaiAPIError
except Exception:  # pragma: no cover - SDK always installed in prod
    _GenaiAPIError = None  # type: ignore[assignment]

try:
    # Errors raised by the Interactions API (`client.aio.interactions`, used by Gemini TTS).
    from google.genai._gaos.errors import GenAiError as _GaosGenAiError
except Exception:  # pragma: no cover - older SDKs
    _GaosGenAiError = None  # type: ignore[assignment]


class AiErrorKind(str, Enum):
    RATE_LIMIT = "rate_limit"
    DAILY_QUOTA = "daily_quota"
    BILLING = "billing"
    INVALID_KEY = "invalid_key"
    TRANSIENT = "transient"
    OTHER = "other"


# Kinds that mean "this key cannot serve requests right now": rotate to the next key and cool it down.
KEY_EXHAUSTION_KINDS = frozenset(
    {AiErrorKind.RATE_LIMIT, AiErrorKind.DAILY_QUOTA, AiErrorKind.BILLING, AiErrorKind.INVALID_KEY}
)
# Kinds where telling a shared-key user "add your own key / try again shortly" is useful advice.
BYOK_SUGGESTION_KINDS = frozenset(
    {AiErrorKind.RATE_LIMIT, AiErrorKind.DAILY_QUOTA, AiErrorKind.BILLING, AiErrorKind.TRANSIENT}
)

RATE_LIMIT_COOLDOWN_RANGE_SECONDS = (30.0, 60.0)
RATE_LIMIT_MAX_COOLDOWN_SECONDS = 900.0
DAILY_QUOTA_COOLDOWN_SECONDS = 3600.0
BILLING_COOLDOWN_SECONDS_PAID = 600.0
BILLING_COOLDOWN_SECONDS_FREE = 300.0
INVALID_KEY_COOLDOWN_SECONDS = 3600.0

_MAX_CHAIN_DEPTH = 16

_BILLING_REASONS = frozenset({"BILLING_DISABLED", "BILLING_NOT_ACTIVE", "BILLING_ACCOUNT_CLOSED"})
# Phrases from Google's own error message that mean the project's money ran out. The generic 429 text
# ("please check your plan and billing details") deliberately does not match any of these.
_BILLING_PHRASES = (
    "prepayment",
    "credits are depleted",
    "credit balance",
    "billing account",
    "billing to be enabled",
    "billing is not enabled",
    "billing has not been enabled",
    "billing_disabled",
    "spending cap",
    "spend cap",
)
_INVALID_KEY_REASONS = frozenset(
    {"API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_SERVICE_BLOCKED", "CONSUMER_SUSPENDED", "SERVICE_DISABLED"}
)
_TRANSIENT_STATUSES = frozenset({"UNAVAILABLE", "DEADLINE_EXCEEDED", "INTERNAL"})
_TIMEOUT_TYPES = (asyncio.TimeoutError, TimeoutError, httpx.TimeoutException, httpx.TransportError)
_GOOGLE_API_HOST_SUFFIX = "googleapis.com"


class LocalRateLimitError(RuntimeError):
    """Raised before calling Gemini when our own per-(key, model) pacing (SC-14) says the request
    would exceed the configured RPM. Classified like a 429 so callers rotate to another key or
    model, with a cooldown of just `retry_after` seconds."""

    def __init__(self, retry_after: float):
        super().__init__("Gemini request rate limit reached for this key and model (local pacing).")
        self.retry_after = max(0.0, float(retry_after))


@dataclass
class ProviderError:
    """Normalised view of a structured provider error."""

    code: Optional[int]
    status: str = ""
    message: str = ""
    details: List[Dict[str, Any]] = field(default_factory=list)
    headers: Dict[str, str] = field(default_factory=dict)


def _iter_exception_chain(exc: Optional[BaseException]) -> Iterator[BaseException]:
    """Yields `exc` and its causes/contexts, cycle-safe, honouring `raise ... from None`."""
    seen = set()
    stack = [exc] if exc is not None else []
    while stack and len(seen) < _MAX_CHAIN_DEPTH:
        cur = stack.pop(0)
        if cur is None or id(cur) in seen:
            continue
        seen.add(id(cur))
        yield cur
        if cur.__cause__ is not None:
            stack.append(cur.__cause__)
        if cur.__context__ is not None and not cur.__suppress_context__:
            stack.append(cur.__context__)


def _normalise_body(body: Any) -> Dict[str, Any]:
    if isinstance(body, (bytes, bytearray)):
        body = body.decode("utf-8", errors="replace")
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except (ValueError, TypeError):
            return {}
    if isinstance(body, list) and len(body) == 1:
        body = body[0]
    if not isinstance(body, dict):
        return {}
    inner = body.get("error")
    return inner if isinstance(inner, dict) else body


def _detail_list(body: Dict[str, Any]) -> List[Dict[str, Any]]:
    details = body.get("details")
    if not isinstance(details, list):
        return []
    return [d for d in details if isinstance(d, dict)]


def _headers_dict(headers: Any) -> Dict[str, str]:
    try:
        return {str(k).lower(): str(v) for k, v in dict(headers or {}).items()}
    except Exception:
        return {}


def _as_int(val: Any) -> Optional[int]:
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def _provider_error_from(exc: BaseException) -> Optional[ProviderError]:
    if _GenaiAPIError is not None and isinstance(exc, _GenaiAPIError):
        body = _normalise_body(getattr(exc, "details", None))
        response = getattr(exc, "response", None)
        return ProviderError(
            code=_as_int(getattr(exc, "code", None)) or _as_int(body.get("code")),
            status=str(getattr(exc, "status", None) or body.get("status") or "").upper(),
            message=str(getattr(exc, "message", None) or body.get("message") or ""),
            details=_detail_list(body),
            headers=_headers_dict(getattr(response, "headers", None)),
        )
    if _GaosGenAiError is not None and isinstance(exc, _GaosGenAiError):
        body = _normalise_body(getattr(exc, "body", None))
        return ProviderError(
            code=_as_int(getattr(exc, "status_code", None)),
            status=str(body.get("status") or "").upper(),
            message=str(body.get("message") or getattr(exc, "message", "") or ""),
            details=_detail_list(body),
            headers=_headers_dict(getattr(exc, "headers", None)),
        )
    if isinstance(exc, httpx.HTTPStatusError):
        # Only trust raw HTTP errors that came from a Google API endpoint, so e.g. a Wikimedia 429
        # bubbling out of an enrichment step can never bench a Gemini key.
        try:
            host = (exc.request.url.host or "").lower()
        except Exception:
            host = ""
        if not host.endswith(_GOOGLE_API_HOST_SUFFIX):
            return None
        try:
            body = _normalise_body(exc.response.text)
        except Exception:
            body = {}
        return ProviderError(
            code=exc.response.status_code,
            status=str(body.get("status") or "").upper(),
            message=str(body.get("message") or ""),
            details=_detail_list(body),
            headers=_headers_dict(exc.response.headers),
        )
    return None


def find_provider_error(exc: Optional[BaseException]) -> Optional[ProviderError]:
    """Returns the first structured provider error found in `exc`'s cause/context chain."""
    for cur in _iter_exception_chain(exc):
        info = _provider_error_from(cur)
        if info is not None:
            return info
    return None


def _detail_type(detail: Dict[str, Any]) -> str:
    return str(detail.get("@type") or "")


def _error_reasons(info: ProviderError) -> set:
    return {
        str(d.get("reason") or "").upper()
        for d in info.details
        if _detail_type(d).endswith("google.rpc.ErrorInfo") and d.get("reason")
    }


def _quota_identifiers(info: ProviderError) -> List[str]:
    out: List[str] = []
    for d in info.details:
        if not _detail_type(d).endswith("google.rpc.QuotaFailure"):
            continue
        for v in d.get("violations") or []:
            if isinstance(v, dict):
                for k in ("quotaId", "quotaMetric", "subject", "description"):
                    if v.get(k):
                        out.append(str(v[k]).lower())
    return out


def _is_daily_quota(info: ProviderError) -> bool:
    return any(
        "perday" in q or "per_day" in q or "per day" in q or "daily" in q for q in _quota_identifiers(info)
    )


def _is_billing(info: ProviderError) -> bool:
    if info.code is not None and not (400 <= info.code < 500):
        return False
    if _error_reasons(info) & _BILLING_REASONS:
        return True
    msg = info.message.lower()
    return any(p in msg for p in _BILLING_PHRASES)


def _classify_provider_error(info: ProviderError) -> AiErrorKind:
    code = info.code
    status = info.status
    if _is_billing(info):
        return AiErrorKind.BILLING
    if code == 429 or status == "RESOURCE_EXHAUSTED":
        return AiErrorKind.DAILY_QUOTA if _is_daily_quota(info) else AiErrorKind.RATE_LIMIT
    reasons = _error_reasons(info)
    msg = info.message.lower()
    if (
        reasons & _INVALID_KEY_REASONS
        or code in (401, 403)
        or status in ("UNAUTHENTICATED", "PERMISSION_DENIED")
        or (code == 400 and ("api key not valid" in msg or "api key expired" in msg))
    ):
        return AiErrorKind.INVALID_KEY
    if (code is not None and (code >= 500 or code == 408)) or status in _TRANSIENT_STATUSES:
        return AiErrorKind.TRANSIENT
    return AiErrorKind.OTHER


def classify_ai_error(exc: Optional[BaseException]) -> AiErrorKind:
    """Classifies an exception (or anything it was chained from) into an `AiErrorKind`."""
    info = find_provider_error(exc)
    if info is not None:
        return _classify_provider_error(info)
    if any(isinstance(cur, LocalRateLimitError) for cur in _iter_exception_chain(exc)):
        return AiErrorKind.RATE_LIMIT
    if any(isinstance(cur, _TIMEOUT_TYPES) for cur in _iter_exception_chain(exc)):
        return AiErrorKind.TRANSIENT
    return AiErrorKind.OTHER


def _parse_duration_seconds(val: Any) -> Optional[float]:
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        return float(val)
    if isinstance(val, dict):
        secs = val.get("seconds")
        nanos = val.get("nanos") or 0
        try:
            return float(secs or 0) + float(nanos) / 1e9
        except (TypeError, ValueError):
            return None
    if isinstance(val, str):
        m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*s?\s*", val)
        if m:
            return float(m.group(1))
    return None


def retry_after_seconds(exc: Optional[BaseException]) -> Optional[float]:
    """Returns Google's suggested retry delay (RetryInfo.retryDelay or Retry-After), if any."""
    info = find_provider_error(exc)
    if info is None:
        local = next((cur for cur in _iter_exception_chain(exc) if isinstance(cur, LocalRateLimitError)), None)
        return local.retry_after if local is not None else None
    for d in info.details:
        if _detail_type(d).endswith("google.rpc.RetryInfo"):
            secs = _parse_duration_seconds(d.get("retryDelay"))
            if secs is not None and secs >= 0:
                return secs
    header = info.headers.get("retry-after")
    if header:
        secs = _parse_duration_seconds(header)
        if secs is not None and secs >= 0:
            return secs
    # Google's own message (never ours) often ends with "Please retry in 33.2s."
    m = re.search(r"retry in (\d+(?:\.\d+)?)\s*s", info.message, re.IGNORECASE)
    if m:
        return float(m.group(1))
    return None


def key_cooldown_seconds(kind: AiErrorKind, exc: Optional[BaseException], is_paid_key: bool) -> Optional[float]:
    """Cooldown for a server key that failed with `kind`, or None when the key must not be benched."""
    if kind == AiErrorKind.RATE_LIMIT:
        retry_after = retry_after_seconds(exc)
        if retry_after is not None:
            return min(max(retry_after, 1.0), RATE_LIMIT_MAX_COOLDOWN_SECONDS) + random.uniform(0.0, 3.0)
        return random.uniform(*RATE_LIMIT_COOLDOWN_RANGE_SECONDS)
    if kind == AiErrorKind.DAILY_QUOTA:
        return DAILY_QUOTA_COOLDOWN_SECONDS
    if kind == AiErrorKind.BILLING:
        return BILLING_COOLDOWN_SECONDS_PAID if is_paid_key else BILLING_COOLDOWN_SECONDS_FREE
    if kind == AiErrorKind.INVALID_KEY:
        return INVALID_KEY_COOLDOWN_SECONDS
    return None
