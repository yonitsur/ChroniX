import re
from typing import Annotated, List, Optional, Literal, Dict, Any
from pydantic import BaseModel, BeforeValidator, Field, AliasChoices

_UNSAFE_ID_CHARS_RE = re.compile(r'[<>"\'`\x00-\x1f\x7f]')


def _validate_safe_id(v: Any) -> str:
    if not isinstance(v, str):
        raise ValueError("id must be a string")
    cleaned = v.strip()
    if not cleaned:
        raise ValueError("id must not be empty")
    if len(cleaned) > 128:
        raise ValueError("id exceeds maximum length of 128 characters")
    if _UNSAFE_ID_CHARS_RE.search(cleaned):
        raise ValueError("id contains unsafe HTML or control characters")
    return cleaned


SafeIdStr = Annotated[str, BeforeValidator(_validate_safe_id)]

STORY_STUDIO_META_MAX_CHARS = 16_000


def _validate_story_studio_meta(v: Any) -> Any:
    """Story Studio re-open state is small (blueprint key, names, hidden chapter ids); cap its size."""
    if v is None:
        return None
    if not isinstance(v, dict):
        raise ValueError("storyStudio must be an object")
    import json
    if len(json.dumps(v, ensure_ascii=False, default=str)) > STORY_STUDIO_META_MAX_CHARS:
        raise ValueError("storyStudio metadata is too large")
    return v

PrecisionType = Literal[
    "minute", "hour", "day", "month", "year", "decade", "century", "millennium", "million-years", "billion-years"
]

# Shared descriptions for the optional time-of-day fields (local time at the event's location).
HOUR_DESC = "Hour of day (0-23, 24h local time at the event's location). ONLY when the time is documented in reliable sources; otherwise null."
MINUTE_DESC = "Minute (0-59). ONLY when the exact minute is documented; otherwise null."

def _normalize_stored_content_mode(v: Any) -> str:
    return "kids" if v == "kids" else "classic"


StoredContentMode = Annotated[Literal["classic", "kids"], BeforeValidator(_normalize_stored_content_mode)]
ContentModeType = Literal["classic", "kids"]


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

_WIKI_ARTICLE_URL_RE = re.compile(r"^https://[a-z0-9-]{2,24}\.wikipedia\.org/wiki/[^\s<>\"']{1,1500}$")
_QID_RE = re.compile(r"^Q[1-9][0-9]{0,11}$")
CONTEXT_LINK_KINDS = ("place", "event")
_COMMONS_FILE_URL_RE = re.compile(r"^https://commons\.wikimedia\.org/wiki/File:[^\s<>\"']{1,600}$")
MAX_CONTEXT_LINKS = 6


def _clean_context_links(v: Any) -> Optional[List[Dict[str, Any]]]:
    """"Learn more" links of an event (e.g. the Wikipedia article of its place): only plain Wikipedia
    article URLs survive, anything else is dropped silently (timelines are saved by the client)."""
    if not isinstance(v, list):
        return None
    out: List[Dict[str, Any]] = []
    for raw in v[: MAX_CONTEXT_LINKS * 2]:
        if not isinstance(raw, dict):
            continue
        kind, url, title = raw.get("kind"), raw.get("url"), raw.get("title")
        if kind not in CONTEXT_LINK_KINDS or not isinstance(url, str) or not _WIKI_ARTICLE_URL_RE.match(url):
            continue
        if not isinstance(title, str) or not title.strip():
            continue
        item: Dict[str, Any] = {"kind": kind, "title": title.strip()[:400], "url": url}
        for key, limit in (("name", 400), ("lang", 24), ("description", 200)):
            val = raw.get(key)
            if isinstance(val, str) and val.strip():
                item[key] = val.strip()[:limit]
        if isinstance(raw.get("qid"), str) and _QID_RE.match(raw["qid"]):
            item["qid"] = raw["qid"]
        out.append(item)
        if len(out) >= MAX_CONTEXT_LINKS:
            break
    return out or None


_UPLOAD_URL_RE = re.compile(r"^https://upload\.wikimedia\.org/[^\s<>\"']{1,1500}$")
MAX_DISMISSED_LINKS = 300


def _clean_dismissed_links(v: Any) -> Optional[List[str]]:
    if not isinstance(v, list):
        return None
    out = [s[:2300] for s in v if isinstance(s, str) and "https://" in s and len(s) <= 2300]
    return list(dict.fromkeys(out))[-MAX_DISMISSED_LINKS:] or None


def _clean_illustrative(v: Any) -> Optional[Dict[str, Any]]:
    """An illustrative cover (a Wikimedia picture of the event's place, not the family's own photo):
    only its place name and its Commons file page survive."""
    if not isinstance(v, dict) or not isinstance(v.get("fileUrl"), str) or not _COMMONS_FILE_URL_RE.match(v["fileUrl"]):
        return None
    out: Dict[str, Any] = {"fileUrl": v["fileUrl"]}
    # The picture it describes: the badge shows only while that picture is still the cover.
    if isinstance(v.get("url"), str) and _UPLOAD_URL_RE.match(v["url"]):
        out["url"] = v["url"]
    for key, limit in (("place", 200), ("file", 300)):
        if isinstance(v.get(key), str) and v[key].strip():
            out[key] = v[key].strip()[:limit]
    return out


class TimelineArticle(BaseModel):
    id: SafeIdStr
    title: str = Field(..., max_length=600)
    subtitle: Optional[str] = Field(default=None, max_length=6000)
    lane: Optional[str] = Field(default=None, max_length=128)
    from_: TimelineDate = Field(alias="from")
    to: Optional[TimelineDate] = None
    isToPresent: Optional[bool] = False
    imageUrl: Optional[str] = Field(default=None, max_length=1_500_000)
    imageSource: Optional[str] = Field(
        default=None,
        max_length=120,
        validation_alias=AliasChoices("imageSource", "image_source"),
        serialization_alias="imageSource"
    )
    mediaType: Optional[Literal["image", "gif", "video"]] = "image"
    imageModel: Optional[str] = Field(
        default=None,
        max_length=120,
        validation_alias=AliasChoices("imageModel", "image_model"),
        serialization_alias="imageModel"
    )
    imageCostUsd: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("imageCostUsd", "image_cost_usd"),
        serialization_alias="imageCostUsd"
    )
    imagePositionX: Optional[float] = Field(default=None, ge=0, le=100)
    imagePositionY: Optional[float] = Field(default=None, ge=0, le=100)
    rank: Optional[int] = Field(default=5, ge=1, le=10)
    
    # Extra rich metadata
    wikiTitle: Optional[str] = Field(default=None, max_length=400)
    wikiTitleEn: Optional[str] = Field(default=None, max_length=400)
    wikiUrl: Optional[str] = Field(default=None, max_length=2000)
    extract: Optional[str] = Field(default=None, max_length=30000)
    # True when the user wrote the summary (vs. the automatic Wikipedia extract).
    extractIsCustom: Optional[bool] = False
    # YouTube results saved for the Videos tab, and the search query they were found with.
    videos: Optional[List[Dict[str, Any]]] = Field(default=None, max_length=30)
    videosQuery: Optional[str] = Field(default=None, max_length=400)
    category: Optional[str] = Field(default=None, max_length=200)

    # Geographic metadata
    locationName: Optional[str] = Field(default=None, max_length=400)
    lat: Optional[float] = None
    lng: Optional[float] = None
    googleMapsUrl: Optional[str] = Field(default=None, max_length=2000)
    # Wikipedia articles about what the event mentions (personal timelines: its place).
    contextLinks: Annotated[Optional[List[Dict[str, Any]]], BeforeValidator(_clean_context_links)] = None
    imageIllustrative: Annotated[Optional[Dict[str, Any]], BeforeValidator(_clean_illustrative)] = None
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
        max_length=80,
        validation_alias=AliasChoices("editedAt", "edited_at"),
        serialization_alias="editedAt"
    )

    model_config = {"populate_by_name": True, "extra": "allow"}

class TimelineLane(BaseModel):
    id: SafeIdStr
    title: str = Field(..., max_length=300)
    color: Optional[str] = Field(default=None, max_length=64)
    order: Optional[int] = 0

class TimelineTimeBand(BaseModel):
    id: SafeIdStr
    title: str = Field(..., max_length=300)
    from_: TimelineDate = Field(alias="from")
    to: TimelineDate
    color: Optional[str] = Field(default=None, max_length=64)
    sourceLayerId: Optional[str] = Field(default=None, max_length=128)

    model_config = {"populate_by_name": True, "extra": "allow"}

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


class PodcastTurn(BaseModel):
    speaker: Literal["host1", "host2"] = Field(
        default="host1",
        description="Speaker identifier: 'host1' (lead narrator/historian) or 'host2' (co-host in duo format)."
    )
    text: str = Field(
        description="Natural spoken broadcast dialogue in the timeline's language. Pure plain spoken text (NO markdown symbols like ** or *, NO stage directions in brackets)."
    )


class PodcastSegment(BaseModel):
    id: str = Field(default="", description="Unique short ID for the segment, e.g. 'seg-1'")
    type: Literal["intro", "event", "outro"] = Field(
        default="event",
        description="'intro' for the opening hook, 'event' for a timeline milestone chapter, or 'outro' for the closing synthesis."
    )
    event_id: Optional[str] = Field(
        default=None,
        description="Exact `id` of the timeline event discussed in this chapter (e.g. 'evt-3'), or null for 'intro' and 'outro'."
    )
    chapter_title: str = Field(
        default="",
        description="Short, compelling chapter heading in the timeline's language (for 'event' segments, the event title or a vivid chapter title)."
    )
    turns: List[PodcastTurn] = Field(
        default_factory=list,
        description="1 rich narrative turn in 'single' format, or 2-3 natural conversational turns alternating between 'host1' and 'host2' in 'duo' format."
    )


class PodcastData(BaseModel):
    """Legacy podcast script embedded on a timeline (pre-episode storage). Read-only; migrated on access."""
    title: str = Field(default="", description="Engaging podcast episode title in the timeline's language")
    format: Literal["single", "duo"] = "single"
    voice_gender: Literal["male", "female"] = "male"
    length: Literal["focused", "full"] = "full"
    tts_engine: Annotated[
        Literal["edge", "gcloud", "gemini"],
        BeforeValidator(lambda v: v if v in ("edge", "gcloud", "gemini") else "edge"),
    ] = "edge"
    host1_name: str = Field(default="", description="Display name/role of Host 1")
    host2_name: Optional[str] = Field(default=None, description="Display name/role of Host 2 (in duo mode)")
    detected_language: Optional[str] = "en"
    segments: List[PodcastSegment] = Field(default_factory=list)
    created_at: Optional[str] = None


class MergedSourceMeta(BaseModel):
    id: Optional[str] = Field(default=None, description="Original source timeline ID, if any")
    title: str = Field(default="", description="Display title of the source timeline layer")
    color: Optional[str] = Field(default=None, description="Assigned lane color for this layer")
    articleCount: Optional[int] = Field(default=None, description="Number of events contributed by this layer")
    laneId: Optional[str] = Field(default=None, description="Primary lane ID in the merged timeline")
    subLanes: Optional[List[TimelineLane]] = Field(default=None, description="Original sub-lanes if the source timeline had multiple lanes")

    model_config = {"populate_by_name": True, "extra": "allow"}


class TimelineData(BaseModel):
    id: SafeIdStr
    title: str = Field(..., max_length=600)
    description: Optional[str] = Field(default="", max_length=6000)
    overview: Optional[str] = Field(
        default="",
        max_length=80000,
        description="Rich narrative synopsis (150-220 words, 1-2 detailed paragraphs) providing the big-picture context, significance, key arguments, and framing of the timeline's subject — distinct from the short one-line description."
    )
    timeScale: Literal["calendar", "prehistoric"] = "calendar"
    lanes: List[TimelineLane] = Field(default_factory=list, max_length=40)
    timeBands: List[TimelineTimeBand] = Field(default_factory=list, max_length=120)
    articles: List[TimelineArticle] = Field(default_factory=list, max_length=600)
    createdAt: Optional[str] = Field(default=None, max_length=80)
    updatedAt: Optional[str] = Field(default=None, max_length=80)
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
        max_length=30,
        validation_alias=AliasChoices("relatedPrompts", "related_prompts"),
        serialization_alias="relatedPrompts",
        description="Suggested prompt topics for related timelines to explore."
    )
    chatQuestions: Optional[List[str]] = Field(
        default_factory=list,
        max_length=30,
        validation_alias=AliasChoices("chatQuestions", "chat_questions"),
        serialization_alias="chatQuestions",
        description="Suggested in-depth follow-up questions to ask the timeline chat."
    )
    chatEditIdeas: Optional[List[str]] = Field(
        default_factory=list,
        max_length=30,
        validation_alias=AliasChoices("chatEditIdeas", "chat_edit_ideas"),
        serialization_alias="chatEditIdeas",
        description="Suggested edit requests (add/remove/change events) for the timeline chat."
    )
    categories: Optional[List[str]] = Field(
        default_factory=list,
        max_length=20,
        validation_alias=AliasChoices("categories", "category_list"),
        serialization_alias="categories",
        description="Curated high-level domain categories (e.g. ['Science & Technology', 'History & Politics'])"
    )
    tags: Optional[List[str]] = Field(
        default_factory=list,
        max_length=40,
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
    quizModel: Optional[str] = Field(
        default=None,
        max_length=120,
        validation_alias=AliasChoices("quizModel", "quiz_model"),
        serialization_alias="quizModel",
        description="AI model used to generate the quiz"
    )
    whoamiModel: Optional[str] = Field(
        default=None,
        max_length=120,
        validation_alias=AliasChoices("whoamiModel", "whoami_model"),
        serialization_alias="whoamiModel",
        description="AI model used to generate the Who Am I mystery"
    )
    detectedLanguage: Optional[str] = Field(
        default=None,
        max_length=32,
        validation_alias=AliasChoices("detectedLanguage", "detected_language", "language"),
        serialization_alias="detectedLanguage",
        description="2-letter ISO 639-1 language code of the timeline content (e.g. 'en', 'he', 'es', 'fr')"
    )
    contentMode: Optional[StoredContentMode] = Field(
        default="classic",
        validation_alias=AliasChoices("contentMode", "content_mode"),
        serialization_alias="contentMode",
        description="Audience content mode: 'classic' (general audience) or 'kids' (ages 8-11)"
    )
    searchMode: Optional[Literal["fast", "web_search"]] = Field(
        default=None,
        validation_alias=AliasChoices("searchMode", "search_mode"),
        serialization_alias="searchMode",
        description="How the timeline was AI-generated: 'fast' (model knowledge only) or 'web_search' (Google Search grounding). None for hand-authored timelines."
    )
    creationSource: Optional[Literal["prompt", "files", "photo_prompt", "manual", "merged"]] = Field(
        default=None,
        validation_alias=AliasChoices("creationSource", "creation_source"),
        serialization_alias="creationSource",
        description="How the timeline was created: text prompt, uploaded files/pasted text, photo prompt, or by hand."
    )
    isLibrary: Optional[bool] = Field(
        default=False,
        validation_alias=AliasChoices("isLibrary", "is_library"),
        serialization_alias="isLibrary",
        description="Whether this timeline is curated and published in the ChroniX Public Library (distinct from private link sharing)."
    )
    isFeatured: Optional[bool] = Field(
        default=False,
        validation_alias=AliasChoices("isFeatured", "is_featured"),
        serialization_alias="isFeatured",
        description="Whether this library timeline is highlighted as featured on the home screen / top of library."
    )
    featuredOrder: Optional[int] = Field(
        default=None,
        ge=0,
        le=10000,
        validation_alias=AliasChoices("featuredOrder", "featured_order"),
        serialization_alias="featuredOrder",
        description="Optional 0-based admin-curated display position under Featured sort in the Public Library."
    )
    coverImageUrl: Optional[str] = Field(
        default=None,
        max_length=70000,
        validation_alias=AliasChoices("coverImageUrl", "cover_image_url"),
        serialization_alias="coverImageUrl",
        description="Optional Admin-selected cover image URL for library cards."
    )
    coverImagePositionX: Optional[float] = Field(
        default=None,
        ge=0,
        le=100,
        validation_alias=AliasChoices("coverImagePositionX", "cover_image_position_x"),
        serialization_alias="coverImagePositionX",
        description="Optional horizontal focal point (0-100%) for the library card cover image."
    )
    coverImagePositionY: Optional[float] = Field(
        default=None,
        ge=0,
        le=100,
        validation_alias=AliasChoices("coverImagePositionY", "cover_image_position_y"),
        serialization_alias="coverImagePositionY",
        description="Optional vertical focal point (0-100%) for the library card cover image."
    )
    mergedSources: Optional[List[MergedSourceMeta]] = Field(
        default=None,
        max_length=10,
        validation_alias=AliasChoices("mergedSources", "merged_sources"),
        serialization_alias="mergedSources",
        description="Provenance metadata for source timelines when this timeline was created by merging/layering."
    )
    # Wikipedia links the owner marked wrong ("Not this place"): a later enrichment never re-adds them.
    # Entries are an article URL (a place, timeline-wide) or "<event id>|<article URL>" (one event).
    dismissedLinks: Annotated[Optional[List[str]], BeforeValidator(_clean_dismissed_links)] = None
    storyStudio: Annotated[Optional[Dict[str, Any]], BeforeValidator(_validate_story_studio_meta)] = Field(
        default=None,
        description="Story Studio state needed to re-open a personal timeline in the guided builder (blueprint, people, hidden auto chapters)."
    )
    subLanesExpanded: Optional[bool] = Field(
        default=False,
        validation_alias=AliasChoices("subLanesExpanded", "sub_lanes_expanded"),
        serialization_alias="subLanesExpanded",
        description="Whether original sub-lanes are expanded in a merged timeline."
    )
    quiz: Optional[List[QuizQuestion]] = Field(
        default=None,
        max_length=30,
        description="Optional on-demand generated interactive trivia quiz questions for the timeline"
    )
    whoami: Optional[List[WhoAmIItem]] = Field(
        default=None,
        max_length=30,
        description="Optional on-demand generated progressive-clue mystery rounds ('Who/What Event Am I?') for the timeline"
    )
    podcast: Optional[PodcastData] = Field(
        default=None,
        description="Optional on-demand generated interactive audio podcast script for the timeline"
    )

    model_config = {"populate_by_name": True}

class GenerateTimelineRequest(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=3000, description="User natural language request for timeline")
    custom_focus: Optional[str] = Field(default=None, max_length=1000, description="Optional special focus or aspect")
    enable_grounding: bool = Field(default=False, description="Whether to activate Google Search Grounding for live factual verification")
    content_mode: Optional[ContentModeType] = Field(default="classic", description="Audience content mode ('classic' or 'kids')")
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
    engine: Optional[Literal["auto", "free", "premium"]] = Field(default="auto", description="Image engine tier: 'free' (Hugging Face Z-Image-Turbo / FLUX), 'premium' (Gemini Image), or 'auto'")
    content_mode: Optional[ContentModeType] = Field(default="classic")
    api_key: Optional[str] = Field(default=None, max_length=512)
    timeline_id: Optional[str] = Field(default=None, max_length=128, description="Active timeline ID (activity analytics only)")
    source: Optional[Literal["event_drawer", "event_editor", "puzzle"]] = Field(default=None, description="UI surface that requested the image (activity analytics only)")

class GameCompletedRequest(BaseModel):
    """A finished timeline game, reported by the client for activity analytics."""
    game: Literal["trivia", "sequence", "timeGuesser", "wordle", "puzzle", "memory", "whoAmI"]
    timeline_id: Optional[str] = Field(default=None, max_length=128)
    content_mode: Optional[ContentModeType] = None
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
    content_mode: Optional[ContentModeType] = Field(default=None, description="Audience content mode override ('classic' or 'kids')")
    media_stripped: bool = Field(default=False, description="True when client omitted heavy stored media/blobs from the request payload")

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=8000)

class TimelineChatRequest(BaseModel):
    timeline: TimelineData
    message: str = Field(..., min_length=1, max_length=1000, description="The user's chat message about the timeline")
    history: List[ChatMessage] = Field(default_factory=list, max_length=120, description="Prior conversation turns (most recent last)")
    enable_grounding: bool = Field(default=False, description="Whether to use Google Search grounding for factual questions")
    content_mode: Optional[ContentModeType] = Field(default=None, description="Audience content mode override ('classic' or 'kids')")
    input_method: Optional[InputMethod] = Field(default=None, description=INPUT_METHOD_DESC)
    media_stripped: bool = Field(default=False, description="True when client omitted heavy stored media/blobs from the request payload")

TextPolishField = Literal[
    "event_title",
    "event_subtitle",
    "event_description",
    "timeline_title",
    "timeline_description",
    "timeline_overview",
    "moment_title",
    "moment_story",
    "chapter_title",
]

# Hard ceiling on a single polish request (the longest free-text field is the timeline overview).
TEXT_POLISH_MAX_CHARS = 20000


class TextPolishRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=TEXT_POLISH_MAX_CHARS, description="The user's rough draft to polish")
    field: TextPolishField = Field(..., description="Which field the text belongs to (drives length and style)")
    context: Optional[str] = Field(default="", max_length=400, description="Short surrounding context, e.g. the timeline topic or event title")
    max_length: Optional[int] = Field(default=None, ge=10, le=80000, description="The field's character limit; the result is kept within it")
    timeline_id: Optional[str] = Field(default=None, max_length=128, description="Optional active timeline ID (analytics only)")
    content_mode: Optional[ContentModeType] = Field(default="classic", description="Audience content mode ('classic' or 'kids')")
    api_key: Optional[str] = Field(default=None, max_length=512)


class TextPolishOutput(BaseModel):
    text: str = Field(description="The polished text, in the same language as the draft")


# --- Story Studio: AI-drafted overview -------------------------------------------------------
# The overview is written ONLY from what the user entered in the Studio, so the request carries
# the story's facts (people, chapters, moments and their notes), never free-form instructions.

class StoryOverviewChapter(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    from_: Optional[str] = Field(default="", max_length=40, alias="from")
    to: Optional[str] = Field(default="", max_length=40)

    model_config = {"populate_by_name": True}


class StoryOverviewMoment(BaseModel):
    title: str = Field(..., min_length=1, max_length=160)
    date: Optional[str] = Field(default="", max_length=40)
    to: Optional[str] = Field(default="", max_length=40)
    place: Optional[str] = Field(default="", max_length=160)
    lane: Optional[str] = Field(default="", max_length=80)
    note: Optional[str] = Field(default="", max_length=1500)
    story: Optional[str] = Field(default="", max_length=6000)


# Who a Story Studio timeline is for (chosen in the Studio); it only steers the tone of AI wording.
StoryOccasion = Literal["keepsake", "gift", "family", "memorial"]


class StoryOverviewRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=160)
    kind: Optional[str] = Field(default="", max_length=80, description="The story type, e.g. 'Couple & wedding'")
    people: List[str] = Field(default_factory=list, max_length=12)
    lanes: List[str] = Field(default_factory=list, max_length=12)
    chapters: List[StoryOverviewChapter] = Field(default_factory=list, max_length=40)
    moments: List[StoryOverviewMoment] = Field(..., min_length=1, max_length=200)
    language: Optional[str] = Field(default="en", max_length=12)
    timeline_id: Optional[str] = Field(default=None, max_length=128, description="Optional active timeline ID (analytics only)")
    content_mode: Optional[ContentModeType] = Field(default="classic")
    api_key: Optional[str] = Field(default=None, max_length=512)
    import_run_id: Optional[str] = Field(default=None, max_length=64, description="Photo import run (cost logging only)")
    occasion: Optional[StoryOccasion] = Field(default=None, description="Who the story is for; sets the tone of the wording")


class StoryOverviewOutput(BaseModel):
    overview: str = Field(description="The overview article in Markdown, in the story's language")


# --- Story Studio photo import -------------------------------------------------------------
PHOTO_DRAFT_MAX_EVENTS = 40          # hard request ceiling (unlimited tier); tiers enforce less
PHOTO_INSTRUCTIONS_MAX_CHARS = 10_000  # unlimited tier; limited tiers enforce less (entitlements)
PHOTO_DRAFT_MAX_IMAGES = 6           # per event, hard ceiling (unlimited tier)
PHOTO_DRAFT_MAX_IMAGE_CHARS = 400_000  # one base64 thumbnail (a 768px JPEG is ~100-200 KB)


class PhotoDraftEvent(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    place: Optional[str] = Field(default="", max_length=200, description="Place name (never raw coordinates)")
    date_text: Optional[str] = Field(default="", max_length=80, description="Human date or range, e.g. '12-15 May 2023'")
    photo_count: int = Field(default=1, ge=1, le=100_000)
    at_home: Optional[bool] = Field(default=None, description="True when the photos were taken near the user's home")
    hint: Optional[str] = Field(default="", max_length=300, description="What the user typed about this event")
    current_title: Optional[str] = Field(default="", max_length=200, description="Title the user already gave, if any")
    people_tagged: List[str] = Field(default_factory=list, max_length=10, description="People the user tagged in these photos (Google Photos / Takeout)")
    needs_place: bool = Field(default=False, description="The photos carry no location: ask the model to recognise the place if it can")
    time_text: Optional[str] = Field(default="", max_length=40, description="Time of day of the first-last photo, e.g. '09:10-18:40'")
    sequence: Optional[str] = Field(default="", max_length=80, description="Where the event sits in the story, e.g. 'day 3 of 12 of a trip'")
    images: List[str] = Field(default_factory=list, max_length=PHOTO_DRAFT_MAX_IMAGES)


PhotoDraftDetail = Literal["brief", "full"]


class PhotoDraftRequest(BaseModel):
    events: List[PhotoDraftEvent] = Field(..., min_length=1, max_length=PHOTO_DRAFT_MAX_EVENTS)
    # "brief": title + one sentence (the manual import's optional button).
    # "full": the AI-first import - caption, a one-paragraph story, cover pick, kind, category,
    # importance and an occasion when the photos clearly show one.
    detail: PhotoDraftDetail = Field(default="brief")
    story_context: Optional[str] = Field(default="", max_length=600, description="What the user said the photos are about (AI-first import)")
    # The user's own instructions for the AI (style, focus, what to leave out). The schema allows
    # the unlimited plan's ceiling; the endpoint enforces the caller's (entitlements).
    instructions: Optional[str] = Field(default="", max_length=PHOTO_INSTRUCTIONS_MAX_CHARS)
    story_kind: Optional[str] = Field(default="", max_length=120)
    story_title: Optional[str] = Field(default="", max_length=200)
    people: List[str] = Field(default_factory=list, max_length=8)
    lang: Optional[str] = Field(default="en", max_length=12)
    timeline_id: Optional[str] = Field(default=None, max_length=128)
    content_mode: Optional[ContentModeType] = Field(default="classic")
    api_key: Optional[str] = Field(default=None, max_length=512)
    import_run_id: Optional[str] = Field(default=None, max_length=64, description="Photo import run (cost logging only)")


PhotoPlaceConfidence = Literal["high", "medium", "low", "none"]


class PhotoDraftItem(BaseModel):
    id: str = Field(description="The event id exactly as given")
    title: str = Field(description="Short event title, 2-7 words")
    description: str = Field(description="One or two sentences describing the event")
    place_guess: Optional[str] = Field(default="", description="Only for events marked 'needs place': the recognised place as 'Place, City, Country', else empty")
    place_confidence: Optional[PhotoPlaceConfidence] = Field(default="none", description="high = a named landmark or readable sign identifies it; medium = strongly suggestive; low = a hunch; none = no guess")


class PhotoDraftOutput(BaseModel):
    drafts: List[PhotoDraftItem]


PhotoEventKind = Literal["moment", "everyday", "screenshot", "document", "other"]


class PhotoDraftFullItem(BaseModel):
    id: str = Field(description="The event id exactly as given")
    title: str = Field(description="Short event title, 2-7 words")
    caption: str = Field(description="One sentence that sums up the moment")
    story: str = Field(description="One paragraph (40-140 words, shorter when the photos show little) about what the photos show")
    place_guess: Optional[str] = Field(default="", description="Only for events marked 'needs place': the recognised place as 'Place, City, Country', else empty")
    place_confidence: Optional[PhotoPlaceConfidence] = Field(default="none", description="high = a named landmark or readable sign identifies it; medium = strongly suggestive; low = a hunch; none = no guess")
    cover_index: int = Field(default=0, description="0-based index of the photo of this event (in the order sent) that makes the best cover")
    kind: PhotoEventKind = Field(default="moment", description="moment = a real-life moment; everyday = routine snaps; screenshot / document = screen captures, receipts, papers; other = not worth a timeline event")
    category: Optional[str] = Field(default="", description="One or two words, e.g. 'Travel', 'Family', 'Food', 'Nature', 'Celebration'")
    importance: int = Field(default=5, description="1-10: how much this moment matters in the story (10 = a highlight)")
    occasion: Optional[str] = Field(default="", description="Only when the photos clearly show it (a cake with candles, a wedding dress, a graduation gown): the occasion in 1-3 words, else empty")


class PhotoDraftFullOutput(BaseModel):
    drafts: List[PhotoDraftFullItem]


# --- Story Studio photo import: the story pass (text only, the whole import at once) -------
PHOTO_STORY_MAX_EVENTS = 600


class PhotoStoryEvent(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    date_text: Optional[str] = Field(default="", max_length=80)
    place: Optional[str] = Field(default="", max_length=200)
    title: Optional[str] = Field(default="", max_length=200)
    caption: Optional[str] = Field(default="", max_length=400)
    story: Optional[str] = Field(default="", max_length=700)
    photo_count: int = Field(default=1, ge=1, le=100_000)
    at_home: Optional[bool] = None
    trip: Optional[str] = Field(default="", max_length=64, description="Id of the trip (run of days away from home) the event belongs to")
    people_tagged: List[str] = Field(default_factory=list, max_length=10)
    occasion: Optional[str] = Field(default="", max_length=60)
    user_titled: bool = Field(default=False, description="The user typed this title: never change it")


class PhotoStoryRequest(BaseModel):
    events: List[PhotoStoryEvent] = Field(..., min_length=1, max_length=PHOTO_STORY_MAX_EVENTS)
    story_context: Optional[str] = Field(default="", max_length=600)
    instructions: Optional[str] = Field(default="", max_length=PHOTO_INSTRUCTIONS_MAX_CHARS)
    people: List[str] = Field(default_factory=list, max_length=8)
    home: Optional[str] = Field(default="", max_length=120, description="The user's home area, when detected")
    # "new": a timeline built from these photos; "add": photos added to an existing story
    # (keep its title and type, only name chapters and tidy titles).
    mode: Literal["new", "add"] = Field(default="new")
    existing_title: Optional[str] = Field(default="", max_length=200)
    lang: Optional[str] = Field(default="en", max_length=12)
    timeline_id: Optional[str] = Field(default=None, max_length=128)
    content_mode: Optional[ContentModeType] = Field(default="classic")
    api_key: Optional[str] = Field(default=None, max_length=512)
    import_run_id: Optional[str] = Field(default=None, max_length=64, description="Photo import run (cost logging only)")


PhotoStoryType = Literal["trip", "child", "couple", "lifeStory", "custom"]


class PhotoImportCostSummaryRequest(BaseModel):
    """Ends a photo import run: the server logs its per-stage and grand total cost."""
    import_run_id: str = Field(..., min_length=1, max_length=64)


class PhotoStoryChapter(BaseModel):
    title: str = Field(description="Chapter name, 1-6 words")
    first_event_id: str = Field(description="Id of the chapter's first event")
    last_event_id: str = Field(description="Id of the chapter's last event")


class PhotoStoryMerge(BaseModel):
    event_ids: List[str] = Field(description="2+ CONSECUTIVE event ids that are really one moment")
    title: Optional[str] = Field(default="", description="Title for the merged moment")
    caption: Optional[str] = Field(default="", description="One sentence for the merged moment")


class PhotoStoryTitle(BaseModel):
    id: str
    title: str


class PhotoStoryOutput(BaseModel):
    timeline_title: str = Field(description="A warm title for the whole timeline, 2-8 words")
    story_type: PhotoStoryType = Field(default="custom")
    subject_names: List[str] = Field(default_factory=list, description="Names from the user's context for the story's people (child's name; the two partners), else empty")
    lane_title: Optional[str] = Field(default="", description="Name of the timeline's single lane, 1-4 words")
    chapters: List[PhotoStoryChapter] = Field(default_factory=list)
    merges: List[PhotoStoryMerge] = Field(default_factory=list)
    titles: List[PhotoStoryTitle] = Field(default_factory=list, description="Only titles you improve")
    highlights: List[str] = Field(default_factory=list, description="Ids of the few moments that matter most")


class PersonalEnrichmentEvent(BaseModel):
    id: str = Field(..., min_length=1, max_length=128)
    title: str = Field(default="", max_length=600)
    text: Optional[str] = Field(default="", max_length=4000, description="Summary and story (trimmed for the model)")
    year: Optional[int] = Field(default=None, ge=-100000, le=3000)
    to_year: Optional[int] = Field(default=None, ge=-100000, le=3000)
    place: Optional[str] = Field(default="", max_length=400)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)
    has_image: bool = False
    place_link: Optional[Dict[str, Any]] = None
    rank: Optional[int] = Field(default=5, ge=1, le=10)


PERSONAL_ENRICHMENT_MAX_EVENTS = 600


class PersonalEnrichmentRequest(BaseModel):
    events: List[PersonalEnrichmentEvent] = Field(..., min_length=1, max_length=PERSONAL_ENRICHMENT_MAX_EVENTS)
    lang: Optional[str] = Field(default="en", max_length=12)
    places: bool = True
    history: bool = True
    images: bool = False
    timeline_id: Optional[str] = Field(default=None, max_length=128)
    content_mode: Optional[ContentModeType] = Field(default="classic")
    api_key: Optional[str] = Field(default=None, max_length=512)


class ReverseGeocodePoint(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class ReverseGeocodeRequest(BaseModel):
    points: List[ReverseGeocodePoint] = Field(..., min_length=1, max_length=50)
    lang: Optional[str] = Field(default=None, max_length=32)


class EventSuggestionRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=150, description="Event name, query, or phrase")
    timeline_id: Optional[str] = Field(default=None, max_length=128, description="Optional active timeline ID, currently unused for quota (kept for future analytics)")
    timeline_topic: Optional[str] = Field(default="", max_length=250, description="Active timeline title or prompt")
    time_scale: Optional[Literal["calendar", "prehistoric"]] = Field(default="calendar")
    lanes: Optional[List[dict]] = Field(default_factory=list, max_length=40)
    api_key: Optional[str] = Field(default=None, max_length=512)
    content_mode: Optional[ContentModeType] = Field(default="classic", description="Audience content mode ('classic' or 'kids')")

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
        description="Chronological milestones (typically 10-50 verified events for topic prompts, or ALL documented events up to 150+ when extracting from a multi-event uploaded document/list; only verified events for 'sparse'; EMPTY for 'unknown')."
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
    model: Optional[str] = Field(default=None, description="AI model used for this turn (e.g. 'gemini-3.8-flash').")
    timeline_id: Optional[str] = Field(default=None, description="Edited timeline id, present with an edit.")
    persisted: Optional[bool] = Field(default=None, description="Whether the edit was saved server-side (edits only).")
    conflict: Optional[bool] = Field(default=None, description="True when the edit was NOT saved because the timeline changed since the snapshot was sent; the client merges and saves it.")


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
    content_mode: Optional[ContentModeType] = Field(
        default=None,
        description="Audience content mode override ('classic' or 'kids')"
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
    image_event_ids: List[str] = Field(
        default_factory=list,
        max_length=120,
        description="Optional list of event IDs that have an image on the client, so the generator can prefer visually illustrated rounds."
    )
    content_mode: Optional[ContentModeType] = Field(
        default=None,
        description="Audience content mode override ('classic' or 'kids')"
    )


class TimelineWhoAmIResponse(BaseModel):
    items: List[WhoAmIItem]
    detected_language: Optional[str] = "en"
    tokenUsage: Optional[Dict[str, Any]] = None


PodcastMusicMood = Literal[
    "sunrise_piano",
    "acoustic_horizon",
    "breezy_jazz",
    "indie_groove",
    "ancient_sands",
    "cinematic_orchestra",
    "modern_tension",
    "cello_elegy",
    "solemn_chorale",
]


class TimelinePodcastOutput(BaseModel):
    """Structured Gemini output for an interactive timeline audio podcast script."""
    episode_title: str = Field(
        description="Compelling, broadcast-style episode title in the timeline's language."
    )
    host1_name: str = Field(
        default="",
        description="Unused; host names are assigned by the server. Leave empty."
    )
    host2_name: Optional[str] = Field(
        default=None,
        description="Unused; host names are assigned by the server. Leave null."
    )
    detected_language: Optional[str] = Field(
        default="en",
        description="2-letter ISO 639-1 language code of the timeline (e.g. 'he', 'en', 'fr', 'es')."
    )
    music_mood: Optional[PodcastMusicMood] = Field(
        default=None,
        description="Background score ID that best matches the timeline's subject matter, era, and emotional arc."
    )
    segments: List[PodcastSegment] = Field(
        ...,
        description="Ordered broadcast chapters: 1 'intro' segment (event_id=null), chronological 'event' segments (each with exact event_id from the timeline), and 1 'outro' segment (event_id=null)."
    )


class TimelinePodcastRequest(BaseModel):
    timeline: TimelineData
    format: Literal["single", "duo"] = Field(
        default="single",
        description="'single' for a solo documentary narrator, or 'duo' for a two-host studio conversation."
    )
    voice_gender: Literal["male", "female"] = Field(
        default="male",
        description="Preferred primary host voice gender ('male' or 'female')."
    )
    length: Literal["focused", "full"] = Field(
        default="full",
        description="'focused' (AI-curated highlights of key turning points) or 'full' (the complete story across the timeline, up to 50 milestones)."
    )
    tts_engine: Optional[Literal["edge", "gcloud", "gemini"]] = Field(
        default=None,
        description="Voice engine to render the episode audio with ('edge' standard — English default, 'gcloud' Google Cloud WaveNet — Hebrew default, 'gemini' premium). Premium falls back to standard when no AI credit is available."
    )
    content_mode: Optional[ContentModeType] = Field(
        default=None,
        description="Audience content mode override ('classic' or 'kids')"
    )


class PodcastAudioRequest(BaseModel):
    engine: Literal["edge", "gcloud", "gemini"] = "edge"
    voice_gender: Optional[Literal["male", "female"]] = None


class PodcastListenReport(BaseModel):
    """Client-side listening analytics for one podcast session (no AI involved)."""
    event: Literal["play_start", "episode_complete", "session_end"]
    timeline_id: Optional[str] = Field(default=None, max_length=120)
    episode_id: Optional[str] = Field(default=None, max_length=120)
    engine: Optional[Literal["edge", "gcloud", "gemini"]] = None
    content_mode: Optional[ContentModeType] = None
    chapters_total: Optional[int] = Field(default=None, ge=0, le=100)
    chapters_completed: Optional[int] = Field(default=None, ge=0, le=100)
    max_chapter_reached: Optional[int] = Field(default=None, ge=0, le=100)
    listened_seconds: Optional[float] = Field(default=None, ge=0, le=6 * 3600)
    episode_seconds: Optional[float] = Field(default=None, ge=0, le=6 * 3600)
    music_enabled: Optional[bool] = None
    music_mood: Optional[str] = Field(default=None, max_length=32)
    time_to_first_audio_ms: Optional[int] = Field(default=None, ge=0, le=600_000)
    buffering_ms: Optional[int] = Field(default=None, ge=0, le=24 * 3600 * 1000)
    fallback_count: Optional[int] = Field(default=None, ge=0, le=100)
    is_shared_view: Optional[bool] = None


