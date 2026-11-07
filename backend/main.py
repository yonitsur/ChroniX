import os
import re
import base64
import io
import json
import uuid
import hashlib
import logging
import time
import ipaddress
import contextvars
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Awaitable, Callable, Dict, List, Optional, Tuple
from fastapi import FastAPI, HTTPException, Header, Body, Depends, Request, Response, status, File, Form, UploadFile, Query
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.datastructures import Headers
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.background import BackgroundTask
from pydantic import ValidationError
from dotenv import load_dotenv
load_dotenv()

import urllib.parse
from models import (
    TimelineData,
    TimelineDate,
    GenerateTimelineRequest,
    RefineTimelineRequest,
    TimelineArticle,
    EventSuggestionRequest,
    TextPolishRequest,
    StoryOverviewRequest,
    PhotoDraftRequest,
    PhotoStoryRequest,
    PersonalEnrichmentRequest,
    PhotoImportCostSummaryRequest,
    ReverseGeocodeRequest,
    PHOTO_DRAFT_MAX_IMAGE_CHARS,
    TimelineChatRequest,
    TimelineChatResponse,
    TimelineChatOutput,
    TimelineQuizRequest,
    TimelineQuizResponse,
    QuizQuestion,
    TimelineWhoAmIRequest,
    TimelineWhoAmIResponse,
    WhoAmIItem,
    TimelinePodcastRequest,
    PodcastAudioRequest,
    PodcastListenReport,
    PodcastData,
    GroundingMetadataPayload,
    EventImageGenerationRequest,
    GameCompletedRequest,
)
from services.gemini_service import (
    generate_timeline_with_gemini,
    generate_timeline_from_files,
    refine_timeline_with_gemini,
    suggest_event_details,
    polish_user_text,
    draft_story_overview,
    draft_photo_events,
    draft_photo_story,
    generate_event_image_with_gemini,
    PremiumImageUnavailableError,
    chat_about_timeline,
    generate_timeline_quiz,
    generate_timeline_whoami,
    generate_timeline_podcast,
    default_host_names,
    clean_spoken_text,
    normalize_music_mood,
    PODCAST_FOCUSED_MAX_EVENTS,
    PODCAST_MUSIC_MOODS,
    normalize_event_dates,
    timeline_date_from_dict,
    date_sort_key,
    SUB_DAY_PRECISIONS,
    InsufficientSubjectInfoError,
    EmptyRefineResultError,
    TimelineTooLargeError,
    TIMELINE_MAX_ARTICLES,
    article_media_kwargs,
    set_model_response_hook,
    set_partial_result_hook,
)
from services.podcast_tts_service import (
    ENGINES,
    available_engines,
    default_engine_for_language,
    ensure_gcloud_remaining_chars_fresh,
    detect_effective_language,
    normalize_engine,
)
from services import podcast_audio, podcast_store
from services.executors import run_bulk, run_cpu, run_quota, run_storage
from services import http_clients
from prompts.timeline import normalize_content_mode
from services.wiki_enricher import (
    fetch_wikipedia_summary,
    search_wikipedia_candidates,
    search_geocode_candidates,
    reverse_geocode_point,
    round_reverse_geocode_point,
    warm_reverse_geocode_cells,
    NominatimBusyError,
    enrich_events_with_wikipedia,
    wikimedia_http_client,
    normalize_wiki_lang,
    WIKIMEDIA_LANE_INTERACTIVE,
)
from services.storage import (
    list_all_timelines,
    list_user_timeline_ids,
    list_library_timelines,
    list_library_timelines_fast_page,
    get_library_catalog_facets,
    project_library_card_for_viewer,
    invalidate_library_cache,
    set_timeline_library_status,
    reorder_library_timelines,
    CURATED_DOMAINS,
    get_timeline_by_id,
    get_timeline_with_meta,
    get_timeline_access_meta,
    get_timeline_data_fields,
    get_timeline_share_meta,
    public_cache_get,
    public_cache_put,
    set_timeline_shared,
    save_timeline_data,
    delete_timeline_data,
    delete_all_user_timelines,
    ensure_data_dir,
    get_timeline_owner,
    get_timeline_chat,
    save_timeline_chat,
    transfer_user_timelines,
    StorageUnavailableError,
    TimelineConflictError,
    TimelineGoneError,
    TimelineImageLimitError,
    TimelineStaleWriteError,
    EmptyTimelineError,
    timeline_content_fingerprint,
    sanitize_timeline_dates,
)
from services.auth_service import (
    authorization_header_plausible,
    get_current_user_optional,
    get_current_user_required,
    is_admin_user,
    is_guest_user,
    list_all_users,
    delete_supabase_user,
    resolve_guest_session_user,
)
from services.byok_verification import (
    is_custom_key_verified,
    mark_custom_key_verified,
    forget_custom_key,
    observe_gemini_successes,
    key_fingerprint as byok_key_fingerprint,
)
from services.quota_service import (
    resolve_gemini_key,
    charge_premium_credits,
    PREMIUM_KEY_UNAVAILABLE_TIER,
    QUOTA_STORE_UNAVAILABLE_TIER,
    QUOTA_STORE_UNAVAILABLE_DETAIL,
    QUOTA_STORE_RETRY_AFTER_SECONDS,
    UsageStoreUnavailable,
    get_user_quota_info,
    get_all_free_keys,
    get_candidate_keys_for_request,
    get_next_free_key,
    mark_key_exhausted,
    get_guest_api_key_mode,
    get_guest_daily_limit,
    get_api_key_mode,
    get_registered_daily_limit,
    get_text_credit_cost,
    get_gemini_image_credit_cost,
    get_gemini_audio_credit_cost,
    get_gemini_audio_full_credit_cost,
    get_credit_costs,
    calculate_upload_credit_cost,
    refund_user_quota,
    increment_user_quota,
    usage_store_is_durable,
    get_community_ledger,
    record_community_donation_usd,
    set_community_ledger_totals,
    sync_historical_spend_from_activity_log,
    admin_sync_historical_spend,
    community_pool_reserved_for_tier,
    refund_community_paid_prompt,
    normalize_client_ip,
    ipv6_coarse_network,
    get_ipv6_56_ceiling_multiplier,
    reserve_free_image_generation,
    refund_daily_counters,
    delete_user_usage_records,
    set_request_client_ip,
    begin_request_ai_tier_tracking,
    AI_TIER_HEADER,
    calculate_photo_draft_credit_cost,
    calculate_photo_story_credit_cost,
    calculate_history_links_credit_cost,
    get_history_links_events_per_credit,
    get_photo_draft_events_per_credit,
    get_photo_draft_full_events_per_credit,
    get_photo_story_events_per_credit,
    get_hosted_photo_count,
    change_hosted_photo_count,
    set_hosted_photo_count,
    is_production_environment,
    log_spend_cap_startup_warnings,
)
from services.runtime_env import log_secret_salt_startup_warnings
from services.image_safety import install_pillow_pixel_limit, open_image_checked
from services.ai_errors import (
    AiErrorKind,
    BYOK_SUGGESTION_KINDS,
    classify_ai_error,
    key_cooldown_seconds,
)
from services.entitlements import (
    get_entitlements,
    effective_auto_ai_images,
    entitlements_summary,
    photo_import_limits,
    hosted_photo_quota,
)
from services.youtube_service import search_youtube_videos
from services import google_photos, photo_store
from services.upload_security import (
    ALLOWED_UPLOAD_MIME_TYPES,
    ValidatedUploads,
    validate_and_read_uploads,
)
from services.photo_import_cost import log_photo_import_summary, record_photo_import_cost
from services.gemini_service import QUIET_USAGE_LOGS
from services.activity_log import (
    track_ai_activity,
    apply_timeline_result,
    search_mode_for,
    normalize_input_method,
    record_key_rotation,
    log_game_completed,
    log_podcast_listen,
    record_extra_cost,
    reassign_user_activity,
    delete_user_activity,
    flush as flush_activity_log,
)
from services import deleted_users
import httpx
import asyncio

load_dotenv()
logging.basicConfig(level=logging.INFO)
# Suppress httpx/httpcore INFO logs so outbound URLs (and any query strings) are never printed to stdout.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger("ChroniXAPI")

ensure_data_dir()

if usage_store_is_durable():
    logger.info("AI usage quota store: Supabase (durable across restarts).")
else:
    logger.warning(
        "AI usage quota store: local JSON file. On ephemeral hosts (Render/Railway) every "
        "restart or redeploy RESETS all daily quotas. Configure SUPABASE_URL + "
        "SUPABASE_SERVICE_ROLE_KEY and create the ai_usage table (see README) to persist them."
    )


def _parse_valid_ip(raw: Optional[str]) -> Optional[str]:
    if not raw or not isinstance(raw, str):
        return None
    candidate = raw.strip()
    if not candidate:
        return None
    # Strip optional IPv4 :port suffix
    if candidate.count(":") == 1 and "." in candidate:
        host_part, port_part = candidate.rsplit(":", 1)
        if port_part.isdigit():
            candidate = host_part
    try:
        ipaddress.ip_address(candidate)
        return candidate
    except ValueError:
        return None


def _should_trust_proxy_headers(peer_host: Optional[str]) -> bool:
    explicit = os.getenv("TRUST_PROXY_HEADERS", "").strip().lower()
    if explicit in ("0", "false", "no"):
        return False
    if explicit in ("1", "true", "yes") or os.getenv("RENDER") or os.getenv("RAILWAY_ENVIRONMENT"):
        return True
    parsed = _parse_valid_ip(peer_host)
    if not parsed:
        return False
    addr = ipaddress.ip_address(parsed)
    return bool(addr.is_loopback or addr.is_private)


def get_client_ip(request: Request) -> str:
    """
    Resolves the caller IP (see `_resolve_client_ip`) and remembers it for the current request
    task, so real-cost metering in `track_ai_activity` (including background jobs spawned from
    this request) can attribute guest spend to the same per-IP counters as guest credits.
    """
    ip = _resolve_client_ip(request)
    set_request_client_ip(ip)
    return ip


def _header_lines(headers: Any, name: str) -> List[str]:
    """Every line of header `name`, in order (a proxy chain may split X-Forwarded-For across lines)."""
    if not headers:
        return []
    getlist = getattr(headers, "getlist", None)
    if callable(getlist):
        return [v for v in getlist(name) if isinstance(v, str)]
    lname = name.lower()
    try:
        return [v for k, v in headers.items() if isinstance(k, str) and k.lower() == lname and isinstance(v, str)]
    except AttributeError:
        return []


def _forwarded_for_chain(headers: Any) -> List[str]:
    joined = ",".join(_header_lines(headers, "x-forwarded-for"))
    return [parsed for part in joined.split(",") if (parsed := _parse_valid_ip(part)) is not None]


_FORWARDED_HEADERS_LOGGED = False


def _log_forwarded_headers_once(request: Request) -> None:
    """LOG_FORWARDED_HEADERS_ONCE=true: log one request's raw forwarding headers so the proxy chain
    (and the right TRUSTED_PROXY_HOPS / TRUSTED_CLIENT_IP_HEADER) can be confirmed on the real host."""
    global _FORWARDED_HEADERS_LOGGED
    if _FORWARDED_HEADERS_LOGGED or os.getenv("LOG_FORWARDED_HEADERS_ONCE", "").strip().lower() not in ("1", "true", "yes"):
        return
    _FORWARDED_HEADERS_LOGGED = True
    names = ("x-forwarded-for", "x-real-ip", "forwarded", "cf-connecting-ip", "true-client-ip", "x-forwarded-proto")
    seen = {name: _header_lines(request.headers, name) for name in names}
    peer = request.client.host if request.client else None
    logger.warning(f"Forwarding headers (one-shot diagnostic): peer={peer!r} headers={seen!r}")


def _resolve_client_ip(request: Request) -> str:
    """
    Extracts the client IP safely. Proxy-provided headers are read only behind a trusted proxy
    (`_should_trust_proxy_headers`), in this order:
      1. `TRUSTED_CLIENT_IP_HEADER` (e.g. CF-Connecting-IP / True-Client-IP), only when configured,
         because only an edge that overwrites it makes it trustworthy.
      2. `X-Forwarded-For`, all header lines joined in order, taking the entry `TRUSTED_PROXY_HOPS`
         from the right, so client-prepended (left-hand) entries are ignored.
      3. `X-Real-IP`, only when `TRUST_X_REAL_IP=true`.
    Otherwise the socket peer. The Procfile no longer lets uvicorn rewrite `request.client` from
    these headers (FORWARDED_ALLOW_IPS defaults to 127.0.0.1), so the peer really is the peer.
    """
    _log_forwarded_headers_once(request)
    peer_host = request.client.host if request.client else None
    if _should_trust_proxy_headers(peer_host):
        edge_header = os.getenv("TRUSTED_CLIENT_IP_HEADER", "").strip()
        if edge_header:
            values = _header_lines(request.headers, edge_header)
            if values:
                parsed_edge = _parse_valid_ip(values[-1])
                if parsed_edge:
                    return parsed_edge
        try:
            trusted_hops = max(1, int(os.getenv("TRUSTED_PROXY_HOPS", "1").strip() or "1"))
        except ValueError:
            trusted_hops = 1
        valid_chain = _forwarded_for_chain(request.headers)
        if valid_chain:
            idx = max(0, len(valid_chain) - trusted_hops)
            return valid_chain[idx]
        if os.getenv("TRUST_X_REAL_IP", "").strip().lower() in ("1", "true", "yes"):
            real_ips = _header_lines(request.headers, "x-real-ip")
            if real_ips:
                parsed_real = _parse_valid_ip(real_ips[-1])
                if parsed_real:
                    return parsed_real
    return peer_host if peer_host else "unknown"


class SimpleRateLimiter:
    """
    In-memory sliding-window rate limiter per client/user.
    Protects expensive AI endpoints from spam and wallet exhaustion.
    Admin users are completely exempt from rate limiting.
    Supports dynamic configuration via environment variables and refunding on cancellation.
    """
    MAX_TRACKED_IDENTIFIERS = 4096

    def __init__(
        self,
        max_requests: int,
        window_seconds: int = 60,
        name: str = "endpoint",
        env_var: Optional[str] = None,
        guest_max_requests: Optional[int] = None,
        byok_multiplier: bool = True,
    ):
        self.max_requests = max_requests
        self.guest_max_requests = guest_max_requests
        # False for limiters guarding third-party quotas the server pays for (Nominatim, Wikimedia,
        # YouTube, Google Photos, free image generators): a personal Gemini key doesn't pay for those.
        self.byok_multiplier = byok_multiplier
        self.window_seconds = window_seconds
        self.name = name
        self.env_var = env_var
        self.records: Dict[str, list[float]] = defaultdict(list)

    @property
    def effective_max_requests(self) -> int:
        if self.env_var:
            raw = os.getenv(self.env_var, "").strip()
            if raw:
                try:
                    return int(raw)
                except ValueError:
                    pass
        return self.max_requests

    def effective_limit_for_user(
        self,
        actual_user: Optional[Dict[str, Any]],
        has_custom_key: bool = False,
    ) -> int:
        base = self.effective_max_requests
        if base <= 0:
            return base
        has_custom_key = bool(has_custom_key and self.byok_multiplier)
        if (
            self.guest_max_requests is not None
            and not has_custom_key
            and (actual_user is None or is_guest_user(actual_user))
            and not (self.env_var and os.getenv(self.env_var, "").strip())
        ):
            base = self.guest_max_requests
        return base * 4 if has_custom_key else base

    @staticmethod
    def guest_ip_ceiling_multiplier() -> int:
        """Per-IP ceiling for guest sessions, as a multiple of the per-guest limit (0 disables it)."""
        raw = os.getenv("GUEST_RATE_LIMIT_IP_MULTIPLIER", "").strip()
        if raw:
            try:
                return max(0, int(raw))
            except ValueError:
                pass
        return 5

    @staticmethod
    def _bucket_keys(identifier: str) -> List[str]:
        return [part for part in identifier.split("|") if part]

    def refund(self, identifier: str) -> None:
        """Removes the most recent request timestamp from each bucket of identifier (e.g. after cancellation)."""
        for key in self._bucket_keys(identifier):
            if key in self.records and self.records[key]:
                self.records[key].pop()
                remaining = len(self.records[key])
                if not remaining:
                    self.records.pop(key, None)
                logger.info(f"Rate limiter refund applied for {key} on {self.name} (remaining: {remaining})")

    def get_identifier(self, request: Request, user: Optional[Dict[str, Any]] = None) -> str:
        """
        Registered users are keyed by user id. Guest sessions are keyed by their (stable) anonymous
        user id plus a shared per-IP ceiling bucket, joined as `guest:<id>|guest_ip_all:<ip>`, so
        classmates behind one IP don't share one guest's limit. IPv6 guests also get a coarser
        `guest_ip56_all:<net>/56` ceiling, so hopping /64s inside one connection doesn't help.
        Callers with no user at all (optional-auth routes) are keyed by IP.
        """
        actual_user = user if isinstance(user, dict) else None
        if actual_user and not is_guest_user(actual_user) and actual_user.get("id"):
            return f"user:{actual_user['id']}"
        raw_ip = get_client_ip(request)
        ip = normalize_client_ip(raw_ip)
        if actual_user and actual_user.get("id"):
            identifier = f"guest:{actual_user['id']}|guest_ip_all:{ip}"
            net56 = ipv6_coarse_network(raw_ip)
            if net56:
                identifier += f"|guest_ip56_all:{net56}"
            return identifier
        return f"guest_ip:{ip}"

    def _prune(self, now: float, cutoff: float) -> None:
        if len(self.records) > 512:
            for k, ts in list(self.records.items()):
                if not ts or ts[-1] <= cutoff:
                    self.records.pop(k, None)
            if len(self.records) >= self.MAX_TRACKED_IDENTIFIERS:
                oldest_keys = sorted(
                    self.records.keys(),
                    key=lambda k: self.records[k][-1] if self.records[k] else 0.0,
                )
                for k in oldest_keys[: len(self.records) - self.MAX_TRACKED_IDENTIFIERS + 1]:
                    self.records.pop(k, None)

    async def __call__(
        self,
        request: Request,
        x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
        user: Optional[Dict[str, Any]] = Depends(get_current_user_optional)
    ):
        actual_user = user if isinstance(user, dict) else None

        # Admin is completely exempt from rate limits!
        if actual_user and is_admin_user(actual_user):
            return

        # Only a key that has completed a Gemini call earns the BYOK multiplier (S-04).
        has_custom_key = is_custom_key_verified(x_gemini_api_key)
        effective_limit = self.effective_limit_for_user(actual_user, has_custom_key=has_custom_key)
        # If limit <= 0, rate limiting is disabled entirely
        if effective_limit <= 0:
            return

        identifier = self.get_identifier(request, actual_user)
        keys = self._bucket_keys(identifier)
        ip_multiplier = self.guest_ip_ceiling_multiplier()

        now = time.time()
        cutoff = now - self.window_seconds

        # Clean expired timestamps and prune empty identifier buckets
        buckets: List[tuple] = []
        for key in keys:
            if key.startswith("guest_ip_all:"):
                if ip_multiplier <= 0:
                    continue
                limit = effective_limit * ip_multiplier
            elif key.startswith("guest_ip56_all:"):
                v6_multiplier = get_ipv6_56_ceiling_multiplier()
                if ip_multiplier <= 0 or v6_multiplier <= 0:
                    continue
                limit = effective_limit * ip_multiplier * v6_multiplier
            else:
                limit = effective_limit
            kept = [t for t in self.records.get(key, ()) if t > cutoff]
            if kept:
                self.records[key] = kept
            else:
                self.records.pop(key, None)
            buckets.append((key, kept, limit))

        self._prune(now, cutoff)

        for key, kept, limit in buckets:
            if len(kept) >= limit:
                oldest = kept[0]
                retry_after = max(1, int(self.window_seconds - (now - oldest)))
                logger.warning(f"Rate limit exceeded for {key} on {self.name} ({len(kept)}/{limit})")
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Rate limit exceeded for {self.name}. Please wait {retry_after} seconds before trying again.",
                    headers={"Retry-After": str(retry_after)}
                )

        for key, _, _ in buckets:
            self.records[key].append(now)

timeline_rate_limiter = SimpleRateLimiter(
    max_requests=10,
    window_seconds=60,
    name="timeline generation",
    env_var="TIMELINE_RATE_LIMIT_PER_MINUTE"
)
# Dedicated non-refunded upload limiter: prevents start+cancel loops from flooding multipart
# parsing, server memory, or multimodal token intake without consuming rate-limit budget.
file_upload_rate_limiter = SimpleRateLimiter(
    max_requests=6,
    guest_max_requests=4,
    window_seconds=60,
    name="file upload",
    env_var="UPLOAD_RATE_LIMIT_PER_MINUTE",
)
event_suggest_rate_limiter = SimpleRateLimiter(max_requests=25, window_seconds=60, name="event suggestion")
text_polish_rate_limiter = SimpleRateLimiter(max_requests=20, window_seconds=60, name="text polish")
# Photo import: AI drafting calls (BYOK x4, admins exempt - see SimpleRateLimiter) and place lookups.
photo_draft_rate_limiter = SimpleRateLimiter(
    max_requests=12, guest_max_requests=8, window_seconds=60, name="photo drafts",
    env_var="PHOTO_DRAFT_RATE_LIMIT_PER_MINUTE",
)
reverse_geocode_rate_limiter = SimpleRateLimiter(
    max_requests=30, window_seconds=60, name="place lookup", byok_multiplier=False,
)
# Google Photos Picker proxy: session calls are few; photo fetches are many (one per thumbnail /
# AI copy / stored copy), but only small resized images. Admins are exempt (SimpleRateLimiter).
google_photos_rate_limiter = SimpleRateLimiter(
    max_requests=180, window_seconds=60, name="Google Photos", byok_multiplier=False,
)
google_photos_media_rate_limiter = SimpleRateLimiter(
    max_requests=900, window_seconds=60, name="Google Photos photos", byok_multiplier=False,
)
# Hosted timeline photos: one upload per kept photo (admins exempt).
photo_upload_rate_limiter = SimpleRateLimiter(max_requests=600, window_seconds=60, name="photo upload")
# POST /api/timelines: autosaves are frequent but each save may compress inline images (CPU/RAM).
timeline_save_rate_limiter = SimpleRateLimiter(
    max_requests=120, window_seconds=60, name="timeline save", env_var="TIMELINE_SAVE_RATE_LIMIT_PER_MINUTE",
)
# GET /api/timelines/{id} is reachable without login (shared links) — keep it generous but bounded.
shared_view_rate_limiter = SimpleRateLimiter(max_requests=60, window_seconds=60, name="timeline view")
media_search_rate_limiter = SimpleRateLimiter(
    max_requests=30, window_seconds=60, name="video search", byok_multiplier=False,
)
wiki_lookup_rate_limiter = SimpleRateLimiter(
    max_requests=60, window_seconds=60, name="Wikipedia lookup", byok_multiplier=False,
)
geocode_rate_limiter = SimpleRateLimiter(
    max_requests=20, window_seconds=60, name="location search", byok_multiplier=False,
)
# Free image engine (HF / Pollinations fetches + Pillow work on the server): never widened by BYOK.
free_image_rate_limiter = SimpleRateLimiter(
    max_requests=10, window_seconds=60, name="free image generation",
    env_var="FREE_IMAGE_RATE_LIMIT_PER_MINUTE", byok_multiplier=False,
)
# Finished-game reports are tiny, but bound them so a misbehaving client can't flood the activity log.
game_activity_rate_limiter = SimpleRateLimiter(max_requests=20, window_seconds=60, name="game activity")

# Process-wide Pillow decompression-bomb backstop (every decode site also checks dimensions first).
install_pillow_pixel_limit()

@asynccontextmanager
async def _app_lifespan(_app: FastAPI):
    """Startup: config warnings + event-loop lag sampler. Shutdown: drain and refund AI jobs (SC-03/SC-16)."""
    global _SERVER_DRAINING
    _SERVER_DRAINING = False
    log_spend_cap_startup_warnings()
    log_secret_salt_startup_warnings()
    sampler = asyncio.create_task(_event_loop_lag_sampler())
    await _start_book_import_runner()
    try:
        yield
    finally:
        sampler.cancel()
        await _stop_book_import_runner()
        await _drain_ai_jobs_on_shutdown()
        if _BACKGROUND_TASKS:
            # Write-behind work (game rounds, cache writes) gets a moment to land.
            await asyncio.wait(list(_BACKGROUND_TASKS), timeout=5.0)
        await http_clients.aclose_all()


app = FastAPI(
    title="ChroniX Backend",
    description="Interactive visual timeline generator using Gemini and Wikipedia/Wikidata",
    version="1.0.0",
    lifespan=_app_lifespan,
)

_STORAGE_UNAVAILABLE_DETAIL = "Timeline storage is temporarily unavailable. Please try again in a moment."
_TIMELINE_CONFLICT_DETAIL = "This timeline was changed elsewhere. Please reload it and try again."
_TIMELINE_STALE_DETAIL = "This timeline was changed elsewhere since you opened it."
_TIMELINE_GONE_DETAIL = "This timeline was deleted."


@app.exception_handler(StorageUnavailableError)
async def _storage_unavailable_handler(request: Request, exc: StorageUnavailableError):
    # A failed ownership/meta lookup must never be read as "not found" or "new timeline".
    return JSONResponse(status_code=503, content={"detail": _STORAGE_UNAVAILABLE_DETAIL})


@app.exception_handler(UsageStoreUnavailable)
async def _usage_store_unavailable_handler(request: Request, exc: UsageStoreUnavailable):
    # Fail-closed quota store (SC-09): a counter that can't be reserved must never be skipped.
    return JSONResponse(
        status_code=503,
        content={"detail": QUOTA_STORE_UNAVAILABLE_DETAIL},
        headers={"Retry-After": str(QUOTA_STORE_RETRY_AFTER_SECONDS)},
    )


@app.exception_handler(TimelineConflictError)
async def _timeline_conflict_handler(request: Request, exc: TimelineConflictError):
    return JSONResponse(status_code=409, content={"detail": _TIMELINE_CONFLICT_DETAIL})


def _stale_write_response(exc: TimelineStaleWriteError) -> JSONResponse:
    """409 for a save whose base version is out of date (B-04): the client re-reads and merges."""
    return JSONResponse(
        status_code=409,
        content={
            "detail": _TIMELINE_STALE_DETAIL,
            "code": "stale_write",
            "current_updated_at": getattr(exc, "current_updated_at", None),
        },
    )


@app.exception_handler(TimelineStaleWriteError)
async def _timeline_stale_write_handler(request: Request, exc: TimelineStaleWriteError):
    return _stale_write_response(exc)


@app.exception_handler(TimelineGoneError)
async def _timeline_gone_handler(request: Request, exc: TimelineGoneError):
    # A soft-deleted row is never resurrected by a save (B-04).
    return JSONResponse(status_code=410, content={"detail": _TIMELINE_GONE_DETAIL, "code": "timeline_deleted"})


@app.exception_handler(EmptyTimelineError)
async def _empty_timeline_handler(request: Request, exc: EmptyTimelineError):
    # B-18: an empty save used to be skipped with a 200, so the client believed it was stored.
    return JSONResponse(status_code=422, content={"detail": str(exc), "code": EmptyTimelineError.code})


# Pure-ASGI gzip, registered before CORS so CORS stays the outer layer. Starlette skips audio/*,
# images, event streams, 206 partial responses and anything that already has Content-Encoding,
# and compresses streaming bodies chunk by chunk (no buffering).
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


def _cors_middleware_kwargs() -> Dict[str, Any]:
    """
    CORS policy (S-05). `CORS_ORIGINS` is a comma-separated allow-list; `CORS_ORIGIN_REGEX` adds
    e.g. preview deployments. Unset in production (APP_ENV=production or Render) fails closed:
    no cross-origin browser access, unless `ALLOW_ANY_CORS_ORIGIN=true` explicitly allows `*`.
    Outside production an unset list stays `*` for local / LAN development.
    """
    production = is_production_environment()
    origins = [
        o.strip().rstrip("/") for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()
    ]
    origin_regex = os.getenv("CORS_ORIGIN_REGEX", "").strip() or None
    if "*" in origins:
        origins = ["*"]
        if production:
            logger.warning("CORS_ORIGINS='*' in production: any website can call this API from its visitors' browsers.")
    elif not origins:
        if not production or _env_flag("ALLOW_ANY_CORS_ORIGIN"):
            origins = ["*"]
        elif not origin_regex:
            logger.critical(
                "CORS_ORIGINS is not set in production: browsers will refuse every cross-origin call "
                "to this API. Set CORS_ORIGINS to the frontend origin(s), e.g. https://chronix.example.com "
                "(or ALLOW_ANY_CORS_ORIGIN=true to knowingly allow any origin)."
            )
    allow_any = origins == ["*"]
    return {
        "allow_origins": origins,
        "allow_origin_regex": origin_regex,
        "allow_credentials": not allow_any and bool(origins or origin_regex),
        "allow_methods": ["*"],
        "allow_headers": ["*"],
        # Lets cross-origin frontends read which key tier served an AI request (fast vs basic mode),
        # and Retry-After on 503 (draining) / 429 job-start refusals.
        "expose_headers": [AI_TIER_HEADER, "Retry-After"],
        # Lets browsers cache preflights (every authenticated call has one) for 2 hours (P-08).
        "max_age": 7200,
    }

MAX_JSON_BODY_BYTES = 16 * 1024 * 1024   # 16 MB cap for JSON routes
MAX_UPLOAD_BODY_BYTES = 35 * 1024 * 1024 # 35 MB cap for multipart upload routes
_UPLOAD_ROUTE_PREFIXES = (
    "/api/timeline/generate-from-files",
    "/api/timeline/chat/attach-files",
)


_BOOK_IMPORT_LOCAL_UPLOAD_PREFIX = "/api/book-import-uploads/"


def _book_import_local_upload_max_bytes() -> int:
    from services.book_import.config import get_config as _book_cfg

    return _book_cfg().max_file_mb * 1024 * 1024


def _payload_too_large_detail(max_bytes: int) -> str:
    return f"Request payload exceeds maximum allowed size ({max_bytes // (1024 * 1024)} MB)."


class _BodyTooLargeError(HTTPException):
    """Raised from the bounded `receive` once a body (chunked or lying about its length) overflows.
    An HTTPException so FastAPI's body parsing re-raises it as a 413 instead of a generic 400."""

    def __init__(self, max_bytes: int):
        super().__init__(status_code=413, detail=_payload_too_large_detail(max_bytes))


def _is_upload_route(path: str) -> bool:
    return any(path.startswith(p) for p in _UPLOAD_ROUTE_PREFIXES)


async def _send_json(send, status_code: int, payload: Dict[str, Any], headers: Optional[List[Tuple[bytes, bytes]]] = None) -> None:
    body = json.dumps(payload).encode("utf-8")
    await send({
        "type": "http.response.start",
        "status": status_code,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode("ascii")),
            *(headers or []),
        ],
    })
    await send({"type": "http.response.body", "body": body})


_AI_TIER_HEADER_RAW = AI_TIER_HEADER.lower().encode("latin-1")


class AITierHeaderMiddleware:
    """
    Pure ASGI (SC-02): reports which key tier served this request's AI work (custom / admin_paid /
    paid / unlimited / free) in `AI_TIER_HEADER`, so the client can tell the user on the spot that
    it switched to basic mode. The ContextVar holder is set here and filled in by the route.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        holder = begin_request_ai_tier_tracking()

        async def send_with_tier(message):
            if message.get("type") == "http.response.start":
                tier = holder.get("tier")
                if tier:
                    headers = [(k, v) for k, v in (message.get("headers") or []) if k.lower() != _AI_TIER_HEADER_RAW]
                    headers.append((_AI_TIER_HEADER_RAW, str(tier).encode("latin-1")))
                    message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_tier)


# --- Upload admission (SC-06) ------------------------------------------------------------------
# Every upload request holds a slot from the moment it is admitted (before its body is read) until
# the request ends, or, for the job routes, until the background job that took the slot over ends.
_UPLOAD_SLOTS_IN_USE = 0
_UPLOAD_ADMISSION_RETRY_AFTER = "10"


def _max_concurrent_upload_jobs() -> int:
    raw = os.getenv("MAX_CONCURRENT_UPLOAD_JOBS", "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return 3


class _UploadSlot:
    """One admitted upload. `held_by_job` hands its release over to the job it started."""

    def __init__(self) -> None:
        global _UPLOAD_SLOTS_IN_USE
        _UPLOAD_SLOTS_IN_USE += 1
        self.held_by_job = False
        self._released = False
        # Validated uploads (spooled temp files) live exactly as long as the slot.
        self.uploads: List[Any] = []

    def release(self) -> None:
        global _UPLOAD_SLOTS_IN_USE
        if self._released:
            return
        self._released = True
        _UPLOAD_SLOTS_IN_USE = max(0, _UPLOAD_SLOTS_IN_USE - 1)
        for uploads in self.uploads:
            close = getattr(uploads, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass
        self.uploads.clear()


def _attach_uploads_to_slot(request: Optional[Request], uploads: Any) -> Any:
    """Ties validated uploads' temp files to the request's upload slot (closed when it is released)."""
    slot = (request.scope.get("state") or {}).get("upload_slot") if request is not None else None
    if isinstance(slot, _UploadSlot):
        slot.uploads.append(uploads)
    return uploads


def _take_over_upload_slot(request: Optional[Request]) -> Optional[_UploadSlot]:
    """Called by a job route once its job exists: the job (not the request) now releases the slot."""
    if request is None:
        return None
    slot = (request.scope.get("state") or {}).get("upload_slot")
    if isinstance(slot, _UploadSlot):
        slot.held_by_job = True
        return slot
    return None


def _upload_auth_precheck_enabled(scope) -> bool:
    # Tests (and only tests) replace the auth dependency; the pre-check mirrors it, so it steps aside.
    overrides = getattr(scope.get("app"), "dependency_overrides", None) or {}
    return get_current_user_required not in overrides and get_current_user_optional not in overrides


class RequestBodyLimitMiddleware:
    """
    Pure ASGI (SC-02) body-size cap: 413 from Content-Length up front, and from the running byte
    count for chunked bodies or bodies longer than they claimed. Upload routes (SC-06) additionally
    get, before their multipart body is parsed: a cheap Authorization check (401) and the
    per-instance upload concurrency cap (503 + Retry-After).
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path") or ""
        is_upload = _is_upload_route(path)
        max_bytes = MAX_UPLOAD_BODY_BYTES if is_upload else MAX_JSON_BODY_BYTES
        if path.startswith(_BOOK_IMPORT_LOCAL_UPLOAD_PREFIX):
            # Local-storage book uploads (dev only): signed per-file URLs, capped by the book-import file limit.
            max_bytes = _book_import_local_upload_max_bytes()
        headers = Headers(scope=scope)
        content_length = headers.get("content-length")
        if content_length:
            try:
                declared = int(content_length)
            except ValueError:
                await _send_json(send, status.HTTP_400_BAD_REQUEST, {"detail": "Invalid Content-Length header."})
                return
            if declared > max_bytes:
                await _send_json(send, 413, {"detail": _payload_too_large_detail(max_bytes)})
                return

        slot: Optional[_UploadSlot] = None
        if is_upload and scope.get("method") == "POST":
            if _upload_auth_precheck_enabled(scope) and not authorization_header_plausible(headers.get("authorization")):
                await _send_json(send, status.HTTP_401_UNAUTHORIZED, {"detail": "Authentication required. Please sign in."})
                return
            cap = _max_concurrent_upload_jobs()
            if cap > 0 and _UPLOAD_SLOTS_IN_USE >= cap:
                logger.warning(f"Upload admission refused: {_UPLOAD_SLOTS_IN_USE}/{cap} upload jobs in flight.")
                await _send_json(
                    send, status.HTTP_503_SERVICE_UNAVAILABLE,
                    {"detail": "The server is processing many uploads right now. Please try again in a few seconds."},
                    headers=[(b"retry-after", _UPLOAD_ADMISSION_RETRY_AFTER.encode("ascii"))],
                )
                return
            slot = _UploadSlot()
            scope.setdefault("state", {})["upload_slot"] = slot

        received = 0
        response_started = False

        async def bounded_receive():
            nonlocal received
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body", b"") or b"")
                if received > max_bytes:
                    raise _BodyTooLargeError(max_bytes)
            return message

        async def guarded_send(message):
            nonlocal response_started
            if message.get("type") == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, bounded_receive, guarded_send)
        except _BodyTooLargeError:
            if response_started:
                raise
            await _send_json(send, 413, {"detail": _payload_too_large_detail(max_bytes)})
        finally:
            if slot is not None and not slot.held_by_job:
                slot.release()


app.add_middleware(AITierHeaderMiddleware)
app.add_middleware(RequestBodyLimitMiddleware)


_API_SECURITY_HEADERS = (
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
)


class SecurityHeadersMiddleware:
    """
    Pure ASGI (S-08): adds nosniff / no framing / no referrer to every API response without
    buffering streamed bodies (podcast audio, ranges). Headers a route already set are kept.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message.get("type") == "http.response.start":
                headers = list(message.get("headers") or [])
                present = {name.lower() for name, _ in headers}
                headers.extend((k, v) for k, v in _API_SECURITY_HEADERS if k not in present)
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


app.add_middleware(SecurityHeadersMiddleware)


# Registered last so CORS is the OUTERMOST middleware: responses produced by the middlewares above
# (e.g. the 413 body-size rejection) still carry CORS headers, so the browser sees the real status
# instead of a CORS error (SC-16).
app.add_middleware(CORSMiddleware, **_cors_middleware_kwargs())


# --- Health / event-loop lag (SC-16) ----------------------------------------------------
_LOOP_LAG_SAMPLE_SECONDS = 1.0
_LOOP_HEALTH: Dict[str, Optional[float]] = {"lag_seconds": None, "last_tick": None}
# The loop the sampler runs on: a tick recorded by another loop (an earlier test client, a stopped
# lifespan) says nothing about this one.
_LOOP_SAMPLER_OWNER: Dict[str, Any] = {"loop": None}
_SERVER_DRAINING = False


def _health_max_loop_lag_seconds() -> float:
    raw = os.getenv("HEALTH_MAX_LOOP_LAG_SECONDS", "").strip()
    if raw:
        try:
            return float(raw)
        except ValueError:
            pass
    return 5.0


async def _event_loop_lag_sampler() -> None:
    """Measures how late a 1 s sleep wakes up; also runs the throttled AI-job cleanup and the
    text-job queue timeouts (SC-07) when idle."""
    loop = asyncio.get_running_loop()
    _LOOP_SAMPLER_OWNER["loop"] = loop
    # Started now: until the first tick lands, the loop is not "overdue".
    _LOOP_HEALTH["lag_seconds"] = 0.0
    _LOOP_HEALTH["last_tick"] = loop.time()
    try:
        while True:
            started = loop.time()
            await asyncio.sleep(_LOOP_LAG_SAMPLE_SECONDS)
            now = loop.time()
            _LOOP_HEALTH["lag_seconds"] = max(0.0, now - started - _LOOP_LAG_SAMPLE_SECONDS)
            _LOOP_HEALTH["last_tick"] = now
            try:
                _maybe_cleanup_ai_jobs()
                _expire_queued_text_jobs()
                if _TEXT_JOB_QUEUE:
                    _dispatch_queued_text_jobs()  # e.g. the budget was raised: never strand the queue
            except Exception as e:
                logger.warning(f"AI job cleanup failed: {e}")
    finally:
        if _LOOP_SAMPLER_OWNER.get("loop") is loop:
            _LOOP_SAMPLER_OWNER["loop"] = None
            _LOOP_HEALTH["last_tick"] = None


def _current_event_loop_lag() -> Optional[float]:
    last_tick = _LOOP_HEALTH.get("last_tick")
    if last_tick is None:
        return None
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None
    if _LOOP_SAMPLER_OWNER.get("loop") is not loop:
        # No sampler on this loop (not started yet, or a stale tick from another loop): healthy.
        return None
    # A sampler that hasn't ticked for a while means the loop itself is (or was just) blocked.
    overdue = loop.time() - last_tick - _LOOP_LAG_SAMPLE_SECONDS
    return max(_LOOP_HEALTH.get("lag_seconds") or 0.0, overdue, 0.0)


def _current_rss_mb() -> Optional[float]:
    """Resident memory from /proc (Linux, e.g. Render); None where unavailable."""
    try:
        with open("/proc/self/statm", "rb") as f:
            resident_pages = int(f.read().split()[1])
        return round(resident_pages * os.sysconf("SC_PAGE_SIZE") / (1024 * 1024), 1)
    except Exception:
        return None


@app.get("/api/health")
async def health_check():
    has_api_key = bool(os.getenv("GEMINI_API_KEY"))
    lag = _current_event_loop_lag()
    max_lag = _health_max_loop_lag_seconds()
    lagging = bool(lag is not None and max_lag > 0 and lag > max_lag)
    pending = sum(1 for job in _AI_JOBS.values() if job.get("status") == "pending")
    if _SERVER_DRAINING:
        status_val, message = "draining", "ChroniX API is shutting down"
    elif lagging:
        status_val, message = "degraded", "ChroniX API is overloaded"
    else:
        status_val, message = "ok", "ChroniX API is running"
    payload = {
        "status": status_val,
        "has_server_gemini_key": has_api_key,
        "message": message,
        "draining": _SERVER_DRAINING,
        "pending_jobs": pending,
        "finished_jobs": len(_AI_JOBS) - pending,
        "event_loop_lag_ms": int(lag * 1000) if lag is not None else None,
        "rss_mb": _current_rss_mb(),
    }
    if status_val != "ok":
        return JSONResponse(status_code=503, content=payload, headers={"Retry-After": "15"})
    return payload

@app.get("/api/user/quota")
async def get_current_user_quota(
    request: Request,
    response: Response,
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional)
):
    """
    Get current user's daily prompt quota status.
    Supports both authenticated users and anonymous/guest visitors.
    Marked no-store so mobile browsers never serve a stale cached count.
    """
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    info = await run_quota(get_user_quota_info, user, get_client_ip(request))
    info["entitlements"] = entitlements_summary(get_entitlements(user, request.headers.get("X-Gemini-Api-Key")))
    return info

@app.get("/api/guest-policy")
async def get_guest_policy():
    """
    Public, no-auth endpoint exposing the CURRENT guest quota policy (GUEST_API_KEY_MODE
    and its configured limits) and registered user quota policy so the pre-login screen can
    render accurate copy before any guest session/user object exists.
    """
    mode = get_guest_api_key_mode()
    reg_mode = get_api_key_mode()
    guest_limit = get_guest_daily_limit() if mode == "limited" else -1
    reg_limit = get_registered_daily_limit() if reg_mode == "limited" else -1
    return {
        "mode": mode,
        "daily_paid_limit": guest_limit,
        "guest_mode": mode,
        "guest_daily_limit": guest_limit,
        "registered_mode": reg_mode,
        "registered_daily_limit": reg_limit,
        "credit_costs": get_credit_costs(),
    }

def _should_suggest_byok(error: Exception) -> bool:
    # Structured classification only: our own wrapper text and user prompts must not influence this.
    return classify_ai_error(error) in BYOK_SUGGESTION_KINDS

def format_api_error_for_user(error: Exception, user: Optional[Dict[str, Any]] = None) -> str:
    err_msg = str(error)
    if is_admin_user(user):
        return err_msg
    if _should_suggest_byok(error):
        if is_guest_user(user):
            return (
                "The guest AI service is temporarily at capacity (all shared keys, including backups, reached their limits). "
                "Sign in to access the standard high-speed AI tier, or add a personal Gemini API key in Settings (a paid key is recommended for reliable access)."
            )
        return (
            "The shared AI service is temporarily at capacity (high demand or quota limits across all shared keys, including backups). "
            "For reliable, uninterrupted access, we recommend adding a paid personal Gemini API key in Settings (a free key can help somewhat, though free-tier limits still apply), or try again shortly."
        )
    return err_msg

async def run_with_key_failover(
    operation,
    api_key: Optional[str],
    key_tier: str,
    label: str = "AI request",
    failover_to_free: bool = True,
):
    """
    Runs `operation(key)` (an async callable taking one api_key arg), rotating across
    available keys when a quota, rate-limit, or billing exhaustion error is hit.
    - Paid tier and server-key requests attempt the paid key first, automatically falling
      back to candidate free keys if billing budget or quota is depleted.
    - Free tier requests rotate across healthy candidate free keys.
    - Custom BYOK requests use the user's personal key.
    - `failover_to_free=False` (charged premium features): only `api_key` is tried.
    Exhausted keys are put on cooldown so subsequent requests don't waste time on them.
    A custom key is marked verified (S-04, unlocking the unlimited tier) only when a Gemini client
    built from that key actually returned a response during the operation.
    """
    if key_tier == "custom" and api_key:
        with observe_gemini_successes() as served_by:
            try:
                result = await operation(api_key)
            except Exception as e:
                if classify_ai_error(e) == AiErrorKind.INVALID_KEY:
                    forget_custom_key(api_key)
                raise
        if byok_key_fingerprint(api_key) in served_by:
            mark_custom_key_verified(api_key)
        return result

    if key_tier == "custom" or not failover_to_free:
        keys_to_try = [api_key] if api_key else [None]
    else:
        # For free, paid, admin_paid: get full candidate chain including free fallbacks
        keys_to_try = get_candidate_keys_for_request(api_key)

    if not keys_to_try:
        keys_to_try = [api_key]

    last_error = None
    server_paid_key = os.getenv("GEMINI_API_KEY", "").strip()

    for current_key in keys_to_try:
        try:
            return await operation(current_key)
        except InsufficientSubjectInfoError:
            # Honest "unknown subject" verdict, not a key problem: never rotate keys/regenerate.
            raise
        except Exception as e:
            last_error = e
            if not current_key or key_tier == "custom":
                raise
            kind = classify_ai_error(e)
            is_paid_key = bool(server_paid_key) and current_key == server_paid_key
            if kind == AiErrorKind.INVALID_KEY and not (is_paid_key or current_key in get_all_free_keys()):
                raise
            cooldown = key_cooldown_seconds(kind, e, is_paid_key=is_paid_key)
            if cooldown is None:
                # Transient (5xx/timeouts, already retried inside gemini_service) and unrelated errors
                # never bench a key: doing so would push every user off the paid key for minutes.
                raise
            mark_key_exhausted(current_key, cooldown_seconds=cooldown)
            if current_key == keys_to_try[-1]:
                raise
            record_key_rotation()
            if is_paid_key:
                logger.warning(
                    f"Paid Gemini key unavailable ({kind.value}) during {label}; "
                    f"falling back to candidate free key for {cooldown:.0f}s..."
                )
            else:
                logger.warning(f"Gemini key unavailable ({kind.value}) during {label}, rotating to next candidate free key...")
            continue
    if last_error:
        raise last_error
    raise Exception(f"Failed to complete {label}")


# --- Background AI jobs ---------------------------------------------------------
# AI calls (generate / refine / chat) can take a while, and a single long-lived
# HTTP request is killed when a mobile browser backgrounds the tab (causing the
# client to stall forever). Instead we run them as background tasks and let the
# client poll for the result, which survives the connection being dropped and
# resumed. Safe as an in-memory store because the app runs as a single uvicorn worker.
_AI_JOBS: Dict[str, Dict[str, Any]] = {}
_JOB_TTL_SECONDS = 300  # keep finished jobs available for 5 minutes
_PENDING_JOB_TTL_SECONDS = 900
_DELIVERED_JOB_TTL_SECONDS = 30  # evict already-delivered results quickly after client poll
# Finished results are bounded by approximate size (SC-03); the count ceiling is only a safety net.
_MAX_FINISHED_AI_JOBS = 1000
_MAX_FINISHED_AI_JOBS_PER_USER = 6
_DEFAULT_MAX_FINISHED_AI_JOB_BYTES = 64 * 1024 * 1024
# Undelivered results this young survive count-based eviction; only the byte cap can evict them.
_UNDELIVERED_JOB_GRACE_SECONDS = 60
_AI_JOBS_CLEANUP_INTERVAL_SECONDS = 3.0
_ai_jobs_last_cleanup = 0.0
_CANCEL_REFUND_WINDOW_SECONDS = 600  # 10 minutes
_MAX_CANCEL_REFUNDS_PER_WINDOW = 2
_CANCEL_REFUND_HISTORY: Dict[str, List[float]] = defaultdict(list)
# How long a cancel that lands mid-save waits for the save to finish before answering (B-16).
_CANCEL_WAIT_FOR_PERSIST_SECONDS = 20.0


def _is_ai_job_expired(job: Dict[str, Any], now: float) -> bool:
    if job.get("status") == "pending":
        return now - job.get("updated", now) > _PENDING_JOB_TTL_SECONDS
    delivered_at = job.get("delivered_at")
    if delivered_at is not None and (now - delivered_at) > _DELIVERED_JOB_TTL_SECONDS:
        return True
    return now - job.get("updated", now) > _JOB_TTL_SECONDS


def _max_finished_ai_job_bytes() -> int:
    raw = os.getenv("AI_JOBS_MAX_FINISHED_BYTES", "").strip()
    if raw:
        try:
            return max(1, int(raw))
        except ValueError:
            pass
    return _DEFAULT_MAX_FINISHED_AI_JOB_BYTES


def _estimate_result_bytes(result: Any) -> int:
    """Approximate in-memory weight of a finished result (its JSON length), computed once."""
    if result is None:
        return 0
    try:
        return len(json.dumps(result, ensure_ascii=False, default=str))
    except Exception:
        return 0


_APPROX_RESULT_NODE_BUDGET = 100_000


def _approx_result_bytes(result: Any, node_budget: int = _APPROX_RESULT_NODE_BUDGET) -> Optional[int]:
    """
    Approximate JSON length of a result without serializing it (P-11: `json.dumps` of a 12 MB
    result costs ~34 ms of event loop). Cost grows with the number of values, not their size, so
    multi-MB inline images stay cheap. Returns None past `node_budget` values.
    """
    total = 0
    nodes = 0
    stack = [result]
    while stack:
        value = stack.pop()
        nodes += 1
        if nodes > node_budget:
            return None
        if isinstance(value, str):
            total += len(value) + 2
        elif isinstance(value, dict):
            total += 2
            for key, item in value.items():
                total += len(str(key)) + 4
                stack.append(item)
        elif isinstance(value, (list, tuple)):
            total += 2 + len(value)
            stack.extend(value)
        elif value is None or isinstance(value, bool):
            total += 5
        elif isinstance(value, (int, float)):
            total += 8
        else:
            total += len(str(value)) + 2
    return total


def _cleanup_ai_jobs() -> None:
    global _ai_jobs_last_cleanup
    now = time.time()
    _ai_jobs_last_cleanup = now
    stale = [jid for jid, job in _AI_JOBS.items() if _is_ai_job_expired(job, now)]
    for jid in stale:
        _AI_JOBS.pop(jid, None)

    # 1. Bound finished jobs per user (evicting delivered before undelivered, oldest first)
    by_user: Dict[str, List[tuple]] = defaultdict(list)
    for jid, job in _AI_JOBS.items():
        if job.get("status") != "pending":
            uid = str(job.get("user_id") or "_anon_")
            delivered_rank = 0 if job.get("delivered_at") is not None else 1
            by_user[uid].append((delivered_rank, job.get("updated", 0.0), jid))
    for uid, entries in by_user.items():
        if len(entries) > _MAX_FINISHED_AI_JOBS_PER_USER:
            entries.sort()
            for _, _, jid in entries[: len(entries) - _MAX_FINISHED_AI_JOBS_PER_USER]:
                _AI_JOBS.pop(jid, None)

    # 2. Bound finished results globally by approximate bytes (and a high count ceiling).
    #    Order: delivered first, then oldest. Undelivered results younger than the grace period
    #    are only evicted when the byte cap itself is exceeded.
    finished = sorted(
        (0 if job.get("delivered_at") is not None else 1, job.get("updated", 0.0), jid)
        for jid, job in _AI_JOBS.items()
        if job.get("status") != "pending"
    )
    max_bytes = _max_finished_ai_job_bytes()
    total_bytes = sum(int(_AI_JOBS[jid].get("result_bytes") or 0) for _, _, jid in finished)
    count = len(finished)
    for undelivered, updated, jid in finished:
        over_bytes = total_bytes > max_bytes
        if not over_bytes and count <= _MAX_FINISHED_AI_JOBS:
            break
        if not over_bytes and undelivered and (now - updated) < _UNDELIVERED_JOB_GRACE_SECONDS:
            continue
        job = _AI_JOBS.pop(jid, None)
        if job is None:
            continue
        total_bytes -= int(job.get("result_bytes") or 0)
        count -= 1
        if undelivered:
            logger.warning(f"Evicted undelivered AI job result {jid} (finished results over the memory cap).")


def _maybe_cleanup_ai_jobs() -> None:
    """Cleanup is O(jobs); run it at most every few seconds instead of on every poll."""
    if time.time() - _ai_jobs_last_cleanup >= _AI_JOBS_CLEANUP_INTERVAL_SECONDS:
        _cleanup_ai_jobs()


def _max_concurrent_jobs_per_client() -> int:
    raw = os.getenv("MAX_CONCURRENT_JOBS_PER_USER", "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return 2


def _max_concurrent_jobs_per_ip() -> int:
    raw = os.getenv("MAX_CONCURRENT_JOBS_PER_IP", "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return 12


def _ensure_accepting_new_jobs() -> None:
    """New background jobs are refused while the process drains for shutdown (SC-16)."""
    if _SERVER_DRAINING:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The server is restarting. Please try again in a few seconds.",
            headers={"Retry-After": "15"},
        )


def _enforce_concurrent_job_limit(
    user: Optional[Dict[str, Any]], client_ip: Optional[str], text_budget: bool = True
) -> None:
    """
    Prevents a single client/account from queuing unbounded concurrent background AI jobs
    (which would pin large upload buffers in RAM or bypass per-request quotas during flight).
    Counted per user id (anonymous guests have stable ids), so guests sharing a school or
    carrier NAT each get their own allowance; a much higher per-IP ceiling across all
    non-admin users still stops floods from one network (SC-12). Also refuses new jobs while draining,
    and (text jobs) once the per-instance queue is full (SC-07), before anything is charged.
    """
    _ensure_accepting_new_jobs()
    if text_budget:
        _ensure_text_job_capacity(user)
    if user and is_admin_user(user):
        return
    max_concurrent = _max_concurrent_jobs_per_client()
    max_per_ip = _max_concurrent_jobs_per_ip()
    if max_concurrent <= 0 and max_per_ip <= 0:
        return
    _maybe_cleanup_ai_jobs()
    uid = user.get("id") if isinstance(user, dict) else None
    norm_ip = normalize_client_ip(client_ip)
    has_ip = bool(norm_ip and norm_ip != "unknown")
    active_for_caller = 0
    active_on_ip = 0
    for job in _AI_JOBS.values():
        if job.get("status") != "pending":
            continue
        same_ip = has_ip and normalize_client_ip(job.get("client_ip")) == norm_ip
        if uid:
            if job.get("user_id") == uid:
                active_for_caller += 1
        elif same_ip:
            # No user id at all: the IP is the only identity we have.
            active_for_caller += 1
        if same_ip and not is_admin_user(job.get("user")):
            active_on_ip += 1
    if max_concurrent > 0 and active_for_caller >= max_concurrent:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many generations are already running. Please wait for the current one to finish or cancel it.",
        )
    if max_per_ip > 0 and active_on_ip >= max_per_ip:
        logger.warning(f"Per-IP concurrent job ceiling reached ({active_on_ip}/{max_per_ip}).")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many generations are running from your network right now. Please try again in a moment.",
            headers={"Retry-After": "10"},
        )


def _create_ai_job(
    user: Dict[str, Any],
    client_ip: Optional[str] = None,
    rate_limit_identifier: Optional[str] = None,
    incremented_quota: bool = False,
    pool_reserved: bool = False,
    quota_credits: Optional[int] = None,
    timeline_id: Optional[str] = None,
) -> str:
    _maybe_cleanup_ai_jobs()
    job_id = uuid.uuid4().hex
    _AI_JOBS[job_id] = {
        "status": "pending",
        "user_id": user.get("id"),
        "user": user,
        "client_ip": client_ip,
        "rate_limit_identifier": rate_limit_identifier,
        "incremented_quota": incremented_quota,
        "quota_credits": max(1, int(quota_credits if quota_credits is not None else get_text_credit_cost())),
        # True only when resolve_gemini_key actually reserved a Community Pool slot for this job.
        "pool_reserved": pool_reserved,
        "can_refund_on_cancel": True,
        "task": None,
        "updated": time.time(),
        # Lets the client open the saved timeline if the result itself is lost (B-03/SC-03).
        "timeline_id": timeline_id or None,
        "persisted": False,
    }
    return job_id


# The job a background task is running for, so `_persist_timeline_dict` can record on it that the
# timeline was saved. Set inside `_run_ai_job`'s own task, so it never leaks into other requests.
_current_ai_job_id: ContextVar[Optional[str]] = ContextVar("chronix_current_ai_job_id", default=None)


def _note_job_phase(phase: str) -> None:
    """Records how far the running job got: 'persisting' / 'persisted' (B-16, see cancel_ai_job)."""
    job_id = _current_ai_job_id.get()
    job = _AI_JOBS.get(job_id) if job_id else None
    if job is not None:
        job["phase"] = phase


def _note_job_timeline_persisted(timeline_id: Optional[str]) -> None:
    job_id = _current_ai_job_id.get()
    job = _AI_JOBS.get(job_id) if job_id else None
    if job is not None and timeline_id:
        job["timeline_id"] = str(timeline_id)
        job["persisted"] = True
        job.pop("conflict", None)
        _notify_ai_job(job)


def _note_job_timeline_conflict(timeline_id: Optional[str]) -> None:
    """The job's AI result was NOT saved because the timeline changed meanwhile (B-04)."""
    job_id = _current_ai_job_id.get()
    job = _AI_JOBS.get(job_id) if job_id else None
    if job is not None and timeline_id:
        job["timeline_id"] = str(timeline_id)
        job["persisted"] = False
        job["conflict"] = True


def _job_timeline_fields(job: Dict[str, Any]) -> Dict[str, Any]:
    """`timeline_id` + `persisted` (+ `conflict`) for status payloads, once the job's timeline id is known."""
    timeline_id = job.get("timeline_id")
    if not timeline_id:
        return {}
    fields = {"timeline_id": timeline_id, "persisted": bool(job.get("persisted"))}
    if job.get("conflict"):
        fields["conflict"] = True
    return fields


# --- Long-poll wake-ups (SC-02) ------------------------------------------------------------------
# A status poll may wait (`?wait=`) on the job's "changed" event; every status change, new partial
# revision and queue move swaps in a fresh event and sets the old one, so no wake-up is lost.

def _notify_ai_job(job: Optional[Dict[str, Any]]) -> None:
    if not job:
        return
    event = job.pop("changed", None)
    if event is not None:
        event.set()


def _ai_job_changed_event(job: Dict[str, Any]) -> asyncio.Event:
    event = job.get("changed")
    if event is None:
        event = asyncio.Event()
        job["changed"] = event
    return event


# --- Per-instance text-job budget and queue (SC-07) and server deadline (SC-19) ------------------
_TEXT_JOB_QUEUE: "deque[str]" = deque()
_TEXT_JOBS_RUNNING: set = set()
_QUEUE_FULL_RETRY_AFTER = "20"
_SERVER_TIMEOUT_CODE = "server_timeout"
_QUEUE_TIMEOUT_DETAIL = (
    "The server is very busy, so this request didn't start in time. Your credits were refunded. Please try again."
)
_DEADLINE_DETAIL = (
    "This took longer than the server allows, so it was stopped. Please try again in a moment."
)
_DEADLINE_REFUNDED_DETAIL = (
    "This took longer than the server allows, so it was stopped and your credits were refunded. Please try again."
)
# After the model has answered (no refund any more), enrichment and the save get this much longer.
_POST_MODEL_DEADLINE_GRACE_SECONDS = 60.0


def _env_seconds(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if raw:
        try:
            return max(0.0, float(raw))
        except ValueError:
            pass
    return default


def _env_count(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if raw:
        try:
            return max(0, int(raw))
        except ValueError:
            pass
    return default


def _max_concurrent_text_jobs() -> int:
    """0 disables the budget (no queueing)."""
    return _env_count("MAX_CONCURRENT_TEXT_JOBS", 80)


def _max_queued_text_jobs() -> int:
    return _env_count("MAX_QUEUED_TEXT_JOBS", 200)


def _text_job_queue_timeout_seconds() -> float:
    return _env_seconds("AI_JOB_QUEUE_TIMEOUT_SECONDS", 180.0)


def _ai_job_server_deadline_seconds() -> float:
    """0 disables the deadline."""
    return _env_seconds("AI_JOB_SERVER_DEADLINE_SECONDS", 240.0)


def _live_queued_job_ids() -> List[str]:
    """Queue order, dropping entries that were cancelled, expired or already started."""
    live = [
        jid for jid in _TEXT_JOB_QUEUE
        if (_AI_JOBS.get(jid) or {}).get("queued") and _AI_JOBS[jid].get("status") == "pending"
    ]
    if len(live) != len(_TEXT_JOB_QUEUE):
        _TEXT_JOB_QUEUE.clear()
        _TEXT_JOB_QUEUE.extend(live)
    return live


def _text_job_queue_position(job_id: str) -> int:
    """1-based place in line, 0 when the job is not queued."""
    try:
        return list(_TEXT_JOB_QUEUE).index(job_id) + 1
    except ValueError:
        return 0


def _text_job_budget_full() -> bool:
    limit = _max_concurrent_text_jobs()
    return limit > 0 and (len(_TEXT_JOBS_RUNNING) >= limit or bool(_live_queued_job_ids()))


def _ensure_text_job_capacity(user: Optional[Dict[str, Any]]) -> None:
    """Refuses a new text job (before anything is charged) once the queue itself is full. Admins
    bypass the queue; BYOK callers share the instance's capacity like everyone else."""
    if user and is_admin_user(user):
        return
    if not _text_job_budget_full():
        return
    max_queued = _max_queued_text_jobs()
    if len(_live_queued_job_ids()) >= max_queued:
        logger.warning(f"Text-job queue full ({len(_TEXT_JOB_QUEUE)}/{max_queued}); refusing a new job.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The AI service is very busy right now. Please try again in a moment.",
            headers={"Retry-After": _QUEUE_FULL_RETRY_AFTER},
        )


def _launch_ai_job(
    job_id: str,
    operation: Callable[[], Awaitable[Any]],
    user: Dict[str, Any],
    label: str,
    budget: Optional[str] = "text",
    upload_slot: Optional["_UploadSlot"] = None,
) -> Dict[str, Any]:
    """
    Starts the job now, or (text budget full, caller not an admin) puts it in line as `queued`.
    Returns the start route's response body. Upload jobs carry their admission slot instead of
    using the text budget (they have their own, tighter cap).
    """
    job = _AI_JOBS[job_id]
    job["label"] = label
    if upload_slot is not None:
        job["upload_slot"] = upload_slot
    if budget != "text" or is_admin_user(user) or not _text_job_budget_full():
        _start_ai_job_task(job_id, operation, user, label, budgeted=(budget == "text"))
        return {"job_id": job_id, "status": "pending"}
    # The job runs later from another task: keep the starting request's context (client IP,
    # BYOK observations, ...) so it behaves exactly as if it had started right away.
    job.update(queued=True, queued_at=time.time(), queued_operation=operation, queued_context=contextvars.copy_context())
    _TEXT_JOB_QUEUE.append(job_id)
    position = _text_job_queue_position(job_id)
    logger.info(f"{label} job {job_id} queued at position {position} ({len(_TEXT_JOBS_RUNNING)} running).")
    return {"job_id": job_id, "status": "queued", "position": position, "ahead": max(0, position - 1)}


def _start_ai_job_task(
    job_id: str, operation: Callable[[], Awaitable[Any]], user: Dict[str, Any], label: str, budgeted: bool,
    context: Optional[contextvars.Context] = None,
) -> None:
    job = _AI_JOBS[job_id]
    job.pop("queued", None)
    job.pop("queued_operation", None)
    job.pop("queued_context", None)
    job["started_at"] = time.time()
    if budgeted:
        _TEXT_JOBS_RUNNING.add(job_id)
    task = asyncio.create_task(_run_ai_job(job_id, operation, user, label=label), context=context)
    job["task"] = task
    deadline = _ai_job_server_deadline_seconds()
    if deadline > 0:
        job["deadline_handle"] = asyncio.get_running_loop().call_later(deadline, _on_ai_job_deadline, job_id)
    task.add_done_callback(lambda _t, jid=job_id: _on_ai_job_task_done(jid))


def _on_ai_job_task_done(job_id: str) -> None:
    job = _AI_JOBS.get(job_id)
    if job is not None:
        handle = job.pop("deadline_handle", None)
        if handle is not None:
            handle.cancel()
        slot = job.pop("upload_slot", None)
        if slot is not None:
            slot.release()
        _notify_ai_job(job)
    if job_id in _TEXT_JOBS_RUNNING:
        _TEXT_JOBS_RUNNING.discard(job_id)
        _dispatch_queued_text_jobs()


def _dispatch_queued_text_jobs() -> int:
    """Starts queued jobs while the budget has room; every job still in line learns its new place."""
    started = 0
    limit = _max_concurrent_text_jobs()
    live = _live_queued_job_ids()
    while live and (limit <= 0 or len(_TEXT_JOBS_RUNNING) < limit):
        job_id = _TEXT_JOB_QUEUE.popleft()
        live.pop(0)
        job = _AI_JOBS.get(job_id)
        if job is None:
            continue
        operation = job.get("queued_operation")
        if operation is None:
            continue
        context = job.get("queued_context")
        _start_ai_job_task(
            job_id, operation, job.get("user") or {}, job.get("label") or "ai", budgeted=True,
            context=context.copy() if context is not None else None,
        )
        _notify_ai_job(job)
        started += 1
    if started:
        for jid in list(_TEXT_JOB_QUEUE):
            _notify_ai_job(_AI_JOBS.get(jid))
    return started


async def _refund_server_timeout(job: Dict[str, Any]) -> None:
    try:
        await run_quota(_refund_job_quota_and_limits, job, job.get("user") or {})
    except Exception as e:
        logger.warning(f"Server-timeout refund failed: {e}")


def _expire_queued_text_jobs(now: Optional[float] = None) -> int:
    """Jobs that waited in line past the queue timeout fail with `server_timeout` and are ALWAYS
    refunded: the delay was the server's, never the user's (SC-19)."""
    timeout = _text_job_queue_timeout_seconds()
    if timeout <= 0 or not _TEXT_JOB_QUEUE:
        return 0
    now = time.time() if now is None else now
    expired = 0
    for job_id in _live_queued_job_ids():
        job = _AI_JOBS[job_id]
        if now - float(job.get("queued_at") or now) < timeout:
            continue
        job.pop("queued", None)
        job.pop("queued_operation", None)
        job.pop("queued_context", None)
        job.update(
            status="error", status_code=503, code=_SERVER_TIMEOUT_CODE,
            detail=_QUEUE_TIMEOUT_DETAIL, updated=now,
        )
        _spawn_background(_refund_server_timeout(job), "queued job refund")
        _notify_ai_job(job)
        expired += 1
    if expired:
        _live_queued_job_ids()
        for jid in list(_TEXT_JOB_QUEUE):
            _notify_ai_job(_AI_JOBS.get(jid))
        logger.warning(f"{expired} queued AI job(s) timed out waiting for capacity (refunded).")
    return expired


def _on_ai_job_deadline(job_id: str, final: bool = False) -> None:
    """
    Server-side deadline (SC-19): a job still running this long is stopped with `server_timeout`.
    Before the model answered it is refunded (no cancel-refund cap applies); after that (B-16) the
    tokens are spent, so it gets a short grace for enrichment and the save, then stops unrefunded.
    A save already in progress is always allowed to finish.
    """
    job = _AI_JOBS.get(job_id)
    if job is None or job.get("status") != "pending":
        return
    job.pop("deadline_handle", None)
    loop = asyncio.get_running_loop()
    if job.get("phase") in ("persisting", "persisted"):
        return
    refundable = bool(job.get("can_refund_on_cancel", True))
    if not refundable and not final:
        job["deadline_handle"] = loop.call_later(
            _POST_MODEL_DEADLINE_GRACE_SECONDS, _on_ai_job_deadline, job_id, True
        )
        return
    now = time.time()
    job.update(
        status="error", status_code=504, code=_SERVER_TIMEOUT_CODE,
        detail=_DEADLINE_REFUNDED_DETAIL if refundable else _DEADLINE_DETAIL, updated=now,
    )
    task: Optional[asyncio.Task] = job.get("task")
    if task is not None and not task.done():
        task.cancel()
    if refundable:
        _spawn_background(_refund_server_timeout(job), "deadline refund")
    else:
        job["rate_limit_identifier"] = None
        job["incremented_quota"] = False
        job["pool_reserved"] = False
    _notify_ai_job(job)
    logger.warning(f"AI job {job_id} ({job.get('label')}) passed the server deadline (refunded={refundable}).")


def _cancel_is_server_caused(job: Dict[str, Any], now: Optional[float] = None) -> bool:
    """A cancel of a job that was still waiting in line, or already running past the server
    deadline, is the server's fault: it never counts against the cancel-refund cap (SC-19)."""
    if job.get("queued"):
        return True
    deadline = _ai_job_server_deadline_seconds()
    started_at = job.get("started_at")
    now = time.time() if now is None else now
    return bool(deadline > 0 and started_at and now - float(started_at) >= deadline)


async def _drain_ai_jobs_on_shutdown(budget_seconds: Optional[float] = None) -> int:
    """
    Shutdown hook: stop accepting new jobs, mark every pending job cancelled and refund the ones
    whose model call hadn't finished yet (`can_refund_on_cancel`), within a small time budget.
    Returns the number of jobs whose refund was attempted.
    """
    global _SERVER_DRAINING
    _SERVER_DRAINING = True
    if budget_seconds is None:
        try:
            budget_seconds = float(os.getenv("SHUTDOWN_REFUND_BUDGET_SECONDS", "").strip() or 5.0)
        except ValueError:
            budget_seconds = 5.0
    to_refund: List[Dict[str, Any]] = []
    now = time.time()
    _TEXT_JOB_QUEUE.clear()
    for job in list(_AI_JOBS.values()):
        if job.get("status") != "pending":
            continue
        refundable = bool(job.get("can_refund_on_cancel", True))
        # Marked before the task is cancelled, so `_run_ai_job` doesn't refund a second time.
        job.update(
            status="cancelled",
            detail="The server restarted before this finished. Please try again.",
            updated=now,
        )
        job.pop("queued", None)
        job.pop("queued_operation", None)
        job.pop("queued_context", None)
        task: Optional[asyncio.Task] = job.get("task")
        if task and not task.done():
            task.cancel()
        _notify_ai_job(job)
        if refundable:
            to_refund.append(job)
        else:
            job["rate_limit_identifier"] = None
            job["incremented_quota"] = False
            job["pool_reserved"] = False
    if not to_refund:
        return 0

    async def _refund(job: Dict[str, Any]) -> None:
        try:
            await run_quota(_refund_job_quota_and_limits, job, job.get("user") or {})
        except Exception as e:
            logger.warning(f"Shutdown refund failed: {e}")

    try:
        await asyncio.wait_for(
            asyncio.gather(*(_refund(job) for job in to_refund)),
            timeout=max(0.1, budget_seconds),
        )
    except asyncio.TimeoutError:
        logger.warning(f"Shutdown refunds did not finish within {budget_seconds:.1f}s.")
    logger.info(f"Shutdown: cancelled pending AI jobs, refunded {len(to_refund)}.")
    return len(to_refund)


def _mark_job_non_refundable_on_cancel(job_id: Optional[str]) -> None:
    """Locks user-cancel refunds once the upstream LLM call has completed and billed tokens."""
    if not job_id:
        return
    job = _AI_JOBS.get(job_id)
    if job is not None:
        job["can_refund_on_cancel"] = False


def _allow_cancel_refund_for_caller(user: Optional[Dict[str, Any]], client_ip: Optional[str]) -> bool:
    """Caps user-initiated cancel refunds per caller to prevent start+cancel quota/rate-limit bypass loops."""
    if user and is_admin_user(user):
        return True
    uid = user.get("id") if isinstance(user, dict) and not is_guest_user(user) else None
    key = f"user:{uid}" if uid else f"ip:{normalize_client_ip(client_ip)}"
    now = time.time()
    cutoff = now - _CANCEL_REFUND_WINDOW_SECONDS
    recent = [ts for ts in _CANCEL_REFUND_HISTORY.get(key, ()) if ts > cutoff]
    if len(_CANCEL_REFUND_HISTORY) > 1024:
        for k, ts_list in list(_CANCEL_REFUND_HISTORY.items()):
            if not ts_list or ts_list[-1] <= cutoff:
                _CANCEL_REFUND_HISTORY.pop(k, None)
    if len(recent) >= _MAX_CANCEL_REFUNDS_PER_WINDOW:
        _CANCEL_REFUND_HISTORY[key] = recent
        logger.warning(f"Cancel-refund cap reached for {key} ({len(recent)}/{_MAX_CANCEL_REFUNDS_PER_WINDOW}); skipping refund.")
        return False
    recent.append(now)
    _CANCEL_REFUND_HISTORY[key] = recent
    return True


def _transfer_ai_jobs(from_user_id: Optional[str], to_user_id: Optional[str]) -> int:
    """
    Hands in-flight/finished AI jobs of a claimed guest session over to the signed-in account,
    so a guest who signs in mid-generation can keep polling (and receive) their result.
    Only `user_id` (access ownership) moves; `user` stays as-is so quota refunds still credit
    whoever was actually charged.
    """
    if not from_user_id or not to_user_id or from_user_id == to_user_id:
        return 0
    moved = 0
    for job in _AI_JOBS.values():
        if job.get("user_id") == from_user_id:
            job["user_id"] = to_user_id
            moved += 1
    return moved


def _job_owner_id(job_id: Optional[str], fallback_user: Dict[str, Any]) -> Optional[str]:
    """Current owner of a job (may change if a guest signs in while it runs)."""
    job = _AI_JOBS.get(job_id) if job_id else None
    if job and job.get("user_id"):
        return job.get("user_id")
    return fallback_user.get("id")


def _refund_job_quota_and_limits(job: Optional[Dict[str, Any]], user: Dict[str, Any]) -> None:
    if not job:
        return
    rl_id = job.get("rate_limit_identifier")
    job["rate_limit_identifier"] = None
    if rl_id:
        try:
            timeline_rate_limiter.refund(rl_id)
        except Exception:
            pass
    pool_reserved = bool(job.get("pool_reserved"))
    was_incremented = bool(job.get("incremented_quota"))
    job["incremented_quota"] = False
    job["pool_reserved"] = False
    credits = max(1, int(job.get("quota_credits") or get_text_credit_cost()))
    if was_incremented:
        client_ip = job.get("client_ip")
        saved_user = job.get("user") or user
        try:
            refund_user_quota(saved_user, client_ip=client_ip, refund_pool=pool_reserved, credits=credits)
            logger.info(f"Refunded {credits} daily credit(s) for user {saved_user.get('id')} / IP {client_ip}")
        except Exception as e:
            logger.warning(f"Failed to refund quota for user {saved_user.get('id')}: {e}")
    elif pool_reserved:
        # e.g. unlimited mode: no per-user count was recorded, but pool credit(s) were reserved.
        try:
            refund_community_paid_prompt(credits=credits)
        except Exception as e:
            logger.warning(f"Failed to refund community pool slot: {e}")


async def _refund_sync_call_quota(
    user: Optional[Dict[str, Any]],
    client_ip: Optional[str],
    key_tier: Optional[str],
    custom_key: Optional[str],
    credits: Optional[int] = None,
) -> None:
    """Refunds reserved daily credits / Community Pool slot when a synchronous AI endpoint fails."""
    if not key_tier:
        return
    pool_reserved = community_pool_reserved_for_tier(key_tier)
    incremented = bool(key_tier == "paid" and _quota_counts_usage(user, custom_key))
    cost = max(1, int(credits if credits is not None else get_text_credit_cost()))
    try:
        if incremented:
            await run_quota(
                refund_user_quota,
                user,
                client_ip=client_ip,
                refund_pool=pool_reserved,
                credits=cost,
            )
        elif pool_reserved:
            await run_quota(refund_community_paid_prompt, credits=cost)
    except Exception as refund_err:
        logger.warning(f"Failed to refund sync call quota: {refund_err}")


async def _verify_timeline_mutation_target(
    timeline_id: Optional[str],
    user: Dict[str, Any],
) -> tuple[Optional[str], Optional[Dict[str, Any]]]:
    """
    Verifies that `user` may modify `timeline_id`: its owner, an admin, or anyone for a brand-new id.
    Unowned rows (NULL owner: curated Library demos, re-homed rows) are admin-only.
    Returns `(target_owner_id, existing_meta)`, where `existing_meta` is None only for an id that
    verifiably does not exist yet. Raises HTTP 403, or 503 when storage can't answer.
    """
    caller_id = user.get("id")
    if not timeline_id:
        return caller_id, None
    try:
        existing_meta = await run_storage(_get_timeline_access_meta_sync, timeline_id)
    except StorageUnavailableError:
        raise HTTPException(status_code=503, detail=_STORAGE_UNAVAILABLE_DETAIL)
    if existing_meta is None:
        return caller_id, None
    owner_id = existing_meta.get("owner_id")
    if owner_id and owner_id == caller_id:
        return caller_id, existing_meta
    if not is_admin_user(user):
        raise HTTPException(
            status_code=403,
            detail="You cannot overwrite someone else's timeline. Please save a copy instead.",
        )
    # Admin edits keep the existing owner (including NULL for unowned rows).
    return owner_id, existing_meta


_LIBRARY_FLAG_KEYS = ("isLibrary", "is_library", "isFeatured", "is_featured", "featuredOrder", "featured_order")


async def _owner_save_keeps_library_content(clean: Dict[str, Any], timeline_id: Optional[str]) -> bool:
    """
    B-11: True when a non-admin owner's save leaves the published Library content unchanged (only
    cosmetic / cached fields such as videos, pins or image focal points differ), so it stays published.
    Any read failure counts as a content change: unpublishing is the safe direction.
    """
    if not timeline_id:
        return False
    try:
        stored = await run_storage(get_timeline_with_meta, timeline_id)
    except Exception as e:
        logger.warning(f"Could not read stored Library timeline {timeline_id} for the content check: {e}")
        return False
    stored_data = stored.get("data") if isinstance(stored, dict) else None
    if not isinstance(stored_data, dict):
        return False
    sanitize_timeline_dates(clean)
    return timeline_content_fingerprint(clean) == timeline_content_fingerprint(stored_data)


async def _persist_timeline_dict(
    tl_dict: Dict[str, Any],
    user: Dict[str, Any],
    target_owner: Optional[str],
    existing_meta: Optional[Dict[str, Any]] = None,
    *,
    id_is_server_generated: bool = False,
    base_updated_at: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Sanitizes server-controlled visibility flags (`isShared`, `isLibrary`, `isFeatured`) and persists
    the timeline, converting fail-closed storage errors to HTTP 503 and lost write races to HTTP 409.
    `existing_meta` must be what `_verify_timeline_mutation_target` returned for this id (None = the
    id was verified as new, so it is INSERTed under `target_owner`); existing rows keep their owner.
    Generation paths pass `id_is_server_generated=True` so an id collision fails instead of updating.

    Library flags in the payload are always ignored, admins included: they come from the stored row,
    so a stale copy can never re-publish, re-feature or re-order (curation goes only through the
    admin library endpoints). A non-admin owner's save unpublishes only when content changed (B-11).

    `base_updated_at` (B-04) is the version the caller's copy was based on: a stale one raises
    TimelineStaleWriteError (409 `stale_write`) and writes nothing. A soft-deleted row raises 410.
    """
    if deleted_users.is_recently_deleted(target_owner) or deleted_users.is_recently_deleted((user or {}).get("id")):
        # A job that outlived its account's deletion must not recreate its data (B-13).
        raise HTTPException(status_code=410, detail="This account was deleted.")
    clean = dict(tl_dict)
    clean.pop("isShared", None)
    clean.pop("is_shared", None)
    clean.pop("is_public", None)
    clean.pop("isOwner", None)
    clean.pop("isAdmin", None)
    for key in _LIBRARY_FLAG_KEYS:
        clean.pop(key, None)

    if existing_meta and existing_meta.get("is_library"):
        keep_published = is_admin_user(user) or await _owner_save_keeps_library_content(clean, clean.get("id"))
        if keep_published:
            clean["isLibrary"] = True
            clean["isFeatured"] = bool(existing_meta.get("is_featured"))
            if existing_meta.get("featured_order") is not None:
                clean["featuredOrder"] = existing_meta["featured_order"]
        else:
            # Editing an already-curated timeline's content unpublishes it until an admin re-reviews it.
            clean["isLibrary"] = False
            clean["isFeatured"] = False

    save_kwargs: Dict[str, Any] = {"user_id": target_owner, "existing_meta": existing_meta}
    if base_updated_at and existing_meta is not None:
        save_kwargs["base_updated_at"] = base_updated_at
    try:
        # From here a job's cancel no longer interrupts it: the write may land either way (B-16).
        _note_job_phase("persisting")
        saved = await run_storage(save_timeline_data, clean, **save_kwargs)
        saved_id = saved.get("id") if isinstance(saved, dict) else None
        _note_job_timeline_persisted(saved_id or clean.get("id"))
        _note_job_phase("persisted")
        return saved
    except TimelineStaleWriteError:
        logger.info(f"Stale timeline write rejected for {clean.get('id')}")
        raise
    except TimelineGoneError:
        raise  # 410 `timeline_deleted` (global handler; AI jobs record it as a 410 error)
    except TimelineConflictError:
        if existing_meta is None and not id_is_server_generated and tl_dict.get("id"):
            # The id was free when verified but was created since (e.g. an autosave racing a refine):
            # re-authorize against the row that now exists and update it instead of failing.
            fresh_owner, fresh_meta = await _verify_timeline_mutation_target(tl_dict["id"], user)
            if fresh_meta is not None:
                return await _persist_timeline_dict(
                    tl_dict, user=user, target_owner=fresh_owner, existing_meta=fresh_meta,
                    base_updated_at=base_updated_at,
                )
        logger.warning(f"Timeline write conflict for {clean.get('id')}")
        raise HTTPException(status_code=409, detail=_TIMELINE_CONFLICT_DETAIL)
    except TimelineImageLimitError as limit_err:
        raise HTTPException(status_code=413, detail=f"{limit_err} Remove some embedded photos and try again.")
    except RuntimeError as storage_err:
        logger.error(f"Storage unavailable while saving timeline {clean.get('id')}: {storage_err}")
        raise HTTPException(status_code=503, detail=_STORAGE_UNAVAILABLE_DETAIL)


def _ensure_ai_timeline_storable(tl_dict: Dict[str, Any]) -> None:
    """An AI mutation must leave 1..TIMELINE_MAX_ARTICLES events, or nothing is saved (B-18)."""
    count = len(tl_dict.get("articles") or [])
    if count == 0:
        raise EmptyRefineResultError()
    if count > TIMELINE_MAX_ARTICLES:
        raise TimelineTooLargeError()


async def _persist_ai_timeline(
    tl_dict: Dict[str, Any],
    user: Dict[str, Any],
    target_owner: Optional[str],
    existing_meta: Optional[Dict[str, Any]],
    base_updated_at: Optional[str],
) -> Dict[str, Any]:
    """
    Persists an AI result computed from the snapshot the client sent at job start (refine, chat
    edit, attach-files), conditioned on that snapshot's `updatedAt` (B-04). When the timeline moved
    on meanwhile, nothing is overwritten: returns `persisted: False, conflict: True` so the client
    merges the result into its latest copy and saves it through its save queue.
    Returns {"persisted", "conflict", "updatedAt"} (the new version when persisted).
    Refuses (ValueError, refunded by the callers) a result with no events or above the event ceiling (B-18).
    """
    _ensure_ai_timeline_storable(tl_dict)
    try:
        saved = await _persist_timeline_dict(
            tl_dict, user=user, target_owner=target_owner, existing_meta=existing_meta,
            base_updated_at=base_updated_at,
        )
    except TimelineStaleWriteError:
        _note_job_timeline_conflict(tl_dict.get("id"))
        return {"persisted": False, "conflict": True, "updatedAt": base_updated_at}
    new_version = saved.get("updatedAt") if isinstance(saved, dict) else None
    return {"persisted": True, "conflict": False, "updatedAt": new_version or tl_dict.get("updatedAt")}


def _note_job_partial(job_id: str, partial: Dict[str, Any]) -> None:
    """Keeps the parsed-but-not-yet-enriched timeline on a pending job for the status poll (P-03)."""
    job = _AI_JOBS.get(job_id)
    if job is None or job.get("status") != "pending" or not isinstance(partial, dict):
        return
    job["partial"] = partial
    job["partial_rev"] = int(job.get("partial_rev") or 0) + 1
    _notify_ai_job(job)


async def _run_ai_job(job_id: str, operation, user: Dict[str, Any], label: str) -> None:
    """Run an async `operation()` returning a JSON-serializable dict, recording status on the job."""
    _current_ai_job_id.set(job_id)
    # The generators call this as soon as the model's answer is in, before enrichment (B-16).
    set_model_response_hook(lambda: _mark_job_non_refundable_on_cancel(job_id))
    # ...and this with the timeline before images and links are added, so the client can show it (P-03).
    set_partial_result_hook(lambda partial: _note_job_partial(job_id, partial))
    try:
        result = await operation()
        job = _AI_JOBS.get(job_id)
        if job is not None:
            if job.get("status") != "pending":
                return
            result_bytes = _approx_result_bytes(result)
            if result_bytes is None:
                # Too many nodes to walk cheaply: serialize it in the cpu pool, not on the loop (P-11).
                result_bytes = await run_cpu(_estimate_result_bytes, result)
                if job.get("status") != "pending":
                    return  # cancelled / timed out by the server while it was being measured
            job.update(status="done", result=result, result_bytes=result_bytes, updated=time.time())
            # Enforce the memory cap as results land, not only when the throttled cleanup next runs.
            if sum(int(j.get("result_bytes") or 0) for j in _AI_JOBS.values()) > _max_finished_ai_job_bytes():
                _cleanup_ai_jobs()
    except asyncio.CancelledError:
        logger.info(f"{label} job {job_id} cancelled.")
        job = _AI_JOBS.get(job_id)
        if job is not None:
            if job.get("status") == "pending":
                # Nobody else settled this job (the cancel route, shutdown drain and the server
                # deadline mark it first and handle its refund themselves).
                if job.get("can_refund_on_cancel", True):
                    await run_quota(_refund_job_quota_and_limits, job, user)
                job.update(status="cancelled", detail="Cancelled by user", updated=time.time())
            elif job.get("status") == "cancelled" and not job.get("detail"):
                job.update(detail="Cancelled by user", updated=time.time())
        raise
    except InsufficientSubjectInfoError as ie:
        # Not a failure: the AI honestly has no reliable facts (e.g. a private person).
        # Refund the attempt and let the client offer upload / paste / manual alternatives.
        job = _AI_JOBS.get(job_id)
        if job is not None:
            if job.get("status") != "pending":
                return
            await run_quota(_refund_job_quota_and_limits, job, user)
            job.update(
                status="error",
                status_code=422,
                code=ie.code,
                subject=ie.subject,
                detail=str(ie),
                updated=time.time(),
            )
    except HTTPException as he:
        job = _AI_JOBS.get(job_id)
        if job is not None:
            if job.get("status") != "pending":
                return
            await run_quota(_refund_job_quota_and_limits, job, user)
            job.update(status="error", status_code=he.status_code, detail=str(he.detail), updated=time.time())
    except TimelineGoneError:
        job = _AI_JOBS.get(job_id)
        if job is not None:
            if job.get("status") != "pending":
                return
            await run_quota(_refund_job_quota_and_limits, job, user)
            job.update(status="error", status_code=410, detail=_TIMELINE_GONE_DETAIL, updated=time.time())
    except (StorageUnavailableError, TimelineConflictError) as se:
        job = _AI_JOBS.get(job_id)
        if job is not None:
            if job.get("status") != "pending":
                return
            await run_quota(_refund_job_quota_and_limits, job, user)
            conflict = isinstance(se, TimelineConflictError)
            job.update(
                status="error",
                status_code=409 if conflict else 503,
                detail=_TIMELINE_CONFLICT_DETAIL if conflict else _STORAGE_UNAVAILABLE_DETAIL,
                updated=time.time(),
            )
    except ValueError as ve:
        job = _AI_JOBS.get(job_id)
        if job is not None:
            if job.get("status") != "pending":
                return
            await run_quota(_refund_job_quota_and_limits, job, user)
            job.update(status="error", status_code=400, detail=str(ve), updated=time.time())
            error_code = getattr(ve, "code", None)
            if isinstance(error_code, str) and error_code:
                job["code"] = error_code
    except Exception as e:
        job = _AI_JOBS.get(job_id)
        if job is not None and job.get("status") != "pending":
            return
        logger.error(f"Error in {label} job: {e}", exc_info=True)
        if job is not None:
            await run_quota(_refund_job_quota_and_limits, job, user)
            job.update(status="error", status_code=500, detail=format_api_error_for_user(e, user), updated=time.time())
    finally:
        # Release the finished Task and its coroutine/closure frame (e.g. up to 30 MB of upload bytes)
        job = _AI_JOBS.get(job_id)
        if job is not None:
            job["task"] = None
            job.pop("partial", None)  # the final result (or error) replaces the preview
            _notify_ai_job(job)


_MAX_JOB_STATUS_WAIT_SECONDS = 25.0
# Done results at least this big are serialized (and gzipped) in the cpu pool, not on the loop (P-11).
_DEFAULT_PREENCODE_MIN_BYTES = 1024 * 1024


def _job_preencode_min_bytes() -> int:
    return _env_count("AI_JOB_PREENCODE_MIN_BYTES", _DEFAULT_PREENCODE_MIN_BYTES)


def _encode_json_body(payload: Dict[str, Any], gzip_body: bool) -> bytes:
    import gzip as _gzip

    body = json.dumps(
        jsonable_encoder(payload), ensure_ascii=False, allow_nan=False, separators=(",", ":")
    ).encode("utf-8")
    return _gzip.compress(body, compresslevel=5) if gzip_body else body


async def _job_done_response(request: Optional[Request], payload: Dict[str, Any]) -> Response:
    gzip_body = request is not None and "gzip" in (request.headers.get("accept-encoding") or "").lower()
    body = await run_cpu(_encode_json_body, payload, gzip_body)
    headers = {"Vary": "Accept-Encoding"}
    if gzip_body:
        # Already compressed: GZipMiddleware leaves responses with a Content-Encoding alone.
        headers["Content-Encoding"] = "gzip"
    return Response(content=body, media_type="application/json", headers=headers)


def _job_status_payload(job_id: str, job: Dict[str, Any], partial_rev: int) -> Dict[str, Any]:
    status_val = job.get("status")
    timeline_fields = _job_timeline_fields(job)
    if status_val == "done":
        return {"status": "done", "result": job.get("result"), **timeline_fields}
    if status_val == "error":
        payload = {"status": "error", "detail": job.get("detail", "Request failed"), **timeline_fields}
        if job.get("code"):
            payload["code"] = job.get("code")
            payload["subject"] = job.get("subject")
        return payload
    if status_val == "cancelled":
        return {"status": "cancelled", "detail": job.get("detail", "Job was cancelled by user"), **timeline_fields}
    if job.get("queued"):
        position = _text_job_queue_position(job_id)
        return {"status": "queued", "position": position, "ahead": max(0, position - 1), **timeline_fields}
    payload = {"status": "pending", **timeline_fields}
    current_rev = int(job.get("partial_rev") or 0)
    if current_rev and isinstance(job.get("partial"), dict):
        payload["partial_rev"] = current_rev
        if partial_rev < current_rev:
            payload["partial"] = job["partial"]
    return payload


def _job_status_is_news(payload: Dict[str, Any], client_position: int) -> bool:
    """Whether a status answer tells the client something it didn't know (ends a long poll)."""
    status_val = payload.get("status")
    if status_val not in ("pending", "queued"):
        return True
    if "partial" in payload:
        return True
    current_position = int(payload.get("position") or 0) if status_val == "queued" else 0
    return current_position != client_position


def _lookup_pollable_job(job_id: str, user: Dict[str, Any]) -> Dict[str, Any]:
    job = _AI_JOBS.get(job_id)
    if job is not None and _is_ai_job_expired(job, time.time()):
        # Cleanup is throttled; expiry of the polled job itself is still exact.
        _AI_JOBS.pop(job_id, None)
        job = None
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found or expired.")
    if job.get("user_id") != user.get("id"):
        raise HTTPException(status_code=403, detail="Not authorized to access this job.")
    return job


@app.get("/api/timeline/job/status/{job_id}")
async def ai_job_status(
    job_id: str,
    partial_rev: Annotated[int, Query(ge=0)] = 0,
    wait: Annotated[float, Query(ge=0)] = 0.0,
    position: Annotated[int, Query(ge=0)] = 0,
    user: Dict[str, Any] = Depends(get_current_user_required),
    request: Request = None,
):
    """
    Poll the status of a background AI job (generate / refine / chat). Every payload carries
    `timeline_id` + `persisted` once the job's timeline id is known, so a client whose result
    is lost (expired, evicted, errored after saving) can open the saved timeline instead.
    A pending generation whose model answer is parsed also carries `partial_rev` and, unless the
    client already has that revision (`?partial_rev=`), `partial`: the timeline without Wikipedia
    images / links yet (P-03). It is a preview only: never saved, replaced by the `done` result.

    A job waiting for capacity reports `{"status": "queued", "position": N, "ahead": N-1}` (SC-07).
    A job the server stopped reports `status: "error"` with `code: "server_timeout"` (SC-19).

    Long poll (SC-02): with `?wait=<seconds>` (capped at 25) the answer is held until something
    changed compared with what the client has (`partial_rev`, queue `position`, or any final
    status), or the wait runs out; it then carries `waited_ms`. Without `wait` it answers at once.
    """
    _maybe_cleanup_ai_jobs()
    job = _lookup_pollable_job(job_id, user)
    payload = _job_status_payload(job_id, job, partial_rev)
    wait_seconds = min(float(wait or 0.0), _MAX_JOB_STATUS_WAIT_SECONDS)
    if wait_seconds > 0 and not _job_status_is_news(payload, position):
        loop = asyncio.get_running_loop()
        started = loop.time()
        deadline = started + wait_seconds
        while not _SERVER_DRAINING:
            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            event = _ai_job_changed_event(job)
            try:
                await asyncio.wait_for(event.wait(), timeout=remaining)
            except asyncio.TimeoutError:
                break
            current = _AI_JOBS.get(job_id)
            if current is None:
                raise HTTPException(status_code=404, detail="Job not found or expired.")
            job = current
            payload = _job_status_payload(job_id, job, partial_rev)
            if _job_status_is_news(payload, position):
                break
        if payload.get("status") in ("pending", "queued"):
            payload["waited_ms"] = int((loop.time() - started) * 1000)

    if payload.get("status") in ("done", "error", "cancelled"):
        job.setdefault("delivered_at", time.time())
    if payload.get("status") == "done" and int(job.get("result_bytes") or 0) >= _job_preencode_min_bytes():
        return await _job_done_response(request, payload)
    return payload


@app.post("/api/timeline/job/cancel/{job_id}")
async def cancel_ai_job(
    job_id: str,
    request: Request,
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Cancel an in-progress background AI job (generate / refine / chat).
    Cancels the background task, refunds the rate limiter hit, and refunds daily quota
    (subject to pre-completion and anti-abuse cancel-refund limits). A job still waiting in line,
    or one already past the server deadline, is refunded without touching the cap (SC-19).
    """
    job = _AI_JOBS.get(job_id)
    if job is None:
        return {"status": "cancelled", "message": "Job not found or already finished."}

    if job.get("user_id") != user.get("id") and not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Not authorized to cancel this job.")

    if job.get("status") == "pending" and job.get("phase") in ("persisting", "persisted"):
        # The result is being (or was) saved: cancelling now would report "cancelled" while the
        # timeline lands anyway. Let the job finish and report what was saved instead (B-16).
        task = job.get("task")
        if task is not None and not task.done():
            await asyncio.wait({task}, timeout=_CANCEL_WAIT_FOR_PERSIST_SECONDS)
        return {
            "status": job.get("status"),
            "message": "The result was already being saved, so it was kept.",
            **_job_timeline_fields(job),
        }

    if job.get("status") == "pending":
        can_refund = bool(job.get("can_refund_on_cancel", True))
        server_caused = _cancel_is_server_caused(job)
        job["status"] = "cancelled"
        job["updated"] = time.time()
        job.pop("queued", None)
        job.pop("queued_operation", None)
        job.pop("queued_context", None)

        # 1. Cancel background asyncio Task
        task: Optional[asyncio.Task] = job.get("task")
        if task and not task.done():
            task.cancel()
            logger.info(f"Cancelled background asyncio task for job {job_id}")
        _notify_ai_job(job)

        # 2. Refund rate limiter and daily quota only if LLM hasn't finished and caller isn't spamming cancels
        caller_ip = job.get("client_ip") or get_client_ip(request)
        if can_refund and (server_caused or _allow_cancel_refund_for_caller(job.get("user") or user, caller_ip)):
            await run_quota(_refund_job_quota_and_limits, job, user)
            return {"status": "cancelled", "message": "Job cancelled and quota refunded."}

        job["rate_limit_identifier"] = None
        job["incremented_quota"] = False
        job["pool_reserved"] = False
        return {"status": "cancelled", "message": "Job cancelled.", **_job_timeline_fields(job)}

    return {
        "status": job.get("status"),
        "message": f"Job was already in {job.get('status')} state.",
        **_job_timeline_fields(job),
    }


def _tier_entitlements(user: Optional[Dict[str, Any]], key_tier: Optional[str], api_key: Optional[str] = None):
    """
    Entitlements for a resolved request. key_tier 'custom' means `api_key` is the caller's own key,
    which unlocks the unlimited tier only once verified (S-04).
    """
    return get_entitlements(user, api_key if key_tier == "custom" else None)


def _generation_limit_kwargs(
    user: Optional[Dict[str, Any]],
    key_tier: Optional[str],
    requested_auto_images: Optional[bool],
    source: str = "prompt",
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Tier ceilings for a timeline generation: event cap, large-timeline opt-in, auto AI images."""
    ent = _tier_entitlements(user, key_tier, api_key)
    kwargs: Dict[str, Any] = {
        "max_events": ent.max_file_events if source == "files" else ent.max_prompt_events,
        "allow_large": ent.is_unlimited,
    }
    auto_images = effective_auto_ai_images(ent, requested_auto_images)
    if auto_images is not None:
        kwargs["enable_ai_fallback_images"] = auto_images
    return kwargs


def _refine_limit_kwargs(
    user: Optional[Dict[str, Any]], key_tier: Optional[str], api_key: Optional[str] = None
) -> Dict[str, Any]:
    """Tier ceilings for refine / chat edits: new-event cap and timeline-context budget."""
    ent = _tier_entitlements(user, key_tier, api_key)
    return {
        "max_new_events": ent.max_refine_new_events,
        "max_context_chars": ent.max_refine_context_chars,
    }


def _copy_saved_version(saved: Any, target: Any) -> None:
    """Copies the stored `updatedAt` / `createdAt` onto a generation result, so the client's first
    save already has the version to send as its base (B-04)."""
    if not isinstance(saved, dict):
        return
    for key in ("updatedAt", "createdAt"):
        value = saved.get(key)
        if not value:
            continue
        if isinstance(target, dict):
            target[key] = value
        else:
            setattr(target, key, value)


async def _execute_generation(
    req: GenerateTimelineRequest,
    api_key: Optional[str],
    key_tier: str,
    user: Dict[str, Any],
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    t_start = time.time()
    extra_kwargs = _generation_limit_kwargs(user, key_tier, req.enable_ai_fallback_images, source="prompt", api_key=api_key)
    async with track_ai_activity(
        "generate_timeline", user,
        key_tier=key_tier,
        content_mode=req.content_mode or "classic",
        search_mode=search_mode_for(req.enable_grounding),
        prompt=req.prompt,
        details={"custom_focus": bool(req.custom_focus), "async_job": bool(job_id), "input_method": normalize_input_method(req.input_method)},
    ) as activity:
        timeline = await run_with_key_failover(
            lambda key: generate_timeline_with_gemini(
                prompt=req.prompt,
                custom_focus=req.custom_focus,
                api_key=key,
                enable_grounding=req.enable_grounding,
                content_mode=req.content_mode or "classic",
                **extra_kwargs,
            ),
            api_key, key_tier, label="timeline generation"
        )
        _mark_job_non_refundable_on_cancel(job_id)
        timeline.searchMode = search_mode_for(req.enable_grounding)
        timeline.creationSource = "prompt"
        apply_timeline_result(activity, timeline)
        elapsed_gen = time.time() - t_start
        # Resolve the owner at save time: a guest may have signed in while the job was running.
        user_id = _job_owner_id(job_id, user)
        dumped = timeline.model_dump(by_alias=True)
        saved = await _persist_timeline_dict(dumped, user=user, target_owner=user_id, existing_meta=None, id_is_server_generated=True)
        _copy_saved_version(saved, dumped)
    is_grounded = bool(timeline.grounding and timeline.grounding.is_grounded)
    logger.info(f"Timeline generated successfully in {elapsed_gen:.2f}s (id={timeline.id}, events={len(timeline.articles)}, grounded={is_grounded})")
    return dumped


@app.post("/api/timeline/generate/start", dependencies=[Depends(timeline_rate_limiter)])
async def start_generate_timeline(
    req: GenerateTimelineRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Start a timeline generation as a background job and return a job id to poll.
    Decouples the long-running AI call from the HTTP request so the client can
    leave and return (e.g. backgrounding a mobile tab) without stalling.
    """
    try:
        client_ip = get_client_ip(request)
        _enforce_concurrent_job_limit(user, client_ip)
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        api_key, key_tier, is_admin = await run_quota(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        incremented_quota = bool(key_tier == "paid" and _quota_counts_usage(user, x_gemini_api_key))
        logger.info(
            f"Starting timeline job for user {user.get('id')} using {key_tier} key "
            f"(is_admin={is_admin}, grounding={'ENABLED' if req.enable_grounding else 'OFF'})"
        )
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(key_tier),
        )
        return _launch_ai_job(
            job_id,
            lambda: _execute_generation(req, api_key, key_tier, user, job_id=job_id),
            user,
            label="generate",
        )
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error starting generate job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post("/api/timeline/generate", response_model=TimelineData, dependencies=[Depends(timeline_rate_limiter)])
async def generate_timeline_endpoint(
    req: GenerateTimelineRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Generate a full timeline from a natural language prompt.
    Requires authentication. Routes between paid and free Gemini keys based on daily quota.
    """
    client_ip = get_client_ip(request)
    key_tier: Optional[str] = None
    quota_charged = False
    try:
        api_key, key_tier, is_admin = await run_quota(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        quota_charged = True
        logger.info(
            f"Generating timeline for user {user.get('id')} using {key_tier} key "
            f"(is_admin={is_admin}, grounding={'ENABLED' if req.enable_grounding else 'OFF'})"
        )

        extra_kwargs = _generation_limit_kwargs(user, key_tier, req.enable_ai_fallback_images, source="prompt", api_key=api_key)
        async with track_ai_activity(
            "generate_timeline", user,
            key_tier=key_tier,
            content_mode=req.content_mode or "classic",
            search_mode=search_mode_for(req.enable_grounding),
            prompt=req.prompt,
            details={"custom_focus": bool(req.custom_focus), "async_job": False, "input_method": normalize_input_method(req.input_method)},
        ) as activity:
            timeline = await run_with_key_failover(
                lambda key: generate_timeline_with_gemini(
                    prompt=req.prompt,
                    custom_focus=req.custom_focus,
                    api_key=key,
                    enable_grounding=req.enable_grounding,
                    content_mode=req.content_mode or "classic",
                    **extra_kwargs,
                ),
                api_key, key_tier, label="timeline generation"
            )
            timeline.searchMode = search_mode_for(req.enable_grounding)
            timeline.creationSource = "prompt"
            apply_timeline_result(activity, timeline)

            user_id = user.get("id")
            saved = await _persist_timeline_dict(
                timeline.model_dump(by_alias=True), user=user, target_owner=user_id,
                existing_meta=None, id_is_server_generated=True,
            )
            _copy_saved_version(saved, timeline)
        is_grounded = bool(timeline.grounding and timeline.grounding.is_grounded)
        logger.info(f"Timeline generated successfully (id={timeline.id}, events={len(timeline.articles)}, grounded={is_grounded})")
        return timeline
    except InsufficientSubjectInfoError as ie:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, key_tier, x_gemini_api_key)
        raise HTTPException(
            status_code=422,
            detail={"code": ie.code, "subject": ie.subject, "message": str(ie)},
        )
    except HTTPException:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, key_tier, x_gemini_api_key)
        raise
    except ValueError as ve:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, key_tier, x_gemini_api_key)
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, key_tier, x_gemini_api_key)
        logger.error(f"Error in generate_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


MAX_UPLOAD_FILES = 20
MAX_UPLOAD_FILE_BYTES = 8 * 1024 * 1024  # 8MB per file
MAX_UPLOAD_TOTAL_BYTES = 30 * 1024 * 1024  # 30MB per request
MAX_RAW_TEXT_CHARS = 20000


def _stamp_files_timeline(timeline: TimelineData, prompt_mode: bool, enable_grounding: Optional[bool]) -> None:
    """Records how a file/photo-based timeline was created (persisted with the timeline)."""
    timeline.creationSource = "photo_prompt" if prompt_mode else "files"
    timeline.searchMode = search_mode_for(enable_grounding) if prompt_mode else "fast"


async def _execute_generation_from_files(
    validated_uploads: ValidatedUploads,
    context: Optional[str],
    raw_text: Optional[str],
    resolved_mode: str,
    prompt_mode: bool,
    enable_grounding: bool,
    ui_language: Optional[str],
    enable_ai_fallback_images: Optional[bool],
    api_key: Optional[str],
    key_tier: str,
    user: Dict[str, Any],
    job_id: Optional[str] = None,
    input_method: Optional[str] = None,
    credits_charged: Optional[int] = None,
) -> Dict[str, Any]:
    extra_kwargs: Dict[str, Any] = {
        "extracted_documents": validated_uploads.extracted_documents or None,
        "total_pdf_pages": validated_uploads.total_pdf_pages,
    }
    if prompt_mode:
        extra_kwargs["prompt_mode"] = True
        extra_kwargs["enable_grounding"] = bool(enable_grounding)
        if ui_language:
            extra_kwargs["ui_language"] = ui_language
    extra_kwargs.update(_generation_limit_kwargs(user, key_tier, enable_ai_fallback_images, source="files", api_key=api_key))

    activity_details: Dict[str, Any] = {
        "file_count": validated_uploads.total_accepted_files,
        "image_count": validated_uploads.image_count,
        "doc_count": validated_uploads.doc_count,
        "has_pasted_text": bool(raw_text),
        "async_job": bool(job_id),
        "input_method": normalize_input_method(input_method, bool((context or "").strip())),
    }
    if credits_charged is not None:
        activity_details["credits_charged"] = int(credits_charged)
    if validated_uploads.total_pdf_pages > 0:
        activity_details["pdf_pages"] = validated_uploads.total_pdf_pages

    async with track_ai_activity(
        "generate_from_photo_prompt" if prompt_mode else "generate_from_files", user,
        key_tier=key_tier,
        content_mode=resolved_mode,
        search_mode=search_mode_for(enable_grounding) if prompt_mode else None,
        prompt=context,
        details=activity_details,
    ) as activity:
        timeline = await run_with_key_failover(
            lambda key: generate_timeline_from_files(
                files=validated_uploads.binary_files,
                context_prompt=context,
                raw_text=raw_text or None,
                api_key=key,
                content_mode=resolved_mode,
                **extra_kwargs,
            ),
            api_key, key_tier, label="timeline generation from files"
        )
        _mark_job_non_refundable_on_cancel(job_id)
        _stamp_files_timeline(timeline, prompt_mode, enable_grounding)
        apply_timeline_result(activity, timeline)
        user_id = _job_owner_id(job_id, user) if job_id else user.get("id")
        dumped = timeline.model_dump(by_alias=True)
        saved = await _persist_timeline_dict(dumped, user=user, target_owner=user_id, existing_meta=None, id_is_server_generated=True)
        _copy_saved_version(saved, dumped)
    logger.info(f"Timeline generated from files successfully (id={timeline.id}, events={len(timeline.articles)}, prompt_mode={prompt_mode})")
    return dumped


@app.post(
    "/api/timeline/generate-from-files/start",
    dependencies=[Depends(timeline_rate_limiter), Depends(file_upload_rate_limiter)],
)
async def start_generate_timeline_from_files(
    request: Request,
    files: List[UploadFile] = File(default=[]),
    text: Optional[str] = Form(None),
    context: Optional[str] = Form(None),
    content_mode: Optional[str] = Form("classic"),
    prompt_mode: Optional[bool] = Form(False),
    enable_grounding: Optional[bool] = Form(False),
    ui_language: Optional[str] = Form(None),
    enable_ai_fallback_images: Optional[bool] = Form(None),
    input_method: Optional[str] = Form(None),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Start a file/photo timeline generation as a cancellable background job and return a job id to poll.
    """
    try:
        client_ip = get_client_ip(request)
        _enforce_concurrent_job_limit(user, client_ip, text_budget=False)
        has_custom_key = is_custom_key_verified(x_gemini_api_key)
        raw_text = (text or "").strip()
        validated_uploads = await validate_and_read_uploads(
            files,
            raw_text,
            request=request,
            user=user,
            has_custom_key=has_custom_key,
            prompt_mode=bool(prompt_mode),
        )
        _attach_uploads_to_slot(request, validated_uploads)
        upload_credits = calculate_upload_credit_cost(
            validated_uploads, raw_text=raw_text, is_chat_or_refine=False
        )
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        api_key, key_tier, is_admin = await run_quota(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip, credits=upload_credits
        )
        incremented_quota = bool(key_tier == "paid" and _quota_counts_usage(user, x_gemini_api_key))
        resolved_mode = "kids" if content_mode == "kids" else "classic"
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(key_tier),
            quota_credits=upload_credits,
        )
        return _launch_ai_job(
            job_id,
            lambda: _execute_generation_from_files(
                validated_uploads=validated_uploads,
                context=context,
                raw_text=raw_text or None,
                resolved_mode=resolved_mode,
                prompt_mode=bool(prompt_mode),
                enable_grounding=bool(enable_grounding),
                ui_language=ui_language,
                enable_ai_fallback_images=enable_ai_fallback_images,
                api_key=api_key,
                key_tier=key_tier,
                user=user,
                job_id=job_id,
                input_method=input_method,
                credits_charged=upload_credits,
            ),
            user,
            label="generate-from-files", budget="upload", upload_slot=_take_over_upload_slot(request),
        )
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error starting generate_from_files job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post(
    "/api/timeline/generate-from-files",
    response_model=TimelineData,
    dependencies=[Depends(timeline_rate_limiter), Depends(file_upload_rate_limiter)],
)
async def generate_timeline_from_files_endpoint(
    request: Request,
    files: List[UploadFile] = File(default=[]),
    text: Optional[str] = Form(None),
    context: Optional[str] = Form(None),
    content_mode: Optional[str] = Form("classic"),
    prompt_mode: Optional[bool] = Form(False),
    enable_grounding: Optional[bool] = Form(False),
    ui_language: Optional[str] = Form(None),
    enable_ai_fallback_images: Optional[bool] = Form(None),
    input_method: Optional[str] = Form(None),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Generate a timeline by extracting content directly from uploaded files (photos of
    book/document pages, scans, PDFs, TXT/MD documents, or personal photos) and/or pasted raw text,
    or from a file/photo prompt (`prompt_mode=True`).
    """
    client_ip = get_client_ip(request)
    key_tier: Optional[str] = None
    upload_credits = 1
    quota_charged = False
    try:
        has_custom_key = is_custom_key_verified(x_gemini_api_key)
        raw_text = (text or "").strip()
        validated_uploads = await validate_and_read_uploads(
            files,
            raw_text,
            request=request,
            user=user,
            has_custom_key=has_custom_key,
            prompt_mode=bool(prompt_mode),
        )
        _attach_uploads_to_slot(request, validated_uploads)

        upload_credits = calculate_upload_credit_cost(
            validated_uploads, raw_text=raw_text, is_chat_or_refine=False
        )
        api_key, key_tier, is_admin = await run_quota(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip, credits=upload_credits
        )
        quota_charged = True
        logger.info(
            f"Generating timeline from {validated_uploads.total_accepted_files} uploaded file(s) + "
            f"{'pasted text' if raw_text else 'no pasted text'} (prompt_mode={prompt_mode}, credits={upload_credits}) for user {user.get('id')} using {key_tier} key (is_admin={is_admin})"
        )

        resolved_mode = "kids" if content_mode == "kids" else "classic"
        extra_kwargs: Dict[str, Any] = {
            "extracted_documents": validated_uploads.extracted_documents or None,
            "total_pdf_pages": validated_uploads.total_pdf_pages,
        }
        if prompt_mode:
            extra_kwargs["prompt_mode"] = True
            extra_kwargs["enable_grounding"] = bool(enable_grounding)
            if ui_language:
                extra_kwargs["ui_language"] = ui_language
        extra_kwargs.update(_generation_limit_kwargs(user, key_tier, enable_ai_fallback_images, source="files", api_key=api_key))

        activity_details: Dict[str, Any] = {
            "file_count": validated_uploads.total_accepted_files,
            "image_count": validated_uploads.image_count,
            "doc_count": validated_uploads.doc_count,
            "has_pasted_text": bool(raw_text),
            "async_job": False,
            "credits_charged": upload_credits,
            "input_method": normalize_input_method(input_method, bool((context or "").strip())),
        }
        if validated_uploads.total_pdf_pages > 0:
            activity_details["pdf_pages"] = validated_uploads.total_pdf_pages

        async with track_ai_activity(
            "generate_from_photo_prompt" if prompt_mode else "generate_from_files", user,
            key_tier=key_tier,
            content_mode=resolved_mode,
            search_mode=search_mode_for(enable_grounding) if prompt_mode else None,
            prompt=context,
            details=activity_details,
        ) as activity:
            timeline = await run_with_key_failover(
                lambda key: generate_timeline_from_files(
                    files=validated_uploads.binary_files,
                    context_prompt=context,
                    raw_text=raw_text or None,
                    api_key=key,
                    content_mode=resolved_mode,
                    **extra_kwargs,
                ),
                api_key, key_tier, label="timeline generation from files"
            )
            _stamp_files_timeline(timeline, bool(prompt_mode), enable_grounding)
            apply_timeline_result(activity, timeline)

            user_id = user.get("id")
            saved = await _persist_timeline_dict(
                timeline.model_dump(by_alias=True), user=user, target_owner=user_id,
                existing_meta=None, id_is_server_generated=True,
            )
            _copy_saved_version(saved, timeline)
        logger.info(f"Timeline generated from files successfully (id={timeline.id}, events={len(timeline.articles)})")
        return timeline
    except asyncio.CancelledError:
        # A dropped request cancels the handler: CancelledError is not an Exception (B-09).
        if quota_charged:
            await asyncio.shield(
                _refund_sync_call_quota(user, client_ip, key_tier, x_gemini_api_key, credits=upload_credits)
            )
        raise
    except InsufficientSubjectInfoError as ie:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, key_tier, x_gemini_api_key, credits=upload_credits)
        raise HTTPException(
            status_code=422,
            detail={"code": ie.code, "subject": ie.subject, "message": str(ie)},
        )
    except HTTPException:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, key_tier, x_gemini_api_key, credits=upload_credits)
        raise
    except ValueError as ve:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, key_tier, x_gemini_api_key, credits=upload_credits)
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, key_tier, x_gemini_api_key, credits=upload_credits)
        logger.error(f"Error in generate_timeline_from_files: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


async def _execute_refine(
    req: RefineTimelineRequest,
    api_key: Optional[str],
    key_tier: str,
    user: Dict[str, Any],
    target_owner: Optional[str] = None,
    existing_meta: Optional[Dict[str, Any]] = None,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    base_updated_at = req.timeline.updatedAt  # the version the client's snapshot was based on
    # The stripped media is read while the model works and put back just before saving (P-09).
    pending_media = _start_media_rehydration(req.timeline, req.media_stripped)
    try:
        async with track_ai_activity(
            "refine_timeline", user,
            key_tier=key_tier,
            content_mode=req.content_mode or req.timeline.contentMode,
            prompt=req.instruction,
            timeline_id=req.timeline.id,
            details={"events_before": len(req.timeline.articles)},
        ) as activity:
            updated_timeline = await run_with_key_failover(
                lambda key: refine_timeline_with_gemini(
                    current_timeline=req.timeline,
                    instruction=req.instruction,
                    api_key=key,
                    content_mode=req.content_mode,
                    **_refine_limit_kwargs(user, key_tier, key),
                ),
                api_key, key_tier, label="timeline refine"
            )
            restored_media = await _finish_media_rehydration(pending_media, updated_timeline)
            pending_media = None
            _mark_job_non_refundable_on_cancel(job_id)
            apply_timeline_result(activity, updated_timeline)
            owner_to_save = target_owner or _job_owner_id(job_id, user)
            dumped = updated_timeline.model_dump(by_alias=True)
            outcome = await _persist_ai_timeline(dumped, user, owner_to_save, existing_meta, base_updated_at)
    finally:
        _discard_media_rehydration(pending_media)
    # The result tells the client whether it was saved, and the version it now is (B-04).
    result = _drop_restored_media(dumped, restored_media)
    result["updatedAt"] = outcome["updatedAt"]
    result["persisted"] = outcome["persisted"]
    if outcome["conflict"]:
        result["conflict"] = True
    return result


@app.post("/api/timeline/refine/start", dependencies=[Depends(timeline_rate_limiter)])
async def start_refine_timeline(
    req: RefineTimelineRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Start a timeline refinement as a background job and return a job id to poll."""
    try:
        timeline_id = req.timeline.id
        target_owner, existing_meta = await _verify_timeline_mutation_target(timeline_id, user)
        client_ip = get_client_ip(request)
        _enforce_concurrent_job_limit(user, client_ip)
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        api_key, key_tier, is_admin = await run_quota(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        incremented_quota = bool(key_tier == "paid" and _quota_counts_usage(user, x_gemini_api_key))
        logger.info(
            f"Starting refine job for timeline {timeline_id} user {user.get('id')} using {key_tier} key "
            f"(is_admin={is_admin})"
        )
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(key_tier),
            timeline_id=timeline_id,
        )
        return _launch_ai_job(
            job_id,
            lambda: _execute_refine(
                req, api_key, key_tier, user,
                target_owner=target_owner,
                existing_meta=existing_meta,
                job_id=job_id,
            ),
            user,
            label="refine",
        )
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error starting refine job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post("/api/timeline/refine", response_model=TimelineData, dependencies=[Depends(timeline_rate_limiter)])
async def refine_timeline_endpoint(
    req: RefineTimelineRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Refine or extend an existing timeline via a natural language instruction.
    Requires authentication. Routes between paid and free Gemini keys based on the shared
    daily AI-operation quota.
    """
    client_ip = get_client_ip(request)
    key_tier: Optional[str] = None
    quota_charged = False
    try:
        timeline_id = req.timeline.id
        target_owner, existing_meta = await _verify_timeline_mutation_target(timeline_id, user)
        api_key, key_tier, is_admin = await run_quota(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        quota_charged = True
        logger.info(
            f"Refining timeline {timeline_id} for user {user.get('id')} using {key_tier} key "
            f"(is_admin={is_admin})"
        )
        await _rehydrate_stripped_timeline_media(req.timeline, req.media_stripped)

        async with track_ai_activity(
            "refine_timeline", user,
            key_tier=key_tier,
            content_mode=req.content_mode or req.timeline.contentMode,
            prompt=req.instruction,
            timeline_id=timeline_id,
            details={"events_before": len(req.timeline.articles)},
        ) as activity:
            updated_timeline = await run_with_key_failover(
                lambda key: refine_timeline_with_gemini(
                    current_timeline=req.timeline,
                    instruction=req.instruction,
                    api_key=key,
                    content_mode=req.content_mode,
                    **_refine_limit_kwargs(user, key_tier, key),
                ),
                api_key, key_tier, label="timeline refine"
            )
            apply_timeline_result(activity, updated_timeline)

            dumped = updated_timeline.model_dump(by_alias=True)
            _ensure_ai_timeline_storable(dumped)
            saved = await _persist_timeline_dict(
                dumped,
                user=user,
                target_owner=target_owner,
                existing_meta=existing_meta,
            )
            _copy_saved_version(saved, updated_timeline)
        return updated_timeline
    except (HTTPException, TimelineGoneError):
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, key_tier, x_gemini_api_key)
        raise
    except ValueError as ve:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, key_tier, x_gemini_api_key)
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, key_tier, x_gemini_api_key)
        logger.error(f"Error in refine_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))

def _resolve_chat_target_article(articles: List[TimelineArticle], ref: Optional[str]) -> Optional[TimelineArticle]:
    """The one event a chat edit names: exact id, else a unique exact (case-insensitive, trimmed)
    title. None when the reference is empty, unknown or ambiguous (B-17)."""
    ref_clean = (ref or "").strip()
    if not ref_clean:
        return None
    by_id = next((a for a in articles if a.id == ref_clean), None)
    if by_id is not None:
        return by_id
    ref_key = ref_clean.casefold()
    title_matches = [a for a in articles if (a.title or "").strip().casefold() == ref_key]
    return title_matches[0] if len(title_matches) == 1 else None


def _resolve_chat_target_ids(articles: List[TimelineArticle], refs: set) -> Optional[set]:
    """Ids of the events a chat delete names, or None unless every reference resolves (B-17)."""
    refs = {r for r in refs if r}
    if not refs:
        return None
    resolved = set()
    for ref in refs:
        art = _resolve_chat_target_article(articles, ref)
        if art is None:
            return None
        resolved.add(art.id)
    return resolved


async def _apply_chat_edit(
    chat_result: TimelineChatOutput,
    current_timeline: TimelineData,
    chat_key: Optional[str],
    chat_tier: str,
    user: Dict[str, Any],
    content_mode: Optional[str] = None,
    target_owner: Optional[str] = None,
    existing_meta: Optional[Dict[str, Any]] = None,
    base_updated_at: Optional[str] = None,
    persist_outcome: Optional[Dict[str, Any]] = None,
    before_persist: Optional[Callable[[TimelineData], Awaitable[None]]] = None,
) -> Optional[TimelineData]:
    """
    Applies an edit resulting from a chat turn.
    Supports fast surgical event edits/deletions/additions directly in Python,
    or falls back to deep timeline refinement via refine_timeline_with_gemini.
    The edit is saved conditioned on `base_updated_at` (B-04); `persist_outcome`, when given, receives
    `persisted` / `conflict` / `updatedAt` and the returned timeline carries the resulting version.
    """
    if chat_result.action != "edit":
        return None

    edit_type = chat_result.edit_type or "timeline_refine"
    owner_to_save = target_owner or user.get("id")

    async def _persist(tl: TimelineData) -> None:
        if before_persist is not None:
            await before_persist(tl)
        outcome = await _persist_ai_timeline(
            tl.model_dump(by_alias=True), user, owner_to_save, existing_meta, base_updated_at,
        )
        tl.updatedAt = outcome["updatedAt"]
        if persist_outcome is not None:
            persist_outcome.update(outcome)

    # 1. Surgical Event Deletion
    if edit_type == "event_delete":
        target_ids = set()
        if chat_result.target_event_id:
            target_ids.add(str(chat_result.target_event_id).strip())
        if chat_result.target_event_ids:
            target_ids.update(str(tid).strip() for tid in chat_result.target_event_ids if tid)

        # Every reference must name exactly one event (exact id, else one exact title); otherwise
        # the surgical path is skipped and deep refine, which sees the whole timeline, decides (B-17).
        resolved_ids = _resolve_chat_target_ids(current_timeline.articles, target_ids)
        if resolved_ids:
            remaining_articles = [a for a in current_timeline.articles if a.id not in resolved_ids]
            # Guardrail: never allow deleting every single event to empty the timeline
            if len(remaining_articles) > 0:
                current_timeline.articles = remaining_articles
                await _persist(current_timeline)
                return current_timeline

    # 2. Surgical Event Edit (dates, title, subtitle, category, lane, rank, location)
    if edit_type == "event_edit" and (chat_result.target_event_id or chat_result.event_edits):
        target_id = str(chat_result.target_event_id).strip() if chat_result.target_event_id else None
        target_art = _resolve_chat_target_article(current_timeline.articles, target_id)

        if target_art and chat_result.event_edits:
            edits = chat_result.event_edits
            updates: Dict[str, Any] = {}

            if edits.title and edits.title.strip():
                updates["title"] = edits.title.strip()
            if edits.subtitle is not None and edits.subtitle.strip():
                updates["subtitle"] = edits.subtitle.strip()
            if edits.category is not None and edits.category.strip():
                updates["category"] = edits.category.strip()
            if edits.lane is not None and edits.lane.strip():
                valid_lane_ids = {l.id for l in current_timeline.lanes}
                if edits.lane.strip() in valid_lane_ids:
                    updates["lane"] = edits.lane.strip()
            if edits.importance_rank is not None:
                updates["rank"] = max(1, min(10, edits.importance_rank))
            if edits.location_name is not None and edits.location_name.strip():
                updates["locationName"] = edits.location_name.strip()

            # Date updates
            new_fy = edits.from_year if edits.from_year is not None else target_art.from_.year
            drop_from_month = bool(edits.from_precision) and edits.from_precision in ("year", "decade", "century", "millennium", "million-years", "billion-years") and edits.from_month is None
            drop_from_day = (drop_from_month or (bool(edits.from_precision) and edits.from_precision == "month")) and edits.from_day is None
            new_fm = edits.from_month if edits.from_month is not None else (None if drop_from_month else target_art.from_.month)
            new_fd = edits.from_day if edits.from_day is not None else (None if drop_from_day else target_art.from_.day)
            new_fp = edits.from_precision or target_art.from_.precision or "year"
            # An explicit coarse precision with no new time means "drop the time of day".
            drop_from_time = bool(edits.from_precision) and edits.from_precision not in SUB_DAY_PRECISIONS and edits.from_hour is None
            new_fh = edits.from_hour if edits.from_hour is not None else (None if drop_from_time else target_art.from_.hour)
            new_fmin = edits.from_minute if edits.from_minute is not None else (None if drop_from_time else target_art.from_.minute)

            new_ty = edits.to_year if edits.to_year is not None else (target_art.to.year if target_art.to else None)
            drop_to_month = bool(edits.to_precision) and edits.to_precision in ("year", "decade", "century", "millennium", "million-years", "billion-years") and edits.to_month is None
            drop_to_day = (drop_to_month or (bool(edits.to_precision) and edits.to_precision == "month")) and edits.to_day is None
            new_tm = edits.to_month if edits.to_month is not None else (None if drop_to_month or not target_art.to else target_art.to.month)
            new_td = edits.to_day if edits.to_day is not None else (None if drop_to_day or not target_art.to else target_art.to.day)
            new_tp = edits.to_precision or (target_art.to.precision if target_art.to else None)
            drop_to_time = bool(edits.to_precision) and edits.to_precision not in SUB_DAY_PRECISIONS and edits.to_hour is None
            new_th = edits.to_hour if edits.to_hour is not None else (None if drop_to_time or not target_art.to else target_art.to.hour)
            new_tmin = edits.to_minute if edits.to_minute is not None else (None if drop_to_time or not target_art.to else target_art.to.minute)
            new_present = edits.is_to_present if edits.is_to_present is not None else (target_art.isToPresent or False)

            from_dict, to_dict, is_present = normalize_event_dates(
                from_year=new_fy,
                from_month=new_fm,
                from_day=new_fd,
                from_precision=new_fp,
                to_year=new_ty,
                to_month=new_tm,
                to_day=new_td,
                to_precision=new_tp,
                is_to_present=new_present,
                from_hour=new_fh,
                from_minute=new_fmin,
                to_hour=new_th,
                to_minute=new_tmin,
            )

            updates["from_"] = timeline_date_from_dict(from_dict)
            updates["to"] = timeline_date_from_dict(to_dict) if to_dict else None
            updates["isToPresent"] = is_present

            updated_art = target_art.model_copy(update=updates)
            updated_articles = [updated_art if a.id == target_art.id else a for a in current_timeline.articles]
            updated_articles.sort(key=lambda a: date_sort_key(a.from_))
            current_timeline.articles = updated_articles
            await _persist(current_timeline)
            return current_timeline

    # 3. Surgical Event Add
    if edit_type == "event_add" and chat_result.new_event:
        if len(current_timeline.articles) >= TIMELINE_MAX_ARTICLES:
            raise TimelineTooLargeError()
        ne = chat_result.new_event
        from_dict, to_dict, is_present = normalize_event_dates(
            from_year=ne.from_year,
            from_month=ne.from_month,
            from_day=ne.from_day,
            from_precision=ne.from_precision or "year",
            to_year=ne.to_year,
            to_month=ne.to_month,
            to_day=ne.to_day,
            to_precision=ne.to_precision,
            is_to_present=ne.is_to_present or False,
            from_hour=ne.from_hour,
            from_minute=ne.from_minute,
            to_hour=ne.to_hour,
            to_minute=ne.to_minute,
        )
        assigned_lane = ne.lane
        valid_lane_ids = {l.id for l in current_timeline.lanes}
        if not assigned_lane or assigned_lane not in valid_lane_ids:
            assigned_lane = current_timeline.lanes[0].id if current_timeline.lanes else "main"

        new_id = f"ev-{uuid.uuid4().hex[:8]}"
        is_fictional = bool(current_timeline.isFictional)
        raw_article = {
            "id": new_id,
            "title": ne.title.strip(),
            "subtitle": (ne.subtitle or "").strip(),
            "lane": assigned_lane,
            "category": (ne.category or "").strip(),
            "from": from_dict,
            "rank": max(1, min(10, ne.importance_rank or 5)),
            "isToPresent": is_present,
            "wikipedia_title": (ne.wikipedia_title or "").strip(),
            "wikipedia_title_en": (ne.wikipedia_title_en or "").strip(),
            "location_name": ne.location_name,
            "is_fictional": is_fictional
        }
        if to_dict:
            raw_article["to"] = to_dict

        enriched = await enrich_events_with_wikipedia(
            [raw_article],
            lang=chat_result.detected_language or "en",
            timeline_topic=current_timeline.title,
            is_timeline_fictional=is_fictional,
            api_key=chat_key,
        )
        item = enriched[0] if enriched else raw_article
        from_d = item.get("from", from_dict)
        to_d = item.get("to")

        from_date = timeline_date_from_dict({"year": ne.from_year, **(from_d or {})})
        to_date = timeline_date_from_dict(to_d) if to_d else None

        loc_name = item.get("location_name")
        lat = item.get("lat")
        lng = item.get("lng")
        google_maps_url = None
        if not is_fictional:
            if lat is not None and lng is not None:
                google_maps_url = f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"
            elif loc_name:
                google_maps_url = f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(loc_name)}"

        created_art = TimelineArticle(
            id=new_id,
            title=item.get("title", ne.title),
            subtitle=item.get("subtitle", ne.subtitle or ""),
            lane=assigned_lane,
            category=item.get("category", ne.category or ""),
            from_=from_date,
            to=to_date,
            isToPresent=is_present,
            imageUrl=item.get("imageUrl"),
            **article_media_kwargs(item),
            wikiTitle=item.get("wikiTitle"),
            wikiTitleEn=item.get("wikiTitleEn"),
            wikiUrl=item.get("wikiUrl"),
            extract=item.get("extract"),
            rank=item.get("rank", 5),
            locationName=loc_name,
            lat=lat,
            lng=lng,
            googleMapsUrl=google_maps_url,
            isFictional=is_fictional
        )
        current_timeline.articles.append(created_art)
        current_timeline.articles.sort(key=lambda a: date_sort_key(a.from_))
        await _persist(current_timeline)
        return current_timeline

    # 4. Deep Refinement (timeline_refine or fallback)
    instruction = chat_result.edit_instruction or chat_result.reply
    if instruction:
        updated_timeline = await run_with_key_failover(
            lambda key: refine_timeline_with_gemini(
                current_timeline=current_timeline,
                instruction=instruction,
                api_key=key,
                content_mode=content_mode,
                **_refine_limit_kwargs(user, chat_tier, key),
            ),
            chat_key, chat_tier, label="chat edit"
        )
        await _persist(updated_timeline)
        return updated_timeline

    return None


async def _run_chat_turn(
    req: TimelineChatRequest,
    chat_key: Optional[str],
    chat_tier: str,
    user: Dict[str, Any],
    async_job: bool,
    target_owner: Optional[str] = None,
    existing_meta: Optional[Dict[str, Any]] = None,
    job_id: Optional[str] = None,
    restored_out: Optional[Dict[str, Any]] = None,
) -> TimelineChatResponse:
    async with track_ai_activity(
        "chat", user,
        key_tier=chat_tier,
        content_mode=req.content_mode or req.timeline.contentMode,
        search_mode=search_mode_for(req.enable_grounding),
        prompt=req.message,
        timeline_id=req.timeline.id,
        details={"history_turns": len(req.history), "async_job": async_job, "input_method": normalize_input_method(req.input_method)},
    ) as activity:
        chat_result, grounding = await run_with_key_failover(
            lambda key: chat_about_timeline(
                current_timeline=req.timeline,
                message=req.message,
                history=req.history,
                api_key=key,
                enable_grounding=req.enable_grounding,
                content_mode=req.content_mode,
            ),
            chat_key, chat_tier, label="timeline chat"
        )
        _mark_job_non_refundable_on_cancel(job_id)

        model_used = getattr(chat_result, "_model_used", None)
        response = TimelineChatResponse(
            reply=chat_result.reply,
            action=chat_result.action,
            grounding=grounding,
            detected_language=chat_result.detected_language or "en",
            is_relevant=chat_result.is_relevant if chat_result.is_relevant is not None else True,
            model=model_used,
        )
        activity["language"] = response.detected_language
        activity["details"].update(
            chat_action=chat_result.action,
            is_relevant=response.is_relevant,
            edit_type=(chat_result.edit_type or "timeline_refine") if chat_result.action == "edit" else None,
        )

        if chat_result.action == "edit":
            base_updated_at = req.timeline.updatedAt  # the version the client's snapshot was based on
            events_before = len(req.timeline.articles)
            persist_outcome: Dict[str, Any] = {}
            # The stripped media is read while the edit runs and put back just before saving (P-09).
            pending_media = _start_media_rehydration(req.timeline, req.media_stripped)

            async def _restore_media(tl: TimelineData) -> None:
                nonlocal pending_media
                restored = await _finish_media_rehydration(pending_media, tl)
                pending_media = None
                if restored_out is not None and restored:
                    restored_out.update(restored)

            try:
                updated_timeline = await _apply_chat_edit(
                    chat_result=chat_result,
                    current_timeline=req.timeline,
                    chat_key=chat_key,
                    chat_tier=chat_tier,
                    user=user,
                    content_mode=req.content_mode,
                    target_owner=target_owner or _job_owner_id(job_id, user),
                    existing_meta=existing_meta,
                    base_updated_at=base_updated_at,
                    persist_outcome=persist_outcome,
                    before_persist=_restore_media,
                )
            finally:
                _discard_media_rehydration(pending_media)
            activity["details"]["edit_applied"] = bool(updated_timeline)
            if updated_timeline:
                response.updated_timeline = updated_timeline
                response.timeline_id = updated_timeline.id
                response.persisted = bool(persist_outcome.get("persisted", True))
                if persist_outcome.get("conflict"):
                    response.conflict = True
                activity["details"]["events_before"] = events_before
                activity["result_count"] = len(updated_timeline.articles)

    return response


async def _execute_chat(
    req: TimelineChatRequest,
    chat_key: Optional[str],
    chat_tier: str,
    x_gemini_api_key: Optional[str],
    client_ip: str,
    user: Dict[str, Any],
    target_owner: Optional[str] = None,
    existing_meta: Optional[Dict[str, Any]] = None,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    restored: Dict[str, Any] = {}
    response = await _run_chat_turn(
        req, chat_key, chat_tier, user, async_job=True,
        target_owner=target_owner, existing_meta=existing_meta, job_id=job_id,
        restored_out=restored,
    )
    result = response.model_dump(by_alias=True)
    if restored and isinstance(result.get("updated_timeline"), dict):
        result["updated_timeline"] = _drop_restored_media(result["updated_timeline"], restored)
    return result


@app.post("/api/timeline/chat/start", dependencies=[Depends(timeline_rate_limiter)])
async def start_chat_timeline(
    req: TimelineChatRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Start a conversational turn as a background job and return a job id to poll."""
    try:
        timeline_id = req.timeline.id
        target_owner, existing_meta = await _verify_timeline_mutation_target(timeline_id, user)
        client_ip = get_client_ip(request)
        _enforce_concurrent_job_limit(user, client_ip)
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        chat_key, chat_tier, is_admin = await run_quota(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        incremented_quota = bool(chat_tier == "paid" and _quota_counts_usage(user, x_gemini_api_key))
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(chat_tier),
            timeline_id=timeline_id,
        )
        return _launch_ai_job(
            job_id,
            lambda: _execute_chat(
                req, chat_key, chat_tier, x_gemini_api_key, client_ip, user,
                target_owner=target_owner, existing_meta=existing_meta, job_id=job_id,
            ),
            user,
            label="chat",
        )
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error starting chat job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post("/api/timeline/chat", response_model=TimelineChatResponse, dependencies=[Depends(timeline_rate_limiter)])
async def chat_timeline_endpoint(
    req: TimelineChatRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Conversational turn about a timeline. The assistant answers questions or applies
    an edit through the refine pipeline. Every AI operation (answer or edit) draws from
    the single shared daily quota bucket, routing between the paid and free Gemini keys.
    """
    client_ip = get_client_ip(request)
    chat_tier: Optional[str] = None
    quota_charged = False
    try:
        timeline_id = req.timeline.id
        target_owner, existing_meta = await _verify_timeline_mutation_target(timeline_id, user)
        chat_key, chat_tier, is_admin = await run_quota(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        quota_charged = True
        return await _run_chat_turn(
            req, chat_key, chat_tier, user, async_job=False,
            target_owner=target_owner, existing_meta=existing_meta,
        )
    except (HTTPException, TimelineGoneError):
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, chat_tier, x_gemini_api_key)
        raise
    except ValueError as ve:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, chat_tier, x_gemini_api_key)
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, chat_tier, x_gemini_api_key)
        logger.error(f"Error in chat_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


async def _execute_quiz(
    req: TimelineQuizRequest,
    quiz_key: Optional[str],
    quiz_tier: str,
    user: Dict[str, Any],
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    if not req.timeline.articles:
        raise ValueError("Cannot generate a quiz for an empty timeline.")

    async with track_ai_activity(
        "generate_quiz", user,
        key_tier=quiz_tier,
        content_mode=req.content_mode or req.timeline.contentMode,
        timeline_id=req.timeline.id,
        language=req.timeline.detectedLanguage,
        details={"fresh_round": bool(req.previous_questions)},
    ) as activity:
        quiz_result = await run_with_key_failover(
            lambda key: generate_timeline_quiz(
                current_timeline=req.timeline,
                previous_questions=req.previous_questions,
                api_key=key,
                content_mode=req.content_mode,
            ),
            quiz_key, quiz_tier, label="timeline quiz"
        )
        _mark_job_non_refundable_on_cancel(job_id)
        activity["result_count"] = len(quiz_result.get("questions") or [])
        activity["language"] = quiz_result.get("detected_language") or activity.get("language")

    _schedule_generated_game_persist(req.timeline.id, user, "quiz", "quizModel", quiz_result.get("questions"), quiz_result)
    return quiz_result


@app.post("/api/timeline/quiz/start", dependencies=[Depends(timeline_rate_limiter)])
async def start_quiz_timeline(
    req: TimelineQuizRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Start on-demand trivia quiz generation as a background job and return a job id to poll."""
    _strip_heavy_media_from_timeline(req.timeline)
    try:
        if not req.timeline.articles:
            raise HTTPException(status_code=400, detail="Timeline has no events to generate a quiz from.")
        client_ip = get_client_ip(request)
        _enforce_concurrent_job_limit(user, client_ip)
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        quiz_key, quiz_tier, is_admin = await run_quota(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        incremented_quota = bool(quiz_tier == "paid" and _quota_counts_usage(user, x_gemini_api_key))
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(quiz_tier),
        )
        return _launch_ai_job(
            job_id,
            lambda: _execute_quiz(req, quiz_key, quiz_tier, user, job_id=job_id),
            user,
            label="quiz",
        )
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error starting quiz job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post("/api/timeline/quiz", response_model=TimelineQuizResponse, dependencies=[Depends(timeline_rate_limiter)])
async def quiz_timeline_endpoint(
    req: TimelineQuizRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Synchronous endpoint for generating an on-demand trivia quiz from a timeline."""
    client_ip = get_client_ip(request)
    quiz_tier: Optional[str] = None
    quota_charged = False
    try:
        if not req.timeline.articles:
            raise HTTPException(status_code=400, detail="Timeline has no events to generate a quiz from.")
        quiz_key, quiz_tier, is_admin = await run_quota(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        quota_charged = True
        result = await _execute_quiz(req, quiz_key, quiz_tier, user)
        return TimelineQuizResponse(**result)
    except HTTPException:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, quiz_tier, x_gemini_api_key)
        raise
    except ValueError as ve:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, quiz_tier, x_gemini_api_key)
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, quiz_tier, x_gemini_api_key)
        logger.error(f"Error in quiz_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


def _discard_task(task: "asyncio.Task") -> None:
    """Stops a speculative task whose result is no longer wanted, and swallows its outcome."""
    if not task.done():
        task.cancel()
    task.add_done_callback(lambda t: t.cancelled() or t.exception())


# Fire-and-forget coroutines (write-behind work) are kept referenced until they finish, so the
# event loop can't garbage-collect them mid-flight.
_BACKGROUND_TASKS: set = set()


def _spawn_background(coro: Any, label: str) -> Optional["asyncio.Task"]:
    try:
        task = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        coro.close()
        return None
    _BACKGROUND_TASKS.add(task)

    def _done(t: "asyncio.Task") -> None:
        _BACKGROUND_TASKS.discard(t)
        if not t.cancelled() and t.exception() is not None:
            logger.warning(f"Background {label} failed: {t.exception()}")

    task.add_done_callback(_done)
    return task


def _schedule_generated_game_persist(
    timeline_id: Optional[str],
    user: Optional[Dict[str, Any]],
    field: str,
    model_field: str,
    value: Any,
    result: Dict[str, Any],
) -> None:
    """P-09: the round is returned right away; storing it on the timeline happens behind it."""
    if not timeline_id or value is None:
        return
    _spawn_background(
        _persist_generated_game(timeline_id, user, field, model_field, value, result),
        f"{field} persist",
    )


async def _persist_generated_game(
    timeline_id: Optional[str],
    user: Optional[Dict[str, Any]],
    field: str,
    model_field: str,
    value: Any,
    result: Dict[str, Any],
) -> None:
    """
    Stores a freshly generated quiz / who-am-I round on the caller's own timeline (non-fatal). On a
    published Library timeline only an admin's round is stored: a non-admin owner still gets the round
    back, but can't change reviewed public content this way (S-15). Other edits unpublish instead.
    """
    if not timeline_id or value is None:
        return
    try:
        meta = await run_storage(get_timeline_with_meta, timeline_id)
        if not meta or not meta.get("data"):
            return
        owner_id = meta.get("owner_id")
        user_id = user.get("id") if user else None
        is_admin = is_admin_user(user)
        if not ((owner_id and user_id and owner_id == user_id) or is_admin):
            return
        if meta.get("is_library") and not is_admin:
            return
        if meta["data"].get("isDeleted") is True or meta["data"].get("is_deleted") is True:
            return  # never resurrect a deleted timeline by attaching a game round to it
        stored_data = dict(meta["data"])
        stored_data[field] = value
        model = (result.get("tokenUsage") or {}).get("model")
        if model:
            stored_data[model_field] = model
        if meta.get("is_library"):
            stored_data["isLibrary"] = True
            stored_data["isFeatured"] = bool(meta.get("is_featured"))
        save_kwargs: Dict[str, Any] = {"user_id": owner_id or user_id, "existing_meta": meta}
        if stored_data.get("updatedAt"):
            # Read-modify-write of the whole row: never clobber an owner save that landed meanwhile (B-04).
            save_kwargs["base_updated_at"] = stored_data["updatedAt"]
        await run_storage(save_timeline_data, stored_data, **save_kwargs)
    except Exception as save_err:
        logger.warning(f"Non-fatal: could not persist {field} on timeline {timeline_id}: {save_err}")


async def _execute_whoami(
    req: TimelineWhoAmIRequest,
    whoami_key: Optional[str],
    whoami_tier: str,
    user: Dict[str, Any],
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    if not req.timeline.articles:
        raise ValueError("Cannot generate a Who Am I game for an empty timeline.")

    async with track_ai_activity(
        "generate_whoami", user,
        key_tier=whoami_tier,
        content_mode=req.content_mode or req.timeline.contentMode,
        timeline_id=req.timeline.id,
        language=req.timeline.detectedLanguage,
        details={"fresh_round": bool(req.previous_event_ids)},
    ) as activity:
        whoami_result = await run_with_key_failover(
            lambda key: generate_timeline_whoami(
                current_timeline=req.timeline,
                previous_event_ids=req.previous_event_ids,
                api_key=key,
                content_mode=req.content_mode,
                image_event_ids=req.image_event_ids,
            ),
            whoami_key, whoami_tier, label="timeline whoami"
        )
        _mark_job_non_refundable_on_cancel(job_id)
        activity["result_count"] = len(whoami_result.get("items") or [])
        activity["language"] = whoami_result.get("detected_language") or activity.get("language")

    _schedule_generated_game_persist(req.timeline.id, user, "whoami", "whoamiModel", whoami_result.get("items"), whoami_result)
    return whoami_result


@app.post("/api/timeline/whoami/start", dependencies=[Depends(timeline_rate_limiter)])
async def start_whoami_timeline(
    req: TimelineWhoAmIRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Start on-demand 'Who/What Event Am I?' mystery game generation as a background job."""
    _strip_heavy_media_from_timeline(req.timeline)
    try:
        if not req.timeline.articles:
            raise HTTPException(status_code=400, detail="Timeline has no events to generate a mystery game from.")
        client_ip = get_client_ip(request)
        _enforce_concurrent_job_limit(user, client_ip)
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        whoami_key, whoami_tier, is_admin = await run_quota(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        incremented_quota = bool(whoami_tier == "paid" and _quota_counts_usage(user, x_gemini_api_key))
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(whoami_tier),
        )
        return _launch_ai_job(
            job_id,
            lambda: _execute_whoami(req, whoami_key, whoami_tier, user, job_id=job_id),
            user,
            label="whoami",
        )
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error starting whoami job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post("/api/timeline/whoami", response_model=TimelineWhoAmIResponse, dependencies=[Depends(timeline_rate_limiter)])
async def whoami_timeline_endpoint(
    req: TimelineWhoAmIRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Synchronous endpoint for generating an on-demand 'Who/What Event Am I?' mystery game."""
    client_ip = get_client_ip(request)
    whoami_tier: Optional[str] = None
    quota_charged = False
    try:
        if not req.timeline.articles:
            raise HTTPException(status_code=400, detail="Timeline has no events to generate a mystery game from.")
        whoami_key, whoami_tier, is_admin = await run_quota(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
        )
        quota_charged = True
        result = await _execute_whoami(req, whoami_key, whoami_tier, user)
        return TimelineWhoAmIResponse(**result)
    except HTTPException:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, whoami_tier, x_gemini_api_key)
        raise
    except ValueError as ve:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, whoami_tier, x_gemini_api_key)
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        if quota_charged:
            await _refund_sync_call_quota(user, client_ip, whoami_tier, x_gemini_api_key)
        logger.error(f"Error in whoami_timeline: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


# --- Podcasts ---------------------------------------------------------------------------------
# Episodes are stored separately from timelines (no read-modify-write races with timeline edits).
# Audio is rendered on the server from the stored script only — clients can never submit
# arbitrary text for synthesis — and each chapter is cached under a content hash, so replays,
# shared links and downloads are free after the first render.

podcast_audio_rate_limiter = SimpleRateLimiter(max_requests=120, window_seconds=60, name="podcast audio")
podcast_stream_rate_limiter = SimpleRateLimiter(max_requests=600, window_seconds=60, name="podcast stream")
podcast_activity_rate_limiter = SimpleRateLimiter(max_requests=30, window_seconds=60, name="podcast activity")
podcast_view_rate_limiter = SimpleRateLimiter(max_requests=120, window_seconds=60, name="podcast view")

MAX_EPISODES_PER_OWNER_TIMELINE = 8
# Across all creators (S-06). At the cap, other people's new episodes are refused; the owner's and
# admins' new episodes are always accepted and make room by pruning the oldest episodes of others.
_DEFAULT_MAX_EPISODES_PER_TIMELINE_TOTAL = 40
_EPISODE_CAP_REACHED_DETAIL = (
    "This timeline already has the maximum number of podcast episodes. "
    "Delete one of yours or ask the timeline's owner to make room."
)
LEGACY_EPISODE_ID = "legacy"
_LEGACY_MAX_SEGMENTS = 55
_LEGACY_MAX_TURNS = 3
_LEGACY_MAX_TURN_CHARS = 1500


def _quota_counts_usage(user: Optional[Dict[str, Any]], custom_key: Optional[str]) -> bool:
    """True when resolve_gemini_key(increment_usage=True) actually records a usage unit for this caller."""
    if (custom_key and custom_key.strip()) or is_admin_user(user):
        return False
    if is_guest_user(user):
        return get_guest_api_key_mode() == "limited"
    return get_api_key_mode() == "limited"


def _podcast_user_id(user: Optional[Dict[str, Any]]) -> Optional[str]:
    return (user or {}).get("id") or None


_ORIG_GET_TIMELINE_WITH_META = get_timeline_with_meta


def _strip_heavy_media_from_timeline(timeline: Optional[TimelineData]) -> None:
    """Drop inline base64 images and bulky unused blobs on text-only AI job payloads (quiz/whoami/podcast)."""
    if timeline is None:
        return
    for attr in ("quiz", "whoami", "podcast", "grounding"):
        if hasattr(timeline, attr):
            setattr(timeline, attr, None)
    extra = getattr(timeline, "__pydantic_extra__", None)
    if isinstance(extra, dict):
        for k in ("quiz", "whoami", "podcast", "grounding"):
            extra.pop(k, None)
    for art in timeline.articles or []:
        art.imageUrl = None
        art.videos = None
        art_extra = getattr(art, "__pydantic_extra__", None)
        if isinstance(art_extra, dict):
            art_extra.pop("additionalImages", None)


_REHYDRATE_TOP_LEVEL_KEYS = ("grounding", "quiz", "whoami", "podcast")


def _collect_stripped_media_markers(timeline: Optional[TimelineData]) -> Dict[str, List[str]]:
    """Pops the transient `_strippedMediaFields` markers (they never enter persisted JSON)."""
    stripped_by_article_id: Dict[str, List[str]] = {}
    for art in (timeline.articles if timeline is not None else None) or []:
        art_extra = getattr(art, "__pydantic_extra__", None)
        if isinstance(art_extra, dict):
            fields = art_extra.pop("_strippedMediaFields", None)
            if isinstance(fields, list) and fields and art.id:
                stripped_by_article_id[art.id] = [str(f) for f in fields]
    return stripped_by_article_id


def _read_stored_media_fields(timeline_id: str, keys: List[str]) -> Optional[Dict[str, Any]]:
    if get_timeline_with_meta is not _ORIG_GET_TIMELINE_WITH_META:  # monkeypatched in unit tests
        meta = get_timeline_with_meta(timeline_id)
        data = meta.get("data") if isinstance(meta, dict) else None
        return {k: data.get(k) for k in keys} if isinstance(data, dict) else None
    return get_timeline_data_fields(timeline_id, keys)


async def _fetch_stored_media(timeline_id: str, keys: List[str]) -> Optional[Dict[str, Any]]:
    try:
        return await run_storage(_read_stored_media_fields, timeline_id, keys)
    except StorageUnavailableError:
        # Persisting without the stripped media would delete it from the stored timeline.
        raise HTTPException(status_code=503, detail=_STORAGE_UNAVAILABLE_DETAIL)


def _apply_stored_media(
    timeline: TimelineData,
    stored_data: Dict[str, Any],
    stripped_by_article_id: Dict[str, List[str]],
) -> Dict[str, Any]:
    """
    Restores stripped article media (`imageUrl`, `additionalImages`, `videos`) by event id and missing
    top-level blobs (`grounding`, `quiz`, `whoami`, `podcast`) from the stored copy. Returns what was
    restored: {"top": [keys], "articles": {event id: [fields]}}.
    """
    restored: Dict[str, Any] = {"top": [], "articles": {}}
    if timeline.grounding is None and isinstance(stored_data.get("grounding"), dict):
        try:
            timeline.grounding = GroundingMetadataPayload.model_validate(stored_data["grounding"])
            restored["top"].append("grounding")
        except Exception:
            pass
    if timeline.quiz is None and isinstance(stored_data.get("quiz"), list):
        try:
            timeline.quiz = [QuizQuestion.model_validate(q) for q in stored_data["quiz"]]
            restored["top"].append("quiz")
        except Exception:
            pass
    if timeline.whoami is None and isinstance(stored_data.get("whoami"), list):
        try:
            timeline.whoami = [WhoAmIItem.model_validate(w) for w in stored_data["whoami"]]
            restored["top"].append("whoami")
        except Exception:
            pass
    if timeline.podcast is None and isinstance(stored_data.get("podcast"), dict):
        try:
            timeline.podcast = PodcastData.model_validate(stored_data["podcast"])
            restored["top"].append("podcast")
        except Exception:
            pass

    stored_articles = stored_data.get("articles")
    if not isinstance(stored_articles, list) or not stripped_by_article_id:
        return restored

    stored_by_id = {
        str(sa.get("id")): sa
        for sa in stored_articles
        if isinstance(sa, dict) and sa.get("id")
    }
    for art in timeline.articles or []:
        fields = stripped_by_article_id.get(art.id)
        stored_art = stored_by_id.get(art.id) if fields else None
        if not fields or not stored_art:
            continue
        done: List[str] = []
        if "imageUrl" in fields and not art.imageUrl and isinstance(stored_art.get("imageUrl"), str):
            art.imageUrl = stored_art["imageUrl"]
            done.append("imageUrl")
        if "videos" in fields and art.videos is None and isinstance(stored_art.get("videos"), list):
            art.videos = stored_art["videos"]
            done.append("videos")
        if "additionalImages" in fields and isinstance(stored_art.get("additionalImages"), list):
            art_extra = getattr(art, "__pydantic_extra__", None)
            if isinstance(art_extra, dict) and "additionalImages" not in art_extra:
                art_extra["additionalImages"] = stored_art["additionalImages"]
                done.append("additionalImages")
        if done:
            restored["articles"][art.id] = done
    return restored


def _stored_media_keys(timeline: TimelineData, stripped_by_article_id: Dict[str, List[str]]) -> List[str]:
    keys = [k for k in _REHYDRATE_TOP_LEVEL_KEYS if getattr(timeline, k, None) is None]
    if stripped_by_article_id:
        keys.append("articles")
    return keys


_PendingMedia = Optional[Tuple["asyncio.Task", Dict[str, List[str]]]]


def _start_media_rehydration(timeline: Optional[TimelineData], media_stripped: bool) -> _PendingMedia:
    """
    P-09: starts reading what the client stripped from the stored row, in parallel with the model
    call; `_finish_media_rehydration` applies it to the result just before it is saved.
    Only the needed `data` keys are read, never the whole row.
    """
    if timeline is None:
        return None
    stripped = _collect_stripped_media_markers(timeline)
    if not media_stripped or not timeline.id:
        return None
    keys = _stored_media_keys(timeline, stripped)
    if not keys:
        return None
    return asyncio.create_task(_fetch_stored_media(timeline.id, keys)), stripped


async def _finish_media_rehydration(pending: _PendingMedia, timeline: TimelineData) -> Optional[Dict[str, Any]]:
    if pending is None:
        return None
    task, stripped = pending
    stored = await task
    if not isinstance(stored, dict):
        return None
    return _apply_stored_media(timeline, stored, stripped)


def _discard_media_rehydration(pending: _PendingMedia) -> None:
    """The result was never saved: stop the read and swallow its outcome."""
    if pending is None:
        return
    task = pending[0]
    if not task.done():
        task.cancel()
    task.add_done_callback(lambda t: t.cancelled() or t.exception())


def _drop_restored_media(dumped: Dict[str, Any], restored: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    P-09: a job result for a client that stripped its media leaves out what the server restored
    (the client puts its own copy back with restoreTimelineMediaFromLocal), so the poll response
    stays small. The saved timeline keeps everything.
    """
    if not restored or not isinstance(dumped, dict) or not (restored.get("top") or restored.get("articles")):
        return dumped
    slim = dict(dumped)
    for key in restored.get("top") or []:
        slim[key] = None
    by_id = restored.get("articles") or {}
    if by_id and isinstance(slim.get("articles"), list):
        new_articles = []
        for art in slim["articles"]:
            fields = by_id.get(art.get("id")) if isinstance(art, dict) else None
            if fields:
                art = dict(art)
                for field in fields:
                    if field == "additionalImages":
                        art.pop("additionalImages", None)
                    else:
                        art[field] = None
            new_articles.append(art)
        slim["articles"] = new_articles
    return slim


async def _rehydrate_stripped_timeline_media(
    timeline: Optional[TimelineData],
    media_stripped: bool = False,
) -> Optional[Dict[str, Any]]:
    """
    When the client omits heavy stored media/blobs on chat or refine requests (`media_stripped=True`),
    restores stripped article media and top-level blobs from the stored timeline before mutating and
    persisting (the sequential form of `_start_media_rehydration`). Always removes the transient
    `_strippedMediaFields` markers. Returns what was restored (see `_apply_stored_media`).
    """
    pending = _start_media_rehydration(timeline, media_stripped)
    try:
        restored = await _finish_media_rehydration(pending, timeline)
        pending = None
        return restored
    finally:
        _discard_media_rehydration(pending)


def _get_timeline_access_meta_sync(timeline_id: str) -> Optional[Dict[str, Any]]:
    if get_timeline_with_meta is not _ORIG_GET_TIMELINE_WITH_META:
        return get_timeline_with_meta(timeline_id)
    return get_timeline_access_meta(timeline_id)


async def _podcast_timeline_meta(timeline_id: str, include_data: bool = False) -> Optional[Dict[str, Any]]:
    if include_data or get_timeline_with_meta is not _ORIG_GET_TIMELINE_WITH_META:
        return await run_storage(get_timeline_with_meta, timeline_id)
    return await run_storage(get_timeline_access_meta, timeline_id)


async def _podcast_timeline_meta_best_effort(timeline_id: str) -> Optional[Dict[str, Any]]:
    """For decorating a response after the episode is saved: an outage must not fail (and refund) the job."""
    try:
        return await _podcast_timeline_meta(timeline_id)
    except StorageUnavailableError:
        return None


def _max_episodes_per_timeline_total() -> int:
    raw = os.getenv("MAX_EPISODES_PER_TIMELINE_TOTAL", "").strip()
    try:
        value = int(raw) if raw else _DEFAULT_MAX_EPISODES_PER_TIMELINE_TOTAL
    except ValueError:
        value = _DEFAULT_MAX_EPISODES_PER_TIMELINE_TOTAL
    return max(MAX_EPISODES_PER_OWNER_TIMELINE, value)


def _can_view_timeline(meta: Optional[Dict[str, Any]], user: Optional[Dict[str, Any]]) -> bool:
    # A timeline that doesn't exist can't carry episodes (S-06).
    if not meta:
        return False
    if is_admin_user(user) or meta.get("is_shared") or meta.get("is_library"):
        return True
    # Unowned rows are viewable only when shared/in the Library (above) or by admins.
    owner = meta.get("owner_id")
    return bool(owner and _podcast_user_id(user) and owner == _podcast_user_id(user))


def _episode_visible(doc: Dict[str, Any], user: Optional[Dict[str, Any]], meta: Optional[Dict[str, Any]]) -> bool:
    """
    Creators see their episodes; the timeline owner sees all; shared/library timelines publish the
    owner's episodes. Unowned timelines publish only admin-created episodes and the legacy podcast.
    """
    if is_admin_user(user):
        return True
    uid = _podcast_user_id(user)
    if uid and doc.get("owner_id") == uid:
        return True
    if not meta:
        return False
    owner = meta.get("owner_id")
    if owner and uid and uid == owner:
        return True
    # Episodes by people other than the owner / an admin are never published to other viewers.
    if podcast_store.is_private_episode_id(doc.get("id")):
        return False
    published = bool(meta.get("is_shared") or meta.get("is_library"))
    if not owner:
        is_legacy = doc.get("id") == LEGACY_EPISODE_ID and doc.get("source") == "legacy"
        return published and (doc.get("created_by_admin") is True or is_legacy)
    return bool(published and doc.get("owner_id") == owner)


def _is_timeline_owner_or_admin(user: Optional[Dict[str, Any]], meta: Optional[Dict[str, Any]]) -> bool:
    if is_admin_user(user):
        return True
    owner = (meta or {}).get("owner_id")
    uid = _podcast_user_id(user)
    return bool(owner and uid and owner == uid)


def _is_protected_episode(doc: Dict[str, Any], meta: Optional[Dict[str, Any]]) -> bool:
    """The owner's and admins' episodes and the legacy podcast: listed first, never pruned for others."""
    if doc.get("created_by_admin") is True:
        return True
    if doc.get("id") == LEGACY_EPISODE_ID and doc.get("source") == "legacy":
        return True
    owner = (meta or {}).get("owner_id")
    return bool(owner and doc.get("owner_id") == owner)


def _order_episodes_for_listing(docs: List[Dict[str, Any]], meta: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    newest_first = sorted(docs, key=lambda d: d.get("created_at") or "", reverse=True)
    return sorted(newest_first, key=lambda d: not _is_protected_episode(d, meta))


def _can_manage_episode(doc: Dict[str, Any], user: Optional[Dict[str, Any]], meta: Optional[Dict[str, Any]]) -> bool:
    if is_admin_user(user):
        return True
    uid = _podcast_user_id(user)
    if not uid:
        return False
    if doc.get("owner_id") == uid:
        return True
    owner = meta.get("owner_id") if meta else None
    return bool(owner and owner == uid)


def _is_gemini_gender_charged(doc: Dict[str, Any], target_gender: Optional[str] = None) -> bool:
    state = (doc.get("audio") or {}).get("gemini") or {}
    doc_gender = podcast_audio.normalize_gender(doc.get("voice_gender"))
    eff_gender = podcast_audio.normalize_gender(target_gender or doc_gender)
    by_gender = state.get("by_gender") or {}
    if eff_gender in by_gender and "charged" in (by_gender[eff_gender] or {}):
        return bool(by_gender[eff_gender].get("charged"))
    charged_genders = state.get("charged_genders")
    if isinstance(charged_genders, list):
        return eff_gender in charged_genders
    return bool(state.get("charged")) and eff_gender == doc_gender


def _mark_gemini_gender_charged(
    d: Dict[str, Any],
    target_gender: str,
    paid_with: Optional[str] = None,
    charge: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Marks the Gemini variant of `target_gender` unlocked. `paid_with` ('credits' | 'byok' | 'admin')
    is given only when this call (re)charges it: the refund markers of any earlier charge are reset
    then (B-10a), and `charge` records who paid how many server credits (for refunds).
    """
    norm_g = podcast_audio.normalize_gender(target_gender)
    s = podcast_audio.variant_state(d, "gemini")
    s["charged"] = True
    cg = list(s.get("charged_genders") or [])
    if norm_g not in cg:
        cg.append(norm_g)
    s["charged_genders"] = cg
    g_state = podcast_audio.gender_variant_state(d, "gemini", norm_g)
    g_state["charged"] = True
    if paid_with:
        s.pop("refunded", None)
        g_state.pop("refunded", None)
        g_state["paid_with"] = paid_with
        if charge and paid_with == "credits":
            g_state["charge"] = charge
        else:
            g_state.pop("charge", None)


def _premium_paid_with(user: Optional[Dict[str, Any]], custom_key: Optional[str], credits: int) -> str:
    if credits > 0:
        return "credits"
    return "byok" if (custom_key and custom_key.strip()) else "admin"


def _premium_charge_record(
    user: Optional[Dict[str, Any]], credits: int, pool_reserved: bool
) -> Optional[Dict[str, Any]]:
    if credits <= 0:
        return None
    return {
        "credits": int(credits),
        "user_id": _podcast_user_id(user),
        "pool": bool(pool_reserved),
        "day": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    }


def _gemini_gender_state(doc: Dict[str, Any], gender: Optional[str]) -> Dict[str, Any]:
    eff = podcast_audio.normalize_gender(gender or doc.get("voice_gender"))
    return ((((doc.get("audio") or {}).get("gemini") or {}).get("by_gender") or {}).get(eff)) or {}


def _is_gemini_gender_server_paid(doc: Dict[str, Any], gender: Optional[str] = None) -> bool:
    """
    May the server's key render this unlocked Gemini variant (for any viewer)? Only when it was paid
    for with server credits (B-10c): a variant unlocked at zero cost by a personal key or an admin
    must not make later viewers spend the server key. Variants unlocked before this was recorded
    (no `paid_with`) keep the earlier behaviour.
    """
    if not _is_gemini_gender_charged(doc, gender):
        return False
    paid_with = _gemini_gender_state(doc, gender).get("paid_with")
    return paid_with in (None, "credits")


def _sync_episode_voice_gender(doc: Dict[str, Any], voice_gender: str) -> None:
    """Update an episode's primary voice gender, host names, and active per-engine clip pointers."""
    new_gender = podcast_audio.normalize_gender(voice_gender)
    old_gender = podcast_audio.normalize_gender(doc.get("voice_gender"))
    for eng in list((doc.get("audio") or {}).keys()):
        podcast_audio.gender_variant_state(doc, eng, old_gender)
    lang = doc.get("detected_language") or "en"
    default_h1, default_h2 = default_host_names(lang, new_gender)
    doc["voice_gender"] = new_gender
    doc["host1_name"] = default_h1
    doc["host2_name"] = default_h2 if doc.get("format") == "duo" else None
    for eng in list((doc.get("audio") or {}).keys()):
        podcast_audio.sync_engine_state_for_gender(doc, eng, new_gender)


def _timeline_articles_sig(timeline: TimelineData) -> str:
    items = [
        (str(a.id or ""), str(a.title or ""), a.from_.year if a.from_ else None)
        for a in (timeline.articles or [])
    ]
    return json.dumps(items, ensure_ascii=False)


async def _find_reusable_episode(
    timeline_id: str,
    req: TimelinePodcastRequest,
    user: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Find an existing episode by this user with identical script parameters (format, length, content_mode, events)."""
    uid = _podcast_user_id(user)
    if not uid:
        return None
    norm_format = "duo" if (req.format or "").lower() == "duo" else "single"
    norm_length = "focused" if (req.length or "").lower() == "focused" else "full"
    eff_mode = normalize_content_mode(req.content_mode or req.timeline.contentMode)
    sig = _timeline_articles_sig(req.timeline)
    article_ids = {str(a.id) for a in (req.timeline.articles or []) if a.id}
    docs = await run_storage(podcast_store.list_episodes, timeline_id, uid)
    for d in docs:
        if d.get("owner_id") != uid or d.get("id") == LEGACY_EPISODE_ID:
            continue
        if (d.get("format") or "single") != norm_format:
            continue
        if (d.get("length") or "full") != norm_length:
            continue
        if normalize_content_mode(d.get("content_mode")) != eff_mode:
            continue
        if not d.get("segments"):
            continue
        if d.get("articles_sig"):
            if d.get("articles_sig") != sig:
                continue
        else:
            ev_ids = [s.get("event_id") for s in d.get("segments") or [] if s.get("type") == "event" and s.get("event_id")]
            if not ev_ids or not all(str(eid) in article_ids for eid in ev_ids):
                continue
        return d
    return None


def _public_episode(
    doc: Dict[str, Any],
    user: Optional[Dict[str, Any]],
    meta: Optional[Dict[str, Any]],
    voice_gender: Optional[str] = None,
) -> Dict[str, Any]:
    doc_gender = podcast_audio.normalize_gender(doc.get("voice_gender"))
    active_gender = podcast_audio.normalize_gender(voice_gender or doc_gender)
    audio_public = {}
    for engine, state in (doc.get("audio") or {}).items():
        if engine not in ENGINES:
            continue
        by_gender = state.get("by_gender") or {}
        lease_state: Dict[str, Any] = state
        if active_gender in by_gender:
            g_state = by_gender[active_gender]
            lease_state = g_state
            clips = g_state.get("clips") or {}
            status_val = g_state.get("status", "pending")
            total_dur = g_state.get("total_duration")
        elif active_gender == doc_gender:
            clips = state.get("clips") or {}
            status_val = state.get("status", "pending")
            total_dur = state.get("total_duration")
        else:
            clips = {}
            status_val = "pending"
            total_dur = None
        is_rendering = podcast_audio.is_variant_rendering(doc["id"], engine, active_gender)
        if status_val == "rendering" and not is_rendering and podcast_audio.render_lease_expired(lease_state):
            # Nothing is rendering it any more (restart, crash): resumable, not "rendering" forever (B-22).
            status_val = "partial"
        variant_cost_usd = round(
            sum(float((c or {}).get("cost_usd") or 0.0) for c in clips.values()),
            6,
        )
        variant_model = (
            next((c.get("model") for c in clips.values() if c.get("model")), None)
            or (by_gender[active_gender].get("model") if active_gender in by_gender else state.get("model"))
        )
        audio_public[engine] = {
            "status": "rendering" if is_rendering else status_val,
            "unlocked": engine != "gemini" or _is_gemini_gender_charged(doc, active_gender),
            # Each voice gender of a premium variant is paid for separately (B-10b).
            "unlocked_genders": {
                g: engine != "gemini" or _is_gemini_gender_charged(doc, g) for g in ("male", "female")
            },
            "clips": {
                sid: {k: c.get(k) for k in ("key", "duration", "engine", "fallback_from")}
                for sid, c in clips.items()
            },
            "rendered_clips": len(clips),
            "total_duration": total_dur,
            "cost_usd": variant_cost_usd,
            "model": variant_model,
        }
    lang = doc.get("detected_language") or "en"
    default_h1, default_h2 = default_host_names(lang, active_gender)
    # Host names are fixed per language and lead-voice gender (never model-invented), so older episodes match too.
    host1_name = default_h1
    host2_name = default_h2 if doc.get("format") == "duo" else None
    raw_script_cost = doc.get("script_cost_usd")
    if raw_script_cost is None and isinstance(doc.get("tokenUsage"), dict):
        raw_script_cost = doc["tokenUsage"].get("estimatedCostUsd")
    script_cost_usd = round(float(raw_script_cost), 6) if raw_script_cost is not None else None
    return {
        "id": doc["id"],
        "timeline_id": doc["timeline_id"],
        "title": doc.get("title") or "",
        "format": doc.get("format") or "single",
        "voice_gender": active_gender,
        "length": doc.get("length") or "full",
        "content_mode": doc.get("content_mode") or "classic",
        "default_engine": normalize_engine(doc.get("default_engine")),
        "host1_name": host1_name,
        "host2_name": host2_name,
        "detected_language": doc.get("detected_language") or "en",
        "music_mood": normalize_music_mood(doc.get("music_mood"), doc.get("content_mode"), doc.get("id")),
        "segments": doc.get("segments") or [],
        "audio": audio_public,
        "estimates": doc.get("estimates") or {},
        "source": doc.get("source") or "generated",
        "created_at": doc.get("created_at"),
        "is_mine": bool(_podcast_user_id(user) and doc.get("owner_id") == _podcast_user_id(user)),
        "can_manage": _can_manage_episode(doc, user, meta),
        "model": doc.get("model") or (doc.get("tokenUsage") or {}).get("model") or (doc.get("script") or {}).get("model"),
        "script_cost_usd": script_cost_usd,
        "tokenUsage": doc.get("tokenUsage"),
    }


def _legacy_episode_from_timeline(timeline_id: str, data: Dict[str, Any], owner_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """Convert a podcast script embedded on a timeline (pre-episode storage) into an episode document."""
    pod = data.get("podcast") if isinstance(data, dict) else None
    if not isinstance(pod, dict) or not pod.get("segments"):
        return None
    fmt = "duo" if pod.get("format") == "duo" else "single"
    segments = []
    for seg in (pod.get("segments") or [])[:_LEGACY_MAX_SEGMENTS]:
        if not isinstance(seg, dict):
            continue
        turns = []
        for t in (seg.get("turns") or [])[:_LEGACY_MAX_TURNS]:
            text = clean_spoken_text(str((t or {}).get("text") or ""))[:_LEGACY_MAX_TURN_CHARS]
            if text:
                speaker = "host2" if (fmt == "duo" and (t or {}).get("speaker") == "host2") else "host1"
                turns.append({"speaker": speaker, "text": text})
        if not turns:
            continue
        seg_type = seg.get("type") if seg.get("type") in ("intro", "event", "outro") else "event"
        segments.append({
            "id": f"seg-{len(segments) + 1}",
            "type": seg_type,
            "event_id": (str(seg.get("event_id"))[:120] if seg.get("event_id") and seg_type == "event" else None),
            "chapter_title": str(seg.get("chapter_title") or "")[:200],
            "turns": turns,
        })
    if not segments:
        return None
    engine = normalize_engine(pod.get("tts_engine"))
    engine = "edge" if engine == "gemini" else engine
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": LEGACY_EPISODE_ID,
        "timeline_id": str(timeline_id),
        "owner_id": owner_id,
        "created_at": pod.get("created_at") or now,
        "updated_at": now,
        "source": "legacy",
        "title": str(pod.get("title") or data.get("title") or "")[:300],
        "format": fmt,
        "voice_gender": "female" if pod.get("voice_gender") == "female" else "male",
        "length": "focused" if pod.get("length") == "focused" else "full",
        "content_mode": "kids" if data.get("contentMode") == "kids" else "classic",
        "default_engine": engine,
        "host1_name": str(pod.get("host1_name") or "")[:80],
        "host2_name": (str(pod.get("host2_name"))[:80] if fmt == "duo" and pod.get("host2_name") else None),
        "detected_language": str(pod.get("detected_language") or data.get("detectedLanguage") or "en")[:5],
        "segments": segments,
        "audio": {},
        "estimates": {},
    }


async def _load_visible_episode(
    timeline_id: str, episode_id: str, user: Optional[Dict[str, Any]]
) -> tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    if not podcast_store.is_valid_episode_id(episode_id):
        raise HTTPException(status_code=404, detail="Podcast episode not found")
    meta = await _podcast_timeline_meta(timeline_id)
    if not _can_view_timeline(meta, user):
        raise HTTPException(status_code=404, detail="Podcast episode not found")
    doc = await run_storage(podcast_store.get_episode, timeline_id, episode_id)
    if not doc and episode_id == LEGACY_EPISODE_ID and meta and (meta.get("data") or meta.get("has_legacy_podcast")):
        full_meta = meta if meta.get("data") else await _podcast_timeline_meta(timeline_id, include_data=True)
        if full_meta and full_meta.get("data"):
            meta = full_meta
    if not doc and episode_id == LEGACY_EPISODE_ID and meta and meta.get("data"):
        doc = _legacy_episode_from_timeline(timeline_id, meta["data"], meta.get("owner_id"))
        if doc:
            await run_bulk(podcast_store.save_episode, doc)
    if not doc or not _episode_visible(doc, user, meta):
        raise HTTPException(status_code=404, detail="Podcast episode not found")
    return doc, meta


def _resolve_podcast_gemini_key_and_tier(
    custom_key: Optional[str],
    is_admin: bool = False,
    allow_server_key: bool = False,
) -> tuple[Optional[str], Optional[str]]:
    """Resolve the Gemini API key and billing tier used for podcast TTS rendering."""
    if custom_key and custom_key.strip():
        return custom_key.strip(), "custom"
    if is_admin:
        return (os.getenv("GEMINI_API_KEY", "").strip() or None), "admin_paid"
    if allow_server_key:
        paid_key = os.getenv("GEMINI_API_KEY", "").strip()
        free_key = get_next_free_key()
        if free_key and (not paid_key or free_key != paid_key):
            return free_key, "free"
        if paid_key:
            return paid_key, "paid"
        return free_key, "free"
    return None, None


def _gemini_key_runner(custom_key: Optional[str], is_admin: bool = False, allow_server_key: bool = False):
    """API-key failover wrapper for Gemini TTS renders (requires personal key, admin, or server key when permitted)."""
    key, tier = _resolve_podcast_gemini_key_and_tier(custom_key, is_admin=is_admin, allow_server_key=allow_server_key)
    if not tier:
        async def unauthorized_runner(op):
            raise PermissionError("Gemini audio generation requires a personal API key or unlocked quota.")
        return unauthorized_runner

    async def runner(op):
        return await run_with_key_failover(op, key, tier, label="podcast gemini tts")

    return runner


def _count_episode_event_segments(doc: Optional[Dict[str, Any]]) -> Optional[int]:
    """Count timeline-event chapters in a podcast script/episode document (excluding intro/outro)."""
    if not isinstance(doc, dict):
        return None
    segs = doc.get("segments")
    if not isinstance(segs, list) or not segs:
        return None
    return sum(
        1
        for s in segs
        if isinstance(s, dict) and (s.get("type") == "event" or bool(s.get("event_id")))
    )


def _min_optional_counts(*counts: Optional[int]) -> Optional[int]:
    present = [int(c) for c in counts if c is not None]
    return min(present) if present else None


def _resolve_podcast_gemini_audio_cost(
    length: Optional[str] = None,
    event_count: Optional[int] = None,
) -> int:
    """
    Returns the integer credit cost for Gemini TTS podcast audio:
    - 'focused' ("עיקרי הדברים") OR short timelines/episodes (<= PODCAST_FOCUSED_MAX_EVENTS = 12 events):
      `get_gemini_audio_credit_cost()` (default 10 credits).
    - 'full' ("הסיפור המלא") with > 12 events:
      `get_gemini_audio_full_credit_cost()` (default 20 credits).
    """
    norm_length = (length or "focused").strip().lower()
    if norm_length == "focused" or (
        event_count is not None and event_count <= PODCAST_FOCUSED_MAX_EVENTS
    ):
        return get_gemini_audio_credit_cost()
    return get_gemini_audio_full_credit_cost()


def _charge_premium_audio(
    user: Dict[str, Any],
    custom_key: Optional[str],
    client_ip: Optional[str],
    length: Optional[str] = None,
    event_count: Optional[int] = None,
    raise_if_store_unavailable: bool = False,
) -> tuple[bool, bool, bool, int]:
    """
    Authorizes premium (Gemini) audio on an episode.
    - Personal key (BYOK) or admin: always permitted without consuming server quota (any length).
    - Server premium credits: permitted for both 'focused' (10 credits) and 'full' (20 credits, or 10
      credits when the timeline/episode has <= 12 events) whenever the user has sufficient credits.
    - Usage store down (SC-09): declined; with `raise_if_store_unavailable` as a 503 instead of the
      caller's "not enough credits" handling.
    Returns (allowed, incremented, pool_reserved, credits_charged).
    """
    has_custom = bool(custom_key and custom_key.strip())
    is_admin = is_admin_user(user)
    if has_custom or is_admin:
        return True, False, False, 0

    audio_cost = _resolve_podcast_gemini_audio_cost(length=length, event_count=event_count)
    allowed, _, key_tier, incremented, pool_reserved = charge_premium_credits(
        user, None, client_ip=client_ip, credits=audio_cost
    )
    if not allowed and raise_if_store_unavailable and key_tier == QUOTA_STORE_UNAVAILABLE_TIER:
        raise HTTPException(
            status_code=503,
            detail=(
                "Premium AI voices are briefly unavailable and your credits were not used. "
                "Please choose a free voice engine or try again in a moment."
            ),
            headers={"Retry-After": str(QUOTA_STORE_RETRY_AFTER_SECONDS)},
        )
    if not allowed:
        return False, False, False, 0

    return True, incremented, pool_reserved, audio_cost


def _variant_completion_hook(
    user: Dict[str, Any],
    client_ip: Optional[str],
    engine: str,
    refund_if_no_premium: bool,
    voice_gender: Optional[str] = None,
    key_tier: Optional[str] = None,
    refund_pool: bool = False,
    charged_credits: int = 0,
):
    async def hook(
        doc: Dict[str, Any], rendered: Optional[Dict[str, Any]] = None, pass_finished: bool = True
    ) -> None:
        state = (doc.get("audio") or {}).get(engine) or {}
        target_gender = podcast_audio.normalize_gender(voice_gender or doc.get("voice_gender"))
        g_state = (state.get("by_gender") or {}).get(target_gender)
        source = g_state if g_state is not None else state
        clips = list((source.get("clips") or {}).values())
        status = source.get("status")
        # On-demand rendering (SC-15) runs several passes per variant: each clip's cost is metered
        # once, by the first pass that sees it.
        metered = set(source.get("metered_keys") or [])
        new_clips = [c for c in clips if c.get("key") and c.get("key") not in metered]
        if new_clips or rendered is None:
            fallbacks = sum(1 for c in new_clips if c.get("fallback_from"))
            total_cost = sum(float(c.get("cost_usd") or 0) for c in new_clips)
            total_in_tok = sum(int(c.get("input_tokens") or 0) for c in new_clips)
            total_out_tok = sum(int(c.get("output_tokens") or 0) for c in new_clips)
            total_think_tok = sum(int(c.get("thinking_tokens") or 0) for c in new_clips)
            clip_model = next((str(c.get("model")).strip() for c in new_clips if c.get("model")), "")
            model_label = clip_model or f"tts:{engine}"
            async with track_ai_activity(
                "podcast_audio", user,
                key_tier=key_tier,
                content_mode=doc.get("content_mode"),
                timeline_id=doc.get("timeline_id"),
                language=doc.get("detected_language"),
                details={"engine": engine, "episode_id": doc.get("id"), "fallbacks": fallbacks, "status": status},
            ) as rec:
                rec["result_count"] = len(new_clips)
                record_extra_cost(
                    total_cost,
                    model=model_label,
                    input_tokens=total_in_tok,
                    output_tokens=total_out_tok,
                    thinking_tokens=total_think_tok,
                )
            if new_clips and doc.get("timeline_id"):
                keys = sorted(metered | {c["key"] for c in new_clips})

                def _mark_metered(d: Dict[str, Any]) -> None:
                    podcast_audio.gender_variant_state(d, engine, target_gender)["metered_keys"] = keys

                try:
                    await podcast_audio.update_episode(doc["timeline_id"], doc["id"], _mark_metered)
                except Exception as e:
                    logger.debug(f"Could not record metered podcast clips on {doc.get('id')}: {e}")
        # Gender-level only: the engine-level flag is shared by both voices and would block the other's refund.
        already_refunded = bool((g_state or {}).get("refunded"))
        # On demand (SC-15) a finished pass may leave the variant "partial": if everything it
        # rendered so far fell back to a free voice, the premium charge bought nothing (B-10a).
        settled = status not in ("partial", "pending") or bool(rendered and pass_finished and status == "partial")
        if (
            engine == "gemini"
            and (refund_if_no_premium or refund_pool)
            and settled
            and not already_refunded
            and not any(c.get("engine") == "gemini" for c in clips)
        ):
            credits_to_refund = charged_credits or get_gemini_audio_credit_cost()
            if refund_if_no_premium:
                await run_quota(
                    refund_user_quota, user, client_ip=client_ip, refund_pool=refund_pool, credits=credits_to_refund
                )
            elif refund_pool:
                await run_quota(refund_community_paid_prompt, credits=credits_to_refund)

            await podcast_audio.update_episode(
                doc["timeline_id"], doc["id"], lambda d: _mark_gemini_gender_refunded(d, engine, target_gender)
            )
            logger.info(
                f"Refunded {credits_to_refund} premium audio credit(s) for episode {doc.get('id')} ({target_gender}) "
                "(no Gemini chapters rendered)."
            )

    return hook


def _mark_gemini_gender_refunded(d: Dict[str, Any], engine: str, target_gender: str) -> None:
    vs = podcast_audio.variant_state(d, engine)
    # Informational at engine level (the next charge resets it); refund checks read the gender's flag.
    vs["refunded"] = True
    gs = podcast_audio.gender_variant_state(d, engine, target_gender)
    gs["refunded"] = True
    gs["charged"] = False
    gs.pop("charge", None)
    gs.pop("paid_with", None)
    cg = [g for g in (vs.get("charged_genders") or []) if g != target_gender]
    vs["charged_genders"] = cg
    if not cg:
        vs["charged"] = False


async def _refund_stale_premium_renders(
    doc: Dict[str, Any], user: Optional[Dict[str, Any]], client_ip: Optional[str]
) -> Dict[str, Any]:
    """
    A premium render that died with the process (no live task, lease expired) never reached its
    completion hook. When the payer looks at the episode the same day and no Gemini chapter was
    produced, refund them here, exactly as the hook would have (B-22).
    """
    uid = _podcast_user_id(user)
    if not uid:
        return doc
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for gender in ("male", "female"):
        g_state = _gemini_gender_state(doc, gender)
        charge = g_state.get("charge") or {}
        if (
            g_state.get("status") != "rendering"
            or g_state.get("refunded")
            or charge.get("user_id") != uid
            or charge.get("day") != today
            or not int(charge.get("credits") or 0)
            or podcast_audio.is_variant_rendering(doc["id"], "gemini", gender)
            or not podcast_audio.render_lease_expired(g_state)
            or any((c or {}).get("engine") == "gemini" for c in (g_state.get("clips") or {}).values())
        ):
            continue
        claimed = {"charge": None}

        def _claim(d: Dict[str, Any], g: str = gender) -> None:
            gs = _gemini_gender_state(d, g)
            if gs.get("refunded") or gs.get("status") != "rendering" or not gs.get("charge"):
                return
            claimed["charge"] = dict(gs["charge"])
            _mark_gemini_gender_refunded(d, "gemini", g)
            podcast_audio.gender_variant_state(d, "gemini", g)["status"] = "partial" if gs.get("clips") else "pending"

        updated = await podcast_audio.update_episode(doc["timeline_id"], doc["id"], _claim)
        if updated and claimed["charge"]:
            credits = int(claimed["charge"].get("credits") or 0)
            await run_quota(
                refund_user_quota, user, client_ip=client_ip,
                refund_pool=bool(claimed["charge"].get("pool")), credits=credits,
            )
            logger.info(f"Refunded {credits} premium audio credit(s) for stalled episode render {doc.get('id')} ({gender}).")
            doc = updated
    return doc


def _can_render_variant(
    doc: Dict[str, Any], engine: str, gender: str, user: Optional[Dict[str, Any]],
    custom_key: Optional[str], charged_credits: int = 0,
) -> bool:
    """
    Can this caller render the variant? Free engines always; Gemini with their own key, as an admin,
    or on the server key when the variant was paid for with server credits (now or earlier). A
    variant unlocked at zero cost by someone's own key (or an admin) is not rendered on the server
    key for other callers: what is already rendered stays playable (B-10c).
    """
    if engine != "gemini":
        return True
    return bool(
        (custom_key and custom_key.strip())
        or is_admin_user(user)
        or charged_credits > 0
        or _is_gemini_gender_server_paid(doc, gender)
    )


def _start_variant_render(
    doc: Dict[str, Any],
    engine: str,
    user: Dict[str, Any],
    custom_key: Optional[str],
    client_ip: Optional[str],
    refund_if_no_premium: bool = False,
    voice_gender: Optional[str] = None,
    refund_pool: bool = False,
    charged_credits: int = 0,
) -> None:
    target_gender = podcast_audio.normalize_gender(voice_gender or doc.get("voice_gender"))
    is_admin = is_admin_user(user)
    is_charged = (
        engine == "gemini" and (_is_gemini_gender_server_paid(doc, target_gender) or charged_credits > 0)
    ) or refund_if_no_premium
    if not _can_render_variant(doc, engine, target_gender, user, custom_key, charged_credits or int(refund_if_no_premium)):
        return
    _, gemini_tier = (
        _resolve_podcast_gemini_key_and_tier(custom_key, is_admin=is_admin, allow_server_key=is_charged)
        if engine == "gemini"
        else (None, None)
    )
    podcast_audio.ensure_variant_render(
        doc["timeline_id"], doc["id"], engine,
        key_runner=_gemini_key_runner(custom_key, is_admin=is_admin, allow_server_key=is_charged) if engine == "gemini" else None,
        on_complete=_variant_completion_hook(
            user, client_ip, engine, refund_if_no_premium,
            voice_gender=target_gender, key_tier=gemini_tier, refund_pool=refund_pool,
            charged_credits=charged_credits,
        ),
        voice_gender=target_gender,
        owner_id=_podcast_user_id(user),
        # On demand (SC-15): the opening chapters now, the rest as they are played.
        segment_ids=podcast_audio.prefetch_window(doc.get("segments") or []),
    )


async def _prefetch_following_chapters(
    doc: Dict[str, Any],
    segment_id: str,
    engine: str,
    gender: str,
    user: Optional[Dict[str, Any]],
    custom_key: Optional[str],
    client_ip: Optional[str],
    key_runner: Any,
) -> None:
    """Playing chapter N renders N+1..N+PODCAST_PREFETCH_CHAPTERS in the background (SC-15), with the
    same key the listener's own chapter request was allowed to use. Billing is unchanged: a premium
    unlock already paid for every chapter, and free engines cost no credits."""
    window = podcast_audio.prefetch_window(doc.get("segments") or [], from_segment_id=segment_id)[1:]
    if not window or not doc.get("timeline_id"):
        return
    clips = podcast_audio._variant_clips_map(doc, engine, gender)
    by_id = {s.get("id"): s for s in doc.get("segments") or []}
    missing = []
    for sid in window:
        seg = by_id.get(sid)
        if seg is None:
            continue
        key = podcast_audio.clip_key(engine, doc, seg, voice_gender=gender)
        if (clips.get(sid) or {}).get("key") == key:
            continue
        # Already stored (rendered for another listener, or not yet recorded on the episode): no work.
        if await run_storage(podcast_store.get_clip_meta, key):
            continue
        missing.append(sid)
    if not missing:
        return
    is_admin = is_admin_user(user) if user else False
    _, gemini_tier = (
        _resolve_podcast_gemini_key_and_tier(
            custom_key, is_admin=is_admin, allow_server_key=_is_gemini_gender_server_paid(doc, gender)
        )
        if engine == "gemini"
        else (None, None)
    )
    podcast_audio.ensure_variant_render(
        doc["timeline_id"], doc["id"], engine,
        key_runner=key_runner,
        on_complete=_variant_completion_hook(
            user or {}, client_ip, engine, False, voice_gender=gender, key_tier=gemini_tier,
        ),
        voice_gender=gender,
        owner_id=_podcast_user_id(user),
        segment_ids=missing,
    )


async def _prune_old_episodes(
    timeline_id: str, owner_id: Optional[str], meta: Optional[Dict[str, Any]]
) -> None:
    """
    Keeps each creator's newest MAX_EPISODES_PER_OWNER_TIMELINE episodes, then trims the timeline to
    the total cap by dropping the oldest unprotected (other people's) episodes. Without the
    timeline's meta (storage outage) the owner is unknown, so the total cap waits for the next save.
    """
    # Index entries carry id, owner, creation time and the protection flags: no document reads (B-15).
    docs = await run_storage(podcast_store.get_episode_index, timeline_id)
    doomed: Dict[str, Dict[str, Any]] = {}
    mine = [d for d in docs if d.get("owner_id") == owner_id and d.get("id") != LEGACY_EPISODE_ID]
    for old in mine[MAX_EPISODES_PER_OWNER_TIMELINE:]:
        doomed[old["id"]] = old
    remaining = [d for d in docs if d.get("id") not in doomed]
    excess = len(remaining) - _max_episodes_per_timeline_total()
    if excess > 0 and meta is not None:
        oldest_first = sorted(remaining, key=lambda d: d.get("created_at") or "")
        removable = [d for d in oldest_first if not _is_protected_episode(d, meta)]
        for old in removable[:excess]:
            doomed[old["id"]] = old
    for old_id in doomed:
        await podcast_audio.delete_episode(timeline_id, old_id)


def _podcast_max_events_for(
    user: Optional[Dict[str, Any]],
    custom_key: Optional[str],
    req: TimelinePodcastRequest,
) -> Optional[int]:
    """
    'full' episodes for unlimited callers (admin / BYOK) cover EVERY event on the timeline; limited
    tiers keep their tier cap. 'focused' (highlights) keeps its default short cap for everyone.
    """
    if (req.length or "full").strip().lower() == "focused":
        return None
    ent = get_entitlements(user, custom_key)
    if ent.is_unlimited:
        return max(1, len(req.timeline.articles or []))
    return ent.podcast_full_max_events


async def _execute_podcast_episode(
    timeline_id: str,
    req: TimelinePodcastRequest,
    script_key: Optional[str],
    script_tier: str,
    user: Dict[str, Any],
    custom_key: Optional[str],
    client_ip: Optional[str],
    reusable_episode_id: Optional[str] = None,
    job_id: Optional[str] = None,
    creator_is_owner_or_admin: bool = False,
) -> Dict[str, Any]:
    target_gender = podcast_audio.normalize_gender(req.voice_gender)
    tl_lang = detect_effective_language(
        f"{req.timeline.title or ''} {req.timeline.description or ''}",
        req.timeline.detectedLanguage or "en",
    )
    await ensure_gcloud_remaining_chars_fresh()
    default_free_eng = default_engine_for_language(tl_lang)
    engine = normalize_engine(req.tts_engine, default=default_free_eng)
    notice = None
    premium_incremented = False
    premium_pool_reserved = False
    premium_credits = 0

    if reusable_episode_id:
        existing = await run_storage(podcast_store.get_episode, timeline_id, reusable_episode_id)
        if existing:
            already_charged_for_gender = _is_gemini_gender_charged(existing, target_gender)
            if engine == "gemini" and not already_charged_for_gender:
                eff_len = (req.length or existing.get("length") or "full").strip().lower()
                tl_events = len(req.timeline.articles or []) if req.timeline and req.timeline.articles is not None else None
                eff_events = _min_optional_counts(_count_episode_event_segments(existing), tl_events)
                allowed, premium_incremented, premium_pool_reserved, premium_credits = await run_quota(
                    _charge_premium_audio, user, custom_key, client_ip, eff_len, eff_events
                )
                if not allowed:
                    engine = default_engine_for_language(existing.get("detected_language") or tl_lang)
                    notice = "premium_quota_exhausted"

            newly_charged = engine == "gemini" and not already_charged_for_gender
            will_render = _can_render_variant(existing, engine, target_gender, user, custom_key, premium_credits)

            def _reuse_mutate(d: Dict[str, Any]) -> None:
                _sync_episode_voice_gender(d, target_gender)
                d["default_engine"] = engine
                d["articles_sig"] = _timeline_articles_sig(req.timeline)
                podcast_audio.variant_state(d, engine)
                if engine == "gemini":
                    _mark_gemini_gender_charged(
                        d, target_gender,
                        paid_with=_premium_paid_with(user, custom_key, premium_credits) if newly_charged else None,
                        charge=_premium_charge_record(user, premium_credits, premium_pool_reserved),
                    )
                g_state = podcast_audio.gender_variant_state(d, engine, target_gender)
                if will_render and not podcast_audio.variant_is_complete(d, engine, target_gender):
                    g_state["status"] = "rendering"
                    podcast_audio.touch_render_lease(g_state)
                podcast_audio.sync_engine_state_for_gender(d, engine, target_gender)

            doc = await podcast_audio.update_episode(timeline_id, reusable_episode_id, _reuse_mutate) or existing
            # A fresh charge always runs the render pass (cache hits when complete), so its completion
            # hook can refund a variant made only of fallback chapters (B-10a).
            if premium_credits > 0 or not podcast_audio.variant_is_complete(doc, engine, target_gender):
                _start_variant_render(
                    doc, engine, user, custom_key, client_ip,
                    refund_if_no_premium=premium_incremented,
                    voice_gender=target_gender,
                    refund_pool=premium_pool_reserved,
                    charged_credits=premium_credits,
                )
            meta = await _podcast_timeline_meta_best_effort(timeline_id)
            return {"episode": _public_episode(doc, user, meta), "notice": notice, "reused_script": True}

    async with track_ai_activity(
        "generate_podcast", user,
        key_tier=script_tier,
        content_mode=req.content_mode or req.timeline.contentMode,
        timeline_id=timeline_id,
        language=req.timeline.detectedLanguage,
        details={"format": req.format, "voice_gender": req.voice_gender, "length": req.length, "tts_engine": req.tts_engine},
    ) as activity:
        result = await run_with_key_failover(
            lambda key: generate_timeline_podcast(
                current_timeline=req.timeline,
                format_mode=req.format,
                voice_gender=req.voice_gender,
                length=req.length,
                api_key=key,
                content_mode=req.content_mode,
                max_events=_podcast_max_events_for(user, custom_key, req),
            ),
            script_key, script_tier, label="timeline podcast",
        )
        _mark_job_non_refundable_on_cancel(job_id)
        script = result["script"]
        activity["result_count"] = len(script["segments"])
        activity["language"] = script.get("detected_language") or activity.get("language")
        activity["details"].update(result.get("estimates") or {})

    if not req.tts_engine:
        engine = default_engine_for_language(script.get("detected_language") or tl_lang)

    if engine == "gemini":
        eff_len = (req.length or "full").strip().lower()
        tl_events = len(req.timeline.articles or []) if req.timeline and req.timeline.articles is not None else None
        eff_events = _min_optional_counts(_count_episode_event_segments(script), tl_events)
        allowed, premium_incremented, premium_pool_reserved, premium_credits = await run_quota(
            _charge_premium_audio, user, custom_key, client_ip, eff_len, eff_events
        )
        if not allowed:
            engine = default_engine_for_language(script.get("detected_language") or tl_lang)
            notice = "premium_quota_exhausted"

    now = datetime.now(timezone.utc).isoformat()
    initial_gender_state: Dict[str, Any] = {"status": "rendering", "clips": {}}
    podcast_audio.touch_render_lease(initial_gender_state)
    if engine == "gemini":
        initial_gender_state["charged"] = True
        initial_gender_state["paid_with"] = _premium_paid_with(user, custom_key, premium_credits)
        charge_record = _premium_charge_record(user, premium_credits, premium_pool_reserved)
        if charge_record:
            initial_gender_state["charge"] = charge_record
    initial_engine_state: Dict[str, Any] = {
        "status": "rendering",
        "charged": engine == "gemini",
        "clips": {},
        "by_gender": {target_gender: initial_gender_state},
    }
    if engine == "gemini":
        initial_engine_state["charged_genders"] = [target_gender]

    doc = {
        # Someone else's episode on this timeline goes to the private namespace (S-06): listed only
        # to its creator, the owner and admins, and never counted as the timeline having a podcast.
        "id": podcast_store.new_episode_id(private=not creator_is_owner_or_admin),
        "timeline_id": timeline_id,
        # The job's CURRENT owner: a guest who signed in while the script was written now owns it (B-24).
        "owner_id": _job_owner_id(job_id, user),
        # Lets unowned (curated) timelines publish admin-made episodes without publishing everyone's.
        "created_by_admin": bool(is_admin_user(user)),
        "created_at": now,
        "updated_at": now,
        "source": "generated",
        "articles_sig": _timeline_articles_sig(req.timeline),
        **script,
        "default_engine": engine,
        "audio": {
            engine: initial_engine_state,
        },
        "estimates": result.get("estimates") or {},
        "tokenUsage": result.get("tokenUsage"),
        "script_cost_usd": (
            round(float(result["tokenUsage"]["estimatedCostUsd"]), 6)
            if isinstance(result.get("tokenUsage"), dict) and result["tokenUsage"].get("estimatedCostUsd") is not None
            else None
        ),
    }
    try:
        await run_bulk(podcast_store.save_episode, doc)
        invalidate_library_cache(timeline_id)
    except Exception:
        if premium_incremented:
            await run_quota(
                refund_user_quota, user, client_ip=client_ip, refund_pool=premium_pool_reserved, credits=premium_credits
            )
        elif premium_pool_reserved:
            await run_quota(refund_community_paid_prompt, credits=premium_credits)
        raise
    meta = await _podcast_timeline_meta_best_effort(timeline_id)
    try:
        await _prune_old_episodes(timeline_id, doc["owner_id"], meta)
    except Exception as e:
        logger.warning(f"Could not prune old podcast episodes for {timeline_id}: {e}")
    _start_variant_render(
        doc, engine, user, custom_key, client_ip,
        refund_if_no_premium=premium_incremented,
        voice_gender=target_gender,
        refund_pool=premium_pool_reserved,
        charged_credits=premium_credits,
    )

    return {"episode": _public_episode(doc, user, meta), "notice": notice, "tokenUsage": result.get("tokenUsage")}


@app.get("/api/podcast/options")
async def podcast_options(
    lang: Optional[str] = Query(default="en", max_length=10),
    format: str = Query(default="single", pattern="^(single|duo)$"),
    gender: str = Query(default="male", pattern="^(male|female)$"),
):
    """Voice engines available for a language/host setup (drives the studio's voice choices)."""
    await ensure_gcloud_remaining_chars_fresh()
    return {"engines": available_engines(lang, format, gender), "language": detect_effective_language("", lang)}


@app.get("/api/podcast/voice-preview", dependencies=[Depends(podcast_audio_rate_limiter)])
async def podcast_voice_preview(
    engine: str = Query(default="edge", pattern="^(edge|gcloud|gemini)$"),
    gender: str = Query(default="male", pattern="^(male|female)$"),
    lang: Optional[str] = Query(default="en", max_length=10),
    format: str = Query(default="single", pattern="^(single|duo)$"),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    """A short fixed sample sentence per language/voice, rendered once and cached forever."""
    try:
        is_admin = is_admin_user(user) if user else False
        clip = await podcast_audio.render_voice_preview(
            engine, gender, lang, format,
            key_runner=_gemini_key_runner(x_gemini_api_key, is_admin=is_admin, allow_server_key=True) if engine == "gemini" else None,
        )
        return clip
    except Exception as e:
        logger.warning(f"Voice preview failed ({engine}/{gender}/{lang}): {e}")
        raise HTTPException(status_code=503, detail="This voice preview is temporarily unavailable.")


@app.post("/api/timelines/{timeline_id}/podcasts/start", dependencies=[Depends(timeline_rate_limiter)])
async def start_podcast_episode(
    timeline_id: str,
    req: TimelinePodcastRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """Start generating a podcast episode (script, then background audio render) for a timeline."""
    _strip_heavy_media_from_timeline(req.timeline)
    if req.timeline.id and req.timeline.id != timeline_id:
        raise HTTPException(status_code=400, detail="Timeline id mismatch.")
    if not req.timeline.articles:
        raise HTTPException(status_code=400, detail="Timeline has no events to generate a podcast from.")
    # P-14: the reuse lookup (the caller's own episodes) runs alongside the access check; its result
    # is only used once the caller is allowed to see the timeline, and quota is charged after both.
    reuse_task = asyncio.create_task(_find_reusable_episode(timeline_id, req, user))
    try:
        meta = await _podcast_timeline_meta(timeline_id)
    except BaseException:
        _discard_task(reuse_task)
        raise
    if not _can_view_timeline(meta, user):
        _discard_task(reuse_task)
        raise HTTPException(status_code=404, detail="Timeline not found")
    try:
        client_ip = get_client_ip(request)
        _enforce_concurrent_job_limit(user, client_ip)
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        reusable = await reuse_task
        creator_is_owner_or_admin = _is_timeline_owner_or_admin(user, meta)
        if not reusable and not creator_is_owner_or_admin:
            existing = await run_storage(podcast_store.get_episode_index, timeline_id)
            if len(existing) >= _max_episodes_per_timeline_total():
                raise HTTPException(status_code=409, detail=_EPISODE_CAP_REACHED_DETAIL)
        if reusable:
            script_key, script_tier, incremented_quota = None, "reused", False
        else:
            script_key, script_tier, _ = await run_quota(
                resolve_gemini_key, user, x_gemini_api_key, increment_usage=True, client_ip=client_ip
            )
            incremented_quota = bool(script_tier == "paid" and _quota_counts_usage(user, x_gemini_api_key))
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(script_tier),
        )
        reusable_id = reusable["id"] if reusable else None
        return _launch_ai_job(
            job_id,
            lambda: _execute_podcast_episode(
                timeline_id, req, script_key, script_tier, user, x_gemini_api_key, client_ip,
                reusable_episode_id=reusable_id,
                job_id=job_id,
                creator_is_owner_or_admin=creator_is_owner_or_admin,
            ),
            user,
            label="podcast",
        )
    except HTTPException:
        _discard_task(reuse_task)
        raise
    except Exception as e:
        _discard_task(reuse_task)
        logger.error(f"Error starting podcast job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.get("/api/timelines/{timeline_id}/podcasts", dependencies=[Depends(podcast_view_rate_limiter)])
async def list_podcast_episodes(
    timeline_id: str,
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    meta = await _podcast_timeline_meta(timeline_id)
    if not _can_view_timeline(meta, user):
        raise HTTPException(status_code=404, detail="Timeline not found")
    docs = await run_storage(
        podcast_store.list_episodes, timeline_id, None, lambda entry: _episode_visible(entry, user, meta)
    )
    # Whether the legacy episode exists at all (visible to this viewer or not): the index is cached.
    has_legacy_doc = any(d.get("id") == LEGACY_EPISODE_ID for d in docs) or any(
        e.get("id") == LEGACY_EPISODE_ID
        for e in await run_storage(podcast_store.get_episode_index, timeline_id)
    )
    if meta and (meta.get("data") or meta.get("has_legacy_podcast")) and not has_legacy_doc:
        full_meta = meta if meta.get("data") else await _podcast_timeline_meta(timeline_id, include_data=True)
        if full_meta and full_meta.get("data"):
            meta = full_meta
    if meta and meta.get("data") and not has_legacy_doc:
        legacy = _legacy_episode_from_timeline(timeline_id, meta["data"], meta.get("owner_id"))
        if legacy:
            await run_bulk(podcast_store.save_episode, legacy)
            docs.append(legacy)
    visible = _order_episodes_for_listing([d for d in docs if _episode_visible(d, user, meta)], meta)
    return {"episodes": [_public_episode(d, user, meta) for d in visible]}


@app.get("/api/timelines/{timeline_id}/podcasts/{episode_id}", dependencies=[Depends(podcast_view_rate_limiter)])
async def get_podcast_episode(
    timeline_id: str,
    episode_id: str,
    request: Request,
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    doc, meta = await _load_visible_episode(timeline_id, episode_id, user)
    try:
        doc = await _refund_stale_premium_renders(doc, user, get_client_ip(request))
    except Exception as e:  # never fail a poll over refund bookkeeping
        logger.warning(f"Stale premium render check failed for episode {episode_id}: {e}")
    return _public_episode(doc, user, meta)


@app.delete("/api/timelines/{timeline_id}/podcasts/{episode_id}")
async def delete_podcast_episode(
    timeline_id: str,
    episode_id: str,
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    doc, meta = await _load_visible_episode(timeline_id, episode_id, user)
    if not _can_manage_episode(doc, user, meta):
        raise HTTPException(status_code=403, detail="Only the episode's creator or the timeline owner can delete it.")
    await podcast_audio.delete_episode(timeline_id, episode_id)
    invalidate_library_cache(timeline_id)
    return {"deleted": True}


@app.post("/api/timelines/{timeline_id}/podcasts/{episode_id}/audio", dependencies=[Depends(podcast_audio_rate_limiter)])
async def request_podcast_audio(
    timeline_id: str,
    episode_id: str,
    body: PodcastAudioRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """Ensure every chapter is rendered with `engine` and `voice_gender` (reusing the existing script)."""
    doc, meta = await _load_visible_episode(timeline_id, episode_id, user)
    engine = normalize_engine(body.engine)
    target_gender = podcast_audio.normalize_gender(body.voice_gender or doc.get("voice_gender"))
    can_manage = _can_manage_episode(doc, user, meta)
    client_ip = get_client_ip(request)
    refund_if_no_premium = False
    refund_pool_if_no_premium = False
    audio_credits_charged = 0
    newly_charged = False

    if engine == "gemini" and not _is_gemini_gender_charged(doc, target_gender):
        newly_charged = True
        eff_len = (doc.get("length") or "full").strip().lower()
        tl_articles = ((meta or {}).get("data") or {}).get("articles") if isinstance(meta, dict) else None
        tl_events = meta.get("article_count") if (isinstance(meta, dict) and isinstance(meta.get("article_count"), int)) else (len(tl_articles) if isinstance(tl_articles, list) else None)
        eff_events = _min_optional_counts(_count_episode_event_segments(doc), tl_events)
        allowed, incremented, pool_reserved, audio_credits_charged = await run_quota(
            _charge_premium_audio, user, x_gemini_api_key, client_ip, eff_len, eff_events,
            raise_if_store_unavailable=True,
        )
        if not allowed:
            audio_cost = _resolve_podcast_gemini_audio_cost(length=eff_len, event_count=eff_events)
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Not enough premium AI credits (requires {audio_cost} credits). "
                    "Please choose a free voice engine or configure a paid personal Gemini API key in Settings."
                ),
            )
        refund_if_no_premium = incremented
        refund_pool_if_no_premium = pool_reserved
    will_render = _can_render_variant(doc, engine, target_gender, user, x_gemini_api_key, audio_credits_charged)

    def _prepare(d: Dict[str, Any]) -> None:
        if body.voice_gender and can_manage:
            _sync_episode_voice_gender(d, target_gender)
            d["default_engine"] = engine
        podcast_audio.variant_state(d, engine)
        if engine == "gemini":
            _mark_gemini_gender_charged(
                d, target_gender,
                paid_with=_premium_paid_with(user, x_gemini_api_key, audio_credits_charged) if newly_charged else None,
                charge=_premium_charge_record(user, audio_credits_charged, refund_pool_if_no_premium),
            )
        g_state = podcast_audio.gender_variant_state(d, engine, target_gender)
        if will_render and not podcast_audio.variant_is_complete(d, engine, target_gender):
            g_state["status"] = "rendering"
            podcast_audio.touch_render_lease(g_state)
        if podcast_audio.normalize_gender(d.get("voice_gender")) == target_gender:
            podcast_audio.sync_engine_state_for_gender(d, engine, target_gender)

    doc = await podcast_audio.update_episode(timeline_id, episode_id, _prepare) or doc

    # A fresh charge always runs the render pass (cache hits when complete), so its completion hook
    # can refund a variant made only of fallback chapters (B-10a).
    if audio_credits_charged > 0 or not podcast_audio.variant_is_complete(doc, engine, target_gender):
        _start_variant_render(
            doc, engine, user, x_gemini_api_key, client_ip,
            refund_if_no_premium, voice_gender=target_gender, refund_pool=refund_pool_if_no_premium,
            charged_credits=audio_credits_charged,
        )
    return _public_episode(doc, user, meta, voice_gender=target_gender)


async def _existing_gemini_clip(
    doc: Dict[str, Any], segment: Dict[str, Any], gender: str
) -> Optional[Dict[str, Any]]:
    """The chapter's stored Gemini clip (current render, else the one recorded on the episode), or None."""
    keys = [podcast_audio.clip_key("gemini", doc, segment, voice_gender=gender)]
    recorded = ((_gemini_gender_state(doc, gender).get("clips") or {}).get(segment.get("id")) or {}).get("key")
    if recorded and recorded not in keys:
        keys.append(recorded)
    for key in keys:
        meta = await run_storage(podcast_store.get_clip_meta, key)
        if meta and meta.get("engine") == "gemini":
            clip = podcast_audio._public_clip(meta)
            clip.pop("input_tokens", None)
            clip.pop("output_tokens", None)
            clip.pop("thinking_tokens", None)
            return clip
    return None


async def _await_until_disconnect(request: Optional[Request], coro: Any) -> Any:
    """Await `coro`, cancelling it if the HTTP client disconnects (e.g. skipped chapter AbortController)."""
    if request is None:
        return await coro
    task = asyncio.ensure_future(coro)
    if task.done():
        return task.result()

    async def _watch_disconnect() -> None:
        while not task.done():
            await asyncio.sleep(0.25)
            if task.done():
                return
            try:
                if await request.is_disconnected():
                    task.cancel()
                    return
            except Exception:
                return

    watcher = asyncio.create_task(_watch_disconnect())
    try:
        return await task
    finally:
        watcher.cancel()
        try:
            await watcher
        except (asyncio.CancelledError, Exception):
            pass


@app.get(
    "/api/timelines/{timeline_id}/podcasts/{episode_id}/segments/{segment_id}/clip",
    dependencies=[Depends(podcast_audio_rate_limiter)],
)
async def get_podcast_clip(
    timeline_id: str,
    episode_id: str,
    segment_id: str,
    request: Request,
    engine: str = Query(default="edge", pattern="^(edge|gcloud|gemini)$"),
    gender: Optional[str] = Query(default=None, pattern="^(male|female)$"),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    """Chapter audio manifest (stream URL, duration, turn & sentence timings), rendering it if needed."""
    doc, _ = await _load_visible_episode(timeline_id, episode_id, user)
    segment = next((s for s in doc.get("segments") or [] if s.get("id") == segment_id), None)
    if not segment:
        raise HTTPException(status_code=404, detail="Chapter not found")
    target_gender = podcast_audio.normalize_gender(gender or doc.get("voice_gender"))
    state = (doc.get("audio") or {}).get(engine) or {}
    gender_unlocked = _is_gemini_gender_charged(doc, target_gender)
    if engine == "gemini" and not gender_unlocked:
        raise HTTPException(status_code=402, detail="Premium voices are not unlocked for this episode.")
    is_admin = is_admin_user(user) if user else False
    server_key_ok = _is_gemini_gender_server_paid(doc, target_gender)
    if engine == "gemini" and not (server_key_ok or is_admin or (x_gemini_api_key and x_gemini_api_key.strip())):
        # A zero-cost unlock (BYOK / admin) never renders on the server key for other viewers (B-10c):
        # serve the chapter as already rendered, else the episode's free voice.
        existing = await _existing_gemini_clip(doc, segment, target_gender)
        if existing is not None:
            return existing
        engine = default_engine_for_language(doc.get("detected_language") or "en")
        state = (doc.get("audio") or {}).get(engine) or {}
    key_runner = (
        _gemini_key_runner(x_gemini_api_key, is_admin=is_admin, allow_server_key=server_key_ok)
        if engine == "gemini"
        else None
    )
    try:
        clip = await _await_until_disconnect(
            request,
            podcast_audio.render_clip(
                doc,
                segment,
                engine,
                key_runner=key_runner,
                voice_gender=target_gender,
                model=podcast_audio.pinned_model(doc, engine, target_gender),
                priority=podcast_audio.PRIORITY_INTERACTIVE,
            ),
        )
    except asyncio.CancelledError:
        return Response(status_code=499)
    except podcast_audio.TtsBusyError:
        raise HTTPException(
            status_code=503,
            detail="Lots of people are listening right now. This chapter will be ready in a moment, please try again.",
            headers={"Retry-After": "5"},
        )
    except Exception as e:
        logger.error(f"Podcast clip render failed ({episode_id}/{segment_id}/{engine}/{target_gender}): {e}", exc_info=True)
        raise HTTPException(status_code=503, detail="This chapter's audio couldn't be produced right now. Please try again.")

    summary = podcast_audio.clip_summary(clip)
    g_clips = ((state.get("by_gender") or {}).get(target_gender) or {}).get("clips") or {}
    is_doc_gender = target_gender == podcast_audio.normalize_gender(doc.get("voice_gender"))
    # Record new and changed clips (re-renders after a version bump, fallback retries, model re-pins):
    # that is what completes the variant, pins the Gemini model and invalidates a stale episode file.
    if g_clips.get(segment_id) != summary or (is_doc_gender and (state.get("clips") or {}).get(segment_id) != summary):

        def _record(d: Dict[str, Any]) -> None:
            podcast_audio.record_clip_summary(d, engine, segment_id, summary, target_gender)

        try:
            await podcast_audio.update_episode(timeline_id, episode_id, _record)
        except Exception as e:
            logger.warning(f"Could not record clip on episode {episode_id}: {e}")
    _spawn_background(
        _prefetch_following_chapters(
            doc, segment_id, engine, target_gender, user, x_gemini_api_key, get_client_ip(request), key_runner,
        ),
        "podcast prefetch",
    )
    if clip.get("cost_usd") is not None:
        clip["cost_usd"] = round(float(clip["cost_usd"]), 6)
    clip.pop("input_tokens", None)
    clip.pop("output_tokens", None)
    clip.pop("thinking_tokens", None)
    return clip


@app.get(
    "/api/timelines/{timeline_id}/podcasts/{episode_id}/episode-audio",
    dependencies=[Depends(podcast_audio_rate_limiter)],
)
async def get_podcast_episode_audio(
    timeline_id: str,
    episode_id: str,
    engine: str = Query(default="edge", pattern="^(edge|gcloud|gemini)$"),
    gender: Optional[str] = Query(default=None, pattern="^(male|female)$"),
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    """
    Continuous whole-episode audio for gapless playback: one stream URL plus each chapter's start
    offset and transcript timings. `ready` is false until every chapter has been rendered.
    """
    doc, _ = await _load_visible_episode(timeline_id, episode_id, user)
    target_gender = podcast_audio.normalize_gender(gender or doc.get("voice_gender"))
    if engine == "gemini" and not _is_gemini_gender_charged(doc, target_gender):
        raise HTTPException(status_code=402, detail="Premium voices are not unlocked for this episode.")
    try:
        manifest = await podcast_audio.get_episode_audio(doc, engine, voice_gender=target_gender)
    except Exception as e:
        logger.warning(f"Continuous podcast audio failed ({episode_id}/{engine}/{target_gender}): {e}")
        manifest = None
    if not manifest:
        return {"ready": False}
    return {"ready": True, **manifest}


def _audio_range_response(data: bytes, range_header: Optional[str]) -> Response:
    total = len(data)
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
    }
    if range_header and range_header.strip().lower().startswith("bytes="):
        spec = range_header.strip()[6:].split(",")[0].strip()
        start_s, _, end_s = spec.partition("-")
        try:
            if start_s == "":
                start, end = max(0, total - int(end_s)), total - 1
            else:
                start = int(start_s)
                end = int(end_s) if end_s else total - 1
        except ValueError:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
        if start >= total or start > end:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
        end = min(end, total - 1)
        return Response(
            content=data if (start == 0 and end == total - 1) else data[start:end + 1],
            status_code=206,
            media_type="audio/mpeg",
            headers={**headers, "Content-Range": f"bytes {start}-{end}/{total}"},
        )
    return Response(content=data, media_type="audio/mpeg", headers=headers)


_AUDIO_IMMUTABLE_HEADERS = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
}
# Headers worth passing on from Storage when the API itself streams a clip.
_STREAM_PASSTHROUGH_HEADERS = ("content-length", "content-range", "accept-ranges", "etag", "last-modified")
_PODCAST_STREAM_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


def _podcast_download_name(doc: Dict[str, Any]) -> str:
    title = re.sub(r"[\x00-\x1f\\/:*?\"<>|]+", "", doc.get("title") or "ChroniX podcast").strip() or "ChroniX podcast"
    return f"{title}.mp3"


def _download_disposition(filename: str) -> str:
    return f"attachment; filename=\"chronix-podcast.mp3\"; filename*=UTF-8''{urllib.parse.quote(filename)}"


def _audio_redirect(url: str, valid_for: float) -> Response:
    # The redirect may be cached a little, never longer than the signature it points at.
    max_age = int(max(0, min(600, valid_for - 120)))
    return Response(
        status_code=302,
        headers={
            "Location": url,
            "Cache-Control": f"public, max-age={max_age}" if max_age else "no-store",
            "Access-Control-Allow-Origin": "*",
        },
    )


async def _stream_clip_from_storage(key: str, range_header: Optional[str], extra_headers: Optional[Dict[str, str]] = None) -> Response:
    """Signing fallback: relays the clip from private Storage chunk by chunk, passing Range through,
    so the API never holds the whole object (SC-05)."""
    target = podcast_store.remote_clip_request(key)
    if target is None:
        raise HTTPException(status_code=404, detail="Audio not found")
    url, headers = target
    if range_header:
        headers = {**headers, "Range": range_header}
    # The client scope stays open until the body has been relayed (closed by the background task).
    scope = http_clients.shared_async_client("podcast-audio-stream", timeout=_PODCAST_STREAM_TIMEOUT)
    client = await scope.__aenter__()
    try:
        upstream = await client.send(client.build_request("GET", url, headers=headers), stream=True)
    except BaseException:
        await scope.__aexit__(None, None, None)
        raise

    async def _close() -> None:
        try:
            await upstream.aclose()
        finally:
            await scope.__aexit__(None, None, None)

    if upstream.status_code not in (200, 206):
        await _close()
        if upstream.status_code in (400, 404):
            raise HTTPException(status_code=404, detail="Audio not found")
        if upstream.status_code == 416:
            return Response(status_code=416, headers={"Content-Range": upstream.headers.get("content-range", "")})
        logger.warning(f"Podcast audio stream from storage failed: HTTP {upstream.status_code}")
        raise HTTPException(status_code=503, detail="Audio is temporarily unavailable. Please try again.")
    out_headers = {**_AUDIO_IMMUTABLE_HEADERS, **(extra_headers or {})}
    for name in _STREAM_PASSTHROUGH_HEADERS:
        if upstream.headers.get(name):
            out_headers[name] = upstream.headers[name]
    return StreamingResponse(
        upstream.aiter_bytes(64 * 1024),
        status_code=upstream.status_code,
        media_type="audio/mpeg",
        headers=out_headers,
        background=BackgroundTask(_close),
    )


async def _serve_clip_audio(
    key: str,
    request: Request,
    download_name: Optional[str] = None,
    allow_redirect: bool = True,
) -> Response:
    """
    Serves a stored clip or episode file without buffering it (SC-05): a local file with Starlette's
    own Range handling; otherwise a 302 to a short-lived signed Storage URL (Storage and its CDN
    answer Range requests); and if signing fails, a streamed relay from Storage.
    """
    local = await run_bulk(podcast_store.local_clip_file, key)
    if local is not None:
        headers = dict(_AUDIO_IMMUTABLE_HEADERS)
        if download_name:
            headers["Content-Disposition"] = _download_disposition(download_name)
            headers["Cache-Control"] = "no-store"
        return FileResponse(local, media_type="audio/mpeg", headers=headers)
    if not podcast_store.remote_enabled():
        raise HTTPException(status_code=404, detail="Audio not found")
    if allow_redirect:
        try:
            signed = await run_bulk(podcast_store.signed_clip_url, key, download_name)
        except podcast_store.ClipNotFound:
            raise HTTPException(status_code=404, detail="Audio not found")
        if signed is not None:
            return _audio_redirect(*signed)
    extra = {"Content-Disposition": _download_disposition(download_name), "Cache-Control": "no-store"} if download_name else None
    return await _stream_clip_from_storage(key, request.headers.get("range"), extra)


@app.get("/api/podcast-audio/{clip_name}", dependencies=[Depends(podcast_stream_rate_limiter)])
async def stream_podcast_audio(clip_name: str, request: Request):
    """Public, immutable, content-addressed chapter / episode audio (unguessable 256-bit keys):
    a redirect to a signed Storage URL, or a Range-capable file / stream (SC-05)."""
    key = clip_name[:-4] if clip_name.endswith(".mp3") else clip_name
    if not podcast_store.is_valid_clip_key(key):
        raise HTTPException(status_code=404, detail="Audio not found")
    return await _serve_clip_audio(key, request)


@app.get("/api/timelines/{timeline_id}/podcasts/{episode_id}/download", dependencies=[Depends(podcast_audio_rate_limiter)])
async def download_podcast_episode(
    timeline_id: str,
    episode_id: str,
    request: Request,
    engine: str = Query(default="edge", pattern="^(edge|gcloud|gemini)$"),
    gender: Optional[str] = Query(default=None, pattern="^(male|female)$"),
    format: Optional[str] = Query(default=None, pattern="^(url|file)$"),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    """
    The whole episode as one MP3 (chapters joined with short pauses, ID3 title tag). Chapters not
    rendered yet are rendered first (SC-15), then the stored continuous file is served without
    buffering it (SC-05): `?format=url` answers `{url, filename}` with a signed download URL; a
    plain request (no Authorization / BYOK header that a cross-origin redirect would forward)
    gets a 302 to it; otherwise the file is streamed.
    """
    doc, _ = await _load_visible_episode(timeline_id, episode_id, user)
    target_gender = podcast_audio.normalize_gender(gender or doc.get("voice_gender"))
    gender_unlocked = _is_gemini_gender_charged(doc, target_gender)
    if engine == "gemini" and not gender_unlocked:
        raise HTTPException(status_code=402, detail="Premium voices are not unlocked for this episode.")
    is_admin = is_admin_user(user) if user else False
    server_key_ok = _is_gemini_gender_server_paid(doc, target_gender)
    key_runner = (
        _gemini_key_runner(x_gemini_api_key, is_admin=is_admin, allow_server_key=server_key_ok)
        if engine == "gemini"
        else None
    )
    try:
        manifest = await podcast_audio.get_episode_audio(doc, engine, voice_gender=target_gender)
        if not manifest:
            await podcast_audio.render_missing_chapters(doc, engine, key_runner=key_runner, voice_gender=target_gender)
            manifest = await podcast_audio.get_episode_audio(doc, engine, voice_gender=target_gender)
            if not manifest:
                # A background render still owns the variant: join what is stored now.
                manifest = await podcast_audio.build_episode_audio(
                    doc, engine, voice_gender=target_gender,
                    model=podcast_audio.pinned_model(doc, engine, target_gender),
                )
        if not manifest:
            raise RuntimeError("Episode audio is incomplete.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Podcast download failed ({episode_id}/{engine}/{target_gender}): {e}", exc_info=True)
        raise HTTPException(status_code=503, detail="The episode audio couldn't be prepared right now. Please try again.")
    filename = _podcast_download_name(doc)
    if format == "url" and podcast_store.local_clip_file(manifest["key"]) is None and podcast_store.remote_enabled():
        try:
            signed = await run_bulk(podcast_store.signed_clip_url, manifest["key"], filename)
        except podcast_store.ClipNotFound:
            signed = None
        if signed is not None:
            return {"url": signed[0], "filename": filename}
    # Redirecting a request that carries Authorization / a personal key would forward the key
    # header to Storage, so those are streamed instead.
    plain = not request.headers.get("authorization") and not x_gemini_api_key
    return await _serve_clip_audio(manifest["key"], request, download_name=filename, allow_redirect=plain)


@app.post("/api/activity/podcast", status_code=204, dependencies=[Depends(podcast_activity_rate_limiter)])
async def report_podcast_listen(
    payload: PodcastListenReport,
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """Listening analytics: play start (time to first audio), completion and session summaries."""
    log_podcast_listen(
        user,
        content_mode=payload.content_mode,
        timeline_id=payload.timeline_id,
        result_count=payload.chapters_completed,
        duration_ms=int((payload.listened_seconds or 0) * 1000),
        details={
            "event": payload.event,
            "episode_id": payload.episode_id,
            "engine": payload.engine,
            "chapters_total": payload.chapters_total,
            "chapters_completed": payload.chapters_completed,
            "max_chapter_reached": payload.max_chapter_reached,
            "listened_seconds": round(payload.listened_seconds, 1) if payload.listened_seconds is not None else None,
            "episode_seconds": round(payload.episode_seconds, 1) if payload.episode_seconds is not None else None,
            "completion_ratio": (
                round(min(1.0, payload.listened_seconds / payload.episode_seconds), 3)
                if payload.listened_seconds is not None and payload.episode_seconds
                else None
            ),
            "time_to_first_audio_ms": payload.time_to_first_audio_ms,
            "buffering_ms": payload.buffering_ms,
            "fallback_count": payload.fallback_count,
            "is_shared_view": payload.is_shared_view,
            "music_enabled": payload.music_enabled,
            "music_mood": payload.music_mood if payload.music_mood in PODCAST_MUSIC_MOODS else None,
        },
    )
    return Response(status_code=204)


def _parse_attach_timeline_payload(timeline: str) -> TimelineData:
    """The `timeline` multipart field of an attach-files request, validated (400 / 422 on bad input)."""
    try:
        raw_tl = json.loads(timeline)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid timeline payload.")
    try:
        return TimelineData.model_validate(raw_tl)
    except ValidationError as ve:
        raise HTTPException(status_code=422, detail=ve.errors())
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid timeline payload.")


async def _execute_chat_attach_files(
    timeline_data: TimelineData,
    validated_uploads: ValidatedUploads,
    message: Optional[str],
    content_mode: Optional[str],
    input_method: Optional[str],
    api_key: Optional[str],
    key_tier: str,
    user: Dict[str, Any],
    upload_credits: int,
    target_owner: Optional[str],
    existing_meta: Optional[Dict[str, Any]],
    job_id: Optional[str] = None,
) -> TimelineChatResponse:
    """
    Extracts new events from the uploaded files and merges them into `timeline_data` through the
    refine pipeline, then saves the result conditioned on the snapshot's version (B-04). Shared by
    the job route (`/start`) and the legacy synchronous route.
    """
    timeline_id = timeline_data.id
    base_updated_at = timeline_data.updatedAt  # the version the client's snapshot was based on
    instruction = (message or "")[:2000].strip() or "Add any new events described or depicted in the attached files to this timeline."
    logger.info(
        f"Chat file-attach edit on timeline {timeline_id} for user {user.get('id')} using {key_tier} key "
        f"({validated_uploads.total_accepted_files} files, credits={upload_credits}, async_job={bool(job_id)})"
    )

    previous_article_ids = {a.id for a in timeline_data.articles}
    chat_details: Dict[str, Any] = {
        "file_count": validated_uploads.total_accepted_files,
        "image_count": validated_uploads.image_count,
        "doc_count": validated_uploads.doc_count,
        "events_before": len(previous_article_ids),
        "credits_charged": upload_credits,
        "async_job": bool(job_id),
        "input_method": normalize_input_method(input_method, bool((message or "").strip())),
    }
    if validated_uploads.total_pdf_pages > 0:
        chat_details["pdf_pages"] = validated_uploads.total_pdf_pages

    async with track_ai_activity(
        "chat_attach_files", user,
        key_tier=key_tier,
        content_mode=content_mode or timeline_data.contentMode,
        prompt=((message or "")[:500].strip() or None),
        timeline_id=timeline_id,
        details=chat_details,
    ) as activity:
        updated_timeline = await run_with_key_failover(
            lambda key: refine_timeline_with_gemini(
                current_timeline=timeline_data,
                instruction=instruction,
                api_key=key,
                files=validated_uploads.binary_files,
                content_mode=content_mode,
                extracted_documents=validated_uploads.extracted_documents or None,
                **_refine_limit_kwargs(user, key_tier, key),
            ),
            api_key, key_tier, label="chat file-attach edit"
        )
        _mark_job_non_refundable_on_cancel(job_id)
        apply_timeline_result(activity, updated_timeline)

        owner_to_save = target_owner or (_job_owner_id(job_id, user) if job_id else user.get("id"))
        persist_outcome = await _persist_ai_timeline(
            updated_timeline.model_dump(by_alias=True),
            user, owner_to_save, existing_meta, base_updated_at,
        )
        updated_timeline.updatedAt = persist_outcome["updatedAt"]

    added_count = sum(1 for a in updated_timeline.articles if a.id not in previous_article_ids)
    is_hebrew = (
        getattr(updated_timeline, "detectedLanguage", None) == "he"
        or bool(re.search(r"[֐-׿]", f"{message or ''} {updated_timeline.title or ''}"))
    )
    if is_hebrew:
        reply = (
            f"הוספתי {added_count} אירועים חדשים מתוך התמונה/הקבצים שצירפת לציר הזמן."
            if added_count > 0
            else "עדכנתי את ציר הזמן בהתאם לתמונה/לקבצים שצירפת."
        )
    else:
        reply = (
            f"I've added {added_count} new event(s) from your photo/files to the timeline."
            if added_count > 0
            else "I looked through your files but couldn't find any clear new events to add — try attaching clearer photos or more text."
        )

    return TimelineChatResponse(
        reply=reply,
        action="edit",
        updated_timeline=updated_timeline,
        timeline_id=updated_timeline.id,
        persisted=persist_outcome["persisted"],
        conflict=True if persist_outcome["conflict"] else None,
        is_relevant=True,
        model=(updated_timeline.tokenUsage or {}).get("model") if updated_timeline else None,
    )


@app.post(
    "/api/timeline/chat/attach-files/start",
    dependencies=[Depends(timeline_rate_limiter), Depends(file_upload_rate_limiter)],
)
async def start_chat_attach_files(
    request: Request,
    timeline: str = Form(...),
    message: Optional[str] = Form(None),
    content_mode: Optional[str] = Form(None),
    input_method: Optional[str] = Form(None),
    media_stripped: Optional[bool] = Form(False),
    files: List[UploadFile] = File(default=[]),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Chat-attached files as a cancellable background job (B-09): returns a job id to poll at
    `/api/timeline/job/status/{id}`; the result is the same `TimelineChatResponse` as the
    synchronous route. Uploads are validated and read here, before any credit is charged.
    """
    try:
        timeline_data = _parse_attach_timeline_payload(timeline)
        timeline_id = timeline_data.id
        target_owner, existing_meta = await _verify_timeline_mutation_target(timeline_id, user)
        client_ip = get_client_ip(request)
        _enforce_concurrent_job_limit(user, client_ip, text_budget=False)
        await _rehydrate_stripped_timeline_media(timeline_data, bool(media_stripped))

        has_custom_key = is_custom_key_verified(x_gemini_api_key)
        validated_uploads = await validate_and_read_uploads(
            files,
            "",
            request=request,
            user=user,
            has_custom_key=has_custom_key,
            prompt_mode=False,
            is_chat=True,
            require_files_only=True,
        )
        _attach_uploads_to_slot(request, validated_uploads)
        upload_credits = calculate_upload_credit_cost(validated_uploads, is_chat_or_refine=True)
        rate_limit_id = timeline_rate_limiter.get_identifier(request, user)
        api_key, key_tier, is_admin = await run_quota(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip, credits=upload_credits
        )
        incremented_quota = bool(key_tier == "paid" and _quota_counts_usage(user, x_gemini_api_key))
        job_id = _create_ai_job(
            user,
            client_ip=client_ip,
            rate_limit_identifier=rate_limit_id,
            incremented_quota=incremented_quota,
            pool_reserved=community_pool_reserved_for_tier(key_tier),
            quota_credits=upload_credits,
            timeline_id=timeline_id,
        )

        async def _operation() -> Dict[str, Any]:
            response = await _execute_chat_attach_files(
                timeline_data, validated_uploads, message, content_mode, input_method,
                api_key, key_tier, user, upload_credits,
                target_owner=target_owner, existing_meta=existing_meta, job_id=job_id,
            )
            return response.model_dump(by_alias=True)

        return _launch_ai_job(
            job_id, _operation, user, label="chat-attach-files",
            budget="upload", upload_slot=_take_over_upload_slot(request),
        )
    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error starting chat attach-files job: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.post(
    "/api/timeline/chat/attach-files",
    response_model=TimelineChatResponse,
    dependencies=[Depends(timeline_rate_limiter), Depends(file_upload_rate_limiter)],
)
async def chat_attach_files_endpoint(
    request: Request,
    timeline: str = Form(...),
    message: Optional[str] = Form(None),
    content_mode: Optional[str] = Form(None),
    input_method: Optional[str] = Form(None),
    media_stripped: Optional[bool] = Form(False),
    files: List[UploadFile] = File(default=[]),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Chat-attached files: extracts new events from uploaded photos/PDFs/text files and merges them
    into the current timeline via the refine pipeline (counts as one refinement, same as any
    other chat edit). Attaching files always implies an edit intent — no answer/edit
    classification step is needed here.
    Legacy synchronous route, kept for older clients; current clients use `/start` (B-09).
    """
    try:
        timeline_data = _parse_attach_timeline_payload(timeline)
        timeline_id = timeline_data.id
        target_owner, existing_meta = await _verify_timeline_mutation_target(timeline_id, user)
        await _rehydrate_stripped_timeline_media(timeline_data, bool(media_stripped))

        has_custom_key = is_custom_key_verified(x_gemini_api_key)
        validated_uploads = await validate_and_read_uploads(
            files,
            "",
            request=request,
            user=user,
            has_custom_key=has_custom_key,
            prompt_mode=False,
            is_chat=True,
            require_files_only=True,
        )
        _attach_uploads_to_slot(request, validated_uploads)

        client_ip = get_client_ip(request)
        upload_credits = calculate_upload_credit_cost(
            validated_uploads, is_chat_or_refine=True
        )
        api_key, key_tier, is_admin = await run_quota(
            resolve_gemini_key,
            user, x_gemini_api_key, increment_usage=True, client_ip=client_ip, credits=upload_credits
        )

        async def _refund() -> None:
            await _refund_sync_call_quota(user, client_ip, key_tier, x_gemini_api_key, credits=upload_credits)

        try:
            return await _execute_chat_attach_files(
                timeline_data, validated_uploads, message, content_mode, input_method,
                api_key, key_tier, user, upload_credits,
                target_owner=target_owner, existing_meta=existing_meta,
            )
        except asyncio.CancelledError:
            # A dropped request cancels the handler: CancelledError is not an Exception (B-09).
            await asyncio.shield(_refund())
            raise
        except Exception:
            await _refund()
            raise
    except (HTTPException, TimelineGoneError, EmptyTimelineError):
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error in chat_attach_files: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))

@app.get("/api/timelines")
async def get_all_timelines(all: bool = False, user: Dict[str, Any] = Depends(get_current_user_required)):
    user_id = user.get("id")
    want_all = bool(all) and is_admin_user(user)
    return await run_storage(list_all_timelines, user_id=user_id, all_users=want_all)

@app.get("/api/admin/users")
async def get_admin_users(user: Dict[str, Any] = Depends(get_current_user_required)):
    """
    Admin-only: list registered users (incl. guest/anonymous accounts) with
    signup and last-login timestamps, sourced from Supabase Auth.
    """
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Admin access required")
    return await list_all_users()


@app.get("/api/community/ledger", dependencies=[Depends(shared_view_rate_limiter)])
async def get_community_transparency_ledger(response: Response):
    """
    Public endpoint returning the cumulative Community Transparency Ledger:
    total AI spend vs. voluntary community donations.
    Seeds historical spend from `activity_log` on first run if not yet seeded.
    """
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return await run_bulk(sync_historical_spend_from_activity_log, False)


@app.post("/api/admin/community/ledger")
async def update_community_transparency_ledger(
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """
    Admin-only endpoint to manually set or sync the Community Transparency Ledger totals.
    """
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Admin access required")

    if body.get("sync_from_activity_log"):
        ledger, sync_error = await run_bulk(admin_sync_historical_spend)
        if sync_error:
            # Nothing was written: a failed/unavailable activity_log must never reset the ledger.
            raise HTTPException(status_code=502, detail=f"Ledger not changed. {sync_error}")
        return ledger

    if body.get("simulate_donation_usd") is not None:
        try:
            sim_amount = float(body["simulate_donation_usd"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid simulated donation amount")
        return await run_quota(
            record_community_donation_usd,
            sim_amount,
            tx_id=f"admin-sim-{uuid.uuid4().hex[:12]}",
            currency="USD",
        )

    spent_usd = body.get("spent_usd")
    donated_usd = body.get("donated_usd")
    donations_count = body.get("donations_count")

    try:
        spent_val = float(spent_usd) if spent_usd is not None and spent_usd != "" else None
        donated_val = float(donated_usd) if donated_usd is not None and donated_usd != "" else None
        count_val = int(donations_count) if donations_count is not None and donations_count != "" else None
    except (TypeError, ValueError, OverflowError):
        raise HTTPException(status_code=400, detail="Invalid numeric values for community ledger")

    try:
        return await run_quota(
            set_community_ledger_totals,
            spent_usd=spent_val,
            donated_usd=donated_val,
            donations_count=count_val,
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@app.post("/api/webhooks/kofi")
async def kofi_donation_webhook(request: Request):
    """
    Automatic Ko-fi webhook endpoint (`https://ko-fi.com/manage/webhooks`).
    Accepts Ko-fi's standard `application/x-www-form-urlencoded` (`data=<json>`) or `application/json`,
    verifies `KOFI_VERIFICATION_TOKEN`, deduplicates by `kofi_transaction_id`/`message_id`,
    and increments the Community Transparency Ledger.
    """
    import hmac

    expected_token = os.getenv("KOFI_VERIFICATION_TOKEN", "").strip()
    if not expected_token:
        raise HTTPException(
            status_code=503,
            detail="KOFI_VERIFICATION_TOKEN is not configured on the server.",
        )

    content_type = (request.headers.get("content-type") or "").lower()
    payload: Optional[Dict[str, Any]] = None

    try:
        if "application/json" in content_type:
            raw_json = await request.json()
            if isinstance(raw_json, dict):
                if isinstance(raw_json.get("data"), str):
                    payload = json.loads(raw_json["data"])
                else:
                    payload = raw_json
        else:
            form = await request.form()
            data_str = form.get("data")
            if isinstance(data_str, str) and data_str.strip():
                payload = json.loads(data_str)
    except Exception:
        payload = None

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid Ko-fi webhook payload")

    provided_token = str(payload.get("verification_token") or "").strip()
    if not provided_token or not hmac.compare_digest(provided_token, expected_token):
        raise HTTPException(status_code=403, detail="Invalid Ko-fi verification token")

    try:
        amount = float(payload.get("amount") or 0.0)
    except (TypeError, ValueError):
        amount = 0.0

    currency = str(payload.get("currency") or "USD").strip().upper()
    tx_id = str(payload.get("kofi_transaction_id") or payload.get("message_id") or "").strip() or None

    result = await run_quota(
        record_community_donation_usd,
        amount,
        tx_id=tx_id,
        currency=currency,
    )
    logger.info(
        f"Ko-fi webhook processed: amount={amount} {currency}, tx_id={tx_id}, "
        f"recorded={result.get('recorded')}, duplicate={result.get('duplicate')}"
    )
    return {"status": "ok", **result}


@app.get("/api/library", dependencies=[Depends(shared_view_rate_limiter)])
async def get_public_library(
    lang: Optional[str] = Query(None, max_length=10),
    category: Optional[str] = Query(None, max_length=60),
    content_mode: Optional[str] = Query(None, max_length=20),
    q: Optional[str] = Query(None, max_length=200),
    featured_only: bool = Query(False),
    limit: int = Query(120, ge=1, le=200),
    offset: int = Query(0, ge=0, le=500),
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
    request: Request = None,
):
    """
    Public, zero-AI-cost catalog of curated timelines in the ChroniX Library.
    Returns lightweight card summaries (no heavy articles/podcast payloads) from an in-memory cache.
    Supports a fast first-page path (`offset=0`, `limit<=24`, no category/search filter) that hydrates
    only the first-page cards on a cold cache while loading the rest of the catalog in the background.
    Each card carries one `coverImageUrl`; `coverImageCandidates` is included for admins only.
    """
    include_candidates = bool(user and is_admin_user(user))
    # The catalog is the same for every anonymous viewer (admins also get cover candidates).
    anonymous = request is not None and _is_anonymous_request(request, user)

    def _project(cards: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [project_library_card_for_viewer(c, include_candidates) for c in cards]

    def _respond(payload: Dict[str, Any]) -> Any:
        if request is None:
            return payload
        if anonymous:
            body = _json_bytes(jsonable_encoder(payload))
            return _public_json_response(request, body, _etag_for(body))
        return _private_json_response(payload)

    lang_clean = (lang or "").strip().lower()
    mode_clean = (content_mode or "").strip().lower()
    cat_clean = (category or "").strip().lower()
    q_clean = (q or "").strip().lower()

    if offset == 0 and limit <= 24 and (not cat_clean or cat_clean == "all") and not q_clean:
        page_items, total_count = await run_storage(
            list_library_timelines_fast_page,
            lang_clean,
            mode_clean,
            featured_only,
            limit,
        )
        payload = {
            "items": _project(page_items),
            "total": total_count,
            "domains": [{"key": d["key"], "label": d["label"]} for d in CURATED_DOMAINS],
        }
        # Whole-catalog category facets (when a complete catalog is cached) let the Library render
        # its full category row, with real counts, while the rest of the catalog is still loading.
        facets = get_library_catalog_facets()
        if facets is not None:
            payload["facets"] = facets
        return _respond(payload)

    items = await run_bulk(list_library_timelines)

    if lang_clean and lang_clean != "all":
        items = [it for it in items if (it.get("language") or "en").lower() == lang_clean]

    if mode_clean and mode_clean != "all":
        items = [it for it in items if (it.get("contentMode") or "classic").lower() == mode_clean]

    if cat_clean and cat_clean != "all":
        items = [
            it for it in items
            if cat_clean in [str(k).lower() for k in (it.get("categoryKeys") or [])]
            or cat_clean in [str(c).lower() for c in (it.get("categories") or [])]
        ]

    if featured_only:
        items = [it for it in items if it.get("isFeatured")]

    if q_clean:
        def _matches_query(card: Dict[str, Any]) -> bool:
            haystack = " ".join([
                str(card.get("title") or ""),
                str(card.get("description") or ""),
                " ".join(str(t) for t in (card.get("tags") or [])),
                " ".join(str(c) for c in (card.get("categories") or [])),
            ]).lower()
            return q_clean in haystack

        items = [it for it in items if _matches_query(it)]

    return _respond({
        "items": _project(items[offset : offset + limit]),
        "total": len(items),
        "domains": [{"key": d["key"], "label": d["label"]} for d in CURATED_DOMAINS],
    })


# --- Public response caching (P-07) ----------------------------------------------------------------
# Anonymous views of shared / Library timelines, their link-preview meta and the Library catalog are
# the same for every viewer: they get `Cache-Control: public` plus an ETag (304 on If-None-Match).
# Anything served to a signed-in caller, or owner-only, stays `private, no-store`.
PUBLIC_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=600"
PRIVATE_CACHE_CONTROL = "private, no-store"
SHARE_META_MAX_DATA_COVER_CHARS = 12_000
# share.js (link previews) arrives from a handful of Vercel IPs, so this limit is per IP but generous.
share_meta_rate_limiter = SimpleRateLimiter(
    max_requests=300, window_seconds=60, name="timeline preview", env_var="SHARE_META_RATE_LIMIT_PER_MINUTE",
)


def _is_anonymous_request(request: Optional[Request], user: Optional[Dict[str, Any]]) -> bool:
    return user is None and not (request is not None and request.headers.get("authorization"))


def _json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")


def _etag_for(body: bytes) -> str:
    return 'W/"' + hashlib.blake2b(body, digest_size=12).hexdigest() + '"'


def _etag_matches(request: Request, etag: str) -> bool:
    header = request.headers.get("if-none-match") or ""
    if not header:
        return False
    bare = etag[2:] if etag.startswith("W/") else etag
    for candidate in header.split(","):
        candidate = candidate.strip()
        if candidate == "*":
            return True
        if (candidate[2:] if candidate.startswith("W/") else candidate) == bare:
            return True
    return False


def _public_json_response(request: Request, body: bytes, etag: str) -> Response:
    headers = {"Cache-Control": PUBLIC_CACHE_CONTROL, "ETag": etag, "Vary": "Authorization"}
    if _etag_matches(request, etag):
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


def _private_json_response(payload: Any) -> JSONResponse:
    return JSONResponse(content=jsonable_encoder(payload), headers={"Cache-Control": PRIVATE_CACHE_CONTROL})


def _timeline_visibility(meta: Dict[str, Any], user: Optional[Dict[str, Any]], data_obj: Dict[str, Any]) -> Dict[str, bool]:
    owner_id = meta.get("owner_id")
    is_admin = bool(user and is_admin_user(user))
    return {
        "is_admin": is_admin,
        "is_owner": bool(user and owner_id and user.get("id") == owner_id),
        "is_shared": bool(meta.get("is_shared")),
        "is_library": bool(meta.get("is_library") or data_obj.get("isLibrary") or data_obj.get("is_library")),
        "is_featured": bool(meta.get("is_featured") or data_obj.get("isFeatured") or data_obj.get("is_featured")),
        "is_deleted": bool(meta.get("is_deleted") or data_obj.get("isDeleted") or data_obj.get("is_deleted")),
    }


def _raise_unless_viewable(vis: Dict[str, bool]) -> None:
    if vis["is_deleted"] and not vis["is_admin"]:
        raise HTTPException(status_code=404, detail="Timeline not found")
    if not vis["is_owner"] and not vis["is_shared"] and not vis["is_library"] and not vis["is_admin"]:
        # Don't reveal that a private timeline with this id exists.
        raise HTTPException(status_code=404, detail="Timeline not found")


@app.get("/api/timelines/{timeline_id}", dependencies=[Depends(shared_view_rate_limiter)])
async def get_single_timeline(
    timeline_id: str,
    request: Request = None,
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional)
):
    """
    Fetch a timeline by id. Requires NO authentication so "anyone with the link" shared
    views and Public Library timelines work, while keeping private timelines protected.
    Anonymous views of a shared / Library timeline are cacheable (ETag, 304) and served from a
    short in-process cache; everything else is `private, no-store` (P-07).
    """
    anonymous = request is not None and _is_anonymous_request(request, user)
    if anonymous:
        cached = public_cache_get("timeline", timeline_id)
        if cached is not None:
            return _public_json_response(request, cached[1], cached[0])

    meta = await run_storage(get_timeline_with_meta, timeline_id)
    if not meta or not meta.get("data"):
        raise HTTPException(status_code=404, detail="Timeline not found")

    data_obj = meta.get("data") or {}
    vis = _timeline_visibility({**meta, "is_deleted": False}, user, data_obj)
    _raise_unless_viewable(vis)

    payload = {
        **meta["data"],
        "isOwner": vis["is_owner"] or vis["is_admin"],
        "isShared": vis["is_shared"],
        "isLibrary": vis["is_library"],
        "isFeatured": vis["is_featured"],
        "isAdmin": vis["is_admin"],
    }
    if request is None:  # called directly (tests / internal)
        return payload
    if anonymous and not vis["is_deleted"] and (vis["is_shared"] or vis["is_library"]):
        body = await run_cpu(_json_bytes, payload)
        etag = _etag_for(body)
        public_cache_put("timeline", timeline_id, (etag, body), len(body))
        return _public_json_response(request, body, etag)
    return _private_json_response(payload)


def _share_meta_cover(candidates: List[Any]) -> Optional[str]:
    """First http(s) raster image, else a small inline one: what a link preview can show."""
    small_inline = None
    for raw in candidates:
        if not isinstance(raw, str) or not raw.strip():
            continue
        url = raw.strip()
        if url.startswith("//"):
            url = "https:" + url
        lower = url.lower()
        if lower.startswith(("http://", "https://")):
            if not lower.split("?", 1)[0].endswith(".svg"):
                return url
        elif lower.startswith("data:image/") and "svg" not in lower[:30] and small_inline is None:
            if len(url) <= SHARE_META_MAX_DATA_COVER_CHARS:
                small_inline = url
    return small_inline


@app.get("/api/timelines/{timeline_id}/meta", dependencies=[Depends(share_meta_rate_limiter)])
async def get_timeline_preview_meta(
    timeline_id: str,
    request: Request = None,
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    """
    Link-preview metadata (P-07): `{id, title, description, coverImageUrl, articleCount, updatedAt}`,
    with the same visibility rules as GET /api/timelines/{id}, without downloading the timeline.
    """
    anonymous = request is not None and _is_anonymous_request(request, user)
    if anonymous:
        cached = public_cache_get("meta", timeline_id)
        if cached is not None:
            return _public_json_response(request, cached[1], cached[0])
    try:
        meta = await run_storage(get_timeline_share_meta, timeline_id)
    except StorageUnavailableError:
        raise HTTPException(status_code=503, detail=_STORAGE_UNAVAILABLE_DETAIL)
    if not meta:
        raise HTTPException(status_code=404, detail="Timeline not found")
    vis = _timeline_visibility(meta, user, {})
    _raise_unless_viewable(vis)
    payload = {
        "id": timeline_id,
        "title": meta.get("title") or "",
        "description": meta.get("description") or "",
        "coverImageUrl": _share_meta_cover(meta.get("cover_candidates") or []),
        "articleCount": meta.get("article_count"),
        "updatedAt": meta.get("updated_at") or None,
    }
    if request is None:
        return payload
    if anonymous and not vis["is_deleted"] and (vis["is_shared"] or vis["is_library"]):
        body = _json_bytes(payload)
        etag = _etag_for(body)
        public_cache_put("meta", timeline_id, (etag, body), len(body))
        return _public_json_response(request, body, etag)
    return _private_json_response(payload)


@app.put("/api/library/order")
async def update_public_library_order(
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """Admin-only: persist custom display order for timelines under 'Featured' in the Public Library."""
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Admin access required")

    raw_ids = body.get("orderedIds") if "orderedIds" in body else body.get("ordered_ids")
    if not isinstance(raw_ids, list) or len(raw_ids) > 500:
        raise HTTPException(status_code=400, detail="orderedIds must be a list of timeline IDs")

    cleaned_ids: List[str] = []
    for item in raw_ids:
        if not isinstance(item, str):
            raise HTTPException(status_code=400, detail="Each timeline ID must be a string")
        s = item.strip()
        if not s or len(s) > 128:
            continue
        cleaned_ids.append(s)

    final_ids = await run_storage(reorder_library_timelines, cleaned_ids)
    if final_ids is None:
        raise HTTPException(status_code=503, detail="Failed to persist library timeline order")
    return {"status": "ok", "orderedIds": final_ids}


@app.patch("/api/timelines/{timeline_id}/library")
async def update_timeline_library_status(
    timeline_id: str,
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """Admin-only: curate (publish/unpublish, feature, reorder, or customize cover photo) a timeline in the Public Library."""
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Admin access required")

    has_meta_fields = any(
        k in body
        for k in (
            "coverImageUrl",
            "cover_image_url",
            "coverImagePositionX",
            "coverImagePositionY",
            "featuredOrder",
            "featured_order",
        )
    )
    if "isLibrary" in body:
        enabled: Optional[bool] = bool(body["isLibrary"])
    elif "enabled" in body:
        enabled = bool(body["enabled"])
    elif has_meta_fields or "isFeatured" in body or "featured" in body:
        enabled = None
    else:
        enabled = True

    raw_featured = body.get("isFeatured") if "isFeatured" in body else body.get("featured", None)
    featured = bool(raw_featured) if raw_featured is not None else None

    kwargs: Dict[str, Any] = {}
    if "coverImageUrl" in body or "cover_image_url" in body:
        kwargs["cover_image_url"] = body.get("coverImageUrl") if "coverImageUrl" in body else body.get("cover_image_url")
    if "coverImagePositionX" in body and "coverImagePositionY" in body:
        kwargs["cover_image_position_x"] = body.get("coverImagePositionX")
        kwargs["cover_image_position_y"] = body.get("coverImagePositionY")
    if "featuredOrder" in body or "featured_order" in body:
        kwargs["featured_order"] = body.get("featuredOrder") if "featuredOrder" in body else body.get("featured_order")

    result = await run_storage(set_timeline_library_status, timeline_id, enabled, featured, **kwargs)
    if not result:
        raise HTTPException(status_code=404, detail="Timeline not found or cannot be published")
    return result

MAX_SHARE_AUTHOR_NAME_CHARS = 80
# Control characters plus bidi overrides/isolates, which can make a byline render misleadingly.
_AUTHOR_NAME_STRIP_RE = re.compile(r"[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]")


def _clean_share_author_name(raw: Any) -> Optional[str]:
    """The optional byline shown on shared timelines (S-15): a short plain string, or None."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise HTTPException(status_code=400, detail="authorName must be a string.")
    cleaned = " ".join(_AUTHOR_NAME_STRIP_RE.sub(" ", raw).split())[:MAX_SHARE_AUTHOR_NAME_CHARS].strip()
    return cleaned or None


@app.patch("/api/timelines/{timeline_id}/share")
async def set_timeline_share_status(
    timeline_id: str,
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Owner-only or Admin: enable/disable the shareable "anyone with the link" flag."""
    enabled = bool(body.get("enabled", True))
    raw_author = body.get("authorName") if body.get("authorName") is not None else body.get("author_name")
    author_name = _clean_share_author_name(raw_author)
    # Only the owner is needed here, so the multi-MB `data` isn't downloaded (P-14).
    try:
        meta = await run_storage(_get_timeline_access_meta_sync, timeline_id)
    except StorageUnavailableError:
        raise HTTPException(status_code=503, detail=_STORAGE_UNAVAILABLE_DETAIL)
    if not meta:
        raise HTTPException(status_code=404, detail="Timeline not found")
    
    owner_id = meta.get("owner_id")
    # Unowned (NULL owner) timelines are admin-only.
    is_owner = bool(owner_id and user and owner_id == user.get("id"))
    is_admin = is_admin_user(user)
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403, detail="Only the owner or an admin can change sharing for this timeline")

    target_user_id = user.get("id") if is_owner else None

    def _do_share() -> bool:
        try:
            return set_timeline_shared(timeline_id, target_user_id, enabled, author_name=author_name)
        except TypeError:
            return set_timeline_shared(timeline_id, target_user_id, enabled)

    success = await run_storage(_do_share)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update sharing status")
    return {"isShared": enabled, "authorName": author_name}

# P-09: what a client that asked for `?return=minimal` gets back instead of the whole timeline.
_MINIMAL_SAVE_RESPONSE_KEYS = (
    "id", "updatedAt", "createdAt", "isLibrary", "isFeatured", "featuredOrder", "hiddenFromSaved",
)


def _minimal_save_response(saved: Any) -> Dict[str, Any]:
    if not isinstance(saved, dict):
        return {"minimal": True}
    slim = {key: saved[key] for key in _MINIMAL_SAVE_RESPONSE_KEYS if key in saved}
    slim["minimal"] = True
    return slim


@app.post("/api/timelines", dependencies=[Depends(timeline_save_rate_limiter)])
async def save_timeline(
    timeline: dict = Body(...),
    user: Dict[str, Any] = Depends(get_current_user_required),
    return_mode: Optional[str] = Query(None, alias="return", max_length=20),
):
    """
    Create or update a timeline. Optional optimistic concurrency (B-04): `baseUpdatedAt` in the body
    is the `updatedAt` the client last got from the server for this id. When the stored row has
    moved on, nothing is written and the response is 409
    `{"detail", "code": "stale_write", "current_updated_at"}`; without it, last write wins (legacy
    clients). A soft-deleted row answers 410 `{"detail", "code": "timeline_deleted"}`.
    The response is the saved timeline, whose `updatedAt` is the new version; with `?return=minimal`
    only `{id, updatedAt, createdAt, minimal: true}` plus the server-decided Library flags (P-09).
    """
    if not isinstance(timeline, dict):
        raise HTTPException(status_code=400, detail="Timeline payload must be a JSON object.")
    payload = dict(timeline)
    raw_base = payload.pop("baseUpdatedAt", None)
    base_updated_at = raw_base.strip()[:80] if isinstance(raw_base, str) and raw_base.strip() else None
    # Job-result bookkeeping a client may echo back; never part of the stored document.
    for transient_key in ("persisted", "conflict"):
        payload.pop(transient_key, None)
    if not payload.get("id"):
        payload["id"] = str(uuid.uuid4())
    try:
        TimelineData.model_validate(payload)
    except ValidationError as ve:
        raise HTTPException(status_code=422, detail=ve.errors())

    target_owner, existing_meta = await _verify_timeline_mutation_target(payload["id"], user)
    saved = await _persist_timeline_dict(
        payload,
        user=user,
        target_owner=target_owner,
        existing_meta=existing_meta,
        base_updated_at=base_updated_at,
    )
    if isinstance(return_mode, str) and return_mode.strip().lower() == "minimal":
        return _minimal_save_response(saved)
    return saved

@app.delete("/api/timelines")
async def delete_all_timelines(
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    # Unowned local-mode rows (seeded/curated content) are shared; only an admin may wipe them (S-15).
    await run_bulk(delete_all_user_timelines, user_id, is_admin_user(user))
    return {"success": True}

@app.delete("/api/timelines/{timeline_id}")
async def delete_timeline(
    timeline_id: str,
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    user_id = user.get("id")
    target_user_id = None if is_admin_user(user) else user_id
    deleted = await run_storage(delete_timeline_data, timeline_id, user_id=target_user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Timeline not found")
    return {"success": True}


MAX_STORED_CHAT_MESSAGES = 100
MAX_STORED_CHAT_CONTENT_CHARS = 20000
MAX_STORED_CHAT_BYTES = 1_000_000


def _sanitize_chat_messages(messages: Any) -> List[Dict[str, Any]]:
    """Whitelists the fields the chat UI renders; drops anything malformed."""
    if not isinstance(messages, list):
        raise HTTPException(status_code=400, detail="messages must be a list")
    clean: List[Dict[str, Any]] = []
    for m in messages[-MAX_STORED_CHAT_MESSAGES:]:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant"):
            continue
        content = m.get("content")
        if not isinstance(content, str):
            continue
        entry: Dict[str, Any] = {
            "id": str(m.get("id") or "")[:64],
            "role": m["role"],
            "content": content[:MAX_STORED_CHAT_CONTENT_CHARS],
        }
        if m.get("action") in ("answer", "edit"):
            entry["action"] = m["action"]
        for flag in ("error", "undone"):
            if m.get(flag) is True:
                entry[flag] = True
        if m.get("isRelevant") is False:
            entry["isRelevant"] = False
        if m.get("model") and isinstance(m.get("model"), str):
            entry["model"] = str(m["model"]).strip()[:64]
        sources = m.get("sources")
        if isinstance(sources, list):
            safe_sources = [
                {"title": str(s.get("title") or "")[:300], "url": s["url"][:2000]}
                for s in sources[:10]
                if isinstance(s, dict) and isinstance(s.get("url"), str)
                and s["url"].lower().startswith(("https://", "http://"))
            ]
            if safe_sources:
                entry["sources"] = safe_sources
        clean.append(entry)
    return clean


@app.get("/api/timelines/{timeline_id}/chat")
async def get_timeline_chat_endpoint(
    timeline_id: str,
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """The caller's own saved conversation for a timeline. `messages` is null when the store is unavailable."""
    result = await run_storage(get_timeline_chat, timeline_id, user.get("id"))
    if result is None:
        return {"messages": None, "updatedAt": None}
    return result


@app.put("/api/timelines/{timeline_id}/chat")
async def save_timeline_chat_endpoint(
    timeline_id: str,
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Replaces the caller's conversation for a timeline they own (or any timeline, for admins)."""
    messages = _sanitize_chat_messages(body.get("messages"))
    if len(json.dumps(messages, ensure_ascii=False).encode("utf-8")) > MAX_STORED_CHAT_BYTES:
        raise HTTPException(status_code=413, detail="Conversation is too large to save")

    owner = await run_storage(get_timeline_owner, timeline_id)
    if not owner:
        raise HTTPException(status_code=404, detail="Timeline not found")
    if owner.get("owner_id") != user.get("id") and not is_admin_user(user):
        raise HTTPException(status_code=403, detail="You can only save chats for your own timelines")

    if not await run_storage(save_timeline_chat, timeline_id, user.get("id"), messages):
        raise HTTPException(status_code=503, detail="Chat storage is unavailable")
    return {"success": True, "count": len(messages)}

@app.post("/api/user/claim-guest")
async def claim_guest_work(
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Moves timelines created in a guest session into the signed-in account. The caller must
    present that guest session's own token(s), and only anonymous sessions can be claimed.
    """
    if is_guest_user(user):
        raise HTTPException(status_code=400, detail="Sign in to a registered account to keep guest work")

    access_token = body.get("guestAccessToken")
    refresh_token = body.get("guestRefreshToken")
    if not isinstance(access_token, str) and not isinstance(refresh_token, str):
        raise HTTPException(status_code=400, detail="Guest session token is required")

    guest = await resolve_guest_session_user(
        access_token if isinstance(access_token, str) else None,
        refresh_token if isinstance(refresh_token, str) else None,
    )
    if not guest:
        raise HTTPException(status_code=403, detail="Guest session is invalid or expired")
    if guest.get("id") == user.get("id"):
        return {"transferred": 0, "timelineIds": []}

    # Move pending AI jobs first so a generation still running (e.g. the guest signed in
    # mid-generation) saves straight into the account and stays pollable after the redirect.
    moved_jobs = _transfer_ai_jobs(guest["id"], user.get("id"))
    if moved_jobs:
        logger.info(f"Moved {moved_jobs} pending AI job(s) from guest {guest['id']} to {user.get('id')}")

    moved = await run_bulk(transfer_user_timelines, guest["id"], user.get("id"))
    if moved is None:
        raise HTTPException(status_code=503, detail="Timeline storage is unavailable")
    # Episodes on the claimed timelines and the guest's episodes elsewhere, each under its episode lock (B-24).
    await podcast_audio.transfer_episodes_owner(moved, guest["id"], user.get("id"))
    logger.info(f"Moved {len(moved)} guest timeline(s) from {guest['id']} to {user.get('id')}")
    await run_bulk(reassign_user_activity, guest["id"], user.get("id"))
    return {"transferred": len(moved), "timelineIds": moved}

_ACCOUNT_DELETE_RETRY_DETAIL = (
    "Your account could not be deleted right now because some of your data could not be removed. "
    "Your account was not deleted; please try again in a moment."
)


async def _delete_timeline_podcasts_for_account_deletion(timeline_id: str, user_id: str) -> None:
    """Deletes one timeline's podcast episodes and audio, retrying once; raises HTTP 503 if both attempts fail."""
    last_err: Optional[Exception] = None
    for attempt in range(2):
        try:
            entries = await run_storage(podcast_store.get_episode_index, timeline_id)
            for e in entries or []:
                if e.get("id"):
                    podcast_audio.cancel_episode_renders(str(e["id"]))
            await run_bulk(podcast_store.delete_timeline_episodes, timeline_id)
            return
        except Exception as pod_err:
            last_err = pod_err
            logger.warning(
                f"Failed deleting podcast episodes for timeline {timeline_id} (attempt {attempt + 1}/2): {pod_err}"
            )
            if attempt == 0:
                await asyncio.sleep(0.5)
    logger.error(f"Aborting account deletion for {user_id}: podcast episodes of {timeline_id} not deleted ({last_err})")
    raise HTTPException(status_code=503, detail=_ACCOUNT_DELETE_RETRY_DETAIL)


async def _delete_owner_episodes_for_account_deletion(user_id: str, owned_timeline_ids: List[str]) -> None:
    """The user's episodes on OTHER people's timelines (B-13), retrying once; HTTP 503 if both fail."""
    last_err: Optional[Exception] = None
    for attempt in range(2):
        try:
            await run_bulk(podcast_store.delete_owner_episodes, user_id, set(owned_timeline_ids))
            return
        except Exception as pod_err:
            last_err = pod_err
            logger.warning(f"Failed deleting podcast episodes created by {user_id} (attempt {attempt + 1}/2): {pod_err}")
            if attempt == 0:
                await asyncio.sleep(0.5)
    logger.error(f"Aborting account deletion for {user_id}: their episodes elsewhere were not deleted ({last_err})")
    raise HTTPException(status_code=503, detail=_ACCOUNT_DELETE_RETRY_DETAIL)


async def _cancel_user_work(user_id: str, wait_seconds: float = 5.0) -> None:
    """Stops the user's in-flight AI jobs and podcast renders, so none of them writes after deletion.
    Jobs are marked cancelled first: their cancel handler then skips refunds (nobody to refund)."""
    tasks: List["asyncio.Task[Any]"] = []
    for job in list(_AI_JOBS.values()):
        if job.get("user_id") != user_id and (job.get("user") or {}).get("id") != user_id:
            continue
        task = job.get("task")
        job.update(status="cancelled", detail="Account deleted", result=None, updated=time.time())
        if task is not None and not task.done():
            task.cancel()
            tasks.append(task)
    tasks.extend(podcast_audio.cancel_owner_renders(user_id))
    if tasks:
        await asyncio.wait(tasks, timeout=wait_seconds)


async def _delete_legacy_owner_episodes_in_background(user_id: str) -> None:
    """Episodes from before the owner index existed are found by scanning every timeline's index."""
    try:
        refs = await run_bulk(podcast_store.find_owner_episodes_by_scan, user_id)
        for ref in refs:
            await podcast_audio.delete_episode(ref["timeline_id"], ref["id"])
        if refs:
            logger.info(f"Deleted {len(refs)} pre-index podcast episode(s) of a deleted account.")
    except Exception as e:
        logger.warning(f"Background scan for a deleted account's podcast episodes failed: {e}")


async def _delete_user_account_data(user_id: str) -> None:
    """The deletion steps, in order; raises HTTPException (nothing after the failed step has run)."""
    await _cancel_user_work(user_id)

    try:
        # Every row the user owns, including hidden-from-Saved Library rows and empty/deleted ones.
        owned_timeline_ids = await run_storage(list_user_timeline_ids, user_id)
    except Exception as e:
        logger.error(f"Could not enumerate timelines before account deletion for {user_id}: {e}")
        raise HTTPException(status_code=503, detail=_ACCOUNT_DELETE_RETRY_DETAIL)

    # 1. Podcast episodes and their audio on owned timelines. Runs before the timelines are deleted:
    # afterwards they could no longer be enumerated, so a retry would silently leave the audio behind.
    for tid in owned_timeline_ids:
        await _delete_timeline_podcasts_for_account_deletion(tid, user_id)
    # 1b. ...and the episodes they created on other people's timelines (both namespaces).
    await _delete_owner_episodes_for_account_deletion(user_id, owned_timeline_ids)

    # 2. Hard-delete all user timelines (and chats). Abort if durable storage failed so orphan data is never left behind.
    try:
        timelines_deleted = await run_bulk(delete_all_user_timelines, user_id, False, True)
    except Exception as e:
        logger.error(f"Error deleting timelines for user {user_id}: {e}")
        timelines_deleted = False

    if not timelines_deleted:
        raise HTTPException(
            status_code=503,
            detail="Failed to delete user timelines; account deletion aborted so no personal data is left orphaned.",
        )

    # 2b. Hosted timeline photos (counter rows are removed with the usage records below).
    try:
        await run_bulk(photo_store.delete_owner_photos, str(user_id))
    except Exception as e:
        logger.warning(f"Could not delete hosted photos for {user_id}: {e}")
    await _delete_user_book_imports(str(user_id))

    # 3. AI usage counters, then activity log rows once queued inserts have landed (queued rows for
    # this user are dropped from now on anyway).
    await run_bulk(delete_user_usage_records, user_id)
    if not await run_bulk(flush_activity_log, 10.0):
        logger.warning("Activity queue did not drain before account deletion; deleting rows anyway.")
    await run_bulk(delete_user_activity, user_id)

    # 4. Delete user from Supabase Auth
    deleted = await delete_supabase_user(user_id)
    if not deleted:
        logger.error(f"Failed to delete Supabase user {user_id}")
        raise HTTPException(status_code=500, detail="Failed to delete user account from authentication provider.")


@app.delete("/api/user/account")
async def delete_user_account(
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Deletes a registered user's account permanently:
    1. Rejects guest/anonymous accounts (they can simply sign out / clear local state).
    2. Cancels the user's running AI jobs and podcast renders, then deletes podcast episodes and audio
       on owned timelines and the user's episodes on other timelines first (retried once; HTTP 503
       before anything else is deleted if storage fails, so the user can simply retry).
    3. Hard-deletes all timelines, chats, quota records, and activity logs owned by this user.
    4. Deletes the user record from Supabase Auth admin API.
    """
    if is_guest_user(user):
        raise HTTPException(
            status_code=400,
            detail="Guest accounts cannot be deleted through this endpoint. Sign out to clear guest session."
        )

    user_id = user.get("id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    # From here, in-flight work for this account (jobs, renders, queued activity) may no longer
    # write. Cleared again if the deletion aborts, so the still-existing account keeps working.
    deleted_users.mark_deleted(user_id)
    try:
        await _delete_user_account_data(user_id)
    except BaseException:
        deleted_users.unmark_deleted(user_id)
        raise

    # Episodes created before the owner index existed (slow scan; never blocks the response).
    asyncio.create_task(_delete_legacy_owner_episodes_in_background(user_id))
    logger.info(f"User account {user_id} and all associated data deleted successfully")
    return {"success": True, "message": "Account and associated timelines deleted successfully"}


@app.post("/api/activity/game", status_code=204, dependencies=[Depends(game_activity_rate_limiter)])
async def report_game_completed(
    payload: GameCompletedRequest,
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """Records one finished timeline game (score only) in the activity log. Fire-and-forget."""
    log_game_completed(
        user,
        content_mode=payload.content_mode,
        timeline_id=payload.timeline_id,
        result_count=payload.total,
        duration_ms=payload.duration_ms,
        details={
            "game": payload.game,
            "correct": payload.correct,
            "total": payload.total,
            "points": payload.points,
            "ratio": round(payload.ratio, 3) if payload.ratio is not None else None,
            "stars": payload.stars,
            "difficulty": payload.difficulty,
        },
    )
    return Response(status_code=204)


@app.post("/api/timeline/enrich-item", dependencies=[Depends(wiki_lookup_rate_limiter)])
async def enrich_single_item(payload: dict = Body(...)):
    """
    Enrich an event with Wikipedia thumbnail & description by query.
    Supports any language edition with automatic English fallback.
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    title = str(payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    if len(title) > 300:
        raise HTTPException(status_code=400, detail="Title is too long")

    raw_lang = payload.get("lang")
    try:
        lang = normalize_wiki_lang(raw_lang, default="en", strict=bool(raw_lang and str(raw_lang).strip()))
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    fallback_title = str(payload.get("fallback_title") or payload.get("wikipedia_title_en") or "")[:300] or None
    context = str(payload.get("context") or payload.get("subtitle") or "")[:300]
    raw_year = payload.get("year")
    year: Optional[int] = None
    if raw_year is not None and raw_year != "":
        try:
            year = int(raw_year)
        except (TypeError, ValueError):
            year = None
    is_prehistoric = bool(payload.get("is_prehistoric", False))

    async with wikimedia_http_client(lane=WIKIMEDIA_LANE_INTERACTIVE) as client:
        sem = asyncio.Semaphore(1)
        res = await fetch_wikipedia_summary(
            title,
            client,
            sem,
            lang=lang,
            context_text=context,
            year=year,
            is_prehistoric=is_prehistoric,
            fallback_lang="en",
            fallback_title=fallback_title
        )
        return res

@app.post("/api/timeline/suggest-event", dependencies=[Depends(event_suggest_rate_limiter)])
async def suggest_single_event(
    payload: EventSuggestionRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Suggest event details using Gemini and Wikipedia.
    Requires authentication. Routes key based on the shared daily AI-operation quota.
    """
    client_ip = get_client_ip(request)
    eff_custom_key = x_gemini_api_key or payload.api_key
    api_key, key_tier, is_admin = await run_quota(
        resolve_gemini_key,
        user, eff_custom_key, increment_usage=True, client_ip=client_ip
    )
    if not api_key:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key)
        raise HTTPException(status_code=400, detail="Gemini API Key is missing. Configure it in .env or Settings.")

    try:
        async with track_ai_activity(
            "suggest_event", user,
            key_tier=key_tier,
            content_mode=payload.content_mode or "classic",
            prompt=payload.query,
            timeline_id=payload.timeline_id,
        ) as activity:
            suggestion = await run_with_key_failover(
                lambda key: suggest_event_details(
                    query=payload.query,
                    timeline_topic=payload.timeline_topic or "",
                    time_scale=payload.time_scale or "calendar",
                    lanes=payload.lanes or [],
                    api_key=key,
                    content_mode=payload.content_mode or "classic",
                ),
                api_key, key_tier, label="event suggestion"
            )
            if isinstance(suggestion, dict):
                activity["result_count"] = 1
                activity["details"]["has_image"] = bool(suggestion.get("imageUrl"))
        return suggestion
    except HTTPException:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key)
        raise
    except Exception as e:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key)
        logger.error(f"Error suggesting event: {e}")
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


# Drafts longer than this are charged as two text operations (output length scales with input).
TEXT_POLISH_LONG_CHARS = 4000


@app.post("/api/text/polish", dependencies=[Depends(text_polish_rate_limiter)])
async def polish_text(
    payload: TextPolishRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Polishes a user's rough draft for one free-text field (event title/summary/description,
    timeline title/description/overview, Story Studio moment/chapter titles).
    Draws from the shared daily AI credit bank like every other text operation.
    """
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to polish.")
    client_ip = get_client_ip(request)
    eff_custom_key = x_gemini_api_key or payload.api_key
    credits = get_text_credit_cost() * (2 if len(text) > TEXT_POLISH_LONG_CHARS else 1)
    api_key, key_tier, is_admin = await run_quota(
        resolve_gemini_key,
        user, eff_custom_key, increment_usage=True, client_ip=client_ip, credits=credits
    )
    if not api_key:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key, credits=credits)
        raise HTTPException(status_code=400, detail="Gemini API Key is missing. Configure it in .env or Settings.")

    try:
        async with track_ai_activity(
            "polish_text", user,
            key_tier=key_tier,
            content_mode=payload.content_mode or "classic",
            timeline_id=payload.timeline_id,
        ) as activity:
            activity["details"]["field"] = payload.field
            activity["details"]["input_chars"] = len(text)
            result = await run_with_key_failover(
                lambda key: polish_user_text(
                    text=text,
                    field=payload.field,
                    context=payload.context or "",
                    max_length=payload.max_length,
                    api_key=key,
                    content_mode=payload.content_mode or "classic",
                ),
                api_key, key_tier, label="text polish"
            )
            activity["result_count"] = 1
        return {"text": result.get("text", ""), "credits": credits if key_tier == "paid" else 0}
    except HTTPException:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key, credits=credits)
        raise
    except Exception as e:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key, credits=credits)
        logger.error(f"Error polishing text: {e}")
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


# Story facts longer than this are charged as two text operations; far longer is refused.
STORY_OVERVIEW_LONG_CHARS = 6000
STORY_OVERVIEW_MAX_CHARS = 60000


@app.post("/api/story/photo-import/cost-summary", dependencies=[Depends(photo_draft_rate_limiter)])
async def photo_import_cost_summary(
    payload: PhotoImportCostSummaryRequest,
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """Called once when a photo import ends: logs the cost of each major stage and the grand total
    of creating the timeline (server log only; nothing is returned)."""
    try:
        log_photo_import_summary(payload.import_run_id, user)
    except Exception:
        logger.warning("Could not log the photo import's cost summary", exc_info=True)
    return {"ok": True}


def _log_photo_import_cost(run_id: Optional[str], user: Dict[str, Any], step: str, activity: Dict[str, Any], events: int) -> None:
    """Adds this request's cost to its photo import run (logged as totals when the import ends)."""
    if not run_id:
        return
    try:
        record_photo_import_cost(run_id, user, step, float((activity or {}).get("cost_usd") or 0.0), events=events)
    except Exception:
        logger.warning("Could not record the photo import's cost", exc_info=True)


@app.post("/api/story/overview", dependencies=[Depends(text_polish_rate_limiter)])
async def story_overview(
    payload: StoryOverviewRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Drafts the overview of a Story Studio timeline from the user's own facts (people, chapters,
    moments and their notes). The user reviews and edits it before it is saved with the timeline.
    One text credit (two for long stories); admins and BYOK users are not charged.
    """
    story = payload.model_dump(by_alias=True, exclude={"api_key", "timeline_id", "content_mode", "language", "import_run_id", "occasion"})
    facts_chars = len(json.dumps(story, ensure_ascii=False))
    if facts_chars > STORY_OVERVIEW_MAX_CHARS:
        raise HTTPException(status_code=413, detail="This story is too long to draft an overview in one go.")
    client_ip = get_client_ip(request)
    eff_custom_key = x_gemini_api_key or payload.api_key
    credits = get_text_credit_cost() * (2 if facts_chars > STORY_OVERVIEW_LONG_CHARS else 1)
    api_key, key_tier, is_admin = await run_quota(
        resolve_gemini_key,
        user, eff_custom_key, increment_usage=True, client_ip=client_ip, credits=credits
    )
    if not api_key:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key, credits=credits)
        raise HTTPException(status_code=400, detail="Gemini API Key is missing. Configure it in .env or Settings.")

    activity: Dict[str, Any] = {}
    # Part of a photo import: its per-call cost box is quiet; the import logs totals at the end.
    quiet_token = QUIET_USAGE_LOGS.set(True) if payload.import_run_id else None
    try:
        async with track_ai_activity(
            "story_overview", user,
            key_tier=key_tier,
            content_mode=payload.content_mode or "classic",
            timeline_id=payload.timeline_id,
        ) as activity:
            activity["details"]["moments"] = len(payload.moments)
            activity["details"]["input_chars"] = facts_chars
            result = await run_with_key_failover(
                lambda key: draft_story_overview(
                    story=story,
                    language=payload.language or "en",
                    api_key=key,
                    content_mode=payload.content_mode or "classic",
                    occasion=payload.occasion,
                ),
                api_key, key_tier, label="story overview"
            )
            activity["result_count"] = 1
        return {"overview": result.get("overview", ""), "credits": credits if key_tier == "paid" else 0}
    except HTTPException:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key, credits=credits)
        raise
    except Exception as e:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key, credits=credits)
        logger.error(f"Error drafting story overview: {e}")
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))
    finally:
        _log_photo_import_cost(payload.import_run_id, user, "story_overview", activity, len(payload.moments))
        if quiet_token is not None:
            QUIET_USAGE_LOGS.reset(quiet_token)


# --- Story Studio photo import ---------------------------------------------------------------
# Limited tiers send small thumbnails; the server re-checks them so the credit price holds even
# for a modified client. Unlimited callers (admin / BYOK) get bigger, sharper batches.
_PHOTO_DRAFT_LIMITED_MAX_BYTES = 90_000
_PHOTO_DRAFT_UNLIMITED_MAX_BYTES = 280_000


def _check_photo_instructions(instructions: Optional[str], ent: Any) -> None:
    """The user's AI instructions go with every call of an import: the tier caps their length."""
    if len(instructions or "") > ent.photo_instructions_max_chars:
        raise HTTPException(
            status_code=400,
            detail=f"Instructions are too long (max {ent.photo_instructions_max_chars} characters).",
        )


def _decode_photo_draft_image(raw: str, max_px: int, max_bytes: int) -> Optional[bytes]:
    """Decodes one base64 JPEG thumbnail; downsizes it when it exceeds the tier's size. None = unusable."""
    if not isinstance(raw, str) or not raw:
        return None
    if len(raw) > PHOTO_DRAFT_MAX_IMAGE_CHARS:
        raise HTTPException(status_code=413, detail="A photo in the request is too large.")
    data_part = raw.split(",", 1)[1] if raw.startswith("data:") else raw
    try:
        data = base64.b64decode(data_part, validate=True)
    except Exception:
        return None
    if not data.startswith(b"\xff\xd8\xff"):
        return None
    try:
        from PIL import Image
        # Header-only size check before anything is decoded (ImageTooLargeError -> unusable).
        with open_image_checked(data, formats=("JPEG",)) as img:
            w, h = img.size
            if max(w, h) <= max_px * 1.1 and len(data) <= max_bytes:
                return data
            img = img.convert("RGB")
            img.thumbnail((max_px, max_px), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=78, optimize=True)
            return buf.getvalue()
    except Exception:
        return None


@app.get("/api/story/photo-import/limits")
async def photo_import_limits_endpoint(
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    """The caller's photo-import plan: batch sizes, photo detail, parallelism and credit price."""
    ent = get_entitlements(user, x_gemini_api_key)
    quota = hosted_photo_quota(user) if user else 0
    hosted = {"enabled": quota != 0, "quota": quota, "used": 0}
    if hosted["enabled"] and user and user.get("id"):
        reconciled = await _maybe_reconcile_hosted_photos(str(user["id"]), _hosted_photo_reconcile_seconds())
        hosted["used"] = (
            reconciled if reconciled is not None
            else await run_quota(get_hosted_photo_count, str(user["id"]))
        )
    return {
        **photo_import_limits(ent),
        "events_per_credit": get_photo_draft_events_per_credit(),
        # AI-first import: full drafts and the story pass (see calculate_photo_*_credit_cost).
        "full_events_per_credit": get_photo_draft_full_events_per_credit(),
        "story_events_per_credit": get_photo_story_events_per_credit(),
        # Historical Wikipedia links on personal timelines (see calculate_history_links_credit_cost).
        "history_events_per_credit": get_history_links_events_per_credit(),
        "hosted_photos": hosted,
    }


@app.post("/api/timeline/reverse-geocode", dependencies=[Depends(reverse_geocode_rate_limiter)])
async def reverse_geocode(
    payload: ReverseGeocodeRequest,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    """
    City-level place names for photo locations. Points are rounded to ~1 km before lookup and are
    never stored; identical cells in one request are looked up once.
    """
    ent = get_entitlements(user, x_gemini_api_key)
    if len(payload.points) > ent.reverse_geocode_points_per_call:
        raise HTTPException(
            status_code=400,
            detail=f"Too many places in one request (max {ent.reverse_geocode_points_per_call}).",
        )
    norm_lang = normalize_wiki_lang(payload.lang, default="en", strict=False) if payload.lang else None
    cells: List[tuple] = []
    for pt in payload.points:
        cell = round_reverse_geocode_point(pt.lat, pt.lng)
        if cell is not None and cell not in cells:
            cells.append(cell)
    await warm_reverse_geocode_cells(cells, lang=norm_lang)

    # Every cell is queued at once (Nominatim still sees <= 1 request/second site-wide); whatever
    # isn't answered within the deadline comes back as `place: null` with `partial: true` (SC-11).
    tasks = {cell: asyncio.create_task(reverse_geocode_point(cell[0], cell[1], lang=norm_lang)) for cell in cells}
    partial = False
    by_cell: Dict[tuple, Optional[Dict[str, Any]]] = {}
    if tasks:
        _done, pending = await asyncio.wait(tasks.values(), timeout=_reverse_geocode_deadline_seconds())
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        for cell, task in tasks.items():
            if task.cancelled():
                partial = True
                by_cell[cell] = None
                continue
            exc = task.exception()
            if exc is not None:
                partial = partial or isinstance(exc, NominatimBusyError)
                if not isinstance(exc, NominatimBusyError):
                    logger.warning(f"Reverse geocode lookup failed: {exc!r}")
                by_cell[cell] = None
            else:
                by_cell[cell] = task.result()

    results = []
    deferred_ids = []
    for pt in payload.points:
        cell = round_reverse_geocode_point(pt.lat, pt.lng)
        place = by_cell.get(cell) if cell is not None else None
        results.append({"id": pt.id, "place": place})
        if cell is not None and cell in tasks and place is None and (
            tasks[cell].cancelled() or isinstance(tasks[cell].exception(), NominatimBusyError)
        ):
            deferred_ids.append(pt.id)
    body: Dict[str, Any] = {"results": results}
    if partial:
        body["partial"] = True
        body["deferred"] = deferred_ids
    return body


def _reverse_geocode_deadline_seconds() -> float:
    try:
        return max(1.0, float(os.getenv("REVERSE_GEOCODE_REQUEST_DEADLINE_SEC", "15") or 15))
    except ValueError:
        return 15.0


# --- Hosted timeline photos (see services/photo_store.py) ------------------------------------

# The counter only ever went up (uploads of abandoned imports, deleted timelines). It is recounted
# from the storage listing at most every HOSTED_PHOTO_RECONCILE_HOURS per user, and sooner (at most
# every few minutes) when an upload would hit the limit (B-26). Photos are never garbage-collected
# automatically: one may still be referenced by a timeline (see DEPLOYMENT_STEPS.md, Batch 4B).
_HOSTED_PHOTO_RECONCILED_AT: Dict[str, float] = {}
_HOSTED_PHOTO_NEAR_LIMIT_RECONCILE_SECONDS = 300.0


def _hosted_photo_reconcile_seconds() -> float:
    try:
        hours = float(os.getenv("HOSTED_PHOTO_RECONCILE_HOURS", "6") or 6)
    except ValueError:
        hours = 6.0
    return max(0.05, hours) * 3600.0


async def _maybe_reconcile_hosted_photos(user_id: str, min_interval: float) -> Optional[int]:
    """Recounts the user's stored photos and fixes the counter, at most once per `min_interval`.
    Returns the reconciled count, or None when skipped or the count couldn't be read."""
    now = time.time()
    if now - _HOSTED_PHOTO_RECONCILED_AT.get(user_id, 0.0) < min_interval:
        return None
    _HOSTED_PHOTO_RECONCILED_AT[user_id] = now
    if len(_HOSTED_PHOTO_RECONCILED_AT) > 10_000:
        cutoff = now - _hosted_photo_reconcile_seconds()
        for uid, ts in list(_HOSTED_PHOTO_RECONCILED_AT.items()):
            if ts < cutoff:
                _HOSTED_PHOTO_RECONCILED_AT.pop(uid, None)
    actual = await run_bulk(photo_store.count_owner_photos, user_id)
    if actual is None:
        return None
    try:
        return await run_quota(set_hosted_photo_count, user_id, actual)
    except Exception as e:  # SC-09 fail-closed store: keep the old count
        logger.warning(f"Could not reconcile the hosted-photo count: {e}")
        return None


# --- Book import (docs/book-import-spec.md) ------------------------------------------------------
# Long books, scans and page photos -> a reviewed personal timeline. The pipeline lives in
# services/book_import; this block only supplies what it needs from the app (auth, quotas, photo
# storage, timeline persistence) and runs its durable runner inside this process.
from services.book_import import api as book_import_api  # noqa: E402
from services.book_import.config import get_config as get_book_import_config  # noqa: E402
from services.book_import.pipeline import Host as BookImportHost  # noqa: E402
from services.book_import.runner import BookImportRunner, get_runner as get_book_import_runner, set_runner as set_book_import_runner  # noqa: E402
from services.book_import.store import get_store as get_book_import_store  # noqa: E402

book_import_create_limiter = SimpleRateLimiter(max_requests=10, window_seconds=3600, name="book import create", env_var="BOOK_IMPORT_CREATE_PER_HOUR")
book_import_poll_limiter = SimpleRateLimiter(max_requests=240, window_seconds=60, name="book import status", byok_multiplier=False)
book_import_ops_limiter = SimpleRateLimiter(max_requests=180, window_seconds=60, name="book import edits", byok_multiplier=False)


async def _book_photo_quota_remaining(user: Dict[str, Any]) -> Optional[int]:
    quota = hosted_photo_quota(user)
    if quota is None:
        return None
    user_id = str((user or {}).get("id") or "")
    if not user_id or quota <= 0:
        return 0
    used = await run_quota(get_hosted_photo_count, user_id)
    reconciled = await _maybe_reconcile_hosted_photos(user_id, _HOSTED_PHOTO_NEAR_LIMIT_RECONCILE_SECONDS)
    if reconciled is not None:
        used = reconciled
    return max(0, quota - int(used or 0))


async def _book_change_photo_count(user_id: str, delta: int) -> int:
    return await run_quota(change_hosted_photo_count, user_id, delta)


def _shrink_webp(data: bytes, limit: int) -> bytes:
    from PIL import Image as _Image
    import io as _io

    img = _Image.open(_io.BytesIO(data)).convert("RGB")
    for side, quality in ((1800, 76), (1600, 70), (1280, 66)):
        img.thumbnail((side, side))
        buf = _io.BytesIO()
        img.save(buf, format="WEBP", quality=quality, method=4)
        if buf.tell() <= limit:
            return buf.getvalue()
    return buf.getvalue()


async def _book_put_hosted_photo(user_id: str, data: bytes) -> str:
    limit = photo_store.MAX_UPLOAD_BYTES - 64 * 1024
    if len(data) > limit:
        data = await run_cpu(_shrink_webp, data, limit)
    key = photo_store.new_key(user_id, "webp")
    await run_bulk(photo_store.put_photo, key, data)
    return photo_store.public_url(key)


async def _book_persist_timeline(timeline: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
    saved = await _persist_timeline_dict(
        timeline, user=user, target_owner=str(user.get("id")), existing_meta=None, id_is_server_generated=True,
    )
    if isinstance(saved, dict):
        return {**saved, "id": saved.get("id") or timeline.get("id")}
    return {"id": timeline.get("id")}


async def _book_verify_key(api_key: str) -> bool:
    """One tiny call proves a personal key works (marks it verified for the rest of the app too)."""
    from google.genai import types as _types

    try:
        from services.gemini_service import _generate_with_retry as _gen, aget_gemini_client as _client_for

        client = await _client_for(api_key)

        await _gen(client, max_retries=0, model="gemini-3.1-flash-lite", contents="ping",
                   config=_types.GenerateContentConfig(max_output_tokens=1))
        mark_custom_key_verified(api_key)
        return True
    except Exception as e:
        logger.info(f"Book import key check failed: {e}")
        return False


_book_import_host = BookImportHost(
    persist_timeline=_book_persist_timeline,
    photo_quota_remaining=_book_photo_quota_remaining,
    change_photo_count=_book_change_photo_count,
    put_hosted_photo=_book_put_hosted_photo,
    geocode_enabled=(os.getenv("BOOK_IMPORT_GEOCODE", "true").strip().lower() not in ("0", "false", "off", "no")),
)

app.include_router(book_import_api.build_router(book_import_api.ApiDeps(
    current_user=get_current_user_required,
    is_admin=is_admin_user,
    is_guest=is_guest_user,
    key_verified=is_custom_key_verified,
    verify_key=_book_verify_key,
    photo_quota_remaining=_book_photo_quota_remaining,
    store=get_book_import_store,
    runner=get_book_import_runner,
    rate_create=book_import_create_limiter,
    rate_poll=book_import_poll_limiter,
    rate_ops=book_import_ops_limiter,
)))


async def _start_book_import_runner() -> None:
    cfg = get_book_import_config()
    if not cfg.enabled:
        return
    try:
        runner = BookImportRunner(get_book_import_store, _book_import_host)
        set_book_import_runner(runner)
        await runner.start()
    except Exception as e:
        logger.warning(f"Book import runner did not start: {e}")


async def _stop_book_import_runner() -> None:
    runner = get_book_import_runner()
    if runner is not None:
        try:
            await runner.shutdown(budget=15.0)
        except Exception as e:
            logger.warning(f"Book import runner shutdown: {e}")
        set_book_import_runner(None)


async def _delete_user_book_imports(user_id: str) -> None:
    if not get_book_import_config().enabled:
        return
    try:
        await book_import_api.delete_owner_imports(get_book_import_store(), user_id)
    except Exception as e:
        logger.warning(f"Could not delete book imports for {user_id}: {e}")


@app.post("/api/photos", dependencies=[Depends(photo_upload_rate_limiter)])
async def upload_timeline_photo(
    file: UploadFile = File(...),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """
    Stores one (already resized) timeline photo and returns its URL. Counts against the user's
    hosted-photo quota: registered and own-key users 2,000 (REGISTERED_HOSTED_PHOTOS), admins
    unlimited, guests none (their photos stay inline in the timeline).
    """
    quota = hosted_photo_quota(user)
    if quota == 0:
        raise HTTPException(status_code=403, detail="Sign in to keep all your photos.")
    user_id = str(user.get("id") or "")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    data = await file.read(photo_store.MAX_UPLOAD_BYTES + 1)
    # P-14: Pillow re-encodes the photo while the slot is reserved (the counter RPC), instead of one
    # after the other. A photo that turns out to be rejected gives its slot back.
    prepare_task = asyncio.ensure_future(run_cpu(photo_store.prepare_photo, data))
    try:
        # Reserve the slot before storing so parallel uploads can't overshoot the quota.
        count = await run_quota(change_hosted_photo_count, user_id, 1)
    except BaseException:
        _discard_task(prepare_task)
        raise
    try:
        clean, ext = await prepare_task
    except photo_store.PhotoRejected as err:
        await run_quota(change_hosted_photo_count, user_id, -1)
        raise HTTPException(status_code=400, detail=str(err))
    except BaseException:
        await run_quota(change_hosted_photo_count, user_id, -1)
        raise

    if quota is not None and count > quota:
        await run_quota(change_hosted_photo_count, user_id, -1)
        # The counter may be inflated (abandoned imports): recount before refusing, then retry once.
        reconciled = await _maybe_reconcile_hosted_photos(user_id, _HOSTED_PHOTO_NEAR_LIMIT_RECONCILE_SECONDS)
        retried = reconciled is not None and reconciled < quota
        if retried:
            count = await run_quota(change_hosted_photo_count, user_id, 1)
        if not retried or count > quota:
            if retried:
                await run_quota(change_hosted_photo_count, user_id, -1)
            raise HTTPException(status_code=403, detail=f"You've reached your limit of {quota} stored photos.")
    key = photo_store.new_key(user_id, ext)
    try:
        await run_bulk(photo_store.put_photo, key, clean)
    except Exception as e:
        await run_quota(change_hosted_photo_count, user_id, -1)
        logger.error(f"Photo upload failed: {e}")
        raise HTTPException(status_code=502, detail="Couldn't store the photo. Try again.")
    return {"url": photo_store.public_url(key), "key": key, "used": count, "quota": quota}


@app.delete("/api/photos/{key:path}")
async def delete_timeline_photo(key: str, user: Dict[str, Any] = Depends(get_current_user_required)):
    """Deletes one of the caller's own stored photos and frees its slot in the hosted-photo quota."""
    user_id = str(user.get("id") or "")
    if not user_id or not photo_store.owns_key(user_id, key):
        raise HTTPException(status_code=404, detail="Photo not found")
    try:
        deleted = await run_bulk(photo_store.delete_photo, key)
    except Exception as e:
        logger.warning(f"Photo delete failed: {e}")
        raise HTTPException(status_code=502, detail="Couldn't delete the photo. Try again.")
    if deleted:
        await run_quota(change_hosted_photo_count, user_id, -1)
    return {"deleted": bool(deleted)}


@app.get("/api/photos/{key:path}")
async def get_timeline_photo(key: str):
    """Local-storage mode only (Supabase serves hosted photos from its CDN)."""
    found = await run_bulk(photo_store.get_local_photo, key)
    if not found:
        raise HTTPException(status_code=404, detail="Photo not found")
    data, ctype = found
    return Response(content=data, media_type=ctype, headers={"Cache-Control": "public, max-age=31536000, immutable"})


# --- Google Photos Picker proxy (see services/google_photos.py) -------------------------------

def _google_photos_http_error(err: "google_photos.GooglePhotosError") -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.message)


@app.post("/api/google-photos/sessions", dependencies=[Depends(google_photos_rate_limiter)])
async def google_photos_create_session(
    x_google_photos_token: Optional[str] = Header(None, alias="X-Google-Photos-Token"),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """Starts a Google Photos picking session; the user picks in Google's own page (pickerUri)."""
    ent = get_entitlements(user, x_gemini_api_key)
    cap = ent.photo_import_max_photos or google_photos.PICKER_MAX_ITEMS
    try:
        token = google_photos.clean_token(x_google_photos_token)
        return await google_photos.create_session(token, max_items=min(cap, google_photos.PICKER_MAX_ITEMS))
    except google_photos.GooglePhotosError as err:
        raise _google_photos_http_error(err)


@app.get("/api/google-photos/sessions/{session_id}", dependencies=[Depends(google_photos_rate_limiter)])
async def google_photos_get_session(
    session_id: str,
    x_google_photos_token: Optional[str] = Header(None, alias="X-Google-Photos-Token"),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    try:
        return await google_photos.get_session(google_photos.clean_token(x_google_photos_token), session_id)
    except google_photos.GooglePhotosError as err:
        raise _google_photos_http_error(err)


@app.get("/api/google-photos/sessions/{session_id}/items", dependencies=[Depends(google_photos_rate_limiter)])
async def google_photos_list_items(
    session_id: str,
    page_token: Optional[str] = Query(None, max_length=2000),
    x_google_photos_token: Optional[str] = Header(None, alias="X-Google-Photos-Token"),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """One page (<= 100) of the picked photos: id, capture time, file name, a short-lived baseUrl."""
    try:
        return await google_photos.list_items(google_photos.clean_token(x_google_photos_token), session_id, page_token)
    except google_photos.GooglePhotosError as err:
        raise _google_photos_http_error(err)


@app.delete("/api/google-photos/sessions/{session_id}", dependencies=[Depends(google_photos_rate_limiter)])
async def google_photos_delete_session(
    session_id: str,
    x_google_photos_token: Optional[str] = Header(None, alias="X-Google-Photos-Token"),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    try:
        await google_photos.delete_session(google_photos.clean_token(x_google_photos_token), session_id)
        return {"ok": True}
    except google_photos.GooglePhotosError as err:
        raise _google_photos_http_error(err)


@app.get("/api/google-photos/media", dependencies=[Depends(google_photos_media_rate_limiter)])
async def google_photos_media(
    url: str = Query(..., max_length=4000),
    size: int = Query(320),
    x_google_photos_token: Optional[str] = Header(None, alias="X-Google-Photos-Token"),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """A picked photo resized to fit `size` px (thumbnails, AI copies, stored copies). Not cached."""
    try:
        data, ctype = await google_photos.fetch_media(google_photos.clean_token(x_google_photos_token), url, size)
    except google_photos.GooglePhotosError as err:
        raise _google_photos_http_error(err)
    return Response(content=data, media_type=ctype, headers={"Cache-Control": "private, no-store"})


@app.post("/api/story/photo-drafts", dependencies=[Depends(photo_draft_rate_limiter)])
async def photo_drafts(
    payload: PhotoDraftRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """
    Drafts photo-events in the Story Studio photo import: titles + one sentence ("brief"), or a
    complete event - caption, story, cover pick, kind, category, importance, occasion - for the
    AI-first import ("full").

    Limited tiers (guest / registered) pay `calculate_photo_draft_credit_cost(events, detail)`
    credits per call from the shared daily bank and fall back to free keys when it is empty, like every text
    operation. Admin and BYOK callers are never charged and get the unlimited plan (40 events per
    call, 6 photos per event at 768px, parallel calls) - see entitlements.photo_import_limits.
    """
    eff_custom_key = x_gemini_api_key or payload.api_key
    ent = get_entitlements(user, eff_custom_key)
    if len(payload.events) > ent.photo_draft_max_events_per_call:
        raise HTTPException(
            status_code=400,
            detail=f"Too many events in one request (max {ent.photo_draft_max_events_per_call}).",
        )
    if len({ev.id for ev in payload.events}) != len(payload.events):
        raise HTTPException(status_code=400, detail="Event ids must be unique.")
    _check_photo_instructions(payload.instructions, ent)

    max_imgs = ent.photo_draft_max_images_per_event
    max_px = ent.photo_draft_image_max_px
    max_bytes = _PHOTO_DRAFT_UNLIMITED_MAX_BYTES if ent.is_unlimited else _PHOTO_DRAFT_LIMITED_MAX_BYTES

    def _prepare_events() -> List[Dict[str, Any]]:
        prepared = []
        for ev in payload.events:
            images = []
            for raw in ev.images[:max_imgs]:
                data = _decode_photo_draft_image(raw, max_px, max_bytes)
                if data:
                    images.append(data)
            prepared.append({
                "id": ev.id,
                "place": (ev.place or "").strip(),
                "date_text": (ev.date_text or "").strip(),
                "photo_count": ev.photo_count,
                "at_home": ev.at_home,
                "hint": (ev.hint or "").strip(),
                "current_title": (ev.current_title or "").strip(),
                "people_tagged": [p for p in (ev.people_tagged or []) if isinstance(p, str)][:10],
                "needs_place": bool(ev.needs_place),
                "time_text": (ev.time_text or "").strip(),
                "sequence": (ev.sequence or "").strip(),
                "images": images,
            })
        return prepared

    events = await run_cpu(_prepare_events)
    image_count = sum(len(e["images"]) for e in events)

    client_ip = get_client_ip(request)
    detail = payload.detail or "brief"
    credits = calculate_photo_draft_credit_cost(len(events), detail)
    api_key, key_tier, is_admin = await run_quota(
        resolve_gemini_key,
        user, eff_custom_key, increment_usage=True, client_ip=client_ip, credits=credits
    )
    if not api_key:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key, credits=credits)
        raise HTTPException(status_code=400, detail="Gemini API Key is missing. Configure it in .env or Settings.")

    activity: Dict[str, Any] = {}
    # Part of a photo import: its per-call cost box is quiet; the import logs totals at the end.
    quiet_token = QUIET_USAGE_LOGS.set(True) if payload.import_run_id else None
    try:
        async with track_ai_activity(
            "photo_drafts", user,
            key_tier=key_tier,
            content_mode=payload.content_mode or "classic",
            timeline_id=payload.timeline_id,
        ) as activity:
            activity["details"]["events"] = len(events)
            activity["details"]["images"] = image_count
            activity["details"]["plan"] = ent.tier
            activity["details"]["detail"] = detail
            result = await run_with_key_failover(
                lambda key: draft_photo_events(
                    events=events,
                    story_kind=payload.story_kind or "",
                    story_title=payload.story_title or "",
                    people=payload.people,
                    lang=payload.lang or "en",
                    api_key=key,
                    content_mode=payload.content_mode or "classic",
                    detail=detail,
                    story_context=payload.story_context or "",
                    instructions=payload.instructions or "",
                ),
                api_key, key_tier, label="photo drafts"
            )
            activity["result_count"] = len(result.get("drafts") or [])
        return {
            "drafts": result.get("drafts") or [],
            "credits": credits if key_tier == "paid" else 0,
            "tier": key_tier,
        }
    except HTTPException:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key, credits=credits)
        raise
    except Exception as e:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key, credits=credits)
        logger.error(f"Error drafting photo events: {e}")
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))
    finally:
        _log_photo_import_cost(payload.import_run_id, user, "photo_drafts", activity, len(events))
        if quiet_token is not None:
            QUIET_USAGE_LOGS.reset(quiet_token)


@app.post("/api/story/photo-story", dependencies=[Depends(photo_draft_rate_limiter)])
async def photo_story(
    payload: PhotoStoryRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """
    The story pass of the AI-first photo import: one text-only call over every drafted event
    (in time order) that returns the timeline's title and story type, chapter names, merges of
    moments split in two, tidier titles and the highlights - all checked against the events.

    Limited tiers pay `calculate_photo_story_credit_cost(events)` (one credit per 120 events by
    default); admins and BYOK callers are never charged.
    """
    eff_custom_key = x_gemini_api_key or payload.api_key
    ent = get_entitlements(user, eff_custom_key)
    if len(payload.events) > ent.photo_story_max_events:
        raise HTTPException(
            status_code=400,
            detail=f"Too many events in one request (max {ent.photo_story_max_events}).",
        )
    if len({ev.id for ev in payload.events}) != len(payload.events):
        raise HTTPException(status_code=400, detail="Event ids must be unique.")
    _check_photo_instructions(payload.instructions, ent)

    events = [
        {
            "id": ev.id,
            "date_text": (ev.date_text or "").strip(),
            "place": (ev.place or "").strip(),
            "title": (ev.title or "").strip(),
            "caption": (ev.caption or "").strip(),
            "story": (ev.story or "").strip(),
            "photo_count": ev.photo_count,
            "at_home": ev.at_home,
            "trip": (ev.trip or "").strip(),
            "people_tagged": [p for p in (ev.people_tagged or []) if isinstance(p, str)][:10],
            "occasion": (ev.occasion or "").strip(),
            "user_titled": bool(ev.user_titled),
        }
        for ev in payload.events
    ]
    client_ip = get_client_ip(request)
    credits = calculate_photo_story_credit_cost(len(events))
    api_key, key_tier, is_admin = await run_quota(
        resolve_gemini_key,
        user, eff_custom_key, increment_usage=True, client_ip=client_ip, credits=credits
    )
    if not api_key:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key, credits=credits)
        raise HTTPException(status_code=400, detail="Gemini API Key is missing. Configure it in .env or Settings.")

    activity: Dict[str, Any] = {}
    # Part of a photo import: its per-call cost box is quiet; the import logs totals at the end.
    quiet_token = QUIET_USAGE_LOGS.set(True) if payload.import_run_id else None
    try:
        async with track_ai_activity(
            "photo_story", user,
            key_tier=key_tier,
            content_mode=payload.content_mode or "classic",
            timeline_id=payload.timeline_id,
        ) as activity:
            activity["details"]["events"] = len(events)
            activity["details"]["mode"] = payload.mode
            activity["details"]["plan"] = ent.tier
            result = await run_with_key_failover(
                lambda key: draft_photo_story(
                    events=events,
                    story_context=payload.story_context or "",
                    instructions=payload.instructions or "",
                    people=payload.people,
                    home=payload.home or "",
                    mode=payload.mode,
                    existing_title=payload.existing_title or "",
                    lang=payload.lang or "en",
                    api_key=key,
                    content_mode=payload.content_mode or "classic",
                ),
                api_key, key_tier, label="photo story"
            )
            activity["result_count"] = len(result.get("chapters") or [])
        body = {k: v for k, v in result.items() if k != "tokenUsage"}
        return {**body, "credits": credits if key_tier == "paid" else 0, "tier": key_tier}
    except HTTPException:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key, credits=credits)
        raise
    except Exception as e:
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key, credits=credits)
        logger.error(f"Error in the photo story pass: {e}")
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))
    finally:
        _log_photo_import_cost(payload.import_run_id, user, "photo_story", activity, len(events))
        if quiet_token is not None:
            QUIET_USAGE_LOGS.reset(quiet_token)


@app.post("/api/timeline/personal-enrichment", dependencies=[Depends(photo_draft_rate_limiter)])
async def personal_enrichment(
    payload: PersonalEnrichmentRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """
    Wikipedia links for a personal timeline's events (Story Studio templates, photo imports, older
    timelines): places (no AI), historical events (one text-only pass, every candidate checked
    against Wikipedia and Wikidata) and, when asked, illustrative pictures of places for events
    without a photo. See services/personal_enrichment.py.

    Places and pictures are free. The historical pass costs limited tiers
    `calculate_history_links_credit_cost(events)` (refunded when it fails); admins and BYOK callers
    are never charged. Without AI access the places and pictures are still returned.
    """
    from services.place_links import clean_link
    from services.personal_enrichment import PersonalEvent, enrich_personal_events, structured_history_ask

    if len({ev.id for ev in payload.events}) != len(payload.events):
        raise HTTPException(status_code=400, detail="Event ids must be unique.")
    events = [
        PersonalEvent(
            id=ev.id, title=(ev.title or "").strip(), text=(ev.text or "").strip(), year=ev.year, to_year=ev.to_year,
            place=(ev.place or "").strip(), lat=ev.lat, lng=ev.lng, has_image=ev.has_image,
            place_link=clean_link(ev.place_link) if ev.place_link else None, rank=ev.rank or 5,
        )
        for ev in payload.events
    ]
    eff_custom_key = x_gemini_api_key or payload.api_key
    client_ip = get_client_ip(request)
    credits = calculate_history_links_credit_cost(len(events)) if payload.history else 0
    api_key = key_tier = None
    history_skipped = None
    if payload.history:
        try:
            api_key, key_tier, _ = await run_quota(
                resolve_gemini_key, user, eff_custom_key, increment_usage=True, client_ip=client_ip, credits=credits
            )
        except HTTPException as e:
            history_skipped = "quota" if e.status_code in (402, 429) else "unavailable"
        if not api_key and history_skipped is None:
            history_skipped = "no_key"

    ask = None
    if api_key:
        from services.gemini_service import get_gemini_models_to_try

        ask = structured_history_ask(api_key=api_key, models=get_gemini_models_to_try())
    try:
        async with track_ai_activity(
            "history_links", user,
            key_tier=key_tier or "none",
            content_mode=payload.content_mode or "classic",
            timeline_id=payload.timeline_id,
        ) as activity:
            activity["details"]["events"] = len(events)
            result = await enrich_personal_events(
                events, payload.lang, places=payload.places, history=ask, images=payload.images,
            )
            activity["details"].update({k: v for k, v in result.stats.items() if isinstance(v, (int, str, bool))})
            activity["result_count"] = sum(len(v) for v in result.links.values())
    except Exception as e:
        if api_key:
            await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key, credits=credits)
        logger.error(f"Error in personal enrichment: {e}")
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))
    charged = credits if (api_key and key_tier == "paid") else 0
    if api_key and result.stats.get("history_failed"):
        await _refund_sync_call_quota(user, client_ip, key_tier, eff_custom_key, credits=credits)
        charged = 0
        history_skipped = "failed"
    return {
        "links": result.links,
        "images": result.images,
        "stats": result.stats,
        "historySkipped": history_skipped,
        "credits": charged,
        "tier": key_tier,
    }


def _seconds_until_utc_midnight() -> int:
    now = datetime.now(timezone.utc)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((tomorrow - now).total_seconds()))


_PREMIUM_IMAGE_UNAVAILABLE_DETAIL = (
    "Premium AI images are temporarily unavailable and your credits were not used. "
    "Please try the free image generator."
)


@app.post("/api/timeline/generate-event-image", dependencies=[Depends(event_suggest_rate_limiter)])
async def generate_single_event_image(
    payload: EventImageGenerationRequest,
    request: Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
    user: Dict[str, Any] = Depends(get_current_user_required)
):
    """
    Generate an AI image/illustration for a single timeline event on demand.
    - When `payload.engine == 'free'`, routes directly to the free Hugging Face / Pollinations
      generator without consuming the user's daily premium quota (0 credits) or touching the paid server key.
    - When `payload.engine == 'premium'`, consumes `get_gemini_image_credit_cost()` (default 6)
      credits from the shared daily AI credit bank (refunded if generation fails), or rejects
      with HTTP 402 if the user does not have enough remaining credits.
    """
    client_ip = get_client_ip(request)
    custom_key = x_gemini_api_key or payload.api_key
    requested_engine = (payload.engine or "auto").strip().lower()
    is_admin = is_admin_user(user)
    has_custom_key = bool(custom_key and custom_key.strip())

    if requested_engine == "free" or (requested_engine == "auto" and not has_custom_key and not is_admin):
        prefer_free = True
    else:
        prefer_free = False

    pool_reserved = False
    img_cost = 0
    free_image_ids: List[str] = []
    if prefer_free:
        # The free engine's HF / Pollinations fetches and Pillow work are paid by the server even
        # at 0 credits (S-12): its own limiter (never widened by BYOK) plus a daily cap per identity
        # and per IP. Admins are exempt from both.
        await free_image_rate_limiter(request, x_gemini_api_key, user)
        allowed_free, free_image_ids = await run_quota(reserve_free_image_generation, user, client_ip)
        if not allowed_free:
            raise HTTPException(
                status_code=429,
                detail="You've reached today's limit for free AI images. Please try again tomorrow.",
                headers={"Retry-After": str(_seconds_until_utc_midnight())},
            )
        # Never call resolve_gemini_key or fall back to the paid server key on free image requests.
        if has_custom_key:
            api_key = custom_key.strip()
            key_tier = "custom"
        else:
            paid_server_key = (os.getenv("GEMINI_API_KEY") or "").strip()
            free_candidates = [
                k for k in get_all_free_keys() if k and k != paid_server_key
            ]
            api_key = free_candidates[0] if free_candidates else None
            key_tier = "free"
        incremented_quota = False
    else:
        img_cost = get_gemini_image_credit_cost()
        allowed, api_key, key_tier, incremented_quota, pool_reserved = await run_quota(
            charge_premium_credits, user, custom_key, client_ip, img_cost, require_paid_key=True
        )
        if not allowed and key_tier in (PREMIUM_KEY_UNAVAILABLE_TIER, QUOTA_STORE_UNAVAILABLE_TIER):
            raise HTTPException(status_code=503, detail=_PREMIUM_IMAGE_UNAVAILABLE_DETAIL)
        if not allowed:
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Not enough premium AI credits (requires {img_cost} credits). "
                    "Please use the free image generator or configure a paid personal Gemini API key in Settings."
                ),
            )

    if not api_key and not prefer_free:
        raise HTTPException(status_code=400, detail="Gemini API Key is missing. Configure it in .env or Settings.")

    effective_tier = ("custom" if has_custom_key else "free") if prefer_free else key_tier
    # Paid server credits must buy a Gemini image: no free-key rotation, no free-generator substitute.
    premium_charged = bool(incremented_quota or pool_reserved)
    try:
        async with track_ai_activity(
            "generate_image", user,
            key_tier=effective_tier,
            content_mode=payload.content_mode or "classic",
            prompt=payload.custom_prompt or payload.title,
            timeline_id=payload.timeline_id,
            details={
                "source": payload.source,
                "style": payload.style or "auto",
                "engine": requested_engine,
                "custom_prompt": bool(payload.custom_prompt),
            },
        ) as activity:
            result = await run_with_key_failover(
                lambda key: generate_event_image_with_gemini(
                    title=payload.title,
                    subtitle=payload.subtitle or "",
                    year=payload.year,
                    time_scale=payload.time_scale or "calendar",
                    timeline_topic=payload.timeline_topic or "",
                    location_name=payload.location_name,
                    is_fictional=bool(payload.is_fictional),
                    custom_prompt=payload.custom_prompt,
                    style=payload.style or "auto",
                    content_mode=payload.content_mode or "classic",
                    api_key=key,
                    prefer_free=prefer_free,
                    allow_free_fallback=not premium_charged,
                ),
                api_key, effective_tier, label="event image generation",
                failover_to_free=not premium_charged,
            )
            activity["result_count"] = 1 if result and result.get("imageUrl") else 0
            if result and result.get("model"):
                activity["model"] = str(result["model"])[:80]
            if isinstance(result, dict):
                total_cost = round(
                    float(
                        activity.get("cost_usd")
                        or (result.get("tokenUsage") or {}).get("estimatedCostUsd")
                        or result.get("imageCostUsd")
                        or 0.0
                    ),
                    6,
                )
                result["imageCostUsd"] = total_cost
        return result
    except Exception as e:
        if free_image_ids:
            try:
                await run_quota(refund_daily_counters, free_image_ids)
            except Exception as refund_err:
                logger.warning(f"Failed to refund free image allowance: {refund_err}")
        if incremented_quota or pool_reserved:
            try:
                if incremented_quota:
                    await run_quota(
                        refund_user_quota,
                        user,
                        client_ip=client_ip,
                        refund_pool=pool_reserved,
                        credits=max(1, img_cost),
                    )
                elif pool_reserved:
                    await run_quota(refund_community_paid_prompt, credits=max(1, img_cost))
            except Exception as refund_err:
                logger.warning(f"Failed to refund quota after failed event image generation: {refund_err}")
        logger.error(f"Error generating event image: {e}")
        if premium_charged and isinstance(e, PremiumImageUnavailableError):
            raise HTTPException(status_code=503, detail=_PREMIUM_IMAGE_UNAVAILABLE_DETAIL)
        raise HTTPException(status_code=500, detail=format_api_error_for_user(e, user))


@app.get("/api/timeline/wiki-search", dependencies=[Depends(wiki_lookup_rate_limiter)])
async def wiki_search(
    query: str = Query(..., max_length=200),
    lang: Optional[str] = Query(None, max_length=32),
    context: Optional[str] = Query("", max_length=300),
    limit: int = Query(5, ge=1, le=10),
):
    """
    Search Wikipedia for multiple candidate matches for an event name with optional timeline context.
    """
    clean = query.strip()
    if not clean:
        return []

    try:
        norm_lang = normalize_wiki_lang(lang, default="en", strict=bool(lang and lang.strip()))
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    async with wikimedia_http_client(lane=WIKIMEDIA_LANE_INTERACTIVE) as client:
        candidates = await search_wikipedia_candidates(
            query=clean,
            client=client,
            lang=norm_lang,
            context_text=context or "",
            limit=limit
        )
        return candidates

@app.get("/api/timeline/geocode-search", dependencies=[Depends(geocode_rate_limiter)])
async def geocode_search(
    query: str = Query(..., max_length=200),
    lang: Optional[str] = Query(None, max_length=32),
    limit: int = Query(5, ge=1, le=10),
):
    """
    Search for place-name candidates (with coordinates) so the user can pick the
    correct location for a manually added/edited event, syncing it with the map.
    """
    norm_lang = normalize_wiki_lang(lang, default="en", strict=False) if lang else None
    return await search_geocode_candidates(query=query, limit=limit, lang=norm_lang)

@app.get("/api/media/youtube-search", dependencies=[Depends(media_search_rate_limiter)])
async def youtube_search(
    q: str = Query(..., max_length=300),
    lang: Optional[str] = Query(None, max_length=10),
    context: Optional[str] = Query(None, max_length=150),
    user: Dict[str, Any] = Depends(get_current_user_required),
):
    """
    Embeddable YouTube videos for an event (drawer Videos tab). Needs a session (guests are
    signed-in anonymous users) and spends the global daily search budget only on cache misses;
    when it is spent the response is {"items": [], "error": "quota"} and the UI shows its
    "search on YouTube" link.
    """
    return await search_youtube_videos(q, lang, context=context)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
