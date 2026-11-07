"""The book-import stages on top of the store. Each stage is idempotent: it lists what is already
checkpointed under the import's prefix and only does the missing work, so a resumed import (after a
deploy, crash or pause) never repeats a finished unit/chunk.

Object layout under `b/<owner-hash>/<import-id>/`:
  sources/<sid>.<ext>            uploaded originals (deleted after finalize)
  parse/units.json               [UnitParse]   parse/photos.json  {photo_id: [w, h]} (embedded photos)
  units/NNNN.review.webp         1200 px review render      units/NNNN.thumb.webp  360 px thumb
  units/NNNN.work.jpg            normalized page image of a scan/phone photo (crops are cut from it)
  read/NNNN.json                 {"read": PageReadOutput, "photo_sizes": {...}} (model-found photos)
  photos/<pid>.webp / .thumb.webp
  map.json  extract/<chunk>.json  reconcile/geocode.json  reconcile/place_links.json  finalize.json
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence, Tuple

from PIL import Image

from . import photos as ph
from .ai_calls import GeminiReconcileAI, StageContext, run_extract_chunk, run_fast_extract, run_map
from .book_text import photo_id, real_photos, unit_text
from .chunking import plan_chunks
from .config import BookImportConfig
from .extract_logic import validate_events
from .prompts import READ_SYSTEM
from .read_logic import build_read_parts, validate_read_output
from .reconcile import ReconcileInputs, reconcile
from .schemas.artifacts import ChunkPlan, UnitParse
from .schemas.draft import BookDraft
from .schemas.model_io import (
    BookMapOutput, ExtractOutput, FastExtractOutput, MapChapter, PageReadOutput, ReadBlock, ReadPhoto,
)
from .sources import images as imgsrc
from .sources import pdf as pdfsrc
from .sources import text as textsrc
from .sources.safety import SourceRejected, sniff_kind
from .store import BookImportStore, import_prefix

logger = logging.getLogger("ChroniXBookImport")

THUMB_PX = 360
PHOTO_THUMB_PX = 320
READ_IMAGE_PX_PHOTO = 3000
N_CROP_PX = 2048
DOCX_IMAGE_PX = 1600


class ImportFailed(Exception):
    """A non-retryable problem with the input (unreadable file, nothing to import)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ImportCancelled(Exception):
    pass


class Paths:
    def __init__(self, prefix: str):
        self.prefix = prefix

    def source(self, sid: str, ext: str) -> str:
        return f"{self.prefix}/sources/{sid}{ext}"

    units_json = property(lambda self: f"{self.prefix}/parse/units.json")
    parse_photos = property(lambda self: f"{self.prefix}/parse/photos.json")
    map_json = property(lambda self: f"{self.prefix}/map.json")
    geocode_json = property(lambda self: f"{self.prefix}/reconcile/geocode.json")
    place_links_json = property(lambda self: f"{self.prefix}/reconcile/place_links.json")
    enrich_json = property(lambda self: f"{self.prefix}/finalize_enrich.json")
    finalize_json = property(lambda self: f"{self.prefix}/finalize.json")

    def review(self, i: int) -> str:
        return f"{self.prefix}/units/{i:04d}.review.webp"

    def thumb(self, i: int) -> str:
        return f"{self.prefix}/units/{i:04d}.thumb.webp"

    def work(self, i: int) -> str:
        return f"{self.prefix}/units/{i:04d}.work.jpg"

    def read(self, i: int) -> str:
        return f"{self.prefix}/read/{i:04d}.json"

    def photo(self, pid: str) -> str:
        return f"{self.prefix}/photos/{pid}.webp"

    def photo_thumb(self, pid: str) -> str:
        return f"{self.prefix}/photos/{pid}.thumb.webp"

    def extract(self, chunk_id: str) -> str:
        return f"{self.prefix}/extract/{chunk_id}.json"


SOURCE_EXT = {"pdf": ".pdf", "docx": ".docx", "image": ".img", "text": ".txt"}


def source_key(prefix: str, src: Dict[str, Any]) -> str:
    return Paths(prefix).source(src["id"], SOURCE_EXT.get(src.get("kind") or "", ".bin"))


@dataclass
class Host:
    """What the pipeline needs from the web app (kept out of the package so a worker can provide it)."""

    persist_timeline: Callable[[Dict[str, Any], Dict[str, Any]], Awaitable[Dict[str, Any]]]
    photo_quota_remaining: Callable[[Dict[str, Any]], Awaitable[Optional[int]]]
    change_photo_count: Callable[[str, int], Awaitable[int]]
    put_hosted_photo: Callable[[str, bytes], Awaitable[str]]  # (user_id, webp bytes) -> public URL
    geocode_enabled: bool = True
    # Wikipedia links for the geocoded places (needs geocoding: matches are checked against its points).
    place_links_enabled: bool = True
    # Historical links (one AI pass over the accepted events) and illustrative pictures at "Create".
    enrichment_enabled: bool = True


@dataclass
class ImportCtx:
    row: Dict[str, Any]
    store: BookImportStore
    owner: str
    config: BookImportConfig
    stage: StageContext
    host: Host
    cancel: asyncio.Event = field(default_factory=asyncio.Event)
    progress: Dict[str, Dict[str, int]] = field(default_factory=dict)
    cache_dir: Optional[Path] = None

    @property
    def import_id(self) -> str:
        return self.row["id"]

    @property
    def user_id(self) -> str:
        return self.row["user_id"]

    @property
    def paths(self) -> Paths:
        return Paths(import_prefix(self.user_id, self.import_id))

    def check(self) -> None:
        if self.cancel.is_set():
            raise ImportCancelled()

    def tick(self, stage: str, done: Optional[int] = None, total: Optional[int] = None, inc: int = 0) -> None:
        p = self.progress.setdefault(stage, {"done": 0, "total": 0})
        if total is not None:
            p["total"] = total
        if done is not None:
            p["done"] = done
        p["done"] += inc

    def cache(self) -> Path:
        if self.cache_dir is None:
            base = Path(os.getenv("BOOK_IMPORT_CACHE_DIR") or tempfile.gettempdir()) / "chronix-book"
            self.cache_dir = base / self.import_id
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        return self.cache_dir


# ============================================================================== pdf thread helpers

_PDF_DOCS: Dict[str, Any] = {}
_PDF_LOCK = threading.Lock()


def _pdf(path: str):
    """The open PdfDocument for a cached source (only ever touched from the single book thread)."""
    with _PDF_LOCK:
        doc = _PDF_DOCS.get(path)
        if doc is None:
            doc = pdfsrc.open_pdf(path)
            _PDF_DOCS[path] = doc
        return doc


def close_pdf(path: str) -> None:
    with _PDF_LOCK:
        doc = _PDF_DOCS.pop(path, None)
    if doc is not None:
        try:
            doc.close()
        except Exception:
            pass


def _sync_parse_pdf(path: str, source_id: str, first_index: int, max_pages: int) -> List[UnitParse]:
    doc = pdfsrc.open_pdf(path, max_pages=max_pages)
    try:
        units = [pdfsrc.parse_page(doc, i, source_id, first_index + i) for i in range(len(doc))]
    finally:
        doc.close()
    pdfsrc.finalize_units(units)
    return units


def _sync_page_assets(path: str, unit: UnitParse, review_px: int) -> Tuple[bytes, bytes, Dict[str, Tuple[bytes, bytes, int, int]], List[str]]:
    """Review render + thumb and every non-decoration embedded photo of one page."""
    doc = _pdf(path)
    render = pdfsrc.render_page(doc, unit.source_page, review_px)
    review = ph.encode_webp(render, review_px, quality=80)
    thumb = ph.encode_webp(render, THUMB_PX, quality=72)
    photos: Dict[str, Tuple[bytes, bytes, int, int]] = {}
    flat: List[str] = []
    for img in unit.images:
        if img.decoration:
            continue
        pil = pdfsrc.extract_image(doc, unit.source_page, img)
        if pil is None:
            continue
        if ph.is_near_flat(pil):
            flat.append(img.ref)
            continue
        pil = ph.fit_long_edge(pil, 2048)
        photos[photo_id(unit.index, img.ref)] = (
            ph.encode_webp(pil, 2048), ph.encode_webp(pil, PHOTO_THUMB_PX, quality=72), pil.size[0], pil.size[1],
        )
    return review, thumb, photos, flat


def _sync_render(path: str, page: int, px: int) -> Image.Image:
    return pdfsrc.render_page(_pdf(path), page, px)


def _sync_crop(path: str, page: int, box: Sequence[int], px: int) -> Image.Image:
    return pdfsrc.crop_render_region(_pdf(path), page, box, px)


async def _book_cpu(fn, *args):
    from services.executors import run_book_cpu

    return await run_book_cpu(fn, *args)


async def _cpu(fn, *args):
    from services.executors import run_cpu

    return await run_cpu(fn, *args)


# ============================================================================== helpers


async def _cached_source(ctx: ImportCtx, src: Dict[str, Any]) -> Path:
    """The uploaded original as a local file (downloaded once per process)."""
    ext = SOURCE_EXT.get(src.get("kind") or "", ".bin")
    local = ctx.cache() / f"{src['id']}{ext}"
    if local.is_file() and local.stat().st_size > 0:
        return local
    # Streamed to disk: a 200 MB upload must never be held in memory whole (512 MB instances).
    if not await ctx.store.download_to(source_key(import_prefix(ctx.user_id, ctx.import_id), src), local):
        raise ImportFailed("source_missing", f"The file {src.get('name') or src['id']} is missing from storage.")
    return local


async def load_units(ctx: ImportCtx) -> List[UnitParse]:
    data = await ctx.store.get_json(ctx.paths.units_json)
    if not data:
        raise ImportFailed("parse_missing", "The parsed pages are missing; the import must be restarted.")
    return [UnitParse.model_validate(u) for u in data]


async def load_reads(ctx: ImportCtx, units: Sequence[UnitParse]) -> Tuple[Dict[int, PageReadOutput], Dict[str, Tuple[int, int]]]:
    """Read results (model reads + synthesized reads for text-only units) and photo sizes."""
    sizes: Dict[str, Tuple[int, int]] = {k: tuple(v) for k, v in (await ctx.store.get_json(ctx.paths.parse_photos) or {}).items()}  # type: ignore[misc]
    keys = set(await ctx.store.list_keys(f"{ctx.paths.prefix}/read"))
    reads: Dict[int, PageReadOutput] = {}

    async def one(u: UnitParse) -> None:
        key = ctx.paths.read(u.index)
        if key in keys:
            data = await ctx.store.get_json(key) or {}
            if data.get("read"):
                reads[u.index] = PageReadOutput.model_validate(data["read"])
                for k, v in (data.get("photo_sizes") or {}).items():
                    sizes[k] = tuple(v)  # type: ignore[assignment]
                return
        if not needs_read(u):
            reads[u.index] = synthesized_read(u)

    sem = asyncio.Semaphore(16)

    async def guarded(u: UnitParse) -> None:
        async with sem:
            await one(u)

    await asyncio.gather(*(guarded(u) for u in units))
    return reads, sizes


def needs_read(u: UnitParse) -> bool:
    if u.kind == "text":
        return False
    if u.kind == "docx":
        return bool(u.images)
    return True


def synthesized_read(u: UnitParse) -> PageReadOutput:
    blocks = []
    for tb in u.text_blocks or []:
        t = tb.text.strip()
        if not t:
            continue
        if t.startswith("#"):
            level = len(t) - len(t.lstrip("#"))
            blocks.append(ReadBlock(kind="heading", text=t.lstrip("#").strip(), heading_level=min(3, level)))
        else:
            blocks.append(ReadBlock(kind="paragraph", text=t))
    if not blocks and u.text:
        blocks = [ReadBlock(kind="paragraph", text=p.strip()) for p in u.text.split("\n\n") if p.strip()]
    return PageReadOutput(page_type="text", blocks=blocks)


async def _put_photo_files(ctx: ImportCtx, pid: str, pil: Image.Image) -> Tuple[int, int]:
    pil = ph.fit_long_edge(pil.convert("RGB"), 2048)
    full, thumb = await _cpu(lambda: (ph.encode_webp(pil, 2048), ph.encode_webp(pil, PHOTO_THUMB_PX, quality=72)))
    await ctx.store.put(ctx.paths.photo(pid), full, "image/webp")
    await ctx.store.put(ctx.paths.photo_thumb(pid), thumb, "image/webp")
    return pil.size


# ============================================================================== stage: parse


async def stage_parse(ctx: ImportCtx) -> None:
    cfg = ctx.config
    sources = sorted(ctx.row.get("sources") or [], key=lambda s: (s.get("order", 0), s.get("id")))
    if not sources:
        raise ImportFailed("no_sources", "Nothing was uploaded.")
    multi = len(sources) > 1
    units: List[UnitParse] = []
    photo_sizes: Dict[str, List[int]] = {}
    pdf_sources = [s for s in sources if s.get("kind") == "pdf"]
    pdf_total_hint = 0
    ctx.tick("parse", done=0, total=len(sources))

    for src in sources:
        ctx.check()
        kind = src.get("kind")
        local = await _cached_source(ctx, src)
        with open(local, "rb") as fh:
            head = fh.read(4096)
        sniffed = sniff_kind(head)
        if kind == "text":
            sniffed = "text" if sniffed in ("text", None) else sniffed
        if sniffed != kind:
            raise ImportFailed("bad_file", f"{src.get('name') or 'A file'} isn't what its name says (expected {kind}).")
        name = src.get("name") or ""
        if kind == "pdf":
            try:
                parsed = await _book_cpu(_sync_parse_pdf, str(local), src["id"], len(units), cfg.max_units - len(units))
            except pdfsrc.PdfRejected as e:
                raise ImportFailed("bad_pdf", f"{name}: {e}")
            pdf_total_hint += len(parsed)
            for u in parsed:
                u.label = f"{name} p.{u.source_page + 1}" if multi else f"p.{u.source_page + 1}"
                review, thumb, photos, flat = await _book_cpu(_sync_page_assets, str(local), u, cfg.render_review_px)
                await ctx.store.put(ctx.paths.review(u.index), review, "image/webp")
                await ctx.store.put(ctx.paths.thumb(u.index), thumb, "image/webp")
                for img in u.images:
                    if img.ref in flat:
                        img.decoration = "flat"
                for pid, (full, th, w, h) in photos.items():
                    await ctx.store.put(ctx.paths.photo(pid), full, "image/webp")
                    await ctx.store.put(ctx.paths.photo_thumb(pid), th, "image/webp")
                    photo_sizes[pid] = [w, h]
                units.append(u)
                ctx.check()
        elif kind == "image":
            data = local.read_bytes()
            try:
                page = await _cpu(imgsrc.load_page_image, data)
            except Exception as e:
                raise ImportFailed("bad_image", f"{name}: this image can't be read ({e}).")
            idx = len(units)
            u = UnitParse(index=idx, source_id=src["id"], kind="photo", label=name or f"photo {idx + 1}",
                          width=page.size[0], height=page.size[1], is_spread=page.size[0] / max(1, page.size[1]) >= 1.25)
            work = await _cpu(lambda: ph.encode_jpeg(page, imgsrc.WORKING_MAX_PX, quality=90))
            await ctx.store.put(ctx.paths.work(idx), work, "image/jpeg")
            review = await _cpu(lambda: ph.encode_webp(page, cfg.render_review_px, quality=80))
            thumb = await _cpu(lambda: ph.encode_webp(page, THUMB_PX, quality=72))
            await ctx.store.put(ctx.paths.review(idx), review, "image/webp")
            await ctx.store.put(ctx.paths.thumb(idx), thumb, "image/webp")
            units.append(u)
        elif kind == "docx":
            from .sources.docx import parse_docx

            try:
                parsed, images = await _cpu(parse_docx, local.read_bytes(), src["id"], len(units))
            except SourceRejected as e:
                raise ImportFailed("bad_docx", f"{name}: {e}")
            except Exception as e:
                raise ImportFailed("bad_docx", f"{name}: this Word file can't be read ({e}).")
            for u in parsed:
                u.label = f"{name} §{u.source_page + 1}" if multi else f"§{u.source_page + 1}"
                for img in list(u.images):
                    blob, _ = images.get(f"{u.index}:{img.ref}", (None, None))
                    pil = None
                    if blob:
                        try:
                            from services.image_safety import open_image_checked

                            pil = open_image_checked(blob, max_pixels=40_000_000, max_side=12000, formats=("JPEG", "PNG", "WEBP", "GIF", "BMP", "TIFF"))
                            pil.load()
                            pil = ph.exif_upright(pil).convert("RGB")
                        except Exception:
                            pil = None
                    if pil is None or min(pil.size) < 80 or ph.is_near_flat(pil):
                        img.decoration = "small" if pil is not None else "unreadable"
                        continue
                    img.native_w, img.native_h = pil.size
                    pid = photo_id(u.index, img.ref)
                    photo_sizes[pid] = list(await _put_photo_files(ctx, pid, pil))
                units.append(u)
        elif kind == "text":
            text = textsrc.decode_text(local.read_bytes())
            for n, section in enumerate(textsrc.split_sections(text)):
                idx = len(units)
                label = (f"{name} §{n + 1}" if multi and name else f"§{n + 1}") if not src.get("pasted") else f"text §{n + 1}"
                units.append(UnitParse(index=idx, source_id=src["id"], source_page=n, kind="text", label=label,
                                       char_count=len(section), text=section,
                                       text_blocks=[{"text": p, "font_pt": 0.0} for p in section.split("\n\n") if p.strip()]))
        else:
            raise ImportFailed("bad_file", f"{name}: unsupported file type.")
        if len(units) > cfg.max_units:
            raise ImportFailed("too_many_pages", f"This import has more than {cfg.max_units} pages.")
        ctx.tick("parse", inc=1)

    for s in pdf_sources:
        close_pdf(str(ctx.cache() / f"{s['id']}.pdf"))
    if not units:
        raise ImportFailed("empty", "No pages or text were found in the upload.")
    await ctx.store.put_json(ctx.paths.units_json, [u.model_dump() for u in units])
    await ctx.store.put_json(ctx.paths.parse_photos, photo_sizes)

    chars = sum(u.char_count or len(u.text or "") for u in units)
    photo_count = len(photo_sizes) + sum(1 for u in units if u.kind in ("photo", "scanned", "ocr_scan"))
    fast = (
        len(units) <= cfg.fast_lane_max_units and chars <= cfg.fast_lane_max_chars and photo_count <= cfg.fast_lane_max_photos
    )
    ctx.row["lane"] = "fast" if fast else "full"
    ctx.row["progress"] = {**(ctx.row.get("progress") or {}), "units": len(units), "chars": chars, "photos": photo_count}
    await ctx.store.update(ctx.import_id, {"lane": ctx.row["lane"], "progress": ctx.row["progress"]}, owner=ctx.owner)


# ============================================================================== stage: read


async def _read_image(ctx: ImportCtx, u: UnitParse, src: Dict[str, Any]) -> Image.Image:
    if u.kind == "photo":
        data = await ctx.store.get_bytes(ctx.paths.work(u.index))
        if data is None:
            raise ImportFailed("parse_missing", "A page image is missing; the import must be restarted.")
        img = Image.open(io.BytesIO(data)).convert("RGB")
        return ph.fit_long_edge(img, READ_IMAGE_PX_PHOTO)
    local = await _cached_source(ctx, src)
    px = ctx.config.render_spread_px if u.is_spread else ctx.config.render_page_px
    return await _book_cpu(_sync_render, str(local), u.source_page, px)


def _docx_read_parts(u: UnitParse, pictures: List[Tuple[str, bytes]], unit_total: int) -> List[Any]:
    from google.genai import types

    from .prompts import read_user_header

    parts: List[Any] = [types.Part.from_text(text=read_user_header(u.index + 1, unit_total, "docx", u.label, False) +
                                             " Its text is given below; describe and caption each picture.")]
    for ref, jpeg in pictures:
        parts.append(types.Part.from_text(text=f"Picture {ref}:"))
        parts.append(types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"))
    caps = []
    for ref, idxs in (u.caption_candidates or {}).items():
        texts = [u.text_blocks[i].text for i in idxs if i < len(u.text_blocks)]
        if texts:
            caps.append(f"- {ref}: nearby text: {' || '.join(texts)}")
    body = (u.text or "")[:12000]
    parts.append(types.Part.from_text(text=(
        "Return one `photos` entry per picture (ref P1, P2, ...). Copy the document text into `blocks` only as"
        " short paragraphs if needed; the text is already known.\n"
        + ("CAPTION CANDIDATES:\n" + "\n".join(caps) + "\n" if caps else "")
        + f"<section_text>\n{body}\n</section_text>"
    )))
    return parts


async def _read_unit(ctx: ImportCtx, u: UnitParse, sources: Dict[str, Dict[str, Any]], unit_total: int) -> None:
    ctx.check()
    src = sources.get(u.source_id, {})
    sc = ctx.stage
    n_sizes: Dict[str, List[int]] = {}
    if u.kind == "docx":
        pictures: List[Tuple[str, bytes]] = []
        for img in u.images:
            if img.decoration:
                continue
            data = await ctx.store.get_bytes(ctx.paths.photo(photo_id(u.index, img.ref)))
            if data:
                pil = Image.open(io.BytesIO(data)).convert("RGB")
                pictures.append((img.ref, ph.encode_jpeg(pil, DOCX_IMAGE_PX, quality=85)))
        if not pictures:
            read = synthesized_read(u)
        else:
            out = await sc.call(
                api_key=sc.api_key, schema=PageReadOutput, parts=_docx_read_parts(u, pictures, unit_total),
                system_instruction=READ_SYSTEM, models=sc.models("read"), thinking_budget=sc.thinking("read"),
                temperature=0.0, limiter=sc.limiter, global_concurrency=ctx.config.gemini_global_concurrency,
                meter=sc.meter, label=f"read u{u.index}",
            )
            known = {img.ref for img in u.images if not img.decoration}
            photos = []
            for p in out.photos:
                ref = (p.ref or "").upper()
                if ref in known and ref not in {q.ref for q in photos}:
                    photos.append(p.model_copy(update={"ref": ref, "box_2d": None}))
            for ref in known - {p.ref for p in photos}:
                photos.append(ReadPhoto(ref=ref, kind="photo"))
            base = synthesized_read(u)
            read = base.model_copy(update={"photos": photos, "page_type": "mixed" if photos else "text"})
    else:
        image = await _read_image(ctx, u, src)
        parts = build_read_parts(u, image, unit_total)
        # Drop the full-size render (~20 MB raw for a 3000 px spread) before the slow model call:
        # up to 2x gemini_concurrency reads wait on Gemini at once, and holding every page's
        # pixels while they wait ran a 512 MB instance out of memory. Only the JPEG stays.
        image.close()
        del image
        out = await sc.call(
            api_key=sc.api_key, schema=PageReadOutput, parts=parts, system_instruction=READ_SYSTEM,
            models=sc.models("read"), thinking_budget=sc.thinking("read"), temperature=0.0,
            media_resolution="MEDIA_RESOLUTION_HIGH", limiter=sc.limiter,
            global_concurrency=ctx.config.gemini_global_concurrency, meter=sc.meter, label=f"read u{u.index}",
        )
        read = validate_read_output(out, u)
        # Materialize model-found pictures (scans, phone photos, photos baked into graphics).
        work: Optional[Image.Image] = None
        for p in read.photos:
            if not p.ref.startswith("N") or p.kind in ("decoration", "logo") or not p.box_2d:
                continue
            pid = photo_id(u.index, p.ref)
            try:
                if u.kind == "photo":
                    if work is None:
                        data = await ctx.store.get_bytes(ctx.paths.work(u.index))
                        work = Image.open(io.BytesIO(data)).convert("RGB") if data else None
                    if work is None:
                        continue
                    crop = ph.perspective_fix(work, p.corners) if p.corners else None
                    if crop is None:
                        crop = ph.crop_box(work, p.box_2d)
                else:
                    local = await _cached_source(ctx, src)
                    crop = await _book_cpu(_sync_crop, str(local), u.source_page, p.box_2d, N_CROP_PX)
                crop = ph.trim_uniform_border(crop)
                crop = ph.rotate_upright(crop, p.rotation)
                if min(crop.size) < 48:
                    continue
                n_sizes[pid] = list(await _put_photo_files(ctx, pid, crop))
            except Exception as e:  # one bad crop never fails the page
                logger.warning(f"[book_import:{ctx.import_id}] crop {pid} failed: {e}")
        # Embedded photos the model says need turning.
        for p in read.photos:
            if p.ref.startswith("P") and p.rotation in (90, 180, 270):
                pid = photo_id(u.index, p.ref)
                data = await ctx.store.get_bytes(ctx.paths.photo(pid))
                if data:
                    pil = ph.rotate_upright(Image.open(io.BytesIO(data)).convert("RGB"), p.rotation)
                    n_sizes[pid] = list(await _put_photo_files(ctx, pid, pil))
    await ctx.store.put_json(ctx.paths.read(u.index), {"read": read.model_dump(), "photo_sizes": n_sizes})
    ctx.tick("read", inc=1)


async def stage_read(ctx: ImportCtx) -> None:
    units = await load_units(ctx)
    sources = {s["id"]: s for s in ctx.row.get("sources") or []}
    done = set(await ctx.store.list_keys(f"{ctx.paths.prefix}/read"))
    todo = [u for u in units if needs_read(u) and ctx.paths.read(u.index) not in done]
    total = sum(1 for u in units if needs_read(u))
    ctx.tick("read", done=total - len(todo), total=total)
    # Bounds pages held in memory: the limiter runs gemini_concurrency calls, plus 2 rendered ahead.
    sem = asyncio.Semaphore(max(2, ctx.config.gemini_concurrency + 2))

    async def guarded(u: UnitParse) -> None:
        async with sem:
            await _read_unit(ctx, u, sources, len(units))

    try:
        await asyncio.gather(*(guarded(u) for u in todo))
    finally:
        for s in sources.values():
            if s.get("kind") == "pdf":
                await _book_cpu(close_pdf, str(ctx.cache() / f"{s['id']}.pdf"))


# ============================================================================== stage: map / extract


async def stage_map(ctx: ImportCtx) -> None:
    if await ctx.store.size_of(ctx.paths.map_json):
        return
    units = await load_units(ctx)
    reads, _ = await load_reads(ctx, units)
    ctx.tick("map", done=0, total=1)
    book_map = await run_map(ctx.stage, units, reads, ctx.row.get("instructions"))
    await ctx.store.put_json(ctx.paths.map_json, book_map.model_dump())
    ctx.tick("map", done=1)


async def _load_map(ctx: ImportCtx) -> BookMapOutput:
    data = await ctx.store.get_json(ctx.paths.map_json)
    if not data:
        raise ImportFailed("map_missing", "The book map is missing.")
    return BookMapOutput.model_validate(data)


def _plan(units: Sequence[UnitParse], reads: Dict[int, PageReadOutput], book_map: BookMapOutput) -> List[ChunkPlan]:
    chars = {u.index: len(unit_text(u, reads.get(u.index))) for u in units}
    return plan_chunks(book_map, [u.index for u in units], lambda i: chars.get(i, 0), skip={s.unit for s in book_map.skip_units})


async def stage_extract(ctx: ImportCtx) -> None:
    units = await load_units(ctx)
    reads, _ = await load_reads(ctx, units)
    book_map = await _load_map(ctx)
    chunks = _plan(units, reads, book_map)
    done = set(await ctx.store.list_keys(f"{ctx.paths.prefix}/extract"))
    todo = [c for c in chunks if ctx.paths.extract(c.id) not in done]
    ctx.tick("extract", done=len(chunks) - len(todo), total=len(chunks))
    by_index = {u.index: u for u in units}

    async def one(chunk: ChunkPlan) -> None:
        ctx.check()
        res = await run_extract_chunk(ctx.stage, book_map, chunk, by_index, reads, ctx.row.get("instructions"), ctx.row.get("output_language"))
        await ctx.store.put_json(ctx.paths.extract(chunk.id), [{"chunk": c.model_dump(), "out": o.model_dump()} for c, o in res])
        ctx.tick("extract", inc=1)

    await asyncio.gather(*(one(c) for c in todo))


async def stage_fast_extract(ctx: ImportCtx) -> None:
    if await ctx.store.size_of(ctx.paths.extract("c000")):
        return
    units = await load_units(ctx)
    reads, _ = await load_reads(ctx, units)
    ctx.tick("extract", done=0, total=1)
    out: FastExtractOutput = await run_fast_extract(ctx.stage, units, reads, ctx.row.get("instructions"), ctx.row.get("output_language"))
    from .ai_calls import sanitize_map

    indexes = [u.index for u in units]
    book_map = sanitize_map(BookMapOutput(
        title=out.title or "", description=out.description, overview=out.overview, language=out.language,
        narrator_perspective="", cast=out.cast, lanes=out.lanes, places=out.places,
        chapters=[MapChapter(id="ch1", title=out.title or "", first_unit=min(indexes), last_unit=max(indexes))],
    ), indexes)
    chunk = ChunkPlan(id="c000", chapter_id="ch1", units=indexes)
    photo_ids = {photo_id(i, p.ref) for i in indexes for p in real_photos(reads.get(i))}
    events = validate_events(
        out.events, allowed_units=set(indexes), photo_ids=photo_ids, cast_ids={c.id for c in book_map.cast},
        place_ids={p.id for p in book_map.places}, lane_ids={l.id for l in book_map.lanes}, id_prefix="c000",
    )
    unlinked = [p for p in dict.fromkeys(x.lower() for x in out.unlinked_photo_ids) if p in photo_ids]
    await ctx.store.put_json(ctx.paths.map_json, book_map.model_dump())
    await ctx.store.put_json(ctx.paths.extract("c000"), [{"chunk": chunk.model_dump(), "out": ExtractOutput(events=events, unlinked_photo_ids=unlinked).model_dump()}])
    ctx.tick("extract", done=1)


# ============================================================================== stage: reconcile


async def stage_reconcile(ctx: ImportCtx) -> None:
    units = await load_units(ctx)
    reads, sizes = await load_reads(ctx, units)
    book_map = await _load_map(ctx)
    extracts: List[Tuple[ChunkPlan, ExtractOutput]] = []
    for key in await ctx.store.list_keys(f"{ctx.paths.prefix}/extract"):
        for item in await ctx.store.get_json(key) or []:
            extracts.append((ChunkPlan.model_validate(item["chunk"]), ExtractOutput.model_validate(item["out"])))
    extracts.sort(key=lambda pair: pair[0].units[0] if pair[0].units else 0)
    ctx.tick("reconcile", done=0, total=3)

    coords = await ctx.store.get_json(ctx.paths.geocode_json)
    if coords is None and ctx.host.geocode_enabled and book_map.places:
        from .geocode import geocode_places

        coords = await geocode_places(book_map.places, cancelled=ctx.cancel.is_set)
        await ctx.store.put_json(ctx.paths.geocode_json, {k: list(v) for k, v in coords.items()})
    place_links = await _place_links(ctx, book_map, coords or {})
    ctx.tick("reconcile", done=1)
    try:
        from services.gemini_service import DEFAULT_LANE_PALETTE as palette
    except Exception:  # pragma: no cover
        palette = []
    draft = await reconcile(
        ReconcileInputs(
            import_id=ctx.import_id, book_map=book_map, units=units, reads=reads, extracts=extracts,
            photo_sizes={k: (int(v[0]), int(v[1])) for k, v in sizes.items()},
            place_coords={k: (v[0], v[1], v[2]) for k, v in (coords or {}).items()},
            lane_colors=list(palette),
            place_links=place_links,
        ),
        GeminiReconcileAI(ctx.stage),
    )
    ctx.tick("reconcile", done=3)
    ctx.row["draft"] = draft.to_json_dict()
    ctx.row["draft_rev"] = 1
    await ctx.store.update(ctx.import_id, {"draft": ctx.row["draft"], "draft_rev": 1}, owner=ctx.owner)


async def _place_links(ctx: ImportCtx, book_map: BookMapOutput, coords: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """{place_id: Wikipedia link}, checkpointed like the geocoding. Never fails the import."""
    if not (ctx.host.geocode_enabled and ctx.host.place_links_enabled and book_map.places):
        return {}
    if os.getenv("PLACE_LINKS_ENABLED", "1").strip().lower() in ("0", "false", "no", "off"):
        return {}
    cached = await ctx.store.get_json(ctx.paths.place_links_json)
    if isinstance(cached, dict):
        return cached
    from services.place_links import PlaceQuery, resolve_place_links

    queries = []
    for p in book_map.places:
        c = coords.get(p.id) or []
        lat, lng, source = (c[0], c[1], c[2]) if len(c) >= 3 else (None, None, "none")
        head = (p.geocode_query or "").split(",")[0].strip()
        queries.append(PlaceQuery(
            key=p.id, name=p.name, lat=lat, lng=lng, kind=p.kind,
            qid=c[3] if len(c) >= 4 else None,
            alt_names=[n for n in [head, *p.aliases] if n and n != p.name][:4],
            verified=source == "nominatim",
        ))
    out_lang = ctx.row.get("output_language")
    lang = out_lang if out_lang and out_lang != "auto" else book_map.language
    try:
        links = await resolve_place_links(queries, lang, names_lang=book_map.language)
    except Exception:  # pragma: no cover - resolve_place_links already swallows its errors
        logger.warning("[book_import] place links failed", exc_info=True)
        return {}
    logger.info(f"[book_import] place links: {len(links)}/{len(queries)} places linked")
    await ctx.store.put_json(ctx.paths.place_links_json, links)
    return links


# ============================================================================== stage: finalize


async def _enrich_timeline(ctx: ImportCtx, timeline: Dict[str, Any], draft: BookDraft) -> Dict[str, Any]:
    """Historical links, place links still missing and (when asked) illustrative pictures, on the
    accepted events only. Checkpointed; never fails the import."""
    if not ctx.host.enrichment_enabled or os.getenv("PERSONAL_ENRICHMENT_ENABLED", "1").strip().lower() in ("0", "false", "no", "off"):
        return timeline
    from services.personal_enrichment import (
        EnrichmentResult, apply_to_article, enrich_personal_events, events_from_articles, structured_history_ask,
    )

    cached = await ctx.store.get_json(ctx.paths.enrich_json)
    if not isinstance(cached, dict):
        sc = ctx.stage
        ask = structured_history_ask(
            api_key=sc.api_key, models=sc.models("history_links"), call=sc.call, meter=sc.meter, limiter=sc.limiter,
        )
        out_lang = ctx.row.get("output_language")
        lang = out_lang if out_lang and out_lang != "auto" else (draft.language or timeline.get("detectedLanguage"))
        res = await enrich_personal_events(
            events_from_articles(timeline.get("articles") or []), lang,
            places=ctx.host.geocode_enabled, history=ask, images=bool(draft.illustrativeImages),
        )
        cached = {"links": res.links, "images": res.images, "stats": res.stats}
        logger.info(f"[book_import:{ctx.import_id}] enrichment: {res.stats}")
        await ctx.store.put_json(ctx.paths.enrich_json, cached)
    res = EnrichmentResult(links=cached.get("links") or {}, images=cached.get("images") or {}, stats=cached.get("stats") or {})
    timeline["articles"] = [apply_to_article(dict(a), res) for a in timeline.get("articles") or []]
    return timeline


async def stage_finalize(ctx: ImportCtx) -> None:
    from .timeline_build import draft_to_timeline, photos_to_promote

    row = await ctx.store.get(ctx.import_id)
    draft = BookDraft.model_validate((row or {}).get("draft") or {})
    wanted = photos_to_promote(draft)
    state = await ctx.store.get_json(ctx.paths.finalize_json) or {"urls": {}, "reserved": 0}
    urls: Dict[str, str] = dict(state.get("urls") or {})
    remaining = [pid for pid in wanted if pid not in urls]
    ctx.tick("finalize", done=len(wanted) - len(remaining), total=len(wanted) + 1)

    user = ctx.row.get("user_snapshot") or {"id": ctx.user_id}
    reserve = len(remaining) - int(state.get("reserved") or 0)
    if reserve > 0:
        quota = await ctx.host.photo_quota_remaining(user)
        if quota is not None and quota < reserve:
            raise ImportFailed("photo_quota", f"Not enough photo storage: {reserve} photos needed, {quota} left.")
        await ctx.host.change_photo_count(ctx.user_id, reserve)
        state["reserved"] = int(state.get("reserved") or 0) + reserve
        await ctx.store.put_json(ctx.paths.finalize_json, {"urls": urls, "reserved": state["reserved"]})

    since_flush = 0
    sem = asyncio.Semaphore(8)

    async def promote(pid: str) -> None:
        nonlocal since_flush
        async with sem:
            ctx.check()
            data = await ctx.store.get_bytes(ctx.paths.photo(pid))
            if data is None:
                return
            urls[pid] = await ctx.host.put_hosted_photo(ctx.user_id, data)
            ctx.tick("finalize", inc=1)
            since_flush += 1
            if since_flush >= 20:
                since_flush = 0
                await ctx.store.put_json(ctx.paths.finalize_json, {"urls": urls, "reserved": state["reserved"]})

    await asyncio.gather(*(promote(pid) for pid in remaining))
    used = len(urls)
    await ctx.store.put_json(ctx.paths.finalize_json, {"urls": urls, "reserved": state["reserved"]})

    timeline = draft_to_timeline(draft, urls, import_id=ctx.import_id)
    timeline = await _enrich_timeline(ctx, timeline, draft)
    saved = await ctx.host.persist_timeline(timeline, user)
    ctx.row["timeline_id"] = saved.get("id") or timeline["id"]
    unused = int(state["reserved"]) - (used - (len(wanted) - len(remaining)))
    if unused > 0:
        try:
            await ctx.host.change_photo_count(ctx.user_id, -unused)
        except Exception:
            logger.warning(f"[book_import:{ctx.import_id}] could not release {unused} photo slots")
    ctx.tick("finalize", done=ctx.progress["finalize"]["total"])
    await ctx.store.update(ctx.import_id, {"timeline_id": ctx.row["timeline_id"]}, owner=ctx.owner)
    # The originals and working files are no longer needed; the draft row stays until expiry.
    for sub in ("sources", "units", "read", "parse", "extract", "reconcile", "photos"):
        try:
            await ctx.store.delete_prefix(f"{ctx.paths.prefix}/{sub}")
        except Exception as e:
            logger.warning(f"[book_import:{ctx.import_id}] cleanup of {sub} failed: {e}")


STAGES = {
    "parse": stage_parse,
    "read": stage_read,
    "map": stage_map,
    "extract": stage_extract,
    "fast_extract": stage_fast_extract,
    "reconcile": stage_reconcile,
    "finalize": stage_finalize,
}
FULL_LANE = ("parse", "read", "map", "extract", "reconcile")
FAST_LANE = ("parse", "read", "fast_extract", "reconcile")


def plan_for(row: Dict[str, Any]) -> Tuple[str, ...]:
    if row.get("status") == "finalizing":
        return ("finalize",)
    return FAST_LANE if row.get("lane") == "fast" else FULL_LANE
