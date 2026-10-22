from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, Field, AliasChoices

PrecisionType = Literal[
    "minute", "hour", "day", "month", "year", "decade", "century", "millennium", "million-years", "billion-years"
]

# Shared descriptions for the optional time-of-day fields (local time at the event's location).
HOUR_DESC = "Hour of day (0-23, 24h local time at the event's location). ONLY when the time is documented in reliable sources; otherwise null."
MINUTE_DESC = "Minute (0-59). ONLY when the exact minute is documented; otherwise null."

# How the user entered a prompt: keyboard, microphone dictation, or a shared ?prompt= link (activity analytics only).
InputMethod = Literal["typed", "voice", "url"]
INPUT_METHOD_DESC = "How the prompt was entered: 'typed', 'voice' (microphone dictation) or 'url' (?prompt= link). Activity analytics only."

class TimelineDate(BaseModel):
    year: int = Field(description="Calendar year, negative for BC or astronomical years ago")
    month: Optional[int] = Field(default=None, ge=1, le=12)
    day: Optional[int] = Field(default=None, ge=1, le=31)
    # Sub-day parts: local wall-clock time at the event's location (no timezone conversion).
    hour: Optional[int] = Field(default=None, ge=0, le=23)
    minute: Optional[int] = Field(default=None, ge=0, le=59)
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
    imageSource: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("imageSource", "image_source"),
        serialization_alias="imageSource"
    )
    mediaType: Optional[Literal["image", "gif", "video"]] = "image"
    imagePositionX: Optional[float] = Field(default=None, ge=0, le=100)
    imagePositionY: Optional[float] = Field(default=None, ge=0, le=100)
    rank: Optional[int] = Field(default=5, ge=1, le=10)
    
    # Extra rich metadata
    wikiTitle: Optional[str] = None
    wikiTitleEn: Optional[str] = None
    wikiUrl: Optional[str] = None
    extract: Optional[str] = None
    # True when the user wrote the summary (vs. the automatic Wikipedia extract).
    extractIsCustom: Optional[bool] = False
    # YouTube results saved for the Videos tab, and the search query they were found with.
    videos: Optional[List[Dict[str, Any]]] = None
    videosQuery: Optional[str] = None
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
    isEdited: Optional[bool] = Field(
        default=False,
        validation_alias=AliasChoices("isEdited", "is_edited", "isManuallyEdited", "is_manually_edited"),
        serialization_alias="isEdited"
    )
    editedAt: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("editedAt", "edited_at"),
        serialization_alias="editedAt"
    )

    model_config = {"populate_by_name": True, "extra": "allow"}

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

class QuizQuestion(BaseModel):
    id: str = Field(default="", description="Unique short ID for the question, e.g. 'q1', 'q2'")
    question: str = Field(description="Engaging, kid-friendly trivia question based strictly on the timeline's events or overview, in the timeline's language.")
    options: List[str] = Field(description="Exactly 4 multiple-choice answer options in the timeline's language. Only one is correct; the other 3 are plausible distractors.")
    correct_index: int = Field(ge=0, le=3, description="0-based index (0, 1, 2, or 3) of the correct option in `options`.")
    explanation: str = Field(description="Short, warm, encouraging 1-2 sentence explanation of why the answer is right and an interesting takeaway from the timeline, in the timeline's language.")
    event_id: Optional[str] = Field(default=None, description="Exact `id` of the primary related timeline event from the provided events list (e.g. 'evt-3') so the player can focus on that event as a hint.")


class WhoAmIItem(BaseModel):
    id: str = Field(default="", description="Unique short ID for the mystery round, e.g. 'w1', 'w2'")
    target_event_id: str = Field(description="Exact `id` of the target timeline event from the provided events list.")
    target_title: str = Field(default="", description="Exact `title` of the target timeline event.")
    category_hint: Optional[str] = Field(default=None, description="Short category or thematic hint in the timeline's language (e.g. 'Milestone', 'Historical Figure', 'Discovery').")
    clues: List[str] = Field(description="Exactly 5 progressive clues in the timeline's language, ordered from #1 (hardest, atmospheric/indirect context) to #5 (easiest, unmistakable specific detail without explicitly naming the event title).")
    fun_fact: str = Field(default="", description="Short 1-2 sentence reveal takeaway explaining why this event or figure was pivotal in the timeline, in the timeline's language.")

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
        description="Belongs in the user's 'Personal Timelines' list (hand-authored OR AI-extracted from user-supplied files/text)"
    )
    isManual: Optional[bool] = Field(
        default=False,
        validation_alias=AliasChoices("isManual", "is_manual"),
        serialization_alias="isManual",
        description="Hand-authored by the user with no AI involved (drives the 'not AI-generated' disclaimer/overview UI)"
    )
    isPinned: Optional[bool] = Field(
        default=False,
        validation_alias=AliasChoices("isPinned", "is_pinned"),
        serialization_alias="isPinned",
        description="Whether the timeline appears first in saved-timeline lists"
    )
    grounding: Optional[GroundingMetadataPayload] = Field(default=None, description="Google Search Grounding metadata if enabled")
    relatedPrompts: Optional[List[str]] = Field(
        default_factory=list,
        validation_alias=AliasChoices("relatedPrompts", "related_prompts"),
        serialization_alias="relatedPrompts",
        description="Suggested prompt topics for related timelines to explore."
    )
    chatQuestions: Optional[List[str]] = Field(
        default_factory=list,
        validation_alias=AliasChoices("chatQuestions", "chat_questions"),
        serialization_alias="chatQuestions",
        description="Suggested in-depth follow-up questions to ask the timeline chat."
    )
    chatEditIdeas: Optional[List[str]] = Field(
        default_factory=list,
        validation_alias=AliasChoices("chatEditIdeas", "chat_edit_ideas"),
        serialization_alias="chatEditIdeas",
        description="Suggested edit requests (add/remove/change events) for the timeline chat."
    )
    categories: Optional[List[str]] = Field(
        default_factory=list,
        validation_alias=AliasChoices("categories", "category_list"),
        serialization_alias="categories",
        description="Curated high-level domain categories (e.g. ['Science & Technology', 'History & Politics'])"
    )
    tags: Optional[List[str]] = Field(
        default_factory=list,
        validation_alias=AliasChoices("tags", "tag_list"),
        serialization_alias="tags",
        description="Specific entity or topic tags (e.g. ['America', 'Space Exploration', 'NASA'])"
    )
    tokenUsage: Optional[Dict[str, Any]] = Field(
        default=None,
        validation_alias=AliasChoices("tokenUsage", "token_usage"),
        serialization_alias="tokenUsage",
        description="Token consumption and estimated generation cost metadata"
    )
    detectedLanguage: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("detectedLanguage", "detected_language", "language"),
        serialization_alias="detectedLanguage",
        description="2-letter ISO 639-1 language code of the timeline content (e.g. 'en', 'he', 'es', 'fr')"
    )
    contentMode: Optional[Literal["classic", "kids", "teens"]] = Field(
        default="classic",
        validation_alias=AliasChoices("contentMode", "content_mode"),
        serialization_alias="contentMode",
        description="Audience content mode: 'classic' (general audience), 'kids' (ages 8-11) or 'teens' (ages 12-15)"
    )
    searchMode: Optional[Literal["fast", "web_search"]] = Field(
        default=None,
        validation_alias=AliasChoices("searchMode", "search_mode"),
        serialization_alias="searchMode",
        description="How the timeline was AI-generated: 'fast' (model knowledge only) or 'web_search' (Google Search grounding). None for hand-authored timelines."
    )
    creationSource: Optional[Literal["prompt", "files", "photo_prompt", "manual"]] = Field(
        default=None,
        validation_alias=AliasChoices("creationSource", "creation_source"),
        serialization_alias="creationSource",
        description="How the timeline was created: text prompt, uploaded files/pasted text, photo prompt, or by hand."
    )
    quiz: Optional[List[QuizQuestion]] = Field(
        default=None,
        description="Optional on-demand generated interactive trivia quiz questions for the timeline"
    )
    whoami: Optional[List[WhoAmIItem]] = Field(
        default=None,
        description="Optional on-demand generated progressive-clue mystery rounds ('Who/What Event Am I?') for the timeline"
    )

    model_config = {"populate_by_name": True}

class GenerateTimelineRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=3000, description="User natural language request for timeline")
    custom_focus: Optional[str] = Field(default=None, max_length=1000, description="Optional special focus or aspect")
    enable_grounding: bool = Field(default=False, description="Whether to activate Google Search Grounding for live factual verification")
    content_mode: Optional[Literal["classic", "kids", "teens"]] = Field(default="classic", description="Audience content mode ('classic', 'kids' or 'teens')")
    enable_ai_fallback_images: Optional[bool] = Field(default=None, description="Whether to automatically generate AI images for key events when Wikimedia fails to find an image")
    input_method: Optional[InputMethod] = Field(default=None, description=INPUT_METHOD_DESC)

class EventImageGenerationRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=300, description="Event title")
    subtitle: Optional[str] = Field(default="", max_length=1500, description="Event subtitle or description")
    year: Optional[int] = Field(default=None, description="Event start year")
    time_scale: Optional[Literal["calendar", "prehistoric"]] = Field(default="calendar")
    timeline_topic: Optional[str] = Field(default="", max_length=300, description="Overall timeline title or subject")
    location_name: Optional[str] = Field(default=None, max_length=250, description="Geographic or contextual location")
    is_fictional: Optional[bool] = Field(default=False, description="Whether the event is fictional/mythological")
    custom_prompt: Optional[str] = Field(default=None, max_length=600, description="Optional user-specified prompt or visual direction")
    style: Optional[Literal["auto", "historical", "illustration", "painting", "cinematic"]] = Field(default="auto")
    content_mode: Optional[Literal["classic", "kids", "teens"]] = Field(default="classic")
    api_key: Optional[str] = None
    timeline_id: Optional[str] = Field(default=None, max_length=120, description="Active timeline ID (activity analytics only)")
    source: Optional[Literal["event_drawer", "event_editor", "puzzle"]] = Field(default=None, description="UI surface that requested the image (activity analytics only)")

class GameCompletedRequest(BaseModel):
    """A finished timeline game, reported by the client for activity analytics."""
    game: Literal["trivia", "sequence", "timeGuesser", "wordle", "puzzle", "memory", "whoAmI"]
    timeline_id: Optional[str] = Field(default=None, max_length=120)
    content_mode: Optional[Literal["classic", "kids", "teens"]] = None
    correct: Optional[int] = Field(default=None, ge=0, le=500, description="Rounds/questions answered correctly")
    total: Optional[int] = Field(default=None, ge=0, le=500, description="Rounds/questions played")
    points: Optional[float] = Field(default=None, ge=0, le=10_000_000, description="Game-specific points, if the game keeps a points score")
    ratio: Optional[float] = Field(default=None, ge=0, le=1)
    stars: Optional[int] = Field(default=None, ge=0, le=3)
    duration_ms: Optional[int] = Field(default=None, ge=0, le=24 * 3600 * 1000)
    difficulty: Optional[str] = Field(default=None, max_length=30)

class RefineTimelineRequest(BaseModel):
    timeline: TimelineData
    instruction: str = Field(..., min_length=2, max_length=2000, description="Instruction for refining or adding events")
    content_mode: Optional[Literal["classic", "kids", "teens"]] = Field(default=None, description="Audience content mode override ('classic', 'kids' or 'teens')")

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=4000)

class TimelineChatRequest(BaseModel):
    timeline: TimelineData
    message: str = Field(..., min_length=1, max_length=1000, description="The user's chat message about the timeline")
    history: List[ChatMessage] = Field(default_factory=list, description="Prior conversation turns (most recent last)")
    enable_grounding: bool = Field(default=False, description="Whether to use Google Search grounding for factual questions")
    content_mode: Optional[Literal["classic", "kids", "teens"]] = Field(default=None, description="Audience content mode override ('classic', 'kids' or 'teens')")
    input_method: Optional[InputMethod] = Field(default=None, description=INPUT_METHOD_DESC)

class EventSuggestionRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=150, description="Event name, query, or phrase")
    timeline_id: Optional[str] = Field(default=None, description="Optional active timeline ID, currently unused for quota (kept for future analytics)")
    timeline_topic: Optional[str] = Field(default="", max_length=250, description="Active timeline title or prompt")
    time_scale: Optional[Literal["calendar", "prehistoric"]] = Field(default="calendar")
    lanes: Optional[List[dict]] = Field(default_factory=list)
    api_key: Optional[str] = None
    content_mode: Optional[Literal["classic", "kids", "teens"]] = Field(default="classic", description="Audience content mode ('classic', 'kids' or 'teens')")

class EventSuggestionOutput(BaseModel):
    title: str = Field(description="Display title of the event or person")
    subtitle: Optional[str] = Field(
        default="",
        description="A substantive, engaging event narrative (2 to 3 sentences / ~40-65 words for supporting milestones; 3 to 5 sentences / ~60-95 words for pivotal milestones) detailing what happened, its context, and historical significance, understandable on its own while fitting logically into the active timeline topic. Avoid dry or one-sentence summaries."
    )
    detected_language: Optional[str] = Field(default="en", description="2-letter ISO 639-1 language code of the query/timeline topic, e.g. 'en', 'fr', 'es', 'de', 'ja', etc.")
    wikipedia_title: Optional[str] = Field(default=None, description="Exact canonical Wikipedia title in the prompt's language (with disambiguation parenthetical if needed, e.g. 'Lucy (Australopithecus)')")
    wikipedia_title_en: Optional[str] = Field(default=None, description="Exact canonical English Wikipedia title for fallback if the prompt language article does not exist")
    from_year: int = Field(description="Start calendar year. Negative for BCE (e.g. -753) or astronomical years ago if prehistoric (e.g. -3200000)")
    from_month: Optional[int] = Field(default=None, ge=1, le=12, description="Start month (1-12) if known")
    from_day: Optional[int] = Field(default=None, ge=1, le=31, description="Start day (1-31) if known")
    from_hour: Optional[int] = Field(default=None, ge=0, le=23, description=HOUR_DESC)
    from_minute: Optional[int] = Field(default=None, ge=0, le=59, description=MINUTE_DESC)
    from_precision: Optional[PrecisionType] = Field(default="year", description="Precision of start date matching the finest date component supplied ('day' if from_day is set, 'month' if only from_month is set, 'year' if only from_year is set on calendar timelines, or 'million-years'/'billion-years'/'millennium' on prehistoric timelines)")
    to_year: Optional[int] = Field(default=None, description="End calendar year. MANDATORY for any prolonged event, war, reign, era, movement, or span. Leave null ONLY for single-moment / single-day events.")
    to_month: Optional[int] = Field(default=None, ge=1, le=12, description="End month (1-12) if known")
    to_day: Optional[int] = Field(default=None, ge=1, le=31, description="End day (1-31) if known")
    to_hour: Optional[int] = Field(default=None, ge=0, le=23, description=HOUR_DESC)
    to_minute: Optional[int] = Field(default=None, ge=0, le=59, description=MINUTE_DESC)
    to_precision: Optional[PrecisionType] = Field(default=None, description="Precision of end date")
    is_to_present: Optional[bool] = Field(default=False, description="Set to true if this event, reign, organization, or movement began in the past and is still ongoing today.")
    lane_id: Optional[str] = Field(default=None, description="Matching lane id from available lanes, or null")
    category: Optional[str] = Field(default=None, description="Concise 1-3 word thematic topic/category classifying this event (e.g. 'Politics', 'Military', 'Culture'), independent of lane_id — used to color-code the event by topic.")
    location_name: Optional[str] = Field(default=None, description="City, region, landmark, or celestial body where the event took place, or null. For space/astronomical events, provide the celestial name (e.g. 'Uranus', 'Mare Tranquillitatis, Moon') and leave lat/lng strictly null.")
    lat: Optional[float] = Field(default=None, description="Latitude on Earth (-90.0 to 90.0), or null. MUST be null for space/extraterrestrial locations (e.g. Moon, Mars, Uranus, orbit, deep space) and fictional worlds.")
    lng: Optional[float] = Field(default=None, description="Longitude on Earth (-180.0 to 180.0), or null. MUST be null for space/extraterrestrial locations (e.g. Moon, Mars, Uranus, orbit, deep space) and fictional worlds.")
    is_fictional: Optional[bool] = Field(default=False, description="Set to true if this event is from fiction, literature, mythology, or fantasy (any such work, not just famous ones), or false for real Earth history. If unsure, prefer true rather than guessing real coordinates.")


class EventEditPayload(BaseModel):
    title: Optional[str] = Field(default=None, description="New title if renaming the event")
    subtitle: Optional[str] = Field(default=None, description="New subtitle / description if rewriting or editing the text")
    category: Optional[str] = Field(default=None, description="New topic / category for color coding")
    lane: Optional[str] = Field(default=None, description="Target lane id to move this event into")
    from_year: Optional[int] = Field(default=None, description="New start year")
    from_month: Optional[int] = Field(default=None, ge=1, le=12, description="New start month (1-12)")
    from_day: Optional[int] = Field(default=None, ge=1, le=31, description="New start day (1-31)")
    from_hour: Optional[int] = Field(default=None, ge=0, le=23, description="New start hour (0-23, local time)")
    from_minute: Optional[int] = Field(default=None, ge=0, le=59, description="New start minute (0-59)")
    from_precision: Optional[PrecisionType] = Field(default=None, description="Precision of start date")
    to_year: Optional[int] = Field(default=None, description="New end year")
    to_month: Optional[int] = Field(default=None, ge=1, le=12, description="New end month (1-12)")
    to_day: Optional[int] = Field(default=None, ge=1, le=31, description="New end day (1-31)")
    to_hour: Optional[int] = Field(default=None, ge=0, le=23, description="New end hour (0-23, local time)")
    to_minute: Optional[int] = Field(default=None, ge=0, le=59, description="New end minute (0-59)")
    to_precision: Optional[PrecisionType] = Field(default=None, description="Precision of end date")
    is_to_present: Optional[bool] = Field(default=None, description="Set to true if event continues to present")
    importance_rank: Optional[int] = Field(default=None, ge=1, le=10, description="Visual prominence rank from 1 to 10")
    location_name: Optional[str] = Field(default=None, description="Location name or landmark")


class NewEventPayload(BaseModel):
    title: str = Field(description="Display title of the new event")
    subtitle: Optional[str] = Field(default="", description="Substantive, engaging narrative (2-3 sentences / ~40-65 words for supporting; 3-5 sentences / ~60-95 words for pivotal milestones)")
    lane: Optional[str] = Field(default=None, description="Target lane id from existing lanes, or null for default")
    category: Optional[str] = Field(default="", description="Thematic topic / category for color coding (e.g. 'Politics', 'Military')")
    from_year: int = Field(description="Start calendar year")
    from_month: Optional[int] = Field(default=None, ge=1, le=12, description="Start month (1-12)")
    from_day: Optional[int] = Field(default=None, ge=1, le=31, description="Start day (1-31)")
    from_hour: Optional[int] = Field(default=None, ge=0, le=23, description=HOUR_DESC)
    from_minute: Optional[int] = Field(default=None, ge=0, le=59, description=MINUTE_DESC)
    from_precision: PrecisionType = Field(default="year", description="Precision of start date matching the finest component supplied: 'day' when from_day is provided, 'month' when only from_month is provided, 'year' when only from_year is provided on calendar timelines (never 'decade' or 'century' for single/approximate years)")
    to_year: Optional[int] = Field(default=None, description="End calendar year if span/duration")
    to_month: Optional[int] = Field(default=None, ge=1, le=12, description="End month (1-12)")
    to_day: Optional[int] = Field(default=None, ge=1, le=31, description="End day (1-31)")
    to_hour: Optional[int] = Field(default=None, ge=0, le=23, description=HOUR_DESC)
    to_minute: Optional[int] = Field(default=None, ge=0, le=59, description=MINUTE_DESC)
    to_precision: Optional[PrecisionType] = Field(default=None, description="Precision of end date")
    is_to_present: Optional[bool] = Field(default=False, description="Set to true if event continues to present")
    importance_rank: int = Field(default=5, ge=1, le=10, description="Visual prominence rank 1-10")
    wikipedia_title: Optional[str] = Field(default="", description="Exact canonical Wikipedia title in prompt language")
    wikipedia_title_en: Optional[str] = Field(default="", description="English Wikipedia title fallback")
    location_name: Optional[str] = Field(default=None, description="Location name, city, landmark, or region")


class TimelineChatOutput(BaseModel):
    """Structured result of a single conversational turn about a timeline."""
    reply: str = Field(description="The assistant's conversational reply to the user, in the same language as the user's message. Clear, factual, and helpful; a few sentences for questions, or a short confirmation of what changed for edits.")
    action: Literal["answer", "edit"] = Field(default="answer", description="'answer' if the user only asked a question or wants to discuss; 'edit' if the user asked to change, add, remove, split, rename, condense, or polish the timeline.")
    edit_type: Optional[Literal[
        "timeline_refine",      # Whole timeline: condense/prune, split lanes, merge lanes, full re-categorization, batch additions
        "event_edit",          # Edit an existing single event (title, subtitle, dates, category, lane, rank, location)
        "event_delete",        # Delete one or more specific events
        "event_add"            # Add a single new event with precise dates and Wikipedia title
    ]] = Field(default="timeline_refine", description="The specific type of edit requested.")
    edit_instruction: Optional[str] = Field(default=None, description="When edit_type is 'timeline_refine', a single self-contained natural-language instruction that fully describes the requested change. Null when action is 'answer'.")
    target_event_id: Optional[str] = Field(default=None, description="Exact ID of the target event when edit_type is 'event_edit' or 'event_delete'.")
    target_event_ids: Optional[List[str]] = Field(default=None, description="List of event IDs when deleting multiple specific events.")
    event_edits: Optional[EventEditPayload] = Field(default=None, description="Specific fields to update on the target event when edit_type is 'event_edit'.")
    new_event: Optional[NewEventPayload] = Field(default=None, description="Structured details of the new event when edit_type is 'event_add'.")
    is_relevant: Optional[bool] = Field(default=True, description="True if the message is meaningfully connected or naturally adjacent to the timeline topic, its historical/scientific context, curiosity extensions, or editing requests. False only if the message is completely unrelated personal banter, coding task, homework solver, or generic LLM abuse.")
    detected_language: Optional[str] = Field(default="en", description="2-letter ISO 639-1 language code of the user's message, e.g. 'en', 'he', 'fr', 'es', 'de'.")


# Gemini Raw Structured Response Models
class GeminiEventItem(BaseModel):
    id: Optional[str] = Field(default="", description="Short ID (required only when refining existing events; omit for new timelines)")
    title: str = Field(description="Display title of the event or entity")
    subtitle: Optional[str] = Field(
        default="",
        description=(
            "Substantive narrative calibrated by rank: 3-5 rich sentences (~60-95 words) for pivotal milestones (ranks 7-10 & bookends) "
            "covering occurrence, catalyst, and lasting impact; 2-3 sentences (~40-65 words) for supporting milestones (ranks 1-6). "
            "Self-contained yet chronologically cohesive."
        )
    )
    lane: Optional[str] = Field(default="", description="Target lane id (omit when timeline has only 1 lane)")
    category: Optional[str] = Field(
        default="",
        description="Concise 1-3 word thematic category driving event color (reuse 2-6 consistent themes across timeline)."
    )
    from_year: int = Field(description="Start year (negative for BCE or prehistoric years ago)")
    from_month: Optional[int] = Field(default=None, ge=1, le=12, description="Start month (1-12) if known; omit if unknown")
    from_day: Optional[int] = Field(default=None, ge=1, le=31, description="Start day (1-31) if known; omit if unknown")
    from_hour: Optional[int] = Field(default=None, ge=0, le=23, description=HOUR_DESC)
    from_minute: Optional[int] = Field(default=None, ge=0, le=59, description=MINUTE_DESC)
    from_precision: PrecisionType = Field(default="year", description="Precision of start date matching the finest component supplied: 'day' when from_day is provided, 'month' when only from_month is provided, 'year' when only from_year is provided on calendar timelines (never 'decade' or 'century' for single/approximate years)")
    to_year: Optional[int] = Field(
        default=None,
        description="End calendar year. MANDATORY for any prolonged event, war, reign, era, movement, or span. Omit for point-in-time events."
    )
    to_month: Optional[int] = Field(default=None, ge=1, le=12, description="End month (1-12) if known; omit if unknown")
    to_day: Optional[int] = Field(default=None, ge=1, le=31, description="End day (1-31) if known; omit if unknown")
    to_hour: Optional[int] = Field(default=None, ge=0, le=23, description=HOUR_DESC)
    to_minute: Optional[int] = Field(default=None, ge=0, le=59, description=MINUTE_DESC)
    to_precision: Optional[PrecisionType] = Field(default=None, description="Precision of end date matching the finest component supplied ('day', 'month', 'year', etc.); omit if point-in-time")
    is_to_present: Optional[bool] = Field(
        default=False,
        description="Set to true ONLY if ongoing today; otherwise omit."
    )
    wikipedia_title: Optional[str] = Field(default="", description="Canonical Wikipedia title in the prompt's language (with disambiguation parenthetical if needed), or omit if no dedicated article")
    wikipedia_title_en: Optional[str] = Field(default="", description="Canonical English Wikipedia title for non-English timelines (omit when detected_language is 'en')")
    importance_rank: int = Field(default=5, ge=1, le=10, description="Prominence rank 1-10 (first and last chronological events MUST be 9 or 10)")
    location_name: Optional[str] = Field(default=None, description="City, region, site, or celestial body; omit if none")
    lat: Optional[float] = Field(default=None, description="Earth latitude (-90 to 90); omit for space, fictional, or non-geographic events")
    lng: Optional[float] = Field(default=None, description="Earth longitude (-180 to 180); omit for space, fictional, or non-geographic events")
    is_fictional: Optional[bool] = Field(default=False, description="Set to true ONLY for fictional/mythological/literary events; otherwise omit.")

class GeminiLaneItem(BaseModel):
    id: str
    title: str
    color: Optional[str] = "#3b82f6"

class GeminiTimeBandItem(BaseModel):
    id: Optional[str] = ""
    title: str
    from_year: int
    to_year: int
    from_month: Optional[int] = Field(default=None, ge=1, le=12)
    from_day: Optional[int] = Field(default=None, ge=1, le=31)
    to_month: Optional[int] = Field(default=None, ge=1, le=12)
    to_day: Optional[int] = Field(default=None, ge=1, le=31)
    from_hour: Optional[int] = Field(default=None, ge=0, le=23, description="Start hour (0-23) — only for single-day phases")
    from_minute: Optional[int] = Field(default=None, ge=0, le=59)
    to_hour: Optional[int] = Field(default=None, ge=0, le=23, description="End hour (0-23) — only for single-day phases")
    to_minute: Optional[int] = Field(default=None, ge=0, le=59)
    precision: PrecisionType = "year"
    color: Optional[str] = "#e2e8f0"

SubjectStatusType = Literal["documented", "sparse", "unknown"]


class GeminiTimelineOutput(BaseModel):
    # Declared FIRST on purpose: the model commits to an honest knowledge verdict
    # before generating any events, which helps curb fabricated timelines.
    subject_status: SubjectStatusType = Field(
        default="documented",
        description=(
            "Honest verdict on subject documentation decided BEFORE writing events: "
            "'documented' (well-documented real subject or fictional setting), "
            "'sparse' (only a few verified facts), or "
            "'unknown' (private/unrecognized subject — return EMPTY events array)."
        )
    )
    title: str
    description: str
    overview: str = Field(
        description="Rich 150-220 word narrative synopsis (1-2 paragraphs, light Markdown) covering context, core thesis/driving forces, and lasting legacy in the timeline's language."
    )
    time_scale: Literal["calendar", "prehistoric"] = "calendar"
    is_fictional: Optional[bool] = Field(default=False, description="True if set in a fictional, literary, mythological, or fantasy world; false for real Earth history/science.")
    detected_language: Optional[str] = Field(default="en", description="2-letter ISO 639-1 language code of the prompt/timeline (e.g. 'en', 'he', 'fr', 'es', 'de', 'ar', 'ja').")
    lanes: List[GeminiLaneItem] = Field(default_factory=list)
    time_bands: List[GeminiTimeBandItem] = Field(default_factory=list)
    events: List[GeminiEventItem] = Field(
        default_factory=list,
        description="Chronological milestones (10-50 verified events for 'documented', only verified events for 'sparse', EMPTY for 'unknown')."
    )
    keep_unmentioned_events: Optional[bool] = Field(
        default=True,
        description="During refinement: false if condensing/pruning/filtering; true to preserve unmentioned events."
    )
    related_prompts: Optional[List[str]] = Field(
        default_factory=list,
        description="3-5 standalone follow-up timeline prompts in the same language."
    )
    chat_questions: Optional[List[str]] = Field(
        default_factory=list,
        description="2-3 specific follow-up questions (<90 chars each) about this timeline in the same language."
    )
    chat_edit_ideas: Optional[List[str]] = Field(
        default_factory=list,
        description="2-3 short imperative edit requests (<80 chars each: add, remove/condense, re-group colors) in the same language."
    )
    categories: Optional[List[str]] = Field(
        default_factory=list,
        description="1-3 categories from: ['History & Politics', 'Science & Technology', 'Space & Aviation', 'Geography & Nations', 'Arts & Culture', 'Nature & Evolution', 'Biographies & Figures', 'Military & War', 'Business & Economy', 'Society & Philosophy']"
    )
    tags: Optional[List[str]] = Field(
        default_factory=list,
        description="2-5 specific entity, topic, or geographic tags."
    )


class TimelineChatResponse(BaseModel):
    """API response for a single chat turn about a timeline."""
    reply: str
    action: Literal["answer", "edit"] = "answer"
    updated_timeline: Optional[TimelineData] = Field(default=None, description="The refined timeline, present only when action is 'edit' and the change succeeded.")
    grounding: Optional[GroundingMetadataPayload] = Field(default=None, description="Google Search grounding metadata for the answer, when grounding was active and used.")
    detected_language: Optional[str] = "en"
    is_relevant: Optional[bool] = Field(default=True, description="Whether the user query was relevant or off-topic.")


class TimelineQuizOutput(BaseModel):
    """Structured Gemini output for an interactive timeline trivia quiz."""
    questions: List[QuizQuestion] = Field(
        ...,
        description="List of 5 to 6 varied multiple-choice trivia questions ordered from accessible warm-up to thought-provoking."
    )
    detected_language: Optional[str] = Field(
        default="en",
        description="2-letter ISO 639-1 language code of the timeline (e.g. 'he', 'en', 'fr', 'es')."
    )


class TimelineQuizRequest(BaseModel):
    timeline: TimelineData
    previous_questions: List[str] = Field(
        default_factory=list,
        max_length=50,
        description="Optional list of previously asked question strings to avoid repeating when generating a fresh quiz."
    )
    content_mode: Optional[Literal["classic", "kids", "teens"]] = Field(
        default=None,
        description="Audience content mode override ('classic', 'kids' or 'teens')"
    )


class TimelineQuizResponse(BaseModel):
    questions: List[QuizQuestion]
    detected_language: Optional[str] = "en"
    tokenUsage: Optional[Dict[str, Any]] = None


class TimelineWhoAmIOutput(BaseModel):
    """Structured Gemini output for the 'Who/What Event Am I?' progressive clues game."""
    items: List[WhoAmIItem] = Field(
        ...,
        description="List of 4 to 5 mystery rounds, each targeting a distinct timeline event with 5 progressive clues."
    )
    detected_language: Optional[str] = Field(
        default="en",
        description="2-letter ISO 639-1 language code of the timeline (e.g. 'he', 'en', 'fr', 'es')."
    )


class TimelineWhoAmIRequest(BaseModel):
    timeline: TimelineData
    previous_event_ids: List[str] = Field(
        default_factory=list,
        max_length=50,
        description="Optional list of previously used target_event_ids to avoid repeating when generating a fresh round."
    )
    content_mode: Optional[Literal["classic", "kids", "teens"]] = Field(
        default=None,
        description="Audience content mode override ('classic', 'kids' or 'teens')"
    )


class TimelineWhoAmIResponse(BaseModel):
    items: List[WhoAmIItem]
    detected_language: Optional[str] = "en"
    tokenUsage: Optional[Dict[str, Any]] = None

