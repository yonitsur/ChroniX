import os
import re
import json
import uuid
import logging
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, Header, Body, Depends, Request, Response, status, File, Form, UploadFile, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
load_dotenv()

import urllib.parse
from models import (
    TimelineData,
    TimelineDate,
    GenerateTimelineRequest,
    RefineTimelineRequest,
    TimelineArticle,
    EventSuggestionRequest,
    TimelineChatRequest,
    TimelineChatResponse,
    TimelineChatOutput,
    TimelineQuizRequest,
    TimelineQuizResponse,
    QuizQuestion,
    TimelineWhoAmIRequest,
    TimelineWhoAmIResponse,
    WhoAmIItem,
    TimelinePodcastRequest,
    PodcastAudioRequest,
    PodcastListenReport,
    EventImageGenerationRequest,
    GameCompletedRequest,
)
from services.gemini_service import (
    generate_timeline_with_gemini,
    generate_timeline_from_files,
    refine_timeline_with_gemini,
    suggest_event_details,
    generate_event_image_with_gemini,
    chat_about_timeline,
    generate_timeline_quiz,
    generate_timeline_whoami,
    generate_timeline_podcast,
    default_host_names,
    clean_spoken_text,
    normalize_music_mood,
    PODCAST_FOCUSED_MAX_EVENTS,
    PODCAST_MUSIC_MOODS,
    normalize_event_dates,
    timeline_date_from_dict,
    date_sort_key,
    SUB_DAY_PRECISIONS,
    InsufficientSubjectInfoError,
)
from services.podcast_tts_service import (
    ENGINES,
    available_engines,
    default_engine_for_language,
    detect_effective_language,
    normalize_engine,
)
from services import podcast_audio, podcast_store
from prompts.timeline import normalize_content_mode
from services.wiki_enricher import (
    fetch_wikipedia_summary,
    search_wikipedia_candidates,
    search_geocode_candidates,
    enrich_events_with_wikipedia,
    wikimedia_http_client,
)
from services.storage import (
    list_all_timelines,
    find_matching_timelines,
    get_timeline_by_id,
    get_timeline_with_meta,
    get_timeline_access_meta,
    set_timeline_shared,
    save_timeline_data,
    delete_timeline_data,
    delete_all_user_timelines,
    ensure_data_dir,
    get_timeline_owner,
    get_timeline_chat,
    save_timeline_chat,
    transfer_user_timelines,
)
from services.auth_service import (
    get_current_user_optional,
    get_current_user_required,
    is_admin_user,
    is_guest_user,
    list_all_users,
    delete_supabase_user,
    resolve_guest_session_user,
)
from services.quota_service import (
    resolve_gemini_key,
    charge_premium_credits,
    get_user_quota_info,
    get_candidate_keys_for_request,
    get_next_free_key,
    mark_key_exhausted,
    get_guest_api_key_mode,
    get_guest_daily_limit,
    get_api_key_mode,
    get_registered_daily_limit,
    get_text_credit_cost,
    get_gemini_image_credit_cost,
    get_gemini_audio_credit_cost,
    get_gemini_audio_full_credit_cost,
    get_credit_costs,
    calculate_upload_credit_cost,
    refund_user_quota,
    increment_user_quota,
    usage_store_is_durable,
    get_community_ledger,
    record_community_donation_usd,
    set_community_ledger_totals,
    sync_historical_spend_from_activity_log,
    admin_sync_historical_spend,
    community_pool_reserved_for_tier,
    refund_community_paid_prompt,
)
from services.youtube_service import search_youtube_videos
from services.upload_security import (
    ALLOWED_UPLOAD_MIME_TYPES,
    ValidatedUploads,
    validate_and_read_uploads,
)
from services.activity_log import (
    track_ai_activity,
    apply_timeline_result,
    search_mode_for,
    normalize_input_method,
    record_key_rotation,
    log_game_completed,
    log_podcast_listen,
    record_extra_cost,
    reassign_user_activity,
)
import httpx
import asyncio

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ChroniXAPI")

ensure_data_dir()

if usage_store_is_durable():
    logger.info("AI usage quota store: Supabase (durable across restarts).")
else:
    logger.warning(
        "AI usage quota store: local JSON file. On ephemeral hosts (Render/Railway) every "
        "restart or redeploy RESETS all daily quotas. Configure SUPABASE_URL + "
        "SUPABASE_SERVICE_ROLE_KEY and create the ai_usage table (see README) to persist them."
    )

def get_client_ip(request: Request) -> str:
    """Extracts the client IP from proxy headers or direct connection."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"

class SimpleRateLimiter:
    """
    In-memory sliding-window rate limiter per client/user.
    Protects expensive AI endpoints from spam and wallet exhaustion.
    Admin users are completely exempt from rate limiting.
    Supports dynamic configuration via environment variables and refunding on cancellation.
    """
    def __init__(
        self,
        max_requests: int,
        window_seconds: int = 60,
        name: str = "endpoint",
        env_var: Optional[str] = None,
        guest_max_requests: Optional[int] = None,
    ):
        self.max_requests = max_requests
        self.guest_max_requests = guest_max_requests
        self.window_seconds = window_seconds
        self.name = name
        self.env_var = env_var
        self.records: Dict[str, list[float]] = defaultdict(list)

    @property
    def effective_max_requests(self) -> int:
        if self.env_var:
            raw = os.getenv(self.env_var, "").strip()
            if raw:
                try:
                    return int(raw)
                except ValueError:
                    pass
        return self.max_requests

    def effective_limit_for_user(
        self,
        actual_user: Optional[Dict[str, Any]],
        has_custom_key: bool = False,
    ) -> int:
        base = self.effective_max_requests
        if base <= 0:
            return base
        if (
            self.guest_max_requests is not None
            and not has_custom_key
            and (actual_user is None or is_guest_user(actual_user))
            and not (self.env_var and os.getenv(self.env_var, "").strip())
        ):
            base = self.guest_max_requests
        return base * 4 if has_custom_key else base

    def refund(self, identifier: str) -> None:
        """Removes the most recent request timestamp for identifier if present (e.g. after cancellation)."""
        if identifier in self.records and self.records[identifier]:
            self.records[identifier].pop()
            remaining = len(self.records[identifier])
            if not remaining:
                self.records.pop(identifier, None)
            logger.info(f"Rate limiter refund applied for {identifier} on {self.name} (remaining: {remaining})")

    def get_identifier(self, request: Request, user: Optional[Dict[str, Any]] = None) -> str:
        """Identify client by user_id if registered user, otherwise by guest IP."""
        actual_user = user if isinstance(user, dict) else None
        if actual_user and not is_guest_user(actual_user) and actual_user.get("id"):
            return f"user:{actual_user['id']}"
        ip = get_client_ip(request)
        return f"guest_ip:{ip}"

    async def __call__(
        self,
        request: Request,
        x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
        user: Optional[Dict[str, Any]] = Depends(get_current_user_optional)
    ):
        actual_user = user if isinstance(user, dict) else None

        # Admin is completely exempt from rate limits!
        if actual_user and is_admin_user(actual_user):
            return

        has_custom_key = bool(x_gemini_api_key and str(x_gemini_api_key).strip())
        effective_limit = self.effective_limit_for_user(actual_user, has_custom_key=has_custom_key)
        # If limit <= 0, rate limiting is disabled entirely
        if effective_limit <= 0:
            return

        identifier = self.get_identifier(request, actual_user)

        now = time.time()
        cutoff = now - self.window_seconds

        # Clean expired timestamps and prune empty identifier buckets
        kept = [t for t in self.records.get(identifier, ()) if t > cutoff]
        if kept:
            self.records[identifier] = kept
        else:
            self.records.pop(identifier, None)

        if len(self.records) > 512:
            for k, ts in list(self.records.items()):
                if not ts or ts[-1] <= cutoff:
                    self.records.pop(k, None)

        if len(kept) >= effective_limit:
            oldest = kept[0]
            retry_after = max(1, int(self.window_seconds - (now - oldest)))
            logger.warning(f"Rate limit exceeded for {identifier} on {self.name} ({len(kept)}/{effective_limit})")
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded for {self.name}. Please wait {retry_after} seconds before trying again.",
                headers={"Retry-After": str(retry_after)}
            )

        self.records[identifier].append(now)

timeline_rate_limiter = SimpleRateLimiter(
    max_requests=10,
    window_seconds=60,
    name="timeline generation",
    env_var="TIMELINE_RATE_LIMIT_PER_MINUTE"
)
# Dedicated non-refunded upload limiter: prevents start+cancel loops from flooding multipart
# parsing, server memory, or multimodal token intake without consuming rate-limit budget.
file_upload_rate_limiter = SimpleRateLimiter(
    max_requests=6,
    guest_max_requests=4,
    window_seconds=60,
    name="file upload",
    env_var="UPLOAD_RATE_LIMIT_PER_MINUTE",
)
event_suggest_rate_limiter = SimpleRateLimiter(max_requests=25, window_seconds=60, name="event suggestion")
# GET /api/timelines/{id} is reachable without login (shared links) — keep it generous but bounded.
shared_view_rate_limiter = SimpleRateLimiter(max_requests=60, window_seconds=60, name="timeline view")
media_search_rate_limiter = SimpleRateLimiter(max_requests=30, window_seconds=60, name="video search")
# Finished-game reports are tiny, but bound them so a misbehaving client can't flood the activity log.
game_activity_rate_limiter = SimpleRateLimiter(max_requests=20, window_seconds=60, name="game activity")

app = FastAPI(
    title="ChroniX Backend",
    description="Interactive visual chronology generator using Gemini and Wikipedia/Wikidata",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def health_check():
    has_api_key = bool(os.getenv("GEMINI_API_KEY"))
    return {
        "status": "ok",
        "has_server_gemini_key": has_api_key,
        "message": "ChroniX API is running"
    }

@app.get("/api/user/quota")
async def get_current_user_quota(
    request: Request,
    response: Response,
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional)
):
    """
    Get current user's daily prompt quota status.
    Supports both authenticated users and anonymous/guest visitors.
    Marked no-store so mobile browsers never serve a stale cached count.
    """
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    return await asyncio.to_thread(get_user_quota_info, user, get_client_ip(request))

@app.get("/api/guest-policy")
async def get_guest_policy():
    """
    Public, no-auth endpoint exposing the CURRENT guest quota policy (GUEST_API_KEY_MODE
    and its configured limits) and registered user quota policy so the pre-login screen can
    render accurate copy before any guest session/user object exists.
    """
    mode = get_guest_api_key_mode()
    reg_mode = get_api_key_mode()
    guest_limit = get_guest_daily_limit() if mode == "limited" else -1
    reg_limit = get_registered_daily_limit() if reg_mode == "limited" else -1
    return {
        "mode": mode,
        "daily_paid_limit": guest_limit,
        "guest_mode": mode,
        "guest_daily_limit": guest_limit,
        "registered_mode": reg_mode,
        "registered_daily_limit": reg_limit,
        "credit_costs": get_credit_costs(),
    }

# Substrings that signal a key hit its quota / rate limit / billing exhaustion and should be rotated away from.
QUOTA_ERROR_INDICATORS = [
    "prepayment credits",
    "quota",
    "resource_exhausted",
    "429",
    "rate limit",
    "billing",
    "billing_disabled",
    "credit",
    "prepayment",
]

# Broader set (quota OR Google-side transient overload) where suggesting a personal API key
# to escape the shared free/paid key pool is actually useful advice to surface to the user.
BYOK_SUGGESTION_INDICATORS = QUOTA_ERROR_INDICATORS + ["overloaded", "unavailable", "high demand"]

def _is_quota_error(error: Exception) -> bool:
    err_lower = str(error).lower()
    return any(ind in err_lower for ind in QUOTA_ERROR_INDICATORS)

def _should_suggest_byok(error: Exception) -> bool:
    err_lower = str(error).lower()
    return any(ind in err_lower for ind in BYOK_SUGGESTION_INDICATORS)

def format_api_error_for_user(error: Exception, user: Optional[Dict[str, Any]] = None) -> str:
    err_msg = str(error)
    if is_admin_user(user):
        return err_msg
    if _should_suggest_byok(error):
        if is_guest_user(user):
            return (
                "The guest AI service is temporarily at capacity (all shared keys, including backups, reached their limits). "
                "Sign in to access the standard high-speed AI tier, or add a personal Gemini API key in Settings (a paid key is recommended for reliable access)."
            )
        return (
            "The shared AI service is temporarily at capacity (high demand or quota limits across all shared keys, including backups). "
            "For reliable, uninterrupted access, we recommend adding a paid personal Gemini API key in Settings (a free key can help somewhat, though free-tier limits still apply), or try again shortly."
        )
    return err_msg

async def run_with_key_failover(operation, api_key: Optional[str], key_tier: str, label: str = "AI request"):
    """
    Runs `operation(key)` (an async callable taking one api_key arg), rotating across
    available keys when a quota, rate-limit, or billing exhaustion error is hit.
    - Paid tier and server-key requests attempt the paid key first, automatically falling
      back to candidate free keys if billing budget or quota is depleted.
    - Free tier requests rotate across healthy candidate free keys.
    - Custom BYOK requests use the user's personal key.
    Exhausted keys are put on cooldown so subsequent requests don't waste time on them.
    """
    if key_tier == "custom":
        keys_to_try = [api_key] if api_key else []
    else:
        # For free, paid, admin_paid: get full candidate chain including free fallbacks
        keys_to_try = get_candidate_keys_for_request(api_key)

    if not keys_to_try:
        keys_to_try = [api_key] if api_key else []

    last_error = None
    server_paid_key = os.getenv("GEMINI_API_KEY", "").strip()

    for current_key in keys_to_try:
        try:
            return await operation(current_key)
        except InsufficientSubjectInfoError:
            # Honest "unknown subject" verdict, not a key problem: never rotate keys/regenerate.
            raise
        except Exception as e:
            last_error = e
            if _is_quota_error(e) and current_key != keys_to_try[-1]:
                record_key_rotation()
                # 600s (10m) cooldown for paid key billing depletion, 300s for free keys
                cooldown = 600.0 if (server_paid_key and current_key == server_paid_key) else 300.0
                mark_key_exhausted(current_key, cooldown_seconds=cooldown)
                if server_paid_key and current_key == server_paid_key:
                    logger.warning(
                        f"Paid Gemini key quota/billing exhausted during {label} ({e}). "
                        f"Seamlessly falling back to candidate free key..."
                    )
                else:
                    logger.warning(f"Key quota/rate-limit hit during {label}, rotating to next candidate free key...")
                continue
            if _is_quota_error(e):
                mark_key_exhausted(current_key)
            raise
    if last_error:
        raise last_error
    raise Exception(f"Failed to complete {label}")


# --- Background AI jobs ---------------------------------------------------------
# AI calls (generate / refine / chat) can take a while, and a single long-lived
# HTTP request is killed when a mobile browser backgrounds the tab (causing the
# client to stall forever). Instead we run them as background tasks and let the
# client poll for the result, which survives the connection being dropped and
# resumed. Safe as an in-memory store because the app runs as a single uvicorn worker.
_AI_JOBS: Dict[str, Dict[str, Any]] = {}
_JOB_TTL_SECONDS = 300  # keep finished jobs available for 5 minutes
_PENDING_JOB_TTL_SECONDS = 900
_DELIVERED_JOB_TTL_SECONDS = 30  # evict already-delivered results quickly after client poll
_MAX_FINISHED_AI_JOBS = 6


def _is_ai_job_expired(job: Dict[str, Any], now: float) -> bool:
    if job.get("status") == "pending":
        return now - job.get("updated", now) > _PENDING_JOB_TTL_SECONDS
    delivered_at = job.get("delivered_at")
    if delivered_at is not None and (now - delivered_at) > _DELIVERED_JOB_TTL_SECONDS:
        return True
    return now - job.get("updated", now) > _JOB_TTL_SECONDS


def _cleanup_ai_jobs() -> None:
    now = time.time()
    stale = [
        jid for jid, job in _AI_JOBS.items()
        if _is_ai_job_expired(job, now) and (
            job is not None
        )
    ]
    for jid in stale:
        _AI_JOBS.pop(jid, None)
    finished = [
        (job.get("updated", 0.0), jid)
        for jid, job in _AI_JOBS.items()
        if job.get("status") != "pending"
    ]
    if len(finished) > _MAX_FINISHED_AI_JOBS:
        finished.sort()
        for _, jid in finished[: len(finished) - _MAX_FINISHED_AI_JOBS]:
            _AI_JOBS.pop(jid, None)


def _max_concurrent_jobs_per_client() -> int:
    raw = os.getenv("MAX_CONCURRENT_JOBS_PER_USER", "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return 2


def _enforce_concurrent_job_limit(user: Optional[Dict[str, Any]], client_ip: Optional[str]) -> None:
    """
    Prevents a single client/account from queuing unbounded concurrent background AI jobs
    (which would pin large upload buffers in RAM or bypass per-request quotas during flight).
    """
    if user and is_admin_user(user):
        return
    max_concurrent = _max_concurrent_jobs_per_client()
    if max_concurrent <= 0:
        return
    _cleanup_ai_jobs()
    uid = user.get("id") if isinstance(user, dict) else None
    guest = is_guest_user(user) if isinstance(user, dict) else True
    active = 0
    for job in _AI_JOBS.values():
        if job.get("status") != "pending":
            continue
        if uid and job.get("user_id") == uid:
            active += 1
        elif guest and client_ip and client_ip != "unknown" and job.get("client_ip") == client_ip:
            active += 1
    if active >= max_concurrent:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many generations are already running. Please wait for the current one to finish or cancel it.",
        )


def _create_ai_job(
    user: Dict[str, Any],
    client_ip: Optional[str] = None,
    rate_limit_identifier: Optional[str] = None,
    incremented_quota: bool = False,
    pool_reserved: bool = False,
    quota_credits: Optional[int] = None,
) -> str:
    _cleanup_ai_jobs()
    job_id = uuid.uuid4().hex
    _AI_JOBS[job_id] = {
        "status": "pending",
        "user_id": user.get("id"),
        "user": user,
        "client_ip": client_ip,
        "rate_limit_identifier": rate_limit_identifier,
        "incremented_quota": incremented_quota,
        "quota_credits": max(1, int(quota_credits if quota_credits is not None else get_text_credit_cost())),
        # True only when resolve_gemini_key actually reserved a Community Pool slot for this job.
        "pool_reserved": pool_reserved,
        "task": None,
        "updated": time.time(),
    }
    return job_id


def _transfer_ai_jobs(from_user_id: Optional[str], to_user_id: Optional[str]) -> int:
    """
    Hands in-flight/finished AI jobs of a claimed guest session over to the signed-in account,
    so a guest who signs in mid-generation can keep polling (and receive) their result.
    Only `user_id` (access ownership) moves; `user` stays as-is so quota refunds still credit
    whoever was actually charged.
    """
    if not from_user_id or not to_user_id or from_user_id == to_user_id:
        return 0
    moved = 0
    for job in _AI_JOBS.values():
        if job.get("user_id") == from_user_id:
            job["user_id"] = to_user_id
            moved += 1
    return moved


def _job_owner_id(job_id: Optional[str], fallback_user: Dict[str, Any]) -> Optional[str]:
    """Current owner of a job (may change if a guest signs in while it runs)."""
    job = _AI_JOBS.get(job_id) if job_id else None
    if job and job.get("user_id"):
        return job.get("user_id")
    return fallback_user.get("id")


def _refund_job_quota_and_limits(job: Optional[Dict[str, Any]], user: Dict[str, Any]) -> None:
    if not job:
        return
    rl_id = job.get("rate_limit_identifier")
    if rl_id:
        try:
            timeline_rate_limiter.refund(rl_id)
        except Exception:
            pass
        job["rate_limit_identifier"] = None
    pool_reserved = bool(job.get("pool_reserved"))
    credits = max(1, int(job.get("quota_credits") or get_text_credit_cost()))
    if job.get("incremented_quota"):
        client_ip = job.get("client_ip")
        saved_user = job.get("user") or user
        try:
            refund_user_quota(saved_user, client_ip=client_ip, refund_pool=pool_reserved, credits=credits)
            logger.info(f"Refunded {credits} daily credit(s) for user {saved_user.get('id')} / IP {client_ip}")
        except Exception as e:
            logger.warning(f"Failed to refund quota for user {saved_user.get('id')}: {e}")
        job["incremented_quota"] = False
    elif pool_reserved:
        # e.g. unlimited mode: no per-user count was recorded, but pool credit(s) were reserved.
        try:
            refund_community_paid_prompt(credits=credits)
        except Exception as e:
            logger.warning(f"Failed to refund community pool slot: {e}")
    job["pool_reserved"] = False


async def _run_ai_job(job_id: str, operation, user: Dict[str, Any], label: str) -> None:
    """Run an async `operation()` returning a JSON-serializable dict, recording status on the job."""
    try:
        result = await operation()
        job = _AI_JOBS.get(job_id)
        if job is not None:
            if job.get("status") == "cancelled":
                return
            job.update(status="done", result=result, updated=time.time())
    except asyncio.CancelledError:
        logger.info(f"{label} job {job_id} cancelled.")
        job = _AI_JOBS.get(job_id)
        if job is not None:
            _refund_job_quota_and_limits(job, user)
            job.update(status="cancelled", detail="Cancelled by user", updated=time.time())
        raise
    except InsufficientSubjectInfoError as ie:
        # Not a failure: the AI honestly has no reliable facts (e.g. a private person).
        # Refund the attempt and let the client offer upload / paste / manual alternatives.
        job = _AI_JOBS.get(job_id)
        if job is not None:
            if job.get("status") == "cancelled":
                return
            _refund_job_quota_and_limits(job, user)
            job.update(
                status="error",
                status_code=422,
                code=ie.code,
                subject=ie.subject,
                detail=str(ie),
                updated=time.time(),
            )
    except HTTPException as he:
        job = _AI_JOBS.get(job_id)
        if job is not None:
            if job.get("status") == "cancelled":
                return
            _refund_job_quota_and_limits(job, user)
            job.update(status="error", status_code=he.status_code, detail=str(he.detail), updated=time.time())
    except ValueError as ve:
        job = _AI_JOBS.get(job_id)
        if job is not None:
            if job.get("status") == "cancelled":
                return
            _refund_job_quota_and_limits(job, user)
            job.update(status="error", status_code=400, detail=str(ve), updated=time.time())
    except Exception as e:
        job = _AI_JOBS.get(job_id)
        if job is not None and job.get("status") == "cancelled":
            return
        logger.error(f"Error in {label} job: {e}", exc_info=True)
        if job is not None:
            _refund_job_quota_and_limits(job, user)
            job.update(status="error", status_code=500, detail=format_api_error_for_user(e, user), updated=time.time())
    finally:
        # Release the finished Task and its coroutine/closure frame (e.g. up to 30 MB of upload bytes)
        job = _AI_JOBS.get(job_id)
        if job is not None:
            job["task"] = None


@app.get("/api/timeline/job/status/{job_id}")
async def ai_job_status(
    job_id: str,
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Poll the status of a background AI job (generate / refine / chat)."""
    _cleanup_ai_jobs()
    job = _AI_JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found or expired.")
    if job.get("user_id") != user.get("id"):
        raise HTTPException(status_code=403, detail="Not authorized to access this job.")

    status_val = job.get("status")
    if status_val in ("done", "error", "cancelled"):
        job.setdefault("delivered_at", time.time())
    if status_val == "done":
        return {"status": "done", "result": job.get("result")}
    if status_val == "error":
        payload = {"status": "error", "detail": job.get("detail", "Request failed")}
        if job.get("code"):
            payload["code"] = job.get("code")
            payload["subject"] = job.get("subject")
        return payload
    if status_val == "cancelled":
        return {"status": "cancelled", "detail": job.get("detail", "Job was cancelled by user")}
    return {"status": "pending"}


@app.post("/api/timeline/job/cancel/{job_id}")
async def cancel_ai_job(
    job_id: str,
    request: Request,
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Cancel an in-progress background AI job (generate / refine / chat).
    Cancels the background task, refunds the rate limiter hit, and refunds daily quota.
    """
    job = _AI_JOBS.get(job_id)
    if job is None:
        return {"status": "cancelled", "message": "Job not found or already finished."}

    if job.get("user_id") != user.get("id") and not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Not authorized to cancel this job.")

    if job.get("status") == "pending":
        job["status"] = "cancelled"
        job["updated"] = time.time()

        # 1. Cancel background asyncio Task
        task: Optional[asyncio.Task] = job.get("task")
        if task and not task.done():
            task.cancel()
            logger.info(f"Cancelled background asyncio task for job {job_id}")

        # 2. Refund rate limiter and daily quota if applicable
        _refund_job_quota_and_limits(job, user)

        return {"status": "cancelled", "message": "Job cancelled and quota refunded."}

    return {"status": job.get("status"), "message": f"Job was already in {job.get('status')} state."}


async def _execute_generation(
    req: GenerateTimelineRequest,
    api_key: Optional[str],
    key_tier: str,
    user: Dict[str, Any],
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    t_start = time.time()
    extra_kwargs = (
        {"enable_ai_fallback_images": req.enable_ai_fallback_images}
        if req.enable_ai_fallback_images is not None
        else {}
    )
    async with track_ai_activity(
        "generate_timeline", user,
        key_tier=key_tier,
        content_mode=req.content_mode or "classic",
        search_mode=search_mode_for(req.enable_grounding),
        prompt=req.prompt,
        details={"custom_focus": bool(req.custom_focus), "async_job": bool(job_id), "input_method": normalize_input_method(req.input_method)},
    ) as activity:
        timeline = await run_with_key_failover(
            lambda key: generate_timeline_with_gemini(
                prompt=req.prompt,
                custom_focus=req.custom_focus,
                api_key=key,
                enable_grounding=req.enable_grounding,
                content_mode=req.content_mode or "classic",
                **extra_kwargs,
            ),
            api_key, key_tier, label="timeline generation"
        )
        timeline.searchMode = search_mode_for(req.enable_grounding)
        timeline.creationSource = "prompt"
        apply_timeline_result(activity, timeline)
        elapsed_gen = time.time() - t_start
        # Resolve the owner at save time: a guest may have signed in while the job was running.
        user_id = _job_owner_id(job_id, user)
        dumped = timeline.model_dump(by_alias=True)
        await asyncio.to_thread(save_timeline_data, dumped, user_id=user_id)
    is_grounded = bool(timeline.grounding and timeline.grounding.is_grounded)
    logger.info(f"Timeline generated successfully in {elapsed_gen:.2f}s (id={timeline.id}, events={len(timeline.articles)}, grounded={is_grounded})")
    return dumped


@app.post("/api/timeline/generate/start", dependencies=[Depends(timeline_rate_limiter)])
async def start_generate_timeline(
    req: GenerateTimelineRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Start a timeline generation as a background job and return a job id to poll.
    Decouples the long-running AI call from the HTTP request so the client can
    leave and return (e.g. backgrounding a mobile tab) without stalling.
    """
    try:
        client_ip = get_client_ip(request)
        _enforce_concurrent_job_limit(user, client_ip)
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        api_key, key_tier, is_admin = await asyncio.to_thread(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        incremented_quota = bool(key_tier in ("paid", "free") and not is_admin and not (x_gemini_api_key and x_gemini_api_key.strip()))
        logger.info(
            f"Starting timeline job for user {user.get('id')} using {key_tier} key "
            f"(is_admin={is_admin}, grounding={'ENABLED' if req.enable_grounding else 'OFF'})"
        )
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(key_tier),
        )
        task = asyncio.create_task(_run_ai_job(
            job_id,
            lambda: _execute_generation(req, api_key, key_tier, user, job_id=job_id),
            user,
            label="generate",
        ))
        _AI_JOBS[job_id]["task"] = task
        return {"job_id": job_id, "status": "pending"}
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error starting generate job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post("/api/timeline/generate", response_model=TimelineData, dependencies=[Depends(timeline_rate_limiter)])
async def generate_timeline_endpoint(
    req: GenerateTimelineRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Generate a full timeline from a natural language prompt.
    Requires authentication. Routes between paid and free Gemini keys based on daily quota.
    """
    try:
        client_ip = get_client_ip(request)
        api_key, key_tier, is_admin = resolve_gemini_key(
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        logger.info(
            f"Generating timeline for user {user.get('id')} using {key_tier} key "
            f"(is_admin={is_admin}, grounding={'ENABLED' if req.enable_grounding else 'OFF'})"
        )

        extra_kwargs = (
            {"enable_ai_fallback_images": req.enable_ai_fallback_images}
            if req.enable_ai_fallback_images is not None
            else {}
        )
        async with track_ai_activity(
            "generate_timeline", user,
            key_tier=key_tier,
            content_mode=req.content_mode or "classic",
            search_mode=search_mode_for(req.enable_grounding),
            prompt=req.prompt,
            details={"custom_focus": bool(req.custom_focus), "async_job": False, "input_method": normalize_input_method(req.input_method)},
        ) as activity:
            timeline = await run_with_key_failover(
                lambda key: generate_timeline_with_gemini(
                    prompt=req.prompt,
                    custom_focus=req.custom_focus,
                    api_key=key,
                    enable_grounding=req.enable_grounding,
                    content_mode=req.content_mode or "classic",
                    **extra_kwargs,
                ),
                api_key, key_tier, label="timeline generation"
            )
            timeline.searchMode = search_mode_for(req.enable_grounding)
            timeline.creationSource = "prompt"
            apply_timeline_result(activity, timeline)

            user_id = user.get("id")
            await asyncio.to_thread(save_timeline_data, timeline.model_dump(by_alias=True), user_id=user_id)
        is_grounded = bool(timeline.grounding and timeline.grounding.is_grounded)
        logger.info(f"Timeline generated successfully (id={timeline.id}, events={len(timeline.articles)}, grounded={is_grounded})")
        return timeline
    except InsufficientSubjectInfoError as ie:
        if key_tier in ("paid", "free") and not is_admin and not (x_gemini_api_key and x_gemini_api_key.strip()):
            try:
                refund_user_quota(
                    user, client_ip=client_ip,
                    refund_pool=community_pool_reserved_for_tier(key_tier),
                )
            except Exception as refund_err:
                logger.warning(f"Failed to refund quota after insufficient_info: {refund_err}")
        raise HTTPException(
            status_code=422,
            detail={"code": ie.code, "subject": ie.subject, "message": str(ie)},
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in generate_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


MAX_UPLOAD_FILES = 20
MAX_UPLOAD_FILE_BYTES = 8 * 1024 * 1024  # 8MB per file
MAX_UPLOAD_TOTAL_BYTES = 30 * 1024 * 1024  # 30MB per request
MAX_RAW_TEXT_CHARS = 20000


def _stamp_files_timeline(timeline: TimelineData, prompt_mode: bool, enable_grounding: Optional[bool]) -> None:
    """Records how a file/photo-based timeline was created (persisted with the timeline)."""
    timeline.creationSource = "photo_prompt" if prompt_mode else "files"
    timeline.searchMode = search_mode_for(enable_grounding) if prompt_mode else "fast"


async def _execute_generation_from_files(
    validated_uploads: ValidatedUploads,
    context: Optional[str],
    raw_text: Optional[str],
    resolved_mode: str,
    prompt_mode: bool,
    enable_grounding: bool,
    ui_language: Optional[str],
    enable_ai_fallback_images: Optional[bool],
    api_key: Optional[str],
    key_tier: str,
    user: Dict[str, Any],
    job_id: Optional[str] = None,
    input_method: Optional[str] = None,
    credits_charged: Optional[int] = None,
) -> Dict[str, Any]:
    extra_kwargs: Dict[str, Any] = {
        "extracted_documents": validated_uploads.extracted_documents or None,
        "total_pdf_pages": validated_uploads.total_pdf_pages,
    }
    if prompt_mode:
        extra_kwargs["prompt_mode"] = True
        extra_kwargs["enable_grounding"] = bool(enable_grounding)
        if ui_language:
            extra_kwargs["ui_language"] = ui_language
    if enable_ai_fallback_images is not None:
        extra_kwargs["enable_ai_fallback_images"] = enable_ai_fallback_images

    activity_details: Dict[str, Any] = {
        "file_count": validated_uploads.total_accepted_files,
        "image_count": validated_uploads.image_count,
        "doc_count": validated_uploads.doc_count,
        "has_pasted_text": bool(raw_text),
        "async_job": bool(job_id),
        "input_method": normalize_input_method(input_method, bool((context or "").strip())),
    }
    if credits_charged is not None:
        activity_details["credits_charged"] = int(credits_charged)
    if validated_uploads.total_pdf_pages > 0:
        activity_details["pdf_pages"] = validated_uploads.total_pdf_pages

    async with track_ai_activity(
        "generate_from_photo_prompt" if prompt_mode else "generate_from_files", user,
        key_tier=key_tier,
        content_mode=resolved_mode,
        search_mode=search_mode_for(enable_grounding) if prompt_mode else None,
        prompt=context,
        details=activity_details,
    ) as activity:
        timeline = await run_with_key_failover(
            lambda key: generate_timeline_from_files(
                files=validated_uploads.binary_files,
                context_prompt=context,
                raw_text=raw_text or None,
                api_key=key,
                content_mode=resolved_mode,
                **extra_kwargs,
            ),
            api_key, key_tier, label="timeline generation from files"
        )
        _stamp_files_timeline(timeline, prompt_mode, enable_grounding)
        apply_timeline_result(activity, timeline)
        user_id = _job_owner_id(job_id, user) if job_id else user.get("id")
        dumped = timeline.model_dump(by_alias=True)
        await asyncio.to_thread(save_timeline_data, dumped, user_id=user_id)
    logger.info(f"Timeline generated from files successfully (id={timeline.id}, events={len(timeline.articles)}, prompt_mode={prompt_mode})")
    return dumped


@app.post(
    "/api/timeline/generate-from-files/start",
    dependencies=[Depends(timeline_rate_limiter), Depends(file_upload_rate_limiter)],
)
async def start_generate_timeline_from_files(
    request: Request,
    files: List[UploadFile] = File(default=[]),
    text: Optional[str] = Form(None),
    context: Optional[str] = Form(None),
    content_mode: Optional[str] = Form("classic"),
    prompt_mode: Optional[bool] = Form(False),
    enable_grounding: Optional[bool] = Form(False),
    ui_language: Optional[str] = Form(None),
    enable_ai_fallback_images: Optional[bool] = Form(None),
    input_method: Optional[str] = Form(None),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Start a file/photo timeline generation as a cancellable background job and return a job id to poll.
    """
    try:
        client_ip = get_client_ip(request)
        _enforce_concurrent_job_limit(user, client_ip)
        has_custom_key = bool(x_gemini_api_key and x_gemini_api_key.strip())
        raw_text = (text or "").strip()
        validated_uploads = await validate_and_read_uploads(
            files,
            raw_text,
            request=request,
            user=user,
            has_custom_key=has_custom_key,
            prompt_mode=bool(prompt_mode),
        )
        upload_credits = calculate_upload_credit_cost(
            validated_uploads, raw_text=raw_text, is_chat_or_refine=False
        )
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        api_key, key_tier, is_admin = await asyncio.to_thread(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip, credits=upload_credits
        )
        incremented_quota = bool(key_tier in ("paid", "free") and not is_admin and not has_custom_key)
        resolved_mode = content_mode if content_mode in ("kids", "teens") else "classic"
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(key_tier),
            quota_credits=upload_credits,
        )
        task = asyncio.create_task(_run_ai_job(
            job_id,
            lambda: _execute_generation_from_files(
                validated_uploads=validated_uploads,
                context=context,
                raw_text=raw_text or None,
                resolved_mode=resolved_mode,
                prompt_mode=bool(prompt_mode),
                enable_grounding=bool(enable_grounding),
                ui_language=ui_language,
                enable_ai_fallback_images=enable_ai_fallback_images,
                api_key=api_key,
                key_tier=key_tier,
                user=user,
                job_id=job_id,
                input_method=input_method,
                credits_charged=upload_credits,
            ),
            user,
            label="generate-from-files",
        ))
        _AI_JOBS[job_id]["task"] = task
        return {"job_id": job_id, "status": "pending"}
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error starting generate_from_files job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post(
    "/api/timeline/generate-from-files",
    response_model=TimelineData,
    dependencies=[Depends(timeline_rate_limiter), Depends(file_upload_rate_limiter)],
)
async def generate_timeline_from_files_endpoint(
    request: Request,
    files: List[UploadFile] = File(default=[]),
    text: Optional[str] = Form(None),
    context: Optional[str] = Form(None),
    content_mode: Optional[str] = Form("classic"),
    prompt_mode: Optional[bool] = Form(False),
    enable_grounding: Optional[bool] = Form(False),
    ui_language: Optional[str] = Form(None),
    enable_ai_fallback_images: Optional[bool] = Form(None),
    input_method: Optional[str] = Form(None),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Generate a timeline by extracting content directly from uploaded files (photos of
    book/document pages, scans, PDFs, TXT/MD documents, or personal photos) and/or pasted raw text,
    or from a file/photo prompt (`prompt_mode=True`).
    """
    try:
        has_custom_key = bool(x_gemini_api_key and x_gemini_api_key.strip())
        raw_text = (text or "").strip()
        validated_uploads = await validate_and_read_uploads(
            files,
            raw_text,
            request=request,
            user=user,
            has_custom_key=has_custom_key,
            prompt_mode=bool(prompt_mode),
        )

        client_ip = get_client_ip(request)
        upload_credits = calculate_upload_credit_cost(
            validated_uploads, raw_text=raw_text, is_chat_or_refine=False
        )
        api_key, key_tier, is_admin = resolve_gemini_key(
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip, credits=upload_credits
        )
        logger.info(
            f"Generating timeline from {validated_uploads.total_accepted_files} uploaded file(s) + "
            f"{'pasted text' if raw_text else 'no pasted text'} (prompt_mode={prompt_mode}, credits={upload_credits}) for user {user.get('id')} using {key_tier} key (is_admin={is_admin})"
        )

        resolved_mode = content_mode if content_mode in ("kids", "teens") else "classic"
        extra_kwargs: Dict[str, Any] = {
            "extracted_documents": validated_uploads.extracted_documents or None,
            "total_pdf_pages": validated_uploads.total_pdf_pages,
        }
        if prompt_mode:
            extra_kwargs["prompt_mode"] = True
            extra_kwargs["enable_grounding"] = bool(enable_grounding)
            if ui_language:
                extra_kwargs["ui_language"] = ui_language
        if enable_ai_fallback_images is not None:
            extra_kwargs["enable_ai_fallback_images"] = enable_ai_fallback_images

        activity_details: Dict[str, Any] = {
            "file_count": validated_uploads.total_accepted_files,
            "image_count": validated_uploads.image_count,
            "doc_count": validated_uploads.doc_count,
            "has_pasted_text": bool(raw_text),
            "async_job": False,
            "credits_charged": upload_credits,
            "input_method": normalize_input_method(input_method, bool((context or "").strip())),
        }
        if validated_uploads.total_pdf_pages > 0:
            activity_details["pdf_pages"] = validated_uploads.total_pdf_pages

        async with track_ai_activity(
            "generate_from_photo_prompt" if prompt_mode else "generate_from_files", user,
            key_tier=key_tier,
            content_mode=resolved_mode,
            search_mode=search_mode_for(enable_grounding) if prompt_mode else None,
            prompt=context,
            details=activity_details,
        ) as activity:
            timeline = await run_with_key_failover(
                lambda key: generate_timeline_from_files(
                    files=validated_uploads.binary_files,
                    context_prompt=context,
                    raw_text=raw_text or None,
                    api_key=key,
                    content_mode=resolved_mode,
                    **extra_kwargs,
                ),
                api_key, key_tier, label="timeline generation from files"
            )
            _stamp_files_timeline(timeline, bool(prompt_mode), enable_grounding)
            apply_timeline_result(activity, timeline)

            user_id = user.get("id")
            await asyncio.to_thread(save_timeline_data, timeline.model_dump(by_alias=True), user_id=user_id)
        logger.info(f"Timeline generated from files successfully (id={timeline.id}, events={len(timeline.articles)})")
        return timeline
    except InsufficientSubjectInfoError as ie:
        if key_tier in ("paid", "free") and not is_admin and not (x_gemini_api_key and x_gemini_api_key.strip()):
            try:
                refund_user_quota(
                    user, client_ip=client_ip,
                    refund_pool=community_pool_reserved_for_tier(key_tier),
                    credits=upload_credits,
                )
            except Exception as refund_err:
                logger.warning(f"Failed to refund quota after insufficient_info: {refund_err}")
        raise HTTPException(
            status_code=422,
            detail={"code": ie.code, "subject": ie.subject, "message": str(ie)},
        )
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in generate_timeline_from_files: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


async def _execute_refine(
    req: RefineTimelineRequest,
    api_key: Optional[str],
    key_tier: str,
    user: Dict[str, Any],
) -> Dict[str, Any]:
    async with track_ai_activity(
        "refine_timeline", user,
        key_tier=key_tier,
        content_mode=req.content_mode or req.timeline.contentMode,
        prompt=req.instruction,
        timeline_id=req.timeline.id,
        details={"events_before": len(req.timeline.articles)},
    ) as activity:
        updated_timeline = await run_with_key_failover(
            lambda key: refine_timeline_with_gemini(
                current_timeline=req.timeline,
                instruction=req.instruction,
                api_key=key,
                content_mode=req.content_mode,
            ),
            api_key, key_tier, label="timeline refine"
        )
        apply_timeline_result(activity, updated_timeline)
        user_id = user.get("id")
        dumped = updated_timeline.model_dump(by_alias=True)
        await asyncio.to_thread(save_timeline_data, dumped, user_id=user_id)
    return dumped


@app.post("/api/timeline/refine/start", dependencies=[Depends(timeline_rate_limiter)])
async def start_refine_timeline(
    req: RefineTimelineRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Start a timeline refinement as a background job and return a job id to poll."""
    try:
        timeline_id = req.timeline.id
        client_ip = get_client_ip(request)
        _enforce_concurrent_job_limit(user, client_ip)
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        api_key, key_tier, is_admin = await asyncio.to_thread(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        incremented_quota = bool(key_tier in ("paid", "free") and not is_admin and not (x_gemini_api_key and x_gemini_api_key.strip()))
        logger.info(
            f"Starting refine job for timeline {timeline_id} user {user.get('id')} using {key_tier} key "
            f"(is_admin={is_admin})"
        )
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(key_tier),
        )
        task = asyncio.create_task(_run_ai_job(
            job_id,
            lambda: _execute_refine(req, api_key, key_tier, user),
            user,
            label="refine",
        ))
        _AI_JOBS[job_id]["task"] = task
        return {"job_id": job_id, "status": "pending"}
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error starting refine job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post("/api/timeline/refine", response_model=TimelineData, dependencies=[Depends(timeline_rate_limiter)])
async def refine_timeline_endpoint(
    req: RefineTimelineRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Refine or extend an existing timeline via a natural language instruction.
    Requires authentication. Routes between paid and free Gemini keys based on the shared
    daily AI-operation quota.
    """
    try:
        timeline_id = req.timeline.id
        client_ip = get_client_ip(request)
        api_key, key_tier, is_admin = resolve_gemini_key(
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        logger.info(
            f"Refining timeline {timeline_id} for user {user.get('id')} using {key_tier} key "
            f"(is_admin={is_admin})"
        )

        async with track_ai_activity(
            "refine_timeline", user,
            key_tier=key_tier,
            content_mode=req.content_mode or req.timeline.contentMode,
            prompt=req.instruction,
            timeline_id=timeline_id,
            details={"events_before": len(req.timeline.articles)},
        ) as activity:
            updated_timeline = await run_with_key_failover(
                lambda key: refine_timeline_with_gemini(
                    current_timeline=req.timeline,
                    instruction=req.instruction,
                    api_key=key,
                    content_mode=req.content_mode,
                ),
                api_key, key_tier, label="timeline refine"
            )
            apply_timeline_result(activity, updated_timeline)

            user_id = user.get("id")
            await asyncio.to_thread(save_timeline_data, updated_timeline.model_dump(by_alias=True), user_id=user_id)
        return updated_timeline
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in refine_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))

async def _apply_chat_edit(
    chat_result: TimelineChatOutput,
    current_timeline: TimelineData,
    chat_key: Optional[str],
    chat_tier: str,
    user: Dict[str, Any],
    content_mode: Optional[str] = None,
) -> Optional[TimelineData]:
    """
    Applies an edit resulting from a chat turn.
    Supports fast surgical event edits/deletions/additions directly in Python,
    or falls back to deep timeline refinement via refine_timeline_with_gemini.
    """
    if chat_result.action != "edit":
        return None

    edit_type = chat_result.edit_type or "timeline_refine"
    user_id = user.get("id")

    # 1. Surgical Event Deletion
    if edit_type == "event_delete":
        target_ids = set()
        if chat_result.target_event_id:
            target_ids.add(str(chat_result.target_event_id).strip())
        if chat_result.target_event_ids:
            target_ids.update(str(tid).strip() for tid in chat_result.target_event_ids if tid)

        # Fallback: if target_event_id was an event title instead of an ID, match by title
        matched_articles = [a for a in current_timeline.articles if a.id in target_ids]
        if not matched_articles and chat_result.target_event_id:
            query_lower = str(chat_result.target_event_id).strip().lower()
            matched_articles = [a for a in current_timeline.articles if query_lower in a.title.lower() or a.title.lower() in query_lower]
            for a in matched_articles:
                target_ids.add(a.id)

        if target_ids:
            remaining_articles = [a for a in current_timeline.articles if a.id not in target_ids]
            # Guardrail: never allow deleting every single event to empty the timeline
            if len(remaining_articles) > 0:
                current_timeline.articles = remaining_articles
                await asyncio.to_thread(save_timeline_data, current_timeline.model_dump(by_alias=True), user_id=user_id)
                return current_timeline

    # 2. Surgical Event Edit (dates, title, subtitle, category, lane, rank, location)
    if edit_type == "event_edit" and (chat_result.target_event_id or chat_result.event_edits):
        target_id = str(chat_result.target_event_id).strip() if chat_result.target_event_id else None
        target_art = next((a for a in current_timeline.articles if a.id == target_id), None)
        if not target_art and target_id:
            target_id_lower = target_id.lower()
            target_art = next((a for a in current_timeline.articles if target_id_lower in a.title.lower() or a.title.lower() in target_id_lower), None)

        if target_art and chat_result.event_edits:
            edits = chat_result.event_edits
            updates: Dict[str, Any] = {}

            if edits.title and edits.title.strip():
                updates["title"] = edits.title.strip()
            if edits.subtitle is not None and edits.subtitle.strip():
                updates["subtitle"] = edits.subtitle.strip()
            if edits.category is not None and edits.category.strip():
                updates["category"] = edits.category.strip()
            if edits.lane is not None and edits.lane.strip():
                valid_lane_ids = {l.id for l in current_timeline.lanes}
                if edits.lane.strip() in valid_lane_ids:
                    updates["lane"] = edits.lane.strip()
            if edits.importance_rank is not None:
                updates["rank"] = max(1, min(10, edits.importance_rank))
            if edits.location_name is not None and edits.location_name.strip():
                updates["locationName"] = edits.location_name.strip()

            # Date updates
            new_fy = edits.from_year if edits.from_year is not None else target_art.from_.year
            drop_from_month = bool(edits.from_precision) and edits.from_precision in ("year", "decade", "century", "millennium", "million-years", "billion-years") and edits.from_month is None
            drop_from_day = (drop_from_month or (bool(edits.from_precision) and edits.from_precision == "month")) and edits.from_day is None
            new_fm = edits.from_month if edits.from_month is not None else (None if drop_from_month else target_art.from_.month)
            new_fd = edits.from_day if edits.from_day is not None else (None if drop_from_day else target_art.from_.day)
            new_fp = edits.from_precision or target_art.from_.precision or "year"
            # An explicit coarse precision with no new time means "drop the time of day".
            drop_from_time = bool(edits.from_precision) and edits.from_precision not in SUB_DAY_PRECISIONS and edits.from_hour is None
            new_fh = edits.from_hour if edits.from_hour is not None else (None if drop_from_time else target_art.from_.hour)
            new_fmin = edits.from_minute if edits.from_minute is not None else (None if drop_from_time else target_art.from_.minute)

            new_ty = edits.to_year if edits.to_year is not None else (target_art.to.year if target_art.to else None)
            drop_to_month = bool(edits.to_precision) and edits.to_precision in ("year", "decade", "century", "millennium", "million-years", "billion-years") and edits.to_month is None
            drop_to_day = (drop_to_month or (bool(edits.to_precision) and edits.to_precision == "month")) and edits.to_day is None
            new_tm = edits.to_month if edits.to_month is not None else (None if drop_to_month or not target_art.to else target_art.to.month)
            new_td = edits.to_day if edits.to_day is not None else (None if drop_to_day or not target_art.to else target_art.to.day)
            new_tp = edits.to_precision or (target_art.to.precision if target_art.to else None)
            drop_to_time = bool(edits.to_precision) and edits.to_precision not in SUB_DAY_PRECISIONS and edits.to_hour is None
            new_th = edits.to_hour if edits.to_hour is not None else (None if drop_to_time or not target_art.to else target_art.to.hour)
            new_tmin = edits.to_minute if edits.to_minute is not None else (None if drop_to_time or not target_art.to else target_art.to.minute)
            new_present = edits.is_to_present if edits.is_to_present is not None else (target_art.isToPresent or False)

            from_dict, to_dict, is_present = normalize_event_dates(
                from_year=new_fy,
                from_month=new_fm,
                from_day=new_fd,
                from_precision=new_fp,
                to_year=new_ty,
                to_month=new_tm,
                to_day=new_td,
                to_precision=new_tp,
                is_to_present=new_present,
                from_hour=new_fh,
                from_minute=new_fmin,
                to_hour=new_th,
                to_minute=new_tmin,
            )

            updates["from_"] = timeline_date_from_dict(from_dict)
            updates["to"] = timeline_date_from_dict(to_dict) if to_dict else None
            updates["isToPresent"] = is_present

            updated_art = target_art.model_copy(update=updates)
            updated_articles = [updated_art if a.id == target_art.id else a for a in current_timeline.articles]
            updated_articles.sort(key=lambda a: date_sort_key(a.from_))
            current_timeline.articles = updated_articles
            await asyncio.to_thread(save_timeline_data, current_timeline.model_dump(by_alias=True), user_id=user_id)
            return current_timeline

    # 3. Surgical Event Add
    if edit_type == "event_add" and chat_result.new_event:
        ne = chat_result.new_event
        from_dict, to_dict, is_present = normalize_event_dates(
            from_year=ne.from_year,
            from_month=ne.from_month,
            from_day=ne.from_day,
            from_precision=ne.from_precision or "year",
            to_year=ne.to_year,
            to_month=ne.to_month,
            to_day=ne.to_day,
            to_precision=ne.to_precision,
            is_to_present=ne.is_to_present or False,
            from_hour=ne.from_hour,
            from_minute=ne.from_minute,
            to_hour=ne.to_hour,
            to_minute=ne.to_minute,
        )
        assigned_lane = ne.lane
        valid_lane_ids = {l.id for l in current_timeline.lanes}
        if not assigned_lane or assigned_lane not in valid_lane_ids:
            assigned_lane = current_timeline.lanes[0].id if current_timeline.lanes else "main"

        new_id = f"ev-{uuid.uuid4().hex[:8]}"
        is_fictional = bool(current_timeline.isFictional)
        raw_article = {
            "id": new_id,
            "title": ne.title.strip(),
            "subtitle": (ne.subtitle or "").strip(),
            "lane": assigned_lane,
            "category": (ne.category or "").strip(),
            "from": from_dict,
            "rank": max(1, min(10, ne.importance_rank or 5)),
            "isToPresent": is_present,
            "wikipedia_title": (ne.wikipedia_title or "").strip(),
            "wikipedia_title_en": (ne.wikipedia_title_en or "").strip(),
            "location_name": ne.location_name,
            "is_fictional": is_fictional
        }
        if to_dict:
            raw_article["to"] = to_dict

        enriched = await enrich_events_with_wikipedia(
            [raw_article],
            lang=chat_result.detected_language or "en",
            timeline_topic=current_timeline.title,
            is_timeline_fictional=is_fictional,
            api_key=chat_key,
        )
        item = enriched[0] if enriched else raw_article
        from_d = item.get("from", from_dict)
        to_d = item.get("to")

        from_date = timeline_date_from_dict({"year": ne.from_year, **(from_d or {})})
        to_date = timeline_date_from_dict(to_d) if to_d else None

        loc_name = item.get("location_name")
        lat = item.get("lat")
        lng = item.get("lng")
        google_maps_url = None
        if not is_fictional:
            if lat is not None and lng is not None:
                google_maps_url = f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"
            elif loc_name:
                google_maps_url = f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(loc_name)}"

        created_art = TimelineArticle(
            id=new_id,
            title=item.get("title", ne.title),
            subtitle=item.get("subtitle", ne.subtitle or ""),
            lane=assigned_lane,
            category=item.get("category", ne.category or ""),
            from_=from_date,
            to=to_date,
            isToPresent=is_present,
            imageUrl=item.get("imageUrl"),
            wikiTitle=item.get("wikiTitle"),
            wikiTitleEn=item.get("wikiTitleEn"),
            wikiUrl=item.get("wikiUrl"),
            extract=item.get("extract"),
            rank=item.get("rank", 5),
            locationName=loc_name,
            lat=lat,
            lng=lng,
            googleMapsUrl=google_maps_url,
            isFictional=is_fictional
        )
        current_timeline.articles.append(created_art)
        current_timeline.articles.sort(key=lambda a: date_sort_key(a.from_))
        await asyncio.to_thread(save_timeline_data, current_timeline.model_dump(by_alias=True), user_id=user_id)
        return current_timeline

    # 4. Deep Refinement (timeline_refine or fallback)
    instruction = chat_result.edit_instruction or chat_result.reply
    if instruction:
        updated_timeline = await run_with_key_failover(
            lambda key: refine_timeline_with_gemini(
                current_timeline=current_timeline,
                instruction=instruction,
                api_key=key,
                content_mode=content_mode,
            ),
            chat_key, chat_tier, label="chat edit"
        )
        await asyncio.to_thread(save_timeline_data, updated_timeline.model_dump(by_alias=True), user_id=user_id)
        return updated_timeline

    return None


async def _run_chat_turn(
    req: TimelineChatRequest,
    chat_key: Optional[str],
    chat_tier: str,
    user: Dict[str, Any],
    async_job: bool,
) -> TimelineChatResponse:
    async with track_ai_activity(
        "chat", user,
        key_tier=chat_tier,
        content_mode=req.content_mode or req.timeline.contentMode,
        search_mode=search_mode_for(req.enable_grounding),
        prompt=req.message,
        timeline_id=req.timeline.id,
        details={"history_turns": len(req.history), "async_job": async_job, "input_method": normalize_input_method(req.input_method)},
    ) as activity:
        chat_result, grounding = await run_with_key_failover(
            lambda key: chat_about_timeline(
                current_timeline=req.timeline,
                message=req.message,
                history=req.history,
                api_key=key,
                enable_grounding=req.enable_grounding,
                content_mode=req.content_mode,
            ),
            chat_key, chat_tier, label="timeline chat"
        )

        model_used = getattr(chat_result, "_model_used", None)
        response = TimelineChatResponse(
            reply=chat_result.reply,
            action=chat_result.action,
            grounding=grounding,
            detected_language=chat_result.detected_language or "en",
            is_relevant=chat_result.is_relevant if chat_result.is_relevant is not None else True,
            model=model_used,
        )
        activity["language"] = response.detected_language
        activity["details"].update(
            chat_action=chat_result.action,
            is_relevant=response.is_relevant,
            edit_type=(chat_result.edit_type or "timeline_refine") if chat_result.action == "edit" else None,
        )

        if chat_result.action == "edit":
            events_before = len(req.timeline.articles)
            updated_timeline = await _apply_chat_edit(
                chat_result=chat_result,
                current_timeline=req.timeline,
                chat_key=chat_key,
                chat_tier=chat_tier,
                user=user,
                content_mode=req.content_mode,
            )
            activity["details"]["edit_applied"] = bool(updated_timeline)
            if updated_timeline:
                response.updated_timeline = updated_timeline
                activity["details"]["events_before"] = events_before
                activity["result_count"] = len(updated_timeline.articles)

    return response


async def _execute_chat(
    req: TimelineChatRequest,
    chat_key: Optional[str],
    chat_tier: str,
    x_gemini_api_key: Optional[str],
    client_ip: str,
    user: Dict[str, Any],
) -> Dict[str, Any]:
    response = await _run_chat_turn(req, chat_key, chat_tier, user, async_job=True)
    return response.model_dump(by_alias=True)


@app.post("/api/timeline/chat/start", dependencies=[Depends(timeline_rate_limiter)])
async def start_chat_timeline(
    req: TimelineChatRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Start a conversational turn as a background job and return a job id to poll."""
    try:
        timeline_id = req.timeline.id
        client_ip = get_client_ip(request)
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        chat_key, chat_tier, is_admin = resolve_gemini_key(
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        incremented_quota = bool(chat_tier in ("paid", "free") and not is_admin and not (x_gemini_api_key and x_gemini_api_key.strip()))
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(chat_tier),
        )
        task = asyncio.create_task(_run_ai_job(
            job_id,
            lambda: _execute_chat(req, chat_key, chat_tier, x_gemini_api_key, client_ip, user),
            user,
            label="chat",
        ))
        _AI_JOBS[job_id]["task"] = task
        return {"job_id": job_id, "status": "pending"}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error starting chat job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post("/api/timeline/chat", response_model=TimelineChatResponse, dependencies=[Depends(timeline_rate_limiter)])
async def chat_timeline_endpoint(
    req: TimelineChatRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Conversational turn about a timeline. The assistant answers questions or applies
    an edit through the refine pipeline. Every AI operation (answer or edit) draws from
    the single shared daily quota bucket, routing between the paid and free Gemini keys.
    """
    try:
        timeline_id = req.timeline.id
        client_ip = get_client_ip(request)
        chat_key, chat_tier, is_admin = resolve_gemini_key(
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        return await _run_chat_turn(req, chat_key, chat_tier, user, async_job=False)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in chat_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


async def _execute_quiz(
    req: TimelineQuizRequest,
    quiz_key: Optional[str],
    quiz_tier: str,
    user: Dict[str, Any],
) -> Dict[str, Any]:
    if not req.timeline.articles:
        raise ValueError("Cannot generate a quiz for an empty timeline.")

    async with track_ai_activity(
        "generate_quiz", user,
        key_tier=quiz_tier,
        content_mode=req.content_mode or req.timeline.contentMode,
        timeline_id=req.timeline.id,
        language=req.timeline.detectedLanguage,
        details={"fresh_round": bool(req.previous_questions)},
    ) as activity:
        quiz_result = await run_with_key_failover(
            lambda key: generate_timeline_quiz(
                current_timeline=req.timeline,
                previous_questions=req.previous_questions,
                api_key=key,
                content_mode=req.content_mode,
            ),
            quiz_key, quiz_tier, label="timeline quiz"
        )
        activity["result_count"] = len(quiz_result.get("questions") or [])
        activity["language"] = quiz_result.get("detected_language") or activity.get("language")

    # Persist generated quiz onto the stored timeline if owned by this user
    try:
        timeline_id = req.timeline.id
        if timeline_id:
            meta = await asyncio.to_thread(get_timeline_with_meta, timeline_id)
            if meta and meta.get("data"):
                owner_id = meta.get("owner_id")
                user_id = user.get("id") if user else None
                if (owner_id and user_id and owner_id == user_id) or is_admin_user(user):
                    stored_data = dict(meta["data"])
                    stored_data["quiz"] = quiz_result["questions"]
                    quiz_model = (quiz_result.get("tokenUsage") or {}).get("model")
                    if quiz_model:
                        stored_data["quizModel"] = quiz_model
                    target_owner = owner_id or user_id
                    await asyncio.to_thread(save_timeline_data, stored_data, user_id=target_owner)
    except Exception as save_err:
        logger.warning(f"Non-fatal: could not persist quiz on timeline {req.timeline.id}: {save_err}")

    return quiz_result


@app.post("/api/timeline/quiz/start", dependencies=[Depends(timeline_rate_limiter)])
async def start_quiz_timeline(
    req: TimelineQuizRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Start on-demand trivia quiz generation as a background job and return a job id to poll."""
    _strip_heavy_media_from_timeline(req.timeline)
    try:
        if not req.timeline.articles:
            raise HTTPException(status_code=400, detail="Timeline has no events to generate a quiz from.")
        client_ip = get_client_ip(request)
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        quiz_key, quiz_tier, is_admin = resolve_gemini_key(
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        incremented_quota = bool(quiz_tier in ("paid", "free") and not is_admin and not (x_gemini_api_key and x_gemini_api_key.strip()))
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(quiz_tier),
        )
        task = asyncio.create_task(_run_ai_job(
            job_id,
            lambda: _execute_quiz(req, quiz_key, quiz_tier, user),
            user,
            label="quiz",
        ))
        _AI_JOBS[job_id]["task"] = task
        return {"job_id": job_id, "status": "pending"}
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error starting quiz job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post("/api/timeline/quiz", response_model=TimelineQuizResponse, dependencies=[Depends(timeline_rate_limiter)])
async def quiz_timeline_endpoint(
    req: TimelineQuizRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Synchronous endpoint for generating an on-demand trivia quiz from a timeline."""
    try:
        if not req.timeline.articles:
            raise HTTPException(status_code=400, detail="Timeline has no events to generate a quiz from.")
        client_ip = get_client_ip(request)
        quiz_key, quiz_tier, is_admin = resolve_gemini_key(
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        result = await _execute_quiz(req, quiz_key, quiz_tier, user)
        return TimelineQuizResponse(**result)
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in quiz_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


async def _execute_whoami(
    req: TimelineWhoAmIRequest,
    whoami_key: Optional[str],
    whoami_tier: str,
    user: Dict[str, Any],
) -> Dict[str, Any]:
    if not req.timeline.articles:
        raise ValueError("Cannot generate a Who Am I game for an empty timeline.")

    async with track_ai_activity(
        "generate_whoami", user,
        key_tier=whoami_tier,
        content_mode=req.content_mode or req.timeline.contentMode,
        timeline_id=req.timeline.id,
        language=req.timeline.detectedLanguage,
        details={"fresh_round": bool(req.previous_event_ids)},
    ) as activity:
        whoami_result = await run_with_key_failover(
            lambda key: generate_timeline_whoami(
                current_timeline=req.timeline,
                previous_event_ids=req.previous_event_ids,
                api_key=key,
                content_mode=req.content_mode,
            ),
            whoami_key, whoami_tier, label="timeline whoami"
        )
        activity["result_count"] = len(whoami_result.get("items") or [])
        activity["language"] = whoami_result.get("detected_language") or activity.get("language")

    # Persist generated whoami items onto the stored timeline if owned by this user
    try:
        timeline_id = req.timeline.id
        if timeline_id:
            meta = await asyncio.to_thread(get_timeline_with_meta, timeline_id)
            if meta and meta.get("data"):
                owner_id = meta.get("owner_id")
                user_id = user.get("id") if user else None
                if (owner_id and user_id and owner_id == user_id) or is_admin_user(user):
                    stored_data = dict(meta["data"])
                    stored_data["whoami"] = whoami_result["items"]
                    whoami_model = (whoami_result.get("tokenUsage") or {}).get("model")
                    if whoami_model:
                        stored_data["whoamiModel"] = whoami_model
                    target_owner = owner_id or user_id
                    await asyncio.to_thread(save_timeline_data, stored_data, user_id=target_owner)
    except Exception as save_err:
        logger.warning(f"Non-fatal: could not persist whoami on timeline {req.timeline.id}: {save_err}")

    return whoami_result


@app.post("/api/timeline/whoami/start", dependencies=[Depends(timeline_rate_limiter)])
async def start_whoami_timeline(
    req: TimelineWhoAmIRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Start on-demand 'Who/What Event Am I?' mystery game generation as a background job."""
    _strip_heavy_media_from_timeline(req.timeline)
    try:
        if not req.timeline.articles:
            raise HTTPException(status_code=400, detail="Timeline has no events to generate a mystery game from.")
        client_ip = get_client_ip(request)
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        whoami_key, whoami_tier, is_admin = resolve_gemini_key(
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        incremented_quota = bool(whoami_tier in ("paid", "free") and not is_admin and not (x_gemini_api_key and x_gemini_api_key.strip()))
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(whoami_tier),
        )
        task = asyncio.create_task(_run_ai_job(
            job_id,
            lambda: _execute_whoami(req, whoami_key, whoami_tier, user),
            user,
            label="whoami",
        ))
        _AI_JOBS[job_id]["task"] = task
        return {"job_id": job_id, "status": "pending"}
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error starting whoami job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post("/api/timeline/whoami", response_model=TimelineWhoAmIResponse, dependencies=[Depends(timeline_rate_limiter)])
async def whoami_timeline_endpoint(
    req: TimelineWhoAmIRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Synchronous endpoint for generating an on-demand 'Who/What Event Am I?' mystery game."""
    try:
        if not req.timeline.articles:
            raise HTTPException(status_code=400, detail="Timeline has no events to generate a mystery game from.")
        client_ip = get_client_ip(request)
        whoami_key, whoami_tier, is_admin = resolve_gemini_key(
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        result = await _execute_whoami(req, whoami_key, whoami_tier, user)
        return TimelineWhoAmIResponse(**result)
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in whoami_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


# --- Podcasts ---------------------------------------------------------------------------------
# Episodes are stored separately from timelines (no read-modify-write races with timeline edits).
# Audio is rendered on the server from the stored script only — clients can never submit
# arbitrary text for synthesis — and each chapter is cached under a content hash, so replays,
# shared links and downloads are free after the first render.

podcast_audio_rate_limiter = SimpleRateLimiter(max_requests=120, window_seconds=60, name="podcast audio")
podcast_stream_rate_limiter = SimpleRateLimiter(max_requests=600, window_seconds=60, name="podcast stream")
podcast_activity_rate_limiter = SimpleRateLimiter(max_requests=30, window_seconds=60, name="podcast activity")
podcast_view_rate_limiter = SimpleRateLimiter(max_requests=120, window_seconds=60, name="podcast view")

MAX_EPISODES_PER_OWNER_TIMELINE = 8
LEGACY_EPISODE_ID = "legacy"
_LEGACY_MAX_SEGMENTS = 55
_LEGACY_MAX_TURNS = 3
_LEGACY_MAX_TURN_CHARS = 1500


def _quota_counts_usage(user: Optional[Dict[str, Any]], custom_key: Optional[str]) -> bool:
    """True when resolve_gemini_key(increment_usage=True) actually records a usage unit for this caller."""
    if (custom_key and custom_key.strip()) or is_admin_user(user):
        return False
    if is_guest_user(user):
        return get_guest_api_key_mode() == "limited"
    return get_api_key_mode() == "limited"


def _podcast_user_id(user: Optional[Dict[str, Any]]) -> Optional[str]:
    return (user or {}).get("id") or None


_ORIG_GET_TIMELINE_WITH_META = get_timeline_with_meta


def _strip_heavy_media_from_timeline(timeline: Optional[TimelineData]) -> None:
    """Drop inline base64 images and bulky unused blobs on text-only AI job payloads (quiz/whoami/podcast)."""
    if timeline is None:
        return
    for attr in ("quiz", "whoami", "podcast", "grounding"):
        if hasattr(timeline, attr):
            setattr(timeline, attr, None)
    extra = getattr(timeline, "__pydantic_extra__", None)
    if isinstance(extra, dict):
        for k in ("quiz", "whoami", "podcast", "grounding"):
            extra.pop(k, None)
    for art in timeline.articles or []:
        art.imageUrl = None
        art.videos = None
        art_extra = getattr(art, "__pydantic_extra__", None)
        if isinstance(art_extra, dict):
            art_extra.pop("additionalImages", None)


def _get_timeline_access_meta_sync(timeline_id: str) -> Optional[Dict[str, Any]]:
    if get_timeline_with_meta is not _ORIG_GET_TIMELINE_WITH_META:
        return get_timeline_with_meta(timeline_id)
    return get_timeline_access_meta(timeline_id)


async def _podcast_timeline_meta(timeline_id: str, include_data: bool = False) -> Optional[Dict[str, Any]]:
    if include_data or get_timeline_with_meta is not _ORIG_GET_TIMELINE_WITH_META:
        return await asyncio.to_thread(get_timeline_with_meta, timeline_id)
    return await asyncio.to_thread(get_timeline_access_meta, timeline_id)


def _can_view_timeline(meta: Optional[Dict[str, Any]], user: Optional[Dict[str, Any]]) -> bool:
    if not meta:
        return True
    if is_admin_user(user) or meta.get("is_shared") or not meta.get("owner_id"):
        return True
    return bool(_podcast_user_id(user) and meta.get("owner_id") == _podcast_user_id(user))


def _episode_visible(doc: Dict[str, Any], user: Optional[Dict[str, Any]], meta: Optional[Dict[str, Any]]) -> bool:
    """Creators see their episodes; the timeline owner sees all; shared timelines publish the owner's episodes."""
    if is_admin_user(user):
        return True
    uid = _podcast_user_id(user)
    if uid and doc.get("owner_id") == uid:
        return True
    if not meta:
        return False
    owner = meta.get("owner_id")
    if not owner:
        return True
    if uid and uid == owner:
        return True
    return bool(meta.get("is_shared") and doc.get("owner_id") == owner)


def _can_manage_episode(doc: Dict[str, Any], user: Optional[Dict[str, Any]], meta: Optional[Dict[str, Any]]) -> bool:
    if is_admin_user(user):
        return True
    uid = _podcast_user_id(user)
    if not uid:
        return False
    return doc.get("owner_id") == uid or bool(meta and meta.get("owner_id") == uid)


def _sync_episode_voice_gender(doc: Dict[str, Any], voice_gender: str) -> None:
    """Update an episode's primary voice gender, host names, and active per-engine clip pointers."""
    new_gender = podcast_audio.normalize_gender(voice_gender)
    old_gender = podcast_audio.normalize_gender(doc.get("voice_gender"))
    for eng in list((doc.get("audio") or {}).keys()):
        podcast_audio.gender_variant_state(doc, eng, old_gender)
    lang = doc.get("detected_language") or "en"
    default_h1, default_h2 = default_host_names(lang, new_gender)
    doc["voice_gender"] = new_gender
    doc["host1_name"] = default_h1
    doc["host2_name"] = default_h2 if doc.get("format") == "duo" else None
    for eng in list((doc.get("audio") or {}).keys()):
        podcast_audio.sync_engine_state_for_gender(doc, eng, new_gender)


def _timeline_articles_sig(timeline: TimelineData) -> str:
    items = [
        (str(a.id or ""), str(a.title or ""), a.from_.year if a.from_ else None)
        for a in (timeline.articles or [])
    ]
    return json.dumps(items, ensure_ascii=False)


async def _find_reusable_episode(
    timeline_id: str,
    req: TimelinePodcastRequest,
    user: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Find an existing episode by this user with identical script parameters (format, length, content_mode, events)."""
    uid = _podcast_user_id(user)
    if not uid:
        return None
    norm_format = "duo" if (req.format or "").lower() == "duo" else "single"
    norm_length = "focused" if (req.length or "").lower() == "focused" else "full"
    eff_mode = normalize_content_mode(req.content_mode or req.timeline.contentMode)
    sig = _timeline_articles_sig(req.timeline)
    article_ids = {str(a.id) for a in (req.timeline.articles or []) if a.id}
    docs = await asyncio.to_thread(podcast_store.list_episodes, timeline_id)
    for d in docs:
        if d.get("owner_id") != uid or d.get("id") == LEGACY_EPISODE_ID:
            continue
        if (d.get("format") or "single") != norm_format:
            continue
        if (d.get("length") or "full") != norm_length:
            continue
        if normalize_content_mode(d.get("content_mode")) != eff_mode:
            continue
        if not d.get("segments"):
            continue
        if d.get("articles_sig"):
            if d.get("articles_sig") != sig:
                continue
        else:
            ev_ids = [s.get("event_id") for s in d.get("segments") or [] if s.get("type") == "event" and s.get("event_id")]
            if not ev_ids or not all(str(eid) in article_ids for eid in ev_ids):
                continue
        return d
    return None


def _public_episode(
    doc: Dict[str, Any],
    user: Optional[Dict[str, Any]],
    meta: Optional[Dict[str, Any]],
    voice_gender: Optional[str] = None,
) -> Dict[str, Any]:
    doc_gender = podcast_audio.normalize_gender(doc.get("voice_gender"))
    active_gender = podcast_audio.normalize_gender(voice_gender or doc_gender)
    audio_public = {}
    for engine, state in (doc.get("audio") or {}).items():
        if engine not in ENGINES:
            continue
        by_gender = state.get("by_gender") or {}
        if active_gender in by_gender:
            g_state = by_gender[active_gender]
            clips = g_state.get("clips") or {}
            status_val = g_state.get("status", "pending")
            total_dur = g_state.get("total_duration")
        elif active_gender == doc_gender:
            clips = state.get("clips") or {}
            status_val = state.get("status", "pending")
            total_dur = state.get("total_duration")
        else:
            clips = {}
            status_val = "pending"
            total_dur = None
        is_rendering = podcast_audio.is_variant_rendering(doc["id"], engine, active_gender)
        variant_cost_usd = round(
            sum(float((c or {}).get("cost_usd") or 0.0) for c in clips.values()),
            6,
        )
        variant_model = (
            next((c.get("model") for c in clips.values() if c.get("model")), None)
            or (by_gender[active_gender].get("model") if active_gender in by_gender else state.get("model"))
        )
        audio_public[engine] = {
            "status": "rendering" if is_rendering else status_val,
            "unlocked": engine != "gemini" or bool(state.get("charged")),
            "clips": {
                sid: {k: c.get(k) for k in ("key", "duration", "engine", "fallback_from")}
                for sid, c in clips.items()
            },
            "rendered_clips": len(clips),
            "total_duration": total_dur,
            "cost_usd": variant_cost_usd,
            "model": variant_model,
        }
    lang = doc.get("detected_language") or "en"
    default_h1, default_h2 = default_host_names(lang, active_gender)
    # Host names are fixed per language and lead-voice gender (never model-invented), so older episodes match too.
    host1_name = default_h1
    host2_name = default_h2 if doc.get("format") == "duo" else None
    raw_script_cost = doc.get("script_cost_usd")
    if raw_script_cost is None and isinstance(doc.get("tokenUsage"), dict):
        raw_script_cost = doc["tokenUsage"].get("estimatedCostUsd")
    script_cost_usd = round(float(raw_script_cost), 6) if raw_script_cost is not None else None
    return {
        "id": doc["id"],
        "timeline_id": doc["timeline_id"],
        "title": doc.get("title") or "",
        "format": doc.get("format") or "single",
        "voice_gender": active_gender,
        "length": doc.get("length") or "full",
        "content_mode": doc.get("content_mode") or "classic",
        "default_engine": normalize_engine(doc.get("default_engine")),
        "host1_name": host1_name,
        "host2_name": host2_name,
        "detected_language": doc.get("detected_language") or "en",
        "music_mood": normalize_music_mood(doc.get("music_mood"), doc.get("content_mode"), doc.get("id")),
        "segments": doc.get("segments") or [],
        "audio": audio_public,
        "estimates": doc.get("estimates") or {},
        "source": doc.get("source") or "generated",
        "created_at": doc.get("created_at"),
        "is_mine": bool(_podcast_user_id(user) and doc.get("owner_id") == _podcast_user_id(user)),
        "can_manage": _can_manage_episode(doc, user, meta),
        "model": doc.get("model") or (doc.get("tokenUsage") or {}).get("model") or (doc.get("script") or {}).get("model"),
        "script_cost_usd": script_cost_usd,
        "tokenUsage": doc.get("tokenUsage"),
    }


def _legacy_episode_from_timeline(timeline_id: str, data: Dict[str, Any], owner_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """Convert a podcast script embedded on a timeline (pre-episode storage) into an episode document."""
    pod = data.get("podcast") if isinstance(data, dict) else None
    if not isinstance(pod, dict) or not pod.get("segments"):
        return None
    fmt = "duo" if pod.get("format") == "duo" else "single"
    segments = []
    for seg in (pod.get("segments") or [])[:_LEGACY_MAX_SEGMENTS]:
        if not isinstance(seg, dict):
            continue
        turns = []
        for t in (seg.get("turns") or [])[:_LEGACY_MAX_TURNS]:
            text = clean_spoken_text(str((t or {}).get("text") or ""))[:_LEGACY_MAX_TURN_CHARS]
            if text:
                speaker = "host2" if (fmt == "duo" and (t or {}).get("speaker") == "host2") else "host1"
                turns.append({"speaker": speaker, "text": text})
        if not turns:
            continue
        seg_type = seg.get("type") if seg.get("type") in ("intro", "event", "outro") else "event"
        segments.append({
            "id": f"seg-{len(segments) + 1}",
            "type": seg_type,
            "event_id": (str(seg.get("event_id"))[:120] if seg.get("event_id") and seg_type == "event" else None),
            "chapter_title": str(seg.get("chapter_title") or "")[:200],
            "turns": turns,
        })
    if not segments:
        return None
    engine = normalize_engine(pod.get("tts_engine"))
    engine = "edge" if engine == "gemini" else engine
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": LEGACY_EPISODE_ID,
        "timeline_id": str(timeline_id),
        "owner_id": owner_id,
        "created_at": pod.get("created_at") or now,
        "updated_at": now,
        "source": "legacy",
        "title": str(pod.get("title") or data.get("title") or "")[:300],
        "format": fmt,
        "voice_gender": "female" if pod.get("voice_gender") == "female" else "male",
        "length": "focused" if pod.get("length") == "focused" else "full",
        "content_mode": data.get("contentMode") if data.get("contentMode") in ("kids", "teens") else "classic",
        "default_engine": engine,
        "host1_name": str(pod.get("host1_name") or "")[:80],
        "host2_name": (str(pod.get("host2_name"))[:80] if fmt == "duo" and pod.get("host2_name") else None),
        "detected_language": str(pod.get("detected_language") or data.get("detectedLanguage") or "en")[:5],
        "segments": segments,
        "audio": {},
        "estimates": {},
    }


async def _load_visible_episode(
    timeline_id: str, episode_id: str, user: Optional[Dict[str, Any]]
) -> tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    if not podcast_store.is_valid_episode_id(episode_id):
        raise HTTPException(status_code=404, detail="Podcast episode not found")
    meta = await _podcast_timeline_meta(timeline_id)
    doc = await asyncio.to_thread(podcast_store.get_episode, timeline_id, episode_id)
    if not doc and episode_id == LEGACY_EPISODE_ID and meta and (meta.get("data") or meta.get("has_legacy_podcast")):
        full_meta = meta if meta.get("data") else await _podcast_timeline_meta(timeline_id, include_data=True)
        if full_meta and full_meta.get("data"):
            meta = full_meta
    if not doc and episode_id == LEGACY_EPISODE_ID and meta and meta.get("data"):
        doc = _legacy_episode_from_timeline(timeline_id, meta["data"], meta.get("owner_id"))
        if doc:
            await asyncio.to_thread(podcast_store.save_episode, doc)
    if not doc or not _episode_visible(doc, user, meta):
        raise HTTPException(status_code=404, detail="Podcast episode not found")
    return doc, meta


def _resolve_podcast_gemini_key_and_tier(
    custom_key: Optional[str],
    is_admin: bool = False,
    allow_server_key: bool = False,
) -> tuple[Optional[str], Optional[str]]:
    """Resolve the Gemini API key and billing tier used for podcast TTS rendering."""
    if custom_key and custom_key.strip():
        return custom_key.strip(), "custom"
    if is_admin:
        return (os.getenv("GEMINI_API_KEY", "").strip() or None), "admin_paid"
    if allow_server_key:
        paid_key = os.getenv("GEMINI_API_KEY", "").strip()
        free_key = get_next_free_key()
        if free_key and (not paid_key or free_key != paid_key):
            return free_key, "free"
        if paid_key:
            return paid_key, "paid"
        return free_key, "free"
    return None, None


def _gemini_key_runner(custom_key: Optional[str], is_admin: bool = False, allow_server_key: bool = False):
    """API-key failover wrapper for Gemini TTS renders (requires personal key, admin, or server key when permitted)."""
    key, tier = _resolve_podcast_gemini_key_and_tier(custom_key, is_admin=is_admin, allow_server_key=allow_server_key)
    if not tier:
        async def unauthorized_runner(op):
            raise PermissionError("Gemini audio generation requires a personal API key or unlocked quota.")
        return unauthorized_runner

    async def runner(op):
        return await run_with_key_failover(op, key, tier, label="podcast gemini tts")

    return runner


def _count_episode_event_segments(doc: Optional[Dict[str, Any]]) -> Optional[int]:
    """Count timeline-event chapters in a podcast script/episode document (excluding intro/outro)."""
    if not isinstance(doc, dict):
        return None
    segs = doc.get("segments")
    if not isinstance(segs, list) or not segs:
        return None
    return sum(
        1
        for s in segs
        if isinstance(s, dict) and (s.get("type") == "event" or bool(s.get("event_id")))
    )


def _min_optional_counts(*counts: Optional[int]) -> Optional[int]:
    present = [int(c) for c in counts if c is not None]
    return min(present) if present else None


def _resolve_podcast_gemini_audio_cost(
    length: Optional[str] = None,
    event_count: Optional[int] = None,
) -> int:
    """
    Returns the integer credit cost for Gemini TTS podcast audio:
    - 'focused' ("עיקרי הדברים") OR short timelines/episodes (<= PODCAST_FOCUSED_MAX_EVENTS = 12 events):
      `get_gemini_audio_credit_cost()` (default 10 credits).
    - 'full' ("הסיפור המלא") with > 12 events:
      `get_gemini_audio_full_credit_cost()` (default 20 credits).
    """
    norm_length = (length or "focused").strip().lower()
    if norm_length == "focused" or (
        event_count is not None and event_count <= PODCAST_FOCUSED_MAX_EVENTS
    ):
        return get_gemini_audio_credit_cost()
    return get_gemini_audio_full_credit_cost()


def _charge_premium_audio(
    user: Dict[str, Any],
    custom_key: Optional[str],
    client_ip: Optional[str],
    length: Optional[str] = None,
    event_count: Optional[int] = None,
) -> tuple[bool, bool, bool, int]:
    """
    Authorizes premium (Gemini) audio on an episode.
    - Personal key (BYOK) or admin: always permitted without consuming server quota (any length).
    - Server premium credits: permitted for both 'focused' (10 credits) and 'full' (20 credits, or 10
      credits when the timeline/episode has <= 12 events) whenever the user has sufficient credits.
    Returns (allowed, incremented, pool_reserved, credits_charged).
    """
    has_custom = bool(custom_key and custom_key.strip())
    is_admin = is_admin_user(user)
    if has_custom or is_admin:
        return True, False, False, 0

    audio_cost = _resolve_podcast_gemini_audio_cost(length=length, event_count=event_count)
    allowed, _, _, incremented, pool_reserved = charge_premium_credits(
        user, None, client_ip=client_ip, credits=audio_cost
    )
    if not allowed:
        return False, False, False, 0

    return True, incremented, pool_reserved, audio_cost


def _variant_completion_hook(
    user: Dict[str, Any],
    client_ip: Optional[str],
    engine: str,
    refund_if_no_premium: bool,
    voice_gender: Optional[str] = None,
    key_tier: Optional[str] = None,
    refund_pool: bool = False,
    charged_credits: int = 0,
):
    async def hook(doc: Dict[str, Any]) -> None:
        state = (doc.get("audio") or {}).get(engine) or {}
        target_gender = podcast_audio.normalize_gender(voice_gender or doc.get("voice_gender"))
        g_state = (state.get("by_gender") or {}).get(target_gender)
        source = g_state if g_state is not None else state
        clips = list((source.get("clips") or {}).values())
        status = source.get("status")
        fallbacks = sum(1 for c in clips if c.get("fallback_from"))
        total_cost = sum(float(c.get("cost_usd") or 0) for c in clips)
        total_in_tok = sum(int(c.get("input_tokens") or 0) for c in clips)
        total_out_tok = sum(int(c.get("output_tokens") or 0) for c in clips)
        total_think_tok = sum(int(c.get("thinking_tokens") or 0) for c in clips)
        clip_model = next((str(c.get("model")).strip() for c in clips if c.get("model")), "")
        model_label = clip_model or f"tts:{engine}"
        async with track_ai_activity(
            "podcast_audio", user,
            key_tier=key_tier,
            content_mode=doc.get("content_mode"),
            timeline_id=doc.get("timeline_id"),
            language=doc.get("detected_language"),
            details={"engine": engine, "episode_id": doc.get("id"), "fallbacks": fallbacks, "status": status},
        ) as rec:
            rec["result_count"] = len(clips)
            record_extra_cost(
                total_cost,
                model=model_label,
                input_tokens=total_in_tok,
                output_tokens=total_out_tok,
                thinking_tokens=total_think_tok,
            )
        all_gender_clips = [
            c
            for gs in (state.get("by_gender") or {}).values()
            for c in (gs.get("clips") or {}).values()
        ] or clips
        other_gender_rendering = any(
            ep == doc["id"] and eng == engine and g != target_gender and not t.done()
            for (ep, eng, g), t in list(podcast_audio._variant_tasks.items())
        )
        if (
            engine == "gemini"
            and (refund_if_no_premium or refund_pool)
            and status not in ("partial", "pending")
            and not state.get("refunded")
            and not other_gender_rendering
            and not any(c.get("engine") == "gemini" for c in all_gender_clips)
        ):
            credits_to_refund = charged_credits or get_gemini_audio_credit_cost()
            if refund_if_no_premium:
                refund_user_quota(user, client_ip=client_ip, refund_pool=refund_pool, credits=credits_to_refund)
            elif refund_pool:
                refund_community_paid_prompt(credits=credits_to_refund)

            def _mark(d: Dict[str, Any]) -> None:
                podcast_audio.variant_state(d, engine)["refunded"] = True

            await podcast_audio.update_episode(doc["timeline_id"], doc["id"], _mark)
            logger.info(
                f"Refunded {credits_to_refund} premium audio credit(s) for episode {doc.get('id')} "
                "(no Gemini chapters rendered)."
            )

    return hook


def _start_variant_render(
    doc: Dict[str, Any],
    engine: str,
    user: Dict[str, Any],
    custom_key: Optional[str],
    client_ip: Optional[str],
    refund_if_no_premium: bool = False,
    voice_gender: Optional[str] = None,
    refund_pool: bool = False,
    charged_credits: int = 0,
) -> None:
    target_gender = podcast_audio.normalize_gender(voice_gender or doc.get("voice_gender"))
    is_admin = is_admin_user(user)
    state = (doc.get("audio") or {}).get(engine) or {}
    is_charged = state.get("charged", False) or refund_if_no_premium
    _, gemini_tier = (
        _resolve_podcast_gemini_key_and_tier(custom_key, is_admin=is_admin, allow_server_key=is_charged)
        if engine == "gemini"
        else (None, None)
    )
    podcast_audio.ensure_variant_render(
        doc["timeline_id"], doc["id"], engine,
        key_runner=_gemini_key_runner(custom_key, is_admin=is_admin, allow_server_key=is_charged) if engine == "gemini" else None,
        on_complete=_variant_completion_hook(
            user, client_ip, engine, refund_if_no_premium,
            voice_gender=target_gender, key_tier=gemini_tier, refund_pool=refund_pool,
            charged_credits=charged_credits,
        ),
        voice_gender=target_gender,
        owner_id=_podcast_user_id(user),
    )


async def _prune_old_episodes(timeline_id: str, owner_id: Optional[str]) -> None:
    docs = await asyncio.to_thread(podcast_store.list_episodes, timeline_id)
    mine = [d for d in docs if d.get("owner_id") == owner_id and d.get("id") != LEGACY_EPISODE_ID]
    for old in mine[MAX_EPISODES_PER_OWNER_TIMELINE:]:
        podcast_audio.cancel_episode_renders(old["id"])
        await asyncio.to_thread(podcast_store.delete_episode, timeline_id, old["id"])


async def _execute_podcast_episode(
    timeline_id: str,
    req: TimelinePodcastRequest,
    script_key: Optional[str],
    script_tier: str,
    user: Dict[str, Any],
    custom_key: Optional[str],
    client_ip: Optional[str],
    reusable_episode_id: Optional[str] = None,
) -> Dict[str, Any]:
    target_gender = podcast_audio.normalize_gender(req.voice_gender)
    tl_lang = detect_effective_language(
        f"{req.timeline.title or ''} {req.timeline.description or ''}",
        req.timeline.detectedLanguage or "en",
    )
    default_free_eng = default_engine_for_language(tl_lang)
    engine = normalize_engine(req.tts_engine, default=default_free_eng)
    notice = None
    premium_incremented = False
    premium_pool_reserved = False
    premium_credits = 0

    if reusable_episode_id:
        existing = await asyncio.to_thread(podcast_store.get_episode, timeline_id, reusable_episode_id)
        if existing:
            state = (existing.get("audio") or {}).get(engine) or {}
            if engine == "gemini" and not state.get("charged"):
                eff_len = (req.length or existing.get("length") or "full").strip().lower()
                tl_events = len(req.timeline.articles or []) if req.timeline and req.timeline.articles is not None else None
                eff_events = _min_optional_counts(_count_episode_event_segments(existing), tl_events)
                allowed, premium_incremented, premium_pool_reserved, premium_credits = _charge_premium_audio(
                    user, custom_key, client_ip, length=eff_len, event_count=eff_events
                )
                if not allowed:
                    engine = default_engine_for_language(existing.get("detected_language") or tl_lang)
                    notice = "premium_quota_exhausted"

            def _reuse_mutate(d: Dict[str, Any]) -> None:
                _sync_episode_voice_gender(d, target_gender)
                d["default_engine"] = engine
                d["articles_sig"] = _timeline_articles_sig(req.timeline)
                s = podcast_audio.variant_state(d, engine)
                if engine == "gemini":
                    s["charged"] = True
                g_state = podcast_audio.gender_variant_state(d, engine, target_gender)
                if not podcast_audio.variant_is_complete(d, engine, target_gender):
                    g_state["status"] = "rendering"
                podcast_audio.sync_engine_state_for_gender(d, engine, target_gender)

            doc = await podcast_audio.update_episode(timeline_id, reusable_episode_id, _reuse_mutate) or existing
            if not podcast_audio.variant_is_complete(doc, engine, target_gender):
                _start_variant_render(
                    doc, engine, user, custom_key, client_ip,
                    refund_if_no_premium=premium_incremented,
                    voice_gender=target_gender,
                    refund_pool=premium_pool_reserved,
                    charged_credits=premium_credits,
                )
            meta = await _podcast_timeline_meta(timeline_id)
            return {"episode": _public_episode(doc, user, meta), "notice": notice, "reused_script": True}

    async with track_ai_activity(
        "generate_podcast", user,
        key_tier=script_tier,
        content_mode=req.content_mode or req.timeline.contentMode,
        timeline_id=timeline_id,
        language=req.timeline.detectedLanguage,
        details={"format": req.format, "voice_gender": req.voice_gender, "length": req.length, "tts_engine": req.tts_engine},
    ) as activity:
        result = await run_with_key_failover(
            lambda key: generate_timeline_podcast(
                current_timeline=req.timeline,
                format_mode=req.format,
                voice_gender=req.voice_gender,
                length=req.length,
                api_key=key,
                content_mode=req.content_mode,
            ),
            script_key, script_tier, label="timeline podcast",
        )
        script = result["script"]
        activity["result_count"] = len(script["segments"])
        activity["language"] = script.get("detected_language") or activity.get("language")
        activity["details"].update(result.get("estimates") or {})

    if not req.tts_engine:
        engine = default_engine_for_language(script.get("detected_language") or tl_lang)

    if engine == "gemini":
        eff_len = (req.length or "full").strip().lower()
        tl_events = len(req.timeline.articles or []) if req.timeline and req.timeline.articles is not None else None
        eff_events = _min_optional_counts(_count_episode_event_segments(script), tl_events)
        allowed, premium_incremented, premium_pool_reserved, premium_credits = _charge_premium_audio(
            user, custom_key, client_ip, length=eff_len, event_count=eff_events
        )
        if not allowed:
            engine = default_engine_for_language(script.get("detected_language") or tl_lang)
            notice = "premium_quota_exhausted"

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": uuid.uuid4().hex,
        "timeline_id": timeline_id,
        "owner_id": _podcast_user_id(user),
        "created_at": now,
        "updated_at": now,
        "source": "generated",
        "articles_sig": _timeline_articles_sig(req.timeline),
        **script,
        "default_engine": engine,
        "audio": {
            engine: {
                "status": "rendering",
                "charged": engine == "gemini",
                "clips": {},
                "by_gender": {target_gender: {"status": "rendering", "clips": {}}},
            }
        },
        "estimates": result.get("estimates") or {},
        "tokenUsage": result.get("tokenUsage"),
        "script_cost_usd": (
            round(float(result["tokenUsage"]["estimatedCostUsd"]), 6)
            if isinstance(result.get("tokenUsage"), dict) and result["tokenUsage"].get("estimatedCostUsd") is not None
            else None
        ),
    }
    try:
        await asyncio.to_thread(podcast_store.save_episode, doc)
    except Exception:
        if premium_incremented:
            refund_user_quota(user, client_ip=client_ip, refund_pool=premium_pool_reserved, credits=premium_credits)
        elif premium_pool_reserved:
            refund_community_paid_prompt(credits=premium_credits)
        raise
    try:
        await _prune_old_episodes(timeline_id, doc["owner_id"])
    except Exception as e:
        logger.warning(f"Could not prune old podcast episodes for {timeline_id}: {e}")
    _start_variant_render(
        doc, engine, user, custom_key, client_ip,
        refund_if_no_premium=premium_incremented,
        voice_gender=target_gender,
        refund_pool=premium_pool_reserved,
        charged_credits=premium_credits,
    )

    meta = await _podcast_timeline_meta(timeline_id)
    return {"episode": _public_episode(doc, user, meta), "notice": notice, "tokenUsage": result.get("tokenUsage")}


@app.get("/api/podcast/options")
async def podcast_options(
    lang: Optional[str] = Query(default="en", max_length=10),
    format: str = Query(default="single", pattern="^(single|duo)$"),
    gender: str = Query(default="male", pattern="^(male|female)$"),
):
    """Voice engines available for a language/host setup (drives the studio's voice choices)."""
    return {"engines": available_engines(lang, format, gender), "language": detect_effective_language("", lang)}


@app.get("/api/podcast/voice-preview", dependencies=[Depends(podcast_audio_rate_limiter)])
async def podcast_voice_preview(
    engine: str = Query(default="edge", pattern="^(edge|gcloud|gemini)$"),
    gender: str = Query(default="male", pattern="^(male|female)$"),
    lang: Optional[str] = Query(default="en", max_length=10),
    format: str = Query(default="single", pattern="^(single|duo)$"),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    """A short fixed sample sentence per language/voice, rendered once and cached forever."""
    try:
        is_admin = is_admin_user(user) if user else False
        clip = await podcast_audio.render_voice_preview(
            engine, gender, lang, format,
            key_runner=_gemini_key_runner(x_gemini_api_key, is_admin=is_admin, allow_server_key=True) if engine == "gemini" else None,
        )
        return clip
    except Exception as e:
        logger.warning(f"Voice preview failed ({engine}/{gender}/{lang}): {e}")
        raise HTTPException(status_code=503, detail="This voice preview is temporarily unavailable.")


@app.post("/api/timelines/{timeline_id}/podcasts/start", dependencies=[Depends(timeline_rate_limiter)])
async def start_podcast_episode(
    timeline_id: str,
    req: TimelinePodcastRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """Start generating a podcast episode (script, then background audio render) for a timeline."""
    _strip_heavy_media_from_timeline(req.timeline)
    if req.timeline.id and req.timeline.id != timeline_id:
        raise HTTPException(status_code=400, detail="Timeline id mismatch.")
    if not req.timeline.articles:
        raise HTTPException(status_code=400, detail="Timeline has no events to generate a podcast from.")
    meta = await _podcast_timeline_meta(timeline_id)
    if not _can_view_timeline(meta, user):
        raise HTTPException(status_code=404, detail="Timeline not found")
    try:
        client_ip = get_client_ip(request)
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        reusable = await _find_reusable_episode(timeline_id, req, user)
        if reusable:
            script_key, script_tier, incremented_quota = None, "reused", False
        else:
            script_key, script_tier, _ = resolve_gemini_key(user, x_gemini_api_key, increment_usage=True, client_ip=client_ip)
            incremented_quota = _quota_counts_usage(user, x_gemini_api_key)
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(script_tier),
        )
        reusable_id = reusable["id"] if reusable else None
        task = asyncio.create_task(_run_ai_job(
            job_id,
            lambda: _execute_podcast_episode(
                timeline_id, req, script_key, script_tier, user, x_gemini_api_key, client_ip,
                reusable_episode_id=reusable_id,
            ),
            user,
            label="podcast",
        ))
        _AI_JOBS[job_id]["task"] = task
        return {"job_id": job_id, "status": "pending"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting podcast job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.get("/api/timelines/{timeline_id}/podcasts", dependencies=[Depends(podcast_view_rate_limiter)])
async def list_podcast_episodes(
    timeline_id: str,
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    meta = await _podcast_timeline_meta(timeline_id)
    if not _can_view_timeline(meta, user):
        raise HTTPException(status_code=404, detail="Timeline not found")
    docs = await asyncio.to_thread(podcast_store.list_episodes, timeline_id)
    if meta and (meta.get("data") or meta.get("has_legacy_podcast")) and not any(d.get("id") == LEGACY_EPISODE_ID for d in docs):
        full_meta = meta if meta.get("data") else await _podcast_timeline_meta(timeline_id, include_data=True)
        if full_meta and full_meta.get("data"):
            meta = full_meta
    if meta and meta.get("data") and not any(d.get("id") == LEGACY_EPISODE_ID for d in docs):
        legacy = _legacy_episode_from_timeline(timeline_id, meta["data"], meta.get("owner_id"))
        if legacy:
            await asyncio.to_thread(podcast_store.save_episode, legacy)
            docs.append(legacy)
    visible = [d for d in docs if _episode_visible(d, user, meta)]
    visible.sort(key=lambda d: d.get("created_at") or "", reverse=True)
    return {"episodes": [_public_episode(d, user, meta) for d in visible]}


@app.get("/api/timelines/{timeline_id}/podcasts/{episode_id}", dependencies=[Depends(podcast_view_rate_limiter)])
async def get_podcast_episode(
    timeline_id: str,
    episode_id: str,
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    doc, meta = await _load_visible_episode(timeline_id, episode_id, user)
    return _public_episode(doc, user, meta)


@app.delete("/api/timelines/{timeline_id}/podcasts/{episode_id}")
async def delete_podcast_episode(
    timeline_id: str,
    episode_id: str,
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    doc, meta = await _load_visible_episode(timeline_id, episode_id, user)
    if not _can_manage_episode(doc, user, meta):
        raise HTTPException(status_code=403, detail="Only the episode's creator or the timeline owner can delete it.")
    podcast_audio.cancel_episode_renders(episode_id)
    await asyncio.to_thread(podcast_store.delete_episode, timeline_id, episode_id)
    return {"deleted": True}


@app.post("/api/timelines/{timeline_id}/podcasts/{episode_id}/audio", dependencies=[Depends(podcast_audio_rate_limiter)])
async def request_podcast_audio(
    timeline_id: str,
    episode_id: str,
    body: PodcastAudioRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """Ensure every chapter is rendered with `engine` and `voice_gender` (reusing the existing script)."""
    doc, meta = await _load_visible_episode(timeline_id, episode_id, user)
    engine = normalize_engine(body.engine)
    target_gender = podcast_audio.normalize_gender(body.voice_gender or doc.get("voice_gender"))
    can_manage = _can_manage_episode(doc, user, meta)
    client_ip = get_client_ip(request)
    state = (doc.get("audio") or {}).get(engine) or {}
    refund_if_no_premium = False
    refund_pool_if_no_premium = False
    audio_credits_charged = 0

    if engine == "gemini" and not state.get("charged"):
        eff_len = (doc.get("length") or "full").strip().lower()
        tl_articles = ((meta or {}).get("data") or {}).get("articles") if isinstance(meta, dict) else None
        tl_events = meta.get("article_count") if (isinstance(meta, dict) and isinstance(meta.get("article_count"), int)) else (len(tl_articles) if isinstance(tl_articles, list) else None)
        eff_events = _min_optional_counts(_count_episode_event_segments(doc), tl_events)
        allowed, incremented, pool_reserved, audio_credits_charged = _charge_premium_audio(
            user, x_gemini_api_key, client_ip, length=eff_len, event_count=eff_events
        )
        if not allowed:
            audio_cost = _resolve_podcast_gemini_audio_cost(length=eff_len, event_count=eff_events)
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Not enough premium AI credits (requires {audio_cost} credits). "
                    "Please choose a free voice engine or configure a paid personal Gemini API key in Settings."
                ),
            )
        refund_if_no_premium = incremented
        refund_pool_if_no_premium = pool_reserved

    def _prepare(d: Dict[str, Any]) -> None:
        if body.voice_gender and can_manage:
            _sync_episode_voice_gender(d, target_gender)
            d["default_engine"] = engine
        s = podcast_audio.variant_state(d, engine)
        if engine == "gemini" and not s.get("charged"):
            s["charged"] = True
        g_state = podcast_audio.gender_variant_state(d, engine, target_gender)
        if not podcast_audio.variant_is_complete(d, engine, target_gender):
            g_state["status"] = "rendering"
        if podcast_audio.normalize_gender(d.get("voice_gender")) == target_gender:
            podcast_audio.sync_engine_state_for_gender(d, engine, target_gender)

    doc = await podcast_audio.update_episode(timeline_id, episode_id, _prepare) or doc

    if not podcast_audio.variant_is_complete(doc, engine, target_gender):
        _start_variant_render(
            doc, engine, user, x_gemini_api_key, client_ip,
            refund_if_no_premium, voice_gender=target_gender, refund_pool=refund_pool_if_no_premium,
            charged_credits=audio_credits_charged,
        )
    return _public_episode(doc, user, meta, voice_gender=target_gender)


async def _await_until_disconnect(request: Optional[Request], coro: Any) -> Any:
    """Await `coro`, cancelling it if the HTTP client disconnects (e.g. skipped chapter AbortController)."""
    if request is None:
        return await coro
    task = asyncio.ensure_future(coro)
    if task.done():
        return task.result()

    async def _watch_disconnect() -> None:
        while not task.done():
            await asyncio.sleep(0.25)
            if task.done():
                return
            try:
                if await request.is_disconnected():
                    task.cancel()
                    return
            except Exception:
                return

    watcher = asyncio.create_task(_watch_disconnect())
    try:
        return await task
    finally:
        watcher.cancel()
        try:
            await watcher
        except (asyncio.CancelledError, Exception):
            pass


@app.get(
    "/api/timelines/{timeline_id}/podcasts/{episode_id}/segments/{segment_id}/clip",
    dependencies=[Depends(podcast_audio_rate_limiter)],
)
async def get_podcast_clip(
    timeline_id: str,
    episode_id: str,
    segment_id: str,
    request: Request,
    engine: str = Query(default="edge", pattern="^(edge|gcloud|gemini)$"),
    gender: Optional[str] = Query(default=None, pattern="^(male|female)$"),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    """Chapter audio manifest (stream URL, duration, turn & sentence timings), rendering it if needed."""
    doc, _ = await _load_visible_episode(timeline_id, episode_id, user)
    segment = next((s for s in doc.get("segments") or [] if s.get("id") == segment_id), None)
    if not segment:
        raise HTTPException(status_code=404, detail="Chapter not found")
    target_gender = podcast_audio.normalize_gender(gender or doc.get("voice_gender"))
    state = (doc.get("audio") or {}).get(engine) or {}
    if engine == "gemini" and not state.get("charged"):
        raise HTTPException(status_code=402, detail="Premium voices are not unlocked for this episode.")
    is_admin = is_admin_user(user) if user else False
    try:
        clip = await _await_until_disconnect(
            request,
            podcast_audio.render_clip(
                doc,
                segment,
                engine,
                key_runner=_gemini_key_runner(
                    x_gemini_api_key, is_admin=is_admin, allow_server_key=bool(state.get("charged"))
                )
                if engine == "gemini"
                else None,
                voice_gender=target_gender,
                model=podcast_audio.pinned_model(doc, engine, target_gender),
                priority=podcast_audio.PRIORITY_INTERACTIVE,
            ),
        )
    except asyncio.CancelledError:
        return Response(status_code=499)
    except Exception as e:
        logger.error(f"Podcast clip render failed ({episode_id}/{segment_id}/{engine}/{target_gender}): {e}", exc_info=True)
        raise HTTPException(status_code=503, detail="This chapter's audio couldn't be produced right now. Please try again.")

    summary = podcast_audio.clip_summary(clip)
    g_clips = ((state.get("by_gender") or {}).get(target_gender) or {}).get("clips") or {}
    is_doc_gender = target_gender == podcast_audio.normalize_gender(doc.get("voice_gender"))
    # Record new and changed clips (re-renders after a version bump, fallback retries, model re-pins):
    # that is what completes the variant, pins the Gemini model and invalidates a stale episode file.
    if g_clips.get(segment_id) != summary or (is_doc_gender and (state.get("clips") or {}).get(segment_id) != summary):

        def _record(d: Dict[str, Any]) -> None:
            podcast_audio.record_clip_summary(d, engine, segment_id, summary, target_gender)

        try:
            await podcast_audio.update_episode(timeline_id, episode_id, _record)
        except Exception as e:
            logger.warning(f"Could not record clip on episode {episode_id}: {e}")
    if clip.get("cost_usd") is not None:
        clip["cost_usd"] = round(float(clip["cost_usd"]), 6)
    clip.pop("input_tokens", None)
    clip.pop("output_tokens", None)
    clip.pop("thinking_tokens", None)
    return clip


@app.get(
    "/api/timelines/{timeline_id}/podcasts/{episode_id}/episode-audio",
    dependencies=[Depends(podcast_audio_rate_limiter)],
)
async def get_podcast_episode_audio(
    timeline_id: str,
    episode_id: str,
    engine: str = Query(default="edge", pattern="^(edge|gcloud|gemini)$"),
    gender: Optional[str] = Query(default=None, pattern="^(male|female)$"),
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    """
    Continuous whole-episode audio for gapless playback: one stream URL plus each chapter's start
    offset and transcript timings. `ready` is false until every chapter has been rendered.
    """
    doc, _ = await _load_visible_episode(timeline_id, episode_id, user)
    target_gender = podcast_audio.normalize_gender(gender or doc.get("voice_gender"))
    if engine == "gemini" and not ((doc.get("audio") or {}).get("gemini") or {}).get("charged"):
        raise HTTPException(status_code=402, detail="Premium voices are not unlocked for this episode.")
    try:
        manifest = await podcast_audio.get_episode_audio(doc, engine, voice_gender=target_gender)
    except Exception as e:
        logger.warning(f"Continuous podcast audio failed ({episode_id}/{engine}/{target_gender}): {e}")
        manifest = None
    if not manifest:
        return {"ready": False}
    return {"ready": True, **manifest}


def _audio_range_response(data: bytes, range_header: Optional[str]) -> Response:
    total = len(data)
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
    }
    if range_header and range_header.strip().lower().startswith("bytes="):
        spec = range_header.strip()[6:].split(",")[0].strip()
        start_s, _, end_s = spec.partition("-")
        try:
            if start_s == "":
                start, end = max(0, total - int(end_s)), total - 1
            else:
                start = int(start_s)
                end = int(end_s) if end_s else total - 1
        except ValueError:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
        if start >= total or start > end:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
        end = min(end, total - 1)
        return Response(
            content=data if (start == 0 and end == total - 1) else data[start:end + 1],
            status_code=206,
            media_type="audio/mpeg",
            headers={**headers, "Content-Range": f"bytes {start}-{end}/{total}"},
        )
    return Response(content=data, media_type="audio/mpeg", headers=headers)


@app.get("/api/podcast-audio/{clip_name}", dependencies=[Depends(podcast_stream_rate_limiter)])
async def stream_podcast_audio(clip_name: str, request: Request):
    """Public, immutable, content-addressed chapter audio (unguessable 256-bit keys), with Range support."""
    key = clip_name[:-4] if clip_name.endswith(".mp3") else clip_name
    if not podcast_store.is_valid_clip_key(key):
        raise HTTPException(status_code=404, detail="Audio not found")
    data = await asyncio.to_thread(podcast_store.get_clip_audio, key)
    if not data:
        raise HTTPException(status_code=404, detail="Audio not found")
    return _audio_range_response(data, request.headers.get("range"))


@app.get("/api/timelines/{timeline_id}/podcasts/{episode_id}/download", dependencies=[Depends(podcast_audio_rate_limiter)])
async def download_podcast_episode(
    timeline_id: str,
    episode_id: str,
    engine: str = Query(default="edge", pattern="^(edge|gcloud|gemini)$"),
    gender: Optional[str] = Query(default=None, pattern="^(male|female)$"),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    """The whole episode as one MP3 (chapters joined with short pauses, ID3 title tag)."""
    doc, _ = await _load_visible_episode(timeline_id, episode_id, user)
    target_gender = podcast_audio.normalize_gender(gender or doc.get("voice_gender"))
    if engine == "gemini" and not ((doc.get("audio") or {}).get("gemini") or {}).get("charged"):
        raise HTTPException(status_code=402, detail="Premium voices are not unlocked for this episode.")
    is_admin = is_admin_user(user) if user else False
    try:
        data = None
        manifest = await podcast_audio.get_episode_audio(doc, engine, voice_gender=target_gender)
        if manifest:
            data = await asyncio.to_thread(podcast_store.get_clip_audio, manifest["key"])
        if not data:
            data = await podcast_audio.build_episode_mp3(
                doc, engine,
                key_runner=_gemini_key_runner(x_gemini_api_key, is_admin=is_admin) if engine == "gemini" else None,
                voice_gender=target_gender,
            )
    except Exception as e:
        logger.error(f"Podcast download failed ({episode_id}/{engine}/{target_gender}): {e}", exc_info=True)
        raise HTTPException(status_code=503, detail="The episode audio couldn't be prepared right now. Please try again.")
    title = re.sub(r"[\x00-\x1f\\/:*?\"<>|]+", "", doc.get("title") or "ChroniX podcast").strip() or "ChroniX podcast"
    quoted = urllib.parse.quote(f"{title}.mp3")
    return Response(
        content=data,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": f"attachment; filename=\"chronix-podcast.mp3\"; filename*=UTF-8''{quoted}",
            "Cache-Control": "no-store",
        },
    )


@app.post("/api/activity/podcast", status_code=204, dependencies=[Depends(podcast_activity_rate_limiter)])
async def report_podcast_listen(
    payload: PodcastListenReport,
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """Listening analytics: play start (time to first audio), completion and session summaries."""
    log_podcast_listen(
        user,
        content_mode=payload.content_mode,
        timeline_id=payload.timeline_id,
        result_count=payload.chapters_completed,
        duration_ms=int((payload.listened_seconds or 0) * 1000),
        details={
            "event": payload.event,
            "episode_id": payload.episode_id,
            "engine": payload.engine,
            "chapters_total": payload.chapters_total,
            "chapters_completed": payload.chapters_completed,
            "max_chapter_reached": payload.max_chapter_reached,
            "listened_seconds": round(payload.listened_seconds, 1) if payload.listened_seconds is not None else None,
            "episode_seconds": round(payload.episode_seconds, 1) if payload.episode_seconds is not None else None,
            "completion_ratio": (
                round(min(1.0, payload.listened_seconds / payload.episode_seconds), 3)
                if payload.listened_seconds is not None and payload.episode_seconds
                else None
            ),
            "time_to_first_audio_ms": payload.time_to_first_audio_ms,
            "buffering_ms": payload.buffering_ms,
            "fallback_count": payload.fallback_count,
            "is_shared_view": payload.is_shared_view,
            "music_enabled": payload.music_enabled,
            "music_mood": payload.music_mood if payload.music_mood in PODCAST_MUSIC_MOODS else None,
        },
    )
    return Response(status_code=204)


@app.post(
    "/api/timeline/chat/attach-files",
    response_model=TimelineChatResponse,
    dependencies=[Depends(timeline_rate_limiter), Depends(file_upload_rate_limiter)],
)
async def chat_attach_files_endpoint(
    request: Request,
    timeline: str = Form(...),
    message: Optional[str] = Form(None),
    content_mode: Optional[str] = Form(None),
    input_method: Optional[str] = Form(None),
    files: List[UploadFile] = File(default=[]),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Chat-attached files: extracts new events from uploaded photos/PDFs/text files and merges them
    into the current timeline via the refine pipeline (counts as one refinement, same as any
    other chat edit). Attaching files always implies an edit intent — no answer/edit
    classification step is needed here.
    """
    try:
        try:
            timeline_data = TimelineData(**json.loads(timeline))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid timeline payload.")

        has_custom_key = bool(x_gemini_api_key and x_gemini_api_key.strip())
        validated_uploads = await validate_and_read_uploads(
            files,
            "",
            request=request,
            user=user,
            has_custom_key=has_custom_key,
            prompt_mode=False,
            is_chat=True,
            require_files_only=True,
        )

        timeline_id = timeline_data.id
        client_ip = get_client_ip(request)
        upload_credits = calculate_upload_credit_cost(
            validated_uploads, is_chat_or_refine=True
        )
        api_key, key_tier, is_admin = resolve_gemini_key(
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip, credits=upload_credits
        )
        incremented_quota = bool(key_tier in ("paid", "free") and not is_admin and not has_custom_key)
        instruction = (message or "").strip() or "Add any new events described or depicted in the attached files to this timeline."
        logger.info(
            f"Chat file-attach edit on timeline {timeline_id} for user {user.get('id')} using {key_tier} key "
            f"({validated_uploads.total_accepted_files} files, credits={upload_credits})"
        )

        previous_article_ids = {a.id for a in timeline_data.articles}
        chat_details: Dict[str, Any] = {
            "file_count": validated_uploads.total_accepted_files,
            "image_count": validated_uploads.image_count,
            "doc_count": validated_uploads.doc_count,
            "events_before": len(previous_article_ids),
            "credits_charged": upload_credits,
            "input_method": normalize_input_method(input_method, bool((message or "").strip())),
        }
        if validated_uploads.total_pdf_pages > 0:
            chat_details["pdf_pages"] = validated_uploads.total_pdf_pages

        try:
            async with track_ai_activity(
                "chat_attach_files", user,
                key_tier=key_tier,
                content_mode=content_mode or timeline_data.contentMode,
                prompt=(message or "").strip() or None,
                timeline_id=timeline_id,
                details=chat_details,
            ) as activity:
                updated_timeline = await run_with_key_failover(
                    lambda key: refine_timeline_with_gemini(
                        current_timeline=timeline_data,
                        instruction=instruction,
                        api_key=key,
                        files=validated_uploads.binary_files,
                        content_mode=content_mode,
                        extracted_documents=validated_uploads.extracted_documents or None,
                    ),
                    api_key, key_tier, label="chat file-attach edit"
                )
                apply_timeline_result(activity, updated_timeline)

                user_id = user.get("id")
                await asyncio.to_thread(save_timeline_data, updated_timeline.model_dump(by_alias=True), user_id=user_id)
        except Exception:
            if incremented_quota:
                try:
                    refund_user_quota(
                        user,
                        client_ip=client_ip,
                        refund_pool=community_pool_reserved_for_tier(key_tier),
                        credits=upload_credits,
                    )
                except Exception as refund_err:
                    logger.warning(f"Failed to refund quota after chat_attach_files error: {refund_err}")
            elif community_pool_reserved_for_tier(key_tier):
                try:
                    refund_community_paid_prompt(credits=upload_credits)
                except Exception:
                    pass
            raise

        added_count = sum(1 for a in updated_timeline.articles if a.id not in previous_article_ids)
        is_hebrew = (
            getattr(updated_timeline, "detectedLanguage", None) == "he"
            or bool(re.search(r"[\u0590-\u05FF]", f"{message or ''} {updated_timeline.title or ''}"))
        )
        if is_hebrew:
            reply = (
                f"הוספתי {added_count} אירועים חדשים מתוך התמונה/הקבצים שצירפת לציר הזמן."
                if added_count > 0
                else "עדכנתי את ציר הזמן בהתאם לתמונה/לקבצים שצירפת."
            )
        else:
            reply = (
                f"I've added {added_count} new event(s) from your photo/files to the timeline."
                if added_count > 0
                else "I looked through your files but couldn't find any clear new events to add — try attaching clearer photos or more text."
            )

        return TimelineChatResponse(
            reply=reply,
            action="edit",
            updated_timeline=updated_timeline,
            is_relevant=True,
            model=(updated_timeline.tokenUsage or {}).get("model") if updated_timeline else None,
        )
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in chat_attach_files: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))

@app.get("/api/timelines")
async def get_all_timelines(all: bool = False, user: Dict[str, Any] = Depends(get_current_user_required)):
    user_id = user.get("id")
    want_all = bool(all) and is_admin_user(user)
    return list_all_timelines(user_id=user_id, all_users=want_all)

@app.get("/api/admin/users")
async def get_admin_users(user: Dict[str, Any] = Depends(get_current_user_required)):
    """
    Admin-only: list registered users (incl. guest/anonymous accounts) with
    signup and last-login timestamps, sourced from Supabase Auth.
    """
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Admin access required")
    return await list_all_users()


@app.get("/api/community/ledger", dependencies=[Depends(shared_view_rate_limiter)])
async def get_community_transparency_ledger(response: Response):
    """
    Public endpoint returning the cumulative Community Transparency Ledger:
    total AI spend vs. voluntary community donations.
    Seeds historical spend from `activity_log` on first run if not yet seeded.
    """
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return await asyncio.to_thread(sync_historical_spend_from_activity_log, False)


@app.post("/api/admin/community/ledger")
async def update_community_transparency_ledger(
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """
    Admin-only endpoint to manually set or sync the Community Transparency Ledger totals.
    """
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Admin access required")

    if body.get("sync_from_activity_log"):
        ledger, sync_error = await asyncio.to_thread(admin_sync_historical_spend)
        if sync_error:
            # Nothing was written: a failed/unavailable activity_log must never reset the ledger.
            raise HTTPException(status_code=502, detail=f"Ledger not changed. {sync_error}")
        return ledger

    if body.get("simulate_donation_usd") is not None:
        try:
            sim_amount = float(body["simulate_donation_usd"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid simulated donation amount")
        return await asyncio.to_thread(
            record_community_donation_usd,
            sim_amount,
            tx_id=f"admin-sim-{uuid.uuid4().hex[:12]}",
            currency="USD",
        )

    spent_usd = body.get("spent_usd")
    donated_usd = body.get("donated_usd")
    donations_count = body.get("donations_count")

    try:
        spent_val = float(spent_usd) if spent_usd is not None and spent_usd != "" else None
        donated_val = float(donated_usd) if donated_usd is not None and donated_usd != "" else None
        count_val = int(donations_count) if donations_count is not None and donations_count != "" else None
    except (TypeError, ValueError, OverflowError):
        raise HTTPException(status_code=400, detail="Invalid numeric values for community ledger")

    try:
        return await asyncio.to_thread(
            set_community_ledger_totals,
            spent_usd=spent_val,
            donated_usd=donated_val,
            donations_count=count_val,
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@app.post("/api/webhooks/kofi")
async def kofi_donation_webhook(request: Request):
    """
    Automatic Ko-fi webhook endpoint (`https://ko-fi.com/manage/webhooks`).
    Accepts Ko-fi's standard `application/x-www-form-urlencoded` (`data=<json>`) or `application/json`,
    verifies `KOFI_VERIFICATION_TOKEN`, deduplicates by `kofi_transaction_id`/`message_id`,
    and increments the Community Transparency Ledger.
    """
    import hmac

    expected_token = os.getenv("KOFI_VERIFICATION_TOKEN", "").strip()
    if not expected_token:
        raise HTTPException(
            status_code=503,
            detail="KOFI_VERIFICATION_TOKEN is not configured on the server.",
        )

    content_type = (request.headers.get("content-type") or "").lower()
    payload: Optional[Dict[str, Any]] = None

    try:
        if "application/json" in content_type:
            raw_json = await request.json()
            if isinstance(raw_json, dict):
                if isinstance(raw_json.get("data"), str):
                    payload = json.loads(raw_json["data"])
                else:
                    payload = raw_json
        else:
            form = await request.form()
            data_str = form.get("data")
            if isinstance(data_str, str) and data_str.strip():
                payload = json.loads(data_str)
    except Exception:
        payload = None

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid Ko-fi webhook payload")

    provided_token = str(payload.get("verification_token") or "").strip()
    if not provided_token or not hmac.compare_digest(provided_token, expected_token):
        raise HTTPException(status_code=403, detail="Invalid Ko-fi verification token")

    try:
        amount = float(payload.get("amount") or 0.0)
    except (TypeError, ValueError):
        amount = 0.0

    currency = str(payload.get("currency") or "USD").strip().upper()
    tx_id = str(payload.get("kofi_transaction_id") or payload.get("message_id") or "").strip() or None

    result = await asyncio.to_thread(
        record_community_donation_usd,
        amount,
        tx_id=tx_id,
        currency=currency,
    )
    logger.info(
        f"Ko-fi webhook processed: amount={amount} {currency}, tx_id={tx_id}, "
        f"recorded={result.get('recorded')}, duplicate={result.get('duplicate')}"
    )
    return {"status": "ok", **result}


@app.get("/api/timelines/match", dependencies=[Depends(shared_view_rate_limiter)])
async def match_existing_timelines(
    q: str = Query("", max_length=300),
    content_mode: Optional[str] = Query(None, max_length=24),
    limit: int = Query(3, ge=1, le=10),
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    """
    Find existing shared or user-owned non-personal timelines matching a topic query `q`.
    Allows instant 0-token reuse ("Community Cache") before generating a new timeline.
    """
    clean_q = (q or "").strip()
    if len(clean_q) < 2:
        return []
    user_id = user.get("id") if user else None
    is_admin = bool(user and is_admin_user(user))
    return await asyncio.to_thread(
        find_matching_timelines,
        clean_q,
        content_mode=content_mode,
        user_id=user_id,
        is_admin=is_admin,
        limit=limit,
    )


@app.get("/api/timelines/{timeline_id}", dependencies=[Depends(shared_view_rate_limiter)])
async def get_single_timeline(
    timeline_id: str,
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional)
):
    """
    Fetch a timeline by id. Requires NO authentication so "anyone with the link" shared
    views work, but access is still gated: the owner always sees their own timeline;
    admins can access any timeline; everyone else only sees it if the owner has explicitly enabled sharing.
    """
    meta = get_timeline_with_meta(timeline_id)
    if not meta or not meta.get("data"):
        raise HTTPException(status_code=404, detail="Timeline not found")

    owner_id = meta.get("owner_id")
    is_admin = bool(user and is_admin_user(user))
    is_owner = bool(user and owner_id and user.get("id") == owner_id)
    is_shared = bool(meta.get("is_shared"))
    data_obj = meta.get("data") or {}
    is_deleted = bool(data_obj.get("isDeleted") or data_obj.get("is_deleted"))

    if is_deleted and not is_admin:
        raise HTTPException(status_code=404, detail="Timeline not found")

    if not is_owner and not is_shared and not is_admin:
        # Don't reveal that a private timeline with this id exists.
        raise HTTPException(status_code=404, detail="Timeline not found")

    return {
        **meta["data"],
        "isOwner": is_owner or is_admin,
        "isShared": is_shared,
        "isAdmin": is_admin
    }

@app.patch("/api/timelines/{timeline_id}/share")
async def set_timeline_share_status(
    timeline_id: str,
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Owner-only or Admin: enable/disable the shareable "anyone with the link" flag."""
    enabled = bool(body.get("enabled", True))
    author_name = body.get("authorName") or body.get("author_name")
    meta = get_timeline_with_meta(timeline_id)
    if not meta or not meta.get("data"):
        raise HTTPException(status_code=404, detail="Timeline not found")
    
    owner_id = meta.get("owner_id")
    is_owner = (owner_id is None) or bool(user and owner_id == user.get("id"))
    is_admin = is_admin_user(user)
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403, detail="Only the owner or an admin can change sharing for this timeline")

    target_user_id = user.get("id") if (is_owner and owner_id is not None) else None
    try:
        success = set_timeline_shared(timeline_id, target_user_id, enabled, author_name=author_name)
    except TypeError:
        success = set_timeline_shared(timeline_id, target_user_id, enabled)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update sharing status")
    return {"isShared": enabled, "authorName": author_name}

@app.post("/api/timelines")
async def save_timeline(
    timeline: dict = Body(...),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    user_id = user.get("id")
    timeline_id = timeline.get("id")
    target_owner = user_id
    if timeline_id:
        existing_meta = _get_timeline_access_meta_sync(timeline_id)
        if existing_meta and existing_meta.get("owner_id"):
            owner_id = existing_meta.get("owner_id")
            if owner_id != user_id and not is_admin_user(user):
                raise HTTPException(
                    status_code=403,
                    detail="You cannot overwrite someone else's timeline. Please save a copy instead."
                )
            if is_admin_user(user) and owner_id != user_id:
                target_owner = owner_id
    saved = save_timeline_data(timeline, user_id=target_owner)
    return saved

@app.delete("/api/timelines")
async def delete_all_timelines(
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    await asyncio.to_thread(delete_all_user_timelines, user_id, True)
    return {"success": True}

@app.delete("/api/timelines/{timeline_id}")
async def delete_timeline(
    timeline_id: str,
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    user_id = user.get("id")
    target_user_id = None if is_admin_user(user) else user_id
    deleted = delete_timeline_data(timeline_id, user_id=target_user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Timeline not found")
    return {"success": True}


MAX_STORED_CHAT_MESSAGES = 100
MAX_STORED_CHAT_CONTENT_CHARS = 20000
MAX_STORED_CHAT_BYTES = 1_000_000


def _sanitize_chat_messages(messages: Any) -> List[Dict[str, Any]]:
    """Whitelists the fields the chat UI renders; drops anything malformed."""
    if not isinstance(messages, list):
        raise HTTPException(status_code=400, detail="messages must be a list")
    clean: List[Dict[str, Any]] = []
    for m in messages[-MAX_STORED_CHAT_MESSAGES:]:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant"):
            continue
        content = m.get("content")
        if not isinstance(content, str):
            continue
        entry: Dict[str, Any] = {
            "id": str(m.get("id") or "")[:64],
            "role": m["role"],
            "content": content[:MAX_STORED_CHAT_CONTENT_CHARS],
        }
        if m.get("action") in ("answer", "edit"):
            entry["action"] = m["action"]
        for flag in ("error", "undone"):
            if m.get(flag) is True:
                entry[flag] = True
        if m.get("isRelevant") is False:
            entry["isRelevant"] = False
        if m.get("model") and isinstance(m.get("model"), str):
            entry["model"] = str(m["model"]).strip()[:64]
        sources = m.get("sources")
        if isinstance(sources, list):
            safe_sources = [
                {"title": str(s.get("title") or "")[:300], "url": s["url"][:2000]}
                for s in sources[:10]
                if isinstance(s, dict) and isinstance(s.get("url"), str)
                and s["url"].lower().startswith(("https://", "http://"))
            ]
            if safe_sources:
                entry["sources"] = safe_sources
        clean.append(entry)
    return clean


@app.get("/api/timelines/{timeline_id}/chat")
async def get_timeline_chat_endpoint(
    timeline_id: str,
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """The caller's own saved conversation for a timeline. `messages` is null when the store is unavailable."""
    result = await asyncio.to_thread(get_timeline_chat, timeline_id, user.get("id"))
    if result is None:
        return {"messages": None, "updatedAt": None}
    return result


@app.put("/api/timelines/{timeline_id}/chat")
async def save_timeline_chat_endpoint(
    timeline_id: str,
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Replaces the caller's conversation for a timeline they own (or any timeline, for admins)."""
    messages = _sanitize_chat_messages(body.get("messages"))
    if len(json.dumps(messages, ensure_ascii=False).encode("utf-8")) > MAX_STORED_CHAT_BYTES:
        raise HTTPException(status_code=413, detail="Conversation is too large to save")

    owner = await asyncio.to_thread(get_timeline_owner, timeline_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Timeline not found")
    if owner.get("owner_id") != user.get("id") and not is_admin_user(user):
        raise HTTPException(status_code=403, detail="You can only save chats for your own timelines")

    if not await asyncio.to_thread(save_timeline_chat, timeline_id, user.get("id"), messages):
        raise HTTPException(status_code=503, detail="Chat storage is unavailable")
    return {"success": True, "count": len(messages)}

@app.post("/api/user/claim-guest")
async def claim_guest_work(
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Moves timelines created in a guest session into the signed-in account. The caller must
    present that guest session's own token(s), and only anonymous sessions can be claimed.
    """
    if is_guest_user(user):
        raise HTTPException(status_code=400, detail="Sign in to a registered account to keep guest work")

    access_token = body.get("guestAccessToken")
    refresh_token = body.get("guestRefreshToken")
    if not isinstance(access_token, str) and not isinstance(refresh_token, str):
        raise HTTPException(status_code=400, detail="Guest session token is required")

    guest = await resolve_guest_session_user(
        access_token if isinstance(access_token, str) else None,
        refresh_token if isinstance(refresh_token, str) else None,
    )
    if not guest:
        raise HTTPException(status_code=403, detail="Guest session is invalid or expired")
    if guest.get("id") == user.get("id"):
        return {"transferred": 0, "timelineIds": []}

    # Move pending AI jobs first so a generation still running (e.g. the guest signed in
    # mid-generation) saves straight into the account and stays pollable after the redirect.
    moved_jobs = _transfer_ai_jobs(guest["id"], user.get("id"))
    if moved_jobs:
        logger.info(f"Moved {moved_jobs} pending AI job(s) from guest {guest['id']} to {user.get('id')}")

    moved = await asyncio.to_thread(transfer_user_timelines, guest["id"], user.get("id"))
    if moved is None:
        raise HTTPException(status_code=503, detail="Timeline storage is unavailable")
    logger.info(f"Moved {len(moved)} guest timeline(s) from {guest['id']} to {user.get('id')}")
    reassign_user_activity(guest["id"], user.get("id"))
    return {"transferred": len(moved), "timelineIds": moved}

@app.delete("/api/user/account")
async def delete_user_account(
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Deletes a registered user's account permanently:
    1. Rejects guest/anonymous accounts (they can simply sign out / clear local state).
    2. Deletes all timelines owned by this user.
    3. Deletes the user record from Supabase Auth admin API.
    """
    if is_guest_user(user):
        raise HTTPException(
            status_code=400,
            detail="Guest accounts cannot be deleted through this endpoint. Sign out to clear guest session."
        )

    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    # 1. Delete all user timelines
    try:
        await asyncio.to_thread(delete_all_user_timelines, user_id, False, True)
    except Exception as e:
        logger.error(f"Error deleting timelines for user {user_id}: {e}")

    # 2. Delete user from Supabase Auth
    deleted = await delete_supabase_user(user_id)
    if not deleted:
        logger.error(f"Failed to delete Supabase user {user_id}")
        raise HTTPException(status_code=500, detail="Failed to delete user account from authentication provider.")

    logger.info(f"User account {user_id} and all associated data deleted successfully")
    return {"success": True, "message": "Account and associated timelines deleted successfully"}


@app.post("/api/activity/game", status_code=204, dependencies=[Depends(game_activity_rate_limiter)])
async def report_game_completed(
    payload: GameCompletedRequest,
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Records one finished timeline game (score only) in the activity log. Fire-and-forget."""
    log_game_completed(
        user,
        content_mode=payload.content_mode,
        timeline_id=payload.timeline_id,
        result_count=payload.total,
        duration_ms=payload.duration_ms,
        details={
            "game": payload.game,
            "correct": payload.correct,
            "total": payload.total,
            "points": payload.points,
            "ratio": round(payload.ratio, 3) if payload.ratio is not None else None,
            "stars": payload.stars,
            "difficulty": payload.difficulty,
        },
    )
    return Response(status_code=204)


@app.post("/api/timeline/enrich-item")
async def enrich_single_item(payload: dict = Body(...)):
    """
    Enrich an event with Wikipedia thumbnail & description by query.
    Supports any language edition with automatic English fallback.
    """
    title = payload.get("title", "")
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    lang = (payload.get("lang") or "").strip().lower() or "en"

    fallback_title = payload.get("fallback_title") or payload.get("wikipedia_title_en")
    context = payload.get("context") or payload.get("subtitle", "")
    year = payload.get("year")
    is_prehistoric = payload.get("is_prehistoric", False)

    async with wikimedia_http_client() as client:
        sem = asyncio.Semaphore(1)
        res = await fetch_wikipedia_summary(
            title,
            client,
            sem,
            lang=lang,
            context_text=context,
            year=year,
            is_prehistoric=is_prehistoric,
            fallback_lang="en",
            fallback_title=fallback_title
        )
        return res

@app.post("/api/timeline/suggest-event", dependencies=[Depends(event_suggest_rate_limiter)])
async def suggest_single_event(
    payload: EventSuggestionRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Suggest event details using Gemini and Wikipedia.
    Requires authentication. Routes key based on the shared daily AI-operation quota.
    """
    client_ip = get_client_ip(request)
    api_key, key_tier, is_admin = resolve_gemini_key(
        user, x_gemini_api_key or payload.api_key, increment_usage=True, client_ip=client_ip
    )
    if not api_key:
        raise HTTPException(status_code=400, detail="Gemini API Key is missing. Configure it in .env or Settings.")

    try:
        async with track_ai_activity(
            "suggest_event", user,
            key_tier=key_tier,
            content_mode=payload.content_mode or "classic",
            prompt=payload.query,
            timeline_id=payload.timeline_id,
        ) as activity:
            suggestion = await run_with_key_failover(
                lambda key: suggest_event_details(
                    query=payload.query,
                    timeline_topic=payload.timeline_topic or "",
                    time_scale=payload.time_scale or "calendar",
                    lanes=payload.lanes or [],
                    api_key=key,
                    content_mode=payload.content_mode or "classic",
                ),
                api_key, key_tier, label="event suggestion"
            )
            if isinstance(suggestion, dict):
                activity["result_count"] = 1
                activity["details"]["has_image"] = bool(suggestion.get("imageUrl"))
        return suggestion
    except Exception as e:
        logger.error(f"Error suggesting event: {e}")
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post("/api/timeline/generate-event-image", dependencies=[Depends(event_suggest_rate_limiter)])
async def generate_single_event_image(
    payload: EventImageGenerationRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Generate an AI image/illustration for a single timeline event on demand.
    - When `payload.engine == 'free'`, routes directly to the free Hugging Face / Pollinations
      generator without consuming the user's daily premium quota (0 credits).
    - When `payload.engine == 'premium'`, consumes `get_gemini_image_credit_cost()` (default 6)
      credits from the shared daily AI credit bank (refunded if generation fails), or rejects
      with HTTP 402 if the user does not have enough remaining credits.
    """
    client_ip = get_client_ip(request)
    custom_key = x_gemini_api_key or payload.api_key
    requested_engine = (payload.engine or "auto").strip().lower()
    is_admin = is_admin_user(user)
    has_custom_key = bool(custom_key and custom_key.strip())

    if requested_engine == "free" or (requested_engine == "auto" and not has_custom_key and not is_admin):
        prefer_free = True
    else:
        prefer_free = False

    pool_reserved = False
    img_cost = 0
    if prefer_free:
        api_key, key_tier, _ = resolve_gemini_key(
            user, custom_key, increment_usage=False, client_ip=client_ip
        )
        # Prefer a configured free key for prompt translation when available so zero paid tokens are used
        candidate_keys = get_candidate_keys_for_request(None)
        paid_server_key = (os.getenv("GEMINI_API_KEY") or "").strip()
        free_candidates = [k for k in candidate_keys if k and k != paid_server_key]
        if free_candidates and not has_custom_key:
            api_key = free_candidates[0]
            key_tier = "free"
        incremented_quota = False
    else:
        img_cost = get_gemini_image_credit_cost()
        allowed, api_key, key_tier, incremented_quota, pool_reserved = await asyncio.to_thread(
            charge_premium_credits, user, custom_key, client_ip, img_cost
        )
        if not allowed:
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Not enough premium AI credits (requires {img_cost} credits). "
                    "Please use the free image generator or configure a paid personal Gemini API key in Settings."
                ),
            )

    if not api_key and not prefer_free:
        raise HTTPException(status_code=400, detail="Gemini API Key is missing. Configure it in .env or Settings.")

    effective_tier = "free" if prefer_free else key_tier
    try:
        async with track_ai_activity(
            "generate_image", user,
            key_tier=effective_tier,
            content_mode=payload.content_mode or "classic",
            prompt=payload.custom_prompt or payload.title,
            timeline_id=payload.timeline_id,
            details={
                "source": payload.source,
                "style": payload.style or "auto",
                "engine": requested_engine,
                "custom_prompt": bool(payload.custom_prompt),
            },
        ) as activity:
            result = await run_with_key_failover(
                lambda key: generate_event_image_with_gemini(
                    title=payload.title,
                    subtitle=payload.subtitle or "",
                    year=payload.year,
                    time_scale=payload.time_scale or "calendar",
                    timeline_topic=payload.timeline_topic or "",
                    location_name=payload.location_name,
                    is_fictional=bool(payload.is_fictional),
                    custom_prompt=payload.custom_prompt,
                    style=payload.style or "auto",
                    content_mode=payload.content_mode or "classic",
                    api_key=key,
                    prefer_free=prefer_free,
                ),
                api_key, effective_tier, label="event image generation"
            )
            activity["result_count"] = 1 if result and result.get("imageUrl") else 0
            if result and result.get("model"):
                activity["model"] = str(result["model"])[:80]
            if isinstance(result, dict):
                total_cost = round(
                    float(
                        activity.get("cost_usd")
                        or (result.get("tokenUsage") or {}).get("estimatedCostUsd")
                        or result.get("imageCostUsd")
                        or 0.0
                    ),
                    6,
                )
                result["imageCostUsd"] = total_cost
        return result
    except Exception as e:
        if incremented_quota or pool_reserved:
            try:
                if incremented_quota:
                    refund_user_quota(
                        user,
                        client_ip=client_ip,
                        refund_pool=pool_reserved,
                        credits=max(1, img_cost),
                    )
                elif pool_reserved:
                    refund_community_paid_prompt(credits=max(1, img_cost))
            except Exception as refund_err:
                logger.warning(f"Failed to refund quota after failed event image generation: {refund_err}")
        logger.error(f"Error generating event image: {e}")
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.get("/api/timeline/wiki-search")
async def wiki_search(
    query: str,
    lang: Optional[str] = None,
    context: Optional[str] = "",
    limit: int = 5
):
    """
    Search Wikipedia for multiple candidate matches for an event name with optional timeline context.
    """
    clean = query.strip()
    if not clean:
        return []

    lang = (lang or "").strip().lower() or "en"

    async with wikimedia_http_client() as client:
        candidates = await search_wikipedia_candidates(
            query=clean,
            client=client,
            lang=lang,
            context_text=context or "",
            limit=limit
        )
        return candidates

@app.get("/api/timeline/geocode-search")
async def geocode_search(
    query: str,
    lang: Optional[str] = None,
    limit: int = 5
):
    """
    Search for place-name candidates (with coordinates) so the user can pick the
    correct location for a manually added/edited event, syncing it with the map.
    """
    return await search_geocode_candidates(query=query, limit=limit, lang=lang)

@app.get("/api/media/youtube-search", dependencies=[Depends(media_search_rate_limiter)])
async def youtube_search(
    q: str = Query(..., max_length=300),
    lang: Optional[str] = Query(None, max_length=10),
    context: Optional[str] = Query(None, max_length=150),
):
    """Embeddable YouTube videos for an event (drawer Videos tab)."""
    return await search_youtube_videos(q, lang, context=context)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
