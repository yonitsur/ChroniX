import os
import re
import uuid
import logging
import time
from collections import defaultdict
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, Header, Body, Depends, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from models import (
    TimelineData,
    GenerateTimelineRequest,
    RefineTimelineRequest,
    TimelineArticle,
    EventSuggestionRequest,
    TimelineChatRequest,
    TimelineChatResponse
)
from services.gemini_service import (
    generate_timeline_with_gemini,
    refine_timeline_with_gemini,
    suggest_event_details,
    chat_about_timeline
)
from services.wiki_enricher import fetch_wikipedia_summary, search_wikipedia_candidates, search_geocode_candidates
from services.storage import (
    list_all_timelines,
    get_timeline_by_id,
    save_timeline_data,
    delete_timeline_data,
    delete_all_user_timelines,
    ensure_data_dir
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
    resolve_refine_gemini_key,
    resolve_event_suggest_gemini_key,
    resolve_chat_gemini_key,
    get_user_quota_info,
    get_timeline_ai_usage,
    get_candidate_keys_for_request,
    mark_key_exhausted
)
import httpx
import asyncio

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ChroniXAPI")

ensure_data_dir()

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
    """
    def __init__(self, max_requests: int, window_seconds: int = 60, name: str = "endpoint"):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.name = name
        self.records: Dict[str, list[float]] = defaultdict(list)

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

        # If user provides their own API key, give relaxed quota; if server key, enforce strict cap
        effective_limit = self.max_requests * 4 if x_gemini_api_key else self.max_requests

        # Identify client by user_id if registered user, otherwise by guest IP
        if actual_user and not is_guest_user(actual_user) and actual_user.get("id"):
            identifier = f"user:{actual_user['id']}"
        else:
            ip = get_client_ip(request)
            identifier = f"guest_ip:{ip}"

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

timeline_rate_limiter = SimpleRateLimiter(max_requests=3, window_seconds=60, name="timeline generation")
event_suggest_rate_limiter = SimpleRateLimiter(max_requests=25, window_seconds=60, name="event suggestion")

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
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Get current user's daily prompt quota status.
    Marked no-store so mobile browsers never serve a stale cached count.
    """
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    return get_user_quota_info(user, client_ip=get_client_ip(request))

# Substrings that signal a key hit its quota / rate limit and should be rotated away from.
QUOTA_ERROR_INDICATORS = ["prepayment credits", "quota", "resource_exhausted", "429", "rate limit"]

def _is_quota_error(error: Exception) -> bool:
    err_lower = str(error).lower()
    return any(ind in err_lower for ind in QUOTA_ERROR_INDICATORS)

def format_api_error_for_user(error: Exception, user: Optional[Dict[str, Any]] = None) -> str:
    err_msg = str(error)
    if is_guest_user(user):
        if _is_quota_error(error):
            return (
                "The guest free AI tier is temporarily at capacity. "
                "Sign in to access the standard high-speed AI tier, or add your own free Gemini API key in Settings."
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


def _create_ai_job(user: Dict[str, Any]) -> str:
    _cleanup_ai_jobs()
    job_id = uuid.uuid4().hex
    _AI_JOBS[job_id] = {
        "status": "pending",
        "user_id": user.get("id"),
        "updated": time.time(),
    }
    return job_id


async def _run_ai_job(job_id: str, operation, user: Dict[str, Any], label: str) -> None:
    """Run an async `operation()` returning a JSON-serializable dict, recording status on the job."""
    try:
        result = await operation()
        job = _AI_JOBS.get(job_id)
        if job is not None:
            job.update(status="done", result=result, updated=time.time())
    except HTTPException as he:
        job = _AI_JOBS.get(job_id)
        if job is not None:
            job.update(status="error", status_code=he.status_code, detail=str(he.detail), updated=time.time())
    except ValueError as ve:
        job = _AI_JOBS.get(job_id)
        if job is not None:
            job.update(status="error", status_code=400, detail=str(ve), updated=time.time())
    except Exception as e:
        logger.error(f"Error in {label} job: {e}", exc_info=True)
        job = _AI_JOBS.get(job_id)
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
    return {"status": "pending"}


async def _execute_generation(
    req: GenerateTimelineRequest,
    api_key: Optional[str],
    key_tier: str,
    user: Dict[str, Any],
) -> Dict[str, Any]:
    timeline = await run_with_key_failover(
        lambda key: generate_timeline_with_gemini(
            prompt=req.prompt,
            detail_level=req.detail_level,
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
        api_key, key_tier, is_admin = resolve_gemini_key(
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        logger.info(
            f"Starting timeline job for user {user.get('id')} using {key_tier} key "
            f"(is_admin={is_admin}, grounding={'ENABLED' if req.enable_grounding else 'OFF'})"
        )
        job_id = _create_ai_job(user)
        asyncio.create_task(_run_ai_job(
            job_id,
            lambda: _execute_generation(req, api_key, key_tier, user),
            user,
            label="generate",
        ))
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
                detail_level=req.detail_level,
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

async def _execute_refine(
    req: RefineTimelineRequest,
    api_key: Optional[str],
    key_tier: str,
    user: Dict[str, Any],
) -> Dict[str, Any]:
    timeline_id = req.timeline.id
    updated_timeline = await run_with_key_failover(
        lambda key: refine_timeline_with_gemini(
            current_timeline=req.timeline,
            instruction=req.instruction,
            api_key=key
        ),
        api_key, key_tier, label="timeline refine"
    )
    usage = get_timeline_ai_usage(timeline_id)
    updated_timeline.aiRefineCount = usage.get("refine_count", (req.timeline.aiRefineCount or 0) + 1)
    updated_timeline.aiEventAddCount = usage.get("event_add_count", req.timeline.aiEventAddCount or 0)
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
        api_key, key_tier, is_admin, remaining_refines = resolve_refine_gemini_key(
            user,
            timeline_id=timeline_id,
            custom_api_key=x_gemini_api_key,
            increment_usage=True,
            client_ip=client_ip
        )
        logger.info(
            f"Starting refine job for timeline {timeline_id} user {user.get('id')} using {key_tier} key "
            f"(is_admin={is_admin}, remaining_refines={remaining_refines})"
        )
        job_id = _create_ai_job(user)
        asyncio.create_task(_run_ai_job(
            job_id,
            lambda: _execute_refine(req, api_key, key_tier, user),
            user,
            label="refine",
        ))
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
    Requires authentication. Routes between paid and free Gemini keys based on daily quota and per-timeline limit (3).
    """
    try:
        timeline_id = req.timeline.id
        client_ip = get_client_ip(request)
        api_key, key_tier, is_admin, remaining_refines = resolve_refine_gemini_key(
            user,
            timeline_id=timeline_id,
            custom_api_key=x_gemini_api_key,
            increment_usage=True,
            client_ip=client_ip
        )
        logger.info(
            f"Refining timeline {timeline_id} for user {user.get('id')} using {key_tier} key "
            f"(is_admin={is_admin}, remaining_refines={remaining_refines})"
        )

        updated_timeline = await run_with_key_failover(
            lambda key: refine_timeline_with_gemini(
                current_timeline=req.timeline,
                instruction=req.instruction,
                api_key=key
            ),
            api_key, key_tier, label="timeline refine"
        )

        # Update AI usage counters on the returned timeline
        usage = get_timeline_ai_usage(timeline_id)
        updated_timeline.aiRefineCount = usage.get("refine_count", (req.timeline.aiRefineCount or 0) + 1)
        updated_timeline.aiEventAddCount = usage.get("event_add_count", req.timeline.aiEventAddCount or 0)

        user_id = user.get("id")
        await asyncio.to_thread(save_timeline_data, updated_timeline.model_dump(by_alias=True), user_id=user_id)
        return updated_timeline
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in refine_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))

async def _execute_chat(
    req: TimelineChatRequest,
    chat_key: Optional[str],
    chat_tier: str,
    x_gemini_api_key: Optional[str],
    client_ip: str,
    user: Dict[str, Any],
) -> Dict[str, Any]:
    timeline_id = req.timeline.id
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

    # If the turn requested an edit, run it through the refine pipeline.
    if chat_result.action == "edit" and chat_result.edit_instruction:
        api_key, key_tier, is_admin, remaining_refines = resolve_refine_gemini_key(
            user,
            timeline_id=timeline_id,
            custom_api_key=x_gemini_api_key,
            increment_usage=True,
            client_ip=client_ip
        )
        logger.info(
            f"Chat edit on timeline {timeline_id} for user {user.get('id')} using {key_tier} key "
            f"(remaining_refines={remaining_refines})"
        )
        updated_timeline = await run_with_key_failover(
            lambda key: refine_timeline_with_gemini(
                current_timeline=req.timeline,
                instruction=chat_result.edit_instruction,
                api_key=key,
            ),
            api_key, key_tier, label="chat edit"
        )
        usage = get_timeline_ai_usage(timeline_id)
        updated_timeline.aiRefineCount = usage.get("refine_count", (req.timeline.aiRefineCount or 0) + 1)
        updated_timeline.aiEventAddCount = usage.get("event_add_count", req.timeline.aiEventAddCount or 0)
        user_id = user.get("id")
        await asyncio.to_thread(save_timeline_data, updated_timeline.model_dump(by_alias=True), user_id=user_id)
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
        chat_key, chat_tier, is_admin = resolve_chat_gemini_key(
            user=user,
            timeline_id=timeline_id,
            client_ip=client_ip,
            custom_api_key=x_gemini_api_key,
            increment_usage=True
        )
        job_id = _create_ai_job(user)
        asyncio.create_task(_run_ai_job(
            job_id,
            lambda: _execute_chat(req, chat_key, chat_tier, x_gemini_api_key, client_ip, user),
            user,
            label="chat",
        ))
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
    an edit through the refine pipeline. For guests, routes between paid and free Gemini keys
    based on per-timeline chat limit and daily IP quota. Edits count as refinements.
    """
    try:
        timeline_id = req.timeline.id
        client_ip = get_client_ip(request)
        chat_key, chat_tier, is_admin = resolve_chat_gemini_key(
            user=user,
            timeline_id=timeline_id,
            client_ip=client_ip,
            custom_api_key=x_gemini_api_key,
            increment_usage=True
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

        # If the turn requested an edit, run it through the refine pipeline.
        if chat_result.action == "edit" and chat_result.edit_instruction:
            api_key, key_tier, is_admin, remaining_refines = resolve_refine_gemini_key(
                user,
                timeline_id=timeline_id,
                custom_api_key=x_gemini_api_key,
                increment_usage=True,
                client_ip=client_ip
            )
            logger.info(
                f"Chat edit on timeline {timeline_id} for user {user.get('id')} using {key_tier} key "
                f"(remaining_refines={remaining_refines})"
            )
            updated_timeline = await run_with_key_failover(
                lambda key: refine_timeline_with_gemini(
                    current_timeline=req.timeline,
                    instruction=chat_result.edit_instruction,
                    api_key=key,
                ),
                api_key, key_tier, label="chat edit"
            )
            usage = get_timeline_ai_usage(timeline_id)
            updated_timeline.aiRefineCount = usage.get("refine_count", (req.timeline.aiRefineCount or 0) + 1)
            updated_timeline.aiEventAddCount = usage.get("event_add_count", req.timeline.aiEventAddCount or 0)
            user_id = user.get("id")
            await asyncio.to_thread(save_timeline_data, updated_timeline.model_dump(by_alias=True), user_id=user_id)
            response.updated_timeline = updated_timeline

        return response
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in chat_timeline: {e}", exc_info=True)
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

@app.get("/api/timelines/{timeline_id}")
async def get_single_timeline(timeline_id: str):
    timeline = get_timeline_by_id(timeline_id)
    if not timeline:
        raise HTTPException(status_code=404, detail="Timeline not found")
    return timeline

@app.post("/api/timelines")
async def save_timeline(
    timeline: dict = Body(...),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    user_id = user.get("id")
    saved = save_timeline_data(timeline, user_id=user_id)
    return saved

@app.delete("/api/timelines/{timeline_id}")
async def delete_timeline(
    timeline_id: str,
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    user_id = user.get("id")
    deleted = delete_timeline_data(timeline_id, user_id=user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Timeline not found")
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
    Requires authentication. Routes key based on user, daily quota, and per-timeline limit (10).
    """
    client_ip = get_client_ip(request)
    api_key, key_tier, is_admin, remaining_adds = resolve_event_suggest_gemini_key(
        user,
        timeline_id=payload.timeline_id,
        custom_api_key=x_gemini_api_key or payload.api_key,
        increment_usage=True,
        client_ip=client_ip
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
        if payload.timeline_id:
            usage = get_timeline_ai_usage(payload.timeline_id)
            suggestion.ai_event_add_count = usage.get("event_add_count", 0)
        suggestion.remaining_timeline_adds = remaining_adds
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
