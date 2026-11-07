"""P-02: the Google Cloud TTS budget check must never do blocking I/O on the event loop."""
import asyncio
import threading

import pytest
from fastapi.testclient import TestClient

import main
from services import podcast_tts_service as tts
from services import quota_service


def _on_event_loop_thread() -> bool:
    try:
        asyncio.get_running_loop()
        return True
    except RuntimeError:
        return False


@pytest.fixture
def usage_calls(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_TTS_API_KEY", "gcloud-key")
    monkeypatch.setenv("GOOGLE_CLOUD_TTS_MONTHLY_CHAR_LIMIT", "1000")
    tts._gcloud_tts_disabled_until.clear()
    tts.reset_gcloud_usage_cache()
    calls = []

    def fake_usage(month_str=None):
        calls.append({"on_loop": _on_event_loop_thread(), "thread": threading.get_ident()})
        return 400

    monkeypatch.setattr(tts, "get_google_cloud_tts_monthly_usage", fake_usage)
    monkeypatch.setattr(quota_service, "get_google_cloud_tts_monthly_usage", fake_usage)
    yield calls
    tts.reset_gcloud_usage_cache()


def test_podcast_options_does_not_read_usage_when_cache_is_warm(usage_calls):
    tts._store_gcloud_usage(400)
    with TestClient(main.app) as client:
        res = client.get("/api/podcast/options?lang=he")
    assert res.status_code == 200
    gcloud = next(e for e in res.json()["engines"] if e["id"] == "gcloud")
    assert gcloud["available"] is True
    assert usage_calls == []


def test_podcast_options_cold_cache_reads_usage_off_the_event_loop(usage_calls, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLOUD_TTS_MONTHLY_CHAR_LIMIT", "400")
    with TestClient(main.app) as client:
        first = client.get("/api/podcast/options?lang=he")
        second = client.get("/api/podcast/options?lang=he")
    assert len(usage_calls) == 1 and usage_calls[0]["on_loop"] is False
    for res in (first, second):
        gcloud = next(e for e in res.json()["engines"] if e["id"] == "gcloud")
        assert gcloud["available"] is False and gcloud["reason"] == "quota_exhausted"


@pytest.mark.asyncio
async def test_sync_accessor_on_the_loop_never_blocks(usage_calls):
    # Cold cache on the loop thread: unknown (treated as available), refresh goes to a worker thread.
    assert tts.get_cached_gcloud_remaining_chars() is None
    for _ in range(100):
        if usage_calls:
            break
        await asyncio.sleep(0.01)
    assert usage_calls and all(c["on_loop"] is False for c in usage_calls)
    assert tts.get_cached_gcloud_remaining_chars() == 600


def test_sync_accessor_off_the_loop_refreshes_inline(usage_calls):
    assert tts.get_cached_gcloud_remaining_chars() == 600
    assert tts.get_cached_gcloud_remaining_chars() == 600
    assert len(usage_calls) == 1
