"""Batch 5B / P-07: link-preview meta endpoint, public cache headers + ETag/304, private no-store,
and the in-process public response cache with its invalidation."""
from typing import Any, Dict, List

import pytest
from fastapi.testclient import TestClient

import main
from services import storage


def _shared_meta(owner="owner-1", shared=True, library=False, data=None) -> Dict[str, Any]:
    return {
        "data": data or {"id": "tl-1", "title": "Roman Empire", "articles": [{"id": "e1"}], "updatedAt": "v1"},
        "owner_id": owner,
        "is_shared": shared,
        "is_library": library,
    }


@pytest.fixture
def client():
    main.app.dependency_overrides.clear()
    with TestClient(main.app) as c:
        yield c
    main.app.dependency_overrides.clear()


def _as(user):
    main.app.dependency_overrides[main.get_current_user_optional] = lambda: user


def test_anonymous_shared_view_is_public_with_etag_and_304(client, monkeypatch):
    calls: List[str] = []
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: calls.append(tid) or _shared_meta())
    _as(None)

    res = client.get("/api/timelines/tl-1")
    assert res.status_code == 200
    assert res.json()["title"] == "Roman Empire" and res.json()["isOwner"] is False
    assert res.headers["cache-control"] == main.PUBLIC_CACHE_CONTROL
    assert "Authorization" in res.headers["vary"]
    etag = res.headers["etag"]

    again = client.get("/api/timelines/tl-1", headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b""
    assert calls == ["tl-1"]  # the second view came from the in-process cache


def test_owner_and_signed_in_views_are_private_no_store(client, monkeypatch):
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: _shared_meta(shared=False))
    _as({"id": "owner-1"})
    res = client.get("/api/timelines/tl-1", headers={"Authorization": "Bearer x"})
    assert res.status_code == 200 and res.json()["isOwner"] is True
    assert res.headers["cache-control"] == "private, no-store"
    assert "etag" not in res.headers

    # A signed-in non-owner of a shared timeline isn't served (or stored) from the public cache either.
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: _shared_meta())
    _as({"id": "someone"})
    res = client.get("/api/timelines/tl-1", headers={"Authorization": "Bearer y"})
    assert res.headers["cache-control"] == "private, no-store"
    assert storage.public_cache_get("timeline", "tl-1") is None


def test_private_timeline_is_still_404_for_anonymous_viewers(client, monkeypatch):
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: _shared_meta(shared=False))
    _as(None)
    assert client.get("/api/timelines/tl-1").status_code == 404
    assert storage.public_cache_get("timeline", "tl-1") is None


def test_cache_is_dropped_by_saves_shares_and_deletes(client, monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "SUPABASE_URL", "")
    monkeypatch.setattr(storage, "SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setattr(storage, "TIMELINES_FILE", tmp_path / "timelines.json")
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)
    (tmp_path / "timelines.json").write_text("[]", encoding="utf-8")
    timeline = {"id": "tl-1", "title": "First", "articles": [{"id": "e1", "title": "A", "from": {"year": 1}}]}
    storage.save_timeline_data(dict(timeline), user_id=None, existing_meta=None)  # unowned = public locally
    _as(None)

    assert client.get("/api/timelines/tl-1").json()["title"] == "First"
    assert storage.public_cache_get("timeline", "tl-1") is not None

    meta = storage.get_timeline_access_meta("tl-1")
    storage.save_timeline_data({**timeline, "title": "Second"}, existing_meta=meta)
    assert storage.public_cache_get("timeline", "tl-1") is None
    assert client.get("/api/timelines/tl-1").json()["title"] == "Second"

    storage.set_timeline_shared("tl-1", "", False)
    assert storage.public_cache_get("timeline", "tl-1") is None
    client.get("/api/timelines/tl-1")
    storage.delete_timeline_data("tl-1", force_delete=True)
    assert storage.public_cache_get("timeline", "tl-1") is None


def test_public_cache_is_bounded_and_expires(monkeypatch):
    monkeypatch.setattr(storage, "PUBLIC_TIMELINE_CACHE_MAX_BYTES", 100)
    storage.public_cache_put("timeline", "a", ("e", b"x" * 60), 60)
    storage.public_cache_put("timeline", "b", ("e", b"x" * 60), 60)
    assert storage.public_cache_get("timeline", "a") is None  # evicted, oldest first
    assert storage.public_cache_get("timeline", "b") is not None
    monkeypatch.setattr(storage, "PUBLIC_TIMELINE_CACHE_TTL_SECONDS", 0.0)
    storage.public_cache_put("timeline", "c", ("e", b"x"), 1)
    assert storage.public_cache_get("timeline", "c") is None  # TTL 0 disables caching


def test_meta_endpoint_returns_only_preview_fields(client, monkeypatch):
    monkeypatch.setattr(main, "get_timeline_share_meta", lambda tid: {
        "owner_id": "owner-1", "is_shared": True, "is_library": False, "is_deleted": False,
        "title": "Roman Empire", "description": "Rise and fall", "article_count": 12, "updated_at": "v9",
        "cover_candidates": ["data:image/png;base64," + "A" * 50_000, "//upload.wikimedia.org/x.svg", "https://img/x.jpg"],
    })
    _as(None)
    res = client.get("/api/timelines/tl-1/meta")
    assert res.status_code == 200
    assert res.json() == {
        "id": "tl-1", "title": "Roman Empire", "description": "Rise and fall",
        "coverImageUrl": "https://img/x.jpg", "articleCount": 12, "updatedAt": "v9",
    }
    assert res.headers["cache-control"] == main.PUBLIC_CACHE_CONTROL
    assert client.get("/api/timelines/tl-1/meta", headers={"If-None-Match": res.headers["etag"]}).status_code == 304


def test_meta_endpoint_keeps_private_timelines_hidden(client, monkeypatch):
    base = {"owner_id": "owner-1", "is_shared": False, "is_library": False, "is_deleted": False,
            "title": "Secret", "description": "", "article_count": 1, "updated_at": "v1", "cover_candidates": []}
    monkeypatch.setattr(main, "get_timeline_share_meta", lambda tid: dict(base))
    _as(None)
    assert client.get("/api/timelines/tl-1/meta").status_code == 404
    _as({"id": "owner-1"})
    res = client.get("/api/timelines/tl-1/meta", headers={"Authorization": "Bearer x"})
    assert res.status_code == 200 and res.headers["cache-control"] == "private, no-store"
    monkeypatch.setattr(main, "get_timeline_share_meta", lambda tid: {**base, "is_shared": True, "is_deleted": True})
    _as(None)
    assert client.get("/api/timelines/tl-1/meta").status_code == 404


def test_share_meta_reads_light_columns_only(monkeypatch):
    seen: List[str] = []

    class _Resp:
        status_code = 200
        text = ""

        def json(self):
            return [{"id": "tl-1", "user_id": "o", "is_shared": True, "title": "T", "description": "D",
                     "article_count": 5, "updated_at": "u", "is_library": False, "is_deleted": False,
                     "data_updated_at": "v2", "cover_url": None, "img0": "https://a/b.jpg"}]

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
    meta = storage.get_timeline_share_meta("tl-1")
    assert ",data," not in f",{seen[0]}," and "data->articles->0->>imageUrl" in seen[0]
    assert meta["article_count"] == 5 and meta["updated_at"] == "v2" and meta["cover_candidates"] == ["https://a/b.jpg"]


def test_library_is_public_for_anonymous_and_private_for_signed_in(client, monkeypatch):
    cards = [{"id": "lib-1", "title": "L", "language": "en", "contentMode": "classic", "coverImageUrl": "https://c"}]
    monkeypatch.setattr(main, "list_library_timelines_fast_page", lambda *a, **k: (list(cards), 1))
    _as(None)
    res = client.get("/api/library?limit=12")
    assert res.status_code == 200 and res.json()["items"][0]["id"] == "lib-1"
    assert res.headers["cache-control"] == main.PUBLIC_CACHE_CONTROL and res.headers.get("etag")
    assert client.get("/api/library?limit=12", headers={"If-None-Match": res.headers["etag"]}).status_code == 304
    _as({"id": "admin", "is_admin": True})
    res = client.get("/api/library?limit=12", headers={"Authorization": "Bearer x"})
    assert res.headers["cache-control"] == "private, no-store"
