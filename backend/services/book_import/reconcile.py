"""Reconcile: turns the per-chunk extractions into one reviewable draft.

Code first, the model only where judgment is needed (through the injected `ReconcileAI`):
1. dates      - DateParts -> draft dates; Hebrew-calendar dates checked with a deterministic converter;
                relative ages resolved from the cast's birth years; flags for inferred/undated dates.
2. dedupe     - candidate groups found in code (close years + shared people/places + similar titles),
                decided by the model per group; a merge keeps the union of evidence and photos.
3. photos     - each photo gets one home event (confidence, role, page proximity); unlinked photos get
                a second chance against nearby candidates; weak matches go to the tray.
4. structure  - places, lanes, chapter spans, ranks, stable ids, flags -> BookDraft.
"""

from __future__ import annotations

import calendar
import re
import statistics
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional, Protocol, Sequence, Set, Tuple

from .book_text import photo_id, real_photos
from .hebrew_dates import ENGLISH_TO_PYLUACH, parse_hebrew_date, to_gregorian
from .schemas.artifacts import ChunkPlan, UnitParse
from .schemas.draft import (
    BookDraft, DraftChapter, DraftDate, DraftEvent, DraftEventPhoto, DraftLane, DraftPerson, DraftPhoto,
    DraftPlace, DraftPlaceEntry, DraftSourceRef, DraftUnit,
)
from .schemas.model_io import (
    BookMapOutput, DateParts, Evidence, ExtractedEvent, ExtractOutput, MergeGroup, PageReadOutput, PhotoAssignment,
    PhotoLink,
)

SEASON_MONTH = {"spring": 4, "summer": 7, "autumn": 10, "winter": 1}
PRECISION_RANK = {"day": 5, "month": 4, "year": 3, "decade": 2, "century": 1}
KEY_CATEGORIES = {"birth", "death", "marriage", "divorce", "immigration"}
DEDUPE_GROUP_MAX = 40
PHOTO_BATCH = 60
ALBUM_TITLE_HE = "\u05d0\u05dc\u05d1\u05d5\u05dd: "
ALBUM_TITLE_EN = "Photos: "
LANE_PALETTE_FALLBACK = ["#2563a2", "#2e6b56", "#b87326", "#6e395e", "#4b5563", "#9a3b3b"]


class ReconcileAI(Protocol):
    async def dedupe(self, groups: List[List[Dict[str, Any]]]) -> List[MergeGroup]: ...

    async def assign_photos(self, photos: List[Dict[str, Any]], candidates: List[Dict[str, Any]]) -> List[PhotoAssignment]: ...


@dataclass
class WorkEvent:
    """An extracted event while it is being reconciled."""

    key: str
    ev: ExtractedEvent
    chunk_id: str
    chapter_id: Optional[str]
    date_from: Optional[Dict[str, Any]] = None
    date_to: Optional[Dict[str, Any]] = None
    circa: bool = False
    flags: Set[str] = field(default_factory=set)
    merged_from: List[str] = field(default_factory=list)
    alive: bool = True

    @property
    def year(self) -> Optional[int]:
        return self.date_from["year"] if self.date_from else None

    @property
    def units(self) -> List[int]:
        return [e.unit for e in self.ev.evidence]


# ------------------------------------------------------------------------------------------ dates


def _valid_ymd(y: int, m: Optional[int], d: Optional[int]) -> Tuple[Optional[int], Optional[int]]:
    if m is None or not (1 <= m <= 12):
        return None, None
    if d is None:
        return m, None
    try:
        last = calendar.monthrange(y, m)[1] if y > 0 else 31
    except Exception:
        last = 31
    return m, d if 1 <= d <= last else None


def parts_to_date(dp: Optional[DateParts]) -> Tuple[Optional[Dict[str, Any]], bool]:
    """DateParts -> ({year, month, day, precision}, circa) or (None, False) when there's no year."""
    if dp is None or dp.year is None:
        return None, False
    y = int(dp.year)
    if not (-10000 <= y <= 2200) or y == 0:
        return None, False
    circa = bool(dp.circa)
    p = dp.precision
    if p == "season":
        return {"year": y, "month": SEASON_MONTH.get(dp.season or "", dp.month or 1), "day": None, "precision": "month"}, True
    if p == "decade":
        return {"year": (y // 10) * 10, "month": None, "day": None, "precision": "decade"}, circa
    if p == "century":
        return {"year": (y // 100) * 100, "month": None, "day": None, "precision": "century"}, circa
    m, d = _valid_ymd(y, dp.month, dp.day)
    if p == "day" and m and d:
        return {"year": y, "month": m, "day": d, "precision": "day"}, circa
    if p in ("day", "month") and m:
        return {"year": y, "month": m, "day": None, "precision": "month"}, circa
    return {"year": y, "month": None, "day": None, "precision": "year"}, circa or p == "unknown"


def _has_explicit_gregorian(text: str, year: int) -> bool:
    return bool(re.search(rf"(?<!\d){year}(?!\d)", text or ""))


def normalize_dates(w: WorkEvent, birth_years: Dict[str, int]) -> None:
    ev = w.ev
    date_from, circa = parts_to_date(ev.start)
    date_to, _ = parts_to_date(ev.end) if ev.end else (None, False)

    # Hebrew-calendar dates: deterministic conversion of what is written, compared with the model.
    hd = parse_hebrew_date(ev.date_text)
    heb = None
    if hd and hd.year:
        heb = to_gregorian(hd.year, hd.month, hd.day)
    elif ev.hebrew_start and ev.hebrew_start.year:
        month = ENGLISH_TO_PYLUACH.get(ev.hebrew_start.month or "")
        heb = to_gregorian(int(ev.hebrew_start.year), month, ev.hebrew_start.day if month else None)
    if heb:
        hy, hm, hdy = heb
        heb_date = {"year": hy, "month": hm, "day": hdy, "precision": "day" if hdy else ("month" if hm else "year")}
        if date_from is None:
            date_from, circa = heb_date, hm is None
        else:
            same = date_from["year"] == hy and (
                date_from["precision"] != "day" or hdy is None or (date_from.get("month") == hm and date_from.get("day") == hdy)
            )
            near_year = abs(date_from["year"] - hy) <= 1 and hm is None  # a Hebrew year spans two years
            if not same and not near_year:
                w.flags.add("hebrew_mismatch")
                if not _has_explicit_gregorian(ev.date_text, date_from["year"]):
                    date_from, circa = heb_date, hm is None

    if date_from is None and ev.relative_age and ev.relative_age.person_id in birth_years:
        y = birth_years[ev.relative_age.person_id] + int(ev.relative_age.age_years)
        date_from, circa = {"year": y, "month": None, "day": None, "precision": "year"}, True
        w.flags.add("date_inferred")

    if date_from is None:
        w.flags.add("undated")
    elif ev.date_basis in ("derived", "inferred", "unknown"):
        w.flags.add("date_inferred")
    if date_to is not None and date_from is not None and _sort_key(date_to) < _sort_key(date_from):
        date_from, date_to = date_to, date_from
    if date_to is not None and date_from is not None and _sort_key(date_to) == _sort_key(date_from):
        date_to = None
    w.date_from, w.date_to, w.circa = date_from, date_to, bool(circa)


def _sort_key(d: Optional[Dict[str, Any]]) -> Tuple[int, int, int]:
    if not d:
        return (99999, 13, 32)
    return (int(d["year"]), int(d.get("month") or 0), int(d.get("day") or 0))


_KINSHIP = {
    "אמא", "אבא", "סבא", "סבתא", "דוד", "דודה", "אח", "אחות", "בעלי", "אשתי", "הבן", "הבת", "סבי", "סבתי",
    "אמי", "אבי", "סבא רבא", "סבתא רבתא", "mom", "dad", "mother", "father", "grandma", "grandpa",
    "grandmother", "grandfather", "uncle", "aunt", "my brother", "my sister", "my husband", "my wife",
}
_KIN_PUNCT = re.compile("[\"'\u05f3\u05f4().,]")


def is_kinship_only(name: str) -> bool:
    """True for a bare kinship word ('Grandpa', the Hebrew word for Mom) that should have resolved to a cast member."""
    n = _KIN_PUNCT.sub(" ", (name or "").strip().lower())
    n = re.sub(r"\s+", " ", n).strip()
    return n in _KINSHIP or (n.startswith("\u05d4") and n[1:] in _KINSHIP)


# ------------------------------------------------------------------------------------------ dedupe

_TOKEN_RE = re.compile(r"[\w֐-׿]+", re.UNICODE)
_HE_PREFIX = re.compile(r"^[והבלמכש](?=[֐-׿]{3,})")


def _tokens(text: str) -> Set[str]:
    out = set()
    for t in _TOKEN_RE.findall((text or "").lower()):
        t = _HE_PREFIX.sub("", t)
        if len(t) >= 2 and not t.isdigit():
            out.add(t)
    return out


def _jaccard(a: Set[str], b: Set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _pair_score(a: WorkEvent, b: WorkEvent) -> float:
    ya, yb = a.year, b.year
    if ya is not None and yb is not None and abs(ya - yb) > 2:
        return 0.0
    shared_people = set(a.ev.person_ids) & set(b.ev.person_ids)
    shared_place = set(a.ev.place_ids) & set(b.ev.place_ids)
    if not shared_people and not shared_place:
        return 0.0
    jac = _jaccard(_tokens(a.ev.title + " " + a.ev.summary), _tokens(b.ev.title + " " + b.ev.summary))
    same_key = a.ev.category == b.ev.category and a.ev.category in KEY_CATEGORIES
    if jac < 0.2 and not same_key:
        return 0.0
    score = jac + (0.3 if same_key else 0.0) + (0.1 if ya is not None and ya == yb else 0.0)
    if a.ev.cross_reference or b.ev.cross_reference:
        score += 0.2
    return score


def candidate_groups(events: Sequence[WorkEvent]) -> Tuple[List[List[WorkEvent]], Dict[Tuple[str, str], float]]:
    alive = [e for e in events if e.alive]
    alive.sort(key=lambda e: _sort_key(e.date_from))
    parent = {e.key: e.key for e in alive}
    scores: Dict[Tuple[str, str], float] = {}

    def find(k: str) -> str:
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    for i, a in enumerate(alive):
        for b in alive[i + 1:]:
            if a.year is not None and b.year is not None and b.year - a.year > 2:
                break
            s = _pair_score(a, b)
            if s > 0:
                scores[(a.key, b.key)] = s
                parent[find(a.key)] = find(b.key)
        if a.year is None:
            continue
    # undated events are compared with everything that shares people (the sort put them last)
    undated = [e for e in alive if e.year is None]
    dated = [e for e in alive if e.year is not None]
    for u in undated:
        for d in dated:
            s = _pair_score(u, d)
            if s > 0:
                scores[(d.key, u.key)] = s
                parent[find(u.key)] = find(d.key)
    comps: Dict[str, List[WorkEvent]] = {}
    for e in alive:
        comps.setdefault(find(e.key), []).append(e)
    groups: List[List[WorkEvent]] = []
    for members in comps.values():
        if len(members) < 2:
            continue
        members.sort(key=lambda e: _sort_key(e.date_from))
        for i in range(0, len(members), DEDUPE_GROUP_MAX):
            part = members[i:i + DEDUPE_GROUP_MAX]
            if len(part) >= 2:
                groups.append(part)
    return groups, scores


def _event_brief(w: WorkEvent) -> Dict[str, Any]:
    d = w.date_from
    return {
        "id": w.key,
        "date": (f"{d['year']}" + (f"-{d['month']:02d}" if d.get("month") else "") + (f"-{d['day']:02d}" if d.get("day") else "")) if d else "undated",
        "date_text": w.ev.date_text[:80],
        "title": w.ev.title,
        "summary": w.ev.summary[:200],
        "people": w.ev.person_ids,
        "places": w.ev.place_ids,
        "category": w.ev.category,
        "units": sorted(set(w.units)),
        "cross_reference": w.ev.cross_reference,
    }


def _date_quality(w: WorkEvent) -> Tuple[int, int]:
    p = PRECISION_RANK.get((w.date_from or {}).get("precision", ""), 0)
    explicit = 1 if w.ev.date_basis in ("explicit", "hebrew", "caption") else 0
    return explicit, p


def merge_into(keep: WorkEvent, other: WorkEvent) -> None:
    """Merges `other` into `keep`: union of evidence/photos/people/places, best date, longest story."""
    if keep.ev.cross_reference and not other.ev.cross_reference:
        keep.ev, other.ev = other.ev, keep.ev  # the full telling is the better base
    ev = keep.ev
    seen = {(e.unit, e.quote) for e in ev.evidence}
    evidence = list(ev.evidence) + [e for e in other.ev.evidence if (e.unit, e.quote) not in seen]
    photo_ids = {p.photo_id for p in ev.photos}
    photos = list(ev.photos) + [p for p in other.ev.photos if p.photo_id not in photo_ids]
    people = list(dict.fromkeys(list(ev.person_ids) + list(other.ev.person_ids)))
    places = list(dict.fromkeys(list(ev.place_ids) + list(other.ev.place_ids)))
    unresolved = list(dict.fromkeys(list(ev.unresolved_people) + list(other.ev.unresolved_people)))
    narrative = ev.narrative if len(ev.narrative) >= len(other.ev.narrative) else other.ev.narrative
    update: Dict[str, Any] = dict(
        evidence=evidence[:6], photos=photos, person_ids=people, place_ids=places, unresolved_people=unresolved,
        narrative=narrative, importance=max(ev.importance, other.ev.importance),
        cross_reference=ev.cross_reference and other.ev.cross_reference,
        from_infographic=ev.from_infographic and other.ev.from_infographic,
    )
    if not ev.summary and other.ev.summary:
        update["summary"] = other.ev.summary
    keep.ev = ev.model_copy(update=update)
    if _date_quality(other) > _date_quality(keep):
        keep.date_from, keep.date_to, keep.circa = other.date_from, other.date_to, other.circa
        keep.ev = keep.ev.model_copy(update={"date_text": other.ev.date_text, "date_basis": other.ev.date_basis})
        keep.flags.discard("undated")
        keep.flags.discard("date_inferred")
        keep.flags |= {f for f in other.flags if f in ("date_inferred", "hebrew_mismatch")}
    keep.merged_from.append(other.key)
    keep.merged_from.extend(other.merged_from)
    other.alive = False


async def dedupe(events: List[WorkEvent], ai: Optional[ReconcileAI]) -> Dict[str, int]:
    groups, scores = candidate_groups(events)
    by_key = {e.key: e for e in events}
    merged = 0
    decided_pairs: Set[Tuple[str, str]] = set()
    if groups and ai is not None:
        decisions = await ai.dedupe([[_event_brief(w) for w in g] for g in groups])
        for d in decisions:
            keep = by_key.get(d.keep_id)
            if keep is None or not keep.alive:
                continue
            for mid in d.merge_ids:
                other = by_key.get(mid)
                if other is None or other is keep or not other.alive:
                    continue
                merge_into(keep, other)
                decided_pairs.add(tuple(sorted((keep.key, other.key))))  # type: ignore[arg-type]
                merged += 1
    elif groups:
        # No model: merge only near-certain duplicates (same category, same year, very similar titles).
        for (ka, kb), s in sorted(scores.items(), key=lambda kv: -kv[1]):
            a, b = by_key[ka], by_key[kb]
            if a.alive and b.alive and s >= 0.9 and a.ev.category == b.ev.category and a.year == b.year:
                merge_into(a, b)
                merged += 1
    flagged = 0
    for (ka, kb), s in scores.items():
        a, b = by_key[ka], by_key[kb]
        if a.alive and b.alive and s >= 0.5 and tuple(sorted((ka, kb))) not in decided_pairs:
            a.flags.add("possible_duplicate")
            b.flags.add("possible_duplicate")
            flagged += 1
    return {"groups": len(groups), "merged": merged, "flaggedPairs": flagged}


# ------------------------------------------------------------------------------------------ photos

CONF = {"high": 3, "medium": 2, "low": 1}
ROLE = {"depicts": 3, "document": 2, "related": 1}


def _photo_unit(pid: str) -> int:
    try:
        return int(pid.split("-", 1)[0][1:])
    except (ValueError, IndexError):
        return -1


def _link_score(w: WorkEvent, conf: str, role: str, pid: str) -> float:
    unit = _photo_unit(pid)
    prox = 0.0
    if unit in w.units:
        prox = 2.0
    elif any(abs(unit - u) <= 1 for u in w.units):
        prox = 1.0
    return CONF.get(conf, 1) * 10 + ROLE.get(role, 1) + prox


async def assign_photos(
    events: List[WorkEvent],
    photos: Dict[str, DraftPhoto],
    unlinked_hint: Set[str],
    ai: Optional[ReconcileAI],
    chapter_of_unit: Optional[Dict[int, Optional[str]]] = None,
) -> Dict[str, int]:
    chapter_of_unit = chapter_of_unit or {}
    alive = [e for e in events if e.alive]
    best: Dict[str, Tuple[float, WorkEvent, str]] = {}
    for w in alive:
        for link in w.ev.photos:
            if link.photo_id not in photos:
                continue
            s = _link_score(w, link.confidence, link.role, link.photo_id)
            if link.photo_id not in best or s > best[link.photo_id][0]:
                best[link.photo_id] = (s, w, link.confidence)
    for pid, (s, w, conf) in best.items():
        p = photos[pid]
        if conf == "low":
            p.status, p.suggestedEventId, p.confidence = "tray", w.key, "low"
        else:
            p.status, p.eventId, p.confidence = "linked", w.key, conf  # type: ignore[assignment]

    second = [p for p in photos.values() if p.status == "tray" and p.kind != "decoration" and p.eventId is None]
    assigned_second = 0
    if second and ai is not None:
        for i in range(0, len(second), PHOTO_BATCH):
            batch = second[i:i + PHOTO_BATCH]
            cand_keys: Dict[str, WorkEvent] = {}
            for p in batch:
                for w in _candidates_for_photo(p, alive, chapter_of_unit):
                    cand_keys[w.key] = w
            if not cand_keys:
                continue
            briefs = [
                {"id": p.id, "unit": p.unit, "caption": p.caption, "caption_date": p.captionDate,
                 "people_named": p.peopleNamed, "shows": p.description}
                for p in batch
            ]
            results = await ai.assign_photos(briefs, [_event_brief(w) for w in cand_keys.values()])
            for r in results:
                p = photos.get(r.photo_id)
                w = cand_keys.get(r.event_id or "")
                if p is None or p.status != "tray":
                    continue
                if w is None:
                    continue
                if r.confidence in ("high", "medium"):
                    p.status, p.eventId, p.confidence = "linked", w.key, r.confidence
                    p.suggestedEventId = None
                    assigned_second += 1
                else:
                    p.suggestedEventId, p.confidence = w.key, "low"
    # Event photo lists: best first; the first "depicts"-quality photo is the cover.
    per_event: Dict[str, List[Tuple[float, DraftPhoto]]] = {}
    for p in photos.values():
        if p.status == "linked" and p.eventId:
            w = next((e for e in alive if e.key == p.eventId), None)
            if w is None:
                p.status, p.eventId = "tray", None
                continue
            link = next((l for l in w.ev.photos if l.photo_id == p.id), None)
            score = _link_score(w, p.confidence or "medium", link.role if link else "related", p.id) + (p.w * p.h) / 1e7
            per_event.setdefault(w.key, []).append((score, p))
    for w in alive:
        ranked = [p for _, p in sorted(per_event.get(w.key, []), key=lambda t: -t[0])]
        w.ev = w.ev.model_copy(update={"photos": []})
        setattr(w, "_draft_photos", [
            DraftEventPhoto(photoId=p.id, role="cover" if i == 0 else "gallery", confidence=p.confidence or "medium")
            for i, p in enumerate(ranked)
        ])
        if any((p.confidence or "medium") != "high" for p in ranked):
            w.flags.add("low_photo_confidence")
    linked = sum(1 for p in photos.values() if p.status == "linked")
    return {"linked": linked, "tray": sum(1 for p in photos.values() if p.status == "tray"), "secondPass": assigned_second}


def _caption_year(p: DraftPhoto) -> Optional[int]:
    m = re.search(r"(1[6-9]\d\d|20\d\d)", (p.captionDate or "") + " " + (p.caption or ""))
    return int(m.group(1)) if m else None


def _candidates_for_photo(p: DraftPhoto, events: Sequence[WorkEvent], chapter_of_unit: Dict[int, Optional[str]], limit: int = 8) -> List[WorkEvent]:
    year = _caption_year(p)
    named = _tokens(" ".join(p.peopleNamed) + " " + (p.caption or ""))
    chapter = chapter_of_unit.get(p.unit)
    scored = []
    for w in events:
        s = 0.0
        if any(abs(p.unit - u) <= 1 for u in w.units):
            s += 2.0
        elif any(abs(p.unit - u) <= 3 for u in w.units):
            s += 1.0
        if chapter is not None and w.chapter_id == chapter:
            s += 1.0
        if year is not None and w.year is not None and abs(year - w.year) <= 1:
            s += 1.5
        if named and _jaccard(named, _tokens(w.ev.title + " " + w.ev.summary + " " + w.ev.narrative[:300])) > 0:
            s += 1.0
        if s >= 1.0:
            scored.append((s, w))
    scored.sort(key=lambda t: -t[0])
    return [w for _, w in scored[:limit]]


def make_chapter_albums(
    events: List[WorkEvent],
    photos: Dict[str, DraftPhoto],
    bm: BookMapOutput,
    chapter_of_unit: Dict[int, Optional[str]],
    min_photos: int = 4,
) -> int:
    """Photos still in the tray (no confident event, no suggestion) are grouped per chapter into one album
    event ("Photos: <chapter>"), dated by the chapter's events and flagged for review. Photo-album chapters
    (family life, grandchildren) rarely map to single events; an album keeps them on the timeline."""
    by_chapter: Dict[str, List[DraftPhoto]] = {}
    for p in photos.values():
        if p.status == "tray" and p.kind in ("photo", "collage") and not p.suggestedEventId:
            ch = chapter_of_unit.get(p.unit)
            if ch:
                by_chapter.setdefault(ch, []).append(p)
    chapters = {c.id: c for c in bm.chapters}
    he = (bm.language or "").lower().startswith("he")
    made = 0
    for ch_id, items in by_chapter.items():
        ch = chapters.get(ch_id)
        if ch is None or not ch.include or len(items) < min_photos:
            continue
        years = sorted(w.year for w in events if w.alive and w.chapter_id == ch_id and w.year is not None)
        lanes = [w.ev.lane_id for w in events if w.alive and w.chapter_id == ch_id and w.ev.lane_id]
        year = years[len(years) // 2] if years else None
        key = f"album-{ch_id}"
        title = ((ALBUM_TITLE_HE if he else ALBUM_TITLE_EN) + ch.title)[:200]
        items.sort(key=lambda p: (p.unit, p.id))
        ev = ExtractedEvent(
            local_id=key, title=title, summary="", narrative="",
            evidence=[Evidence(unit=items[0].unit, quote=(items[0].caption or "")[:300] or title)],
            start=DateParts(year=year, precision="year", circa=True) if year else DateParts(),
            date_basis="inferred", category="family", importance=3,
            lane_id=max(set(lanes), key=lanes.count) if lanes else None,
            photos=[PhotoLink(photo_id=p.id, role="related", confidence="low") for p in items],
        )
        w = WorkEvent(key=key, ev=ev, chunk_id="albums", chapter_id=ch_id)
        normalize_dates(w, {})
        w.flags.add("photo_album")
        setattr(w, "_draft_photos", [
            DraftEventPhoto(photoId=p.id, role="cover" if i == 0 else "gallery", confidence="low") for i, p in enumerate(items)
        ])
        for p in items:
            p.status, p.eventId, p.confidence = "linked", key, "low"
        events.append(w)
        made += 1
    return made


# ------------------------------------------------------------------------------------------ build


@dataclass
class ReconcileInputs:
    import_id: str
    book_map: BookMapOutput
    units: List[UnitParse]
    reads: Dict[int, PageReadOutput]
    extracts: List[Tuple[ChunkPlan, ExtractOutput]]
    photo_sizes: Dict[str, Tuple[int, int]] = field(default_factory=dict)
    place_coords: Dict[str, Tuple[Optional[float], Optional[float], str]] = field(default_factory=dict)
    place_links: Dict[str, Dict[str, Any]] = field(default_factory=dict)  # {place_id: wiki link}
    lane_colors: Sequence[str] = ()


def build_photos(units: Sequence[UnitParse], reads: Dict[int, PageReadOutput], sizes: Dict[str, Tuple[int, int]]) -> Dict[str, DraftPhoto]:
    out: Dict[str, DraftPhoto] = {}
    for u in units:
        read = reads.get(u.index)
        for p in real_photos(read):
            pid = photo_id(u.index, p.ref)
            if sizes and pid not in sizes:
                continue  # never materialized (crop failed) -> not offered
            w, h = sizes.get(pid, (0, 0))
            out[pid] = DraftPhoto(
                id=pid, unit=u.index, box2d=list(p.box_2d or []), w=w, h=h, kind=p.kind,
                caption=p.caption, captionDate=p.caption_date_text, peopleNamed=list(p.people_named),
                description=p.description, status="tray",
            )
    return out


def _percentile(values: Sequence[int], q: float) -> int:
    vals = sorted(values)
    if not vals:
        return 0
    idx = min(len(vals) - 1, max(0, int(round(q * (len(vals) - 1)))))
    return vals[idx]


async def reconcile(inputs: ReconcileInputs, ai: Optional[ReconcileAI] = None) -> BookDraft:
    bm = inputs.book_map
    birth_years = {c.id: int(c.birth_year) for c in bm.cast if c.birth_year}
    units_by = {u.index: u for u in inputs.units}

    work: List[WorkEvent] = []
    for chunk, out in inputs.extracts:
        for ev in out.events:
            w = WorkEvent(key=ev.local_id, ev=ev, chunk_id=chunk.id, chapter_id=chunk.chapter_id)
            normalize_dates(w, birth_years)
            if any(is_kinship_only(n) for n in ev.unresolved_people):
                w.flags.add("unresolved_people")
            work.append(w)

    stats: Dict[str, Any] = {"extracted": len(work)}
    stats["dedupe"] = await dedupe(work, ai)

    photos = build_photos(inputs.units, inputs.reads, inputs.photo_sizes)
    unlinked_hint = {pid for _, out in inputs.extracts for pid in out.unlinked_photo_ids}
    chapter_of_unit: Dict[int, Optional[str]] = {}
    for ch in bm.chapters:
        for i in range(min(ch.first_unit, ch.last_unit), max(ch.first_unit, ch.last_unit) + 1):
            chapter_of_unit.setdefault(i, ch.id)
    stats["photos"] = await assign_photos(work, photos, unlinked_hint, ai, chapter_of_unit)
    stats["photos"]["albums"] = make_chapter_albums(work, photos, bm, chapter_of_unit)

    # Places
    place_entries: List[DraftPlaceEntry] = []
    place_by_id: Dict[str, DraftPlaceEntry] = {}
    for p in bm.places:
        lat, lng, source = inputs.place_coords.get(p.id, (p.lat, p.lng, "model" if p.lat is not None else "none"))
        entry = DraftPlaceEntry(
            id=p.id, name=p.name, query=p.geocode_query, lat=lat, lng=lng, source=source,  # type: ignore[arg-type]
            wiki=inputs.place_links.get(p.id),
        )
        place_entries.append(entry)
        place_by_id[p.id] = entry

    # Lanes
    colors = list(inputs.lane_colors) or LANE_PALETTE_FALLBACK
    lanes = [DraftLane(id=l.id, title=l.title, color=colors[i % len(colors)]) for i, l in enumerate(bm.lanes)]
    if not lanes:
        lanes = [DraftLane(id="main", title=bm.title or "Timeline", color=colors[0])]
    lane_people = {l.id: set(l.person_ids) for l in bm.lanes}
    lane_ids = {l.id for l in lanes}

    alive = [w for w in work if w.alive]
    alive.sort(key=lambda w: (_sort_key(w.date_from), min(w.units) if w.units else 0))
    events: List[DraftEvent] = []
    key_to_id: Dict[str, str] = {}
    for n, w in enumerate(alive, start=1):
        key_to_id[w.key] = f"bk-{n:04d}"
    for w in alive:
        ev = w.ev
        lane = ev.lane_id if ev.lane_id in lane_ids else None
        if lane is None:
            overlap = sorted(((len(set(ev.person_ids) & ppl), lid) for lid, ppl in lane_people.items()), reverse=True)
            lane = overlap[0][1] if overlap and overlap[0][0] > 0 else lanes[0].id
        place = None
        place_id = ev.place_ids[0] if ev.place_ids else None
        if place_id and place_id in place_by_id:
            pe = place_by_id[place_id]
            place = DraftPlace(name=pe.name, lat=pe.lat, lng=pe.lng, source=pe.source, wiki=pe.wiki)
            if pe.lat is None and inputs.place_coords:
                w.flags.add("place_uncertain")
        elif ev.place_text:
            place = DraftPlace(name=ev.place_text, source="none")
        refs = []
        for e in ev.evidence:
            u = units_by.get(e.unit)
            read = inputs.reads.get(e.unit)
            refs.append(DraftSourceRef(
                sourceId=u.source_id if u else "",
                unit=e.unit,
                printedPage="–".join(read.printed_page_numbers[:2]) if read and read.printed_page_numbers else None,
                snippet=e.quote,
            ))
        draft_photos = [
            dp.model_copy(update={"photoId": dp.photoId}) for dp in getattr(w, "_draft_photos", [])
        ]
        flags = sorted(w.flags)
        events.append(DraftEvent(
            id=key_to_id[w.key], status="accepted", needsReview=bool(flags), flags=flags,
            title=ev.title, summary=ev.summary, narrative=ev.narrative, dateText=ev.date_text, dateBasis=ev.date_basis,
            dateNote=ev.date_note, **{"from": DraftDate(**w.date_from) if w.date_from else None},
            to=DraftDate(**w.date_to) if w.date_to else None, isToPresent=bool(ev.ongoing), circa=w.circa,
            people=list(ev.person_ids), unresolvedPeople=list(ev.unresolved_people), placeId=place_id, place=place,
            category=ev.category, lane=lane, rank=max(1, min(10, ev.importance)),
            chapterId=w.chapter_id, sourceRefs=refs, photos=draft_photos,
            mergedFrom=[key_to_id.get(k, k) for k in w.merged_from],
            crossReference=ev.cross_reference, fromInfographic=ev.from_infographic,
        ))
    # photo -> event ids in draft id space
    for p in photos.values():
        if p.eventId:
            p.eventId = key_to_id.get(p.eventId)
            if p.eventId is None:
                p.status = "tray"
        if p.suggestedEventId:
            p.suggestedEventId = key_to_id.get(p.suggestedEventId)

    # Chapters with spans from their dated events (10th-90th percentile, robust to stray dates)
    chapters: List[DraftChapter] = []
    for ch in bm.chapters:
        years = [e.from_.year for e in events if e.chapterId == ch.id and e.from_ is not None]
        span_from = span_to = None
        if years:
            lo, hi = _percentile(years, 0.1), _percentile(years, 0.9)
            span_from = DraftDate(year=lo, precision="year")
            span_to = DraftDate(year=max(lo, hi), precision="year")
        chapters.append(DraftChapter(
            id=ch.id, title=ch.title, firstUnit=ch.first_unit, lastUnit=ch.last_unit, include=ch.include,
            **{"from": span_from}, to=span_to,
        ))

    cast = [
        DraftPerson(id=c.id, name=c.name, aliases=list(c.aliases), relation=c.relation_to_subjects,
                    birthYear=c.birth_year, deathYear=c.death_year)
        for c in bm.cast
    ]
    draft_units = []
    for u in inputs.units:
        read = inputs.reads.get(u.index)
        draft_units.append(DraftUnit(
            index=u.index, label=u.label or f"unit {u.index + 1}",
            printedPages=list(read.printed_page_numbers) if read else [], kind=u.kind, sourceId=u.source_id,
        ))
    stats.update({
        "events": len(events),
        "dated": sum(1 for e in events if e.from_ is not None),
        "needsReview": sum(1 for e in events if e.needsReview),
        "photos": {**stats["photos"], "total": len(photos)},
    })
    return BookDraft(
        importId=inputs.import_id, title=bm.title, description=bm.description, overview=bm.overview,
        language=bm.language, instructionsApplied=bm.instructions_applied, lanes=lanes, chapters=chapters,
        cast=cast, units=draft_units, places=place_entries, events=events,
        photos=sorted(photos.values(), key=lambda p: (p.unit, p.id)), stats=stats,
    )
