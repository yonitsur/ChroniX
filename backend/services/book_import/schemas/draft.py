"""The reviewable draft (stored in `book_imports.draft`, edited through `DraftOp`s).

JSON field names are camelCase because the draft is shared verbatim with the frontend; the same
operations are implemented in `draft_ops.py` and `frontend/src/utils/bookImport/draftModel.js`.
"""

from __future__ import annotations

import re
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

DRAFT_VERSION = 1

EventFlag = Literal[
    "date_inferred", "hebrew_mismatch", "undated", "possible_duplicate", "place_uncertain",
    "low_photo_confidence", "unresolved_people", "photo_album",
]
EVENT_FLAGS = (
    "date_inferred", "hebrew_mismatch", "undated", "possible_duplicate", "place_uncertain",
    "low_photo_confidence", "unresolved_people", "photo_album",
)


class _Model(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class DraftDate(_Model):
    year: int
    month: Optional[int] = None
    day: Optional[int] = None
    precision: Literal["day", "month", "year", "decade", "century"] = "year"


_WIKI_URL_RE = re.compile(r"^https://[a-z0-9-]{2,24}\.wikipedia\.org/wiki/[^\s<>\"']{1,1500}$")


class DraftPlaceWiki(_Model):
    """The place's Wikipedia article (services/place_links.py), shown as "About <place>" in the app."""

    title: str = Field(max_length=400)
    url: str = Field(max_length=2000)
    lang: str = Field(default="en", max_length=24)
    qid: Optional[str] = Field(default=None, max_length=16)
    description: Optional[str] = Field(default=None, max_length=200)


def _wiki_or_none(v: Any) -> Any:
    """A link that is not a plain Wikipedia article URL is dropped, never an error (the draft is
    edited by the client)."""
    if v is None or isinstance(v, DraftPlaceWiki):
        return v
    if not isinstance(v, dict) or not isinstance(v.get("url"), str) or not _WIKI_URL_RE.match(v["url"]):
        return None
    try:
        return DraftPlaceWiki.model_validate(v)
    except Exception:
        return None


class DraftPlace(_Model):
    name: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    source: Literal["nominatim", "model", "user", "none"] = "none"
    wiki: Optional[DraftPlaceWiki] = None

    _clean_wiki = field_validator("wiki", mode="before")(_wiki_or_none)


class DraftSourceRef(_Model):
    sourceId: str
    unit: int
    printedPage: Optional[str] = None
    snippet: str = ""


class DraftEventPhoto(_Model):
    photoId: str
    role: Literal["cover", "gallery"] = "gallery"
    confidence: Literal["high", "medium", "low"] = "medium"


class DraftEvent(_Model):
    id: str
    status: Literal["accepted", "rejected"] = "accepted"
    needsReview: bool = False
    flags: List[str] = Field(default_factory=list)
    title: str
    summary: str = ""
    narrative: str = ""
    dateText: str = ""
    dateBasis: str = "unknown"
    dateNote: Optional[str] = None
    from_: Optional[DraftDate] = Field(default=None, alias="from")
    to: Optional[DraftDate] = None
    isToPresent: bool = False
    circa: bool = False
    people: List[str] = Field(default_factory=list)
    unresolvedPeople: List[str] = Field(default_factory=list)
    placeId: Optional[str] = None
    place: Optional[DraftPlace] = None
    category: str = "other"
    lane: Optional[str] = None
    rank: int = 5
    chapterId: Optional[str] = None
    sourceRefs: List[DraftSourceRef] = Field(default_factory=list)
    photos: List[DraftEventPhoto] = Field(default_factory=list)
    mergedFrom: List[str] = Field(default_factory=list)
    crossReference: bool = False
    fromInfographic: bool = False


class DraftPhoto(_Model):
    id: str
    unit: int
    box2d: List[int] = Field(default_factory=list)
    w: int = 0
    h: int = 0
    kind: str = "photo"
    caption: Optional[str] = None
    captionDate: Optional[str] = None
    peopleNamed: List[str] = Field(default_factory=list)
    description: str = ""
    status: Literal["linked", "tray", "excluded"] = "tray"
    eventId: Optional[str] = None
    suggestedEventId: Optional[str] = None
    confidence: Optional[Literal["high", "medium", "low"]] = None
    dupOf: Optional[str] = None


class DraftLane(_Model):
    id: str
    title: str
    color: Optional[str] = None


class DraftChapter(_Model):
    id: str
    title: str
    firstUnit: int
    lastUnit: int
    include: bool = True
    status: Literal["accepted", "rejected"] = "accepted"
    from_: Optional[DraftDate] = Field(default=None, alias="from")
    to: Optional[DraftDate] = None


class DraftPerson(_Model):
    id: str
    name: str
    aliases: List[str] = Field(default_factory=list)
    relation: Optional[str] = None
    birthYear: Optional[int] = None
    deathYear: Optional[int] = None


class DraftUnit(_Model):
    index: int
    label: str
    printedPages: List[str] = Field(default_factory=list)
    kind: str = "born_digital"
    sourceId: str = ""


class DraftPlaceEntry(_Model):
    id: str
    name: str
    query: str = ""
    lat: Optional[float] = None
    lng: Optional[float] = None
    source: Literal["nominatim", "model", "user", "none"] = "none"
    wiki: Optional[DraftPlaceWiki] = None

    _clean_wiki = field_validator("wiki", mode="before")(_wiki_or_none)


class BookDraft(_Model):
    v: int = DRAFT_VERSION
    importId: str = ""
    title: str = ""
    description: str = ""
    overview: str = ""
    language: str = ""
    instructionsApplied: str = ""
    lanes: List[DraftLane] = Field(default_factory=list)
    chapters: List[DraftChapter] = Field(default_factory=list)
    cast: List[DraftPerson] = Field(default_factory=list)
    units: List[DraftUnit] = Field(default_factory=list)
    places: List[DraftPlaceEntry] = Field(default_factory=list)
    events: List[DraftEvent] = Field(default_factory=list)
    photos: List[DraftPhoto] = Field(default_factory=list)
    stats: dict = Field(default_factory=dict)
    # Set at "Create": put a picture of the place (Wikimedia, marked illustrative) on events without a photo.
    illustrativeImages: bool = False

    def to_json_dict(self) -> dict:
        return self.model_dump(by_alias=True, exclude_none=False)
