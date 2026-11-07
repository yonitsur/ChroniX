"""Gemini `response_schema` models for every book-import stage.

Conventions:
- Boxes are Gemini-native `box_2d = [ymin, xmin, ymax, xmax]` normalized to 0-1000 of the image sent.
  Lists are plain `List[int]`; length/range is enforced in code after the call (schema validators
  vary between models).
- Evidence / verbatim fields are declared before the structured conclusions so the model writes what
  it saw before it interprets it.
- Flat models, Literal enums, no free-form dicts.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

# ---------------------------------------------------------------- Stage 2: read (one call per unit)

BlockKind = Literal["heading", "paragraph", "caption", "quote", "poem", "recipe", "list", "table", "footnote", "other"]
PhotoKind = Literal["photo", "document", "artwork", "map", "collage", "infographic", "decoration", "logo", "other"]
PageType = Literal[
    "text", "photos", "mixed", "cover", "title", "toc", "chapter_opener", "family_tree",
    "infographic_timeline", "recipe", "poem", "document_scan", "index", "blank", "other",
]


class ReadBlock(BaseModel):
    kind: BlockKind
    text: str = Field(description="Verbatim text in logical reading order, original language, numbers exactly as printed.")
    heading_level: Optional[int] = None


class ReadPhoto(BaseModel):
    ref: str = Field(description="'P<n>' for a marked embedded image; 'N<n>' for a picture region you found yourself.")
    box_2d: Optional[List[int]] = Field(default=None, description="[ymin, xmin, ymax, xmax] 0-1000. Required for N refs.")
    corners: Optional[List[int]] = Field(
        default=None,
        description="Only for a visibly skewed photo in a camera shot of a page: 8 ints y,x for top-left, top-right, bottom-right, bottom-left (0-1000).",
    )
    kind: PhotoKind
    rotation: int = Field(default=0, description="Clockwise degrees (0, 90, 180, 270) needed to make the picture upright.")
    caption: Optional[str] = Field(default=None, description="Verbatim caption belonging to this picture only.")
    caption_shared_with: List[str] = Field(default_factory=list, description="Other refs that share the same caption.")
    caption_date_text: Optional[str] = Field(default=None, description="Any date or year written in the caption, verbatim.")
    people_named: List[str] = Field(default_factory=list, description="People named in the caption, exactly as written.")
    description: str = Field(default="", description="One short factual sentence in the book's language about what the picture shows.")


class TreeRelation(BaseModel):
    person: str
    relation: Literal["parent_of", "spouse_of", "sibling_of"]
    other: str
    person_years: Optional[str] = None
    other_years: Optional[str] = None


class InfographicItem(BaseModel):
    date_text: str
    label: str
    thumb_box_2d: Optional[List[int]] = None


class PageReadOutput(BaseModel):
    page_type: PageType
    printed_page_numbers: List[str] = Field(default_factory=list)
    is_spread: bool = False
    language: str = ""
    chapter_title: Optional[str] = None
    running_header: Optional[str] = None
    blocks: List[ReadBlock] = Field(default_factory=list)
    photos: List[ReadPhoto] = Field(default_factory=list)
    tree: List[TreeRelation] = Field(default_factory=list)
    infographic: List[InfographicItem] = Field(default_factory=list)
    continues_from_previous: bool = False
    continues_on_next: bool = False


# ---------------------------------------------------------------- Stage 3: book map (one call)


class CastMember(BaseModel):
    id: str
    name: str
    name_en: Optional[str] = None
    aliases: List[str] = Field(default_factory=list)
    gender: Literal["female", "male", "unknown"] = "unknown"
    relation_to_subjects: Optional[str] = None
    birth_text: Optional[str] = None
    birth_year: Optional[int] = None
    death_text: Optional[str] = None
    death_year: Optional[int] = None
    importance: int = 5


class AliasScope(BaseModel):
    alias: str
    person_id: str
    chapter_ids: List[str] = Field(default_factory=list, description="Empty = the whole book.")


class MapChapter(BaseModel):
    id: str
    title: str
    first_unit: int
    last_unit: int
    narrator: Optional[str] = None
    focus_person_ids: List[str] = Field(default_factory=list)
    era_text: Optional[str] = None
    include: bool = True
    skip_reason: Optional[str] = None


class MapLane(BaseModel):
    id: str
    title: str
    person_ids: List[str] = Field(default_factory=list)
    rule: str = ""


PlaceKind = Literal["address", "village", "city", "region", "country", "institution", "other"]


class MapPlace(BaseModel):
    id: str
    name: str
    aliases: List[str] = Field(default_factory=list)
    geocode_query: str = Field(description="Modern name + country for a geocoder, e.g. 'Monthey, Switzerland'.")
    kind: PlaceKind = "other"
    lat: Optional[float] = None
    lng: Optional[float] = None


class AnchorFact(BaseModel):
    label: str
    person_ids: List[str] = Field(default_factory=list)
    date_text: str
    year: Optional[int] = None
    month: Optional[int] = None
    day: Optional[int] = None
    unit: int


class SkipUnit(BaseModel):
    unit: int
    reason: str


class BookMapOutput(BaseModel):
    title: str
    subtitle: Optional[str] = None
    description: str
    overview: str
    language: str
    narrator_perspective: str
    subject_person_ids: List[str] = Field(default_factory=list)
    cast: List[CastMember] = Field(default_factory=list)
    alias_scopes: List[AliasScope] = Field(default_factory=list)
    chapters: List[MapChapter] = Field(default_factory=list)
    lanes: List[MapLane] = Field(default_factory=list)
    places: List[MapPlace] = Field(default_factory=list)
    anchors: List[AnchorFact] = Field(default_factory=list)
    skip_units: List[SkipUnit] = Field(default_factory=list)
    instructions_applied: str = ""


# ---------------------------------------------------------------- Stage 4: extract (one call per chunk)

Precision = Literal["day", "month", "season", "year", "decade", "century", "unknown"]
HebMonth = Literal[
    "Tishrei", "Cheshvan", "Kislev", "Tevet", "Shevat", "Adar", "Adar I", "Adar II",
    "Nisan", "Iyar", "Sivan", "Tammuz", "Av", "Elul",
]
DateBasis = Literal["explicit", "hebrew", "caption", "derived", "inferred", "unknown"]
EventCategory = Literal[
    "birth", "death", "marriage", "divorce", "immigration", "move", "education", "work", "military", "war",
    "holocaust", "travel", "celebration", "family", "health", "community", "achievement", "other",
]


class DateParts(BaseModel):
    year: Optional[int] = None
    month: Optional[int] = None
    day: Optional[int] = None
    precision: Precision = "unknown"
    season: Optional[Literal["spring", "summer", "autumn", "winter"]] = None
    circa: bool = False


class HebrewDateParts(BaseModel):
    year: Optional[int] = Field(default=None, description="Hebrew year as a number, e.g. 5704 for תש״ד.")
    month: Optional[HebMonth] = None
    day: Optional[int] = None


class RelativeAge(BaseModel):
    person_id: str
    age_years: int
    approx: bool = True


class Evidence(BaseModel):
    unit: int
    quote: str = Field(description="Verbatim from the transcription, at most 300 characters.")


class PhotoLink(BaseModel):
    photo_id: str
    role: Literal["depicts", "related", "document"]
    confidence: Literal["high", "medium", "low"]


class ExtractedEvent(BaseModel):
    local_id: str
    evidence: List[Evidence] = Field(default_factory=list)
    date_text: str = ""
    title: str
    summary: str = ""
    narrative: str = ""
    start: DateParts = Field(default_factory=DateParts)
    end: Optional[DateParts] = None
    ongoing: bool = False
    hebrew_start: Optional[HebrewDateParts] = None
    relative_age: Optional[RelativeAge] = None
    date_basis: DateBasis = "unknown"
    date_note: Optional[str] = None
    person_ids: List[str] = Field(default_factory=list)
    unresolved_people: List[str] = Field(default_factory=list)
    place_ids: List[str] = Field(default_factory=list)
    place_text: Optional[str] = None
    category: EventCategory = "other"
    lane_id: Optional[str] = None
    importance: int = 5
    photos: List[PhotoLink] = Field(default_factory=list)
    cross_reference: bool = False
    from_infographic: bool = False


class ExtractOutput(BaseModel):
    events: List[ExtractedEvent] = Field(default_factory=list)
    unlinked_photo_ids: List[str] = Field(default_factory=list)


class FastExtractOutput(BaseModel):
    """Fast lane: a light book map and the extraction in one call (small inputs)."""

    title: str
    description: str = ""
    overview: str = ""
    language: str = ""
    cast: List[CastMember] = Field(default_factory=list)
    lanes: List[MapLane] = Field(default_factory=list)
    places: List[MapPlace] = Field(default_factory=list)
    events: List[ExtractedEvent] = Field(default_factory=list)
    unlinked_photo_ids: List[str] = Field(default_factory=list)


# ---------------------------------------------------------------- Stage 5: reconcile helpers


class MergeGroup(BaseModel):
    keep_id: str
    merge_ids: List[str]
    reason: str = ""


class DedupeOutput(BaseModel):
    groups: List[MergeGroup] = Field(default_factory=list)


class PhotoAssignment(BaseModel):
    photo_id: str
    event_id: Optional[str] = None
    confidence: Literal["high", "medium", "low"] = "low"
    reason: str = ""


class PhotoAssignOutput(BaseModel):
    assignments: List[PhotoAssignment] = Field(default_factory=list)
