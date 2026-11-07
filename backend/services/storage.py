import json
import os
import re
import uuid
import base64
import io
import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from collections import OrderedDict
from contextlib import contextmanager
from functools import cmp_to_key, lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv()
import httpx
from models import TimelineData, TimelineArticle, TimelineDate, TimelineLane, TimelineTimeBand
from services.image_safety import ImageTooLargeError, open_image_checked, sniff_image_size

logger = logging.getLogger("ChroniXStorage")


class StorageUnavailableError(RuntimeError):
    """Durable timeline storage could not answer (non-200 or network error). Never means "not found"."""


class TimelineImageLimitError(ValueError):
    """The timeline embeds more inline data: images than the safety caps allow."""


class TimelineConflictError(Exception):
    """A timeline write lost a race: the id is already taken (insert) or the row no longer matches its verified owner (update)."""


class TimelineStaleWriteError(TimelineConflictError):
    """The caller's base version (`updatedAt` it last read) no longer matches the stored row (B-04)."""

    def __init__(self, current_updated_at: Optional[str] = None):
        super().__init__("timeline was changed since it was read")
        self.current_updated_at = current_updated_at


class TimelineGoneError(Exception):
    """The timeline row was soft-deleted; a save must not bring it back (B-04)."""


class EmptyTimelineError(ValueError):
    """A save with no events is refused (B-18); the API answers 422 `empty_timeline`, never a silent 200."""

    code = "empty_timeline"

    def __init__(self, timeline_id: Optional[str] = None):
        super().__init__("A timeline needs at least one event. Add an event, or delete the timeline instead.")
        self.timeline_id = timeline_id


_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def get_system_owner_user_id() -> Optional[str]:
    """
    Optional `SYSTEM_OWNER_USER_ID`: an existing auth user (normally an admin) that owns curated and
    re-homed Library timelines. Unset/invalid means such rows stay unowned (NULL), which is admin-only.
    """
    raw = (os.getenv("SYSTEM_OWNER_USER_ID") or "").strip()
    if not raw:
        return None
    if not _UUID_RE.match(raw):
        logger.warning("SYSTEM_OWNER_USER_ID is not a valid UUID; ignoring it")
        return None
    return raw

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TIMELINES_FILE = DATA_DIR / "timelines.json"

_LOCAL_TIMELINES_CACHE_KEY: Optional[Tuple[str, int, int]] = None
_LOCAL_TIMELINES_CACHE_DATA: Optional[List[dict]] = None
_LOCAL_TIMELINES_CACHE_MAX_BYTES = 2 * 1024 * 1024  # Avoid pinning multi-MB local fallback files in RAM

_LIBRARY_CACHE_LOCK = threading.Lock()
_LIBRARY_REBUILD_LOCK = threading.Lock()
_LIBRARY_CACHE_TS: float = 0.0
_LIBRARY_CACHE_ITEMS: Optional[List[dict]] = None
_LIBRARY_CACHE_TTL_SECONDS = 300.0
# A catalog built while some card chunks failed is kept only briefly, so a transient error can't
# hide those cards for everyone for the full TTL (B-23).
_LIBRARY_PARTIAL_CACHE_TTL_SECONDS = 15.0
_LIBRARY_CACHE_STALE_MAX_SECONDS = 3600.0
_LIBRARY_CACHE_PARTIAL: bool = False
# Bumped by every invalidation: a rebuild that started earlier must not write its (stale) result
# back afterwards, e.g. re-showing a timeline that was just unpublished (B-23).
_LIBRARY_CACHE_GENERATION: int = 0
_LIBRARY_BG_REFRESH_IN_FLIGHT: bool = False
_LIBRARY_CARD_CACHE: Dict[str, Tuple[tuple, dict]] = {}
_LIBRARY_INDEX_PAGE_SIZE = 200
_LIBRARY_INDEX_MAX_PAGES = 25  # 5,000 Library rows


def _library_cache_ttl() -> float:
    """TTL of the current catalog cache entry (caller holds `_LIBRARY_CACHE_LOCK`)."""
    return _LIBRARY_PARTIAL_CACHE_TTL_SECONDS if _LIBRARY_CACHE_PARTIAL else _LIBRARY_CACHE_TTL_SECONDS


def invalidate_library_cache(timeline_id: Optional[str] = None, *, keep_cards: bool = False) -> None:
    """Clear the in-memory Public Library catalog cache (and optionally per-timeline card cache)."""
    global _LIBRARY_CACHE_TS, _LIBRARY_CACHE_ITEMS, _LIBRARY_CACHE_GENERATION, _LIBRARY_CACHE_PARTIAL
    invalidate_public_timeline_cache(timeline_id)
    with _LIBRARY_CACHE_LOCK:
        _LIBRARY_CACHE_TS = 0.0
        _LIBRARY_CACHE_ITEMS = None
        _LIBRARY_CACHE_PARTIAL = False
        _LIBRARY_CACHE_GENERATION += 1
        if timeline_id:
            _LIBRARY_CARD_CACHE.pop(str(timeline_id).strip(), None)
        elif not keep_cards:
            _LIBRARY_CARD_CACHE.clear()


def _sanitize_date_dict(d: Optional[dict]) -> Optional[dict]:
    """Ensure a stored date dict's precision matches its supplied components."""
    if not isinstance(d, dict):
        return d
    year = d.get("year")
    month = d.get("month")
    day = d.get("day") if month is not None else None
    if month is None and d.get("day") is not None:
        d["day"] = None
    hour = d.get("hour") if day is not None else None
    minute = d.get("minute") if hour is not None else None
    prec = d.get("precision") or "year"
    if prec not in ("hour", "minute") and hour == 0 and not minute:
        hour = minute = None

    if minute is not None:
        prec = "minute"
    elif hour is not None:
        prec = "hour"
    elif day is not None:
        prec = "day"
    elif month is not None:
        prec = "month"
    elif isinstance(year, (int, float)) and abs(year) >= 1_000_000:
        prec = "million-years"
    elif isinstance(year, (int, float)) and abs(year) >= 10_000:
        prec = prec if prec in ("millennium", "million-years") else "millennium"
    else:
        prec = "year"

    d["precision"] = prec
    return d


def _env_positive_int(name: str, default: int) -> int:
    try:
        val = int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default
    return val if val > 0 else default


# Inline data: image caps. The photo importer embeds at most 12 photos per event and ~9M chars per
# timeline (>=22K chars each), so these only stop crafted payloads.
TIMELINE_MAX_INLINE_IMAGES_PER_ARTICLE = _env_positive_int("TIMELINE_MAX_INLINE_IMAGES_PER_ARTICLE", 24)
TIMELINE_MAX_INLINE_IMAGES = _env_positive_int("TIMELINE_MAX_INLINE_IMAGES", 400)


def _is_inline_image(val: Any) -> bool:
    return isinstance(val, str) and val.startswith("data:image/")


def enforce_inline_image_limits(timeline: Optional[dict]) -> None:
    """Raises TimelineImageLimitError when a timeline embeds too many inline data: images."""
    if not isinstance(timeline, dict):
        return
    total = 0
    for art in timeline.get("articles") or []:
        if not isinstance(art, dict):
            continue
        count = 1 if _is_inline_image(art.get("imageUrl")) else 0
        add_imgs = art.get("additionalImages")
        if isinstance(add_imgs, list):
            for item in add_imgs:
                url = item.get("url") if isinstance(item, dict) else item
                if _is_inline_image(url):
                    count += 1
        if count > TIMELINE_MAX_INLINE_IMAGES_PER_ARTICLE:
            raise TimelineImageLimitError(
                f"An event embeds {count} images (max {TIMELINE_MAX_INLINE_IMAGES_PER_ARTICLE})."
            )
        total += count
        if total > TIMELINE_MAX_INLINE_IMAGES:
            raise TimelineImageLimitError(f"The timeline embeds too many images (max {TIMELINE_MAX_INLINE_IMAGES}).")


# P-10: a JPEG / WebP that is already within the dimension limit is never re-encoded (each pass
# loses quality, and clients now compress once at upload). Above this size it is re-encoded anyway,
# so one oversized photo can't bloat the row.
INLINE_IMAGE_REENCODE_SKIP_MAX_CHARS = _env_positive_int("INLINE_IMAGE_REENCODE_SKIP_MAX_CHARS", 240_000)


def _is_compact_jpeg_or_webp(b64_data: str, max_dim: int) -> bool:
    """True for a JPEG / WebP whose header-declared size fits `max_dim` (header bytes only, no decode)."""
    try:
        raw = base64.b64decode(b64_data)
    except Exception:
        return False
    is_jpeg = raw[:2] == bytes((0xFF, 0xD8))
    is_webp = raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"
    if not (is_jpeg or is_webp):
        return False
    size = sniff_image_size(raw)
    return bool(size) and 0 < size[0] <= max_dim and 0 < size[1] <= max_dim


def _compress_data_image_url(url: str, max_bytes_b64: int = 80_000, max_dim: int = 1024, quality: int = 80) -> str:
    """
    Compresses oversized inline base64 data:image/ URLs (e.g. uncompressed PNGs in imported JSONs)
    into compact JPEGs so multi-MB timelines do not exceed Supabase/Postgres statement timeouts.

    Returns "" (image dropped) when the header declares more pixels than the inline safety cap:
    such an image is never decoded, and is not stored either, because legit clients always
    downscale before sending and keeping it would hand the pixel bomb to every viewer's browser.
    """
    if not isinstance(url, str) or len(url) <= max_bytes_b64 or not url.startswith("data:image/"):
        return url
    header, sep, b64_data = url.partition(",")
    if not sep or not b64_data or "image/gif" in header.lower():
        return url
    if len(url) <= INLINE_IMAGE_REENCODE_SKIP_MAX_CHARS and _is_compact_jpeg_or_webp(b64_data, max_dim):
        return url
    try:
        from PIL import Image
        raw_bytes = base64.b64decode(b64_data)
        with open_image_checked(raw_bytes) as img:
            if img.mode in ("RGBA", "LA", "P"):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                converted = img.convert("RGBA")
                bg.paste(converted, mask=converted.split()[3])
                img = bg
            elif img.mode != "RGB":
                img = img.convert("RGB")
            img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality, optimize=True)
            compressed_b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            new_url = f"data:image/jpeg;base64,{compressed_b64}"
            return new_url if len(new_url) < len(url) else url
    except ImageTooLargeError as e:
        logger.warning(f"Dropping oversized inline data:image URL ({e})")
        return ""
    except Exception as e:
        logger.info(f"Could not compress data:image URL: {e}")
        return url


def _compress_timeline_data_images(timeline: Optional[dict]) -> Optional[dict]:
    """Compresses oversized base64 images across all articles in a timeline dict in-place."""
    if not isinstance(timeline, dict):
        return timeline
    for art in timeline.get("articles") or []:
        if not isinstance(art, dict):
            continue
        if isinstance(art.get("imageUrl"), str):
            art["imageUrl"] = _compress_data_image_url(art["imageUrl"])
        add_imgs = art.get("additionalImages")
        if isinstance(add_imgs, list):
            kept = []
            for item in add_imgs:
                if isinstance(item, dict) and isinstance(item.get("url"), str):
                    item["url"] = _compress_data_image_url(item["url"])
                    if not item["url"]:
                        continue
                elif isinstance(item, str):
                    item = _compress_data_image_url(item)
                    if not item:
                        continue
                kept.append(item)
            add_imgs[:] = kept
    return timeline


def sanitize_timeline_dates(timeline: Optional[dict]) -> Optional[dict]:
    """Normalize all article and timeBand date precisions in a timeline dict."""
    if not isinstance(timeline, dict):
        return timeline
    for art in timeline.get("articles") or []:
        if isinstance(art, dict):
            if isinstance(art.get("from"), dict):
                _sanitize_date_dict(art["from"])
            if isinstance(art.get("to"), dict):
                _sanitize_date_dict(art["to"])
    for tb in timeline.get("timeBands") or []:
        if isinstance(tb, dict):
            if isinstance(tb.get("from"), dict):
                _sanitize_date_dict(tb["from"])
            if isinstance(tb.get("to"), dict):
                _sanitize_date_dict(tb["to"])
    return timeline


def _load_local_timelines() -> List[dict]:
    """Load local timelines JSON with an mtime/size-validated in-memory cache."""
    global _LOCAL_TIMELINES_CACHE_KEY, _LOCAL_TIMELINES_CACHE_DATA
    ensure_data_dir()
    try:
        st = TIMELINES_FILE.stat()
        key = (str(TIMELINES_FILE), st.st_mtime_ns, st.st_size)
        if _LOCAL_TIMELINES_CACHE_KEY == key and _LOCAL_TIMELINES_CACHE_DATA is not None:
            return _LOCAL_TIMELINES_CACHE_DATA
        with open(TIMELINES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            for item in data:
                sanitize_timeline_dates(item)
            if st.st_size <= _LOCAL_TIMELINES_CACHE_MAX_BYTES:
                _LOCAL_TIMELINES_CACHE_KEY = key
                _LOCAL_TIMELINES_CACHE_DATA = data
            else:
                _LOCAL_TIMELINES_CACHE_KEY = None
                _LOCAL_TIMELINES_CACHE_DATA = None
            return data
    except Exception:
        pass
    return []


def _save_local_timelines(data: List[dict]) -> None:
    """Persist local timelines JSON and update the in-memory cache."""
    global _LOCAL_TIMELINES_CACHE_KEY, _LOCAL_TIMELINES_CACHE_DATA
    ensure_data_dir()
    with open(TIMELINES_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    try:
        st = TIMELINES_FILE.stat()
        if st.st_size <= _LOCAL_TIMELINES_CACHE_MAX_BYTES:
            _LOCAL_TIMELINES_CACHE_KEY = (str(TIMELINES_FILE), st.st_mtime_ns, st.st_size)
            _LOCAL_TIMELINES_CACHE_DATA = data
        else:
            _LOCAL_TIMELINES_CACHE_KEY = None
            _LOCAL_TIMELINES_CACHE_DATA = None
    except Exception:
        _LOCAL_TIMELINES_CACHE_KEY = None
        _LOCAL_TIMELINES_CACHE_DATA = None


SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Free-tier Supabase projects pause after inactivity and can take 10-30s to cold-start
# on the first request back - a short timeout here silently drops saves to the
# ephemeral local-file fallback, which is wiped on every redeploy.
# `pool` is how long a worker may wait for a free connection; it is kept separate from the read
# timeout so pool starvation shows up as its own error instead of eating the cold-start budget (SC-08).
SUPABASE_TIMEOUT = httpx.Timeout(20.0, connect=10.0, pool=10.0)
# Sized for the storage + bulk executors (services/executors.py) plus the Library chunk fetchers.
_SUPABASE_MAX_CONNECTIONS = max(20, int(os.getenv("SUPABASE_STORAGE_MAX_CONNECTIONS", "48") or 48))
_ORIG_HTTP_CLIENT = httpx.Client
_HTTP_CLIENT_LOCK = threading.Lock()
_SHARED_HTTP_CLIENT: Optional[httpx.Client] = None


@contextmanager
def _supabase_http_client():
    """Reuse a persistent sync httpx.Client unless monkeypatched in unit tests."""
    global _SHARED_HTTP_CLIENT
    if httpx.Client is not _ORIG_HTTP_CLIENT:
        client_cls = httpx.Client
        with client_cls(timeout=SUPABASE_TIMEOUT) as client:
            yield client
        return
    with _HTTP_CLIENT_LOCK:
        if _SHARED_HTTP_CLIENT is None or _SHARED_HTTP_CLIENT.is_closed:
            _SHARED_HTTP_CLIENT = _ORIG_HTTP_CLIENT(
                timeout=SUPABASE_TIMEOUT,
                limits=httpx.Limits(
                    max_connections=_SUPABASE_MAX_CONNECTIONS,
                    max_keepalive_connections=max(10, _SUPABASE_MAX_CONNECTIONS // 2),
                ),
            )
        client = _SHARED_HTTP_CLIENT
    yield client

def _get_supabase_headers():
    if not SUPABASE_SERVICE_ROLE_KEY:
        return None
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json"
    }

def _supabase_is_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


# --- Generated flag columns (P-06, backend/migrations/004_timeline_flag_columns.sql) ---------------
# Stored generated columns mirror the JSON flags (`flag_is_library`, ...), so the Library index can
# use a partial index and list / meta lookups never detoast the multi-MB `data` column. Until the
# migration is applied PostgREST answers 400 (42703 "column ... does not exist"): that is remembered
# for _FLAG_COLUMNS_RECHECK_SECONDS and the JSONB expressions are used instead.
FLAG_COLUMN_PREFIX = "flag_"
_FLAG_COLUMNS_RECHECK_SECONDS = 600.0
_flag_columns_missing_until = 0.0


def _flag_columns_enabled() -> bool:
    return time.time() >= _flag_columns_missing_until


# Columns migration 004 guarantees (the mode columns may also come from the README's activity-log
# section); an error naming any of them means the generated-column selects can't be used yet.
_MIGRATION_004_COLUMNS = (FLAG_COLUMN_PREFIX, "content_mode", "search_mode", "creation_source")


def _is_missing_flag_column_response(resp: Any) -> bool:
    """A 400 / 404 naming a migration-004 column (42703 / PGRST204 / "does not exist")."""
    if getattr(resp, "status_code", None) not in (400, 404):
        return False
    try:
        text = str(resp.text or "")
    except Exception:
        return False
    return any(name in text for name in _MIGRATION_004_COLUMNS) and any(
        marker in text for marker in ("42703", "PGRST204", "does not exist", "Could not find")
    )


def _note_flag_columns_missing(context: str) -> None:
    global _flag_columns_missing_until
    if time.time() >= _flag_columns_missing_until:
        logger.info(
            f"Timeline flag columns are not installed ({context}); using JSON expressions. "
            "Run backend/migrations/004_timeline_flag_columns.sql to enable them."
        )
    _flag_columns_missing_until = time.time() + _FLAG_COLUMNS_RECHECK_SECONDS


def reset_flag_columns_detection() -> None:
    """Forget a cached "columns missing" verdict (tests, or right after applying the migration)."""
    global _flag_columns_missing_until
    _flag_columns_missing_until = 0.0

def ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not TIMELINES_FILE.exists():
        with open(TIMELINES_FILE, "w", encoding="utf-8") as f:
            json.dump([], f, ensure_ascii=False)

def get_sample_timeline() -> dict:
    return {
        "id": "sample-us-presidents",
        "title": "Presidents of the United States (Key Figures)",
        "description": "An interactive timeline highlighting transformative presidents in American history.",
        "timeScale": "calendar",
        "lanes": [
            {"id": "early", "title": "18th & 19th Century", "color": "#454b52", "order": 1},
            {"id": "modern", "title": "20th Century", "color": "#2e6b56", "order": 2},
            {"id": "contemporary", "title": "21st Century", "color": "#6e395e", "order": 3}
        ],
        "timeBands": [
            {"id": "founding", "title": "Founding & Civil War Era", "from": {"year": 1789, "precision": "year"}, "to": {"year": 1877, "precision": "year"}, "color": "rgba(43, 82, 120, 0.08)"},
            {"id": "twentieth", "title": "20th Century & Cold War", "from": {"year": 1900, "precision": "year"}, "to": {"year": 1999, "precision": "year"}, "color": "rgba(46, 107, 86, 0.08)"},
            {"id": "twentyfirst", "title": "21st Century", "from": {"year": 2000, "precision": "year"}, "to": {"year": 2026, "precision": "year"}, "color": "rgba(110, 57, 94, 0.08)"}
        ],
        "articles": [
            {
                "id": "george-washington",
                "title": "George Washington",
                "subtitle": "1st U.S. President & Founding Father",
                "lane": "early",
                "from": {"year": 1789, "month": 4, "day": 30, "precision": "day"},
                "to": {"year": 1797, "month": 3, "day": 4, "precision": "day"},
                "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Gilbert_Stuart_Williamstown_Portrait_of_George_Washington.jpg/440px-Gilbert_Stuart_Williamstown_Portrait_of_George_Washington.jpg",
                "wikiTitle": "George Washington",
                "wikiUrl": "https://en.wikipedia.org/wiki/George_Washington",
                "extract": "George Washington was an American military officer, statesman, and Founding Father who served as the first president of the United States from 1789 to 1797.",
                "rank": 10,
                "locationName": "Philadelphia & Mount Vernon, USA",
                "lat": 38.7081,
                "lng": -77.0861,
                "googleMapsUrl": "https://www.google.com/maps/search/?api=1&query=38.7081,-77.0861"
            },
            {
                "id": "abraham-lincoln",
                "title": "Abraham Lincoln",
                "subtitle": "16th U.S. President, Civil War & Emancipation",
                "lane": "early",
                "from": {"year": 1861, "month": 3, "day": 4, "precision": "day"},
                "to": {"year": 1865, "month": 4, "day": 15, "precision": "day"},
                "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Abraham_Lincoln_O-77_matte_collodion_print.jpg/440px-Abraham_Lincoln_O-77_matte_collodion_print.jpg",
                "wikiTitle": "Abraham Lincoln",
                "wikiUrl": "https://en.wikipedia.org/wiki/Abraham_Lincoln",
                "extract": "Abraham Lincoln was an American lawyer, politician, and statesman who served as the 16th president of the United States from 1861 until his assassination in 1865. Lincoln led the nation through the American Civil War and issued the Emancipation Proclamation.",
                "rank": 10,
                "locationName": "Washington D.C. & Springfield, USA",
                "lat": 38.8977,
                "lng": -77.0365,
                "googleMapsUrl": "https://www.google.com/maps/search/?api=1&query=38.8977,-77.0365"
            },
            {
                "id": "theodore-roosevelt",
                "title": "Theodore Roosevelt",
                "subtitle": "26th U.S. President, Progressive Era & Conservation",
                "lane": "modern",
                "from": {"year": 1901, "month": 9, "day": 14, "precision": "day"},
                "to": {"year": 1909, "month": 3, "day": 4, "precision": "day"},
                "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Theodore_Roosevelt_typical_c1904.jpg/440px-Theodore_Roosevelt_typical_c1904.jpg",
                "wikiTitle": "Theodore Roosevelt",
                "wikiUrl": "https://en.wikipedia.org/wiki/Theodore_Roosevelt",
                "extract": "Theodore Roosevelt Jr. was an American politician, statesman, soldier, conservationist, and writer who served as the 26th president of the United States from 1901 to 1909.",
                "rank": 8,
                "locationName": "Oyster Bay, New York, USA",
                "lat": 40.8718,
                "lng": -73.5321,
                "googleMapsUrl": "https://www.google.com/maps/search/?api=1&query=40.8718,-73.5321"
            },
            {
                "id": "franklin-d-roosevelt",
                "title": "Franklin D. Roosevelt",
                "subtitle": "32nd U.S. President, New Deal & World War II",
                "lane": "modern",
                "from": {"year": 1933, "month": 3, "day": 4, "precision": "day"},
                "to": {"year": 1945, "month": 4, "day": 12, "precision": "day"},
                "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/FDR_1944_Color_Portrait.jpg/440px-FDR_1944_Color_Portrait.jpg",
                "wikiTitle": "Franklin D. Roosevelt",
                "wikiUrl": "https://en.wikipedia.org/wiki/Franklin_D._Roosevelt",
                "extract": "Franklin Delano Roosevelt was an American statesman and political leader who served as the 32nd president of the United States from 1933 until his death in 1945. He led the nation through the Great Depression and World War II.",
                "rank": 10,
                "locationName": "Hyde Park, New York, USA",
                "lat": 41.7684,
                "lng": -73.9351,
                "googleMapsUrl": "https://www.google.com/maps/search/?api=1&query=41.7684,-73.9351"
            },
            {
                "id": "john-f-kennedy",
                "title": "John F. Kennedy",
                "subtitle": "35th U.S. President, Space Race & Civil Rights",
                "lane": "modern",
                "from": {"year": 1961, "month": 1, "day": 20, "precision": "day"},
                "to": {"year": 1963, "month": 11, "day": 22, "precision": "day"},
                "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/John_F._Kennedy%2C_White_House_color_photo_portrait.jpg/440px-John_F._Kennedy%2C_White_House_color_photo_portrait.jpg",
                "wikiTitle": "John F. Kennedy",
                "wikiUrl": "https://en.wikipedia.org/wiki/John_F._Kennedy",
                "extract": "John Fitzgerald Kennedy, often referred to by his initials JFK, was an American politician who served as the 35th president of the United States from 1961 until his assassination in 1963.",
                "rank": 9,
                "locationName": "Dallas, Texas, USA",
                "lat": 32.7788,
                "lng": -96.8087,
                "googleMapsUrl": "https://www.google.com/maps/search/?api=1&query=32.7788,-96.8087"
            },
            {
                "id": "barack-obama",
                "title": "Barack Obama",
                "subtitle": "44th U.S. President, First African-American President",
                "lane": "contemporary",
                "from": {"year": 2009, "month": 1, "day": 20, "precision": "day"},
                "to": {"year": 2017, "month": 1, "day": 20, "precision": "day"},
                "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/President_Barack_Obama.jpg/440px-President_Barack_Obama.jpg",
                "wikiTitle": "Barack Obama",
                "wikiUrl": "https://en.wikipedia.org/wiki/Barack_Obama",
                "extract": "Barack Hussein Obama II is an American retired politician who served as the 44th president of the United States from 2009 to 2017. A member of the Democratic Party, he was the first African-American president.",
                "rank": 9,
                "locationName": "Chicago, Illinois, USA",
                "lat": 41.8781,
                "lng": -87.6298,
                "googleMapsUrl": "https://www.google.com/maps/search/?api=1&query=41.8781,-87.6298"
            }
        ],
        "createdAt": "2026-09-03T11:00:00Z",
        "updatedAt": "2026-09-03T11:00:00Z"
    }

def _is_timeline_deleted(obj: Optional[dict]) -> bool:
    if not isinstance(obj, dict):
        return False
    for key in ("is_deleted", "isDeleted"):
        val = obj.get(key)
        if val is True:
            return True
        if isinstance(val, str) and val.strip().lower() in ("true", "1"):
            return True
    return False


def _is_timeline_in_library(obj: Optional[dict]) -> bool:
    if not isinstance(obj, dict):
        return False
    for key in ("is_library", "isLibrary"):
        val = obj.get(key)
        if val is True:
            return True
        if isinstance(val, str) and val.strip().lower() in ("true", "1"):
            return True
    return False


def _is_hidden_from_saved(obj: Optional[dict]) -> bool:
    if not isinstance(obj, dict):
        return False
    for key in ("hidden_from_saved", "hiddenFromSaved"):
        val = obj.get(key)
        if val is True:
            return True
        if isinstance(val, str) and val.strip().lower() in ("true", "1"):
            return True
    return False


def _is_timeline_featured(obj: Optional[dict]) -> bool:
    if not isinstance(obj, dict):
        return False
    for key in ("is_featured", "isFeatured"):
        val = obj.get(key)
        if val is True:
            return True
        if isinstance(val, str) and val.strip().lower() in ("true", "1"):
            return True
    return False


def _get_timeline_featured_order(obj: Optional[dict]) -> Optional[int]:
    if not isinstance(obj, dict):
        return None
    for key in ("featuredOrder", "featured_order"):
        val = obj.get(key)
        if isinstance(val, bool) or val is None:
            continue
        if isinstance(val, int):
            return max(0, val)
        if isinstance(val, float) and val.is_integer():
            return max(0, int(val))
        if isinstance(val, str):
            s = val.strip()
            if s.isdigit():
                return int(s)
    return None


def _compare_library_featured(a: dict, b: dict) -> int:
    """
    Sort comparator for the Public Library 'Featured' view:
    - Group -1: explicitly featured (isFeatured=True) without a manual featuredOrder yet (newly featured -> top)
    - Group  0: admin-ordered timelines (sorted by featuredOrder ascending: 0, 1, 2, ...)
    - Group  1: unordered non-featured timelines (newly published -> after curated order)
    Tie-breaker: updatedAt descending, then title ascending.
    """
    a_ord = a.get("featuredOrder")
    b_ord = b.get("featuredOrder")
    a_has = isinstance(a_ord, int) and not isinstance(a_ord, bool)
    b_has = isinstance(b_ord, int) and not isinstance(b_ord, bool)

    a_group = 0 if a_has else (-1 if a.get("isFeatured") else 1)
    b_group = 0 if b_has else (-1 if b.get("isFeatured") else 1)
    if a_group != b_group:
        return -1 if a_group < b_group else 1

    if a_has and b_has and a_ord != b_ord:
        return -1 if a_ord < b_ord else 1

    a_upd = str(a.get("updatedAt") or "")
    b_upd = str(b.get("updatedAt") or "")
    if a_upd != b_upd:
        return -1 if a_upd > b_upd else 1

    a_title = str(a.get("title") or "")
    b_title = str(b.get("title") or "")
    if a_title != b_title:
        return -1 if a_title < b_title else 1
    return 0


def list_all_timelines(
    user_id: Optional[str] = None,
    all_users: bool = False,
    include_deleted: bool = False,
) -> List[dict]:
    """
    List timelines. If Supabase is configured, fetches strictly from Supabase PostgreSQL
    (never falling back to an unowned local file on error). Otherwise uses local JSON storage.

    When all_users=True (admin only, enforced by the caller), returns every saved
    timeline regardless of owner, including the owning user_id on each row.
    """
    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            base_params = {"order": "updated_at.desc"}
            if all_users:
                base_params["limit"] = "500"
            elif user_id:
                base_params["user_id"] = f"eq.{user_id}"
            else:
                return []

            with _supabase_http_client() as client:
                light_select_shared = (
                    "id,title,description,time_scale,article_count,is_personal,"
                    "is_pinned,is_public,is_shared,created_at,updated_at,user_id,"
                    "content_mode:data->>contentMode,search_mode:data->>searchMode,"
                    "creation_src:data->>creationSource,is_library:data->>isLibrary,"
                    "is_featured:data->>isFeatured,is_deleted:data->>isDeleted,deleted_at:data->>deletedAt,"
                    "hidden_from_saved:data->>hiddenFromSaved"
                )
                light_select_legacy = light_select_shared.replace(",is_shared", "")
                resp = None
                if _flag_columns_enabled():
                    flag_select = (
                        "id,title,description,time_scale,article_count,is_personal,"
                        "is_pinned,is_public,is_shared,created_at,updated_at,user_id,"
                        "content_mode,search_mode,creation_src:creation_source,"
                        "is_library:flag_is_library,is_featured:flag_is_featured,"
                        "is_deleted:flag_is_deleted,hidden_from_saved:flag_hidden_from_saved"
                        + (",deleted_at:data->>deletedAt" if all_users else "")
                    )
                    resp = client.get(url, headers=headers, params={**base_params, "select": flag_select})
                    if resp.status_code != 200:
                        if _is_missing_flag_column_response(resp):
                            _note_flag_columns_missing("list_all_timelines")
                        resp = None
                if resp is None:
                    resp = client.get(url, headers=headers, params={**base_params, "select": light_select_shared})
                if resp.status_code != 200:
                    resp = client.get(url, headers=headers, params={**base_params, "select": light_select_legacy})
                if resp.status_code == 200:
                    rows = resp.json()
                    results = []
                    for row in rows:
                        is_deleted = _is_timeline_deleted(row)
                        if is_deleted and not (all_users or include_deleted):
                            continue
                        if not all_users and _is_hidden_from_saved(row):
                            continue
                        entry = {
                            "id": row["id"],
                            "title": row["title"],
                            "description": row.get("description", ""),
                            "articleCount": row.get("article_count") or 0,
                            "timeScale": row.get("time_scale", "calendar"),
                            "updatedAt": row.get("updated_at", row.get("created_at", "")),
                            "isOwner": bool(user_id and row.get("user_id") == user_id),
                            "isPersonal": bool(row.get("is_personal", False)),
                            "isPinned": bool(row.get("is_pinned", False)),
                            "isShared": bool(row.get("is_shared") or row.get("is_public", False)),
                            "contentMode": "kids" if row.get("content_mode") == "kids" else "classic",
                            "searchMode": row.get("search_mode") or None,
                            "creationSource": row.get("creation_src") or None,
                            "isLibrary": _is_timeline_in_library(row),
                            "isFeatured": _is_timeline_featured(row)
                        }
                        if all_users:
                            entry["ownerId"] = row.get("user_id")
                            entry["isDeleted"] = is_deleted
                            entry["deletedAt"] = row.get("deleted_at") or None
                        if entry["articleCount"] > 0 or include_deleted:
                            results.append(entry)
                    return results

                # Column(s) not present yet (pre-migration) - fall back to the full-data select.
                logger.warning(
                    "list_all_timelines lightweight select failed (status=%s: %s); falling back to full JSON select.",
                    resp.status_code,
                    (resp.text or "")[:200],
                )
                full_params = {**base_params, "select": "id,title,description,time_scale,data,is_public,created_at,updated_at,user_id"}
                resp = client.get(url, headers=headers, params=full_params)
                if resp.status_code == 200:
                    rows = resp.json()
                    results = []
                    for row in rows:
                        data = row.get("data") or {}
                        is_deleted = _is_timeline_deleted(data) or _is_timeline_deleted(row)
                        if is_deleted and not (all_users or include_deleted):
                            continue
                        if not all_users and (_is_hidden_from_saved(data) or _is_hidden_from_saved(row)):
                            continue
                        articles = data.get("articles", [])
                        entry = {
                            "id": row["id"],
                            "title": row["title"],
                            "description": row.get("description", ""),
                            "articleCount": len(articles),
                            "timeScale": row.get("time_scale", "calendar"),
                            "updatedAt": row.get("updated_at", row.get("created_at", "")),
                            "isOwner": bool(user_id and row.get("user_id") == user_id),
                            "isPersonal": bool(data.get("isPersonal", False)),
                            "isPinned": bool(data.get("isPinned", False)),
                            "isShared": bool(row.get("is_shared") or row.get("is_public", False)),
                            "contentMode": "kids" if data.get("contentMode") == "kids" else "classic",
                            "searchMode": data.get("searchMode") or None,
                            "creationSource": data.get("creationSource") or None,
                            "isLibrary": _is_timeline_in_library(data) or _is_timeline_in_library(row),
                            "isFeatured": _is_timeline_featured(data) or _is_timeline_featured(row)
                        }
                        if all_users:
                            entry["ownerId"] = row.get("user_id")
                            entry["isDeleted"] = is_deleted
                            entry["deletedAt"] = data.get("deletedAt") or row.get("deleted_at") or None
                        if entry["articleCount"] > 0 or include_deleted:
                            results.append(entry)
                    return results
                logger.warning(f"Supabase list_all_timelines status {resp.status_code}")
        except Exception as e:
            logger.error(f"Supabase list_all_timelines failed (failing closed): {e}")
        return []

    # Local JSON storage (used ONLY when Supabase is not configured)
    try:
        data = _load_local_timelines()
        results = []
        for item in data:
            if len(item.get("articles", [])) == 0 and not include_deleted:
                continue
            item_owner = item.get("user_id")
            if not all_users:
                if user_id:
                    if item_owner not in (user_id, None):
                        continue
                else:
                    if item_owner is not None:
                        continue
            is_deleted = _is_timeline_deleted(item)
            if is_deleted and not (all_users or include_deleted):
                continue
            if not all_users and _is_hidden_from_saved(item):
                continue
            entry = {
                "id": item["id"],
                "title": item["title"],
                "description": item.get("description", ""),
                "articleCount": len(item.get("articles", [])),
                "timeScale": item.get("timeScale", "calendar"),
                "updatedAt": item.get("updatedAt", item.get("createdAt", "")),
                "isOwner": bool((user_id and item_owner == user_id) or item_owner is None),
                "isPersonal": bool(item.get("isPersonal", False)),
                "isPinned": bool(item.get("isPinned", False)),
                "isShared": True if item_owner is None else bool(item.get("is_shared") or item.get("is_public", False)),
                "contentMode": "kids" if item.get("contentMode") == "kids" else "classic",
                "searchMode": item.get("searchMode") or None,
                "creationSource": item.get("creationSource") or None,
                "isLibrary": _is_timeline_in_library(item),
                "isFeatured": _is_timeline_featured(item)
            }
            if all_users:
                entry["ownerId"] = item_owner
                entry["isDeleted"] = is_deleted
                entry["deletedAt"] = item.get("deletedAt") or None
            results.append(entry)
        return results
    except Exception:
        return []


def get_timeline_by_id(timeline_id: str) -> Optional[dict]:
    """
    Get a timeline by ID from the active configured store.
    """
    meta = get_timeline_with_meta(timeline_id)
    return meta.get("data") if meta else None

def get_timeline_with_meta(timeline_id: str) -> Optional[dict]:
    """
    Get a timeline by ID along with ownership/sharing metadata, used to enforce
    "shared link" read access (owner or a timeline explicitly marked as shared).
    Returns {"data": <timeline dict>, "owner_id": str|None, "is_shared": bool}, or None when the
    timeline genuinely does not exist. Raises StorageUnavailableError when Supabase can't answer.
    """
    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            params = {
                "id": f"eq.{timeline_id}",
                "select": "*"
            }
            with _supabase_http_client() as client:
                resp = client.get(url, headers=headers, params=params)
                if resp.status_code != 200:
                    raise StorageUnavailableError(f"timeline lookup returned HTTP {resp.status_code}")
                rows = resp.json()
        except StorageUnavailableError as e:
            logger.error(f"Supabase get_timeline failed (failing closed): {e}")
            raise
        except Exception as e:
            logger.error(f"Supabase get_timeline failed (failing closed): {e}")
            raise StorageUnavailableError("timeline lookup failed") from e
        if not isinstance(rows, list):
            raise StorageUnavailableError("timeline lookup returned an unexpected body")
        if not rows:
            return None
        row = rows[0]
        row_data = row.get("data")
        feat_ord = _get_timeline_featured_order(row_data)
        if feat_ord is None:
            feat_ord = _get_timeline_featured_order(row)
        return {
            "data": sanitize_timeline_dates(row_data),
            "owner_id": row.get("user_id"),
            "is_shared": bool(row.get("is_shared") or row.get("is_public", False)),
            "is_library": _is_timeline_in_library(row_data) or _is_timeline_in_library(row),
            "is_featured": _is_timeline_featured(row_data) or _is_timeline_featured(row),
            "featured_order": feat_ord,
        }

    try:
        data = _load_local_timelines()
        for item in data:
            if item["id"] == timeline_id:
                local_owner = item.get("user_id")
                return {
                    "data": item,
                    "owner_id": local_owner,
                    "is_shared": True if local_owner is None else bool(item.get("is_shared") or item.get("is_public", False)),
                    "is_library": _is_timeline_in_library(item),
                    "is_featured": _is_timeline_featured(item),
                    "featured_order": _get_timeline_featured_order(item),
                }
    except Exception:
        pass
    return None

def _is_truthy_flag(val) -> bool:
    if val is True:
        return True
    if isinstance(val, str) and val.strip().lower() in ("true", "1"):
        return True
    return False


_REHYDRATE_FIELD_KEYS = frozenset({"articles", "grounding", "quiz", "whoami", "podcast"})


def get_timeline_data_fields(timeline_id: str, keys: List[str]) -> Optional[dict]:
    """
    Only the top-level `data` keys asked for (e.g. `quiz`, `articles`), so restoring media a client
    stripped from a refine / chat request doesn't download the whole row (P-09). Returns
    {key: value-or-None}, None when the timeline doesn't exist; raises StorageUnavailableError.
    """
    wanted = [k for k in dict.fromkeys(keys) if k in _REHYDRATE_FIELD_KEYS]
    if not wanted:
        return {}
    if _supabase_is_configured():
        url = f"{SUPABASE_URL}/rest/v1/timelines"
        select = "id," + ",".join(f"{k}:data->{k}" for k in wanted)
        try:
            with _supabase_http_client() as client:
                resp = client.get(url, headers=_get_supabase_headers(), params={"id": f"eq.{timeline_id}", "select": select})
        except Exception as e:
            raise StorageUnavailableError("timeline field lookup failed") from e
        if resp.status_code == 200:
            rows = resp.json()
            if not isinstance(rows, list):
                raise StorageUnavailableError("timeline field lookup returned an unexpected body")
            if not rows:
                return None
            return {k: rows[0].get(k) for k in wanted}
        if resp.status_code != 400:
            raise StorageUnavailableError(f"timeline field lookup returned HTTP {resp.status_code}")
        # A PostgREST without JSON-path selects: read the full row instead.
    meta = get_timeline_with_meta(timeline_id)
    if not meta:
        return None
    data = meta.get("data") if isinstance(meta.get("data"), dict) else {}
    return {k: data.get(k) for k in wanted}


_SHARE_META_COVER_CANDIDATES = 3
_SHARE_META_FLAG_SELECT = (
    "id,user_id,is_public,is_shared,title,description,article_count,updated_at,"
    "is_library:flag_is_library,is_deleted:flag_is_deleted,data_updated_at:flag_updated_at,"
    "cover_url:data->>coverImageUrl,"
    + ",".join(f"img{i}:data->articles->{i}->>imageUrl" for i in range(_SHARE_META_COVER_CANDIDATES))
)
_SHARE_META_JSON_SELECT = (
    "id,user_id,is_public,is_shared,title,description,article_count,updated_at,"
    "is_library:data->>isLibrary,is_library_alt:data->>is_library,"
    "is_deleted:data->>isDeleted,is_deleted_alt:data->>is_deleted,data_updated_at:data->>updatedAt,"
    "cover_url:data->>coverImageUrl,"
    + ",".join(f"img{i}:data->articles->{i}->>imageUrl" for i in range(_SHARE_META_COVER_CANDIDATES))
)


def _share_meta_from_timeline(item: dict, owner_id: Any, is_shared: bool, is_library: bool) -> dict:
    articles = item.get("articles") if isinstance(item.get("articles"), list) else []
    covers = [item.get("coverImageUrl")] + [
        a.get("imageUrl") for a in articles[:_SHARE_META_COVER_CANDIDATES] if isinstance(a, dict)
    ]
    return {
        "owner_id": owner_id,
        "is_shared": is_shared,
        "is_library": is_library,
        "is_deleted": _is_timeline_deleted(item),
        "title": item.get("title") or "",
        "description": item.get("description") or "",
        "article_count": len(articles),
        "updated_at": item.get("updatedAt") or item.get("createdAt") or "",
        "cover_candidates": [c for c in covers if isinstance(c, str) and c],
    }


def get_timeline_share_meta(timeline_id: str) -> Optional[dict]:
    """
    What a link preview needs (P-07): visibility flags, title, description, event count, version and
    a few cover candidates (`data->coverImageUrl`, the first events' images), without the `data` blob.
    None when the timeline doesn't exist; raises StorageUnavailableError when storage can't answer.
    """
    if not _supabase_is_configured():
        try:
            local_items = _load_local_timelines()
        except Exception:
            return None
        for item in local_items:
            if item.get("id") == timeline_id:
                owner = item.get("user_id")
                shared = True if owner is None else bool(item.get("is_shared") or item.get("is_public", False))
                return _share_meta_from_timeline(item, owner, shared, _is_timeline_in_library(item))
        return None

    url = f"{SUPABASE_URL}/rest/v1/timelines"
    headers = _get_supabase_headers()
    try:
        with _supabase_http_client() as client:
            resp = None
            if _flag_columns_enabled():
                resp = client.get(url, headers=headers, params={"id": f"eq.{timeline_id}", "select": _SHARE_META_FLAG_SELECT})
                if resp.status_code != 200:
                    if _is_missing_flag_column_response(resp):
                        _note_flag_columns_missing("get_timeline_share_meta")
                    resp = None
            if resp is None:
                resp = client.get(url, headers=headers, params={"id": f"eq.{timeline_id}", "select": _SHARE_META_JSON_SELECT})
    except Exception as e:
        raise StorageUnavailableError("timeline share meta lookup failed") from e
    if resp.status_code != 200:
        if resp.status_code >= 500:
            raise StorageUnavailableError(f"timeline share meta lookup returned HTTP {resp.status_code}")
        # Pre-migration columns (article_count / is_shared): derive it from the full row.
        meta = get_timeline_with_meta(timeline_id)
        if not meta or not isinstance(meta.get("data"), dict):
            return None
        return _share_meta_from_timeline(
            meta["data"], meta.get("owner_id"), bool(meta.get("is_shared")), bool(meta.get("is_library"))
        )
    rows = resp.json()
    if not isinstance(rows, list):
        raise StorageUnavailableError("timeline share meta lookup returned an unexpected body")
    if not rows:
        return None
    row = rows[0]
    raw_count = row.get("article_count")
    covers = [row.get("cover_url")] + [row.get(f"img{i}") for i in range(_SHARE_META_COVER_CANDIDATES)]
    return {
        "owner_id": row.get("user_id"),
        "is_shared": bool(row.get("is_shared") or row.get("is_public", False)),
        "is_library": _is_timeline_in_library(row) or _is_truthy_flag(row.get("is_library_alt")),
        "is_deleted": _is_timeline_deleted(row) or _is_truthy_flag(row.get("is_deleted_alt")),
        "title": row.get("title") or "",
        "description": row.get("description") or "",
        "article_count": int(raw_count) if isinstance(raw_count, int) else None,
        "updated_at": row.get("data_updated_at") or row.get("updated_at") or "",
        "cover_candidates": [c for c in covers if isinstance(c, str) and c],
    }


# --- Public timeline response cache (P-07) ------------------------------------------------------
# Serialized responses for anonymous views of shared / Library timelines (and their link-preview
# meta), so a viral link doesn't pull the multi-MB row out of Supabase on every view. Entries live
# PUBLIC_TIMELINE_CACHE_TTL_SECONDS and are dropped whenever this process saves, shares, deletes or
# curates the timeline. Another instance's change shows up within the TTL.
def _env_float(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.getenv(name, "") or default))
    except ValueError:
        return default


PUBLIC_TIMELINE_CACHE_TTL_SECONDS = _env_float("PUBLIC_TIMELINE_CACHE_TTL_SECONDS", 30.0)
PUBLIC_TIMELINE_CACHE_MAX_BYTES = int(_env_float("PUBLIC_TIMELINE_CACHE_MAX_MB", 32.0) * 1024 * 1024)
PUBLIC_TIMELINE_CACHE_MAX_ENTRY_BYTES = 6 * 1024 * 1024
_PUBLIC_CACHE_LOCK = threading.Lock()
_PUBLIC_CACHE: "OrderedDict[Tuple[str, str], Tuple[float, int, Any]]" = OrderedDict()
_PUBLIC_CACHE_BYTES = 0


def public_cache_get(kind: str, timeline_id: str) -> Any:
    key = (kind, str(timeline_id))
    with _PUBLIC_CACHE_LOCK:
        entry = _PUBLIC_CACHE.get(key)
        if entry is None:
            return None
        if entry[0] <= time.monotonic():
            _public_cache_pop_locked(key)
            return None
        _PUBLIC_CACHE.move_to_end(key)
        return entry[2]


def public_cache_put(kind: str, timeline_id: str, value: Any, size: int) -> None:
    global _PUBLIC_CACHE_BYTES
    if PUBLIC_TIMELINE_CACHE_TTL_SECONDS <= 0 or size > PUBLIC_TIMELINE_CACHE_MAX_ENTRY_BYTES:
        return
    key = (kind, str(timeline_id))
    with _PUBLIC_CACHE_LOCK:
        _public_cache_pop_locked(key)
        _PUBLIC_CACHE[key] = (time.monotonic() + PUBLIC_TIMELINE_CACHE_TTL_SECONDS, int(size), value)
        _PUBLIC_CACHE_BYTES += int(size)
        while _PUBLIC_CACHE and _PUBLIC_CACHE_BYTES > PUBLIC_TIMELINE_CACHE_MAX_BYTES:
            _public_cache_pop_locked(next(iter(_PUBLIC_CACHE)))


def _public_cache_pop_locked(key: Tuple[str, str]) -> None:
    global _PUBLIC_CACHE_BYTES
    entry = _PUBLIC_CACHE.pop(key, None)
    if entry is not None:
        _PUBLIC_CACHE_BYTES = max(0, _PUBLIC_CACHE_BYTES - entry[1])


def invalidate_public_timeline_cache(timeline_id: Optional[str] = None) -> None:
    """Drops the cached public responses for one timeline (or all of them)."""
    global _PUBLIC_CACHE_BYTES
    with _PUBLIC_CACHE_LOCK:
        if timeline_id is None:
            _PUBLIC_CACHE.clear()
            _PUBLIC_CACHE_BYTES = 0
            return
        tid = str(timeline_id).strip()
        for key in [k for k in _PUBLIC_CACHE if k[1] == tid]:
            _public_cache_pop_locked(key)


_ACCESS_META_FLAG_SELECT = (
    "id,user_id,is_public,is_shared,article_count,"
    "is_library:flag_is_library,is_featured:flag_is_featured,featured_order:flag_featured_order,"
    "is_deleted:flag_is_deleted,hidden_from_saved:flag_hidden_from_saved,"
    "data_updated_at:flag_updated_at,legacy_podcast:flag_has_legacy_podcast"
)


def get_timeline_access_meta(timeline_id: str) -> Optional[dict]:
    """
    Lightweight ownership/sharing/deletion metadata lookup for a timeline WITHOUT fetching
    its multi-MB `data` JSONB column. Used by podcast endpoints and save_timeline ownership checks.
    Returns {
        "data": None,
        "owner_id": str|None,
        "is_shared": bool,
        "is_deleted": bool,
        "article_count": int|None,
        "has_legacy_podcast": bool,
    } or None if the timeline genuinely does not exist.
    Raises StorageUnavailableError when Supabase can't answer, so callers never mistake an outage
    for "new timeline" (which would let a save overwrite or take over someone else's row).
    """
    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            # `data_updated_at` is the version token for optimistic concurrency (B-04).
            select_with_optional = (
                "id,user_id,is_public,is_shared,article_count,"
                "is_library:data->>isLibrary,is_featured:data->>isFeatured,"
                "featured_order:data->>featuredOrder,"
                "is_deleted:data->>isDeleted,is_deleted_alt:data->>is_deleted,"
                "hidden_from_saved:data->>hiddenFromSaved,data_updated_at:data->>updatedAt,"
                "legacy_podcast_seg:data->podcast->segments->0->>id"
            )
            select_minimal = (
                "id,user_id,is_public,"
                "is_library:data->>isLibrary,is_featured:data->>isFeatured,"
                "featured_order:data->>featuredOrder,"
                "is_deleted:data->>isDeleted,is_deleted_alt:data->>is_deleted,"
                "hidden_from_saved:data->>hiddenFromSaved,data_updated_at:data->>updatedAt,"
                "legacy_podcast_seg:data->podcast->segments->0->>id"
            )
            with _supabase_http_client() as client:
                resp = None
                if _flag_columns_enabled():
                    resp = client.get(url, headers=headers, params={"id": f"eq.{timeline_id}", "select": _ACCESS_META_FLAG_SELECT})
                    if resp.status_code != 200:
                        if _is_missing_flag_column_response(resp):
                            _note_flag_columns_missing("get_timeline_access_meta")
                            resp = None
                        else:
                            # An outage, or another optional column (article_count / is_shared) is
                            # missing, which the JSON select carries too: one retry with the minimal one.
                            resp = client.get(url, headers=headers, params={"id": f"eq.{timeline_id}", "select": select_minimal})
                if resp is None:
                    resp = client.get(url, headers=headers, params={"id": f"eq.{timeline_id}", "select": select_with_optional})
                    if resp.status_code != 200:
                        # Pre-migration databases lack the optional columns (HTTP 400): retry with the minimal select.
                        resp = client.get(url, headers=headers, params={"id": f"eq.{timeline_id}", "select": select_minimal})
                if resp.status_code != 200:
                    raise StorageUnavailableError(f"timeline meta lookup returned HTTP {resp.status_code}")
                rows = resp.json()
        except StorageUnavailableError as e:
            logger.error(f"Supabase get_timeline_access_meta failed (failing closed): {e}")
            raise
        except Exception as e:
            logger.error(f"Supabase get_timeline_access_meta failed (failing closed): {e}")
            raise StorageUnavailableError("timeline meta lookup failed") from e
        if not isinstance(rows, list):
            raise StorageUnavailableError("timeline meta lookup returned an unexpected body")
        if not rows:
            return None
        row = rows[0]
        raw_count = row.get("article_count")
        art_count = int(raw_count) if isinstance(raw_count, int) else None
        is_deleted = _is_timeline_deleted(row) or _is_truthy_flag(row.get("is_deleted_alt"))
        feat_ord = _get_timeline_featured_order(row.get("data"))
        if feat_ord is None:
            feat_ord = _get_timeline_featured_order(row)
        meta = {
            "data": None,
            "owner_id": row.get("user_id"),
            "is_shared": bool(row.get("is_shared") or row.get("is_public", False)),
            "is_library": _is_timeline_in_library(row.get("data")) or _is_timeline_in_library(row),
            "is_featured": _is_timeline_featured(row.get("data")) or _is_timeline_featured(row),
            "featured_order": feat_ord,
            "is_deleted": is_deleted,
            "article_count": art_count,
            "has_legacy_podcast": bool(row.get("legacy_podcast_seg") or row.get("legacy_podcast") is True),
        }
        return _with_version_meta(meta, row.get("data_updated_at"), _is_hidden_from_saved(row))

    try:
        data = _load_local_timelines()
        for item in data:
            if item["id"] == timeline_id:
                pod = item.get("podcast")
                articles = item.get("articles")
                local_owner = item.get("user_id")
                meta = {
                    "data": None,
                    "owner_id": local_owner,
                    "is_shared": True if local_owner is None else bool(item.get("is_shared") or item.get("is_public", False)),
                    "is_library": _is_timeline_in_library(item),
                    "is_featured": _is_timeline_featured(item),
                    "featured_order": _get_timeline_featured_order(item),
                    "is_deleted": _is_timeline_deleted(item),
                    "article_count": len(articles) if isinstance(articles, list) else None,
                    "has_legacy_podcast": bool(isinstance(pod, dict) and pod.get("segments")),
                }
                return _with_version_meta(meta, item.get("updatedAt"), _is_hidden_from_saved(item))
    except Exception:
        pass
    return None


def _with_version_meta(meta: dict, updated_at: Any, hidden_from_saved: bool) -> dict:
    """Adds the optional `updated_at` version token / `hidden_from_saved` flag only when present."""
    if isinstance(updated_at, str) and updated_at:
        meta["updated_at"] = updated_at
    if hidden_from_saved:
        meta["hidden_from_saved"] = True
    return meta


def _set_timeline_shared_impl(timeline_id: str, user_id: str, enabled: bool, author_name: Optional[str] = None) -> bool:
    """
    Enables/disables the "anyone with the link" share flag on a timeline.
    Caller MUST have already verified ownership. Returns True on success.
    """
    if not _supabase_is_configured():
        try:
            if TIMELINES_FILE.exists():
                data = list(_load_local_timelines())
                updated_local = False
                for item in data:
                    if item["id"] == timeline_id:
                        item["is_shared"] = enabled
                        item["is_public"] = enabled
                        if author_name:
                            item["author_name"] = author_name
                        updated_local = True
                        break
                if updated_local:
                    _save_local_timelines(data)
            return True
        except Exception as e:
            logger.warning(f"Failed to update local timeline share flag: {e}")
            return False

    try:
        url = f"{SUPABASE_URL}/rest/v1/timelines"
        headers = _get_supabase_headers()
        headers["Prefer"] = "return=minimal"
        params = {"id": f"eq.{timeline_id}"}
        if user_id:
            # Callers pass `user_id` only for the verified owner (admins pass none).
            params["user_id"] = f"eq.{user_id}"
        payload = {"is_public": enabled, "is_shared": enabled}
        if author_name:
            payload["author_name"] = author_name

        # The listing columns only matter once the timeline is visible: unsharing reads nothing (P-14).
        meta = get_timeline_with_meta(timeline_id) if enabled else None
        if meta and meta.get("data"):
            tl_data = meta["data"]
            payload["categories"] = _extract_categories(tl_data)
            payload["tags"] = _extract_tags(tl_data)
            payload["language"] = _extract_language(tl_data)

        with _supabase_http_client() as client:
            resp = client.patch(url, headers=headers, params=params, json=payload)
            if resp.status_code in (200, 204):
                return True
            if resp.status_code == 400:
                # Retry without optional pre-migration columns (`is_shared`, `categories`, `tags`, `language`, `author_name`)
                resp_min = client.patch(url, headers=headers, params=params, json={"is_public": enabled})
                if resp_min.status_code in (200, 204):
                    return True
            logger.warning(f"Supabase set_timeline_shared status {resp.status_code}")
    except StorageUnavailableError:
        raise
    except Exception as e:
        logger.warning(f"Failed to update timeline share flag in Supabase: {e}")
    return False

_META_NOT_PROVIDED = object()


def _is_unique_violation(resp) -> bool:
    if resp.status_code == 409:
        return True
    try:
        body = resp.json()
    except Exception:
        return False
    return isinstance(body, dict) and str(body.get("code") or "") == "23505"


def _supabase_insert_timeline(timeline_id: str, owner_id: Optional[str], content: dict, rich_extra: dict) -> bool:
    """
    Plain INSERT (no merge-duplicates) of a brand-new timeline row. Returns True when inserted, or
    False when a retry hit a duplicate after an ambiguous first attempt (which may have committed).
    Raises TimelineConflictError when the id is already taken, StorageUnavailableError otherwise.
    """
    url = f"{SUPABASE_URL}/rest/v1/timelines"
    headers = {**_get_supabase_headers(), "Prefer": "return=minimal"}
    core_payload = {"id": timeline_id, **content}
    if owner_id:
        core_payload["user_id"] = owner_id
    rich_payload = {**core_payload, **rich_extra}

    last_error = None
    ambiguous = False
    for _attempt in range(2):  # one retry: covers a paused project's cold-start timeout
        try:
            with _supabase_http_client() as client:
                resp = client.post(url, headers=headers, json=rich_payload)
                if resp.status_code == 400 and not _is_unique_violation(resp):
                    # Pre-migration databases lack the optional columns: retry with the core payload.
                    resp = client.post(url, headers=headers, json=core_payload)
        except Exception as e:
            last_error = type(e).__name__
            ambiguous = True
            continue
        if resp.status_code in (200, 201, 204):
            return True
        if _is_unique_violation(resp):
            if ambiguous:
                return False
            raise TimelineConflictError("timeline id already exists")
        last_error = f"status {resp.status_code}"
        if resp.status_code >= 500:
            ambiguous = True
    logger.error(f"Timeline {timeline_id} FAILED to insert into Supabase after retry: {last_error}")
    raise StorageUnavailableError("timeline insert failed")


def _supabase_update_timeline(
    timeline_id: str,
    owner_id: Optional[str],
    content: dict,
    rich_extra: dict,
    base_updated_at: Optional[str] = None,
) -> None:
    """
    PATCH an existing row filtered by id AND its verified owner (never touching `user_id`), and
    require an affected row: zero means it was deleted or changed hands since the ownership check.
    With `base_updated_at` the row must also still carry that version (`data->>updatedAt`), so the
    check-and-write is atomic; a mismatch raises TimelineStaleWriteError (B-04).
    """
    url = f"{SUPABASE_URL}/rest/v1/timelines"
    headers = {**_get_supabase_headers(), "Prefer": "return=representation"}
    params = {
        "id": f"eq.{timeline_id}",
        "user_id": f"eq.{owner_id}" if owner_id else "is.null",
        "select": "id",
    }
    if base_updated_at:
        params["data->>updatedAt"] = f"eq.{base_updated_at}"
    rich_payload = {**content, **rich_extra}

    last_error = None
    for _attempt in range(2):  # PATCH is idempotent, so a cold-start retry is always safe
        try:
            with _supabase_http_client() as client:
                resp = client.patch(url, headers=headers, params=params, json=rich_payload)
                if resp.status_code == 400:
                    resp = client.patch(url, headers=headers, params=params, json=content)
        except Exception as e:
            last_error = type(e).__name__
            continue
        if resp.status_code == 200:
            try:
                rows = resp.json()
            except Exception:
                rows = None
            if isinstance(rows, list):
                if rows:
                    return
                if base_updated_at:
                    _raise_for_unmatched_versioned_write(timeline_id, owner_id, base_updated_at)
                raise TimelineConflictError("timeline row no longer matches its verified owner")
        last_error = f"status {resp.status_code}"
    logger.error(f"Timeline {timeline_id} FAILED to update in Supabase after retry: {last_error}")
    raise StorageUnavailableError("timeline update failed")


def _raise_for_unmatched_versioned_write(timeline_id: str, owner_id: Optional[str], base_updated_at: str) -> None:
    """A versioned PATCH matched no row: tell a stale version apart from a deleted / re-owned row."""
    fresh = get_timeline_access_meta(timeline_id)
    if not fresh or fresh.get("owner_id") != (owner_id or None):
        raise TimelineConflictError("timeline row no longer matches its verified owner")
    if fresh.get("is_deleted"):
        raise TimelineGoneError("timeline was deleted")
    if fresh.get("updated_at") != base_updated_at:
        raise TimelineStaleWriteError(fresh.get("updated_at"))
    raise TimelineConflictError("timeline row did not accept the update")


def _local_write_timeline(
    timeline: dict,
    is_new: bool,
    owner_id: Optional[str],
    base_updated_at: Optional[str] = None,
) -> None:
    """Local-JSON twin of the Supabase insert/update split (dev mode only)."""
    data = list(_load_local_timelines())
    idx = next((i for i, item in enumerate(data) if item.get("id") == timeline["id"]), None)
    record = dict(timeline)
    if is_new:
        if idx is not None:
            raise TimelineConflictError("timeline id already exists")
        if owner_id:
            record["user_id"] = owner_id
            record["is_shared"] = False
            record["is_public"] = False
        data.insert(0, record)
    else:
        if idx is None or data[idx].get("user_id") != owner_id:
            raise TimelineConflictError("timeline row no longer matches its verified owner")
        if _is_timeline_deleted(data[idx]):
            raise TimelineGoneError("timeline was deleted")
        if base_updated_at and data[idx].get("updatedAt") != base_updated_at:
            raise TimelineStaleWriteError(data[idx].get("updatedAt"))
        for key in ("user_id", "is_shared", "is_public", "author_name"):
            if key in data[idx]:
                record[key] = data[idx][key]
        data[idx] = record
    _save_local_timelines(data)


# B-11: what counts as reviewed *content* of a published Library timeline. A non-admin owner's save
# unpublishes the timeline only when this fingerprint changes. Top level: the text, structure and
# audience fields the public sees. Per event: every field except the ones below, which are cached
# lookups or display preferences that automatic / cosmetic saves touch (the Videos tab caches its
# search results; drag-to-reframe moves the image focal point). Pins, chat, quiz/who-am-I/podcast,
# Story Studio state and suggested prompts live outside these fields, so they never unpublish.
LIBRARY_CONTENT_TIMELINE_FIELDS = (
    "title", "description", "overview", "timeScale", "lanes", "timeBands", "articles",
    "isFictional", "isPersonal", "contentMode", "categories", "tags", "detectedLanguage",
)
LIBRARY_COSMETIC_ARTICLE_FIELDS = frozenset({"videos", "videosQuery", "imagePositionX", "imagePositionY"})


def _drop_empty(value: Any) -> Any:
    """None and missing compare equal, so a client omitting null fields isn't a content change."""
    if isinstance(value, dict):
        return {k: _drop_empty(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_drop_empty(v) for v in value]
    return value


def timeline_content_fingerprint(timeline: Optional[dict]) -> str:
    """Stable hash of a timeline's Library-reviewed content (see LIBRARY_CONTENT_TIMELINE_FIELDS)."""
    import hashlib

    if not isinstance(timeline, dict):
        return ""
    content: Dict[str, Any] = {}
    for key in LIBRARY_CONTENT_TIMELINE_FIELDS:
        val = timeline.get(key)
        if key == "articles":
            val = [
                {k: v for k, v in art.items() if k not in LIBRARY_COSMETIC_ARTICLE_FIELDS and not str(k).startswith("_")}
                if isinstance(art, dict) else art
                for art in (val or [])
            ]
        content[key] = val
    raw = json.dumps(_drop_empty(content), sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _save_timeline_data_impl(
    timeline: dict,
    user_id: Optional[str] = None,
    existing_meta: Any = _META_NOT_PROVIDED,
    base_updated_at: Optional[str] = None,
) -> dict:
    """
    Save timeline data to Supabase when configured (failing closed on error so private timelines
    never spill into an unowned local file), or to local JSON storage in unconfigured dev mode.
    Refuses to persist empty timelines (0 articles): EmptyTimelineError, nothing is written.

    `existing_meta` is the access meta the caller already fetched (and authorized against) for this
    id; pass None when the id is known to be new. It is looked up here only when omitted.
    - New id: plain INSERT owned by `user_id`; a taken id raises TimelineConflictError.
    - Existing id: PATCH filtered by id and the meta's owner. `user_id` is never changed, and zero
      affected rows raises TimelineConflictError.
    - A soft-deleted row is never brought back: TimelineGoneError. A Library row the owner removed
      from Saved (`hiddenFromSaved`) stays hidden while it is still published.
    - `base_updated_at` (optional) is the `updatedAt` the caller last read: when the stored row has
      moved on, TimelineStaleWriteError is raised and nothing is written. Omitted = last write wins.
    Raises StorageUnavailableError when storage can't be reached.
    """
    articles = timeline.get("articles") or []
    if not articles or len(articles) == 0:
        logger.warning(f"Refusing to save empty timeline to storage (id={timeline.get('id')}) - no articles.")
        raise EmptyTimelineError(timeline.get("id"))

    if not timeline.get("id"):
        timeline["id"] = str(uuid.uuid4())
    timeline.pop("isDeleted", None)
    timeline.pop("is_deleted", None)
    timeline.pop("deletedAt", None)
    timeline.pop("deleted_at", None)
    timeline.pop("hiddenFromSaved", None)
    timeline.pop("hidden_from_saved", None)
    # Never persist transient client-side fields inside JSONB
    timeline.pop("isShared", None)
    timeline.pop("is_shared", None)
    timeline.pop("is_public", None)

    sanitize_timeline_dates(timeline)
    enforce_inline_image_limits(timeline)
    _compress_timeline_data_images(timeline)

    timeline["updatedAt"] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
    if "createdAt" not in timeline or not timeline["createdAt"]:
        timeline["createdAt"] = timeline["updatedAt"]

    if existing_meta is _META_NOT_PROVIDED:
        existing_meta = get_timeline_access_meta(timeline["id"])
    if existing_meta is not None and not isinstance(existing_meta, dict):
        raise TypeError("existing_meta must be a dict or None")
    from services.deleted_users import UserDeletedError, is_recently_deleted

    if is_recently_deleted(user_id) or (existing_meta and is_recently_deleted(existing_meta.get("owner_id"))):
        # In-flight work of an account deleted moments ago must not recreate its data (B-13).
        raise UserDeletedError("account was deleted")
    if existing_meta is None:
        base_updated_at = None  # an INSERT has nothing to be stale against
    elif existing_meta.get("is_deleted"):
        raise TimelineGoneError("timeline was deleted")
    elif base_updated_at and existing_meta.get("updated_at") and existing_meta["updated_at"] != base_updated_at:
        # Cheap early reject; the PATCH below re-checks the version atomically.
        raise TimelineStaleWriteError(existing_meta["updated_at"])

    if existing_meta and existing_meta.get("is_library") and ("isLibrary" not in timeline and "is_library" not in timeline):
        timeline["isLibrary"] = True
        if "isFeatured" not in timeline and "is_featured" not in timeline:
            timeline["isFeatured"] = bool(existing_meta.get("is_featured"))
        if (
            "featuredOrder" not in timeline
            and "featured_order" not in timeline
            and existing_meta.get("featured_order") is not None
        ):
            timeline["featuredOrder"] = existing_meta.get("featured_order")
    if existing_meta and existing_meta.get("hidden_from_saved") and _is_timeline_in_library(timeline):
        # Still published: keep it out of the owner's Saved list. Unpublishing brings it back there.
        timeline["hiddenFromSaved"] = True
    was_library = bool((existing_meta and existing_meta.get("is_library")) or _is_timeline_in_library(timeline))

    if _supabase_is_configured():
        content = {
            "title": timeline.get("title", "Untitled Timeline"),
            "description": timeline.get("description", ""),
            "time_scale": timeline.get("timeScale", "calendar"),
            "data": timeline,
            "updated_at": timeline["updatedAt"],
        }
        rich_extra = {
            "categories": _extract_categories(timeline),
            "tags": _extract_tags(timeline),
            "language": _extract_language(timeline),
        }
        if existing_meta is None:
            # Sharing is controlled exclusively by `set_timeline_shared`: brand-new timelines start private.
            inserted = _supabase_insert_timeline(
                timeline["id"],
                user_id,
                {**content, "is_public": False},
                {**rich_extra, "is_shared": False},
            )
            if not inserted:
                # An earlier attempt timed out but may have committed: only adopt the row if it is ours.
                existing_meta = get_timeline_access_meta(timeline["id"])
                if not existing_meta or existing_meta.get("owner_id") != (user_id or None):
                    raise TimelineConflictError("timeline id already exists")
                _supabase_update_timeline(timeline["id"], existing_meta.get("owner_id"), content, rich_extra)
        else:
            # Updates omit is_public/is_shared, so a save can never change the sharing state.
            _supabase_update_timeline(
                timeline["id"], existing_meta.get("owner_id"), content, rich_extra,
                base_updated_at=base_updated_at,
            )
        logger.info(f"Timeline {timeline['id']} successfully saved to Supabase")

        if was_library:
            invalidate_library_cache(timeline["id"])
        return timeline

    # Local JSON storage (ONLY when Supabase is unconfigured)
    is_new = existing_meta is None
    try:
        _local_write_timeline(
            timeline,
            is_new=is_new,
            owner_id=(user_id or None) if is_new else existing_meta.get("owner_id"),
            base_updated_at=base_updated_at,
        )
    except (TimelineConflictError, TimelineGoneError):
        raise
    except Exception as e:
        logger.error(f"Error saving to local timelines file: {e}")

    if was_library:
        invalidate_library_cache(timeline["id"])

    return timeline

def _delete_timeline_data_impl(timeline_id: str, user_id: Optional[str] = None, force_delete: bool = False) -> bool:
    """
    Soft-delete timeline data in Supabase (or local storage when Supabase is unconfigured)
    so the record remains visible in the Admin Panel with a deleted indicator.
    If the timeline is published in the Public Library (`isLibrary=True`) and `force_delete` is False,
    it is NEVER removed from the Public Library or soft-deleted; instead it is marked `hiddenFromSaved=True`
    so it disappears from the user's personal 'Saved Timelines' list while staying live in the Public Library.
    """
    deleted = False
    was_library = False
    deleted_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            params = {"id": f"eq.{timeline_id}", "select": "id,data"}
            if user_id:
                params["user_id"] = f"eq.{user_id}"

            with _supabase_http_client() as client:
                get_resp = client.get(url, headers=headers, params=params)
                if get_resp.status_code == 200:
                    rows = get_resp.json()
                    if rows:
                        row_data = dict(rows[0].get("data") or {})
                        _compress_timeline_data_images(row_data)
                        in_library = _is_timeline_in_library(row_data)
                        patch_headers = {**headers, "Prefer": "return=minimal"}
                        patch_params = {"id": f"eq.{timeline_id}"}
                        if user_id:
                            patch_params["user_id"] = f"eq.{user_id}"
                        if in_library and not force_delete:
                            row_data["hiddenFromSaved"] = True
                            row_data.pop("isDeleted", None)
                            row_data.pop("is_deleted", None)
                            row_data.pop("deletedAt", None)
                            row_data.pop("deleted_at", None)
                            resp = client.patch(
                                url,
                                headers=patch_headers,
                                params=patch_params,
                                json={"data": row_data},
                            )
                        else:
                            was_library = in_library
                            row_data["isDeleted"] = True
                            row_data["deletedAt"] = deleted_at
                            row_data["isShared"] = False
                            row_data["is_shared"] = False
                            row_data["is_public"] = False
                            row_data["isLibrary"] = False
                            row_data["isFeatured"] = False
                            row_data.pop("featuredOrder", None)
                            row_data.pop("featured_order", None)
                            resp = client.patch(
                                url,
                                headers=patch_headers,
                                params=patch_params,
                                json={"data": row_data, "is_public": False, "is_shared": False},
                            )
                            if resp.status_code == 400:
                                resp = client.patch(
                                    url,
                                    headers=patch_headers,
                                    params=patch_params,
                                    json={"data": row_data, "is_public": False},
                                )
                        if resp.status_code in (200, 204):
                            deleted = True
        except Exception as e:
            logger.warning(f"Supabase soft-delete failed: {e}")
        if deleted and was_library:
            invalidate_library_cache(timeline_id)
        return deleted

    try:
        data = list(_load_local_timelines())
        updated_local = False
        for item in data:
            if item.get("id") == timeline_id:
                if user_id and item.get("user_id") not in (None, user_id):
                    continue
                in_library = _is_timeline_in_library(item)
                if in_library and not force_delete:
                    item["hiddenFromSaved"] = True
                    item.pop("isDeleted", None)
                    item.pop("is_deleted", None)
                    item.pop("deletedAt", None)
                    item.pop("deleted_at", None)
                else:
                    was_library = in_library
                    item["isDeleted"] = True
                    item["deletedAt"] = deleted_at
                    item["isShared"] = False
                    item["is_shared"] = False
                    item["is_public"] = False
                    item["isLibrary"] = False
                    item["isFeatured"] = False
                    item.pop("featuredOrder", None)
                    item.pop("featured_order", None)
                updated_local = True
                break
        if updated_local:
            _save_local_timelines(data)
            deleted = True
    except Exception:
        pass

    if deleted and was_library:
        invalidate_library_cache(timeline_id)
    return deleted

def _library_rehome_owner(deleted_user_id: str) -> Optional[str]:
    """Owner for Library rows kept after a hard account delete (never the account being deleted)."""
    system_owner = get_system_owner_user_id()
    return system_owner if system_owner and system_owner != deleted_user_id else None


# PostgREST filter for "not a Library row": rows without the flag (NULL) must match too, so a plain
# `data->>isLibrary=not.eq.true` (which drops NULLs) would leave every ordinary timeline behind.
_NOT_LIBRARY_FILTER = {"or": "(data->>isLibrary.is.null,data->>isLibrary.not.in.(true,1))"}

# Kept Library rows outlive the account: no trace of who wrote them (B-13).
_AUTHOR_FIELDS = ("authorName", "author_name", "authorEmail", "author_email", "authorAvatar", "author_avatar")


def _scrub_library_author(row_data: dict) -> None:
    for key in _AUTHOR_FIELDS:
        row_data.pop(key, None)


def _rehome_library_row(client, url: str, patch_headers: dict, row_id: str, user_id: str,
                        library_owner: Optional[str], row_data: dict) -> None:
    """Detaches one Library row from a deleted account; raises StorageUnavailableError unless it stuck."""
    row_data["hiddenFromSaved"] = True
    _scrub_library_author(row_data)
    params = {"id": f"eq.{row_id}", "user_id": f"eq.{user_id}"}
    resp = client.patch(url, headers=patch_headers, params=params,
                        json={"user_id": library_owner, "data": row_data, "author_name": None})
    if resp.status_code == 400:
        # Pre-migration schema without the `author_name` column.
        resp = client.patch(url, headers=patch_headers, params=params,
                            json={"user_id": library_owner, "data": row_data})
    if resp.status_code not in (200, 204):
        raise StorageUnavailableError(f"library row re-home failed: HTTP {resp.status_code}")


def _delete_all_user_timelines_impl(user_id: str, include_unowned_local: bool = False, hard_delete: bool = False) -> bool:
    """
    Deletes all timelines belonging to user_id from Supabase (or local storage in dev mode).
    By default performs a soft-delete so records remain visible in the Admin Panel;
    pass hard_delete=True when permanently deleting a user account.
    Timelines published in the Public Library (`isLibrary=True`) are NEVER deleted or unpublished:
    when `hard_delete=False`, they are marked `hiddenFromSaved=True` (hiding them from the user's
    personal Saved Timelines list while remaining live in the Public Library); when `hard_delete=True`,
    their `user_id` is re-homed to `SYSTEM_OWNER_USER_ID` (or detached to `None`, which is admin-only)
    so the Public Library retains them.
    """
    if not user_id:
        return False

    deleted_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"

    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            params = {"user_id": f"eq.{user_id}"}
            with _supabase_http_client() as client:
                get_resp = client.get(url, headers=headers, params={**params, "select": "id,data"})
                rows = get_resp.json() if get_resp.status_code == 200 else []
                patch_headers = {**headers, "Prefer": "return=minimal"}

                if hard_delete:
                    # B-14: without a complete read and every Library row detached first, the DELETE
                    # below would destroy curated Library timelines. Abort instead (503, retryable).
                    if get_resp.status_code != 200 or not isinstance(rows, list):
                        raise StorageUnavailableError(f"timeline read failed: HTTP {get_resp.status_code}")
                    library_owner = _library_rehome_owner(user_id)
                    for row in rows:
                        row_data = dict(row.get("data") or {})
                        if _is_timeline_in_library(row_data):
                            _rehome_library_row(client, url, patch_headers, row["id"], user_id, library_owner, row_data)
                    resp = client.delete(url, headers=headers, params={**params, **_NOT_LIBRARY_FILTER})
                    if resp.status_code not in (200, 204):
                        logger.warning(f"Supabase delete_all_user_timelines status {resp.status_code}")
                        return False
                    # Also purge any saved timeline chat histories owned by this user
                    client.delete(
                        f"{SUPABASE_URL}/rest/v1/timeline_chats",
                        headers={**headers, "Prefer": "return=minimal"},
                        params={"user_id": f"eq.{user_id}"},
                    )
                else:
                    if get_resp.status_code != 200:
                        return False
                    for row in rows:
                        row_data = dict(row.get("data") or {})
                        if _is_timeline_deleted(row_data):
                            continue
                        if _is_timeline_in_library(row_data):
                            if _is_hidden_from_saved(row_data):
                                continue
                            _compress_timeline_data_images(row_data)
                            row_data["hiddenFromSaved"] = True
                            client.patch(
                                url,
                                headers=patch_headers,
                                params={"id": f"eq.{row['id']}", "user_id": f"eq.{user_id}"},
                                json={"data": row_data},
                            )
                            continue
                        _compress_timeline_data_images(row_data)
                        row_data["isDeleted"] = True
                        row_data["deletedAt"] = deleted_at
                        row_data["isShared"] = False
                        row_data["is_shared"] = False
                        row_data["is_public"] = False
                        row_data["isLibrary"] = False
                        row_data["isFeatured"] = False
                        row_data.pop("featuredOrder", None)
                        row_data.pop("featured_order", None)
                        r = client.patch(
                            url,
                            headers=patch_headers,
                            params={"id": f"eq.{row['id']}", "user_id": f"eq.{user_id}"},
                            json={"data": row_data, "is_public": False, "is_shared": False},
                        )
                        if r.status_code == 400:
                            client.patch(
                                url,
                                headers=patch_headers,
                                params={"id": f"eq.{row['id']}", "user_id": f"eq.{user_id}"},
                                json={"data": row_data, "is_public": False},
                            )
            return True
        except StorageUnavailableError:
            raise
        except Exception as e:
            logger.warning(f"Supabase delete_all_user_timelines failed: {e}")
            if hard_delete:
                raise StorageUnavailableError("timeline delete failed") from e
            return False

    # Local storage cleanup (when Supabase is unconfigured)
    try:
        if TIMELINES_FILE.exists():
            data = list(_load_local_timelines())
            if hard_delete:
                filtered = []
                changed = False
                for item in data:
                    matches_owner = item.get("user_id") == user_id or (include_unowned_local and item.get("user_id") is None)
                    if matches_owner:
                        if _is_timeline_in_library(item):
                            item["user_id"] = _library_rehome_owner(user_id)
                            item["hiddenFromSaved"] = True
                            _scrub_library_author(item)
                            filtered.append(item)
                            changed = True
                        else:
                            changed = True
                    else:
                        filtered.append(item)
                if changed:
                    _save_local_timelines(filtered)
            else:
                updated_local = False
                for item in data:
                    if item.get("user_id") == user_id or (include_unowned_local and item.get("user_id") is None):
                        if not _is_timeline_deleted(item):
                            if _is_timeline_in_library(item):
                                if not _is_hidden_from_saved(item):
                                    item["hiddenFromSaved"] = True
                                    updated_local = True
                            else:
                                item["isDeleted"] = True
                                item["deletedAt"] = deleted_at
                                item["isShared"] = False
                                item["is_shared"] = False
                                item["is_public"] = False
                                item["isLibrary"] = False
                                item["isFeatured"] = False
                                item.pop("featuredOrder", None)
                                item.pop("featured_order", None)
                                updated_local = True
                if updated_local:
                    _save_local_timelines(data)
    except Exception as e:
        logger.warning(f"Failed cleaning local storage for user {user_id}: {e}")

    return True


def _transfer_user_timelines_impl(from_user_id: str, to_user_id: str) -> Optional[List[str]]:
    """
    Re-assigns every timeline (and its saved chat) owned by from_user_id to to_user_id.
    Caller MUST have proven ownership of from_user_id. Returns the moved timeline ids,
    or None when the store is unavailable / the update failed.
    """
    if not from_user_id or not to_user_id or from_user_id == to_user_id:
        return []
    if not _supabase_is_configured():
        return None
    headers = _get_supabase_headers()
    headers["Prefer"] = "return=representation"
    try:
        with _supabase_http_client() as client:
            resp = client.patch(
                f"{SUPABASE_URL}/rest/v1/timelines",
                headers=headers,
                params={"user_id": f"eq.{from_user_id}", "select": "id"},
                json={"user_id": to_user_id},
            )
            if resp.status_code not in (200, 204):
                logger.warning(f"Supabase transfer_user_timelines status {resp.status_code}: {resp.text}")
                return None
            moved = [row.get("id") for row in (resp.json() if resp.status_code == 200 else []) if row.get("id")]

            chat_headers = _get_supabase_headers()
            chat_headers["Prefer"] = "return=minimal"
            chat_resp = client.patch(
                f"{SUPABASE_URL}/rest/v1/timeline_chats",
                headers=chat_headers,
                params={"user_id": f"eq.{from_user_id}"},
                json={"user_id": to_user_id},
            )
            if chat_resp.status_code not in (200, 204):
                logger.warning(f"Supabase transfer chats status {chat_resp.status_code}: {chat_resp.text}")
            return moved
    except Exception as e:
        logger.warning(f"Supabase transfer_user_timelines failed: {e}")
    return None


# ---- Timeline chat conversations ("Chat with Timeline") ----
# One row per (user, timeline) in public.timeline_chats. Supabase-only: without it the
# frontend's localStorage copy is the only store, so these helpers return None / False.

def list_user_timeline_ids(user_id: str) -> List[str]:
    """
    Ids of EVERY row `user_id` owns: deleted, empty and hidden-from-Saved Library rows included
    (account deletion must find their podcasts too). Raises StorageUnavailableError on failure.
    """
    if not user_id:
        return []
    if _supabase_is_configured():
        ids: List[str] = []
        try:
            with _supabase_http_client() as client:
                offset = 0
                while True:
                    resp = client.get(
                        f"{SUPABASE_URL}/rest/v1/timelines",
                        headers=_get_supabase_headers(),
                        params={"user_id": f"eq.{user_id}", "select": "id", "order": "id.asc",
                                "limit": "1000", "offset": str(offset)},
                    )
                    if resp.status_code != 200:
                        raise StorageUnavailableError(f"timeline id listing failed: HTTP {resp.status_code}")
                    rows = resp.json() or []
                    ids.extend(str(r["id"]) for r in rows if isinstance(r, dict) and r.get("id"))
                    if len(rows) < 1000:
                        return ids
                    offset += 1000
        except StorageUnavailableError:
            raise
        except Exception as e:
            raise StorageUnavailableError("timeline id listing failed") from e
    return [str(t["id"]) for t in _load_local_timelines() if t.get("user_id") == user_id and t.get("id")]


def get_timeline_owner(timeline_id: str) -> Optional[dict]:
    """Lightweight ownership lookup (no heavy `data` column). Returns {"owner_id"} or None if missing."""
    if not _supabase_is_configured():
        return None
    try:
        with _supabase_http_client() as client:
            resp = client.get(
                f"{SUPABASE_URL}/rest/v1/timelines",
                headers=_get_supabase_headers(),
                params={"id": f"eq.{timeline_id}", "select": "id,user_id"},
            )
            if resp.status_code == 200:
                rows = resp.json()
                return {"owner_id": rows[0].get("user_id")} if rows else None
            logger.warning(f"Supabase get_timeline_owner status {resp.status_code}: {resp.text}")
    except Exception as e:
        logger.warning(f"Supabase get_timeline_owner failed: {e}")
    return None


def get_timeline_chat(timeline_id: str, user_id: str) -> Optional[dict]:
    """
    Returns {"messages": [...], "updatedAt": str|None} for this user's conversation
    (empty list if none saved yet), or None when the store is unavailable.
    """
    if not _supabase_is_configured() or not user_id:
        return None
    try:
        with _supabase_http_client() as client:
            resp = client.get(
                f"{SUPABASE_URL}/rest/v1/timeline_chats",
                headers=_get_supabase_headers(),
                params={
                    "timeline_id": f"eq.{timeline_id}",
                    "user_id": f"eq.{user_id}",
                    "select": "messages,updated_at",
                },
            )
            if resp.status_code == 200:
                rows = resp.json()
                if not rows:
                    return {"messages": [], "updatedAt": None}
                return {"messages": rows[0].get("messages") or [], "updatedAt": rows[0].get("updated_at")}
            logger.warning(f"Supabase get_timeline_chat status {resp.status_code}: {resp.text}")
    except Exception as e:
        logger.warning(f"Supabase get_timeline_chat failed: {e}")
    return None


def save_timeline_chat(timeline_id: str, user_id: str, messages: list) -> bool:
    """Upserts this user's conversation for a timeline. Returns True on success."""
    if not _supabase_is_configured() or not user_id:
        return False
    headers = _get_supabase_headers()
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
    payload = {
        "timeline_id": timeline_id,
        "user_id": user_id,
        "messages": messages,
        "updated_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
    }
    try:
        with _supabase_http_client() as client:
            resp = client.post(
                f"{SUPABASE_URL}/rest/v1/timeline_chats",
                headers=headers,
                params={"on_conflict": "user_id,timeline_id"},
                json=payload,
            )
            if resp.status_code in (200, 201, 204):
                return True
            logger.warning(f"Supabase save_timeline_chat status {resp.status_code}: {resp.text}")
    except Exception as e:
        logger.warning(f"Supabase save_timeline_chat failed: {e}")
    return False


CURATED_DOMAINS = [
    {
        "key": "history",
        "label": "History & Politics",
        "aliases": [
            "history", "politics", "political", "war", "ancient", "medieval", "modern history", "empire", "revolution", "diplomacy", "treaty", "monarchy", "president",
            "historia", "política", "imperio", "revolución", "monarquía", "presidente", "diplomacia", "tratado",
            "histoire", "politique", "révolution", "président", "diplomatie", "traité", "moyen âge",
            "geschichte", "politik", "kaiserreich", "monarchie", "vertrag", "mittelalter",
            "história", "político", "império", "revolução",
            "تاريخ", "سياسة", "سياسي", "إمبراطورية", "ثورة", "معاهدة",
            "היסטוריה", "פוליטיקה", "מדיני", "אימפריה", "מהפכה", "דיפלומטיה", "הסכם", "מלוכה", "נשיא", "ראש ממשלה", "תולדות", "ימי הביניים"
        ]
    },
    {
        "key": "technology",
        "label": "Science & Technology",
        "aliases": [
            "technology", "tech", "computing", "computer", "internet", "software", "ai", "hardware", "engineering", "telecom", "electronics", "robotics", "science", "physics", "physicist", "chemistry", "mathematics", "einstein", "discovery",
            "ciencia", "tecnología", "informática", "computación", "inteligencia artificial", "ingeniería", "física", "química", "matemáticas", "científico",
            "technologie", "ordinateur", "logiciel", "physique", "chimie", "mathématiques", "scientifique",
            "wissenschaft", "technik", "rechner", "informatik", "mathematik", "wissenschaftler",
            "ciência", "computador", "engenharia", "matemática",
            "علم", "تكنولوجيا", "تقنية", "حاسوب", "ذكاء اصطناعي", "هندسة", "فيزياء", "كيمياء", "رياضيات",
            "מדע", "טכנולוגיה", "מחשבים", "מחשוב", "אינטרנט", "תוכנה", "בינה מלאכותית", "הנדסה", "פיזיקה", "כימיה", "מתמטיקה", "רפואה", "המצאות", "חדשנות"
        ]
    },
    {
        "key": "space",
        "label": "Space & Aviation",
        "aliases": [
            "space", "astronomy", "aviation", "flight", "aerospace", "nasa", "planet", "rocket", "cosmic", "satellite", "moon", "apollo",
            "espacio", "astronomía", "aviación", "vuelo", "aeroespacial", "cohete", "satélite", "luna", "cosmos",
            "espace", "astronomie", "fusée", "lune", "astronautique",
            "raumfahrt", "weltraum", "luftfahrt", "rakete", "satellit", "mond", "kosmos",
            "espaço", "aviação", "foguete",
            "فضاء", "علم الفلك", "طيران", "صاروخ", "قمر صناعي",
            "חלל", "אסטרונומיה", "תעופה", "טיסה", "כוכב לכת", "טיל", "לוויין", "ירח", "אפולו", "יקום", "קוסמוס"
        ]
    },
    {
        "key": "geography",
        "label": "Geography & Nations",
        "aliases": [
            "geography", "nations", "countries", "america", "usa", "united states", "europe", "asia", "israel", "middle east", "africa", "cities", "britain", "france", "germany", "japan", "vikings", "viking", "nordic", "scandinavia",
            "geografía", "naciones", "países", "estados unidos", "oriente medio", "vikingos", "escandinavia",
            "géographie", "pays", "états-unis", "moyen-orient", "scandinavie",
            "geographie", "länder", "staaten", "wikinger", "skandinavien",
            "geografia", "nações", "países", "escandinávia",
            "جغرافيا", "أمم", "دول", "بلدان", "الشرق الأوسط", "فايكنج", "إسكندنافيا",
            "גאוגרפיה", "גיאוגרפיה", "מדינות", "עמים", "אמריקה", "ארצות הברית", "אירופה", "אסיה", "ישראל", "ציונות", "המזרח התיכון", "אפריקה", "ערים", "ירושלים"
        ]
    },
    {
        "key": "nature",
        "label": "Nature & Evolution",
        "aliases": [
            "nature", "evolution", "biology", "animals", "earth", "paleontology", "prehistory", "environment", "species", "fauna", "flora", "geology", "horse", "dinosaur", "volcano", "volcanoes", "eruption", "geological",
            "naturaleza", "evolución", "biología", "animales", "tierra", "paleontología", "prehistoria", "fósiles", "dinosaurios", "volcán", "volcanes",
            "évolution", "animaux", "paléontologie", "préhistoire", "espèces", "dinosaures",
            "evolution", "tiere", "erde", "paläontologie", "urgeschichte", "dinosaurier", "vulkan",
            "natureza", "evolução", "fósseis", "dinossauros",
            "طبيعة", "تطور", "أحياء", "حيوانات", "أحافير", "ديناصورات", "بركان",
            "טבע", "אבולוציה", "ביולוגיה", "בעלי חיים", "כדור הארץ", "פרהיסטוריה", "סביבה", "אקלים", "גאולוגיה", "דינוזאורים", "הר געש", "הכחדה"
        ]
    },
    {
        "key": "arts",
        "label": "Arts & Culture",
        "aliases": [
            "arts", "culture", "art", "music", "cinema", "literature", "painting", "architecture", "theatre", "film", "sculpture", "fashion",
            "arte", "cultura", "música", "cine", "literatura", "pintura", "arquitectura", "teatro", "escultura",
            "musique", "littérature", "peinture", "sculpture",
            "kunst", "kultur", "malerei", "architektur", "theater", "bildhauerei",
            "música", "arquitetura",
            "فن", "فنون", "ثقافة", "موسيقى", "سينما", "أدب", "رسم", "عمارة", "مسرح",
            "אמנות", "אומנות", "תרבות", "מוזיקה", "קולנוע", "ספרות", "ציור", "אדריכלות", "תיאטרון", "פיסול", "אופנה", "ספורט"
        ]
    },
    {
        "key": "biography",
        "label": "Biographies & Figures",
        "aliases": [
            "biography", "biographies", "people", "figures", "leaders", "scientists", "artists", "life of", "inventor", "philosopher", "albert", "einstein", "dirac",
            "biografía", "biografías", "personajes", "líderes", "vida de", "inventor",
            "biographies", "dirigeants", "vie de", "penseur",
            "biografie", "biografien", "persönlichkeiten", "lebensgeschichte", "erfinder",
            "biografia",
            "سيرة", "سيرة ذاتية", "شخصيات", "قادة", "مخترع",
            "ביוגרפיה", "ביוגרפיות", "דמויות", "מנהיגים", "מדענים", "אמנים", "חייו של", "חייה של", "ממציא"
        ]
    },
    {
        "key": "military",
        "label": "Military & Wars",
        "aliases": [
            "military", "war", "battle", "weapons", "army", "conflict", "navy", "conquest", "invasion", "crusade", "six-day", "six day",
            "militar", "guerra", "batalla", "armas", "ejército", "conflicto", "armada", "conquista", "invasión", "cruzada", "bélico",
            "militaire", "guerre", "bataille", "armée", "conquête", "croisade",
            "militär", "krieg", "schlacht", "waffen", "armee", "heer", "eroberung", "kreuzzug",
            "batalha", "exército", "invasão",
            "عسكري", "حرب", "معركة", "أسلحة", "جيش", "صراع", "غزو", "احتلال",
            "צבא", "מלחמה", "מלחמת", "קרב", "נשק", "ביטחון", "פלישה", "מבצע"
        ]
    },
    {
        "key": "business",
        "label": "Economy & Business",
        "aliases": [
            "business", "economy", "finance", "trade", "industry", "money", "markets", "commerce", "capitalism", "silicon valley",
            "economía", "económico", "negocios", "finanzas", "comercio", "industria", "dinero", "mercados",
            "économie", "économique", "affaires", "finance", "marchés",
            "wirtschaft", "finanzen", "handel", "märkte", "unternehmen",
            "economia", "negócios",
            "اقتصاد", "اقتصادي", "أعمال", "تمويل", "تجارة", "صناعة", "أسواق",
            "כלכלה", "עסקים", "פיננסים", "מסחר", "תעשייה", "כסף", "שוק ההון", "הייטק", "יזמות"
        ]
    },
    {
        "key": "society",
        "label": "Society & Philosophy",
        "aliases": [
            "society", "philosophy", "religion", "social", "movements", "law", "ethics", "rights", "education", "schools of thought", "greece", "ancient greece", "plato", "aristotle",
            "sociedad", "social", "filosofía", "religión", "leyes", "ética", "derechos", "educación", "platón", "aristóteles",
            "société", "philosophie", "droits", "éthique", "éducation", "platon", "aristote",
            "gesellschaft", "sozial", "rechte", "bildung", "aristoteles",
            "sociedade", "filosofia", "religião", "direitos",
            "مجتمع", "فلسفة", "دين", "قانون", "أخلاق", "حقوق", "تعليم", "أفلاطون", "أرسطو",
            "חברה", "פילוסופיה", "דת", "יהדות", "נצרות", "אסלאם", "משפט", "חוק", "זכויות", "חינוך", "הגות", "יוון העתיקה"
        ]
    },
    {
        "key": "personal",
        "label": "Personal & Family Stories",
        "aliases": [
            "personal & family", "personal & family stories", "personal story", "personal stories", "family story", "family stories", "family tree", "family roots", "wedding timeline",
            "historia familiar", "árbol genealógico", "historia personal",
            "histoire familiale", "arbre généalogique", "histoire personnelle",
            "familiengeschichte", "stammbaum", "persönliche geschichte",
            "história familiar", "árvore genealógica",
            "قصة عائلية", "شجرة العائلة", "قصة شخصية",
            "סיפורים אישיים", "סיפורים אישיים ומשפחה", "סיפור אישי", "סיפור משפחתי", "עץ משפחה", "שורשים משפחתיים", "ציר אישי"
        ]
    }
]


# Characters that delimit a whole-word alias match; Hebrew matches also accept '-' and a one-letter
# prefix (ה/ו/ב/כ/ל/מ/ש). Kept byte-for-byte equal to the original per-alias patterns.
_ALIAS_EDGE_CHARS = r'\s\.,!?:;"\'\(\)\[\]/\\'
_HEB_ALIAS_EDGE_CHARS = r'\s\.,!?:;\"\'\(\)\[\]/\\\-'
_HEBREW_CHAR_RE = re.compile(r'[\u0590-\u05FF]')


class _AliasMatcher:
    """
    Precompiled equivalent of `any(_alias_matches(a, text) for a in aliases)`: one alternation
    regex per match rule instead of ~3 fresh patterns per alias (which thrashed `re`'s 512-entry
    cache and recompiled on almost every call).
    """

    __slots__ = ("substrings", "delimited", "hebrew", "word")

    def __init__(self, aliases) -> None:
        normalized: List[str] = []
        for raw in aliases:
            alias = str(raw).lower().strip()
            if alias and alias not in normalized:
                normalized.append(alias)
        self.substrings = tuple(a for a in normalized if " " in a or "-" in a or '"' in a)
        bounded = [a for a in normalized if a not in self.substrings]
        hebrew = [a for a in bounded if _HEBREW_CHAR_RE.search(a) and len(a) >= 3]

        def _alt(items: List[str]) -> str:
            return "|".join(re.escape(a) for a in items)

        self.delimited = re.compile(
            r'(?:^|[' + _ALIAS_EDGE_CHARS + r'])(?:' + _alt(bounded) + r')(?:$|[' + _ALIAS_EDGE_CHARS + r'])'
        ) if bounded else None
        self.hebrew = re.compile(
            r'(?:^|[' + _HEB_ALIAS_EDGE_CHARS + r'])[הובכלמש]?(?:' + _alt(hebrew) + r')(?:$|[' + _HEB_ALIAS_EDGE_CHARS + r'])'
        ) if hebrew else None
        self.word = re.compile(r'\b(?:' + _alt(bounded) + r')\b') if bounded else None

    def matches(self, text: str) -> bool:
        text = text.lower()
        if any(a in text for a in self.substrings):
            return True
        for pattern in (self.delimited, self.hebrew, self.word):
            if pattern is not None and pattern.search(text):
                return True
        return False


@lru_cache(maxsize=1024)
def _single_alias_matcher(alias: str) -> _AliasMatcher:
    return _AliasMatcher((alias,))


@lru_cache(maxsize=1)
def _curated_domain_matchers() -> Tuple[Tuple[dict, _AliasMatcher], ...]:
    return tuple((d, _AliasMatcher(d["aliases"])) for d in CURATED_DOMAINS)


def _alias_matches(alias: str, text: str) -> bool:
    return _single_alias_matcher(alias).matches(text)


def _extract_categories(data: dict) -> List[str]:
    """
    Extract 1-3 categories from explicit timeline fields or infer them smartly from
    articles, lanes, title, and description across multiple languages.
    Personal timelines (`isPersonal=True`) always receive 'Personal & Family Stories'
    as their primary category and do not auto-infer historical domains unless explicitly set.
    """
    is_personal = bool((data or {}).get("isPersonal") or (data or {}).get("is_personal"))
    explicit = (data or {}).get("categories")
    if explicit and isinstance(explicit, list) and len(explicit) > 0:
        cleaned = [str(c).strip() for c in explicit if str(c).strip()]
        if cleaned:
            if is_personal:
                if "personal" not in _get_category_keys(cleaned):
                    return ["Personal & Family Stories", *cleaned][:3]
            return cleaned[:3]

    if is_personal:
        return ["Personal & Family Stories"]

    text_corpus = (
        f"{(data or {}).get('title', '')} {(data or {}).get('description', '')} " +
        " ".join([str(a.get('category', '')) + " " + str(a.get('title', '')) for a in ((data or {}).get('articles') or [])[:25]])
    ).lower()

    matched = []
    for domain, matcher in _curated_domain_matchers():
        if matcher.matches(text_corpus) and domain["label"] not in matched:
            matched.append(domain["label"])
        if len(matched) >= 3:
            break

    if not matched:
        matched = ["History & Politics"]
    return matched


def _extract_tags(data: dict) -> List[str]:
    """
    Extract 3-5 tags from explicit timeline fields or infer them smartly from
    title, article categories, and key historical/scientific terms across all languages.
    """
    explicit = (data or {}).get("tags")
    if explicit and isinstance(explicit, list) and len(explicit) > 0:
        cleaned = [str(t).strip().lstrip('#') for t in explicit if str(t).strip()]
        if len(cleaned) >= 3:
            return cleaned[:5]
        inferred = list(cleaned)
    else:
        inferred = []

    title = str((data or {}).get("title", "")).strip()
    desc = str((data or {}).get("description", "")).strip()
    articles = (data or {}).get("articles") or []

    # 1. Add article event categories (high-value themes)
    for a in articles:
        if isinstance(a, dict):
            c = a.get("category")
            if c and isinstance(c, str):
                c_clean = c.strip().lstrip('#')
                if c_clean and c_clean not in inferred and len(c_clean) > 2:
                    inferred.append(c_clean)
                    if len(inferred) >= 5:
                        break

    # 2. Multilingual entity keywords mapping
    multilingual_entity_keywords = [
        ("Albert Einstein", ["albert einstein", "einstein"]),
        ("Physics", ["physics", "quantum", "relativity"]),
        ("Science", ["science", "scientific"]),
        ("Biography", ["biography", "life of"]),
        ("Six-Day War", ["six-day war", "six day war"]),
        ("Israel", ["israel", "idf"]),
        ("Middle East", ["middle east"]),
        ("Military History", ["military", "war", "battle"]),
        ("Vikings", ["vikings", "viking"]),
        ("Scandinavia", ["scandinavia", "nordic"]),
        ("Medieval", ["medieval", "middle ages"]),
        ("Ancient Greece", ["ancient greece", "greece"]),
        ("Philosophy", ["philosophy", "philosophers"]),
        ("Ancient Rome", ["rome", "roman empire"]),
        ("Space Exploration", ["space", "nasa", "apollo", "moon"]),
        ("Geology", ["geology", "volcano", "earth"]),
        ("Evolution", ["evolution", "prehistory", "paleontology"]),
        ("Aviation", ["aviation", "aircraft", "flight"])
    ]

    text_corpus = f"{title} {desc}".lower()
    for tag_name, kws in multilingual_entity_keywords:
        for kw in kws:
            if _alias_matches(kw, text_corpus):
                if tag_name not in inferred and not any(kw in str(ex).lower() for ex in inferred):
                    inferred.append(tag_name)
                break
        if len(inferred) >= 5:
            break

    # 3. Extract meaningful phrases from title if under 3 tags
    if len(inferred) < 3 and title:
        parts = [p.strip() for p in re.split(r'[:â€“â€”\-]', title) if p.strip()]
        for part in parts:
            if len(inferred) >= 5:
                break
            if 3 < len(part) < 28 and part not in inferred:
                inferred.append(part)

    # 4. Fill to at least 3 with curated domain-specific tags
    if len(inferred) < 3:
        cats = _extract_categories(data)
        domain_fallbacks = {
            "Military & Wars": ["MilitaryHistory", "Conflicts", "ArmedForces"],
            "Science & Technology": ["Science", "Innovation", "Research"],
            "Biographies & Figures": ["Biography", "HistoricalFigures", "Leaders"],
            "Geography & Nations": ["WorldHistory", "Civilizations", "Nations"],
            "Nature & Evolution": ["Nature", "Evolution", "EarthHistory"],
            "Society & Philosophy": ["Philosophy", "Society", "Culture"],
            "Space & Aviation": ["Space", "Aviation", "Cosmos"],
            "Arts & Culture": ["Culture", "ArtHistory", "Heritage"],
            "Economy & Business": ["Economy", "Commerce", "Industry"],
            "Personal & Family Stories": ["FamilyStory", "PersonalTimeline", "Memories"],
        }
        for cat in cats:
            for fallback in domain_fallbacks.get(cat, ["History", "WorldEvents", "Chronology"]):
                if fallback not in inferred:
                    inferred.append(fallback)
                    if len(inferred) >= 3:
                        break
            if len(inferred) >= 3:
                break

    return inferred[:5]


@lru_cache(maxsize=4096)
def _category_keys_for(cat_lower: str) -> Tuple[str, ...]:
    keys: List[str] = []
    for d, matcher in _curated_domain_matchers():
        if d["key"] == cat_lower or d["label"].lower() == cat_lower or matcher.matches(cat_lower):
            if d["key"] not in keys:
                keys.append(d["key"])
    return tuple(keys)


def _get_category_keys(categories: List[str]) -> List[str]:
    """Map category display names or aliases to standard keys."""
    keys = []
    for cat in categories:
        for key in _category_keys_for(str(cat).lower()):
            if key not in keys:
                keys.append(key)
    return keys


def _extract_language(data: dict) -> str:
    """
    Detect the natural language of the timeline from text script or explicit metadata.
    Supports all 11 languages (he, ar, hi, ko, ja, zh, ru, es, fr, de, pt, en).
    """
    text = f"{(data or {}).get('title', '')} {(data or {}).get('description', '')}"
    articles = (data or {}).get("articles") or []
    if articles and isinstance(articles, list):
        text += " " + " ".join([f"{a.get('title', '')} {a.get('subtitle', '')}" for a in articles[:5] if isinstance(a, dict)])

    # 1. Distinct non-Latin script detection takes absolute priority over any English default:
    if re.search(r'[\u0590-\u05FF]', text):
        return 'he'
    if re.search(r'[\u0600-\u06FF]', text):
        return 'ar'
    if re.search(r'[\u0900-\u097F]', text):
        return 'hi'
    if re.search(r'[\uAC00-\uD7AF]', text):
        return 'ko'
    if re.search(r'[\u3040-\u30FF]', text):
        return 'ja'
    if re.search(r'[\u4E00-\u9FFF]', text):
        return 'zh'
    if re.search(r'[\u0400-\u04FF]', text):
        return 'ru'

    # 2. Check explicit detected_language or language if valid 2-letter code
    lang = (data or {}).get("detectedLanguage") or (data or {}).get("detected_language") or (data or {}).get("language")
    if lang and isinstance(lang, str) and len(lang.strip()) == 2:
        lang_code = lang.strip().lower()
        if lang_code != "en":
            return lang_code

    # 3. European Latin language signature words check (Spanish, German, French, Portuguese):
    text_lower = text.lower()
    es_indicators = [" de ", " la ", " el ", " los ", " las ", " y ", " en ", " del ", " por ", " una ", " un "]
    fr_indicators = [" de ", " le ", " la ", " les ", " et ", " des ", " du ", " dans ", " une ", " un "]
    de_indicators = [" der ", " die ", " das ", " und ", " in ", " von ", " mit ", " fÃ¼r ", " auf "]
    pt_indicators = [" de ", " do ", " da ", " dos ", " das ", " e ", " em ", " para ", " com "]

    en_indicators = [" the ", " and ", " from ", " to ", " of ", " with ", " for ", " by ", " into ", " between "]
    en_score = sum(1 for w in en_indicators if w in text_lower)
    es_score = sum(1 for w in es_indicators if w in text_lower)
    fr_score = sum(1 for w in fr_indicators if w in text_lower)
    de_score = sum(1 for w in de_indicators if w in text_lower)
    pt_score = sum(1 for w in pt_indicators if w in text_lower)

    max_score = max(es_score, fr_score, de_score, pt_score)
    if max_score >= 3 and max_score > en_score:
        if de_score == max_score:
            return 'de'
        if fr_score == max_score:
            return 'fr'
        if pt_score == max_score and pt_score > es_score:
            return 'pt'
        if es_score == max_score:
            return 'es'

    if lang and isinstance(lang, str) and len(lang.strip()) == 2:
        return lang.strip().lower()

    return 'en'


def _extract_author(data: dict) -> str:
    """
    Extract author display name, honoring anonymous choice if requested.
    """
    if (data or {}).get("isAnonymous"):
        return "Explorer"
    author = (data or {}).get("authorName") or (data or {}).get("author_name")
    if author and isinstance(author, str) and author.strip():
        return author.strip()
    tid = (data or {}).get("id", "")
    if tid in ("apollo", "tl-nature-horse", "sample-us-presidents"):
        return "ChroniX Curators"
    return "Guest Explorer"


def _extract_preview_lanes(data: dict) -> List[dict]:
    lanes = (data or {}).get("lanes", [])
    result = []
    for l in lanes[:4]:
        if isinstance(l, dict) and l.get("title"):
            result.append({
                "id": l.get("id"),
                "title": l.get("title"),
                "color": l.get("color") or "#4a7c59"
            })
    return result


# Largest inline data-URL cover a Library card may carry (~64 KB of base64).
LIBRARY_CARD_MAX_DATA_COVER_CHARS = 65000


def project_library_card_for_viewer(card: dict, include_cover_candidates: bool) -> dict:
    """
    Per-request view of a cached Library card (the cached dict is never mutated). Non-admins get a
    single cover and no `coverImageCandidates` (those exist only for admin cover cycling); an
    oversized inline data-URL cover becomes the first http candidate, or None.
    """
    cover = card.get("coverImageUrl")
    oversized = isinstance(cover, str) and cover.startswith("data:") and len(cover) > LIBRARY_CARD_MAX_DATA_COVER_CHARS
    if include_cover_candidates and not oversized:
        return card
    view = dict(card)
    if oversized:
        candidates = card.get("coverImageCandidates") or []
        view["coverImageUrl"] = next(
            (c for c in candidates if isinstance(c, str) and c.lower().startswith(("https://", "http://"))),
            None,
        )
    if not include_cover_candidates:
        view.pop("coverImageCandidates", None)
    return view


def _extract_library_card_meta(
    data: dict,
    row: Optional[dict] = None,
    podcast_folders: Optional[set] = None,
) -> Optional[dict]:
    """
    Build a lightweight catalog card summary for a Public Library timeline without
    including the full articles array, overview, quiz, or podcast blobs.
    """
    if not isinstance(data, dict):
        return None
    if _is_timeline_deleted(data) or _is_timeline_deleted(row):
        return None
    articles = data.get("articles") or []
    if not isinstance(articles, list) or len(articles) == 0:
        return None

    tid = str(data.get("id") or (row or {}).get("id") or "").strip()
    title = str(data.get("title") or (row or {}).get("title") or "").strip()
    if not tid or not title:
        return None

    raw_desc = str(data.get("description") or (row or {}).get("description") or "").strip()
    if not raw_desc:
        overview_txt = str(data.get("overview") or "").strip()
        if overview_txt:
            raw_desc = overview_txt[:220].rsplit(" ", 1)[0] + ("…" if len(overview_txt) > 220 else "")

    min_year: Optional[int] = None
    max_year: Optional[int] = None
    current_year = datetime.now(timezone.utc).year
    has_geo = False

    ranked_candidates: List[Tuple[int, int, str]] = []
    for idx, art in enumerate(articles):
        if not isinstance(art, dict):
            continue
        f_obj = art.get("from")
        if isinstance(f_obj, dict):
            fy = f_obj.get("year")
            if isinstance(fy, (int, float)) and not isinstance(fy, bool):
                fy_int = int(fy)
                min_year = fy_int if min_year is None else min(min_year, fy_int)
                max_year = fy_int if max_year is None else max(max_year, fy_int)
        t_obj = art.get("to")
        if isinstance(t_obj, dict):
            ty = t_obj.get("year")
            if isinstance(ty, (int, float)) and not isinstance(ty, bool):
                ty_int = int(ty)
                min_year = ty_int if min_year is None else min(min_year, ty_int)
                max_year = ty_int if max_year is None else max(max_year, ty_int)
        if art.get("isToPresent") is True:
            max_year = current_year if max_year is None else max(max_year, current_year)

        lat = art.get("lat")
        lng = art.get("lng")
        if isinstance(lat, (int, float)) and isinstance(lng, (int, float)) and not isinstance(lat, bool) and not isinstance(lng, bool):
            has_geo = True

        img = art.get("imageUrl")
        if isinstance(img, str) and img.strip():
            img_clean = img.strip()
            rank_val = art.get("rank")
            rank_num = int(rank_val) if isinstance(rank_val, (int, float)) and not isinstance(rank_val, bool) else 0
            ranked_candidates.append((-rank_num, idx, img_clean, art))

    ranked_candidates.sort(key=lambda t: (t[0], t[1]))
    http_candidates: List[str] = []
    data_candidates: List[str] = []
    seen_urls: set = set()
    article_pos_by_url: Dict[str, tuple] = {}

    for _, _, img_url, art_obj in ranked_candidates:
        px = art_obj.get("imagePositionX")
        py = art_obj.get("imagePositionY")
        if (
            img_url not in article_pos_by_url
            and isinstance(px, (int, float))
            and not isinstance(px, bool)
            and isinstance(py, (int, float))
            and not isinstance(py, bool)
        ):
            article_pos_by_url[img_url] = (
                round(max(0.0, min(100.0, float(px))), 1),
                round(max(0.0, min(100.0, float(py))), 1),
            )
        if img_url in seen_urls:
            continue
        if img_url.lower().startswith(("https://", "http://")):
            if len(http_candidates) < 24:
                http_candidates.append(img_url)
                seen_urls.add(img_url)
        elif img_url.startswith("data:image/") and len(img_url) <= LIBRARY_CARD_MAX_DATA_COVER_CHARS:
            if len(data_candidates) < 4:
                data_candidates.append(img_url)
                seen_urls.add(img_url)

    cover_candidates: List[str] = http_candidates if http_candidates else data_candidates

    explicit_cover = data.get("coverImageUrl") or data.get("cover_image_url")
    cover_image_url: Optional[str] = None
    if isinstance(explicit_cover, str) and explicit_cover.strip():
        clean_explicit = explicit_cover.strip()
        if clean_explicit.lower().startswith(("https://", "http://")) or (
            clean_explicit.startswith("data:image/") and len(clean_explicit) <= LIBRARY_CARD_MAX_DATA_COVER_CHARS
        ):
            cover_image_url = clean_explicit
            if clean_explicit not in cover_candidates:
                cover_candidates = [clean_explicit, *cover_candidates][:24]

    if not cover_image_url and cover_candidates:
        cover_image_url = cover_candidates[0]

    raw_pos_x = data.get("coverImagePositionX") if "coverImagePositionX" in data else data.get("cover_image_position_x")
    raw_pos_y = data.get("coverImagePositionY") if "coverImagePositionY" in data else data.get("cover_image_position_y")
    cover_pos_x: Optional[float] = None
    cover_pos_y: Optional[float] = None
    if (
        isinstance(raw_pos_x, (int, float))
        and not isinstance(raw_pos_x, bool)
        and isinstance(raw_pos_y, (int, float))
        and not isinstance(raw_pos_y, bool)
    ):
        cover_pos_x = round(max(0.0, min(100.0, float(raw_pos_x))), 1)
        cover_pos_y = round(max(0.0, min(100.0, float(raw_pos_y))), 1)
    elif cover_image_url and cover_image_url in article_pos_by_url:
        cover_pos_x, cover_pos_y = article_pos_by_url[cover_image_url]

    cats = _extract_categories(data)
    cat_keys = _get_category_keys(cats)
    if not cat_keys:
        inferred_cats = _extract_categories({**data, "categories": []})
        cat_keys = _get_category_keys(inferred_cats) or ["history"]

    tags = _extract_tags(data)
    lang = _extract_language(data)
    lanes = data.get("lanes") or []
    lane_count = max(1, len(lanes)) if isinstance(lanes, list) else 1
    pod = data.get("podcast")
    has_podcast = bool(isinstance(pod, dict) and pod.get("segments"))
    if not has_podcast:
        try:
            from services import podcast_store
            has_podcast = podcast_store.has_timeline_episodes(tid, known_folders=podcast_folders)
        except Exception:
            pass
    updated_at = str((row or {}).get("updated_at") or data.get("updatedAt") or (row or {}).get("created_at") or data.get("createdAt") or "")

    feat_order = _get_timeline_featured_order(data)
    if feat_order is None:
        feat_order = _get_timeline_featured_order(row)

    merged_sources = data.get("mergedSources") or data.get("merged_sources")
    merged_layer_count = len(merged_sources) if isinstance(merged_sources, list) and len(merged_sources) >= 2 else 0

    return {
        "id": tid,
        "title": title,
        "description": raw_desc[:320],
        "coverImageUrl": cover_image_url,
        "coverImageCandidates": cover_candidates,
        "coverImagePositionX": cover_pos_x,
        "coverImagePositionY": cover_pos_y,
        "articleCount": len(articles),
        "laneCount": lane_count,
        "mergedLayerCount": merged_layer_count,
        "timeScale": str(data.get("timeScale") or (row or {}).get("time_scale") or "calendar"),
        "minYear": min_year,
        "maxYear": max_year,
        "categories": cats,
        "categoryKeys": cat_keys,
        "tags": tags,
        "language": lang,
        "contentMode": "kids" if data.get("contentMode") == "kids" else "classic",
        "searchMode": data.get("searchMode") or None,
        "creationSource": data.get("creationSource") or ("manual" if data.get("isManual") else None),
        "isFeatured": _is_timeline_featured(data) or _is_timeline_featured(row),
        "featuredOrder": feat_order,
        "isPersonal": bool(data.get("isPersonal", False)),
        "hasGeo": has_geo,
        "hasPodcast": has_podcast,
        "updatedAt": updated_at,
    }


_LIGHT_LIBRARY_INDEX_SELECT = (
    "id,title,description,time_scale,updated_at,created_at,"
    "is_featured:data->>isFeatured,"
    "featured_order:data->>featuredOrder,"
    "is_deleted:data->>isDeleted,"
    "content_mode:data->>contentMode,"
    "detected_lang:data->>detectedLanguage,"
    "cover_url:data->>coverImageUrl,"
    "cover_x:data->>coverImagePositionX,"
    "cover_y:data->>coverImagePositionY"
)
_LIGHT_LIBRARY_INDEX_FLAG_SELECT = (
    "id,title,description,time_scale,updated_at,created_at,"
    "is_featured:flag_is_featured,"
    "featured_order:flag_featured_order,"
    "is_deleted:flag_is_deleted,"
    "content_mode,"
    "detected_lang:data->>detectedLanguage,"
    "cover_url:data->>coverImageUrl,"
    "cover_x:data->>coverImagePositionX,"
    "cover_y:data->>coverImagePositionY"
)
_FULL_LIBRARY_ROW_SELECT = "id,title,description,time_scale,data,updated_at,created_at"
_LIBRARY_JSON_FILTER = ("data->>isLibrary", "eq.true")
# Served by the partial index `idx_timelines_flag_library` (migration 004).
_LIBRARY_FLAG_FILTER = ("flag_is_library", "is.true")


def _postgrest_in_list(values: List[str]) -> str:
    """`in.(...)` filter value with every item double-quoted, so ids holding `,` `(` `)` or quotes
    can't split or widen the list (S-15)."""
    quoted = ('"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"' for v in values)
    return f"in.({','.join(quoted)})"


def _card_content_fingerprint(row: dict, tl_data: Optional[dict] = None) -> tuple:
    src = tl_data if isinstance(tl_data, dict) and tl_data else row
    raw_cov = (tl_data or {}).get("coverImageUrl") if tl_data and "coverImageUrl" in tl_data else row.get("cover_url")
    raw_px = (tl_data or {}).get("coverImagePositionX") if tl_data and "coverImagePositionX" in tl_data else row.get("cover_x")
    raw_py = (tl_data or {}).get("coverImagePositionY") if tl_data and "coverImagePositionY" in tl_data else row.get("cover_y")
    return (
        str(row.get("updated_at") or src.get("updatedAt") or row.get("created_at") or src.get("createdAt") or ""),
        str(row.get("title") or src.get("title") or ""),
        str(row.get("description") or src.get("description") or ""),
        str(raw_cov or ""),
        str(raw_px if raw_px is not None else ""),
        str(raw_py if raw_py is not None else ""),
    )


def _sync_cached_card_mutable_fields(
    card: dict,
    row: dict,
    tl_data: Optional[dict] = None,
    podcast_folders: Optional[set] = None,
) -> dict:
    updated = dict(card)
    updated["isFeatured"] = _is_timeline_featured(tl_data) or _is_timeline_featured(row)
    feat_order = _get_timeline_featured_order(tl_data)
    if feat_order is None:
        feat_order = _get_timeline_featured_order(row)
    updated["featuredOrder"] = feat_order
    if podcast_folders is not None:
        try:
            from services import podcast_store
            tid = str(updated.get("id") or "")
            if tid and podcast_store.has_timeline_episodes(tid, known_folders=podcast_folders):
                updated["hasPodcast"] = True
        except Exception:
            pass
    return updated


def _get_podcast_folders_safe() -> Optional[set]:
    try:
        from services import podcast_store
        return podcast_store.list_episode_timeline_folders()
    except Exception:
        return None


def _fetch_library_index_pages(
    client,
    url: str,
    headers: dict,
    select: str,
    library_filter: Tuple[str, str] = _LIBRARY_JSON_FILTER,
    failures: Optional[list] = None,
) -> Optional[List[dict]]:
    """
    Every Public Library row for `select`, paged by `_LIBRARY_INDEX_PAGE_SIZE` (B-23: a single
    `limit 200` silently dropped the oldest rows). None when the first page fails (its response is
    appended to `failures`); a later page failing returns what was read so far, logged.
    """
    rows: List[dict] = []
    seen_ids: set = set()
    for page in range(_LIBRARY_INDEX_MAX_PAGES):
        params = {
            library_filter[0]: library_filter[1],
            # `id` breaks updated_at ties, so offsets stay stable between pages.
            "order": "updated_at.desc,id.asc",
            "limit": str(_LIBRARY_INDEX_PAGE_SIZE),
            "offset": str(page * _LIBRARY_INDEX_PAGE_SIZE),
            "select": select,
        }
        resp = client.get(url, headers=headers, params=params)
        if resp.status_code != 200:
            if page == 0:
                if failures is not None:
                    failures.append(resp)
                return None
            logger.warning(f"Supabase library index page {page} status {resp.status_code}; using {len(rows)} rows")
            break
        batch = resp.json()
        if not isinstance(batch, list):
            return [] if page == 0 else rows
        new_rows = [r for r in batch if not (isinstance(r, dict) and r.get("id") in seen_ids)]
        for r in new_rows:
            if isinstance(r, dict) and r.get("id") is not None:
                seen_ids.add(r.get("id"))
        rows.extend(new_rows)
        if len(batch) < _LIBRARY_INDEX_PAGE_SIZE or not new_rows:
            break
    else:
        logger.warning(f"Public Library index reached {_LIBRARY_INDEX_MAX_PAGES} pages; the rest is not listed")
    return rows


def _fetch_supabase_library_index_rows(client, url: str, headers: dict) -> Tuple[Optional[List[dict]], bool]:
    """
    Fetch lightweight index rows for all Public Library timelines without downloading
    multi-MB `data` JSONB blobs. Falls back to full-row select if lightweight select fails.
    Returns (rows, has_inline_data).
    """
    if _flag_columns_enabled():
        failures: list = []
        rows = _fetch_library_index_pages(
            client, url, headers, _LIGHT_LIBRARY_INDEX_FLAG_SELECT, _LIBRARY_FLAG_FILTER, failures
        )
        if rows is not None:
            return rows, False
        if failures and _is_missing_flag_column_response(failures[0]):
            _note_flag_columns_missing("library index")
    rows = _fetch_library_index_pages(client, url, headers, _LIGHT_LIBRARY_INDEX_SELECT)
    if rows is not None:
        has_inline = bool(rows and isinstance(rows[0], dict) and isinstance(rows[0].get("data"), dict))
        return rows, has_inline

    rows_full = _fetch_library_index_pages(client, url, headers, _FULL_LIBRARY_ROW_SELECT)
    if rows_full is not None:
        return rows_full, True

    logger.warning("Supabase _fetch_supabase_library_index_rows failed for both selects")
    return None, False


def _hydrate_library_rows_by_ids(
    index_rows: List[dict],
    url: str,
    headers: dict,
    podcast_folders: Optional[set] = None,
    status: Optional[Dict[str, Any]] = None,
) -> List[dict]:
    """
    Given lightweight `index_rows`, return full card metadata dicts.
    Reuses `_LIBRARY_CARD_CACHE` for unchanged timelines and fetches `data` in chunks
    ONLY for timelines missing from the cache. When a chunk can't be fetched, its cards are
    missing from the result and `status["complete"]` is set to False (B-23).
    """
    if status is not None:
        status.setdefault("complete", True)
    if not index_rows:
        return []

    index_by_id: Dict[str, dict] = {}
    ordered_ids: List[str] = []
    missing_ids: List[str] = []
    resolved_cards: Dict[str, dict] = {}

    with _LIBRARY_CACHE_LOCK:
        for row in index_rows:
            if not isinstance(row, dict) or _is_timeline_deleted(row):
                continue
            tid = str(row.get("id") or "").strip()
            if not tid or tid in index_by_id:
                continue
            index_by_id[tid] = row
            ordered_ids.append(tid)
            fp = _card_content_fingerprint(row)
            cached_entry = _LIBRARY_CARD_CACHE.get(tid)
            if cached_entry and cached_entry[0] == fp:
                resolved_cards[tid] = _sync_cached_card_mutable_fields(
                    cached_entry[1], row, podcast_folders=podcast_folders
                )
            else:
                missing_ids.append(tid)

    if missing_ids:
        chunk_size = 20
        chunks = [missing_ids[i : i + chunk_size] for i in range(0, len(missing_ids), chunk_size)]

        def _mark_incomplete() -> None:
            if status is not None:
                status["complete"] = False

        def _fetch_chunk(id_chunk: List[str]) -> List[dict]:
            try:
                with _supabase_http_client() as c:
                    r = c.get(
                        url,
                        headers=headers,
                        params={
                            "id": _postgrest_in_list(id_chunk),
                            "select": _FULL_LIBRARY_ROW_SELECT,
                        },
                    )
                    if r.status_code == 200:
                        data = r.json()
                        return data if isinstance(data, list) else []
                    logger.warning(f"Supabase library chunk fetch status {r.status_code}")
            except Exception as e:
                logger.warning(f"Supabase library chunk fetch failed: {e}")
            _mark_incomplete()
            return []

        fetched_rows: List[dict] = []
        if len(chunks) == 1:
            fetched_rows = _fetch_chunk(chunks[0])
        else:
            with ThreadPoolExecutor(max_workers=min(3, len(chunks))) as pool:
                for batch_rows in pool.map(_fetch_chunk, chunks):
                    fetched_rows.extend(batch_rows)

        new_cache_entries: Dict[str, Tuple[tuple, dict]] = {}
        for full_row in fetched_rows:
            if not isinstance(full_row, dict):
                continue
            tid = str(full_row.get("id") or "").strip()
            tl_data = full_row.get("data") or {}
            if not tid:
                continue
            idx_row = index_by_id.get(tid, full_row)
            card = _extract_library_card_meta(tl_data, row=full_row, podcast_folders=podcast_folders)
            if card:
                fp = _card_content_fingerprint(idx_row, tl_data)
                new_cache_entries[tid] = (fp, card)
                resolved_cards[tid] = card

        if new_cache_entries:
            with _LIBRARY_CACHE_LOCK:
                _LIBRARY_CARD_CACHE.update(new_cache_entries)

    return [resolved_cards[tid] for tid in ordered_ids if tid in resolved_cards]


def _trigger_background_library_refresh() -> None:
    """Refresh the full catalog in the bulk executor without blocking callers (single-flight)."""
    global _LIBRARY_BG_REFRESH_IN_FLIGHT
    with _LIBRARY_CACHE_LOCK:
        if _LIBRARY_BG_REFRESH_IN_FLIGHT or (_LIBRARY_REBUILD_FUTURE is not None and not _LIBRARY_REBUILD_FUTURE.done()):
            return
        _LIBRARY_BG_REFRESH_IN_FLIGHT = True

    def _worker() -> None:
        global _LIBRARY_BG_REFRESH_IN_FLIGHT
        try:
            list_library_timelines(force_refresh=True)
        except Exception as e:
            logger.warning(f"Background library catalog refresh failed: {e}")
        finally:
            with _LIBRARY_CACHE_LOCK:
                _LIBRARY_BG_REFRESH_IN_FLIGHT = False

    try:
        from services.executors import submit_bulk
        submit_bulk(_worker)
    except RuntimeError:  # executor shut down (interpreter exit)
        with _LIBRARY_CACHE_LOCK:
            _LIBRARY_BG_REFRESH_IN_FLIGHT = False


def list_library_timelines_fast_page(
    lang: Optional[str] = None,
    content_mode: Optional[str] = None,
    featured_only: bool = False,
    limit: int = 12,
) -> Tuple[List[dict], int]:
    """
    Fast first-page loader for the Public Library:
    - When the full catalog cache is warm (or within stale-while-revalidate window), filters in memory in <1ms.
    - When the catalog cache is cold on Supabase, runs a lightweight index query (no `data` JSONB),
      sorts and filters the index, fetches `data` ONLY for the first `limit` visible timelines,
      returns them immediately, and triggers a background thread to hydrate the rest of the catalog.
    """
    now = time.monotonic()
    lang_clean = (lang or "").strip().lower()
    mode_clean = (content_mode or "").strip().lower()

    def _filter_cards(cards: List[dict]) -> List[dict]:
        res = cards
        if lang_clean and lang_clean != "all":
            res = [it for it in res if (it.get("language") or "en").lower() == lang_clean]
        if mode_clean and mode_clean != "all":
            res = [it for it in res if (it.get("contentMode") or "classic").lower() == mode_clean]
        if featured_only:
            res = [it for it in res if it.get("isFeatured")]
        return res

    with _LIBRARY_CACHE_LOCK:
        cached = list(_LIBRARY_CACHE_ITEMS) if _LIBRARY_CACHE_ITEMS is not None else None
        cache_age = now - _LIBRARY_CACHE_TS if _LIBRARY_CACHE_ITEMS is not None else float("inf")
        cache_ttl = _library_cache_ttl()

    if cached is not None and cache_age < _LIBRARY_CACHE_STALE_MAX_SECONDS:
        if cache_age >= cache_ttl:
            _trigger_background_library_refresh()
        filtered = _filter_cards(cached)
        return filtered[:limit], len(filtered)

    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            with _supabase_http_client() as client:
                rows, has_inline = _fetch_supabase_library_index_rows(client, url, headers)
            if rows is not None and not has_inline:
                index_summaries: List[dict] = []
                row_by_id: Dict[str, dict] = {}
                for row in rows:
                    if not isinstance(row, dict) or _is_timeline_deleted(row):
                        continue
                    tid = str(row.get("id") or "").strip()
                    title = str(row.get("title") or "").strip()
                    if not tid or not title:
                        continue
                    row_by_id[tid] = row
                    row_lang = _extract_language({
                        "title": title,
                        "description": row.get("description") or "",
                        "detectedLanguage": row.get("detected_lang"),
                    })
                    row_mode = "kids" if row.get("content_mode") == "kids" else "classic"
                    index_summaries.append({
                        "id": tid,
                        "title": title,
                        "isFeatured": _is_timeline_featured(row),
                        "featuredOrder": _get_timeline_featured_order(row),
                        "updatedAt": str(row.get("updated_at") or row.get("created_at") or ""),
                        "language": row_lang,
                        "contentMode": row_mode,
                    })

                index_summaries.sort(key=cmp_to_key(_compare_library_featured))
                matching_summaries = _filter_cards(index_summaries)
                first_slice_rows = [
                    row_by_id[s["id"]]
                    for s in matching_summaries[: max(limit + 2, 8)]
                    if s["id"] in row_by_id
                ]
                podcast_folders = _get_podcast_folders_safe()
                hydrated = _hydrate_library_rows_by_ids(
                    first_slice_rows, url, headers, podcast_folders=podcast_folders
                )
                hydrated.sort(key=cmp_to_key(_compare_library_featured))
                filtered_hydrated = _filter_cards(hydrated)
                # Hydrate the remaining library items in the background so Stage 2 is ready
                _trigger_background_library_refresh()
                total_est = max(len(filtered_hydrated), len(matching_summaries))
                return filtered_hydrated[:limit], total_est
        except Exception as e:
            logger.warning(f"Fast-page library fetch fell back to full load: {e}")

    all_items = list_library_timelines()
    filtered_all = _filter_cards(all_items)
    return filtered_all[:limit], len(filtered_all)


def build_library_facets(cards: List[dict]) -> List[dict]:
    """
    Category facets of a Library catalog: one group per (language, contentMode) with the group's
    timeline count and per-category counts. A few hundred bytes, so the fast first page can carry it
    and the Library's category row renders complete (with honest counts) before Stage 2 lands.
    """
    groups: Dict[Tuple[str, str], dict] = {}
    for card in cards or []:
        if not isinstance(card, dict):
            continue
        lang = str(card.get("language") or "en").lower()
        mode = "kids" if card.get("contentMode") == "kids" else "classic"
        group = groups.get((lang, mode))
        if group is None:
            group = groups[(lang, mode)] = {"language": lang, "contentMode": mode, "total": 0, "categories": {}}
        group["total"] += 1
        keys = card.get("categoryKeys") or (["history"] if not card.get("category") else [card.get("category")])
        for key in dict.fromkeys(str(k) for k in keys if k):
            group["categories"][key] = group["categories"].get(key, 0) + 1
    return sorted(groups.values(), key=lambda g: (g["language"], g["contentMode"]))


def get_library_catalog_facets() -> Optional[List[dict]]:
    """
    Facets of the whole cached Library catalog, or None when no complete catalog is in memory
    (cold start, or a partial build): the client then falls back to its own last-known facets.
    Never triggers a load.
    """
    now = time.monotonic()
    with _LIBRARY_CACHE_LOCK:
        if _LIBRARY_CACHE_ITEMS is None or _LIBRARY_CACHE_PARTIAL:
            return None
        if now - _LIBRARY_CACHE_TS >= _LIBRARY_CACHE_STALE_MAX_SECONDS:
            return None
        cached = list(_LIBRARY_CACHE_ITEMS)
    return build_library_facets(cached)


def list_library_timelines(force_refresh: bool = False) -> List[dict]:
    """
    Return lightweight catalog metadata for all timelines curated into the ChroniX Public Library.
    Served from an in-memory cache with Stale-While-Revalidate and per-timeline card caching.
    """
    global _LIBRARY_CACHE_TS, _LIBRARY_CACHE_ITEMS, _LIBRARY_CACHE_PARTIAL
    now = time.monotonic()
    if not force_refresh:
        with _LIBRARY_CACHE_LOCK:
            if _LIBRARY_CACHE_ITEMS is not None:
                age = now - _LIBRARY_CACHE_TS
                if age < _library_cache_ttl():
                    return list(_LIBRARY_CACHE_ITEMS)
                if age < _LIBRARY_CACHE_STALE_MAX_SECONDS:
                    cached_copy = list(_LIBRARY_CACHE_ITEMS)
                else:
                    cached_copy = None
            else:
                cached_copy = None
        if cached_copy is not None:
            _trigger_background_library_refresh()
            return cached_copy
    return _rebuild_library_single_flight(force_refresh)


# SC-08: one rebuild at a time, run by the first caller; concurrent callers wait for its result
# instead of queueing on a lock held across the network calls (and an expired-but-recent catalog is
# served while a background rebuild runs, see list_library_timelines).
_LIBRARY_REBUILD_FUTURE: Optional[Future] = None
_LIBRARY_REBUILD_GENERATION: int = -1
_LIBRARY_REBUILD_WAIT_SECONDS = 90.0


def _rebuild_library_single_flight(force_refresh: bool) -> List[dict]:
    global _LIBRARY_REBUILD_FUTURE, _LIBRARY_REBUILD_GENERATION
    while True:
        with _LIBRARY_CACHE_LOCK:
            if not force_refresh and _LIBRARY_CACHE_ITEMS is not None and (time.monotonic() - _LIBRARY_CACHE_TS) < _library_cache_ttl():
                return list(_LIBRARY_CACHE_ITEMS)
            fut = _LIBRARY_REBUILD_FUTURE
            if fut is None or fut.done():
                fut = Future()
                _LIBRARY_REBUILD_FUTURE = fut
                build_generation = _LIBRARY_REBUILD_GENERATION = _LIBRARY_CACHE_GENERATION
                break
            # A rebuild that started before an invalidation can't answer for the current data.
            predates_invalidation = _LIBRARY_REBUILD_GENERATION != _LIBRARY_CACHE_GENERATION
        try:
            result = fut.result(timeout=_LIBRARY_REBUILD_WAIT_SECONDS)
        except Exception as e:
            logger.warning(f"Waiting for the Library rebuild failed: {e}")
            with _LIBRARY_CACHE_LOCK:
                return list(_LIBRARY_CACHE_ITEMS) if _LIBRARY_CACHE_ITEMS is not None else []
        if not predates_invalidation:
            return list(result)
    try:
        items = _build_library_catalog(build_generation)
    except BaseException as e:
        fut.set_exception(e)
        raise
    fut.set_result(items)
    return list(items)


def _build_library_catalog(build_generation: int) -> List[dict]:
    """Builds the catalog (network calls, no lock held) and caches it unless invalidated meanwhile."""
    global _LIBRARY_CACHE_TS, _LIBRARY_CACHE_ITEMS, _LIBRARY_CACHE_PARTIAL

    items: List[dict] = []
    complete = True
    podcast_folders = _get_podcast_folders_safe()

    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            with _supabase_http_client() as client:
                rows, has_inline = _fetch_supabase_library_index_rows(client, url, headers)
            if rows is None:
                with _LIBRARY_CACHE_LOCK:
                    if _LIBRARY_CACHE_ITEMS is not None:
                        return list(_LIBRARY_CACHE_ITEMS)
                return []
            if has_inline:
                new_cache: Dict[str, Tuple[tuple, dict]] = {}
                for row in rows:
                    tl_data = row.get("data") or {}
                    card = _extract_library_card_meta(tl_data, row=row, podcast_folders=podcast_folders)
                    if card:
                        items.append(card)
                        new_cache[card["id"]] = (_card_content_fingerprint(row, tl_data), card)
                if new_cache:
                    with _LIBRARY_CACHE_LOCK:
                        _LIBRARY_CARD_CACHE.update(new_cache)
            else:
                hydrate_status: Dict[str, Any] = {}
                items = _hydrate_library_rows_by_ids(
                    rows, url, headers, podcast_folders=podcast_folders, status=hydrate_status
                )
                complete = bool(hydrate_status.get("complete", True))
        except Exception as e:
            logger.error(f"Supabase list_library_timelines failed (failing closed): {e}")
            with _LIBRARY_CACHE_LOCK:
                if _LIBRARY_CACHE_ITEMS is not None:
                    return list(_LIBRARY_CACHE_ITEMS)
            return []
    else:
        try:
            local_data = _load_local_timelines()
            for entry in local_data:
                if not _is_timeline_in_library(entry):
                    continue
                card = _extract_library_card_meta(entry, podcast_folders=podcast_folders)
                if card:
                    items.append(card)
        except Exception as e:
            logger.warning(f"Local list_library_timelines failed: {e}")

    items.sort(key=cmp_to_key(_compare_library_featured))

    with _LIBRARY_CACHE_LOCK:
        if build_generation != _LIBRARY_CACHE_GENERATION:
            # Invalidated while this rebuild ran: its data predates the change, so don't cache it.
            return list(items)
        if not complete and _LIBRARY_CACHE_ITEMS is not None and not _LIBRARY_CACHE_PARTIAL:
            # Keep the last complete catalog rather than replace it with one missing cards.
            logger.warning("Library catalog rebuild was incomplete; keeping the previous complete catalog")
            return list(_LIBRARY_CACHE_ITEMS)
        _LIBRARY_CACHE_ITEMS = items
        _LIBRARY_CACHE_TS = time.monotonic()
        _LIBRARY_CACHE_PARTIAL = not complete

    return list(items)


_UNSET = object()


def set_timeline_library_status(
    timeline_id: str,
    is_library: Optional[bool] = None,
    is_featured: Optional[bool] = None,
    cover_image_url: Any = _UNSET,
    cover_image_position_x: Any = _UNSET,
    cover_image_position_y: Any = _UNSET,
    featured_order: Any = _UNSET,
) -> Optional[dict]:
    """
    Admin-only helper (caller MUST verify admin role): publish/unpublish, feature, reorder, or customize
    the library card cover image & focal point without altering private link-sharing (`is_shared`).
    The read-modify-write PATCH is conditioned on the row's `updatedAt` (B-04), so an owner edit
    landing in between is never clobbered: the change is recomputed on the fresh row (one retry).
    """
    if not _supabase_is_configured():
        meta = get_timeline_with_meta(timeline_id)
        computed = _compute_library_status_change(
            meta, is_library, is_featured, cover_image_url,
            cover_image_position_x, cover_image_position_y, featured_order,
        )
        if computed is None:
            return None
        tl_data, next_library, next_featured = computed
        if not _local_apply_library_status(timeline_id, tl_data, next_library, next_featured):
            return None
    else:
        tl_data = next_library = next_featured = None
        for _attempt in range(2):
            meta = get_timeline_with_meta(timeline_id)
            computed = _compute_library_status_change(
                meta, is_library, is_featured, cover_image_url,
                cover_image_position_x, cover_image_position_y, featured_order,
            )
            if computed is None:
                return None
            tl_data, next_library, next_featured = computed
            outcome = _supabase_patch_library_data(timeline_id, tl_data, meta["data"].get("updatedAt"))
            if outcome is None:
                return None
            if outcome:
                break
            logger.info(f"Timeline {timeline_id} changed during a library status update; retrying on the fresh row")
        else:
            logger.warning(f"Timeline {timeline_id} kept changing during a library status update; giving up")
            return None

    invalidate_library_cache(timeline_id)
    return {
        "id": timeline_id,
        "isLibrary": next_library,
        "isFeatured": next_featured,
        "featuredOrder": tl_data.get("featuredOrder"),
        "isPersonal": bool(tl_data.get("isPersonal", False)),
        "coverImageUrl": tl_data.get("coverImageUrl"),
        "coverImagePositionX": tl_data.get("coverImagePositionX"),
        "coverImagePositionY": tl_data.get("coverImagePositionY"),
    }


def _supabase_patch_library_data(timeline_id: str, tl_data: dict, base_updated_at: Optional[str]) -> Optional[bool]:
    """
    Versioned PATCH of a Library row's `data`. True = written, False = the row's `updatedAt` moved
    on since it was read (caller re-reads and retries), None = storage error.
    """
    url = f"{SUPABASE_URL}/rest/v1/timelines"
    headers = {**_get_supabase_headers(), "Prefer": "return=representation"}
    params = {
        "id": f"eq.{timeline_id}",
        "data->>updatedAt": f"eq.{base_updated_at}" if base_updated_at else "is.null",
        "select": "id",
    }
    payload = {
        "data": tl_data,
        "categories": _extract_categories(tl_data),
        "tags": _extract_tags(tl_data),
        "language": _extract_language(tl_data),
    }
    try:
        with _supabase_http_client() as client:
            resp = client.patch(url, headers=headers, params=params, json=payload)
            if resp.status_code == 400:
                resp = client.patch(url, headers=headers, params=params, json={"data": tl_data})
    except Exception as e:
        logger.warning(f"Supabase library data PATCH failed: {e}")
        return None
    if resp.status_code not in (200, 204):
        logger.warning(f"Supabase library data PATCH status {resp.status_code}")
        return None
    try:
        rows = resp.json() if resp.status_code == 200 else None
    except Exception:
        rows = None
    # Only an explicit empty representation means "no row matched the version"; 204 = written.
    return not (isinstance(rows, list) and not rows)


def _compute_library_status_change(
    meta: Optional[dict],
    is_library: Optional[bool],
    is_featured: Optional[bool],
    cover_image_url: Any,
    cover_image_position_x: Any,
    cover_image_position_y: Any,
    featured_order: Any,
) -> Optional[Tuple[dict, bool, bool]]:
    """Applies a library status change to a copy of the row's data: (data, isLibrary, isFeatured)."""
    if not meta or not isinstance(meta.get("data"), dict):
        return None

    tl_data = dict(meta["data"])
    if _is_timeline_deleted(tl_data):
        if is_library is True:
            tl_data.pop("isDeleted", None)
            tl_data.pop("is_deleted", None)
            tl_data.pop("deletedAt", None)
            tl_data.pop("deleted_at", None)
        else:
            return None
    articles = tl_data.get("articles") or []
    if not isinstance(articles, list) or len(articles) == 0:
        return None

    was_featured = _is_timeline_featured(tl_data)
    next_library = bool(is_library) if is_library is not None else _is_timeline_in_library(tl_data)
    tl_data["isLibrary"] = next_library
    if not next_library:
        tl_data["isFeatured"] = False
        tl_data.pop("featuredOrder", None)
        tl_data.pop("featured_order", None)
    else:
        if is_featured is not None:
            tl_data["isFeatured"] = bool(is_featured)
        if featured_order is not _UNSET:
            if featured_order is None:
                tl_data.pop("featuredOrder", None)
                tl_data.pop("featured_order", None)
            elif isinstance(featured_order, (int, float)) and not isinstance(featured_order, bool):
                tl_data["featuredOrder"] = max(0, int(featured_order))
        elif is_featured is True and not was_featured:
            # Newly featured without an explicit order: clear stale order so it surfaces at top
            tl_data.pop("featuredOrder", None)
            tl_data.pop("featured_order", None)

    next_featured = bool(tl_data.get("isFeatured", False))

    if cover_image_url is not _UNSET:
        if cover_image_url is None or (isinstance(cover_image_url, str) and not cover_image_url.strip()):
            tl_data.pop("coverImageUrl", None)
            tl_data.pop("cover_image_url", None)
            tl_data.pop("coverImagePositionX", None)
            tl_data.pop("coverImagePositionY", None)
        elif isinstance(cover_image_url, str):
            clean_url = cover_image_url.strip()
            if clean_url.lower().startswith(("https://", "http://")) or (
                clean_url.startswith("data:image/") and len(clean_url) <= 65000
            ):
                if tl_data.get("coverImageUrl") != clean_url and cover_image_position_x is _UNSET:
                    tl_data.pop("coverImagePositionX", None)
                    tl_data.pop("coverImagePositionY", None)
                tl_data["coverImageUrl"] = clean_url

    if cover_image_position_x is not _UNSET and cover_image_position_y is not _UNSET:
        if cover_image_position_x is None or cover_image_position_y is None:
            tl_data.pop("coverImagePositionX", None)
            tl_data.pop("coverImagePositionY", None)
        elif (
            isinstance(cover_image_position_x, (int, float))
            and not isinstance(cover_image_position_x, bool)
            and isinstance(cover_image_position_y, (int, float))
            and not isinstance(cover_image_position_y, bool)
        ):
            tl_data["coverImagePositionX"] = round(max(0.0, min(100.0, float(cover_image_position_x))), 1)
            tl_data["coverImagePositionY"] = round(max(0.0, min(100.0, float(cover_image_position_y))), 1)

    return tl_data, next_library, next_featured


def _local_apply_library_status(timeline_id: str, tl_data: dict, next_library: bool, next_featured: bool) -> bool:
    """Local-JSON mode: copies only the library/cover fields onto the freshly loaded row."""
    try:
        local_items = list(_load_local_timelines())
        for idx, item in enumerate(local_items):
            if item.get("id") == timeline_id:
                updated_item = dict(item)
                if next_library:
                    updated_item.pop("isDeleted", None)
                    updated_item.pop("is_deleted", None)
                    updated_item.pop("deletedAt", None)
                    updated_item.pop("deleted_at", None)
                updated_item["isLibrary"] = next_library
                updated_item["isFeatured"] = next_featured
                for cov_key in ("coverImageUrl", "coverImagePositionX", "coverImagePositionY", "featuredOrder"):
                    if cov_key in tl_data:
                        updated_item[cov_key] = tl_data[cov_key]
                    else:
                        updated_item.pop(cov_key, None)
                updated_item.pop("featured_order", None)
                local_items[idx] = updated_item
                _save_local_timelines(local_items)
                return True
    except Exception as e:
        logger.warning(f"Local set_timeline_library_status update failed: {e}")
    return False


def reorder_library_timelines(ordered_ids: List[str]) -> Optional[List[str]]:
    """
    Admin-only helper (caller MUST verify admin role): persist sequential `featuredOrder` (0, 1, 2, ...)
    for Public Library timelines. Any library timelines omitted from `ordered_ids` are appended
    in their existing relative order so no published timeline is ever lost or given a duplicate rank.
    """
    seen_req: set = set()
    clean_requested: List[str] = []
    for raw_id in ordered_ids or []:
        if not isinstance(raw_id, str):
            continue
        tid = raw_id.strip()
        if tid and tid not in seen_req:
            seen_req.add(tid)
            clean_requested.append(tid)

    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            params = {
                "data->>isLibrary": "eq.true",
                "limit": "500",
                "select": "id,title,data,updated_at,created_at",
            }
            with _supabase_http_client() as client:
                resp = client.get(url, headers=headers, params=params)
                if resp.status_code != 200:
                    logger.warning(f"Supabase reorder_library_timelines fetch status {resp.status_code}")
                    return None
                rows = resp.json()

            valid_rows: Dict[str, dict] = {}
            sort_summaries: List[dict] = []
            for row in rows:
                tl_data = row.get("data") or {}
                if not isinstance(tl_data, dict) or _is_timeline_deleted(tl_data) or _is_timeline_deleted(row):
                    continue
                arts = tl_data.get("articles") or []
                if not isinstance(arts, list) or len(arts) == 0:
                    continue
                tid = str(row.get("id") or tl_data.get("id") or "").strip()
                if not tid:
                    continue
                valid_rows[tid] = row
                sort_summaries.append({
                    "id": tid,
                    "title": str(tl_data.get("title") or row.get("title") or ""),
                    "isFeatured": _is_timeline_featured(tl_data) or _is_timeline_featured(row),
                    "featuredOrder": _get_timeline_featured_order(tl_data),
                    "updatedAt": str(row.get("updated_at") or tl_data.get("updatedAt") or row.get("created_at") or ""),
                })

            sort_summaries.sort(key=cmp_to_key(_compare_library_featured))
            final_ids: List[str] = [tid for tid in clean_requested if tid in valid_rows]
            final_set = set(final_ids)
            for summary in sort_summaries:
                if summary["id"] not in final_set:
                    final_ids.append(summary["id"])
                    final_set.add(summary["id"])

            updates_to_apply: List[Tuple[str, dict, int]] = []
            for new_idx, tid in enumerate(final_ids):
                row_data = dict(valid_rows[tid].get("data") or {})
                if _get_timeline_featured_order(row_data) != new_idx or "featured_order" in row_data:
                    row_data["featuredOrder"] = new_idx
                    row_data.pop("featured_order", None)
                    updates_to_apply.append((tid, row_data, new_idx))

            if updates_to_apply:
                def _patch_one(item: Tuple[str, dict, int]) -> bool:
                    # Versioned write (B-04): if the owner saved in between, re-read that row and retry once.
                    target_id, new_data, new_idx = item
                    for _attempt in range(2):
                        outcome = _supabase_patch_library_data(target_id, new_data, new_data.get("updatedAt"))
                        if outcome is not False:
                            return bool(outcome)
                        fresh = get_timeline_with_meta(target_id)
                        if not fresh or not isinstance(fresh.get("data"), dict) or _is_timeline_deleted(fresh["data"]):
                            return False
                        new_data = dict(fresh["data"])
                        new_data["featuredOrder"] = new_idx
                        new_data.pop("featured_order", None)
                    return False

                if len(updates_to_apply) == 1:
                    if not _patch_one(updates_to_apply[0]):
                        return None
                else:
                    with ThreadPoolExecutor(max_workers=min(6, len(updates_to_apply))) as pool:
                        results = list(pool.map(_patch_one, updates_to_apply))
                    if not all(results):
                        logger.warning("Supabase reorder_library_timelines had one or more failed PATCH calls")
                        return None

            invalidate_library_cache(keep_cards=True)
            return final_ids
        except Exception as e:
            logger.error(f"Supabase reorder_library_timelines failed: {e}")
            return None

    try:
        local_items = list(_load_local_timelines())
        valid_entries: Dict[str, int] = {}
        sort_summaries = []
        for idx, entry in enumerate(local_items):
            if not isinstance(entry, dict) or not _is_timeline_in_library(entry) or _is_timeline_deleted(entry):
                continue
            arts = entry.get("articles") or []
            if not isinstance(arts, list) or len(arts) == 0:
                continue
            tid = str(entry.get("id") or "").strip()
            if not tid:
                continue
            valid_entries[tid] = idx
            sort_summaries.append({
                "id": tid,
                "title": str(entry.get("title") or ""),
                "isFeatured": _is_timeline_featured(entry),
                "featuredOrder": _get_timeline_featured_order(entry),
                "updatedAt": str(entry.get("updatedAt") or entry.get("createdAt") or ""),
            })

        sort_summaries.sort(key=cmp_to_key(_compare_library_featured))
        final_ids = [tid for tid in clean_requested if tid in valid_entries]
        final_set = set(final_ids)
        for summary in sort_summaries:
            if summary["id"] not in final_set:
                final_ids.append(summary["id"])
                final_set.add(summary["id"])

        changed_local = False
        for new_idx, tid in enumerate(final_ids):
            arr_idx = valid_entries[tid]
            cur_item = local_items[arr_idx]
            if _get_timeline_featured_order(cur_item) != new_idx or "featured_order" in cur_item:
                updated_item = dict(cur_item)
                updated_item["featuredOrder"] = new_idx
                updated_item.pop("featured_order", None)
                local_items[arr_idx] = updated_item
                changed_local = True

        if changed_local:
            _save_local_timelines(local_items)
        invalidate_library_cache(keep_cards=True)
        return final_ids
    except Exception as e:
        logger.warning(f"Local reorder_library_timelines failed: {e}")
        return None


# P-07: every write path drops the cached public responses of what it touched (after the write, so a
# concurrent anonymous view can't re-cache the old copy for the whole TTL).
def save_timeline_data(
    timeline: dict,
    user_id: Optional[str] = None,
    existing_meta: Any = _META_NOT_PROVIDED,
    base_updated_at: Optional[str] = None,
) -> dict:
    try:
        return _save_timeline_data_impl(timeline, user_id, existing_meta, base_updated_at)
    finally:
        invalidate_public_timeline_cache(timeline.get("id") if isinstance(timeline, dict) else None)


save_timeline_data.__doc__ = _save_timeline_data_impl.__doc__


def set_timeline_shared(timeline_id: str, user_id: str, enabled: bool, author_name: Optional[str] = None) -> bool:
    try:
        return _set_timeline_shared_impl(timeline_id, user_id, enabled, author_name)
    finally:
        invalidate_public_timeline_cache(timeline_id)


set_timeline_shared.__doc__ = _set_timeline_shared_impl.__doc__


def delete_timeline_data(timeline_id: str, user_id: Optional[str] = None, force_delete: bool = False) -> bool:
    try:
        return _delete_timeline_data_impl(timeline_id, user_id, force_delete)
    finally:
        invalidate_public_timeline_cache(timeline_id)


delete_timeline_data.__doc__ = _delete_timeline_data_impl.__doc__


def delete_all_user_timelines(user_id: str, include_unowned_local: bool = False, hard_delete: bool = False) -> bool:
    try:
        return _delete_all_user_timelines_impl(user_id, include_unowned_local, hard_delete)
    finally:
        invalidate_public_timeline_cache()


delete_all_user_timelines.__doc__ = _delete_all_user_timelines_impl.__doc__


def transfer_user_timelines(from_user_id: str, to_user_id: str) -> Optional[List[str]]:
    try:
        return _transfer_user_timelines_impl(from_user_id, to_user_id)
    finally:
        invalidate_public_timeline_cache()


transfer_user_timelines.__doc__ = _transfer_user_timelines_impl.__doc__
