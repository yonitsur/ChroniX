"""Shared pytest fixtures for the ChroniX backend test-suite."""
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services import quota_service  # noqa: E402


@pytest.fixture(autouse=True)
def isolate_usage_store(monkeypatch, tmp_path):
    """
    Several test modules call load_dotenv() at import time, which puts the REAL Supabase
    service-role credentials into the environment. Without this fixture the quota tests
    would read/write the production usage table. Force every test onto a throwaway local file.
    """
    monkeypatch.setattr(quota_service, "usage_store_is_durable", lambda: False)
    monkeypatch.setattr(quota_service, "USAGE_FILE", tmp_path / "daily_usage.json")
