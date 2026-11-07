"""P-08: one-round-trip credit reservation RPC (with fallback), spend prefetch, community cache, CORS max_age."""
import pytest

from _quota_store_fakes import FakeUsageDB, install_fake_store
from services import quota_service as qs

USER = {"id": "rpc-user", "email": "rpc@example.com"}
GUEST = {"id": "rpc-guest", "is_anonymous": True}
IPV6 = "2001:db8:abcd:12::1"


@pytest.fixture(autouse=True)
def _policy(monkeypatch):
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "25")
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "10")
    monkeypatch.delenv("GUEST_IP_DAILY_PAID_PROMPTS", raising=False)
    monkeypatch.setenv("GUEST_IPV6_56_MULTIPLIER", "4")
    monkeypatch.setenv("DAILY_COMMUNITY_PAID_LIMIT", "-1")
    monkeypatch.setenv("MONTHLY_COMMUNITY_PAID_LIMIT", "-1")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY")
    monkeypatch.delenv("ADMIN_EMAILS", raising=False)
    yield
    qs.reset_usage_store_breaker()


def _store(monkeypatch, rpc):
    return install_fake_store(monkeypatch, qs, FakeUsageDB(with_reserve_rpc=rpc))


def _seed(db, counts):
    day = qs._get_today_str()
    for ident, val in counts.items():
        db.rows[(day, ident)] = val


def _snapshot(db):
    day = qs._get_today_str()
    return {ident: val for (d, ident), val in db.rows.items() if d == day}


def test_rpc_path_reserves_every_identifier_in_one_request(monkeypatch):
    db = _store(monkeypatch, rpc=True)
    within, kept, reads = qs._try_reserve_guest_credits(GUEST, IPV6, 2, keep_overlimit_tick=True, read_ids=["spend:x"])
    assert (within, kept) == (True, True)
    assert reads == {}
    assert db.count("post", "/rpc/reserve_ai_credits") == 1
    assert db.count("post", "/rpc/increment_ai_usage") == 0
    sent = [r for r in db.requests if r[1].endswith("/rpc/reserve_ai_credits")][0][2]
    ids = qs.get_guest_identifiers(GUEST, IPV6)
    assert sent["p_identifiers"] == ids and len(ids) == 3  # session, /64 and /56 buckets
    ip_cap = qs.get_guest_ip_daily_limit()
    assert sent["p_caps"] == [10, ip_cap, ip_cap * 4]
    assert sent["p_delta"] == 2 and sent["p_keep_overlimit"] is True
    assert all(v == 2 for v in _snapshot(db).values())


def test_missing_rpc_falls_back_and_is_remembered(monkeypatch):
    db = _store(monkeypatch, rpc=False)
    assert qs._try_reserve_user_credits(USER["id"], 1)[:2] == (True, True)
    assert db.count("post", "/rpc/reserve_ai_credits") == 1
    assert db.count("post", "/rpc/increment_ai_usage") == 1
    assert qs._breaker_open is False  # a missing function is not a store outage

    assert qs._try_reserve_user_credits(USER["id"], 1)[:2] == (True, True)
    assert db.count("post", "/rpc/reserve_ai_credits") == 1  # not retried while remembered
    assert _snapshot(db)[USER["id"]] == 2

    qs._reserve_rpc_missing_until = 0.0  # recheck window elapsed
    db.with_reserve_rpc = True
    assert qs._try_reserve_user_credits(USER["id"], 1)[:2] == (True, True)
    assert db.count("post", "/rpc/reserve_ai_credits") == 2
    assert _snapshot(db)[USER["id"]] == 3


def _guest_ids():
    return qs.get_guest_identifiers(GUEST, IPV6)


def _matrix():
    s, ip, ip56 = _guest_ids()
    ip_cap = qs.get_guest_ip_daily_limit()
    return [
        # (label, kind, seed, cost, keep_overlimit_tick, expected (within_limit, kept_increment))
        ("user within", "user", {USER["id"]: 3}, 1, True, (True, True)),
        ("user reaches cap", "user", {USER["id"]: 24}, 1, True, (True, True)),
        ("user straddles", "user", {USER["id"]: 24}, 3, True, (False, False)),
        ("user already over keeps tick", "user", {USER["id"]: 25}, 1, True, (False, True)),
        ("user already over premium", "user", {USER["id"]: 25}, 6, False, (False, False)),
        ("user straddle premium", "user", {USER["id"]: 20}, 6, False, (False, False)),
        ("guest within", "guest", {s: 2, ip: 3, ip56: 3}, 2, True, (True, True)),
        ("guest ip straddles", "guest", {s: 2, ip: ip_cap - 1, ip56: ip_cap - 1}, 2, True, (False, False)),
        ("guest session over keeps tick", "guest", {s: 10, ip: 10, ip56: 10}, 1, True, (False, True)),
        ("guest /56 over keeps tick", "guest", {s: 1, ip: 1, ip56: ip_cap * 4}, 1, True, (False, True)),
        ("guest /56 straddles", "guest", {s: 1, ip: 1, ip56: ip_cap * 4 - 1}, 3, True, (False, False)),
        ("guest premium over", "guest", {s: 8, ip: 8, ip56: 8}, 6, False, (False, False)),
        ("guest fresh premium", "guest", {}, 6, False, (True, True)),
    ]


@pytest.mark.parametrize("case", range(13))
def test_rpc_and_legacy_paths_are_equivalent(monkeypatch, case):
    label, kind, seed, cost, keep, expected = _matrix()[case]
    results = {}
    for rpc in (False, True):
        db = _store(monkeypatch, rpc=rpc)
        _seed(db, seed)
        if kind == "user":
            within, kept, _ = qs._try_reserve_user_credits(USER["id"], cost, keep_overlimit_tick=keep)
        else:
            within, kept, _ = qs._try_reserve_guest_credits(GUEST, IPV6, cost, keep_overlimit_tick=keep)
        # Rows that a rolled-back legacy reservation leaves at 0 do not exist after an RPC rollback.
        final = {k: v for k, v in _snapshot(db).items() if v or k in seed}
        results[rpc] = (within, kept, final)
        assert db.count("post", "/rpc/reserve_ai_credits") == 1
        increments = db.count("post", "/rpc/increment_ai_usage")
        assert increments == 0 if rpc else increments > 0
    assert results[True] == results[False], label
    assert results[True][:2] == expected, label


def test_resolve_uses_one_request_including_the_spend_check(monkeypatch):
    db = _store(monkeypatch, rpc=True)
    key, tier, _ = qs.resolve_gemini_key(USER, increment_usage=True, client_ip="198.51.100.4")
    assert (key, tier) == ("PAID_KEY", "paid")
    assert len(db.requests) == 1 and db.requests[0][1].endswith("/rpc/reserve_ai_credits")
    sent = db.requests[0][2]
    assert "spend:" + USER["id"] in sent["p_read_identifiers"]


def test_spend_cap_from_rpc_reads_serves_free_and_refunds_credits(monkeypatch):
    db = _store(monkeypatch, rpc=True)
    over = qs._usd_to_micro(qs.get_registered_daily_usd_cap())
    _seed(db, {USER["id"]: 4, "spend:" + USER["id"]: over})
    key, tier, _ = qs.resolve_gemini_key(USER, increment_usage=True, client_ip="198.51.100.4")
    assert tier == "free" and key != "PAID_KEY"
    assert _snapshot(db)[USER["id"]] == 4  # personal credits handed back
    assert db.count("get") == 0  # the spend check came from the reservation response


def test_spend_check_without_rpc_still_reads_separately(monkeypatch):
    db = _store(monkeypatch, rpc=False)
    over = qs._usd_to_micro(qs.get_registered_daily_usd_cap())
    _seed(db, {"spend:" + USER["id"]: over})
    assert qs.resolve_gemini_key(USER, increment_usage=True, client_ip="198.51.100.4")[1] == "free"
    assert db.count("get") == 1
    assert _snapshot(db)[USER["id"]] == 0


def test_premium_charge_uses_the_rpc_and_rolls_back_straddles(monkeypatch):
    db = _store(monkeypatch, rpc=True)
    _seed(db, {USER["id"]: 22})
    allowed, _, tier, incremented, _ = qs.charge_premium_credits(USER, None, credits=6)
    assert (allowed, tier, incremented) == (False, "free", False)
    assert _snapshot(db)[USER["id"]] == 22
    allowed, key, tier, incremented, _ = qs.charge_premium_credits(USER, None, credits=3)
    assert (allowed, key, tier, incremented) == (True, "PAID_KEY", "paid", True)
    assert _snapshot(db)[USER["id"]] == 25


def test_quota_info_caches_ledger_and_pool_status(monkeypatch):
    db = _store(monkeypatch, rpc=False)
    clock = {"t": 500.0}
    monkeypatch.setattr(qs.time, "monotonic", lambda: clock["t"])
    monkeypatch.setenv("COMMUNITY_STATUS_CACHE_SECONDS", "45")

    def ledger_reads():
        return len([r for r in db.requests if r[0] == "get" and r[2]["usage_date"] == f"eq.{qs.COMMUNITY_LEDGER_DATE}"])

    qs.get_user_quota_info(USER, client_ip="198.51.100.4")
    assert ledger_reads() == 1
    clock["t"] += 30
    qs.get_user_quota_info(USER, client_ip="198.51.100.4")
    qs.get_user_quota_info(GUEST, client_ip="198.51.100.4")
    assert ledger_reads() == 1
    clock["t"] += 16
    qs.get_user_quota_info(USER, client_ip="198.51.100.4")
    assert ledger_reads() == 2


def test_ledger_writes_invalidate_the_cache(monkeypatch):
    db = _store(monkeypatch, rpc=False)
    monkeypatch.setenv("COMMUNITY_STATUS_CACHE_SECONDS", "45")
    assert qs.get_cached_community_ledger()["donated_usd"] == 0
    qs.record_community_donation_usd(5, tx_id="tx-3b", currency="USD")
    assert qs.get_cached_community_ledger()["donated_usd"] == 5.0
    assert qs.get_cached_community_pool_status()["donated_usd"] == 5.0


def test_cache_is_bypassed_for_the_local_file_store(monkeypatch, tmp_path):
    monkeypatch.setattr(qs, "USAGE_FILE", tmp_path / "u.json")
    qs.record_community_spend_usd(1.25)
    assert qs.get_cached_community_ledger()["spent_usd"] == 1.25
    qs.record_community_spend_usd(1.0)
    assert qs.get_cached_community_ledger()["spent_usd"] == 2.25


def test_cors_preflights_are_cacheable():
    import main

    assert main._cors_middleware_kwargs()["max_age"] == 7200


def test_rpc_404_with_a_postgres_error_is_a_store_failure_not_a_missing_function(monkeypatch, tmp_path):
    from _quota_store_fakes import FakeResponse

    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.setattr(qs, "USAGE_FILE", tmp_path / "u.json")
    db = _store(monkeypatch, rpc=True)
    monkeypatch.setattr(db, "post", lambda url, headers=None, json=None: FakeResponse(
        404, {"code": "42P01", "message": 'relation "public.ai_usage" does not exist'}
    ))
    assert qs._try_reserve_user_credits(USER["id"], 1)[:2] == (True, True)  # dev: local-file fallback
    assert qs._breaker_open is True
    assert qs._reserve_rpc_missing_until == 0.0
