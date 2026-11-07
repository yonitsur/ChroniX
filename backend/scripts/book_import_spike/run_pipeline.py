"""Phase 0: map -> extract -> reconcile on top of a finished read run (real Gemini).

Every stage output is cached in the output directory, so re-running resumes (delete a file to redo it).

Usage:
  python scripts/book_import_spike/run_pipeline.py ../yoni/singer_family_book.pdf \
      --reads data/book_eval/read/<fullbook-run> --out data/book_eval/pipeline/singer \
      [--map-model gemini-3.8-flash] [--extract-model ...] [--instructions "..."]
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from collections import Counter
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BACKEND_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_DIR))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND_DIR / ".env")

from services.book_import.ai_calls import GeminiReconcileAI, StageContext, run_extract_chunk, run_map  # noqa: E402
from services.book_import.book_text import unit_text  # noqa: E402
from services.book_import.chunking import plan_chunks  # noqa: E402
from services.book_import.config import load_config  # noqa: E402
from services.book_import.gemini_calls import AimdLimiter, UsageMeter  # noqa: E402
from services.book_import.reconcile import ReconcileInputs, reconcile  # noqa: E402
from services.book_import.schemas.artifacts import ChunkPlan  # noqa: E402
from services.book_import.schemas.model_io import BookMapOutput, ExtractOutput, PageReadOutput  # noqa: E402
from services.book_import.sources import pdf as pdfsrc  # noqa: E402


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--reads", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--map-model", default="")
    ap.add_argument("--extract-model", default="")
    ap.add_argument("--reconcile-model", default="")
    ap.add_argument("--instructions", default="")
    ap.add_argument("--language", default="auto")
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--no-ai-reconcile", action="store_true")
    args = ap.parse_args()

    if args.map_model:
        os.environ["BOOK_IMPORT_MODEL_MAP"] = args.map_model
    if args.extract_model:
        os.environ["BOOK_IMPORT_MODEL_EXTRACT"] = args.extract_model
    if args.reconcile_model:
        os.environ["BOOK_IMPORT_MODEL_RECONCILE"] = args.reconcile_model
    cfg = load_config()
    out = Path(args.out)
    (out / "extract").mkdir(parents=True, exist_ok=True)

    doc = pdfsrc.open_pdf(args.pdf, max_pages=5000)
    units = [pdfsrc.parse_page(doc, i, "s0", i) for i in range(len(doc))]
    pdfsrc.finalize_units(units)
    for u in units:
        u.label = f"PDF p.{u.index + 1}"
    reads = {}
    for f in Path(args.reads).glob("p*_read.json"):
        idx = int(f.name[1:4]) - 1
        reads[idx] = PageReadOutput.model_validate_json(f.read_text(encoding="utf-8"))
    print(f"units={len(units)} reads={len(reads)}")
    by_index = {u.index: u for u in units}

    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    logging.getLogger("ChroniXBookImport").setLevel(logging.INFO)
    ledger = out / "usage.jsonl"

    def sink(entry):  # every model call, written as it happens (survives crashes)
        with ledger.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    ctx = StageContext(api_key=os.environ.get("GEMINI_API_KEY"), config=cfg, limiter=AimdLimiter(args.concurrency), meter=UsageMeter(sink=sink))
    timings = {}

    map_path = out / "map.json"
    ctx.meter.stage = "map"
    t0 = time.time()
    if map_path.exists():
        book_map = BookMapOutput.model_validate_json(map_path.read_text(encoding="utf-8"))
    else:
        book_map = await run_map(ctx, units, reads, args.instructions or None)
        map_path.write_text(book_map.model_dump_json(indent=1), encoding="utf-8")
    timings["map"] = round(time.time() - t0, 1)
    print(f"map: cast={len(book_map.cast)} chapters={len(book_map.chapters)} places={len(book_map.places)} "
          f"lanes={[l.title for l in book_map.lanes]} anchors={len(book_map.anchors)} skip={len(book_map.skip_units)} ({timings['map']}s)")

    chars = {u.index: len(unit_text(u, reads.get(u.index))) for u in units}
    chunks = plan_chunks(book_map, [u.index for u in units], lambda i: chars.get(i, 0), skip={s.unit for s in book_map.skip_units})
    print(f"chunks={len(chunks)} units covered={sum(len(c.units) for c in chunks)}")

    ctx.meter.stage = "extract"
    t0 = time.time()

    async def one(chunk: ChunkPlan):
        path = out / "extract" / f"{chunk.id}.json"
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            return [(ChunkPlan.model_validate(d["chunk"]), ExtractOutput.model_validate(d["out"])) for d in data]
        res = await run_extract_chunk(ctx, book_map, chunk, by_index, reads, args.instructions or None, args.language)
        path.write_text(json.dumps([{"chunk": c.model_dump(), "out": o.model_dump()} for c, o in res], ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"  {chunk.id} units U{chunk.units[0]}-U{chunk.units[-1]} -> {sum(len(o.events) for _, o in res)} events")
        return res

    results = await asyncio.gather(*(one(c) for c in chunks))
    extracts = [pair for r in results for pair in r]
    timings["extract"] = round(time.time() - t0, 1)
    print(f"extracted events={sum(len(o.events) for _, o in extracts)} ({timings['extract']}s)")

    ctx.meter.stage = "reconcile"
    t0 = time.time()
    ai = None if args.no_ai_reconcile else GeminiReconcileAI(ctx)
    draft = await reconcile(ReconcileInputs(import_id="spike", book_map=book_map, units=units, reads=reads, extracts=extracts), ai)
    timings["reconcile"] = round(time.time() - t0, 1)
    (out / "draft.json").write_text(json.dumps(draft.to_json_dict(), ensure_ascii=False, indent=1), encoding="utf-8")

    flags = Counter(f for e in draft.events for f in e.flags)
    bases = Counter(e.dateBasis for e in draft.events)
    precision = Counter((e.from_.precision if e.from_ else "undated") for e in draft.events)
    print(json.dumps({"stats": draft.stats, "flags": flags, "dateBasis": bases, "precision": precision,
                      "timings": timings, "usage_this_run": ctx.meter.as_dict()}, ensure_ascii=False, indent=1))
    print(f"\nPer-call costs: {ledger}  (summary: python scripts/book_import_spike/cost_report.py {ledger})")


if __name__ == "__main__":
    asyncio.run(main())
