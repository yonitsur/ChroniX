"""B-26: the hosted-photo counter is reconciled against storage and freed on delete."""
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import main
from services import photo_store, quota_service
from services.auth_service import get_current_user_optional, get_current_user_required

USER = {"id": "hp4b-user", "email": "hp4b@example.com"}
OTHER = {"id": "hp4b-other", "email": "other@example.com"}


def _img():
    buf = io.BytesIO()
    Image.new("RGB", (300, 200), (10, 20, 30)).save(buf, format="WEBP")
    return buf.getvalue()


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("PHOTO_STORAGE_BACKEND", "local")
    monkeypatch.setattr(photo_store, "LOCAL_DIR", tmp_path / "photos")
    monkeypatch.setenv("REGISTERED_HOSTED_PHOTOS", "3")
    monkeypatch.setattr(main, "_HOSTED_PHOTO_RECONCILED_AT", {})
    main.photo_upload_rate_limiter.records.clear()
    current = {"user": USER}
    main.app.dependency_overrides[get_current_user_required] = lambda: current["user"]
    main.app.dependency_overrides[get_current_user_optional] = lambda: current["user"]
    yield {"client": TestClient(main.app), "current": current}
    main.app.dependency_overrides.clear()


def _upload(client):
    return client.post("/api/photos", files={"file": ("p.webp", _img(), "image/webp")})


def test_limits_request_reconciles_an_inflated_counter(env):
    assert _upload(env["client"]).status_code == 200
    quota_service.change_hosted_photo_count(USER["id"], 50)  # drift: abandoned imports, lost deletes
    body = env["client"].get("/api/story/photo-import/limits").json()
    assert body["hosted_photos"]["used"] == 1
    assert quota_service.get_hosted_photo_count(USER["id"]) == 1
    # Throttled: a second request within the interval doesn't recount.
    quota_service.change_hosted_photo_count(USER["id"], 5)
    assert env["client"].get("/api/story/photo-import/limits").json()["hosted_photos"]["used"] == 6


def test_upload_at_the_limit_recounts_before_refusing(env):
    assert _upload(env["client"]).status_code == 200
    quota_service.change_hosted_photo_count(USER["id"], 2)  # counter says 3/3, storage holds 1
    res = _upload(env["client"])
    assert res.status_code == 200, res.text
    assert res.json()["used"] == 2


def test_upload_is_still_refused_when_storage_is_really_full(env):
    for _ in range(3):
        assert _upload(env["client"]).status_code == 200
    assert _upload(env["client"]).status_code == 403
    assert quota_service.get_hosted_photo_count(USER["id"]) == 3


def test_deleting_a_photo_frees_its_slot_and_only_the_owner_can(env):
    key = _upload(env["client"]).json()["key"]
    env["current"]["user"] = OTHER
    assert env["client"].delete(f"/api/photos/{key}").status_code == 404
    env["current"]["user"] = USER
    res = env["client"].delete(f"/api/photos/{key}")
    assert res.status_code == 200 and res.json()["deleted"] is True
    assert quota_service.get_hosted_photo_count(USER["id"]) == 0
    # Deleting again doesn't drive the count negative or below the real number.
    assert env["client"].delete(f"/api/photos/{key}").json()["deleted"] is False
    assert quota_service.get_hosted_photo_count(USER["id"]) == 0


def test_count_owner_photos_is_none_when_storage_cannot_answer(monkeypatch):
    monkeypatch.setattr(photo_store, "remote_enabled", lambda: True)

    def boom(prefix, strict=False):
        raise RuntimeError("down")

    monkeypatch.setattr(photo_store, "_list_remote", boom)
    assert photo_store.count_owner_photos(USER["id"]) is None
