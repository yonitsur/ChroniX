"""
Phase 0 for the AI-first photo import: run the real prompts on a folder of YOUR photos and
measure what they cost, how long they take and what they write.

    python scripts/photo_story_spike/measure_photo_story.py PHOTOS_DIR \
        [--context "Our honeymoon in Portugal"] [--people "Dana,Yoni"] [--lang en|he] \
        [--plan registered|guest|unlimited] [--out drafts.json] [--dry-run]

Events: one per sub-folder when PHOTOS_DIR has sub-folders, otherwise one per capture day
(EXIF DateTimeOriginal). Each event sends the plan's photos (registered: 3 at 384 px, guest:
2 at 384 px, unlimited: 6 at 768 px) - the same as the app. Uses GEMINI_API_KEY from
backend/.env (the owner's paid key: a 30-event run costs a few cents).

Prints, per call and in total: tokens, USD cost (from the same rates as the activity log),
seconds, and what the current prices charge (credits x $0.005), so
PHOTO_DRAFT_FULL_EVENTS_PER_CREDIT / PHOTO_STORY_EVENTS_PER_CREDIT can be set from data.
Also a few quality signals (story length, repeated title openings, kinds, occasions); read the
drafts in --out for the real review.
"""

import argparse
import asyncio
import io
import json
import os
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BACKEND_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_DIR))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND_DIR / ".env")

from PIL import Image, ImageOps  # noqa: E402

from services.gemini_service import draft_photo_events, draft_photo_story  # noqa: E402
from services.quota_service import calculate_photo_draft_credit_cost, calculate_photo_story_credit_cost  # noqa: E402

CREDIT_USD = 0.005  # what one credit is meant to cover (see the credit policy)
PLANS = {
    "guest": {"batch": 8, "images": 2, "px": 384},
    "registered": {"batch": 12, "images": 3, "px": 384},
    "unlimited": {"batch": 40, "images": 6, "px": 768},
}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic"}


def capture_day(path: Path) -> str:
    try:
        with Image.open(path) as img:
            exif = img.getexif()
            raw = exif.get_ifd(0x8769).get(36867) or exif.get(306)  # DateTimeOriginal / DateTime
            if raw:
                return str(raw)[:10].replace(":", "-")
    except Exception:
        pass
    return "undated"


def thumbnail(path: Path, px: int) -> bytes:
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img).convert("RGB")
        img.thumbnail((px, px), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=78, optimize=True)
        return buf.getvalue()


def spread(items: List[Path], n: int) -> List[Path]:
    if len(items) <= n:
        return items
    step = len(items) / n
    return [items[int(i * step + step / 2)] for i in range(n)]


def collect_events(root: Path) -> List[Dict[str, Any]]:
    subdirs = sorted(p for p in root.iterdir() if p.is_dir())
    groups: Dict[str, List[Path]] = defaultdict(list)
    if subdirs:
        for d in subdirs:
            groups[d.name] = sorted(p for p in d.rglob("*") if p.suffix.lower() in IMAGE_EXT)
    else:
        for p in sorted(root.iterdir()):
            if p.suffix.lower() in IMAGE_EXT:
                groups[capture_day(p)].append(p)
    events = []
    for i, (name, photos) in enumerate(sorted(groups.items())):
        if photos:
            events.append({"id": f"e{i}", "label": name, "photos": photos})
    return events


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("photos_dir", type=Path)
    ap.add_argument("--context", default="")
    ap.add_argument("--people", default="")
    ap.add_argument("--lang", default="en")
    ap.add_argument("--plan", choices=sorted(PLANS), default="registered")
    ap.add_argument("--out", type=Path, default=Path("photo_story_drafts.json"))
    ap.add_argument("--dry-run", action="store_true", help="Group and encode only; no Gemini calls")
    args = ap.parse_args()

    plan = PLANS[args.plan]
    people = [p.strip() for p in args.people.split(",") if p.strip()]
    events = collect_events(args.photos_dir)
    if not events:
        sys.exit("No photos found.")
    print(f"{len(events)} events, {sum(len(e['photos']) for e in events)} photos, plan {args.plan} "
          f"({plan['images']} photos/event @ {plan['px']} px, {plan['batch']} events/call)")

    payload = []
    for ev in events:
        images = [thumbnail(p, plan["px"]) for p in spread(ev["photos"], plan["images"])]
        payload.append({
            "id": ev["id"], "place": "", "date_text": ev["label"], "photo_count": len(ev["photos"]),
            "at_home": None, "hint": "", "current_title": "", "people_tagged": [], "needs_place": True,
            "time_text": "", "sequence": "", "images": images,
        })
    image_kb = sum(len(b) for e in payload for b in e["images"]) / 1024
    print(f"Encoded {sum(len(e['images']) for e in payload)} AI photos, {image_kb:.0f} KB")
    if args.dry_run:
        return
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        sys.exit("GEMINI_API_KEY is not set (backend/.env).")

    drafts: List[Dict[str, Any]] = []
    look_usd = 0.0
    look_credits = 0
    look_seconds = 0.0
    for i in range(0, len(payload), plan["batch"]):
        batch = payload[i:i + plan["batch"]]
        t0 = time.time()
        res = await draft_photo_events(
            events=batch, people=people, lang=args.lang, api_key=api_key, detail="full", story_context=args.context,
        )
        secs = time.time() - t0
        usage = res.get("tokenUsage") or {}
        usd = float(usage.get("estimatedCostUsd") or 0)
        credits = calculate_photo_draft_credit_cost(len(batch), "full")
        look_usd += usd
        look_credits += credits
        look_seconds += secs
        drafts.extend(res["drafts"])
        print(f"  look {i // plan['batch'] + 1}: {len(batch)} events, {usage.get('promptTokens')} in / "
              f"{usage.get('candidatesTokens')} out tokens, ${usd:.4f}, {secs:.1f}s, charged {credits} credits (${credits * CREDIT_USD:.3f})")

    by_id = {d["id"]: d for d in drafts}
    story_events = [{
        "id": ev["id"], "date_text": ev["label"], "place": by_id.get(ev["id"], {}).get("place_guess", ""),
        "title": by_id.get(ev["id"], {}).get("title", ev["label"]), "caption": by_id.get(ev["id"], {}).get("caption", ""),
        "story": (by_id.get(ev["id"], {}).get("story", "") or "")[:600], "photo_count": len(ev["photos"]),
        "at_home": None, "trip": "", "people_tagged": [], "occasion": by_id.get(ev["id"], {}).get("occasion", ""),
        "user_titled": False,
    } for ev in events]
    t0 = time.time()
    story = await draft_photo_story(events=story_events, story_context=args.context, people=people, lang=args.lang, api_key=api_key)
    story_secs = time.time() - t0
    story_usd = float((story.get("tokenUsage") or {}).get("estimatedCostUsd") or 0)
    story_credits = calculate_photo_story_credit_cost(len(story_events))

    n = len(events)
    print("\n== Cost ==")
    print(f"Look:  ${look_usd:.4f} total, ${look_usd / n:.5f}/event, {look_seconds:.1f}s; charged {look_credits} credits (${look_credits * CREDIT_USD:.3f})")
    print(f"Story: ${story_usd:.4f}, {story_secs:.1f}s; charged {story_credits} credits (${story_credits * CREDIT_USD:.3f})")
    if look_usd:
        fair = max(1, int(CREDIT_USD / (look_usd / n)))
        print(f"-> one credit covers ~{fair} full events at this cost (PHOTO_DRAFT_FULL_EVENTS_PER_CREDIT is "
              f"{os.getenv('PHOTO_DRAFT_FULL_EVENTS_PER_CREDIT', '8')})")

    words = [len((d.get("story") or "").split()) for d in drafts]
    openings = Counter(" ".join((d.get("title") or "").split()[:2]).lower() for d in drafts)
    print("\n== Quality signals ==")
    print(f"Drafted {len(drafts)}/{n} events; story words min/avg/max {min(words or [0])}/{sum(words) / max(1, len(words)):.0f}/{max(words or [0])}")
    print(f"Kinds: {dict(Counter(d.get('kind') for d in drafts))}; occasions: {[d['occasion'] for d in drafts if d.get('occasion')]}")
    print(f"Repeated title openings: {[k for k, v in openings.items() if v > 1] or 'none'}")
    print(f"Timeline: {story.get('timeline_title')!r} ({story.get('story_type')}), {len(story.get('chapters') or [])} chapters, "
          f"{len(story.get('merges') or [])} merges, {len(story.get('titles') or [])} retitles")

    out = {"events": [{"id": e["id"], "label": e["label"], "photos": [str(p) for p in e["photos"]]} for e in events],
           "drafts": drafts, "story": {k: v for k, v in story.items() if k != "tokenUsage"},
           "cost": {"look_usd": look_usd, "story_usd": story_usd, "look_credits": look_credits, "story_credits": story_credits}}
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nDrafts written to {args.out}")


if __name__ == "__main__":
    asyncio.run(main())
