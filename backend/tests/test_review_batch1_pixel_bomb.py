"""S-02: pixel-bomb images are rejected from their header, before Pillow decodes any pixels."""
import base64
import io
import struct
import zlib

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
from services import image_safety, photo_store, storage
from services.auth_service import get_current_user_optional, get_current_user_required

USER = {"id": "bomb-user-1", "email": "bomb@example.com", "is_anonymous": False}


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def _bomb_png(width: int, height: int, pad_bytes: int = 0) -> bytes:
    """A tiny PNG whose IHDR declares width x height (never allocated in this test)."""
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    out = b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", ihdr)
    if pad_bytes:
        out += _png_chunk(b"tEXt", b"pad\x00" + b"x" * pad_bytes)
    out += _png_chunk(b"IDAT", zlib.compress(b"\x00")) + _png_chunk(b"IEND", b"")
    return out


def _bomb_jpeg(width: int, height: int) -> bytes:
    sof = b"\xff\xc0" + struct.pack(">HBHHB", 11, 8, height, width, 1) + b"\x01\x11\x00"
    return b"\xff\xd8" + sof + b"\xff\xd9"


def _bomb_webp(width: int, height: int) -> bytes:
    w, h = width - 1, height - 1
    vp8x = b"\x00\x00\x00\x00" + bytes([w & 0xFF, (w >> 8) & 0xFF, (w >> 16) & 0xFF, h & 0xFF, (h >> 8) & 0xFF, (h >> 16) & 0xFF])
    body = b"WEBP" + b"VP8X" + struct.pack("<I", len(vp8x)) + vp8x
    return b"RIFF" + struct.pack("<I", len(body)) + body


def _data_url(raw: bytes, mime: str = "image/png") -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


@pytest.fixture
def no_decode(monkeypatch):
    """Fails the test if Pillow decodes or converts pixels anywhere."""
    calls = []

    def boom(self, *args, **kwargs):
        calls.append(self.size)
        raise AssertionError(f"Pillow decoded a {self.size} image")

    monkeypatch.setattr(Image.Image, "load", boom)
    monkeypatch.setattr(Image.Image, "convert", boom)
    return calls


@pytest.fixture
def local_store(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "SUPABASE_URL", "")
    monkeypatch.setattr(storage, "SUPABASE_SERVICE_ROLE_KEY", "")
    local_file = tmp_path / "timelines.json"
    local_file.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(storage, "TIMELINES_FILE", local_file)
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)
    return local_file


def test_pillow_global_backstop_is_lowered():
    assert Image.MAX_IMAGE_PIXELS is not None
    assert Image.MAX_IMAGE_PIXELS <= image_safety.PIL_MAX_IMAGE_PIXELS


@pytest.mark.parametrize(
    "raw",
    [_bomb_png(20000, 20000), _bomb_jpeg(20000, 20000), _bomb_webp(16000, 16000), _bomb_png(5000, 5000)],
)
def test_open_image_checked_rejects_from_header(raw, no_decode, monkeypatch):
    opened = []
    real_open = Image.open
    monkeypatch.setattr(Image, "open", lambda *a, **k: opened.append(1) or real_open(*a, **k))
    with pytest.raises(image_safety.ImageTooLargeError):
        image_safety.open_image_checked(raw)
    assert opened == []  # rejected by the pure-Python sniff, before Pillow even parses it
    assert no_decode == []


def test_save_path_drops_bomb_without_decoding(local_store, no_decode):
    bomb_url = _data_url(_bomb_png(20000, 20000, pad_bytes=90_000))
    medium_url = _data_url(_bomb_png(5000, 5000, pad_bytes=90_000))
    assert len(bomb_url) > 80_000
    timeline = {
        "id": "bomb-tl",
        "title": "Bomb",
        "articles": [
            {
                "id": "a1",
                "title": "Ev",
                "imageUrl": bomb_url,
                "additionalImages": [{"url": medium_url}, medium_url, {"url": "https://example.com/ok.jpg"}],
            }
        ],
    }
    saved = storage.save_timeline_data(timeline, user_id=USER["id"], existing_meta=None)
    art = saved["articles"][0]
    assert art["imageUrl"] == ""
    assert art["additionalImages"] == [{"url": "https://example.com/ok.jpg"}]
    assert no_decode == []


def test_save_path_still_compresses_normal_large_images(local_store):
    img = Image.effect_noise((600, 600), 80).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    url = _data_url(buf.getvalue())
    assert len(url) > 80_000
    saved = storage.save_timeline_data(
        {"id": "ok-tl", "title": "Ok", "articles": [{"id": "a1", "title": "Ev", "imageUrl": url}]},
        user_id=USER["id"],
        existing_meta=None,
    )
    assert saved["articles"][0]["imageUrl"].startswith("data:image/jpeg;base64,")


def test_prepare_photo_rejects_bomb_before_load(no_decode):
    for raw in (_bomb_png(20000, 20000), _bomb_png(6000, 5000), _bomb_jpeg(13000, 1000)):
        with pytest.raises(photo_store.PhotoRejected, match="too large"):
            photo_store.prepare_photo(raw)
    assert no_decode == []


def test_prepare_photo_accepts_normal_photo():
    buf = io.BytesIO()
    Image.new("RGB", (1280, 960), (10, 120, 200)).save(buf, format="JPEG", quality=80)
    data, ext = photo_store.prepare_photo(buf.getvalue())
    assert ext in ("jpg", "webp") and data


def test_photo_draft_decoder_rejects_bomb(no_decode):
    for raw in (_bomb_jpeg(20000, 20000), _bomb_jpeg(5000, 5000)):
        b64 = base64.b64encode(raw).decode("ascii")
        assert main._decode_photo_draft_image(b64, 384, 90_000) is None
    assert no_decode == []


def test_photo_draft_decoder_keeps_small_thumbnail():
    buf = io.BytesIO()
    Image.new("RGB", (384, 288), (200, 100, 50)).save(buf, format="JPEG", quality=70)
    raw = buf.getvalue()
    assert main._decode_photo_draft_image(base64.b64encode(raw).decode("ascii"), 384, 90_000) == raw


def test_model_image_compressor_refuses_bomb(no_decode):
    from services.gemini_service import _compress_image_bytes_to_data_url

    with pytest.raises(image_safety.ImageTooLargeError):
        _compress_image_bytes_to_data_url(_bomb_png(20000, 20000), "image/png")
    assert no_decode == []


def test_inline_image_count_caps(local_store, monkeypatch):
    tiny = _data_url(_bomb_png(4, 4))
    monkeypatch.setattr(storage, "TIMELINE_MAX_INLINE_IMAGES_PER_ARTICLE", 3)
    monkeypatch.setattr(storage, "TIMELINE_MAX_INLINE_IMAGES", 5)

    def tl(per_article, n_articles):
        return {
            "id": "cap-tl",
            "title": "Caps",
            "articles": [
                {"id": f"a{i}", "title": "Ev", "imageUrl": tiny, "additionalImages": [{"url": tiny}] * (per_article - 1)}
                for i in range(n_articles)
            ],
        }

    with pytest.raises(storage.TimelineImageLimitError):
        storage.save_timeline_data(tl(4, 1), user_id=USER["id"], existing_meta=None)
    with pytest.raises(storage.TimelineImageLimitError):
        storage.save_timeline_data(tl(3, 2), user_id=USER["id"], existing_meta=None)
    storage.save_timeline_data(tl(3, 1), user_id=USER["id"], existing_meta=None)


@pytest.fixture
def api(local_store):
    main.app.dependency_overrides[get_current_user_optional] = lambda: USER
    main.app.dependency_overrides[get_current_user_required] = lambda: USER
    main.timeline_save_rate_limiter.records.clear()
    try:
        yield TestClient(main.app)
    finally:
        main.app.dependency_overrides.clear()
        main.timeline_save_rate_limiter.records.clear()


def test_post_timelines_inline_image_cap_returns_413(api, monkeypatch):
    monkeypatch.setattr(storage, "TIMELINE_MAX_INLINE_IMAGES_PER_ARTICLE", 2)
    tiny = _data_url(_bomb_png(4, 4))
    body = {
        "id": "cap-api",
        "title": "Caps",
        "articles": [{"id": "a1", "title": "Ev", "from": {"year": 1957}, "imageUrl": tiny, "additionalImages": [{"url": tiny}, {"url": tiny}]}],
    }
    res = api.post("/api/timelines", json=body)
    assert res.status_code == 413


def test_post_timelines_rate_limited(api, monkeypatch):
    monkeypatch.setenv("TIMELINE_SAVE_RATE_LIMIT_PER_MINUTE", "3")
    body = {"id": "rl-tl", "title": "RL", "articles": [{"id": "a1", "title": "Ev", "from": {"year": 1957}}]}
    codes = [api.post("/api/timelines", json=body).status_code for _ in range(4)]
    assert codes[:3] == [200, 200, 200]
    assert codes[3] == 429


def test_post_timelines_rate_limit_exempts_admin(api, monkeypatch):
    admin = {"id": "admin-bomb", "email": "admin@example.com", "email_confirmed_at": "2026-01-01T00:00:00Z", "is_anonymous": False}
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    monkeypatch.setenv("TIMELINE_SAVE_RATE_LIMIT_PER_MINUTE", "1")
    main.app.dependency_overrides[get_current_user_optional] = lambda: admin
    main.app.dependency_overrides[get_current_user_required] = lambda: admin
    body = {"id": "rl-admin", "title": "RL", "articles": [{"id": "a1", "title": "Ev", "from": {"year": 1957}}]}
    assert [api.post("/api/timelines", json=body).status_code for _ in range(3)] == [200, 200, 200]
