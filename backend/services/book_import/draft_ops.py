"""Review edits as small operations on the draft (a plain dict, as stored and as sent to the client).

The same operations are implemented in `frontend/src/utils/bookImport/draftModel.js`; both run the
shared vectors in `backend/tests/fixtures/book_import/draft_ops_vectors.json`, so the server and the
browser never disagree about what an edit means.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, Iterable, List, Optional

MAX_OPS = 500
EVENT_PATCH_KEYS = {
    "title", "summary", "narrative", "from", "to", "isToPresent", "circa", "people", "unresolvedPeople",
    "place", "placeId", "category", "lane", "rank", "dateText",
}
DATE_FLAGS = ("undated", "date_inferred", "hebrew_mismatch")


class OpError(ValueError):
    pass


def _events(draft: Dict[str, Any]) -> List[Dict[str, Any]]:
    return draft.setdefault("events", [])


def _photos(draft: Dict[str, Any]) -> List[Dict[str, Any]]:
    return draft.setdefault("photos", [])


def _event(draft: Dict[str, Any], eid: Any) -> Dict[str, Any]:
    for e in _events(draft):
        if e.get("id") == eid:
            return e
    raise OpError(f"unknown event {eid!r}")


def _photo(draft: Dict[str, Any], pid: Any) -> Dict[str, Any]:
    for p in _photos(draft):
        if p.get("id") == pid:
            return p
    raise OpError(f"unknown photo {pid!r}")


def _set_flags(e: Dict[str, Any], flags: Iterable[str]) -> None:
    e["flags"] = sorted(set(flags))
    e["needsReview"] = bool(e["flags"])


def _remove_flags(e: Dict[str, Any], *names: str) -> None:
    _set_flags(e, [f for f in e.get("flags") or [] if f not in names])


def _fix_cover(e: Dict[str, Any]) -> None:
    photos = e.get("photos") or []
    for i, p in enumerate(photos):
        p["role"] = "cover" if i == 0 else "gallery"


def _detach_photo(draft: Dict[str, Any], pid: str) -> None:
    for e in _events(draft):
        before = e.get("photos") or []
        after = [p for p in before if p.get("photoId") != pid]
        if len(after) != len(before):
            e["photos"] = after
            _fix_cover(e)


def _valid_date(d: Any) -> Optional[Dict[str, Any]]:
    if d is None:
        return None
    if not isinstance(d, dict) or not isinstance(d.get("year"), int):
        raise OpError("dates need an integer year")
    precision = d.get("precision") or ("day" if d.get("day") else "month" if d.get("month") else "year")
    if precision not in ("day", "month", "year", "decade", "century"):
        raise OpError(f"bad precision {precision!r}")
    out = {"year": d["year"], "month": d.get("month"), "day": d.get("day"), "precision": precision}
    if out["month"] is not None and not (isinstance(out["month"], int) and 1 <= out["month"] <= 12):
        raise OpError("bad month")
    if out["day"] is not None and not (isinstance(out["day"], int) and 1 <= out["day"] <= 31):
        raise OpError("bad day")
    return out


def apply_op(draft: Dict[str, Any], op: Dict[str, Any]) -> None:
    kind = op.get("op")
    if kind == "event.update":
        e = _event(draft, op.get("id"))
        patch = op.get("patch") or {}
        unknown = set(patch) - EVENT_PATCH_KEYS
        if unknown:
            raise OpError(f"cannot edit {sorted(unknown)}")
        for k, v in patch.items():
            if k in ("from", "to"):
                v = _valid_date(v)
            if k == "rank":
                v = max(1, min(10, int(v)))
            e[k] = copy.deepcopy(v)
        if "from" in patch or "to" in patch or "dateText" in patch:
            _remove_flags(e, *DATE_FLAGS)
            if e.get("from") is None:
                _set_flags(e, list(e.get("flags") or []) + ["undated"])
        if "place" in patch or "placeId" in patch:
            _remove_flags(e, "place_uncertain")
        if "people" in patch or "unresolvedPeople" in patch:
            _remove_flags(e, "unresolved_people")
    elif kind == "event.markReviewed":
        for eid in op.get("ids") or []:
            _set_flags(_event(draft, eid), [])
    elif kind == "event.setStatus":
        status = op.get("status")
        if status not in ("accepted", "rejected"):
            raise OpError("status must be accepted or rejected")
        for eid in op.get("ids") or []:
            _event(draft, eid)["status"] = status
    elif kind == "event.merge":
        target = _event(draft, op.get("targetId"))
        sources = [_event(draft, sid) for sid in op.get("sourceIds") or [] if sid != target["id"]]
        for s in sources:
            have = {p["photoId"] for p in target.get("photos") or []}
            target.setdefault("photos", []).extend(p for p in s.get("photos") or [] if p["photoId"] not in have)
            refs = {(r.get("unit"), r.get("snippet")) for r in target.get("sourceRefs") or []}
            target.setdefault("sourceRefs", []).extend(r for r in s.get("sourceRefs") or [] if (r.get("unit"), r.get("snippet")) not in refs)
            target["people"] = list(dict.fromkeys((target.get("people") or []) + (s.get("people") or [])))
            target["mergedFrom"] = list(dict.fromkeys((target.get("mergedFrom") or []) + [s["id"]] + (s.get("mergedFrom") or [])))
            for p in _photos(draft):
                if p.get("eventId") == s["id"]:
                    p["eventId"] = target["id"]
                if p.get("suggestedEventId") == s["id"]:
                    p["suggestedEventId"] = target["id"]
        _fix_cover(target)
        _remove_flags(target, "possible_duplicate")
        drop = {s["id"] for s in sources}
        draft["events"] = [e for e in _events(draft) if e["id"] not in drop]
    elif kind == "event.create":
        ev = copy.deepcopy(op.get("event") or {})
        if not ev.get("id") or not ev.get("title"):
            raise OpError("a new event needs an id and a title")
        if any(e["id"] == ev["id"] for e in _events(draft)):
            raise OpError("duplicate event id")
        ev["from"] = _valid_date(ev.get("from"))
        ev["to"] = _valid_date(ev.get("to"))
        ev.setdefault("status", "accepted")
        ev.setdefault("photos", [])
        ev.setdefault("sourceRefs", [])
        ev.setdefault("people", [])
        _set_flags(ev, [] if ev.get("from") else ["undated"])
        _events(draft).append(ev)
    elif kind == "photo.assign":
        p = _photo(draft, op.get("photoId"))
        e = _event(draft, op.get("eventId"))
        _detach_photo(draft, p["id"])
        entry = {"photoId": p["id"], "role": "gallery", "confidence": "high"}
        if op.get("role") == "cover":
            e.setdefault("photos", []).insert(0, entry)
        else:
            e.setdefault("photos", []).append(entry)
        _fix_cover(e)
        p.update({"status": "linked", "eventId": e["id"], "confidence": "high", "suggestedEventId": None})
    elif kind == "photo.unassign":
        for pid in op.get("photoIds") or []:
            p = _photo(draft, pid)
            _detach_photo(draft, pid)
            p.update({"status": "tray", "eventId": None})
    elif kind == "photo.exclude":
        excluded = bool(op.get("excluded", True))
        for pid in op.get("photoIds") or []:
            p = _photo(draft, pid)
            if excluded:
                _detach_photo(draft, pid)
                p.update({"status": "excluded", "eventId": None})
            elif p.get("status") == "excluded":
                p["status"] = "tray"
    elif kind == "photo.reorder":
        e = _event(draft, op.get("eventId"))
        order = list(op.get("photoIds") or [])
        current = {p["photoId"]: p for p in e.get("photos") or []}
        if set(order) != set(current):
            raise OpError("reorder must list exactly the event's photos")
        e["photos"] = [current[pid] for pid in order]
        _fix_cover(e)
    elif kind == "person.rename":
        name = str(op.get("name") or "").strip()
        if not name:
            raise OpError("a name is required")
        for c in draft.setdefault("cast", []):
            if c.get("id") == op.get("id"):
                c["name"] = name[:200]
                break
        else:
            raise OpError(f"unknown person {op.get('id')!r}")
    elif kind == "person.merge":
        target_id = op.get("targetId")
        cast = draft.setdefault("cast", [])
        target = next((c for c in cast if c.get("id") == target_id), None)
        if target is None:
            raise OpError(f"unknown person {target_id!r}")
        sources = [sid for sid in op.get("sourceIds") or [] if sid != target_id]
        for c in cast:
            if c.get("id") in sources:
                target["aliases"] = list(dict.fromkeys((target.get("aliases") or []) + [c.get("name")] + (c.get("aliases") or [])))
        draft["cast"] = [c for c in cast if c.get("id") not in sources]
        for e in _events(draft):
            if any(pid in sources for pid in e.get("people") or []):
                e["people"] = list(dict.fromkeys(target_id if pid in sources else pid for pid in e["people"]))
    elif kind == "person.resolveAlias":
        alias, pid = op.get("alias"), op.get("personId")
        if not any(c.get("id") == pid for c in draft.get("cast") or []):
            raise OpError(f"unknown person {pid!r}")
        for eid in op.get("eventIds") or []:
            e = _event(draft, eid)
            e["unresolvedPeople"] = [n for n in e.get("unresolvedPeople") or [] if n != alias]
            if pid not in (e.get("people") or []):
                e.setdefault("people", []).append(pid)
            _remove_flags(e, "unresolved_people")
    elif kind == "lane.upsert":
        lane = op.get("lane") or {}
        if not lane.get("id") or not str(lane.get("title") or "").strip():
            raise OpError("a lane needs an id and a title")
        lanes = draft.setdefault("lanes", [])
        for l in lanes:
            if l["id"] == lane["id"]:
                l.update({k: lane[k] for k in ("title", "color") if k in lane})
                break
        else:
            if len(lanes) >= 12:
                raise OpError("too many lanes")
            lanes.append({"id": lane["id"], "title": lane["title"], "color": lane.get("color")})
    elif kind == "lane.delete":
        lanes = draft.setdefault("lanes", [])
        lid, to = op.get("id"), op.get("reassignTo")
        if not any(l["id"] == lid for l in lanes):
            raise OpError(f"unknown lane {lid!r}")
        if len(lanes) <= 1:
            raise OpError("the last lane can't be deleted")
        if not any(l["id"] == to for l in lanes if l["id"] != lid):
            raise OpError("reassignTo must be another lane")
        draft["lanes"] = [l for l in lanes if l["id"] != lid]
        for e in _events(draft):
            if e.get("lane") == lid:
                e["lane"] = to
    elif kind == "chapter.rename":
        for ch in draft.setdefault("chapters", []):
            if ch["id"] == op.get("id"):
                ch["title"] = str(op.get("title") or ch["title"])[:300]
                break
        else:
            raise OpError(f"unknown chapter {op.get('id')!r}")
    elif kind == "chapter.setStatus":
        status = op.get("status")
        if status not in ("accepted", "rejected"):
            raise OpError("status must be accepted or rejected")
        for ch in draft.setdefault("chapters", []):
            if ch["id"] == op.get("chapterId"):
                ch["status"] = status
                break
        else:
            raise OpError(f"unknown chapter {op.get('chapterId')!r}")
        for e in _events(draft):
            if e.get("chapterId") == op.get("chapterId"):
                e["status"] = status
    elif kind == "timeline.update":
        for k in ("title", "description", "overview"):
            if k in op:
                draft[k] = str(op[k] or "")[: (600 if k == "title" else 80000)]
    else:
        raise OpError(f"unknown op {kind!r}")


def apply_ops(draft: Dict[str, Any], ops: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Applies ops to a COPY of the draft (all or nothing)."""
    if len(ops) > MAX_OPS:
        raise OpError(f"at most {MAX_OPS} operations per request")
    out = copy.deepcopy(draft)
    for op in ops:
        if not isinstance(op, dict):
            raise OpError("each operation must be an object")
        apply_op(out, op)
    stats = out.setdefault("stats", {})
    stats["events"] = len(out.get("events") or [])
    stats["needsReview"] = sum(1 for e in out.get("events") or [] if e.get("needsReview") and e.get("status") == "accepted")
    return out
