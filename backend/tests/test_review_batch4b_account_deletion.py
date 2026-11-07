"""B-13 / B-14: account deletion stops in-flight work, finds every episode the user made, drains the
activity queue first, removes spend meters, scrubs kept Library rows, and never destroys Library
rows when storage misbehaves."""
import asyncio
import json
from typing import Any, Dict, List, Optional

import pytest
from fastapi import HTTPException

import main
from services import deleted_users, podcast_store, quota_service, storage

USER = {"id": "del4b-user", "email": "del4b@example.com", "is_anonymous": False}
OTHER_OWNER = "someone-else"


@pytest.fixture
def account(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    podcast_store.clip_cache.clear()
    monkeypatch.setattr(storage, "TIMELINES_FILE", tmp_path / "timelines.json")
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    order: List[str] = []
    monkeypatch.setattr(main, "delete_user_usage_records", lambda uid: order.append("usage"))
    monkeypatch.setattr(main, "flush_activity_log", lambda timeout: order.append("flush") or True)
    monkeypatch.setattr(main, "delete_user_activity", lambda uid: order.append("activity") or True)

    async def fake_delete_supabase_user(user_id):
        order.append("auth")
        return True

    monkeypatch.setattr(main, "delete_supabase_user", fake_delete_supabase_user)
    monkeypatch.setattr(main, "_delete_legacy_owner_episodes_in_background", lambda uid: asyncio.sleep(0))
    storage.save_timeline_data(
        {"id": "own-tl", "title": "Mine", "articles": [{"id": "a1", "title": "Ev"}]}, user_id=USER["id"], existing_meta=None
    )
    return order


def _episode(timeline_id, episode_id, owner):
    podcast_store.save_episode({
        "id": episode_id, "timeline_id": timeline_id, "owner_id": owner, "created_at": "2026-11-01T00:00:00+00:00",
        "audio": {},
    })


@pytest.mark.asyncio
async def test_deletes_the_users_episodes_on_other_peoples_timelines(account):
    _episode("their-tl", "u-mine1", USER["id"])          # private namespace
    _episode("their-tl", "theirs1", OTHER_OWNER)
    _episode("library-tl", "pub-mine", USER["id"])       # public namespace (e.g. made before S-06)
    resp = await main.delete_user_account(user=USER)
    assert resp["success"] is True
    assert podcast_store.get_episode("their-tl", "u-mine1") is None
    assert podcast_store.get_episode("library-tl", "pub-mine") is None
    assert podcast_store.get_episode("their-tl", "theirs1") is not None
    assert [e["id"] for e in podcast_store.get_episode_index("their-tl")] == ["theirs1"]
    assert podcast_store.list_owner_episode_refs(USER["id"]) == []


@pytest.mark.asyncio
async def test_activity_rows_are_deleted_only_after_the_queue_drains(account):
    await main.delete_user_account(user=USER)
    assert account.index("flush") < account.index("activity") < account.index("auth")


@pytest.mark.asyncio
async def test_in_flight_jobs_are_cancelled_and_cannot_write_afterwards(account):
    started = asyncio.Event()

    async def long_job():
        started.set()
        await asyncio.sleep(30)

    task = asyncio.create_task(long_job())
    job_id = "job-del4b"
    main._AI_JOBS[job_id] = {"status": "pending", "user_id": USER["id"], "user": USER, "task": task, "updated": 0}
    await started.wait()
    try:
        await main.delete_user_account(user=USER)
        assert task.cancelled()
        assert main._AI_JOBS[job_id]["status"] == "cancelled"
        # A late write for the deleted account is refused everywhere.
        with pytest.raises(HTTPException) as exc:
            await main._persist_timeline_dict(
                {"id": "late-tl", "title": "x", "articles": [{"id": "a", "title": "b"}]},
                user=USER, target_owner=USER["id"], existing_meta=None,
            )
        assert exc.value.status_code == 410
        with pytest.raises(podcast_store.EpisodeWriteRefused):
            _episode("their-tl", "u-late", USER["id"])
    finally:
        main._AI_JOBS.pop(job_id, None)


@pytest.mark.asyncio
async def test_an_aborted_deletion_lets_the_account_keep_working(account, monkeypatch):
    def failing(owner_id, skip):
        raise podcast_store.PodcastStorageError("down")

    monkeypatch.setattr(podcast_store, "delete_owner_episodes", failing)
    with pytest.raises(HTTPException) as exc:
        await main.delete_user_account(user=USER)
    assert exc.value.status_code == 503
    assert "auth" not in account
    assert deleted_users.is_recently_deleted(USER["id"]) is False


@pytest.mark.asyncio
async def test_hidden_library_rows_are_enumerated_for_podcast_cleanup(account):
    rows = storage._load_local_timelines()
    rows.append({
        "id": "lib-own", "title": "Curated", "user_id": USER["id"], "isLibrary": True, "hiddenFromSaved": True,
        "articles": [{"id": "a", "title": "b"}],
    })
    storage._save_local_timelines(rows)
    _episode("lib-own", "someone-elses", OTHER_OWNER)
    assert "lib-own" not in [t["id"] for t in storage.list_all_timelines(USER["id"], False, True)]
    assert "lib-own" in storage.list_user_timeline_ids(USER["id"])
    await main.delete_user_account(user=USER)
    assert podcast_store.get_episode("lib-own", "someone-elses") is None


def test_usage_record_deletion_includes_spend_meters(monkeypatch, tmp_path):
    monkeypatch.setattr(quota_service, "USAGE_FILE", tmp_path / "u.json")
    uid = "spend-del-user"
    for ident in (uid, f"spend:{uid}", f"spend:guest:{uid}", "spend:someone-else"):
        quota_service._local_change_usage("2026-11-06", ident, 5)
    quota_service.delete_user_usage_records(uid)
    left = quota_service._load_usage_data()["2026-11-06"]
    assert left == {"spend:someone-else": 5}


# --- B-14: hard delete never destroys Library rows ------------------------------------------

class _Resp:
    def __init__(self, status_code: int, body: Any = None):
        self.status_code = status_code
        self._body = body
        self.text = json.dumps(body) if body is not None else ""

    def json(self):
        return self._body


class _FakeTimelines:
    def __init__(self, rows, get_status=200, patch_statuses=None):
        self.rows = rows
        self.get_status = get_status
        self.patch_statuses = list(patch_statuses or [])
        self.patches: List[Dict[str, Any]] = []
        self.deletes: List[Dict[str, Any]] = []
        fake = self

        class Client:
            def __init__(self, **kw):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get(self, url, headers=None, params=None):
                return _Resp(fake.get_status, fake.rows if fake.get_status == 200 else {"message": "boom"})

            def patch(self, url, headers=None, params=None, json=None):
                fake.patches.append({"params": params, "json": json})
                return _Resp(fake.patch_statuses.pop(0) if fake.patch_statuses else 204)

            def delete(self, url, headers=None, params=None):
                fake.deletes.append({"url": url, "params": params})
                return _Resp(204)

        self.Client = Client


def _use_fake(monkeypatch, fake):
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: True)
    monkeypatch.setattr(storage, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(storage.httpx, "Client", fake.Client)


LIB_ROW = {"id": "lib-1", "data": {"id": "lib-1", "isLibrary": True, "authorName": "Dana", "title": "Curated"}}
PLAIN_ROW = {"id": "own-1", "data": {"id": "own-1", "title": "Private"}}


def test_hard_delete_aborts_when_the_read_fails(monkeypatch):
    fake = _FakeTimelines([LIB_ROW], get_status=503)
    _use_fake(monkeypatch, fake)
    with pytest.raises(storage.StorageUnavailableError):
        storage.delete_all_user_timelines("u-x", hard_delete=True)
    assert fake.deletes == []


def test_hard_delete_aborts_when_a_library_rehome_fails(monkeypatch):
    fake = _FakeTimelines([LIB_ROW, PLAIN_ROW], patch_statuses=[500])
    _use_fake(monkeypatch, fake)
    with pytest.raises(storage.StorageUnavailableError):
        storage.delete_all_user_timelines("u-x", hard_delete=True)
    assert fake.deletes == []


def test_hard_delete_rehomes_scrubs_and_excludes_library_rows(monkeypatch):
    fake = _FakeTimelines([LIB_ROW, PLAIN_ROW])
    _use_fake(monkeypatch, fake)
    assert storage.delete_all_user_timelines("u-x", hard_delete=True) is True
    assert len(fake.patches) == 1
    body = fake.patches[0]["json"]
    assert body["data"]["hiddenFromSaved"] is True
    assert "authorName" not in body["data"] and body["author_name"] is None
    timeline_delete = next(d for d in fake.deletes if d["url"].endswith("/timelines"))
    assert timeline_delete["params"]["user_id"] == "eq.u-x"
    assert "isLibrary" in timeline_delete["params"]["or"]


def test_rehome_retries_without_the_author_column_on_old_schemas(monkeypatch):
    fake = _FakeTimelines([LIB_ROW], patch_statuses=[400, 204])
    _use_fake(monkeypatch, fake)
    assert storage.delete_all_user_timelines("u-x", hard_delete=True) is True
    assert "author_name" in fake.patches[0]["json"] and "author_name" not in fake.patches[1]["json"]
