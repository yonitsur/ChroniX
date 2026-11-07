"""Text views of the read results that feed the map and extract stages, plus stable photo ids."""

from __future__ import annotations

import json
from typing import Dict, Iterable, List, Optional, Sequence

from .schemas.artifacts import UnitParse
from .schemas.model_io import BookMapOutput, PageReadOutput, ReadPhoto

REAL_PICTURE_KINDS = {"photo", "document", "artwork", "map", "collage", "infographic", "other"}


def photo_id(unit_index: int, ref: str) -> str:
    return f"u{unit_index:04d}-{ref.lower()}"


def unit_tag(unit: UnitParse, read: Optional[PageReadOutput]) -> str:
    bits = [f"U{unit.index}", unit.label or f"unit {unit.index}"]
    if read is not None:
        if read.printed_page_numbers:
            bits.append("printed " + "–".join(read.printed_page_numbers[:2]))
        bits.append(read.page_type)
        if read.chapter_title:
            bits.append(f"chapter: {read.chapter_title}")
    return "[[" + " | ".join(bits) + "]]"


def real_photos(read: Optional[PageReadOutput]) -> List[ReadPhoto]:
    if read is None:
        return []
    return [p for p in read.photos if p.kind in REAL_PICTURE_KINDS]


def picture_line(unit_index: int, p: ReadPhoto, *, brief: bool = False) -> str:
    parts = [f"[photo {photo_id(unit_index, p.ref)}]", p.kind]
    if p.caption:
        parts.append(f'caption: "{p.caption}"')
    if not brief:
        if p.caption_date_text:
            parts.append(f"date in caption: {p.caption_date_text}")
        if p.people_named:
            parts.append("named: " + ", ".join(p.people_named))
        if p.description:
            parts.append(f"shows: {p.description}")
    return " | ".join(parts)


def unit_text(unit: UnitParse, read: Optional[PageReadOutput], *, brief_pictures: bool = False) -> str:
    """The unit as text: tag line, blocks in reading order (captions listed with their pictures),
    family-tree relations and infographic items."""
    lines: List[str] = [unit_tag(unit, read)]
    if read is None:
        if unit.text:
            lines.append(unit.text.strip())
        return "\n".join(lines)
    for b in read.blocks:
        t = (b.text or "").strip()
        if not t or b.kind == "caption":
            continue
        if b.kind == "heading":
            lines.append(("#" * max(1, min(3, b.heading_level or 1))) + " " + t)
        elif b.kind in ("quote", "poem"):
            lines.append("> " + t.replace("\n", "\n> "))
        else:
            lines.append(t)
    pics = real_photos(read)
    if pics:
        lines.append("PICTURES:")
        lines.extend("- " + picture_line(unit.index, p, brief=brief_pictures) for p in pics)
    if read.tree:
        lines.append("FAMILY TREE (as drawn):")
        for r in read.tree:
            py = f" ({r.person_years})" if r.person_years else ""
            oy = f" ({r.other_years})" if r.other_years else ""
            lines.append(f"- {r.person}{py} {r.relation} {r.other}{oy}")
    if read.infographic:
        lines.append("SUMMARY GRAPHIC:")
        lines.extend(f"- {i.date_text}: {i.label}" for i in read.infographic)
    return "\n".join(lines)


def book_text(units: Sequence[UnitParse], reads: Dict[int, PageReadOutput], *, brief_pictures: bool = True) -> str:
    return "\n\n".join(unit_text(u, reads.get(u.index), brief_pictures=brief_pictures) for u in units)


def map_context(book_map: BookMapOutput, chapter_id: Optional[str]) -> str:
    """Compact JSON of the book map for extract calls. Identical for every chunk (only the chapter
    line differs, and it comes last) so Gemini's implicit prefix cache applies."""
    ctx = {
        "title": book_map.title,
        "language": book_map.language,
        "narrator_perspective": book_map.narrator_perspective,
        "subjects": book_map.subject_person_ids,
        "cast": [
            {k: v for k, v in {
                "id": c.id, "name": c.name, "aliases": c.aliases, "relation": c.relation_to_subjects,
                "born": c.birth_text or c.birth_year, "died": c.death_text or c.death_year,
            }.items() if v not in (None, "", [])}
            for c in book_map.cast
        ],
        "alias_scopes": [a.model_dump() for a in book_map.alias_scopes],
        "chapters": [
            {"id": ch.id, "title": ch.title, "units": f"U{ch.first_unit}-U{ch.last_unit}", "era": ch.era_text, "narrator": ch.narrator}
            for ch in book_map.chapters
        ],
        "lanes": [{"id": l.id, "title": l.title, "rule": l.rule} for l in book_map.lanes],
        "places": [{"id": p.id, "name": p.name, "aliases": p.aliases} for p in book_map.places],
        "anchors": [
            {"fact": a.label, "date": a.date_text, "year": a.year, "people": a.person_ids, "unit": a.unit}
            for a in book_map.anchors
        ],
    }
    text = "BOOK MAP (authoritative for ids):\n" + json.dumps(ctx, ensure_ascii=False, separators=(",", ":"))
    if chapter_id:
        text += f"\n\nTHIS PART BELONGS TO CHAPTER: {chapter_id}"
    return text


def units_by_index(units: Iterable[UnitParse]) -> Dict[int, UnitParse]:
    return {u.index: u for u in units}
