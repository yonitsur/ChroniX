"""
Durable storage for podcast episodes and rendered audio clips.

Objects live in a private Supabase Storage bucket (created on first use) when Supabase is
configured, with a local `data/podcasts/` directory as the fallback for development or when
the remote store is unreachable.

Layout:
  clips/<k2>/<key>.mp3     content-addressed chapter audio (immutable)
  clips/<k2>/<key>.json    clip metadata: duration, turn starts, sentence timings, engine
  episodes/<timeline>/<episode_id>.json   episode documents (script + audio variant state)
  episodes-private/<timeline>/u-<id>.json episodes made by someone other than the timeline's owner
                                          or an admin: listed only to their creator (and the owner /
                                          admins), and never counted as the timeline "having a podcast"
  episodes-index/<timeline>.json          the timeline's episode index (see "Episode index" below)
  episodes-owners/<hash>.json             one creator's episodes across all timelines
"""
import contextlib
import hashlib
import json
import logging
import os
import re
import shutil
import threading
import time
import urllib.parse
import uuid
from collections import OrderedDict
from pathlib import Path
from typing import Any, BinaryIO, Callable, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
LOCAL_DIR = DATA_DIR / "podcasts"
# Safety bound on how many episode documents one listing reads. The per-timeline total is capped
# well below this when episodes are created (MAX_EPISODES_PER_TIMELINE_TOTAL in main.py).
MAX_EPISODES_LISTED = 200
_EPISODES_ROOT = "episodes"
_PRIVATE_EPISODES_ROOT = "episodes-private"
_INDEX_ROOT = "episodes-index"
_OWNER_INDEX_ROOT = "episodes-owners"
PRIVATE_EPISODE_ID_PREFIX = "u-"
_LIST_PAGE_SIZE = 1000
_MAX_LIST_PAGES = 50
_PARALLEL_READS = max(1, int(os.getenv("PODCAST_PARALLEL_READS", "8") or 8))
_TOMBSTONE_SECONDS = 3600.0

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


_DEFAULT_CLIP_CACHE_BYTES = max(1, int(os.getenv("PODCAST_CLIP_CACHE_MB", "10"))) * 1024 * 1024
_MAX_EPISODE_CACHE_ENTRIES = 32


class _EpisodeCache:
    """Write-through LRU for episode JSON documents so rapid chapter updates never read stale CDN copies."""

    def __init__(self, max_entries: int = _MAX_EPISODE_CACHE_ENTRIES):
        self.max_entries = max_entries
        self._items: "OrderedDict[str, bytes]" = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[bytes]:
        with self._lock:
            data = self._items.get(key)
            if data is not None:
                self._items.move_to_end(key)
            return data

    def put(self, key: str, data: bytes) -> None:
        with self._lock:
            self._items.pop(key, None)
            self._items[key] = data
            while len(self._items) > self.max_entries:
                self._items.popitem(last=False)

    def delete(self, key: str) -> None:
        with self._lock:
            self._items.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()


episode_cache = _EpisodeCache()


def _episode_cache_key(path: str) -> str:
    scope = _supabase()[0] if remote_enabled() else str(LOCAL_DIR)
    return f"{scope}:{path}"


class _ClipCache:
    """Small in-process LRU so repeated Range requests for a hot clip don't refetch it."""

    def __init__(self, max_bytes: int = _DEFAULT_CLIP_CACHE_BYTES):
        self.max_bytes = max_bytes
        self.max_item_bytes = min(6 * 1024 * 1024, max(512 * 1024, max_bytes // 2))
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

    def delete(self, key: str) -> None:
        with self._lock:
            data = self._items.pop(key, None)
            if data is not None:
                self._size -= len(data)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._size = 0
        episode_cache.clear()
        clear_index_cache()
        invalidate_podcast_folders_cache()
        clear_signed_url_cache()


clip_cache = _ClipCache()

_PODCAST_FOLDERS_LOCK = threading.Lock()
_PODCAST_FOLDERS_CACHE: Optional[set[str]] = None
_PODCAST_FOLDERS_TS: float = 0.0
_PODCAST_FOLDERS_TTL = 300.0


def invalidate_podcast_folders_cache() -> None:
    """Clear the cached set of timeline folders that have podcast episodes."""
    global _PODCAST_FOLDERS_CACHE, _PODCAST_FOLDERS_TS
    with _PODCAST_FOLDERS_LOCK:
        _PODCAST_FOLDERS_CACHE = None
        _PODCAST_FOLDERS_TS = 0.0


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
                # Episode documents and indexes change in place; only clips are immutable.
                headers["cache-control"] = "no-cache" if (_is_episode_path(path) or _is_index_path(path)) else "3600"
                resp = client.post(f"{url}/storage/v1/object/{_bucket()}/{path}", headers=headers, content=data)
            if resp.status_code in (200, 201):
                if _is_episode_path(path):
                    episode_cache.put(_episode_cache_key(path), data)
                return
            logger.error(f"Podcast storage upload failed for {path}: HTTP {resp.status_code} {resp.text[:200]}")
        except Exception as e:
            logger.error(f"Podcast storage upload failed for {path}: {e}")
    local = _local_path(path)
    local.parent.mkdir(parents=True, exist_ok=True)
    tmp = local.with_suffix(f"{local.suffix}.{threading.get_ident()}.tmp")
    tmp.write_bytes(data)
    _retry_io(lambda: os.replace(tmp, local))
    if _is_episode_path(path):
        episode_cache.put(_episode_cache_key(path), data)


class PodcastStorageError(RuntimeError):
    """Remote podcast storage failed during an operation that must not fail silently (strict mode)."""


def get_object(path: str, strict: bool = False) -> Optional[bytes]:
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
            if strict:
                raise PodcastStorageError(f"Podcast storage read failed: HTTP {resp.status_code}")
    except PodcastStorageError:
        raise
    except Exception as e:
        logger.warning(f"Podcast storage read failed for {path}: {e}")
        if strict:
            raise PodcastStorageError("Podcast storage read failed") from e
    return None


def list_objects(prefix: str, strict: bool = False) -> List[str]:
    """Names (relative to `prefix`) of objects directly under a folder prefix ending in '/'."""
    names: set[str] = set()
    local_dir = _local_path(prefix)
    if local_dir.is_dir():
        names.update(p.name for p in local_dir.iterdir() if p.is_file() and not p.name.endswith(".tmp"))
    if remote_enabled():
        url, _ = _supabase()
        try:
            with _http_client() as client:
                # Paginated (B-15): a busy folder holds more than one page.
                for page in range(_MAX_LIST_PAGES):
                    resp = client.post(
                        f"{url}/storage/v1/object/list/{_bucket()}",
                        headers=_headers("application/json"),
                        json={
                            "prefix": prefix,
                            "limit": _LIST_PAGE_SIZE,
                            "offset": page * _LIST_PAGE_SIZE,
                            "sortBy": {"column": "name", "order": "asc"},
                        },
                    )
                    if resp.status_code != 200:
                        if strict:
                            raise PodcastStorageError(f"Podcast storage list failed: HTTP {resp.status_code}")
                        logger.warning(f"Podcast storage list failed for {prefix}: HTTP {resp.status_code}")
                        break
                    batch = resp.json() or []
                    names.update(item["name"] for item in batch if item.get("name") and item.get("id"))
                    if len(batch) < _LIST_PAGE_SIZE:
                        break
        except PodcastStorageError:
            raise
        except Exception as e:
            logger.warning(f"Podcast storage list failed for {prefix}: {e}")
            if strict:
                raise PodcastStorageError("Podcast storage list failed") from e
    return sorted(names)


def delete_objects(paths: List[str], strict: bool = False) -> None:
    for path in paths:
        if _is_episode_path(path):
            episode_cache.delete(_episode_cache_key(path))
        try:
            _local_path(path).unlink(missing_ok=True)
        except OSError:
            pass
    if remote_enabled() and paths:
        url, _ = _supabase()
        try:
            with _http_client() as client:
                resp = client.request(
                    "DELETE",
                    f"{url}/storage/v1/object/{_bucket()}",
                    headers=_headers("application/json"),
                    json={"prefixes": paths},
                )
            if resp.status_code not in (200, 204):
                logger.warning(f"Podcast storage delete failed: HTTP {resp.status_code} {resp.text[:200]}")
                if strict:
                    raise PodcastStorageError(f"Podcast storage delete failed: HTTP {resp.status_code}")
        except PodcastStorageError:
            raise
        except Exception as e:
            logger.warning(f"Podcast storage delete failed: {e}")
            if strict:
                raise PodcastStorageError("Podcast storage delete failed") from e


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


def _put_object_file(path: str, fileobj: BinaryIO, size: int, content_type: str) -> None:
    """`put_object` for a large body held in a (spooled) file: streamed, never one `bytes` (SC-05)."""
    if remote_enabled():
        url, _ = _supabase()
        try:
            fileobj.seek(0)
            with _http_client() as client:
                _ensure_bucket(client)
                headers = _headers(content_type)
                headers["x-upsert"] = "true"
                headers["cache-control"] = "3600"
                headers["Content-Length"] = str(size)
                resp = client.post(
                    f"{url}/storage/v1/object/{_bucket()}/{path}", headers=headers,
                    content=iter(lambda: fileobj.read(_STREAM_CHUNK_BYTES), b""),
                )
            if resp.status_code in (200, 201):
                return
            logger.error(f"Podcast storage upload failed for {path}: HTTP {resp.status_code} {resp.text[:200]}")
        except Exception as e:
            logger.error(f"Podcast storage upload failed for {path}: {e}")
    local = _local_path(path)
    local.parent.mkdir(parents=True, exist_ok=True)
    tmp = local.with_suffix(f"{local.suffix}.{threading.get_ident()}.tmp")
    fileobj.seek(0)
    with open(tmp, "wb") as out:
        shutil.copyfileobj(fileobj, out, _STREAM_CHUNK_BYTES)
    _retry_io(lambda: os.replace(tmp, local))


def put_clip_file(key: str, fileobj: BinaryIO, size: int, meta: Dict[str, Any]) -> None:
    """Stores a large clip (a joined episode file) straight from its spooled file."""
    _put_object_file(_clip_path(key, "mp3"), fileobj, size, "audio/mpeg")
    put_object(_clip_path(key, "json"), json.dumps(meta, ensure_ascii=False).encode("utf-8"), "application/json")


# --- Serving clips without buffering them (SC-05) ----------------------------------------------
# Clip keys are unguessable content hashes, so a short-lived signed Storage URL is as private as
# the API URL itself: the API redirects to it and Storage / its CDN answer Range requests.
_STREAM_CHUNK_BYTES = 64 * 1024
_SIGNED_URL_CACHE_MAX = 4096
_signed_url_lock = threading.Lock()
_signed_url_cache: "OrderedDict[tuple, tuple]" = OrderedDict()


class ClipNotFound(Exception):
    """Storage says the clip object does not exist."""


def signed_url_ttl_seconds() -> int:
    try:
        return max(60, int(os.getenv("PODCAST_SIGNED_URL_TTL_SECONDS", "") or 3600))
    except ValueError:
        return 3600


def clear_signed_url_cache() -> None:
    with _signed_url_lock:
        _signed_url_cache.clear()


def local_clip_file(key: str) -> Optional[Path]:
    """The clip's MP3 on local disk (local backend, or a remote-upload fallback), else None."""
    if not is_valid_clip_key(key):
        return None
    local = _local_path(_clip_path(key, "mp3"))
    return local if local.is_file() else None


def signed_clip_url(key: str, download_name: Optional[str] = None) -> Optional[Tuple[str, float]]:
    """
    (signed Storage URL, seconds it stays valid) for a clip, reusing a cached signature for most
    of its lifetime. None when signing is unavailable (no remote store, Storage error); raises
    ClipNotFound when Storage reports the object missing.
    """
    if not is_valid_clip_key(key) or not remote_enabled():
        return None
    ttl = signed_url_ttl_seconds()
    now = time.time()
    cache_key = (_supabase()[0], _bucket(), key)
    with _signed_url_lock:
        hit = _signed_url_cache.get(cache_key)
        if hit is not None and hit[1] - now > ttl * 0.25:
            _signed_url_cache.move_to_end(cache_key)
            signed, expires_at = hit
            return _with_download(signed, download_name), expires_at - now
    url, _ = _supabase()
    try:
        with _http_client() as client:
            resp = client.post(
                f"{url}/storage/v1/object/sign/{_bucket()}/{_clip_path(key, 'mp3')}",
                headers=_headers("application/json"),
                json={"expiresIn": ttl},
            )
    except Exception as e:
        logger.warning(f"Podcast clip signing failed: {e}")
        return None
    if resp.status_code in (400, 404):
        raise ClipNotFound(key)
    if resp.status_code != 200:
        logger.warning(f"Podcast clip signing failed: HTTP {resp.status_code}")
        return None
    try:
        relative = (resp.json() or {}).get("signedURL") or (resp.json() or {}).get("signedUrl")
    except ValueError:
        relative = None
    if not relative:
        return None
    signed = relative if relative.startswith("http") else f"{url}/storage/v1{relative if relative.startswith('/') else '/' + relative}"
    expires_at = now + ttl
    with _signed_url_lock:
        _signed_url_cache[cache_key] = (signed, expires_at)
        _signed_url_cache.move_to_end(cache_key)
        while len(_signed_url_cache) > _SIGNED_URL_CACHE_MAX:
            _signed_url_cache.popitem(last=False)
    return _with_download(signed, download_name), float(ttl)


def _with_download(signed: str, download_name: Optional[str]) -> str:
    if not download_name:
        return signed
    sep = "&" if "?" in signed else "?"
    return f"{signed}{sep}download={urllib.parse.quote(download_name)}"


def remote_clip_request(key: str) -> Optional[Tuple[str, Dict[str, str]]]:
    """(URL, headers) for streaming a clip straight from private Storage (signing fallback)."""
    if not is_valid_clip_key(key) or not remote_enabled():
        return None
    url, _ = _supabase()
    return f"{url}/storage/v1/object/authenticated/{_bucket()}/{_clip_path(key, 'mp3')}", _headers()


# --- Episodes --------------------------------------------------------------------------------

def _timeline_folder(timeline_id: str) -> str:
    tid = str(timeline_id or "")
    if _SAFE_ID_RE.match(tid):
        return tid
    return "h-" + hashlib.sha256(tid.encode("utf-8")).hexdigest()[:40]


def is_private_episode_id(episode_id: str) -> bool:
    return str(episode_id or "").startswith(PRIVATE_EPISODE_ID_PREFIX)


def new_episode_id(private: bool = False) -> str:
    """A fresh episode id; private ones carry a prefix that selects the private namespace."""
    eid = uuid.uuid4().hex
    return f"{PRIVATE_EPISODE_ID_PREFIX}{eid}" if private else eid


def _is_episode_path(path: str) -> bool:
    return path.startswith((f"{_EPISODES_ROOT}/", f"{_PRIVATE_EPISODES_ROOT}/"))


def _is_index_path(path: str) -> bool:
    return path.startswith((f"{_INDEX_ROOT}/", f"{_OWNER_INDEX_ROOT}/"))


def _episode_prefixes(timeline_id: str) -> List[str]:
    folder = _timeline_folder(timeline_id)
    return [f"{_EPISODES_ROOT}/{folder}/", f"{_PRIVATE_EPISODES_ROOT}/{folder}/"]


def _episode_path(timeline_id: str, episode_id: str) -> str:
    # The id alone picks the namespace, so lookups never have to probe both.
    root = _PRIVATE_EPISODES_ROOT if is_private_episode_id(episode_id) else _EPISODES_ROOT
    return f"{root}/{_timeline_folder(timeline_id)}/{episode_id}.json"


def is_valid_episode_id(episode_id: str) -> bool:
    return bool(_SAFE_ID_RE.match(episode_id or ""))


class EpisodeWriteRefused(RuntimeError):
    """A write for an account deleted moments ago (B-13). Nothing was stored."""


# Episodes deleted in this process: a render or clip update still in flight must not re-create them.
_tombstones: Dict[tuple, float] = {}
_tombstones_lock = threading.Lock()


def _tombstone_key(timeline_id: str, episode_id: str) -> tuple:
    return (_episode_cache_key(""), _timeline_folder(timeline_id), str(episode_id or ""))


def tombstone_episode(timeline_id: str, episode_id: str) -> None:
    now = time.time()
    with _tombstones_lock:
        for k, until in list(_tombstones.items()):
            if until <= now:
                _tombstones.pop(k, None)
        _tombstones[_tombstone_key(timeline_id, episode_id)] = now + _TOMBSTONE_SECONDS


def clear_tombstones() -> None:
    """Test helper."""
    with _tombstones_lock:
        _tombstones.clear()


def is_episode_tombstoned(timeline_id: str, episode_id: str) -> bool:
    with _tombstones_lock:
        until = _tombstones.get(_tombstone_key(timeline_id, episode_id))
        return bool(until and until > time.time())


def save_episode(doc: Dict[str, Any]) -> bool:
    """
    Writes an episode document and keeps the timeline's episode index in step. Returns False (and
    writes nothing) for an episode deleted moments ago; raises EpisodeWriteRefused when its owner's
    account was just deleted.
    """
    from services.deleted_users import is_recently_deleted

    if is_episode_tombstoned(doc["timeline_id"], doc["id"]):
        logger.info(f"Not re-saving deleted podcast episode {doc['id']}.")
        return False
    if is_recently_deleted(doc.get("owner_id")):
        raise EpisodeWriteRefused("episode owner was deleted")
    path = _episode_path(doc["timeline_id"], doc["id"])
    raw = json.dumps(doc, ensure_ascii=False).encode("utf-8")
    put_object(path, raw, "application/json")
    episode_cache.put(_episode_cache_key(path), raw)
    try:
        _index_upsert(doc)
    except Exception as e:  # the index is rebuilt from a listing when it is missing or wrong
        logger.warning(f"Could not update the episode index of {doc['timeline_id']}: {e}")
    if is_private_episode_id(doc["id"]):
        return True
    folder = _timeline_folder(doc["timeline_id"])
    with _PODCAST_FOLDERS_LOCK:
        if _PODCAST_FOLDERS_CACHE is not None:
            _PODCAST_FOLDERS_CACHE.add(folder)
    return True


# --- Episode index (B-15) --------------------------------------------------------------------
# `episodes-index/<timeline>.json` lists a timeline's episodes (id, owner, creation time and the
# flags visibility needs), so listings, the per-timeline cap, pruning and script reuse never have
# to list the folder and read every document. `episodes-owners/<hash>.json` lists one creator's
# episodes across all timelines (account deletion). Both are updated under a per-timeline /
# per-owner lock on save and delete; a missing or corrupt timeline index is rebuilt from a full
# (paginated) listing. In-process locks only: another instance's concurrent write can drop an entry
# until the next rebuild, which is why readers treat the documents as the source of truth.

_INDEX_FIELDS = ("id", "owner_id", "created_at", "created_by_admin", "source")
_index_cache: "OrderedDict[str, tuple]" = OrderedDict()  # path -> (cached_at, entries)
_INDEX_CACHE_TTL = 60.0
_index_cache_lock = threading.Lock()
_index_locks: Dict[str, threading.Lock] = {}
_index_locks_guard = threading.Lock()
_MAX_INDEX_CACHE_ENTRIES = 256
_MISSING = object()


def clear_index_cache() -> None:
    with _index_cache_lock:
        _index_cache.clear()


def _index_path(timeline_id: str) -> str:
    return f"{_INDEX_ROOT}/{_timeline_folder(timeline_id)}.json"


def _owner_index_path(owner_id: str) -> str:
    digest = hashlib.sha256(f"episode-owner:{owner_id}".encode("utf-8")).hexdigest()[:40]
    return f"{_OWNER_INDEX_ROOT}/{digest}.json"


def _named_lock(name: str) -> threading.Lock:
    with _index_locks_guard:
        lock = _index_locks.get(name)
        if lock is None:
            lock = threading.Lock()
            _index_locks[name] = lock
        return lock


def _index_entry(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {k: doc.get(k) for k in _INDEX_FIELDS}


def _cache_index(path: str, entries: Optional[list]) -> None:
    ckey = _episode_cache_key(path)
    with _index_cache_lock:
        _index_cache.pop(ckey, None)
        if entries is not None:
            _index_cache[ckey] = (time.monotonic(), entries)
            while len(_index_cache) > _MAX_INDEX_CACHE_ENTRIES:
                _index_cache.popitem(last=False)


def _read_json_list(path: str, key: str) -> Any:
    """The `key` list of a JSON object; `_MISSING` when absent or unreadable as JSON.
    Raises PodcastStorageError when storage can't answer."""
    with _index_cache_lock:
        cached = _index_cache.get(_episode_cache_key(path))
        if cached is not None and time.monotonic() - cached[0] < _INDEX_CACHE_TTL:
            _index_cache.move_to_end(_episode_cache_key(path))
            return [dict(e) for e in cached[1]]
    raw = get_object(path, strict=True)
    if not raw:
        return _MISSING
    try:
        body = json.loads(raw)
        entries = body.get(key) if isinstance(body, dict) else None
    except ValueError:
        entries = None
    if not isinstance(entries, list) or not all(isinstance(e, dict) and e.get("id") for e in entries):
        logger.warning(f"Podcast index {path} is corrupt; it will be rebuilt.")
        return _MISSING
    _cache_index(path, entries)
    return [dict(e) for e in entries]


def _write_json_list(path: str, key: str, entries: list, extra: Optional[Dict[str, Any]] = None) -> None:
    body = {"v": 1, **(extra or {}), key: entries}
    put_object(path, json.dumps(body, ensure_ascii=False).encode("utf-8"), "application/json")
    _cache_index(path, [dict(e) for e in entries])


def _load_docs(timeline_id: str, episode_ids: List[str], strict: bool = False) -> List[Dict[str, Any]]:
    """Reads several episode documents in parallel (bounded), skipping missing ones."""
    read = (lambda eid: _read_episode_strict(timeline_id, eid)) if strict else (lambda eid: get_episode(timeline_id, eid))
    ids = [eid for eid in episode_ids if is_valid_episode_id(eid)]
    if len(ids) <= 1:
        return [d for d in (read(eid) for eid in ids) if d]
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=min(_PARALLEL_READS, len(ids)), thread_name_prefix="podcast-read") as pool:
        return [d for d in pool.map(read, ids) if d]


def _list_episode_ids(timeline_id: str, strict: bool) -> List[str]:
    ids: List[str] = []
    for prefix in _episode_prefixes(timeline_id):
        ids.extend(n[: -len(".json")] for n in list_objects(prefix, strict=strict) if n.endswith(".json"))
    return ids


def _rebuild_index(timeline_id: str) -> list:
    """Full listing (both namespaces, paginated) + document reads -> a fresh index. Strict: a storage
    failure raises instead of writing an incomplete index."""
    docs = _load_docs(timeline_id, _list_episode_ids(timeline_id, strict=True), strict=True)
    entries = [_index_entry(d) for d in docs]
    if entries:
        _write_json_list(_index_path(timeline_id), "episodes", entries, {"timeline_id": str(timeline_id)})
    else:
        _cache_index(_index_path(timeline_id), [])
    return entries


def get_episode_index(timeline_id: str, strict: bool = False) -> List[Dict[str, Any]]:
    """
    The timeline's episode index entries ({id, owner_id, created_at, created_by_admin, source}),
    newest first. Rebuilt from a full listing when missing or corrupt. On a storage failure: raises
    when `strict`, else falls back to the documents found by a (non-strict) listing.
    """
    path = _index_path(timeline_id)
    try:
        entries = _read_json_list(path, "episodes")
        if entries is _MISSING:
            with _named_lock(path):
                entries = _read_json_list(path, "episodes")
                if entries is _MISSING:
                    entries = _rebuild_index(timeline_id)
    except PodcastStorageError:
        if strict:
            raise
        docs = _load_docs(timeline_id, _list_episode_ids(timeline_id, strict=False)[:MAX_EPISODES_LISTED])
        entries = [_index_entry(d) for d in docs]
    entries.sort(key=lambda e: e.get("created_at") or "", reverse=True)
    return entries


def _index_upsert(doc: Dict[str, Any]) -> None:
    timeline_id = doc["timeline_id"]
    path = _index_path(timeline_id)
    entry = _index_entry(doc)
    with _named_lock(path):
        entries = _read_json_list(path, "episodes")
        if entries is _MISSING:
            # Rebuilding lists the folder, which already holds the document just saved.
            entries = _rebuild_index(timeline_id)
            if any(e.get("id") == doc["id"] for e in entries):
                previous = None
            else:
                entries.append(entry)
                _write_json_list(path, "episodes", entries, {"timeline_id": str(timeline_id)})
                previous = None
        else:
            previous = next((e for e in entries if e.get("id") == doc["id"]), None)
            if previous == entry:
                return
            entries = [e for e in entries if e.get("id") != doc["id"]] + [entry]
            _write_json_list(path, "episodes", entries, {"timeline_id": str(timeline_id)})
    old_owner = (previous or {}).get("owner_id")
    if old_owner and old_owner != doc.get("owner_id"):
        _owner_index_change(old_owner, timeline_id, doc["id"], add=False)
    if doc.get("owner_id") and (previous is None or old_owner != doc.get("owner_id")):
        _owner_index_change(doc["owner_id"], timeline_id, doc["id"], add=True)


def _index_remove(timeline_id: str, episode_ids: List[str]) -> None:
    path = _index_path(timeline_id)
    doomed = set(episode_ids)
    removed: List[Dict[str, Any]] = []
    with _named_lock(path):
        entries = _read_json_list(path, "episodes")
        if entries is _MISSING:
            return
        removed = [e for e in entries if e.get("id") in doomed]
        if not removed:
            return
        _write_json_list(path, "episodes", [e for e in entries if e.get("id") not in doomed], {"timeline_id": str(timeline_id)})
    for e in removed:
        if e.get("owner_id"):
            try:
                _owner_index_change(e["owner_id"], timeline_id, e["id"], add=False)
            except Exception as err:
                logger.warning(f"Could not update an episode owner index: {err}")


def _owner_index_change(owner_id: str, timeline_id: str, episode_id: str, add: bool) -> None:
    path = _owner_index_path(owner_id)
    with _named_lock(path):
        entries = _read_json_list(path, "episodes")
        if entries is _MISSING:
            entries = []
        entries = [e for e in entries if not (e.get("id") == episode_id and e.get("timeline_id") == str(timeline_id))]
        if add:
            entries.append({"id": episode_id, "timeline_id": str(timeline_id)})
        if entries:
            _write_json_list(path, "episodes", entries)
        else:
            delete_objects([path])
            _cache_index(path, None)


def list_owner_episode_refs(owner_id: str, strict: bool = False) -> List[Dict[str, str]]:
    """[{timeline_id, id}] of every indexed episode `owner_id` created, on any timeline."""
    if not owner_id:
        return []
    try:
        entries = _read_json_list(_owner_index_path(owner_id), "episodes")
    except PodcastStorageError:
        if strict:
            raise
        return []
    return [] if entries is _MISSING else [{"timeline_id": str(e.get("timeline_id")), "id": str(e.get("id"))} for e in entries]


def list_episode_timeline_folders(force_refresh: bool = False) -> set[str]:
    """
    Return the set of `_timeline_folder(timeline_id)` names that contain at least one episode,
    using a single top-level prefix listing instead of N per-timeline requests.
    """
    global _PODCAST_FOLDERS_CACHE, _PODCAST_FOLDERS_TS
    now = time.monotonic()
    if not force_refresh:
        with _PODCAST_FOLDERS_LOCK:
            if _PODCAST_FOLDERS_CACHE is not None and (now - _PODCAST_FOLDERS_TS) < _PODCAST_FOLDERS_TTL:
                return set(_PODCAST_FOLDERS_CACHE)

    folders: set[str] = set()
    local_eps_dir = _local_path("episodes")
    if local_eps_dir.is_dir():
        try:
            for sub in local_eps_dir.iterdir():
                if sub.is_dir():
                    if any(p.is_file() and p.name.endswith(".json") and not p.name.endswith(".tmp") for p in sub.iterdir()):
                        folders.add(sub.name)
        except OSError:
            pass

    if remote_enabled():
        url, _ = _supabase()
        try:
            with _http_client() as client:
                resp = client.post(
                    f"{url}/storage/v1/object/list/{_bucket()}",
                    headers=_headers("application/json"),
                    json={"prefix": "episodes/", "limit": 1000, "offset": 0, "sortBy": {"column": "name", "order": "asc"}},
                )
            if resp.status_code == 200:
                for item in resp.json() or []:
                    if not isinstance(item, dict):
                        continue
                    name = (item.get("name") or "").strip().strip("/")
                    if name and not name.endswith(".tmp"):
                        folders.add(name.split("/")[0])
        except Exception as e:
            logger.warning(f"Podcast storage top-level folder list failed: {e}")

    with _PODCAST_FOLDERS_LOCK:
        _PODCAST_FOLDERS_CACHE = folders
        _PODCAST_FOLDERS_TS = time.monotonic()
    return set(folders)


def has_timeline_episodes(timeline_id: str, known_folders: Optional[set[str]] = None) -> bool:
    """Fast O(1) check for whether `timeline_id` has any stored podcast episodes."""
    folder = _timeline_folder(timeline_id)
    if known_folders is not None:
        return folder in known_folders
    return folder in list_episode_timeline_folders()


def get_episode(timeline_id: str, episode_id: str) -> Optional[Dict[str, Any]]:
    if not is_valid_episode_id(episode_id):
        return None
    path = _episode_path(timeline_id, episode_id)
    ckey = _episode_cache_key(path)
    raw = episode_cache.get(ckey)
    if raw is None:
        raw = get_object(path)
        if raw:
            episode_cache.put(ckey, raw)
    if not raw:
        return None
    try:
        doc = json.loads(raw)
    except ValueError:
        episode_cache.delete(ckey)
        return None
    return doc if doc.get("timeline_id") == str(timeline_id) else None


def list_episodes(
    timeline_id: str,
    owner_id: Optional[str] = None,
    include: Optional[Callable[[Dict[str, Any]], bool]] = None,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    A timeline's episodes (both namespaces), newest first, read from its index. `owner_id` and
    `include(index_entry)` filter BEFORE any document is read, so a listing only reads the episodes
    it returns (in parallel). Index entries whose document is gone are dropped from the index.
    """
    entries = get_episode_index(timeline_id)
    if owner_id is not None:
        entries = [e for e in entries if e.get("owner_id") == owner_id]
    if include is not None:
        entries = [e for e in entries if include(e)]
    entries = entries[: min(limit or MAX_EPISODES_LISTED, MAX_EPISODES_LISTED)]
    docs = _load_docs(timeline_id, [str(e.get("id")) for e in entries])
    found = {d.get("id") for d in docs}
    stale = [str(e.get("id")) for e in entries if e.get("id") not in found]
    if stale:
        try:
            # Only drop entries whose document is really gone (not a read that failed).
            gone = [eid for eid in stale if _read_episode_strict(timeline_id, eid) is None]
            if gone:
                _index_remove(timeline_id, gone)
        except PodcastStorageError:
            pass
    docs.sort(key=lambda d: d.get("created_at") or "", reverse=True)
    return docs


def delete_episode(timeline_id: str, episode_id: str) -> None:
    """Deletes one episode document. Tombstoned first, so an in-flight update can't re-create it."""
    tombstone_episode(timeline_id, episode_id)
    delete_objects([_episode_path(timeline_id, episode_id)])
    try:
        _index_remove(timeline_id, [episode_id])
    except Exception as e:
        logger.warning(f"Could not update the episode index of {timeline_id}: {e}")
    invalidate_podcast_folders_cache()


def _read_episode_strict(timeline_id: str, episode_id: str) -> Optional[Dict[str, Any]]:
    """Like get_episode, but a storage failure raises instead of reading as "no episode"."""
    if not is_valid_episode_id(episode_id):
        return None
    path = _episode_path(timeline_id, episode_id)
    raw = episode_cache.get(_episode_cache_key(path)) or get_object(path, strict=True)
    if not raw:
        return None
    try:
        doc = json.loads(raw)
    except ValueError:
        return None
    return doc if isinstance(doc, dict) and doc.get("timeline_id") == str(timeline_id) else None


def _episode_clip_keys(doc: Optional[Dict[str, Any]]) -> set:
    keys: set = set()
    audio_map = doc.get("audio") if isinstance(doc, dict) else None
    if not isinstance(audio_map, dict):
        return keys
    for eng_state in audio_map.values():
        if not isinstance(eng_state, dict):
            continue
        states = [eng_state] + [g for g in (eng_state.get("by_gender") or {}).values() if isinstance(g, dict)]
        for state in states:
            for clip_info in (state.get("clips") or {}).values():
                if isinstance(clip_info, dict) and is_valid_clip_key(clip_info.get("key") or ""):
                    keys.add(clip_info["key"])
            ep_aud = state.get("episode_audio")
            if isinstance(ep_aud, dict) and is_valid_clip_key(ep_aud.get("key") or ""):
                keys.add(ep_aud["key"])
    return keys


def _delete_episode_docs(timeline_id: str, episode_ids: List[str], extra_paths: Optional[List[str]] = None) -> None:
    """Strictly deletes episode documents plus the audio and metadata clips they reference."""
    paths: List[str] = []
    clip_keys: set = set()
    for ep_id in episode_ids:
        tombstone_episode(timeline_id, ep_id)
        clip_keys |= _episode_clip_keys(_read_episode_strict(timeline_id, ep_id))
        paths.append(_episode_path(timeline_id, ep_id))
    for key in clip_keys:
        clip_cache.delete(key)
        paths.append(_clip_path(key, "mp3"))
        paths.append(_clip_path(key, "json"))
    paths.extend(extra_paths or [])
    if paths:
        delete_objects(paths, strict=True)


def delete_timeline_episodes(timeline_id: str) -> None:
    """
    Delete all podcast episodes and referenced audio/meta clips for `timeline_id`, and its index.
    Raises PodcastStorageError when remote storage can't be listed, read or deleted, so callers
    (account deletion) never report success while episodes and audio stay streamable.
    """
    invalidate_podcast_folders_cache()
    # The listing, not the index, is authoritative here: nothing may be left behind.
    ids = _list_episode_ids(timeline_id, strict=True)
    try:
        indexed = get_episode_index(timeline_id, strict=True)
    except PodcastStorageError:
        indexed = []
    owners = {(e.get("owner_id"), str(e.get("id"))) for e in indexed if e.get("owner_id")}
    for eid in ids:
        tombstone_episode(timeline_id, eid)
    index_path = _index_path(timeline_id)
    _delete_episode_docs(timeline_id, ids, extra_paths=[index_path])
    _cache_index(index_path, None)
    for owner, eid in owners:
        try:
            _owner_index_change(owner, timeline_id, eid, add=False)
        except Exception as e:
            logger.warning(f"Could not update an episode owner index: {e}")


def delete_owner_episodes(owner_id: str, skip_timelines: Optional[set] = None) -> int:
    """
    Deletes every indexed episode `owner_id` created on any timeline (other people's included, both
    namespaces), with its clips. Strict: raises PodcastStorageError so account deletion can retry.
    Returns how many were deleted.
    """
    refs = list_owner_episode_refs(owner_id, strict=True)
    skip = {str(t) for t in (skip_timelines or set())}
    by_timeline: Dict[str, List[str]] = {}
    for ref in refs:
        if ref["timeline_id"] in skip:
            continue
        by_timeline.setdefault(ref["timeline_id"], []).append(ref["id"])
    deleted = 0
    for tid, ids in by_timeline.items():
        # Only the owner's own episodes, whatever the (possibly stale) owner index says.
        mine = [eid for eid in ids if ((_read_episode_strict(tid, eid) or {}).get("owner_id") == owner_id)]
        if mine:
            _delete_episode_docs(tid, mine)
            deleted += len(mine)
        try:
            _index_remove(tid, ids)
        except Exception as e:
            logger.warning(f"Could not update the episode index of {tid}: {e}")
    path = _owner_index_path(owner_id)
    delete_objects([path], strict=True)
    _cache_index(path, None)
    invalidate_podcast_folders_cache()
    return deleted


def list_all_episode_timeline_folders() -> List[str]:
    """Every timeline folder holding episodes, both namespaces (paginated; used by the legacy scan)."""
    folders: set = set()
    for root in (_EPISODES_ROOT, _PRIVATE_EPISODES_ROOT):
        local_root = _local_path(root)
        if local_root.is_dir():
            folders.update(p.name for p in local_root.iterdir() if p.is_dir())
        if remote_enabled():
            url, _ = _supabase()
            with _http_client() as client:
                for page in range(_MAX_LIST_PAGES):
                    resp = client.post(
                        f"{url}/storage/v1/object/list/{_bucket()}",
                        headers=_headers("application/json"),
                        json={"prefix": f"{root}/", "limit": _LIST_PAGE_SIZE, "offset": page * _LIST_PAGE_SIZE},
                    )
                    if resp.status_code != 200:
                        raise PodcastStorageError(f"Podcast storage list failed: HTTP {resp.status_code}")
                    batch = resp.json() or []
                    folders.update(
                        (it.get("name") or "").strip("/") for it in batch if isinstance(it, dict) and it.get("name")
                    )
                    if len(batch) < _LIST_PAGE_SIZE:
                        break
    folders.discard("")
    return sorted(folders)


def find_owner_episodes_by_scan(owner_id: str) -> List[Dict[str, str]]:
    """
    Episodes `owner_id` created before the owner index existed: reads (or rebuilds) every
    timeline's index. Slow on a big bucket; account deletion runs it in the background.
    Folders named by a hash (timelines with unusual ids) are skipped.
    """
    found: List[Dict[str, str]] = []
    for folder in list_all_episode_timeline_folders():
        try:
            for e in get_episode_index(folder, strict=True):
                if e.get("owner_id") == owner_id:
                    found.append({"timeline_id": folder, "id": str(e.get("id"))})
        except PodcastStorageError as err:
            logger.warning(f"Legacy episode scan skipped folder {folder}: {err}")
    return found
