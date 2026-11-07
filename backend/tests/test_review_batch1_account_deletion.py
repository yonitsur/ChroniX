"""B-02: account deletion really deletes podcast episodes and audio, and fails loudly (503) otherwise."""
import json
from typing import Any, Dict, List

import pytest
from fastapi import HTTPException

import main
from services import podcast_store, storage

USER = {"id": "del-user-1", "email": "del@example.com", "is_anonymous": False}
TL_ID = "del-tl-1"


def _key(ch: str) -> str:
    return ch * 64


@pytest.fixture
def local_podcasts(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    podcast_store.episode_cache.clear()
    podcast_store.clip_cache.clear()
    yield tmp_path / "podcasts"
    podcast_store.episode_cache.clear()
    podcast_store.clip_cache.clear()


def _seed_episode(episode_id: str, keys: Dict[str, str]) -> None:
    for key in keys.values():
        podcast_store.put_clip(key, b"ID3" + key.encode() * 4, {"key": key})
    podcast_store.save_episode(
        {
            "id": episode_id,
            "timeline_id": TL_ID,
            "owner_id": USER["id"],
            "audio": {
                "gemini": {
                    "clips": {"s1": {"key": keys["clip"]}},
                    "episode_audio": {"key": keys["episode"]},
                    "by_gender": {
                        "female": {"clips": {"s1": {"key": keys["gender_clip"]}}, "episode_audio": {"key": keys["gender_episode"]}}
                    },
                }
            },
        }
    )


def test_clip_cache_delete_adjusts_size():
    cache = podcast_store._ClipCache(max_bytes=1024 * 1024)
    cache.put("a", b"x" * 100)
    cache.put("b", b"y" * 50)
    cache.delete("a")
    assert cache.get("a") is None and cache.get("b") == b"y" * 50
    assert cache._size == 50
    cache.delete("missing")
    assert cache._size == 50


def test_delete_timeline_episodes_removes_docs_clips_and_cache(local_podcasts):
    keys = {"clip": _key("a"), "episode": _key("b"), "gender_clip": _key("c"), "gender_episode": _key("d")}
    _seed_episode("ep-1", keys)
    assert podcast_store.list_episodes(TL_ID)
    assert all(podcast_store.clip_cache.get(k) for k in keys.values())

    podcast_store.delete_timeline_episodes(TL_ID)

    assert podcast_store.list_episodes(TL_ID) == []
    assert podcast_store.get_episode(TL_ID, "ep-1") is None
    for key in keys.values():
        assert podcast_store.clip_cache.get(key) is None
        assert not (local_podcasts / podcast_store._clip_path(key, "mp3")).exists()
        assert not (local_podcasts / podcast_store._clip_path(key, "json")).exists()
    assert podcast_store.clip_cache._size == 0


class _FakeRemote:
    """Minimal Supabase Storage stand-in for list / read / bulk-delete."""

    def __init__(self) -> None:
        self.objects: Dict[str, bytes] = {}
        self.list_status = 200
        self.delete_status = 200
        self.delete_calls: List[List[str]] = []
        fake = self

        class Resp:
            def __init__(self, status_code: int, body: Any = None, content: bytes = b"") -> None:
                self.status_code = status_code
                self._body = body
                self.content = content
                self.text = json.dumps(body) if body is not None else ""

            def json(self) -> Any:
                return self._body

        class Client:
            def __init__(self, **kwargs: Any) -> None:
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, url, headers=None, json=None, **kw):
                if "/object/list/" in url:
                    if fake.list_status != 200:
                        return Resp(fake.list_status, {"error": "boom"})
                    prefix = json["prefix"]
                    names = [p[len(prefix):] for p in fake.objects if p.startswith(prefix) and "/" not in p[len(prefix):]]
                    return Resp(200, [{"name": n, "id": n} for n in names])
                return Resp(200, {})

            def get(self, url, headers=None, **kw):
                path = url.split("/object/authenticated/podcasts/", 1)[1]
                if path in fake.objects:
                    return Resp(200, content=fake.objects[path])
                return Resp(404, {"error": "not found"})

            def request(self, method, url, headers=None, json=None, **kw):
                fake.delete_calls.append(list(json["prefixes"]))
                if fake.delete_status == 200:
                    for p in json["prefixes"]:
                        fake.objects.pop(p, None)
                return Resp(fake.delete_status, [])

        self.Client = Client


@pytest.fixture
def remote_podcasts(monkeypatch, tmp_path):
    fake = _FakeRemote()
    monkeypatch.delenv("PODCAST_STORAGE_BACKEND", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("PODCAST_STORAGE_BUCKET", "podcasts")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    monkeypatch.setattr(podcast_store.httpx, "Client", fake.Client)
    podcast_store.episode_cache.clear()
    doc = {"id": "ep-r", "timeline_id": TL_ID, "audio": {"edge": {"episode_audio": {"key": _key("e")}}}}
    fake.objects[podcast_store._episode_path(TL_ID, "ep-r")] = json.dumps(doc).encode()
    fake.objects[podcast_store._clip_path(_key("e"), "mp3")] = b"ID3..."
    yield fake
    podcast_store.episode_cache.clear()


def test_remote_delete_removes_episode_and_clip_objects(remote_podcasts):
    podcast_store.delete_timeline_episodes(TL_ID)
    assert remote_podcasts.objects == {}
    assert podcast_store._clip_path(_key("e"), "mp3") in remote_podcasts.delete_calls[0]


@pytest.mark.parametrize("which", ["list", "delete"])
def test_remote_storage_failure_raises(remote_podcasts, which):
    setattr(remote_podcasts, f"{which}_status", 500)
    with pytest.raises(podcast_store.PodcastStorageError):
        podcast_store.delete_timeline_episodes(TL_ID)


@pytest.fixture
def account_env(monkeypatch, tmp_path, local_podcasts):
    monkeypatch.setattr(storage, "TIMELINES_FILE", tmp_path / "timelines.json")
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    monkeypatch.setattr(main, "delete_user_usage_records", lambda uid: None)
    monkeypatch.setattr(main, "delete_user_activity", lambda uid: 0)
    auth_deleted: List[str] = []

    async def fake_delete_supabase_user(user_id):
        auth_deleted.append(user_id)
        return True

    monkeypatch.setattr(main, "delete_supabase_user", fake_delete_supabase_user)
    storage.save_timeline_data(
        {"id": TL_ID, "title": "Owned", "articles": [{"id": "a1", "title": "Ev"}]}, user_id=USER["id"], existing_meta=None
    )
    return auth_deleted


@pytest.mark.asyncio
async def test_account_deletion_returns_503_and_keeps_auth_user_when_podcasts_fail(account_env, monkeypatch):
    calls = []

    def failing_delete(tid):
        calls.append(tid)
        raise podcast_store.PodcastStorageError("storage down")

    monkeypatch.setattr(podcast_store, "delete_timeline_episodes", failing_delete)
    with pytest.raises(HTTPException) as exc:
        await main.delete_user_account(user=USER)
    assert exc.value.status_code == 503
    assert calls == [TL_ID, TL_ID]  # retried once
    assert account_env == []  # auth user NOT deleted
    # Nothing else was deleted either, so a retry can still find the timeline's podcasts.
    assert [t["id"] for t in storage.list_all_timelines(user_id=USER["id"])] == [TL_ID]


@pytest.mark.asyncio
async def test_account_deletion_retries_podcast_cleanup_once(account_env, monkeypatch):
    real = podcast_store.delete_timeline_episodes
    calls = []

    def flaky(tid):
        calls.append(tid)
        if len(calls) == 1:
            raise podcast_store.PodcastStorageError("blip")
        return real(tid)

    monkeypatch.setattr(podcast_store, "delete_timeline_episodes", flaky)
    resp = await main.delete_user_account(user=USER)
    assert resp["success"] is True
    assert len(calls) == 2
    assert account_env == [USER["id"]]


@pytest.mark.asyncio
async def test_account_deletion_deletes_podcast_audio_end_to_end(account_env, local_podcasts):
    keys = {"clip": _key("1"), "episode": _key("2"), "gender_clip": _key("3"), "gender_episode": _key("4")}
    _seed_episode("ep-acct", keys)
    resp = await main.delete_user_account(user=USER)
    assert resp["success"] is True
    assert podcast_store.list_episodes(TL_ID) == []
    for key in keys.values():
        assert not (local_podcasts / podcast_store._clip_path(key, "mp3")).exists()
    assert account_env == [USER["id"]]
