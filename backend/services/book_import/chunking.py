"""Deterministic extraction chunks from the book map's chapters (the model never decides chunk sizes)."""

from __future__ import annotations

from typing import Callable, Dict, List, Optional, Sequence, Set

from .schemas.artifacts import ChunkPlan
from .schemas.model_io import BookMapOutput

MAX_UNITS = 12
MAX_CHARS = 30_000


def plan_chunks(
    book_map: BookMapOutput,
    unit_indexes: Sequence[int],
    unit_chars: Callable[[int], int],
    *,
    skip: Optional[Set[int]] = None,
    max_units: int = MAX_UNITS,
    max_chars: int = MAX_CHARS,
) -> List[ChunkPlan]:
    """Splits every included chapter into chunks of <= max_units units / <= max_chars characters.
    Units the map left out of every chapter are chunked on their own (nothing is silently dropped);
    excluded chapters and skip units are left out. Each chunk carries the previous unit as read-only
    context (`overlap_units`) so a story running across a boundary is understood."""
    skip = set(skip or ())
    valid = sorted(set(int(i) for i in unit_indexes))
    valid_set = set(valid)
    covered: Set[int] = set()
    excluded: Set[int] = set()
    ranges: List[tuple] = []  # (chapter_id, [units])

    for ch in book_map.chapters:
        lo, hi = min(ch.first_unit, ch.last_unit), max(ch.first_unit, ch.last_unit)
        members = [i for i in valid if lo <= i <= hi and i not in covered]
        covered.update(members)
        if not ch.include:
            excluded.update(members)
            continue
        members = [i for i in members if i not in skip]
        if members:
            ranges.append((ch.id, members))

    orphans = [i for i in valid if i not in covered and i not in skip]
    if orphans:
        run: List[int] = []
        for i in orphans:
            if run and i != run[-1] + 1:
                ranges.append((None, run))
                run = []
            run.append(i)
        if run:
            ranges.append((None, run))

    ranges.sort(key=lambda r: r[1][0])
    chunks: List[ChunkPlan] = []
    for chapter_id, members in ranges:
        current: List[int] = []
        chars = 0
        for i in members:
            c = max(0, int(unit_chars(i)))
            if current and (len(current) >= max_units or chars + c > max_chars):
                chunks.append(_chunk(len(chunks), chapter_id, current, valid_set, excluded))
                current, chars = [], 0
            current.append(i)
            chars += c
        if current:
            chunks.append(_chunk(len(chunks), chapter_id, current, valid_set, excluded))
    return chunks


def _chunk(n: int, chapter_id: Optional[str], members: List[int], valid: Set[int], excluded: Set[int]) -> ChunkPlan:
    prev = members[0] - 1
    overlap = [prev] if prev in valid and prev not in excluded else []
    return ChunkPlan(id=f"c{n:03d}", chapter_id=chapter_id, units=list(members), overlap_units=overlap)


def chapter_of(book_map: BookMapOutput) -> Dict[int, str]:
    out: Dict[int, str] = {}
    for ch in book_map.chapters:
        for i in range(min(ch.first_unit, ch.last_unit), max(ch.first_unit, ch.last_unit) + 1):
            out.setdefault(i, ch.id)
    return out
