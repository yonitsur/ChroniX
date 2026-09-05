import os
import time
import logging
from typing import Optional, Dict, Any
import httpx
from fastapi import Header, HTTPException, Depends

logger = logging.getLogger("ChroniXAuth")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# In-memory cache for user sessions: token -> (user_dict, expire_timestamp)
_TOKEN_CACHE: Dict[str, tuple] = {}
CACHE_TTL = 300  # 5 minutes cache

def get_admin_emails() -> set[str]:
    raw = os.getenv("ADMIN_EMAILS", "")
    return {email.strip().lower() for email in raw.split(",") if email.strip()}

def is_admin_user(user_data: Optional[Dict[str, Any]]) -> bool:
    if not user_data or not isinstance(user_data, dict):
        return False
    admin_emails = get_admin_emails()
    email = (user_data.get("email") or "").strip().lower()
    if email and email in admin_emails:
        return True
    meta_email = (user_data.get("user_metadata", {}).get("email") or "").strip().lower()
    if meta_email and meta_email in admin_emails:
        return True
    return False

async def verify_supabase_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Verifies a Supabase JWT access token by calling the Supabase Auth API.
    Returns the user dict if valid, or None if invalid.
    """
    if not token or not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None

    # Check cache first
    now = time.time()
    if token in _TOKEN_CACHE:
        user_info, expires_at = _TOKEN_CACHE[token]
        if now < expires_at:
            # Recompute is_admin in case env changed
            user_info["is_admin"] = is_admin_user(user_info)
            return user_info
        else:
            del _TOKEN_CACHE[token]

    try:
        url = f"{SUPABASE_URL}/auth/v1/user"
        headers = {
            "Authorization": f"Bearer {token}",
            "apikey": SUPABASE_ANON_KEY
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                user_data = resp.json()
                user_data["is_admin"] = is_admin_user(user_data)
                _TOKEN_CACHE[token] = (user_data, now + CACHE_TTL)
                return user_data
            else:
                logger.warning(f"Supabase auth check returned {resp.status_code}: {resp.text}")
                return None
    except Exception as e:
        logger.error(f"Error validating Supabase token: {e}")
        return None

async def get_current_user_optional(
    authorization: Optional[str] = Header(None)
) -> Optional[Dict[str, Any]]:
    """
    Optional authentication dependency: returns user dict if valid token provided, else None.
    """
    if not authorization:
        return None

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None

    token = parts[1]
    return await verify_supabase_token(token)

async def get_current_user_required(
    authorization: Optional[str] = Header(None)
) -> Dict[str, Any]:
    """
    Required authentication dependency: raises 401 if missing or invalid token.
    """
    user = await get_current_user_optional(authorization)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Please sign in."
        )
    return user
