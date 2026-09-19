import os
import json
import logging
import threading
import time
import re
import ipaddress
import httpx
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
    If `api_key` is one of our server's free keys (or if none was passed),
    returns candidate free keys with `api_key` tried first, then remaining healthy free keys.
    If `api_key` is a custom user key (BYOK) or the paid key, returns [api_key].
    """
    all_free = get_all_free_keys()
    if not api_key:
        return get_candidate_free_keys()
    if api_key in all_free:
        return get_candidate_free_keys(api_key)
    return [api_key]

def _get_today_str() -> str:
    """Returns today's date in YYYY-MM-DD format (UTC)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

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

def get_guest_daily_limit() -> int:
    """
    Returns the single daily AI-operation quota for guest users (default 10).
    This ONE quota covers every AI operation equally — timeline generation, refine,
    chat (answer + edit), event suggestions, and file-based generation/attachment.
    There are no separate per-operation or per-timeline limits anymore.
    """
    return int(os.getenv("GUEST_DAILY_PAID_PROMPTS", "10"))

def get_registered_daily_limit() -> int:
    """
    Returns the single daily AI-operation quota for registered (non-guest, non-admin)
    users (default 10). Covers every AI operation equally, same as guests.
    """
    return int(os.getenv("DAILY_PAID_PROMPTS", "10"))

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

def record_guest_usage(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None, date_str: Optional[str] = None) -> int:
    """
    Increments usage for all identifiers tied to this guest (session ID and normalized IP).
    """
    ids = get_guest_identifiers(user, client_ip)
    current_max = 0
    for ident in ids:
        c = record_prompt_usage(ident, date_str=date_str)
        if c > current_max:
            current_max = c
    return current_max

def refund_guest_usage(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None, date_str: Optional[str] = None) -> None:
    """
    Refunds usage for all identifiers tied to this guest.
    """
    ids = get_guest_identifiers(user, client_ip)
    for ident in ids:
        refund_prompt_usage(ident, date_str=date_str)

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
    """Atomically saves usage data, keeping only the most recent days."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        keep_dates = sorted(data.keys(), reverse=True)[:USAGE_RETENTION_DAYS]
        filtered = {k: data[k] for k in keep_dates}
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
        with httpx.Client(timeout=_REMOTE_TIMEOUT) as client:
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
        with httpx.Client(timeout=_REMOTE_TIMEOUT) as client:
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

def record_prompt_usage(user_id: str, date_str: Optional[str] = None) -> int:
    """Increments and records one AI operation usage for user_id on the given date (default today)."""
    if not user_id:
        return 0
    date_key = date_str or _get_today_str()
    if _usage_remote_available():
        new_count = _remote_change_usage(date_key, user_id, 1)
        if new_count is not None:
            return new_count
    return _local_change_usage(date_key, user_id, 1)

def refund_prompt_usage(user_id: str, date_str: Optional[str] = None) -> int:
    """Decrements one AI operation usage for user_id on the given date (clamped to 0)."""
    if not user_id:
        return 0
    date_key = date_str or _get_today_str()
    if _usage_remote_available():
        new_count = _remote_change_usage(date_key, user_id, -1)
        if new_count is not None:
            return new_count
    return _local_change_usage(date_key, user_id, -1)

def refund_user_quota(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None) -> None:
    """Refunds one daily AI prompt for a non-admin user/guest."""
    if is_admin_user(user):
        return
    if is_guest_user(user):
        refund_guest_usage(user, client_ip)
    else:
        user_id = user.get("id") if user else "anonymous"
        refund_prompt_usage(str(user_id))

def get_user_quota_info(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None) -> Dict[str, Any]:
    """
    Returns the current user's single unified AI-operation quota: daily limit, used today,
    remaining, admin status, and (for admins) the raw policy config for both roles.
    """
    is_admin = is_admin_user(user)
    mode = get_api_key_mode()

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
            }
        if guest_mode == "unlimited":
            return {
                "is_admin": False, "is_guest": True,
                "daily_paid_limit": -1, "used_today": 0, "remaining_paid": -1,
                "tier": "unlimited", "mode": "unlimited",
                "registered_mode": mode, "registered_daily_limit": reg_limit,
            }
        # "limited"
        guest_limit = get_guest_daily_limit()
        used = get_guest_usage(user, client_ip)
        remaining = max(0, guest_limit - used)
        return {
            "is_admin": False, "is_guest": True,
            "daily_paid_limit": guest_limit, "used_today": used, "remaining_paid": remaining,
            "tier": "paid" if used < guest_limit else "free", "mode": "limited",
            "registered_mode": mode, "registered_daily_limit": reg_limit,
        }

    # Free mode: non-admins always run on the free key (unlimited, but paid features off).
    if mode == "free":
        return {
            "is_admin": False,
            "daily_paid_limit": -1, "used_today": 0, "remaining_paid": -1,
            "tier": "free", "mode": "free",
            "registered_mode": mode, "registered_daily_limit": -1,
        }

    # Unlimited mode: report unlimited paid access for everyone.
    if mode == "unlimited":
        return {
            "is_admin": False,
            "daily_paid_limit": -1, "used_today": 0, "remaining_paid": -1,
            "tier": "unlimited", "mode": "unlimited",
            "registered_mode": mode, "registered_daily_limit": -1,
        }

    # Regular registered user, limited mode
    limit = get_registered_daily_limit()
    user_id = user.get("id") if user else "anonymous"
    used = get_user_daily_usage(user_id)
    remaining = max(0, limit - used)

    return {
        "is_admin": False,
        "daily_paid_limit": limit, "used_today": used, "remaining_paid": remaining,
        "tier": "paid" if used < limit else "free", "mode": "limited",
        "registered_mode": mode, "registered_daily_limit": limit,
    }

def resolve_gemini_key(
    user: Optional[Dict[str, Any]],
    custom_api_key: Optional[str] = None,
    increment_usage: bool = True,
    client_ip: Optional[str] = None
) -> Tuple[str, str, bool]:
    """
    Resolves which Gemini API key to use for ANY AI operation — timeline generation, refine,
    chat (answer + edit), event suggestion/auto-fill, and file-based generate/attach. Every
    operation draws from ONE shared daily quota bucket per identity (GUEST_DAILY_PAID_PROMPTS
    for guests, DAILY_PAID_PROMPTS for registered users) — there are no separate
    chat/refine/event-add limits and no per-timeline caps; all AI actions count equally.
    Returns: (resolved_key, tier_name, is_admin)
    tier_name can be: "custom", "admin_paid", "paid", "free"
    """
    # 1. Custom BYOK provided by the client header
    if custom_api_key and custom_api_key.strip():
        return custom_api_key.strip(), "custom", False

    paid_key = os.getenv("GEMINI_API_KEY", "").strip()
    mode = get_api_key_mode()

    # 2. Admin user: always uses paid key without consuming quota
    if is_admin_user(user):
        chosen_key = paid_key or get_next_free_key()
        return chosen_key, "admin_paid", True

    # 2a. Guest (anonymous) user
    if is_guest_user(user):
        guest_mode = get_guest_api_key_mode()
        if guest_mode == "free":
            chosen_key = get_next_free_key() or paid_key
            return chosen_key, "free", False
        elif guest_mode == "unlimited":
            chosen_key = paid_key or get_next_free_key()
            return chosen_key, "paid", False
        else:  # "limited"
            guest_limit = get_guest_daily_limit()
            used = get_guest_usage(user, client_ip)
            if used < guest_limit:
                if increment_usage:
                    record_guest_usage(user, client_ip)
                chosen_key = paid_key or get_next_free_key()
                return chosen_key, "paid", False
            else:
                if increment_usage:
                    record_guest_usage(user, client_ip)
                chosen_key = get_next_free_key() or paid_key
                return chosen_key, "free", False

    # 2b. Free mode: non-admins always use rotated free key, no usage recorded
    if mode == "free":
        chosen_key = get_next_free_key() or paid_key
        return chosen_key, "free", False

    # 2c. Unlimited mode: everyone gets the paid key, no usage recorded
    if mode == "unlimited":
        chosen_key = paid_key or get_next_free_key()
        return chosen_key, "paid", False

    # 3. Regular authenticated user
    user_id = user.get("id") if user else "anonymous"
    limit = get_registered_daily_limit()
    used = get_user_daily_usage(user_id)

    if used < limit:
        if increment_usage:
            record_prompt_usage(user_id)
        chosen_key = paid_key or get_next_free_key()
        return chosen_key, "paid", False
    else:
        if increment_usage:
            record_prompt_usage(user_id)
        chosen_key = get_next_free_key() or paid_key
        return chosen_key, "free", False
