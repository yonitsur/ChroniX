"""B-27: one bad activity row no longer pauses all logging; the queue is bounded and can be flushed."""
import threading

import httpx
import pytest

from services import activity_log, deleted_users


class _Resp:
    def __init__(self, status_code, text=""):
        self.status_code = status_code
        self.text = text


def _client_returning(outcome, posted):
    class Client:
        def __init__(self, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers=None, json=None):
            posted.append(json)
            if isinstance(outcome, Exception):
                raise outcome
            return _Resp(outcome, "nope")

    return Client


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "key")
    monkeypatch.setenv("ACTIVITY_LOG_ENABLED", "true")
    monkeypatch.setattr(activity_log, "_disabled_until", 0.0)
    monkeypatch.setattr(activity_log, "_pending", 0)
    yield monkeypatch
    activity_log._disabled_until = 0.0


@pytest.mark.parametrize("status", [400, 409, 413, 422])
def test_a_rejected_row_is_dropped_without_pausing(configured, status):
    posted = []
    configured.setattr(httpx, "Client", _client_returning(status, posted))
    activity_log._post_row({"action": "chat", "user_id": "u1"})
    assert posted and activity_log._disabled_until == 0.0


@pytest.mark.parametrize("outcome", [500, 503, 429, 404, 401, httpx.ConnectError("down")])
def test_store_wide_failures_pause_logging(configured, outcome):
    posted = []
    configured.setattr(httpx, "Client", _client_returning(outcome, posted))
    activity_log._post_row({"action": "chat"})
    assert activity_log._disabled_until > 0


def test_queue_is_bounded_and_drops_new_rows_when_full(configured):
    submitted = []

    class _Exec:
        def submit(self, fn, *args):
            submitted.append(args)

    configured.setattr(activity_log, "_executor", _Exec())
    configured.setattr(activity_log, "_MAX_PENDING", 3)
    for i in range(5):
        activity_log.submit_row({"action": "chat", "n": i})
    assert len(submitted) == 3
    assert activity_log.pending_count() == 3


def test_flush_waits_for_queued_inserts(configured):
    configured.setattr(httpx, "Client", _client_returning(201, []))
    gate = threading.Event()
    real_post = activity_log._post_row_once

    def slow(row):
        gate.wait(2)
        real_post(row)

    configured.setattr(activity_log, "_post_row_once", slow)
    activity_log.submit_row({"action": "chat"})
    assert activity_log.flush(timeout=0.05) is False
    gate.set()
    assert activity_log.flush(timeout=2) is True
    assert activity_log.pending_count() == 0


def test_rows_of_a_just_deleted_account_are_dropped(configured):
    posted = []
    configured.setattr(httpx, "Client", _client_returning(201, posted))
    deleted_users.mark_deleted("gone-user")
    activity_log._post_row({"action": "chat", "user_id": "gone-user"})
    activity_log._post_row({"action": "chat", "user_id": "other"})
    assert [r["user_id"] for r in posted] == ["other"]
