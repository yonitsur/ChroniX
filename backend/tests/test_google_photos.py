"""Google Photos Picker proxy: token handling, SSRF guard, session/list/media mapping, tier caps."""
import httpx
import pytest
from fastapi.testclient import TestClient

import main
from services import google_photos
from services.auth_service import get_current_user_required

USER = {"id": "gp-user-1", "email": "gp@example.com"}
BASE = "https://lh3.googleusercontent.com/ppa/AbCdEf123"


def test_sized_media_url_only_allows_google_user_content():
    assert google_photos.sized_media_url(BASE, 320) == f"{BASE}=w320-h320"
    assert google_photos.sized_media_url(f"{BASE}=w2048-h1024", 800) == f"{BASE}=w800-h800"
    for bad in [
        "http://lh3.googleusercontent.com/x",            # not https
        "https://evil.com/lh3.googleusercontent.com",    # wrong host
        "https://lh3.googleusercontent.com.evil.com/x",  # suffix trick
        "https://169.254.169.254/latest/meta-data",      # metadata endpoint
        "https://lh3.googleusercontent.com:8443/x",      # odd port
        "file:///etc/passwd",
    ]:
        with pytest.raises(google_photos.GooglePhotosError):
            google_photos.sized_media_url(bad, 320)
    with pytest.raises(google_photos.GooglePhotosError):
        google_photos.sized_media_url(BASE, 5000)


def test_clean_token_and_session_id():
    assert google_photos.clean_token("Bearer abc.def") == "abc.def"
    for bad in [None, "", "a b", "x" * 5000]:
        with pytest.raises(google_photos.GooglePhotosError) as e:
            google_photos.clean_token(bad)
        assert e.value.status == 401
    with pytest.raises(google_photos.GooglePhotosError):
        google_photos.check_session_id("../../sessions")


class FakeGoogle:
    """Stands in for photospicker.googleapis.com + the googleusercontent CDN."""

    def __init__(self):
        self.requests = []
        self.picked = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.headers["authorization"] == "Bearer GTOKEN"
        path = request.url.path
        if request.url.host == "photospicker.googleapis.com":
            if request.method == "POST" and path == "/v1/sessions":
                return httpx.Response(200, json={
                    "id": "sess-1", "pickerUri": "https://photos.google.com/picker/sess-1",
                    "pollingConfig": {"pollInterval": "3s", "timeoutIn": "1800s"}, "mediaItemsSet": False,
                })
            if request.method == "GET" and path == "/v1/sessions/sess-1":
                return httpx.Response(200, json={"id": "sess-1", "mediaItemsSet": self.picked, "pollingConfig": {"pollInterval": "3s"}})
            if request.method == "DELETE":
                return httpx.Response(200, json={})
            if path == "/v1/mediaItems":
                if not self.picked:
                    return httpx.Response(400, json={"error": {"status": "FAILED_PRECONDITION"}})
                return httpx.Response(200, json={"mediaItems": [
                    {"id": "m1", "createTime": "2023-05-14T17:20:00Z", "type": "PHOTO",
                     "mediaFile": {"baseUrl": BASE, "mimeType": "image/jpeg", "filename": "PXL_1.jpg", "mediaFileMetadata": {"width": 4000, "height": 3000}}},
                    {"id": "v1", "createTime": "2023-05-14T17:21:00Z", "type": "VIDEO",
                     "mediaFile": {"baseUrl": BASE + "v", "mimeType": "video/mp4", "filename": "v.mp4"}},
                ], "nextPageToken": "p2"})
        if request.url.host == "lh3.googleusercontent.com":
            assert path.endswith("=w320-h320")
            return httpx.Response(200, content=b"\xff\xd8\xff fake jpeg", headers={"content-type": "image/jpeg"})
        return httpx.Response(404)


@pytest.fixture
def env(monkeypatch):
    fake = FakeGoogle()
    transport = httpx.MockTransport(fake.handler)
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(google_photos.httpx, "AsyncClient", client_factory)
    main.google_photos_rate_limiter.records.clear()
    main.google_photos_media_rate_limiter.records.clear()
    main.app.dependency_overrides[get_current_user_required] = lambda: USER
    yield {"client": TestClient(main.app), "fake": fake}
    main.app.dependency_overrides.pop(get_current_user_required, None)


H = {"X-Google-Photos-Token": "GTOKEN"}


def test_session_flow_and_item_mapping(env):
    c, fake = env["client"], env["fake"]
    res = c.post("/api/google-photos/sessions", headers=H)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["id"] == "sess-1" and body["pickerUri"].startswith("https://photos.google.com/")
    # Registered plan: at most 2000 photos per import == Google's own cap.
    sent = fake.requests[-1]
    assert b'"maxItemCount":"2000"' in sent.content.replace(b" ", b"")

    assert c.get("/api/google-photos/sessions/sess-1", headers=H).json()["mediaItemsSet"] is False
    assert c.get("/api/google-photos/sessions/sess-1/items", headers=H).status_code == 409

    fake.picked = True
    items = c.get("/api/google-photos/sessions/sess-1/items", headers=H).json()
    assert items["nextPageToken"] == "p2"
    assert items["skipped"] == 1  # the video
    assert items["items"] == [{
        "id": "m1", "createTime": "2023-05-14T17:20:00Z", "baseUrl": BASE, "mimeType": "image/jpeg",
        "filename": "PXL_1.jpg", "width": 4000, "height": 3000,
    }]
    assert c.delete("/api/google-photos/sessions/sess-1", headers=H).json() == {"ok": True}


def test_guest_session_is_capped_to_guest_plan(env, monkeypatch):
    main.app.dependency_overrides[get_current_user_required] = lambda: {"id": "g", "is_anonymous": True}
    env["client"].post("/api/google-photos/sessions", headers=H)
    assert b'"maxItemCount":"1000"' in env["fake"].requests[-1].content.replace(b" ", b"")


def test_media_proxy_resizes_and_never_caches(env):
    res = env["client"].get("/api/google-photos/media", params={"url": BASE, "size": 320}, headers=H)
    assert res.status_code == 200
    assert res.content.startswith(b"\xff\xd8\xff")
    assert res.headers["cache-control"] == "private, no-store"
    assert env["client"].get("/api/google-photos/media", params={"url": "https://evil.com/x", "size": 320}, headers=H).status_code == 400


@pytest.mark.parametrize("body, expect", [
    ({"error": {"code": 403, "status": "PERMISSION_DENIED", "message": "Photos Picker API has not been used in project 123 before or it is disabled.",
                "details": [{"reason": "SERVICE_DISABLED"}]}}, "isn't enabled"),
    ({"error": {"code": 403, "status": "PERMISSION_DENIED", "message": "Request had insufficient authentication scopes.",
                "details": [{"reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}}, "tick the Google Photos box"),
    ({"error": {"code": 403, "status": "PERMISSION_DENIED", "message": "Something else."}}, "Something else."),
])
def test_google_403s_explain_the_setup_problem(monkeypatch, body, expect):
    transport = httpx.MockTransport(lambda request: httpx.Response(403, json=body))
    real_client = httpx.AsyncClient
    monkeypatch.setattr(google_photos.httpx, "AsyncClient", lambda *a, **k: real_client(*a, **{**k, "transport": transport}))
    main.google_photos_rate_limiter.records.clear()
    main.app.dependency_overrides[get_current_user_required] = lambda: USER
    try:
        res = TestClient(main.app).post("/api/google-photos/sessions", headers=H)
    finally:
        main.app.dependency_overrides.pop(get_current_user_required, None)
    assert res.status_code == 403
    assert expect in res.json()["detail"]


def test_expired_google_token_is_401(monkeypatch):
    transport = httpx.MockTransport(lambda request: httpx.Response(401, json={"error": {"code": 401, "status": "UNAUTHENTICATED"}}))
    real_client = httpx.AsyncClient
    monkeypatch.setattr(google_photos.httpx, "AsyncClient", lambda *a, **k: real_client(*a, **{**k, "transport": transport}))
    main.google_photos_rate_limiter.records.clear()
    main.app.dependency_overrides[get_current_user_required] = lambda: USER
    try:
        res = TestClient(main.app).post("/api/google-photos/sessions", headers=H)
    finally:
        main.app.dependency_overrides.pop(get_current_user_required, None)
    assert res.status_code == 401
    assert "expired" in res.json()["detail"]


def test_missing_token_is_401(env):
    assert env["client"].post("/api/google-photos/sessions").status_code == 401
    assert env["client"].get("/api/google-photos/media", params={"url": BASE}).status_code == 401
