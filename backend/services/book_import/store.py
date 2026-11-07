"""Durable state for book imports: the `book_imports` row (status, stages, lease, draft) and the
artifacts/objects under one Storage prefix per import.

Two implementations share the `BookImportStore` interface:
- `SupabaseStore`: PostgREST table + RPC lease functions (migration 006) and a PRIVATE Storage bucket;
  uploads and downloads use short-lived signed URLs.
- `LocalStore`: JSON files and a directory tree under backend/data/book_imports/ (development and tests);
  "signed" URLs are HMAC-signed links to the book-import file routes of this backend.

Leases fence every write the runner makes (`update(..., owner=...)` only succeeds while that owner holds
the lease), so two processes overlapping during a deploy never both advance the same import.
"""

from __future__ import annotations

import abc
import asyncio
import base64
import copy
import hashlib
import hmac
import json
import logging
import os
import shutil
import threading
import time
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import httpx

logger = logging.getLogger("ChroniXBookImport")

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "book_imports"
TABLE = "book_imports"
ACTIVE_STATUSES = ("awaiting_upload", "queued", "running", "paused", "review", "finalizing")
CLAIMABLE_STATUSES = ("queued", "running", "finalizing")
LIST_COLUMNS = (
    "id,user_id,status,paused_reason,stage,key_tier,instructions,output_language,lane,sources,stages,progress,"
    "usage,error,draft_rev,timeline_id,attempts,not_before,lease_owner,lease_until,created_at,updated_at,"
    "expires_at,deleted_at"
)


class StoreError(Exception):
    pass


class StoreUnavailable(StoreError):
    """Not configured, or the migration hasn't been applied (`reason` says which)."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class LeaseLost(StoreError):
    pass


class StaleDraft(StoreError):
    def __init__(self, rev: int):
        super().__init__(f"draft revision is {rev}")
        self.rev = rev


class NotFound(StoreError):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def owner_hash(user_id: str) -> str:
    try:
        from services.photo_store import _current_salt

        salt = _current_salt()
    except Exception:  # pragma: no cover
        salt = "book-import"
    return hashlib.sha256(f"{salt}:book:{user_id}".encode("utf-8")).hexdigest()[:20]


def import_prefix(user_id: str, import_id: str) -> str:
    return f"b/{owner_hash(user_id)}/{import_id}"


def new_row(user_id: str, **fields: Any) -> Dict[str, Any]:
    now = utcnow()
    ttl_days = int(fields.pop("ttl_days", 14))
    row: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "status": "awaiting_upload",
        "paused_reason": None,
        "stage": None,
        "key_tier": "admin_paid",
        "user_snapshot": {},
        "instructions": None,
        "output_language": "auto",
        "lane": "full",
        "sources": [],
        "stages": {},
        "progress": {},
        "usage": {},
        "error": None,
        "draft": None,
        "draft_rev": 0,
        "timeline_id": None,
        "attempts": 0,
        "not_before": None,
        "lease_owner": None,
        "lease_until": None,
        "created_at": iso(now),
        "updated_at": iso(now),
        "expires_at": iso(now + timedelta(days=ttl_days)),
        "deleted_at": None,
    }
    row.update(fields)
    return row


class BookImportStore(abc.ABC):
    kind = "abstract"

    # ---- rows
    @abc.abstractmethod
    async def check(self) -> None:
        """Raises StoreUnavailable when the store can't be used."""

    @abc.abstractmethod
    async def insert(self, row: Dict[str, Any]) -> Dict[str, Any]: ...

    @abc.abstractmethod
    async def get(self, import_id: str, *, with_draft: bool = True) -> Optional[Dict[str, Any]]: ...

    @abc.abstractmethod
    async def list_user(self, user_id: str, limit: int = 20) -> List[Dict[str, Any]]: ...

    @abc.abstractmethod
    async def update(self, import_id: str, patch: Dict[str, Any], *, owner: Optional[str] = None) -> Dict[str, Any]:
        """Applies `patch`. With `owner`, only while that owner holds the lease (else LeaseLost)."""

    @abc.abstractmethod
    async def update_draft(self, import_id: str, base_rev: int, draft: Dict[str, Any]) -> int:
        """Optimistic write: succeeds only when the stored revision equals `base_rev` (else StaleDraft)."""

    @abc.abstractmethod
    async def claim(self, owner: str, lease_seconds: int, max_active: int) -> Optional[Dict[str, Any]]: ...

    @abc.abstractmethod
    async def renew(self, import_id: str, owner: str, lease_seconds: int) -> Optional[str]:
        """Extends the lease; returns the current status, or None when the lease is no longer ours."""

    @abc.abstractmethod
    async def release(self, import_id: str, owner: str) -> None: ...

    @abc.abstractmethod
    async def due_for_expiry(self, limit: int = 5) -> List[Dict[str, Any]]: ...

    @abc.abstractmethod
    async def user_ids_with_imports(self, user_id: str) -> List[Dict[str, Any]]:
        """Every import row of a user (including deleted), for account deletion."""

    @abc.abstractmethod
    async def hard_delete(self, import_id: str) -> None: ...

    # ---- objects
    @abc.abstractmethod
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    @abc.abstractmethod
    async def get_bytes(self, key: str) -> Optional[bytes]: ...

    async def download_to(self, key: str, dest: Path) -> bool:
        """Writes an object to `dest` (atomically, via a .part file); False if it doesn't exist.
        Subclasses stream so a large upload never sits in memory whole (512 MB instances)."""
        data = await self.get_bytes(key)
        if data is None:
            return False
        tmp = dest.with_name(dest.name + ".part")
        await asyncio.to_thread(tmp.write_bytes, data)
        os.replace(tmp, dest)
        return True

    @abc.abstractmethod
    async def size_of(self, key: str) -> Optional[int]: ...

    @abc.abstractmethod
    async def list_keys(self, prefix: str) -> List[str]: ...

    @abc.abstractmethod
    async def delete_prefix(self, prefix: str) -> int: ...

    @abc.abstractmethod
    async def upload_target(self, key: str, content_type: str, max_bytes: int, ttl: int) -> Dict[str, Any]: ...

    @abc.abstractmethod
    async def signed_urls(self, keys: Iterable[str], ttl: int) -> Dict[str, str]: ...

    async def put_json(self, key: str, obj: Any) -> None:
        await self.put(key, json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), "application/json")

    async def get_json(self, key: str) -> Optional[Any]:
        data = await self.get_bytes(key)
        if data is None:
            return None
        try:
            return json.loads(data.decode("utf-8"))
        except ValueError:
            return None


# ============================================================================================ local


def _signing_key() -> bytes:
    try:
        from services.runtime_env import derived_secret

        secret = derived_secret("book-import-local-files-v1")
    except Exception:  # pragma: no cover
        secret = ""
    return (secret or os.getenv("BOOK_IMPORT_LOCAL_SIGNING_KEY") or "chronix-book-import-dev").encode("utf-8")


def sign_local(path: str, expires: int, extra: str = "") -> str:
    msg = f"{path}\n{expires}\n{extra}".encode("utf-8")
    return base64.urlsafe_b64encode(hmac.new(_signing_key(), msg, hashlib.sha256).digest()[:18]).decode("ascii")


def verify_local(path: str, expires: str, sig: str, extra: str = "") -> bool:
    try:
        exp = int(expires)
    except (TypeError, ValueError):
        return False
    if exp < int(time.time()):
        return False
    return hmac.compare_digest(sign_local(path, exp, extra), sig or "")


class LocalStore(BookImportStore):
    kind = "local"

    def __init__(self, root: Optional[Path] = None, public_base: str = "/api"):
        self.root = Path(root) if root else DATA_DIR
        self.rows_dir = self.root / "rows"
        self.obj_dir = self.root / "objects"
        self.public_base = public_base.rstrip("/")
        self._lock = threading.RLock()

    # rows ----------------------------------------------------------------------------------
    def _row_path(self, import_id: str) -> Path:
        safe = "".join(ch for ch in import_id if ch.isalnum() or ch == "-")
        return self.rows_dir / f"{safe}.json"

    def _read(self, import_id: str) -> Optional[Dict[str, Any]]:
        p = self._row_path(import_id)
        if not p.is_file():
            return None
        return json.loads(p.read_text(encoding="utf-8"))

    def _write(self, row: Dict[str, Any]) -> None:
        self.rows_dir.mkdir(parents=True, exist_ok=True)
        p = self._row_path(row["id"])
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(row, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, p)

    def _all(self) -> List[Dict[str, Any]]:
        if not self.rows_dir.is_dir():
            return []
        out = []
        for p in self.rows_dir.glob("*.json"):
            try:
                out.append(json.loads(p.read_text(encoding="utf-8")))
            except ValueError:
                continue
        return out

    async def check(self) -> None:
        return None

    async def insert(self, row: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            self._write(row)
            return copy.deepcopy(row)

    async def get(self, import_id: str, *, with_draft: bool = True) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._read(import_id)
        if row is not None and not with_draft:
            row = {k: v for k, v in row.items() if k != "draft"}
        return row

    async def list_user(self, user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        with self._lock:
            rows = [r for r in self._all() if r.get("user_id") == user_id and not r.get("deleted_at")]
        rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        return [{k: v for k, v in r.items() if k != "draft"} for r in rows[:limit]]

    async def update(self, import_id: str, patch: Dict[str, Any], *, owner: Optional[str] = None) -> Dict[str, Any]:
        with self._lock:
            row = self._read(import_id)
            if row is None:
                raise NotFound(import_id)
            if owner is not None and row.get("lease_owner") != owner:
                raise LeaseLost(import_id)
            row.update(copy.deepcopy(patch))
            row["updated_at"] = iso(utcnow())
            self._write(row)
            return copy.deepcopy(row)

    async def update_draft(self, import_id: str, base_rev: int, draft: Dict[str, Any]) -> int:
        with self._lock:
            row = self._read(import_id)
            if row is None:
                raise NotFound(import_id)
            if int(row.get("draft_rev") or 0) != int(base_rev):
                raise StaleDraft(int(row.get("draft_rev") or 0))
            row["draft"] = draft
            row["draft_rev"] = int(base_rev) + 1
            row["updated_at"] = iso(utcnow())
            self._write(row)
            return row["draft_rev"]

    async def claim(self, owner: str, lease_seconds: int, max_active: int) -> Optional[Dict[str, Any]]:
        now = utcnow()
        with self._lock:
            rows = self._all()
            held = sum(
                1 for r in rows
                if r.get("status") in ("running", "finalizing") and (parse_iso(r.get("lease_until")) or now) > now
                and r.get("lease_owner")
            )
            if held >= max_active:
                return None
            cands = []
            for r in rows:
                if r.get("status") not in CLAIMABLE_STATUSES or r.get("deleted_at"):
                    continue
                lu = parse_iso(r.get("lease_until"))
                if r.get("lease_owner") and lu and lu > now:
                    continue
                nb = parse_iso(r.get("not_before"))
                if nb and nb > now:
                    continue
                cands.append(r)
            if not cands:
                return None
            cands.sort(key=lambda r: r.get("created_at") or "")
            row = cands[0]
            row["lease_owner"] = owner
            row["lease_until"] = iso(now + timedelta(seconds=lease_seconds))
            if row["status"] == "queued":
                row["status"] = "running"
            row["updated_at"] = iso(now)
            self._write(row)
            return copy.deepcopy(row)

    async def renew(self, import_id: str, owner: str, lease_seconds: int) -> Optional[str]:
        with self._lock:
            row = self._read(import_id)
            if row is None or row.get("lease_owner") != owner:
                return None
            row["lease_until"] = iso(utcnow() + timedelta(seconds=lease_seconds))
            self._write(row)
            return row.get("status")

    async def release(self, import_id: str, owner: str) -> None:
        with self._lock:
            row = self._read(import_id)
            if row is None or row.get("lease_owner") != owner:
                return
            row["lease_owner"] = None
            row["lease_until"] = None
            self._write(row)

    async def due_for_expiry(self, limit: int = 5) -> List[Dict[str, Any]]:
        now = utcnow()
        with self._lock:
            rows = [
                r for r in self._all()
                if not r.get("deleted_at") and (parse_iso(r.get("expires_at")) or now) < now
                and r.get("status") not in ("running", "finalizing")
            ]
        return rows[:limit]

    async def user_ids_with_imports(self, user_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            return [{"id": r["id"], "user_id": r["user_id"]} for r in self._all() if r.get("user_id") == user_id]

    async def hard_delete(self, import_id: str) -> None:
        with self._lock:
            p = self._row_path(import_id)
            if p.is_file():
                p.unlink()

    # objects -------------------------------------------------------------------------------
    def _obj(self, key: str) -> Path:
        clean = key.replace("\\", "/").lstrip("/")
        if ".." in clean.split("/"):
            raise ValueError("bad key")
        return self.obj_dir / clean

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        p = self._obj(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + ".part")
        await asyncio.to_thread(tmp.write_bytes, data)
        os.replace(tmp, p)

    async def get_bytes(self, key: str) -> Optional[bytes]:
        p = self._obj(key)
        if not p.is_file():
            return None
        return await asyncio.to_thread(p.read_bytes)

    async def download_to(self, key: str, dest: Path) -> bool:
        p = self._obj(key)
        if not p.is_file():
            return False
        tmp = dest.with_name(dest.name + ".part")
        await asyncio.to_thread(shutil.copyfile, p, tmp)
        os.replace(tmp, dest)
        return True

    async def size_of(self, key: str) -> Optional[int]:
        p = self._obj(key)
        return p.stat().st_size if p.is_file() else None

    async def list_keys(self, prefix: str) -> List[str]:
        base = self._obj(prefix)
        if not base.exists():
            return []
        root = self.obj_dir
        return sorted(str(p.relative_to(root)).replace("\\", "/") for p in base.rglob("*") if p.is_file() and not p.name.endswith(".part"))

    async def delete_prefix(self, prefix: str) -> int:
        base = self._obj(prefix)
        if not base.exists():
            return 0
        n = sum(1 for p in base.rglob("*") if p.is_file())
        await asyncio.to_thread(shutil.rmtree, base, True)
        return n

    def local_path(self, key: str) -> Path:
        return self._obj(key)

    async def upload_target(self, key: str, content_type: str, max_bytes: int, ttl: int) -> Dict[str, Any]:
        exp = int(time.time()) + ttl
        sig = sign_local(key, exp, f"put:{max_bytes}")
        q = urllib.parse.urlencode({"e": exp, "s": sig, "m": max_bytes})
        return {
            "method": "PUT",
            "url": f"{self.public_base}/book-import-uploads/{urllib.parse.quote(key)}?{q}",
            "headers": {"content-type": content_type},
            "auth": "none",
            "expiresAt": exp,
        }

    async def signed_urls(self, keys: Iterable[str], ttl: int) -> Dict[str, str]:
        exp = int(time.time()) + ttl
        out = {}
        for k in keys:
            q = urllib.parse.urlencode({"e": exp, "s": sign_local(k, exp, "get")})
            out[k] = f"{self.public_base}/book-import-files/{urllib.parse.quote(k)}?{q}"
        return out


# ============================================================================================ supabase


class SupabaseStore(BookImportStore):
    kind = "supabase"

    def __init__(self, url: str, service_key: str, bucket: str, max_file_mb: int = 200):
        self.url = url.rstrip("/")
        self.key = service_key
        self.bucket = bucket
        self.max_file_mb = max_file_mb
        self._bucket_ready = False
        self._unavailable_until = 0.0
        self._unavailable_reason = ""

    def _headers(self, content_type: Optional[str] = "application/json", **extra: str) -> Dict[str, str]:
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}"}
        if content_type:
            h["Content-Type"] = content_type
        h.update(extra)
        return h

    async def _req(self, method: str, path: str, **kw) -> httpx.Response:
        from services.http_clients import shared_async_client

        async with shared_async_client("book-import-supabase", timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            return await client.request(method, f"{self.url}{path}", **kw)

    def _missing_table(self, resp: httpx.Response) -> bool:
        if resp.status_code not in (400, 404):
            return False
        try:
            code = (resp.json() or {}).get("code")
        except ValueError:
            code = None
        return code in ("PGRST205", "42P01", "PGRST202") or (resp.status_code == 404 and "book_import" in resp.text)

    def _raise(self, resp: httpx.Response, what: str) -> None:
        if self._missing_table(resp):
            self._unavailable_until = time.monotonic() + 300
            self._unavailable_reason = "migration_missing"
            raise StoreUnavailable("migration_missing")
        raise StoreError(f"{what}: HTTP {resp.status_code} {resp.text[:300]}")

    async def check(self) -> None:
        if time.monotonic() < self._unavailable_until:
            raise StoreUnavailable(self._unavailable_reason)
        resp = await self._req("GET", f"/rest/v1/{TABLE}?select=id&limit=1", headers=self._headers(None))
        if resp.status_code != 200:
            self._raise(resp, "check")

    # rows ------------------------------------------------------------------------------------
    async def insert(self, row: Dict[str, Any]) -> Dict[str, Any]:
        resp = await self._req("POST", f"/rest/v1/{TABLE}", headers=self._headers(Prefer="return=representation"), json=row)
        if resp.status_code not in (200, 201):
            self._raise(resp, "insert")
        return resp.json()[0]

    async def get(self, import_id: str, *, with_draft: bool = True) -> Optional[Dict[str, Any]]:
        cols = "*" if with_draft else LIST_COLUMNS
        resp = await self._req(
            "GET", f"/rest/v1/{TABLE}?id=eq.{urllib.parse.quote(import_id)}&select={cols}", headers=self._headers(None)
        )
        if resp.status_code != 200:
            if resp.status_code == 400 and "invalid input syntax" in resp.text:
                return None
            self._raise(resp, "get")
        rows = resp.json()
        return rows[0] if rows else None

    async def list_user(self, user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        q = (
            f"/rest/v1/{TABLE}?user_id=eq.{urllib.parse.quote(user_id)}&deleted_at=is.null"
            f"&order=created_at.desc&limit={int(limit)}&select={LIST_COLUMNS}"
        )
        resp = await self._req("GET", q, headers=self._headers(None))
        if resp.status_code != 200:
            self._raise(resp, "list")
        return resp.json()

    async def update(self, import_id: str, patch: Dict[str, Any], *, owner: Optional[str] = None) -> Dict[str, Any]:
        body = dict(patch)
        body["updated_at"] = iso(utcnow())
        q = f"/rest/v1/{TABLE}?id=eq.{urllib.parse.quote(import_id)}"
        if owner is not None:
            q += f"&lease_owner=eq.{urllib.parse.quote(owner)}"
        resp = await self._req("PATCH", q + f"&select={LIST_COLUMNS}", headers=self._headers(Prefer="return=representation"), json=body)
        if resp.status_code != 200:
            self._raise(resp, "update")
        rows = resp.json()
        if not rows:
            if owner is not None:
                raise LeaseLost(import_id)
            raise NotFound(import_id)
        return rows[0]

    async def update_draft(self, import_id: str, base_rev: int, draft: Dict[str, Any]) -> int:
        q = f"/rest/v1/{TABLE}?id=eq.{urllib.parse.quote(import_id)}&draft_rev=eq.{int(base_rev)}&select=draft_rev"
        resp = await self._req(
            "PATCH", q, headers=self._headers(Prefer="return=representation"),
            json={"draft": draft, "draft_rev": int(base_rev) + 1, "updated_at": iso(utcnow())},
        )
        if resp.status_code != 200:
            self._raise(resp, "update_draft")
        rows = resp.json()
        if not rows:
            current = await self.get(import_id, with_draft=False)
            if current is None:
                raise NotFound(import_id)
            raise StaleDraft(int(current.get("draft_rev") or 0))
        return int(rows[0]["draft_rev"])

    async def _rpc(self, fn: str, args: Dict[str, Any]) -> Any:
        resp = await self._req("POST", f"/rest/v1/rpc/{fn}", headers=self._headers(), json=args)
        if resp.status_code not in (200, 204):
            self._raise(resp, fn)
        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    async def claim(self, owner: str, lease_seconds: int, max_active: int) -> Optional[Dict[str, Any]]:
        rows = await self._rpc("claim_book_import", {"p_owner": owner, "p_lease_seconds": lease_seconds, "p_max_active": max_active})
        if isinstance(rows, list):
            return rows[0] if rows else None
        return rows or None

    async def renew(self, import_id: str, owner: str, lease_seconds: int) -> Optional[str]:
        res = await self._rpc("renew_book_import_lease", {"p_id": import_id, "p_owner": owner, "p_lease_seconds": lease_seconds})
        return res if isinstance(res, str) else None

    async def release(self, import_id: str, owner: str) -> None:
        await self._rpc("release_book_import_lease", {"p_id": import_id, "p_owner": owner})

    async def due_for_expiry(self, limit: int = 5) -> List[Dict[str, Any]]:
        now = urllib.parse.quote(iso(utcnow()))
        q = (
            f"/rest/v1/{TABLE}?expires_at=lt.{now}&deleted_at=is.null&status=not.in.(running,finalizing)"
            f"&order=expires_at.asc&limit={int(limit)}&select=id,user_id,status"
        )
        resp = await self._req("GET", q, headers=self._headers(None))
        if resp.status_code != 200:
            self._raise(resp, "due_for_expiry")
        return resp.json()

    async def user_ids_with_imports(self, user_id: str) -> List[Dict[str, Any]]:
        resp = await self._req("GET", f"/rest/v1/{TABLE}?user_id=eq.{urllib.parse.quote(user_id)}&select=id,user_id", headers=self._headers(None))
        if resp.status_code != 200:
            self._raise(resp, "user imports")
        return resp.json()

    async def hard_delete(self, import_id: str) -> None:
        resp = await self._req("DELETE", f"/rest/v1/{TABLE}?id=eq.{urllib.parse.quote(import_id)}", headers=self._headers(None))
        if resp.status_code not in (200, 204):
            self._raise(resp, "delete")

    # objects ---------------------------------------------------------------------------------
    async def _ensure_bucket(self) -> None:
        if self._bucket_ready:
            return
        body = {
            "id": self.bucket, "name": self.bucket, "public": False,
            "file_size_limit": self.max_file_mb * 1024 * 1024,
        }
        resp = await self._req("POST", "/storage/v1/bucket", headers=self._headers(), json=body)
        if resp.status_code not in (200, 201, 409) and "already exists" not in resp.text.lower() and (
                "413" in resp.text or "EntityTooLarge" in resp.text or "maximum allowed size" in resp.text):
            # The requested per-bucket limit exceeds the project's global upload cap (50 MB on the free
            # plan). Create the bucket without its own limit; the global cap still applies.
            logger.warning(f"[book_import] bucket limit {self.max_file_mb} MB exceeds the project's global "
                           f"upload cap; creating {self.bucket} without a per-bucket limit")
            body.pop("file_size_limit", None)
            resp = await self._req("POST", "/storage/v1/bucket", headers=self._headers(), json=body)
        if resp.status_code in (200, 201) or resp.status_code == 409 or "already exists" in resp.text.lower():
            self._bucket_ready = True
            return
        # Not marked ready: the next storage call retries creation instead of failing on a missing bucket.
        logger.warning(f"[book_import] could not create bucket {self.bucket}: HTTP {resp.status_code} {resp.text[:200]}")

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await self._ensure_bucket()
        resp = await self._req(
            "POST", f"/storage/v1/object/{self.bucket}/{urllib.parse.quote(key)}",
            headers=self._headers(content_type, **{"x-upsert": "true", "cache-control": "no-cache"}), content=data,
        )
        if resp.status_code not in (200, 201):
            raise StoreError(f"put {key}: HTTP {resp.status_code} {resp.text[:200]}")

    async def get_bytes(self, key: str) -> Optional[bytes]:
        resp = await self._req("GET", f"/storage/v1/object/{self.bucket}/{urllib.parse.quote(key)}", headers=self._headers(None))
        if resp.status_code in (400, 404):
            return None
        if resp.status_code != 200:
            raise StoreError(f"get {key}: HTTP {resp.status_code}")
        return resp.content

    async def download_to(self, key: str, dest: Path) -> bool:
        from services.http_clients import shared_async_client

        url = f"{self.url}/storage/v1/object/{self.bucket}/{urllib.parse.quote(key)}"
        tmp = dest.with_name(dest.name + ".part")
        async with shared_async_client("book-import-supabase", timeout=httpx.Timeout(300.0, connect=10.0)) as client:
            async with client.stream("GET", url, headers=self._headers(None)) as resp:
                if resp.status_code in (400, 404):
                    return False
                if resp.status_code != 200:
                    raise StoreError(f"get {key}: HTTP {resp.status_code}")
                with open(tmp, "wb") as fh:
                    async for chunk in resp.aiter_bytes(1 << 20):
                        fh.write(chunk)
        os.replace(tmp, dest)
        return True

    async def _list_level(self, prefix: str) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        offset = 0
        while True:
            resp = await self._req(
                "POST", f"/storage/v1/object/list/{self.bucket}", headers=self._headers(),
                json={"prefix": prefix, "limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
            )
            if resp.status_code != 200:
                if resp.status_code in (400, 404):
                    return out
                raise StoreError(f"list {prefix}: HTTP {resp.status_code}")
            items = resp.json() or []
            out.extend(items)
            if len(items) < 1000:
                return out
            offset += 1000

    async def size_of(self, key: str) -> Optional[int]:
        parent, _, name = key.rpartition("/")
        for it in await self._list_level(parent):
            if it.get("name") == name and it.get("id"):
                return int(((it.get("metadata") or {}).get("size")) or 0)
        return None

    async def list_keys(self, prefix: str) -> List[str]:
        keys: List[str] = []
        stack = [prefix.rstrip("/")]
        while stack:
            cur = stack.pop()
            for it in await self._list_level(cur):
                full = f"{cur}/{it['name']}" if cur else it["name"]
                if it.get("id"):
                    keys.append(full)
                else:
                    stack.append(full)
        return sorted(keys)

    async def delete_prefix(self, prefix: str) -> int:
        keys = await self.list_keys(prefix)
        for i in range(0, len(keys), 900):
            batch = keys[i:i + 900]
            resp = await self._req("DELETE", f"/storage/v1/object/{self.bucket}", headers=self._headers(), json={"prefixes": batch})
            if resp.status_code not in (200, 204):
                raise StoreError(f"delete: HTTP {resp.status_code} {resp.text[:200]}")
        return len(keys)

    async def upload_target(self, key: str, content_type: str, max_bytes: int, ttl: int) -> Dict[str, Any]:
        await self._ensure_bucket()
        resp = await self._req("POST", f"/storage/v1/object/upload/sign/{self.bucket}/{urllib.parse.quote(key)}", headers=self._headers(), json={})
        if resp.status_code != 200:
            raise StoreError(f"upload sign: HTTP {resp.status_code} {resp.text[:200]}")
        rel = (resp.json() or {}).get("url") or ""
        return {
            "method": "PUT",
            "url": f"{self.url}/storage/v1{rel}",
            "headers": {"content-type": content_type, "x-upsert": "true"},
            "auth": "none",
            "expiresAt": int(time.time()) + 7200,  # Supabase signed upload URLs last 2 hours
        }

    async def signed_urls(self, keys: Iterable[str], ttl: int) -> Dict[str, str]:
        keys = [k for k in keys if k]
        out: Dict[str, str] = {}
        for i in range(0, len(keys), 500):
            batch = keys[i:i + 500]
            resp = await self._req("POST", f"/storage/v1/object/sign/{self.bucket}", headers=self._headers(), json={"expiresIn": ttl, "paths": batch})
            if resp.status_code != 200:
                raise StoreError(f"sign: HTTP {resp.status_code} {resp.text[:200]}")
            for item in resp.json() or []:
                rel = item.get("signedURL") or item.get("signedUrl")
                if rel and item.get("path"):
                    out[item["path"]] = f"{self.url}/storage/v1{rel}"
        return out


# ============================================================================================ factory

_STORE: Optional[BookImportStore] = None


def build_store(backend: str, bucket: str, max_file_mb: int) -> BookImportStore:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if backend == "local" or (backend == "auto" and not (url and key)):
        return LocalStore()
    if not (url and key):
        raise StoreUnavailable("not_configured")
    return SupabaseStore(url, key, bucket, max_file_mb)


def get_store() -> BookImportStore:
    global _STORE
    if _STORE is None:
        from .config import get_config

        cfg = get_config()
        _STORE = build_store(cfg.storage_backend, cfg.bucket, cfg.max_file_mb)
    return _STORE


def set_store_for_tests(store: Optional[BookImportStore]) -> None:
    global _STORE
    _STORE = store
