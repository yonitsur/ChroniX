"""Read stage building blocks (pure): request parts for one unit and validation of the model's reading."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

from . import photos as ph
from .prompts import read_user_header
from .schemas.artifacts import UnitParse
from .schemas.model_io import PageReadOutput, ReadPhoto

TEXT_HINT_MAX_CHARS = 6000
N_DUPLICATE_IOU = 0.5


def marks_for(unit: UnitParse) -> List[Tuple[str, List[int]]]:
    return [(img.ref, img.box_2d) for img in unit.images if not img.decoration]


def build_read_parts(unit: UnitParse, render: Image.Image, unit_total: int, *, jpeg_quality: int = 88) -> List[Any]:
    """Header text, the marked render, then the text-layer hint and marked-image metadata."""
    from google.genai import types

    marks = marks_for(unit)
    marked = ph.draw_marks(render, marks) if marks else render.convert("RGB")
    image_bytes = ph.encode_jpeg(marked, max(marked.size), quality=jpeg_quality)

    lines: List[str] = [read_user_header(unit.index + 1, unit_total, unit.kind, unit.label or f"unit {unit.index + 1}", unit.is_spread)]
    parts: List[Any] = [types.Part.from_text(text=lines[0]), types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")]

    meta: List[str] = []
    if marks:
        meta.append("MARKED IMAGES (magenta outlines):")
        by_ref = {img.ref: img for img in unit.images}
        for ref, box in marks:
            img = by_ref[ref]
            caps = [unit.text_blocks[i].text.replace("\n", " ")[:160] for i in unit.caption_candidates.get(ref, []) if i < len(unit.text_blocks)]
            cap_txt = f" | nearby small text: {' || '.join(caps)}" if caps else ""
            meta.append(f"- {ref} box={box} native={img.native_w}x{img.native_h}{cap_txt}")
    else:
        meta.append("MARKED IMAGES: none. Find every real picture yourself (N refs with box_2d).")

    hint = "\n".join(tb.text for tb in unit.text_blocks).strip()
    if hint:
        if len(hint) > TEXT_HINT_MAX_CHARS:
            hint = hint[:TEXT_HINT_MAX_CHARS] + " …"
        meta.append(
            "TEXT LAYER HINT (from the PDF; may be scrambled for right-to-left/number runs; spelling hint only):\n"
            f"<text_layer>\n{hint}\n</text_layer>"
        )
    parts.append(types.Part.from_text(text="\n".join(meta)))
    return parts


def validate_read_output(out: PageReadOutput, unit: UnitParse) -> PageReadOutput:
    """Drops unknown/duplicate refs, clamps boxes, removes N boxes that duplicate a marked image, and
    adds a placeholder for any marked image the model forgot (so every P ref has an entry)."""
    known = {img.ref: img for img in unit.images if not img.decoration}
    seen: set = set()
    photos: List[ReadPhoto] = []
    n_counter = 0
    for p in out.photos:
        ref = (p.ref or "").strip().upper()
        if ref.startswith("P"):
            if ref not in known or ref in seen:
                continue
            box = ph.clamp_box(p.box_2d) or known[ref].box_2d
            p = p.model_copy(update={"ref": ref, "box_2d": box})
        else:
            box = ph.clamp_box(p.box_2d)
            if box is None:
                continue
            if any(ph.box_iou(box, img.box_2d) > N_DUPLICATE_IOU for img in known.values()):
                continue
            if any(q.box_2d and ph.box_iou(box, q.box_2d) > N_DUPLICATE_IOU for q in photos if q.ref.startswith("N")):
                continue
            n_counter += 1
            ref = f"N{n_counter}"
            p = p.model_copy(update={"ref": ref, "box_2d": box})
        if p.corners is not None and len(p.corners) != 8:
            p = p.model_copy(update={"corners": None})
        if p.rotation not in (0, 90, 180, 270):
            p = p.model_copy(update={"rotation": 0})
        seen.add(ref)
        photos.append(p)
    for ref, img in known.items():
        if ref not in seen:
            photos.append(ReadPhoto(ref=ref, box_2d=img.box_2d, kind="photo"))
    out = out.model_copy(update={"photos": photos})
    return out


def read_summary(out: PageReadOutput) -> Dict[str, Any]:
    return {
        "page_type": out.page_type,
        "pages": out.printed_page_numbers,
        "blocks": len(out.blocks),
        "chars": sum(len(b.text) for b in out.blocks),
        "photos": len([p for p in out.photos if p.kind not in ("decoration", "logo")]),
        "captions": len([p for p in out.photos if p.caption]),
    }
