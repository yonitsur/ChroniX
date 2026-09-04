from typing import List, Optional, Literal
from pydantic import BaseModel, Field

PrecisionType = Literal[
    "day", "month", "year", "decade", "century", "millennium", "million-years", "billion-years"
]

class TimelineDate(BaseModel):
    year: int = Field(description="Calendar year, negative for BC or astronomical years ago")
    month: Optional[int] = Field(default=None, ge=1, le=12)
    day: Optional[int] = Field(default=None, ge=1, le=31)
    precision: Optional[PrecisionType] = Field(default="year")

class ArticleStyle(BaseModel):
    border: Optional[str] = None
    background: Optional[str] = None
    color: Optional[str] = None

class TimelineArticle(BaseModel):
    id: str
    title: str
    subtitle: Optional[str] = None
    lane: Optional[str] = None
    from_: TimelineDate = Field(alias="from")
    to: Optional[TimelineDate] = None
    isToPresent: Optional[bool] = False
    imageUrl: Optional[str] = None
    rank: Optional[int] = Field(default=5, ge=1, le=10)
    
    # Extra rich metadata
    wikiTitle: Optional[str] = None
    wikiUrl: Optional[str] = None
    extract: Optional[str] = None
    category: Optional[str] = None

    model_config = {"populate_by_name": True}

class TimelineLane(BaseModel):
    id: str
    title: str
    color: Optional[str] = None
    order: Optional[int] = 0

class TimelineTimeBand(BaseModel):
    id: str
    title: str
    from_: TimelineDate = Field(alias="from")
    to: TimelineDate
    color: Optional[str] = None

    model_config = {"populate_by_name": True}

class TimelineData(BaseModel):
    id: str
    title: str
    description: Optional[str] = ""
    timeScale: Literal["calendar", "prehistoric"] = "calendar"
    lanes: List[TimelineLane] = Field(default_factory=list)
    timeBands: List[TimelineTimeBand] = Field(default_factory=list)
    articles: List[TimelineArticle] = Field(default_factory=list)
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None

class GenerateTimelineRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=400, description="User natural language request for timeline")
    detail_level: Literal["overview", "standard", "deep_dive"] = "standard"
    custom_focus: Optional[str] = Field(default=None, max_length=300, description="Optional special focus or aspect")
    language: Optional[str] = Field(default=None, max_length=10, description="Language code e.g. he or en")

class RefineTimelineRequest(BaseModel):
    timeline: TimelineData
    instruction: str = Field(..., min_length=2, max_length=300, description="Instruction for refining or adding events")

class EventSuggestionRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=150, description="Event name, query, or phrase")
    timeline_topic: Optional[str] = Field(default="", max_length=250, description="Active timeline title or prompt")
    time_scale: Optional[Literal["calendar", "prehistoric"]] = Field(default="calendar")
    lanes: Optional[List[dict]] = Field(default_factory=list)
    language: Optional[str] = Field(default=None, max_length=10)
    api_key: Optional[str] = None

class EventSuggestionOutput(BaseModel):
    title: str = Field(description="Display title of the event or person")
    subtitle: Optional[str] = Field(default="", description="Crisp one-line summary or historical significance")
    wikipedia_title: Optional[str] = Field(default=None, description="Exact canonical Wikipedia title (with disambiguation parenthetical if needed, e.g. 'Lucy (hominid)' or 'לוסי (שלד)')")
    from_year: int = Field(description="Calendar year, negative for BCE or astronomical years ago if prehistoric")
    from_month: Optional[int] = Field(default=None, ge=1, le=12)
    from_day: Optional[int] = Field(default=None, ge=1, le=31)
    from_precision: Optional[PrecisionType] = Field(default="year")
    to_year: Optional[int] = None
    to_month: Optional[int] = Field(default=None, ge=1, le=12)
    to_day: Optional[int] = Field(default=None, ge=1, le=31)
    to_precision: Optional[PrecisionType] = None
    is_to_present: Optional[bool] = False
    lane_id: Optional[str] = Field(default=None, description="Matching lane id from available lanes, or null")


# Gemini Raw Structured Response Models
class GeminiEventItem(BaseModel):
    id: str
    title: str
    subtitle: Optional[str] = ""
    lane: Optional[str] = ""
    from_year: int
    from_month: Optional[int] = None
    from_day: Optional[int] = None
    from_precision: PrecisionType = "year"
    to_year: Optional[int] = None
    to_month: Optional[int] = None
    to_day: Optional[int] = None
    to_precision: Optional[PrecisionType] = None
    is_to_present: Optional[bool] = False
    wikipedia_title: Optional[str] = ""
    importance_rank: int = 5

class GeminiLaneItem(BaseModel):
    id: str
    title: str
    color: Optional[str] = "#3b82f6"

class GeminiTimeBandItem(BaseModel):
    id: str
    title: str
    from_year: int
    to_year: int
    precision: PrecisionType = "year"
    color: Optional[str] = "#e2e8f0"

class GeminiTimelineOutput(BaseModel):
    title: str
    description: str
    time_scale: Literal["calendar", "prehistoric"] = "calendar"
    lanes: List[GeminiLaneItem] = Field(default_factory=list)
    time_bands: List[GeminiTimeBandItem] = Field(default_factory=list)
    events: List[GeminiEventItem] = Field(default_factory=list)
