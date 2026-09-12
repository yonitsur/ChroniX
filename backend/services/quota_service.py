import os
import json
import logging
import threading
import time
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any, Tuple, List
from services.auth_service import is_admin_user, is_guest_user

logger = logging.getLogger("ChroniXQuota")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
USAGE_FILE = DATA_DIR / "daily_usage.json"
TIMELINE_USAGE_FILE = DATA_DIR / "timeline_usage.json"
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
      - "limited":   paid key up to per-user/timeline quota, then falls back to the free key.
      - "free":      non-admins always use the free key; the paid key is never spent.
    Admins always get the paid key regardless of mode.
    """
    mode = os.getenv("API_KEY_MODE", "unlimited").strip().lower()
    return mode if mode in ("unlimited", "limited", "free") else "unlimited"

def get_guest_api_key_mode() -> str:
    """
    Returns the operating mode for guest users:
      - 'limited': (default) Guests get a daily quota on the high-speed paid key (e.g. 15 prompts),
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
    """Returns the daily paid prompts limit for guest users (default 5)."""
    return int(os.getenv("GUEST_DAILY_PAID_PROMPTS", "5"))

def get_guest_daily_chat_limit() -> int:
    """Returns the daily paid chat turns limit for guest users (default 15)."""
    return int(os.getenv("GUEST_DAILY_PAID_CHAT_PROMPTS", "15"))

def get_timeline_chat_limit() -> int:
    """Returns the paid chat turns limit per timeline (default 15)."""
    return int(os.getenv("TIMELINE_PAID_CHAT_LIMIT", "15"))

def get_quota_identifier(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None) -> str:
    """
    Returns the key used for daily quota tracking:
      - Registered users (authenticated with email/google): user['id'] (device-independent)
      - Guests (anonymous Supabase users or unauthenticated): 'guest_ip:{client_ip}' (prevents incognito/cookie-clear resets),
        falling back to 'guest:{user_id}' if client_ip is not provided.
    """
    if user and not is_guest_user(user) and user.get("id"):
        return str(user["id"])
    if client_ip and client_ip not in ("unknown", ""):
        return f"guest_ip:{client_ip}"
    if user and user.get("id"):
        return f"guest:{user['id']}"
    if client_ip:
        return f"guest_ip:{client_ip}"
    return "guest_ip:unknown"

def _load_usage_data() -> Dict[str, Dict[str, int]]:
    """Loads usage data from JSON file with lock protection."""
    if not USAGE_FILE.exists():
        return {}
    try:
        with open(USAGE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to read usage file {USAGE_FILE}: {e}")
        return {}

def _save_usage_data(data: Dict[str, Dict[str, int]]) -> None:
    """Saves usage data and prunes entries older than 3 days."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        today = _get_today_str()
        # Keep only today and the last 3 days
        filtered = {k: v for k, v in data.items() if k >= today or len(data) <= 5}
        with open(USAGE_FILE, "w", encoding="utf-8") as f:
            json.dump(filtered, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Failed to write usage file {USAGE_FILE}: {e}")

def _load_timeline_usage_data() -> Dict[str, Dict[str, int]]:
    """Loads per-timeline AI usage data with lock protection."""
    if not TIMELINE_USAGE_FILE.exists():
        return {}
    try:
        with open(TIMELINE_USAGE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to read timeline usage file {TIMELINE_USAGE_FILE}: {e}")
        return {}

def _save_timeline_usage_data(data: Dict[str, Dict[str, int]]) -> None:
    """Saves per-timeline AI usage data."""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(TIMELINE_USAGE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Failed to write timeline usage file {TIMELINE_USAGE_FILE}: {e}")

def get_timeline_ai_usage(timeline_id: Optional[str]) -> Dict[str, int]:
    """Returns AI usage counts for a specific timeline (refine, event addition, and chat)."""
    if not timeline_id:
        return {"refine_count": 0, "event_add_count": 0, "chat_count": 0}
    with _LOCK:
        data = _load_timeline_usage_data()
        t_data = data.get(timeline_id, {})
        return {
            "refine_count": t_data.get("refine_count", 0),
            "event_add_count": t_data.get("event_add_count", 0),
            "chat_count": t_data.get("chat_count", 0),
        }

def record_timeline_chat(timeline_id: Optional[str]) -> int:
    """Increments and records one chat message on timeline_id."""
    if not timeline_id:
        return 0
    with _LOCK:
        data = _load_timeline_usage_data()
        if timeline_id not in data:
            data[timeline_id] = {}
        current = data[timeline_id].get("chat_count", 0) + 1
        data[timeline_id]["chat_count"] = current
        _save_timeline_usage_data(data)
        return current

def record_timeline_refine(timeline_id: Optional[str]) -> int:
    """Increments and records one refinement usage for timeline_id."""
    if not timeline_id:
        return 0
    with _LOCK:
        data = _load_timeline_usage_data()
        if timeline_id not in data:
            data[timeline_id] = {}
        current = data[timeline_id].get("refine_count", 0) + 1
        data[timeline_id]["refine_count"] = current
        _save_timeline_usage_data(data)
        return current

def record_timeline_event_add(timeline_id: Optional[str]) -> int:
    """Increments and records one AI event addition/suggestion for timeline_id."""
    if not timeline_id:
        return 0
    with _LOCK:
        data = _load_timeline_usage_data()
        if timeline_id not in data:
            data[timeline_id] = {}
        current = data[timeline_id].get("event_add_count", 0) + 1
        data[timeline_id]["event_add_count"] = current
        _save_timeline_usage_data(data)
        return current

def get_user_daily_usage(user_id: str, date_str: Optional[str] = None) -> int:
    """Returns the number of prompts used by user_id for the given date (default today)."""
    if not user_id:
        return 0
    date_key = date_str or _get_today_str()
    with _LOCK:
        data = _load_usage_data()
        return data.get(date_key, {}).get(user_id, 0)

def record_prompt_usage(user_id: str, date_str: Optional[str] = None) -> int:
    """Increments and records one prompt usage for user_id on the given date (default today)."""
    if not user_id:
        return 0
    date_key = date_str or _get_today_str()
    with _LOCK:
        data = _load_usage_data()
        if date_key not in data:
            data[date_key] = {}
        current = data[date_key].get(user_id, 0) + 1
        data[date_key][user_id] = current
        _save_usage_data(data)
        return current

def get_user_daily_chat_usage(identifier: str, date_str: Optional[str] = None) -> int:
    """Returns the number of chat prompts used by identifier today."""
    if not identifier:
        return 0
    key = f"chat:{identifier}"
    date_key = date_str or _get_today_str()
    with _LOCK:
        data = _load_usage_data()
        return data.get(date_key, {}).get(key, 0)

def record_chat_prompt_usage(identifier: str, date_str: Optional[str] = None) -> int:
    """Increments and records one chat prompt usage for identifier on date."""
    if not identifier:
        return 0
    key = f"chat:{identifier}"
    date_key = date_str or _get_today_str()
    with _LOCK:
        data = _load_usage_data()
        if date_key not in data:
            data[date_key] = {}
        current = data[date_key].get(key, 0) + 1
        data[date_key][key] = current
        _save_usage_data(data)
        return current

def get_user_quota_info(user: Optional[Dict[str, Any]], client_ip: Optional[str] = None) -> Dict[str, Any]:
    """
    Returns user quota details: daily limit, used today, remaining paid prompts, admin status,
    and configured per-timeline limits.
    """
    is_admin = is_admin_user(user)
    mode = get_api_key_mode()
    limit = int(os.getenv("DAILY_PAID_PROMPTS_PER_USER", "15"))
    refine_limit = int(os.getenv("TIMELINE_PAID_REFINE_LIMIT", "3"))
    event_add_limit = int(os.getenv("TIMELINE_PAID_EVENT_ADD_LIMIT", "10"))
    timeline_chat_limit = get_timeline_chat_limit()

    if is_admin:
        return {
            "is_admin": True,
            "daily_paid_limit": -1,
            "used_today": 0,
            "remaining_paid": -1,
            "tier": "admin_unlimited",
            "mode": mode,
            "timeline_paid_refine_limit": -1,
            "timeline_paid_event_add_limit": -1,
            "timeline_paid_chat_limit": -1,
            "guest_daily_chat_limit": -1,
            "guest_chat_used_today": 0,
            "guest_chat_remaining": -1,
        }

    # Guests (anonymous sessions)
    if is_guest_user(user):
        guest_mode = get_guest_api_key_mode()
        guest_chat_limit = get_guest_daily_chat_limit()
        if guest_mode == "free":
            return {
                "is_admin": False,
                "is_guest": True,
                "daily_paid_limit": -1,
                "used_today": 0,
                "remaining_paid": -1,
                "tier": "free",
                "mode": "free",
                "timeline_paid_refine_limit": -1,
                "timeline_paid_event_add_limit": -1,
                "timeline_paid_chat_limit": -1,
                "guest_daily_chat_limit": -1,
                "guest_chat_used_today": 0,
                "guest_chat_remaining": -1,
            }
        elif guest_mode == "unlimited":
            return {
                "is_admin": False,
                "is_guest": True,
                "daily_paid_limit": -1,
                "used_today": 0,
                "remaining_paid": -1,
                "tier": "unlimited",
                "mode": "unlimited",
                "timeline_paid_refine_limit": -1,
                "timeline_paid_event_add_limit": -1,
                "timeline_paid_chat_limit": -1,
                "guest_daily_chat_limit": -1,
                "guest_chat_used_today": 0,
                "guest_chat_remaining": -1,
            }
        else:  # "limited"
            guest_limit = get_guest_daily_limit()
            identifier = get_quota_identifier(user, client_ip)
            used = get_user_daily_usage(identifier)
            remaining = max(0, guest_limit - used)
            chat_used = get_user_daily_chat_usage(identifier)
            chat_remaining = max(0, guest_chat_limit - chat_used)
            return {
                "is_admin": False,
                "is_guest": True,
                "daily_paid_limit": guest_limit,
                "used_today": used,
                "remaining_paid": remaining,
                "tier": "paid" if used < guest_limit else "free",
                "mode": "limited",
                "timeline_paid_refine_limit": refine_limit,
                "timeline_paid_event_add_limit": event_add_limit,
                "timeline_paid_chat_limit": timeline_chat_limit,
                "guest_daily_chat_limit": guest_chat_limit,
                "guest_chat_used_today": chat_used,
                "guest_chat_remaining": chat_remaining,
            }

    # Free mode: non-admins always run on the free key (unlimited, but paid features off).
    if mode == "free":
        return {
            "is_admin": False,
            "daily_paid_limit": -1,
            "used_today": 0,
            "remaining_paid": -1,
            "tier": "free",
            "mode": "free",
            "timeline_paid_refine_limit": -1,
            "timeline_paid_event_add_limit": -1,
            "timeline_paid_chat_limit": -1,
            "guest_daily_chat_limit": -1,
            "guest_chat_used_today": 0,
            "guest_chat_remaining": -1,
        }

    # Unlimited mode: report unlimited paid access for everyone.
    if mode == "unlimited":
        return {
            "is_admin": False,
            "daily_paid_limit": -1,
            "used_today": 0,
            "remaining_paid": -1,
            "tier": "unlimited",
            "mode": "unlimited",
            "timeline_paid_refine_limit": -1,
            "timeline_paid_event_add_limit": -1,
            "timeline_paid_chat_limit": -1,
            "guest_daily_chat_limit": -1,
            "guest_chat_used_today": 0,
            "guest_chat_remaining": -1,
        }

    user_id = user.get("id") if user else "anonymous"
    used = get_user_daily_usage(user_id)
    remaining = max(0, limit - used)

    return {
        "is_admin": False,
        "daily_paid_limit": limit,
        "used_today": used,
        "remaining_paid": remaining,
        "tier": "paid" if used < limit else "free",
        "mode": "limited",
        "timeline_paid_refine_limit": refine_limit,
        "timeline_paid_event_add_limit": event_add_limit,
        "timeline_paid_chat_limit": timeline_chat_limit,
        "guest_daily_chat_limit": -1,
        "guest_chat_used_today": 0,
        "guest_chat_remaining": -1,
    }

def resolve_gemini_key(
    user: Optional[Dict[str, Any]],
    custom_api_key: Optional[str] = None,
    increment_usage: bool = True,
    client_ip: Optional[str] = None
) -> Tuple[str, str, bool]:
    """
    Resolves which Gemini API key to use for standard timeline generation.
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
            identifier = get_quota_identifier(user, client_ip)
            used = get_user_daily_usage(identifier)
            if used < guest_limit:
                if increment_usage:
                    record_prompt_usage(identifier)
                chosen_key = paid_key or get_next_free_key()
                return chosen_key, "paid", False
            else:
                if increment_usage:
                    record_prompt_usage(identifier)
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
    limit = int(os.getenv("DAILY_PAID_PROMPTS_PER_USER", "15"))
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

def resolve_refine_gemini_key(
    user: Optional[Dict[str, Any]],
    timeline_id: Optional[str] = None,
    custom_api_key: Optional[str] = None,
    increment_usage: bool = True,
    client_ip: Optional[str] = None
) -> Tuple[str, str, bool, int]:
    """
    Resolves which Gemini API key to use for a Refine request.
    Enforces a per-timeline limit (default 3 paid refinements) in addition to the daily limit.
    Admins and custom BYOK keys are exempt.
    Returns: (resolved_key, tier_name, is_admin, remaining_timeline_refines)
    """
    refine_limit = int(os.getenv("TIMELINE_PAID_REFINE_LIMIT", "3"))

    # 1. Custom BYOK
    if custom_api_key and custom_api_key.strip():
        return custom_api_key.strip(), "custom", False, -1

    paid_key = os.getenv("GEMINI_API_KEY", "").strip()
    mode = get_api_key_mode()

    # 2. Admin user
    if is_admin_user(user):
        chosen_key = paid_key or get_next_free_key()
        return chosen_key, "admin_paid", True, -1

    # 2a. Guest (anonymous) user
    if is_guest_user(user):
        guest_mode = get_guest_api_key_mode()
        if guest_mode == "free":
            chosen_key = get_next_free_key() or paid_key
            return chosen_key, "free", False, -1
        elif guest_mode == "unlimited":
            chosen_key = paid_key or get_next_free_key()
            return chosen_key, "paid", False, -1
        else:  # "limited"
            current_timeline_usage = get_timeline_ai_usage(timeline_id) if timeline_id else {"refine_count": 0}
            timeline_refines = current_timeline_usage.get("refine_count", 0)
            remaining_timeline_refines = max(0, refine_limit - timeline_refines)

            identifier = get_quota_identifier(user, client_ip)
            guest_limit = get_guest_daily_limit()
            daily_used = get_user_daily_usage(identifier)

            if timeline_refines < refine_limit and daily_used < guest_limit:
                if increment_usage:
                    record_prompt_usage(identifier)
                    if timeline_id:
                        new_count = record_timeline_refine(timeline_id)
                        remaining_timeline_refines = max(0, refine_limit - new_count)
                chosen_key = paid_key or get_next_free_key()
                return chosen_key, "paid", False, remaining_timeline_refines
            else:
                if increment_usage:
                    record_prompt_usage(identifier)
                    if timeline_id:
                        new_count = record_timeline_refine(timeline_id)
                        remaining_timeline_refines = max(0, refine_limit - new_count)
                chosen_key = get_next_free_key() or paid_key
                return chosen_key, "free", False, remaining_timeline_refines

    # 2b. Free mode: non-admins always use rotated free key, no usage recorded
    if mode == "free":
        chosen_key = get_next_free_key() or paid_key
        return chosen_key, "free", False, -1

    # 2c. Unlimited mode: unlimited paid access, no usage recorded
    if mode == "unlimited":
        chosen_key = paid_key or get_next_free_key()
        return chosen_key, "paid", False, -1

    # 3. Regular user: check timeline usage
    current_timeline_usage = get_timeline_ai_usage(timeline_id) if timeline_id else {"refine_count": 0}
    timeline_refines = current_timeline_usage.get("refine_count", 0)
    remaining_timeline_refines = max(0, refine_limit - timeline_refines)

    user_id = user.get("id") if user else "anonymous"
    daily_limit = int(os.getenv("DAILY_PAID_PROMPTS_PER_USER", "15"))
    daily_used = get_user_daily_usage(user_id)

    # Both per-timeline refine limit AND daily prompt limit must have capacity for PAID key
    if timeline_refines < refine_limit and daily_used < daily_limit:
        if increment_usage:
            record_prompt_usage(user_id)
            if timeline_id:
                new_count = record_timeline_refine(timeline_id)
                remaining_timeline_refines = max(0, refine_limit - new_count)
        chosen_key = paid_key or get_next_free_key()
        return chosen_key, "paid", False, remaining_timeline_refines
    else:
        # Fall back to Free Tier key
        if increment_usage:
            record_prompt_usage(user_id)
            if timeline_id:
                new_count = record_timeline_refine(timeline_id)
                remaining_timeline_refines = max(0, refine_limit - new_count)
        chosen_key = get_next_free_key() or paid_key
        return chosen_key, "free", False, remaining_timeline_refines

def resolve_event_suggest_gemini_key(
    user: Optional[Dict[str, Any]],
    timeline_id: Optional[str] = None,
    custom_api_key: Optional[str] = None,
    increment_usage: bool = True,
    client_ip: Optional[str] = None
) -> Tuple[str, str, bool, int]:
    """
    Resolves which Gemini API key to use for single event suggestion / auto-fill.
    Enforces a per-timeline limit (default 10 paid AI event suggestions).
    Admins and custom BYOK keys are exempt.
    Returns: (resolved_key, tier_name, is_admin, remaining_timeline_adds)
    """
    event_add_limit = int(os.getenv("TIMELINE_PAID_EVENT_ADD_LIMIT", "10"))

    # 1. Custom BYOK
    if custom_api_key and custom_api_key.strip():
        return custom_api_key.strip(), "custom", False, -1

    paid_key = os.getenv("GEMINI_API_KEY", "").strip()
    mode = get_api_key_mode()

    # 2. Admin user
    if is_admin_user(user):
        chosen_key = paid_key or get_next_free_key()
        return chosen_key, "admin_paid", True, -1

    # 2a. Guest (anonymous) user
    if is_guest_user(user):
        guest_mode = get_guest_api_key_mode()
        if guest_mode == "free":
            chosen_key = get_next_free_key() or paid_key
            return chosen_key, "free", False, -1
        elif guest_mode == "unlimited":
            chosen_key = paid_key or get_next_free_key()
            return chosen_key, "paid", False, -1
        else:  # "limited"
            current_timeline_usage = get_timeline_ai_usage(timeline_id) if timeline_id else {"event_add_count": 0}
            timeline_adds = current_timeline_usage.get("event_add_count", 0)
            remaining_timeline_adds = max(0, event_add_limit - timeline_adds)

            identifier = get_quota_identifier(user, client_ip)
            guest_limit = get_guest_daily_limit()
            daily_used = get_user_daily_usage(identifier)

            if timeline_adds < event_add_limit and daily_used < guest_limit:
                if increment_usage and timeline_id:
                    new_count = record_timeline_event_add(timeline_id)
                    remaining_timeline_adds = max(0, event_add_limit - new_count)
                chosen_key = paid_key or get_next_free_key()
                return chosen_key, "paid", False, remaining_timeline_adds
            else:
                if increment_usage and timeline_id:
                    new_count = record_timeline_event_add(timeline_id)
                    remaining_timeline_adds = max(0, event_add_limit - new_count)
                chosen_key = get_next_free_key() or paid_key
                return chosen_key, "free", False, remaining_timeline_adds

    # 2b. Free mode: non-admins always use rotated free key, no usage recorded
    if mode == "free":
        chosen_key = get_next_free_key() or paid_key
        return chosen_key, "free", False, -1

    # 2c. Unlimited mode: unlimited paid access, no usage recorded
    if mode == "unlimited":
        chosen_key = paid_key or get_next_free_key()
        return chosen_key, "paid", False, -1

    # 3. Regular user: check timeline usage
    current_timeline_usage = get_timeline_ai_usage(timeline_id) if timeline_id else {"event_add_count": 0}
    timeline_adds = current_timeline_usage.get("event_add_count", 0)
    remaining_timeline_adds = max(0, event_add_limit - timeline_adds)

    user_id = user.get("id") if user else "anonymous"
    daily_limit = int(os.getenv("DAILY_PAID_PROMPTS_PER_USER", "15"))
    daily_used = get_user_daily_usage(user_id)

    if timeline_adds < event_add_limit and daily_used < daily_limit:
        if increment_usage and timeline_id:
            new_count = record_timeline_event_add(timeline_id)
            remaining_timeline_adds = max(0, event_add_limit - new_count)
        chosen_key = paid_key or get_next_free_key()
        return chosen_key, "paid", False, remaining_timeline_adds
    else:
        if increment_usage and timeline_id:
            new_count = record_timeline_event_add(timeline_id)
            remaining_timeline_adds = max(0, event_add_limit - new_count)
        chosen_key = get_next_free_key() or paid_key
        return chosen_key, "free", False, remaining_timeline_adds

def resolve_chat_gemini_key(
    user: Optional[Dict[str, Any]],
    timeline_id: Optional[str] = None,
    client_ip: Optional[str] = None,
    custom_api_key: Optional[str] = None,
    increment_usage: bool = True
) -> Tuple[str, str, bool]:
    """
    Resolves which Gemini API key to use for Timeline Chat ('צ'אט עם ציר הזמן').
    For guests:
      - Enforces per-timeline limit (TIMELINE_PAID_CHAT_LIMIT, default 3)
      - Enforces daily IP limit (GUEST_DAILY_PAID_CHAT_PROMPTS, default 3)
      - If either limit is reached, seamlessly routes to rotated free keys (no hard error or crash).
    For registered users:
      - In 'unlimited' mode (default), uses the fast paid key without artificial bounds.
      - In 'limited' mode, enforces per-timeline chat limit before falling back to free.
    Admins always get the paid key without consuming quota.
    Returns: (resolved_key, tier_name, is_admin)
    """
    # 1. Custom BYOK provided by the client header
    if custom_api_key and custom_api_key.strip():
        return custom_api_key.strip(), "custom", False

    paid_key = os.getenv("GEMINI_API_KEY", "").strip()
    mode = get_api_key_mode()

    # 2. Admin user
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
            timeline_chat_limit = get_timeline_chat_limit()
            guest_chat_limit = get_guest_daily_chat_limit()

            current_timeline_usage = get_timeline_ai_usage(timeline_id) if timeline_id else {"chat_count": 0}
            timeline_chats = current_timeline_usage.get("chat_count", 0)

            identifier = get_quota_identifier(user, client_ip)
            daily_chats = get_user_daily_chat_usage(identifier)

            # Must have remaining capacity on both the timeline AND the guest's daily IP chat quota
            if timeline_chats < timeline_chat_limit and daily_chats < guest_chat_limit:
                if increment_usage:
                    record_chat_prompt_usage(identifier)
                    if timeline_id:
                        record_timeline_chat(timeline_id)
                chosen_key = paid_key or get_next_free_key()
                return chosen_key, "paid", False
            else:
                # Seamlessly fallback to free Gemini key
                if increment_usage:
                    record_chat_prompt_usage(identifier)
                    if timeline_id:
                        record_timeline_chat(timeline_id)
                chosen_key = get_next_free_key() or paid_key
                return chosen_key, "free", False

    # 2b. Global free mode
    if mode == "free":
        chosen_key = get_next_free_key() or paid_key
        return chosen_key, "free", False

    # 2c. Global unlimited mode (registered users get paid key)
    if mode == "unlimited":
        chosen_key = paid_key or get_next_free_key()
        return chosen_key, "paid", False

    # 3. Regular registered user in limited mode
    timeline_chat_limit = get_timeline_chat_limit()
    current_timeline_usage = get_timeline_ai_usage(timeline_id) if timeline_id else {"chat_count": 0}
    timeline_chats = current_timeline_usage.get("chat_count", 0)

    user_id = user.get("id") if user else "anonymous"
    if timeline_chats < timeline_chat_limit:
        if increment_usage:
            record_chat_prompt_usage(user_id)
            if timeline_id:
                record_timeline_chat(timeline_id)
        chosen_key = paid_key or get_next_free_key()
        return chosen_key, "paid", False
    else:
        if increment_usage:
            record_chat_prompt_usage(user_id)
            if timeline_id:
                record_timeline_chat(timeline_id)
        chosen_key = get_next_free_key() or paid_key
        return chosen_key, "free", False
