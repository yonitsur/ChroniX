"""Regenerates draft_ops_vectors.json (expected outputs come from the Python implementation; the JS
implementation must match them). Run: python tests/fixtures/book_import/make_draft_ops_vectors.py"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2]))

from services.book_import.draft_ops import OpError, apply_ops  # noqa: E402

DRAFT = {
    "v": 1, "title": "Book", "description": "", "overview": "",
    "lanes": [{"id": "mom", "title": "Mom", "color": "#111"}, {"id": "dad", "title": "Dad", "color": "#222"}],
    "chapters": [{"id": "ch1", "title": "Childhood", "firstUnit": 0, "lastUnit": 3, "include": True, "status": "accepted"},
                 {"id": "ch2", "title": "Recipes", "firstUnit": 4, "lastUnit": 5, "include": True, "status": "accepted"}],
    "cast": [{"id": "p1", "name": "Judy", "aliases": ["Mom"]}, {"id": "p2", "name": "Meir", "aliases": []},
             {"id": "p3", "name": "M. Singer", "aliases": []}],
    "events": [
        {"id": "bk-0001", "status": "accepted", "needsReview": True, "flags": ["date_inferred", "possible_duplicate"], "title": "Born",
         "from": {"year": 1944, "month": None, "day": None, "precision": "year"}, "people": ["p1"], "unresolvedPeople": ["Mom"],
         "lane": "mom", "chapterId": "ch1", "photos": [{"photoId": "u0001-p1", "role": "cover", "confidence": "high"}],
         "sourceRefs": [{"sourceId": "s0", "unit": 1, "snippet": "born"}], "mergedFrom": []},
        {"id": "bk-0002", "status": "accepted", "needsReview": True, "flags": ["possible_duplicate"], "title": "Birth in Monthey",
         "from": {"year": 1944, "month": 7, "day": 26, "precision": "day"}, "people": ["p1", "p3"], "lane": "mom", "chapterId": "ch1",
         "photos": [{"photoId": "u0002-p1", "role": "cover", "confidence": "medium"}],
         "sourceRefs": [{"sourceId": "s0", "unit": 2, "snippet": "26.07.1944"}], "mergedFrom": []},
        {"id": "bk-0003", "status": "accepted", "needsReview": True, "flags": ["undated"], "title": "Kugel", "from": None,
         "people": [], "lane": "dad", "chapterId": "ch2", "photos": [], "sourceRefs": [], "mergedFrom": []},
    ],
    "photos": [
        {"id": "u0001-p1", "unit": 1, "status": "linked", "eventId": "bk-0001"},
        {"id": "u0002-p1", "unit": 2, "status": "linked", "eventId": "bk-0002"},
        {"id": "u0003-p1", "unit": 3, "status": "tray", "eventId": None, "suggestedEventId": "bk-0002"},
        {"id": "u0003-p2", "unit": 3, "status": "tray", "eventId": None},
    ],
    "stats": {},
}

CASES = [
    ("update title and date clears date flags", [{"op": "event.update", "id": "bk-0001", "patch": {"title": "Judy is born", "from": {"year": 1944, "month": 7, "precision": "month"}}}]),
    ("clearing a date marks undated", [{"op": "event.update", "id": "bk-0002", "patch": {"from": None}}]),
    ("rank is clamped", [{"op": "event.update", "id": "bk-0001", "patch": {"rank": 42}}]),
    ("unknown patch key", [{"op": "event.update", "id": "bk-0001", "patch": {"photos": []}}]),
    ("bad month", [{"op": "event.update", "id": "bk-0001", "patch": {"from": {"year": 1944, "month": 13}}}]),
    ("mark reviewed", [{"op": "event.markReviewed", "ids": ["bk-0001", "bk-0002"]}]),
    ("reject two", [{"op": "event.setStatus", "ids": ["bk-0001", "bk-0003"], "status": "rejected"}]),
    ("merge duplicates", [{"op": "event.merge", "targetId": "bk-0002", "sourceIds": ["bk-0001"]}]),
    ("create event", [{"op": "event.create", "event": {"id": "bk-u1", "title": "New", "from": {"year": 1970}, "lane": "dad"}}]),
    ("create undated event", [{"op": "event.create", "event": {"id": "bk-u2", "title": "Someday"}}]),
    ("duplicate create", [{"op": "event.create", "event": {"id": "bk-0001", "title": "Dup"}}]),
    ("assign tray photo as cover", [{"op": "photo.assign", "photoId": "u0003-p1", "eventId": "bk-0002", "role": "cover"}]),
    ("move photo between events", [{"op": "photo.assign", "photoId": "u0001-p1", "eventId": "bk-0002"}]),
    ("unassign", [{"op": "photo.unassign", "photoIds": ["u0002-p1"]}]),
    ("exclude and restore", [{"op": "photo.exclude", "photoIds": ["u0001-p1", "u0003-p2"]}, {"op": "photo.exclude", "photoIds": ["u0003-p2"], "excluded": False}]),
    ("reorder", [{"op": "photo.assign", "photoId": "u0003-p2", "eventId": "bk-0001"}, {"op": "photo.reorder", "eventId": "bk-0001", "photoIds": ["u0003-p2", "u0001-p1"]}]),
    ("bad reorder", [{"op": "photo.reorder", "eventId": "bk-0001", "photoIds": ["u0003-p2"]}]),
    ("rename person", [{"op": "person.rename", "id": "p2", "name": "  Meir Israel Singer "}]),
    ("merge people", [{"op": "person.merge", "targetId": "p2", "sourceIds": ["p3"]}]),
    ("resolve alias", [{"op": "person.resolveAlias", "eventIds": ["bk-0001"], "alias": "Mom", "personId": "p1"}]),
    ("lane upsert and delete", [{"op": "lane.upsert", "lane": {"id": "family", "title": "Family"}}, {"op": "lane.delete", "id": "dad", "reassignTo": "family"}]),
    ("lane rename", [{"op": "lane.upsert", "lane": {"id": "mom", "title": "Judy"}}]),
    ("delete last lane", [{"op": "lane.delete", "id": "mom", "reassignTo": "dad"}, {"op": "lane.delete", "id": "dad", "reassignTo": "mom"}]),
    ("reject chapter", [{"op": "chapter.setStatus", "chapterId": "ch2", "status": "rejected"}]),
    ("rename chapter", [{"op": "chapter.rename", "id": "ch1", "title": "Early years"}]),
    ("timeline text", [{"op": "timeline.update", "title": "The Singer Family", "overview": "Hello"}]),
    ("unknown op", [{"op": "event.explode", "id": "bk-0001"}]),
    ("all or nothing", [{"op": "event.update", "id": "bk-0001", "patch": {"title": "kept?"}}, {"op": "event.update", "id": "missing", "patch": {}}]),
]


def main() -> None:
    cases = []
    for name, ops in CASES:
        try:
            expected = apply_ops(DRAFT, ops)
            cases.append({"name": name, "ops": ops, "expected": expected})
        except OpError:
            cases.append({"name": name, "ops": ops, "error": True})
    out = HERE / "draft_ops_vectors.json"
    out.write_text(json.dumps({"draft": DRAFT, "cases": cases}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(cases)} cases to {out}")


if __name__ == "__main__":
    main()
