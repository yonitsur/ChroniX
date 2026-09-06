import os
import re
import logging
import time
from collections import defaultdict
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, Header, Body, Depends, Request, status
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from models import (
    TimelineData,
    GenerateTimelineRequest,
    RefineTimelineRequest,
    TimelineArticle,
    EventSuggestionRequest
)
from services.gemini_service import (
    generate_timeline_with_gemini,
    refine_timeline_with_gemini,
    suggest_event_details
)
from services.wiki_enricher import fetch_wikipedia_summary, search_wikipedia_candidates
from services.storage import (
    list_all_timelines,
    get_timeline_by_id,
    save_timeline_data,
    delete_timeline_data,
    ensure_data_dir
)
from services.auth_service import get_current_user_optional, get_current_user_required, is_admin_user
from services.quota_service import resolve_gemini_key, get_user_quota_info
import httpx
import asyncio

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ChroniXAPI")

ensure_data_dir()

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

        # Identify client by user_id if logged in, otherwise by IP
        identifier = f"user:{actual_user['id']}" if actual_user and actual_user.get("id") else None
        if not identifier:
            forwarded = request.headers.get("X-Forwarded-For")
            ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")
            identifier = f"ip:{ip}"

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
async def get_current_user_quota(user: Dict[str, Any] = Depends(get_current_user_required)):
    """
    Get current user's daily prompt quota status.
    """
    return get_user_quota_info(user)

@app.post("/api/timeline/generate", response_model=TimelineData, dependencies=[Depends(timeline_rate_limiter)])
async def generate_timeline_endpoint(
    req: GenerateTimelineRequest,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Generate a full timeline from a natural language prompt.
    Requires authentication. Routes between paid and free Gemini keys based on daily quota.
    """
    try:
        api_key, key_tier, is_admin = resolve_gemini_key(user, x_gemini_api_key, increment_usage=True)
        logger.info(f"Generating timeline for user {user.get('id')} using {key_tier} key (is_admin={is_admin})")

        timeline = await generate_timeline_with_gemini(
            prompt=req.prompt,
            detail_level=req.detail_level,
            custom_focus=req.custom_focus,
            api_key=api_key,
            language=req.language
        )
        user_id = user.get("id")
        save_timeline_data(timeline.model_dump(by_alias=True), user_id=user_id)
        return timeline
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in generate_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/timeline/refine", response_model=TimelineData, dependencies=[Depends(timeline_rate_limiter)])
async def refine_timeline_endpoint(
    req: RefineTimelineRequest,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Refine or extend an existing timeline via a natural language instruction.
    Requires authentication. Routes between paid and free Gemini keys based on daily quota.
    """
    try:
        api_key, key_tier, is_admin = resolve_gemini_key(user, x_gemini_api_key, increment_usage=True)
        logger.info(f"Refining timeline for user {user.get('id')} using {key_tier} key (is_admin={is_admin})")

        updated_timeline = await refine_timeline_with_gemini(
            current_timeline=req.timeline,
            instruction=req.instruction,
            api_key=api_key
        )
        user_id = user.get("id")
        save_timeline_data(updated_timeline.model_dump(by_alias=True), user_id=user_id)
        return updated_timeline
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in refine_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/timelines")
async def get_all_timelines(user: Dict[str, Any] = Depends(get_current_user_required)):
    user_id = user.get("id")
    return list_all_timelines(user_id=user_id)

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

@app.post("/api/timeline/enrich-item")
async def enrich_single_item(payload: dict = Body(...)):
    """
    Enrich an event with Wikipedia thumbnail & description by query.
    Supports any language edition with automatic English fallback.
    """
    title = payload.get("title", "")
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    lang = payload.get("lang")
    if not lang:
        lang = "he" if bool(re.search(r'[\u0590-\u05FF]', title)) else "en"

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
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Suggest event details using Gemini and Wikipedia.
    Requires authentication. Routes key based on user and quota.
    """
    api_key, key_tier, is_admin = resolve_gemini_key(user, x_gemini_api_key or payload.api_key, increment_usage=False)
    if not api_key:
        raise HTTPException(status_code=400, detail="Gemini API Key is missing. Configure it in .env or Settings.")

    try:
        suggestion = await suggest_event_details(
            query=payload.query,
            timeline_topic=payload.timeline_topic or "",
            time_scale=payload.time_scale or "calendar",
            lanes=payload.lanes or [],
            language=payload.language,
            api_key=api_key
        )
        return suggestion
    except Exception as e:
        logger.error(f"Error suggesting event: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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

    if not lang:
        lang = "he" if bool(re.search(r'[\u0590-\u05FF]', clean)) else "en"

    async with httpx.AsyncClient(follow_redirects=True) as client:
        candidates = await search_wikipedia_candidates(
            query=clean,
            client=client,
            lang=lang,
            context_text=context or "",
            limit=limit
        )
        return candidates

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
