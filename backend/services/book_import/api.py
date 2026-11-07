"""HTTP routes for book imports. Mounted by main.py with `build_router(deps)`; everything app-specific
(auth dependency, rate limiters, role checks, hosted-photo quota) comes in through `ApiDeps`, so the
package doesn't import main.py."""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import draft_ops
from .config import BookImportConfig, get_config
from .pipeline import SOURCE_EXT, source_key
from .runner import BookImportRunner
from .sources.safety import ACCEPT_EXTENSIONS, ACCEPTED_MIMES, declared_kind, sniff_kind
from .store import (
    ACTIVE_STATUSES, BookImportStore, NotFound, StaleDraft, StoreError, StoreUnavailable, import_prefix, iso,
    new_row, utcnow, verify_local, LocalStore,
)

logger = logging.getLogger("ChroniXBookImport")

TERMINAL = ("completed", "failed", "cancelled", "expired")
STAGE_ORDER = ("parse", "read", "map", "extract", "fast_extract", "reconcile", "finalize")


class FileDecl(BaseModel):
    clientId: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    size: int = Field(..., ge=1)
    mime: str = Field(default="", max_length=120)


class CreateRequest(BaseModel):
    files: List[FileDecl] = Field(default_factory=list, max_length=5000)
    pastedText: Optional[str] = Field(default=None, max_length=200_000)
    instructions: Optional[str] = Field(default=None, max_length=10_000)
    outputLanguage: Optional[str] = Field(default="auto", max_length=12)


class OpsRequest(BaseModel):
    baseRev: int = Field(..., ge=0)
    ops: List[Dict[str, Any]] = Field(..., max_length=draft_ops.MAX_OPS)


class FinalizeRequest(BaseModel):
    baseRev: int = Field(..., ge=0)
    illustrativeImages: bool = False


@dataclass
class ApiDeps:
    current_user: Callable[..., Any]                      # FastAPI dependency -> user dict
    is_admin: Callable[[Dict[str, Any]], bool]
    is_guest: Callable[[Dict[str, Any]], bool]
    key_verified: Callable[[Optional[str]], bool]
    verify_key: Callable[[str], Awaitable[bool]]          # one tiny call; True when the key works
    photo_quota_remaining: Callable[[Dict[str, Any]], Awaitable[Optional[int]]]
    store: Callable[[], BookImportStore]
    runner: Callable[[], Optional[BookImportRunner]]
    rate_create: Optional[Callable[..., Any]] = None
    rate_poll: Optional[Callable[..., Any]] = None
    rate_ops: Optional[Callable[..., Any]] = None
    config: Callable[[], BookImportConfig] = get_config


def _noop_dep():
    return None


def _snapshot(user: Dict[str, Any], admin: bool) -> Dict[str, Any]:
    meta = dict(user.get("app_metadata") or {})
    if admin:
        meta.setdefault("role", meta.get("role") or "admin")
    return {"id": user.get("id"), "email": user.get("email"), "is_anonymous": False, "app_metadata": meta}


def _clean_lang(value: Optional[str]) -> str:
    v = (value or "auto").strip().lower()
    return v if v == "auto" or (v.replace("-", "").isalpha() and len(v) <= 8) else "auto"


def status_payload(row: Dict[str, Any], runner: Optional[BookImportRunner]) -> Dict[str, Any]:
    progress = dict(row.get("progress") or {})
    live = runner.live_progress(row["id"]) if runner is not None else None
    stages_progress = (live or {}).get("stages") or progress.get("stages") or {}
    done_stages = row.get("stages") or {}
    lane = row.get("lane") or "full"
    if row.get("status") in ("finalizing", "completed") or "finalize" in done_stages:
        plan = ["finalize"]
    else:
        plan = ["parse", "read", "fast_extract", "reconcile"] if lane == "fast" else ["parse", "read", "map", "extract", "reconcile"]
    stages = []
    for key in plan:
        p = stages_progress.get(key) or {}
        status = "done" if (done_stages.get(key) or {}).get("status") == "done" else (
            "active" if (live or {}).get("stage") == key or row.get("stage") == key else "pending")
        stages.append({"key": key, "status": status, "done": int(p.get("done") or 0), "total": int(p.get("total") or 0)})
    draft = row.get("draft") or {}
    keyed = runner.keys.has(row["id"]) if runner is not None else False
    return {
        "id": row["id"],
        "status": row.get("status"),
        "pausedReason": row.get("paused_reason"),
        "stage": (live or {}).get("stage") or row.get("stage"),
        "lane": lane,
        "stages": stages,
        "counts": {"units": progress.get("units"), "photos": progress.get("photos"), "events": (draft.get("stats") or {}).get("events")},
        "draftRev": row.get("draft_rev") or 0,
        "timelineId": row.get("timeline_id"),
        "error": row.get("error"),
        "keyTier": row.get("key_tier"),
        "keyHeld": keyed,
        "sources": [
            {"id": s.get("id"), "name": s.get("name"), "size": s.get("size"), "kind": s.get("kind"), "uploaded": bool(s.get("uploaded"))}
            for s in row.get("sources") or [] if not s.get("pasted")
        ],
        "title": draft.get("title") or next((s.get("name") for s in row.get("sources") or [] if s.get("name")), None),
        "usage": {
            "costUsd": (row.get("usage") or {}).get("costUsd"),
            "calls": (row.get("usage") or {}).get("calls"),
            "byStage": (row.get("usage") or {}).get("byStage") or {},
        },
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
        "expiresAt": row.get("expires_at"),
    }


def build_router(deps: ApiDeps) -> APIRouter:
    router = APIRouter()
    rate_create = deps.rate_create or _noop_dep
    rate_poll = deps.rate_poll or _noop_dep
    rate_ops = deps.rate_ops or _noop_dep

    def cfg() -> BookImportConfig:
        return deps.config()

    async def store_or_503() -> BookImportStore:
        c = cfg()
        if not c.enabled:
            raise HTTPException(status_code=404, detail="Not found.")
        store = deps.store()
        try:
            await store.check()
        except StoreUnavailable as e:
            raise HTTPException(status_code=503, detail={"code": e.reason, "message": "Book import storage isn't set up yet."})
        return store

    def entitlement(user: Dict[str, Any], api_key: Optional[str]) -> Dict[str, Any]:
        c = cfg()
        if deps.is_guest(user):
            return {"entitled": False, "reason": "sign_in", "keyTier": None}
        if deps.is_admin(user):
            return {"entitled": True, "reason": None, "keyTier": "admin_paid"}
        if c.access == "admin_byok" and api_key:
            return {"entitled": True, "reason": None if deps.key_verified(api_key) else "verify_key", "keyTier": "custom"}
        return {"entitled": False, "reason": "needs_key" if c.access == "admin_byok" else "admin_only", "keyTier": None}

    async def owned(store: BookImportStore, import_id: str, user: Dict[str, Any], *, with_draft: bool = False) -> Dict[str, Any]:
        try:
            uuid.UUID(import_id)
        except ValueError:
            raise HTTPException(status_code=404, detail="Import not found.")
        row = await store.get(import_id, with_draft=with_draft)
        if row is None or row.get("deleted_at") or (row.get("user_id") != user.get("id") and not deps.is_admin(user)):
            raise HTTPException(status_code=404, detail="Import not found.")
        return row

    # ------------------------------------------------------------------ limits / list
    @router.get("/api/book-imports/limits")
    async def limits(
        user: Dict[str, Any] = Depends(deps.current_user),
        x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    ):
        c = cfg()
        if not c.enabled:
            return {"enabled": False}
        try:
            store = deps.store()
            await store.check()
        except StoreUnavailable as e:
            return {"enabled": False, "reason": e.reason}
        ent = entitlement(user, x_gemini_api_key)
        active = []
        if not deps.is_guest(user):
            rows = await store.list_user(user["id"], limit=10)
            active = [status_payload(r, deps.runner()) for r in rows if r.get("status") not in TERMINAL]
        return {
            "enabled": True, **ent,
            "maxFiles": c.max_files, "maxFileBytes": c.max_file_mb * 1024 * 1024, "maxTotalBytes": c.max_total_mb * 1024 * 1024,
            "maxUnits": c.max_units, "pasteMaxChars": c.max_pasted_chars, "instructionsMaxChars": c.max_instructions_chars,
            "accept": sorted(set(ACCEPTED_MIMES)) + list(ACCEPT_EXTENSIONS), "active": active,
        }

    @router.get("/api/book-imports", dependencies=[Depends(rate_poll)])
    async def list_imports(user: Dict[str, Any] = Depends(deps.current_user)):
        store = await store_or_503()
        rows = await store.list_user(user["id"], limit=20)
        return {"imports": [status_payload(r, deps.runner()) for r in rows]}

    # ------------------------------------------------------------------ create / upload / start
    @router.post("/api/book-imports", dependencies=[Depends(rate_create)])
    async def create_import(
        body: CreateRequest,
        user: Dict[str, Any] = Depends(deps.current_user),
        x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    ):
        c = cfg()
        store = await store_or_503()
        ent = entitlement(user, x_gemini_api_key)
        if not ent["entitled"]:
            raise HTTPException(status_code=403, detail={"code": ent["reason"], "message": "Book import isn't available on this account."})
        if ent["reason"] == "verify_key":
            if not await deps.verify_key(x_gemini_api_key or ""):
                raise HTTPException(status_code=400, detail={"code": "invalid_key", "message": "Your Gemini key didn't work."})
        files = body.files
        pasted = (body.pastedText or "").strip()
        if not files and not pasted:
            raise HTTPException(status_code=400, detail={"code": "empty", "message": "Add files or paste text."})
        if len(files) > c.max_files:
            raise HTTPException(status_code=400, detail={"code": "too_many_files", "message": f"At most {c.max_files} files."})
        total = 0
        sources: List[Dict[str, Any]] = []
        for n, f in enumerate(files):
            kind = declared_kind(f.mime, f.name)
            if kind is None:
                raise HTTPException(status_code=400, detail={"code": "bad_type", "message": f"{f.name}: unsupported file type."})
            if f.size > c.max_file_mb * 1024 * 1024:
                raise HTTPException(status_code=413, detail={"code": "file_too_large", "message": f"{f.name} is larger than {c.max_file_mb} MB."})
            total += f.size
            sources.append({"id": f"s{n:04d}", "clientId": f.clientId, "name": f.name[:255], "size": f.size,
                            "mime": f.mime or "", "kind": kind, "order": n, "uploaded": False})
        if total > c.max_total_mb * 1024 * 1024:
            raise HTTPException(status_code=413, detail={"code": "total_too_large", "message": f"The upload is larger than {c.max_total_mb} MB."})
        rows = await store.list_user(user["id"], limit=20)
        active = [r for r in rows if r.get("status") in ACTIVE_STATUSES and r.get("status") != "review"]
        if len(active) >= c.max_active_per_user:
            raise HTTPException(status_code=409, detail={"code": "import_in_progress", "message": "Another import is still running.", "importId": active[0]["id"]})
        if pasted:
            sources.append({"id": f"s{len(sources):04d}", "clientId": "pasted", "name": "", "size": len(pasted.encode("utf-8")),
                            "mime": "text/plain", "kind": "text", "order": len(sources), "uploaded": True, "pasted": True})
        row = new_row(
            user["id"], key_tier=ent["keyTier"], user_snapshot=_snapshot(user, ent["keyTier"] == "admin_paid"),
            instructions=(body.instructions or "").strip()[: c.max_instructions_chars] or None,
            output_language=_clean_lang(body.outputLanguage), sources=sources, ttl_days=c.ttl_days,
        )
        prefix = import_prefix(user["id"], row["id"])
        if pasted:
            await store.put(source_key(prefix, sources[-1]), pasted.encode("utf-8"), "text/plain; charset=utf-8")
        row = await store.insert(row)
        runner = deps.runner()
        if runner is not None and x_gemini_api_key and ent["keyTier"] == "custom":
            runner.keys.put(row["id"], x_gemini_api_key)
        uploads = []
        try:
            for s in sources:
                if s.get("pasted"):
                    continue
                target = await store.upload_target(source_key(prefix, s), s["mime"] or "application/octet-stream", s["size"], 7200)
                uploads.append({"clientId": s["clientId"], "sourceId": s["id"], **target})
        except StoreError as e:
            # Don't leave an `awaiting_upload` row behind: it would block the retry with a 409.
            logger.error(f"[book_import] upload signing failed for {row['id']}: {e}")
            if runner is not None:
                runner.keys.drop(row["id"])
            try:
                await store.update(row["id"], {"status": "failed", "deleted_at": iso(utcnow()),
                                                "error": {"code": "upload_sign_failed", "message": str(e)[:300]}})
                await store.delete_prefix(prefix)
            except StoreError:
                pass
            raise HTTPException(status_code=503, detail={"code": "storage_error", "message": "Couldn't prepare the upload. Please try again."})
        if not uploads:
            row = await _start(store, row, user, x_gemini_api_key)
        return {"import": status_payload(row, runner), "uploads": uploads}

    @router.post("/api/book-imports/{import_id}/uploads/refresh")
    async def refresh_uploads(import_id: str, user: Dict[str, Any] = Depends(deps.current_user)):
        store = await store_or_503()
        row = await owned(store, import_id, user)
        if row.get("status") != "awaiting_upload":
            raise HTTPException(status_code=409, detail={"code": "not_uploading", "message": "Uploads are closed for this import."})
        prefix = import_prefix(row["user_id"], row["id"])
        uploads = []
        for s in row.get("sources") or []:
            if s.get("pasted"):
                continue
            size = await store.size_of(source_key(prefix, s))
            if size is not None and size == s["size"]:
                continue
            target = await store.upload_target(source_key(prefix, s), s["mime"] or "application/octet-stream", s["size"], 7200)
            uploads.append({"clientId": s["clientId"], "sourceId": s["id"], **target})
        return {"uploads": uploads}

    async def _start(store: BookImportStore, row: Dict[str, Any], user: Dict[str, Any], api_key: Optional[str]) -> Dict[str, Any]:
        prefix = import_prefix(row["user_id"], row["id"])
        missing = []
        sources = []
        for s in row.get("sources") or []:
            s = dict(s)
            key = source_key(prefix, s)
            size = await store.size_of(key)
            if size is None or (not s.get("pasted") and size != s["size"]):
                missing.append(s.get("name") or s["id"])
            else:
                head = (await store.get_bytes(key) or b"")[:4096] if s["kind"] != "text" else b""
                if s["kind"] != "text":
                    sniffed = sniff_kind(head)
                    if sniffed != s["kind"]:
                        raise HTTPException(status_code=400, detail={"code": "bad_file", "message": f"{s.get('name')} isn't a valid {s['kind']} file."})
                s["uploaded"] = True
            sources.append(s)
        if missing:
            raise HTTPException(status_code=409, detail={"code": "uploads_missing", "message": "Some files haven't finished uploading.", "missing": missing[:20]})
        row = await store.update(row["id"], {"status": "queued", "sources": sources, "not_before": None})
        runner = deps.runner()
        if runner is not None:
            if api_key and row.get("key_tier") == "custom":
                runner.keys.put(row["id"], api_key)
            runner.wake()
        return row

    @router.post("/api/book-imports/{import_id}/start")
    async def start_import(
        import_id: str,
        user: Dict[str, Any] = Depends(deps.current_user),
        x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    ):
        store = await store_or_503()
        row = await owned(store, import_id, user)
        if row.get("status") != "awaiting_upload":
            return {"import": status_payload(row, deps.runner())}
        row = await _start(store, row, user, x_gemini_api_key)
        return {"import": status_payload(row, deps.runner())}

    # ------------------------------------------------------------------ status / control
    @router.get("/api/book-imports/{import_id}", dependencies=[Depends(rate_poll)])
    async def get_import(import_id: str, user: Dict[str, Any] = Depends(deps.current_user)):
        store = await store_or_503()
        row = await owned(store, import_id, user, with_draft=False)
        payload = status_payload(row, deps.runner())
        runner = deps.runner()
        if row.get("status") == "paused" and row.get("paused_reason") == "needs_key" and runner is not None and runner.keys.has(row["id"]):
            payload["pausedReason"] = "resuming"
        return {"import": payload}

    @router.post("/api/book-imports/{import_id}/resume")
    async def resume_import(
        import_id: str,
        user: Dict[str, Any] = Depends(deps.current_user),
        x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    ):
        store = await store_or_503()
        row = await owned(store, import_id, user)
        if row.get("status") not in ("paused", "failed", "queued", "running"):
            return {"import": status_payload(row, deps.runner())}
        runner = deps.runner()
        if row.get("key_tier") == "custom":
            if not x_gemini_api_key:
                raise HTTPException(status_code=400, detail={"code": "needs_key", "message": "Your Gemini key is needed to continue."})
            if runner is not None:
                runner.keys.put(row["id"], x_gemini_api_key)
        if row.get("status") in ("paused", "failed"):
            retryable = row.get("status") == "paused" or ((row.get("error") or {}).get("code") in ("stage_failed", "retrying"))
            if not retryable:
                raise HTTPException(status_code=409, detail={"code": "not_resumable", "message": "This import can't be resumed."})
            row = await store.update(row["id"], {"status": "queued", "paused_reason": None, "attempts": 0, "not_before": None})
        if runner is not None:
            runner.wake()
        return {"import": status_payload(row, runner)}

    @router.post("/api/book-imports/{import_id}/cancel")
    async def cancel_import(import_id: str, user: Dict[str, Any] = Depends(deps.current_user)):
        store = await store_or_503()
        row = await owned(store, import_id, user)
        if row.get("status") in TERMINAL:
            return {"import": status_payload(row, deps.runner())}
        row = await store.update(row["id"], {"status": "cancelled"})
        runner = deps.runner()
        if runner is not None:
            runner.request_cancel(row["id"])
            runner.keys.drop(row["id"])
        if not (runner and runner.is_running(row["id"])):
            try:
                await store.delete_prefix(import_prefix(row["user_id"], row["id"]))
            except StoreError:
                pass
        return {"import": status_payload(row, runner)}

    @router.delete("/api/book-imports/{import_id}")
    async def delete_import(import_id: str, user: Dict[str, Any] = Depends(deps.current_user)):
        store = await store_or_503()
        row = await owned(store, import_id, user)
        runner = deps.runner()
        if runner is not None:
            runner.request_cancel(row["id"])
            runner.keys.drop(row["id"])
        await store.update(row["id"], {"status": "cancelled" if row.get("status") not in TERMINAL else row["status"],
                                        "deleted_at": iso(utcnow()), "draft": None})
        try:
            await store.delete_prefix(import_prefix(row["user_id"], row["id"]))
        except StoreError:
            pass
        return Response(status_code=204)

    # ------------------------------------------------------------------ draft / review
    async def _assets(store: BookImportStore, row: Dict[str, Any], draft: Dict[str, Any]) -> Dict[str, Any]:
        prefix = import_prefix(row["user_id"], row["id"])
        keys = []
        for p in draft.get("photos") or []:
            keys += [f"{prefix}/photos/{p['id']}.thumb.webp", f"{prefix}/photos/{p['id']}.webp"]
        for u in draft.get("units") or []:
            keys += [f"{prefix}/units/{u['index']:04d}.thumb.webp"]
        ttl = cfg().signed_url_ttl
        urls = await store.signed_urls(keys, ttl)
        photos = {}
        for p in draft.get("photos") or []:
            photos[p["id"]] = {"thumb": urls.get(f"{prefix}/photos/{p['id']}.thumb.webp"), "full": urls.get(f"{prefix}/photos/{p['id']}.webp")}
        units = {str(u["index"]): urls.get(f"{prefix}/units/{u['index']:04d}.thumb.webp") for u in draft.get("units") or []}
        return {"photos": photos, "units": units, "expiresIn": ttl}

    @router.get("/api/book-imports/{import_id}/draft", dependencies=[Depends(rate_poll)])
    async def get_draft(import_id: str, user: Dict[str, Any] = Depends(deps.current_user)):
        store = await store_or_503()
        row = await owned(store, import_id, user, with_draft=True)
        draft = row.get("draft")
        if not draft:
            raise HTTPException(status_code=409, detail={"code": "no_draft", "message": "The draft isn't ready yet."})
        return {"rev": row.get("draft_rev") or 0, "draft": draft, "assets": await _assets(store, row, draft), "status": row.get("status")}

    @router.post("/api/book-imports/{import_id}/draft/ops", dependencies=[Depends(rate_ops)])
    async def post_ops(import_id: str, body: OpsRequest, user: Dict[str, Any] = Depends(deps.current_user)):
        store = await store_or_503()
        row = await owned(store, import_id, user, with_draft=True)
        if row.get("status") != "review":
            raise HTTPException(status_code=409, detail={"code": "not_in_review", "message": "This draft can't be edited now."})
        if int(row.get("draft_rev") or 0) != body.baseRev:
            raise HTTPException(status_code=409, detail={"code": "stale_draft", "rev": int(row.get("draft_rev") or 0)})
        try:
            new_draft = draft_ops.apply_ops(row.get("draft") or {}, body.ops)
        except draft_ops.OpError as e:
            raise HTTPException(status_code=400, detail={"code": "bad_op", "message": str(e)})
        try:
            rev = await store.update_draft(row["id"], body.baseRev, new_draft)
        except StaleDraft as e:
            raise HTTPException(status_code=409, detail={"code": "stale_draft", "rev": e.rev})
        return {"rev": rev}

    @router.get("/api/book-imports/{import_id}/units/{index}", dependencies=[Depends(rate_poll)])
    async def get_unit(import_id: str, index: int, user: Dict[str, Any] = Depends(deps.current_user)):
        store = await store_or_503()
        row = await owned(store, import_id, user)
        prefix = import_prefix(row["user_id"], row["id"])
        data = await store.get_json(f"{prefix}/read/{index:04d}.json")
        read = (data or {}).get("read") or {}
        urls = await store.signed_urls([f"{prefix}/units/{index:04d}.review.webp"], cfg().signed_url_ttl)
        if not read:
            units = await store.get_json(f"{prefix}/parse/units.json") or []
            unit = next((u for u in units if u.get("index") == index), None)
            if unit is None:
                raise HTTPException(status_code=404, detail="Unit not found.")
            read = {"blocks": [{"kind": "paragraph", "text": tb.get("text")} for tb in unit.get("text_blocks") or []]}
        return {
            "index": index,
            "reviewUrl": urls.get(f"{prefix}/units/{index:04d}.review.webp"),
            "pageType": read.get("page_type"),
            "printedPages": read.get("printed_page_numbers") or [],
            "blocks": [{"kind": b.get("kind"), "text": b.get("text")} for b in read.get("blocks") or []],
            "photos": [{"ref": p.get("ref"), "box2d": p.get("box_2d"), "kind": p.get("kind")} for p in read.get("photos") or []],
        }

    @router.get("/api/book-imports/{import_id}/usage", dependencies=[Depends(rate_poll)])
    async def get_usage(import_id: str, user: Dict[str, Any] = Depends(deps.current_user)):
        """What this import cost: totals, per stage (retries included) and one entry per model call
        (stage, label such as 'read u12' or 'extract c004', model, input/cached/output/thinking tokens,
        USD and where the price came from)."""
        store = await store_or_503()
        row = await owned(store, import_id, user)
        prefix = import_prefix(row["user_id"], row["id"])
        calls: List[Dict[str, Any]] = []
        for key in await store.list_keys(f"{prefix}/usage"):
            calls.extend(await store.get_json(key) or [])
        calls.sort(key=lambda c: c.get("at") or "")
        return {"importId": row["id"], "total": row.get("usage") or {}, "calls": calls}

    @router.post("/api/book-imports/{import_id}/finalize", status_code=202)
    async def finalize(import_id: str, body: FinalizeRequest, user: Dict[str, Any] = Depends(deps.current_user)):
        from .schemas.draft import BookDraft
        from .timeline_build import MAX_ARTICLES, _accepted, photos_to_promote

        store = await store_or_503()
        row = await owned(store, import_id, user, with_draft=True)
        if row.get("status") == "finalizing":
            return {"import": status_payload(row, deps.runner())}
        if row.get("status") != "review":
            raise HTTPException(status_code=409, detail={"code": "not_in_review", "message": "This import isn't ready to create."})
        if int(row.get("draft_rev") or 0) != body.baseRev:
            raise HTTPException(status_code=409, detail={"code": "stale_draft", "rev": int(row.get("draft_rev") or 0)})
        draft = BookDraft.model_validate(row.get("draft") or {})
        accepted = _accepted(draft)
        if not accepted:
            raise HTTPException(status_code=409, detail={"code": "no_events", "message": "Keep at least one dated event."})
        if len(accepted) > MAX_ARTICLES:
            raise HTTPException(status_code=409, detail={"code": "too_many_events", "message": f"At most {MAX_ARTICLES} events.", "count": len(accepted)})
        needed = len(photos_to_promote(draft))
        remaining = await deps.photo_quota_remaining(row.get("user_snapshot") or user)
        if remaining is not None and needed > remaining:
            raise HTTPException(status_code=409, detail={"code": "photo_quota", "needed": needed, "remaining": remaining,
                                                         "message": "Not enough photo storage for every photo."})
        draft_json = {**(row.get("draft") or {}), "illustrativeImages": bool(body.illustrativeImages)}
        row = await store.update(row["id"], {
            "status": "finalizing", "stage": "finalize", "error": None, "attempts": 0, "not_before": None, "draft": draft_json,
        })
        runner = deps.runner()
        if runner is not None:
            runner.wake()
        return {"import": status_payload(row, runner)}

    # ------------------------------------------------------------------ local storage backend only
    @router.put("/api/book-import-uploads/{key:path}")
    async def local_upload(key: str, request: Request, e: str = "", s: str = "", m: str = "0"):
        store = deps.store()
        if not isinstance(store, LocalStore) or not verify_local(key, e, s, f"put:{m}"):
            raise HTTPException(status_code=403, detail="Upload link is invalid or expired.")
        limit = int(m or 0)
        chunks = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                raise HTTPException(status_code=413, detail="File is larger than declared.")
            chunks.append(chunk)
        await store.put(key, b"".join(chunks), request.headers.get("content-type") or "application/octet-stream")
        return Response(status_code=200)

    @router.get("/api/book-import-files/{key:path}")
    async def local_file(key: str, e: str = "", s: str = ""):
        store = deps.store()
        if not isinstance(store, LocalStore) or not verify_local(key, e, s, "get"):
            raise HTTPException(status_code=403, detail="Link is invalid or expired.")
        data = await store.get_bytes(key)
        if data is None:
            raise HTTPException(status_code=404, detail="Not found.")
        ctype = "image/webp" if key.endswith(".webp") else "image/jpeg" if key.endswith(".jpg") else "application/octet-stream"
        return Response(content=data, media_type=ctype, headers={"Cache-Control": "private, max-age=3600"})

    return router


async def delete_owner_imports(store: BookImportStore, user_id: str) -> int:
    """Account deletion: every import row and object of a user."""
    n = 0
    for row in await store.user_ids_with_imports(user_id):
        try:
            await store.delete_prefix(import_prefix(user_id, row["id"]))
            await store.hard_delete(row["id"])
            n += 1
        except StoreError:
            logger.warning(f"[book_import] could not delete import {row['id']}", exc_info=True)
    return n
