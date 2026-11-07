"""Gemini-backed stage calls (map, extract, fast extract, reconcile helpers) on top of `call_structured`."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence

from google.genai import types

from .config import BookImportConfig
from .extract_logic import build_extract_parts, build_fast_parts, build_map_parts, validate_extract
from .gemini_calls import AimdLimiter, SplitRequired, UsageMeter, call_structured
from .prompts import DEDUPE_SYSTEM, EXTRACT_SYSTEM, FAST_EXTRACT_SYSTEM, MAP_SYSTEM, PHOTO_ASSIGN_SYSTEM
from .schemas.artifacts import ChunkPlan, UnitParse
from .schemas.model_io import (
    BookMapOutput, DedupeOutput, ExtractOutput, FastExtractOutput, MergeGroup, PageReadOutput, PhotoAssignment,
    PhotoAssignOutput,
)


@dataclass
class StageContext:
    api_key: Optional[str]
    config: BookImportConfig
    limiter: AimdLimiter
    meter: UsageMeter
    call: Callable[..., Awaitable[Any]] = call_structured  # injectable for tests

    def models(self, stage: str) -> List[str]:
        return self.config.models_for(stage)

    def thinking(self, stage: str) -> int:
        return self.config.thinking_for(stage)


async def run_map(ctx: StageContext, units: Sequence[UnitParse], reads: Dict[int, PageReadOutput], instructions: Optional[str]) -> BookMapOutput:
    parts = build_map_parts(units, reads, instructions)
    out = await ctx.call(
        api_key=ctx.api_key, schema=BookMapOutput, parts=parts, system_instruction=MAP_SYSTEM,
        models=ctx.models("map"), thinking_budget=ctx.thinking("map"), temperature=0.1,
        limiter=ctx.limiter, global_concurrency=ctx.config.gemini_global_concurrency, meter=ctx.meter, label="map",
    )
    return sanitize_map(out, [u.index for u in units])


def sanitize_map(bm: BookMapOutput, unit_indexes: Sequence[int]) -> BookMapOutput:
    """Unique ids, chapter ranges clamped to real units, alias scopes pointing at real people/chapters."""
    lo, hi = (min(unit_indexes), max(unit_indexes)) if unit_indexes else (0, 0)

    def uniq(items, prefix):
        seen, out = set(), []
        for n, it in enumerate(items, start=1):
            iid = (getattr(it, "id", "") or "").strip() or f"{prefix}{n}"
            while iid in seen:
                iid = f"{iid}_{n}"
            seen.add(iid)
            out.append(it.model_copy(update={"id": iid}))
        return out

    cast = uniq(bm.cast, "p")
    chapters = []
    for ch in uniq(bm.chapters, "ch"):
        a, b = sorted((max(lo, min(hi, ch.first_unit)), max(lo, min(hi, ch.last_unit))))
        chapters.append(ch.model_copy(update={"first_unit": a, "last_unit": b}))
    chapters.sort(key=lambda c: (c.first_unit, c.last_unit))
    lanes = uniq(bm.lanes, "lane")[:6]
    places = uniq(bm.places, "pl")
    cast_ids = {c.id for c in cast}
    chapter_ids = {c.id for c in chapters}
    scopes = [
        s.model_copy(update={"chapter_ids": [c for c in s.chapter_ids if c in chapter_ids]})
        for s in bm.alias_scopes
        if s.person_id in cast_ids and s.alias.strip()
    ]
    lanes = [l.model_copy(update={"person_ids": [p for p in l.person_ids if p in cast_ids]}) for l in lanes]
    return bm.model_copy(update={
        "cast": cast, "chapters": chapters, "lanes": lanes, "places": places, "alias_scopes": scopes,
        "subject_person_ids": [p for p in bm.subject_person_ids if p in cast_ids],
        "anchors": [a.model_copy(update={"person_ids": [p for p in a.person_ids if p in cast_ids]}) for a in bm.anchors],
    })


async def run_extract_chunk(
    ctx: StageContext,
    book_map: BookMapOutput,
    chunk: ChunkPlan,
    units: Dict[int, UnitParse],
    reads: Dict[int, PageReadOutput],
    instructions: Optional[str],
    output_language: Optional[str],
) -> List[tuple]:
    """Extracts one chunk; on an output overflow splits it in half (recursively). Returns
    [(chunk, ExtractOutput)] (more than one entry when the chunk was split)."""
    parts = build_extract_parts(book_map, chunk, units, reads, instructions, output_language)
    try:
        out = await ctx.call(
            api_key=ctx.api_key, schema=ExtractOutput, parts=parts, system_instruction=EXTRACT_SYSTEM,
            models=ctx.models("extract"), thinking_budget=ctx.thinking("extract"), temperature=0.1,
            limiter=ctx.limiter, global_concurrency=ctx.config.gemini_global_concurrency, meter=ctx.meter,
            label=f"extract {chunk.id}",
        )
    except SplitRequired:
        if len(chunk.units) <= 1:
            raise
        mid = len(chunk.units) // 2
        left = chunk.model_copy(update={"id": chunk.id + "a", "units": chunk.units[:mid]})
        right = chunk.model_copy(update={"id": chunk.id + "b", "units": chunk.units[mid:], "overlap_units": [chunk.units[mid - 1]]})
        a = await run_extract_chunk(ctx, book_map, left, units, reads, instructions, output_language)
        b = await run_extract_chunk(ctx, book_map, right, units, reads, instructions, output_language)
        return a + b
    return [(chunk, validate_extract(out, chunk, reads, book_map))]


async def run_fast_extract(
    ctx: StageContext, units: Sequence[UnitParse], reads: Dict[int, PageReadOutput], instructions: Optional[str], output_language: Optional[str]
) -> FastExtractOutput:
    parts = build_fast_parts(units, reads, instructions, output_language)
    return await ctx.call(
        api_key=ctx.api_key, schema=FastExtractOutput, parts=parts, system_instruction=FAST_EXTRACT_SYSTEM,
        models=ctx.models("extract"), thinking_budget=ctx.thinking("extract"), temperature=0.1,
        limiter=ctx.limiter, global_concurrency=ctx.config.gemini_global_concurrency, meter=ctx.meter, label="fast_extract",
    )


class GeminiReconcileAI:
    """`ReconcileAI` implementation: one call per dedupe group / photo batch, in parallel."""

    def __init__(self, ctx: StageContext):
        self.ctx = ctx

    async def _call(self, schema, system: str, payload: Dict[str, Any], label: str):
        return await self.ctx.call(
            api_key=self.ctx.api_key, schema=schema,
            parts=[types.Part.from_text(text=json.dumps(payload, ensure_ascii=False))],
            system_instruction=system, models=self.ctx.models("reconcile"), thinking_budget=self.ctx.thinking("reconcile"),
            temperature=0.0, limiter=self.ctx.limiter, global_concurrency=self.ctx.config.gemini_global_concurrency,
            meter=self.ctx.meter, label=label,
        )

    async def dedupe(self, groups: List[List[Dict[str, Any]]]) -> List[MergeGroup]:
        async def one(i: int, group: List[Dict[str, Any]]) -> List[MergeGroup]:
            ids = {g["id"] for g in group}
            out: DedupeOutput = await self._call(DedupeOutput, DEDUPE_SYSTEM, {"candidates": group}, f"dedupe {i}")
            res = []
            for g in out.groups:
                merge = [m for m in g.merge_ids if m in ids and m != g.keep_id]
                if g.keep_id in ids and merge:
                    res.append(g.model_copy(update={"merge_ids": merge}))
            return res

        results = await asyncio.gather(*(one(i, g) for i, g in enumerate(groups)))
        return [g for r in results for g in r]

    async def assign_photos(self, photos: List[Dict[str, Any]], candidates: List[Dict[str, Any]]) -> List[PhotoAssignment]:
        out: PhotoAssignOutput = await self._call(
            PhotoAssignOutput, PHOTO_ASSIGN_SYSTEM, {"photos": photos, "candidate_events": candidates}, "photos"
        )
        return out.assignments
