"""Internal (non-model) artifacts persisted between pipeline stages.

All boxes are `box_2d = [ymin, xmin, ymax, xmax]` normalized to 0-1000 of the unit (page/spread/photo),
the same convention Gemini uses for detection output, so parse output, model output and the review UI
share one coordinate system.
"""

from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

UnitKind = Literal["born_digital", "scanned", "ocr_scan", "photo", "docx", "text"]


class TextBlock(BaseModel):
    box_2d: List[int] = Field(default_factory=list)
    text: str
    font_pt: float = 0.0


class EmbeddedImage(BaseModel):
    ref: str  # "P1", "P2", ... (stable within the unit)
    box_2d: List[int]
    native_w: int = 0
    native_h: int = 0
    sha1: str = ""
    angle: float = 0.0  # placement rotation in degrees (counter-clockwise, PDF convention)
    flipped: bool = False
    decoration: Optional[str] = None  # reason when filtered out (repeated|small|strip|background|flat)
    obj_index: int = -1  # position among the page's image objects (for re-extraction)
    visible_uv: Optional[List[float]] = None  # [u0, v0, u1, v1] part shown through the clipping frame


class UnitParse(BaseModel):
    index: int  # 0-based position in book order
    source_id: str
    source_page: int = 0  # 0-based page (PDF) / section (DOCX) / 0 for single images
    kind: UnitKind
    label: str = ""
    width: float = 0.0  # pt for PDF units, px for image units
    height: float = 0.0
    is_spread: bool = False
    char_count: int = 0
    text_blocks: List[TextBlock] = Field(default_factory=list)
    images: List[EmbeddedImage] = Field(default_factory=list)
    caption_candidates: Dict[str, List[int]] = Field(default_factory=dict)  # ref -> text_block indexes
    text: str = ""  # logical-order text for docx/text units (no read stage needed)
    review_key: Optional[str] = None
    thumb_key: Optional[str] = None


class PhotoRecord(BaseModel):
    id: str  # "u0042-p03" (stable across re-runs)
    unit: int
    ref: str
    box_2d: List[int]
    key: Optional[str] = None
    thumb_key: Optional[str] = None
    w: int = 0
    h: int = 0
    dhash: str = ""
    kind: str = "photo"
    caption: Optional[str] = None
    caption_date_text: Optional[str] = None
    people_named: List[str] = Field(default_factory=list)
    description: str = ""
    dup_of: Optional[str] = None


class ChunkPlan(BaseModel):
    id: str
    chapter_id: Optional[str] = None
    units: List[int]
    overlap_units: List[int] = Field(default_factory=list)
