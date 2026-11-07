"""B-30: grounded calls reserve their searches before running, so concurrent calls can't overshoot
the monthly cap, and the reservation is corrected with the real count afterwards."""
import pytest

import services.gemini_service as gs
import services.quota_service as qs
from models import GroundingMetadataPayload

MONTH = "2026-11-01"


@pytest.fixture
def capped(monkeypatch, tmp_path):
    monkeypatch.setattr(qs, "USAGE_FILE", tmp_path / "usage.json")
    monkeypatch.setenv("GOOGLE_SEARCH_GROUNDING_MONTHLY_QUERY_LIMIT", "10")
    monkeypatch.setenv("GROUNDING_RESERVED_QUERIES_PER_CALL", "4")
    monkeypatch.setattr(qs, "_get_month_start_str", lambda: MONTH)


def _used():
    return qs.get_google_search_grounding_monthly_usage(MONTH)


def test_concurrent_reservations_stop_at_the_cap(capped):
    # Three calls start before any finishes: 0+4 and 4+4 pass (under 10 when they start), 8+4 too
    # (8 < 10), the fourth sees 12 and is refused. Overshoot is bounded by one reservation.
    results = [qs.reserve_google_search_grounding_queries() for _ in range(4)]
    assert results == [4, 4, 4, None]
    assert _used() == 12  # the refused reservation was given back


def test_settle_corrects_to_the_executed_count(capped):
    reserved = qs.reserve_google_search_grounding_queries()
    total, cost = qs.settle_google_search_grounding_queries(reserved, 2)
    assert (total, cost) == (2, 0.0)
    reserved = qs.reserve_google_search_grounding_queries()
    total, _ = qs.settle_google_search_grounding_queries(reserved, 7)  # more than reserved: charged
    assert total == 9


def test_release_returns_an_unused_reservation(capped):
    reserved = qs.reserve_google_search_grounding_queries()
    qs.release_google_search_grounding_reservation(reserved)
    assert _used() == 0


def test_store_outage_refuses_paid_grounding(capped, monkeypatch):
    def down(*a, **k):
        raise qs.UsageStoreUnavailable("down")

    monkeypatch.setattr(qs, "_change_usage_delta", down)
    assert qs.reserve_google_search_grounding_queries() is None


def test_uncapped_paid_grounding_reserves_nothing(capped, monkeypatch):
    monkeypatch.setenv("GOOGLE_SEARCH_GROUNDING_MONTHLY_QUERY_LIMIT", "-1")
    assert qs.reserve_google_search_grounding_queries() == 0
    assert qs.settle_google_search_grounding_queries(0, 3)[0] == 3


def test_prepare_and_track_use_the_reservation(capped, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY_MAIN")
    monkeypatch.delenv("GEMINI_API_KEY_FREE", raising=False)
    monkeypatch.setattr(gs, "get_gemini_client", lambda key=None: f"client:{key or 'PAID_KEY_MAIN'}")
    monkeypatch.setattr(gs, "get_dedicated_free_key_for_grounding", lambda: None)
    primary = "client:PAID_KEY_MAIN"

    res = gs.GroundingReservation()
    client, on_paid = gs._prepare_grounding_client("PAID_KEY_MAIN", primary, res)
    assert (client, on_paid, res.reserved) == (primary, True, 4)
    assert _used() == 4
    payload = GroundingMetadataPayload(is_grounded=True, search_queries=["a"], sources=[], citations=[])
    assert gs._track_grounding_queries(on_paid, payload, res) == (1, 0.0)
    assert _used() == 1
    res.release()  # already settled: no-op
    assert _used() == 1

    # A failed grounded step gives its whole reservation back.
    failed = gs.GroundingReservation()
    gs._prepare_grounding_client("PAID_KEY_MAIN", primary, failed)
    assert _used() == 5
    failed.release()
    assert _used() == 1

    # At the cap with no free key: grounding is skipped and nothing stays reserved.
    qs.record_google_search_grounding_queries(20, month_str=MONTH)
    blocked = gs.GroundingReservation()
    assert gs._prepare_grounding_client("PAID_KEY_MAIN", primary, blocked) == (None, False)
    assert blocked.reserved == 0 and _used() == 21
