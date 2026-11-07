"""
Append-only activity log (Supabase table `public.activity_log`, see README).

One row per meaningful user action:
  * every AI operation (generate / refine / chat / quiz / who-am-i / event suggestion /
    image generation ...) - success, failure, cancellation or "no info" verdict, with the
    content mode (classic/kids), search mode (fast/web_search), key tier, duration,
    tokens, estimated cost and number of AI images produced;
  * every completed game (score, rounds, duration).

Deliberately NOT logged (high-volume / low analytical value / private): job polling, quota
checks, Wikipedia/geocode/YouTube lookups, timeline views and saves (the `timelines` table
already holds that), AI replies, chat history, image bytes, IP addresses.

Writes are fire-and-forget on a small background thread pool so a slow or missing table can
never delay or break the user's request. Token/cost/image counters are collected through a
ContextVar, so deep service code (gemini_service) can report usage without signature changes.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
import threading
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger("ChroniXActivity")

ACTIVITY_TABLE = "activity_log"

AI_ACTIONS = {
    "generate_timeline",
    "generate_from_files",
    "generate_from_photo_prompt",
    "refine_timeline",
    "chat",
    "chat_attach_files",
    "generate_quiz",
    "generate_whoami",
    "generate_podcast",
    "podcast_audio",
    "suggest_event",
    "generate_image",
    "polish_text",
    "book_import",
    "story_overview",
}
GAME_ACTION = "game_completed"
PODCAST_LISTEN_ACTION = "podcast_listen"

MAX_PROMPT_CHARS = 500
MAX_ERROR_CHARS = 300

_TIMEOUT = httpx.Timeout(8.0, connect=4.0)
_FAILURE_COOLDOWN = 300.0
_disabled_until: float = 0.0
_PAUSE_STATUSES = frozenset({401, 403, 404, 429})
_MAX_PENDING = max(100, int(os.getenv("ACTIVITY_LOG_MAX_PENDING", "5000") or 5000))
_DROP_WARNING_INTERVAL = 60.0
_pending_cond = threading.Condition()
_pending = 0
_dropped_since_warning = 0
_last_drop_warning = 0.0
_ORIG_HTTP_CLIENT = httpx.Client
_HTTP_CLIENT_LOCK = threading.Lock()
_SHARED_HTTP_CLIENT: Optional[httpx.Client] = None


@contextmanager
def _activity_http_client():
    """Reuse a persistent sync httpx.Client for background activity inserts."""
    global _SHARED_HTTP_CLIENT
    if httpx.Client is not _ORIG_HTTP_CLIENT:
        client_cls = httpx.Client
        with client_cls(timeout=_TIMEOUT) as client:
            yield client
        return
    with _HTTP_CLIENT_LOCK:
        if _SHARED_HTTP_CLIENT is None or _SHARED_HTTP_CLIENT.is_closed:
            _SHARED_HTTP_CLIENT = _ORIG_HTTP_CLIENT(
                timeout=_TIMEOUT,
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=4),
            )
        client = _SHARED_HTTP_CLIENT
    yield client
# SC-13: each AI operation is one `record_ai_spend` RPC (spend counters + activity row) when the
# migration is applied, so a few workers keep up with well over 10 operations per second.
_ACTIVITY_WORKERS = max(1, min(32, int(os.getenv("ACTIVITY_LOG_WORKERS", "4") or 4)))
_executor = ThreadPoolExecutor(max_workers=_ACTIVITY_WORKERS, thread_name_prefix="activity-log")

_current: ContextVar[Optional[Dict[str, Any]]] = ContextVar("chronix_activity_record", default=None)


def _config() -> tuple[str, str]:
    return os.getenv("SUPABASE_URL", "").rstrip("/"), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def is_enabled() -> bool:
    if os.getenv("ACTIVITY_LOG_ENABLED", "true").strip().lower() in ("0", "false", "no", "off"):
        return False
    url, key = _config()
    return bool(url and key)


def _truncate(value: Optional[str], limit: int) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text if len(text) <= limit else text[: limit - 1] + "…"


def search_mode_for(enable_grounding: Optional[bool]) -> str:
    return "web_search" if enable_grounding else "fast"


def normalize_content_mode(mode: Optional[str]) -> Optional[str]:
    return mode if mode in ("classic", "kids") else None


def normalize_input_method(method: Optional[str], has_text: bool = True) -> Optional[str]:
    """'typed' | 'voice' (microphone dictation) | 'url' (?prompt= link); None when no text was entered."""
    if not has_text:
        return None
    return method if method in ("typed", "voice", "url") else "typed"


# --- Usage reporting hooks (called from gemini_service / main) -----------------------

def record_token_usage(summary: Optional[Dict[str, Any]], is_auxiliary: bool = False) -> None:
    """Adds one Gemini call's token/cost summary (log_token_usage_summary output) to the active record."""
    rec = _current.get()
    if rec is None or not isinstance(summary, dict):
        return
    try:
        rec["input_tokens"] += int(summary.get("promptTokens") or 0)
        rec["output_tokens"] += int(summary.get("candidatesTokens") or 0)
        rec["thinking_tokens"] += int(summary.get("thoughtsTokens") or 0)
        rec["cost_usd"] += float(summary.get("estimatedCostUsd") or 0.0)
        model = summary.get("model")
        if model:
            if not is_auxiliary and (not rec.get("model") or rec.get("_model_is_auxiliary")):
                rec["model"] = str(model)[:80]
                rec["_model_is_auxiliary"] = False
            elif is_auxiliary and not rec.get("model"):
                rec["model"] = str(model)[:80]
                rec["_model_is_auxiliary"] = True
        breakdown = summary.get("breakdown") or {}
        if isinstance(breakdown, dict) and breakdown.get("grounding"):
            rec["web_search_used"] = True
        grounding_queries = int(summary.get("groundingQueries") or 0)
        if grounding_queries > 0:
            rec["details"]["grounding_queries"] = rec["details"].get("grounding_queries", 0) + grounding_queries
        cached_tokens = int(summary.get("cachedTokens") or 0)
        if cached_tokens > 0:
            rec["details"]["cached_tokens"] = rec["details"].get("cached_tokens", 0) + cached_tokens
    except Exception:  # never let analytics break an AI call
        pass


def record_ai_image(
    model: Optional[str] = None,
    cost_usd: float = 0.0,
    input_tokens: int = 0,
    output_tokens: int = 0,
    thinking_tokens: int = 0,
) -> None:
    """Counts one successfully generated AI image (manual or automatic fallback) on the active record."""
    rec = _current.get()
    if rec is None:
        return
    rec["ai_images"] += 1
    if input_tokens and input_tokens > 0:
        rec["input_tokens"] += int(input_tokens)
    if output_tokens and output_tokens > 0:
        rec["output_tokens"] += int(output_tokens)
    if thinking_tokens and thinking_tokens > 0:
        rec["thinking_tokens"] += int(thinking_tokens)
    if cost_usd and cost_usd > 0:
        rec["cost_usd"] += float(cost_usd)
    if model and not rec.get("image_model"):
        rec["image_model"] = str(model)[:80]


def record_key_rotation() -> None:
    """Notes that a quota-exhausted key forced a fallback to another key during the active action."""
    rec = _current.get()
    if rec is not None:
        rec["details"]["key_rotations"] = rec["details"].get("key_rotations", 0) + 1


def record_extra_cost(
    cost_usd: float,
    model: Optional[str] = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    thinking_tokens: int = 0,
) -> None:
    """Adds a non-token cost (e.g. text-to-speech audio) and optional token counts to the active record."""
    rec = _current.get()
    if rec is None:
        return
    has_tokens = bool((input_tokens and input_tokens > 0) or (output_tokens and output_tokens > 0) or (thinking_tokens and thinking_tokens > 0))
    has_cost = bool(cost_usd and cost_usd > 0)
    if not has_cost and not has_tokens:
        return
    if input_tokens and input_tokens > 0:
        rec["input_tokens"] += int(input_tokens)
    if output_tokens and output_tokens > 0:
        rec["output_tokens"] += int(output_tokens)
    if thinking_tokens and thinking_tokens > 0:
        rec["thinking_tokens"] += int(thinking_tokens)
    if has_cost:
        rec["cost_usd"] += float(cost_usd)
    if model and not rec.get("model"):
        rec["model"] = str(model)[:80]


# --- Writing ---------------------------------------------------------------------------

def _pause(reason: str) -> None:
    global _disabled_until
    _disabled_until = time.time() + _FAILURE_COOLDOWN
    logger.error(f"{reason} Pausing activity logging for {_FAILURE_COOLDOWN:.0f}s.")


def _post_row(row: Dict[str, Any]) -> None:
    try:
        _post_row_once(row)
    finally:
        _release_slot()


def _post_row_once(row: Dict[str, Any]) -> None:
    from services.deleted_users import is_recently_deleted

    if is_recently_deleted(row.get("user_id")):
        return
    url, key = _config()
    try:
        with _activity_http_client() as client:
            resp = client.post(
                f"{url}/rest/v1/{ACTIVITY_TABLE}",
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json=row,
            )
    except Exception as e:
        # Connection errors and timeouts mean the store is struggling: back off for everyone.
        _pause(f"Activity log insert failed ({e.__class__.__name__}).")
        return
    status = resp.status_code
    if status in (200, 201, 204):
        return
    # 5xx / 429 are store-wide trouble; 401/403/404 mean a missing table or a bad key, which every
    # row would hit too. Any other 4xx is about this one row: drop it and keep logging the rest.
    if status >= 500 or status in _PAUSE_STATUSES:
        _pause(
            f"Activity log insert failed (HTTP {status}: {resp.text[:200]}). "
            f"Ensure the '{ACTIVITY_TABLE}' table exists (see README)."
        )
        return
    logger.warning(
        f"Activity log dropped one rejected row (HTTP {status}: {resp.text[:200]}; action={row.get('action')})."
    )


def _claim_slot() -> bool:
    """Bounds the executor queue so a slow store can't grow memory without limit."""
    global _pending, _dropped_since_warning, _last_drop_warning
    with _pending_cond:
        if _pending >= _MAX_PENDING:
            _dropped_since_warning += 1
            now = time.time()
            if now - _last_drop_warning >= _DROP_WARNING_INTERVAL:
                logger.warning(
                    f"Activity log queue is full ({_MAX_PENDING} pending); dropped "
                    f"{_dropped_since_warning} new row(s)."
                )
                _last_drop_warning = now
                _dropped_since_warning = 0
            return False
        _pending += 1
        return True


def _release_slot() -> None:
    global _pending
    with _pending_cond:
        _pending = max(0, _pending - 1)
        if _pending == 0:
            _pending_cond.notify_all()


def pending_count() -> int:
    with _pending_cond:
        return _pending


def flush(timeout: float = 10.0) -> bool:
    """Waits (up to `timeout` seconds) until every queued activity insert has finished.
    Account deletion calls this before deleting the user's rows, so a queued insert can't land after."""
    deadline = time.time() + max(0.0, timeout)
    with _pending_cond:
        while _pending > 0:
            remaining = deadline - time.time()
            if remaining <= 0:
                return False
            _pending_cond.wait(remaining)
    return True


def submit_row(row: Dict[str, Any]) -> None:
    """Queues a row for insertion without blocking the caller."""
    if not is_enabled() or time.time() < _disabled_until:
        return
    clean = {k: v for k, v in row.items() if v is not None}
    if not _claim_slot():
        return
    try:
        _executor.submit(_post_row, clean)
    except RuntimeError:  # executor shut down (interpreter exit)
        _release_slot()


def _submit_operation(user: Optional[Dict[str, Any]], community_usd: float, identity_usd: float, row: Dict[str, Any]) -> None:
    """
    Meters one AI operation's spend and writes its activity row. With a durable store this is one
    background `record_ai_spend` RPC (SC-13), falling back to the per-counter calls plus the REST
    insert when the function is missing. Spend is never dropped for a full queue (the row may be).
    """
    if community_usd <= 0 and identity_usd <= 0:
        submit_row(row)
        return
    from services.quota_service import (
        get_request_client_ip,
        record_community_spend_usd,
        record_identity_spend_usd,
        usage_store_is_durable,
    )
    client_ip = get_request_client_ip()
    if not usage_store_is_durable():
        # Local file: cheap, and keeps dev / tests synchronous.
        if community_usd > 0:
            record_community_spend_usd(community_usd)
        if identity_usd > 0:
            record_identity_spend_usd(user, client_ip, identity_usd)
        submit_row(row)
        return
    clean = None
    if is_enabled() and time.time() >= _disabled_until:
        clean = {k: v for k, v in row.items() if v is not None}
    holds_slot = bool(clean) and _claim_slot()
    if clean and not holds_slot:
        clean = None
    try:
        _executor.submit(_record_operation, user, client_ip, community_usd, identity_usd, clean, holds_slot)
    except RuntimeError:  # executor shut down (interpreter exit)
        if holds_slot:
            _release_slot()


def _record_operation(
    user: Optional[Dict[str, Any]],
    client_ip: Optional[str],
    community_usd: float,
    identity_usd: float,
    row: Optional[Dict[str, Any]],
    holds_slot: bool,
) -> None:
    from services import quota_service
    from services.deleted_users import is_recently_deleted

    try:
        if row is not None and is_recently_deleted(row.get("user_id")):
            row = None
        status, body = quota_service.record_ai_spend_once(user, client_ip, community_usd, identity_usd, row)
        if status == "missing":
            if community_usd > 0:
                quota_service.record_community_spend_usd(community_usd)
            if identity_usd > 0:
                quota_service.record_identity_spend_usd(user, client_ip, identity_usd)
            if row is not None:
                _post_row_once(row)
        elif status == "failed":
            # The RPC may have committed, so the counters are not retried (like any other lost
            # metering call); the analytics row still gets its own attempt.
            logger.warning(f"Spend metering call failed: ${community_usd or identity_usd:.6f} may not be metered.")
            if row is not None:
                _post_row_once(row)
        elif row is not None and not (body or {}).get("activity_inserted"):
            _post_row_once(row)
    except Exception as e:
        logger.warning(f"Could not meter an AI operation: {e}")
    finally:
        if holds_slot:
            _release_slot()


def _user_fields(user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    user = user or {}
    return {
        "user_id": user.get("id") or None,
        "is_guest": bool(user.get("is_anonymous", False)) or not user.get("id"),
        "is_admin": bool(user.get("is_admin", False)),
    }


def _new_record(action: str, user: Optional[Dict[str, Any]], **fields: Any) -> Dict[str, Any]:
    rec: Dict[str, Any] = {
        "action": action,
        **_user_fields(user),
        "status": "success",
        "content_mode": normalize_content_mode(fields.get("content_mode")),
        "search_mode": fields.get("search_mode"),
        "key_tier": fields.get("key_tier"),
        "timeline_id": fields.get("timeline_id"),
        "prompt": _truncate(fields.get("prompt"), MAX_PROMPT_CHARS),
        "language": fields.get("language"),
        "result_count": None,
        "error": None,
        "model": None,
        "image_model": None,
        "input_tokens": 0,
        "output_tokens": 0,
        "thinking_tokens": 0,
        "cost_usd": 0.0,
        "ai_images": 0,
        "web_search_used": False,
        "details": dict(fields.get("details") or {}),
    }
    return rec


def _record_to_row(rec: Dict[str, Any], duration_ms: int) -> Dict[str, Any]:
    details = {k: v for k, v in (rec.get("details") or {}).items() if v is not None}
    if rec.get("image_model"):
        details.setdefault("image_model", rec["image_model"])
    if rec.get("search_mode") == "web_search":
        details["web_search_used"] = bool(rec.get("web_search_used"))
    return {
        "action": rec["action"],
        "status": rec["status"],
        "user_id": rec["user_id"],
        "is_guest": rec["is_guest"],
        "is_admin": rec["is_admin"],
        "content_mode": rec.get("content_mode"),
        "search_mode": rec.get("search_mode"),
        "key_tier": rec.get("key_tier"),
        "timeline_id": (str(rec["timeline_id"])[:120] if rec.get("timeline_id") else None),
        "prompt": rec.get("prompt"),
        "language": (str(rec["language"])[:10] if rec.get("language") else None),
        "result_count": rec.get("result_count"),
        "duration_ms": duration_ms,
        "model": rec.get("model"),
        "input_tokens": rec["input_tokens"] or None,
        "output_tokens": rec["output_tokens"] or None,
        "thinking_tokens": rec["thinking_tokens"] or None,
        "cost_usd": round(rec["cost_usd"], 6) if rec["cost_usd"] else None,
        "ai_images": rec["ai_images"] or None,
        "error": _truncate(rec.get("error"), MAX_ERROR_CHARS),
        "details": details or None,
    }


def _status_for_exception(exc: BaseException) -> tuple[str, str]:
    if isinstance(exc, asyncio.CancelledError):
        return "cancelled", "Cancelled"
    if exc.__class__.__name__ == "InsufficientSubjectInfoError":
        return "no_info", str(exc)
    detail = getattr(exc, "detail", None)
    if detail is not None:
        status_code = getattr(exc, "status_code", None)
        msg = detail.get("message") if isinstance(detail, dict) else detail
        return "error", f"[{status_code}] {msg}" if status_code else str(msg)
    return "error", f"{exc.__class__.__name__}: {exc}"


@asynccontextmanager
async def track_ai_activity(action: str, user: Optional[Dict[str, Any]], **fields: Any):
    """
    Wraps one AI operation. Yields a mutable record; the body may set `timeline_id`,
    `result_count`, `language`, `content_mode` or add `details[...]`. Tokens, cost, AI images
    and key rotations are collected automatically from nested calls. The row is written when
    the block exits - including on errors and cancellation (the exception is re-raised).
    """
    rec = _new_record(action, user, **fields)
    token = _current.set(rec)
    started = time.monotonic()
    try:
        yield rec
    except BaseException as exc:
        rec["status"], rec["error"] = _status_for_exception(exc)
        raise
    finally:
        _current.reset(token)
        try:
            cost = float(rec.get("cost_usd") or 0)
            not_admin = not rec.get("is_admin")
            # Community ledger: everything not paid by the caller's own key or an admin's key.
            community_usd = cost if not_admin and rec.get("key_tier") not in ("custom", "admin_paid") and cost > 0 else 0.0
            # Real-cost backstop: meter what the server's paid key actually spent for this caller.
            identity_usd = cost if rec.get("key_tier") == "paid" and not_admin and cost > 0 else 0.0
            row = _record_to_row(rec, int((time.monotonic() - started) * 1000))
            _submit_operation(user, community_usd, identity_usd, row)
        except Exception as e:
            logger.info(f"Could not queue activity row: {e}")


def apply_timeline_result(rec: Dict[str, Any], timeline: Any) -> None:
    """Fills timeline-derived fields (id, event count, language, mode) from a TimelineData or dict."""
    if timeline is None:
        return
    get = timeline.get if isinstance(timeline, dict) else (lambda k, d=None: getattr(timeline, k, d))
    rec["timeline_id"] = get("id") or rec.get("timeline_id")
    articles = get("articles") or []
    rec["result_count"] = len(articles)
    rec["language"] = get("detectedLanguage") or rec.get("language")
    if not rec.get("content_mode"):
        rec["content_mode"] = normalize_content_mode(get("contentMode"))


def log_game_completed(user: Optional[Dict[str, Any]], **fields: Any) -> None:
    """Writes one finished-game row (no AI involved; scores only)."""
    rec = _new_record(GAME_ACTION, user, **fields)
    rec["result_count"] = fields.get("result_count")
    submit_row(_record_to_row(rec, int(fields.get("duration_ms") or 0)))


def log_podcast_listen(user: Optional[Dict[str, Any]], **fields: Any) -> None:
    """Writes one podcast listening row (play start, completion or session summary)."""
    rec = _new_record(PODCAST_LISTEN_ACTION, user, **fields)
    rec["result_count"] = fields.get("result_count")
    submit_row(_record_to_row(rec, int(fields.get("duration_ms") or 0)))


def reassign_user_activity(from_user_id: str, to_user_id: str) -> None:
    """After a guest signs in and claims their work, attributes their guest activity to the account
    (rows keep is_guest=true, so pre-signup activity stays distinguishable)."""
    if not is_enabled() or not from_user_id or not to_user_id or from_user_id == to_user_id:
        return

    def _patch() -> None:
        url, key = _config()
        try:
            with _activity_http_client() as client:
                resp = client.patch(
                    f"{url}/rest/v1/{ACTIVITY_TABLE}",
                    headers={
                        "apikey": key,
                        "Authorization": f"Bearer {key}",
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal",
                    },
                    params={"user_id": f"eq.{from_user_id}"},
                    json={"user_id": to_user_id},
                )
            if resp.status_code not in (200, 204):
                logger.warning(f"Activity log reassignment failed (HTTP {resp.status_code}: {resp.text[:200]})")
        except Exception as e:
            logger.warning(f"Activity log reassignment failed: {e}")

    try:
        _executor.submit(_patch)
    except RuntimeError:
        pass


def delete_user_activity(user_id: str) -> bool:
    """Delete activity_log rows (prompts and user linkage) when an account is erased."""
    if not user_id:
        return True
    url, key = _config()
    if not (url and key):
        return True
    try:
        with _activity_http_client() as client:
            resp = client.delete(
                f"{url}/rest/v1/{ACTIVITY_TABLE}",
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "Prefer": "return=minimal",
                },
                params={"user_id": f"eq.{user_id}"},
            )
        if resp.status_code in (200, 204, 404):
            return True
        logger.warning(f"Activity log user delete returned HTTP {resp.status_code}")
        return False
    except Exception as e:
        logger.warning(f"Activity log user delete failed: {e}")
        return False
