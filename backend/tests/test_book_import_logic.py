"""Book import: pure logic (Hebrew dates, date normalization, chunking, dedupe/merge, photo placement)."""

import asyncio

import pytest

from services.book_import.chunking import plan_chunks
from services.book_import.hebrew_dates import hebrew_year_value, parse_hebrew_date, to_gregorian
from services.book_import.reconcile import (
    ReconcileInputs, WorkEvent, candidate_groups, merge_into, normalize_dates, parts_to_date, reconcile,
)
from services.book_import.schemas.artifacts import ChunkPlan, UnitParse
from services.book_import.schemas.model_io import (
    BookMapOutput, CastMember, DateParts, Evidence, ExtractedEvent, ExtractOutput, HebrewDateParts, MapChapter,
    MapLane, MergeGroup, PageReadOutput, PhotoAssignment, PhotoLink, ReadPhoto, RelativeAge,
)


# ---------------------------------------------------------------- Hebrew dates

@pytest.mark.parametrize("text,expected", [
    ("אמא נולדה בו׳ באב תש״ד, 26.07.1944", (5704, 5, 6)),
    ("ט״ו בשבט תשכ״ג", (5723, 11, 15)),
    ('כ"ה באדר ב\' תש"ח', (5708, 13, 25)),
    ('י"ב בחשון תשל"ה', (5735, 8, 12)),
])
def test_parse_hebrew_date(text, expected):
    d = parse_hebrew_date(text)
    assert d is not None
    assert (d.year, d.month, d.day) == expected


def test_hebrew_year_forms():
    assert hebrew_year_value("תש״ד") == 5704
    assert hebrew_year_value("ה'תשכ\"ג") == 5723
    assert hebrew_year_value("התשכ״ג") == 5723


def test_bare_month_word_is_not_a_date():
    assert parse_hebrew_date("אבא של משה") is None


def test_to_gregorian():
    assert to_gregorian(5704, 5, 6) == (1944, 7, 26)
    assert to_gregorian(5723, 11, 15) == (1963, 2, 9)
    assert to_gregorian(5708, 13, 25) == (1948, 4, 5)
    y, m, d = to_gregorian(5723, None, None)
    assert (y, m, d) == (1962, None, None)


# ---------------------------------------------------------------- date normalization

def _ev(**kw):
    base = dict(local_id="c000-e001", title="Event", evidence=[Evidence(unit=1, quote="q")])
    base.update(kw)
    return ExtractedEvent(**base)


def test_parts_to_date_precisions():
    assert parts_to_date(DateParts(year=1944, month=7, day=26, precision="day"))[0] == {"year": 1944, "month": 7, "day": 26, "precision": "day"}
    assert parts_to_date(DateParts(year=1968, season="summer", precision="season")) == ({"year": 1968, "month": 7, "day": None, "precision": "month"}, True)
    assert parts_to_date(DateParts(year=1957, precision="decade"))[0]["year"] == 1950
    assert parts_to_date(DateParts(year=1944, month=2, day=31, precision="day"))[0]["precision"] == "month"
    assert parts_to_date(DateParts(precision="unknown")) == (None, False)


def test_hebrew_date_fills_missing_gregorian():
    w = WorkEvent(key="k", ev=_ev(date_text="בו׳ באב תש״ד", date_basis="hebrew"), chunk_id="c", chapter_id=None)
    normalize_dates(w, {})
    assert w.date_from == {"year": 1944, "month": 7, "day": 26, "precision": "day"}
    assert "hebrew_mismatch" not in w.flags


def test_hebrew_mismatch_is_flagged_and_explicit_gregorian_kept():
    w = WorkEvent(key="k", ev=_ev(date_text="בו׳ באב תש״ד, 26.07.1945", date_basis="explicit",
                                  start=DateParts(year=1945, month=7, day=26, precision="day")), chunk_id="c", chapter_id=None)
    normalize_dates(w, {})
    assert "hebrew_mismatch" in w.flags
    assert w.date_from["year"] == 1945  # the written Gregorian date wins, the review flags it


def test_hebrew_conversion_wins_when_model_made_up_gregorian():
    w = WorkEvent(key="k", ev=_ev(date_text="בו׳ באב תש״ד", date_basis="hebrew",
                                  start=DateParts(year=1943, month=8, day=1, precision="day"),
                                  hebrew_start=HebrewDateParts(year=5704, month="Av", day=6)), chunk_id="c", chapter_id=None)
    normalize_dates(w, {})
    assert w.date_from["year"] == 1944 and "hebrew_mismatch" in w.flags


def test_relative_age_resolves_from_birth_year():
    w = WorkEvent(key="k", ev=_ev(date_text="בגיל 18", relative_age=RelativeAge(person_id="p1", age_years=18)), chunk_id="c", chapter_id=None)
    normalize_dates(w, {"p1": 1944})
    assert w.date_from["year"] == 1962 and w.circa and "date_inferred" in w.flags


def test_undated_flag():
    w = WorkEvent(key="k", ev=_ev(), chunk_id="c", chapter_id=None)
    normalize_dates(w, {})
    assert w.date_from is None and "undated" in w.flags


# ---------------------------------------------------------------- chunking

def _map(chapters, **kw):
    return BookMapOutput(title="t", description="d", overview="o", language="he", narrator_perspective="n", chapters=chapters, **kw)


def test_plan_chunks_respects_chapters_limits_and_skips():
    bm = _map([
        MapChapter(id="ch1", title="A", first_unit=0, last_unit=2, include=False, skip_reason="toc"),
        MapChapter(id="ch2", title="B", first_unit=3, last_unit=20),
    ])
    chunks = plan_chunks(bm, list(range(0, 25)), lambda i: 1000, skip={10}, max_units=6)
    covered = [u for c in chunks for u in c.units]
    assert 0 not in covered and 10 not in covered  # excluded chapter + skip unit
    assert all(len(c.units) <= 6 for c in chunks)
    assert {21, 22, 23, 24} <= set(covered)  # units outside every chapter are not dropped
    assert chunks[1].overlap_units == [chunks[0].units[-1]]
    assert chunks[0].overlap_units == []  # previous unit belongs to an excluded chapter


def test_plan_chunks_char_budget():
    bm = _map([MapChapter(id="ch", title="A", first_unit=0, last_unit=9)])
    chunks = plan_chunks(bm, list(range(10)), lambda i: 20_000, max_chars=30_000)
    assert all(len(c.units) == 1 for c in chunks)


# ---------------------------------------------------------------- dedupe / merge / photos

def _work(key, title, year, people, unit, **kw):
    ev = _ev(local_id=key, title=title, summary=kw.pop("summary", ""), person_ids=people,
             evidence=[Evidence(unit=unit, quote=f"quote {key}")],
             start=DateParts(year=year, precision="year") if year else DateParts(), **kw)
    w = WorkEvent(key=key, ev=ev, chunk_id="c", chapter_id=None)
    normalize_dates(w, {})
    return w


def test_candidate_groups_need_shared_people_and_close_years():
    a = _work("a", "העלייה לישראל", 1968, ["p1"], 10, category="immigration")
    b = _work("b", "עלייה לישראל עם הילדים", 1968, ["p1", "p2"], 40, category="immigration")
    c = _work("c", "העלייה לישראל", 1990, ["p1"], 50, category="immigration")  # 22 years later
    d = _work("d", "העלייה לישראל", 1968, ["p9"], 60, category="immigration")  # nobody shared
    groups, _ = candidate_groups([a, b, c, d])
    keys = [sorted(w.key for w in g) for g in groups]
    assert ["a", "b"] in keys
    assert not any("c" in g or "d" in g for g in keys)


def test_merge_keeps_union_and_prefers_full_telling():
    full = _work("full", "Escape to Switzerland", 1942, ["p1"], 70, narrative="long story " * 20,
                 photos=[PhotoLink(photo_id="u0070-p1", role="depicts", confidence="high")])
    xref = _work("xref", "Escape to Switzerland", 1942, ["p1", "p2"], 12, cross_reference=True,
                 photos=[PhotoLink(photo_id="u0012-p2", role="related", confidence="medium")])
    merge_into(xref, full)  # called with the cross-reference as keep: the full telling becomes the base
    assert not full.alive
    assert xref.ev.cross_reference is False
    assert {p.photo_id for p in xref.ev.photos} == {"u0070-p1", "u0012-p2"}
    assert set(xref.ev.person_ids) == {"p1", "p2"}
    assert {e.unit for e in xref.ev.evidence} == {12, 70}


class FakeAI:
    def __init__(self, merges=None, assignments=None):
        self.merges = merges or []
        self.assignments = assignments or []
        self.dedupe_calls = 0
        self.photo_calls = 0

    async def dedupe(self, groups):
        self.dedupe_calls += 1
        return self.merges

    async def assign_photos(self, photos, candidates):
        self.photo_calls += 1
        return self.assignments


def _unit(i):
    return UnitParse(index=i, source_id="s0", kind="born_digital", label=f"PDF p.{i + 1}")


def test_reconcile_end_to_end_with_fake_ai():
    bm = _map(
        [MapChapter(id="ch1", title="Life", first_unit=0, last_unit=3)],
        cast=[CastMember(id="p1", name="Judy", birth_year=1944)],
        lanes=[MapLane(id="mom", title="Mom", person_ids=["p1"])],
    )
    reads = {
        1: PageReadOutput(page_type="mixed", photos=[ReadPhoto(ref="P1", kind="photo", caption="Judy 1949", box_2d=[0, 0, 500, 500]),
                                                     ReadPhoto(ref="P2", kind="decoration", box_2d=[0, 0, 100, 100])]),
        2: PageReadOutput(page_type="photos", photos=[ReadPhoto(ref="P1", kind="photo", caption="no match", box_2d=[0, 0, 500, 500])]),
    }
    chunk = ChunkPlan(id="c000", chapter_id="ch1", units=[0, 1, 2, 3])
    e1 = _ev(local_id="c000-e001", title="Born in Monthey", person_ids=["p1"], category="birth", importance=10,
             evidence=[Evidence(unit=1, quote="נולדה")], start=DateParts(year=1944, month=7, day=26, precision="day"),
             date_basis="explicit")
    e2 = _ev(local_id="c000-e002", title="Emigrated to the USA", person_ids=["p1"], category="immigration",
             evidence=[Evidence(unit=1, quote="היגרה")], start=DateParts(year=1949, month=6, day=7, precision="day"),
             date_basis="explicit", photos=[PhotoLink(photo_id="u0001-p1", role="depicts", confidence="high")])
    e3 = _ev(local_id="c000-e003", title="Emigrated to America", person_ids=["p1"], category="immigration",
             evidence=[Evidence(unit=2, quote="עברו לאמריקה")], start=DateParts(year=1949, precision="year"),
             date_basis="inferred")
    ai = FakeAI(merges=[MergeGroup(keep_id="c000-e002", merge_ids=["c000-e003"])],
                assignments=[PhotoAssignment(photo_id="u0002-p1", event_id="c000-e001", confidence="low")])
    draft = asyncio.run(reconcile(ReconcileInputs(import_id="imp", book_map=bm, units=[_unit(i) for i in range(4)],
                                                  reads=reads, extracts=[(chunk, ExtractOutput(events=[e1, e2, e3]))]), ai))
    assert [e.id for e in draft.events] == ["bk-0001", "bk-0002"]
    migr = draft.events[1]
    assert migr.mergedFrom and {r.unit for r in migr.sourceRefs} == {1, 2}
    assert migr.photos[0].photoId == "u0001-p1" and migr.photos[0].role == "cover"
    assert migr.lane == "mom"
    photos = {p.id: p for p in draft.photos}
    assert "u0001-p2" not in photos  # decorations are never offered
    assert photos["u0001-p1"].status == "linked" and photos["u0001-p1"].eventId == "bk-0002"
    assert photos["u0002-p1"].status == "tray" and photos["u0002-p1"].suggestedEventId == "bk-0001"
    assert draft.chapters[0].from_.year == 1944
    assert ai.dedupe_calls == 1 and ai.photo_calls == 1


# ---------------------------------------------------------------- draft ops (shared with the frontend)

def test_draft_ops_vectors_are_current():
    """The JS twin (frontend/src/utils/bookImport/draftModel.js) is tested against the same file;
    regenerate it with tests/fixtures/book_import/make_draft_ops_vectors.py after changing draft_ops."""
    import json
    from pathlib import Path

    from services.book_import.draft_ops import OpError, apply_ops

    data = json.loads((Path(__file__).parent / "fixtures" / "book_import" / "draft_ops_vectors.json").read_text(encoding="utf-8"))
    for case in data["cases"]:
        if case.get("error"):
            with pytest.raises(OpError):
                apply_ops(data["draft"], case["ops"])
        else:
            assert apply_ops(data["draft"], case["ops"]) == case["expected"], case["name"]
