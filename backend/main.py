import os
import re
import json
import uuid
import logging
import time
from collections import defaultdict
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
    TimelineChatOutput
)
from services.gemini_service import (
    generate_timeline_with_gemini,
    generate_timeline_from_files,
    refine_timeline_with_gemini,
    suggest_event_details,
    chat_about_timeline,
    normalize_event_dates
)
from services.wiki_enricher import (
    fetch_wikipedia_summary,
    search_wikipedia_candidates,
    search_geocode_candidates,
    enrich_events_with_wikipedia
)
from services.storage import (
    list_all_timelines,
    get_timeline_by_id,
    get_timeline_with_meta,
    set_timeline_shared,
    save_timeline_data,
    delete_timeline_data,
    delete_all_user_timelines,
    ensure_data_dir,
    list_public_timelines,
    toggle_timeline_like,
    list_timeline_comments,
    create_timeline_comment,
    delete_timeline_comment
)
from services.auth_service import (
    get_current_user_optional,
    get_current_user_required,
    is_admin_user,
    is_guest_user,
    list_all_users,
    delete_supabase_user
)
from services.quota_service import (
    resolve_gemini_key,
    get_user_quota_info,
    get_candidate_keys_for_request,
    mark_key_exhausted,
    get_guest_api_key_mode,
    get_guest_daily_limit,
    get_api_key_mode,
    get_registered_daily_limit,
    refund_user_quota,
    usage_store_is_durable
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
        env_var: Optional[str] = None
    ):
        self.max_requests = max_requests
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

    def refund(self, identifier: str) -> None:
        """Removes the most recent request timestamp for identifier if present (e.g. after cancellation)."""
        if identifier in self.records and self.records[identifier]:
            self.records[identifier].pop()
            logger.info(f"Rate limiter refund applied for {identifier} on {self.name} (remaining: {len(self.records[identifier])})")

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

        limit = self.effective_max_requests
        # If limit <= 0, rate limiting is disabled entirely
        if limit <= 0:
            return

        # If user provides their own API key, give relaxed quota; if server key, enforce strict cap
        effective_limit = limit * 4 if x_gemini_api_key else limit

        identifier = self.get_identifier(request, actual_user)

        now = time.time()
        cutoff = now - self.window_seconds

        # Clean expired timestamps
        self.records[identifier] = [t for t in self.records[identifier] if t > cutoff]

        if len(self.records[identifier]) >= effective_limit:
            oldest = self.records[identifier][0]
            retry_after = max(1, int(self.window_seconds - (now - oldest)))
            logger.warning(f"Rate limit exceeded for {identifier} on {self.name} ({len(self.records[identifier])}/{effective_limit})")
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
event_suggest_rate_limiter = SimpleRateLimiter(max_requests=25, window_seconds=60, name="event suggestion")
# GET /api/timelines/{id} is reachable without login (shared links) — keep it generous but bounded.
shared_view_rate_limiter = SimpleRateLimiter(max_requests=60, window_seconds=60, name="timeline view")

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
    }

# Substrings that signal a key hit its quota / rate limit and should be rotated away from.
QUOTA_ERROR_INDICATORS = ["prepayment credits", "quota", "resource_exhausted", "429", "rate limit"]

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
                "The guest free AI tier is temporarily at capacity. "
                "Sign in to access the standard high-speed AI tier, or add your own free Gemini API key in Settings."
            )
        return (
            "The shared AI tier is temporarily at capacity (high demand or quota limits). "
            "Add your own free Gemini API key in Settings for reliable, uninterrupted access, or try again shortly."
        )
    return err_msg

async def run_with_key_failover(operation, api_key: Optional[str], key_tier: str, label: str = "AI request"):
    """
    Runs `operation(key)` (an async callable taking one api_key arg), rotating across the
    configured free keys when a quota/rate-limit error is hit. Only free-tier requests rotate;
    admin/paid/BYOK requests use their single resolved key. Exhausted keys are put on cooldown.
    """
    keys_to_try = get_candidate_keys_for_request(api_key) if key_tier == "free" else [api_key]
    last_error = None
    for current_key in keys_to_try:
        try:
            return await operation(current_key)
        except Exception as e:
            last_error = e
            if _is_quota_error(e) and current_key != keys_to_try[-1]:
                mark_key_exhausted(current_key)
                logger.warning(f"Free key quota hit during {label}, rotating to next free key...")
                continue
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
_JOB_TTL_SECONDS = 900  # keep finished jobs available for 15 minutes


def _cleanup_ai_jobs() -> None:
    now = time.time()
    stale = [jid for jid, job in _AI_JOBS.items() if now - job.get("updated", now) > _JOB_TTL_SECONDS]
    for jid in stale:
        _AI_JOBS.pop(jid, None)


def _create_ai_job(
    user: Dict[str, Any],
    client_ip: Optional[str] = None,
    rate_limit_identifier: Optional[str] = None,
    incremented_quota: bool = False,
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
        "task": None,
        "updated": time.time(),
    }
    return job_id


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
            job.update(status="cancelled", detail="Cancelled by user", updated=time.time())
        raise
    except HTTPException as he:
        job = _AI_JOBS.get(job_id)
        if job is not None:
            if job.get("status") == "cancelled":
                return
            job.update(status="error", status_code=he.status_code, detail=str(he.detail), updated=time.time())
    except ValueError as ve:
        job = _AI_JOBS.get(job_id)
        if job is not None:
            if job.get("status") == "cancelled":
                return
            job.update(status="error", status_code=400, detail=str(ve), updated=time.time())
    except Exception as e:
        job = _AI_JOBS.get(job_id)
        if job is not None and job.get("status") == "cancelled":
            return
        logger.error(f"Error in {label} job: {e}", exc_info=True)
        if job is not None:
            job.update(status="error", status_code=500, detail=format_api_error_for_user(e, user), updated=time.time())


@app.get("/api/timeline/job/status/{job_id}")
async def ai_job_status(
    job_id: str,
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Poll the status of a background AI job (generate / refine / chat)."""
    job = _AI_JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found or expired.")
    if job.get("user_id") != user.get("id"):
        raise HTTPException(status_code=403, detail="Not authorized to access this job.")

    status_val = job.get("status")
    if status_val == "done":
        return {"status": "done", "result": job.get("result")}
    if status_val == "error":
        return {"status": "error", "detail": job.get("detail", "Request failed")}
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

        # 2. Refund rate limiter
        rl_id = job.get("rate_limit_identifier")
        if rl_id:
            timeline_rate_limiter.refund(rl_id)

        # 3. Refund daily quota if it was incremented
        if job.get("incremented_quota"):
            client_ip = job.get("client_ip") or get_client_ip(request)
            saved_user = job.get("user") or user
            refund_user_quota(saved_user, client_ip=client_ip)
            logger.info(f"Refunded daily quota for user {saved_user.get('id')} / IP {client_ip}")

        return {"status": "cancelled", "message": "Job cancelled and quota refunded."}

    return {"status": job.get("status"), "message": f"Job was already in {job.get('status')} state."}


async def _execute_generation(
    req: GenerateTimelineRequest,
    api_key: Optional[str],
    key_tier: str,
    user: Dict[str, Any],
) -> Dict[str, Any]:
    t_start = time.time()
    timeline = await run_with_key_failover(
        lambda key: generate_timeline_with_gemini(
            prompt=req.prompt,
            custom_focus=req.custom_focus,
            api_key=key,
            enable_grounding=req.enable_grounding
        ),
        api_key, key_tier, label="timeline generation"
    )
    elapsed_gen = time.time() - t_start
    user_id = user.get("id")
    await asyncio.to_thread(save_timeline_data, timeline.model_dump(by_alias=True), user_id=user_id)
    is_grounded = bool(timeline.grounding and timeline.grounding.is_grounded)
    logger.info(f"Timeline generated successfully in {elapsed_gen:.2f}s (id={timeline.id}, events={len(timeline.articles)}, grounded={is_grounded})")
    return timeline.model_dump(by_alias=True)


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
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        api_key, key_tier, is_admin = resolve_gemini_key(
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
            incremented_quota=incremented_quota
        )
        task = asyncio.create_task(_run_ai_job(
            job_id,
            lambda: _execute_generation(req, api_key, key_tier, user),
            user,
            label="generate",
        ))
        _AI_JOBS[job_id]["task"] = task
        return {"job_id": job_id, "status": "pending"}
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

        timeline = await run_with_key_failover(
            lambda key: generate_timeline_with_gemini(
                prompt=req.prompt,
                custom_focus=req.custom_focus,
                api_key=key,
                enable_grounding=req.enable_grounding
            ),
            api_key, key_tier, label="timeline generation"
        )

        user_id = user.get("id")
        await asyncio.to_thread(save_timeline_data, timeline.model_dump(by_alias=True), user_id=user_id)
        is_grounded = bool(timeline.grounding and timeline.grounding.is_grounded)
        logger.info(f"Timeline generated successfully (id={timeline.id}, events={len(timeline.articles)}, grounded={is_grounded})")
        return timeline
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in generate_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


MAX_UPLOAD_FILES = 20
MAX_UPLOAD_FILE_BYTES = 8 * 1024 * 1024  # 8MB per file
MAX_UPLOAD_TOTAL_BYTES = 30 * 1024 * 1024  # 30MB per request
MAX_RAW_TEXT_CHARS = 20000
ALLOWED_UPLOAD_MIME_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
    "application/pdf",
}


@app.post("/api/timeline/generate-from-files", response_model=TimelineData, dependencies=[Depends(timeline_rate_limiter)])
async def generate_timeline_from_files_endpoint(
    request: Request,
    files: List[UploadFile] = File(default=[]),
    text: Optional[str] = Form(None),
    context: Optional[str] = Form(None),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Generate a timeline by extracting content directly from uploaded files (photos of
    book/document pages, scans, PDFs, or personal photos) and/or pasted raw text,
    instead of a text prompt.
    """
    try:
        raw_text = (text or "").strip()
        if raw_text and len(raw_text) > MAX_RAW_TEXT_CHARS:
            raise HTTPException(status_code=400, detail=f"Pasted text is too long (max {MAX_RAW_TEXT_CHARS} characters).")
        if not files and not raw_text:
            raise HTTPException(status_code=400, detail="Please attach at least one file or paste some text.")
        if len(files) > MAX_UPLOAD_FILES:
            raise HTTPException(status_code=400, detail=f"Too many files (max {MAX_UPLOAD_FILES}).")

        file_payloads: list[tuple[bytes, str]] = []
        total_bytes = 0
        for f in files:
            mime = (f.content_type or "").lower()
            if mime not in ALLOWED_UPLOAD_MIME_TYPES:
                raise HTTPException(status_code=400, detail=f"Unsupported file type: {mime or f.filename}")
            data = await f.read()
            if len(data) > MAX_UPLOAD_FILE_BYTES:
                raise HTTPException(status_code=400, detail=f"'{f.filename}' is too large (max {MAX_UPLOAD_FILE_BYTES // (1024 * 1024)}MB per file).")
            total_bytes += len(data)
            if total_bytes > MAX_UPLOAD_TOTAL_BYTES:
                raise HTTPException(status_code=400, detail=f"Total upload size exceeds {MAX_UPLOAD_TOTAL_BYTES // (1024 * 1024)}MB.")
            file_payloads.append((data, mime))

        client_ip = get_client_ip(request)
        api_key, key_tier, is_admin = resolve_gemini_key(
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        logger.info(
            f"Generating timeline from {len(file_payloads)} uploaded file(s) + "
            f"{'pasted text' if raw_text else 'no pasted text'} for user {user.get('id')} using {key_tier} key (is_admin={is_admin})"
        )

        timeline = await run_with_key_failover(
            lambda key: generate_timeline_from_files(
                files=file_payloads,
                context_prompt=context,
                raw_text=raw_text or None,
                api_key=key
            ),
            api_key, key_tier, label="timeline generation from files"
        )

        user_id = user.get("id")
        await asyncio.to_thread(save_timeline_data, timeline.model_dump(by_alias=True), user_id=user_id)
        logger.info(f"Timeline generated from files successfully (id={timeline.id}, events={len(timeline.articles)})")
        return timeline
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
    updated_timeline = await run_with_key_failover(
        lambda key: refine_timeline_with_gemini(
            current_timeline=req.timeline,
            instruction=req.instruction,
            api_key=key
        ),
        api_key, key_tier, label="timeline refine"
    )
    user_id = user.get("id")
    await asyncio.to_thread(save_timeline_data, updated_timeline.model_dump(by_alias=True), user_id=user_id)
    return updated_timeline.model_dump(by_alias=True)


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
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        api_key, key_tier, is_admin = resolve_gemini_key(
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
            incremented_quota=incremented_quota
        )
        task = asyncio.create_task(_run_ai_job(
            job_id,
            lambda: _execute_refine(req, api_key, key_tier, user),
            user,
            label="refine",
        ))
        _AI_JOBS[job_id]["task"] = task
        return {"job_id": job_id, "status": "pending"}
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

        updated_timeline = await run_with_key_failover(
            lambda key: refine_timeline_with_gemini(
                current_timeline=req.timeline,
                instruction=req.instruction,
                api_key=key
            ),
            api_key, key_tier, label="timeline refine"
        )

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
            new_fm = edits.from_month if edits.from_month is not None else target_art.from_.month
            new_fd = edits.from_day if edits.from_day is not None else target_art.from_.day
            new_fp = edits.from_precision or target_art.from_.precision or "year"

            new_ty = edits.to_year if edits.to_year is not None else (target_art.to.year if target_art.to else None)
            new_tm = edits.to_month if edits.to_month is not None else (target_art.to.month if target_art.to else None)
            new_td = edits.to_day if edits.to_day is not None else (target_art.to.day if target_art.to else None)
            new_tp = edits.to_precision or (target_art.to.precision if target_art.to else None)
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
                is_to_present=new_present
            )

            updates["from_"] = TimelineDate(
                year=from_dict["year"],
                month=from_dict.get("month"),
                day=from_dict.get("day"),
                precision=from_dict.get("precision", "year")
            )
            updates["to"] = TimelineDate(
                year=to_dict["year"],
                month=to_dict.get("month"),
                day=to_dict.get("day"),
                precision=to_dict.get("precision", "year")
            ) if to_dict else None
            updates["isToPresent"] = is_present

            updated_art = target_art.model_copy(update=updates)
            updated_articles = [updated_art if a.id == target_art.id else a for a in current_timeline.articles]
            updated_articles.sort(key=lambda a: (a.from_.year, a.from_.month or 1, a.from_.day or 1))
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
            is_to_present=ne.is_to_present or False
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
            is_timeline_fictional=is_fictional
        )
        item = enriched[0] if enriched else raw_article
        from_d = item.get("from", from_dict)
        to_d = item.get("to")

        from_date = TimelineDate(
            year=from_d.get("year", ne.from_year),
            month=from_d.get("month"),
            day=from_d.get("day"),
            precision=from_d.get("precision", "year")
        )
        to_date = TimelineDate(
            year=to_d.get("year", 0),
            month=to_d.get("month"),
            day=to_d.get("day"),
            precision=to_d.get("precision", "year")
        ) if to_d else None

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
        current_timeline.articles.sort(key=lambda a: (a.from_.year, a.from_.month or 1, a.from_.day or 1))
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
            ),
            chat_key, chat_tier, label="chat edit"
        )
        await asyncio.to_thread(save_timeline_data, updated_timeline.model_dump(by_alias=True), user_id=user_id)
        return updated_timeline

    return None


async def _execute_chat(
    req: TimelineChatRequest,
    chat_key: Optional[str],
    chat_tier: str,
    x_gemini_api_key: Optional[str],
    client_ip: str,
    user: Dict[str, Any],
) -> Dict[str, Any]:
    chat_result, grounding = await run_with_key_failover(
        lambda key: chat_about_timeline(
            current_timeline=req.timeline,
            message=req.message,
            history=req.history,
            api_key=key,
            enable_grounding=req.enable_grounding,
        ),
        chat_key, chat_tier, label="timeline chat"
    )

    response = TimelineChatResponse(
        reply=chat_result.reply,
        action=chat_result.action,
        grounding=grounding,
        detected_language=chat_result.detected_language or "en",
        is_relevant=chat_result.is_relevant if chat_result.is_relevant is not None else True,
    )

    if chat_result.action == "edit":
        updated_timeline = await _apply_chat_edit(
            chat_result=chat_result,
            current_timeline=req.timeline,
            chat_key=chat_key,
            chat_tier=chat_tier,
            user=user,
        )
        if updated_timeline:
            response.updated_timeline = updated_timeline

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
            incremented_quota=incremented_quota
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
        chat_result, grounding = await run_with_key_failover(
            lambda key: chat_about_timeline(
                current_timeline=req.timeline,
                message=req.message,
                history=req.history,
                api_key=key,
                enable_grounding=req.enable_grounding,
            ),
            chat_key, chat_tier, label="timeline chat"
        )

        response = TimelineChatResponse(
            reply=chat_result.reply,
            action=chat_result.action,
            grounding=grounding,
            detected_language=chat_result.detected_language or "en",
            is_relevant=chat_result.is_relevant if chat_result.is_relevant is not None else True,
        )

        if chat_result.action == "edit":
            updated_timeline = await _apply_chat_edit(
                chat_result=chat_result,
                current_timeline=req.timeline,
                chat_key=chat_key,
                chat_tier=chat_tier,
                user=user,
            )
            if updated_timeline:
                response.updated_timeline = updated_timeline

        return response
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in chat_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post("/api/timeline/chat/attach-files", response_model=TimelineChatResponse, dependencies=[Depends(timeline_rate_limiter)])
async def chat_attach_files_endpoint(
    request: Request,
    timeline: str = Form(...),
    message: Optional[str] = Form(None),
    files: List[UploadFile] = File(default=[]),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Chat-attached files: extracts new events from uploaded photos/PDFs and merges them into
    the current timeline via the refine pipeline (counts as one refinement, same as any
    other chat edit). Attaching files always implies an edit intent — no answer/edit
    classification step is needed here.
    """
    try:
        try:
            timeline_data = TimelineData(**json.loads(timeline))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid timeline payload.")

        if not files:
            raise HTTPException(status_code=400, detail="Please attach at least one file.")
        if len(files) > MAX_UPLOAD_FILES:
            raise HTTPException(status_code=400, detail=f"Too many files (max {MAX_UPLOAD_FILES}).")

        file_payloads: list[tuple[bytes, str]] = []
        total_bytes = 0
        for f in files:
            mime = (f.content_type or "").lower()
            if mime not in ALLOWED_UPLOAD_MIME_TYPES:
                raise HTTPException(status_code=400, detail=f"Unsupported file type: {mime or f.filename}")
            data = await f.read()
            if len(data) > MAX_UPLOAD_FILE_BYTES:
                raise HTTPException(status_code=400, detail=f"'{f.filename}' is too large (max {MAX_UPLOAD_FILE_BYTES // (1024 * 1024)}MB per file).")
            total_bytes += len(data)
            if total_bytes > MAX_UPLOAD_TOTAL_BYTES:
                raise HTTPException(status_code=400, detail=f"Total upload size exceeds {MAX_UPLOAD_TOTAL_BYTES // (1024 * 1024)}MB.")
            file_payloads.append((data, mime))

        timeline_id = timeline_data.id
        client_ip = get_client_ip(request)
        api_key, key_tier, is_admin = resolve_gemini_key(
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        instruction = (message or "").strip() or "Add any new events described or depicted in the attached files to this timeline."
        logger.info(
            f"Chat file-attach edit on timeline {timeline_id} for user {user.get('id')} using {key_tier} key "
            f"({len(file_payloads)} files)"
        )

        previous_article_ids = {a.id for a in timeline_data.articles}
        updated_timeline = await run_with_key_failover(
            lambda key: refine_timeline_with_gemini(
                current_timeline=timeline_data,
                instruction=instruction,
                api_key=key,
                files=file_payloads
            ),
            api_key, key_tier, label="chat file-attach edit"
        )

        user_id = user.get("id")
        await asyncio.to_thread(save_timeline_data, updated_timeline.model_dump(by_alias=True), user_id=user_id)

        added_count = sum(1 for a in updated_timeline.articles if a.id not in previous_article_ids)
        reply = (
            f"I've added {added_count} new event(s) from your files to the timeline."
            if added_count > 0
            else "I looked through your files but couldn't find any clear new events to add — try attaching clearer photos or more text."
        )

        return TimelineChatResponse(
            reply=reply,
            action="edit",
            updated_timeline=updated_timeline,
            is_relevant=True,
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

@app.get("/api/timelines/{timeline_id}", dependencies=[Depends(shared_view_rate_limiter)])
async def get_single_timeline(
    timeline_id: str,
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional)
):
    """
    Fetch a timeline by id. Requires NO authentication so "anyone with the link" shared
    views work, but access is still gated: the owner always sees their own timeline;
    everyone else only sees it if the owner has explicitly enabled sharing.
    """
    meta = get_timeline_with_meta(timeline_id)
    if not meta or not meta.get("data"):
        raise HTTPException(status_code=404, detail="Timeline not found")

    owner_id = meta.get("owner_id")
    is_owner = bool(user and owner_id and user.get("id") == owner_id)
    is_shared = bool(meta.get("is_shared"))

    if not is_owner and not is_shared:
        # Don't reveal that a private timeline with this id exists.
        raise HTTPException(status_code=404, detail="Timeline not found")

    return {**meta["data"], "isOwner": is_owner, "isShared": is_shared}

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
    
    is_owner = meta.get("owner_id") == user.get("id")
    is_admin = is_admin_user(user)
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403, detail="Only the owner or an admin can change sharing for this timeline")

    target_user_id = user.get("id") if is_owner else None
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
    if timeline_id:
        existing_meta = get_timeline_with_meta(timeline_id)
        if existing_meta and existing_meta.get("owner_id"):
            owner_id = existing_meta.get("owner_id")
            if owner_id != user_id and not is_admin_user(user):
                raise HTTPException(
                    status_code=403,
                    detail="You cannot overwrite someone else's timeline. Please save a copy instead."
                )
    saved = save_timeline_data(timeline, user_id=user_id)
    return saved

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

@app.get("/api/community/timelines")
async def get_community_timelines(
    sort: str = "popular",
    search: Optional[str] = None,
    topic: Optional[str] = None,
    tag: Optional[str] = None,
    language: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional)
):
    """
    Public community wall: returns publicly shared timelines with likes,
    comment counts, categories, tags, language, author, preview images, and the requesting user's like status.
    """
    user_id = user.get("id") if user else None
    return list_public_timelines(
        user_id=user_id,
        sort=sort,
        search=search,
        topic=topic,
        tag=tag,
        language=language,
        limit=limit,
        offset=offset
    )

@app.post("/api/timelines/{timeline_id}/like")
async def like_timeline(
    timeline_id: str,
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Toggle a like on a timeline for the current authenticated user or guest.
    """
    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    result = toggle_timeline_like(timeline_id, user_id)
    return result

@app.get("/api/timelines/{timeline_id}/comments")
async def get_timeline_comments(timeline_id: str):
    """
    Get all comments for a timeline.
    """
    return list_timeline_comments(timeline_id)

@app.post("/api/timelines/{timeline_id}/comments")
async def post_timeline_comment(
    timeline_id: str,
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Add a comment to a timeline.
    """
    content = str(body.get("content", "")).strip()
    if not content:
        raise HTTPException(status_code=400, detail="Comment content cannot be empty")

    user_name = str(body.get("userName") or "").strip()
    if not user_name:
        user_metadata = user.get("user_metadata") or {}
        user_name = user_metadata.get("full_name") or user_metadata.get("name")
        if not user_name and user.get("email"):
            user_name = user.get("email").split("@")[0]
        if not user_name:
            user_name = "Explorer"

    try:
        created = create_timeline_comment(timeline_id, user.get("id"), user_name, content)
        return created
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error adding comment to timeline {timeline_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to post comment")

@app.delete("/api/timelines/{timeline_id}/comments/{comment_id}")
async def remove_timeline_comment(
    timeline_id: str,
    comment_id: str,
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Delete a comment (author or admin only).
    """
    is_admin = is_admin_user(user)
    success = delete_timeline_comment(timeline_id, comment_id, user.get("id"), is_admin=is_admin)
    if not success:
        raise HTTPException(status_code=404, detail="Comment not found or unauthorized to delete")
    return {"success": True}

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
        await asyncio.to_thread(delete_all_user_timelines, user_id)
    except Exception as e:
        logger.error(f"Error deleting timelines for user {user_id}: {e}")

    # 2. Delete user from Supabase Auth
    deleted = await delete_supabase_user(user_id)
    if not deleted:
        logger.error(f"Failed to delete Supabase user {user_id}")
        raise HTTPException(status_code=500, detail="Failed to delete user account from authentication provider.")

    logger.info(f"User account {user_id} and all associated data deleted successfully")
    return {"success": True, "message": "Account and associated timelines deleted successfully"}


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

    async with httpx.AsyncClient(follow_redirects=True) as client:
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
        suggestion = await run_with_key_failover(
            lambda key: suggest_event_details(
                query=payload.query,
                timeline_topic=payload.timeline_topic or "",
                time_scale=payload.time_scale or "calendar",
                lanes=payload.lanes or [],
                api_key=key
            ),
            api_key, key_tier, label="event suggestion"
        )
        return suggestion
    except Exception as e:
        logger.error(f"Error suggesting event: {e}")
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

    async with httpx.AsyncClient(follow_redirects=True) as client:
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
