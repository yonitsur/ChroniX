"""
Shared, persistent cache for Wikimedia / Nominatim lookups (SC-04, SC-11).

Backed by the Supabase table `public.enrichment_cache` (migration 003). It sits behind the
in-process caches: a process restart or deploy no longer re-fetches Wikidata depictions or
reverse-geocoded places from rate-limited public APIs.

- Reads are batched (one PostgREST request per <= 50 keys) with a short timeout; any failure is
  treated as a miss.
- Writes are fire-and-forget background tasks: they never delay a response.
- A missing table (migration not applied), missing credentials, local JSON mode or
  ENRICHMENT_CACHE_ENABLED=false turn the cache into a no-op.
"""
import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import httpx

logger = logging.getLogger(__name__)

_TABLE = "enrichment_cache"
_READ_TIMEOUT = httpx.Timeout(1.5, connect=1.0)
_WRITE_TIMEOUT = httpx.Timeout(5.0, connect=2.0)
_READ_CHUNK = 50
_WRITE_CHUNK = 100
_MAX_PENDING_WRITES = 32
_MAX_VALUE_CHARS = 20_000
# After the table turned out to be missing (or Supabase failed repeatedly), stay off for a while.
_DISABLE_SECONDS = 600.0
_KEY_RE = re.compile(r"^[A-Za-z0-9:._\-]{1,200}$")

_ORIG_ASYNC_CLIENT = httpx.AsyncClient
_disabled_until = 0.0
_consecutive_failures = 0
_pending_writes: Set["asyncio.Task"] = set()
_client: Optional[httpx.AsyncClient] = None
_client_loop = None


def _shared_client() -> httpx.AsyncClient:
    """One keep-alive client per event loop (no TLS handshake per lookup)."""
    global _client, _client_loop
    loop = asyncio.get_running_loop()
    if _client is None or _client.is_closed or _client_loop is not loop:
        _client = _ORIG_ASYNC_CLIENT(
            timeout=_WRITE_TIMEOUT,
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
        )
        _client_loop = loop
    return _client


def _config() -> Tuple[str, str]:
    return os.getenv("SUPABASE_URL", "").rstrip("/"), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def is_enabled() -> bool:
    raw = (os.getenv("ENRICHMENT_CACHE_ENABLED") or "true").strip().lower()
    if raw in ("false", "0", "off", "no", "disabled"):
        return False
    url, key = _config()
    if not url or not key:
        return False
    return time.monotonic() >= _disabled_until


def reset_for_tests() -> None:
    global _disabled_until, _consecutive_failures
    _disabled_until = 0.0
    _consecutive_failures = 0


def _headers(key: str) -> Dict[str, str]:
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def _note_failure(resp: Optional[httpx.Response] = None) -> None:
    """A missing table disables the cache at once; other failures only after a few in a row."""
    global _disabled_until, _consecutive_failures
    _consecutive_failures += 1
    missing_table = False
    if resp is not None and resp.status_code in (404, 400):
        try:
            code = (resp.json() or {}).get("code")
        except Exception:
            code = None
        missing_table = resp.status_code == 404 or code in ("PGRST205", "42P01")
    if missing_table or _consecutive_failures >= 3:
        _disabled_until = time.monotonic() + _DISABLE_SECONDS
        _consecutive_failures = 0
        logger.warning(
            "Enrichment cache disabled for %.0f min (%s).",
            _DISABLE_SECONDS / 60,
            "table public.enrichment_cache missing; run migration 003" if missing_table else "repeated Supabase errors",
        )


def _note_success() -> None:
    global _consecutive_failures
    _consecutive_failures = 0


def valid_key(key: str) -> bool:
    return bool(key) and bool(_KEY_RE.match(key))


def _quote_in_list(keys: Iterable[str]) -> str:
    return ",".join(f'"{k}"' for k in keys)


async def get_many(keys: Iterable[str]) -> Dict[str, Any]:
    """Returns {key: value} for the keys present and not expired. Never raises."""
    wanted = list(dict.fromkeys(k for k in keys if valid_key(k)))
    if not wanted or not is_enabled() or httpx.AsyncClient is not _ORIG_ASYNC_CLIENT:
        return {}
    url, service_key = _config()
    now_iso = datetime.now(timezone.utc).isoformat()
    found: Dict[str, Any] = {}
    try:
        client = _shared_client()
        for i in range(0, len(wanted), _READ_CHUNK):
            chunk = wanted[i : i + _READ_CHUNK]
            resp = await client.get(
                f"{url}/rest/v1/{_TABLE}",
                params={
                    "select": "key,value",
                    "key": f"in.({_quote_in_list(chunk)})",
                    "expires_at": f"gt.{now_iso}",
                },
                headers=_headers(service_key),
                timeout=_READ_TIMEOUT,
            )
            if resp.status_code != 200:
                _note_failure(resp)
                return found
            for row in resp.json() or []:
                if isinstance(row, dict) and row.get("key") in chunk:
                    found[row["key"]] = row.get("value")
        _note_success()
    except Exception as e:
        logger.info("Enrichment cache read failed: %r", e)
        _note_failure()
    return found


async def _write(rows: List[Dict[str, Any]]) -> None:
    url, service_key = _config()
    headers = dict(_headers(service_key))
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    try:
        client = _shared_client()
        for i in range(0, len(rows), _WRITE_CHUNK):
            resp = await client.post(
                f"{url}/rest/v1/{_TABLE}",
                params={"on_conflict": "key"},
                headers=headers,
                content=json.dumps(rows[i : i + _WRITE_CHUNK]),
            )
            if resp.status_code not in (200, 201, 204):
                _note_failure(resp)
                return
        _note_success()
    except Exception as e:
        logger.info("Enrichment cache write failed: %r", e)
        _note_failure()


def put_many(items: Iterable[Tuple[str, Any, float]]) -> None:
    """Schedules an upsert of (key, value, ttl_seconds) rows in the background. Never blocks or raises."""
    if not is_enabled() or httpx.AsyncClient is not _ORIG_ASYNC_CLIENT:
        return
    now = datetime.now(timezone.utc)
    rows: List[Dict[str, Any]] = []
    for key, value, ttl in items:
        if not valid_key(key):
            continue
        try:
            encoded = json.dumps(value, ensure_ascii=False)
        except (TypeError, ValueError):
            continue
        if len(encoded) > _MAX_VALUE_CHARS:
            continue
        rows.append({
            "key": key,
            "value": value,
            "expires_at": (now + timedelta(seconds=max(60.0, float(ttl)))).isoformat(),
        })
    if not rows:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if len(_pending_writes) >= _MAX_PENDING_WRITES:
        return  # Supabase is slow: drop cache writes rather than pile up tasks
    task = loop.create_task(_write(rows))
    _pending_writes.add(task)
    task.add_done_callback(_pending_writes.discard)


async def drain_pending_writes_for_tests() -> None:
    if _pending_writes:
        await asyncio.gather(*list(_pending_writes), return_exceptions=True)
