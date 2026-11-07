"""Book import: sources, pipeline stages, runner lifecycle and HTTP routes against the local store with a
fake model (no network). Fixture PDFs/DOCX files are generated per test."""

import asyncio
import dataclasses
import io
import json
import re
import uuid
from typing import Any, Dict, List

import pypdfium2 as pdfium
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from services.book_import import api as bi_api
from services.book_import import draft_ops
from services.book_import.config import load_config
from services.book_import.pipeline import Host, Paths, source_key, stage_read
from services.book_import.runner import BookImportRunner
from services.book_import.schemas.model_io import (
    BookMapOutput, CastMember, DateParts, DedupeOutput, Evidence, ExtractedEvent, ExtractOutput, FastExtractOutput,
    MapChapter, MapLane, MapPlace, PageReadOutput, PhotoAssignOutput, PhotoLink, ReadBlock, ReadPhoto,
)
from services.book_import.sources import pdf as pdfsrc
from services.book_import.sources.docx import parse_docx
from services.book_import.store import LocalStore, LeaseLost, import_prefix, new_row


# ------------------------------------------------------------------ fixtures

def _jpeg(color, size=(400, 300)) -> bytes:
    img = Image.new("RGB", size, color)
    d = ImageDraw.Draw(img)
    for i in range(0, size[0], 20):  # texture so the photo isn't "near flat"
        d.line([(i, 0), (size[0] - i, size[1])], fill=(255 - color[0], 120, color[2]), width=3)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def make_pdf(pages: int = 2) -> bytes:
    pdf = pdfium.PdfDocument.new()
    for n in range(pages):
        page = pdf.new_page(600, 800)
        for k in range(2):
            img = pdfium.PdfImage.new(pdf)
            img.load_jpeg(io.BytesIO(_jpeg(((60 * n + 40 * k) % 255, 90, 160))), inline=False)
            img.set_matrix(pdfium.PdfMatrix().scale(240, 180).translate(50 + 270 * k, 450))
            page.insert_obj(img)
        page.gen_content()
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


def make_docx() -> bytes:
    import docx

    d = docx.Document()
    d.add_heading("Family", level=1)
    d.add_paragraph("Rachel was born in 1950 in Haifa.")
    png = io.BytesIO()
    Image.open(io.BytesIO(_jpeg((30, 140, 90)))).save(png, format="PNG")
    png.seek(0)
    d.add_picture(png)
    d.add_paragraph("Rachel as a baby, 1950", style="Caption")
    d.add_paragraph("In 1972 she married David.")
    out = io.BytesIO()
    d.save(out)
    return out.getvalue()


class FakeModel:
    """Schema-keyed fake for `call_structured` that builds answers from the request text."""

    def __init__(self):
        self.calls: List[str] = []

    async def __call__(self, *, schema, parts, label="", meter=None, **kw):
        self.calls.append(label)
        if meter is not None:  # like the real call: every response is metered
            meter.add("gemini-3.8-flash", {"prompt_tokens": 1000, "cached_tokens": 200, "candidates_tokens": 300, "thoughts_tokens": 50}, label=label)
        text = "\n".join(getattr(p, "text", "") or "" for p in parts)
        units = sorted({int(u) for u in re.findall(r"\[\[U(\d+)", text)})
        if schema is PageReadOutput:
            refs = re.findall(r"- (P\d+) box=", text) or re.findall(r"Picture (P\d+):", text)
            return PageReadOutput(
                page_type="mixed", printed_page_numbers=["1"],
                blocks=[ReadBlock(kind="paragraph", text="Rachel was born in 1950 in Haifa.")],
                photos=[ReadPhoto(ref=r, kind="photo", caption=f"Rachel {1950 + i}", caption_date_text=str(1950 + i)) for i, r in enumerate(refs)],
            )
        if schema is BookMapOutput:
            return BookMapOutput(
                title="The Family", description="d", overview="o", language="en", narrator_perspective="children",
                cast=[CastMember(id="p1", name="Rachel Cohen", aliases=["Mom"], birth_year=1950)],
                chapters=[MapChapter(id="ch1", title="Life", first_unit=min(units or [0]), last_unit=max(units or [0]))],
                lanes=[MapLane(id="mom", title="Rachel", person_ids=["p1"])],
                places=[MapPlace(id="pl1", name="Haifa", geocode_query="Haifa, Israel", lat=32.8, lng=35.0)],
            )
        events = []
        photo_ids = re.findall(r"\[photo (u\d{4}-p\d+)\]", text)
        for i, u in enumerate(units):
            events.append(ExtractedEvent(
                local_id=f"x{i}", title=f"Event on unit {u}", summary="s", narrative="n",
                evidence=[Evidence(unit=u, quote="Rachel was born")], date_text="1950",
                start=DateParts(year=1950 + u, precision="year"), date_basis="explicit", person_ids=["p1"],
                place_ids=["pl1"], category="family", lane_id="mom", importance=6,
                photos=[PhotoLink(photo_id=pid, role="depicts", confidence="high") for pid in photo_ids if pid.startswith(f"u{u:04d}")],
            ))
        if schema is ExtractOutput:
            return ExtractOutput(events=events)
        if schema is FastExtractOutput:
            return FastExtractOutput(
                title="Short story", language="en", cast=[CastMember(id="p1", name="Rachel Cohen")],
                lanes=[MapLane(id="main", title="Rachel")], places=[MapPlace(id="pl1", name="Haifa", geocode_query="Haifa")],
                events=events,
            )
        if schema is DedupeOutput:
            return DedupeOutput()
        if schema is PhotoAssignOutput:
            return PhotoAssignOutput()
        raise AssertionError(f"unexpected schema {schema}")


class FakeHost:
    def __init__(self):
        self.saved: List[Dict[str, Any]] = []
        self.photo_delta = 0
        self.uploaded = 0

    def build(self) -> Host:
        async def persist(tl, user):
            self.saved.append(tl)
            return {"id": tl["id"]}

        async def quota(user):
            return None

        async def change(uid, delta):
            self.photo_delta += delta
            return self.photo_delta

        async def put(uid, data):
            self.uploaded += 1
            return f"https://cdn.example/{self.uploaded}.webp"

        return Host(persist_timeline=persist, photo_quota_remaining=quota, change_photo_count=change, put_hosted_photo=put, geocode_enabled=False)


def _config(**kw):
    base = dict(enabled=True, storage_backend="local", gemini_concurrency=4, lease_seconds=30, sweep_seconds=1)
    base.update(kw)
    return dataclasses.replace(load_config(), **base)


async def _queue(store: LocalStore, files: List[tuple], user_id: str = None) -> Dict[str, Any]:
    user_id = user_id or str(uuid.uuid4())
    sources = [{"id": f"s{i:04d}", "name": name, "size": len(data), "mime": mime, "kind": kind, "order": i, "uploaded": True}
               for i, (name, data, mime, kind) in enumerate(files)]
    row = new_row(user_id, key_tier="admin_paid", user_snapshot={"id": user_id}, sources=sources, status="queued")
    prefix = import_prefix(user_id, row["id"])
    for s, (_, data, _, _) in zip(sources, files):
        await store.put(source_key(prefix, s), data, s["mime"])
    return await store.insert(row)


async def _drain(runner: BookImportRunner, rounds: int = 50):
    for _ in range(rounds):
        await runner.sweep_once()
        tasks = [r.task for r in runner._runs.values() if r.task]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        else:
            return


# ------------------------------------------------------------------ sources

def test_pdf_parse_finds_images_and_extracts_them(tmp_path):
    path = tmp_path / "book.pdf"
    path.write_bytes(make_pdf(2))
    doc = pdfsrc.open_pdf(str(path))
    units = [pdfsrc.parse_page(doc, i, "s0", i) for i in range(len(doc))]
    pdfsrc.finalize_units(units)
    assert [len(u.images) for u in units] == [2, 2]
    assert all(u.kind == "born_digital" for u in units)
    img = units[0].images[0]
    assert img.box_2d[1] < img.box_2d[3] and img.native_w == 400
    pil = pdfsrc.extract_image(doc, 0, img)
    assert pil is not None and pil.size == (400, 300)
    doc.close()


def test_pdf_rejects_password_and_garbage(tmp_path):
    with pytest.raises(pdfsrc.PdfRejected):
        pdfsrc.open_pdf(b"%PDF-1.7 not really a pdf")


def test_docx_sections_images_and_captions():
    units, images = parse_docx(make_docx(), "s0", 0)
    assert len(units) == 1
    u = units[0]
    assert "Rachel was born in 1950" in u.text and u.text.startswith("# Family")
    assert [i.ref for i in u.images] == ["P1"] and "0:P1" in images
    caption_blocks = [u.text_blocks[i].text for i in u.caption_candidates["P1"]]
    assert "Rachel as a baby, 1950" in caption_blocks


def test_docx_with_macros_is_rejected():
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<w:document/>")
        z.writestr("word/vbaProject.bin", b"x")
    from services.book_import.sources.safety import SourceRejected, check_docx

    with pytest.raises(SourceRejected):
        check_docx(buf.getvalue())


# ------------------------------------------------------------------ runner: fast lane end to end + finalize

def test_fast_lane_pdf_to_review_to_timeline(tmp_path):
    async def go():
        store = LocalStore(tmp_path)
        host = FakeHost()
        model = FakeModel()
        cfg = _config()
        runner = BookImportRunner(lambda: store, host.build(), lambda: cfg, call=model)
        row = await _queue(store, [("letter.pdf", make_pdf(2), "application/pdf", "pdf")])
        await _drain(runner)
        row = await store.get(row["id"])
        assert row["status"] == "review", row.get("error")
        assert row["lane"] == "fast"
        draft = row["draft"]
        assert len(draft["events"]) == 2
        linked = [p for p in draft["photos"] if p["status"] == "linked"]
        assert len(linked) == 4  # each event got its page's photos
        assert draft["events"][0]["photos"][0]["role"] == "cover"
        assert sum(1 for c in model.calls if c.startswith("read")) == 2

        # review edit then finalize
        new = draft_ops.apply_ops(draft, [{"op": "event.update", "id": draft["events"][0]["id"], "patch": {"title": "Born in Haifa"}}])
        rev = await store.update_draft(row["id"], 1, new)
        await store.update(row["id"], {"status": "finalizing"})
        await _drain(runner)
        row = await store.get(row["id"])
        assert row["status"] == "completed", row.get("error")
        assert row["timeline_id"] and len(host.saved) == 1
        tl = host.saved[0]
        assert tl["isPersonal"] is True and tl["creationSource"] == "files"
        assert tl["storyStudio"]["source"] == "book_import"
        titles = [a["title"] for a in tl["articles"]]
        assert "Born in Haifa" in titles
        first = tl["articles"][0]
        assert first["imageUrl"].startswith("https://cdn.example/") and first["additionalImages"]
        assert first["sourceRefs"] and first["people"][0]["name"] == "Rachel Cohen"
        assert host.photo_delta == 4 and host.uploaded == 4
        # working files are gone after finalize
        prefix = import_prefix(row["user_id"], row["id"])
        assert await store.list_keys(f"{prefix}/sources") == []
        assert rev == 2

    asyncio.run(go())


def test_full_lane_docx_and_text(tmp_path):
    async def go():
        store = LocalStore(tmp_path)
        model = FakeModel()
        cfg = _config(fast_lane_max_units=0)  # force the full lane
        runner = BookImportRunner(lambda: store, FakeHost().build(), lambda: cfg, call=model)
        text = ("In 1980 the family moved to Jerusalem.\n\n" * 3).encode("utf-8")
        row = await _queue(store, [("book.docx", make_docx(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"),
                                   ("notes.txt", text, "text/plain", "text")])
        await _drain(runner)
        row = await store.get(row["id"])
        assert row["status"] == "review", row.get("error")
        assert row["lane"] == "full"
        assert set(row["stages"]) == {"parse", "read", "map", "extract", "reconcile"}
        assert "map" in model.calls
        assert sum(1 for c in model.calls if c.startswith("read")) == 1  # only the docx section with a picture
        assert row["draft"]["cast"][0]["name"] == "Rachel Cohen"

    asyncio.run(go())


def test_read_stage_resumes_without_repeating_units(tmp_path):
    async def go():
        store = LocalStore(tmp_path)
        model = FakeModel()
        cfg = _config(fast_lane_max_units=0)
        runner = BookImportRunner(lambda: store, FakeHost().build(), lambda: cfg, call=model)
        row = await _queue(store, [("book.pdf", make_pdf(3), "application/pdf", "pdf")])
        await _drain(runner)
        row = await store.get(row["id"])
        assert sum(1 for c in model.calls if c.startswith("read")) == 3
        # Simulate a crash that lost one unit's reading: only that unit is read again.
        paths = Paths(import_prefix(row["user_id"], row["id"]))
        store.local_path(paths.read(1)).unlink()
        ctx = runner._make_ctx(row)
        ctx.row["lease_owner"] = runner.owner
        before = len(model.calls)
        await stage_read(ctx)
        assert model.calls[before:] == ["read u1"]

    asyncio.run(go())


def test_bad_file_fails_without_retry(tmp_path):
    async def go():
        store = LocalStore(tmp_path)
        runner = BookImportRunner(lambda: store, FakeHost().build(), lambda: _config(), call=FakeModel())
        row = await _queue(store, [("fake.pdf", b"this is not a pdf at all, just text", "application/pdf", "pdf")])
        await _drain(runner)
        row = await store.get(row["id"])
        assert row["status"] == "failed" and row["error"]["code"] == "bad_file"
        assert row["lease_owner"] is None

    asyncio.run(go())


def test_byok_import_pauses_without_key_then_resumes(tmp_path):
    async def go():
        store = LocalStore(tmp_path)
        model = FakeModel()
        runner = BookImportRunner(lambda: store, FakeHost().build(), lambda: _config(), call=model)
        row = await _queue(store, [("letter.pdf", make_pdf(1), "application/pdf", "pdf")])
        await store.update(row["id"], {"key_tier": "custom"})
        await _drain(runner)
        row = await store.get(row["id"])
        assert row["status"] == "paused" and row["paused_reason"] == "needs_key"
        runner.keys.put(row["id"], "user-key")
        await store.update(row["id"], {"status": "queued"})
        await _drain(runner)
        row = await store.get(row["id"])
        assert row["status"] == "review"
        assert not runner.keys.has(row["id"])  # the key is dropped once no more model calls are needed

    asyncio.run(go())


# ------------------------------------------------------------------ store: lease fencing

def test_lease_fencing_and_claim_cap(tmp_path):
    async def go():
        store = LocalStore(tmp_path)
        a = await store.insert(new_row("u1", status="queued"))
        b = await store.insert(new_row("u2", status="queued"))
        got = await store.claim("owner-A", 60, max_active=1)
        assert got["id"] == a["id"] and got["status"] == "running"
        assert await store.claim("owner-B", 60, max_active=1) is None  # global cap
        with pytest.raises(LeaseLost):
            await store.update(a["id"], {"stage": "read"}, owner="owner-B")
        assert await store.renew(a["id"], "owner-B", 60) is None
        assert await store.renew(a["id"], "owner-A", 60) == "running"
        await store.release(a["id"], "owner-A")
        got_b = await store.claim("owner-B", 60, max_active=2)
        assert got_b["id"] in (a["id"], b["id"])

    asyncio.run(go())


# ------------------------------------------------------------------ HTTP routes

ADMIN = {"id": str(uuid.uuid4()), "email": "admin@example.com", "app_metadata": {"role": "admin"}}
GUEST = {"id": str(uuid.uuid4()), "is_anonymous": True}
REGULAR = {"id": str(uuid.uuid4()), "email": "user@example.com"}


def _app(tmp_path, user, *, enabled=True):
    store = LocalStore(tmp_path)
    cfg = _config(enabled=enabled)
    current = {"user": user}

    async def quota(u):
        return 1000

    async def verify(k):
        return k == "good-key"

    deps = bi_api.ApiDeps(
        current_user=lambda: current["user"],
        is_admin=lambda u: (u.get("app_metadata") or {}).get("role") == "admin",
        is_guest=lambda u: bool(u.get("is_anonymous")),
        key_verified=lambda k: False,
        verify_key=verify,
        photo_quota_remaining=quota,
        store=lambda: store,
        runner=lambda: None,
        config=lambda: cfg,
    )
    app = FastAPI()
    app.include_router(bi_api.build_router(deps))
    return TestClient(app), store, current


def test_routes_disabled_flag(tmp_path):
    client, _, _ = _app(tmp_path, ADMIN, enabled=False)
    assert client.get("/api/book-imports/limits").json() == {"enabled": False}
    assert client.post("/api/book-imports", json={"files": []}).status_code == 404


def test_routes_entitlement(tmp_path):
    client, _, current = _app(tmp_path, GUEST)
    assert client.get("/api/book-imports/limits").json()["reason"] == "sign_in"
    assert client.post("/api/book-imports", json={"pastedText": "hi"}).status_code == 403
    current["user"] = REGULAR
    assert client.get("/api/book-imports/limits").json()["reason"] == "needs_key"
    r = client.post("/api/book-imports", json={"pastedText": "hi"}, headers={"X-Gemini-Api-Key": "bad-key"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "invalid_key"
    r = client.post("/api/book-imports", json={"pastedText": "Rachel was born in 1950."}, headers={"X-Gemini-Api-Key": "good-key"})
    assert r.status_code == 200 and r.json()["import"]["status"] == "queued"  # pasted text needs no upload
    assert r.json()["import"]["keyTier"] == "custom"


def test_routes_upload_start_ops_and_finalize_guards(tmp_path):
    client, store, _ = _app(tmp_path, ADMIN)
    pdf = make_pdf(1)
    r = client.post("/api/book-imports", json={"files": [{"clientId": "c1", "name": "book.pdf", "size": len(pdf), "mime": "application/pdf"}], "instructions": "focus on Rachel"})
    assert r.status_code == 200, r.text
    body = r.json()
    imp = body["import"]
    assert imp["status"] == "awaiting_upload" and len(body["uploads"]) == 1
    # Start before upload -> 409
    assert client.post(f"/api/book-imports/{imp['id']}/start").status_code == 409
    up = body["uploads"][0]
    assert up["method"] == "PUT" and up["auth"] == "none"
    r = client.put(up["url"], content=pdf, headers=up["headers"])
    assert r.status_code == 200
    # a tampered signature is refused
    assert client.put(up["url"].replace("s=", "s=x"), content=pdf).status_code == 403
    r = client.post(f"/api/book-imports/{imp['id']}/start")
    assert r.status_code == 200 and r.json()["import"]["status"] == "queued"
    # A second active import is refused
    r2 = client.post("/api/book-imports", json={"pastedText": "another"})
    assert r2.status_code == 409 and r2.json()["detail"]["code"] == "import_in_progress"

    # Put a draft in place as the runner would, then edit it through ops.
    async def to_review():
        await store.update(imp["id"], {"status": "review", "draft_rev": 1, "draft": {
            "v": 1, "title": "T", "events": [{"id": "bk-0001", "title": "A", "status": "accepted", "from": {"year": 1950, "precision": "year"},
                                              "photos": [], "people": [], "sourceRefs": [], "flags": ["date_inferred"]}],
            "photos": [{"id": "u0000-p1", "unit": 0, "status": "tray"}], "units": [{"index": 0, "label": "p.1"}], "lanes": [], "chapters": [], "cast": []}})
    asyncio.run(to_review())
    d = client.get(f"/api/book-imports/{imp['id']}/draft").json()
    assert d["rev"] == 1 and "u0000-p1" in d["assets"]["photos"]
    r = client.post(f"/api/book-imports/{imp['id']}/draft/ops", json={"baseRev": 1, "ops": [
        {"op": "photo.assign", "photoId": "u0000-p1", "eventId": "bk-0001", "role": "cover"},
        {"op": "event.update", "id": "bk-0001", "patch": {"from": {"year": 1951, "precision": "year"}}},
    ]})
    assert r.status_code == 200 and r.json()["rev"] == 2
    stale = client.post(f"/api/book-imports/{imp['id']}/draft/ops", json={"baseRev": 1, "ops": []})
    assert stale.status_code == 409 and stale.json()["detail"]["rev"] == 2
    bad = client.post(f"/api/book-imports/{imp['id']}/draft/ops", json={"baseRev": 2, "ops": [{"op": "event.update", "id": "nope", "patch": {}}]})
    assert bad.status_code == 400
    d = client.get(f"/api/book-imports/{imp['id']}/draft").json()
    ev = d["draft"]["events"][0]
    assert ev["photos"][0]["photoId"] == "u0000-p1" and ev["flags"] == [] and ev["from"]["year"] == 1951
    r = client.post(f"/api/book-imports/{imp['id']}/finalize", json={"baseRev": 2})
    assert r.status_code == 202 and r.json()["import"]["status"] == "finalizing"
    assert client.get(f"/api/book-imports/{imp['id']}").json()["import"]["status"] == "finalizing"
    # someone else's import is invisible
    assert client.get(f"/api/book-imports/{uuid.uuid4()}").status_code == 404


def test_cancel_and_delete(tmp_path):
    client, store, _ = _app(tmp_path, ADMIN)
    r = client.post("/api/book-imports", json={"pastedText": "short text"})
    iid = r.json()["import"]["id"]
    assert client.post(f"/api/book-imports/{iid}/cancel").json()["import"]["status"] == "cancelled"
    assert client.delete(f"/api/book-imports/{iid}").status_code == 204
    assert client.get(f"/api/book-imports/{iid}").status_code == 404


# ------------------------------------------------------------------ cost tracking

def test_every_call_is_in_the_ledger_with_stage_totals(tmp_path):
    async def go():
        store = LocalStore(tmp_path)
        model = FakeModel()
        runner = BookImportRunner(lambda: store, FakeHost().build(), lambda: _config(), call=model)
        row = await _queue(store, [("letter.pdf", make_pdf(2), "application/pdf", "pdf")])
        await _drain(runner)
        row = await store.get(row["id"])
        usage = row["usage"]
        assert usage["calls"] == len(model.calls)
        assert usage["inputTokens"] == 1000 * len(model.calls) and usage["thinkingTokens"] == 50 * len(model.calls)
        assert set(usage["byStage"]) == {"parse", "read", "fast_extract", "reconcile"}  # every stage, even $0 ones
        assert usage["byStage"]["parse"]["costUsd"] == 0 and usage["byStage"]["read"]["calls"] == 2
        assert abs(sum(st["costUsd"] for st in usage["byStage"].values()) - usage["costUsd"]) < 1e-6
        ledger = []
        for key in await store.list_keys(f"{import_prefix(row['user_id'], row['id'])}/usage"):
            ledger.extend(await store.get_json(key))
        assert sorted(e["label"] for e in ledger) == sorted(model.calls)
        assert all(e["stage"] and e["costUsd"] > 0 and e["model"] == "gemini-3.8-flash" for e in ledger)
        assert {e["stage"] for e in ledger if e["label"].startswith("read")} == {"read"}

        # The API returns the same ledger.
        client, _, _ = _app(tmp_path, {"id": row["user_id"], "app_metadata": {"role": "admin"}})
        r = client.get(f"/api/book-imports/{row['id']}/usage").json()
        assert len(r["calls"]) == len(ledger) and r["total"]["costUsd"] == usage["costUsd"]

    asyncio.run(go())


def test_price_override_from_env(monkeypatch):
    from services.book_import.gemini_calls import call_cost

    metrics = {"prompt_tokens": 1_000_000, "cached_tokens": 200_000, "candidates_tokens": 100_000, "thoughts_tokens": 50_000}
    usd, source = call_cost("gemini-3.8-flash", metrics)
    assert source == "app_table" and usd > 0
    monkeypatch.setenv("BOOK_IMPORT_PRICE_INPUT_PER_M", "0.30")
    monkeypatch.setenv("BOOK_IMPORT_PRICE_OUTPUT_PER_M", "2.50")
    usd, source = call_cost("gemini-3.8-flash", metrics)
    # 800k uncached x 0.30 + 200k cached x 0.075 + 100k out x 2.50 + 50k thinking x 2.50
    assert source == "env" and abs(usd - (0.24 + 0.015 + 0.25 + 0.125)) < 1e-9


def test_call_structured_meters_and_logs_every_billed_call(monkeypatch, caplog):
    import logging
    from types import SimpleNamespace

    from services import gemini_service as gs
    from services.book_import.gemini_calls import UsageMeter, call_structured

    responses = [
        SimpleNamespace(parsed=None, text="not json", candidates=[SimpleNamespace(finish_reason="STOP")],
                        usage_metadata=SimpleNamespace(prompt_token_count=500, cached_content_token_count=0, candidates_token_count=20, thoughts_token_count=5, total_token_count=525, tool_use_prompt_token_count=0)),
        SimpleNamespace(parsed=DedupeOutput(), text="{}", candidates=[SimpleNamespace(finish_reason="STOP")],
                        usage_metadata=SimpleNamespace(prompt_token_count=500, cached_content_token_count=100, candidates_token_count=30, thoughts_token_count=7, total_token_count=537, tool_use_prompt_token_count=0)),
    ]

    async def fake_client(key=None):
        return object()

    async def fake_generate(client, max_retries=0, **kw):
        return responses.pop(0)

    monkeypatch.setattr(gs, "aget_gemini_client", fake_client)
    monkeypatch.setattr(gs, "_generate_with_retry", fake_generate)
    meter = UsageMeter(stage="reconcile")
    seen = []
    meter.sink = seen.append
    # Single calls are logged at DEBUG (INFO shows only stage and import totals).
    with caplog.at_level(logging.DEBUG, logger="ChroniXBookImport"):
        out = asyncio.run(call_structured(api_key="k", schema=DedupeOutput, parts=[], system_instruction="s",
                                          models=["gemini-3.8-flash"], meter=meter, label="dedupe 0"))
    assert isinstance(out, DedupeOutput)
    assert [e["outcome"] for e in meter.entries] == ["unparseable", "ok"]  # the wasted call is counted too
    assert meter.prompt_tokens == 1000 and meter.thoughts_tokens == 12 and len(seen) == 2
    cost_lines = [r.message for r in caplog.records if "[book_import:cost]" in r.message]
    assert len(cost_lines) == 2 and "dedupe 0" in cost_lines[0] and "thinking=5" in cost_lines[0]


def test_stage_killed_repeatedly_is_halted_not_retried_forever(tmp_path):
    """An OOM kill skips every except block; the attempt is counted before the stage runs, so a
    crash loop (each restart resuming the same import) ends after MAX_ATTEMPTS."""
    from services.book_import.runner import MAX_ATTEMPTS

    async def go():
        store = LocalStore(tmp_path)
        model = FakeModel()
        runner = BookImportRunner(lambda: store, FakeHost().build(), lambda: _config(), call=model)
        row = await _queue(store, [("book.pdf", make_pdf(1), "application/pdf", "pdf")])
        # As left behind by MAX_ATTEMPTS processes that died mid-stage.
        await store.update(row["id"], {"attempts": MAX_ATTEMPTS, "stage": "parse"})
        await _drain(runner)
        row = await store.get(row["id"])
        assert row["status"] == "failed" and row["error"]["code"] == "stage_crashed"
        assert model.calls == []

    asyncio.run(go())


def test_successful_import_resets_attempts(tmp_path):
    from services.book_import.runner import MAX_ATTEMPTS

    async def go():
        store = LocalStore(tmp_path)
        runner = BookImportRunner(lambda: store, FakeHost().build(), lambda: _config(), call=FakeModel())
        row = await _queue(store, [("book.pdf", make_pdf(1), "application/pdf", "pdf")])
        await store.update(row["id"], {"attempts": MAX_ATTEMPTS - 1})
        await _drain(runner)
        row = await store.get(row["id"])
        assert row["status"] == "review" and int(row.get("attempts") or 0) == 0

    asyncio.run(go())
