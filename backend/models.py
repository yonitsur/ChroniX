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

class GroundingSource(BaseModel):
    title: str = Field(description="Title of the web source")
    url: str = Field(description="URL of the web source")

class GroundingCitation(BaseModel):
    text_segment: str = Field(description="Segment of text corroborated by web grounding")
    source_indices: List[int] = Field(default_factory=list, description="Indices of sources supporting this segment")
    confidence_score: Optional[float] = Field(default=None, description="Model confidence score for grounding support")

class GroundingMetadataPayload(BaseModel):
    is_grounded: bool = Field(default=False, description="Whether Google Search Grounding was active")
    search_queries: List[str] = Field(default_factory=list, description="Search queries executed by Gemini")
    sources: List[GroundingSource] = Field(default_factory=list, description="Web sources retrieved and cited")
    citations: List[GroundingCitation] = Field(default_factory=list, description="Text segments and supporting source indices")
    search_entry_point_html: Optional[str] = Field(default=None, description="Rendered Google Search attribution chip HTML")

class TimelineData(BaseModel):
    id: str
    title: str
    description: Optional[str] = ""
    overview: Optional[str] = Field(
        default="",
        description="Rich narrative synopsis (150-220 words, 1-2 detailed paragraphs) providing the big-picture context, significance, key arguments, and framing of the timeline's subject — distinct from the short one-line description."
    )
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
    isPersonal: Optional[bool] = Field(
        default=False,
        validation_alias=AliasChoices("isPersonal", "is_personal"),
        serialization_alias="isPersonal",
        description="User-authored personal/family timeline built by hand (not AI-generated)"
    )
    aiRefineCount: Optional[int] = Field(default=0, alias="aiRefineCount")
    aiEventAddCount: Optional[int] = Field(default=0, alias="aiEventAddCount")
    grounding: Optional[GroundingMetadataPayload] = Field(default=None, description="Google Search Grounding metadata if enabled")
    relatedPrompts: Optional[List[str]] = Field(
        default_factory=list,
        validation_alias=AliasChoices("relatedPrompts", "related_prompts"),
        serialization_alias="relatedPrompts",
        description="Suggested prompt topics for related timelines to explore."
    )

    model_config = {"populate_by_name": True}

class GenerateTimelineRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=400, description="User natural language request for timeline")
    detail_level: Optional[str] = Field(default=None, description="Legacy optional parameter; event count and density are now autonomously decided by the AI curator")
    custom_focus: Optional[str] = Field(default=None, max_length=300, description="Optional special focus or aspect")
    enable_grounding: bool = Field(default=False, description="Whether to activate Google Search Grounding for live factual verification")

class RefineTimelineRequest(BaseModel):
    timeline: TimelineData
    instruction: str = Field(..., min_length=2, max_length=500, description="Instruction for refining or adding events")

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=4000)

class TimelineChatRequest(BaseModel):
    timeline: TimelineData
    message: str = Field(..., min_length=1, max_length=1000, description="The user's chat message about the timeline")
    history: List[ChatMessage] = Field(default_factory=list, description="Prior conversation turns (most recent last)")
    enable_grounding: bool = Field(default=False, description="Whether to use Google Search grounding for factual questions")

class EventSuggestionRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=150, description="Event name, query, or phrase")
    timeline_id: Optional[str] = Field(default=None, description="Optional active timeline ID for tracking per-timeline limits")
    timeline_topic: Optional[str] = Field(default="", max_length=250, description="Active timeline title or prompt")
    time_scale: Optional[Literal["calendar", "prehistoric"]] = Field(default="calendar")
    lanes: Optional[List[dict]] = Field(default_factory=list)
    api_key: Optional[str] = None

class EventSuggestionOutput(BaseModel):
    title: str = Field(description="Display title of the event or person")
    subtitle: Optional[str] = Field(
        default="",
        description="A rich, informative event explanation (2-3 clear sentences / ~30-55 words) detailing what happened, its context, and historical significance, understandable on its own while fitting logically into the active timeline topic."
    )
    detected_language: Optional[str] = Field(default="en", description="2-letter ISO 639-1 language code of the query/timeline topic, e.g. 'en', 'he', 'fr', 'es', 'de', 'ru', 'ar', 'ja', etc.")
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
    is_fictional: Optional[bool] = Field(default=False, description="Set to true if this event is from fiction, literature, mythology, or fantasy (any such work, not just famous ones), or false for real Earth history. If unsure, prefer true rather than guessing real coordinates.")
    ai_event_add_count: Optional[int] = Field(default=None, description="Current event addition count for the timeline")
    remaining_timeline_adds: Optional[int] = Field(default=None, description="Remaining paid event additions for this timeline")


class TimelineChatOutput(BaseModel):
    """Structured result of a single conversational turn about a timeline."""
    reply: str = Field(description="The assistant's conversational reply to the user, in the same language as the user's message. Clear, factual, and helpful; a few sentences for questions, or a short confirmation of what changed for edits.")
    action: Literal["answer", "edit"] = Field(default="answer", description="'answer' if the user only asked a question or wants to discuss; 'edit' if the user asked to change, add, remove, split, rename, or polish the timeline.")
    edit_instruction: Optional[str] = Field(default=None, description="When action is 'edit', a single self-contained natural-language instruction (in the timeline's own language) that fully describes the requested change, suitable for the refine engine. Null when action is 'answer'.")
    is_relevant: Optional[bool] = Field(default=True, description="True if the message is meaningfully connected or naturally adjacent to the timeline topic, its historical/scientific context, curiosity extensions, or editing requests. False only if the message is completely unrelated personal banter, coding task, homework solver, or generic LLM abuse.")
    detected_language: Optional[str] = Field(default="en", description="2-letter ISO 639-1 language code of the user's message, e.g. 'en', 'he', 'fr', 'es'.")


# Gemini Raw Structured Response Models
class GeminiEventItem(BaseModel):
    id: str = Field(description="Unique short ID for the event, e.g. 'ev-1'")
    title: str = Field(description="Display title of the event or entity")
    subtitle: Optional[str] = Field(
        default="",
        description=(
            "A rich, informative event explanation (2-4 clear sentences / ~35-65 words). "
            "It must clearly explain what happened, its context, significance, and cause/consequence. "
            "Crucially, it should naturally weave into the chronological narrative arc so that reading the timeline "
            "sequentially feels coherent and logical, while remaining strictly self-contained and fully understandable "
            "on its own without requiring the reader to have seen prior events. Avoid dry, laconic, or one-sentence summaries; "
            "keep it engaging, meaningful, and balanced (not overly long)."
        )
    )
    lane: Optional[str] = Field(default="", description="Target lane id from the lanes list")
    category: Optional[str] = Field(default="", description="Concise 1-3 word theme classifying this event (e.g. 'Politics', 'Military', 'Science', 'Culture'). Reuse a small consistent set of themes across the timeline. Used to color-code events by theme within a single timeline, independent of lanes.")
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
    is_fictional: Optional[bool] = Field(default=False, description="Set to true if this event is set in a fictional universe, literary saga, fantasy, mythology, or sci-fi world (any such work, not just famous ones). If unsure whether a place/subject is real or fictional, prefer true rather than guessing real coordinates.")

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
    overview: str = Field(
        description="A rich narrative synopsis of 150-220 words (1-2 detailed, structured paragraphs) giving the reader the big picture: what the subject is, why it matters, central arguments/theses (including specific authors, books, theories, or schools of thought when prompted), the driving forces and narrative arc across history/science/nature/culture/fiction, and lasting significance/legacy — the framing a high-level museum exhibition or definitive monograph provides. DISTINCT from and richer than the one-line `description`. Written in the same language as the rest of the timeline."
    )
    time_scale: Literal["calendar", "prehistoric"] = "calendar"
    is_fictional: Optional[bool] = Field(default=False, description="Set to true if this timeline represents a fictional universe, literary saga, fantasy world, sci-fi, or mythology (any such work, not just famous examples like Game of Thrones, Lord of the Rings, Star Wars, Harry Potter). Set to false for real Earth history, prehistory, science, or real biographies.")
    detected_language: Optional[str] = Field(default="en", description="2-letter ISO 639-1 language code of the prompt/timeline, e.g. 'en', 'he', 'fr', 'es', 'de', 'ru', 'ar', 'it', 'ja', etc.")
    lanes: List[GeminiLaneItem] = Field(default_factory=list)
    time_bands: List[GeminiTimeBandItem] = Field(default_factory=list)
    events: List[GeminiEventItem] = Field(default_factory=list)
    related_prompts: Optional[List[str]] = Field(
        default_factory=list,
        description="3 to 5 intriguing, relevant follow-up timeline topic prompts (in the exact same language as the timeline) exploring parallel developments, key sub-topics, or adjacent historical/scientific eras."
    )


class TimelineChatResponse(BaseModel):
    """API response for a single chat turn about a timeline."""
    reply: str
    action: Literal["answer", "edit"] = "answer"
    updated_timeline: Optional[TimelineData] = Field(default=None, description="The refined timeline, present only when action is 'edit' and the change succeeded.")
    grounding: Optional[GroundingMetadataPayload] = Field(default=None, description="Google Search grounding metadata for the answer, when grounding was active and used.")
    detected_language: Optional[str] = "en"
    is_relevant: Optional[bool] = Field(default=True, description="Whether the user query was relevant or off-topic.")
