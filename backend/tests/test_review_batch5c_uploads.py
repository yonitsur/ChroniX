"""Batch 5C: pure-ASGI middlewares (SC-02) and upload admission / memory (SC-06, P-11):
pre-parse auth and size checks, the per-instance upload cap, spooled uploads validated in the cpu
pool, and the Gemini Files API for large uploads."""
import asyncio
import base64
import io
import json
import threading
import time

import pytest
from fastapi.testclient import TestClient
from starlette.datastructures import Headers, UploadFile
from starlette.middleware.base import BaseHTTPMiddleware

import main
from services import gemini_service as gs
from services import quota_service, upload_security
from services.auth_service import get_current_user_optional, get_current_user_required

USER = {"id": "upload-5c-user", "email": "u5c@example.com", "is_anonymous": False}
FILES_ROUTE = "/api/timeline/generate-from-files/start"


@pytest.fixture(autouse=True)
def clean_state():
    main.app.dependency_overrides.clear()
    main._UPLOAD_SLOTS_IN_USE = 0
    yield
    main.app.dependency_overrides.clear()
    main._UPLOAD_SLOTS_IN_USE = 0


def _jwt(exp: float) -> str:
    def seg(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()
    return f"{seg({'alg': 'HS256', 'typ': 'JWT'})}.{seg({'sub': 'x', 'exp': exp})}.c2ln"


def _png() -> bytes:
    import struct
    import zlib

    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    ihdr = struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00" * 16)) + chunk(b"IEND", b"")


# --- pure ASGI middleware (SC-02) --------------------------------------------------------------

def test_no_base_http_middleware_layers_remain():
    classes = [m.cls for m in main.app.user_middleware]
    assert not any(isinstance(c, type) and issubclass(c, BaseHTTPMiddleware) for c in classes), classes
    assert main.AITierHeaderMiddleware in classes and main.RequestBodyLimitMiddleware in classes


def test_chunked_body_over_the_cap_is_a_413(monkeypatch):
    monkeypatch.setattr(main, "MAX_JSON_BODY_BYTES", 1000)

    def chunks():
        for _ in range(5):
            yield b"x" * 400

    res = TestClient(main.app).post("/api/timelines", content=chunks(), headers={"Content-Type": "application/json"})
    assert res.status_code == 413
    assert "exceeds maximum allowed size" in res.json()["detail"]


def test_declared_oversized_and_invalid_content_length():
    async def app(scope, receive, send):  # pragma: no cover - never reached
        raise AssertionError("the body limit must answer first")

    mw = main.RequestBodyLimitMiddleware(app)

    def call(content_length):
        sent = []

        async def send(message):
            sent.append(message)

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        scope = {"type": "http", "method": "POST", "path": "/api/timelines",
                 "headers": [(b"content-length", content_length)]}
        asyncio.run(mw(scope, receive, send))
        return sent[0]["status"], json.loads(sent[1]["body"])

    assert call(str(main.MAX_JSON_BODY_BYTES + 1).encode())[0] == 413
    status, body = call(b"nope")
    assert status == 400 and body["detail"] == "Invalid Content-Length header."


def test_ai_tier_header_middleware_streams_without_buffering():
    async def app(scope, receive, send):
        quota_service.note_request_ai_tier("paid")
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"a", "more_body": True})
        await send({"type": "http.response.body", "body": b"b"})

    sent = []

    async def send(message):
        sent.append(message)

    async def receive():
        return {"type": "http.request", "body": b""}

    asyncio.run(main.AITierHeaderMiddleware(app)({"type": "http", "path": "/x", "headers": []}, receive, send))
    assert Headers(raw=sent[0]["headers"]).get(main.AI_TIER_HEADER) == "paid"
    assert [m.get("body") for m in sent[1:]] == [b"a", b"b"]


# --- upload admission before the multipart parse (SC-06) ---------------------------------------

def test_upload_without_authorization_is_rejected_before_the_body_is_parsed(monkeypatch):
    parsed = []

    async def never_called(*a, **k):
        parsed.append(1)
        raise AssertionError("must not parse")

    monkeypatch.setattr(main, "validate_and_read_uploads", never_called)
    client = TestClient(main.app)
    res = client.post(FILES_ROUTE, files=[("files", ("a.png", _png(), "image/png"))])
    assert res.status_code == 401
    res = client.post(FILES_ROUTE, files=[("files", ("a.png", _png(), "image/png"))],
                      headers={"Authorization": "Bearer not-a-jwt"})
    assert res.status_code == 401
    res = client.post(FILES_ROUTE, files=[("files", ("a.png", _png(), "image/png"))],
                      headers={"Authorization": f"Bearer {_jwt(time.time() - 3600)}"})
    assert res.status_code == 401, "an expired token is refused without parsing"
    assert parsed == []
    assert main._UPLOAD_SLOTS_IN_USE == 0


def test_precheck_accepts_only_unexpired_bearer_jwts():
    # A plausible token only gets past the pre-check: the route dependency still verifies it fully.
    assert main.authorization_header_plausible(f"Bearer {_jwt(time.time() + 3600)}")
    assert not main.authorization_header_plausible(f"Bearer {_jwt(time.time() - 3600)}")
    assert not main.authorization_header_plausible("Basic abc")


def test_upload_over_content_length_cap_is_413_before_parsing():
    res = TestClient(main.app).post(
        FILES_ROUTE, content=b"x", headers={"Content-Length": str(main.MAX_UPLOAD_BODY_BYTES + 1)},
    )
    assert res.status_code == 413


def test_concurrent_upload_cap_gives_503_with_retry_after(monkeypatch):
    monkeypatch.setenv("MAX_CONCURRENT_UPLOAD_JOBS", "2")
    main.app.dependency_overrides[get_current_user_required] = lambda: USER
    main._UPLOAD_SLOTS_IN_USE = 2
    res = TestClient(main.app).post(FILES_ROUTE, files=[("files", ("a.png", _png(), "image/png"))])
    assert res.status_code == 503
    assert res.headers["Retry-After"]
    assert main._UPLOAD_SLOTS_IN_USE == 2


def test_failed_upload_request_releases_its_slot_and_temp_files(monkeypatch):
    main.app.dependency_overrides[get_current_user_required] = lambda: USER
    seen = {}

    async def fake_validate(files, raw_text, **kw):
        uploads = upload_security.ValidatedUploads()
        blob = upload_security.SpooledUpload()
        blob.write(b"data")
        uploads.binary_files.append((blob, "image/png"))
        seen["blob"] = blob
        seen["slots"] = main._UPLOAD_SLOTS_IN_USE
        return uploads

    def broken_quota(*a, **k):
        raise main.HTTPException(status_code=402, detail="no credits")

    monkeypatch.setattr(main, "validate_and_read_uploads", fake_validate)
    monkeypatch.setattr(main, "resolve_gemini_key", broken_quota)
    res = TestClient(main.app).post(FILES_ROUTE, files=[("files", ("a.png", _png(), "image/png"))])
    assert res.status_code == 402
    assert seen["slots"] == 1, "the request held a slot while it ran"
    assert main._UPLOAD_SLOTS_IN_USE == 0
    assert seen["blob"].closed, "spooled uploads are deleted with the slot"


@pytest.mark.asyncio
async def test_job_takes_over_the_upload_slot_and_releases_it_when_done():
    slot = main._UploadSlot()
    blob = upload_security.SpooledUpload()
    blob.write(b"x")
    uploads = upload_security.ValidatedUploads(binary_files=[(blob, "image/png")])
    slot.uploads.append(uploads)
    slot.held_by_job = True
    release = asyncio.Event()

    async def op():
        await release.wait()
        return {"ok": 1}

    job_id = main._create_ai_job(USER)
    out = main._launch_ai_job(job_id, op, USER, label="generate-from-files", budget="upload", upload_slot=slot)
    assert out["status"] == "pending"
    assert main._UPLOAD_SLOTS_IN_USE == 1 and not blob.closed
    release.set()
    await asyncio.sleep(0.02)
    assert main._UPLOAD_SLOTS_IN_USE == 0
    assert blob.closed
    main._AI_JOBS.pop(job_id, None)


# --- spooled uploads, validated in the cpu pool (SC-06 / P-11) -----------------------------------

@pytest.mark.asyncio
async def test_validation_runs_in_the_cpu_pool_and_keeps_uploads_spooled(monkeypatch):
    threads = []
    real = upload_security._inspect_upload_sync

    def spy(*args, **kwargs):
        threads.append(threading.current_thread().name)
        return real(*args, **kwargs)

    monkeypatch.setattr(upload_security, "_inspect_upload_sync", spy)
    png = _png()
    files = [
        UploadFile(io.BytesIO(png), filename="a.png", headers=Headers({"content-type": "image/png"})),
        UploadFile(io.BytesIO(png), filename="dup.png", headers=Headers({"content-type": "image/png"})),
        UploadFile(io.BytesIO(b"1990: born"), filename="n.txt", headers=Headers({"content-type": "text/plain"})),
    ]
    result = await upload_security.validate_and_read_uploads(files, user=USER)
    assert threads and all(name.startswith("chronix-cpu") for name in threads), threads
    assert result.image_count == 1 and result.deduplicated_count == 1 and result.text_file_count == 1
    blob, mime = result.binary_files[0]
    assert isinstance(blob, upload_security.SpooledUpload) and mime == "image/png"
    assert len(blob) == len(png) and blob.read_bytes() == png
    result.close()
    assert blob.closed


@pytest.mark.asyncio
async def test_rejected_upload_closes_its_spooled_files():
    created = []
    real_init = upload_security.SpooledUpload.__init__

    def tracking_init(self, *a, **k):
        real_init(self, *a, **k)
        created.append(self)

    upload_security.SpooledUpload.__init__ = tracking_init
    try:
        files = [
            UploadFile(io.BytesIO(_png()), filename="a.png", headers=Headers({"content-type": "image/png"})),
            UploadFile(io.BytesIO(b"MZ\x90not a pdf"), filename="b.pdf", headers=Headers({"content-type": "application/pdf"})),
        ]
        with pytest.raises(main.HTTPException):
            await upload_security.validate_and_read_uploads(files, user=USER)
    finally:
        upload_security.SpooledUpload.__init__ = real_init
    assert len(created) == 2 and all(b.closed for b in created)


# --- Gemini Files API above the threshold (SC-06) ------------------------------------------------

class _FakeFiles:
    def __init__(self, fail=False):
        self.uploaded = []
        self.deleted = []
        self.fail = fail

    async def upload(self, file, config=None):
        if self.fail:
            raise RuntimeError("upload refused")
        data = file.read()
        name = f"files/{len(self.uploaded)}"
        self.uploaded.append((name, len(data), config))
        return type("F", (), {"name": name, "uri": f"https://generativelanguage.googleapis.com/v1beta/{name}",
                              "mime_type": (config or {}).get("mime_type"), "state": "ACTIVE"})()

    async def get(self, name):  # pragma: no cover - state is ACTIVE at once here
        raise AssertionError

    async def delete(self, name):
        self.deleted.append(name)


class _FakeClient:
    def __init__(self, fail=False):
        self.files = _FakeFiles(fail)
        self.aio = type("Aio", (), {"files": self.files})()


def _blob(size):
    blob = upload_security.SpooledUpload()
    blob.write(b"\x00" * size)
    return blob


@pytest.mark.asyncio
async def test_large_uploads_go_through_the_files_api_and_are_deleted_after(monkeypatch):
    monkeypatch.setenv("GEMINI_FILES_API_THRESHOLD_BYTES", "1000")
    client = _FakeClient()
    files = [(_blob(800), "image/png"), (_blob(800), "application/pdf")]
    async with gs.gemini_upload_scope():
        parts = await gs.build_file_parts(client, files)
        assert [p.file_data.file_uri.endswith(f"files/{i}") for i, p in enumerate(parts)] == [True, True]
        assert all(p.inline_data is None for p in parts), "nothing sent inline"
        assert [u[2]["mime_type"] for u in client.files.uploaded] == ["image/png", "application/pdf"]
        assert client.files.deleted == []
    assert sorted(client.files.deleted) == ["files/0", "files/1"]


@pytest.mark.asyncio
async def test_small_uploads_stay_inline(monkeypatch):
    monkeypatch.setenv("GEMINI_FILES_API_THRESHOLD_BYTES", "10000")
    client = _FakeClient()
    async with gs.gemini_upload_scope():
        parts = await gs.build_file_parts(client, [(_blob(100), "image/png"), (b"raw", "image/jpeg")])
    assert client.files.uploaded == []
    assert parts[0].inline_data.data == b"\x00" * 100 and parts[1].inline_data.data == b"raw"


@pytest.mark.asyncio
async def test_files_api_failure_falls_back_to_inline(monkeypatch):
    monkeypatch.setenv("GEMINI_FILES_API_THRESHOLD_BYTES", "10")
    client = _FakeClient(fail=True)
    async with gs.gemini_upload_scope():
        parts = await gs.build_file_parts(client, [(_blob(100), "image/png")])
    assert parts[0].inline_data is not None


@pytest.mark.asyncio
async def test_generation_from_files_deletes_its_uploads_when_it_returns(monkeypatch):
    monkeypatch.setenv("GEMINI_FILES_API_THRESHOLD_BYTES", "10")
    client = _FakeClient()

    async def fake_impl(files, **kwargs):
        # The user's own key builds the client (BYOK uploads under their project).
        parts = await gs.build_file_parts(client, files)
        assert client.files.deleted == []
        return parts

    monkeypatch.setattr(gs, "_generate_timeline_from_files", fake_impl)
    await gs.generate_timeline_from_files(files=[(_blob(100), "image/png")], api_key="AIzaUser")
    assert client.files.deleted == ["files/0"]
