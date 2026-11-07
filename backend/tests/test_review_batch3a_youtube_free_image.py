"""Batch 3A - S-13 (YouTube search: session + global daily budget) and S-12 (free-image daily caps)."""
import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

import main
from services import gemini_service, quota_service, youtube_service
from services.auth_service import get_current_user_optional, get_current_user_required
from services.byok_verification import mark_custom_key_verified

YT_PAYLOAD = {"items": [{"id": {"videoId": "abcdefghijk"}, "snippet": {"title": "Moon landing"}}]}


class _YouTubeClient:
    calls = []
    fail = False

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, params=None, headers=None, timeout=None):
        _YouTubeClient.calls.append(params)
        if _YouTubeClient.fail:
            raise httpx.ConnectError("down")
        return httpx.Response(200, json=YT_PAYLOAD)


@pytest.fixture
def yt_env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setenv("GCLOUD_API_KEY", "test-key")
    monkeypatch.setenv("YOUTUBE_DAILY_SEARCH_BUDGET", "2")
    monkeypatch.setattr(quota_service, "_youtube_budget_spent", ("", 0.0))
    youtube_service._cache.clear()
    _YouTubeClient.calls = []
    _YouTubeClient.fail = False
    monkeypatch.setattr(youtube_service.httpx, "AsyncClient", _YouTubeClient)
    yield
    youtube_service._cache.clear()


def _budget_used():
    ident = quota_service.YOUTUBE_SEARCH_BUDGET_ID
    return quota_service.get_usage_for_identifiers([ident], date_str=quota_service._youtube_quota_day())[ident]


def test_youtube_daily_budget_enforced_and_cache_hits_are_free(yt_env):
    run = lambda q: asyncio.run(youtube_service.search_youtube_videos(q))
    assert run("Apollo 11")["items"]
    assert run("Apollo 12")["items"]
    assert _budget_used() == 2
    # Cached query: served without touching the budget or the API.
    assert run("apollo 11")["items"]
    assert len(_YouTubeClient.calls) == 2 and _budget_used() == 2
    # Budget spent: graceful fallback (the UI shows its "search on YouTube" link), no API call.
    spent = run("Apollo 13")
    assert spent == {"configured": True, "items": [], "error": "quota"}
    assert len(_YouTubeClient.calls) == 2
    assert _budget_used() == 2


def test_youtube_transport_error_refunds_budget(yt_env):
    _YouTubeClient.fail = True
    assert asyncio.run(youtube_service.search_youtube_videos("Apollo 11"))["error"] == "unavailable"
    assert _budget_used() == 0


def test_youtube_budget_disabled_with_zero(yt_env, monkeypatch):
    monkeypatch.setenv("YOUTUBE_DAILY_SEARCH_BUDGET", "0")
    for i in range(4):
        assert asyncio.run(youtube_service.search_youtube_videos(f"Apollo {i}"))["items"]


def test_youtube_search_requires_session(yt_env):
    main.media_search_rate_limiter.records.clear()
    main.app.dependency_overrides.clear()
    with TestClient(main.app) as client:
        assert client.get("/api/media/youtube-search", params={"q": "Apollo 11"}).status_code == 401
        main.app.dependency_overrides[get_current_user_required] = lambda: {"id": "g", "is_anonymous": True}
        try:
            res = client.get("/api/media/youtube-search", params={"q": "Apollo 11"})
        finally:
            main.app.dependency_overrides.clear()
    assert res.status_code == 200 and res.json()["items"]


# --- S-12: free image engine ---------------------------------------------------------------------

USER = {"id": "free-img-user", "email": "free@example.com"}
ADMIN = {"id": "free-img-admin", "email": "admin@example.com"}


@pytest.fixture
def image_env(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")
    monkeypatch.setenv("FREE_IMAGE_DAILY_LIMIT", "2")
    monkeypatch.setenv("FREE_IMAGE_IP_DAILY_LIMIT", "3")
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY")
    monkeypatch.setattr(quota_service, "_KEY_COOLDOWNS", {})
    for limiter in (main.event_suggest_rate_limiter, main.free_image_rate_limiter):
        limiter.records.clear()

    calls = []

    async def fake_generate(**kwargs):
        calls.append(kwargs)
        if kwargs.get("title") == "boom":
            raise RuntimeError("generator failed")
        return {"imageUrl": "data:image/jpeg;base64,X", "model": "free" if kwargs.get("prefer_free") else "gemini"}

    monkeypatch.setattr(main, "generate_event_image_with_gemini", fake_generate)
    current = {"user": USER}
    main.app.dependency_overrides[get_current_user_optional] = lambda: current["user"]
    main.app.dependency_overrides[get_current_user_required] = lambda: current["user"]
    with TestClient(main.app) as client:
        def post(engine="free", ip="198.51.100.1", title="Moon", headers=None):
            return client.post(
                "/api/timeline/generate-event-image",
                json={"title": title, "engine": engine},
                headers={"X-Forwarded-For": ip, **(headers or {})},
            )
        yield {"post": post, "calls": calls, "as_user": lambda u: current.__setitem__("user", u)}
    main.app.dependency_overrides.clear()


def test_free_image_cap_per_identity(image_env):
    post = image_env["post"]
    assert post().status_code == 200
    assert post().status_code == 200
    res = post()
    assert res.status_code == 429
    assert int(res.headers["Retry-After"]) > 0
    # Another account on another IP is unaffected.
    image_env["as_user"]({"id": "someone-else", "email": "x@example.com"})
    assert post(ip="198.51.100.2").status_code == 200


def test_free_image_cap_per_ip_backstop(image_env):
    post = image_env["post"]
    for i in range(3):
        image_env["as_user"]({"id": f"guest-{i}", "is_anonymous": True})
        assert post().status_code == 200
    image_env["as_user"]({"id": "guest-new", "is_anonymous": True})
    assert post().status_code == 429
    assert post(ip="198.51.100.9").status_code == 200


def test_free_image_cap_not_widened_by_byok(image_env):
    mark_custom_key_verified("MY_KEY")
    post = image_env["post"]
    assert post(headers={"X-Gemini-Api-Key": "MY_KEY"}).status_code == 200
    assert post(headers={"X-Gemini-Api-Key": "MY_KEY"}).status_code == 200
    assert post(headers={"X-Gemini-Api-Key": "MY_KEY"}).status_code == 429


def test_failed_free_image_is_refunded(image_env):
    post = image_env["post"]
    assert post(title="boom").status_code == 500
    assert post().status_code == 200
    assert post().status_code == 200


def test_admin_exempt_from_free_image_cap(image_env):
    image_env["as_user"](ADMIN)
    for _ in range(5):
        assert image_env["post"]().status_code == 200


def test_premium_path_unaffected_by_free_cap(image_env):
    post = image_env["post"]
    post()
    post()
    assert post().status_code == 429
    res = post(engine="premium")
    assert res.status_code == 200, res.text
    assert res.json()["model"] == "gemini"
    assert image_env["calls"][-1]["prefer_free"] is False
