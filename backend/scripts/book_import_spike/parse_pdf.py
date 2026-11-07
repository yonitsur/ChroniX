"""Phase 0: deterministic parse of a PDF with the book-import PDF source; prints stats and writes
renders + extracted photos for inspection into backend/data/book_eval/parse/<name>/.

Usage: python scripts/book_import_spike/parse_pdf.py <pdf> [--pages 8,9,12] [--render-px 3000]
"""

import argparse
import json
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BACKEND_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_DIR))

from services.book_import.sources import pdf as pdfsrc  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--pages", default="", help="1-based pages to dump/extract (comma separated)")
    ap.add_argument("--render-px", type=int, default=3000)
    args = ap.parse_args()

    out = BACKEND_DIR / "data" / "book_eval" / "parse" / Path(args.pdf).stem
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    doc = pdfsrc.open_pdf(args.pdf, max_pages=2000)
    units = [pdfsrc.parse_page(doc, i, "s0", i) for i in range(len(doc))]
    pdfsrc.finalize_units(units)
    t_parse = time.time() - t0

    kinds = Counter(u.kind for u in units)
    imgs = [im for u in units for im in u.images]
    deco = Counter(im.decoration for im in imgs if im.decoration)
    photos = [(u, im) for u in units for im in u.images if not im.decoration]
    with_caps = sum(1 for u, im in photos if im.ref in u.caption_candidates)
    sizes = [tb.font_pt for u in units for tb in u.text_blocks]
    print(f"pages={len(units)} kinds={dict(kinds)} parse={t_parse:.2f}s spreads={sum(u.is_spread for u in units)}")
    print(f"image placements={len(imgs)} decorations={dict(deco)} photos={len(photos)} with caption candidates={with_caps}")
    print(f"text blocks={sum(len(u.text_blocks) for u in units)} font sizes median={statistics.median(sizes) if sizes else 0}")
    (out / "units.json").write_text(json.dumps([u.model_dump() for u in units], ensure_ascii=False, indent=1), encoding="utf-8")

    pages = [int(p) for p in args.pages.split(",") if p.strip()]
    for p in pages:
        u = units[p - 1]
        print(f"\n== PDF p.{p} kind={u.kind} chars={u.char_count}")
        for idx, tb in enumerate(u.text_blocks):
            print(f"  [{idx}] {tb.font_pt:>5} {tb.box_2d} {tb.text[:90]!r}")
        for im in u.images:
            caps = [u.text_blocks[i].text[:60] for i in u.caption_candidates.get(im.ref, [])]
            print(f"  {im.ref} {im.box_2d} {im.native_w}x{im.native_h} angle={im.angle} deco={im.decoration} caps={caps}")
            if not im.decoration:
                pil = pdfsrc.extract_image(doc, p - 1, im)
                if pil:
                    pil.save(out / f"p{p:03d}_{im.ref}.jpg", quality=90)
        t1 = time.time()
        pdfsrc.render_page(doc, p - 1, args.render_px).save(out / f"p{p:03d}_render.jpg", quality=88)
        print(f"  render {args.render_px}px {time.time() - t1:.2f}s")
    print("\nwrote", out)


if __name__ == "__main__":
    main()
