"""Phase 0: run the read stage (real Gemini) on selected PDF pages and score what can be scored.

Modes:
  born     - the real page: embedded photos are marked (P refs), text-layer hint included.
  scan     - synthetic scan: page rendered to an image, no marks, no text layer. Ground-truth photo boxes
             are the embedded image boxes -> detection recall/precision at IoU thresholds.
  photo    - synthetic phone photo: the scan, rotated a few degrees on a darker "table", blurred,
             lit unevenly, JPEG q70; ground-truth boxes transformed accordingly.

Usage:
  python scripts/book_import_spike/run_read.py ../yoni/singer_family_book.pdf --pages 12,16,49 \
      --mode born --model gemini-3.8-flash --px 3000
Outputs: backend/data/book_eval/read/<run>/ (inputs, raw JSON, report.json).
"""

import argparse
import asyncio
import json
import math
import os
import random
import sys
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BACKEND_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_DIR))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND_DIR / ".env")

from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

from services.book_import import photos as ph  # noqa: E402
from services.book_import.gemini_calls import AimdLimiter, UsageMeter, call_structured  # noqa: E402
from services.book_import.prompts import READ_SYSTEM  # noqa: E402
from services.book_import.read_logic import build_read_parts, read_summary, validate_read_output  # noqa: E402
from services.book_import.schemas.artifacts import UnitParse  # noqa: E402
from services.book_import.schemas.model_io import PageReadOutput  # noqa: E402
from services.book_import.sources import pdf as pdfsrc  # noqa: E402


def synthetic_photo(img: Image.Image, boxes, seed: int):
    """Rotate the page by a few degrees onto a larger table, add blur/lighting/JPEG artifacts."""
    rnd = random.Random(seed)
    angle = rnd.uniform(-4, 4)
    w, h = img.size
    margin = int(0.08 * max(w, h))
    table = Image.new("RGB", (w + 2 * margin, h + 2 * margin), (rnd.randint(60, 110),) * 3)
    table.paste(img, (margin, margin))
    rot = table.rotate(angle, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=(80, 80, 80))
    W, H = rot.size
    cx, cy = W / 2, H / 2
    a = math.radians(angle)

    def tf(x, y):
        # PIL rotates counter-clockwise for positive angles (image coordinates, y down)
        dx, dy = x - cx, y - cy
        return cx + dx * math.cos(a) + dy * math.sin(a), cy - dx * math.sin(a) + dy * math.cos(a)

    new_boxes = []
    for b in boxes:
        x0, y0, x1, y1 = ph.box_to_pixels(b, w, h)
        pts = [tf(x + margin, y + margin) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        new_boxes.append([round(min(ys) / H * 1000), round(min(xs) / W * 1000), round(max(ys) / H * 1000), round(max(xs) / W * 1000)])
    grad = Image.linear_gradient("L").resize((W, H)).rotate(rnd.uniform(0, 360))
    dark = Image.new("RGB", (W, H), (0, 0, 0))
    rot = Image.composite(rot, Image.blend(rot, dark, 0.35), grad)
    rot = rot.filter(ImageFilter.GaussianBlur(radius=1.2))
    import io

    buf = io.BytesIO()
    rot.save(buf, format="JPEG", quality=70)
    return Image.open(io.BytesIO(buf.getvalue())).convert("RGB"), new_boxes


def match_boxes(gt, pred, thr):
    used, hits, ious = set(), 0, []
    for g in gt:
        best, best_j = 0.0, -1
        for j, p in enumerate(pred):
            if j in used:
                continue
            iou = ph.box_iou(g, p)
            if iou > best:
                best, best_j = iou, j
        if best_j >= 0 and best >= thr:
            used.add(best_j)
            hits += 1
            ious.append(best)
    return hits, ious


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--pages", required=True)
    ap.add_argument("--mode", choices=["born", "scan", "photo"], default="born")
    ap.add_argument("--model", default="gemini-3.8-flash")
    ap.add_argument("--px", type=int, default=3000)
    ap.add_argument("--thinking", type=int, default=0)
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--media-resolution", default="MEDIA_RESOLUTION_HIGH")
    ap.add_argument("--tag", default="")
    args = ap.parse_args()

    pages = [int(p) for p in args.pages.split(",") if p.strip()]
    run = f"{time.strftime('%Y%m%d-%H%M%S')}-{args.mode}-{args.model}-{args.px}{('-' + args.tag) if args.tag else ''}"
    out = BACKEND_DIR / "data" / "book_eval" / "read" / run
    out.mkdir(parents=True, exist_ok=True)

    doc = pdfsrc.open_pdf(args.pdf, max_pages=5000)
    all_units = [pdfsrc.parse_page(doc, i, "s0", i) for i in range(len(doc))]
    pdfsrc.finalize_units(all_units)

    jobs = []
    for p in pages:
        unit = all_units[p - 1]
        unit.label = f"PDF p.{p}"
        render = pdfsrc.render_page(doc, p - 1, args.px)
        gt = [img.box_2d for img in unit.images if not img.decoration]
        if args.mode == "born":
            send_unit = unit
            image = render
        else:
            image = render
            if args.mode == "photo":
                image, gt = synthetic_photo(render, gt, seed=p)
            send_unit = UnitParse(index=unit.index, source_id="s0", kind="scanned" if args.mode == "scan" else "photo",
                                  label=unit.label, width=image.size[0], height=image.size[1], is_spread=unit.is_spread)
        image.save(out / f"p{p:03d}_input.jpg", quality=85)
        jobs.append((p, send_unit, image, gt))

    limiter = AimdLimiter(args.concurrency)
    ledger = out / "usage.jsonl"

    def sink(entry):  # every model call, written as it happens (survives crashes)
        with ledger.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    meter = UsageMeter(sink=sink, stage="read")

    async def one(p, unit, image, gt):
        t0 = time.time()
        parts = build_read_parts(unit, image, len(all_units))
        res = await call_structured(
            api_key=os.environ.get("GEMINI_API_KEY"), schema=PageReadOutput, parts=parts, system_instruction=READ_SYSTEM,
            models=[args.model], thinking_budget=args.thinking, media_resolution=args.media_resolution,
            limiter=limiter, meter=meter, label=f"read p{p}", temperature=0.0,
        )
        res = validate_read_output(res, unit)
        dt = time.time() - t0
        (out / f"p{p:03d}_read.json").write_text(res.model_dump_json(indent=1), encoding="utf-8")
        mine = [e for e in meter.entries if e["label"] == f"read p{p}"]
        row = {"page": p, "secs": round(dt, 1), "usd": round(sum(e["costUsd"] for e in mine), 6),
               "tokens_in": sum(e["inputTokens"] for e in mine), "tokens_out": sum(e["outputTokens"] + e["thinkingTokens"] for e in mine),
               **read_summary(res)}
        if args.mode != "born":
            pred = [q.box_2d for q in res.photos if q.box_2d and q.kind in ("photo", "document", "artwork", "map", "collage")]
            for thr in (0.5, 0.75):
                hits, ious = match_boxes(gt, pred, thr)
                row[f"recall@{thr}"] = f"{hits}/{len(gt)}"
                row[f"prec@{thr}"] = f"{hits}/{len(pred)}"
            _, ious = match_boxes(gt, pred, 0.01)
            row["median_iou"] = round(sorted(ious)[len(ious) // 2], 3) if ious else 0
            dbg = image.copy()
            d = ImageDraw.Draw(dbg)
            for b in gt:
                d.rectangle(ph.box_to_pixels(b, *dbg.size), outline=(0, 200, 0), width=4)
            for b in pred:
                d.rectangle(ph.box_to_pixels(b, *dbg.size), outline=(255, 0, 0), width=3)
            dbg.thumbnail((1600, 1600))
            dbg.save(out / f"p{p:03d}_boxes.jpg", quality=80)
        else:
            row["captioned_P"] = sum(1 for q in res.photos if q.ref.startswith("P") and q.caption)
            row["N_found"] = sum(1 for q in res.photos if q.ref.startswith("N"))
        print(json.dumps(row, ensure_ascii=False))
        return row

    t0 = time.time()
    rows = await asyncio.gather(*(one(*j) for j in jobs), return_exceptions=True)
    report = {"run": run, "args": vars(args), "elapsed": round(time.time() - t0, 1), "usage": meter.as_dict(),
              "rows": [r if isinstance(r, dict) else {"error": repr(r)} for r in rows]}
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"elapsed": report["elapsed"], "usage": report["usage"]}, ensure_ascii=False))
    print("wrote", out)


if __name__ == "__main__":
    asyncio.run(main())
