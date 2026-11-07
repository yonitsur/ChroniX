"""Batch 5B / P-09, P-10, P-14: minimal save responses, refine media rehydration in parallel with the
model call (and dropped from the result), background quiz persistence, no re-encoding of compact
JPEG/WebP images, background YouTube cache writes and the light share-toggle lookup."""
import asyncio
import base64
import io
import json
import threading
from typing import Any, Dict, List

import pytest
from fastapi.testclient import TestClient

import main
from models import RefineTimelineRequest, TimelineData, TimelineQuizRequest
from services import storage, youtube_service

OWNER = {"id": "owner-5b", "email": "o@example.com"}
DATA_IMG = "data:image/jpeg;base64," + "A" * 400


@pytest.fixture
def local_store(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "SUPABASE_URL", "")
    monkeypatch.setattr(storage, "SUPABASE_SERVICE_ROLE_KEY", "")
    f = tmp_path / "timelines.json"
    f.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(storage, "TIMELINES_FILE", f)
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)
    return f


def _rows(f) -> Dict[str, dict]:
    return {r["id"]: r for r in json.loads(f.read_text(encoding="utf-8"))}


def _seed(f, row: dict) -> None:
    f.write_text(json.dumps([row]), encoding="utf-8")


# --- P-09: minimal save response --------------------------------------------------------------

def test_save_returns_minimal_body_only_when_asked(monkeypatch):
    full = {"id": "tl-1", "title": "T", "articles": [{"id": "e1"}], "updatedAt": "v2", "createdAt": "v1",
            "isLibrary": False}

    async def fake_verify(tid, user):
        return user["id"], None

    async def fake_persist(payload, **kwargs):
        return dict(full)

    monkeypatch.setattr(main, "_verify_timeline_mutation_target", fake_verify)
    monkeypatch.setattr(main, "_persist_timeline_dict", fake_persist)
    main.app.dependency_overrides[main.get_current_user_required] = lambda: OWNER
    try:
        with TestClient(main.app) as client:
            body = {"id": "tl-1", "title": "T", "articles": [{"id": "e1", "title": "A", "from": {"year": 1}}]}
            slim = client.post("/api/timelines?return=minimal", json=body).json()
            assert slim == {"id": "tl-1", "updatedAt": "v2", "createdAt": "v1", "isLibrary": False, "minimal": True}
            assert client.post("/api/timelines", json=body).json() == full  # legacy clients: full echo
    finally:
        main.app.dependency_overrides.clear()


def test_generation_never_looks_up_meta_for_a_new_id(monkeypatch, local_store):
    calls: List[str] = []
    monkeypatch.setattr(storage, "get_timeline_access_meta", lambda tid: calls.append(tid))
    tl = {"id": "new-id", "title": "T", "articles": [{"id": "e1", "title": "A", "from": {"year": 1}}]}
    asyncio.run(main._persist_timeline_dict(tl, user=OWNER, target_owner=OWNER["id"], existing_meta=None,
                                            id_is_server_generated=True))
    assert calls == []


# --- P-09: refine media rehydration ---------------------------------------------------------------

def test_refine_reads_stripped_media_while_the_model_runs_and_drops_it_from_the_result(monkeypatch, local_store):
    stored = {
        "id": "tl-r", "title": "Stored", "user_id": OWNER["id"], "updatedAt": "v1",
        "quiz": [{"id": "q1", "question": "Q?", "options": ["a", "b", "c", "d"], "correct_index": 0, "explanation": "E"}],
        "articles": [
            {"id": "e1", "title": "Sputnik", "from": {"year": 1957}, "imageUrl": DATA_IMG},
            {"id": "e2", "title": "Apollo", "from": {"year": 1969}, "imageUrl": "https://img/apollo.jpg"},
        ],
    }
    _seed(local_store, stored)
    request_tl = {
        "id": "tl-r", "title": "Stored", "updatedAt": "v1",
        "articles": [
            {"id": "e1", "title": "Sputnik", "from": {"year": 1957}, "_strippedMediaFields": ["imageUrl"]},
            {"id": "e2", "title": "Apollo", "from": {"year": 1969}, "imageUrl": "https://img/apollo.jpg"},
        ],
    }
    req = RefineTimelineRequest(timeline=TimelineData.model_validate(request_tl), instruction="add one", media_stripped=True)
    model_started = threading.Event()
    read_saw_model = []
    real_read = main._read_stored_media_fields

    def slow_read(tid, keys):
        read_saw_model.append(model_started.wait(2.0))
        return real_read(tid, keys)

    async def fake_failover(fn, api_key, key_tier, label=""):
        model_started.set()
        await asyncio.sleep(0.05)
        tl = req.timeline
        tl.articles = [a.model_copy() for a in tl.articles]
        tl.articles.append(TimelineData.model_validate(
            {"id": "x", "title": "x", "articles": [{"id": "e3", "title": "Voyager", "from": {"year": 1977}}]}
        ).articles[0])
        return tl

    monkeypatch.setattr(main, "_read_stored_media_fields", slow_read)
    monkeypatch.setattr(main, "run_with_key_failover", fake_failover)
    meta = storage.get_timeline_access_meta("tl-r")

    result = asyncio.run(main._execute_refine(req, "key", "paid", OWNER, target_owner=OWNER["id"], existing_meta=meta))

    assert read_saw_model == [True]  # the stored read waited for (ran alongside) the model call
    row = _rows(local_store)["tl-r"]
    assert row["articles"][0]["imageUrl"] == DATA_IMG  # the saved timeline keeps the media
    assert row["quiz"] and row["quiz"][0]["id"] == "q1"
    by_id = {a["id"]: a for a in result["articles"]}
    assert by_id["e1"]["imageUrl"] is None  # restored media is left out of the poll result
    assert by_id["e2"]["imageUrl"] == "https://img/apollo.jpg"  # hosted URLs were never stripped
    assert result["quiz"] is None and result["persisted"] is True


def test_rehydrate_reads_only_the_needed_data_keys(monkeypatch):
    seen: List[str] = []

    class _Resp:
        status_code = 200

        def json(self):
            return [{"id": "tl-1", "quiz": None, "articles": []}]

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, url, headers=None, params=None):
            seen.append(params["select"])
            return _Resp()

    monkeypatch.setattr(storage, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(storage, "SUPABASE_SERVICE_ROLE_KEY", "k")
    monkeypatch.setattr(storage, "_supabase_http_client", lambda: _Client())
    assert storage.get_timeline_data_fields("tl-1", ["quiz", "articles", "not-allowed"]) == {"quiz": None, "articles": []}
    assert seen == ["id,quiz:data->quiz,articles:data->articles"]


# --- P-09: quiz persisted in the background ---------------------------------------------------------

def test_quiz_result_returns_before_the_round_is_persisted(monkeypatch):
    release = None
    persisted: List[Any] = []

    async def slow_persist(timeline_id, user, field, model_field, value, result):
        await release.wait()
        persisted.append((timeline_id, field, value))

    async def fake_failover(fn, api_key, key_tier, label=""):
        return {"questions": [{"q": 1}], "tokenUsage": {"model": "m"}}

    monkeypatch.setattr(main, "_persist_generated_game", slow_persist)
    monkeypatch.setattr(main, "run_with_key_failover", fake_failover)
    req = TimelineQuizRequest(timeline=TimelineData.model_validate(
        {"id": "tl-q", "title": "T", "articles": [{"id": "e1", "title": "A", "from": {"year": 1}}]}
    ))

    async def run():
        nonlocal release
        release = asyncio.Event()
        result = await main._execute_quiz(req, "key", "paid", OWNER)
        assert persisted == []  # the response did not wait for the write
        release.set()
        await asyncio.gather(*list(main._BACKGROUND_TASKS))
        return result

    result = asyncio.run(run())
    assert result["questions"] == [{"q": 1}]
    assert persisted == [("tl-q", "quiz", [{"q": 1}])]


# --- P-10: compact JPEG / WebP images are not re-encoded ---------------------------------------------

def _noise_image(fmt: str, side: int) -> str:
    from PIL import Image
    import os as _os

    img = Image.frombytes("RGB", (side, side), _os.urandom(side * side * 3))
    buf = io.BytesIO()
    img.save(buf, format=fmt, quality=92) if fmt in ("JPEG", "WEBP") else img.save(buf, format=fmt)
    mime = {"JPEG": "jpeg", "WEBP": "webp", "PNG": "png"}[fmt]
    return f"data:image/{mime};base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def test_compact_jpeg_and_webp_are_kept_byte_for_byte():
    for fmt in ("JPEG", "WEBP"):
        url = _noise_image(fmt, 300)
        assert 80_000 < len(url) <= storage.INLINE_IMAGE_REENCODE_SKIP_MAX_CHARS, fmt
        assert storage._compress_data_image_url(url) == url, fmt


def test_oversized_or_non_jpeg_images_are_still_compressed():
    png = _noise_image("PNG", 200)
    assert len(png) > 80_000
    out = storage._compress_data_image_url(png)
    assert out.startswith("data:image/jpeg") and len(out) < len(png)
    big = _noise_image("JPEG", 1400)  # wider than the 1024 px limit
    out = storage._compress_data_image_url(big)
    assert out != big and out.startswith("data:image/jpeg")


# --- P-14: YouTube cache write behind the response ------------------------------------------------

def test_youtube_cache_write_happens_after_the_response(monkeypatch):
    written: List[str] = []
    release = None

    async def slow_put(client, key, q, lang, items):
        await release.wait()
        written.append(q)

    async def no_stored(client, key):
        return None

    async def candidates(client, q, lang, api_key):
        return [{"videoId": "v1", "title": "Moon landing"}], None

    monkeypatch.setattr(youtube_service, "_api_key", lambda: "yt-key")
    monkeypatch.setattr(youtube_service, "_supabase_config", lambda: ("https://example.supabase.co", "k"))
    monkeypatch.setattr(youtube_service, "_remote_get", no_stored)
    monkeypatch.setattr(youtube_service, "_remote_put", slow_put)
    monkeypatch.setattr(youtube_service, "_fetch_youtube_candidates", candidates)

    async def run():
        nonlocal release
        release = asyncio.Event()
        result = await youtube_service.search_youtube_videos("batch5b moon landing unique", "en")
        assert written == [] and youtube_service._PENDING_WRITES
        release.set()
        await asyncio.gather(*list(youtube_service._PENDING_WRITES))
        return result

    result = asyncio.run(run())
    assert result["items"] and written == ["batch5b moon landing unique"]


# --- P-14: the share toggle reads only the access meta ------------------------------------------------

def test_share_toggle_uses_the_light_access_meta(monkeypatch):
    lookups: List[str] = []
    shares: List[tuple] = []
    assert main.get_timeline_with_meta is main._ORIG_GET_TIMELINE_WITH_META
    monkeypatch.setattr(main, "get_timeline_access_meta", lambda tid: lookups.append(tid) or {"data": None, "owner_id": OWNER["id"]})
    monkeypatch.setattr(main, "set_timeline_shared", lambda tid, uid, enabled, author_name=None: shares.append((tid, uid, enabled)) or True)
    monkeypatch.setattr(storage, "get_timeline_with_meta", lambda tid: pytest.fail("full row read"))
    result = asyncio.run(main.set_timeline_share_status("tl-s", body={"enabled": False}, user=OWNER))
    assert result["isShared"] is False
    assert lookups == ["tl-s"] and shares == [("tl-s", OWNER["id"], False)]


def test_unsharing_in_storage_reads_no_timeline_data(monkeypatch):
    patches: List[dict] = []

    class _Resp:
        status_code = 204

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def patch(self, url, headers=None, params=None, json=None):
            patches.append({"params": dict(params), "json": dict(json)})
            return _Resp()

    monkeypatch.setattr(storage, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(storage, "SUPABASE_SERVICE_ROLE_KEY", "k")
    monkeypatch.setattr(storage, "_supabase_http_client", lambda: _Client())
    monkeypatch.setattr(storage, "get_timeline_with_meta", lambda tid: pytest.fail("full row read"))
    assert storage.set_timeline_shared("tl-s", OWNER["id"], False) is True
    assert patches[0]["params"]["user_id"] == f"eq.{OWNER['id']}"
    assert patches[0]["json"] == {"is_public": False, "is_shared": False}
