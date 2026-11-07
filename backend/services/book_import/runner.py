"""In-process runner: claims queued imports through a fenced lease, runs their stages, renews the lease
while working and releases it on pause, failure, cancellation and shutdown.

Independent of the app's in-memory AI jobs (no 240 s deadline, no 15 min TTL); the same code can run
in a separate worker process because all state lives in the store.
"""

from __future__ import annotations

import asyncio
import logging
import os
import socket
import time
import uuid
from datetime import timedelta
from typing import Any, Callable, Dict, Optional

from .ai_calls import StageContext
from .config import BookImportConfig, get_config
from .gemini_calls import AimdLimiter, PauseImport, StageCallError, UsageMeter, call_structured
from .pipeline import STAGES, Host, ImportCancelled, ImportCtx, ImportFailed, import_prefix, plan_for
from .store import BookImportStore, LeaseLost, StoreError, StoreUnavailable, iso, utcnow

logger = logging.getLogger("ChroniXBookImport")

MAX_ATTEMPTS = 3


class KeyVault:
    """BYOK keys for running imports, in memory only (never persisted, never logged). After a restart a
    BYOK import pauses with `needs_key` until the client resumes it with the key header."""

    def __init__(self) -> None:
        self._keys: Dict[str, str] = {}

    def put(self, import_id: str, key: Optional[str]) -> None:
        if key:
            self._keys[import_id] = key

    def get(self, import_id: str) -> Optional[str]:
        return self._keys.get(import_id)

    def drop(self, import_id: str) -> None:
        self._keys.pop(import_id, None)

    def has(self, import_id: str) -> bool:
        return import_id in self._keys


class _Run:
    def __init__(self, ctx: ImportCtx):
        self.ctx = ctx
        self.task: Optional[asyncio.Task] = None
        self.lease_task: Optional[asyncio.Task] = None
        self.user_cancelled = False
        self.lease_lost = False
        self.stage: Optional[str] = None
        self.started = time.time()


class BookImportRunner:
    def __init__(
        self,
        store_getter: Callable[[], BookImportStore],
        host: Host,
        config_getter: Callable[[], BookImportConfig] = get_config,
        call=call_structured,
    ):
        self._store_getter = store_getter
        self.host = host
        self._config_getter = config_getter
        self.call = call
        self.owner = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"
        self.keys = KeyVault()
        self._runs: Dict[str, _Run] = {}
        self._wake = asyncio.Event()
        self._sweeper: Optional[asyncio.Task] = None
        self._stopping = False

    @property
    def store(self) -> BookImportStore:
        return self._store_getter()

    @property
    def config(self) -> BookImportConfig:
        return self._config_getter()

    # ------------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        cfg = self.config
        if not cfg.enabled or cfg.runner != "web" or self._sweeper is not None:
            return
        self._stopping = False
        self._wake = asyncio.Event()
        self._sweeper = asyncio.create_task(self._sweep_loop(), name="book-import-sweeper")
        logger.info(f"[book_import] runner started as {self.owner}")

    def wake(self) -> None:
        self._wake.set()

    async def shutdown(self, budget: float = 15.0) -> None:
        self._stopping = True
        if self._sweeper is not None:
            self._sweeper.cancel()
            try:
                await self._sweeper
            except (asyncio.CancelledError, Exception):
                pass
            self._sweeper = None
        runs = list(self._runs.values())
        for r in runs:
            if r.task is not None:
                r.task.cancel()
        tasks = [r.task for r in runs if r.task is not None]
        if tasks:
            await asyncio.wait(tasks, timeout=budget)
        for r in runs:
            try:
                await self.store.release(r.ctx.import_id, self.owner)
            except Exception:
                pass
        self._runs.clear()

    def is_running(self, import_id: str) -> bool:
        return import_id in self._runs

    def live_progress(self, import_id: str) -> Optional[Dict[str, Any]]:
        r = self._runs.get(import_id)
        if r is None:
            return None
        return {"stage": r.stage, "stages": {k: dict(v) for k, v in r.ctx.progress.items()}}

    def request_cancel(self, import_id: str) -> None:
        r = self._runs.get(import_id)
        if r is not None:
            r.user_cancelled = True
            r.ctx.cancel.set()

    # ------------------------------------------------------------------ sweeping
    async def _sweep_loop(self) -> None:
        while not self._stopping:
            try:
                await self.sweep_once()
            except StoreUnavailable as e:
                logger.info(f"[book_import] store unavailable ({e.reason}); sweeper idle")
            except Exception:
                logger.warning("[book_import] sweep failed", exc_info=True)
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=self.config.sweep_seconds)
            except asyncio.TimeoutError:
                pass
            self._wake.clear()

    async def sweep_once(self) -> None:
        cfg = self.config
        while len(self._runs) < cfg.max_active and not self._stopping:
            row = await self.store.claim(self.owner, cfg.lease_seconds, cfg.max_active)
            if not row:
                break
            if row["id"] in self._runs:
                continue
            self._spawn(row)
        await self._expire_some()

    def _spawn(self, row: Dict[str, Any]) -> _Run:
        ctx = self._make_ctx(row)
        run = _Run(ctx)
        self._runs[row["id"]] = run
        run.task = asyncio.create_task(self._run(run), name=f"book-import-{row['id'][:8]}")
        return run

    def _make_ctx(self, row: Dict[str, Any]) -> ImportCtx:
        cfg = self.config
        stage = StageContext(api_key=None, config=cfg, limiter=AimdLimiter(cfg.gemini_concurrency), meter=UsageMeter(), call=self.call)
        return ImportCtx(row=row, store=self.store, owner=self.owner, config=cfg, stage=stage, host=self.host)

    async def _expire_some(self) -> None:
        for row in await self.store.due_for_expiry(limit=5):
            if row["id"] in self._runs:
                continue
            try:
                await self.store.delete_prefix(import_prefix(row["user_id"], row["id"]))
                await self.store.update(row["id"], {"status": "expired", "deleted_at": iso(utcnow()), "draft": None})
            except Exception:
                logger.warning(f"[book_import] expiry of {row['id']} failed", exc_info=True)

    # ------------------------------------------------------------------ one import
    def _api_key_for(self, row: Dict[str, Any]) -> Optional[str]:
        if row.get("key_tier") == "custom":
            key = self.keys.get(row["id"])
            if not key:
                raise PauseImport("needs_key", "The personal Gemini key is needed to continue.")
            return key
        return self.config.gemini_api_key  # None -> the server's default key

    async def _lease_loop(self, run: _Run) -> None:
        cfg = self.config
        interval = max(2.0, cfg.lease_seconds / 3)
        while True:
            await asyncio.sleep(interval)
            try:
                status = await self.store.renew(run.ctx.import_id, self.owner, cfg.lease_seconds)
            except Exception:
                logger.warning("[book_import] lease renewal failed", exc_info=True)
                continue
            if status is None:
                run.lease_lost = True
                run.ctx.cancel.set()
                return
            if status == "cancelled":
                run.user_cancelled = True
                run.ctx.cancel.set()
                return
            try:
                await self.store.update(
                    run.ctx.import_id,
                    {"progress": {**(run.ctx.row.get("progress") or {}), "stage": run.stage, "stages": run.ctx.progress}},
                    owner=self.owner,
                )
            except LeaseLost:
                run.lease_lost = True
                run.ctx.cancel.set()
                return
            except Exception:
                pass

    @staticmethod
    def _uncount(run: _Run, row: Dict[str, Any]) -> int:
        """Gives back the attempt this run counted for its current stage (if it counted one)."""
        if getattr(run, "counted", False):
            run.counted = False
            row["attempts"] = max(0, int(row.get("attempts") or 0) - 1)
        return int(row.get("attempts") or 0)

    async def _set(self, run: _Run, patch: Dict[str, Any], *, release: bool = False) -> None:
        patch = dict(patch)
        if release:
            patch.update({"lease_owner": None, "lease_until": None})
        try:
            await self.store.update(run.ctx.import_id, patch, owner=self.owner)
        except LeaseLost:
            run.lease_lost = True

    async def _run(self, run: _Run) -> None:
        ctx = run.ctx
        row = ctx.row
        run.lease_task = asyncio.create_task(self._lease_loop(run))
        try:
            ctx.stage.api_key = self._api_key_for(row)
            await self._set(run, {"paused_reason": None, "error": None})
            while True:
                plan = plan_for(row)
                pending = [s for s in plan if (row.get("stages") or {}).get(s, {}).get("status") != "done"]
                if not pending:
                    break
                stage = pending[0]
                run.stage = stage
                # Counted BEFORE the stage runs: a process killed mid-stage (out of memory) never
                # reaches the except below, and without this the next claim retried it forever,
                # taking the whole API down on every restart. Reset to 0 when a stage completes.
                attempts = int(row.get("attempts") or 0) + 1
                if attempts > MAX_ATTEMPTS:
                    raise ImportFailed(
                        "stage_crashed",
                        f"Processing stopped unexpectedly {MAX_ATTEMPTS} times during the {stage} step "
                        "(the server likely ran out of memory), so the import was halted.",
                    )
                row["attempts"] = attempts
                run.counted = True
                await self._set(run, {"stage": stage, "attempts": attempts})
                await self._run_stage(run, stage)
                ctx.check()
            final = "completed" if plan == ("finalize",) else "review"
            if final == "review":
                self.keys.drop(row["id"])  # no model calls after reconcile
            log_import_cost_total(row, final)
            await self._set(run, {"status": final, "stage": None, "progress": {**(row.get("progress") or {}), "stage": None, "stages": ctx.progress}}, release=True)
        except PauseImport as p:
            logger.info(f"[book_import:{row['id']}] paused ({p.reason})")
            await self._set(run, {"status": "paused", "paused_reason": p.reason, "attempts": self._uncount(run, row), "error": {"code": p.reason, "message": p.detail[:300]}}, release=True)
        except ImportFailed as f:
            logger.info(f"[book_import:{row['id']}] failed: {f.code} {f.message}")
            self.keys.drop(row["id"])
            await self._set(run, {"status": "failed", "error": {"code": f.code, "message": f.message[:500]}}, release=True)
        except (ImportCancelled, asyncio.CancelledError) as e:
            if run.user_cancelled:
                self.keys.drop(row["id"])
                try:
                    await self.store.delete_prefix(import_prefix(row["user_id"], row["id"]))
                except Exception:
                    pass
                try:
                    await self.store.release(row["id"], self.owner)
                except Exception:
                    pass
            elif run.lease_lost:
                logger.warning(f"[book_import:{row['id']}] lease lost; another process continues")
            else:
                try:
                    # A graceful shutdown (deploy) is not the stage's fault: give the attempt back.
                    await self._set(run, {"attempts": self._uncount(run, row)})
                    await self.store.release(row["id"], self.owner)
                except Exception:
                    pass
                if isinstance(e, asyncio.CancelledError):
                    raise
        except LeaseLost:
            logger.warning(f"[book_import:{row['id']}] lease lost; another process continues")
        except Exception as e:  # retryable: model/storage trouble
            attempts = max(1, int(row.get("attempts") or 0))  # already counted when the stage started
            logger.warning(f"[book_import:{row['id']}] stage {run.stage} failed (attempt {attempts}): {e}", exc_info=not isinstance(e, (StageCallError, StoreError)))
            if attempts >= MAX_ATTEMPTS:
                self.keys.drop(row["id"])
                await self._set(run, {"status": "failed", "attempts": attempts, "error": {"code": "stage_failed", "message": str(e)[:500]}}, release=True)
            else:
                not_before = utcnow() + timedelta(minutes=2 ** attempts)
                await self._set(run, {"status": "queued", "attempts": attempts, "not_before": iso(not_before),
                                      "error": {"code": "retrying", "message": str(e)[:300]}}, release=True)
        finally:
            if run.lease_task is not None:
                run.lease_task.cancel()
            self._runs.pop(row["id"], None)
            if not self._stopping:
                self.wake()

    async def _record_spend(self, run: _Run, stage: str, meter: UsageMeter, secs: float) -> None:
        """Adds this stage attempt's calls to the import's call ledger (`usage/<stage>.json`, one entry
        per model call) and its totals to `row.usage` (overall and per stage, retries included)."""
        ctx = run.ctx
        row = ctx.row
        usage = dict(row.get("usage") or {})
        usage["costUsd"] = round(float(usage.get("costUsd") or 0) + meter.cost_usd, 6)
        usage["calls"] = int(usage.get("calls") or 0) + meter.calls
        for k, attr in (("inputTokens", "prompt_tokens"), ("cachedTokens", "cached_tokens"),
                        ("outputTokens", "candidates_tokens"), ("thinkingTokens", "thoughts_tokens")):
            usage[k] = int(usage.get(k) or 0) + int(getattr(meter, attr))
        per = dict(usage.get("byStage") or {})
        st = dict(per.get(stage) or {})
        st["costUsd"] = round(float(st.get("costUsd") or 0) + meter.cost_usd, 6)
        st["calls"] = int(st.get("calls") or 0) + meter.calls
        st["attempts"] = int(st.get("attempts") or 0) + 1
        per[stage] = st
        usage["byStage"] = per
        row["usage"] = usage
        logger.info(
            f"[book_import:cost] import={row['id']} stage={stage} calls={meter.calls} in={meter.prompt_tokens} "
            f"cached={meter.cached_tokens} out={meter.candidates_tokens} thinking={meter.thoughts_tokens} "
            f"usd={meter.cost_usd:.6f} secs={secs:.1f} | import total usd={usage['costUsd']:.6f}"
        )
        if not meter.entries:
            return
        try:
            key = f"{import_prefix(row['user_id'], row['id'])}/usage/{stage}.json"
            existing = await self.store.get_json(key) or []
            await self.store.put_json(key, list(existing) + meter.entries)
            await self.store.update(row["id"], {"usage": usage}, owner=self.owner)
        except Exception:
            logger.warning(f"[book_import:{row['id']}] could not save the call ledger for {stage}", exc_info=True)

    async def _run_stage(self, run: _Run, stage: str) -> None:
        from services.activity_log import record_token_usage, track_ai_activity

        ctx = run.ctx
        row = ctx.row
        meter = UsageMeter(stage=stage)
        ctx.stage.meter = meter
        started = time.time()
        user = row.get("user_snapshot") or {"id": row["user_id"]}
        async with track_ai_activity(
            "book_import", user, key_tier=row.get("key_tier"), details={"stage": stage, "import_id": row["id"]},
        ) as rec:
            try:
                await STAGES[stage](ctx)
            finally:
                if meter.calls:
                    record_token_usage({
                        "promptTokens": meter.prompt_tokens, "candidatesTokens": meter.candidates_tokens,
                        "thoughtsTokens": meter.thoughts_tokens, "cachedTokens": meter.cached_tokens,
                        "estimatedCostUsd": meter.cost_usd, "model": next(iter(meter.by_model), None),
                    })
                rec["details"]["calls"] = meter.calls
                # Spend is recorded even when the stage fails or pauses, so retries are never invisible.
                await self._record_spend(run, stage, meter, time.time() - started)
        stages = dict(row.get("stages") or {})
        stages[stage] = {"status": "done", "finishedAt": iso(utcnow()), "secs": round(time.time() - started, 1), "usage": meter.as_dict()}
        row["stages"] = stages
        row["attempts"] = 0
        run.counted = False
        await self.store.update(row["id"], {"stages": stages, "usage": row.get("usage") or {}, "attempts": 0}, owner=self.owner)
        cap = self.config.max_usd
        if cap is not None and float((row.get("usage") or {}).get("costUsd") or 0) > cap:
            raise PauseImport("retry_later", f"This import reached its cost guard (${cap:.2f}).")


def log_import_cost_total(row: Dict[str, Any], final: str) -> None:
    """Logs the import's total cost so far, per stage (retries included). At "review" every model
    call is done (finalize makes none), so this is the cost of creating the timeline; "completed"
    repeats it once the timeline is saved."""
    usage = row.get("usage") or {}
    total = float(usage.get("costUsd") or 0)
    lines = [
        "",
        "=" * 78,
        f"[BOOK IMPORT TOTAL COST] import={row.get('id')} status={final}"
        + (f" timeline={row.get('timeline_id')}" if row.get("timeline_id") else ""),
        "-" * 78,
        f"{'Stage':<16} {'Calls':>7} {'Attempts':>9} {'Cost (USD)':>14}",
        "-" * 78,
    ]
    for stage, st in (usage.get("byStage") or {}).items():
        lines.append(
            f"{stage:<16} {int(st.get('calls') or 0):>7} {int(st.get('attempts') or 0):>9} "
            f"{float(st.get('costUsd') or 0):>14.6f}"
        )
    lines += [
        "-" * 78,
        f"Tokens: in={int(usage.get('inputTokens') or 0):,} cached={int(usage.get('cachedTokens') or 0):,} "
        f"out={int(usage.get('outputTokens') or 0):,} thinking={int(usage.get('thinkingTokens') or 0):,}",
        f"TOTAL COST OF THIS TIMELINE: ${total:.6f} USD (~{total * 100:.3f} cents) "
        f"over {int(usage.get('calls') or 0)} model calls",
        "=" * 78,
    ]
    logger.info("\n".join(lines))


_RUNNER: Optional[BookImportRunner] = None


def get_runner() -> Optional[BookImportRunner]:
    return _RUNNER


def set_runner(runner: Optional[BookImportRunner]) -> None:
    global _RUNNER
    _RUNNER = runner
