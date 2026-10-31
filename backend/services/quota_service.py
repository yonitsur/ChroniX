import os
import json
import logging
import threading
import time
import re
import ipaddress
import math
import httpx
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any, Tuple, List
from services.auth_service import is_admin_user, is_guest_user

logger = logging.getLogger("ChroniXQuota")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
USAGE_FILE = DATA_DIR / "daily_usage.json"
_LOCK = threading.Lock()
_KEY_LOCK = threading.Lock()

_free_key_rr_counter: int = 0
_KEY_COOLDOWNS: Dict[str, float] = {}

def get_all_free_keys() -> List[str]:
    """
    Collects all configured free Gemini API keys from the environment.
    Supports:
      1. GEMINI_API_KEY_FREE (single key or comma/semicolon/whitespace-separated list)
      2. Numbered/suffixed vars: GEMINI_API_KEY_FREE_1, GEMINI_API_KEY_FREE_2, etc.
    Deduplicates and preserves order. Falls back to GEMINI_API_KEY if no free key is set.
    """
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

    # Fallback to paid key if no free keys defined at all
    if not keys:
        paid_key = os.getenv("GEMINI_API_KEY", "").strip()
        if paid_key:
            keys.append(paid_key)

    return keys

def mark_key_exhausted(key: str, cooldown_seconds: float = 300.0) -> None:
    """Marks an API key in cooldown after a quota or prepayment exhaustion error."""
    if not key:
        return
    with _KEY_LOCK:
        _KEY_COOLDOWNS[key] = time.time() + cooldown_seconds
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
      - "unlimited": everyone uses the paid key with no limits (default).
      - "limited":   paid key up to the daily quota, then falls back to the free key.
      - "free":      non-admins always use the free key; the paid key is never spent.
    Admins always get the paid key regardless of mode.
    """
    mode = os.getenv("API_KEY_MODE", "unlimited").strip().lower()
    return mode if mode in ("unlimited", "limited", "free") else "unlimited"

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

def get_guest_identifiers(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None) -> List[str]:
    """
    Returns the list of identifiers associated with a guest session:
    - If user has a persistent anonymous ID: 'guest:{user_id}'
    - If client_ip is known: 'guest_ip:{normalized_ip}'
    """
    ids: List[str] = []
    if user and user.get("id"):
        ids.append(f"guest:{user['id']}")
    norm_ip = normalize_client_ip(client_ip)
    if norm_ip and norm_ip != "unknown":
        ids.append(f"guest_ip:{norm_ip}")
    if not ids:
        ids.append("guest_ip:unknown")
    return ids

def get_guest_usage(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None, date_str: Optional[str] = None) -> int:
    """
    Returns the maximum daily usage recorded across any identifier for this guest (session ID or IP ceiling).
    Taking the max ensures:
    1. Switching tabs, network shifts (IPv4 <-> IPv6), or waking up from sleep cannot reset usage to 0 (bound to session ID).
    2. Clearing localStorage or opening incognito cannot bypass quota (bound to IP ceiling).
    """
    ids = get_guest_identifiers(user, client_ip)
    usages = get_usage_for_identifiers(ids, date_str=date_str)
    return max(usages.values()) if usages else 0

def record_guest_usage(
    user: Optional[Dict[str, Any]],
    client_ip: Optional[str] = None,
    date_str: Optional[str] = None,
    credits: int = 1,
) -> int:
    """
    Increments usage by `credits` for all identifiers tied to this guest (session ID and normalized IP).
    """
    ids = get_guest_identifiers(user, client_ip)
    current_max = 0
    for ident in ids:
        c = record_prompt_usage(ident, date_str=date_str, credits=credits)
        if c > current_max:
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
    ids = get_guest_identifiers(user, client_ip)
    for ident in ids:
        refund_prompt_usage(ident, date_str=date_str, credits=credits)

def get_quota_identifier(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None) -> str:
    """
    Returns the primary key used for daily quota tracking:
      - Registered users (authenticated with email/google): user['id'] (device-independent)
      - Guests (anonymous Supabase users or unauthenticated): 'guest_ip:{normalized_ip}',
        falling back to 'guest:{user_id}' if client_ip is not provided.
    """
    if user and not is_guest_user(user) and user.get("id"):
        return str(user["id"])
    norm_ip = normalize_client_ip(client_ip)
    if norm_ip and norm_ip != "unknown":
        return f"guest_ip:{norm_ip}"
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
# there instead, and the local file is only used as a fallback (local dev / outage).

USAGE_TABLE = "ai_usage"
USAGE_RETENTION_DAYS = 3
_REMOTE_TIMEOUT = httpx.Timeout(10.0, connect=5.0)
_REMOTE_FAILURE_COOLDOWN = 60.0
_remote_disabled_until: float = 0.0
_ORIG_HTTP_CLIENT = httpx.Client
_HTTP_CLIENT_LOCK = threading.Lock()
_SHARED_HTTP_CLIENT: Optional[httpx.Client] = None


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
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
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

def _usage_remote_available() -> bool:
    return usage_store_is_durable() and time.time() >= _remote_disabled_until

def _disable_remote_temporarily(operation: str, detail: Any) -> None:
    """Falls back to the local file for a short cooldown after a Supabase failure."""
    global _remote_disabled_until
    _remote_disabled_until = time.time() + _REMOTE_FAILURE_COOLDOWN
    logger.error(
        f"Supabase usage store {operation} failed ({detail}). Falling back to the EPHEMERAL local file "
        f"for {_REMOTE_FAILURE_COOLDOWN:.0f}s - quota counts may reset on restart until it recovers. "
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
        return {row["identifier"]: int(row.get("count") or 0) for row in rows}
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
        return int(resp.json())
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
    if _usage_remote_available():
        remote = _remote_get_usages(date_key, ids)
        if remote is not None:
            return {ident: remote.get(ident, 0) for ident in ids}
    return {ident: _local_get_usage(date_key, ident) for ident in ids}

def get_user_daily_usage(user_id: str, date_str: Optional[str] = None) -> int:
    """Returns the number of AI operations used by user_id for the given date (default today)."""
    if not user_id:
        return 0
    return get_usage_for_identifiers([user_id], date_str=date_str).get(user_id, 0)

def record_prompt_usage(user_id: str, date_str: Optional[str] = None, credits: int = 1) -> int:
    """Increments and records `credits` AI usage units for user_id on the given date (default today)."""
    if not user_id:
        return 0
    delta = max(1, int(credits))
    date_key = date_str or _get_today_str()
    if _usage_remote_available():
        new_count = _remote_change_usage(date_key, user_id, delta)
        if new_count is not None:
            return new_count
    return _local_change_usage(date_key, user_id, delta)

def refund_prompt_usage(user_id: str, date_str: Optional[str] = None, credits: int = 1) -> int:
    """Decrements `credits` AI usage units for user_id on the given date (clamped to 0)."""
    if not user_id:
        return 0
    delta = -max(1, int(credits))
    date_key = date_str or _get_today_str()
    if _usage_remote_available():
        new_count = _remote_change_usage(date_key, user_id, delta)
        if new_count is not None:
            return new_count
    return _local_change_usage(date_key, user_id, delta)


GOOGLE_CLOUD_TTS_USAGE_ID = "system:google_cloud_tts_chars"
DEFAULT_GOOGLE_CLOUD_TTS_MONTHLY_CHAR_LIMIT = 950_000


def get_google_cloud_tts_monthly_limit() -> int:
    """Hard monthly character ceiling for Google Cloud TTS (default 950,000 to stay safely inside the 1M free tier)."""
    try:
        return int(os.getenv("GOOGLE_CLOUD_TTS_MONTHLY_CHAR_LIMIT", str(DEFAULT_GOOGLE_CLOUD_TTS_MONTHLY_CHAR_LIMIT)))
    except ValueError:
        return DEFAULT_GOOGLE_CLOUD_TTS_MONTHLY_CHAR_LIMIT


def _change_usage_delta(date_key: str, identifier: str, delta: int) -> int:
    if _usage_remote_available():
        new_count = _remote_change_usage(date_key, identifier, delta)
        if new_count is not None:
            return new_count
    return _local_change_usage(date_key, identifier, delta)


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
    new_total = _change_usage_delta(month_key, GOOGLE_CLOUD_TTS_USAGE_ID, n)
    if new_total > limit:
        _change_usage_delta(month_key, GOOGLE_CLOUD_TTS_USAGE_ID, -n)
        logger.warning(
            f"Google Cloud TTS monthly character cap reached ({new_total - n}/{limit} chars in {month_key}); "
            "falling back to free edge-tts."
        )
        return False
    return True


def refund_google_cloud_tts_chars(char_count: int, month_str: Optional[str] = None) -> int:
    """Refunds `char_count` characters back to the monthly Google Cloud TTS budget when a request fails."""
    n = max(0, int(char_count))
    if n == 0:
        return get_google_cloud_tts_monthly_usage(month_str)
    month_key = month_str or _get_month_start_str()
    return _change_usage_delta(month_key, GOOGLE_CLOUD_TTS_USAGE_ID, -n)


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
    return get_google_search_grounding_monthly_usage(month_str) < limit


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
    if n == 0:
        return get_google_search_grounding_monthly_usage(month_str), 0.0
    month_key = month_str or _get_month_start_str()
    new_total = _change_usage_delta(month_key, GOOGLE_SEARCH_GROUNDING_USAGE_ID, n)
    old_total = max(0, new_total - n)
    billable_queries = max(0, new_total - GOOGLE_SEARCH_GROUNDING_FREE_TIER_QUERIES) - max(
        0, old_total - GOOGLE_SEARCH_GROUNDING_FREE_TIER_QUERIES
    )
    overage_usd = round(billable_queries * GOOGLE_SEARCH_GROUNDING_USD_PER_QUERY, 6) if billable_queries > 0 else 0.0
    return new_total, overage_usd


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
    _add_community_spend_micro(delta_micro)
    return delta_micro / _MICRO_PER_USD


def record_community_donation_usd(
    amount: float,
    tx_id: Optional[str] = None,
    currency: str = "USD",
) -> Dict[str, Any]:
    """
    Atomically records a voluntary community donation (e.g., from Ko-fi webhook).
    Deduplicates by `tx_id` when provided so webhook retries never double-count.
    """
    try:
        raw_amount = float(amount or 0.0)
    except (TypeError, ValueError):
        raw_amount = 0.0
    if not math.isfinite(raw_amount) or raw_amount < 0:
        raw_amount = 0.0

    curr = (currency or "USD").strip().upper()
    rate = CURRENCY_TO_USD_RATES.get(curr, 1.0)
    usd_amount = raw_amount * rate
    if usd_amount > MAX_COMMUNITY_LEDGER_USD:
        logger.warning(f"Ignoring out-of-range community donation amount: {raw_amount} {curr}")
        usd_amount = 0.0

    if tx_id:
        clean_tx = re.sub(r"[^a-zA-Z0-9_\-:]", "", str(tx_id).strip())[:80]
        if clean_tx:
            tx_ident = f"kofi_tx:{clean_tx}"
            # Atomic claim: only the first delivery of a transaction sees the counter reach 1.
            if _change_usage_delta(COMMUNITY_LEDGER_DATE, tx_ident, 1) > 1:
                return {"recorded": False, "duplicate": True, "added_usd": 0.0, **get_community_ledger()}

    delta_cents = int(round(usd_amount * 100))
    if delta_cents > 0:
        _change_usage_delta(COMMUNITY_LEDGER_DATE, COMMUNITY_DONATED_CENTS_ID, delta_cents)
        _change_usage_delta(COMMUNITY_LEDGER_DATE, COMMUNITY_DONATIONS_COUNT_ID, 1)

    return {
        "recorded": delta_cents > 0,
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
        # Fast path for the public endpoint: one read, no lock, once seeded (or cooling down).
        ledger = get_community_ledger()
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
    ledger = get_community_ledger()

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
    if daily_limit > 0:
        day_key = date_str or _get_today_str()
        _change_usage_delta(day_key, COMMUNITY_DAILY_PAID_USAGE_ID, -cost)
    if monthly_limit > 0:
        m_key = month_str or _get_month_start_str()
        _change_usage_delta(m_key, COMMUNITY_MONTHLY_PAID_USAGE_ID, -cost)


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
    if is_guest_user(user):
        refund_guest_usage(user, client_ip, credits=cost)
    else:
        user_id = user.get("id") if user else "anonymous"
        refund_prompt_usage(str(user_id), credits=cost)
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

def get_user_quota_info(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None) -> Dict[str, Any]:
    """
    Returns the current user's single unified AI-operation quota: daily limit, used today,
    remaining, admin status, community pool status, and (for admins) the raw policy config for both roles.
    """
    is_admin = is_admin_user(user)
    mode = get_api_key_mode()
    community_pool = get_community_pool_status()
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

def resolve_gemini_key(
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
    registered users), falling back seamlessly to rotating free keys when credits are exhausted.
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

    def _resolve_paid_with_community_pool() -> Tuple[str, str]:
        if increment_usage:
            allowed = reserve_community_paid_prompt(credits=cost)
        else:
            allowed = not get_community_pool_status().get("exhausted", False)
        if not allowed:
            return get_next_free_key() or _get_active_paid_or_free_key(), "free"
        return _get_active_paid_or_free_key(), "paid"

    # 2a. Guest (anonymous) user
    if is_guest_user(user):
        guest_mode = get_guest_api_key_mode()
        if guest_mode == "free":
            chosen_key = get_next_free_key() or _get_active_paid_or_free_key()
            return chosen_key, "free", False
        elif guest_mode == "unlimited":
            chosen_key, tier = _resolve_paid_with_community_pool()
            return chosen_key, tier, False
        else:  # "limited"
            guest_limit = get_guest_daily_limit()
            used = get_guest_usage(user, client_ip)
            if used + cost <= guest_limit:
                if increment_usage:
                    record_guest_usage(user, client_ip, credits=cost)
                chosen_key, tier = _resolve_paid_with_community_pool()
                return chosen_key, tier, False
            else:
                if increment_usage:
                    record_guest_usage(user, client_ip, credits=cost)
                chosen_key = get_next_free_key() or _get_active_paid_or_free_key()
                return chosen_key, "free", False

    # 2b. Free mode: non-admins always use rotated free key, no usage recorded
    if mode == "free":
        chosen_key = get_next_free_key() or _get_active_paid_or_free_key()
        return chosen_key, "free", False

    # 2c. Unlimited mode: everyone gets the paid key, no usage recorded (with auto fallback)
    if mode == "unlimited":
        chosen_key, tier = _resolve_paid_with_community_pool()
        return chosen_key, tier, False

    # 3. Regular authenticated user
    user_id = user.get("id") if user else "anonymous"
    limit = get_registered_daily_limit()
    used = get_user_daily_usage(user_id)

    if used + cost <= limit:
        if increment_usage:
            record_prompt_usage(user_id, credits=cost)
        chosen_key, tier = _resolve_paid_with_community_pool()
        return chosen_key, tier, False
    else:
        if increment_usage:
            record_prompt_usage(user_id, credits=cost)
        chosen_key = get_next_free_key() or _get_active_paid_or_free_key()
        return chosen_key, "free", False


def charge_premium_credits(
    user: Optional[Dict[str, Any]],
    custom_api_key: Optional[str] = None,
    client_ip: Optional[str] = None,
    credits: int = 1,
) -> Tuple[bool, Optional[str], str, bool, bool]:
    """
    Atomically checks and deducts `credits` for strict premium-only features
    (Gemini image generation = 6 credits, Gemini podcast audio = 10 or 20 credits) that MUST
    be blocked rather than falling back to free keys or partially draining the user's
    remaining credits when `remaining < credits`.

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

    if is_guest_user(user):
        eff_mode = get_guest_api_key_mode()
        if eff_mode == "free":
            return False, None, "free", False, False
        if eff_mode == "limited":
            guest_limit = get_guest_daily_limit()
            used = get_guest_usage(user, client_ip)
            if used + cost > guest_limit:
                return False, None, "free", False, False
            if not reserve_community_paid_prompt(credits=cost):
                return False, None, "free", False, False
            record_guest_usage(user, client_ip, credits=cost)
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
    limit = get_registered_daily_limit()
    used = get_user_daily_usage(user_id)
    if used + cost > limit:
        return False, None, "free", False, False
    if not reserve_community_paid_prompt(credits=cost):
        return False, None, "free", False, False
    record_prompt_usage(user_id, credits=cost)
    return True, _get_active_paid_or_free_key(), "paid", True, True
