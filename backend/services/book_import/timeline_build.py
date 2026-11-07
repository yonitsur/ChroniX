"""Reviewed draft -> TimelineData dict (built at finalize, after photos were promoted to hosted storage)."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from models import TimelineArticle, TimelineData
from services.gemini_service import DEFAULT_LANE_PALETTE, date_sort_key, dedupe_article_ids, new_timeline_id

from .schemas.draft import BookDraft, DraftDate, DraftEvent

MAX_ARTICLES = 600
MAX_BANDS = 120
BAND_COLOR = "rgba(120, 113, 108, 0.08)"


class TimelineTooLarge(ValueError):
    pass


def _accepted(draft: BookDraft) -> List[DraftEvent]:
    rejected_chapters = {c.id for c in draft.chapters if c.status == "rejected"}
    return [
        e for e in draft.events
        if e.status == "accepted" and e.from_ is not None and (e.chapterId not in rejected_chapters)
    ]


def photos_to_promote(draft: BookDraft) -> List[str]:
    """Hosted-photo ids needed by the timeline: every photo of every event that will be created."""
    excluded = {p.id for p in draft.photos if p.status == "excluded"}
    out: List[str] = []
    seen = set()
    for e in _accepted(draft):
        for ep in e.photos:
            if ep.photoId not in excluded and ep.photoId not in seen:
                seen.add(ep.photoId)
                out.append(ep.photoId)
    return out


def _date(d: Optional[DraftDate]) -> Optional[Dict[str, Any]]:
    if d is None:
        return None
    out: Dict[str, Any] = {"year": int(d.year), "precision": d.precision}
    if d.month and d.precision in ("day", "month"):
        out["month"] = int(d.month)
    if d.day and d.precision == "day":
        out["day"] = int(d.day)
    return out


def _safe_id(raw: str, fallback: str) -> str:
    cleaned = re.sub(r'[<>"\'`\x00-\x1f\x7f]', "_", str(raw or "").strip())[:128]
    return cleaned or fallback


def draft_to_timeline(draft: BookDraft, photo_urls: Dict[str, str], *, import_id: str) -> Dict[str, Any]:
    events = _accepted(draft)
    if not events:
        raise ValueError("No accepted, dated events to create.")
    if len(events) > MAX_ARTICLES:
        raise TimelineTooLarge(f"{len(events)} events; the limit is {MAX_ARTICLES}.")
    events.sort(key=lambda e: date_sort_key(_date(e.from_) or {}))
    captions = {p.id: (p.caption or "") for p in draft.photos}
    excluded = {p.id for p in draft.photos if p.status == "excluded"}
    people = {c.id: c.name for c in draft.cast}

    palette = list(DEFAULT_LANE_PALETTE) or ["#2563a2"]
    lanes = []
    for n, l in enumerate(draft.lanes, start=1):
        lanes.append({"id": _safe_id(l.id, f"lane-{n}"), "title": l.title[:300], "color": l.color or palette[(n - 1) % len(palette)], "order": n})
    if not lanes:
        lanes = [{"id": "main", "title": draft.title[:300] or "Timeline", "color": palette[0], "order": 1}]
    lane_ids = {l["id"] for l in lanes}

    articles: List[TimelineArticle] = []
    for n, e in enumerate(events, start=1):
        media = [ep.photoId for ep in e.photos if ep.photoId in photo_urls and ep.photoId not in excluded]
        cover_id = next((ep.photoId for ep in e.photos if ep.role == "cover" and ep.photoId in media), media[0] if media else None)
        gallery = [pid for pid in media if pid != cover_id]
        art: Dict[str, Any] = {
            "id": _safe_id(e.id, f"bk-{n:04d}"),
            "title": e.title[:600],
            "subtitle": (e.summary or "")[:6000] or None,
            "lane": e.lane if e.lane in lane_ids else lanes[0]["id"],
            "from": _date(e.from_),
            "to": _date(e.to),
            "isToPresent": bool(e.isToPresent),
            "rank": max(1, min(10, int(e.rank or 5))),
            "category": (e.category or "")[:200] or None,
        }
        if e.narrative:
            art["extract"] = e.narrative[:30000]
            art["extractIsCustom"] = True
        if e.place and e.place.name:
            art["locationName"] = e.place.name[:400]
            if e.place.lat is not None and e.place.lng is not None:
                art["lat"], art["lng"] = float(e.place.lat), float(e.place.lng)
                art["googleMapsUrl"] = f"https://www.google.com/maps?q={e.place.lat},{e.place.lng}"
            if e.place.wiki:
                art["contextLinks"] = [{"kind": "place", "name": e.place.name[:400], **e.place.wiki.model_dump(exclude_none=True)}]
        if cover_id:
            art["imageUrl"] = photo_urls[cover_id]
            art["imageSource"] = "upload"
            art["mediaType"] = "image"
        if gallery:
            art["additionalImages"] = [{"url": photo_urls[pid], "caption": captions.get(pid, "")[:300]} for pid in gallery]
        if cover_id and captions.get(cover_id):
            art["imageCaption"] = captions[cover_id][:300]
        art["people"] = [{"id": pid, "name": people.get(pid, pid)} for pid in e.people][:20]
        if e.unresolvedPeople:
            art["peopleMentioned"] = list(e.unresolvedPeople)[:20]
        art["sourceRefs"] = [r.model_dump() for r in e.sourceRefs][:6]
        if e.sourceRefs:
            first = e.sourceRefs[0]
            art["provenance"] = f"document:{first.sourceId}#u{first.unit}" + (f"p{first.printedPage}" if first.printedPage else "")
        if e.circa:
            art["circa"] = True
        if e.dateText:
            art["dateText"] = e.dateText[:200]
        art["dateBasis"] = e.dateBasis
        articles.append(TimelineArticle.model_validate(art))

    # Bookends stand out (same rule as AI-generated timelines).
    articles[0] = articles[0].model_copy(update={"rank": 10})
    articles[-1] = articles[-1].model_copy(update={"rank": 10})
    articles = dedupe_article_ids(articles)

    used_chapters = {e.chapterId for e in events}
    bands = []
    for ch in draft.chapters:
        if ch.status == "rejected" or ch.id not in used_chapters or ch.from_ is None or ch.to is None:
            continue
        bands.append({
            "id": _safe_id(ch.id if ch.id.startswith("ch") else f"ch-{ch.id}", f"ch-{len(bands) + 1}"),
            "title": ch.title[:300],
            "from": {"year": ch.from_.year, "precision": "year"},
            "to": {"year": max(ch.to.year, ch.from_.year), "precision": "year"},
            "color": BAND_COLOR,
        })
        if len(bands) >= MAX_BANDS:
            break

    now = datetime.now(timezone.utc).isoformat()
    timeline = TimelineData.model_validate({
        "id": new_timeline_id(draft.title),
        "title": (draft.title or "Family book")[:600],
        "description": (draft.description or "")[:6000],
        "overview": (draft.overview or "")[:80000],
        "timeScale": "calendar",
        "lanes": lanes,
        "timeBands": bands,
        "articles": [a.model_dump(by_alias=True, exclude_none=True) for a in articles],
        "createdAt": now,
        "updatedAt": now,
        "isPersonal": True,
        "isManual": False,
        "creationSource": "files",
        "searchMode": "fast",
        "detectedLanguage": (draft.language or "")[:32] or None,
        "storyStudio": {"blueprint": "custom", "version": 2, "source": "book_import", "importId": import_id},
    })
    return timeline.model_dump(by_alias=True, exclude_none=True)
