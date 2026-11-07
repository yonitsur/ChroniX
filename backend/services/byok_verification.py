"""
Verified-BYOK tracking (S-04).

A personal Gemini key (`X-Gemini-Api-Key`) unlocks the UNLIMITED entitlement tier and the BYOK
rate-limit multiplier only after that key has completed at least one successful Gemini call
through this server. Until then the caller gets their normal guest / registered ceilings (the AI
call itself still runs on their key at 0 credits), so a junk header can't buy unlimited-size
server CPU, memory and bandwidth work.

Verdicts are kept in-process, keyed by sha256(key) (never the raw key), for ~24 h.
Success is observed from the Gemini client actually used (`note_gemini_success`), so an
operation that swallows a Gemini error and returns a fallback never verifies a key.
"""

import hashlib
import os
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator, Optional, Set

_DEFAULT_TTL_SECONDS = 24 * 3600
_MAX_ENTRIES = 10_000

_VERIFIED: "OrderedDict[str, float]" = OrderedDict()
_LOCK = threading.Lock()
# Fingerprints of keys whose Gemini call succeeded inside the current observed operation.
_OBSERVED_SUCCESSES: ContextVar[Optional[Set[str]]] = ContextVar("chronix_byok_successes", default=None)


def _ttl_seconds() -> int:
    try:
        return max(60, int(os.getenv("BYOK_VERIFIED_TTL_SECONDS", "").strip() or _DEFAULT_TTL_SECONDS))
    except ValueError:
        return _DEFAULT_TTL_SECONDS


def key_fingerprint(api_key: str) -> str:
    return hashlib.sha256(api_key.strip().encode("utf-8", errors="ignore")).hexdigest()


def _clean(api_key: Optional[str]) -> str:
    return api_key.strip() if isinstance(api_key, str) else ""


def mark_custom_key_verified(api_key: Optional[str]) -> None:
    key = _clean(api_key)
    if not key:
        return
    fp = key_fingerprint(key)
    with _LOCK:
        _VERIFIED[fp] = time.time() + _ttl_seconds()
        _VERIFIED.move_to_end(fp)
        while len(_VERIFIED) > _MAX_ENTRIES:
            _VERIFIED.popitem(last=False)


def forget_custom_key(api_key: Optional[str]) -> None:
    """Drops a verdict (e.g. Google now rejects the key as invalid)."""
    key = _clean(api_key)
    if key:
        with _LOCK:
            _VERIFIED.pop(key_fingerprint(key), None)


def is_custom_key_verified(api_key: Optional[str]) -> bool:
    """True only for a non-empty key that has completed a successful Gemini call within the TTL."""
    key = _clean(api_key)
    if not key:
        return False
    fp = key_fingerprint(key)
    with _LOCK:
        expires_at = _VERIFIED.get(fp)
        if expires_at is None:
            return False
        if time.time() >= expires_at:
            _VERIFIED.pop(fp, None)
            return False
        return True


def note_gemini_success(client: Any) -> None:
    """Called after a Gemini request returned: records which key served it (if being observed)."""
    observed = _OBSERVED_SUCCESSES.get()
    if observed is None:
        return
    api_client = getattr(client, "_api_client", None)
    key = getattr(api_client, "api_key", None)
    if isinstance(key, str) and key.strip():
        observed.add(key_fingerprint(key))


@contextmanager
def observe_gemini_successes() -> Iterator[Set[str]]:
    """Collects fingerprints of keys that served a successful Gemini call within the block."""
    observed: Set[str] = set()
    token = _OBSERVED_SUCCESSES.set(observed)
    try:
        yield observed
    finally:
        _OBSERVED_SUCCESSES.reset(token)


def reset_for_tests() -> None:
    with _LOCK:
        _VERIFIED.clear()
