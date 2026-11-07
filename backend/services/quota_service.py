import os
import json
import logging
import threading
import time
import re
import ipaddress
import hashlib
import math
import httpx
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Dict, Any, Tuple, List
from fastapi import HTTPException
from services.auth_service import is_admin_user, is_guest_user
from services.runtime_env import derived_secret, is_production_environment

logger = logging.getLogger("ChroniXQuota")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
USAGE_FILE = DATA_DIR / "daily_usage.json"
_LOCK = threading.Lock()
_KEY_LOCK = threading.Lock()

_free_key_rr_counter: int = 0
_KEY_COOLDOWNS: Dict[str, float] = {}
_MAX_KEY_COOLDOWNS = 256
_WARNED_MISSING_FREE_KEYS = False

def get_all_free_keys() -> List[str]:
    """
    Collects all configured free Gemini API keys from the environment.
    Supports:
      1. GEMINI_API_KEY_FREE (single key or comma/semicolon/whitespace-separated list)
      2. Numbered/suffixed vars: GEMINI_API_KEY_FREE_1, GEMINI_API_KEY_FREE_2, etc.
    Deduplicates and preserves order. Never falls back to the paid GEMINI_API_KEY (fail-closed).
    """
    global _WARNED_MISSING_FREE_KEYS
    keys: List[str] = []

    # 1. Base env var GEMINI_API_KEY_FREE
    base_free = os.getenv("GEMINI_API_KEY_FREE", "").strip()
    if base_free:
        for part in re.split(r"[,;\s]+", base_free):
            p = part.strip()
            if p and p not in keys:
                keys.append(p)

    # 2. Numbered or suffixed vars like GEMINI_API_KEY_FREE_2, GEMINI_API_KEY_FREE_3, ...
    numbered_vars: List[Tuple[int, str, str]] = []
    for var_name, var_val in os.environ.items():
        if var_name.startswith("GEMINI_API_KEY_FREE_"):
            suffix = var_name[len("GEMINI_API_KEY_FREE_"):]
            val = var_val.strip()
            if not val:
                continue
            try:
                order_idx = int(suffix)
            except ValueError:
                order_idx = 9999
            numbered_vars.append((order_idx, var_name, val))

    numbered_vars.sort(key=lambda item: (item[0], item[1]))
    for _, _, val in numbered_vars:
        for part in re.split(r"[,;\s]+", val):
            p = part.strip()
            if p and p not in keys:
                keys.append(p)

    if not keys and not _WARNED_MISSING_FREE_KEYS:
        if (
            os.getenv("API_KEY_MODE", "").strip().lower() in ("limited", "free")
            or os.getenv("GUEST_API_KEY_MODE", "").strip().lower() in ("limited", "free")
        ):
            _WARNED_MISSING_FREE_KEYS = True
            logger.error(
                "No GEMINI_API_KEY_FREE* keys are configured while limited/free quota mode is active; "
                "over-limit requests will fail closed instead of spending GEMINI_API_KEY."
            )

    return keys

def mark_key_exhausted(key: str, cooldown_seconds: float = 300.0) -> None:
    """Marks a server API key in cooldown after a quota or prepayment exhaustion error."""
    if not key:
        return
    with _KEY_LOCK:
        now = time.time()
        if len(_KEY_COOLDOWNS) >= _MAX_KEY_COOLDOWNS:
            expired = [k for k, exp in list(_KEY_COOLDOWNS.items()) if now >= exp]
            for k in expired:
                _KEY_COOLDOWNS.pop(k, None)
            while len(_KEY_COOLDOWNS) >= _MAX_KEY_COOLDOWNS:
                _KEY_COOLDOWNS.pop(next(iter(_KEY_COOLDOWNS)), None)
        _KEY_COOLDOWNS[key] = now + cooldown_seconds
        masked = f"...{key[-6:]}" if len(key) >= 6 else "***"
        logger.warning(f"Marked Gemini key {masked} in cooldown for {cooldown_seconds:.0f}s (quota hit)")

def clear_key_cooldown(key: str) -> None:
    """Clears active cooldown for an API key."""
    if not key:
        return
    with _KEY_LOCK:
        _KEY_COOLDOWNS.pop(key, None)

def is_key_available(key: str) -> bool:
    """Checks whether an API key is available (not currently in cooldown)."""
    if not key:
        return False
    with _KEY_LOCK:
        exp = _KEY_COOLDOWNS.get(key)
        if exp is None:
            return True
        if time.time() >= exp:
            del _KEY_COOLDOWNS[key]
            return True
        return False

def get_next_free_key() -> str:
    """
    Returns the next free Gemini API key using round-robin rotation.
    Prioritizes healthy keys (not in cooldown). Falls back to earliest expiring key if all are cooling.
    """
    global _free_key_rr_counter
    all_keys = get_all_free_keys()
    if not all_keys:
        return ""

    with _KEY_LOCK:
        now = time.time()
        expired = [k for k, exp in _KEY_COOLDOWNS.items() if now >= exp]
        for k in expired:
            del _KEY_COOLDOWNS[k]

        available = [k for k in all_keys if k not in _KEY_COOLDOWNS]
        keys_to_pick = available if available else all_keys

        chosen = keys_to_pick[_free_key_rr_counter % len(keys_to_pick)]
        _free_key_rr_counter = (_free_key_rr_counter + 1) % 1_000_000
        return chosen

def get_candidate_free_keys(start_key: Optional[str] = None) -> List[str]:
    """
    Returns an ordered list of free keys to attempt for a request.
    Healthy keys are prioritized first (with `start_key` first among them if healthy).
    Cooling keys are placed at the end as a last resort.
    """
    all_keys = get_all_free_keys()
    if not all_keys:
        return [start_key] if start_key else []

    with _KEY_LOCK:
        now = time.time()
        expired = [k for k, exp in _KEY_COOLDOWNS.items() if now >= exp]
        for k in expired:
            del _KEY_COOLDOWNS[k]

        healthy = [k for k in all_keys if k not in _KEY_COOLDOWNS]
        cooling = [k for k in all_keys if k in _KEY_COOLDOWNS]

    candidates: List[str] = []
    if start_key and start_key in healthy:
        candidates.append(start_key)

    for k in healthy:
        if k not in candidates:
            candidates.append(k)

    for k in cooling:
        if k not in candidates:
            candidates.append(k)

    if not candidates and start_key:
        candidates.append(start_key)

    return candidates

def get_candidate_keys_for_request(api_key: Optional[str] = None) -> List[str]:
    """
    Returns the ordered list of keys to attempt for an AI request.
    - If `api_key` is the server's paid key (or not passed): returns the paid key first (if available)
      followed by candidate free keys as automatic fallbacks.
    - If `api_key` is one of our server's free keys: returns candidate free keys with `api_key` tried first.
    - If `api_key` is a custom user key (BYOK): returns [api_key].
    """
    all_free = get_all_free_keys()
    if not api_key:
        return get_candidate_free_keys()
    if api_key in all_free:
        return get_candidate_free_keys(api_key)

    paid_key = os.getenv("GEMINI_API_KEY", "").strip()
    # Server paid key: attempt paid key first (if not in cooldown), followed by candidate free keys
    if paid_key and api_key == paid_key:
        candidate_free = [k for k in get_candidate_free_keys() if k != paid_key]
        if is_key_available(paid_key):
            return [paid_key] + candidate_free
        return candidate_free if candidate_free else [paid_key]

    return [api_key]

def is_server_paid_gemini_key(api_key: Optional[str]) -> bool:
    """
    True when `api_key` (or None, which defaults to GEMINI_API_KEY in get_gemini_client)
    resolves to the server's primary paid GEMINI_API_KEY.
    """
    paid_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not paid_key:
        return False
    effective = (api_key or "").strip() or paid_key
    return effective == paid_key


def get_dedicated_free_key_for_grounding() -> Optional[str]:
    """
    Returns a healthy free-tier Gemini API key (distinct from GEMINI_API_KEY) to handle
    Google Search Grounding when the paid key's monthly free grounding cap is reached,
    or None if no separate free key is configured.
    """
    paid_key = os.getenv("GEMINI_API_KEY", "").strip()
    for candidate in get_candidate_free_keys():
        if candidate and candidate != paid_key:
            return candidate
    return None


def _get_today_str() -> str:
    """Returns today's date in YYYY-MM-DD format (UTC)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _get_month_start_str() -> str:
    """Returns the first day of the current UTC month in YYYY-MM-01 format (valid SQL DATE for monthly counters)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-01")

def get_api_key_mode() -> str:
    """
    Returns the API-key policy mode (env API_KEY_MODE). One of:
      - "unlimited": everyone uses the paid key with no per-user credit limits.
      - "limited":   paid key up to the daily quota, then falls back to the free key (default).
      - "free":      non-admins always use the free key; the paid key is never spent.
    Admins always get the paid key regardless of mode.
    Fails closed: a missing or misspelled value means "limited", never "unlimited".
    """
    mode = os.getenv("API_KEY_MODE", "limited").strip().lower()
    return mode if mode in ("unlimited", "limited", "free") else "limited"

def get_guest_api_key_mode() -> str:
    """
    Returns the operating mode for guest users:
      - 'limited': (default) Guests get a daily quota on the high-speed paid key,
                   then fall back to the free key.
      - 'unlimited': Guests get unlimited access on the paid key.
      - 'free': Guests are strictly on the free key.
    Configured via GUEST_API_KEY_MODE env var.
    If global API_KEY_MODE is 'free', guests are also forced to 'free'.
    Otherwise, defaults to 'limited' even when global API_KEY_MODE is 'unlimited'.
    """
    global_mode = get_api_key_mode()
    if global_mode == "free":
        return "free"
    explicit = os.getenv("GUEST_API_KEY_MODE", "").strip().lower()
    if explicit in ("limited", "unlimited", "free"):
        return explicit
    return "limited"

DEFAULT_REGISTERED_DAILY_CREDITS = 25
DEFAULT_GUEST_DAILY_CREDITS = 10
DEFAULT_CREDIT_COST_TEXT = 1
DEFAULT_CREDIT_COST_UPLOAD_MEDIUM = 2
DEFAULT_CREDIT_COST_UPLOAD_HEAVY = 3
DEFAULT_CREDIT_COST_GEMINI_IMAGE = 6
DEFAULT_CREDIT_COST_GEMINI_AUDIO = 10
DEFAULT_CREDIT_COST_GEMINI_AUDIO_FULL = 20
# Photo import drafts: one credit covers this many photo-events (title + description from up to
# 3 small photos each). Measured against Flash pricing, a 12-event call with 36 thumbnails at
# 384px costs well under one credit's worth (~$0.005), so this keeps the price honest.
DEFAULT_PHOTO_DRAFT_EVENTS_PER_CREDIT = 12
# AI-first photo import ("full" drafts): each event also gets a caption, a one-paragraph story,
# a cover pick and a category, so the output is ~5x longer. Priced per 8 events until measured
# (backend/scripts/photo_story_spike/measure_photo_story.py reports the real cost per event).
DEFAULT_PHOTO_DRAFT_FULL_EVENTS_PER_CREDIT = 8
# The whole-import story pass (text only: titles, chapters, merges): one credit per started
# block of this many events.
DEFAULT_PHOTO_STORY_EVENTS_PER_CREDIT = 120
# Historical links on a personal timeline: one text-only pass (~100 input tokens per event).
DEFAULT_HISTORY_LINKS_EVENTS_PER_CREDIT = 60


def get_guest_daily_limit() -> int:
    """
    Returns the daily AI credit bank for guest users (default 10).
    All AI actions draw from this shared daily credit bank according to their weight
    (1 credit for text actions, 6 for Gemini image, 10/20 for Gemini podcast audio).
    """
    try:
        return int(os.getenv("GUEST_DAILY_PAID_PROMPTS", str(DEFAULT_GUEST_DAILY_CREDITS)))
    except ValueError:
        return DEFAULT_GUEST_DAILY_CREDITS


# Guests are counted per anonymous session id; the per-IP counter is only a backstop against one
# person minting many sessions. It sits well above one guest's allowance so a classroom or a
# carrier-grade NAT doesn't share a single guest's credits (SC-12).
GUEST_IP_BACKSTOP_MULTIPLIER = 5


def get_guest_ip_daily_limit() -> int:
    """
    Returns the daily paid-credit ceiling per normalized public IP / IPv6 /64 prefix.
    Defaults to `GUEST_IP_BACKSTOP_MULTIPLIER` x `get_guest_daily_limit()` (50 with the default 10);
    `GUEST_IP_DAILY_PAID_PROMPTS` overrides it, never below the per-guest limit.
    """
    base = get_guest_daily_limit()
    default = base * GUEST_IP_BACKSTOP_MULTIPLIER if base > 0 else base
    raw = os.getenv("GUEST_IP_DAILY_PAID_PROMPTS", "").strip()
    if not raw:
        return default
    try:
        return max(base, int(raw))
    except ValueError:
        return default


def get_registered_daily_limit() -> int:
    """
    Returns the daily AI credit bank for registered (non-guest, non-admin) users (default 25).
    All AI actions draw from this shared daily credit bank according to their weight.
    """
    try:
        return int(os.getenv("DAILY_PAID_PROMPTS", str(DEFAULT_REGISTERED_DAILY_CREDITS)))
    except ValueError:
        return DEFAULT_REGISTERED_DAILY_CREDITS


def get_text_credit_cost() -> int:
    """Credit weight for standard text AI operations (timeline generate/refine, chat, quiz, podcast script)."""
    try:
        return max(1, int(os.getenv("CREDIT_COST_TEXT", str(DEFAULT_CREDIT_COST_TEXT))))
    except ValueError:
        return DEFAULT_CREDIT_COST_TEXT


def get_gemini_image_credit_cost() -> int:
    """Credit weight for generating one premium image with Gemini (free image engines cost 0)."""
    try:
        return max(1, int(os.getenv("CREDIT_COST_GEMINI_IMAGE", str(DEFAULT_CREDIT_COST_GEMINI_IMAGE))))
    except ValueError:
        return DEFAULT_CREDIT_COST_GEMINI_IMAGE


def get_gemini_audio_credit_cost() -> int:
    """Credit weight for rendering Gemini TTS podcast audio on Highlights or short (<= 12 events) episodes (free TTS costs 0)."""
    try:
        return max(1, int(os.getenv("CREDIT_COST_GEMINI_AUDIO", str(DEFAULT_CREDIT_COST_GEMINI_AUDIO))))
    except ValueError:
        return DEFAULT_CREDIT_COST_GEMINI_AUDIO


def get_gemini_audio_full_credit_cost() -> int:
    """Credit weight for rendering Gemini TTS podcast audio on Full-Story episodes (> 12 events; free TTS costs 0)."""
    try:
        return max(1, int(os.getenv("CREDIT_COST_GEMINI_AUDIO_FULL", str(DEFAULT_CREDIT_COST_GEMINI_AUDIO_FULL))))
    except ValueError:
        return DEFAULT_CREDIT_COST_GEMINI_AUDIO_FULL


def get_photo_draft_events_per_credit() -> int:
    """How many photo-events one credit drafts (Story Studio photo import)."""
    try:
        return max(1, int(os.getenv("PHOTO_DRAFT_EVENTS_PER_CREDIT", str(DEFAULT_PHOTO_DRAFT_EVENTS_PER_CREDIT))))
    except ValueError:
        return DEFAULT_PHOTO_DRAFT_EVENTS_PER_CREDIT


def get_photo_draft_full_events_per_credit() -> int:
    """How many photo-events one credit drafts in the AI-first ("full") mode."""
    try:
        return max(1, int(os.getenv("PHOTO_DRAFT_FULL_EVENTS_PER_CREDIT", str(DEFAULT_PHOTO_DRAFT_FULL_EVENTS_PER_CREDIT))))
    except ValueError:
        return DEFAULT_PHOTO_DRAFT_FULL_EVENTS_PER_CREDIT


def calculate_photo_draft_credit_cost(event_count: int, detail: str = "brief") -> int:
    """Credits for one photo-draft call: one per started block of events (minimum 1)."""
    n = max(1, int(event_count or 0))
    per = get_photo_draft_full_events_per_credit() if detail == "full" else get_photo_draft_events_per_credit()
    return max(1, -(-n // per))


def get_photo_story_events_per_credit() -> int:
    """How many events one credit covers in the photo-import story pass."""
    try:
        return max(1, int(os.getenv("PHOTO_STORY_EVENTS_PER_CREDIT", str(DEFAULT_PHOTO_STORY_EVENTS_PER_CREDIT))))
    except ValueError:
        return DEFAULT_PHOTO_STORY_EVENTS_PER_CREDIT


def calculate_photo_story_credit_cost(event_count: int) -> int:
    """Credits for one story pass over an import (text only): one per started block, minimum 1."""
    n = max(1, int(event_count or 0))
    return max(1, -(-n // get_photo_story_events_per_credit()))


def get_history_links_events_per_credit() -> int:
    """How many events one credit covers in the historical-links pass of a personal timeline."""
    try:
        return max(1, int(os.getenv("HISTORY_LINKS_EVENTS_PER_CREDIT", str(DEFAULT_HISTORY_LINKS_EVENTS_PER_CREDIT))))
    except ValueError:
        return DEFAULT_HISTORY_LINKS_EVENTS_PER_CREDIT


def calculate_history_links_credit_cost(event_count: int) -> int:
    """Credits for one historical-links pass: one per started block of events, minimum 1."""
    n = max(1, int(event_count or 0))
    return max(1, -(-n // get_history_links_events_per_credit()))


def get_upload_medium_credit_cost() -> int:
    """Credit weight for medium document/photo batch uploads (6-20 photos, 11-25 PDF pages, >15k chars, or chat file merge)."""
    try:
        return max(1, int(os.getenv("CREDIT_COST_UPLOAD_MEDIUM", str(DEFAULT_CREDIT_COST_UPLOAD_MEDIUM))))
    except ValueError:
        return DEFAULT_CREDIT_COST_UPLOAD_MEDIUM


def get_upload_heavy_credit_cost() -> int:
    """Credit weight for heavy document uploads (26+ PDF pages or heavy chat file merge)."""
    try:
        return max(1, int(os.getenv("CREDIT_COST_UPLOAD_HEAVY", str(DEFAULT_CREDIT_COST_UPLOAD_HEAVY))))
    except ValueError:
        return DEFAULT_CREDIT_COST_UPLOAD_HEAVY


def get_credit_costs() -> Dict[str, int]:
    """Returns the active credit cost schedule exposed to clients."""
    return {
        "text": get_text_credit_cost(),
        "upload_medium": get_upload_medium_credit_cost(),
        "upload_heavy": get_upload_heavy_credit_cost(),
        "gemini_image": get_gemini_image_credit_cost(),
        "gemini_audio": get_gemini_audio_credit_cost(),
        "gemini_audio_full": get_gemini_audio_full_credit_cost(),
    }


def calculate_upload_credit_cost(
    validated_uploads: Any,
    raw_text: Optional[str] = None,
    is_chat_or_refine: bool = False,
) -> int:
    """
    Calculates volume-based AI credit weight (1, 2, or 3 credits) for file/text uploads:
      - 1 credit (`text`): text/voice prompts, 1-5 images, <= 10 PDF pages, <= 15,000 text chars.
      - 2 credits (`upload_medium`): 6-20 images, 11-25 PDF pages, > 15,000 text chars,
        or attaching files in Chat (which runs a two-stage extraction + full timeline refinement).
      - 3 credits (`upload_heavy`): 26+ PDF pages, or heavy Chat file merges (>= 20 PDF pages,
        >= 12 images, or > 30,000 text chars).
    """
    raw_chars = len((raw_text or "").strip())
    if validated_uploads is None:
        if is_chat_or_refine and raw_chars > 30_000:
            return get_upload_heavy_credit_cost()
        if raw_chars > 15_000:
            return get_upload_medium_credit_cost()
        return get_text_credit_cost()

    pdf_pages = int(getattr(validated_uploads, "total_pdf_pages", 0) or 0)
    image_count = int(getattr(validated_uploads, "image_count", 0) or 0)
    extracted_docs = getattr(validated_uploads, "extracted_documents", None) or []
    extracted_chars = sum(len(txt or "") for _, txt in extracted_docs)
    total_text_chars = extracted_chars + raw_chars

    if pdf_pages >= 26 or (
        is_chat_or_refine and (pdf_pages >= 20 or image_count >= 12 or total_text_chars > 30_000)
    ):
        return get_upload_heavy_credit_cost()

    if (
        image_count >= 6
        or pdf_pages >= 11
        or total_text_chars > 15_000
        or (is_chat_or_refine and (pdf_pages > 0 or image_count > 0 or extracted_chars > 0))
    ):
        return get_upload_medium_credit_cost()

    return get_text_credit_cost()

def normalize_client_ip(client_ip: Optional[str]) -> str:
    """
    Normalizes client IP strings:
    - Strips whitespace and optional port suffix (e.g. "127.0.0.1:51234" -> "127.0.0.1")
    - Maps loopback addresses ('::1', 'localhost', '127.0.0.1') to '127.0.0.1'
    - For IPv6, truncates to the /64 network prefix (RFC 4941 privacy extensions change the interface identifier
      regularly on Windows / mobile devices, but the /64 prefix remains identical across tabs & connections)
    """
    if not client_ip or client_ip in ("unknown", ""):
        return "unknown"
    ip_str = client_ip.strip()
    # Strip port if present in IPv4 (e.g., "1.2.3.4:5678")
    if ":" in ip_str and not ip_str.startswith("[") and ip_str.count(":") == 1:
        ip_str = ip_str.split(":")[0]
    # Strip brackets if "[::1]:8080"
    if ip_str.startswith("[") and "]" in ip_str:
        ip_str = ip_str[1:ip_str.index("]")]

    # Check loopback
    if ip_str in ("::1", "localhost", "127.0.0.1"):
        return "127.0.0.1"

    try:
        ip_obj = ipaddress.ip_address(ip_str)
        if ip_obj.is_loopback:
            return "127.0.0.1"
        if isinstance(ip_obj, ipaddress.IPv6Address):
            network = ipaddress.IPv6Network(f"{ip_str}/64", strict=False)
            return str(network.network_address)
        return str(ip_obj)
    except ValueError:
        return ip_str

DEFAULT_IPV6_56_CEILING_MULTIPLIER = 4
GUEST_IP56_PREFIX = "guest_ip56:"


def get_ipv6_56_ceiling_multiplier() -> int:
    """
    A home IPv6 connection usually gets a /56 (256 x /64), so per-/64 guest ceilings alone can be
    sidestepped by hopping /64s. The /56 bucket's cap is this multiple of the per-IP cap (0 = off).
    """
    raw = os.getenv("GUEST_IPV6_56_MULTIPLIER", "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return DEFAULT_IPV6_56_CEILING_MULTIPLIER


def ipv6_coarse_network(client_ip: Optional[str]) -> Optional[str]:
    """The /56 network of a (non-loopback) IPv6 client address, else None (IPv4, unknown, disabled)."""
    if get_ipv6_56_ceiling_multiplier() <= 0:
        return None
    norm = normalize_client_ip(client_ip)
    if not norm or norm == "unknown":
        return None
    try:
        ip_obj = ipaddress.ip_address(norm)
    except ValueError:
        return None
    if not isinstance(ip_obj, ipaddress.IPv6Address) or ip_obj.is_loopback:
        return None
    return str(ipaddress.IPv6Network(f"{norm}/56", strict=False).network_address) + "/56"


def guest_identifier_cap(ident: str, guest_cap, ip_cap):
    """Cap for one guest identifier: per-session, per-IP, or the coarser IPv6 /56 bucket."""
    if ident.startswith("guest:"):
        return guest_cap
    if ident.startswith(GUEST_IP56_PREFIX):
        return ip_cap * get_ipv6_56_ceiling_multiplier()
    return ip_cap


IP_HASH_SALT_LABEL = "quota-ip-hash-salt-v1"


def _ip_hash_salt() -> str:
    """
    `QUOTA_IP_HASH_SALT` when set. In production, otherwise a secret derived from the full
    service-role key: the legacy default (the key's first 16 chars, i.e. the constant JWT header
    `eyJhbGciOiJIUzI1`) is public, so hashed IPs could be brute-forced (S-11). Changing the salt only
    re-buckets the current day's per-IP counters. Development keeps the legacy default.
    """
    explicit = os.getenv("QUOTA_IP_HASH_SALT")
    if explicit:
        return explicit
    if is_production_environment():
        derived = derived_secret(IP_HASH_SALT_LABEL)
        if derived:
            return derived
    return os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")[:16] or "chronix-quota-v1"


def _hash_guest_ip(norm_ip: str, date_str: Optional[str] = None) -> str:
    """
    One-way hashes normalized client IPs with a daily date component + optional server salt
    so raw visitor IP addresses are never stored in `ai_usage` or `daily_usage.json`.
    """
    day = date_str or _get_today_str()
    salt = _ip_hash_salt()
    digest = hashlib.sha256(f"{salt}:{day}:{norm_ip}".encode("utf-8")).hexdigest()[:24]
    return f"guest_ip:h_{digest}"

def get_guest_identifiers(
    user: Optional[Dict[str, Any]],
    client_ip: Optional[str] = None,
    date_str: Optional[str] = None,
) -> List[str]:
    """
    Returns the list of identifiers associated with a guest session:
    - If user has a persistent anonymous ID: 'guest:{user_id}'
    - If client_ip is known: hashed 'guest_ip:h_<digest>' (never raw IP)
    """
    ids: List[str] = []
    if user and user.get("id"):
        ids.append(f"guest:{user['id']}")
    norm_ip = normalize_client_ip(client_ip)
    if norm_ip and norm_ip != "unknown":
        ids.append(_hash_guest_ip(norm_ip, date_str=date_str))
        net56 = ipv6_coarse_network(norm_ip)
        if net56:
            ids.append(GUEST_IP56_PREFIX + _hash_guest_ip(net56, date_str=date_str).split(":", 1)[1])
    if not ids:
        ids.append("guest_ip:unknown")
    return ids

def get_guest_usage(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None, date_str: Optional[str] = None) -> int:
    """
    Returns effective daily usage for this guest against `get_guest_daily_limit()`,
    combining per-session usage (`guest:{id}`) and the shared IP ceiling (`GUEST_IP_DAILY_PAID_PROMPTS`).
    """
    guest_limit = get_guest_daily_limit()
    ip_limit = get_guest_ip_daily_limit()
    ids = get_guest_identifiers(user, client_ip, date_str=date_str)
    usages = get_usage_for_identifiers(ids, date_str=date_str)
    if not usages:
        return 0
    if ip_limit <= guest_limit or len(ids) == 1:
        base_vals = [v for i, v in usages.items() if not i.startswith(GUEST_IP56_PREFIX)]
        used = max(base_vals) if base_vals else 0
        for ident, val in usages.items():
            if ident.startswith(GUEST_IP56_PREFIX) and val >= guest_identifier_cap(ident, guest_limit, ip_limit):
                return max(used, guest_limit)
        return used
    session_used = 0
    remaining = []
    for ident, val in usages.items():
        if ident.startswith("guest:"):
            session_used = max(session_used, val)
        remaining.append(guest_identifier_cap(ident, guest_limit, ip_limit) - val)
    eff_remaining = max(0, min(remaining))
    return max(session_used, guest_limit - eff_remaining)

def record_guest_usage(
    user: Optional[Dict[str, Any]],
    client_ip: Optional[str] = None,
    date_str: Optional[str] = None,
    credits: int = 1,
) -> int:
    """
    Increments usage by `credits` for all identifiers tied to this guest (session ID and hashed IP).
    """
    ids = get_guest_identifiers(user, client_ip, date_str=date_str)
    current_max = 0
    for ident in ids:
        c = record_prompt_usage(ident, date_str=date_str, credits=credits)
        if c > current_max and not ident.startswith(GUEST_IP56_PREFIX):
            current_max = c
    return current_max

def refund_guest_usage(
    user: Optional[Dict[str, Any]],
    client_ip: Optional[str] = None,
    date_str: Optional[str] = None,
    credits: int = 1,
) -> None:
    """
    Refunds `credits` usage for all identifiers tied to this guest.
    """
    ids = get_guest_identifiers(user, client_ip, date_str=date_str)
    for ident in ids:
        refund_prompt_usage(ident, date_str=date_str, credits=credits)

def get_quota_identifier(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None) -> str:
    """
    Returns the primary key used for daily quota tracking:
      - Registered users (authenticated with email/google): user['id'] (device-independent)
      - Guests (anonymous Supabase users or unauthenticated): hashed 'guest_ip:h_...',
        falling back to 'guest:{user_id}' if client_ip is not provided.
    """
    if user and not is_guest_user(user) and user.get("id"):
        return str(user["id"])
    norm_ip = normalize_client_ip(client_ip)
    if norm_ip and norm_ip != "unknown":
        return _hash_guest_ip(norm_ip)
    if user and user.get("id"):
        return f"guest:{user['id']}"
    return "guest_ip:unknown"

def _load_usage_data() -> Dict[str, Dict[str, int]]:
    """Loads usage data from JSON file with lock protection."""
    if not USAGE_FILE.exists():
        return {}
    try:
        with open(USAGE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        # A corrupt/half-written file must never silently zero everyone's usage unnoticed.
        logger.error(f"Failed to read usage file {USAGE_FILE} (usage counts may reset): {e}")
        return {}

def _save_usage_data(data: Dict[str, Dict[str, int]]) -> None:
    """Atomically saves usage data, keeping the most recent days plus the current month's bucket."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        keep_dates = set(sorted(data.keys(), reverse=True)[:USAGE_RETENTION_DAYS])
        month_key = _get_month_start_str()
        if month_key in data:
            keep_dates.add(month_key)
        if "1970-01-01" in data:
            keep_dates.add("1970-01-01")
        filtered = {k: data[k] for k in sorted(keep_dates, reverse=True)}
        # Write to a temp file then replace, so a crash/restart mid-write cannot corrupt the store.
        tmp_path = USAGE_FILE.with_suffix(".tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(filtered, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, USAGE_FILE)
    except Exception as e:
        logger.error(f"Failed to write usage file {USAGE_FILE}: {e}")

# --- Durable (Supabase) usage store -------------------------------------------------
# The local JSON file lives on the app server's filesystem, which is EPHEMERAL on
# platforms like Render/Railway: every redeploy, restart or idle spin-down wipes it and
# resets everyone's daily quota. When Supabase is configured the counters are stored
# there instead. The local file is the store only when Supabase is not configured, and an
# outage fallback only outside production (SC-09): in production a store failure fails
# closed (`UsageStoreUnavailable`) instead of handing everyone a fresh, unreconciled quota.

USAGE_TABLE = "ai_usage"
USAGE_RETENTION_DAYS = 3
# A short, separate pool timeout: under load, waiting for a free connection must fail fast
# (and trip the breaker) instead of eating the whole read timeout.
_REMOTE_TIMEOUT = httpx.Timeout(10.0, connect=5.0, pool=2.0)
DEFAULT_QUOTA_STORE_COOLDOWN_SECONDS = 20.0
# How long one half-open probe may hold the breaker before another request may probe.
_HALF_OPEN_PROBE_TIMEOUT = 15.0
_remote_disabled_until: float = 0.0
_breaker_open = False
_probe_started_at: float = 0.0
_BREAKER_LOCK = threading.Lock()
_ORIG_HTTP_CLIENT = httpx.Client
_HTTP_CLIENT_LOCK = threading.Lock()
_SHARED_HTTP_CLIENT: Optional[httpx.Client] = None


class UsageStoreUnavailable(RuntimeError):
    """The durable usage store can't be reached and this deployment may not use the local file."""


@contextmanager
def _remote_http_client():
    """Reuse a bounded persistent sync httpx.Client unless monkeypatched in unit tests."""
    global _SHARED_HTTP_CLIENT
    if httpx.Client is not _ORIG_HTTP_CLIENT:
        client_cls = httpx.Client
        with client_cls(timeout=_REMOTE_TIMEOUT) as client:
            yield client
        return
    with _HTTP_CLIENT_LOCK:
        if _SHARED_HTTP_CLIENT is None or _SHARED_HTTP_CLIENT.is_closed:
            _SHARED_HTTP_CLIENT = _ORIG_HTTP_CLIENT(
                timeout=_REMOTE_TIMEOUT,
                # Covers the quota executor plus the activity-log pool (SC-08 / SC-13).
                limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
            )
        client = _SHARED_HTTP_CLIENT
    yield client

def _supabase_config() -> Tuple[str, str]:
    """Reads Supabase config lazily so it works regardless of load_dotenv() ordering."""
    return os.getenv("SUPABASE_URL", "").rstrip("/"), os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

def usage_store_is_durable() -> bool:
    """True when daily usage counters are stored in Supabase rather than the ephemeral local file."""
    url, key = _supabase_config()
    return bool(url and key)


def local_usage_fallback_allowed() -> bool:
    """
    May a Supabase failure fall back to the local file? `QUOTA_LOCAL_FALLBACK=true|false` decides
    explicitly; unset, it is allowed everywhere except production.
    """
    raw = os.getenv("QUOTA_LOCAL_FALLBACK", "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return not is_production_environment()


def _quota_store_cooldown() -> float:
    try:
        return max(1.0, float(os.getenv("QUOTA_STORE_COOLDOWN_SECONDS", "") or DEFAULT_QUOTA_STORE_COOLDOWN_SECONDS))
    except ValueError:
        return DEFAULT_QUOTA_STORE_COOLDOWN_SECONDS


def _remote_call_permitted() -> bool:
    """
    Circuit breaker. Closed: every call goes out. Open: no calls until the cooldown ends. Then
    half-open: exactly one request probes the store; the rest stay on the open-state behaviour
    until that probe succeeds (closes) or fails (re-opens for another cooldown).
    """
    global _probe_started_at
    now = time.time()
    if now < _remote_disabled_until:
        return False
    if not _breaker_open:
        return True
    with _BREAKER_LOCK:
        if not _breaker_open:
            return True
        if _probe_started_at and now - _probe_started_at < _HALF_OPEN_PROBE_TIMEOUT:
            return False
        _probe_started_at = now
        return True


def _note_remote_success() -> None:
    """Closes an open breaker, but only for calls made after the cooldown (the half-open probe):
    a slow request that started before the failure must not cut the cooldown short."""
    global _breaker_open, _probe_started_at
    if not _breaker_open or time.time() < _remote_disabled_until:
        return
    with _BREAKER_LOCK:
        if not _breaker_open or time.time() < _remote_disabled_until:
            return
        logger.warning("Supabase usage store recovered; quota counting is back to normal.")
        _breaker_open = False
        _probe_started_at = 0.0


def reset_usage_store_breaker() -> None:
    """Closes the breaker (tests and admin tooling)."""
    global _remote_disabled_until, _breaker_open, _probe_started_at, _reserve_rpc_missing_until
    global _record_spend_rpc_missing_until
    with _BREAKER_LOCK:
        _remote_disabled_until = 0.0
        _breaker_open = False
        _probe_started_at = 0.0
    _reserve_rpc_missing_until = 0.0
    _record_spend_rpc_missing_until = 0.0


def _usage_remote_available() -> bool:
    return usage_store_is_durable() and _remote_call_permitted()


def _use_remote() -> bool:
    """
    True: talk to Supabase. False: use the local file (no Supabase, or a dev outage fallback).
    Raises `UsageStoreUnavailable` while the breaker is open and the local file is not allowed.
    """
    if _usage_remote_available():
        return True
    if usage_store_is_durable() and not local_usage_fallback_allowed():
        raise UsageStoreUnavailable("usage store temporarily unavailable")
    return False


def _after_remote_failure() -> None:
    """A remote call just failed: fall through to the local file when allowed, else fail closed."""
    if not local_usage_fallback_allowed():
        raise UsageStoreUnavailable("usage store request failed")


def _disable_remote_temporarily(operation: str, detail: Any) -> None:
    """Opens the breaker for a short cooldown after a Supabase failure."""
    global _remote_disabled_until, _breaker_open, _probe_started_at
    cooldown = _quota_store_cooldown()
    with _BREAKER_LOCK:
        _remote_disabled_until = time.time() + cooldown
        _breaker_open = True
        _probe_started_at = 0.0
    if local_usage_fallback_allowed():
        consequence = (
            f"Falling back to the EPHEMERAL local file for {cooldown:.0f}s - quota counts may reset on "
            "restart until it recovers."
        )
    else:
        consequence = (
            f"Failing closed for {cooldown:.0f}s: paid-key text runs in basic mode, premium features "
            "are declined and server-paid counters are skipped."
        )
    logger.error(
        f"Supabase usage store {operation} failed ({detail}). {consequence} "
        f"Ensure the '{USAGE_TABLE}' table and increment_ai_usage() function exist (see README)."
    )

def _remote_headers() -> Dict[str, str]:
    _, key = _supabase_config()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

def _remote_get_usages(date_key: str, identifiers: List[str]) -> Optional[Dict[str, int]]:
    """Fetches usage counts for several identifiers in ONE request. None means the call failed."""
    url, _ = _supabase_config()
    if not identifiers:
        return {}
    quoted = ",".join('"' + ident.replace('"', '\\"') + '"' for ident in identifiers)
    try:
        with _remote_http_client() as client:
            resp = client.get(
                f"{url}/rest/v1/{USAGE_TABLE}",
                headers=_remote_headers(),
                params={
                    "select": "identifier,count",
                    "usage_date": f"eq.{date_key}",
                    "identifier": f"in.({quoted})",
                },
            )
        if resp.status_code != 200:
            _disable_remote_temporarily("read", f"HTTP {resp.status_code}: {resp.text[:200]}")
            return None
        rows = resp.json()
        result = {row["identifier"]: int(row.get("count") or 0) for row in rows}
        _note_remote_success()
        return result
    except Exception as e:
        _disable_remote_temporarily("read", e)
        return None

def _remote_change_usage(date_key: str, identifier: str, delta: int) -> Optional[int]:
    """Atomically applies `delta` to a counter via the increment_ai_usage RPC. None means it failed."""
    url, _ = _supabase_config()
    try:
        with _remote_http_client() as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/increment_ai_usage",
                headers=_remote_headers(),
                json={"p_date": date_key, "p_identifier": identifier, "p_delta": delta},
            )
        if resp.status_code not in (200, 201):
            _disable_remote_temporarily("increment", f"HTTP {resp.status_code}: {resp.text[:200]}")
            return None
        val = int(resp.json())
        _note_remote_success()
        if httpx.Client is _ORIG_HTTP_CLIENT and delta > 0:
            prune_expired_remote_usage()
        return val
    except Exception as e:
        _disable_remote_temporarily("increment", e)
        return None

def _local_get_usage(date_key: str, user_id: str) -> int:
    with _LOCK:
        return _load_usage_data().get(date_key, {}).get(user_id, 0)

def _local_change_usage(date_key: str, user_id: str, delta: int) -> int:
    with _LOCK:
        data = _load_usage_data()
        day = data.setdefault(date_key, {})
        current = max(0, day.get(user_id, 0) + delta)
        day[user_id] = current
        _save_usage_data(data)
        return current

def get_usage_for_identifiers(identifiers: List[str], date_str: Optional[str] = None) -> Dict[str, int]:
    """Returns the recorded usage for each identifier on the given date (default today)."""
    ids = [i for i in identifiers if i]
    if not ids:
        return {}
    date_key = date_str or _get_today_str()
    if _use_remote():
        remote = _remote_get_usages(date_key, ids)
        if remote is not None:
            return {ident: remote.get(ident, 0) for ident in ids}
        _after_remote_failure()
    return {ident: _local_get_usage(date_key, ident) for ident in ids}


def _change_usage_delta(date_key: str, identifier: str, delta: int) -> int:
    if _use_remote():
        new_count = _remote_change_usage(date_key, identifier, delta)
        if new_count is not None:
            return new_count
        _after_remote_failure()
    return _local_change_usage(date_key, identifier, delta)


def get_user_daily_usage(user_id: str, date_str: Optional[str] = None) -> int:
    """Returns the number of AI operations used by user_id for the given date (default today)."""
    if not user_id:
        return 0
    return get_usage_for_identifiers([user_id], date_str=date_str).get(user_id, 0)

def record_prompt_usage(user_id: str, date_str: Optional[str] = None, credits: int = 1) -> int:
    """Increments and records `credits` AI usage units for user_id on the given date (default today)."""
    if not user_id:
        return 0
    return _change_usage_delta(date_str or _get_today_str(), user_id, max(1, int(credits)))

def refund_prompt_usage(user_id: str, date_str: Optional[str] = None, credits: int = 1) -> int:
    """Decrements `credits` AI usage units for user_id on the given date (clamped to 0)."""
    if not user_id:
        return 0
    return _change_usage_delta(date_str or _get_today_str(), user_id, -max(1, int(credits)))


# --- One-round-trip credit reservation (P-08) -------------------------------------------
# `reserve_ai_credits` (backend/migrations/002_reserve_ai_credits.sql) increments every identifier
# of a caller, checks each against its cap and keeps or rolls back the whole reservation in one
# transaction, optionally returning extra counters (the caller's spend) from the same snapshot.
# Deployments without the function keep the per-identifier `increment_ai_usage` path.
RESERVE_CREDITS_RPC = "reserve_ai_credits"
_RESERVE_RPC_RECHECK_SECONDS = 600.0
_reserve_rpc_missing_until: float = 0.0
_RPC_MISSING_CODES = ("PGRST202", "PGRST203", "42883")


def _is_missing_rpc_response(resp: Any) -> bool:
    """PostgREST's "function not found" (404 PGRST202 & co). A 404 carrying another Postgres code
    (e.g. 42P01, missing table) is a store failure, not a missing migration."""
    try:
        body = resp.json()
    except Exception:
        body = None
    code = body.get("code") if isinstance(body, dict) else None
    if code:
        return code in _RPC_MISSING_CODES
    return resp.status_code == 404


def _remote_reserve_credits(
    date_key: str,
    entries: List[Tuple[str, int]],
    delta: int,
    keep_overlimit: bool,
    read_ids: List[str],
) -> Tuple[str, Optional[Tuple[bool, bool, Dict[str, int]]]]:
    """Returns ("ok", (within, kept, reads)), ("missing", None) or ("failed", None)."""
    global _reserve_rpc_missing_until
    url, _ = _supabase_config()
    payload = {
        "p_date": date_key,
        "p_identifiers": [ident for ident, _ in entries],
        "p_caps": [int(cap) for _, cap in entries],
        "p_delta": int(delta),
        "p_keep_overlimit": bool(keep_overlimit),
        "p_read_identifiers": list(read_ids),
    }
    try:
        with _remote_http_client() as client:
            resp = client.post(
                f"{url}/rest/v1/rpc/{RESERVE_CREDITS_RPC}", headers=_remote_headers(), json=payload
            )
        if resp.status_code in (200, 201):
            body = resp.json()
            reads = {str(k): int(v or 0) for k, v in (body.get("reads") or {}).items()}
            result = (bool(body["within_limit"]), bool(body["kept"]), reads)
            _note_remote_success()
            if httpx.Client is _ORIG_HTTP_CLIENT and result[1]:
                prune_expired_remote_usage()
            return "ok", result
        if _is_missing_rpc_response(resp):
            # The store answered, so it is healthy; only the migration is missing.
            _note_remote_success()
            _reserve_rpc_missing_until = time.time() + _RESERVE_RPC_RECHECK_SECONDS
            logger.info(
                f"{RESERVE_CREDITS_RPC}() is not installed (HTTP {resp.status_code}); using per-counter "
                "increments. Run backend/migrations/002_reserve_ai_credits.sql to enable it."
            )
            return "missing", None
        _disable_remote_temporarily("reserve", f"HTTP {resp.status_code}: {resp.text[:200]}")
        return "failed", None
    except Exception as e:
        _disable_remote_temporarily("reserve", e)
        return "failed", None


def _reserve_capped_counters(
    entries: List[Tuple[str, int]],
    cost: int,
    *,
    keep_overlimit_tick: bool,
    read_ids: Optional[List[str]] = None,
) -> Tuple[bool, bool, Optional[Dict[str, int]]]:
    """
    Adds `cost` to every `(identifier, cap)` counter for today. Returns
    `(within_limit, kept_increment, reads)`:
    - within_limit: no counter ended above its cap (the reservation is kept);
    - otherwise the reservation is kept only when `keep_overlimit_tick` and no counter straddled
      its cap (`new - cost < cap < new`), i.e. the caller was already at/over every cap it exceeds;
    - reads: today's counts for `read_ids` from the same snapshot (RPC path only, else None).
    """
    date_key = _get_today_str()
    # Check the cached "RPC missing" verdict first: `_use_remote()` may claim the half-open probe.
    if time.time() >= _reserve_rpc_missing_until and _use_remote():
        status, result = _remote_reserve_credits(
            date_key, entries, cost, keep_overlimit_tick, list(read_ids or [])
        )
        if status == "ok" and result is not None:
            return result
        if status == "failed":
            _after_remote_failure()

    new_vals: List[Tuple[str, int, int]] = []
    for ident, cap in entries:
        new_vals.append((ident, _change_usage_delta(date_key, ident, cost), cap))

    if not any(val > cap for _, val, cap in new_vals):
        return True, True, None

    any_straddled = any((val - cost) < cap < val for _, val, cap in new_vals)
    if keep_overlimit_tick and not any_straddled:
        return False, True, None

    for ident, _, _ in new_vals:
        _change_usage_delta(date_key, ident, -cost)
    return False, False, None


GOOGLE_CLOUD_TTS_USAGE_ID = "system:google_cloud_tts_chars"
DEFAULT_GOOGLE_CLOUD_TTS_MONTHLY_CHAR_LIMIT = 950_000


def get_google_cloud_tts_monthly_limit() -> int:
    """Hard monthly character ceiling for Google Cloud TTS (default 950,000 to stay safely inside the 1M free tier)."""
    try:
        return int(os.getenv("GOOGLE_CLOUD_TTS_MONTHLY_CHAR_LIMIT", str(DEFAULT_GOOGLE_CLOUD_TTS_MONTHLY_CHAR_LIMIT)))
    except ValueError:
        return DEFAULT_GOOGLE_CLOUD_TTS_MONTHLY_CHAR_LIMIT


def get_google_cloud_tts_monthly_usage(month_str: Optional[str] = None) -> int:
    """Returns the total characters synthesized via Google Cloud TTS in the current UTC month."""
    month_key = month_str or _get_month_start_str()
    return get_usage_for_identifiers([GOOGLE_CLOUD_TTS_USAGE_ID], date_str=month_key).get(GOOGLE_CLOUD_TTS_USAGE_ID, 0)


def get_google_cloud_tts_remaining_chars(month_str: Optional[str] = None) -> int:
    """Returns remaining characters in the current UTC month's Google Cloud TTS budget."""
    return max(0, get_google_cloud_tts_monthly_limit() - get_google_cloud_tts_monthly_usage(month_str))


def reserve_google_cloud_tts_chars(char_count: int, month_str: Optional[str] = None) -> bool:
    """
    Atomically reserves `char_count` characters from the monthly Google Cloud TTS budget.
    Returns True if within the monthly hard cap, or False (after rolling back) if the cap would be exceeded.
    """
    n = max(0, int(char_count))
    if n == 0:
        return True
    limit = get_google_cloud_tts_monthly_limit()
    if limit <= 0:
        return False
    month_key = month_str or _get_month_start_str()
    try:
        new_total = _change_usage_delta(month_key, GOOGLE_CLOUD_TTS_USAGE_ID, n)
        if new_total > limit:
            _change_usage_delta(month_key, GOOGLE_CLOUD_TTS_USAGE_ID, -n)
            logger.warning(
                f"Google Cloud TTS monthly character cap reached ({new_total - n}/{limit} chars in {month_key}); "
                "falling back to free edge-tts."
            )
            return False
    except UsageStoreUnavailable:
        logger.warning("Usage store unavailable: Google Cloud TTS budget can't be reserved; using edge-tts.")
        return False
    return True


def refund_google_cloud_tts_chars(char_count: int, month_str: Optional[str] = None) -> int:
    """Refunds `char_count` characters back to the monthly Google Cloud TTS budget when a request fails."""
    n = max(0, int(char_count))
    if n == 0:
        return get_google_cloud_tts_monthly_usage(month_str)
    month_key = month_str or _get_month_start_str()
    try:
        return _change_usage_delta(month_key, GOOGLE_CLOUD_TTS_USAGE_ID, -n)
    except UsageStoreUnavailable:
        logger.warning(f"Usage store unavailable: could not refund {n} Google Cloud TTS chars.")
        return 0


GOOGLE_SEARCH_GROUNDING_USAGE_ID = "system:google_search_grounding_queries"
GOOGLE_SEARCH_GROUNDING_FREE_TIER_QUERIES = 5_000
GOOGLE_SEARCH_GROUNDING_USD_PER_QUERY = 0.014  # $14.00 / 1,000 executed search queries beyond 5,000/month
DEFAULT_GOOGLE_SEARCH_GROUNDING_MONTHLY_LIMIT = 4_750


def get_google_search_grounding_monthly_limit() -> int:
    """
    Monthly Google Search Grounding query cap on the server's paid Gemini key
    (default 4,750 to stay safely inside Google's 5,000 free monthly search queries on Gemini 3+ models).
    Set GOOGLE_SEARCH_GROUNDING_MONTHLY_QUERY_LIMIT <= 0 (e.g. -1) for uncapped paid grounding.
    """
    raw = os.getenv(
        "GOOGLE_SEARCH_GROUNDING_MONTHLY_QUERY_LIMIT",
        str(DEFAULT_GOOGLE_SEARCH_GROUNDING_MONTHLY_LIMIT),
    ).strip()
    try:
        val = int(raw)
        return val if val > 0 else -1
    except ValueError:
        return DEFAULT_GOOGLE_SEARCH_GROUNDING_MONTHLY_LIMIT


def get_google_search_grounding_monthly_usage(month_str: Optional[str] = None) -> int:
    """Returns total Google Search Grounding queries executed on the server's paid key in the current UTC month."""
    month_key = month_str or _get_month_start_str()
    return get_usage_for_identifiers([GOOGLE_SEARCH_GROUNDING_USAGE_ID], date_str=month_key).get(
        GOOGLE_SEARCH_GROUNDING_USAGE_ID, 0
    )


def get_google_search_grounding_remaining_queries(month_str: Optional[str] = None) -> int:
    """Returns remaining monthly Google Search Grounding queries on the paid key (-1 when uncapped)."""
    limit = get_google_search_grounding_monthly_limit()
    if limit <= 0:
        return -1
    return max(0, limit - get_google_search_grounding_monthly_usage(month_str))


def is_paid_grounding_within_monthly_cap(month_str: Optional[str] = None) -> bool:
    """True when the server's paid Gemini key has not yet reached its monthly Google Search Grounding cap."""
    limit = get_google_search_grounding_monthly_limit()
    if limit <= 0:
        return True
    try:
        return get_google_search_grounding_monthly_usage(month_str) < limit
    except UsageStoreUnavailable:
        # The monthly count can't be checked, so never risk paid overage queries.
        return False


def record_google_search_grounding_queries(
    query_count: int,
    month_str: Optional[str] = None,
) -> Tuple[int, float]:
    """
    Atomically records `query_count` executed Google Search Grounding queries on the server's paid key
    and returns `(new_monthly_total, overage_cost_usd)`.
    Queries up to `GOOGLE_SEARCH_GROUNDING_FREE_TIER_QUERIES` (5,000/month) cost $0.00;
    every query above 5,000 adds $0.014 ($14.00 / 1,000 queries).
    """
    n = max(0, int(query_count or 0))
    try:
        if n == 0:
            return get_google_search_grounding_monthly_usage(month_str), 0.0
        month_key = month_str or _get_month_start_str()
        new_total = _change_usage_delta(month_key, GOOGLE_SEARCH_GROUNDING_USAGE_ID, n)
    except UsageStoreUnavailable:
        logger.warning(f"Usage store unavailable: {n} grounding queries were not counted.")
        return 0, 0.0
    old_total = max(0, new_total - n)
    billable_queries = max(0, new_total - GOOGLE_SEARCH_GROUNDING_FREE_TIER_QUERIES) - max(
        0, old_total - GOOGLE_SEARCH_GROUNDING_FREE_TIER_QUERIES
    )
    overage_usd = round(billable_queries * GOOGLE_SEARCH_GROUNDING_USD_PER_QUERY, 6) if billable_queries > 0 else 0.0
    return new_total, overage_usd


DEFAULT_GROUNDING_RESERVED_QUERIES_PER_CALL = 4


def get_grounding_reserved_queries_per_call() -> int:
    """How many search queries one grounded call reserves up front (a grounded step usually runs 2-6)."""
    try:
        val = int(os.getenv("GROUNDING_RESERVED_QUERIES_PER_CALL", "") or DEFAULT_GROUNDING_RESERVED_QUERIES_PER_CALL)
    except ValueError:
        val = DEFAULT_GROUNDING_RESERVED_QUERIES_PER_CALL
    return min(20, max(1, val))


def _grounding_overage_usd(new_total: int, added: int) -> float:
    old_total = max(0, new_total - added)
    billable = max(0, new_total - GOOGLE_SEARCH_GROUNDING_FREE_TIER_QUERIES) - max(
        0, old_total - GOOGLE_SEARCH_GROUNDING_FREE_TIER_QUERIES
    )
    return round(billable * GOOGLE_SEARCH_GROUNDING_USD_PER_QUERY, 6) if billable > 0 else 0.0


def reserve_google_search_grounding_queries(month_str: Optional[str] = None) -> Optional[int]:
    """
    Reserves the expected searches of one grounded call on the paid key BEFORE the call (B-30):
    increment first, then check, so concurrent callers can't all pass a stale "under the cap" read.
    Returns the number reserved (0 when uncapped), or None when the cap is reached or the store is
    unavailable (fail closed: never risk paid overage). Settle with `settle_google_search_grounding_queries`.
    """
    limit = get_google_search_grounding_monthly_limit()
    if limit <= 0:
        return 0
    n = get_grounding_reserved_queries_per_call()
    month_key = month_str or _get_month_start_str()
    try:
        new_total = _change_usage_delta(month_key, GOOGLE_SEARCH_GROUNDING_USAGE_ID, n)
    except UsageStoreUnavailable:
        return None
    if new_total - n < limit:
        return n
    release_google_search_grounding_reservation(n, month_str=month_key)
    return None


def release_google_search_grounding_reservation(reserved: int, month_str: Optional[str] = None) -> None:
    """Returns an unused reservation (the grounded call never ran or failed)."""
    n = max(0, int(reserved or 0))
    if n == 0:
        return
    try:
        _change_usage_delta(month_str or _get_month_start_str(), GOOGLE_SEARCH_GROUNDING_USAGE_ID, -n)
    except UsageStoreUnavailable:
        logger.warning(f"Usage store unavailable: a {n}-query grounding reservation was not released.")


def settle_google_search_grounding_queries(
    reserved: int,
    executed: int,
    month_str: Optional[str] = None,
) -> Tuple[int, float]:
    """
    Corrects a reservation with the searches actually executed (refunds or charges the difference)
    and returns `(monthly_total, overage_cost_usd_of_the_executed_queries)`.
    """
    reserved = max(0, int(reserved or 0))
    executed = max(0, int(executed or 0))
    if reserved == 0:
        return record_google_search_grounding_queries(executed, month_str=month_str)
    month_key = month_str or _get_month_start_str()
    delta = executed - reserved
    try:
        if delta:
            new_total = _change_usage_delta(month_key, GOOGLE_SEARCH_GROUNDING_USAGE_ID, delta)
        else:
            new_total = get_google_search_grounding_monthly_usage(month_key)
    except UsageStoreUnavailable:
        logger.warning(f"Usage store unavailable: grounding reservation of {reserved} not corrected to {executed}.")
        return 0, 0.0
    return new_total, _grounding_overage_usd(new_total, executed)


def get_google_search_grounding_status(month_str: Optional[str] = None) -> Dict[str, Any]:
    """Returns monthly Google Search Grounding usage and cap summary for admin diagnostics."""
    limit = get_google_search_grounding_monthly_limit()
    used = get_google_search_grounding_monthly_usage(month_str)
    return {
        "used": used,
        "limit": limit,
        "remaining": max(0, limit - used) if limit > 0 else -1,
        "free_tier_queries": GOOGLE_SEARCH_GROUNDING_FREE_TIER_QUERIES,
        "usd_per_overage_query": GOOGLE_SEARCH_GROUNDING_USD_PER_QUERY,
    }


COMMUNITY_DAILY_PAID_USAGE_ID = "system:community_paid_prompts"
COMMUNITY_MONTHLY_PAID_USAGE_ID = "system:community_paid_prompts_month"


def get_community_daily_paid_limit() -> int:
    """
    System-wide daily cap on non-admin paid Gemini API operations across the entire community pool.
    Returns -1 (unlimited) when unset or <= 0.
    """
    raw = os.getenv("DAILY_COMMUNITY_PAID_LIMIT", "-1").strip()
    try:
        val = int(raw)
        return val if val > 0 else -1
    except ValueError:
        return -1


def get_community_monthly_paid_limit() -> int:
    """
    System-wide monthly cap on non-admin paid Gemini API operations across the entire community pool.
    Returns -1 (unlimited) when unset or <= 0.
    """
    raw = os.getenv("MONTHLY_COMMUNITY_PAID_LIMIT", "-1").strip()
    try:
        val = int(raw)
        return val if val > 0 else -1
    except ValueError:
        return -1


DEFAULT_COMMUNITY_DONATION_URL = "https://ko-fi.com/chronixai"

COMMUNITY_LEDGER_DATE = "1970-01-01"
# `ai_usage.count` is a Postgres `integer` (max 2,147,483,647). Storing cumulative dollar totals
# in micro-dollars would overflow at ~$2,147, so totals are kept in whole CENTS (safe to ~$21M).
# Per-call AI costs are often fractions of a cent, so sub-cent spend accumulates in a separate
# micro-dollar remainder counter that carries into the cents counter (always < 1 cent + in-flight).
COMMUNITY_SPENT_CENTS_ID = "system:community_spent_cents"
COMMUNITY_SPENT_REMAINDER_MICRO_ID = "system:community_spent_remainder_micro"
COMMUNITY_DONATED_CENTS_ID = "system:community_donated_cents"
COMMUNITY_DONATIONS_COUNT_ID = "system:community_donations_count"
COMMUNITY_SPEND_SEEDED_ID = "system:community_spend_seeded"
# Legacy micro-dollar totals (pre-cents format). Migrated into the cents counters exactly once.
_LEGACY_SPENT_MICRO_ID = "system:community_spent_microdollars"
_LEGACY_DONATED_MICRO_ID = "system:community_donated_microdollars"
_LEGACY_MIGRATED_ID = "system:community_ledger_cents_migrated"

_MICRO_PER_CENT = 10_000
_MICRO_PER_USD = 1_000_000
# Upper bound for any single ledger value/delta so cents always fit in a Postgres integer.
MAX_COMMUNITY_LEDGER_USD = 20_000_000.0
_MAX_DONATIONS_COUNT = 2_000_000_000

_LEDGER_IDS = [
    COMMUNITY_SPENT_CENTS_ID,
    COMMUNITY_SPENT_REMAINDER_MICRO_ID,
    COMMUNITY_DONATED_CENTS_ID,
    COMMUNITY_DONATIONS_COUNT_ID,
    COMMUNITY_SPEND_SEEDED_ID,
    _LEGACY_SPENT_MICRO_ID,
    _LEGACY_DONATED_MICRO_ID,
    _LEGACY_MIGRATED_ID,
]

CURRENCY_TO_USD_RATES: Dict[str, float] = {
    "USD": 1.0,
    "ILS": 0.27,
    "NIS": 0.27,
    "EUR": 1.08,
    "GBP": 1.28,
    "CAD": 0.73,
    "AUD": 0.66,
    "JPY": 0.0067,
    "CHF": 1.13,
}


def _get_float_env(name: str, default: float = 0.0) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        val = float(raw)
        return val if (math.isfinite(val) and val >= 0) else default
    except ValueError:
        return default


def _validated_usd(value: Any, field: str) -> float:
    """Parses a non-negative, finite USD amount within the int-safe ledger range (raises ValueError)."""
    try:
        val = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be a number")
    if not math.isfinite(val) or val < 0:
        raise ValueError(f"{field} must be a finite, non-negative number")
    if val > MAX_COMMUNITY_LEDGER_USD:
        raise ValueError(f"{field} exceeds the maximum supported value ({MAX_COMMUNITY_LEDGER_USD:,.0f})")
    return val


def get_community_donation_url() -> str:
    """Optional voluntary donation URL (e.g., Ko-fi / Buy Me a Coffee / GitHub Sponsors) to support the community AI pool."""
    return (
        os.getenv("COMMUNITY_DONATION_URL", "").strip()
        or os.getenv("VITE_DONATION_URL", "").strip()
        or DEFAULT_COMMUNITY_DONATION_URL
    )


def _add_community_spend_micro(delta_micro: int) -> None:
    """
    Atomically adds a positive micro-dollar amount to the spend total.
    Whole cents go straight to the cents counter; the sub-cent part goes to the remainder counter.
    A carry is performed only by the increment whose (old, new] range crossed a whole-cent boundary.
    Increments are serialized by the store, so each boundary is crossed exactly once and the
    remainder is always >= the carries still pending - the carry can never be clamped or doubled.
    """
    if delta_micro <= 0:
        return
    cents, rem = divmod(int(delta_micro), _MICRO_PER_CENT)
    if cents:
        _change_usage_delta(COMMUNITY_LEDGER_DATE, COMMUNITY_SPENT_CENTS_ID, cents)
    if rem:
        new_rem = _change_usage_delta(COMMUNITY_LEDGER_DATE, COMMUNITY_SPENT_REMAINDER_MICRO_ID, rem)
        old_rem = max(0, new_rem - rem)
        carry = new_rem // _MICRO_PER_CENT - old_rem // _MICRO_PER_CENT
        if carry > 0:
            _change_usage_delta(COMMUNITY_LEDGER_DATE, COMMUNITY_SPENT_REMAINDER_MICRO_ID, -carry * _MICRO_PER_CENT)
            _change_usage_delta(COMMUNITY_LEDGER_DATE, COMMUNITY_SPENT_CENTS_ID, carry)


def _migrate_legacy_ledger_counters(usages: Dict[str, int]) -> bool:
    """
    One-time conversion of the legacy micro-dollar totals into the cents counters.
    Guarded by an atomic claim so concurrent workers never migrate twice. Returns True if it migrated.
    """
    legacy_spent = int(usages.get(_LEGACY_SPENT_MICRO_ID, 0) or 0)
    legacy_donated = int(usages.get(_LEGACY_DONATED_MICRO_ID, 0) or 0)
    if (legacy_spent <= 0 and legacy_donated <= 0) or int(usages.get(_LEGACY_MIGRATED_ID, 0) or 0) > 0:
        return False
    if _change_usage_delta(COMMUNITY_LEDGER_DATE, _LEGACY_MIGRATED_ID, 1) != 1:
        return False  # another worker claimed the migration
    if legacy_spent > 0:
        _add_community_spend_micro(legacy_spent)
        _change_usage_delta(COMMUNITY_LEDGER_DATE, _LEGACY_SPENT_MICRO_ID, -legacy_spent)
    if legacy_donated > 0:
        cents = int(round(legacy_donated / _MICRO_PER_CENT))
        if cents:
            _change_usage_delta(COMMUNITY_LEDGER_DATE, COMMUNITY_DONATED_CENTS_ID, cents)
        _change_usage_delta(COMMUNITY_LEDGER_DATE, _LEGACY_DONATED_MICRO_ID, -legacy_donated)
    logger.info(
        f"Migrated legacy community ledger counters to cents (spent_micro={legacy_spent}, donated_micro={legacy_donated})."
    )
    return True


def _read_ledger_counters() -> Dict[str, int]:
    """Reads all ledger counters in one store round-trip (migrating the legacy format if present)."""
    usages = get_usage_for_identifiers(_LEDGER_IDS, date_str=COMMUNITY_LEDGER_DATE)
    if _migrate_legacy_ledger_counters(usages):
        usages = get_usage_for_identifiers(_LEDGER_IDS, date_str=COMMUNITY_LEDGER_DATE)
    spent_cents = max(0, int(usages.get(COMMUNITY_SPENT_CENTS_ID, 0) or 0))
    spent_rem = max(0, int(usages.get(COMMUNITY_SPENT_REMAINDER_MICRO_ID, 0) or 0))
    return {
        "spent_cents": spent_cents,
        "spent_rem_micro": spent_rem,
        "spent_micro": spent_cents * _MICRO_PER_CENT + spent_rem,
        "donated_cents": max(0, int(usages.get(COMMUNITY_DONATED_CENTS_ID, 0) or 0)),
        "donations_count": max(0, int(usages.get(COMMUNITY_DONATIONS_COUNT_ID, 0) or 0)),
        "spend_seeded": int(usages.get(COMMUNITY_SPEND_SEEDED_ID, 0) or 0),
    }


# In-process cache for the ledger and the Community Pool status (P-08): `GET /api/user/quota` and
# the public ledger endpoint used to re-read them from Supabase on every call. Only used with the
# remote store (local-file reads are cheap); admin/donation writes invalidate it.
DEFAULT_COMMUNITY_STATUS_CACHE_SECONDS = 45.0
_COMMUNITY_CACHE_LOCK = threading.Lock()
_community_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}


def _community_status_cache_ttl() -> float:
    try:
        return max(0.0, float(os.getenv("COMMUNITY_STATUS_CACHE_SECONDS", "") or DEFAULT_COMMUNITY_STATUS_CACHE_SECONDS))
    except ValueError:
        return DEFAULT_COMMUNITY_STATUS_CACHE_SECONDS


def invalidate_community_status_cache() -> None:
    with _COMMUNITY_CACHE_LOCK:
        _community_cache.clear()


def _cached_community_value(name: str, loader) -> Dict[str, Any]:
    ttl = _community_status_cache_ttl()
    if ttl <= 0 or not usage_store_is_durable():
        return loader()
    now = time.monotonic()
    with _COMMUNITY_CACHE_LOCK:
        hit = _community_cache.get(name)
        if hit and now - hit[0] < ttl:
            return dict(hit[1])
    value = loader()
    with _COMMUNITY_CACHE_LOCK:
        _community_cache[name] = (now, dict(value))
    return dict(value)


def get_cached_community_ledger() -> Dict[str, Any]:
    """`get_community_ledger()` served from a short in-process cache (display paths only)."""
    return _cached_community_value("ledger", get_community_ledger)


def get_cached_community_pool_status() -> Dict[str, Any]:
    """`get_community_pool_status()` served from a short in-process cache (display paths only)."""
    return _cached_community_value("pool", get_community_pool_status)


def get_community_ledger() -> Dict[str, Any]:
    """
    Returns the cumulative Community Transparency Ledger (total AI spend vs. voluntary community donations).
    Stored in `ai_usage` under date '1970-01-01' (zero DB schema changes required).
    """
    counters = _read_ledger_counters()

    base_spent_usd = _get_float_env("COMMUNITY_SPENT_USD_BASE", 0.0)
    base_donated_usd = _get_float_env("COMMUNITY_DONATED_USD_BASE", 0.0)

    spent_usd = round(base_spent_usd + counters["spent_micro"] / _MICRO_PER_USD, 4)
    donated_usd = round(base_donated_usd + counters["donated_cents"] / 100.0, 2)
    balance_usd = round(donated_usd - spent_usd, 2)

    if spent_usd > 0:
        coverage_percent = min(999, int(round((donated_usd / spent_usd) * 100)))
    elif donated_usd > 0:
        coverage_percent = 100
    else:
        coverage_percent = 0

    return {
        "spent_usd": spent_usd,
        "donated_usd": donated_usd,
        "donations_count": counters["donations_count"],
        "coverage_percent": coverage_percent,
        "balance_usd": balance_usd,
        "donation_url": get_community_donation_url(),
        "kofi_webhook_configured": bool(os.getenv("KOFI_VERIFICATION_TOKEN", "").strip()),
        "spend_seeded": counters["spend_seeded"] > 0,
    }


def record_community_spend_usd(cost_usd: float) -> float:
    """
    Atomically adds `cost_usd` to the cumulative community AI spend.
    Returns the amount actually recorded in USD (0.0 when the input is invalid or non-positive).
    """
    try:
        val = float(cost_usd or 0.0)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(val) or val <= 0:
        return 0.0
    val = min(val, MAX_COMMUNITY_LEDGER_USD)
    delta_micro = int(round(val * _MICRO_PER_USD))
    if delta_micro <= 0:
        return 0.0
    try:
        _add_community_spend_micro(delta_micro)
    except UsageStoreUnavailable:
        logger.warning(f"Usage store unavailable: ${val:.6f} of community spend was not added to the ledger.")
        return 0.0
    return delta_micro / _MICRO_PER_USD


UNCONVERTED_DONATION_PREFIX = "kofi_unconverted"


def _change_ledger_counter_strict(identifier: str, delta: int) -> int:
    """Like `_change_usage_delta`, but with Supabase configured it never falls back to the local file:
    a donation counted in an ephemeral file (or a dedupe claim made there) would be lost or doubled
    when Ko-fi retries. Raises `UsageStoreUnavailable` so the webhook answers 503 and Ko-fi retries."""
    if not usage_store_is_durable():
        return _local_change_usage(COMMUNITY_LEDGER_DATE, identifier, delta)
    if not _usage_remote_available():
        raise UsageStoreUnavailable("usage store temporarily unavailable")
    new_count = _remote_change_usage(COMMUNITY_LEDGER_DATE, identifier, delta)
    if new_count is None:
        raise UsageStoreUnavailable("usage store request failed")
    return new_count


def _claim_donation_counter(tx_ident: str) -> int:
    return _change_ledger_counter_strict(tx_ident, 1)


def _release_donation_claim(tx_ident: str) -> None:
    """Undo a dedupe claim whose donation could not be recorded, so Ko-fi's retry is not a 'duplicate'."""
    try:
        _change_ledger_counter_strict(tx_ident, -1)
    except UsageStoreUnavailable:
        logger.error(f"Could not release the dedupe claim {tx_ident}; its retry will be treated as a duplicate.")


def _record_unconverted_donation(raw_amount: float, currency: str, clean_tx: str) -> Dict[str, Any]:
    """
    A donation in a currency without a USD rate is not added to the USD ledger, but it must not vanish
    either: it is logged at ERROR and kept as per-currency counters (amount in hundredths and count) so
    an admin can convert it and adjust the ledger. Deduplicated by transaction like any donation.
    """
    code = re.sub(r"[^A-Z]", "", currency)[:3] or "UNK"
    minor_units = int(round(raw_amount * 100))
    empty = {"recorded": False, "duplicate": False, "unconverted": True, "added_usd": 0.0}
    if minor_units <= 0 or minor_units > int(MAX_COMMUNITY_LEDGER_USD * 100 * 1000):
        logger.error(f"Ignoring out-of-range community donation in unsupported currency {code!r}: {raw_amount}")
        return {**empty, **get_community_ledger()}
    if clean_tx and _claim_donation_counter(f"kofi_tx:{clean_tx}") > 1:
        return {**empty, "duplicate": True, **get_community_ledger()}
    try:
        _change_ledger_counter_strict(f"{UNCONVERTED_DONATION_PREFIX}:{code}:minor", minor_units)
        _change_ledger_counter_strict(f"{UNCONVERTED_DONATION_PREFIX}:{code}:count", 1)
    except UsageStoreUnavailable:
        if clean_tx:
            _release_donation_claim(f"kofi_tx:{clean_tx}")
        raise
    logger.error(
        f"Community donation in unsupported currency {code}: {raw_amount} (tx={clean_tx or 'none'}). "
        f"Kept under '{UNCONVERTED_DONATION_PREFIX}:{code}:*'; convert it and adjust the ledger, "
        "or add a rate to CURRENCY_TO_USD_RATES."
    )
    return {**empty, "pending_currency": code, **get_community_ledger()}


def record_community_donation_usd(
    amount: float,
    tx_id: Optional[str] = None,
    currency: str = "USD",
) -> Dict[str, Any]:
    """
    Atomically records a voluntary community donation (e.g., from Ko-fi webhook).
    Requires a known currency and non-empty `tx_id` so retries or unknown currencies
    never inflate or double-count the ledger.
    """
    try:
        raw_amount = float(amount or 0.0)
    except (TypeError, ValueError):
        raw_amount = 0.0
    if not math.isfinite(raw_amount) or raw_amount <= 0:
        return {"recorded": False, "duplicate": False, "added_usd": 0.0, **get_community_ledger()}

    curr = (currency or "USD").strip().upper()
    clean_tx = re.sub(r"[^a-zA-Z0-9_\-:]", "", str(tx_id or "").strip())[:80]
    if curr not in CURRENCY_TO_USD_RATES:
        return _record_unconverted_donation(raw_amount, curr, clean_tx)

    if not clean_tx:
        logger.warning("Rejecting community donation without a valid transaction ID")
        return {"recorded": False, "duplicate": False, "added_usd": 0.0, **get_community_ledger()}

    rate = CURRENCY_TO_USD_RATES[curr]
    usd_amount = raw_amount * rate
    if usd_amount > MAX_COMMUNITY_LEDGER_USD:
        logger.warning(f"Ignoring out-of-range community donation amount: {raw_amount} {curr}")
        return {"recorded": False, "duplicate": False, "added_usd": 0.0, **get_community_ledger()}

    delta_cents = int(round(usd_amount * 100))
    if delta_cents <= 0:
        return {"recorded": False, "duplicate": False, "added_usd": 0.0, **get_community_ledger()}

    tx_ident = f"kofi_tx:{clean_tx}"
    # Atomic claim: only the first delivery of a transaction sees the counter reach 1.
    if _claim_donation_counter(tx_ident) > 1:
        return {"recorded": False, "duplicate": True, "added_usd": 0.0, **get_community_ledger()}

    try:
        _change_ledger_counter_strict(COMMUNITY_DONATED_CENTS_ID, delta_cents)
    except UsageStoreUnavailable:
        _release_donation_claim(tx_ident)
        raise
    try:
        _change_ledger_counter_strict(COMMUNITY_DONATIONS_COUNT_ID, 1)
    except UsageStoreUnavailable:
        # The amount is in; only the donation count is short by one. Retrying would double the amount.
        logger.error(f"Community donation {clean_tx} was recorded but its count could not be incremented.")
    invalidate_community_status_cache()

    return {
        "recorded": True,
        "duplicate": False,
        "added_usd": round(delta_cents / 100.0, 2),
        **get_community_ledger(),
    }


def set_community_ledger_totals(
    spent_usd: Optional[float] = None,
    donated_usd: Optional[float] = None,
    donations_count: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Admin utility: sets the cumulative community ledger totals to exact values by applying
    the difference against the current stored counters.
    Raises ValueError for non-finite, negative or out-of-range values (nothing is written then).
    """
    spent_val = _validated_usd(spent_usd, "spent_usd") if spent_usd is not None else None
    donated_val = _validated_usd(donated_usd, "donated_usd") if donated_usd is not None else None
    count_val: Optional[int] = None
    if donations_count is not None:
        try:
            count_val = int(donations_count)
        except (TypeError, ValueError, OverflowError):
            raise ValueError("donations_count must be an integer")
        if count_val < 0 or count_val > _MAX_DONATIONS_COUNT:
            raise ValueError("donations_count is out of range")

    current = _read_ledger_counters()

    if spent_val is not None:
        base_spent_micro = int(round(_get_float_env("COMMUNITY_SPENT_USD_BASE", 0.0) * _MICRO_PER_USD))
        target_micro = max(0, int(round(spent_val * _MICRO_PER_USD)) - base_spent_micro)
        target_cents, target_rem = divmod(target_micro, _MICRO_PER_CENT)
        cents_delta = target_cents - current["spent_cents"]
        rem_delta = target_rem - current["spent_rem_micro"]
        if cents_delta:
            _change_usage_delta(COMMUNITY_LEDGER_DATE, COMMUNITY_SPENT_CENTS_ID, cents_delta)
        if rem_delta:
            _change_usage_delta(COMMUNITY_LEDGER_DATE, COMMUNITY_SPENT_REMAINDER_MICRO_ID, rem_delta)
        if current["spend_seeded"] == 0:
            _change_usage_delta(COMMUNITY_LEDGER_DATE, COMMUNITY_SPEND_SEEDED_ID, 1)

    if donated_val is not None:
        base_donated_cents = int(round(_get_float_env("COMMUNITY_DONATED_USD_BASE", 0.0) * 100))
        target_cents = max(0, int(round(donated_val * 100)) - base_donated_cents)
        delta = target_cents - current["donated_cents"]
        if delta:
            _change_usage_delta(COMMUNITY_LEDGER_DATE, COMMUNITY_DONATED_CENTS_ID, delta)

    if count_val is not None:
        delta = count_val - current["donations_count"]
        if delta:
            _change_usage_delta(COMMUNITY_LEDGER_DATE, COMMUNITY_DONATIONS_COUNT_ID, delta)

    invalidate_community_status_cache()
    return get_community_ledger()


_ACTIVITY_LOG_PAGE_SIZE = 1000  # Supabase's default PostgREST max-rows
_ACTIVITY_LOG_MAX_PAGES = 1000
_SEED_RETRY_COOLDOWN = 600.0
_last_seed_failure_at: float = 0.0
_SYNC_LOCK = threading.Lock()


def _fetch_historical_spend_micro() -> Tuple[Optional[int], Optional[str]]:
    """
    Sums historical community (non-admin, server-key) AI spend from `public.activity_log`,
    paging by primary key. Returns (total_micro, None) on success or (None, reason) when the
    log is unavailable or a request fails - callers must NOT apply a partial/failed result.
    """
    url, key = _supabase_config()
    if not (url and key):
        return None, "Supabase is not configured, so there is no activity_log to sync from."

    total_usd = 0.0
    last_id = 0
    try:
        with _remote_http_client() as client:
            for _ in range(_ACTIVITY_LOG_MAX_PAGES):
                resp = client.get(
                    f"{url}/rest/v1/activity_log",
                    headers=_remote_headers(),
                    params={
                        "select": "id,cost_usd,key_tier,is_admin",
                        "cost_usd": "gt.0",
                        "is_admin": "is.false",
                        "id": f"gt.{last_id}",
                        "order": "id.asc",
                        "limit": str(_ACTIVITY_LOG_PAGE_SIZE),
                    },
                )
                if resp.status_code != 200:
                    return None, f"activity_log query failed (HTTP {resp.status_code}): {resp.text[:200]}"
                rows = resp.json()
                if not isinstance(rows, list):
                    return None, "activity_log query returned an unexpected response."
                for r in rows:
                    if not isinstance(r, dict):
                        continue
                    try:
                        last_id = max(last_id, int(r.get("id") or 0))
                    except (TypeError, ValueError):
                        pass
                    if r.get("is_admin") or r.get("key_tier") in ("custom", "admin_paid"):
                        continue
                    try:
                        cost = float(r.get("cost_usd") or 0.0)
                    except (TypeError, ValueError):
                        continue
                    if math.isfinite(cost) and cost > 0:
                        total_usd += cost
                if len(rows) < _ACTIVITY_LOG_PAGE_SIZE:
                    break
            else:
                logger.warning(
                    f"activity_log spend sync stopped after {_ACTIVITY_LOG_MAX_PAGES} pages; total may be understated."
                )
    except Exception as e:
        return None, f"activity_log query failed: {e}"

    total_usd = min(total_usd, MAX_COMMUNITY_LEDGER_USD)
    return int(round(total_usd * _MICRO_PER_USD)), None


def _sync_historical_spend(force: bool) -> Tuple[Dict[str, Any], Optional[str]]:
    """
    Ensures the ledger's spend is AT LEAST the historical sum from `activity_log`.
    Never lowers the counter and never writes anything when the activity_log read fails.
    Returns (ledger, error_message_or_None).
    """
    global _last_seed_failure_at
    if not force:
        # Fast path for the public endpoint: one (cached) read, no lock, once seeded (or cooling down).
        ledger = get_cached_community_ledger()
        if ledger.get("spend_seeded") or time.time() < _last_seed_failure_at + _SEED_RETRY_COOLDOWN:
            return ledger, None

    with _SYNC_LOCK:
        counters = _read_ledger_counters()
        seeded = counters["spend_seeded"] > 0
        if not force and seeded:
            return get_community_ledger(), None  # another request seeded it while we waited

        hist_micro, error = _fetch_historical_spend_micro()
        if hist_micro is None:
            if not usage_store_is_durable():
                # Nothing to sync from (local-only deployment): stop retrying on every public read.
                if not seeded:
                    _change_usage_delta(COMMUNITY_LEDGER_DATE, COMMUNITY_SPEND_SEEDED_ID, 1)
            else:
                _last_seed_failure_at = time.time()
                logger.warning(f"Community spend sync skipped: {error}")
            return get_community_ledger(), error

        if hist_micro > counters["spent_micro"]:
            _add_community_spend_micro(hist_micro - counters["spent_micro"])
        if not seeded:
            _change_usage_delta(COMMUNITY_LEDGER_DATE, COMMUNITY_SPEND_SEEDED_ID, 1)
        invalidate_community_status_cache()
        return get_community_ledger(), None


def sync_historical_spend_from_activity_log(force: bool = False) -> Dict[str, Any]:
    """
    Calculates historical AI spend from `public.activity_log` (if Supabase is configured)
    and ensures the community ledger's `spent_usd` is at least that historical sum.
    Runs automatically once (when `spend_seeded` is False) or when `force=True` (Admin sync).
    """
    ledger, _ = _sync_historical_spend(force)
    return ledger


def admin_sync_historical_spend() -> Tuple[Dict[str, Any], Optional[str]]:
    """Admin-triggered sync. Returns (ledger, error); `error` is set when activity_log could not be read."""
    return _sync_historical_spend(force=True)


def get_community_pool_status(
    date_str: Optional[str] = None,
    month_str: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Returns the current status of the shared Community AI Pool (daily & monthly caps, usage,
    remaining fast prompts, whether the pool is currently exhausted, voluntary donation link,
    and cumulative transparency ledger).
    """
    daily_limit = get_community_daily_paid_limit()
    monthly_limit = get_community_monthly_paid_limit()
    daily_used = 0
    monthly_used = 0

    if daily_limit > 0:
        day_key = date_str or _get_today_str()
        daily_used = get_usage_for_identifiers([COMMUNITY_DAILY_PAID_USAGE_ID], date_str=day_key).get(
            COMMUNITY_DAILY_PAID_USAGE_ID, 0
        )

    if monthly_limit > 0:
        m_key = month_str or _get_month_start_str()
        monthly_used = get_usage_for_identifiers([COMMUNITY_MONTHLY_PAID_USAGE_ID], date_str=m_key).get(
            COMMUNITY_MONTHLY_PAID_USAGE_ID, 0
        )

    daily_exhausted = daily_limit > 0 and daily_used >= daily_limit
    monthly_exhausted = monthly_limit > 0 and monthly_used >= monthly_limit
    exhausted = daily_exhausted or monthly_exhausted
    ledger = get_cached_community_ledger()

    return {
        "enabled": daily_limit > 0 or monthly_limit > 0,
        "daily_limit": daily_limit,
        "daily_used": daily_used,
        "daily_remaining": max(0, daily_limit - daily_used) if daily_limit > 0 else -1,
        "monthly_limit": monthly_limit,
        "monthly_used": monthly_used,
        "monthly_remaining": max(0, monthly_limit - monthly_used) if monthly_limit > 0 else -1,
        "exhausted": exhausted,
        "donation_url": get_community_donation_url(),
        "spent_usd": ledger["spent_usd"],
        "donated_usd": ledger["donated_usd"],
        "donations_count": ledger["donations_count"],
        "coverage_percent": ledger["coverage_percent"],
        "balance_usd": ledger["balance_usd"],
        "kofi_webhook_configured": ledger["kofi_webhook_configured"],
    }


def reserve_community_paid_prompt(
    date_str: Optional[str] = None,
    month_str: Optional[str] = None,
    credits: int = 1,
) -> bool:
    """
    Atomically reserves `credits` paid units from the global Community Pool budget (if daily/monthly caps are configured).
    Returns True if within the global community budget, or False (after rolling back) if the cap would be exceeded.
    """
    cost = max(1, int(credits))
    daily_limit = get_community_daily_paid_limit()
    monthly_limit = get_community_monthly_paid_limit()
    if daily_limit <= 0 and monthly_limit <= 0:
        return True

    day_key = date_str or _get_today_str()
    m_key = month_str or _get_month_start_str()

    if daily_limit > 0:
        new_daily = _change_usage_delta(day_key, COMMUNITY_DAILY_PAID_USAGE_ID, cost)
        if new_daily > daily_limit:
            _change_usage_delta(day_key, COMMUNITY_DAILY_PAID_USAGE_ID, -cost)
            logger.warning(
                f"Community Pool daily paid cap reached ({new_daily - cost}+{cost}/{daily_limit} on {day_key}); "
                "falling back to free keys."
            )
            return False

    if monthly_limit > 0:
        new_monthly = _change_usage_delta(m_key, COMMUNITY_MONTHLY_PAID_USAGE_ID, cost)
        if new_monthly > monthly_limit:
            _change_usage_delta(m_key, COMMUNITY_MONTHLY_PAID_USAGE_ID, -cost)
            if daily_limit > 0:
                _change_usage_delta(day_key, COMMUNITY_DAILY_PAID_USAGE_ID, -cost)
            logger.warning(
                f"Community Pool monthly paid cap reached ({new_monthly - cost}+{cost}/{monthly_limit} in {m_key}); "
                "falling back to free keys."
            )
            return False

    return True


def refund_community_paid_prompt(
    date_str: Optional[str] = None,
    month_str: Optional[str] = None,
    credits: int = 1,
) -> None:
    """Refunds `credits` paid units back to the global Community Pool counters when a job is cancelled or fails."""
    cost = max(1, int(credits))
    daily_limit = get_community_daily_paid_limit()
    monthly_limit = get_community_monthly_paid_limit()
    try:
        if daily_limit > 0:
            day_key = date_str or _get_today_str()
            _change_usage_delta(day_key, COMMUNITY_DAILY_PAID_USAGE_ID, -cost)
        if monthly_limit > 0:
            m_key = month_str or _get_month_start_str()
            _change_usage_delta(m_key, COMMUNITY_MONTHLY_PAID_USAGE_ID, -cost)
    except UsageStoreUnavailable:
        logger.warning(f"Usage store unavailable: Community Pool refund of {cost} credit(s) skipped.")


def community_pool_reserved_for_tier(key_tier: Optional[str]) -> bool:
    """
    True when a request resolved via `resolve_gemini_key(increment_usage=True)` holds a Community
    Pool slot. Only the "paid" tier reserves one; "free" means the user was over their personal
    limit or the pool reservation was rolled back, and custom/admin keys never touch the pool.
    """
    return key_tier == "paid"


def refund_user_quota(
    user: Optional[Dict[str, Any]],
    client_ip: Optional[str] = None,
    refund_pool: bool = False,
    credits: Optional[int] = None,
) -> None:
    """
    Refunds daily AI credits for a non-admin user/guest (defaults to `get_text_credit_cost()`).
    Pass `refund_pool=True` ONLY when the original request actually reserved a Community Pool
    slot (see `community_pool_reserved_for_tier`); otherwise the global cap would be under-counted.
    """
    cost = max(1, int(credits if credits is not None else get_text_credit_cost()))
    if is_admin_user(user):
        return
    try:
        if is_guest_user(user):
            refund_guest_usage(user, client_ip, credits=cost)
        else:
            user_id = user.get("id") if user else "anonymous"
            refund_prompt_usage(str(user_id), credits=cost)
    except UsageStoreUnavailable:
        # Fail-closed outage: the refund is lost (the caller is under-, never over-served).
        logger.warning(f"Usage store unavailable: refund of {cost} credit(s) skipped.")
    if refund_pool:
        refund_community_paid_prompt(credits=cost)

def increment_user_quota(
    user: Optional[Dict[str, Any]],
    client_ip: Optional[str] = None,
    credits: int = 1,
) -> None:
    """Records/increments `credits` daily AI credits for a non-admin user/guest."""
    cost = max(1, int(credits))
    if is_admin_user(user):
        return
    if is_guest_user(user):
        record_guest_usage(user, client_ip, credits=cost)
    else:
        user_id = user.get("id") if user else "anonymous"
        record_prompt_usage(str(user_id), credits=cost)

# --- Real-cost backstop (hidden daily USD caps) -------------------------------------
# Credits are a fixed, user-visible price per action. Real Gemini cost per action varies
# (output length, model retries, failures that are refunded to the user), so actual spend on
# the server's paid key is also metered in micro-dollars per identity and system-wide.
# The caps sit well above what normal use of the daily credits costs, so honest users never
# hit them. When one is reached the caller quietly falls back to the free keys (text features)
# and premium features (Gemini images / audio) are declined, exactly as if credits ran out.

DEFAULT_DAILY_USD_CAP_REGISTERED = 0.50
DEFAULT_DAILY_USD_CAP_GUEST = 0.20
DEFAULT_DAILY_COMMUNITY_USD_LIMIT = 5.00
SPEND_ID_PREFIX = "spend:"
COMMUNITY_DAILY_SPEND_MICRO_ID = "system:community_spend_micro_day"

_request_client_ip: ContextVar[Optional[str]] = ContextVar("chronix_request_client_ip", default=None)


def set_request_client_ip(client_ip: Optional[str]) -> None:
    """Remembers the caller IP for the current request/task (inherited by background jobs it spawns)."""
    _request_client_ip.set(client_ip)


def get_request_client_ip() -> Optional[str]:
    return _request_client_ip.get()


# Per-request record of which key tier actually served the caller, surfaced to the client as the
# `X-ChroniX-AI-Tier` response header so the UI learns about a fast→basic switch on the very
# request where it happens. The ContextVar holds a mutable dict (set by the HTTP middleware) so
# writes made inside `asyncio.to_thread` workers — which run on a *copy* of the context — still
# reach the middleware that created it.
AI_TIER_HEADER = "X-ChroniX-AI-Tier"
_request_ai_tier: ContextVar[Optional[Dict[str, str]]] = ContextVar("chronix_request_ai_tier", default=None)


def begin_request_ai_tier_tracking() -> Dict[str, str]:
    holder: Dict[str, str] = {}
    _request_ai_tier.set(holder)
    return holder


def note_request_ai_tier(tier: Optional[str]) -> None:
    """Records the tier for the current request. 'free' is sticky: if any AI step of the request
    ran in basic mode, the caller experienced basic mode."""
    holder = _request_ai_tier.get()
    if holder is None or not tier:
        return
    if holder.get("tier") == "free":
        return
    holder["tier"] = tier


def get_fast_ai_resets_at() -> str:
    """ISO-8601 UTC timestamp of the next daily credit reset (credit days are UTC dates)."""
    now = datetime.now(timezone.utc)
    next_midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return next_midnight.isoformat().replace("+00:00", "Z")


def _usd_cap_env(name: str, default: float) -> float:
    """Reads a USD cap; returns -1.0 when disabled (<= 0) and the default when unset/invalid."""
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        val = float(raw)
    except ValueError:
        return default
    if not math.isfinite(val) or val <= 0:
        return -1.0
    return val


def get_registered_daily_usd_cap() -> float:
    return _usd_cap_env("DAILY_USD_CAP_REGISTERED", DEFAULT_DAILY_USD_CAP_REGISTERED)


def get_guest_daily_usd_cap() -> float:
    return _usd_cap_env("DAILY_USD_CAP_GUEST", DEFAULT_DAILY_USD_CAP_GUEST)


def get_guest_ip_daily_usd_cap() -> float:
    """Per-IP guest cap: `GUEST_IP_BACKSTOP_MULTIPLIER` x the per-guest cap unless GUEST_IP_DAILY_USD_CAP is set."""
    base = get_guest_daily_usd_cap()
    if base <= 0:
        return base
    raw = _usd_cap_env("GUEST_IP_DAILY_USD_CAP", base * GUEST_IP_BACKSTOP_MULTIPLIER)
    return max(base, raw) if raw > 0 else base


def get_community_daily_usd_limit() -> float:
    return _usd_cap_env("DAILY_COMMUNITY_USD_LIMIT", DEFAULT_DAILY_COMMUNITY_USD_LIMIT)


def _usd_to_micro(usd: float) -> int:
    return int(round(usd * _MICRO_PER_USD))


def _spend_identifiers(user: Optional[Dict[str, Any]], client_ip: Optional[str]) -> List[Tuple[str, float]]:
    """(identifier, cap_usd) pairs for the caller's personal spend counters. Empty for admins."""
    if is_admin_user(user):
        return []
    if is_guest_user(user):
        guest_cap = get_guest_daily_usd_cap()
        ip_cap = get_guest_ip_daily_usd_cap()
        return [
            (SPEND_ID_PREFIX + ident, guest_identifier_cap(ident, guest_cap, ip_cap))
            for ident in get_guest_identifiers(user, client_ip)
        ]
    user_id = str(user.get("id")) if user and user.get("id") else "anonymous"
    return [(SPEND_ID_PREFIX + user_id, get_registered_daily_usd_cap())]


def get_spend_status(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None) -> Dict[str, Any]:
    """
    Returns {"capped": bool, "reason": "personal" | "community" | None} for today's real-cost caps,
    using a single store read. Admins are never capped.
    """
    if is_admin_user(user):
        return {"capped": False, "reason": None}
    plan = _spend_check_plan(user, client_ip)
    if not plan[2]:
        return {"capped": False, "reason": None}
    return _spend_status_from_usages(plan, get_usage_for_identifiers(plan[2]))


def _spend_check_plan(
    user: Optional[Dict[str, Any]], client_ip: Optional[str]
) -> Tuple[List[Tuple[str, float]], float, List[str]]:
    """(personal (identifier, cap) pairs, community limit, every identifier to read) for today."""
    personal = [(ident, cap) for ident, cap in _spend_identifiers(user, client_ip) if cap > 0]
    community_limit = get_community_daily_usd_limit()
    ids = [ident for ident, _ in personal]
    if community_limit > 0:
        ids.append(COMMUNITY_DAILY_SPEND_MICRO_ID)
    return personal, community_limit, ids


def _spend_status_from_usages(
    plan: Tuple[List[Tuple[str, float]], float, List[str]], usages: Dict[str, int]
) -> Dict[str, Any]:
    personal, community_limit, _ = plan
    for ident, cap in personal:
        if usages.get(ident, 0) >= _usd_to_micro(cap):
            return {"capped": True, "reason": "personal"}
    if community_limit > 0 and usages.get(COMMUNITY_DAILY_SPEND_MICRO_ID, 0) >= _usd_to_micro(community_limit):
        return {"capped": True, "reason": "community"}
    return {"capped": False, "reason": None}


def is_spend_capped(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None) -> bool:
    return bool(get_spend_status(user, client_ip).get("capped"))


def record_identity_spend_usd(
    user: Optional[Dict[str, Any]],
    client_ip: Optional[str],
    cost_usd: float,
) -> int:
    """
    Adds the real cost of one paid-key operation to the caller's daily spend counters and the
    system-wide daily counter. Never refunded: it measures money actually spent, so friendly
    refunds of credits on failures cannot be abused for unlimited free paid-key calls.
    Returns the micro-dollars recorded.
    """
    try:
        val = float(cost_usd or 0.0)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(val) or val <= 0 or is_admin_user(user):
        return 0
    micro = _usd_to_micro(min(val, 1_000.0))
    if micro <= 0:
        return 0
    try:
        return _record_identity_spend_micro(user, client_ip, micro)
    except UsageStoreUnavailable:
        logger.warning(f"Usage store unavailable: ${val:.6f} of paid-key spend was not metered.")
        return 0


def _record_identity_spend_micro(user: Optional[Dict[str, Any]], client_ip: Optional[str], micro: int) -> int:
    day = _get_today_str()
    crossed_personal_cap = False
    for ident, cap in _spend_identifiers(user, client_ip):
        if cap > 0:
            new_total = _change_usage_delta(day, ident, micro)
            if new_total - micro < _usd_to_micro(cap) <= new_total:
                crossed_personal_cap = True
    if crossed_personal_cap:
        _note_personal_cap_hit(day)
    community_limit = get_community_daily_usd_limit()
    if community_limit > 0:
        new_total = _change_usage_delta(day, COMMUNITY_DAILY_SPEND_MICRO_ID, micro)
        _check_spend_thresholds(day, "community", new_total - micro, new_total, community_limit)
    return micro


# --- One-round-trip metering per AI operation (SC-13) ---------------------------------------------
# `record_ai_spend` (backend/migrations/005_record_ai_spend.sql) applies every counter change of one
# operation - the caller's identity spend counters, the personal-cap hit counter, the system-wide
# daily counter and the cumulative community ledger - and inserts its activity row, in one
# transaction. Without the function the per-counter path above is used (the caller falls back).
RECORD_SPEND_RPC = "record_ai_spend"
_RECORD_SPEND_RPC_RECHECK_SECONDS = 600.0
_record_spend_rpc_missing_until: float = 0.0


def _community_ledger_delta_micro(cost_usd: Any) -> int:
    """The micro-dollars `record_community_spend_usd` would add for `cost_usd` (0 when invalid)."""
    try:
        val = float(cost_usd or 0.0)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(val) or val <= 0:
        return 0
    return max(0, int(round(min(val, MAX_COMMUNITY_LEDGER_USD) * _MICRO_PER_USD)))


def _identity_spend_delta_micro(user: Optional[Dict[str, Any]], cost_usd: Any) -> int:
    """The micro-dollars `record_identity_spend_usd` would add for `cost_usd` (0 when invalid / admin)."""
    try:
        val = float(cost_usd or 0.0)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(val) or val <= 0 or is_admin_user(user):
        return 0
    return max(0, _usd_to_micro(min(val, 1_000.0)))


def record_ai_spend_once(
    user: Optional[Dict[str, Any]],
    client_ip: Optional[str],
    community_cost_usd: float,
    identity_cost_usd: float,
    activity_row: Optional[Dict[str, Any]],
) -> Tuple[str, Optional[Dict[str, Any]]]:
    """
    Meters one AI operation through the `record_ai_spend` RPC. Returns ("ok", body),
    ("missing", None) when the function or the durable store isn't available (the caller uses
    `record_community_spend_usd` / `record_identity_spend_usd` / the REST insert instead), or
    ("failed", None) when the call failed (nothing may be retried: it may have committed).
    Spend-cap alerts (SC-10) fire exactly as on the per-counter path.
    """
    global _record_spend_rpc_missing_until
    if time.time() < _record_spend_rpc_missing_until or not _usage_remote_available():
        return "missing", None
    day = _get_today_str()
    identity_micro = _identity_spend_delta_micro(user, identity_cost_usd)
    identities = [(ident, cap) for ident, cap in _spend_identifiers(user, client_ip) if cap > 0] if identity_micro else []
    community_limit = get_community_daily_usd_limit() if identity_micro else -1.0
    ledger_micro = _community_ledger_delta_micro(community_cost_usd)
    payload = {
        "p_day": day,
        "p_identity_ids": [ident for ident, _ in identities],
        "p_identity_caps": [_usd_to_micro(cap) for _, cap in identities],
        "p_identity_micro": identity_micro,
        "p_personal_hits_id": PERSONAL_CAP_HITS_ID,
        "p_community_day_id": COMMUNITY_DAILY_SPEND_MICRO_ID if community_limit > 0 else None,
        "p_ledger_date": COMMUNITY_LEDGER_DATE,
        "p_ledger_cents_id": COMMUNITY_SPENT_CENTS_ID,
        "p_ledger_remainder_id": COMMUNITY_SPENT_REMAINDER_MICRO_ID,
        "p_ledger_micro": ledger_micro,
        "p_activity": activity_row,
    }
    url, _ = _supabase_config()
    try:
        with _remote_http_client() as client:
            resp = client.post(f"{url}/rest/v1/rpc/{RECORD_SPEND_RPC}", headers=_remote_headers(), json=payload)
    except Exception as e:
        _disable_remote_temporarily("record spend", e)
        return "failed", None
    if resp.status_code in (200, 201):
        try:
            body = resp.json()
        except Exception:
            body = None
        if not isinstance(body, dict):
            return "failed", None
        _note_remote_success()
        _apply_spend_alerts(day, identity_micro, identities, community_limit, body)
        return "ok", body
    if _is_missing_rpc_response(resp):
        _note_remote_success()
        _record_spend_rpc_missing_until = time.time() + _RECORD_SPEND_RPC_RECHECK_SECONDS
        logger.info(
            f"{RECORD_SPEND_RPC}() is not installed (HTTP {resp.status_code}); metering spend with "
            "per-counter calls. Run backend/migrations/005_record_ai_spend.sql to enable it."
        )
        return "missing", None
    _disable_remote_temporarily("record spend", f"HTTP {resp.status_code}: {resp.text[:200]}")
    return "failed", None


def _apply_spend_alerts(
    day: str,
    micro: int,
    identities: List[Tuple[str, float]],
    community_limit: float,
    body: Dict[str, Any],
) -> None:
    """The SC-10 alert log lines for counters the RPC just moved (same thresholds as the fallback)."""
    if micro <= 0:
        return
    if body.get("personal_hits") is not None and _claim_spend_alert(day, "personal_cap_hits", 1):
        logger.warning(
            f"SPEND_ALERT scope=personal_cap_hits day={day} count={int(body['personal_hits'])} "
            "(first identity capped today)"
        )
    community_total = body.get("community_day")
    if community_limit > 0 and community_total is not None:
        new_total = int(community_total)
        _check_spend_thresholds(day, "community", new_total - micro, new_total, community_limit)


# --- Spend-cap alerts (SC-10) ---------------------------------------------------------
# The USD caps are circuit breakers: when the community cap trips, everyone silently drops to the
# free keys. Log a structured line the first time each threshold is crossed on a UTC day, so the
# owner can alert on it (e.g. a Render log alert on "SPEND_ALERT").
SPEND_ALERT_THRESHOLDS = (50, 80, 100)
PERSONAL_CAP_HITS_ID = "system:personal_usd_cap_hits_day"
_spend_alerts_lock = threading.Lock()
_spend_alerts_fired: set = set()


def _claim_spend_alert(day: str, scope: str, threshold: int) -> bool:
    """True exactly once per (UTC day, scope, threshold) in this process."""
    key = (day, scope, threshold)
    with _spend_alerts_lock:
        if key in _spend_alerts_fired:
            return False
        stale = {k for k in _spend_alerts_fired if k[0] != day}
        _spend_alerts_fired.difference_update(stale)
        _spend_alerts_fired.add(key)
        return True


def _check_spend_thresholds(day: str, scope: str, prev_micro: int, new_micro: int, limit_usd: float) -> None:
    limit_micro = _usd_to_micro(limit_usd)
    if limit_micro <= 0:
        return
    for threshold in SPEND_ALERT_THRESHOLDS:
        mark = limit_micro * threshold // 100
        if prev_micro < mark <= new_micro and _claim_spend_alert(day, scope, threshold):
            log = logger.error if threshold >= 100 else logger.warning
            log(
                f"SPEND_ALERT scope={scope} threshold={threshold}% day={day} "
                f"spent_usd={new_micro / _MICRO_PER_USD:.4f} limit_usd={limit_usd:.2f}"
                + (" action=paid_key_disabled_until_utc_midnight" if threshold >= 100 else "")
            )


def _note_personal_cap_hit(day: str) -> None:
    """Counts identities that reached their personal daily USD cap today (one aggregated counter)."""
    try:
        hits = _change_usage_delta(day, PERSONAL_CAP_HITS_ID, 1)
    except Exception as e:
        logger.warning(f"Failed to count a personal spend-cap hit: {e}")
        return
    if _claim_spend_alert(day, "personal_cap_hits", 1):
        logger.warning(f"SPEND_ALERT scope=personal_cap_hits day={day} count={hits} (first identity capped today)")


def get_community_usd_cap_status(date_str: Optional[str] = None) -> Dict[str, Any]:
    """Today's community USD circuit-breaker state for the admin quota payload (one store read)."""
    day = date_str or _get_today_str()
    limit = get_community_daily_usd_limit()
    usages = get_usage_for_identifiers([COMMUNITY_DAILY_SPEND_MICRO_ID, PERSONAL_CAP_HITS_ID], date_str=day)
    spent_micro = int(usages.get(COMMUNITY_DAILY_SPEND_MICRO_ID, 0) or 0)
    enabled = limit > 0
    return {
        "enabled": enabled,
        "limit_usd": round(limit, 2) if enabled else -1,
        "is_default_limit": not os.getenv("DAILY_COMMUNITY_USD_LIMIT", "").strip(),
        "spent_usd_today": round(spent_micro / _MICRO_PER_USD, 4),
        "percent_used": int(spent_micro * 100 // _usd_to_micro(limit)) if enabled else 0,
        "capped": enabled and spent_micro >= _usd_to_micro(limit),
        "personal_cap_hits_today": int(usages.get(PERSONAL_CAP_HITS_ID, 0) or 0),
        "date": day,
    }


def log_spend_cap_startup_warnings() -> None:
    """Warns at startup when production still runs on the $5/day community default (SC-10)."""
    if not is_production_environment():
        return
    limit = get_community_daily_usd_limit()
    if limit > 0 and abs(limit - DEFAULT_DAILY_COMMUNITY_USD_LIMIT) < 1e-9:
        logger.warning(
            f"DAILY_COMMUNITY_USD_LIMIT is the default ${DEFAULT_DAILY_COMMUNITY_USD_LIMIT:.2f}/day "
            f"(about {int(DEFAULT_DAILY_COMMUNITY_USD_LIMIT / 0.005)} credits for the whole site). "
            "Size it as daily active users x credits per user x ~$0.005; see DEPLOYMENT_STEPS.md."
        )


def get_user_quota_info(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None) -> Dict[str, Any]:
    """
    Quota info for the caller, folding in the hidden real-cost backstop: when today's USD cap is
    reached the caller is shown as out of premium credits (tier "free"), matching what
    `resolve_gemini_key` / `charge_premium_credits` will actually do.
    """
    try:
        info = _base_user_quota_info(user, client_ip)
        info["resets_at"] = get_fast_ai_resets_at()
        if info.get("is_admin"):
            return info
        spend = get_spend_status(user, client_ip)
    except UsageStoreUnavailable:
        return _quota_info_while_store_unavailable(user)
    info["daily_spend_capped"] = bool(spend.get("capped"))
    if spend.get("capped"):
        info["spend_cap_reason"] = spend.get("reason")
        if int(info.get("daily_paid_limit") or -1) > 0:
            info["remaining_paid"] = 0
        if info.get("tier") in ("paid", "unlimited"):
            info["tier"] = "free"
    return info


def _quota_info_while_store_unavailable(user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Quota payload while the usage store is down (fail-closed production). Counts are unknown
    (`used_today: None`, no `community_pool`) and non-admins are shown in basic mode with no
    fast credits left (`remaining_paid: 0`, never the -1 "unlimited" sentinel), which is what
    `resolve_gemini_key` serves until the store recovers. Same keys the UI already reads.
    """
    mode = get_api_key_mode()
    base: Dict[str, Any] = {
        "quota_unavailable": True,
        "used_today": None,
        "community_pool": None,
        "credit_costs": get_credit_costs(),
        "donation_url": get_community_donation_url(),
        "resets_at": get_fast_ai_resets_at(),
    }
    if is_admin_user(user):
        return {
            **base,
            "is_admin": True, "daily_paid_limit": -1, "remaining_paid": -1,
            "tier": "admin_unlimited", "mode": mode, "api_key_mode": mode,
            "guest_api_key_mode": get_guest_api_key_mode(),
            "registered_daily_limit": get_registered_daily_limit(),
            "guest_daily_limit": get_guest_daily_limit(),
        }
    reg_limit = get_registered_daily_limit() if mode == "limited" else -1
    if is_guest_user(user):
        guest_mode = get_guest_api_key_mode()
        limit = get_guest_daily_limit() if guest_mode == "limited" else -1
        return {
            **base,
            "is_admin": False, "is_guest": True, "daily_paid_limit": max(0, limit),
            "remaining_paid": 0, "tier": "free", "mode": guest_mode,
            "registered_mode": mode, "registered_daily_limit": reg_limit, "daily_spend_capped": False,
        }
    return {
        **base,
        "is_admin": False, "daily_paid_limit": max(0, reg_limit),
        "remaining_paid": 0, "tier": "free", "mode": mode,
        "registered_mode": mode, "registered_daily_limit": reg_limit, "daily_spend_capped": False,
    }


def _base_user_quota_info(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None) -> Dict[str, Any]:
    """
    Returns the current user's single unified AI-operation quota: daily limit, used today,
    remaining, admin status, community pool status, and (for admins) the raw policy config for both roles.
    """
    is_admin = is_admin_user(user)
    mode = get_api_key_mode()
    community_pool = get_cached_community_pool_status()
    donation_url = community_pool.get("donation_url", "")
    pool_exhausted = bool(community_pool.get("exhausted"))
    credit_costs = get_credit_costs()

    if is_admin:
        return {
            "is_admin": True,
            "daily_paid_limit": -1,
            "used_today": 0,
            "remaining_paid": -1,
            "tier": "admin_unlimited",
            "mode": mode,
            # Raw policy config for both roles, independent of the viewer — lets admin UI
            # show the registered-user policy AND the guest policy at the same time.
            "api_key_mode": mode,
            "guest_api_key_mode": get_guest_api_key_mode(),
            "registered_daily_limit": get_registered_daily_limit(),
            "guest_daily_limit": get_guest_daily_limit(),
            "credit_costs": credit_costs,
            "community_pool": community_pool,
            "community_usd_cap": get_community_usd_cap_status(),
            "grounding_monthly": get_google_search_grounding_status(),
            "donation_url": donation_url,
        }

    reg_limit = get_registered_daily_limit() if mode == "limited" else -1

    # Guests (anonymous sessions or unauthenticated visitors)
    if is_guest_user(user):
        guest_mode = get_guest_api_key_mode()
        if guest_mode == "free":
            return {
                "is_admin": False, "is_guest": True,
                "daily_paid_limit": -1, "used_today": 0, "remaining_paid": -1,
                "tier": "free", "mode": "free",
                "registered_mode": mode, "registered_daily_limit": reg_limit,
                "credit_costs": credit_costs,
                "community_pool": community_pool, "donation_url": donation_url,
            }
        if guest_mode == "unlimited":
            return {
                "is_admin": False, "is_guest": True,
                "daily_paid_limit": -1, "used_today": 0, "remaining_paid": -1,
                "tier": "free" if pool_exhausted else "unlimited", "mode": "unlimited",
                "registered_mode": mode, "registered_daily_limit": reg_limit,
                "credit_costs": credit_costs,
                "community_pool": community_pool, "community_pool_exhausted": pool_exhausted,
                "donation_url": donation_url,
            }
        # "limited"
        guest_limit = get_guest_daily_limit()
        used = get_guest_usage(user, client_ip)
        remaining = 0 if pool_exhausted else max(0, guest_limit - used)
        return {
            "is_admin": False, "is_guest": True,
            "daily_paid_limit": guest_limit, "used_today": used, "remaining_paid": remaining,
            "tier": "paid" if (used < guest_limit and not pool_exhausted) else "free", "mode": "limited",
            "registered_mode": mode, "registered_daily_limit": reg_limit,
            "credit_costs": credit_costs,
            "community_pool": community_pool, "community_pool_exhausted": pool_exhausted,
            "donation_url": donation_url,
        }

    # Free mode: non-admins always run on the free key (unlimited, but paid features off).
    if mode == "free":
        return {
            "is_admin": False,
            "daily_paid_limit": -1, "used_today": 0, "remaining_paid": -1,
            "tier": "free", "mode": "free",
            "registered_mode": mode, "registered_daily_limit": -1,
            "credit_costs": credit_costs,
            "community_pool": community_pool, "donation_url": donation_url,
        }

    # Unlimited mode: report unlimited paid access for everyone (unless community pool cap is exhausted).
    if mode == "unlimited":
        return {
            "is_admin": False,
            "daily_paid_limit": -1, "used_today": 0, "remaining_paid": -1,
            "tier": "free" if pool_exhausted else "unlimited", "mode": "unlimited",
            "registered_mode": mode, "registered_daily_limit": -1,
            "credit_costs": credit_costs,
            "community_pool": community_pool, "community_pool_exhausted": pool_exhausted,
            "donation_url": donation_url,
        }

    # Regular registered user, limited mode
    limit = get_registered_daily_limit()
    user_id = user.get("id") if user else "anonymous"
    used = get_user_daily_usage(user_id)
    remaining = 0 if pool_exhausted else max(0, limit - used)

    return {
        "is_admin": False,
        "daily_paid_limit": limit, "used_today": used, "remaining_paid": remaining,
        "tier": "paid" if (used < limit and not pool_exhausted) else "free", "mode": "limited",
        "registered_mode": mode, "registered_daily_limit": limit,
        "credit_costs": credit_costs,
        "community_pool": community_pool, "community_pool_exhausted": pool_exhausted,
        "donation_url": donation_url,
    }

def _get_active_paid_or_free_key() -> str:
    """
    Returns the server's paid key if configured and available (not in cooldown from quota
    or billing exhaustion). If cooling down or missing, automatically falls back to the next healthy free key.
    """
    paid_key = os.getenv("GEMINI_API_KEY", "").strip()
    if paid_key and is_key_available(paid_key):
        return paid_key
    if paid_key:
        logger.warning(
            "Server paid GEMINI_API_KEY is currently in cooldown (quota or billing exhausted). "
            "Automatically routing request to healthy free key fallback."
        )
    return get_next_free_key() or paid_key


# `key_tier` returned by a declined `charge_premium_credits(..., require_paid_key=True)` when the
# caller has credits but the server paid key is missing or cooling down.
PREMIUM_KEY_UNAVAILABLE_TIER = "premium_unavailable"
# `key_tier` of a premium charge declined because the usage store is down (fail-closed production).
QUOTA_STORE_UNAVAILABLE_TIER = "quota_store_unavailable"


def _healthy_paid_key() -> str:
    """The server paid key when configured and not cooling down, else ''. Never a free key."""
    paid_key = os.getenv("GEMINI_API_KEY", "").strip()
    return paid_key if paid_key and is_key_available(paid_key) else ""


def _require_free_key(
    increment_usage: bool,
    rollback_fn=None,
    exhausted_reason: str = "Daily AI credit limit reached and no free-tier fallback key is configured.",
) -> str:
    """
    Resolves a configured free Gemini API key without ever falling back to the paid server key.
    When `increment_usage=True` and no free keys are configured, rolls back any provisional counter
    increment and fails closed with HTTP 429.
    """
    chosen = get_next_free_key()
    if chosen:
        return chosen
    if rollback_fn is not None:
        rollback_fn()
    if increment_usage:
        raise HTTPException(
            status_code=429,
            detail=f"{exhausted_reason} Add a personal Gemini API key in Settings or try again later.",
        )
    return ""


def _try_reserve_guest_credits(
    user: Optional[Dict[str, Any]],
    client_ip: Optional[str],
    cost: int,
    *,
    keep_overlimit_tick: bool = False,
    read_ids: Optional[List[str]] = None,
) -> Tuple[bool, bool, Optional[Dict[str, int]]]:
    """
    Atomically increments guest usage counters first and checks against personal + IP caps.
    Returns `(within_paid_limit, kept_increment, reads)`.
    - When `within_paid_limit` is True, `cost` has been atomically reserved (`kept_increment=True`).
    - When `within_paid_limit` is False:
      - If `keep_overlimit_tick` is True and the caller was ALREADY at/above the cap before this
        increment (`prev >= cap`), keeps the increment for total daily operation display (`kept_increment=True`).
      - Otherwise (e.g. `charge_premium_credits` or multi-credit request straddling remaining credits),
        rolls back immediately (`kept_increment=False`).
    - `reads`: today's counts for `read_ids` when the single-RPC path served the call, else None.
    """
    guest_limit = get_guest_daily_limit()
    ip_limit = get_guest_ip_daily_limit()
    if guest_limit <= 0 or ip_limit <= 0:
        return False, False, None

    entries = [
        (ident, guest_identifier_cap(ident, guest_limit, ip_limit))
        for ident in get_guest_identifiers(user, client_ip)
    ]
    return _reserve_capped_counters(entries, cost, keep_overlimit_tick=keep_overlimit_tick, read_ids=read_ids)


def _try_reserve_user_credits(
    user_id: str,
    cost: int,
    *,
    keep_overlimit_tick: bool = False,
    read_ids: Optional[List[str]] = None,
) -> Tuple[bool, bool, Optional[Dict[str, int]]]:
    """
    Atomically increments registered-user usage counter first and checks against `DAILY_PAID_PROMPTS`.
    Returns `(within_paid_limit, kept_increment, reads)` (see `_try_reserve_guest_credits`).
    """
    limit = get_registered_daily_limit()
    if limit <= 0:
        return False, False, None
    return _reserve_capped_counters([(user_id, limit)], cost, keep_overlimit_tick=keep_overlimit_tick, read_ids=read_ids)


def _prefetched_spend_capped(plan, reads: Optional[Dict[str, int]]) -> Optional[bool]:
    """Spend-cap verdict from counters the reservation RPC returned (None: read them separately)."""
    if reads is None:
        return None
    if not plan[2]:
        return False
    return bool(_spend_status_from_usages(plan, reads)["capped"])


def _resolve_gemini_key_impl(
    user: Optional[Dict[str, Any]],
    custom_api_key: Optional[str] = None,
    increment_usage: bool = True,
    client_ip: Optional[str] = None,
    credits: Optional[int] = None,
) -> Tuple[str, str, bool]:
    """
    Resolves which Gemini API key to use for standard AI text operations — timeline generation,
    refine, chat (answer + edit), event suggestion/auto-fill, quiz, and podcast script generation.
    Every operation draws `credits` (default `get_text_credit_cost()`) from ONE shared daily
    credit bank per identity (GUEST_DAILY_PAID_PROMPTS for guests, DAILY_PAID_PROMPTS for
    registered users), falling back to rotating free keys when credits are exhausted (or failing
    closed with 429 if no free keys are configured).
    Returns: (resolved_key, tier_name, is_admin)
    tier_name can be: "custom", "admin_paid", "paid", "free"
    """
    cost = max(1, int(credits if credits is not None else get_text_credit_cost()))

    # 1. Custom BYOK provided by the client header
    if custom_api_key and custom_api_key.strip():
        return custom_api_key.strip(), "custom", False

    mode = get_api_key_mode()

    # 2. Admin user: always uses paid key without consuming quota (with auto fallback to free key)
    if is_admin_user(user):
        chosen_key = _get_active_paid_or_free_key()
        return chosen_key, "admin_paid", True

    def _resolve_paid_with_community_pool(rollback_personal_fn=None, spend_capped=None) -> Tuple[str, str]:
        if spend_capped is None:
            spend_capped = is_spend_capped(user, client_ip)
        if spend_capped:
            # Real-cost backstop reached: keep the caller's credits and serve from free keys.
            if rollback_personal_fn is not None:
                rollback_personal_fn()
            free_key = _require_free_key(
                increment_usage=increment_usage,
                exhausted_reason="Daily AI budget reached and no free-tier fallback key is configured.",
            )
            return free_key, "free"
        if increment_usage:
            allowed = reserve_community_paid_prompt(credits=cost)
        else:
            allowed = not get_community_pool_status().get("exhausted", False)
        if not allowed:
            if rollback_personal_fn is not None:
                rollback_personal_fn()
            free_key = _require_free_key(
                increment_usage=increment_usage,
                exhausted_reason="Community AI pool limit reached and no free-tier fallback key is configured.",
            )
            return free_key, "free"
        return _get_active_paid_or_free_key(), "paid"

    # 2a. Guest (anonymous) user
    if is_guest_user(user):
        guest_mode = get_guest_api_key_mode()
        if guest_mode == "free":
            chosen_key = _require_free_key(
                increment_usage=increment_usage,
                exhausted_reason="Guest free-tier AI service is unavailable because no free Gemini API keys are configured.",
            )
            return chosen_key, "free", False
        elif guest_mode == "unlimited":
            chosen_key, tier = _resolve_paid_with_community_pool()
            return chosen_key, tier, False
        else:  # "limited"
            if not increment_usage:
                guest_limit = get_guest_daily_limit()
                used = get_guest_usage(user, client_ip)
                if used + cost <= guest_limit:
                    chosen_key, tier = _resolve_paid_with_community_pool()
                    return chosen_key, tier, False
                return _require_free_key(increment_usage=False), "free", False

            spend_plan = _spend_check_plan(user, client_ip)
            within_limit, kept_inc, reads = _try_reserve_guest_credits(
                user, client_ip, cost, keep_overlimit_tick=True, read_ids=spend_plan[2]
            )
            rollback_guest = (lambda: refund_guest_usage(user, client_ip, credits=cost)) if kept_inc else None
            if within_limit:
                chosen_key, tier = _resolve_paid_with_community_pool(
                    rollback_personal_fn=rollback_guest, spend_capped=_prefetched_spend_capped(spend_plan, reads)
                )
                return chosen_key, tier, False
            chosen_key = _require_free_key(increment_usage=True, rollback_fn=rollback_guest)
            return chosen_key, "free", False

    # 2b. Free mode: non-admins always use rotated free key, no usage recorded
    if mode == "free":
        chosen_key = _require_free_key(
            increment_usage=increment_usage,
            exhausted_reason="Free-tier AI service is unavailable because no free Gemini API keys are configured.",
        )
        return chosen_key, "free", False

    # 2c. Unlimited mode: everyone gets the paid key, no usage recorded (with auto fallback)
    if mode == "unlimited":
        chosen_key, tier = _resolve_paid_with_community_pool()
        return chosen_key, tier, False

    # 3. Regular authenticated user (limited mode)
    user_id = str(user.get("id")) if user and user.get("id") else "anonymous"
    if not increment_usage:
        limit = get_registered_daily_limit()
        used = get_user_daily_usage(user_id)
        if used + cost <= limit:
            chosen_key, tier = _resolve_paid_with_community_pool()
            return chosen_key, tier, False
        return _require_free_key(increment_usage=False), "free", False

    spend_plan = _spend_check_plan(user, client_ip)
    within_limit, kept_inc, reads = _try_reserve_user_credits(
        user_id, cost, keep_overlimit_tick=True, read_ids=spend_plan[2]
    )
    rollback_user = (lambda: refund_prompt_usage(user_id, credits=cost)) if kept_inc else None
    if within_limit:
        chosen_key, tier = _resolve_paid_with_community_pool(
            rollback_personal_fn=rollback_user, spend_capped=_prefetched_spend_capped(spend_plan, reads)
        )
        return chosen_key, tier, False
    chosen_key = _require_free_key(increment_usage=True, rollback_fn=rollback_user)
    return chosen_key, "free", False


def _charge_premium_credits_impl(
    user: Optional[Dict[str, Any]],
    custom_api_key: Optional[str] = None,
    client_ip: Optional[str] = None,
    credits: int = 1,
    require_paid_key: bool = False,
) -> Tuple[bool, Optional[str], str, bool, bool]:
    """
    Atomically checks and deducts `credits` for strict premium-only features
    (Gemini image generation = 6 credits, Gemini podcast audio = 10 or 20 credits) that MUST
    be blocked rather than falling back to free keys or partially draining the user's
    remaining credits when `remaining < credits`.

    `require_paid_key=True` (callers that use the returned key for the premium model): a charged
    request is declined with tier `PREMIUM_KEY_UNAVAILABLE_TIER`, before anything is reserved, when
    the server paid key is missing or cooling down, so credits never buy a free-key result.
    BYOK and admin requests are unaffected.

    Returns: (allowed, api_key, key_tier, incremented_quota, pool_reserved)
    """
    cost = max(1, int(credits))

    # 1. Personal API key (BYOK): always allowed, zero server credits consumed
    if custom_api_key and custom_api_key.strip():
        return True, custom_api_key.strip(), "custom", False, False

    # 2. Admin user: always allowed on server paid key, zero quota/pool consumed
    if is_admin_user(user):
        return True, _get_active_paid_or_free_key(), "admin_paid", False, False

    global_mode = get_api_key_mode()
    if global_mode == "free":
        return False, None, "free", False, False

    # Real-cost backstop: premium features are declined (never partially charged) once reached.
    if is_spend_capped(user, client_ip):
        return False, None, "free", False, False

    if require_paid_key and not _healthy_paid_key():
        return False, None, PREMIUM_KEY_UNAVAILABLE_TIER, False, False

    if is_guest_user(user):
        eff_mode = get_guest_api_key_mode()
        if eff_mode == "free":
            return False, None, "free", False, False
        if eff_mode == "limited":
            within_limit, _, _ = _try_reserve_guest_credits(
                user, client_ip, cost, keep_overlimit_tick=False
            )
            if not within_limit:
                return False, None, "free", False, False
            if not reserve_community_paid_prompt(credits=cost):
                refund_guest_usage(user, client_ip, credits=cost)
                return False, None, "free", False, False
            return True, _get_active_paid_or_free_key(), "paid", True, True
        # eff_mode == "unlimited"
        if not reserve_community_paid_prompt(credits=cost):
            return False, None, "free", False, False
        return True, _get_active_paid_or_free_key(), "paid", False, True

    # Registered non-admin user
    if global_mode == "unlimited":
        if not reserve_community_paid_prompt(credits=cost):
            return False, None, "free", False, False
        return True, _get_active_paid_or_free_key(), "paid", False, True

    # global_mode == "limited"
    user_id = str(user.get("id")) if user and user.get("id") else "anonymous"
    within_limit, _, _ = _try_reserve_user_credits(
        user_id, cost, keep_overlimit_tick=False
    )
    if not within_limit:
        return False, None, "free", False, False
    if not reserve_community_paid_prompt(credits=cost):
        refund_prompt_usage(user_id, credits=cost)
        return False, None, "free", False, False
    return True, _get_active_paid_or_free_key(), "paid", True, True


def resolve_gemini_key(
    user: Optional[Dict[str, Any]],
    custom_api_key: Optional[str] = None,
    increment_usage: bool = True,
    client_ip: Optional[str] = None,
    credits: Optional[int] = None,
) -> Tuple[str, str, bool]:
    """See `_resolve_gemini_key_impl`; additionally records the served tier for the response header.
    While the usage store is down (fail-closed production) paid credits can't be reserved, so the
    request is served in basic mode on a free key, or refused with 503 when none is configured."""
    try:
        key, tier, is_admin = _resolve_gemini_key_impl(
            user, custom_api_key=custom_api_key, increment_usage=increment_usage,
            client_ip=client_ip, credits=credits,
        )
    except UsageStoreUnavailable:
        key, tier, is_admin = _resolve_free_key_while_store_unavailable(increment_usage), "free", False
    note_request_ai_tier(tier)
    return key, tier, is_admin


QUOTA_STORE_UNAVAILABLE_DETAIL = "AI is briefly unavailable. Please try again in a moment."
QUOTA_STORE_RETRY_AFTER_SECONDS = 15


def _resolve_free_key_while_store_unavailable(increment_usage: bool) -> str:
    chosen = get_next_free_key()
    if chosen:
        logger.warning("Usage store unavailable: serving this AI request in basic mode (free key).")
        return chosen
    if increment_usage:
        raise HTTPException(
            status_code=503,
            detail=QUOTA_STORE_UNAVAILABLE_DETAIL,
            headers={"Retry-After": str(QUOTA_STORE_RETRY_AFTER_SECONDS)},
        )
    return ""


def charge_premium_credits(
    user: Optional[Dict[str, Any]],
    custom_api_key: Optional[str] = None,
    client_ip: Optional[str] = None,
    credits: int = 1,
    require_paid_key: bool = False,
) -> Tuple[bool, Optional[str], str, bool, bool]:
    """See `_charge_premium_credits_impl`. Only an *allowed* charge records the tier: a decline
    can simply mean "this feature costs more than your remaining credits", not basic mode.
    While the usage store is down the charge is declined with `QUOTA_STORE_UNAVAILABLE_TIER`
    (callers answer 503 or fall back to a free engine)."""
    try:
        result = _charge_premium_credits_impl(
            user, custom_api_key=custom_api_key, client_ip=client_ip, credits=credits,
            require_paid_key=require_paid_key,
        )
    except UsageStoreUnavailable:
        logger.warning("Usage store unavailable: premium charge declined.")
        return False, None, QUOTA_STORE_UNAVAILABLE_TIER, False, False
    if result[0]:
        note_request_ai_tier(result[2])
    return result


_LAST_REMOTE_USAGE_PRUNE_TS: float = 0.0
_REMOTE_USAGE_PRUNE_INTERVAL = 6 * 3600.0


def prune_expired_remote_usage(force: bool = False) -> bool:
    """
    Deletes non-permanent `ai_usage` rows older than `USAGE_RETENTION_DAYS` (excluding
    current-month system counters and `1970-01-01` ledger rows) so daily/guest counters
    do not accumulate indefinitely in Supabase.
    """
    global _LAST_REMOTE_USAGE_PRUNE_TS
    if not usage_store_is_durable():
        return False
    now_ts = time.time()
    if not force and (now_ts - _LAST_REMOTE_USAGE_PRUNE_TS) < _REMOTE_USAGE_PRUNE_INTERVAL:
        return False
    _LAST_REMOTE_USAGE_PRUNE_TS = now_ts

    url, _ = _supabase_config()
    cutoff_date = (datetime.now(timezone.utc) - timedelta(days=max(3, USAGE_RETENTION_DAYS))).strftime("%Y-%m-%d")
    month_start = _get_month_start_str()
    try:
        with _remote_http_client() as client:
            if not hasattr(client, "delete"):
                return False
            resp = client.delete(
                f"{url}/rest/v1/{USAGE_TABLE}",
                headers={**_remote_headers(), "Prefer": "return=minimal"},
                params={
                    "usage_date": f"lt.{cutoff_date}",
                    "and": f"(usage_date.neq.{COMMUNITY_LEDGER_DATE},usage_date.neq.{month_start})",
                },
            )
            return resp.status_code in (200, 204)
    except Exception as e:
        logger.debug(f"Remote ai_usage retention prune skipped: {e}")
        return False


def delete_user_usage_records(user_id: str) -> bool:
    """
    Permanently removes every usage row keyed by `user_id` (credits as `<user_id>` / `guest:<user_id>`,
    hosted photos, free images and the `spend:` real-cost meters) from Supabase `ai_usage` and the
    local fallback file on account deletion. Hashed guest-IP rows aren't tied to the account.
    """
    uid = str(user_id or "").strip()
    if not uid:
        return False
    target_ids = {
        uid,
        f"guest:{uid}",
        hosted_photos_identifier(uid),
        free_image_user_identifier(uid, guest=False),
        free_image_user_identifier(uid, guest=True),
        # Real-cost meters (registered and guest identities, B-13).
        f"{SPEND_ID_PREFIX}{uid}",
        f"{SPEND_ID_PREFIX}guest:{uid}",
    }

    if usage_store_is_durable():
        url, _ = _supabase_config()
        quoted = ",".join('"' + ident.replace('"', '\\"') + '"' for ident in sorted(target_ids))
        try:
            with _remote_http_client() as client:
                if hasattr(client, "delete"):
                    client.delete(
                        f"{url}/rest/v1/{USAGE_TABLE}",
                        headers={**_remote_headers(), "Prefer": "return=minimal"},
                        params={"identifier": f"in.({quoted})"},
                    )
        except Exception as e:
            logger.warning(f"Failed deleting remote ai_usage rows for user {uid}: {e}")

    with _LOCK:
        if USAGE_FILE.exists():
            data = _load_usage_data()
            changed = False
            for day_bucket in data.values():
                if isinstance(day_bucket, dict):
                    for tid in target_ids:
                        if tid in day_bucket:
                            day_bucket.pop(tid, None)
                            changed = True
            if changed:
                _save_usage_data(data)

    return True


# ---- Hosted photos (Story Studio photo import) ---------------------------------------------------
# A permanent per-user count of photos stored in Supabase Storage. It lives on the ledger date,
# which the daily-usage pruning never removes.

def hosted_photos_identifier(user_id: str) -> str:
    return f"photos:{user_id}"


def get_hosted_photo_count(user_id: str) -> int:
    ident = hosted_photos_identifier(str(user_id))
    return int(get_usage_for_identifiers([ident], date_str=COMMUNITY_LEDGER_DATE).get(ident, 0) or 0)


def change_hosted_photo_count(user_id: str, delta: int) -> int:
    """Adds `delta` (may be negative) and returns the new count (never below zero)."""
    ident = hosted_photos_identifier(str(user_id))
    new_count = _change_usage_delta(COMMUNITY_LEDGER_DATE, ident, int(delta))
    if new_count < 0:
        new_count = _change_usage_delta(COMMUNITY_LEDGER_DATE, ident, -new_count)
    return new_count


def set_hosted_photo_count(user_id: str, count: int) -> int:
    """Sets the counter to `count` (reconciliation against the storage listing, B-26)."""
    target = max(0, int(count))
    current = get_hosted_photo_count(user_id)
    if current == target:
        return current
    return change_hosted_photo_count(user_id, target - current)


# ---- Daily counters guarding server-paid third-party work (S-12 / S-13) -------------------------

def reserve_daily_counters(caps: List[Tuple[str, int]], amount: int = 1, date_str: Optional[str] = None) -> bool:
    """
    Adds `amount` to every identifier's counter for the day. If any counter would exceed its cap,
    every increment made here is rolled back and False is returned.
    """
    n = max(1, int(amount))
    day = date_str or _get_today_str()
    applied: List[str] = []
    for ident, cap in caps:
        new_val = _change_usage_delta(day, ident, n)
        applied.append(ident)
        if new_val > cap:
            for done in applied:
                _change_usage_delta(day, done, -n)
            return False
    return True


def refund_daily_counters(identifiers: List[str], amount: int = 1, date_str: Optional[str] = None) -> None:
    n = max(1, int(amount))
    day = date_str or _get_today_str()
    try:
        for ident in identifiers:
            _change_usage_delta(day, ident, -n)
    except UsageStoreUnavailable:
        logger.warning("Usage store unavailable: daily counter refund skipped.")


FREE_IMAGE_USAGE_PREFIX = "free_image:"
DEFAULT_FREE_IMAGE_DAILY_LIMIT = 20
DEFAULT_FREE_IMAGE_IP_DAILY_LIMIT = 100


def _non_negative_env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def get_free_image_daily_limit() -> int:
    """Free-engine images per user / guest session per day (<= 0 disables this cap)."""
    return _non_negative_env_int("FREE_IMAGE_DAILY_LIMIT", DEFAULT_FREE_IMAGE_DAILY_LIMIT)


def get_free_image_ip_daily_limit() -> int:
    """Per-IP backstop shared by every account behind one address (<= 0 disables it)."""
    return _non_negative_env_int("FREE_IMAGE_IP_DAILY_LIMIT", DEFAULT_FREE_IMAGE_IP_DAILY_LIMIT)


def free_image_user_identifier(user_id: str, guest: bool) -> str:
    return f"{FREE_IMAGE_USAGE_PREFIX}{'guest' if guest else 'user'}:{user_id}"


def _free_image_caps(user: Optional[Dict[str, Any]], client_ip: Optional[str]) -> List[Tuple[str, int]]:
    caps: List[Tuple[str, int]] = []
    per_identity = get_free_image_daily_limit()
    per_ip = get_free_image_ip_daily_limit()
    if per_identity > 0 and user and user.get("id"):
        caps.append((free_image_user_identifier(str(user["id"]), is_guest_user(user)), per_identity))
    norm_ip = normalize_client_ip(client_ip)
    if per_ip > 0 and norm_ip and norm_ip != "unknown":
        caps.append((FREE_IMAGE_USAGE_PREFIX + _hash_guest_ip(norm_ip), per_ip))
        net56 = ipv6_coarse_network(norm_ip)
        if net56:
            caps.append((
                FREE_IMAGE_USAGE_PREFIX + GUEST_IP56_PREFIX + _hash_guest_ip(net56).split(":", 1)[1],
                per_ip * get_ipv6_56_ceiling_multiplier(),
            ))
    return caps


def reserve_free_image_generation(
    user: Optional[Dict[str, Any]], client_ip: Optional[str]
) -> Tuple[bool, List[str]]:
    """
    Reserves one free-engine image for today. Returns (allowed, identifiers to refund on failure).
    Admins are exempt (always allowed, nothing reserved).
    """
    if is_admin_user(user):
        return True, []
    caps = _free_image_caps(user, client_ip)
    if not caps:
        return True, []
    if not reserve_daily_counters(caps):
        return False, []
    return True, [ident for ident, _ in caps]


YOUTUBE_SEARCH_BUDGET_ID = "system:youtube_searches_day"
DEFAULT_YOUTUBE_DAILY_SEARCH_BUDGET = 90


def get_youtube_daily_search_budget() -> int:
    """Uncached YouTube Data API searches per day (100 quota units each of 10,000). <= 0 = no budget."""
    return _non_negative_env_int("YOUTUBE_DAILY_SEARCH_BUDGET", DEFAULT_YOUTUBE_DAILY_SEARCH_BUDGET)


def _youtube_quota_day() -> str:
    # The YouTube Data API quota resets at midnight Pacific time, not UTC.
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d")
    except Exception:
        return (datetime.now(timezone.utc) - timedelta(hours=8)).strftime("%Y-%m-%d")


_youtube_budget_spent: Tuple[str, float] = ("", 0.0)
_YOUTUBE_SPENT_RECHECK_SECONDS = 600.0


def reserve_youtube_search() -> bool:
    """Takes one uncached search from today's global budget; False once it is spent."""
    global _youtube_budget_spent
    budget = get_youtube_daily_search_budget()
    if budget <= 0:
        return True
    day = _youtube_quota_day()
    spent_day, spent_at = _youtube_budget_spent
    # Once spent, skip the store round-trips for a while instead of incrementing and rolling back.
    if spent_day == day and time.time() - spent_at < _YOUTUBE_SPENT_RECHECK_SECONDS:
        return False
    try:
        allowed = reserve_daily_counters([(YOUTUBE_SEARCH_BUDGET_ID, budget)], date_str=day)
    except UsageStoreUnavailable:
        # The site-wide budget can't be checked: serve the "Search on YouTube" link instead.
        return False
    if not allowed:
        _youtube_budget_spent = (day, time.time())
        logger.warning(f"YouTube daily search budget ({budget}) spent; serving the YouTube-link fallback")
    return allowed


def refund_youtube_search() -> None:
    if get_youtube_daily_search_budget() > 0:
        refund_daily_counters([YOUTUBE_SEARCH_BUDGET_ID], date_str=_youtube_quota_day())
