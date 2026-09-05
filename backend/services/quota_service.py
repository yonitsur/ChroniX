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
    Returns user quota details: daily limit, used today, remaining paid prompts, admin status.
    """
    is_admin = is_admin_user(user)
    limit = int(os.getenv("DAILY_PAID_PROMPTS_PER_USER", "15"))

    if is_admin:
        return {
            "is_admin": True,
            "daily_paid_limit": -1,
            "used_today": 0,
            "remaining_paid": 9999,
            "tier": "admin_unlimited"
        }

    user_id = user.get("id") if user else "anonymous"
    used = get_user_daily_usage(user_id)
    remaining = max(0, limit - used)

    return {
        "is_admin": False,
        "daily_paid_limit": limit,
        "used_today": used,
        "remaining_paid": remaining,
        "tier": "paid" if used < limit else "free"
    }

def resolve_gemini_key(
    user: Optional[Dict[str, Any]],
    custom_api_key: Optional[str] = None,
    increment_usage: bool = True
) -> Tuple[str, str, bool]:
    """
    Resolves which Gemini API key to use for this request.
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
