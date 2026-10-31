"""
Durable storage for podcast episodes and rendered audio clips.

Objects live in a private Supabase Storage bucket (created on first use) when Supabase is
configured, with a local `data/podcasts/` directory as the fallback for development or when
the remote store is unreachable.

Layout:
  clips/<k2>/<key>.mp3     content-addressed chapter audio (immutable)
  clips/<k2>/<key>.json    clip metadata: duration, turn starts, sentence timings, engine
  episodes/<timeline>/<episode_id>.json   episode documents (script + audio variant state)
"""
import contextlib
import hashlib
import json
import logging
import os
import re
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
LOCAL_DIR = DATA_DIR / "podcasts"
MAX_EPISODES_PER_TIMELINE = 20

_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
_KEY_RE = re.compile(r"^[a-f0-9]{64}$")
_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,120}$")

_bucket_ready = False
_bucket_lock = threading.Lock()
_ORIG_HTTP_CLIENT = httpx.Client
_SHARED_HTTP_CLIENT: Optional[httpx.Client] = None
_HTTP_CLIENT_LOCK = threading.Lock()


@contextlib.contextmanager
def _http_client():
    global _SHARED_HTTP_CLIENT
    if httpx.Client is not _ORIG_HTTP_CLIENT:
        client_cls = httpx.Client
        with client_cls(timeout=_TIMEOUT) as client:
            yield client
        return
    with _HTTP_CLIENT_LOCK:
        if _SHARED_HTTP_CLIENT is None or _SHARED_HTTP_CLIENT.is_closed:
            _SHARED_HTTP_CLIENT = _ORIG_HTTP_CLIENT(
                timeout=_TIMEOUT,
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            )
        client = _SHARED_HTTP_CLIENT
    yield client


def _bucket() -> str:
    return (os.getenv("PODCAST_STORAGE_BUCKET") or "podcasts").strip()


def _supabase() -> tuple[str, str]:
    return os.getenv("SUPABASE_URL", "").rstrip("/"), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def remote_enabled() -> bool:
    if (os.getenv("PODCAST_STORAGE_BACKEND") or "").strip().lower() == "local":
        return False
    url, key = _supabase()
    return bool(url and key)


def _headers(content_type: Optional[str] = None) -> Dict[str, str]:
    _, key = _supabase()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _ensure_bucket(client: httpx.Client) -> None:
    global _bucket_ready
    if _bucket_ready:
        return
    with _bucket_lock:
        if _bucket_ready:
            return
        url, _ = _supabase()
        resp = client.post(
            f"{url}/storage/v1/bucket",
            headers=_headers("application/json"),
            json={"id": _bucket(), "name": _bucket(), "public": False},
        )
        if resp.status_code in (200, 201) or "already exists" in resp.text.lower() or resp.status_code == 409:
            _bucket_ready = True
        else:
            logger.warning(f"Could not create podcast storage bucket '{_bucket()}': HTTP {resp.status_code} {resp.text[:200]}")
            _bucket_ready = True  # don't retry on every call; uploads will surface the real error


_DEFAULT_CLIP_CACHE_BYTES = max(1, int(os.getenv("PODCAST_CLIP_CACHE_MB", "4"))) * 1024 * 1024


class _ClipCache:
    """Small in-process LRU so repeated Range requests for a hot clip don't refetch it."""

    def __init__(self, max_bytes: int = _DEFAULT_CLIP_CACHE_BYTES):
        self.max_bytes = max_bytes
        self.max_item_bytes = min(2 * 1024 * 1024, max(512 * 1024, max_bytes // 2))
        self._items: "OrderedDict[str, bytes]" = OrderedDict()
        self._size = 0
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[bytes]:
        with self._lock:
            data = self._items.get(key)
            if data is not None:
                self._items.move_to_end(key)
            return data

    def put(self, key: str, data: bytes) -> None:
        if len(data) > self.max_bytes or len(data) > self.max_item_bytes:
            return
        with self._lock:
            if key in self._items:
                self._size -= len(self._items.pop(key))
            self._items[key] = data
            self._size += len(data)
            while self._size > self.max_bytes and self._items:
                _, old = self._items.popitem(last=False)
                self._size -= len(old)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._size = 0


clip_cache = _ClipCache()


# --- Generic object operations ---------------------------------------------------------------

def _local_path(path: str) -> Path:
    return LOCAL_DIR / path


def _retry_io(fn, attempts: int = 8):
    """Windows can briefly lock a file that is being atomically replaced; retry transient errors."""
    for i in range(attempts):
        try:
            return fn()
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(0.015 * (i + 1))


def put_object(path: str, data: bytes, content_type: str) -> None:
    if remote_enabled():
        url, _ = _supabase()
        try:
            with _http_client() as client:
                _ensure_bucket(client)
                headers = _headers(content_type)
                headers["x-upsert"] = "true"
                resp = client.post(f"{url}/storage/v1/object/{_bucket()}/{path}", headers=headers, content=data)
            if resp.status_code in (200, 201):
                return
            logger.error(f"Podcast storage upload failed for {path}: HTTP {resp.status_code} {resp.text[:200]}")
        except Exception as e:
            logger.error(f"Podcast storage upload failed for {path}: {e}")
    local = _local_path(path)
    local.parent.mkdir(parents=True, exist_ok=True)
    tmp = local.with_suffix(f"{local.suffix}.{threading.get_ident()}.tmp")
    tmp.write_bytes(data)
    _retry_io(lambda: os.replace(tmp, local))


def get_object(path: str) -> Optional[bytes]:
    local = _local_path(path)
    if local.exists():
        try:
            return _retry_io(local.read_bytes)
        except OSError:
            pass
    if not remote_enabled():
        return None
    url, _ = _supabase()
    try:
        with _http_client() as client:
            resp = client.get(f"{url}/storage/v1/object/authenticated/{_bucket()}/{path}", headers=_headers())
        if resp.status_code == 200:
            return resp.content
        if resp.status_code not in (400, 404):
            logger.warning(f"Podcast storage read failed for {path}: HTTP {resp.status_code}")
    except Exception as e:
        logger.warning(f"Podcast storage read failed for {path}: {e}")
    return None


def list_objects(prefix: str) -> List[str]:
    """Names (relative to `prefix`) of objects directly under a folder prefix ending in '/'."""
    names: set[str] = set()
    local_dir = _local_path(prefix)
    if local_dir.is_dir():
        names.update(p.name for p in local_dir.iterdir() if p.is_file() and not p.name.endswith(".tmp"))
    if remote_enabled():
        url, _ = _supabase()
        try:
            with _http_client() as client:
                resp = client.post(
                    f"{url}/storage/v1/object/list/{_bucket()}",
                    headers=_headers("application/json"),
                    json={"prefix": prefix, "limit": 200, "offset": 0, "sortBy": {"column": "name", "order": "asc"}},
                )
            if resp.status_code == 200:
                names.update(item["name"] for item in resp.json() if item.get("name") and item.get("id"))
        except Exception as e:
            logger.warning(f"Podcast storage list failed for {prefix}: {e}")
    return sorted(names)


def delete_objects(paths: List[str]) -> None:
    for path in paths:
        try:
            _local_path(path).unlink(missing_ok=True)
        except OSError:
            pass
    if remote_enabled() and paths:
        url, _ = _supabase()
        try:
            with _http_client() as client:
                client.request(
                    "DELETE",
                    f"{url}/storage/v1/object/{_bucket()}",
                    headers=_headers("application/json"),
                    json={"prefixes": paths},
                )
        except Exception as e:
            logger.warning(f"Podcast storage delete failed: {e}")


# --- Clips -----------------------------------------------------------------------------------

def is_valid_clip_key(key: str) -> bool:
    return bool(_KEY_RE.match(key or ""))


def _clip_path(key: str, ext: str) -> str:
    return f"clips/{key[:2]}/{key}.{ext}"


def get_clip_audio(key: str) -> Optional[bytes]:
    if not is_valid_clip_key(key):
        return None
    cached = clip_cache.get(key)
    if cached is not None:
        return cached
    data = get_object(_clip_path(key, "mp3"))
    if data:
        clip_cache.put(key, data)
    return data


def get_clip_meta(key: str) -> Optional[Dict[str, Any]]:
    if not is_valid_clip_key(key):
        return None
    raw = get_object(_clip_path(key, "json"))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def put_clip(key: str, audio: bytes, meta: Dict[str, Any]) -> None:
    put_object(_clip_path(key, "mp3"), audio, "audio/mpeg")
    put_object(_clip_path(key, "json"), json.dumps(meta, ensure_ascii=False).encode("utf-8"), "application/json")
    clip_cache.put(key, audio)


# --- Episodes --------------------------------------------------------------------------------

def _timeline_folder(timeline_id: str) -> str:
    tid = str(timeline_id or "")
    if _SAFE_ID_RE.match(tid):
        return tid
    return "h-" + hashlib.sha256(tid.encode("utf-8")).hexdigest()[:40]


def _episode_path(timeline_id: str, episode_id: str) -> str:
    return f"episodes/{_timeline_folder(timeline_id)}/{episode_id}.json"


def is_valid_episode_id(episode_id: str) -> bool:
    return bool(_SAFE_ID_RE.match(episode_id or ""))


def save_episode(doc: Dict[str, Any]) -> None:
    put_object(
        _episode_path(doc["timeline_id"], doc["id"]),
        json.dumps(doc, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )


def get_episode(timeline_id: str, episode_id: str) -> Optional[Dict[str, Any]]:
    if not is_valid_episode_id(episode_id):
        return None
    raw = get_object(_episode_path(timeline_id, episode_id))
    if not raw:
        return None
    try:
        doc = json.loads(raw)
    except ValueError:
        return None
    return doc if doc.get("timeline_id") == str(timeline_id) else None


def list_episodes(timeline_id: str) -> List[Dict[str, Any]]:
    prefix = f"episodes/{_timeline_folder(timeline_id)}/"
    docs = []
    for name in list_objects(prefix)[: MAX_EPISODES_PER_TIMELINE * 2]:
        if not name.endswith(".json"):
            continue
        doc = get_episode(timeline_id, name[: -len(".json")])
        if doc:
            docs.append(doc)
    docs.sort(key=lambda d: d.get("created_at") or "", reverse=True)
    return docs


def delete_episode(timeline_id: str, episode_id: str) -> None:
    delete_objects([_episode_path(timeline_id, episode_id)])
