"""Deployment-environment helpers shared by services that behave differently in production."""
import hashlib
import hmac
import logging
import os

logger = logging.getLogger(__name__)


def is_production_environment() -> bool:
    """`APP_ENV` wins when set (production/prod); otherwise Render's `RENDER` env var means production."""
    app_env = os.getenv("APP_ENV", "").strip().lower()
    if app_env:
        return app_env in ("production", "prod")
    return bool(os.getenv("RENDER", "").strip())


def derived_secret(label: str) -> str:
    """
    A deterministic secret for `label`: HMAC-SHA256 of the FULL Supabase service-role key.
    Stable across restarts and workers, but never public (unlike a key prefix or the project URL).
    Empty when no service-role key is configured.
    """
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not key:
        return ""
    return hmac.new(key.encode("utf-8"), f"chronix:{label}".encode("utf-8"), hashlib.sha256).hexdigest()


_SALT_ENV_VARS = (
    ("QUOTA_IP_HASH_SALT", "hashed guest IP counters"),
    ("PHOTO_STORAGE_SALT", "hosted-photo owner folder names"),
)


def log_secret_salt_startup_warnings() -> None:
    """
    S-11: in production the salts must not be public. When unset, a secret derived from the
    service-role key is used instead (deterministic, not public), but explicit random values are
    recommended so rotating the service-role key never moves these hashes.
    """
    if not is_production_environment():
        return
    has_service_key = bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))
    for name, purpose in _SALT_ENV_VARS:
        if os.getenv(name):
            continue
        if has_service_key:
            logger.critical(
                f"{name} is not set in production: the {purpose} use a salt derived from "
                f"SUPABASE_SERVICE_ROLE_KEY. Set {name} to a long random value (see DEPLOYMENT_STEPS.md)."
            )
        else:
            logger.critical(
                f"{name} is not set in production and there is no service-role key to derive one from: "
                f"the {purpose} use a PUBLIC default salt. Set {name} to a long random value."
            )
