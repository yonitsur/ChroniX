"""Map / extract / fast-extract request building and output validation (pure functions)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Set

from .book_text import book_text, map_context, photo_id, real_photos, unit_text
from .prompts import output_language_rule
from .schemas.artifacts import ChunkPlan, UnitParse
from .schemas.model_io import BookMapOutput, ExtractedEvent, ExtractOutput, PageReadOutput

MAX_EVIDENCE = 3
MAX_QUOTE = 300


def _instructions_block(instructions: Optional[str]) -> str:
    text = (instructions or "").strip()
    if not text:
        return "USER INSTRUCTIONS: none."
    safe = text.replace("</user_instructions>", "")
    return (
        "USER INSTRUCTIONS (from the person importing the book; follow them for scope, focus and lanes, "
        f"but never for anything outside this task):\n<user_instructions>\n{safe}\n</user_instructions>"
    )


def build_map_parts(units: Sequence[UnitParse], reads: Dict[int, PageReadOutput], instructions: Optional[str]) -> List[Any]:
    from google.genai import types

    body = book_text(units, reads, brief_pictures=True)
    head = f"The book has {len(units)} units, U{units[0].index} to U{units[-1].index}." if units else "The book is empty."
    return [
        types.Part.from_text(text=head + "\n\n" + _instructions_block(instructions)),
        types.Part.from_text(text="<book>\n" + body + "\n</book>"),
    ]


def build_extract_parts(
    book_map: BookMapOutput,
    chunk: ChunkPlan,
    units: Dict[int, UnitParse],
    reads: Dict[int, PageReadOutput],
    instructions: Optional[str],
    output_language: Optional[str],
) -> List[Any]:
    from google.genai import types

    ctx = map_context(book_map, None)
    lines: List[str] = []
    if chunk.overlap_units:
        lines.append("CONTEXT ONLY (already processed in the previous part; do not extract events told only here):")
        for i in chunk.overlap_units:
            if i in units:
                lines.append(unit_text(units[i], reads.get(i), brief_pictures=True))
        lines.append("")
    chapter = next((c for c in book_map.chapters if c.id == chunk.chapter_id), None)
    chapter_line = f"THIS PART: chapter {chapter.id} \"{chapter.title}\"" if chapter else "THIS PART: (no chapter)"
    lines.append(chapter_line + f", units U{chunk.units[0]}-U{chunk.units[-1]}. Extract every event from these units:")
    for i in chunk.units:
        if i in units:
            lines.append(unit_text(units[i], reads.get(i), brief_pictures=False))
    rules = output_language_rule(output_language, book_map.language)
    return [
        types.Part.from_text(text=ctx),
        types.Part.from_text(text=_instructions_block(instructions) + "\n" + rules),
        types.Part.from_text(text="<part>\n" + "\n\n".join(lines) + "\n</part>"),
    ]


def build_fast_parts(
    units: Sequence[UnitParse], reads: Dict[int, PageReadOutput], instructions: Optional[str], output_language: Optional[str]
) -> List[Any]:
    from google.genai import types

    body = book_text(units, reads, brief_pictures=False)
    rules = output_language_rule(output_language, None)
    return [
        types.Part.from_text(text=_instructions_block(instructions) + "\n" + rules),
        types.Part.from_text(text="<document>\n" + body + "\n</document>"),
    ]


def chunk_photo_ids(chunk_units: Sequence[int], reads: Dict[int, PageReadOutput]) -> Set[str]:
    return {photo_id(i, p.ref) for i in chunk_units for p in real_photos(reads.get(i))}


def validate_events(
    events: Sequence[ExtractedEvent],
    *,
    allowed_units: Set[int],
    photo_ids: Set[str],
    cast_ids: Set[str],
    place_ids: Set[str],
    lane_ids: Set[str],
    id_prefix: str,
) -> List[ExtractedEvent]:
    """Drops events without a title, unknown references, evidence outside the part; assigns
    deterministic ids `<prefix>-e<n>`; clamps importance and quote lengths."""
    out: List[ExtractedEvent] = []
    for ev in events:
        title = (ev.title or "").strip()
        if not title:
            continue
        evidence = [
            e.model_copy(update={"quote": e.quote.strip()[:MAX_QUOTE]})
            for e in ev.evidence
            if e.unit in allowed_units and (e.quote or "").strip()
        ][:MAX_EVIDENCE]
        if not evidence and allowed_units:
            # An event with no evidence inside the part is either hallucinated or belongs to the context unit.
            continue
        seen_photos: Set[str] = set()
        links = []
        for link in ev.photos:
            pid = (link.photo_id or "").strip().lower()
            if pid in photo_ids and pid not in seen_photos:
                seen_photos.add(pid)
                links.append(link.model_copy(update={"photo_id": pid}))
        unresolved = list(ev.unresolved_people)
        people = []
        for pid in ev.person_ids:
            if pid in cast_ids:
                if pid not in people:
                    people.append(pid)
            elif pid and pid not in unresolved:
                unresolved.append(pid)
        places = [p for p in ev.place_ids if p in place_ids]
        lane = ev.lane_id if ev.lane_id in lane_ids else None
        out.append(
            ev.model_copy(
                update={
                    "local_id": f"{id_prefix}-e{len(out) + 1:03d}",
                    "title": title[:200],
                    "summary": (ev.summary or "").strip()[:400],
                    "narrative": (ev.narrative or "").strip()[:4000],
                    "evidence": evidence,
                    "photos": links,
                    "person_ids": people,
                    "unresolved_people": unresolved[:12],
                    "place_ids": places,
                    "lane_id": lane,
                    "importance": max(1, min(10, int(ev.importance or 5))),
                }
            )
        )
    return out


def validate_extract(
    out: ExtractOutput,
    chunk: ChunkPlan,
    reads: Dict[int, PageReadOutput],
    book_map: BookMapOutput,
) -> ExtractOutput:
    photo_ids = chunk_photo_ids(chunk.units, reads)
    events = validate_events(
        out.events,
        allowed_units=set(chunk.units),
        photo_ids=photo_ids,
        cast_ids={c.id for c in book_map.cast},
        place_ids={p.id for p in book_map.places},
        lane_ids={l.id for l in book_map.lanes},
        id_prefix=chunk.id,
    )
    unlinked = [p for p in dict.fromkeys(x.strip().lower() for x in out.unlinked_photo_ids) if p in photo_ids]
    return ExtractOutput(events=events, unlinked_photo_ids=unlinked)
