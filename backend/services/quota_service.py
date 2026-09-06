import os
import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
from services.auth_service import is_admin_user

logger = logging.getLogger("ChroniXQuota")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
USAGE_FILE = DATA_DIR / "daily_usage.json"
TIMELINE_USAGE_FILE = DATA_DIR / "timeline_usage.json"
_LOCK = threading.Lock()

def _get_today_str() -> str:
    """Returns today's date in YYYY-MM-DD format (UTC)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

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
    """Returns AI usage counts for a specific timeline (refine and event addition)."""
    if not timeline_id:
        return {"refine_count": 0, "event_add_count": 0}
    with _LOCK:
        data = _load_timeline_usage_data()
        t_data = data.get(timeline_id, {})
        return {
            "refine_count": t_data.get("refine_count", 0),
            "event_add_count": t_data.get("event_add_count", 0)
        }

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

def get_user_quota_info(user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Returns user quota details: daily limit, used today, remaining paid prompts, admin status,
    and configured per-timeline limits.
    """
    is_admin = is_admin_user(user)
    limit = int(os.getenv("DAILY_PAID_PROMPTS_PER_USER", "15"))
    refine_limit = int(os.getenv("TIMELINE_PAID_REFINE_LIMIT", "3"))
    event_add_limit = int(os.getenv("TIMELINE_PAID_EVENT_ADD_LIMIT", "10"))

    if is_admin:
        return {
            "is_admin": True,
            "daily_paid_limit": -1,
            "used_today": 0,
            "remaining_paid": 9999,
            "tier": "admin_unlimited",
            "timeline_paid_refine_limit": -1,
            "timeline_paid_event_add_limit": -1
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
        "timeline_paid_refine_limit": refine_limit,
        "timeline_paid_event_add_limit": event_add_limit
    }

def resolve_gemini_key(
    user: Optional[Dict[str, Any]],
    custom_api_key: Optional[str] = None,
    increment_usage: bool = True
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
    free_key = os.getenv("GEMINI_API_KEY_FREE", "").strip() or paid_key

    # 2. Admin user: always uses paid key without consuming quota
    if is_admin_user(user):
        chosen_key = paid_key or free_key
        return chosen_key, "admin_paid", True

    # 3. Regular authenticated user
    user_id = user.get("id") if user else "anonymous"
    limit = int(os.getenv("DAILY_PAID_PROMPTS_PER_USER", "15"))
    used = get_user_daily_usage(user_id)

    if used < limit:
        if increment_usage:
            record_prompt_usage(user_id)
        chosen_key = paid_key or free_key
        return chosen_key, "paid", False
    else:
        if increment_usage:
            record_prompt_usage(user_id)
        chosen_key = free_key or paid_key
        return chosen_key, "free", False

def resolve_refine_gemini_key(
    user: Optional[Dict[str, Any]],
    timeline_id: Optional[str] = None,
    custom_api_key: Optional[str] = None,
    increment_usage: bool = True
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
        return custom_api_key.strip(), "custom", False, 9999

    paid_key = os.getenv("GEMINI_API_KEY", "").strip()
    free_key = os.getenv("GEMINI_API_KEY_FREE", "").strip() or paid_key

    # 2. Admin user
    if is_admin_user(user):
        chosen_key = paid_key or free_key
        return chosen_key, "admin_paid", True, 9999

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
        chosen_key = paid_key or free_key
        return chosen_key, "paid", False, remaining_timeline_refines
    else:
        # Fall back to Free Tier key
        if increment_usage:
            record_prompt_usage(user_id)
            if timeline_id:
                new_count = record_timeline_refine(timeline_id)
                remaining_timeline_refines = max(0, refine_limit - new_count)
        chosen_key = free_key or paid_key
        return chosen_key, "free", False, remaining_timeline_refines

def resolve_event_suggest_gemini_key(
    user: Optional[Dict[str, Any]],
    timeline_id: Optional[str] = None,
    custom_api_key: Optional[str] = None,
    increment_usage: bool = True
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
        return custom_api_key.strip(), "custom", False, 9999

    paid_key = os.getenv("GEMINI_API_KEY", "").strip()
    free_key = os.getenv("GEMINI_API_KEY_FREE", "").strip() or paid_key

    # 2. Admin user
    if is_admin_user(user):
        chosen_key = paid_key or free_key
        return chosen_key, "admin_paid", True, 9999

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
        chosen_key = paid_key or free_key
        return chosen_key, "paid", False, remaining_timeline_adds
    else:
        if increment_usage and timeline_id:
            new_count = record_timeline_event_add(timeline_id)
            remaining_timeline_adds = max(0, event_add_limit - new_count)
        chosen_key = free_key or paid_key
        return chosen_key, "free", False, remaining_timeline_adds
