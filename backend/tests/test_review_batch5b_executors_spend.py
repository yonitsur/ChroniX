"""Batch 5B / SC-08, SC-13: dedicated executors, the single-flight Library rebuild that serves stale
data, and one-round-trip spend metering (`record_ai_spend`) with an equivalent fallback."""
import asyncio
import contextvars
import logging
import re
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, List

import pytest

import main
from services import activity_log, executors, storage
from services import quota_service as qs
from tests._quota_store_fakes import FakeResponse, FakeUsageDB, install_fake_store

BACKEND_DIR = Path(__file__).resolve().parent.parent


# --- SC-08: executors -----------------------------------------------------------------------------

def test_each_runner_uses_its_own_pool_and_keeps_contextvars():
    var: contextvars.ContextVar = contextvars.ContextVar("batch5b_var", default=None)

    def probe():
        return threading.current_thread().name, var.get()

    async def run():
        var.set("request-scoped")
        return {
            kind: await getattr(executors, f"run_{kind}")(probe)
            for kind in ("quota", "storage", "bulk", "cpu")
        }

    results = asyncio.run(run())
    for kind, (thread_name, value) in results.items():
        assert thread_name.startswith(f"chronix-{kind}"), (kind, thread_name)
        assert value == "request-scoped"


def test_main_routes_blocking_calls_through_the_dedicated_pools(monkeypatch):
    source = (BACKEND_DIR / "main.py").read_text(encoding="utf-8")
    assert "asyncio.to_thread(" not in source
    assert re.search(r"run_quota\(\s*resolve_gemini_key", source)
    assert "run_cpu(photo_store.prepare_photo" in source
    assert "run_bulk(photo_store.put_photo" in source

    seen: Dict[str, str] = {}

    def fake_quota_info(*args, **kwargs):
        seen["quota"] = threading.current_thread().name
        return {"remaining": 1}

    monkeypatch.setattr(main, "get_user_quota_info", fake_quota_info)
    asyncio.run(main.run_quota(main.get_user_quota_info, {"id": "u"}))
    assert seen["quota"].startswith("chronix-quota")


def test_storage_and_quota_pools_have_matching_connection_limits():
    assert storage._SUPABASE_MAX_CONNECTIONS >= executors.STORAGE_WORKERS + executors.BULK_WORKERS
    assert storage.SUPABASE_TIMEOUT.pool is not None and storage.SUPABASE_TIMEOUT.pool < storage.SUPABASE_TIMEOUT.read
    assert activity_log._ACTIVITY_WORKERS == 4


# --- SC-08: Library rebuild -------------------------------------------------------------------------

class _BlockingLibraryDb:
    def __init__(self):
        self.index_calls = 0
        self.gate = threading.Event()

    def client(self):
        db = self

        class _Resp:
            def __init__(self, payload):
                self.status_code, self._payload, self.text = 200, payload, ""

            def json(self):
                return self._payload

        class _Client:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get(self, url, headers=None, params=None):
                params = params or {}
                if str(params.get("id", "")).startswith("in.("):
                    return _Resp([{"id": "lib-1", "title": "Lib", "description": "d", "updated_at": "u",
                                   "data": {"id": "lib-1", "title": "Lib", "isLibrary": True,
                                            "articles": [{"id": "e", "title": "E", "from": {"year": 1}}]}}])
                db.index_calls += 1
                db.gate.wait(5)
                return _Resp([{"id": "lib-1", "title": "Lib", "description": "d", "updated_at": "u"}])

        return _Client()


@pytest.fixture
def library_db(monkeypatch):
    storage.invalidate_library_cache()
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: True)
    monkeypatch.setattr(storage, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(storage, "_get_podcast_folders_safe", lambda: set())
    db = _BlockingLibraryDb()
    monkeypatch.setattr(storage, "_supabase_http_client", db.client)
    yield db
    db.gate.set()
    storage.invalidate_library_cache()


def test_cold_library_rebuild_is_single_flight(library_db):
    results: List[Any] = []
    threads = [threading.Thread(target=lambda: results.append(storage.list_library_timelines())) for _ in range(4)]
    for t in threads:
        t.start()
    time.sleep(0.2)
    library_db.gate.set()
    for t in threads:
        t.join(5)
    assert len(results) == 4 and all(len(r) == 1 for r in results)
    # One index query (the flag select and its JSON fallback count as one attempt each, at most).
    assert library_db.index_calls <= 2
    assert storage._LIBRARY_REBUILD_LOCK.acquire(blocking=False)  # never held by a rebuild
    storage._LIBRARY_REBUILD_LOCK.release()


def test_expired_catalog_is_served_while_the_rebuild_runs_in_the_bulk_pool(library_db, monkeypatch):
    submitted: List[Any] = []
    monkeypatch.setattr(executors, "submit_bulk", lambda fn, *a, **k: submitted.append(fn))
    stale = [{"id": "old", "title": "Old"}]
    with storage._LIBRARY_CACHE_LOCK:
        storage._LIBRARY_CACHE_ITEMS = list(stale)
        storage._LIBRARY_CACHE_TS = time.monotonic() - storage._LIBRARY_CACHE_TTL_SECONDS - 5
    started = time.monotonic()
    assert storage.list_library_timelines() == stale
    assert time.monotonic() - started < 0.5 and library_db.index_calls == 0
    assert len(submitted) == 1
    # A second request while that refresh is queued doesn't queue another one.
    storage.list_library_timelines()
    assert len(submitted) == 1
    with storage._LIBRARY_CACHE_LOCK:
        storage._LIBRARY_BG_REFRESH_IN_FLIGHT = False


# --- SC-13: one RPC per AI operation ------------------------------------------------------------------

class _SpendDB(FakeUsageDB):
    """FakeUsageDB plus an in-memory twin of migrations/005_record_ai_spend.sql."""

    def __init__(self, with_spend_rpc: bool):
        super().__init__(with_reserve_rpc=False)
        self.with_spend_rpc = with_spend_rpc
        self.activity_rows: List[dict] = []

    def post(self, url, headers=None, json=None):
        if url.endswith("/rpc/record_ai_spend") and self.with_spend_rpc:
            self.requests.append(("post", url, json))
            return FakeResponse(200, self._spend(json))
        return super().post(url, headers=headers, json=json)

    def _inc(self, day, ident, delta):
        key = (day, ident)
        self.rows[key] = max(0, self.rows.get(key, 0) + delta)
        return self.rows[key]

    def _spend(self, p):
        day, micro = p["p_day"], p["p_identity_micro"]
        identity, crossed, hits, comm = {}, False, None, None
        if micro > 0:
            order = sorted(range(len(p["p_identity_ids"])), key=lambda i: (p["p_identity_ids"][i], i))
            for i in order:
                ident, cap = p["p_identity_ids"][i], p["p_identity_caps"][i]
                new = self._inc(day, ident, micro)
                identity[ident] = new
                if cap > 0 and new - micro < cap <= new:
                    crossed = True
            if crossed and p["p_personal_hits_id"]:
                hits = self._inc(day, p["p_personal_hits_id"], 1)
            if p["p_community_day_id"]:
                comm = self._inc(day, p["p_community_day_id"], micro)
        lm = p["p_ledger_micro"]
        if lm > 0:
            cents, rem = divmod(lm, 10_000)
            ld = p["p_ledger_date"]
            if cents:
                self._inc(ld, p["p_ledger_cents_id"], cents)
            if rem:
                new_rem = self._inc(ld, p["p_ledger_remainder_id"], rem)
                carry = new_rem // 10_000 - max(0, new_rem - rem) // 10_000
                if carry > 0:
                    self._inc(ld, p["p_ledger_remainder_id"], -carry * 10_000)
                    self._inc(ld, p["p_ledger_cents_id"], carry)
        inserted = None
        if p["p_activity"] is not None:
            self.activity_rows.append(p["p_activity"])
            inserted = True
        return {"identity": identity, "community_day": comm, "personal_hits": hits,
                "activity_inserted": inserted, "activity_error": None}


@pytest.fixture
def rest_activity(monkeypatch):
    posted: List[dict] = []

    class _Client:
        def post(self, url, headers=None, json=None):
            posted.append(json)
            return FakeResponse(201, None)

    @contextmanager
    def _client():
        yield _Client()

    monkeypatch.setattr(activity_log, "_activity_http_client", _client)
    monkeypatch.setattr(activity_log, "_config", lambda: ("https://fake.supabase.co", "svc-key"))
    return posted


USER = {"id": "user-5b", "email": "u5b@example.com"}
GUEST = {"id": "guest-5b", "is_anonymous": True}
OPS = [
    # (user, client ip, community usd, identity usd)
    (USER, "203.0.113.7", 0.004321, 0.004321),
    (USER, "203.0.113.7", 0.30, 0.30),          # crosses the $0.50 registered cap together with the next
    (USER, "203.0.113.7", 0.25, 0.25),
    (GUEST, "2001:db8:1:2::5", 0.0099, 0.0099),  # guest: session, hashed IP and IPv6 /56 counters
    (GUEST, "2001:db8:1:2::5", 0.0, 0.0),        # nothing to meter: row only
    (USER, "203.0.113.7", 0.000777, 0.0),        # community ledger only (e.g. a free-key image)
]


def _run_ops(monkeypatch, db, posted):
    install_fake_store(monkeypatch, qs, db)
    monkeypatch.setenv("DAILY_COMMUNITY_USD_LIMIT", "5")
    for user, ip, community, identity in OPS:
        row = {"action": "chat", "status": "success", "user_id": user["id"], "is_guest": user is GUEST}
        activity_log._record_operation(user, ip, community, identity, row, False)
    return {k: v for k, v in db.rows.items()}


def test_spend_rpc_matches_the_per_counter_path(monkeypatch, rest_activity):
    rpc_db = _SpendDB(with_spend_rpc=True)
    rpc_counters = _run_ops(monkeypatch, rpc_db, rest_activity)
    rpc_calls = [r for r in rpc_db.requests if r[1].endswith("/rpc/record_ai_spend")]
    assert len(rpc_calls) == len(OPS)  # one round trip per operation...
    assert not [r for r in rpc_db.requests if r[1].endswith("/rpc/increment_ai_usage")]
    assert len(rpc_db.activity_rows) == len(OPS) and rest_activity == []  # ...that also wrote the row

    qs.reset_usage_store_breaker()
    legacy_db = _SpendDB(with_spend_rpc=False)
    legacy_counters = _run_ops(monkeypatch, legacy_db, rest_activity)
    assert len(rest_activity) == len(OPS)  # fallback: rows go through the REST insert

    assert rpc_counters == legacy_counters
    day = qs._get_today_str()
    assert rpc_counters[(day, qs.PERSONAL_CAP_HITS_ID)] == 1  # the registered cap was crossed once
    assert any(ident.startswith("spend:") and "56" in ident for (_, ident) in rpc_counters)  # guest /56 counter


def test_missing_spend_rpc_is_detected_once(monkeypatch, rest_activity):
    db = _SpendDB(with_spend_rpc=False)
    install_fake_store(monkeypatch, qs, db)
    for _ in range(3):
        activity_log._record_operation(USER, "203.0.113.7", 0.01, 0.01, {"action": "chat"}, False)
    probes = [r for r in db.requests if r[1].endswith("/rpc/record_ai_spend")]
    assert len(probes) == 1


def test_spend_rpc_keeps_the_spend_alerts(monkeypatch, rest_activity, caplog):
    db = _SpendDB(with_spend_rpc=True)
    install_fake_store(monkeypatch, qs, db)
    monkeypatch.setenv("DAILY_COMMUNITY_USD_LIMIT", "0.10")
    with qs._spend_alerts_lock:
        qs._spend_alerts_fired.clear()
    with caplog.at_level(logging.WARNING):
        activity_log._record_operation(USER, "203.0.113.7", 0.06, 0.06, None, False)
        activity_log._record_operation(USER, "203.0.113.7", 0.06, 0.06, None, False)
    text = caplog.text
    assert "SPEND_ALERT scope=community threshold=50%" in text
    assert "SPEND_ALERT scope=community threshold=100%" in text


def test_track_ai_activity_queues_one_operation_per_ai_call(monkeypatch):
    submitted: List[tuple] = []
    monkeypatch.setattr(qs, "usage_store_is_durable", lambda: True)

    class _Pool:
        def submit(self, fn, *args):
            submitted.append((fn, args))

    monkeypatch.setattr(activity_log, "_executor", _Pool())

    async def run():
        async with activity_log.track_ai_activity("chat", USER, key_tier="paid"):
            activity_log.record_extra_cost(0.02)

    asyncio.run(run())
    assert len(submitted) == 1 and submitted[0][0] is activity_log._record_operation
    user, ip, community, identity, row, holds_slot = submitted[0][1]
    assert community == pytest.approx(0.02) and identity == pytest.approx(0.02)


def test_migration_005_grants_only_service_role():
    sql = (BACKEND_DIR / "migrations" / "005_record_ai_spend.sql").read_text(encoding="utf-8")
    assert "create or replace function public.record_ai_spend(" in sql
    assert "from public, anon, authenticated" in sql and "to service_role" in sql
    assert "exception when others" in sql  # a failing activity insert never rolls back the counters
