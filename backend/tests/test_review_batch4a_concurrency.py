"""Batch 4A-1: optimistic concurrency on timeline writes (B-04) and Library content fingerprint (B-11)."""
import asyncio
import copy
import json
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

import pytest
from fastapi.testclient import TestClient

import main
from models import RefineTimelineRequest, TimelineChatOutput, TimelineData
from services import storage
from services.auth_service import get_current_user_optional, get_current_user_required

ADMIN = {"id": "admin-1", "email": "admin@example.com", "email_confirmed_at": "2026-01-01T00:00:00Z", "is_anonymous": False}
OWNER = {"id": "owner-1", "email": "owner@example.com", "is_anonymous": False}


def _timeline(tid: str, title: str = "Space Race", **extra) -> Dict[str, Any]:
    return {
        "id": tid,
        "title": title,
        "articles": [
            {"id": "evt-1", "title": "Sputnik", "from": {"year": 1957}},
            {"id": "evt-2", "title": "Apollo 11", "from": {"year": 1969}},
        ],
        **extra,
    }


# --------------------------------------------------------------------------------------------
# Local JSON mode fixtures
# --------------------------------------------------------------------------------------------

@pytest.fixture
def local_store(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "SUPABASE_URL", "")
    monkeypatch.setattr(storage, "SUPABASE_SERVICE_ROLE_KEY", "")
    local_file = tmp_path / "timelines.json"
    local_file.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(storage, "TIMELINES_FILE", local_file)
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    storage._LOCAL_TIMELINES_CACHE_KEY = None
    storage._LOCAL_TIMELINES_CACHE_DATA = None
    storage.invalidate_library_cache()
    return local_file


@pytest.fixture
def api(local_store):
    current = {"user": OWNER}
    main.app.dependency_overrides[get_current_user_optional] = lambda: current["user"]
    main.app.dependency_overrides[get_current_user_required] = lambda: current["user"]
    main.timeline_save_rate_limiter.records.clear()
    try:
        with TestClient(main.app) as client:
            yield {"client": client, "file": local_store, "as_user": lambda u: current.__setitem__("user", u)}
    finally:
        main.app.dependency_overrides.clear()


def _rows(local_file) -> Dict[str, dict]:
    return {r["id"]: r for r in json.loads(local_file.read_text(encoding="utf-8"))}


def _seed(local_file, row: Dict[str, Any]) -> None:
    rows = json.loads(local_file.read_text(encoding="utf-8"))
    rows.append(row)
    local_file.write_text(json.dumps(rows), encoding="utf-8")
    storage._LOCAL_TIMELINES_CACHE_KEY = None
    storage._LOCAL_TIMELINES_CACHE_DATA = None


def _owned(tid: str, version: str = "2026-01-01T00:00:00.000001Z", **extra) -> Dict[str, Any]:
    return {**_timeline(tid, "Stored"), "user_id": OWNER["id"], "updatedAt": version, **extra}


# --------------------------------------------------------------------------------------------
# B-04: version precondition on POST /api/timelines
# --------------------------------------------------------------------------------------------

def test_stale_base_is_409_and_row_is_unchanged(api):
    _seed(api["file"], _owned("tl-1", "v-current"))
    before = copy.deepcopy(_rows(api["file"])["tl-1"])

    res = api["client"].post("/api/timelines", json={**_timeline("tl-1", "Lost edit"), "baseUpdatedAt": "v-old"})

    assert res.status_code == 409
    body = res.json()
    assert body["code"] == "stale_write"
    assert body["current_updated_at"] == "v-current"
    assert body["detail"]
    assert _rows(api["file"])["tl-1"] == before


def test_matching_base_succeeds_and_returns_new_version(api):
    _seed(api["file"], _owned("tl-1", "v-current"))

    res = api["client"].post("/api/timelines", json={**_timeline("tl-1", "Edited"), "baseUpdatedAt": "v-current"})

    assert res.status_code == 200, res.text
    saved = res.json()
    assert saved["title"] == "Edited"
    assert saved["updatedAt"] and saved["updatedAt"] != "v-current"
    assert "baseUpdatedAt" not in saved
    row = _rows(api["file"])["tl-1"]
    assert row["updatedAt"] == saved["updatedAt"] and "baseUpdatedAt" not in row

    # The version just returned is the next base; the old one is now stale.
    again = api["client"].post("/api/timelines", json={**_timeline("tl-1", "Again"), "baseUpdatedAt": saved["updatedAt"]})
    assert again.status_code == 200, again.text
    stale = api["client"].post("/api/timelines", json={**_timeline("tl-1", "Stale"), "baseUpdatedAt": saved["updatedAt"]})
    assert stale.status_code == 409 and stale.json()["code"] == "stale_write"


def test_no_base_keeps_last_write_wins_for_old_clients(api):
    _seed(api["file"], _owned("tl-1", "v-current"))
    res = api["client"].post("/api/timelines", json=_timeline("tl-1", "Legacy client"))
    assert res.status_code == 200, res.text
    assert _rows(api["file"])["tl-1"]["title"] == "Legacy client"


def test_new_id_ignores_base(api):
    res = api["client"].post("/api/timelines", json={**_timeline("tl-new", "Fresh"), "baseUpdatedAt": "anything"})
    assert res.status_code == 200, res.text
    assert _rows(api["file"])["tl-new"]["user_id"] == OWNER["id"]


def test_soft_deleted_row_is_not_resurrected(api):
    _seed(api["file"], _owned("tl-del", isDeleted=True, deletedAt="2026-01-02T00:00:00Z"))
    before = copy.deepcopy(_rows(api["file"])["tl-del"])

    res = api["client"].post("/api/timelines", json=_timeline("tl-del", "Stale app copy"))

    assert res.status_code == 410
    assert res.json()["code"] == "timeline_deleted"
    assert _rows(api["file"])["tl-del"] == before


def test_storage_level_stale_and_gone(local_store):
    _seed(local_store, _owned("tl-s", "v1"))
    meta = storage.get_timeline_access_meta("tl-s")
    assert meta["updated_at"] == "v1"
    with pytest.raises(storage.TimelineStaleWriteError) as exc:
        storage.save_timeline_data(_timeline("tl-s", "x"), user_id=OWNER["id"], existing_meta=meta, base_updated_at="v0")
    assert exc.value.current_updated_at == "v1"
    _seed(local_store, _owned("tl-g", isDeleted=True))
    with pytest.raises(storage.TimelineGoneError):
        storage.save_timeline_data(_timeline("tl-g"), user_id=OWNER["id"], existing_meta=storage.get_timeline_access_meta("tl-g"))


def test_hidden_from_saved_library_row_stays_hidden_after_owner_cosmetic_save(api):
    _seed(api["file"], _owned("lib-h", isLibrary=True, isFeatured=True, hiddenFromSaved=True))
    tl = _timeline("lib-h", "Stored")
    tl["articles"][0]["videos"] = [{"id": "yt1"}]
    res = api["client"].post("/api/timelines", json=tl)
    assert res.status_code == 200, res.text
    row = _rows(api["file"])["lib-h"]
    assert row["isLibrary"] is True and row["hiddenFromSaved"] is True


# --------------------------------------------------------------------------------------------
# B-04 (7): generic saves never change Library flags, admins included
# --------------------------------------------------------------------------------------------

def test_admin_generic_save_keeps_stored_library_flags(api):
    _seed(api["file"], {**_timeline("lib-a", "Curated"), "user_id": OWNER["id"], "isLibrary": True, "isFeatured": True, "featuredOrder": 3})
    api["as_user"](ADMIN)

    stale_copy = {**_timeline("lib-a", "Admin typo fix"), "isLibrary": False, "isFeatured": False, "featuredOrder": 9}
    res = api["client"].post("/api/timelines", json=stale_copy)

    assert res.status_code == 200, res.text
    row = _rows(api["file"])["lib-a"]
    assert row["title"] == "Admin typo fix"
    assert row["isLibrary"] is True and row["isFeatured"] is True and row["featuredOrder"] == 3


def test_admin_cannot_publish_or_duplicate_into_library_via_generic_save(api):
    _seed(api["file"], {**_timeline("priv-1", "Private"), "user_id": OWNER["id"]})
    api["as_user"](ADMIN)
    assert api["client"].post("/api/timelines", json={**_timeline("priv-1", "Private"), "isLibrary": True, "isFeatured": True}).status_code == 200
    assert not _rows(api["file"])["priv-1"].get("isLibrary")

    # "Duplicate" of a Library item: a new id carrying the source's flags.
    dup = {**_timeline("dup-1", "Copy of Curated"), "isLibrary": True, "isFeatured": True, "featuredOrder": 0}
    assert api["client"].post("/api/timelines", json=dup).status_code == 200
    row = _rows(api["file"])["dup-1"]
    assert not row.get("isLibrary") and not row.get("isFeatured") and "featuredOrder" not in row


# --------------------------------------------------------------------------------------------
# B-11: owner's cosmetic / automatic saves keep the Library listing; content changes unpublish
# --------------------------------------------------------------------------------------------

def _library_owned(tid: str = "lib-o") -> Dict[str, Any]:
    return {**_timeline(tid, "Curated"), "user_id": OWNER["id"], "isLibrary": True, "isFeatured": True, "featuredOrder": 1}


@pytest.mark.parametrize("cosmetic", ["videos", "pin", "image_position"])
def test_owner_cosmetic_save_does_not_unpublish(api, cosmetic):
    _seed(api["file"], _library_owned())
    tl = _timeline("lib-o", "Curated")
    if cosmetic == "videos":
        tl["articles"][1].update(videos=[{"id": "yt1", "title": "Moon landing"}], videosQuery="Apollo 11")
    elif cosmetic == "pin":
        tl["isPinned"] = True
    else:
        tl["articles"][0].update(imagePositionX=20.0, imagePositionY=70.0)

    res = api["client"].post("/api/timelines", json=tl)

    assert res.status_code == 200, res.text
    row = _rows(api["file"])["lib-o"]
    assert row["isLibrary"] is True and row["isFeatured"] is True and row["featuredOrder"] == 1


@pytest.mark.parametrize("change", ["title", "event_text", "event_date", "added_event"])
def test_owner_content_change_still_unpublishes(api, change):
    _seed(api["file"], _library_owned())
    tl = _timeline("lib-o", "Curated")
    if change == "title":
        tl["title"] = "Renamed"
    elif change == "event_text":
        tl["articles"][0]["extract"] = "New narrative"
    elif change == "event_date":
        tl["articles"][0]["from"] = {"year": 1958}
    else:
        tl["articles"].append({"id": "evt-3", "title": "ISS", "from": {"year": 1998}})

    res = api["client"].post("/api/timelines", json=tl)

    assert res.status_code == 200, res.text
    row = _rows(api["file"])["lib-o"]
    assert row["isLibrary"] is False and row["isFeatured"] is False


def test_content_fingerprint_field_list():
    base = _timeline("fp")
    fp = storage.timeline_content_fingerprint(base)
    cosmetic = copy.deepcopy(base)
    cosmetic["isPinned"] = True
    cosmetic["chatQuestions"] = ["q?"]
    cosmetic["articles"][0].update(videos=[{"id": "x"}], videosQuery="q", imagePositionX=1, imagePositionY=2, _strippedMediaFields=["imageUrl"])
    cosmetic["articles"][1]["subtitle"] = None  # null == missing
    assert storage.timeline_content_fingerprint(cosmetic) == fp
    for mutate in (
        lambda t: t.update(description="d"),
        lambda t: t["articles"][0].update(imageUrl="https://example.com/new.jpg"),
        lambda t: t["articles"][0].update(lane="other"),
        lambda t: t.update(lanes=[{"id": "l1", "title": "Lane"}]),
    ):
        changed = copy.deepcopy(base)
        mutate(changed)
        assert storage.timeline_content_fingerprint(changed) != fp


# --------------------------------------------------------------------------------------------
# Supabase mode: the version filter is part of the PATCH itself
# --------------------------------------------------------------------------------------------

class FakeResp:
    def __init__(self, status_code: int, payload: Any = None) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload) if payload is not None else ""

    def json(self) -> Any:
        if self._payload is None:
            raise ValueError("no body")
        return self._payload


class VersionedFakeSupabase:
    """PostgREST `timelines` table that understands the `data->>...` aliases and filters used here."""

    def __init__(self) -> None:
        self.rows: Dict[str, Dict[str, Any]] = {}
        self.calls: List[Dict[str, Any]] = []
        self.before_patch = None  # hook(params) run before a PATCH is evaluated (simulates a racing write)
        fake = self

        class Client:
            def __init__(self, **kwargs: Any) -> None:
                pass

            def __enter__(self):
                return self

            def __exit__(self, *args: Any) -> bool:
                return False

            def get(self, url, headers=None, params=None):
                return fake._get(params or {})

            def post(self, url, headers=None, json=None):
                raise AssertionError("unexpected INSERT")

            def patch(self, url, headers=None, params=None, json=None):
                return fake._patch(headers or {}, params or {}, json)

        self.Client = Client

    def add_row(self, tid: str, owner: Optional[str], data: dict) -> None:
        self.rows[tid] = {"id": tid, "user_id": owner, "is_public": False, "is_shared": False, "data": copy.deepcopy(data)}

    def _get(self, params: Dict[str, Any]):
        self.calls.append({"method": "GET", "params": dict(params)})
        if params.get("data->>isLibrary") == "eq.true":
            rows = [copy.deepcopy(r) for r in self.rows.values() if (r["data"] or {}).get("isLibrary") is True]
            return FakeResp(200, rows)
        row = self.rows.get(str(params.get("id", "")).removeprefix("eq."))
        if row is None:
            return FakeResp(200, [])
        out = copy.deepcopy(row)
        data = out.get("data") or {}
        for alias, key in (("data_updated_at", "updatedAt"), ("is_library", "isLibrary"), ("is_featured", "isFeatured"),
                           ("is_deleted", "isDeleted"), ("featured_order", "featuredOrder")):
            val = data.get(key)
            out[alias] = None if val is None else (json.dumps(val) if isinstance(val, bool) else str(val))
        return FakeResp(200, [out])

    def _patch(self, headers, params, payload):
        self.calls.append({"method": "PATCH", "params": dict(params), "json": copy.deepcopy(payload)})
        if self.before_patch:
            hook, self.before_patch = self.before_patch, None
            hook(params)
        row = self.rows.get(str(params.get("id", "")).removeprefix("eq."))
        version_filter = params.get("data->>updatedAt")
        stored_version = (row or {}).get("data", {}).get("updatedAt") if row else None
        version_ok = version_filter is None or (
            version_filter == "is.null" and stored_version is None
        ) or (version_filter.startswith("eq.") and stored_version == version_filter[3:])
        owner_filter = params.get("user_id")
        owner_ok = row is not None and (
            owner_filter is None
            or (owner_filter == "is.null" and row["user_id"] is None)
            or (owner_filter.startswith("eq.") and row["user_id"] == owner_filter[3:])
        )
        if not (owner_ok and version_ok):
            return FakeResp(200, [])
        for key, val in payload.items():
            row[key] = copy.deepcopy(val)
        return FakeResp(200, [{"id": row["id"]}])

    def patches(self) -> List[Dict[str, Any]]:
        return [c for c in self.calls if c["method"] == "PATCH"]


@pytest.fixture
def supa(monkeypatch):
    fake = VersionedFakeSupabase()
    monkeypatch.setattr(storage, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(storage, "SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setattr(storage.httpx, "Client", fake.Client)
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    storage.invalidate_library_cache()
    return fake


def test_supabase_patch_carries_version_filter_and_maps_mismatch_to_stale(supa):
    supa.add_row("tl-1", OWNER["id"], {**_timeline("tl-1", "Stored"), "updatedAt": "v1"})
    meta = storage.get_timeline_access_meta("tl-1")
    assert meta["updated_at"] == "v1"

    # Another writer lands between the meta read and the PATCH: the filter makes the write miss.
    supa.before_patch = lambda params: supa.rows["tl-1"]["data"].update(updatedAt="v2", title="Theirs")
    with pytest.raises(storage.TimelineStaleWriteError) as exc:
        storage.save_timeline_data(_timeline("tl-1", "Mine"), user_id=OWNER["id"], existing_meta=meta, base_updated_at="v1")
    assert exc.value.current_updated_at == "v2"
    assert supa.patches()[0]["params"]["data->>updatedAt"] == "eq.v1"
    assert supa.rows["tl-1"]["data"]["title"] == "Theirs"

    saved = storage.save_timeline_data(
        _timeline("tl-1", "Mine, merged"), user_id=OWNER["id"],
        existing_meta=storage.get_timeline_access_meta("tl-1"), base_updated_at="v2",
    )
    assert supa.rows["tl-1"]["data"]["title"] == "Mine, merged"
    assert supa.rows["tl-1"]["data"]["updatedAt"] == saved["updatedAt"] != "v2"


def test_supabase_save_without_base_sends_no_version_filter(supa):
    supa.add_row("tl-1", OWNER["id"], {**_timeline("tl-1", "Stored"), "updatedAt": "v1"})
    storage.save_timeline_data(_timeline("tl-1", "Legacy"), user_id=OWNER["id"], existing_meta=storage.get_timeline_access_meta("tl-1"))
    assert "data->>updatedAt" not in supa.patches()[0]["params"]
    assert supa.rows["tl-1"]["data"]["title"] == "Legacy"


def test_library_status_patch_uses_version_and_retries_on_owner_edit(supa):
    supa.add_row("lib-1", OWNER["id"], {**_timeline("lib-1", "Curated"), "updatedAt": "v1", "isLibrary": True})

    def owner_saves_meanwhile(params):
        supa.rows["lib-1"]["data"].update(updatedAt="v2", title="Owner edit")

    supa.before_patch = owner_saves_meanwhile
    result = storage.set_timeline_library_status("lib-1", is_featured=True)

    assert result and result["isFeatured"] is True
    first, second = supa.patches()
    assert first["params"]["data->>updatedAt"] == "eq.v1"
    assert second["params"]["data->>updatedAt"] == "eq.v2"
    data = supa.rows["lib-1"]["data"]
    assert data["title"] == "Owner edit" and data["isFeatured"] is True


def test_library_reorder_patch_uses_version_and_retries_on_owner_edit(supa):
    supa.add_row("lib-a", OWNER["id"], {**_timeline("lib-a", "A"), "updatedAt": "va", "isLibrary": True, "featuredOrder": 0})
    supa.add_row("lib-b", OWNER["id"], {**_timeline("lib-b", "B"), "updatedAt": "vb", "isLibrary": True, "featuredOrder": 1})

    def owner_saves_meanwhile(params):
        supa.rows["lib-b"]["data"].update(updatedAt="vb2", title="B edited")

    supa.before_patch = owner_saves_meanwhile
    assert storage.reorder_library_timelines(["lib-b", "lib-a"]) == ["lib-b", "lib-a"]

    assert all("data->>updatedAt" in p["params"] for p in supa.patches())
    assert supa.rows["lib-b"]["data"]["title"] == "B edited"
    assert supa.rows["lib-b"]["data"]["featuredOrder"] == 0
    assert supa.rows["lib-a"]["data"]["featuredOrder"] == 1


# --------------------------------------------------------------------------------------------
# B-04 (2): server-side AI persistence with the start snapshot's version
# --------------------------------------------------------------------------------------------

@pytest.fixture
def no_activity(monkeypatch):
    @asynccontextmanager
    async def fake_activity(*args, **kwargs):
        yield {"details": {}}

    monkeypatch.setattr(main, "track_ai_activity", fake_activity)
    monkeypatch.setattr(main, "apply_timeline_result", lambda *a, **k: None)


def _refined(snapshot: Dict[str, Any]) -> TimelineData:
    data = copy.deepcopy(snapshot)
    data["articles"].append({"id": "evt-ai", "title": "Voyager", "from": {"year": 1977}})
    return TimelineData.model_validate(data)


def test_refine_with_stale_snapshot_is_not_persisted_and_reports_conflict(local_store, monkeypatch, no_activity):
    _seed(local_store, _owned("tl-r", "v2", title="Edited during the job"))
    before = copy.deepcopy(_rows(local_store)["tl-r"])
    snapshot = {**_timeline("tl-r", "Stored"), "updatedAt": "v1"}

    async def fake_failover(fn, api_key, key_tier, label=""):
        return _refined(snapshot)

    monkeypatch.setattr(main, "run_with_key_failover", fake_failover)
    req = RefineTimelineRequest(timeline=TimelineData.model_validate(snapshot), instruction="add Voyager")
    meta = storage.get_timeline_access_meta("tl-r")

    async def run():
        job_id = main._create_ai_job(OWNER, timeline_id="tl-r")
        await main._run_ai_job(
            job_id,
            lambda: main._execute_refine(req, "key", "paid", OWNER, target_owner=OWNER["id"], existing_meta=meta, job_id=job_id),
            OWNER, "refine",
        )
        return main._AI_JOBS.pop(job_id)

    job = asyncio.run(run())

    assert job["status"] == "done"
    assert job["result"]["persisted"] is False and job["result"]["conflict"] is True
    assert job["result"]["updatedAt"] == "v1"
    assert main._job_timeline_fields(job) == {"timeline_id": "tl-r", "persisted": False, "conflict": True}
    assert _rows(local_store)["tl-r"] == before


def test_refine_with_current_snapshot_persists_and_returns_new_version(local_store, monkeypatch, no_activity):
    _seed(local_store, _owned("tl-r", "v1"))
    snapshot = {**_timeline("tl-r", "Stored"), "updatedAt": "v1"}

    async def fake_failover(fn, api_key, key_tier, label=""):
        return _refined(snapshot)

    monkeypatch.setattr(main, "run_with_key_failover", fake_failover)
    req = RefineTimelineRequest(timeline=TimelineData.model_validate(snapshot), instruction="add Voyager")
    meta = storage.get_timeline_access_meta("tl-r")

    result = asyncio.run(main._execute_refine(req, "key", "paid", OWNER, target_owner=OWNER["id"], existing_meta=meta))

    row = _rows(local_store)["tl-r"]
    assert result["persisted"] is True and "conflict" not in result
    assert result["updatedAt"] == row["updatedAt"] != "v1"
    assert [a["id"] for a in row["articles"]][-1] == "evt-ai"


def test_chat_surgical_edit_with_stale_snapshot_reports_conflict_without_overwrite(local_store):
    _seed(local_store, _owned("tl-c", "v2"))
    before = copy.deepcopy(_rows(local_store)["tl-c"])
    snapshot = TimelineData.model_validate({**_timeline("tl-c", "Stored"), "updatedAt": "v1"})
    chat_result = TimelineChatOutput.model_validate({
        "reply": "Removed it.", "action": "edit", "edit_type": "event_delete", "target_event_id": "evt-1",
    })
    outcome: Dict[str, Any] = {}

    updated = asyncio.run(main._apply_chat_edit(
        chat_result=chat_result, current_timeline=snapshot, chat_key=None, chat_tier="paid", user=OWNER,
        target_owner=OWNER["id"], existing_meta=storage.get_timeline_access_meta("tl-c"),
        base_updated_at="v1", persist_outcome=outcome,
    ))

    assert updated is not None and [a.id for a in updated.articles] == ["evt-2"]
    assert outcome["persisted"] is False and outcome["conflict"] is True
    assert updated.updatedAt == "v1"
    assert _rows(local_store)["tl-c"] == before
