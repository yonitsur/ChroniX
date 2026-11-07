"""Hosted timeline photos: quotas per tier, metadata stripping, validation, serving, deletion."""
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
from services import photo_store, quota_service
from services.auth_service import get_current_user_required

USER = {"id": "hp-user-1", "email": "hp@example.com"}
ADMIN = {"id": "hp-admin-1", "email": "admin@example.com"}
GUEST = {"id": "hp-guest-1", "is_anonymous": True}


def _img(fmt="WEBP", size=(800, 600), exif=False):
    img = Image.new("RGB", size, (120, 80, 40))
    buf = io.BytesIO()
    kwargs = {}
    if exif:
        ex = img.getexif()
        gps = ex.get_ifd(0x8825)
        gps[1] = "N"
        ex[0x0132] = "2023:05:14 10:00:00"
        kwargs["exif"] = ex.tobytes()
    img.save(buf, format=fmt, **kwargs)
    return buf.getvalue()


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("PHOTO_STORAGE_BACKEND", "local")
    monkeypatch.setattr(photo_store, "LOCAL_DIR", tmp_path / "photos")
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    monkeypatch.setenv("REGISTERED_HOSTED_PHOTOS", "3")
    main.photo_upload_rate_limiter.records.clear()
    current = {"user": USER}
    main.app.dependency_overrides[get_current_user_required] = lambda: current["user"]
    yield {"client": TestClient(main.app), "current": current}
    main.app.dependency_overrides.pop(get_current_user_required, None)


def _upload(client, data, name="p.webp", ctype="image/webp", headers=None):
    return client.post("/api/photos", files={"file": (name, data, ctype)}, headers=headers or {})


def test_upload_serve_and_count(env):
    res = _upload(env["client"], _img())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["url"].startswith("/api/photos/u/") and body["url"].endswith(".webp")
    assert body["used"] == 1 and body["quota"] == 3
    assert photo_store.is_valid_key(body["key"])
    # The owner folder is a salted hash, never the user id.
    assert USER["id"] not in body["url"]
    got = env["client"].get(body["url"])
    assert got.status_code == 200 and got.headers["content-type"] == "image/webp"
    assert "immutable" in got.headers["cache-control"]
    assert quota_service.get_hosted_photo_count(USER["id"]) == 1


def test_metadata_is_stripped_and_png_reencoded(env):
    res = _upload(env["client"], _img("JPEG", exif=True), "p.jpg", "image/jpeg")
    assert res.status_code == 200, res.text
    data = env["client"].get(res.json()["url"]).content
    with Image.open(io.BytesIO(data)) as img:
        assert len(img.getexif()) == 0
    res = _upload(env["client"], _img("PNG"), "p.png", "image/png")
    assert res.status_code == 200 and res.json()["url"].endswith(".webp")


def test_rejects_non_photos_and_oversize(env):
    assert _upload(env["client"], b"not an image").status_code == 400
    assert _upload(env["client"], b"\x00" * (photo_store.MAX_UPLOAD_BYTES + 10)).status_code == 400
    assert quota_service.get_hosted_photo_count(USER["id"]) == 0


def test_quota_per_tier(env):
    for _ in range(3):
        assert _upload(env["client"], _img()).status_code == 200
    over = _upload(env["client"], _img())
    assert over.status_code == 403 and "limit of 3" in over.json()["detail"]
    assert quota_service.get_hosted_photo_count(USER["id"]) == 3  # the refused one was released

    # Own Gemini key doesn't change the storage quota (storage isn't AI).
    assert _upload(env["client"], _img(), headers={"X-Gemini-Api-Key": "K"}).status_code == 403

    env["current"]["user"] = GUEST
    assert _upload(env["client"], _img()).status_code == 403

    env["current"]["user"] = ADMIN
    for _ in range(5):
        assert _upload(env["client"], _img()).status_code == 200


def test_failed_store_releases_the_slot(env, monkeypatch):
    def boom(key, data):
        raise RuntimeError("storage down")
    monkeypatch.setattr(photo_store, "put_photo", boom)
    assert _upload(env["client"], _img()).status_code == 502
    assert quota_service.get_hosted_photo_count(USER["id"]) == 0


def test_bad_keys_are_not_served(env):
    for key in ["../../etc/passwd", "u/zz/abc.webp", "u/" + "a" * 20 + "/" + "b" * 32 + ".png"]:
        assert env["client"].get(f"/api/photos/{key}").status_code == 404


def test_limits_endpoint_reports_hosted_plan(env):
    _upload(env["client"], _img())
    main.app.dependency_overrides[main.get_current_user_optional] = lambda: USER
    try:
        body = env["client"].get("/api/story/photo-import/limits").json()
    finally:
        main.app.dependency_overrides.pop(main.get_current_user_optional, None)
    assert body["hosted_photos"] == {"enabled": True, "quota": 3, "used": 1}


def test_delete_owner_photos(env):
    for _ in range(2):
        _upload(env["client"], _img())
    assert photo_store.delete_owner_photos(USER["id"]) == 2
    assert photo_store.delete_owner_photos(USER["id"]) == 0
