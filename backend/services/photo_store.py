"""
Hosted timeline photos (Story Studio photo import).

Without this, imported photos are stored inline in the timeline JSON, which caps a timeline at
roughly 100 photos. Hosted photos are files in a PUBLIC Supabase Storage bucket, served by
Supabase's CDN; the timeline only stores their URLs, so an event can keep all of its photos.

Privacy: object names are random (128-bit) under an owner folder named by a salted hash of the
user id, so URLs can't be guessed or tied to a user. Anyone with a photo's URL can open it -
the same exposure as a shared timeline link today. Uploads are re-encoded without metadata
(EXIF/GPS) whenever they carry any.

Timelines are soft-deleted (the record stays), so their photos stay too; everything a user
uploaded is removed when the account is deleted.

Falls back to a local `data/photos/` directory (served by GET /api/photos/...) when Supabase
isn't configured, for development.
"""
import contextlib
import hashlib
import io
import logging
import os
import re
import shutil
import threading
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import httpx

from services.runtime_env import derived_secret, is_production_environment

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
LOCAL_DIR = DATA_DIR / "photos"
MAX_UPLOAD_BYTES = 2 * 1024 * 1024
MAX_SIDE_PX = 2048
_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
KEY_RE = re.compile(r"^u/[a-f0-9]{20}/[a-f0-9]{32}\.(webp|jpg)$")
_CONTENT_TYPES = {"webp": "image/webp", "jpg": "image/jpeg"}

_bucket_ready = False
_bucket_lock = threading.Lock()


def _bucket() -> str:
    return (os.getenv("PHOTO_STORAGE_BUCKET") or "timeline-photos").strip()


def _supabase() -> Tuple[str, str]:
    return os.getenv("SUPABASE_URL", "").rstrip("/"), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def remote_enabled() -> bool:
    if (os.getenv("PHOTO_STORAGE_BACKEND") or "").strip().lower() == "local":
        return False
    url, key = _supabase()
    return bool(url and key)


def _headers(content_type: Optional[str] = None) -> Dict[str, str]:
    _, key = _supabase()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if content_type:
        headers["Content-Type"] = content_type
    return headers


_ORIG_HTTP_CLIENT = httpx.Client
_SHARED_CLIENT: Optional[httpx.Client] = None
_SHARED_CLIENT_LOCK = threading.Lock()


@contextlib.contextmanager
def _client():
    """One pooled client for every photo request (P-14: no TLS handshake per photo); a fresh one
    when tests monkeypatch httpx.Client."""
    global _SHARED_CLIENT
    if httpx.Client is not _ORIG_HTTP_CLIENT:
        with httpx.Client(timeout=_TIMEOUT) as client:
            yield client
        return
    with _SHARED_CLIENT_LOCK:
        if _SHARED_CLIENT is None or _SHARED_CLIENT.is_closed:
            _SHARED_CLIENT = _ORIG_HTTP_CLIENT(
                timeout=_TIMEOUT,
                limits=httpx.Limits(max_connections=16, max_keepalive_connections=8),
            )
        client = _SHARED_CLIENT
    yield client


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
            json={
                "id": _bucket(), "name": _bucket(), "public": True,
                "file_size_limit": MAX_UPLOAD_BYTES, "allowed_mime_types": list(_CONTENT_TYPES.values()),
            },
        )
        if resp.status_code not in (200, 201) and resp.status_code != 409 and "already exists" not in resp.text.lower():
            logger.warning("Could not create photo bucket '%s': HTTP %s %s", _bucket(), resp.status_code, resp.text[:200])
        _bucket_ready = True


PHOTO_SALT_LABEL = "photo-storage-salt-v1"


def _legacy_salt() -> str:
    # SUPABASE_URL ships in the frontend bundle, so this salt is public (S-11). Kept only to find
    # (and delete) photos uploaded before the private salt existed.
    return os.getenv("SUPABASE_URL") or "chronix"


def _current_salt() -> str:
    """`PHOTO_STORAGE_SALT`; in production otherwise a secret derived from the service-role key."""
    explicit = os.getenv("PHOTO_STORAGE_SALT")
    if explicit:
        return explicit
    if is_production_environment():
        derived = derived_secret(PHOTO_SALT_LABEL)
        if derived:
            return derived
    return _legacy_salt()


def _prefix_for(salt: str, user_id: str) -> str:
    digest = hashlib.sha256(f"{salt}:photos:{user_id}".encode("utf-8")).hexdigest()
    return f"u/{digest[:20]}"


def owner_prefix(user_id: str) -> str:
    """The folder NEW uploads go to."""
    return _prefix_for(_current_salt(), user_id)


def owner_prefixes(user_id: str) -> List[str]:
    """
    Every folder a user's photos may live in: the current one, the production derived-salt one
    and the legacy public-salt one. Changing the salt only moves new uploads (stored URLs keep
    working and the hosted-photo count is keyed by user id), so deletion sweeps all of them.
    """
    salts = [_current_salt()]
    derived = derived_secret(PHOTO_SALT_LABEL)
    if derived:
        salts.append(derived)
    salts.append(_legacy_salt())
    prefixes: List[str] = []
    for salt in salts:
        prefix = _prefix_for(salt, user_id)
        if prefix not in prefixes:
            prefixes.append(prefix)
    return prefixes


def new_key(user_id: str, ext: str) -> str:
    return f"{owner_prefix(user_id)}/{uuid.uuid4().hex}.{ext}"


def is_valid_key(key: str) -> bool:
    return bool(KEY_RE.match(key or ""))


def public_url(key: str) -> str:
    """Where the browser loads the photo from (relative /api/... in local mode)."""
    if remote_enabled():
        url, _ = _supabase()
        return f"{url}/storage/v1/object/public/{_bucket()}/{key}"
    return f"/api/photos/{key}"


class PhotoRejected(Exception):
    pass


def prepare_photo(data: bytes) -> Tuple[bytes, str]:
    """
    Validates an uploaded photo and returns (bytes, ext). JPEG/WebP without metadata and within
    size pass through untouched; anything else (PNG, EXIF/GPS, ICC, oversized) is re-encoded.
    """
    if not data or len(data) > MAX_UPLOAD_BYTES:
        raise PhotoRejected("Photo too large.")
    from PIL import Image
    from services.image_safety import (
        ImageTooLargeError,
        MAX_HOSTED_PHOTO_PIXELS,
        MAX_HOSTED_PHOTO_SIDE,
        open_image_checked,
    )

    try:
        # Dimensions are checked from the header before img.load() decodes any pixels.
        with open_image_checked(
            data,
            max_pixels=MAX_HOSTED_PHOTO_PIXELS,
            max_side=MAX_HOSTED_PHOTO_SIDE,
            formats=("JPEG", "WEBP", "PNG"),
        ) as img:
            fmt = (img.format or "").upper()
            if fmt not in ("JPEG", "WEBP", "PNG"):
                raise PhotoRejected("Unsupported photo format.")
            w, h = img.size
            img.load()
            has_meta = bool(img.info.get("exif") or img.info.get("icc_profile") or img.info.get("xmp")) or len(img.getexif()) > 0
            if fmt in ("JPEG", "WEBP") and not has_meta and max(w, h) <= MAX_SIDE_PX:
                return data, ("jpg" if fmt == "JPEG" else "webp")
            rgb = img.convert("RGB")
            if max(w, h) > MAX_SIDE_PX:
                rgb.thumbnail((MAX_SIDE_PX, MAX_SIDE_PX), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            rgb.save(buf, format="WEBP", quality=82, method=4)
            return buf.getvalue(), "webp"
    except PhotoRejected:
        raise
    except ImageTooLargeError:
        raise PhotoRejected("Photo too large.")
    except Exception:
        raise PhotoRejected("This file isn't a readable photo.")


def put_photo(key: str, data: bytes) -> None:
    if not is_valid_key(key):
        raise ValueError("bad key")
    ctype = _CONTENT_TYPES[key.rsplit(".", 1)[1]]
    if remote_enabled():
        url, _ = _supabase()
        with _client() as client:
            _ensure_bucket(client)
            headers = {**_headers(ctype), "Cache-Control": "max-age=31536000", "x-upsert": "false"}
            resp = client.post(f"{url}/storage/v1/object/{_bucket()}/{key}", headers=headers, content=data)
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"Photo upload failed: HTTP {resp.status_code} {resp.text[:200]}")
        return
    path = LOCAL_DIR / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def get_local_photo(key: str) -> Optional[Tuple[bytes, str]]:
    if not is_valid_key(key):
        return None
    path = LOCAL_DIR / key
    if not path.is_file():
        return None
    return path.read_bytes(), _CONTENT_TYPES[key.rsplit(".", 1)[1]]


def _list_remote(prefix: str, strict: bool = False) -> List[str]:
    url, _ = _supabase()
    names: List[str] = []
    offset = 0
    with _client() as client:
        while True:
            resp = client.post(
                f"{url}/storage/v1/object/list/{_bucket()}",
                headers=_headers("application/json"),
                json={"prefix": prefix, "limit": 1000, "offset": offset},
            )
            if resp.status_code != 200:
                if strict:
                    raise RuntimeError(f"Photo listing failed: HTTP {resp.status_code}")
                break
            batch = resp.json() or []
            names.extend(f"{prefix}/{it['name']}" for it in batch if isinstance(it, dict) and it.get("name"))
            if len(batch) < 1000:
                break
            offset += 1000
    return names


def count_owner_photos(user_id: str) -> Optional[int]:
    """
    How many photos the user really has stored, across every folder they may be in (B-26): the
    source of truth the hosted-photo counter is reconciled against. None when storage can't answer.
    """
    total = 0
    try:
        for prefix in owner_prefixes(user_id):
            if remote_enabled():
                total += len(_list_remote(prefix, strict=True))
            else:
                folder = LOCAL_DIR / prefix
                if folder.is_dir():
                    total += sum(1 for p in folder.iterdir() if p.is_file())
    except Exception as e:
        logger.warning("Photo count for reconciliation failed: %s", e)
        return None
    return total


def owns_key(user_id: str, key: str) -> bool:
    """True when `key` lies in one of the user's photo folders."""
    return is_valid_key(key) and any(key.startswith(f"{prefix}/") for prefix in owner_prefixes(user_id))


def delete_photo(key: str) -> bool:
    """Deletes one stored photo. True when it is gone."""
    if not is_valid_key(key):
        return False
    if remote_enabled():
        url, _ = _supabase()
        with _client() as client:
            resp = client.request(
                "DELETE", f"{url}/storage/v1/object/{_bucket()}", headers=_headers("application/json"), json={"prefixes": [key]}
            )
        if resp.status_code == 204:
            return True
        if resp.status_code != 200:
            raise RuntimeError(f"Photo delete failed: HTTP {resp.status_code}")
        try:
            return bool(resp.json())  # the objects actually removed; empty when it didn't exist
        except ValueError:
            return True
    path = LOCAL_DIR / key
    existed = path.is_file()
    path.unlink(missing_ok=True)
    return existed


def delete_owner_photos(user_id: str) -> int:
    """Deletes every photo a user uploaded (account deletion), in every folder they may be in.
    Returns how many were removed."""
    return sum(_delete_prefix(prefix) for prefix in owner_prefixes(user_id))


def _delete_prefix(prefix: str) -> int:
    if remote_enabled():
        keys = _list_remote(prefix)
        url, _ = _supabase()
        removed = 0
        with _client() as client:
            for i in range(0, len(keys), 500):
                chunk = keys[i:i + 500]
                resp = client.request("DELETE", f"{url}/storage/v1/object/{_bucket()}", headers=_headers("application/json"), json={"prefixes": chunk})
                if resp.status_code in (200, 204):
                    removed += len(chunk)
                else:
                    logger.warning("Photo delete failed for %s: HTTP %s", prefix, resp.status_code)
        return removed
    folder = LOCAL_DIR / prefix
    if not folder.is_dir():
        return 0
    count = sum(1 for _ in folder.glob("*"))
    shutil.rmtree(folder, ignore_errors=True)
    return count
