"""
Per-tier AI entitlements: the single source of truth for how "big" an AI operation may get.

Credits (see quota_service) decide HOW MANY operations a caller may run on the server's paid
Gemini key per day. Entitlements decide how much ONE operation may cost: how many events a
generation may produce, how much timeline context a refine may send, how many events a podcast
covers, and whether automatic AI images are allowed.

Fixed credit prices only stay honest if every operation's real cost is bounded, so the
guest/registered ceilings below keep a single operation close to its advertised price.

Tiers:
  - "guest":      anonymous sessions on the server's keys.
  - "registered": signed-in users on the server's keys.
  - "unlimited":  admins and anyone supplying their own Gemini API key (BYOK). No AI size
                  ceilings: BYOK users pay Google directly, and admins own the paid key.
                  A BYOK key counts only once it has completed a successful Gemini call
                  (services/byok_verification.py); until then the caller keeps their normal tier.
                  Model limits (e.g. 65K output tokens) and storage validation still apply.

Every numeric ceiling can be overridden through environment variables (<= 0 disables it).
"""

import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

from services.auth_service import is_admin_user, is_guest_user
from services.byok_verification import is_custom_key_verified

TIER_GUEST = "guest"
TIER_REGISTERED = "registered"
TIER_UNLIMITED = "unlimited"


@dataclass(frozen=True)
class Entitlements:
    tier: str
    # Max events a prompt-based generation may produce (None = no app-side ceiling).
    max_prompt_events: Optional[int]
    # Max events extracted from uploaded files / pasted text.
    max_file_events: Optional[int]
    # Max NEW events a single refine / chat-edit may add.
    max_refine_new_events: Optional[int]
    # Max characters of existing-event inventory a refine may send to the model.
    max_refine_context_chars: Optional[int]
    # Max event chapters in a 'full' podcast episode (None = every event on the timeline).
    podcast_full_max_events: Optional[int]
    # Whether the client's "auto-generate AI images for missing pictures" flag is honoured.
    allow_auto_ai_images: bool
    # --- Photo import (Story Studio) ---
    # Max photo-events one AI drafting call may describe (the client batches larger imports).
    photo_draft_max_events_per_call: int = 12
    # Max photos per event sent to the model, and their longest side in pixels.
    photo_draft_max_images_per_event: int = 3
    photo_draft_image_max_px: int = 384
    # How many drafting calls the client may run at once.
    photo_draft_parallel_calls: int = 1
    # Max points one reverse-geocoding call may resolve (Nominatim is serialised at 1 req/s).
    reverse_geocode_points_per_call: int = 10
    # Client hints for local work (None = no app-side ceiling): photos per import and
    # distinct places named per import.
    photo_import_max_photos: Optional[int] = 2000
    photo_import_max_places: Optional[int] = 80
    # Max events one story pass (titles, chapters, merges over the whole import) may cover.
    photo_story_max_events: int = 250
    # Max characters of the user's own instructions sent with every photo drafting / story call.
    photo_instructions_max_chars: int = 2800

    @property
    def is_unlimited(self) -> bool:
        return self.tier == TIER_UNLIMITED


def _env_cap(name: str, default: int) -> Optional[int]:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        val = int(raw)
    except ValueError:
        return default
    return val if val > 0 else None


def _limited_entitlements(tier: str) -> Entitlements:
    guest = tier == TIER_GUEST
    prefix = "GUEST" if guest else "REGISTERED"
    return Entitlements(
        tier=tier,
        max_prompt_events=_env_cap(f"{prefix}_MAX_PROMPT_EVENTS", 50),
        max_file_events=_env_cap(f"{prefix}_MAX_FILE_EVENTS", 60 if guest else 120),
        max_refine_new_events=_env_cap(f"{prefix}_MAX_REFINE_NEW_EVENTS", 25 if guest else 40),
        max_refine_context_chars=_env_cap(f"{prefix}_MAX_REFINE_CONTEXT_CHARS", 80_000 if guest else 200_000),
        podcast_full_max_events=_env_cap(f"{prefix}_PODCAST_MAX_EVENTS", 25),
        allow_auto_ai_images=False,
        photo_draft_max_events_per_call=_env_cap(f"{prefix}_PHOTO_DRAFT_EVENTS_PER_CALL", 8 if guest else 12) or 12,
        photo_draft_max_images_per_event=_env_cap(f"{prefix}_PHOTO_DRAFT_IMAGES_PER_EVENT", 2 if guest else 3) or 3,
        photo_draft_image_max_px=384,
        # Two calls at once: an AI-first import of a year of photos finishes in half the time.
        # Parallelism changes speed, not cost (every call is priced on its own).
        photo_draft_parallel_calls=_env_cap(f"{prefix}_PHOTO_DRAFT_PARALLEL_CALLS", 1 if guest else 2) or 1,
        reverse_geocode_points_per_call=10,
        photo_import_max_photos=_env_cap(f"{prefix}_PHOTO_IMPORT_MAX_PHOTOS", 1000 if guest else 2000),
        photo_import_max_places=_env_cap(f"{prefix}_PHOTO_IMPORT_MAX_PLACES", 40 if guest else 80),
        photo_story_max_events=_env_cap(f"{prefix}_PHOTO_STORY_MAX_EVENTS", 150 if guest else 250) or 250,
        # Sent with every call of an import, so it is priced into each call's input.
        photo_instructions_max_chars=_env_cap(f"{prefix}_PHOTO_INSTRUCTIONS_MAX_CHARS", 2800) or 2800,
    )


UNLIMITED_ENTITLEMENTS = Entitlements(
    tier=TIER_UNLIMITED,
    max_prompt_events=None,
    max_file_events=None,
    max_refine_new_events=None,
    max_refine_context_chars=None,
    podcast_full_max_events=None,
    allow_auto_ai_images=True,
    # Photo import: big batches, more and sharper photos per event, parallel calls, no caps on
    # photos or places. The per-call ceilings below are request-size / model-output bounds,
    # not cost limits - the client simply sends more calls.
    photo_draft_max_events_per_call=40,
    photo_draft_max_images_per_event=6,
    photo_draft_image_max_px=768,
    photo_draft_parallel_calls=3,
    reverse_geocode_points_per_call=25,
    photo_import_max_photos=None,
    photo_import_max_places=None,
    # Request-size bound only (the prompt stays well inside the model's context).
    photo_story_max_events=600,
    photo_instructions_max_chars=10_000,
)


def get_entitlements(user: Optional[Dict[str, Any]], custom_api_key: Optional[str] = None) -> Entitlements:
    """Resolves the caller's entitlements (admin or verified BYOK -> unlimited)."""
    if is_admin_user(user) or is_custom_key_verified(custom_api_key):
        return UNLIMITED_ENTITLEMENTS
    if is_guest_user(user):
        return _limited_entitlements(TIER_GUEST)
    return _limited_entitlements(TIER_REGISTERED)


def effective_auto_ai_images(ent: Entitlements, requested: Optional[bool]) -> Optional[bool]:
    """
    Client-requested automatic AI images are honoured only for unlimited callers. Limited tiers
    always get False (never None, so a server env default cannot silently re-enable it).
    """
    if ent.allow_auto_ai_images:
        return requested
    return False


def entitlements_summary(ent: Entitlements) -> Dict[str, Any]:
    """Client-facing view of the caller's ceilings (None = no ceiling)."""
    return {
        "tier": ent.tier,
        "max_prompt_events": ent.max_prompt_events,
        "max_file_events": ent.max_file_events,
        "max_refine_new_events": ent.max_refine_new_events,
        "podcast_full_max_events": ent.podcast_full_max_events,
        "allow_auto_ai_images": ent.allow_auto_ai_images,
    }


def photo_import_limits(ent: Entitlements) -> Dict[str, Any]:
    """Client-facing photo-import plan for the caller (None = no ceiling)."""
    return {
        "tier": ent.tier,
        "unlimited": ent.is_unlimited,
        "draft_events_per_call": ent.photo_draft_max_events_per_call,
        "draft_images_per_event": ent.photo_draft_max_images_per_event,
        "draft_image_max_px": ent.photo_draft_image_max_px,
        "draft_parallel_calls": ent.photo_draft_parallel_calls,
        "geocode_points_per_call": ent.reverse_geocode_points_per_call,
        "max_photos": ent.photo_import_max_photos,
        "max_places": ent.photo_import_max_places,
        "story_max_events": ent.photo_story_max_events,
        "instructions_max_chars": ent.photo_instructions_max_chars,
    }



def hosted_photo_quota(user: Optional[Dict[str, Any]]) -> Optional[int]:
    """
    How many photos a user may keep in hosted storage (Supabase Storage).
    Storage is the app owner's cost even for own-key users (their key only pays for AI), so BYOK
    users get the registered quota; admins have none. Guests keep photos inline in the timeline.
    0 = hosted storage not available; None = no limit.
    """
    if is_admin_user(user):
        return None
    if is_guest_user(user):
        return 0
    return _env_cap("REGISTERED_HOSTED_PHOTOS", 2000) or None
