"""DOCX source: the body in document order (headings, paragraphs, tables, text-box captions, images),
grouped into sections of about 4K characters. Word stores text in logical order, so DOCX units need no
transcription; only sections with pictures get a (vision) read call to describe and caption them."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from ..schemas.artifacts import EmbeddedImage, TextBlock, UnitParse
from .safety import check_docx

SECTION_CHARS = 4000
IMAGE_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/gif", "image/bmp", "image/tiff", "image/webp"}
CAPTION_MAX_CHARS = 220

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
V = "{urn:schemas-microsoft-com:vml}"


@dataclass
class DocxSection:
    blocks: List[TextBlock] = field(default_factory=list)
    images: List[Tuple[str, bytes, str]] = field(default_factory=list)  # (ref, bytes, mime)
    captions: Dict[str, List[int]] = field(default_factory=dict)
    chars: int = 0


def _para_text(p) -> str:
    parts: List[str] = []
    for node in p.iter():
        if node.tag == f"{W}t" and node.text:
            parts.append(node.text)
        elif node.tag in (f"{W}tab",):
            parts.append("\t")
        elif node.tag in (f"{W}br", f"{W}cr"):
            parts.append("\n")
    return "".join(parts).strip()


def _style_name(doc, p) -> str:
    ppr = p.find(f"{W}pPr")
    if ppr is None:
        return ""
    ps = ppr.find(f"{W}pStyle")
    if ps is None:
        return ""
    sid = ps.get(f"{W}val") or ""
    try:
        style = doc.styles.get_by_id(sid, 1)  # WD_STYLE_TYPE.PARAGRAPH == 1
        return (style.name or sid) if style is not None else sid
    except Exception:
        return sid


def _heading_level(style: str) -> Optional[int]:
    m = re.match(r"(?i)^(heading|title|כותרת)\s*(\d)?", style.strip())
    if not m:
        return None
    if m.group(1).lower() == "title":
        return 1
    return int(m.group(2) or 1)


def _image_rids(el) -> List[str]:
    rids = [b.get(f"{R}embed") for b in el.iter(f"{A}blip") if b.get(f"{R}embed")]
    rids += [im.get(f"{R}id") for im in el.iter(f"{V}imagedata") if im.get(f"{R}id")]
    return rids


def parse_docx(data: bytes, source_id: str, first_unit_index: int, section_chars: int = SECTION_CHARS) -> Tuple[List[UnitParse], Dict[str, Tuple[bytes, str]]]:
    """Returns (units, images) where images maps photo key "<unit>:<ref>" -> (bytes, mime)."""
    check_docx(data)
    import docx  # python-docx

    document = docx.Document(io.BytesIO(data))
    rels = document.part.related_parts
    body = document.element.body

    sections: List[DocxSection] = [DocxSection()]
    last_image_ref: Optional[str] = None

    def current() -> DocxSection:
        return sections[-1]

    def new_section() -> None:
        if current().blocks or current().images:
            sections.append(DocxSection())

    for el in body.iterchildren():
        tag = el.tag
        if tag == f"{W}p":
            style = _style_name(document, el)
            level = _heading_level(style)
            text = _para_text(el)
            if level is not None and level <= 2 and current().chars > section_chars * 0.4:
                new_section()
            # text boxes inside the paragraph (often captions)
            box_texts = [
                " ".join(t.text for t in tb.iter(f"{W}t") if t.text).strip()
                for tb in el.iter(f"{W}txbxContent")
            ]
            for rid in _image_rids(el):
                part = rels.get(rid)
                ctype = (getattr(part, "content_type", "") or "").lower()
                if part is None or ctype not in IMAGE_TYPES:
                    continue
                sec = current()
                ref = f"P{len(sec.images) + 1}"
                sec.images.append((ref, part.blob, ctype))
                last_image_ref = ref
            if text:
                sec = current()
                is_caption = "caption" in style.lower() or "כיתוב" in style
                if last_image_ref and (is_caption or len(text) <= CAPTION_MAX_CHARS):
                    sec.captions.setdefault(last_image_ref, []).append(len(sec.blocks))
                prefix = ("#" * level + " ") if level else ""
                sec.blocks.append(TextBlock(text=prefix + text, font_pt=0.0))
                sec.chars += len(text)
                if not _image_rids(el):
                    last_image_ref = None if not is_caption else last_image_ref
            for bt in box_texts:
                if bt:
                    sec = current()
                    if last_image_ref:
                        sec.captions.setdefault(last_image_ref, []).append(len(sec.blocks))
                    sec.blocks.append(TextBlock(text=bt, font_pt=0.0))
                    sec.chars += len(bt)
        elif tag == f"{W}tbl":
            rows = []
            for tr in el.iter(f"{W}tr"):
                cells = [" ".join(t.text for t in tc.iter(f"{W}t") if t.text).strip() for tc in tr.iter(f"{W}tc")]
                if any(cells):
                    rows.append(" | ".join(cells))
            for rid in _image_rids(el):
                part = rels.get(rid)
                ctype = (getattr(part, "content_type", "") or "").lower()
                if part is not None and ctype in IMAGE_TYPES:
                    sec = current()
                    sec.images.append((f"P{len(sec.images) + 1}", part.blob, ctype))
            if rows:
                sec = current()
                text = "\n".join(rows)
                sec.blocks.append(TextBlock(text=text, font_pt=0.0))
                sec.chars += len(text)
            last_image_ref = None
        if current().chars >= section_chars:
            new_section()
            last_image_ref = None

    units: List[UnitParse] = []
    images: Dict[str, Tuple[bytes, str]] = {}
    for sec in sections:
        if not sec.blocks and not sec.images:
            continue
        idx = first_unit_index + len(units)
        u = UnitParse(
            index=idx, source_id=source_id, source_page=len(units), kind="docx",
            label=f"section {len(units) + 1}", char_count=sec.chars, text_blocks=sec.blocks,
            images=[EmbeddedImage(ref=ref, box_2d=[]) for ref, _, _ in sec.images],
            caption_candidates={k: v for k, v in sec.captions.items()},
            text="\n\n".join(b.text for b in sec.blocks),
        )
        units.append(u)
        for ref, blob, ctype in sec.images:
            images[f"{idx}:{ref}"] = (blob, ctype)
    return units, images
