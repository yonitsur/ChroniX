"""Regression tests for code-review findings S-01 (unowned timelines are admin-only) and S-03
(fail-closed ownership lookups; INSERT-or-owner-filtered-PATCH saves that never reassign owners)."""
import copy
import json
import time
from typing import Any, Dict, List, Optional

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from services import podcast_audio, podcast_store, storage
from services.auth_service import get_current_user_optional, get_current_user_required
from services.podcast_tts_service import SynthesisResult, mp3_duration_seconds, pcm_to_mp3, silence_pcm

ADMIN = {"id": "admin-1", "email": "admin@example.com", "email_confirmed_at": "2026-01-01T00:00:00Z", "is_anonymous": False}
OWNER = {"id": "owner-1", "email": "owner@example.com", "is_anonymous": False}
USER = {"id": "user-2", "email": "user@example.com", "is_anonymous": False}
GUEST = {"id": "guest-3", "is_anonymous": True}
SYSTEM_OWNER = "11111111-2222-3333-4444-555555555555"


def _timeline(tid: str, title: str = "Space Race", **extra) -> Dict[str, Any]:
    return {
        "id": tid,
        "title": title,
        "articles": [{"id": "evt-1", "title": "Sputnik", "from": {"year": 1957}}],
        **extra,
    }


class FakeResp:
    def __init__(self, status_code: int, payload: Any = None) -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload) if payload is not None else ""

    def json(self) -> Any:
        if self._payload is None:
            raise ValueError("no body")
        return self._payload


class FakeSupabase:
    """In-memory PostgREST `timelines` table that records every request."""

    def __init__(self) -> None:
        self.rows: Dict[str, Dict[str, Any]] = {}
        self.calls: List[Dict[str, Any]] = []
        self.get_failures: List[Any] = []   # queued per-GET failure: int status or Exception
        self.post_failures: List[Any] = []
        self.patch_failures: List[Any] = []
        self.stale_owner_for_get: Optional[Dict[str, Any]] = None  # {"id": ..., "owner": ...}
        self.reject_rich_columns = False
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
                return fake._post(headers or {}, json)

            def patch(self, url, headers=None, params=None, json=None):
                return fake._patch(headers or {}, params or {}, json)

            def delete(self, url, headers=None, params=None):
                fake.calls.append({"method": "DELETE", "params": dict(params or {})})
                return FakeResp(204)

        self.Client = Client

    def add_row(self, tid: str, owner: Optional[str], *, shared: bool = False, data: Optional[dict] = None) -> None:
        self.rows[tid] = {
            "id": tid,
            "user_id": owner,
            "is_public": shared,
            "is_shared": shared,
            "title": (data or {}).get("title", "Stored"),
            "data": copy.deepcopy(data) if data is not None else _timeline(tid, "Stored"),
        }

    def writes(self) -> List[Dict[str, Any]]:
        return [c for c in self.calls if c["method"] in ("POST", "PATCH")]

    @staticmethod
    def _pop_failure(queue: List[Any]):
        if not queue:
            return None
        failure = queue.pop(0)
        if isinstance(failure, Exception):
            raise failure
        return FakeResp(failure, {"message": "boom"})

    def _get(self, params: Dict[str, Any]):
        self.calls.append({"method": "GET", "params": dict(params)})
        failed = self._pop_failure(self.get_failures)
        if failed is not None:
            return failed
        tid = str(params.get("id", "")).removeprefix("eq.")
        row = self.rows.get(tid)
        if row is None:
            return FakeResp(200, [])
        out = copy.deepcopy(row)
        stale = self.stale_owner_for_get
        if stale and stale["id"] == tid:
            out["user_id"] = stale["owner"]
        return FakeResp(200, [out])

    def _post(self, headers: Dict[str, Any], payload: Dict[str, Any]):
        self.calls.append({"method": "POST", "headers": dict(headers), "json": copy.deepcopy(payload)})
        failed = self._pop_failure(self.post_failures)
        if failed is not None:
            return failed
        if self.reject_rich_columns and "categories" in payload:
            return FakeResp(400, {"message": "column categories does not exist"})
        if payload["id"] in self.rows:
            return FakeResp(409, {"code": "23505", "message": "duplicate key"})
        self.rows[payload["id"]] = {
            "id": payload["id"],
            "user_id": payload.get("user_id"),
            "is_public": payload.get("is_public", False),
            "is_shared": payload.get("is_shared", False),
            "title": payload.get("title"),
            "data": copy.deepcopy(payload.get("data")),
        }
        return FakeResp(201)

    def _patch(self, headers: Dict[str, Any], params: Dict[str, Any], payload: Dict[str, Any]):
        self.calls.append({"method": "PATCH", "headers": dict(headers), "params": dict(params), "json": copy.deepcopy(payload)})
        failed = self._pop_failure(self.patch_failures)
        if failed is not None:
            return failed
        if self.reject_rich_columns and "categories" in payload:
            return FakeResp(400, {"message": "column categories does not exist"})
        tid = str(params.get("id", "")).removeprefix("eq.")
        row = self.rows.get(tid)
        owner_filter = params.get("user_id")
        matches = row is not None and (
            owner_filter is None
            or (owner_filter == "is.null" and row["user_id"] is None)
            or (owner_filter.startswith("eq.") and row["user_id"] == owner_filter[3:])
        )
        if not matches:
            return FakeResp(200, [])
        for key, val in payload.items():
            row[key] = copy.deepcopy(val)
        return FakeResp(200, [{"id": tid}])


@pytest.fixture
def supa(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(storage, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(storage, "SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setattr(storage.httpx, "Client", fake.Client)
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    storage.invalidate_library_cache()
    return fake


@pytest.fixture
def api(supa):
    current = {"user": GUEST}
    main.app.dependency_overrides[get_current_user_optional] = lambda: current["user"]
    main.app.dependency_overrides[get_current_user_required] = lambda: current["user"]
    main.shared_view_rate_limiter.records.clear()
    try:
        with TestClient(main.app) as client:
            yield {"client": client, "supa": supa, "as_user": lambda u: current.__setitem__("user", u)}
    finally:
        main.app.dependency_overrides.clear()


def _library_row(supa: FakeSupabase, tid: str = "lib-1", owner: Optional[str] = None, shared: bool = True) -> None:
    supa.add_row(tid, owner, shared=shared, data=_timeline(tid, "Curated", isLibrary=True, isFeatured=True))


# --------------------------------------------------------------------------------------------
# S-01: unowned timelines are admin-only
# --------------------------------------------------------------------------------------------

@pytest.mark.parametrize("caller", [GUEST, USER])
def test_s01_non_admin_cannot_overwrite_unowned_timeline(api, caller):
    supa = api["supa"]
    _library_row(supa)
    before = copy.deepcopy(supa.rows["lib-1"])
    api["as_user"](caller)

    res = api["client"].post("/api/timelines", json=_timeline("lib-1", "Hijacked"))

    assert res.status_code == 403
    assert supa.writes() == []
    assert supa.rows["lib-1"] == before


def test_s01_admin_can_edit_unowned_timeline_without_taking_ownership(api):
    supa = api["supa"]
    _library_row(supa)
    api["as_user"](ADMIN)

    res = api["client"].post("/api/timelines", json=_timeline("lib-1", "Fixed typo"))

    assert res.status_code == 200, res.text
    [write] = supa.writes()
    assert write["method"] == "PATCH"
    assert write["params"]["user_id"] == "is.null"
    assert "user_id" not in write["json"]
    row = supa.rows["lib-1"]
    assert row["user_id"] is None
    assert row["data"]["title"] == "Fixed typo"
    assert row["data"]["isLibrary"] is True  # admin edits keep the curated row published
    assert row["is_shared"] is True


@pytest.mark.parametrize("caller", [GUEST, USER])
def test_s01_non_admin_share_toggle_on_unowned_timeline_is_forbidden(api, monkeypatch, caller):
    _library_row(api["supa"])
    share_calls = []
    monkeypatch.setattr(main, "set_timeline_shared", lambda *a, **k: share_calls.append(a) or True)
    api["as_user"](caller)

    res = api["client"].patch("/api/timelines/lib-1/share", json={"enabled": False, "authorName": "x" * 50})

    assert res.status_code == 403
    assert share_calls == []


def test_s01_admin_share_toggle_on_unowned_timeline_is_allowed(api, monkeypatch):
    _library_row(api["supa"])
    share_calls = []
    monkeypatch.setattr(main, "set_timeline_shared", lambda *a, **k: share_calls.append(a) or True)
    api["as_user"](ADMIN)

    res = api["client"].patch("/api/timelines/lib-1/share", json={"enabled": True})

    assert res.status_code == 200
    assert share_calls == [("lib-1", None, True)]


def test_s01_unowned_shared_timeline_is_still_viewable(api):
    _library_row(api["supa"], shared=True)
    api["as_user"](None)

    res = api["client"].get("/api/timelines/lib-1")

    assert res.status_code == 200
    assert res.json()["title"] == "Curated"
    assert res.json()["isOwner"] is False


def test_s01_can_view_timeline_no_longer_treats_unowned_as_public(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    private_unowned = {"owner_id": None, "is_shared": False, "is_library": False}
    assert main._can_view_timeline(private_unowned, USER) is False
    assert main._can_view_timeline(private_unowned, None) is False
    assert main._can_view_timeline(private_unowned, ADMIN) is True
    assert main._can_view_timeline({"owner_id": None, "is_shared": True}, None) is True
    assert main._can_view_timeline({"owner_id": None, "is_library": True}, USER) is True
    assert main._can_view_timeline({"owner_id": OWNER["id"], "is_shared": False}, OWNER) is True


def test_s01_episode_visibility_on_unowned_timelines(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    lib_meta = {"owner_id": None, "is_shared": True, "is_library": True}
    stranger_ep = {"id": "ep-stranger", "owner_id": USER["id"], "source": "generated"}
    admin_ep = {"id": "ep-admin", "owner_id": ADMIN["id"], "created_by_admin": True, "source": "generated"}
    legacy_ep = {"id": main.LEGACY_EPISODE_ID, "owner_id": None, "source": "legacy"}
    forged_ep = {"id": "ep-forged", "owner_id": USER["id"], "source": "legacy"}

    viewer = {"id": "viewer-9", "email": "viewer@example.com"}
    for who in (None, viewer, GUEST):
        assert main._episode_visible(stranger_ep, who, lib_meta) is False
        assert main._episode_visible(admin_ep, who, lib_meta) is True
        assert main._episode_visible(legacy_ep, who, lib_meta) is True
        assert main._episode_visible(forged_ep, who, lib_meta) is False

    # Creators still see their own; admins see everything.
    assert main._episode_visible(stranger_ep, USER, lib_meta) is True
    assert main._episode_visible(stranger_ep, ADMIN, lib_meta) is True

    # An unpublished unowned timeline publishes nothing to non-admins.
    private_meta = {"owner_id": None, "is_shared": False, "is_library": False}
    assert main._episode_visible(admin_ep, viewer, private_meta) is False
    assert main._episode_visible(legacy_ep, viewer, private_meta) is False

    # Managing: only the episode's creator or an admin (never "anyone" on unowned rows).
    assert main._can_manage_episode(legacy_ep, USER, lib_meta) is False
    assert main._can_manage_episode(admin_ep, USER, lib_meta) is False
    assert main._can_manage_episode(stranger_ep, USER, lib_meta) is True
    assert main._can_manage_episode(legacy_ep, ADMIN, lib_meta) is True


SCRIPT = {
    "title": "Curated Show",
    "format": "single",
    "voice_gender": "male",
    "length": "full",
    "content_mode": "classic",
    "host1_name": "Michael",
    "host2_name": None,
    "detected_language": "en",
    "segments": [
        {"id": "seg-1", "type": "intro", "event_id": None, "chapter_title": "Intro", "turns": [{"speaker": "host1", "text": "Welcome."}]},
        {"id": "seg-2", "type": "outro", "event_id": None, "chapter_title": "Outro", "turns": [{"speaker": "host1", "text": "Bye."}]},
    ],
}


def test_s01_podcast_episodes_on_unowned_library_timeline_publish_only_admin_ones(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    podcast_store.clip_cache.clear()
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    monkeypatch.setenv("API_KEY_MODE", "unlimited")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    tl = _timeline("lib-pod", "Curated")
    meta = {"lib-pod": {"data": dict(tl), "owner_id": None, "is_shared": True, "is_library": True}}
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: meta.get(tid))

    async def fake_generate(**kwargs):
        return {"script": copy.deepcopy(SCRIPT), "tokenUsage": {}, "estimates": {}}

    async def fake_tts(engine, turns, **kwargs):
        audio = pcm_to_mp3(silence_pcm(0.2))
        return SynthesisResult(audio=audio, duration=mp3_duration_seconds(audio), engine=engine, turn_starts=[0.0], cost_usd=0.0)

    monkeypatch.setattr(main, "generate_timeline_podcast", fake_generate)
    monkeypatch.setattr(podcast_audio, "synthesize_segment", fake_tts)
    for limiter in (main.timeline_rate_limiter, main.podcast_view_rate_limiter, main.podcast_audio_rate_limiter):
        limiter.records.clear()

    current = {"user": ADMIN}
    main.app.dependency_overrides[get_current_user_optional] = lambda: current["user"]
    main.app.dependency_overrides[get_current_user_required] = lambda: current["user"]
    try:
        with TestClient(main.app) as client:
            def create(as_user, length):
                current["user"] = as_user
                res = client.post(
                    "/api/timelines/lib-pod/podcasts/start",
                    json={"timeline": tl, "format": "single", "voice_gender": "male", "length": length, "tts_engine": "edge"},
                )
                assert res.status_code == 200, res.text
                job_id = res.json()["job_id"]
                for _ in range(200):
                    status = client.get(f"/api/timeline/job/status/{job_id}").json()
                    if status["status"] != "pending":
                        break
                    time.sleep(0.02)
                assert status["status"] == "done", status
                return status["result"]["episode"]["id"]

            admin_ep = create(ADMIN, "full")
            user_ep = create(USER, "focused")
            stored = {d["id"]: d for d in podcast_store.list_episodes("lib-pod")}
            assert stored[admin_ep]["created_by_admin"] is True
            assert stored[user_ep]["created_by_admin"] is False

            current["user"] = None
            visible = [e["id"] for e in client.get("/api/timelines/lib-pod/podcasts").json()["episodes"]]
            assert visible == [admin_ep]
            assert client.get(f"/api/timelines/lib-pod/podcasts/{user_ep}").status_code == 404

            current["user"] = USER
            mine = {e["id"] for e in client.get("/api/timelines/lib-pod/podcasts").json()["episodes"]}
            assert mine == {admin_ep, user_ep}
    finally:
        main.app.dependency_overrides.clear()


def test_s01_system_owner_env_var_validation(monkeypatch):
    monkeypatch.delenv("SYSTEM_OWNER_USER_ID", raising=False)
    assert storage.get_system_owner_user_id() is None
    monkeypatch.setenv("SYSTEM_OWNER_USER_ID", "not-a-uuid")
    assert storage.get_system_owner_user_id() is None
    monkeypatch.setenv("SYSTEM_OWNER_USER_ID", f"  {SYSTEM_OWNER} ")
    assert storage.get_system_owner_user_id() == SYSTEM_OWNER


@pytest.mark.parametrize("system_owner,expected", [(None, None), (SYSTEM_OWNER, SYSTEM_OWNER)])
def test_s01_hard_account_delete_rehomes_library_rows(supa, monkeypatch, system_owner, expected):
    if system_owner:
        monkeypatch.setenv("SYSTEM_OWNER_USER_ID", system_owner)
    else:
        monkeypatch.delenv("SYSTEM_OWNER_USER_ID", raising=False)
    supa.add_row("lib-mine", OWNER["id"], shared=True, data=_timeline("lib-mine", isLibrary=True))
    # The fake GET filters by id only, so route the user listing through a dedicated response.
    supa._get = lambda params: (supa.calls.append({"method": "GET", "params": dict(params)}) or FakeResp(200, [copy.deepcopy(supa.rows["lib-mine"])]))

    assert storage.delete_all_user_timelines(OWNER["id"], hard_delete=True) is True

    [rehome] = [c for c in supa.calls if c["method"] == "PATCH"]
    assert rehome["params"]["user_id"] == f"eq.{OWNER['id']}"
    assert rehome["json"]["user_id"] == expected


def test_s01_hard_delete_of_the_system_owner_itself_detaches_instead(supa, monkeypatch):
    monkeypatch.setenv("SYSTEM_OWNER_USER_ID", SYSTEM_OWNER)
    supa.add_row("lib-sys", SYSTEM_OWNER, shared=True, data=_timeline("lib-sys", isLibrary=True))
    supa._get = lambda params: FakeResp(200, [copy.deepcopy(supa.rows["lib-sys"])])

    assert storage.delete_all_user_timelines(SYSTEM_OWNER, hard_delete=True) is True
    [rehome] = [c for c in supa.calls if c["method"] == "PATCH"]
    assert rehome["json"]["user_id"] is None


# --------------------------------------------------------------------------------------------
# S-03: fail-closed lookups
# --------------------------------------------------------------------------------------------

@pytest.mark.parametrize("failure", [500, 503, httpx.ConnectError("db unreachable"), httpx.ReadTimeout("cold start")])
def test_s03_access_meta_raises_instead_of_returning_none(supa, failure):
    supa.add_row("tl-1", OWNER["id"])
    supa.get_failures = [failure, failure]
    with pytest.raises(storage.StorageUnavailableError):
        storage.get_timeline_access_meta("tl-1")


@pytest.mark.parametrize("failure", [500, httpx.ConnectError("db unreachable")])
def test_s03_with_meta_raises_instead_of_returning_none(supa, failure):
    supa.add_row("tl-1", OWNER["id"])
    supa.get_failures = [failure]
    with pytest.raises(storage.StorageUnavailableError):
        storage.get_timeline_with_meta("tl-1")


def test_s03_lookups_return_none_only_for_an_empty_200(supa):
    assert storage.get_timeline_access_meta("missing") is None
    assert storage.get_timeline_with_meta("missing") is None


def test_s03_access_meta_still_falls_back_to_minimal_select(supa):
    supa.add_row("tl-1", OWNER["id"], shared=True)
    supa.get_failures = [400]  # pre-migration DB: optional columns missing on the first select
    meta = storage.get_timeline_access_meta("tl-1")
    assert meta["owner_id"] == OWNER["id"] and meta["is_shared"] is True
    assert len([c for c in supa.calls if c["method"] == "GET"]) == 2


@pytest.mark.parametrize("failure", [500, httpx.ConnectError("db unreachable")])
def test_s03_post_timeline_returns_503_and_sends_no_write_when_lookup_fails(api, failure):
    supa = api["supa"]
    supa.add_row("tl-victim", OWNER["id"], shared=True)
    before = copy.deepcopy(supa.rows["tl-victim"])
    supa.get_failures = [failure, failure]
    api["as_user"](USER)

    res = api["client"].post("/api/timelines", json=_timeline("tl-victim", "Overwritten"))

    assert res.status_code == 503
    assert "storage" in res.json()["detail"].lower()
    assert supa.writes() == []
    assert supa.rows["tl-victim"] == before


def test_s03_get_timeline_returns_503_not_404_when_lookup_fails(api):
    api["supa"].add_row("tl-1", OWNER["id"], shared=True)
    api["supa"].get_failures = [500]
    api["as_user"](None)
    assert api["client"].get("/api/timelines/tl-1").status_code == 503


def test_s03_share_toggle_returns_503_when_lookup_fails(api):
    api["supa"].add_row("tl-1", OWNER["id"])
    # The toggle uses the light access-meta lookup (P-14), which retries once with its minimal select.
    api["supa"].get_failures = [500, 500]
    api["as_user"](OWNER)
    assert api["client"].patch("/api/timelines/tl-1/share", json={"enabled": True}).status_code == 503
    assert api["supa"].writes() == []


def test_s03_owner_save_does_a_single_lookup_and_cannot_unshare_or_reassign(api):
    """The old second lookup inside save_timeline_data could fail and then upsert user_id=caller, is_public=False."""
    supa = api["supa"]
    supa.add_row("tl-own", OWNER["id"], shared=True)
    api["as_user"](OWNER)

    # Every lookup after the first one fails: a second lookup would now raise instead of misleading the save.
    original_get = supa._get
    state = {"n": 0}

    def flaky_get(params):
        state["n"] += 1
        if state["n"] > 1:
            supa.calls.append({"method": "GET", "params": dict(params)})
            return FakeResp(500, {"message": "boom"})
        return original_get(params)

    supa._get = flaky_get
    res = api["client"].post("/api/timelines", json=_timeline("tl-own", "Edited"))

    assert res.status_code == 200, res.text
    assert state["n"] == 1
    [write] = supa.writes()
    assert write["method"] == "PATCH"
    for forbidden in ("user_id", "is_public", "is_shared", "id"):
        assert forbidden not in write["json"]
    row = supa.rows["tl-own"]
    assert row["user_id"] == OWNER["id"]
    assert row["is_shared"] is True and row["is_public"] is True
    assert row["data"]["title"] == "Edited"


# --------------------------------------------------------------------------------------------
# S-03: INSERT for new ids, owner-filtered PATCH for existing ids
# --------------------------------------------------------------------------------------------

def test_s03_new_id_is_a_plain_insert_owned_by_the_caller(api):
    supa = api["supa"]
    api["as_user"](USER)

    res = api["client"].post("/api/timelines", json=_timeline("tl-new", "Fresh"))

    assert res.status_code == 200, res.text
    [write] = supa.writes()
    assert write["method"] == "POST"
    assert "merge-duplicates" not in write["headers"].get("Prefer", "")
    assert write["json"]["user_id"] == USER["id"]
    assert write["json"]["is_public"] is False and write["json"]["is_shared"] is False
    assert supa.rows["tl-new"]["user_id"] == USER["id"]


def test_s03_existing_id_update_is_patch_filtered_by_id_and_owner(api):
    supa = api["supa"]
    supa.add_row("tl-own", OWNER["id"])
    api["as_user"](OWNER)

    res = api["client"].post("/api/timelines", json=_timeline("tl-own", "Renamed"))

    assert res.status_code == 200, res.text
    [write] = supa.writes()
    assert write["method"] == "PATCH"
    assert write["params"]["id"] == "eq.tl-own"
    assert write["params"]["user_id"] == f"eq.{OWNER['id']}"
    assert "return=representation" in write["headers"]["Prefer"]
    assert "user_id" not in write["json"]


def test_s03_admin_edit_of_owned_timeline_targets_existing_owner(api):
    supa = api["supa"]
    supa.add_row("tl-own", OWNER["id"], shared=True)
    api["as_user"](ADMIN)

    res = api["client"].post("/api/timelines", json=_timeline("tl-own", "Moderated"))

    assert res.status_code == 200, res.text
    [write] = supa.writes()
    assert write["params"]["user_id"] == f"eq.{OWNER['id']}"
    assert supa.rows["tl-own"]["user_id"] == OWNER["id"]


def test_s03_zero_affected_rows_is_a_conflict_not_success(api):
    """The ownership check saw OWNER, but the row changed hands before the write landed."""
    supa = api["supa"]
    supa.add_row("tl-race", "someone-else")
    supa.stale_owner_for_get = {"id": "tl-race", "owner": OWNER["id"]}
    before = copy.deepcopy(supa.rows["tl-race"])
    api["as_user"](OWNER)

    res = api["client"].post("/api/timelines", json=_timeline("tl-race", "Lost race"))

    assert res.status_code == 409
    assert supa.rows["tl-race"] == before


def test_s03_storage_level_conflicts(supa):
    supa.add_row("tl-taken", "someone-else")
    before = copy.deepcopy(supa.rows["tl-taken"])
    with pytest.raises(storage.TimelineConflictError):
        storage.save_timeline_data(_timeline("tl-taken"), user_id=USER["id"], existing_meta=None)
    with pytest.raises(storage.TimelineConflictError):
        storage.save_timeline_data(_timeline("tl-taken"), user_id=USER["id"], existing_meta={"owner_id": USER["id"]})
    assert supa.rows["tl-taken"] == before


def test_s03_insert_and_patch_keep_pre_migration_core_payload_fallback(supa):
    supa.reject_rich_columns = True
    storage.save_timeline_data(_timeline("tl-old-db"), user_id=USER["id"], existing_meta=None)
    meta = storage.get_timeline_access_meta("tl-old-db")
    storage.save_timeline_data(_timeline("tl-old-db", "Second"), user_id=USER["id"], existing_meta=meta)

    posts = [c for c in supa.calls if c["method"] == "POST"]
    patches = [c for c in supa.calls if c["method"] == "PATCH"]
    assert len(posts) == 2 and "categories" in posts[0]["json"] and "categories" not in posts[1]["json"]
    assert len(patches) == 2 and "categories" not in patches[1]["json"]
    assert supa.rows["tl-old-db"]["data"]["title"] == "Second"


def test_s03_insert_retry_after_timeout_adopts_only_our_own_committed_row(supa):
    # First INSERT times out after committing; the retry sees a duplicate and must not report a conflict.
    original_post = supa._post

    def commit_then_timeout(headers, payload):
        if not any(c["method"] == "POST" for c in supa.calls):
            original_post(headers, payload)
            raise httpx.ReadTimeout("timed out after commit")
        return original_post(headers, payload)

    supa._post = commit_then_timeout
    storage.save_timeline_data(_timeline("tl-cold", "Cold"), user_id=USER["id"], existing_meta=None)
    assert supa.rows["tl-cold"]["user_id"] == USER["id"]
    assert [c["method"] for c in supa.writes()] == ["POST", "POST", "PATCH"]


def test_s03_insert_retry_duplicate_owned_by_someone_else_is_a_conflict(supa):
    supa.add_row("tl-other", "someone-else")
    before = copy.deepcopy(supa.rows["tl-other"])
    supa.post_failures = [httpx.ReadTimeout("timeout")]
    with pytest.raises(storage.TimelineConflictError):
        storage.save_timeline_data(_timeline("tl-other"), user_id=USER["id"], existing_meta=None)
    assert supa.rows["tl-other"] == before
    assert not [c for c in supa.calls if c["method"] == "PATCH"]


def test_s03_patch_is_retried_on_transient_errors(supa):
    supa.add_row("tl-own", OWNER["id"])
    supa.patch_failures = [httpx.ReadTimeout("cold start")]
    storage.save_timeline_data(_timeline("tl-own", "After retry"), user_id=OWNER["id"], existing_meta={"owner_id": OWNER["id"]})
    assert supa.rows["tl-own"]["data"]["title"] == "After retry"


def test_s03_save_failure_after_retries_raises_storage_unavailable(supa):
    supa.post_failures = [503, 503]
    with pytest.raises(storage.StorageUnavailableError):
        storage.save_timeline_data(_timeline("tl-x"), user_id=USER["id"], existing_meta=None)


def test_s03_save_without_meta_looks_it_up_once(supa):
    supa.add_row("tl-own", OWNER["id"], shared=True)
    storage.save_timeline_data(_timeline("tl-own", "Script edit"))  # e.g. seed / maintenance scripts
    assert len([c for c in supa.calls if c["method"] == "GET"]) == 1
    assert supa.rows["tl-own"]["user_id"] == OWNER["id"]
    assert supa.rows["tl-own"]["is_shared"] is True


@pytest.mark.anyio
async def test_s03_generation_id_collision_is_a_409_job_error_not_an_overwrite(monkeypatch):
    def colliding_save(tl, user_id=None, existing_meta=storage._META_NOT_PROVIDED):
        assert existing_meta is None
        raise storage.TimelineConflictError("taken")

    async def must_not_reverify(*args, **kwargs):
        raise AssertionError("generation collisions must not be retried as updates")

    monkeypatch.setattr(main, "save_timeline_data", colliding_save)
    monkeypatch.setattr(main, "_verify_timeline_mutation_target", must_not_reverify)
    with pytest.raises(HTTPException) as exc:
        await main._persist_timeline_dict(
            _timeline("gen-1"), user=USER, target_owner=USER["id"], existing_meta=None, id_is_server_generated=True
        )
    assert exc.value.status_code == 409


@pytest.mark.anyio
async def test_s03_refine_racing_an_autosave_reverifies_and_updates(supa):
    """Refine verified the id as new, but the user's own autosave created it before the persist."""
    supa.add_row("tl-auto", USER["id"])
    saved = await main._persist_timeline_dict(_timeline("tl-auto", "Refined"), user=USER, target_owner=USER["id"], existing_meta=None)
    assert saved["title"] == "Refined"
    assert [c["method"] for c in supa.writes()] == ["POST", "PATCH"]
    assert supa.rows["tl-auto"]["user_id"] == USER["id"]


@pytest.mark.anyio
async def test_s03_refine_race_against_someone_elses_row_is_forbidden(supa):
    supa.add_row("tl-theirs", "someone-else")
    before = copy.deepcopy(supa.rows["tl-theirs"])
    with pytest.raises(HTTPException) as exc:
        await main._persist_timeline_dict(_timeline("tl-theirs"), user=USER, target_owner=USER["id"], existing_meta=None)
    assert exc.value.status_code == 403
    assert supa.rows["tl-theirs"] == before


@pytest.mark.anyio
async def test_s03_verify_maps_storage_outage_to_503(monkeypatch):
    def broken(tid):
        raise storage.StorageUnavailableError("down")

    monkeypatch.setattr(main, "_get_timeline_access_meta_sync", broken)
    with pytest.raises(HTTPException) as exc:
        await main._verify_timeline_mutation_target("tl-1", USER)
    assert exc.value.status_code == 503


# --------------------------------------------------------------------------------------------
# Local JSON mode keeps equivalent semantics
# --------------------------------------------------------------------------------------------

@pytest.fixture
def local_store(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "SUPABASE_URL", "")
    monkeypatch.setattr(storage, "SUPABASE_SERVICE_ROLE_KEY", "")
    local_file = tmp_path / "timelines.json"
    local_file.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(storage, "TIMELINES_FILE", local_file)
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)
    return local_file


def _local_rows(local_file) -> Dict[str, dict]:
    return {r["id"]: r for r in json.loads(local_file.read_text(encoding="utf-8"))}


def test_s03_local_mode_insert_update_and_conflicts(local_store):
    storage.save_timeline_data(_timeline("loc-1", "First"), user_id=OWNER["id"])
    row = _local_rows(local_store)["loc-1"]
    assert row["user_id"] == OWNER["id"] and row["is_shared"] is False

    # Simulate a share toggle, then an owner edit: owner and sharing are preserved.
    storage.set_timeline_shared("loc-1", OWNER["id"], True)
    meta = storage.get_timeline_access_meta("loc-1")
    storage.save_timeline_data(_timeline("loc-1", "Second"), user_id="ignored-on-update", existing_meta=meta)
    row = _local_rows(local_store)["loc-1"]
    assert row["title"] == "Second" and row["user_id"] == OWNER["id"] and row["is_shared"] is True

    with pytest.raises(storage.TimelineConflictError):
        storage.save_timeline_data(_timeline("loc-1", "Dup"), user_id=USER["id"], existing_meta=None)
    with pytest.raises(storage.TimelineConflictError):
        storage.save_timeline_data(_timeline("loc-1", "Wrong owner"), user_id=USER["id"], existing_meta={"owner_id": USER["id"]})
    assert _local_rows(local_store)["loc-1"]["title"] == "Second"


def test_s03_local_mode_unowned_timeline_post_is_admin_only(local_store, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    storage.save_timeline_data(_timeline("loc-lib", "Seed", isLibrary=True))  # unowned seed
    current = {"user": USER}
    main.app.dependency_overrides[get_current_user_required] = lambda: current["user"]
    try:
        client = TestClient(main.app)
        assert client.post("/api/timelines", json=_timeline("loc-lib", "Hijack")).status_code == 403
        current["user"] = ADMIN
        assert client.post("/api/timelines", json=_timeline("loc-lib", "Admin fix")).status_code == 200
    finally:
        main.app.dependency_overrides.clear()
    row = _local_rows(local_store)["loc-lib"]
    assert row["title"] == "Admin fix" and row.get("user_id") is None
