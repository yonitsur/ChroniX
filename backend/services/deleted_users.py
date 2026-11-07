"""
Short-lived memory of accounts that were just deleted (B-13).

Account deletion removes everything a user owns, but work that was already in flight (an AI job
finishing, a podcast render saving its last clip, a queued activity insert) would otherwise write
fresh rows for that user a few seconds later. Writers check `is_recently_deleted` and drop the write.

This is per-process memory: it covers in-flight work on this instance, which is where the race is.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Dict, Optional

_TTL_SECONDS = max(60.0, float(os.getenv("DELETED_USER_TOMBSTONE_SECONDS", "3600") or 3600))
_MAX_ENTRIES = 10_000

_lock = threading.Lock()
_deleted: Dict[str, float] = {}


class UserDeletedError(Exception):
    """Raised when a write is attempted for an account deleted moments ago (not a storage outage)."""


def _prune(now: float) -> None:
    expired = [uid for uid, until in _deleted.items() if until <= now]
    for uid in expired:
        _deleted.pop(uid, None)
    if len(_deleted) > _MAX_ENTRIES:
        for uid, _ in sorted(_deleted.items(), key=lambda kv: kv[1])[: len(_deleted) - _MAX_ENTRIES]:
            _deleted.pop(uid, None)


def mark_deleted(user_id: Optional[str]) -> None:
    if not user_id:
        return
    now = time.time()
    with _lock:
        _prune(now)
        _deleted[str(user_id)] = now + _TTL_SECONDS


def unmark_deleted(user_id: Optional[str]) -> None:
    """The deletion was aborted (the account still exists): its writes are allowed again."""
    if not user_id:
        return
    with _lock:
        _deleted.pop(str(user_id), None)


def is_recently_deleted(user_id: Optional[str]) -> bool:
    if not user_id:
        return False
    with _lock:
        until = _deleted.get(str(user_id))
        if until is None:
            return False
        if until <= time.time():
            _deleted.pop(str(user_id), None)
            return False
        return True


def clear() -> None:
    """Test helper."""
    with _lock:
        _deleted.clear()
