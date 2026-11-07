"""Shared pytest fixtures for the ChroniX backend test-suite."""
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services import quota_service  # noqa: E402


@pytest.fixture(autouse=True)
def disable_activity_log(monkeypatch):
    """Never write analytics rows to the real Supabase activity_log table from tests."""
    monkeypatch.setenv("ACTIVITY_LOG_ENABLED", "false")


@pytest.fixture(autouse=True)
def disable_enrichment_cache(monkeypatch):
    """Never read or write the real Supabase enrichment_cache table from tests (they opt in)."""
    monkeypatch.setenv("ENRICHMENT_CACHE_ENABLED", "false")


@pytest.fixture(autouse=True)
def isolate_usage_store(monkeypatch, tmp_path):
    """
    Several test modules call load_dotenv() at import time, which puts the REAL Supabase
    service-role credentials into the environment. Without this fixture the quota tests
    would read/write the production usage table. Force every test onto a throwaway local file.
    """
    monkeypatch.setattr(quota_service, "usage_store_is_durable", lambda: False)
    monkeypatch.setattr(quota_service, "USAGE_FILE", tmp_path / "daily_usage.json")
    # Process-wide quota-store state (breaker, RPC detection, community cache) must not leak.
    quota_service.reset_usage_store_breaker()
    quota_service.invalidate_community_status_cache()
    # The Google Cloud TTS usage cache would otherwise carry one test's counter into the next.
    tts = sys.modules.get("services.podcast_tts_service")
    if tts is not None:
        tts.reset_gcloud_usage_cache()


@pytest.fixture(autouse=True)
def reset_server_draining_flag():
    """`with TestClient(main.app)` runs the lifespan shutdown, which flips the process into
    "draining" (new AI jobs refused). Reset it so one test's shutdown can't leak into the next."""
    yield
    main_module = sys.modules.get("main")
    if main_module is not None and hasattr(main_module, "_SERVER_DRAINING"):
        main_module._SERVER_DRAINING = False
    # Batch 5C admission state (text-job queue, running set, upload slots) is process-wide too.
    if main_module is not None and hasattr(main_module, "_TEXT_JOB_QUEUE"):
        main_module._TEXT_JOB_QUEUE.clear()
        main_module._TEXT_JOBS_RUNNING.clear()
        main_module._UPLOAD_SLOTS_IN_USE = 0


@pytest.fixture(autouse=True)
def reset_auth_and_byok_state():
    """Verified-BYOK verdicts and auth caches are process-wide: never let one test's state leak."""
    from services import auth_service, byok_verification
    byok_verification.reset_for_tests()
    auth_service.reset_auth_caches_for_tests()
    yield
    byok_verification.reset_for_tests()
    auth_service.reset_auth_caches_for_tests()


@pytest.fixture(autouse=True)
def reset_deleted_account_state():
    """Recently-deleted accounts, episode tombstones and the episode index cache are process-wide."""
    from services import deleted_users, podcast_store
    deleted_users.clear()
    podcast_store.clear_index_cache()
    podcast_store.clear_tombstones()
    yield
    deleted_users.clear()
    podcast_store.clear_index_cache()
    podcast_store.clear_tombstones()


@pytest.fixture(autouse=True)
def reset_public_timeline_cache():
    """The public-response cache and the flag-column detection (P-06/P-07) are process-wide."""
    from services import storage
    storage.invalidate_public_timeline_cache()
    storage.reset_flag_columns_detection()
    yield
    storage.invalidate_public_timeline_cache()
