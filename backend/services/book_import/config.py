"""Typed environment configuration for the book-import pipeline (see docs/book-import-spec.md)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List, Optional


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int, minimum: Optional[int] = None, maximum: Optional[int] = None) -> int:
    try:
        value = int(os.getenv(name, "").strip() or default)
    except ValueError:
        value = default
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def _env_float(name: str, default: Optional[float]) -> Optional[float]:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_models(name: str) -> List[str]:
    raw = (os.getenv(name) or "").strip()
    return [m.strip() for m in raw.split(",") if m.strip()]


STAGES = ("read", "map", "extract", "reconcile")
DEFAULT_THINKING = {"read": 0, "map": 8192, "extract": 2048, "reconcile": 4096}


@dataclass(frozen=True)
class BookImportConfig:
    enabled: bool
    access: str  # "admin" | "admin_byok"
    runner: str  # "web" | "off"
    max_active: int
    max_active_per_user: int
    gemini_concurrency: int
    gemini_global_concurrency: int
    stage_models: dict = field(default_factory=dict)
    stage_thinking: dict = field(default_factory=dict)
    gemini_api_key: Optional[str] = None
    bucket: str = "book-imports"
    storage_backend: str = "auto"  # "auto" | "local" | "supabase"
    max_file_mb: int = 200
    max_total_mb: int = 600
    max_files: int = 600
    max_units: int = 900
    render_spread_px: int = 3000
    render_page_px: int = 2200
    render_review_px: int = 1200
    thumb_px: int = 360
    photo_max_px: int = 2048
    lease_seconds: int = 90
    sweep_seconds: int = 30
    ttl_days: int = 14
    signed_url_ttl: int = 21600
    fast_lane_max_units: int = 12
    fast_lane_max_chars: int = 40000
    fast_lane_max_photos: int = 24
    max_usd: Optional[float] = None
    max_instructions_chars: int = 10_000
    max_pasted_chars: int = 200_000

    def models_for(self, stage: str) -> List[str]:
        """Model chain for a stage: stage override first, then the app's default chain."""
        explicit = list(self.stage_models.get(stage) or [])
        try:
            from services.gemini_service import get_gemini_models_to_try

            defaults = get_gemini_models_to_try()
        except Exception:  # pragma: no cover - import guard for isolated tooling
            defaults = ["gemini-3.8-flash", "gemini-3.6-flash"]
        out: List[str] = []
        for m in explicit + defaults:
            if m not in out:
                out.append(m)
        return out

    def thinking_for(self, stage: str) -> int:
        return int(self.stage_thinking.get(stage, DEFAULT_THINKING.get(stage, 0)))


def load_config() -> BookImportConfig:
    access = (os.getenv("BOOK_IMPORT_ACCESS") or "admin_byok").strip().lower()
    if access not in ("admin", "admin_byok"):
        access = "admin_byok"
    runner = (os.getenv("BOOK_IMPORT_RUNNER") or "web").strip().lower()
    if runner not in ("web", "off"):
        runner = "web"
    storage_backend = (os.getenv("BOOK_IMPORT_STORAGE_BACKEND") or "auto").strip().lower()
    if storage_backend not in ("auto", "local", "supabase"):
        storage_backend = "auto"
    return BookImportConfig(
        enabled=_env_bool("BOOK_IMPORT_ENABLED", False),
        access=access,
        runner=runner,
        max_active=_env_int("BOOK_IMPORT_MAX_ACTIVE", 2, 1, 16),
        max_active_per_user=_env_int("BOOK_IMPORT_MAX_ACTIVE_PER_USER", 1, 1, 8),
        gemini_concurrency=_env_int("BOOK_IMPORT_GEMINI_CONCURRENCY", 8, 1, 64),
        gemini_global_concurrency=_env_int("BOOK_IMPORT_GEMINI_GLOBAL_CONCURRENCY", 12, 1, 128),
        stage_models={s: _env_models(f"BOOK_IMPORT_MODEL_{s.upper()}") for s in STAGES},
        stage_thinking={
            s: _env_int(f"BOOK_IMPORT_THINKING_{s.upper()}", DEFAULT_THINKING[s], 0, 32768) for s in STAGES
        },
        gemini_api_key=(os.getenv("BOOK_IMPORT_GEMINI_API_KEY") or "").strip() or None,
        bucket=(os.getenv("BOOK_IMPORT_BUCKET") or "book-imports").strip() or "book-imports",
        storage_backend=storage_backend,
        max_file_mb=_env_int("BOOK_IMPORT_MAX_FILE_MB", 200, 1, 5000),
        max_total_mb=_env_int("BOOK_IMPORT_MAX_TOTAL_MB", 600, 1, 20000),
        max_files=_env_int("BOOK_IMPORT_MAX_FILES", 600, 1, 5000),
        max_units=_env_int("BOOK_IMPORT_MAX_UNITS", 900, 1, 5000),
        render_spread_px=_env_int("BOOK_IMPORT_RENDER_SPREAD_PX", 3000, 800, 8000),
        render_page_px=_env_int("BOOK_IMPORT_RENDER_PAGE_PX", 2200, 800, 8000),
        render_review_px=_env_int("BOOK_IMPORT_RENDER_REVIEW_PX", 1200, 400, 4000),
        lease_seconds=_env_int("BOOK_IMPORT_LEASE_SECONDS", 90, 15, 3600),
        sweep_seconds=_env_int("BOOK_IMPORT_SWEEP_SECONDS", 30, 2, 3600),
        ttl_days=_env_int("BOOK_IMPORT_TTL_DAYS", 14, 1, 365),
        signed_url_ttl=_env_int("BOOK_IMPORT_SIGNED_URL_TTL", 21600, 60, 7 * 86400),
        fast_lane_max_units=_env_int("BOOK_IMPORT_FAST_LANE_MAX_UNITS", 12, 0, 200),
        fast_lane_max_chars=_env_int("BOOK_IMPORT_FAST_LANE_MAX_CHARS", 40000, 0, 2_000_000),
        fast_lane_max_photos=_env_int("BOOK_IMPORT_FAST_LANE_MAX_PHOTOS", 24, 0, 1000),
        max_usd=_env_float("BOOK_IMPORT_MAX_USD", None),
    )


_CONFIG: Optional[BookImportConfig] = None


def get_config() -> BookImportConfig:
    global _CONFIG
    if _CONFIG is None:
        _CONFIG = load_config()
    return _CONFIG


def reset_config_for_tests() -> None:
    global _CONFIG
    _CONFIG = None
