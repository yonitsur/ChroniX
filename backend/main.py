import os
import re
import logging
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, Header, Body
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
import httpx
import asyncio

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ChroniXAPI")

ensure_data_dir()

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

@app.post("/api/timeline/generate", response_model=TimelineData)
async def generate_timeline_endpoint(
    req: GenerateTimelineRequest,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key")
):
    """
    Generate a full timeline from a natural language prompt.
    """
    try:
        timeline = await generate_timeline_with_gemini(
            prompt=req.prompt,
            detail_level=req.detail_level,
            custom_focus=req.custom_focus,
            api_key=x_gemini_api_key,
            language=req.language
        )
        # Automatically save to persistent storage
        save_timeline_data(timeline.model_dump(by_alias=True))
        return timeline
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in generate_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/timeline/refine", response_model=TimelineData)
async def refine_timeline_endpoint(
    req: RefineTimelineRequest,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key")
):
    """
    Refine or extend an existing timeline via a natural language instruction.
    """
    try:
        updated_timeline = await refine_timeline_with_gemini(
            current_timeline=req.timeline,
            instruction=req.instruction,
            api_key=x_gemini_api_key
        )
        save_timeline_data(updated_timeline.model_dump(by_alias=True))
        return updated_timeline
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in refine_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/timelines")
async def get_all_timelines():
    return list_all_timelines()

@app.get("/api/timelines/{timeline_id}")
async def get_single_timeline(timeline_id: str):
    timeline = get_timeline_by_id(timeline_id)
    if not timeline:
        raise HTTPException(status_code=404, detail="Timeline not found")
    return timeline

@app.post("/api/timelines")
async def save_timeline(timeline: dict = Body(...)):
    saved = save_timeline_data(timeline)
    return saved

@app.delete("/api/timelines/{timeline_id}")
async def delete_timeline(timeline_id: str):
    deleted = delete_timeline_data(timeline_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Timeline not found")
    return {"success": True}

@app.post("/api/timeline/enrich-item")
async def enrich_single_item(payload: dict = Body(...)):
    """
    Enrich an event with Wikipedia thumbnail & description by query.
    """
    title = payload.get("title", "")
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    lang = payload.get("lang")
    if not lang:
        lang = "he" if bool(re.search(r'[\u0590-\u05FF]', title)) else "en"

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
            is_prehistoric=is_prehistoric
        )
        return res

@app.post("/api/timeline/suggest-event")
async def suggest_single_event(
    payload: EventSuggestionRequest,
    x_gemini_api_key: Optional[str] = Header(None)
):
    """
    Suggest event details (title, subtitle, from/to years, precision, lane, and Wikipedia metadata)
    using Gemini and Wikipedia.
    """
    api_key = x_gemini_api_key or payload.api_key or os.getenv("GEMINI_API_KEY")
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
