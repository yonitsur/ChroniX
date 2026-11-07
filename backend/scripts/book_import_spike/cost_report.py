"""Cost breakdown of a book import from its per-call ledger.

Sources (any of):
  - a usage.jsonl written by run_read.py / run_pipeline.py
  - a JSON file saved from GET /api/book-imports/{id}/usage   ({"calls": [...]})
  - a local-store import id: backend/data/book_imports/objects/b/*/<id>/usage/*.json

Usage: python scripts/book_import_spike/cost_report.py <path-or-import-id> [--top 10]

Token counts come from Gemini's own usage metadata on every response. Dollars are tokens x the price
list in use (`priceSource`): the app's built-in table, or BOOK_IMPORT_PRICE_*_PER_M when set. Google's
billing page is the final word on what was charged.
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BACKEND_DIR = Path(__file__).resolve().parents[2]


def load(src: str):
    p = Path(src)
    if p.is_file():
        text = p.read_text(encoding="utf-8")
        if p.suffix == ".jsonl":
            return [json.loads(line) for line in text.splitlines() if line.strip()]
        data = json.loads(text)
        return data.get("calls", data) if isinstance(data, dict) else data
    calls = []
    for f in (BACKEND_DIR / "data" / "book_imports" / "objects").glob(f"b/*/{src}/usage/*.json"):
        calls.extend(json.loads(f.read_text(encoding="utf-8")))
    if not calls:
        sys.exit(f"No usage found for {src!r}")
    return calls


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("--top", type=int, default=10)
    args = ap.parse_args()
    calls = load(args.source)

    keys = ("inputTokens", "cachedTokens", "outputTokens", "thinkingTokens", "costUsd")
    by_stage = defaultdict(lambda: defaultdict(float))
    by_model = defaultdict(lambda: defaultdict(float))
    for c in calls:
        for bucket in (by_stage[c.get("stage") or "?"], by_model[c.get("model") or "?"]):
            bucket["calls"] += 1
            for k in keys:
                bucket[k] += c.get(k) or 0
    total = {k: sum(c.get(k) or 0 for c in calls) for k in keys}

    header = f"{'':<14}{'calls':>7}{'input':>12}{'cached':>10}{'output':>11}{'thinking':>11}{'USD':>12}"
    print(header)
    print("-" * len(header))
    for name, b in sorted(by_stage.items(), key=lambda kv: -kv[1]["costUsd"]):
        print(f"{name:<14}{int(b['calls']):>7}{int(b['inputTokens']):>12,}{int(b['cachedTokens']):>10,}{int(b['outputTokens']):>11,}{int(b['thinkingTokens']):>11,}{b['costUsd']:>12.4f}")
    print("-" * len(header))
    print(f"{'TOTAL':<14}{len(calls):>7}{int(total['inputTokens']):>12,}{int(total['cachedTokens']):>10,}{int(total['outputTokens']):>11,}{int(total['thinkingTokens']):>11,}{total['costUsd']:>12.4f}")

    print("\nBy model:")
    for name, b in sorted(by_model.items(), key=lambda kv: -kv[1]["costUsd"]):
        print(f"  {name:<28} {int(b['calls']):>5} calls  ${b['costUsd']:.4f}")
    retries = [c for c in calls if c.get("outcome") not in (None, "ok")]
    if retries:
        print(f"\nCalls that were billed but not used (retried/split): {len(retries)}, ${sum(c.get('costUsd') or 0 for c in retries):.4f}")
    sources = {c.get("priceSource") for c in calls}
    print(f"\nPrice source: {', '.join(sorted(s for s in sources if s))}")
    print(f"\nMost expensive {args.top} calls:")
    for c in sorted(calls, key=lambda c: -(c.get("costUsd") or 0))[: args.top]:
        print(f"  ${c.get('costUsd', 0):.5f}  {c.get('label'):<22} {c.get('model')}  in={c.get('inputTokens')} out={c.get('outputTokens')} think={c.get('thinkingTokens')}  {c.get('outcome')}")


if __name__ == "__main__":
    main()
