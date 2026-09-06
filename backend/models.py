from typing import List, Optional, Literal
from pydantic import BaseModel, Field, AliasChoices

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

    # Geographic metadata
    locationName: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    googleMapsUrl: Optional[str] = None
    isFictional: Optional[bool] = Field(
        default=False,
        validation_alias=AliasChoices("isFictional", "is_fictional"),
        serialization_alias="isFictional"
    )

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
    isFictional: Optional[bool] = Field(
        default=False,
        validation_alias=AliasChoices("isFictional", "is_fictional"),
        serialization_alias="isFictional"
    )
    aiRefineCount: Optional[int] = Field(default=0, alias="aiRefineCount")
    aiEventAddCount: Optional[int] = Field(default=0, alias="aiEventAddCount")

    model_config = {"populate_by_name": True}

class GenerateTimelineRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=400, description="User natural language request for timeline")
    detail_level: Literal["overview", "standard", "deep_dive"] = "standard"
    custom_focus: Optional[str] = Field(default=None, max_length=300, description="Optional special focus or aspect")
    language: Optional[str] = Field(default=None, max_length=10, description="Language code e.g. he or en")

class RefineTimelineRequest(BaseModel):
    timeline: TimelineData
    instruction: str = Field(..., min_length=2, max_length=500, description="Instruction for refining or adding events")

class EventSuggestionRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=150, description="Event name, query, or phrase")
    timeline_id: Optional[str] = Field(default=None, description="Optional active timeline ID for tracking per-timeline limits")
    timeline_topic: Optional[str] = Field(default="", max_length=250, description="Active timeline title or prompt")
    time_scale: Optional[Literal["calendar", "prehistoric"]] = Field(default="calendar")
    lanes: Optional[List[dict]] = Field(default_factory=list)
    language: Optional[str] = Field(default=None, max_length=10)
    api_key: Optional[str] = None

class EventSuggestionOutput(BaseModel):
    title: str = Field(description="Display title of the event or person")
    subtitle: Optional[str] = Field(default="", description="Crisp one-line summary or historical significance")
    wikipedia_title: Optional[str] = Field(default=None, description="Exact canonical Wikipedia title in the prompt's language (with disambiguation parenthetical if needed, e.g. 'Lucy (hominid)' or 'לוסי (שלד)')")
    wikipedia_title_en: Optional[str] = Field(default=None, description="Exact canonical English Wikipedia title for fallback if the prompt language article does not exist")
    from_year: int = Field(description="Start calendar year. Negative for BCE (e.g. -753) or astronomical years ago if prehistoric (e.g. -3200000)")
    from_month: Optional[int] = Field(default=None, ge=1, le=12, description="Start month (1-12) if known")
    from_day: Optional[int] = Field(default=None, ge=1, le=31, description="Start day (1-31) if known")
    from_precision: Optional[PrecisionType] = Field(default="year", description="Precision of start date")
    to_year: Optional[int] = Field(default=None, description="End calendar year. MANDATORY for any prolonged event, war, reign, era, movement, or span. Leave null ONLY for single-moment / single-day events.")
    to_month: Optional[int] = Field(default=None, ge=1, le=12, description="End month (1-12) if known")
    to_day: Optional[int] = Field(default=None, ge=1, le=31, description="End day (1-31) if known")
    to_precision: Optional[PrecisionType] = Field(default=None, description="Precision of end date")
    is_to_present: Optional[bool] = Field(default=False, description="Set to true if this event, reign, organization, or movement began in the past and is still ongoing today.")
    lane_id: Optional[str] = Field(default=None, description="Matching lane id from available lanes, or null")
    location_name: Optional[str] = Field(default=None, description="City, region, landmark, or country where the event took place, or null")
    lat: Optional[float] = Field(default=None, description="Latitude coordinate, or null")
    lng: Optional[float] = Field(default=None, description="Longitude coordinate, or null")
    is_fictional: Optional[bool] = Field(default=False, description="Set to true if this event is from fiction, literature, mythology, or fantasy, or false for real Earth history.")
    ai_event_add_count: Optional[int] = Field(default=None, description="Current event addition count for the timeline")
    remaining_timeline_adds: Optional[int] = Field(default=None, description="Remaining paid event additions for this timeline")


# Gemini Raw Structured Response Models
class GeminiEventItem(BaseModel):
    id: str = Field(description="Unique short ID for the event, e.g. 'ev-1'")
    title: str = Field(description="Display title of the event or entity")
    subtitle: Optional[str] = Field(default="", description="Crisp one-line summary of historical significance")
    lane: Optional[str] = Field(default="", description="Target lane id from the lanes list")
    from_year: int = Field(description="Start calendar year. Negative for BCE (e.g. -509) or astronomical years ago if prehistoric (e.g. -66000000)")
    from_month: Optional[int] = Field(default=None, ge=1, le=12, description="Start month (1-12) if known")
    from_day: Optional[int] = Field(default=None, ge=1, le=31, description="Start day (1-31) if known")
    from_precision: PrecisionType = Field(default="year", description="Precision of start date")
    to_year: Optional[int] = Field(
        default=None,
        description="End calendar year. MANDATORY for any event, war, reign, era, presidency, movement, dynasty, or prolonged span. Leave null ONLY for instantaneous point-in-time milestones."
    )
    to_month: Optional[int] = Field(default=None, ge=1, le=12, description="End month (1-12) if known")
    to_day: Optional[int] = Field(default=None, ge=1, le=31, description="End day (1-31) if known")
    to_precision: Optional[PrecisionType] = Field(default=None, description="Precision of end date")
    is_to_present: Optional[bool] = Field(
        default=False,
        description="Set to true if this entity, movement, reign, or event began in history and continues actively to this day."
    )
    wikipedia_title: Optional[str] = Field(default="", description="Exact canonical Wikipedia title in the language of the prompt (with parenthetical qualifier if disambiguation needed)")
    wikipedia_title_en: Optional[str] = Field(default="", description="Exact canonical English Wikipedia title for fallback if the prompt language article does not exist or lacks images")
    importance_rank: int = Field(default=5, ge=1, le=10, description="Visual prominence rank from 1 (minor) to 10 (defining milestone)")
    location_name: Optional[str] = Field(default=None, description="City, region, archaeological site, or country where the event took place, or null")
    lat: Optional[float] = Field(default=None, description="Approximate latitude coordinate (-90.0 to 90.0), or null")
    lng: Optional[float] = Field(default=None, description="Approximate longitude coordinate (-180.0 to 180.0), or null")
    is_fictional: Optional[bool] = Field(default=False, description="Set to true if this event is set in a fictional universe, literary saga, fantasy, mythology, or sci-fi world.")

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
    is_fictional: Optional[bool] = Field(default=False, description="Set to true if this timeline represents a fictional universe, literary saga, fantasy world, sci-fi, or mythology e.g. Game of Thrones, Lord of the Rings, Star Wars, Harry Potter. Set to false for real Earth history, prehistory, science, or real biographies.")
    detected_language: Optional[str] = Field(default="en", description="2-letter ISO 639-1 language code of the prompt/timeline, e.g. 'en', 'he', 'fr', 'es', 'de', 'ru', 'ar', 'it', 'ja', etc.")
    lanes: List[GeminiLaneItem] = Field(default_factory=list)
    time_bands: List[GeminiTimeBandItem] = Field(default_factory=list)
    events: List[GeminiEventItem] = Field(default_factory=list)
