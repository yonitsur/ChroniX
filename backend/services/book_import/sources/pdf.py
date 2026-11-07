"""PDF source: page classification, text runs, embedded images, renders and photo extraction (pypdfium2).

pdfium is NOT thread-safe: every function here must run on the single-thread `book` executor
(`services.executors.run_book_cpu`). Coordinates are converted to a top-left origin and then to
`box_2d` (0-1000) so they line up with the model's detection output.

The text layer is a *hint* only: InDesign/RTL exports often store numbers as separate runs, so the
logical order of mixed Hebrew/number lines can't be trusted (the read stage uses the rendered page).
"""

from __future__ import annotations

import ctypes
import hashlib
import math
import statistics
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence, Tuple, Union

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c
from PIL import Image, ImageOps

from ..schemas.artifacts import EmbeddedImage, TextBlock, UnitParse

PathOrBytes = Union[str, bytes]

SCANNED_COVERAGE = 0.85
SCANNED_MAX_CHARS = 20
BACKGROUND_COVERAGE = 0.60
BACKGROUND_MIN_CHARS = 80
MIN_NATIVE_PX = 120
MIN_BOX_PT = 40.0
MAX_STRIP_ASPECT = 6.0
REPEAT_PAGES = 3
CAPTION_FONT_RATIO = 0.75
CAPTION_GAP_PT = 14.0
CAPTION_MIN_OVERLAP = 0.30
SPREAD_ASPECT = 1.25


class PdfRejected(ValueError):
    """The PDF can't be imported (encrypted, unreadable, too many pages)."""


@dataclass
class _Run:
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    size: float
    invisible: bool

    @property
    def h(self) -> float:
        return max(0.1, self.y1 - self.y0)


def open_pdf(src: PathOrBytes, max_pages: Optional[int] = None) -> pdfium.PdfDocument:
    try:
        pdf = pdfium.PdfDocument(src)
    except pdfium.PdfiumError as e:
        msg = str(e).lower()
        if "password" in msg:
            raise PdfRejected("This PDF is password-protected. Please upload an unprotected copy.") from e
        raise PdfRejected("This PDF could not be read. It may be damaged.") from e
    n = len(pdf)
    if n <= 0:
        pdf.close()
        raise PdfRejected("This PDF has no pages.")
    if max_pages is not None and n > max_pages:
        pdf.close()
        raise PdfRejected(f"This PDF has {n} pages; the limit is {max_pages}.")
    return pdf


def to_box_2d(x0: float, y0: float, x1: float, y1: float, width: float, height: float) -> List[int]:
    """Top-left-origin rectangle in page units -> [ymin, xmin, ymax, xmax] in 0-1000."""

    def c(v: float, total: float) -> int:
        return int(round(max(0.0, min(1.0, v / total if total else 0.0)) * 1000))

    return [c(y0, height), c(x0, width), c(y1, height), c(x1, width)]


def _obj_text(obj, textpage) -> str:
    n = pdfium_c.FPDFTextObj_GetText(obj.raw, textpage.raw, None, 0)
    if n <= 2:
        return ""
    buf = ctypes.create_string_buffer(n)
    pdfium_c.FPDFTextObj_GetText(obj.raw, textpage.raw, ctypes.cast(buf, ctypes.POINTER(pdfium_c.FPDF_WCHAR)), n)
    return buf.raw[: n - 2].decode("utf-16-le", errors="ignore")


def _text_runs(page, height: float) -> List[_Run]:
    textpage = page.get_textpage()
    runs: List[_Run] = []
    try:
        for obj in page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_TEXT], max_depth=3):
            text = _obj_text(obj, textpage)
            if not text.strip():
                continue
            size = ctypes.c_float(0)
            pdfium_c.FPDFTextObj_GetFontSize(obj.raw, ctypes.byref(size))
            m = obj.get_matrix()
            scale = math.hypot(m.c, m.d) or 1.0
            eff = float(size.value) * scale
            left, bottom, right, top = obj.get_pos()
            invisible = pdfium_c.FPDFTextObj_GetTextRenderMode(obj.raw) == pdfium_c.FPDF_TEXTRENDERMODE_INVISIBLE
            runs.append(_Run(left, height - top, right, height - bottom, text, round(eff, 2), invisible))
    finally:
        textpage.close()
    return runs


def _is_rtl(text: str) -> bool:
    rtl = sum(1 for ch in text if "֐" <= ch <= "ࣿ" or "יִ" <= ch <= "﷿")
    ltr = sum(1 for ch in text if ch.isalpha() and not ("֐" <= ch <= "ࣿ" or "יִ" <= ch <= "﷿"))
    return rtl > ltr


def _group_lines(runs: Sequence[_Run]) -> List[List[_Run]]:
    lines: List[List[_Run]] = []
    for run in sorted(runs, key=lambda r: ((r.y0 + r.y1) / 2, r.x0)):
        placed = False
        for line in lines[-6:]:
            ref = line[0]
            overlap = min(ref.y1, run.y1) - max(ref.y0, run.y0)
            same_size = abs(ref.size - run.size) <= 0.25 * max(ref.size, run.size, 0.1)
            near = min(abs(run.x0 - max(r.x1 for r in line)), abs(min(r.x0 for r in line) - run.x1)) <= 3 * max(run.size, 1)
            inside = any(r.x0 - 1 <= run.x0 <= r.x1 + 1 for r in line)
            if overlap >= 0.3 * min(ref.h, run.h) and same_size and (near or inside):
                line.append(run)
                placed = True
                break
        if not placed:
            lines.append([run])
    return lines


def _line_text(line: List[_Run]) -> str:
    joined = "".join(r.text for r in line)
    rtl = _is_rtl(joined)
    ordered = sorted(line, key=lambda r: -r.x1 if rtl else r.x0)
    out = ""
    prev: Optional[_Run] = None
    for r in ordered:
        t = r.text if prev is None else r.text
        if not t.strip():
            prev = r
            continue
        if prev is None:
            out = t.strip()
        else:
            gap = (prev.x0 - r.x1) if rtl else (r.x0 - prev.x1)
            tight = gap < 0.15 * max(r.size, prev.size, 1.0)
            sep = "" if tight or out.endswith(" ") or t.startswith(" ") else " "
            out = f"{out}{sep}{t.strip()}"
        prev = r
    return out


def _group_blocks(lines: List[List[_Run]]) -> List[Tuple[float, float, float, float, str, float]]:
    """Merges vertically adjacent lines of similar size into blocks: (x0, y0, x1, y1, text, size)."""
    items = []
    for line in lines:
        x0 = min(r.x0 for r in line)
        x1 = max(r.x1 for r in line)
        y0 = min(r.y0 for r in line)
        y1 = max(r.y1 for r in line)
        size = statistics.median(r.size for r in line)
        items.append([x0, y0, x1, y1, _line_text(line), size])
    items.sort(key=lambda it: (it[1], -it[2]))
    blocks: List[list] = []
    for it in items:
        merged = False
        for b in reversed(blocks[-4:]):
            same_size = abs(b[5] - it[5]) <= 0.15 * max(b[5], it[5], 0.1)
            gap = it[1] - b[3]
            h_overlap = min(b[2], it[2]) - max(b[0], it[0])
            if same_size and -0.5 * it[5] <= gap <= 0.9 * max(it[5], 1) and h_overlap > 0.3 * min(b[2] - b[0], it[2] - it[0]):
                b[0], b[1], b[2], b[3] = min(b[0], it[0]), min(b[1], it[1]), max(b[2], it[2]), max(b[3], it[3])
                b[4] = f"{b[4]}\n{it[4]}"
                merged = True
                break
        if not merged:
            blocks.append(list(it))
    return [tuple(b) for b in blocks]  # type: ignore[misc]


def _placement(matrix) -> Tuple[float, bool]:
    det = matrix.a * matrix.d - matrix.b * matrix.c
    flipped = det < 0
    angle = math.degrees(math.atan2(matrix.b, matrix.a)) if not flipped else math.degrees(math.atan2(-matrix.b, -matrix.a))
    return round(angle, 2), flipped


def _image_objects(page) -> list:
    return list(page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_IMAGE], max_depth=3))


def _clip_bounds(obj) -> Optional[Tuple[float, float, float, float]]:
    """Bounding box (left, bottom, right, top, PDF page space) of an object's clip path, if any.
    InDesign places images in clipping frames, so the image object is often larger than what shows."""
    try:
        clip = pdfium_c.FPDFPageObj_GetClipPath(obj.raw)
    except Exception:
        return None
    if not clip:
        return None
    xs: List[float] = []
    ys: List[float] = []
    for pi in range(max(0, pdfium_c.FPDFClipPath_CountPaths(clip))):
        for si in range(max(0, pdfium_c.FPDFClipPath_CountPathSegments(clip, pi))):
            seg = pdfium_c.FPDFClipPath_GetPathSegment(clip, pi, si)
            if not seg:
                continue
            x, y = ctypes.c_float(), ctypes.c_float()
            if pdfium_c.FPDFPathSegment_GetPoint(seg, ctypes.byref(x), ctypes.byref(y)):
                xs.append(x.value)
                ys.append(y.value)
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def _visible_uv(matrix, left: float, bottom: float, right: float, top: float) -> Optional[List[float]]:
    """Maps a page-space rectangle into the image's unit square (u right, v up) through the inverse
    placement matrix; returns [u0, v0, u1, v1] clamped to 0..1, or None when it covers the whole image."""
    a, b, c, d, e, f = matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f
    det = a * d - b * c
    if abs(det) < 1e-9:
        return None
    us: List[float] = []
    vs: List[float] = []
    for px, py in ((left, bottom), (right, bottom), (right, top), (left, top)):
        dx, dy = px - e, py - f
        us.append((d * dx - c * dy) / det)
        vs.append((-b * dx + a * dy) / det)
    u0, u1 = max(0.0, min(us)), min(1.0, max(us))
    v0, v1 = max(0.0, min(vs)), min(1.0, max(vs))
    if u1 - u0 <= 0.01 or v1 - v0 <= 0.01:
        return None
    if u0 <= 0.005 and v0 <= 0.005 and u1 >= 0.995 and v1 >= 0.995:
        return None
    return [round(u0, 4), round(v0, 4), round(u1, 4), round(v1, 4)]


def _image_sha1(obj) -> str:
    try:
        data = obj.get_data(decode_simple=False)
        return hashlib.sha1(bytes(data)).hexdigest()
    except Exception:
        return ""


def _iou(a: Sequence[int], b: Sequence[int]) -> float:
    iy = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    ix = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = iy * ix
    if inter <= 0:
        return 0.0
    return inter / float((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def parse_page(pdf: pdfium.PdfDocument, index: int, source_id: str, unit_index: int) -> UnitParse:
    """Structural parse of one page (no rendering). Decoration filtering that needs cross-page
    context (repeated images) and pixel statistics happens in `finalize_decorations`."""
    page = pdf[index]
    try:
        width, height = page.get_size()
        runs = _text_runs(page, height)
        visible = [r for r in runs if not r.invisible]
        char_count = sum(len(r.text.strip()) for r in visible)
        invisible_chars = sum(len(r.text.strip()) for r in runs if r.invisible)

        images: List[EmbeddedImage] = []
        page_area = max(1.0, width * height)
        largest = 0.0
        for i, obj in enumerate(_image_objects(page)):
            left, bottom, right, top = obj.get_pos()
            matrix = obj.get_matrix()
            clip = _clip_bounds(obj)
            uv = None
            if clip is not None:
                cl, cb, cr, ct = clip
                left, bottom, right, top = max(left, cl), max(bottom, cb), min(right, cr), min(top, ct)
                if right > left and top > bottom:
                    uv = _visible_uv(matrix, left, bottom, right, top)
            x0, y0, x1, y1 = max(0.0, left), max(0.0, height - top), min(width, right), min(height, height - bottom)
            if x1 <= x0 or y1 <= y0:
                continue
            box = to_box_2d(x0, y0, x1, y1, width, height)
            sha = _image_sha1(obj)
            # Two images stacked on the same spot (an InDesign artifact, or a replaced photo left
            # underneath) show as one picture: the later object is drawn on top, so it wins.
            images = [im for im in images if _iou(im.box_2d, box) <= 0.9]
            try:
                nw, nh = obj.get_size()
            except Exception:
                nw, nh = 0, 0
            angle, flipped = _placement(matrix)
            cover = (x1 - x0) * (y1 - y0) / page_area
            largest = max(largest, cover)
            images.append(
                EmbeddedImage(
                    ref=f"P{len(images) + 1}",
                    box_2d=box,
                    native_w=int(nw),
                    native_h=int(nh),
                    sha1=sha,
                    angle=angle,
                    flipped=flipped,
                    obj_index=i,
                    visible_uv=uv,
                )
            )

        for n, im in enumerate(images, start=1):
            im.ref = f"P{n}"

        if largest >= SCANNED_COVERAGE and char_count < SCANNED_MAX_CHARS:
            kind = "ocr_scan" if invisible_chars >= SCANNED_MAX_CHARS else "scanned"
        else:
            kind = "born_digital"

        blocks_raw = _group_blocks(_group_lines(visible if kind == "born_digital" else runs))
        text_blocks = [
            TextBlock(box_2d=to_box_2d(b[0], b[1], b[2], b[3], width, height), text=b[4], font_pt=round(float(b[5]), 2))
            for b in blocks_raw
            if b[4].strip()
        ]

        unit = UnitParse(
            index=unit_index,
            source_id=source_id,
            source_page=index,
            kind=kind,  # type: ignore[arg-type]
            width=round(width, 2),
            height=round(height, 2),
            is_spread=width / max(height, 1.0) >= SPREAD_ASPECT,
            char_count=char_count,
            text_blocks=text_blocks,
            images=images,
        )
        _mark_static_decorations(unit)
        unit.caption_candidates = caption_candidates(unit)
        return unit
    finally:
        page.close()


def _box_pt(box: Sequence[int], unit: UnitParse) -> Tuple[float, float, float, float]:
    ymin, xmin, ymax, xmax = box
    return xmin / 1000 * unit.width, ymin / 1000 * unit.height, xmax / 1000 * unit.width, ymax / 1000 * unit.height


def _mark_static_decorations(unit: UnitParse) -> None:
    page_area = max(1.0, unit.width * unit.height)
    for img in unit.images:
        if img.decoration:
            continue
        x0, y0, x1, y1 = _box_pt(img.box_2d, unit)
        bw, bh = x1 - x0, y1 - y0
        if (img.native_w and min(img.native_w, img.native_h) < MIN_NATIVE_PX) or min(bw, bh) < MIN_BOX_PT:
            img.decoration = "small"
            continue
        if max(bw, bh) / max(min(bw, bh), 0.1) > MAX_STRIP_ASPECT:
            img.decoration = "strip"
            continue
        if bw * bh / page_area >= BACKGROUND_COVERAGE and unit.kind == "born_digital":
            chars_on_top = 0
            for tb in unit.text_blocks:
                tx0, ty0, tx1, ty1 = _box_pt(tb.box_2d, unit)
                cx, cy = (tx0 + tx1) / 2, (ty0 + ty1) / 2
                if x0 <= cx <= x1 and y0 <= cy <= y1:
                    chars_on_top += len(tb.text)
            if chars_on_top >= BACKGROUND_MIN_CHARS:
                img.decoration = "background"


def body_font_size(units: Iterable[UnitParse]) -> float:
    """Character-weighted median font size: the body text size of the document (0 if no text)."""
    weighted: List[float] = []
    for u in units:
        for tb in u.text_blocks:
            if tb.font_pt > 0:
                weighted.extend([tb.font_pt] * max(1, len(tb.text) // 20))
    return float(statistics.median(weighted)) if weighted else 0.0


def caption_candidates(unit: UnitParse, body_pt: Optional[float] = None) -> dict:
    """Small-font text blocks right above/below an image that overlap it horizontally. Each caption
    goes to its nearest image (captions below a photo are preferred; ties within 1.5pt go to all), so a caption printed between two
    rows of photos is offered to the row it actually belongs to."""
    body = body_pt if body_pt else body_font_size([unit])
    if not body:
        return {}
    limit = body * CAPTION_FONT_RATIO
    photos = [img for img in unit.images if not img.decoration]
    out: dict = {}
    for idx, tb in enumerate(unit.text_blocks):
        text = tb.text.strip()
        if tb.font_pt <= 0 or tb.font_pt > limit or len(text) < 2 or text.replace(" ", "").isdigit():
            continue
        tx0, ty0, tx1, ty1 = _box_pt(tb.box_2d, unit)
        scored = []
        for img in photos:
            ix0, iy0, ix1, iy1 = _box_pt(img.box_2d, unit)
            overlap = min(ix1, tx1) - max(ix0, tx0)
            if overlap < CAPTION_MIN_OVERLAP * min(tx1 - tx0, ix1 - ix0):
                continue
            below = ty0 - iy1
            above = iy0 - ty1
            gap = below if 0 <= below <= CAPTION_GAP_PT else (above + 3.0 if 0 <= above <= CAPTION_GAP_PT else None)
            if gap is not None:
                scored.append((gap, img.ref))
        if not scored:
            continue
        best = min(g for g, _ in scored)
        for g, ref in scored:
            if g <= best + 1.5:
                out.setdefault(ref, []).append(idx)
    return out


def finalize_units(units: Iterable[UnitParse]) -> None:
    """Cross-page rules, run once after every page is parsed:
    - an image (same raw stream) placed on >= REPEAT_PAGES pages is decoration;
    - in a mostly born-digital document, a full-page image page is a born-digital page with one
      big photo/document image (not a scan), so its embedded image is used as-is;
    - caption candidates are recomputed with the document's body font size (photo-only pages
      have no body text of their own)."""
    units = list(units)
    pages_by_sha: dict = {}
    for u in units:
        for img in u.images:
            if img.sha1:
                pages_by_sha.setdefault(img.sha1, set()).add(u.index)
    born = sum(1 for u in units if u.kind == "born_digital")
    mostly_born = born >= 0.5 * max(1, len(units))
    body = body_font_size(units)
    for u in units:
        if mostly_born and u.kind == "scanned":
            u.kind = "born_digital"
        for img in u.images:
            if img.sha1 and not img.decoration and len(pages_by_sha.get(img.sha1, ())) >= REPEAT_PAGES:
                img.decoration = "repeated"
        u.caption_candidates = caption_candidates(u, body)


finalize_decorations = finalize_units  # backwards-compatible name used by early spike scripts


def render_page(pdf: pdfium.PdfDocument, index: int, long_edge_px: int) -> Image.Image:
    page = pdf[index]
    try:
        width, height = page.get_size()
        scale = long_edge_px / max(width, height, 1.0)
        bitmap = page.render(scale=scale, may_draw_forms=True)
        try:
            return bitmap.to_pil().convert("RGB")
        finally:
            bitmap.close()
    finally:
        page.close()


def extract_image(pdf: pdfium.PdfDocument, index: int, img: EmbeddedImage) -> Optional[Image.Image]:
    """Native pixels of an embedded image, oriented as placed (rotations snapped to 90 degree steps;
    small collage tilts are dropped so the photo comes out upright)."""
    page = pdf[index]
    try:
        objs = _image_objects(page)
        if img.obj_index < 0 or img.obj_index >= len(objs):
            return None
        bitmap = objs[img.obj_index].get_bitmap(render=False)
        try:
            pil = bitmap.to_pil()
        finally:
            bitmap.close()
    except Exception:
        return None
    finally:
        page.close()
    if pil.mode != "RGB":
        pil = pil.convert("RGB")
    if img.visible_uv:
        # Keep only what the clipping frame shows (v runs upward; image rows run downward).
        u0, v0, u1, v1 = img.visible_uv
        w, h = pil.size
        box = (int(round(u0 * w)), int(round((1 - v1) * h)), int(round(u1 * w)), int(round((1 - v0) * h)))
        if box[2] - box[0] >= 8 and box[3] - box[1] >= 8:
            pil = pil.crop(box)
    if img.flipped:
        pil = ImageOps.flip(pil)
    snapped = int(round(img.angle / 90.0)) * 90 % 360
    if abs(((img.angle - snapped + 180) % 360) - 180) <= 10 and snapped:
        pil = pil.rotate(snapped, expand=True)
    return pil


def crop_render_region(pdf: pdfium.PdfDocument, index: int, box_2d: Sequence[int], target_long_px: int) -> Image.Image:
    """Renders only the given region of the page (used for flattened graphics and model-found boxes)."""
    page = pdf[index]
    try:
        width, height = page.get_size()
        x0, y0, x1, y1 = (box_2d[1] / 1000 * width, box_2d[0] / 1000 * height, box_2d[3] / 1000 * width, box_2d[2] / 1000 * height)
        region_long = max(x1 - x0, y1 - y0, 1.0)
        scale = max(0.5, min(8.0, target_long_px / region_long))
        crop = (x0, height - y1, width - x1, y0)  # left, bottom, right, top amounts to remove
        bitmap = page.render(scale=scale, crop=crop, may_draw_forms=True)
        try:
            return bitmap.to_pil().convert("RGB")
        finally:
            bitmap.close()
    finally:
        page.close()


def page_label(index: int) -> str:
    return f"PDF p.{index + 1}"
