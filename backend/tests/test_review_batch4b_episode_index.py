"""B-15: per-timeline episode index: ordered, owner-filterable listings that read only the
documents they return, a rebuild from a paginated listing, and prune / cap / reuse on the index."""
import json
from typing import Any, Dict, List

import pytest

from services import podcast_store


@pytest.fixture
def local(monkeypatch, tmp_path):
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    podcast_store.clip_cache.clear()
    return tmp_path / "podcasts"


def _save(eid, owner, created, tid="tl-ix", **extra):
    doc = {"id": eid, "timeline_id": tid, "owner_id": owner, "created_at": created, "source": "generated", **extra}
    podcast_store.save_episode(doc)
    return doc


def test_index_tracks_saves_and_deletes_newest_first(local):
    _save("e-old", "alice", "2026-01-01")
    _save("u-mid", "bob", "2026-02-01")
    _save("e-new", "alice", "2026-03-01")
    assert [e["id"] for e in podcast_store.get_episode_index("tl-ix")] == ["e-new", "u-mid", "e-old"]
    assert (local / "episodes-index" / "tl-ix.json").exists()
    podcast_store.delete_episode("tl-ix", "u-mid")
    assert [e["id"] for e in podcast_store.get_episode_index("tl-ix")] == ["e-new", "e-old"]
    # Clip updates of an indexed episode don't rewrite the index.
    before = (local / "episodes-index" / "tl-ix.json").stat().st_mtime_ns
    _save("e-new", "alice", "2026-03-01", audio={"edge": {"status": "ready"}})
    assert (local / "episodes-index" / "tl-ix.json").stat().st_mtime_ns == before


def test_listing_filters_before_reading_documents(local, monkeypatch):
    for i in range(30):
        _save(f"u-other{i:02d}", f"guest-{i}", f"2026-01-{i + 1:02d}")
    mine = _save("u-mine", "me", "2025-01-01")
    podcast_store.episode_cache.clear()
    reads: List[str] = []
    real_get = podcast_store.get_object

    def counting(path, strict=False):
        if path.startswith(("episodes/", "episodes-private/")):
            reads.append(path)
        return real_get(path, strict)

    monkeypatch.setattr(podcast_store, "get_object", counting)
    docs = podcast_store.list_episodes("tl-ix", "me")
    assert [d["id"] for d in docs] == [mine["id"]]
    assert len(reads) == 1  # not 31 sequential GETs
    reads.clear()
    visible = podcast_store.list_episodes("tl-ix", include=lambda e: e["owner_id"] in ("guest-1", "guest-2"))
    assert {d["id"] for d in visible} == {"u-other01", "u-other02"} and len(reads) == 2


def test_missing_or_corrupt_index_is_rebuilt_from_a_full_listing(local):
    for i in range(5):
        _save(f"e{i}", "alice", f"2026-01-0{i + 1}")
    index_file = local / "episodes-index" / "tl-ix.json"
    index_file.unlink()
    podcast_store.clear_index_cache()
    assert len(podcast_store.get_episode_index("tl-ix")) == 5
    assert index_file.exists()
    index_file.write_text("{not json")
    podcast_store.clear_index_cache()
    assert [e["id"] for e in podcast_store.get_episode_index("tl-ix")] == ["e4", "e3", "e2", "e1", "e0"]


def test_first_save_on_a_legacy_folder_keeps_the_older_episodes(local):
    # Episodes written before the index existed (no index object yet).
    folder = local / "episodes" / "tl-ix"
    folder.mkdir(parents=True)
    for i in range(3):
        (folder / f"old{i}.json").write_text(json.dumps({"id": f"old{i}", "timeline_id": "tl-ix", "created_at": f"2025-0{i + 1}"}))
    _save("brand-new", "alice", "2026-06-01")
    assert {e["id"] for e in podcast_store.get_episode_index("tl-ix")} == {"old0", "old1", "old2", "brand-new"}


class _PagedRemote:
    """Supabase Storage stand-in whose list endpoint honours limit/offset."""

    def __init__(self, names: List[str], prefix: str):
        self.objects: Dict[str, bytes] = {}
        self.list_calls: List[Dict[str, Any]] = []
        for n in names:
            eid = n[: -len(".json")]
            self.objects[prefix + n] = json.dumps({"id": eid, "timeline_id": "tl-big", "created_at": eid}).encode()
        fake = self

        class Resp:
            def __init__(self, status_code, body=None, content=b""):
                self.status_code = status_code
                self._body = body
                self.content = content
                self.text = ""

            def json(self):
                return self._body

        class Client:
            def __init__(self, **kw):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, url, headers=None, json=None, content=None, **kw):
                if "/object/list/" in url:
                    fake.list_calls.append(json)
                    pre = json["prefix"]
                    names = sorted(p[len(pre):] for p in fake.objects if p.startswith(pre) and "/" not in p[len(pre):])
                    page = names[json["offset"]: json["offset"] + json["limit"]]
                    return Resp(200, [{"name": n, "id": n} for n in page])
                path = url.split(f"/object/podcasts/", 1)[1]
                fake.objects[path] = content
                return Resp(200, {})

            def get(self, url, headers=None, **kw):
                path = url.split("/object/authenticated/podcasts/", 1)[1]
                if path in fake.objects:
                    return Resp(200, content=fake.objects[path])
                return Resp(404, {})

            def request(self, method, url, headers=None, json=None, **kw):
                for p in json["prefixes"]:
                    fake.objects.pop(p, None)
                return Resp(200, [])

        self.Client = Client


def test_rebuild_paginates_beyond_one_page(monkeypatch, tmp_path):
    monkeypatch.delenv("PODCAST_STORAGE_BACKEND", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("PODCAST_STORAGE_BUCKET", "podcasts")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    monkeypatch.setattr(podcast_store, "_LIST_PAGE_SIZE", 10)
    monkeypatch.setattr(podcast_store, "_bucket_ready", True)
    fake = _PagedRemote([f"e{i:03d}.json" for i in range(25)], "episodes/tl-big/")
    monkeypatch.setattr(podcast_store.httpx, "Client", fake.Client)
    podcast_store.episode_cache.clear()
    entries = podcast_store.get_episode_index("tl-big")
    assert len(entries) == 25
    assert len([c for c in fake.list_calls if c["prefix"] == "episodes/tl-big/"]) == 3
    assert "episodes-index/tl-big.json" in fake.objects
