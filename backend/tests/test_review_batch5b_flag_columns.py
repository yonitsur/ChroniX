"""Batch 5B / P-06: generated flag columns for the Library index, list projections and access meta,
with a cached fallback to the JSONB expressions when migration 004 isn't applied."""
from typing import Any, Dict, List, Optional

import pytest

from services import storage


class _Resp:
    def __init__(self, status_code: int, payload: Any, text: Optional[str] = None):
        self.status_code = status_code
        self._payload = payload
        self.text = text if text is not None else str(payload)

    def json(self) -> Any:
        return self._payload


class _FakeDb:
    """Answers PostgREST GETs; `columns_installed=False` makes any `flag_` reference a 42703."""

    def __init__(self, columns_installed: bool, rows: List[Dict[str, Any]]):
        self.columns_installed = columns_installed
        self.rows = rows
        self.calls: List[Dict[str, str]] = []

    def client(self):
        db = self

        class _Client:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get(self, url, headers=None, params=None):
                params = dict(params or {})
                db.calls.append(params)
                uses_flags = any("flag_" in str(k) or "flag_" in str(v) for k, v in params.items())
                if uses_flags and not db.columns_installed:
                    body = {"code": "42703", "message": "column timelines.flag_is_library does not exist"}
                    return _Resp(400, body, text=str(body))
                return _Resp(200, db.rows)

        return _Client()


@pytest.fixture
def supabase_env(monkeypatch):
    monkeypatch.setattr(storage, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(storage, "SUPABASE_SERVICE_ROLE_KEY", "service-key")
    storage.reset_flag_columns_detection()
    yield
    storage.reset_flag_columns_detection()


def _install(monkeypatch, db: _FakeDb) -> None:
    monkeypatch.setattr(storage, "_supabase_http_client", db.client)


def test_access_meta_uses_generated_columns_without_touching_data(supabase_env, monkeypatch):
    db = _FakeDb(True, [{
        "id": "tl-1", "user_id": "owner", "is_public": False, "is_shared": True, "article_count": 4,
        "is_library": True, "is_featured": False, "featured_order": 3, "is_deleted": False,
        "hidden_from_saved": False, "data_updated_at": "2026-01-01T00:00:00Z", "legacy_podcast": True,
    }])
    _install(monkeypatch, db)

    meta = storage.get_timeline_access_meta("tl-1")

    assert len(db.calls) == 1
    select = db.calls[0]["select"]
    assert "flag_is_library" in select and "flag_updated_at" in select
    assert "data->" not in select  # nothing is read out of the JSONB column
    assert meta["owner_id"] == "owner" and meta["is_shared"] is True and meta["is_library"] is True
    assert meta["featured_order"] == 3 and meta["updated_at"] == "2026-01-01T00:00:00Z"
    assert meta["has_legacy_podcast"] is True and meta["article_count"] == 4


def test_access_meta_falls_back_to_json_and_caches_the_missing_columns(supabase_env, monkeypatch):
    db = _FakeDb(False, [{
        "id": "tl-1", "user_id": "owner", "is_public": True, "is_shared": True, "article_count": 2,
        "is_library": "true", "is_featured": None, "featured_order": None, "is_deleted": None,
        "is_deleted_alt": None, "hidden_from_saved": None, "data_updated_at": "v1", "legacy_podcast_seg": None,
    }])
    _install(monkeypatch, db)

    first = storage.get_timeline_access_meta("tl-1")
    assert [("flag_" in c["select"]) for c in db.calls] == [True, False]
    assert first["is_library"] is True and first["updated_at"] == "v1"

    db.calls.clear()
    storage.get_timeline_access_meta("tl-1")
    assert len(db.calls) == 1 and "flag_" not in db.calls[0]["select"]  # the verdict is cached


def test_list_all_timelines_uses_flag_and_mode_columns(supabase_env, monkeypatch):
    db = _FakeDb(True, [{
        "id": "tl-1", "title": "T", "description": "", "time_scale": "calendar", "article_count": 3,
        "is_personal": False, "is_pinned": False, "is_public": False, "is_shared": False,
        "created_at": "c", "updated_at": "u", "user_id": "owner", "content_mode": "kids",
        "search_mode": "web_search", "creation_src": "manual", "is_library": False, "is_featured": False,
        "is_deleted": False, "hidden_from_saved": False,
    }])
    _install(monkeypatch, db)

    items = storage.list_all_timelines(user_id="owner")

    assert len(db.calls) == 1
    select = db.calls[0]["select"]
    assert "flag_is_deleted" in select and "content_mode" in select and "data->" not in select
    assert items[0]["contentMode"] == "kids" and items[0]["searchMode"] == "web_search"


def test_list_all_timelines_falls_back_when_columns_are_missing(supabase_env, monkeypatch):
    db = _FakeDb(False, [{
        "id": "tl-1", "title": "T", "description": "", "time_scale": "calendar", "article_count": 3,
        "created_at": "c", "updated_at": "u", "user_id": "owner", "content_mode": "classic",
    }])
    _install(monkeypatch, db)

    items = storage.list_all_timelines(user_id="owner")

    assert [("flag_" in c["select"]) for c in db.calls] == [True, False]
    assert "content_mode:data->>contentMode" in db.calls[1]["select"]
    assert [it["id"] for it in items] == ["tl-1"]


def test_library_index_filters_on_the_indexed_flag_column(supabase_env, monkeypatch):
    db = _FakeDb(True, [{"id": "lib-1", "title": "L", "updated_at": "u", "is_featured": True, "is_deleted": False}])
    with db.client() as client:
        rows, has_inline = storage._fetch_supabase_library_index_rows(client, "https://x/rest/v1/timelines", {})
    assert rows and not has_inline
    assert db.calls[0].get("flag_is_library") == "is.true"
    assert "data->>isLibrary" not in db.calls[0]


def test_library_index_falls_back_to_the_json_filter(supabase_env):
    db = _FakeDb(False, [{"id": "lib-1", "title": "L", "updated_at": "u"}])
    with db.client() as client:
        rows, _ = storage._fetch_supabase_library_index_rows(client, "https://x/rest/v1/timelines", {})
    assert rows
    assert db.calls[0].get("flag_is_library") == "is.true"
    assert db.calls[1].get("data->>isLibrary") == "eq.true"
    assert not storage._flag_columns_enabled()


def test_versioned_patch_still_filters_on_the_json_version(supabase_env, monkeypatch):
    seen: List[Dict[str, str]] = []

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def patch(self, url, headers=None, params=None, json=None):
            seen.append(dict(params))
            return _Resp(200, [{"id": "tl-1"}])

    monkeypatch.setattr(storage, "_supabase_http_client", lambda: _Client())
    storage._supabase_update_timeline("tl-1", "owner", {"data": {}}, {}, base_updated_at="v1")
    assert seen[0]["data->>updatedAt"] == "eq.v1"


def test_migration_004_matches_the_python_truthiness_rule():
    sql = (storage.Path(__file__).resolve().parent.parent / "migrations" / "004_timeline_flag_columns.sql").read_text(encoding="utf-8")
    for col in ("flag_is_library", "flag_is_featured", "flag_is_deleted", "flag_hidden_from_saved",
                "flag_featured_order", "flag_updated_at", "flag_has_legacy_podcast"):
        assert f"add column if not exists {col}" in sql
    # String flags count like _is_truthy_flag: trimmed, lower-cased 'true' / '1'.
    assert "lower(btrim(data->>'isLibrary')) in ('true', '1')" in sql
    assert "where flag_is_library = true" in sql
    # Python: str(True) / "1" are truthy, a JSON number 1 is not.
    assert storage._is_timeline_in_library({"isLibrary": " TRUE "}) and storage._is_timeline_in_library({"is_library": "1"})
    assert not storage._is_timeline_in_library({"isLibrary": 1})
