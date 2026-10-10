import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from services import youtube_service

SUPABASE_URL = "https://fake.supabase.co"
YT_PAYLOAD = {
    "items": [
        {
            "id": {"videoId": "abcdefghijk"},
            "snippet": {
                "title": "Queen &amp; Prince",
                "channelTitle": "Royal &quot;Edits&quot;",
                "publishedAt": "2026-09-01T00:00:00Z",
                "thumbnails": {"medium": {"url": "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg"}},
            },
        },
        {"id": {"videoId": "bad id"}, "snippet": {"title": "x"}},
        {"id": {"channelId": "UC123"}, "snippet": {"title": "channel"}},
    ]
}


class _FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _FakeWorld:
    """Stands in for both the YouTube API and the Supabase cache table."""

    def __init__(self, youtube_response):
        self.youtube_response = youtube_response
        self.youtube_calls = []
        self.rows = {}

    def client_class(self):
        world = self

        class _Client:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def get(self, url, params=None, headers=None, timeout=None):
                if url.startswith(SUPABASE_URL):
                    key = params["cache_key"].removeprefix("eq.")
                    return _FakeResponse(200, [world.rows[key]] if key in world.rows else [])
                if isinstance(world.youtube_response, Exception):
                    raise world.youtube_response
                world.youtube_calls.append(params)
                return world.youtube_response

            async def post(self, url, json=None, headers=None, timeout=None):
                world.rows[json["cache_key"]] = json
                return _FakeResponse(201)

        return _Client


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    # Test modules load the real .env; never touch the live Supabase project.
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setenv("YOUTUBE_API_KEY", "test-key")
    monkeypatch.setattr(youtube_service, "_remote_disabled_until", 0.0)
    youtube_service._cache.clear()
    yield
    youtube_service._cache.clear()


def _install(monkeypatch, youtube_response):
    world = _FakeWorld(youtube_response)
    monkeypatch.setattr(youtube_service.httpx, "AsyncClient", world.client_class())
    return world


def _enable_supabase(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_URL)
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")


def test_not_configured_without_key(monkeypatch):
    monkeypatch.delenv("YOUTUBE_API_KEY", raising=False)
    result = asyncio.run(youtube_service.search_youtube_videos("Elizabeth II"))
    assert result == {"configured": False, "items": []}


def test_parses_filters_and_caches_in_memory(monkeypatch):
    world = _install(monkeypatch, _FakeResponse(200, YT_PAYLOAD))

    first = asyncio.run(youtube_service.search_youtube_videos("  Elizabeth   II ", "HE"))
    second = asyncio.run(youtube_service.search_youtube_videos("elizabeth ii", "he"))

    assert first["items"] == [{
        "videoId": "abcdefghijk",
        "title": "Queen & Prince",
        "channel": 'Royal "Edits"',
        "publishedAt": "2026-09-01T00:00:00Z",
        "thumbnail": "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg",
    }]
    assert second is first
    assert len(world.youtube_calls) == 1
    assert world.youtube_calls[0]["q"] == "Elizabeth II"
    assert world.youtube_calls[0]["relevanceLanguage"] == "he"
    assert world.youtube_calls[0]["videoEmbeddable"] == "true"


def test_persistent_cache_survives_restart(monkeypatch):
    _enable_supabase(monkeypatch)
    world = _install(monkeypatch, _FakeResponse(200, YT_PAYLOAD))

    first = asyncio.run(youtube_service.search_youtube_videos("Apollo 11", "en"))
    youtube_service._cache.clear()  # simulate a server restart
    second = asyncio.run(youtube_service.search_youtube_videos("apollo 11", "en"))

    assert len(world.youtube_calls) == 1
    assert len(world.rows) == 1
    assert second["items"] == first["items"]


def test_expired_persistent_entry_is_refetched(monkeypatch):
    _enable_supabase(monkeypatch)
    world = _install(monkeypatch, _FakeResponse(200, YT_PAYLOAD))
    asyncio.run(youtube_service.search_youtube_videos("Apollo 11"))
    old = datetime.now(timezone.utc) - timedelta(days=31)
    for row in world.rows.values():
        row["fetched_at"] = old.isoformat()
    youtube_service._cache.clear()

    asyncio.run(youtube_service.search_youtube_videos("Apollo 11"))
    assert len(world.youtube_calls) == 2


def test_quota_error_is_not_cached(monkeypatch):
    _enable_supabase(monkeypatch)
    world = _install(monkeypatch, _FakeResponse(403, {}))

    result = asyncio.run(youtube_service.search_youtube_videos("Apollo 11", "not a lang"))
    asyncio.run(youtube_service.search_youtube_videos("Apollo 11"))

    assert result == {"configured": True, "items": [], "error": "quota"}
    assert "relevanceLanguage" not in world.youtube_calls[0]
    assert len(world.youtube_calls) == 2
    assert world.rows == {}


def test_network_error_returns_unavailable(monkeypatch):
    _install(monkeypatch, httpx.ConnectError("boom"))
    result = asyncio.run(youtube_service.search_youtube_videos("Apollo 11"))
    assert result == {"configured": True, "items": [], "error": "unavailable"}
