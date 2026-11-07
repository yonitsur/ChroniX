"""
Cost of one AI-first photo import, logged once as totals.

The import is driven by the client as several requests (photo drafts in batches, then the story
pass, then the overview), so no single request knows what the whole timeline cost. The client
sends the same `import_run_id` with each of them; each request's cost is added here silently (its
own per-call cost box goes to DEBUG, see gemini_service.QUIET_USAGE_LOGS). When the import ends
the client asks for the summary: one block with the total of each major stage and the grand total.
A run the client never closes (tab closed, network lost) is logged as incomplete when it expires.

In-process only (best effort, logging only): a run whose requests land on different workers is
totalled per worker.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_RUN_TTL_SECONDS = 3600.0
_MAX_RUNS = 2000
_STAGE_LABELS = {
    "photo_drafts": "Photo analysis (moments)",
    "photo_story": "Story pass (title, chapters)",
    "story_overview": "Overview",
}

_lock = threading.Lock()
_runs: Dict[Tuple[str, str], Dict[str, Any]] = {}


def _key(run_id: Optional[str], user: Optional[Dict[str, Any]]) -> Optional[Tuple[str, str]]:
    run_id = (run_id or "").strip()[:64]
    if not run_id:
        return None
    return (str((user or {}).get("id") or "anon"), run_id)


def _prune_locked(now: float) -> List[Tuple[Tuple[str, str], Dict[str, Any]]]:
    """Removes expired (and, past the cap, the oldest) runs; returns them for logging."""
    gone = [(k, r) for k, r in _runs.items() if now - r["touched"] > _RUN_TTL_SECONDS]
    for k, _ in gone:
        _runs.pop(k, None)
    if len(_runs) > _MAX_RUNS:
        oldest = sorted(_runs.items(), key=lambda kv: kv[1]["touched"])[: len(_runs) - _MAX_RUNS]
        for k, r in oldest:
            _runs.pop(k, None)
            gone.append((k, r))
    return gone


def _log_summary(key: Tuple[str, str], run: Dict[str, Any], *, complete: bool) -> Dict[str, Any]:
    user_id, run_id = key
    total = float(run["total"])
    steps = run["steps"]
    order = [s for s in _STAGE_LABELS if s in steps] + [s for s in steps if s not in _STAGE_LABELS]
    lines = [
        "",
        "=" * 78,
        f"[PHOTO IMPORT TOTAL COST] run={run_id} user={user_id}" + ("" if complete else " (incomplete: run expired)"),
        f"Duration:         {run['touched'] - run['started']:.0f}s",
        "-" * 78,
        f"{'Stage':<32} {'Calls':>7} {'Events':>8} {'Cost (USD)':>14}",
        "-" * 78,
    ]
    for s in order:
        st = steps[s]
        lines.append(f"{_STAGE_LABELS.get(s, s):<32} {st['calls']:>7} {st['events']:>8} {st['cost']:>14.6f}")
    lines += [
        "-" * 78,
        f"TOTAL COST OF THIS TIMELINE: ${total:.6f} USD (~{total * 100:.3f} cents) over {run['calls']} call(s)",
        "=" * 78,
    ]
    logger.info("\n".join(lines))
    return {"total": total, "calls": run["calls"], "steps": {k: dict(v) for k, v in steps.items()}}


def record_photo_import_cost(
    run_id: Optional[str],
    user: Optional[Dict[str, Any]],
    step: str,
    cost_usd: float,
    *,
    events: Optional[int] = None,
) -> None:
    """Adds one request's cost to its run (nothing is logged here)."""
    key = _key(run_id, user)
    if key is None:
        return
    now = time.time()
    with _lock:
        expired = _prune_locked(now)
        run = _runs.setdefault(key, {"started": now, "touched": now, "total": 0.0, "calls": 0, "steps": {}})
        run["touched"] = now
        cost = max(0.0, float(cost_usd or 0.0))
        run["total"] += cost
        run["calls"] += 1
        st = run["steps"].setdefault(step, {"calls": 0, "events": 0, "cost": 0.0})
        st["calls"] += 1
        st["events"] += int(events or 0)
        st["cost"] += cost
    for k, r in expired:
        _log_summary(k, r, complete=False)


def log_photo_import_summary(run_id: Optional[str], user: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Logs the run's per-stage totals and grand total, then forgets the run. None if unknown."""
    key = _key(run_id, user)
    if key is None:
        return None
    with _lock:
        run = _runs.pop(key, None)
    if run is None:
        return None
    return _log_summary(key, run, complete=True)
