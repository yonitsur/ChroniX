import asyncio
from collections import OrderedDict
import contextlib
import itertools
import json
import logging
import os
import re
import time
import unicodedata
import urllib.parse
from collections import deque
from contextvars import ContextVar
from typing import Dict, Any, Optional, List
import httpx

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "ChroniXApp/1.0 (https://github.com/yonitsur/VisualTimeLine; yonitsur@gmail.com)"
}

_WIKI_CACHE_TTL = 1800  # 30 minutes
_WIKI_CACHE_MAX_ENTRIES = 2000  # Compact text/metadata entries (~few MB worst-case across timelines)
_IMAGE_LIST_CACHE_MAX_ENTRIES = 512  # Multi-item Commons/article candidate lists
_RAW_SUMMARY_CACHE: "OrderedDict[tuple, Any]" = OrderedDict()   # (lang, clean_title_lower) -> (expires_at, (status_code, json_dict))
_SEARCH_CACHE: "OrderedDict[tuple, Any]" = OrderedDict()        # (lang, query_lower, limit) -> (expires_at, List[str])
_LANGLINK_CACHE: "OrderedDict[tuple, Any]" = OrderedDict()      # (from_lang, to_lang, clean_title_lower) -> (expires_at, Optional[str])
_PROBE_CACHE: "OrderedDict[tuple, Any]" = OrderedDict()         # (from_lang, to_lang, clean_title_lower) -> (expires_at, Optional[Dict])
_COMMONS_GIF_CACHE: "OrderedDict[tuple, Any]" = OrderedDict()   # (query_lower, limit) -> (expires_at, List[Dict])
_WIKIDATA_IMAGE_CACHE: "OrderedDict[str, Any]" = OrderedDict()  # qid_upper -> (expires_at, Optional[Dict] | "")
_COMMONS_FALLBACK_CACHE: "OrderedDict[tuple, Any]" = OrderedDict()  # (query_lower, limit) -> (expires_at, List[Dict])
_PAGE_IMAGES_RAW_CACHE: "OrderedDict[tuple, Any]" = OrderedDict()   # (lang, clean_title_lower) -> (expires_at, Dict)
_FILE_IMAGEINFO_CACHE: "OrderedDict[tuple, Any]" = OrderedDict()    # (lang, stripped_file_lower) -> (expires_at, Dict)
_GEOCODE_CACHE: "OrderedDict[tuple, Any]" = OrderedDict()       # (query_lower, limit, lang) -> (expires_at, List[Dict])
_REVERSE_GEOCODE_CACHE: "OrderedDict[tuple, Any]" = OrderedDict()  # (lat_2dp, lng_2dp, lang) -> (expires_at, Optional[Dict])
_REVERSE_GEOCODE_CACHE_TTL = 7 * 24 * 3600   # Place names around a ~1 km cell barely ever change
_REVERSE_GEOCODE_CACHE_MAX_ENTRIES = 5000
_NOMINATIM_MIN_INTERVAL_SEC = 1.0
# Process-wide total, kept for logs/metrics only. Repair decisions use the per-call scopes below (P-13).
_TRANSIENT_ENRICHMENT_ERRORS: int = 0


class _EnrichmentErrorScope:
    """Counts transient Wikimedia errors seen by one enrichment call (or one event within it).
    An event's scope forwards to its timeline's scope, so both levels see the error."""

    __slots__ = ("count", "parent")

    def __init__(self, parent: Optional["_EnrichmentErrorScope"] = None):
        self.count = 0
        self.parent = parent

    def note(self) -> None:
        self.count += 1
        if self.parent is not None:
            self.parent.note()


# Set by enrich_events_with_wikipedia (and per event inside it). Contexts are copied into child
# tasks, so another user's 429 never lands in this user's scope (P-13).
_ENRICHMENT_ERROR_SCOPE: ContextVar[Optional[_EnrichmentErrorScope]] = ContextVar(
    "chronix_enrichment_error_scope", default=None
)


def _note_transient_enrichment_error() -> None:
    """Records a transient Wikimedia error (429/5xx/timeout/API error) on the current call's scope."""
    global _TRANSIENT_ENRICHMENT_ERRORS
    _TRANSIENT_ENRICHMENT_ERRORS += 1
    scope = _ENRICHMENT_ERROR_SCOPE.get()
    if scope is not None:
        scope.note()


# --- Wikimedia priority lanes (SC-04) -------------------------------------------------------------
# One throttle serves every caller, so a user typing in the editor (wiki-search / enrich-item) must
# not queue behind dozens of background enrichment requests. Lower number = served first.
WIKIMEDIA_LANE_INTERACTIVE = 0
WIKIMEDIA_LANE_GENERATION = 1
WIKIMEDIA_LANE_BACKGROUND = 2  # repair passes and other best-effort work
_WIKIMEDIA_LANE: ContextVar[int] = ContextVar("chronix_wikimedia_lane", default=WIKIMEDIA_LANE_GENERATION)


@contextlib.contextmanager
def wikimedia_lane(lane: int):
    """Marks Wikimedia requests made inside the block (and tasks started from it) with `lane`."""
    token = _WIKIMEDIA_LANE.set(int(lane))
    try:
        yield
    finally:
        _WIKIMEDIA_LANE.reset(token)


def _wikimedia_lane_aging_sec() -> float:
    """A waiter moves up one lane per this many seconds of waiting, so lower lanes never starve."""
    raw = os.getenv("WIKIMEDIA_LANE_AGING_SEC", "").strip()
    try:
        return max(0.1, float(raw)) if raw else 3.0
    except ValueError:
        return 3.0


class _PriorityGate:
    """A semaphore whose waiters are served by lane (with aging) instead of first-come-first-served."""

    def __init__(self, capacity: int):
        self._capacity = max(1, int(capacity))
        self._in_use = 0
        self._waiters: List[list] = []  # [lane, enqueued_at, seq, future]
        self._seq = itertools.count()

    @property
    def in_use(self) -> int:
        return self._in_use

    def _pick(self) -> Optional[list]:
        now = time.monotonic()
        aging = _wikimedia_lane_aging_sec()
        best = None
        best_key = None
        for entry in self._waiters:
            lane, enqueued_at, seq, fut = entry
            if fut.done():
                continue
            key = (lane - int((now - enqueued_at) / aging), seq)
            if best_key is None or key < best_key:
                best, best_key = entry, key
        return best

    def _wake(self) -> None:
        while self._in_use < self._capacity:
            self._waiters = [w for w in self._waiters if not w[3].done()]
            entry = self._pick()
            if entry is None:
                return
            self._waiters.remove(entry)
            self._in_use += 1
            entry[3].set_result(True)

    async def acquire(self, lane: int) -> None:
        if self._in_use < self._capacity and not any(not w[3].done() for w in self._waiters):
            self._in_use += 1
            return
        fut = asyncio.get_running_loop().create_future()
        entry = [int(lane), time.monotonic(), next(self._seq), fut]
        self._waiters.append(entry)
        try:
            await fut
        except asyncio.CancelledError:
            if fut.done() and not fut.cancelled():
                self.release()  # granted at the same moment we were cancelled: hand the slot on
            elif entry in self._waiters:
                self._waiters.remove(entry)
            raise

    def release(self) -> None:
        self._in_use = max(0, self._in_use - 1)
        self._wake()

    @contextlib.asynccontextmanager
    async def slot(self, lane: Optional[int] = None):
        await self.acquire(_WIKIMEDIA_LANE.get() if lane is None else lane)
        try:
            yield
        finally:
            self.release()

_WIKI_LANG_RE = re.compile(r"^(?:simple|[a-z]{2,3}(?:-[a-z]{1,12}){0,2})$")


def normalize_wiki_lang(lang: Optional[str], default: str = "en", *, strict: bool = False) -> str:
    """Validate and normalize a Wikipedia language edition subdomain against SSRF/injection."""
    cleaned = (lang or "").strip().lower()
    if not cleaned:
        return default
    if _WIKI_LANG_RE.match(cleaned):
        return cleaned
    if strict:
        raise ValueError(f"Invalid Wikipedia language code: {lang!r}")
    return default


_ORIG_ASYNC_CLIENT = httpx.AsyncClient
_SHARED_HTTP_CLIENT: Optional[httpx.AsyncClient] = None
_SHARED_HTTP_CLIENT_LOOP = None

# --- Wikimedia politeness -----------------------------------------------------------------------
# Enriching one timeline fans out to dozens of Wikipedia/Commons/Wikidata API calls, and multiple
# users (or tabs) generating timelines concurrently multiply that traffic from the same server IP.
# Fired unpaced, bursts trip Wikimedia's bot limiter ("HTTP 429 Your bot is making too many
# requests"). Every request made through the shared client therefore goes through
# _WikimediaPoliteTransport, which:
#   * caps concurrent in-flight Wikimedia requests (WIKIMEDIA_MAX_CONCURRENCY, default 8),
#   * paces sustained request rate via a token bucket (WIKIMEDIA_MAX_RPS, default 25 req/s) so
#     multi-user bursts stay under Wikimedia's threshold and post-429 wakeups never stampede,
#   * on 429 pauses Wikimedia traffic for Retry-After (waiting patiently up to 90s rather than
#     failing fast on normal backoffs) and retries GETs up to 4 attempts (also covering 502/503/504
#     and transient socket timeouts),
#   * coalesces identical concurrent GETs (events/timelines sharing an article) into one request.
_WIKIMEDIA_HOST_SUFFIXES = (".wikipedia.org", ".wikimedia.org", ".wikidata.org")
_WIKIMEDIA_DEFAULT_BACKOFF_SEC = 3.0
_WIKIMEDIA_MAX_BACKOFF_SEC = 30.0
_WIKIMEDIA_MAX_QUEUE_WAIT_SEC = 90.0  # ride out multi-timeline 429 pauses; fail fast only on multi-minute bans
_WIKIMEDIA_DEFAULT_MAX_CONCURRENCY = 8
_WIKIMEDIA_AUTH_DEFAULT_MAX_CONCURRENCY = 12
_WIKIMEDIA_DEFAULT_MAX_RPS = 25.0
_WIKIMEDIA_AUTH_DEFAULT_MAX_RPS = 45.0
_WIKIMEDIA_GET_MAX_ATTEMPTS = 4
_WIKIMEDIA_RETRYABLE_STATUS_CODES = frozenset({502, 503, 504})


def _is_wikimedia_host(host: str) -> bool:
    host = (host or "").lower()
    return any(host == suffix[1:] or host.endswith(suffix) for suffix in _WIKIMEDIA_HOST_SUFFIXES)


def _wikimedia_access_token() -> str:
    """Return configured Wikimedia OAuth 2.0 / Personal API token (empty string if unset or placeholder)."""
    raw = (os.getenv("WIKIMEDIA_ACCESS_TOKEN") or "").strip().strip('"').strip("'")
    if raw.lower().startswith("bearer "):
        raw = raw[7:].strip()
    if not raw or raw.lower().startswith("your_"):
        return ""
    return raw


def _wikimedia_max_concurrency() -> int:
    fallback = (
        _WIKIMEDIA_AUTH_DEFAULT_MAX_CONCURRENCY
        if _wikimedia_access_token()
        else _WIKIMEDIA_DEFAULT_MAX_CONCURRENCY
    )
    raw = os.getenv("WIKIMEDIA_MAX_CONCURRENCY", "").strip()
    if not raw:
        return fallback
    try:
        return max(1, min(30, int(raw)))
    except ValueError:
        return fallback


def _wikimedia_max_rps() -> float:
    fallback = (
        _WIKIMEDIA_AUTH_DEFAULT_MAX_RPS
        if _wikimedia_access_token()
        else _WIKIMEDIA_DEFAULT_MAX_RPS
    )
    raw = os.getenv("WIKIMEDIA_MAX_RPS", "").strip()
    if not raw:
        return fallback
    try:
        val = float(raw)
        return 0.0 if val <= 0 else min(200.0, val)
    except ValueError:
        return fallback


def _wikimedia_max_queue_wait_sec() -> float:
    raw = os.getenv("WIKIMEDIA_MAX_QUEUE_WAIT_SEC", "").strip()
    if raw:
        try:
            return max(1.0, float(raw))
        except ValueError:
            pass
    return _WIKIMEDIA_MAX_QUEUE_WAIT_SEC


def _retry_after_seconds(response: httpx.Response) -> float:
    try:
        value = float(response.headers.get("Retry-After", ""))
    except ValueError:
        value = _WIKIMEDIA_DEFAULT_BACKOFF_SEC
    return max(1.0, min(_WIKIMEDIA_MAX_BACKOFF_SEC, value))


def _parse_mediawiki_json(resp: Any) -> Optional[Dict[str, Any]]:
    """Return parsed JSON dict only on HTTP 200 without a MediaWiki API-level `error` object."""
    status = getattr(resp, "status_code", None)
    if status != 200:
        if status is not None and status != 404:
            _note_transient_enrichment_error()
        return None
    try:
        data = resp.json()
    except Exception:
        _note_transient_enrichment_error()
        return None
    if not isinstance(data, dict) or "error" in data:
        _note_transient_enrichment_error()
        return None
    return data


class _WikimediaPoliteTransport(httpx.AsyncBaseTransport):
    """Throttles (concurrency + RPS), backs off and de-duplicates Wikimedia API traffic; blocks non-Wikimedia/non-HTTPS targets."""

    def __init__(
        self,
        inner: httpx.AsyncBaseTransport,
        max_concurrency: Optional[int] = None,
        max_rps: Optional[float] = None,
        max_attempts: Optional[int] = None,
    ):
        self._inner = inner
        eff_concurrency = max_concurrency or _wikimedia_max_concurrency()
        self._max_concurrency = eff_concurrency
        self._gate = _PriorityGate(eff_concurrency)
        self._max_rps = _wikimedia_max_rps() if max_rps is None else max(0.0, float(max_rps))
        self._max_attempts = max(1, int(max_attempts if max_attempts is not None else _WIKIMEDIA_GET_MAX_ATTEMPTS))
        self._cooldown_until = 0.0
        self._auth_disabled_until = 0.0
        self._tokens = float(eff_concurrency)
        self._last_refill = time.monotonic()
        self._inflight: Dict[str, "asyncio.Future"] = {}
        self.rate_limit_count = 0
        self.transient_error_count = 0

    def _reserve_pace_delay(self, now: float) -> float:
        """Atomically reserve the next token-bucket slot; returns seconds to sleep (0.0 for immediate burst)."""
        if self._max_rps <= 0:
            return 0.0
        if now >= self._last_refill:
            elapsed = now - self._last_refill
            self._tokens = min(float(self._max_concurrency), self._tokens + elapsed * self._max_rps)
            self._last_refill = now
            if self._tokens >= 1.0:
                self._tokens -= 1.0
                return 0.0
            deficit = (1.0 - self._tokens) / self._max_rps
            self._tokens = 0.0
            self._last_refill = now + deficit
            return deficit
        slot_gap = 1.0 / self._max_rps
        self._last_refill += slot_gap
        return self._last_refill - now

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if request.url.scheme != "https" or not _is_wikimedia_host(request.url.host):
            raise httpx.UnsupportedProtocol(
                f"Blocked outbound request to non-Wikimedia target: {request.url.scheme}://{request.url.host}"
            )
        if request.method != "GET":
            return await self._send(request)

        key = str(request.url)
        pending = self._inflight.get(key)
        if pending is not None:
            try:
                status, headers, body = await asyncio.shield(pending)
            except Exception:
                # The shared request failed for every caller: count it in this caller's scope too.
                _note_transient_enrichment_error()
                raise
            return httpx.Response(status, headers=headers, stream=httpx.ByteStream(body))

        future = asyncio.get_running_loop().create_future()
        # Mark exceptions as retrieved so a failure nobody else awaited doesn't log "never retrieved".
        future.add_done_callback(lambda f: f.cancelled() or f.exception())
        self._inflight[key] = future
        try:
            response = await self._send(request)
            try:
                # Raw (still content-encoded) bytes; the client decodes each returned response as usual.
                body = b"".join([chunk async for chunk in response.stream])
            finally:
                await response.aclose()
            result = (response.status_code, response.headers.multi_items(), body)
            future.set_result(result)
        except BaseException as exc:
            if not future.done():
                future.set_exception(exc if isinstance(exc, Exception) else RuntimeError("Wikimedia request cancelled"))
            raise
        finally:
            self._inflight.pop(key, None)
        return httpx.Response(result[0], headers=result[1], stream=httpx.ByteStream(result[2]))

    async def _send(self, request: httpx.Request) -> httpx.Response:
        attempts = self._max_attempts if request.method == "GET" else 1
        response: Optional[httpx.Response] = None
        max_queue_wait = _wikimedia_max_queue_wait_sec()

        token = _wikimedia_access_token()
        injected_auth = False
        if token and time.monotonic() >= self._auth_disabled_until and "authorization" not in request.headers:
            request.headers["Authorization"] = f"Bearer {token}"
            injected_auth = True

        lane = _WIKIMEDIA_LANE.get()
        for attempt in range(attempts):
            try:
                async with self._gate.slot(lane):
                    while True:
                        now = time.monotonic()
                        remaining = self._cooldown_until - now
                        if remaining > max_queue_wait:
                            self.transient_error_count += 1
                            _note_transient_enrichment_error()
                            return httpx.Response(429, headers={"Retry-After": str(int(remaining) + 1)})
                        if remaining > 0:
                            await asyncio.sleep(remaining)
                            continue

                        pace_wait = self._reserve_pace_delay(time.monotonic())
                        if pace_wait > 0:
                            if pace_wait > max_queue_wait:
                                self.transient_error_count += 1
                                _note_transient_enrichment_error()
                                return httpx.Response(429, headers={"Retry-After": str(int(pace_wait) + 1)})
                            await asyncio.sleep(pace_wait)
                            if self._cooldown_until > time.monotonic():
                                continue
                        break

                    response = await self._inner.handle_async_request(request)
            except (httpx.TimeoutException, httpx.NetworkError):
                self.transient_error_count += 1
                _note_transient_enrichment_error()
                if attempt + 1 < attempts:
                    await asyncio.sleep(0.35 * (attempt + 1))
                    continue
                raise

            # If a configured OAuth2/Personal API token expired or was revoked, seamlessly fall back to anonymous mode
            if response.status_code == 401 and injected_auth:
                self._auth_disabled_until = time.monotonic() + 600.0
                request.headers.pop("Authorization", None)
                injected_auth = False
                logger.warning(
                    f"Wikimedia rejected WIKIMEDIA_ACCESS_TOKEN (HTTP 401) on {request.url.host}; "
                    "falling back to anonymous requests for 10m"
                )
                await response.aclose()
                async with self._gate.slot(lane):
                    response = await self._inner.handle_async_request(request)

            if response.status_code == 429:
                self.rate_limit_count += 1
                self.transient_error_count += 1
                _note_transient_enrichment_error()
                delay = _retry_after_seconds(response)
                if "Retry-After" not in response.headers and delay >= 1.0 and attempt > 0:
                    delay = min(_WIKIMEDIA_MAX_BACKOFF_SEC, delay * (1.5 ** attempt))
                cooldown_target = max(self._cooldown_until, time.monotonic() + delay)
                self._cooldown_until = cooldown_target
                # Reset burst tokens to 1 at cooldown expiry so post-pause requests trickle smoothly instead of stampeding
                self._tokens = 1.0
                self._last_refill = max(self._last_refill, cooldown_target)
                logger.warning(
                    f"Wikimedia rate limit (HTTP 429) on {request.url.host} (attempt {attempt + 1}/{attempts}); "
                    f"pausing Wikimedia requests for {delay:.1f}s"
                )
                if attempt + 1 < attempts:
                    await response.aclose()
                    continue
                return response

            if response.status_code in _WIKIMEDIA_RETRYABLE_STATUS_CODES:
                self.transient_error_count += 1
                _note_transient_enrichment_error()
                if attempt + 1 < attempts:
                    await response.aclose()
                    await asyncio.sleep(0.35 * (attempt + 1))
                    continue
                return response

            return response
        return response

    async def aclose(self) -> None:
        await self._inner.aclose()


def _is_real_http_client(client: Any) -> bool:
    """True when `client` is a genuine httpx.AsyncClient (false for unit-test FakeClient doubles)."""
    return isinstance(client, _ORIG_ASYNC_CLIENT) and httpx.AsyncClient is _ORIG_ASYNC_CLIENT


def _get_shared_http_client() -> httpx.AsyncClient:
    """Return a loop-bound persistent httpx.AsyncClient with keep-alive connection pooling."""
    global _SHARED_HTTP_CLIENT, _SHARED_HTTP_CLIENT_LOOP
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if (
        _SHARED_HTTP_CLIENT is None
        or _SHARED_HTTP_CLIENT.is_closed
        or _SHARED_HTTP_CLIENT_LOOP is not loop
    ):
        _SHARED_HTTP_CLIENT = _ORIG_ASYNC_CLIENT(
            follow_redirects=True,
            transport=_WikimediaPoliteTransport(
                httpx.AsyncHTTPTransport(
                    limits=httpx.Limits(max_connections=60, max_keepalive_connections=30),
                )
            ),
        )
        _SHARED_HTTP_CLIENT_LOOP = loop
    return _SHARED_HTTP_CLIENT


@contextlib.asynccontextmanager
async def _http_client_scope(lane: Optional[int] = None):
    """Yield the shared keep-alive httpx.AsyncClient in production, or a scoped client if monkeypatched.
    `lane` (WIKIMEDIA_LANE_*) sets the priority of the requests made inside the block."""
    with (wikimedia_lane(lane) if lane is not None else contextlib.nullcontext()):
        if httpx.AsyncClient is _ORIG_ASYNC_CLIENT:
            yield _get_shared_http_client()
        else:
            async with httpx.AsyncClient(follow_redirects=True) as client:
                yield client


# Public alias: other modules should fetch from Wikimedia through this so the throttling applies.
wikimedia_http_client = _http_client_scope


# Expired entries are swept from a full cache at most this often; between sweeps a full cache just
# drops its least recently used entry, in O(1) (P-11: inserts used to scan and copy every entry).
_CACHE_SWEEP_INTERVAL_SEC = 60.0
_CACHE_LAST_SWEEP: Dict[int, float] = {}


def _cache_touch(store: dict, key) -> None:
    if isinstance(store, OrderedDict):
        store.move_to_end(key)
    else:
        store[key] = store.pop(key)


def _cache_evict_oldest(store: dict) -> None:
    if isinstance(store, OrderedDict):
        store.popitem(last=False)
    else:
        store.pop(next(iter(store)), None)


def _cache_sweep_expired(store: dict, now: float) -> None:
    last = _CACHE_LAST_SWEEP.get(id(store), 0.0)
    if now - last < _CACHE_SWEEP_INTERVAL_SEC:
        return
    _CACHE_LAST_SWEEP[id(store)] = now
    for k in [k for k, (exp, _) in store.items() if exp < now]:
        store.pop(k, None)


def _cache_get(store: dict, key):
    entry = store.get(key)
    if not entry:
        return None
    expires_at, value = entry
    if expires_at < time.monotonic():
        store.pop(key, None)
        return None
    # Refresh recency for LRU eviction
    _cache_touch(store, key)
    return value


def _cache_put(store: dict, key, value, ttl: int = _WIKI_CACHE_TTL, max_entries: int = _WIKI_CACHE_MAX_ENTRIES):
    now = time.monotonic()
    store.pop(key, None)
    if len(store) >= max_entries:
        _cache_sweep_expired(store, now)
        while store and len(store) >= max_entries:
            _cache_evict_oldest(store)
    store[key] = (now + ttl, value)

def generate_title_variations(raw_title: str, lang: str = "en") -> List[str]:
    """
    Generate clean candidate titles by stripping subtitles and parentheticals.
    Universal across languages without hardcoded dictionaries or heuristic rules.
    """
    if not raw_title:
        return []

    clean = raw_title.strip()
    variations = [clean]

    # 1. Subtitle separators (e.g. "Title: Subtitle" or "Title - Subtitle")
    for sep in [":", " - ", " – ", " — "]:
        if sep in clean:
            prefix = clean.split(sep, 1)[0].strip()
            if prefix and prefix not in variations:
                variations.append(prefix)

    # 2. Parenthetical qualifier stripping (e.g. "Title (qualifier)" -> "Title")
    no_parens = re.sub(r'\s*\([^)]*\)', '', clean).strip()
    if no_parens and no_parens not in variations:
        variations.append(no_parens)

    return variations


def is_title_relevant(candidate_title: str, query_title: str) -> bool:
    """
    Generic relevance validation between a candidate Wikipedia title and the requested title.
    Accepts:
    1. Exact matches (case-insensitive)
    2. Parenthetical disambiguation qualifiers (e.g. 'Sparta' -> 'Sparta (mythology)')
    3. Subtitle prefix matches (e.g. 'Battle of Midway: Pacific Theatre' -> 'Battle of Midway')
    4. Multi-word entity containment (e.g. 'Mount Everest' inside 'First ascent of Mount Everest')
    Rejects completely different subjects/names without hardcoded word lists.
    """
    c = candidate_title.strip().lower()
    q = query_title.strip().lower()

    if not c or not q:
        return False

    if c == q:
        return True

    # Disambiguation parenthetical: "Title (qualifier)" matching "Title"
    if c.startswith(f"{q} (") or q.startswith(f"{c} ("):
        return True

    # Base without parentheticals
    c_base = re.sub(r'\s*\([^)]*\)', '', c).strip()
    q_base = re.sub(r'\s*\([^)]*\)', '', q).strip()
    if c_base == q_base:
        return True

    # Hyphen/whitespace-insensitive compound match (e.g. 'Hakuba-kai' vs 'Hakubakai', 'Ukiyo-e' vs 'Ukiyoe')
    c_dehyph = re.sub(r'[\s\-–—]+', '', c_base)
    q_dehyph = re.sub(r'[\s\-–—]+', '', q_base)
    if len(c_dehyph) >= 4 and c_dehyph == q_dehyph:
        return True

    # Subtitle prefix: "Title: Subtitle" -> "Title"
    for sep in [":", " - ", " – ", " — "]:
        if q_base.startswith(f"{c_base}{sep}") or c_base.startswith(f"{q_base}{sep}"):
            return True

    # Entity containment inside descriptive query:
    # 1. Multi-word entity contained inside query, or multi-word query contained inside candidate
    #    (e.g. "Mount Everest" inside "First ascent of Mount Everest")
    if (len(c_base.split()) >= 2 and c_base in q_base) or (len(q_base.split()) >= 2 and q_base in c_base):
        return True

    # 1b. Morphological multi-word token subset (e.g. "National Industrial Exhibitions" inside
    #     "First National Industrial Exhibition")
    c_tokens = _content_tokens(c_base)
    q_tokens = _content_tokens(q_base)
    if len(c_tokens) >= 2 and len(q_tokens) >= 2:
        matched_c = sum(1 for ct in c_tokens if any(are_tokens_related(ct, qt) for qt in q_tokens))
        matched_q = sum(1 for qt in q_tokens if any(are_tokens_related(qt, ct) for ct in c_tokens))
        if matched_c == len(c_tokens) or matched_q == len(q_tokens):
            return True

    # 2. Single-word entity (length >= 3) contained as a distinct token or with a single-character prefix
    #    (e.g. "Cambrian" inside "The Cambrian Period", or prefixed grammatical forms)
    if len(c_base.split()) == 1 and len(c_base) >= 3:
        tokens = set(re.findall(r'[\w]+', q_base))
        if c_base in tokens:
            return True
        for t in tokens:
            if len(t) == len(c_base) + 1 and t.endswith(c_base):
                return True

    return False


def is_likely_searchable_entity(text: str) -> bool:
    """
    Determine if a title string represents a plausible named entity or article title
    rather than a full sentence, action phrase, or narrative clause.
    Universal across languages: relies on token count and sentence punctuation.
    """
    if not text:
        return False
    clean = text.strip()
    if any(p in clean for p in [".", "!", "?", ";"]):
        return False
    words = clean.split()
    if len(words) > 6:
        return False
    return True


_STOPWORDS = frozenset({
    "the", "and", "for", "was", "were", "with", "from", "that", "this", "into",
    "over", "after", "before", "under", "between", "through", "during", "about",
    "against", "among", "within", "without", "but", "not", "are", "has", "had",
    "have", "its", "his", "her", "their", "our", "your", "who", "whom", "whose",
    "which", "what", "where", "when", "why", "how", "all", "any", "both", "each",
    "some", "such", "than", "too", "very", "can", "will", "just", "should", "also",
    # Common European grammatical function words
    "les", "des", "une", "dans", "pour", "par", "sur", "avec", "plus", "sont",
    "los", "las", "una", "del", "por", "con", "para", "como", "fue", "son",
    "der", "die", "das", "und", "von", "mit", "auf", "für", "ist", "war", "den", "dem", "ein", "eine",
    # Common Hebrew grammatical function words
    "את", "של", "על", "עם", "או", "גם", "רק", "כי", "אם", "לא", "כן", "זה", "זו", "אלה", "אלו",
    "הוא", "היא", "הם", "הן", "היה", "היתה", "הייתה", "היו", "כמו", "אחר", "אחרי", "לפני", "בין",
})


def are_tokens_related(t1: str, t2: str) -> bool:
    """
    Check if two tokens share a common stem or morphological relationship.
    Language-agnostic: handles prefix attachments (prepositions/articles),
    suffix attachments (plurals/inflections), and stem consonant/vowel shifts.
    """
    if t1 == t2:
        return True
    len1, len2 = len(t1), len(t2)
    if len1 < 3 or len2 < 3:
        return False
    # Numeric tokens (years, model numbers) must match exactly — '1908' is not an inflection of '1907'
    if any(ch.isdigit() for ch in t1) or any(ch.isdigit() for ch in t2):
        return False

    short_len = min(len1, len2)
    # 1. Prefix attachment (e.g. prepositions/articles un-/re-, Hebrew/Arabic 1-letter prefixes):
    # Require base token >= 4 chars (or non-ASCII script with 1-char prefix) so 3-letter English
    # words like "art"/"era"/"war" do not falsely match "part"/"start"/"opera"/"award".
    if short_len >= 4 or (abs(len1 - len2) == 1 and not (t1.isascii() and t2.isascii())):
        if len1 > len2 and (len1 - len2) <= 2 and t1.endswith(t2):
            return True
        if len2 > len1 and (len2 - len1) <= 2 and t2.endswith(t1):
            return True

    # 2. Suffix attachment (e.g. plurals -s, -es, gender/case inflections):
    if short_len >= 4 or (abs(len1 - len2) == 1 and (t1.endswith("s") or t2.endswith("s"))):
        if len1 > len2 and (len1 - len2) <= 3 and t1.startswith(t2):
            return True
        if len2 > len1 and (len2 - len1) <= 3 and t2.startswith(t1):
            return True

    # 3. Common root/stem for words (length >= 4): share common prefix of at least len - 1 (or >= 4 chars)
    # Handles morphological inflections where final consonant or vowel changes (e.g. y->i, city->cities)
    if short_len >= 4:
        common_len = 0
        for c1, c2 in zip(t1, t2):
            if c1 == c2:
                common_len += 1
            else:
                break
        if common_len >= 3 and common_len >= short_len - 1:
            return True

    return False


def _fold_latin_diacritics(text: str) -> str:
    """Fold Latin combining accents ('zürich' -> 'zurich', 'gödel' -> 'godel') while preserving non-Latin scripts."""
    return re.sub(r'[\u0300-\u036f]', '', unicodedata.normalize('NFKD', text or ''))


def generic_token_overlap(text1: str, text2: str) -> int:
    """
    Count overlapping or root-related content words of 3+ characters between two texts, language-agnostic.
    Filters universal function stopwords so common words ('the', 'and', 'was') do not inflate scores.
    """
    if not text1 or not text2:
        return 0
    s1 = _fold_latin_diacritics(text1.lower())
    s2 = _fold_latin_diacritics(text2.lower())
    t1 = {w for w in re.findall(r'\w{3,}', s1) if w not in _STOPWORDS}
    t2 = {w for w in re.findall(r'\w{3,}', s2) if w not in _STOPWORDS}
    if not t1 or not t2:
        return 0

    exact = t1.intersection(t2)
    matched_t1 = set(exact)
    matched_t2 = set(exact)

    rem1 = t1 - matched_t1
    rem2 = t2 - matched_t2
    for w1 in rem1:
        for w2 in rem2:
            if w2 not in matched_t2 and are_tokens_related(w1, w2):
                matched_t1.add(w1)
                matched_t2.add(w2)
                break

    return len(matched_t1)


def extract_temporal_span(text: str) -> Optional[tuple]:
    """
    Extract birth/death years or active era from Wikipedia summary/description.
    Language-agnostic extraction of parenthetical year ranges and birth years.
    Returns (start_year, end_year) or None.
    """
    if not text:
        return None
    snippet = text[:350]

    # Universal BC / BCE markers
    is_bc = bool(re.search(r'\b(BC|BCE|B\.C\.|B\.C\.E\.|av\. J\.-C\.|v\. Chr\.)\b', snippet, re.IGNORECASE))

    # 1. Inspect parenthetical content for dates: e.g. (1809–1865), (15 August 1769 – 5 May 1821), (born 1948)
    for content in re.findall(r'\(([^)]+)\)', snippet):
        sep_match = re.search(r'[–—\-]|(\s+(?:to|until)\s+)', content)
        if sep_match:
            parts = re.split(r'[–—\-]|(?:\s+(?:to|until)\s+)', content, maxsplit=1)
            left_part, right_part = parts[0], parts[1]

            left_years = re.findall(r'\b(\d{3,4})\b', left_part)
            right_years = re.findall(r'\b(\d{3,4})\b', right_part)

            if is_bc:
                left_bc = re.findall(r'\b(\d{1,4})\b', left_part)
                right_bc = re.findall(r'\b(\d{1,4})\b', right_part)
                if left_bc and right_bc:
                    y1 = int(left_bc[-1])
                    y2 = int(right_bc[-1])
                    return (-max(y1, y2), -min(y1, y2))

            if left_years and right_years:
                y1 = int(left_years[-1])
                y2 = int(right_years[-1])
                if is_bc:
                    return (-max(y1, y2), -min(y1, y2))
                return (min(y1, y2), max(y1, y2))
            elif left_years and any(w in right_part.lower() for w in ['present', 'actuel']):
                return (int(left_years[-1]), None)

        all_years = re.findall(r'\b(\d{3,4})\b', content)
        if all_years:
            if any(w in content.lower() for w in ['born', 'b.', 'né', 'geboren', 'present']):
                return (int(all_years[-1]), None)

    # 2. Free-standing year range: e.g. 1809–1865
    loose = re.search(r'\b(\d{3,4})\s*[–\-—]\s*(\d{3,4})\b', snippet)
    if loose:
        y1, y2 = int(loose.group(1)), int(loose.group(2))
        if 10 <= abs(y2 - y1) <= 125:
            if is_bc:
                return (-max(y1, y2), -min(y1, y2))
            return (min(y1, y2), max(y1, y2))

    return None


def is_temporally_compatible(event_year: int, span: tuple) -> bool:
    """
    Check if an event year is temporally compatible with a candidate entity's lifetime or active era.
    Allows a reasonable buffer for early career / posthumous immediate references.
    """
    start_year, end_year = span
    if end_year is not None:
        return (start_year - 20) <= event_year <= (end_year + 25)
    else:
        return (start_year - 5) <= event_year <= (start_year + 110)


# Calendar-year / decade pages ('1792', '1990s', '79 BC', 'AD 79') are never an event's subject.
_YEAR_TITLE_RE = re.compile(r'^(?:\d{1,4}s?|\d{1,4}\s+[^\d\s]{1,6}|[^\d\s]{1,3}\s+\d{1,4})$')


def _content_tokens(text: str) -> set:
    return {w for w in re.findall(r'\w{3,}', (text or "").lower()) if w not in _STOPWORDS}


def _paren_qualifiers(title: str) -> List[str]:
    return [q.strip() for q in re.findall(r'\(([^)]*)\)', title or "") if q.strip()]


def is_year_article_title(title: str) -> bool:
    return bool(_YEAR_TITLE_RE.match((title or "").strip()))


def title_year_conflicts(title: str, year: Optional[int]) -> bool:
    """
    True when a year inside the title's parenthetical qualifier is far from the event year,
    e.g. 'Siege of Jerusalem (1099)' for a 63 BCE event. Only qualifier years count: numbers in
    the title body are usually part of the name ('STS-114', 'Intel 4004'). Magnitudes are
    compared so BCE markers in any language don't need parsing.
    """
    if year is None or not isinstance(year, int):
        return False
    years = [int(y) for q in _paren_qualifiers(title) for y in re.findall(r'(?<!\d)\d{3,4}(?!\d)', q)]
    if not years:
        return False
    target = abs(year)
    tol = 20 if target < 3000 else target * 0.05
    if len(years) >= 2 and min(years) - tol <= target <= max(years) + tol:
        return False
    return all(abs(y - target) > tol for y in years)


def qualifier_supported(qualifier: str, cand: Dict[str, Any]) -> bool:
    """
    A requested disambiguation qualifier (e.g. 'continent', 'king of Israel') must be reflected in
    the candidate's title/description/extract; otherwise the candidate is a different sense.
    """
    q_tokens = _content_tokens(qualifier)
    if not q_tokens:
        return True
    cand_text = f"{cand.get('wikiTitle') or ''} {cand.get('description') or ''} {cand.get('extract') or ''}"
    need = len(q_tokens) if len(q_tokens) <= 2 else len(q_tokens) - 1
    return generic_token_overlap(qualifier, cand_text) >= need


def _dropped_parts(original: str, variation: str) -> tuple:
    """Return (dropped parenthetical qualifier text, dropped subtitle text) for a title variation."""
    var_quals = _paren_qualifiers(variation)
    dropped_quals = [q for q in _paren_qualifiers(original) if q not in var_quals]
    orig_np = re.sub(r'\s*\([^)]*\)', '', original or "").strip()
    var_np = re.sub(r'\s*\([^)]*\)', '', variation or "").strip()
    subtitle = ""
    if var_np and orig_np != var_np and orig_np.startswith(var_np):
        subtitle = orig_np[len(var_np):].strip(" :-–—")
    return " ".join(dropped_quals), subtitle


def score_candidate(
    cand: Dict[str, Any],
    query: str,
    context_text: str = "",
    year: Optional[int] = None
) -> int:
    """
    Compute a composite confidence score for a candidate Wikipedia article.
    Penalizes disambiguation/meta pages and temporal conflicts. Rewards exact matches,
    temporal compatibility, and contextual alignment.
    """
    score = 0
    cand_title = cand.get("wikiTitle") or ""
    cand_desc = cand.get("description") or ""
    cand_extract = cand.get("extract") or ""
    cand_type = cand.get("type") or ""

    q = query.strip().lower()
    c = cand_title.strip().lower()

    if not q or not c:
        return -500

    # 1. Disambiguation or Meta Page Penalty
    if cand_type == "disambiguation":
        return -500
    meta_indicators = ["disambiguation", "surname", "given name", "name list", "family name", "homonymie", "begriffsklärung"]
    if any(m in cand_desc.lower() for m in meta_indicators):
        return -500

    # 2. Title matching
    c_base = re.sub(r'\s*\([^)]*\)', '', c).strip()
    q_base = re.sub(r'\s*\([^)]*\)', '', q).strip()
    c_dehyph = re.sub(r'[\s\-–—]+', '', c_base)
    q_dehyph = re.sub(r'[\s\-–—]+', '', q_base)
    c_tokens_list = _content_tokens(c_base)
    q_tokens_list = _content_tokens(q_base)
    q_token_count = len(q_tokens_list)
    matched_c_tokens = (
        sum(1 for ct in c_tokens_list if any(are_tokens_related(ct, qt) for qt in q_tokens_list))
        if c_tokens_list and q_tokens_list else 0
    )
    matched_q_tokens = (
        sum(1 for qt in q_tokens_list if any(are_tokens_related(qt, ct) for ct in c_tokens_list))
        if c_tokens_list and q_tokens_list else 0
    )

    if c == q:
        score += 100
    elif c_base == q_base:
        score += 80
    elif len(c_dehyph) >= 4 and c_dehyph == q_dehyph:
        score += 85
    elif c.startswith(f"{q} (") or q.startswith(f"{c} ("):
        score += 75
    elif any(q_base.startswith(f"{c_base}{sep}") or c_base.startswith(f"{q_base}{sep}") for sep in [":", " - ", " – ", " — "]):
        score += 55
    elif len(c_base.split()) >= 2 and c_base in q_base:
        score += 30  # candidate is a sub-phrase of the query: usually the broader parent topic
    elif len(q_base.split()) >= 2 and q_base in c_base:
        score += 15  # candidate contains a multi-word query: usually a more specific work
    elif len(c_tokens_list) >= 2 and matched_c_tokens == len(c_tokens_list):
        score += 30  # morphological multi-word subset (e.g. 'National Industrial Exhibitions' in 'First National Industrial Exhibition')
    elif len(q_tokens_list) >= 2 and matched_q_tokens == len(q_tokens_list):
        score += 15
    elif len(c_base.split()) == 1 and len(c_base) >= 3 and (
        c_base in set(re.findall(r'[\w]+', q_base))
        or any(len(t) == len(c_base) + 1 and t.endswith(c_base) for t in re.findall(r'[\w]+', q_base))
    ):
        # One word of the query: strong only when it IS most of the query ('The Cambrian Period').
        score += 70 if q_token_count <= 2 else (45 if q_token_count == 3 else 20)
    else:
        score -= 50

    # A requested qualifier ('Tethys (ocean)') must not resolve to another sense ('Tethys' the goddess).
    q_quals = " ".join(_paren_qualifiers(query))
    if q_quals:
        c_quals = " ".join(_paren_qualifiers(cand_title))
        if c_quals:
            if not generic_token_overlap(q_quals, c_quals):
                score -= 150
        elif not qualifier_supported(q_quals, cand):
            score -= 150

    # Disambiguation qualifier token overlap with query and context (e.g. 'Mercury (planet)' in astronomy context)
    q_tokens_set = _content_tokens(q_base)
    non_query_ctx = " ".join(
        t for t in re.findall(r'\w{3,}', (context_text or "").lower())
        if t not in _STOPWORDS and not any(are_tokens_related(t, qt) for qt in q_tokens_set)
    )
    paren_match = re.search(r'\(([^)]+)\)', c)
    if paren_match:
        qualifier_text = paren_match.group(1).lower()
        q_overlap = generic_token_overlap(qualifier_text, q_base)
        if q_overlap:
            score += q_overlap * 25
        ctx_overlap = generic_token_overlap(qualifier_text, context_text) if context_text else 0
        if ctx_overlap:
            score += min(ctx_overlap * 20, 50)
        elif not q_quals and not q_overlap and not re.search(r'\b\d{3,4}\b', qualifier_text):
            # Candidate has a parenthetical sense disambiguator (e.g. "Gerhard Frey (politician)")
            # that was NOT requested in the query and does not overlap context.
            body_ctx_overlap = generic_token_overlap(f"{cand_desc} {cand_extract}", non_query_ctx) if non_query_ctx else 0
            if non_query_ctx and body_ctx_overlap == 0:
                score -= 35

    # 3. Temporal verification (crucial for distinguishing figures with shared names)
    if year is not None and isinstance(year, int):
        if title_year_conflicts(cand_title, year):
            score -= 200
        span = extract_temporal_span(f"{cand_desc} {cand_extract}")
        if span:
            if is_temporally_compatible(year, span):
                score += 50
            else:
                score -= 300  # Strict disqualification for candidate from the wrong era
        # Exact year match bonus
        if re.search(rf'\b{abs(year)}\b', f"{cand_desc} {cand_extract}"):
            score += 25

    # 4. Context overlap (timeline topic, subtitle, lane) excluding tokens already in the query
    if non_query_ctx:
        overlap = generic_token_overlap(f"{c} {cand_desc} {cand_extract}", non_query_ctx)
        score += min(overlap * 15, 60)

    # 5. Image bonus (quality indicator)
    if cand.get("imageUrl"):
        score += 10

    return score


MIN_CONFIDENCE_THRESHOLD = 60


def _record_article_candidate(
    sink: Optional[List[Dict[str, Any]]],
    cand: Optional[Dict[str, Any]],
) -> None:
    """Append a unique candidate article summary to `sink` for optional batch LLM adjudication."""
    if sink is None or not isinstance(cand, dict):
        return
    wt = (cand.get("wikiTitle") or "").strip()
    if not wt:
        return
    lg = (cand.get("lang") or "en").strip().lower()
    key = (lg, wt.lower())
    for existing in sink:
        if (
            (existing.get("lang") or "en").strip().lower() == key[0]
            and (existing.get("wikiTitle") or "").strip().lower() == key[1]
        ):
            return
    if len(sink) < 6:
        sink.append(dict(cand))


async def _resolve_disambiguation(
    title: str,
    client: httpx.AsyncClient,
    lang: str = "en",
    context_text: str = "",
    year: Optional[int] = None,
    candidate_sink: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Parse a disambiguation page and select the option with the highest
    relevance and temporal compatibility with the event context.
    """
    lang = normalize_wiki_lang(lang)
    try:
        url = (
            f"https://{lang}.wikipedia.org/w/api.php?action=parse&page="
            f"{urllib.parse.quote(title.strip())}&prop=links|wikitext&format=json"
        )
        resp = await client.get(url, headers=HEADERS, timeout=5.0)
        if resp.status_code != 200:
            return None

        parse_data = resp.json().get("parse", {})
        mainspace_links = {
            l.get("*", "").strip()
            for l in parse_data.get("links", [])
            if l.get("ns") == 0 and l.get("*")
        }

        wt = parse_data.get("wikitext", {}).get("*", "")
        candidates = []
        see_also_re = re.compile(
            r'^==+\s*(?:see also|ראו גם|voir aussi|siehe auch|véase también|vedi anche|ver também|см\.\s*также)\s*==+',
            re.IGNORECASE,
        )
        for line in wt.split("\n"):
            if see_also_re.match(line.strip()):
                break
            matches = re.findall(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]', line)
            if matches:
                clean_line = re.sub(r'\[\[(?:[^\]|]+\|)?([^\]]+)\]\]', r'\1', line)
                for raw_link in matches:
                    # MediaWiki prop=links strips section fragments (#Section), so strip them here too
                    link = raw_link.split("#", 1)[0].strip()
                    if not link:
                        continue
                    if link in mainspace_links or (not mainspace_links and ":" not in link):
                        candidates.append((link, clean_line))
                        break  # Only the first valid mainspace link on a disambiguation bullet is the target

        if not candidates:
            return None

        # Every option repeats the ambiguous name itself, so those tokens carry no evidence.
        name_tokens = _content_tokens(re.sub(r'\s*\([^)]*\)', '', title))
        non_name_ctx = " ".join(
            t for t in re.findall(r'\w{3,}', (context_text or "").lower())
            if t not in _STOPWORDS and not any(are_tokens_related(t, nt) for nt in name_tokens)
        )

        def discriminative_text(text: str) -> str:
            return " ".join(
                t for t in re.findall(r'\w{3,}', text.lower())
                if t not in _STOPWORDS and not any(are_tokens_related(t, nt) for nt in name_tokens)
            )

        def score_disambig_candidate(link: str, desc: str) -> int:
            topical_overlap = generic_token_overlap(discriminative_text(f"{link} {desc}"), context_text)
            sc = topical_overlap * 15

            # Check parenthetical sense qualifier on the link (e.g. "Mercury (planet)")
            link_quals = [
                q for q in _paren_qualifiers(link)
                if not re.fullmatch(r'[\d\s–\-—bcadce.]+', q.lower())
            ]
            if link_quals and context_text:
                qual_ov = generic_token_overlap(" ".join(link_quals), context_text)
                if qual_ov >= 1:
                    sc += min(qual_ov * 20, 40)
                else:
                    sc -= 15

            if year is not None and isinstance(year, int):
                if title_year_conflicts(link, year):
                    return -200
                span = extract_temporal_span(f"{link} {desc}")
                if span:
                    if is_temporally_compatible(year, span):
                        if span[1] is None or year <= span[1]:
                            if not context_text:
                                sc += 30
                            elif topical_overlap >= 1:
                                sc += 10
                    else:
                        sc -= 200
                if re.search(rf'\b{abs(year)}\b', desc):
                    sc += 30
            return sc

        best_by_link: Dict[str, int] = {}
        for link, desc in candidates:
            sc = score_disambig_candidate(link, desc)
            if sc > best_by_link.get(link, -10**9):
                best_by_link[link] = sc
        scored = sorted(((sc, link) for link, sc in best_by_link.items()), key=lambda x: x[0], reverse=True)

        top_score, top_title = scored[0]
        runner_up = scored[1][0] if len(scored) > 1 else None
        viable = [link for sc, link in scored if sc >= -15][:4]

        if top_score >= 15 and (runner_up is None or top_score > runner_up):
            top_res = await _get_summary_direct(top_title, client, lang=lang, resolve_disambig=False, year=year)
            if top_res:
                top_res["_resolution_mode"] = "disambig"
                _record_article_candidate(candidate_sink, top_res)
                if candidate_sink is not None and _is_real_http_client(client) and len(viable) > 1:
                    extra_summaries = await asyncio.gather(
                        *[_get_summary_direct(lk, client, lang=lang, resolve_disambig=False, year=year) for lk in viable[1:4]],
                        return_exceptions=True,
                    )
                    for es in extra_summaries:
                        if isinstance(es, dict) and es.get("wikiTitle"):
                            _record_article_candidate(candidate_sink, es)
                if not non_name_ctx or not _is_real_http_client(client) or len(viable) <= 1 or top_score >= 30:
                    return top_res
                top_body_ov = generic_token_overlap(
                    discriminative_text(f"{top_res.get('wikiTitle', '')} {top_res.get('description', '')} {top_res.get('extract', '')}"),
                    non_name_ctx,
                )
                if top_body_ov >= 2:
                    return top_res

        # Tie-breaker when short disambiguation bullets lack context keywords (e.g. "Gerhard Frey (mathematician)"
        # vs "Gerhard Frey (politician)" where "Fermat" / "elliptic curve" appear in the article summary, not the bullet):
        if (non_name_ctx or candidate_sink is not None) and len(viable) >= 1 and _is_real_http_client(client):
            summaries = await asyncio.gather(
                *[_get_summary_direct(lk, client, lang=lang, resolve_disambig=False, year=year) for lk in viable],
                return_exceptions=True,
            )
            best_sum = None
            best_sum_score = -10**9
            runner_up_sum_score = -10**9
            for s in summaries:
                if not isinstance(s, dict) or not s.get("wikiTitle"):
                    continue
                _record_article_candidate(candidate_sink, s)
                if not non_name_ctx:
                    continue
                body_ov = generic_token_overlap(
                    discriminative_text(f"{s.get('wikiTitle', '')} {s.get('description', '')} {s.get('extract', '')}"),
                    non_name_ctx,
                )
                if body_ov <= 0:
                    continue
                full_sc = max(
                    score_candidate(s, title, context_text=context_text, year=year),
                    score_candidate(s, s["wikiTitle"], context_text=context_text, year=year),
                )
                if full_sc > best_sum_score:
                    runner_up_sum_score = best_sum_score
                    best_sum_score = full_sc
                    best_sum = s
                elif full_sc > runner_up_sum_score:
                    runner_up_sum_score = full_sc
            if best_sum and best_sum_score >= MIN_CONFIDENCE_THRESHOLD and best_sum_score > runner_up_sum_score:
                best_sum["_resolution_mode"] = "disambig"
                return best_sum

    except Exception as e:
        logger.info(f"Failed to resolve disambiguation for '{title}': {e}")

    return None


def _compact_summary_payload(raw_json: Any, fallback_title: str) -> Any:
    if not isinstance(raw_json, dict):
        return raw_json
    desktop_page = ((raw_json.get("content_urls") or {}).get("desktop") or {}).get("page")
    return {
        "type": raw_json.get("type", "standard"),
        "title": raw_json.get("title", fallback_title),
        "description": raw_json.get("description", ""),
        "extract": raw_json.get("extract", ""),
        "thumbnail": raw_json.get("thumbnail"),
        "originalimage": raw_json.get("originalimage"),
        "coordinates": raw_json.get("coordinates"),
        "content_urls": {"desktop": {"page": desktop_page}} if desktop_page else {},
    }


async def _get_summary_direct(
    title: str,
    client: httpx.AsyncClient,
    lang: str = "en",
    resolve_disambig: bool = True,
    context_text: str = "",
    year: Optional[int] = None,
    candidate_sink: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Fetch Wikipedia summary using REST API.
    Follows canonical server-side redirects automatically.
    Resolves disambiguation pages using context and year if resolve_disambig is True.
    Verifies temporal compatibility before returning standard articles.
    """
    lang = normalize_wiki_lang(lang)
    clean = title.strip().replace(" ", "_")
    use_cache = _is_real_http_client(client)
    cache_key = (lang, clean.lower())
    data = None
    if use_cache:
        cached_raw = _cache_get(_RAW_SUMMARY_CACHE, cache_key)
        if cached_raw is not None:
            cached_status, cached_data = cached_raw
            if cached_status != 200 or not cached_data:
                return None
            data = cached_data

    if data is None:
        url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(clean, safe='')}"
        caller_attempts = 1 if isinstance(getattr(client, "_transport", None), _WikimediaPoliteTransport) else 2
        for attempt in range(caller_attempts):
            try:
                resp = await client.get(url, headers=HEADERS, timeout=8.0)
                if resp.status_code == 429 and attempt + 1 < caller_attempts:
                    _note_transient_enrichment_error()
                    await asyncio.sleep(0.5)
                    continue
                if resp.status_code == 200:
                    parsed = resp.json()
                    if isinstance(parsed, dict) and "error" not in parsed:
                        data = parsed
                        if use_cache:
                            _cache_put(_RAW_SUMMARY_CACHE, cache_key, (200, _compact_summary_payload(data, title)))
                    else:
                        _note_transient_enrichment_error()
                elif resp.status_code == 404:
                    if use_cache:
                        _cache_put(_RAW_SUMMARY_CACHE, cache_key, (404, None))
                else:
                    _note_transient_enrichment_error()
                break
            except (httpx.TimeoutException, httpx.NetworkError):
                _note_transient_enrichment_error()
                if attempt + 1 < caller_attempts:
                    await asyncio.sleep(0.3)
                    continue
                break
            except Exception:
                _note_transient_enrichment_error()
                break

    if not data:
        return None

    if data.get("type") == "disambiguation":
        if resolve_disambig and (context_text or year is not None):
            disambig_kwargs = {"candidate_sink": candidate_sink} if candidate_sink is not None else {}
            return await _resolve_disambiguation(
                title, client, lang=lang, context_text=context_text, year=year, **disambig_kwargs
            )
        return None

    desc = data.get("description", "")
    ext = data.get("extract", "")
    landed_title = data.get("title", title)

    if is_year_article_title(landed_title) or title_year_conflicts(landed_title, year):
        logger.info(f"Wikipedia summary '{landed_title}' rejected: year page or qualifier year far from {year}")
        return None

    # If year is provided, verify temporal compatibility for direct matches
    if year is not None and isinstance(year, int):
        span = extract_temporal_span(f"{desc} {ext}")
        if span and not is_temporally_compatible(year, span):
            logger.info(
                f"Direct Wikipedia summary for '{title}' rejected due to temporal incompatibility "
                f"(event year: {year}, entity span: {span})"
            )
            return None

    thumb_info = data.get("thumbnail") if isinstance(data.get("thumbnail"), dict) else {}
    orig_info = data.get("originalimage") if isinstance(data.get("originalimage"), dict) else {}
    img_url = _upgrade_wikimedia_thumb_url(
        thumb_info.get("source"),
        orig_info.get("source"),
        orig_info.get("width"),
    )

    coords = data.get("coordinates")
    lat = None
    lng = None
    if coords and isinstance(coords, dict):
        lat = coords.get("lat")
        lng = coords.get("lon")

    out = {
        "wikiTitle": data.get("title", title),
        "wikiUrl": data.get("content_urls", {}).get("desktop", {}).get("page"),
        "extract": ext,
        "description": desc,
        "imageUrl": img_url,
        "lat": lat,
        "lng": lng,
        "lang": lang,
        "type": data.get("type", "standard"),
    }
    _record_article_candidate(candidate_sink, out)
    return out


async def _search_wikipedia_titles(
    query: str,
    client: httpx.AsyncClient,
    lang: str = "en",
    limit: int = 5
) -> List[str]:
    """Search Wikipedia titles using full-text CirrusSearch with OpenSearch fallback."""
    lang = normalize_wiki_lang(lang)
    limit = max(1, min(int(limit or 5), 10))
    clean = query.strip()
    if not clean:
        return []

    use_cache = _is_real_http_client(client)
    cache_key = (lang, clean.lower(), limit)
    if use_cache:
        cached = _cache_get(_SEARCH_CACHE, cache_key)
        if cached is not None:
            return list(cached)

    cirrus_ok = False
    opensearch_ok = False

    # 1. CirrusSearch full-text search
    url = (
        f"https://{lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch="
        f"{urllib.parse.quote(clean)}&srlimit={limit}&format=json"
    )
    caller_attempts = 1 if isinstance(getattr(client, "_transport", None), _WikimediaPoliteTransport) else 2
    for attempt in range(caller_attempts):
        try:
            resp = await client.get(url, headers=HEADERS, timeout=6.0)
            if resp.status_code == 429 and attempt + 1 < caller_attempts:
                _note_transient_enrichment_error()
                await asyncio.sleep(0.5)
                continue
            body = _parse_mediawiki_json(resp)
            if body is not None and "query" in body:
                cirrus_ok = True
                hits = body.get("query", {}).get("search", [])
                titles = [h["title"] for h in hits if "title" in h]
                if titles:
                    if use_cache:
                        _cache_put(_SEARCH_CACHE, cache_key, titles)
                    return titles
            break
        except (httpx.TimeoutException, httpx.NetworkError):
            _note_transient_enrichment_error()
            if attempt + 1 < caller_attempts:
                await asyncio.sleep(0.3)
                continue
            break
        except Exception:
            _note_transient_enrichment_error()
            break

    # 2. OpenSearch prefix fallback
    try:
        url = (
            f"https://{lang}.wikipedia.org/w/api.php?action=opensearch&search="
            f"{urllib.parse.quote(clean)}&limit={limit}&namespace=0&format=json"
        )
        resp = await client.get(url, headers=HEADERS, timeout=6.0)
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list) and len(data) > 1:
                opensearch_ok = True
                if data[1]:
                    if use_cache:
                        _cache_put(_SEARCH_CACHE, cache_key, data[1])
                    return data[1]
            else:
                _note_transient_enrichment_error()
        else:
            _note_transient_enrichment_error()
    except Exception:
        _note_transient_enrichment_error()

    # Never poison the cache with [] when either search endpoint failed transiently (429 / timeout / API error)
    if use_cache and cirrus_ok and opensearch_ok:
        _cache_put(_SEARCH_CACHE, cache_key, [])
    return []


async def _get_langlink(
    title: str,
    from_lang: str,
    to_lang: str,
    client: httpx.AsyncClient
) -> Optional[str]:
    """
    Fetch canonical page title in another language edition using Wikipedia's
    native interlanguage links (langlinks / Wikidata).
    """
    from_lang = normalize_wiki_lang(from_lang, default="")
    to_lang = normalize_wiki_lang(to_lang, default="")
    if not title or not from_lang or not to_lang or from_lang == to_lang:
        return None
    clean = title.strip().replace(" ", "_")
    use_cache = _is_real_http_client(client)
    cache_key = (from_lang, to_lang, clean.lower())
    if use_cache:
        cached = _cache_get(_LANGLINK_CACHE, cache_key)
        if cached is not None:
            return cached if cached != "" else None
    try:
        url = (
            f"https://{from_lang}.wikipedia.org/w/api.php?action=query&titles="
            f"{urllib.parse.quote(clean)}&prop=langlinks&lllang={to_lang}&redirects=1&format=json"
        )
        resp = await client.get(url, headers=HEADERS, timeout=6.0)
        body = _parse_mediawiki_json(resp)
        if body is not None and "query" in body:
            pages = body.get("query", {}).get("pages", {})
            for pid, page in pages.items():
                if pid != "-1":
                    links = page.get("langlinks", [])
                    if links and "*" in links[0]:
                        res = links[0]["*"]
                        if use_cache:
                            _cache_put(_LANGLINK_CACHE, cache_key, res)
                        return res
            if use_cache:
                _cache_put(_LANGLINK_CACHE, cache_key, "")
    except Exception:
        pass
    return None


async def _probe_title(
    title: str,
    from_lang: str,
    to_lang: str,
    client: httpx.AsyncClient
) -> Optional[Dict[str, Any]]:
    """
    One call: does `title` exist on `from_lang` Wikipedia (following redirects), and what is its
    `to_lang` interlanguage link? Returns None when the probe itself failed (unknown).
    """
    from_lang = normalize_wiki_lang(from_lang)
    to_lang = normalize_wiki_lang(to_lang)
    clean_key = (from_lang, to_lang, title.strip().lower())
    use_cache = _is_real_http_client(client)
    if use_cache:
        cached = _cache_get(_PROBE_CACHE, clean_key)
        if cached is not None:
            return dict(cached)
    try:
        url = (
            f"https://{from_lang}.wikipedia.org/w/api.php?action=query&format=json&redirects=1"
            f"&titles={urllib.parse.quote(title.strip())}&prop=langlinks&lllang={to_lang}"
        )
        resp = await client.get(url, headers=HEADERS, timeout=6.0)
        body = _parse_mediawiki_json(resp)
        if body is None or "query" not in body:
            return None
        pages = body.get("query", {}).get("pages", {})
        for _pid, page in pages.items():
            if "missing" in page or "invalid" in page:
                out = {"exists": False, "langlink": None}
                if use_cache:
                    _cache_put(_PROBE_CACHE, clean_key, out)
                return out
            links = page.get("langlinks") or []
            out = {"exists": True, "langlink": links[0].get("*") if links else None}
            if use_cache:
                _cache_put(_PROBE_CACHE, clean_key, out)
            return out
    except Exception:
        return None
    return None


async def _lookup_direct(
    title: str,
    client: httpx.AsyncClient,
    lang: str,
    context_text: str = "",
    year: Optional[int] = None,
    skip_exact: bool = False,
    candidate_sink: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Direct REST lookup over the title and its simplified variations. When a variation drops a
    parenthetical qualifier ('Ur (continent)' -> 'Ur'), the landed article must still reflect that
    qualifier, otherwise the bare name has resolved to a different sense (e.g. 'Ur' the city).
    """
    sink_kw = {"candidate_sink": candidate_sink} if candidate_sink is not None else {}
    for cand in generate_title_variations(title, lang=lang):
        if skip_exact and cand == title.strip():
            continue
        qualifier, subtitle = _dropped_parts(title, cand)
        ctx = " ".join(p for p in (context_text, qualifier, subtitle) if p)
        res = await _get_summary_direct(
            cand, client, lang=lang, resolve_disambig=True, context_text=ctx, year=year, **sink_kw
        )
        if not res:
            continue
        if qualifier and not qualifier_supported(qualifier, res):
            logger.info(f"'{cand}' -> '{res.get('wikiTitle')}' rejected: does not reflect qualifier '{qualifier}'")
            continue
        res.setdefault("_resolution_mode", "direct")
        return res
    return None


async def _find_best_search_candidate(
    query: str,
    candidate_queries: List[str],
    client: httpx.AsyncClient,
    lang: str = "en",
    context_text: str = "",
    year: Optional[int] = None,
    min_confidence: int = MIN_CONFIDENCE_THRESHOLD,
    candidate_sink: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Search Wikipedia across candidate query variations, score all candidate articles
    multi-dimensionally, and return the highest-scoring candidate ONLY if it meets
    the confidence threshold.
    """
    seen_titles = set()
    collected_titles: List[str] = []

    for q in candidate_queries:
        if not q:
            continue
        hits = await _search_wikipedia_titles(q, client, lang=lang, limit=5)
        for h in hits:
            if h not in seen_titles:
                seen_titles.add(h)
                collected_titles.append(h)
        if len(collected_titles) >= 7:
            break

    if not collected_titles:
        return None

    # Filter out titles that have zero lexical relevance to any variation for the deterministic scorer
    relevant_titles = [
        t for t in collected_titles
        if any(is_title_relevant(t, q) for q in candidate_queries)
    ]
    top_relevant = relevant_titles[:5]
    relevant_set = set(top_relevant)

    # When collecting candidates for the batch semantic LLM adjudicator on a real HTTP client,
    # also fetch summaries for the top 3 raw CirrusSearch hits even when their title shares 0
    # lexical tokens with the query (e.g. romaji/alias 'Monbushō Bijutsu Tenrankai' -> 'Japan Fine Arts Exhibition').
    titles_to_fetch = list(top_relevant)
    if candidate_sink is not None and _is_real_http_client(client):
        for raw_t in collected_titles[:3]:
            if raw_t not in relevant_set and len(titles_to_fetch) < 6:
                titles_to_fetch.append(raw_t)

    if not titles_to_fetch:
        return None

    sink_kw = {"candidate_sink": candidate_sink} if candidate_sink is not None else {}
    tasks = [
        _get_summary_direct(
            t, client, lang=lang, resolve_disambig=bool(context_text), context_text=context_text, year=year, **sink_kw
        )
        for t in titles_to_fetch
    ]
    summaries = await asyncio.gather(*tasks, return_exceptions=True)

    scored_candidates = []
    for req_title, s in zip(titles_to_fetch, summaries):
        if isinstance(s, dict) and s.get("wikiTitle"):
            _record_article_candidate(candidate_sink, s)
            if req_title not in relevant_set:
                continue
            sc = score_candidate(s, query, context_text=context_text, year=year)
            # When a relevant search hit `req_title` (e.g. 'Bunten' inside 'Bunten Exhibition') redirected
            # or disambiguated to its canonical article (e.g. 'Japan Fine Arts Exhibition'), also evaluate
            # against `req_title` / landed title if the landed article shares tokens with the query.
            if s["wikiTitle"].lower() != req_title.lower() and generic_token_overlap(
                f"{s.get('wikiTitle', '')} {s.get('description', '')} {s.get('extract', '')}",
                query,
            ) >= 1:
                sc = max(sc, score_candidate(s, s["wikiTitle"], context_text=context_text, year=year) - 15)
            if sc >= min_confidence:
                scored_candidates.append((sc, s))

    if not scored_candidates:
        return None

    scored_candidates.sort(key=lambda x: x[0], reverse=True)

    # Check for ambiguity tie between distinct entities
    if len(scored_candidates) > 1:
        top_score, top_cand = scored_candidates[0]
        second_score, second_cand = scored_candidates[1]
        if top_cand.get("wikiTitle") != second_cand.get("wikiTitle") and abs(top_score - second_score) <= 5:
            top_span = extract_temporal_span(f"{top_cand.get('description', '')} {top_cand.get('extract', '')}")
            second_span = extract_temporal_span(f"{second_cand.get('description', '')} {second_cand.get('extract', '')}")
            if not top_span and not second_span:
                logger.info(
                    f"Ambiguous Wikipedia match between '{top_cand.get('wikiTitle')}' and "
                    f"'{second_cand.get('wikiTitle')}' for query '{query}'. Returning no link."
                )
                return None

    winner = scored_candidates[0][1]
    winner["_resolution_mode"] = "search"
    return winner


async def fetch_wikipedia_summary(
    title: str,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    lang: str = "en",
    context_text: str = "",
    year: Optional[int] = None,
    is_prehistoric: bool = False,
    fallback_lang: str = "en",
    fallback_title: Optional[str] = None,
    candidate_sink: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Fetch summary, thumbnail image, and page URL from Wikipedia REST API.
    Precision-first multilingual architecture (exact matches always before fuzzy ones):
    1. Direct REST lookup on the title and qualifier-safe variations with temporal validation.
    2. Cross-lingual exact bridge: the exact fallback-language title's interlanguage link to the
       primary language, else the exact fallback-language article itself.
    3. Multi-candidate scored search in the primary language with strict confidence gating.
    4. Scored search in the fallback language.
    """
    if not title:
        return {}

    lang = normalize_wiki_lang(lang)
    fallback_lang = normalize_wiki_lang(fallback_lang)
    cross_lingual = lang != fallback_lang
    sink_kw = {"candidate_sink": candidate_sink} if candidate_sink is not None else {}

    async with semaphore:
        candidates = generate_title_variations(title, lang=lang)
        fb_target = (fallback_title or "").strip()
        if not fb_target and cross_lingual and is_likely_searchable_entity(title):
            fb_target = title.strip()

        # 1. Primary language: Direct REST lookup
        primary_res = await _lookup_direct(title, client, lang, context_text, year, **sink_kw)
        pre_probed = None

        # 1b. Guard against cross-lingual false homographs (e.g. Hebrew 'גיאה' = Moshav Ge'a vs
        #     fallback_title='Carrozzeria Ghia', or 'מיקרוגרפיה' = Jewish calligraphy vs 'Micrographia'):
        #     when the primary article has zero non-title context overlap with the event and the
        #     explicit fallback_title exists on fallback_lang without linking to this primary page,
        #     prefer the cross-lingual bridge (Step 2) over the unrelated local homograph.
        if primary_res and cross_lingual and (fallback_title or "").strip() and fb_target.lower() != title.strip().lower():
            title_tokens = _content_tokens(title)
            non_title_ctx = " ".join(
                t for t in re.findall(r'\w{3,}', (context_text or "").lower())
                if t not in _STOPWORDS and not any(are_tokens_related(t, tt) for tt in title_tokens)
            )
            primary_text = f"{primary_res.get('description') or ''} {primary_res.get('extract') or ''}"
            if non_title_ctx and generic_token_overlap(non_title_ctx, primary_text) == 0:
                pre_probed = await _probe_title(fb_target, fallback_lang, lang, client)
                if pre_probed and pre_probed.get("exists") and pre_probed.get("langlink") != primary_res.get("wikiTitle"):
                    primary_res = None

        # 2. Cross-lingual exact bridge, before any fuzzy search: an exact fallback-language title
        #    beats a loose primary-language search hit (e.g. the city 'Mantinea' for the battle).
        if not primary_res and cross_lingual and fb_target:
            probe = pre_probed if pre_probed is not None else await _probe_title(fb_target, fallback_lang, lang, client)
            linked_title = probe.get("langlink") if probe else await _get_langlink(
                fb_target, from_lang=fallback_lang, to_lang=lang, client=client
            )
            if linked_title:
                primary_res = await _get_summary_direct(
                    linked_title, client, lang=lang, resolve_disambig=True, context_text=context_text, year=year, **sink_kw
                )
                if primary_res:
                    primary_res.setdefault("_resolution_mode", "bridge")
            if not primary_res:
                skip_ex = probe is not None and not probe.get("exists")
                res = await _lookup_direct(
                    fb_target, client, fallback_lang, context_text, year,
                    skip_exact=skip_ex,
                    **sink_kw,
                )
                if res:
                    res.setdefault("_resolution_mode", "bridge")
                    return res

        # 2b. The primary-language title itself may be a fallback-language title (e.g. an English
        #     game name inside a Hebrew timeline).
        if not primary_res and cross_lingual and fallback_title and title.strip() != fb_target:
            linked_title = await _get_langlink(title, from_lang=fallback_lang, to_lang=lang, client=client)
            if linked_title:
                primary_res = await _get_summary_direct(
                    linked_title, client, lang=lang, resolve_disambig=True, context_text=context_text, year=year, **sink_kw
                )
                if primary_res:
                    primary_res.setdefault("_resolution_mode", "bridge")

        # 3. Primary language: Multi-candidate search fallback
        if not primary_res:
            primary_res = await _find_best_search_candidate(
                query=title,
                candidate_queries=candidates,
                client=client,
                lang=lang,
                context_text=context_text,
                year=year,
                min_confidence=MIN_CONFIDENCE_THRESHOLD,
                **sink_kw,
            )

        # 4. If primary language article found: supplement missing thumbnail / coordinates / English title from fallback language
        if primary_res:
            need_supplement = not primary_res.get("imageUrl") or primary_res.get("lat") is None
            if lang != fallback_lang and need_supplement:
                supplement_target = (fallback_title or "").strip()
                if not supplement_target and primary_res.get("wikiTitle"):
                    # Use native interlanguage links to find canonical article in fallback language
                    supplement_target = await _get_langlink(
                        primary_res["wikiTitle"],
                        from_lang=lang,
                        to_lang=fallback_lang,
                        client=client
                    ) or ""
                if not supplement_target and is_likely_searchable_entity(title):
                    supplement_target = title.strip()

                if supplement_target:
                    # Guarded lookup so a stripped qualifier can't borrow another sense's photo/coords.
                    sup_res = await _lookup_direct(supplement_target, client, fallback_lang, context_text, year)
                    if sup_res:
                        if not primary_res.get("imageUrl") and sup_res.get("imageUrl"):
                            primary_res["imageUrl"] = sup_res["imageUrl"]
                        elif sup_res.get("imageUrl"):
                            primary_res["fallbackImageUrl"] = sup_res["imageUrl"]
                        if primary_res.get("lat") is None and sup_res.get("lat") is not None:
                            primary_res["lat"] = sup_res["lat"]
                            primary_res["lng"] = sup_res.get("lng")
                        primary_res["fallbackWikiTitle"] = sup_res.get("wikiTitle")
            return primary_res

        # 4. Fallback-language scored search (its exact/direct lookup already ran in step 2)
        if cross_lingual and fb_target:
            res = await _find_best_search_candidate(
                query=fb_target,
                candidate_queries=generate_title_variations(fb_target, lang=fallback_lang),
                client=client,
                lang=fallback_lang,
                context_text=context_text,
                year=year,
                min_confidence=MIN_CONFIDENCE_THRESHOLD,
                **sink_kw,
            )
            if res:
                return res

        return {}


_DEFAULT_FETCH_WIKIPEDIA_SUMMARY = fetch_wikipedia_summary

_SUMMARY_BATCH_CHUNK_SIZE = 18  # Safely below MediaWiki TextExtracts exlimit=20 cap for exintro=1


def _resolve_query_title_map(
    query_obj: Dict[str, Any],
    requested_titles: List[str],
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Map each requested input title through MediaWiki `query.normalized` and `query.redirects`
    chains to its resolved page object in `query.pages` (returns None if absent from response).
    """
    norm_map = {
        item["from"]: item["to"]
        for item in (query_obj.get("normalized") or [])
        if isinstance(item, dict) and "from" in item and "to" in item
    }
    redir_map = {
        item["from"]: item["to"]
        for item in (query_obj.get("redirects") or [])
        if isinstance(item, dict) and "from" in item and "to" in item
    }
    pages_raw = query_obj.get("pages") or {}
    pages_iter = pages_raw.values() if isinstance(pages_raw, dict) else pages_raw

    by_exact: Dict[str, Dict[str, Any]] = {}
    by_first_cap: Dict[str, Dict[str, Any]] = {}
    for page in pages_iter:
        if isinstance(page, dict) and page.get("title"):
            pt = page["title"]
            by_exact[pt] = page
            cap = pt[:1].upper() + pt[1:]
            by_first_cap.setdefault(cap, page)

    out: Dict[str, Optional[Dict[str, Any]]] = {}
    for raw in requested_titles:
        cur = (raw or "").strip()
        if not cur:
            out[raw] = None
            continue
        if cur in norm_map:
            cur = norm_map[cur]
        elif "_" in cur:
            spaced = cur.replace("_", " ")
            if spaced in norm_map:
                cur = norm_map[spaced]
            elif spaced in redir_map or spaced in by_exact or (spaced[:1].upper() + spaced[1:]) in by_first_cap:
                cur = spaced
        if cur not in redir_map and cur not in by_exact:
            cap_cur = cur[:1].upper() + cur[1:]
            if cap_cur in redir_map:
                cur = cap_cur
        seen_hops = set()
        while cur in redir_map and cur not in seen_hops and len(seen_hops) < 6:
            seen_hops.add(cur)
            cur = redir_map[cur]
        page = by_exact.get(cur)
        if page is None and cur:
            page = by_first_cap.get(cur[:1].upper() + cur[1:])
        out[raw] = page
    return out


async def _batch_query_summaries_chunk(
    titles: List[str],
    lang: str,
    client: httpx.AsyncClient,
    to_lang: Optional[str] = None,
) -> Dict[str, Optional[str]]:
    """
    Fetch summaries, redirects, disambiguation flags, thumbnails, coordinates, and optional
    interlanguage links for up to 18 Wikipedia titles in a SINGLE HTTP request, populating
    _RAW_SUMMARY_CACHE, _LANGLINK_CACHE, and _PROBE_CACHE.
    """
    lang = normalize_wiki_lang(lang)
    to_lang = normalize_wiki_lang(to_lang, default="") if to_lang else ""
    clean_titles = [
        t.split("|", 1)[0].strip()
        for t in titles
        if t and t.split("|", 1)[0].strip()
    ][:_SUMMARY_BATCH_CHUNK_SIZE]
    if not clean_titles:
        return {}

    want_ll = bool(to_lang and to_lang != lang)
    ll_part = f"|langlinks&lllang={urllib.parse.quote(to_lang)}&lllimit=500" if want_ll else ""
    url = (
        f"https://{lang}.wikipedia.org/w/api.php?action=query&format=json&redirects=1"
        f"&titles={urllib.parse.quote('|'.join(clean_titles))}"
        f"&prop=extracts|pageimages|coordinates|pageprops|description|info{ll_part}"
        f"&exintro=1&explaintext=1&exlimit=20"
        f"&piprop=name|thumbnail|original&pithumbsize={DEFAULT_IMAGE_THUMB_WIDTH}&pilimit=20"
        f"&colimit=50&inprop=url&ppprop=disambiguation|wikibase_item"
    )
    try:
        resp = await client.get(url, headers=HEADERS, timeout=10.0)
        body = _parse_mediawiki_json(resp)
        if body is None or "query" not in body:
            return {}
    except Exception:
        _note_transient_enrichment_error()
        return {}

    cont = body.get("continue") or {}
    ll_complete = "llcontinue" not in cont
    pi_complete = "picontinue" not in cont
    co_complete = "cocontinue" not in cont

    resolved = _resolve_query_title_map(body["query"], clean_titles)
    discovered_langlinks: Dict[str, Optional[str]] = {}

    for orig_title, page in resolved.items():
        if page is None:
            continue
        orig_clean_lower = orig_title.strip().replace(" ", "_").lower()
        if "missing" in page or "invalid" in page:
            _cache_put(_RAW_SUMMARY_CACHE, (lang, orig_clean_lower), (404, None))
            if want_ll and ll_complete:
                _cache_put(_LANGLINK_CACHE, (lang, to_lang, orig_clean_lower), "")
                _cache_put(_PROBE_CACHE, (lang, to_lang, orig_title.strip().lower()), {"exists": False, "langlink": None})
                _cache_put(_PROBE_CACHE, (lang, to_lang, orig_title.strip().replace("_", " ").lower()), {"exists": False, "langlink": None})
            continue

        landed_title = (page.get("title") or orig_title).strip()
        landed_clean_lower = landed_title.replace(" ", "_").lower()
        pageprops = page.get("pageprops") or {}
        is_disambig = "disambiguation" in pageprops

        if want_ll and ll_complete:
            links = page.get("langlinks") or []
            ll_target = (
                links[0].get("*")
                if (links and isinstance(links[0], dict) and links[0].get("*"))
                else None
            )
            discovered_langlinks[orig_title] = ll_target
            for k_ll in {orig_clean_lower, landed_clean_lower}:
                _cache_put(_LANGLINK_CACHE, (lang, to_lang, k_ll), ll_target or "")
            for k_pr in {
                orig_title.strip().lower(),
                orig_title.strip().replace("_", " ").lower(),
                landed_title.lower(),
            }:
                _cache_put(_PROBE_CACHE, (lang, to_lang, k_pr), {"exists": True, "langlink": ll_target})

        raw_ext = (page.get("extract") or "").strip() if "extract" in page else ""
        if raw_ext:
            paras = [p.strip() for p in raw_ext.split("\n") if p.strip()]
            if len(paras) >= 2 and len(paras[0]) < 45:
                ext = f"{paras[0]} {paras[1]}"
            elif paras:
                ext = paras[0]
            else:
                ext = ""
        else:
            ext = ""

        # Only cache summary when extract is non-empty (or page is disambiguation) and props weren't truncated
        if (bool(ext) or is_disambig) and pi_complete and co_complete:
            coords_dict = None
            coords_list = page.get("coordinates")
            if isinstance(coords_list, list) and coords_list:
                chosen_c = None
                for c in coords_list:
                    if isinstance(c, dict) and c.get("globe") in (None, "", "earth") and "lat" in c and "lon" in c:
                        chosen_c = c
                        if "primary" in c:
                            break
                if chosen_c:
                    coords_dict = {"lat": chosen_c["lat"], "lon": chosen_c["lon"]}

            full_url = page.get("fullurl") or (
                f"https://{lang}.wikipedia.org/wiki/"
                f"{urllib.parse.quote(landed_title.replace(' ', '_'), safe='()/:,-._~')}"
            )
            compact = {
                "type": "disambiguation" if is_disambig else "standard",
                "title": landed_title,
                "description": page.get("description") or "",
                "extract": ext,
                "thumbnail": page.get("thumbnail"),
                "originalimage": page.get("original"),
                "coordinates": coords_dict,
                "content_urls": {"desktop": {"page": full_url}},
            }
            for k_sum in {orig_clean_lower, landed_clean_lower}:
                _cache_put(_RAW_SUMMARY_CACHE, (lang, k_sum), (200, compact))

    return discovered_langlinks


async def _batch_prewarm_timeline_summaries(
    events_data: list,
    client: httpx.AsyncClient,
    lang: str = "en",
) -> None:
    """
    Pre-warm _RAW_SUMMARY_CACHE, _LANGLINK_CACHE, and _PROBE_CACHE across all timeline events
    using multi-title MediaWiki queries (up to 18 titles per HTTP call instead of 1 per event).
    """
    lang = normalize_wiki_lang(lang)
    primary_titles: List[str] = []
    seen_primary = set()
    en_titles: List[str] = []
    seen_en = set()

    for ev in events_data:
        if not isinstance(ev, dict):
            continue
        wk = (ev.get("wikipedia_title") or "").strip()
        wk_en = (ev.get("wikipedia_title_en") or "").strip()
        reg = (ev.get("title") or "").strip()
        if lang != "en" and not wk_en:
            for src_text in (reg, wk):
                m = re.search(r'\(([A-Za-z][A-Za-z0-9\s\-\'’.,&:]{2,60})\)', src_text or "")
                if m and is_likely_searchable_entity(m.group(1).strip()):
                    wk_en = m.group(1).strip()
                    break

        for cand in ([wk] if wk else ([reg] if reg and is_likely_searchable_entity(reg) else [])):
            ck = (lang, cand.replace(" ", "_").lower())
            if ck not in seen_primary and _cache_get(_RAW_SUMMARY_CACHE, ck) is None:
                seen_primary.add(ck)
                primary_titles.append(cand)

        if lang != "en" and wk_en:
            ek = ("en", wk_en.replace(" ", "_").lower())
            if ek not in seen_en and _cache_get(_RAW_SUMMARY_CACHE, ek) is None:
                seen_en.add(ek)
                en_titles.append(wk_en)

    if len(primary_titles) + len(en_titles) < 2:
        return

    wave1_tasks = []
    for i in range(0, len(primary_titles), _SUMMARY_BATCH_CHUNK_SIZE):
        chunk = primary_titles[i : i + _SUMMARY_BATCH_CHUNK_SIZE]
        wave1_tasks.append(_batch_query_summaries_chunk(chunk, lang, client, to_lang=("en" if lang != "en" else None)))
    en_task_start = len(wave1_tasks)
    for i in range(0, len(en_titles), _SUMMARY_BATCH_CHUNK_SIZE):
        chunk = en_titles[i : i + _SUMMARY_BATCH_CHUNK_SIZE]
        wave1_tasks.append(_batch_query_summaries_chunk(chunk, "en", client, to_lang=lang))

    wave1_results = await asyncio.gather(*wave1_tasks, return_exceptions=True)

    # Wave 2 (cross-lingual bridge follow-up): pre-warm newly discovered interlanguage counterparts
    if lang != "en":
        extra_primary: List[str] = []
        extra_en: List[str] = []
        for idx, res_map in enumerate(wave1_results):
            if not isinstance(res_map, dict):
                continue
            if idx < en_task_start:
                for _src, ll_en in res_map.items():
                    if ll_en:
                        ek = ("en", ll_en.replace(" ", "_").lower())
                        if ek not in seen_en and _cache_get(_RAW_SUMMARY_CACHE, ek) is None:
                            seen_en.add(ek)
                            extra_en.append(ll_en)
            else:
                for _src, ll_loc in res_map.items():
                    if ll_loc:
                        ck = (lang, ll_loc.replace(" ", "_").lower())
                        if ck not in seen_primary and _cache_get(_RAW_SUMMARY_CACHE, ck) is None:
                            seen_primary.add(ck)
                            extra_primary.append(ll_loc)

        wave2_tasks = []
        if len(extra_primary) >= 2:
            for i in range(0, len(extra_primary), _SUMMARY_BATCH_CHUNK_SIZE):
                wave2_tasks.append(_batch_query_summaries_chunk(extra_primary[i : i + _SUMMARY_BATCH_CHUNK_SIZE], lang, client))
        if len(extra_en) >= 2:
            for i in range(0, len(extra_en), _SUMMARY_BATCH_CHUNK_SIZE):
                wave2_tasks.append(_batch_query_summaries_chunk(extra_en[i : i + _SUMMARY_BATCH_CHUNK_SIZE], "en", client))
        if wave2_tasks:
            await asyncio.gather(*wave2_tasks, return_exceptions=True)


async def search_wikipedia_candidates(
    query: str,
    client: httpx.AsyncClient,
    lang: str = "en",
    context_text: str = "",
    limit: int = 5,
    fallback_lang: str = "en",
    year: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Search Wikipedia for multiple candidate articles matching a query, scored and ranked
    with temporal and contextual awareness.
    """
    clean = query.strip()
    if not clean:
        return []

    lang = normalize_wiki_lang(lang)
    fallback_lang = normalize_wiki_lang(fallback_lang)
    limit = max(1, min(int(limit or 5), 10))
    titles_set: List[str] = []

    # 1. Search combined query if context is provided
    if context_text and context_text.lower() not in clean.lower():
        combined_query = f"{clean} {context_text}"
        context_hits = await _search_wikipedia_titles(combined_query, client, lang=lang, limit=limit)
        for t in context_hits:
            if t not in titles_set:
                titles_set.append(t)

    # 2. Search direct query
    direct_hits = await _search_wikipedia_titles(clean, client, lang=lang, limit=limit)
    for t in direct_hits:
        if t not in titles_set:
            titles_set.append(t)

    # 3. OpenSearch prefix fallback
    try:
        url = (
            f"https://{lang}.wikipedia.org/w/api.php?action=opensearch&search="
            f"{urllib.parse.quote(clean)}&limit={limit}&namespace=0&format=json"
        )
        resp = await client.get(url, headers=HEADERS, timeout=3.0)
        if resp.status_code == 200:
            data = resp.json()
            if len(data) > 1 and data[1]:
                for t in data[1]:
                    if t not in titles_set:
                        titles_set.append(t)
    except Exception:
        pass

    # 4. Fetch rich summaries for candidates
    candidates_to_fetch = titles_set[:limit + 3]
    tasks = [_get_summary_direct(t, client, lang=lang, resolve_disambig=False, year=year) for t in candidates_to_fetch]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    valid_candidates = []
    seen_titles = set()
    for res in results:
        if isinstance(res, dict) and res.get("wikiTitle"):
            wt = res["wikiTitle"]
            if wt not in seen_titles:
                seen_titles.add(wt)
                valid_candidates.append(res)

    # 5. English candidate fallback if primary language found fewer than 2 hits
    if len(valid_candidates) < 2 and lang != fallback_lang and is_likely_searchable_entity(clean):
        try:
            fb_direct = await _search_wikipedia_titles(clean, client, lang=fallback_lang, limit=limit)
            fb_fetch = [t for t in fb_direct if t not in seen_titles][:limit]
            fb_tasks = [_get_summary_direct(t, client, lang=fallback_lang, resolve_disambig=False, year=year) for t in fb_fetch]
            fb_results = await asyncio.gather(*fb_tasks, return_exceptions=True)
            for res in fb_results:
                if isinstance(res, dict) and res.get("wikiTitle"):
                    wt = res["wikiTitle"]
                    if wt not in seen_titles:
                        seen_titles.add(wt)
                        valid_candidates.append(res)
        except Exception:
            pass

    # 6. Rank candidates by composite score
    valid_candidates.sort(
        key=lambda cand: score_candidate(cand, clean, context_text=context_text, year=year),
        reverse=True
    )
    # Filter out completely disqualified candidates (e.g. severe temporal contradiction or disambiguation)
    filtered = [
        c for c in valid_candidates
        if score_candidate(c, clean, context_text=context_text, year=year) > -150
    ]
    return filtered[:limit] if filtered else valid_candidates[:limit]


# ---------------------------------------------------------------------------
# Multi-source image retrieval, ranking & timeline-wide de-duplication
# ---------------------------------------------------------------------------

# Files that are almost never a meaningful illustration of a specific subject.
IMAGE_JUNK_KEYWORDS = (
    "flag", "coat_of_arms", "coat-of-arms", "logo", "icon", "symbol",
    "locator", "location_map", "locationmap", "location-map", "orthographic",
    "blank_map", "blankmap", "wikidata", "commons-logo", "wikimedia",
    "edit-icon", "ambox", "question_book", "disambig", "red_pointer",
    "gnome-", "nuvola", "crystal_clear", "star_full", "star_empty",
    "sound-icon", "speaker", "loudspeaker", "wiktionary", "wikisource",
    "portal", "padlock", "seal_of", "_seal", "-seal", "emblem", "locator_map_of", "location_map_of", "blank_map_of", "topographic",
    "reliefkarte", "positionskarte", "pictogram", "text_document",
    "voting_box", "voting box", "kit_body", "kit_left_arm", "kit_right_arm", "kit_shorts", "kit_socks",
    "shackle", "pending-protection", "socrates.png", "merge-arrow", "mergefrom", "mergeto",
    "splitsection", "oojs_ui", "p_philosophy", "p_history", "p_science", "p_literature", "p_religion", "p_mathematics",
    "blue_pencil", "blue pencil", "green_globe", "green globe", "graduation_hat", "graduation hat",
    "grey_point", "grey point", "red_point", "red point", "grey_star", "grey star", "wappen",
)
IMAGE_REJECT_EXT = (".ogg", ".oga", ".ogv", ".wav", ".mid", ".midi", ".webm", ".pdf", ".djvu")

# Minimum composite score for an image to be shown at all (below it we prefer no image).
MIN_IMAGE_CONFIDENCE = 5

# Standard Wikimedia CDN thumbnail width step for high-resolution drawer/map/diagram viewing.
DEFAULT_IMAGE_THUMB_WIDTH = 1280

_ARTICLE_IMAGES_CACHE: "OrderedDict[tuple, Any]" = OrderedDict()   # (lang, title_lower) -> (expires_at, raw_candidates)
_IMAGE_CACHE_TTL = _WIKI_CACHE_TTL


def _filename_from_url(url: str) -> str:
    """Extract the underlying Commons file name from a Wikimedia (thumb or original) URL."""
    if not url:
        return ""
    try:
        segs = [s for s in urllib.parse.urlparse(url).path.split("/") if s]
        # Thumb URLs are .../thumb/<h>/<hh>/<Original_name>/<render>; the render segment can be a
        # generic 'NNNpx-thumbnail.jpg' or carry 'langhe-'/'lossy-page1-' prefixes.
        if "thumb" in segs:
            i = segs.index("thumb")
            if len(segs) > i + 3:
                return urllib.parse.unquote(segs[i + 3])
        seg = urllib.parse.unquote(segs[-1]) if segs else ""
        return re.sub(r'^\d+px-', '', seg)
    except Exception:
        return ""


def _upgrade_wikimedia_thumb_url(
    thumb_url: Optional[str],
    original_url: Optional[str] = None,
    original_width: Optional[int] = None,
    target_width: int = DEFAULT_IMAGE_THUMB_WIDTH,
) -> Optional[str]:
    """
    Upgrade a Wikimedia REST / MediaWiki thumbnail URL (typically 320px/330px/400px)
    to a higher standard Wikimedia thumbnail step (default 1280px) without extra HTTP calls.
    Respects original_width when known so raster images smaller than target_width use
    original_url instead of requesting an upscaled thumbnail that Wikimedia's CDN rejects.
    """
    url = thumb_url or original_url
    if not url or not isinstance(url, str):
        return None
    if "/thumb/" not in url or ("wikimedia.org" not in url and "wikipedia.org" not in url):
        return url

    fn = _filename_from_url(url).lower()
    is_svg = fn.endswith(".svg")
    is_web_safe_raster = fn.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))

    if (
        not is_svg
        and is_web_safe_raster
        and original_url
        and isinstance(original_width, int)
        and 0 < original_width <= target_width
    ):
        return original_url

    last_slash = url.rfind("/")
    if last_slash == -1:
        return url
    tail = url[last_slash + 1 :]
    new_tail, count = re.subn(r"(^|-)(\d+)px-", rf"\g<1>{target_width}px-", tail, count=1)
    if count:
        return url[: last_slash + 1] + new_tail
    return url


def _image_key(name: str) -> str:
    """Dedup key for a file name: API titles use spaces, URLs use underscores."""
    return (name or "").strip().replace(" ", "_").lower()


def _split_glued_tokens(text: str) -> str:
    """Insert word boundaries in PascalCase/camelCase and letter<->digit runs.

    Commons filenames are frequently glued (e.g. 'QuantumHarmonicOscillatorAnimation',
    'DoubleSlitExperiment'); without this they collapse to a single token that cannot
    match the event subject.
    """
    text = re.sub(r'(?<=[A-Z])(?=[A-Z][a-z])', ' ', text)   # 'HOWave' -> 'HO Wave'
    text = re.sub(r'(?<=[a-z0-9])(?=[A-Z])', ' ', text)      # 'camelCase' -> 'camel Case'
    text = re.sub(r'(?<=[A-Za-z])(?=[0-9])', ' ', text)      # 'word2013' -> 'word 2013'
    text = re.sub(r'(?<=[0-9])(?=[A-Za-z])', ' ', text)      # '2013word' -> '2013 word'
    return text


def _normalize_media_text(text: str) -> str:
    """Split glued tokens, flatten separators, and lowercase for token matching."""
    return _split_glued_tokens(text or "").replace("_", " ").replace("-", " ").lower()


def _meaningful_tokens(normalized_text: str) -> set:
    return {
        token
        for token in normalized_text.split()
        if len(token) >= 4 or (token.isdigit() and len(token) >= 2)
    }


def _animation_matches_subject(candidate_text: str, subject_context: str) -> bool:
    """Require strong literal subject evidence before an animation can be selected."""
    candidate_normalized = re.sub(r'[^\w]+', ' ', _normalize_media_text(candidate_text)).strip()
    subject_normalized = re.sub(r'[^\w]+', ' ', _normalize_media_text(subject_context)).strip()
    if not candidate_normalized or not subject_normalized:
        return False
    if len(subject_normalized) >= 5 and subject_normalized in candidate_normalized:
        return True

    subject_tokens = _meaningful_tokens(subject_normalized)
    candidate_tokens = _meaningful_tokens(candidate_normalized)
    overlap = subject_tokens.intersection(candidate_tokens)
    if len(subject_tokens) == 1:
        return bool(overlap)
    return len(overlap) >= 2


def _search_media_is_specific(candidate_text: str, anchors: List[str], event_context: str) -> bool:
    """
    Commons *search* hits echo the search term by construction, so matching a one-word subject
    ('Pangaea', 'Mars') proves little. Require a multi-word subject match, or one extra
    event-specific token (e.g. 'breakup', a year) beyond the one-word subject.
    """
    cand_tokens = _meaningful_tokens(re.sub(r'[^\w]+', ' ', _normalize_media_text(candidate_text)))
    ctx_tokens = _meaningful_tokens(re.sub(r'[^\w]+', ' ', _normalize_media_text(event_context)))
    for anchor in anchors:
        if not anchor or not _animation_matches_subject(candidate_text, anchor):
            continue
        anchor_tokens = _meaningful_tokens(re.sub(r'[^\w]+', ' ', _normalize_media_text(anchor)))
        if len(anchor_tokens) >= 2 or (ctx_tokens - anchor_tokens) & cand_tokens:
            return True
    return False


_CAMERA_DATE_RE = re.compile(r'\b\d{4}[-_]\d{2}[-_]\d{2}\b|\b(?:19|20)\d{6}\b')


def score_image(
    cand: Dict[str, Any],
    event_context: str = "",
    animation_context=None,
) -> Optional[int]:
    """
    Composite confidence score for a candidate image relative to the event context.
    Returns None if the candidate is disqualified (junk type, wrong MIME, unusable).
    Rewards: Wikidata canonical depiction (P18), editorial lead image, caption/context
    overlap, period year match, and adequate resolution. Penalizes tiny thumbnails and
    anachronistic modern photos when historical alternatives exist.

    `animation_context` is the subject anchor (a string, or a list of canonical titles of which
    any one may match). Candidates not embedded in the article itself (animations, Commons
    search hits) must literally name that subject.
    """
    fname = (cand.get("filename") or "").lower()
    caption = (cand.get("caption") or "").lower()
    mime = (cand.get("mime") or "").lower()
    width = cand.get("width") or 0
    source = cand.get("source") or "article"
    is_lead = bool(cand.get("isLead"))

    if mime and not mime.startswith("image/"):
        return None

    key_name = fname or _filename_from_url(cand.get("url") or "").lower()
    if not key_name:
        return None
    if key_name.endswith(IMAGE_REJECT_EXT):
        return None
    if any(k in key_name for k in IMAGE_JUNK_KEYWORDS):
        return None

    low_norm = f"{key_name} {caption}".replace("-", " ").replace("_", " ")
    if cand.get("is_animated") or source == "commons_gif" or mime == "image/gif":
        if any(k in low_norm for k in GIF_JUNK_KEYWORDS):
            return None

    candidate_text = _normalize_media_text(
        f"{cand.get('filename') or _filename_from_url(cand.get('url') or '')} {cand.get('caption') or ''}"
    )
    overlap = generic_token_overlap(candidate_text, event_context) if event_context else 0

    # Non-lead SVG diagrams on an article with zero context overlap are almost always sidebar/template/navbox icons
    if not is_lead and (".svg" in key_name or mime == "image/svg+xml") and event_context and overlap == 0:
        return None

    anchors = animation_context if animation_context is not None else event_context
    if isinstance(anchors, str):
        anchors = [anchors]
    needs_subject_evidence = source in ("commons", "commons_gif") or (cand.get("is_animated") and not is_lead and source != "article")
    if needs_subject_evidence and not any(
        _animation_matches_subject(candidate_text, anchor) for anchor in anchors if anchor
    ):
        return None
    if source in ("commons", "commons_gif") and not _search_media_is_specific(candidate_text, anchors, event_context):
        return None

    score = 0
    if source == "wikidata":
        score += 35  # canonical depiction (Wikidata P18) — best for artworks/people
    if is_lead:
        # Full +35 when context is absent or overlaps; +20 when lead has 0 overlap with event_context
        # so an in-article photo that explicitly names the subject can outrank an accidental navbox lead.
        score += 35 if (not event_context or overlap >= 1) else 20
    if source == "article":
        score += 10
    if source == "commons_gif":
        # Commons GIF candidates must be verified multi-frame animations with context overlap
        if not cand.get("is_animated"):
            return None  # Disqualify static 1-frame GIFs from Commons search
        if event_context:
            if overlap >= 2:
                score += 15  # Contextual match for authentic motion diagram
            elif overlap == 1:
                score += 5   # Modest boost
            else:
                return None  # Disqualify unrelated GIFs with 0 context match
        else:
            return None  # Disqualify if no context to verify relevance

    if width:
        if width < 150:
            score -= 45
        elif width >= 500:
            score += 12
        elif width >= 320:
            score += 6
    if event_context:
        score += min(overlap * 12, 48)
    if cand.get("is_animated"):
        score += 20 if source == "article" else 10  # elevate verified multi-frame animations

    # Temporal alignment between image subject years and event year:
    # Reward period-accurate illustrations and penalize anachronistic modern photos on historical events.
    if event_context and not cand.get("is_animated"):
        ctx_years = [int(y) for y in re.findall(r'(?<!\d)(1[5-9]\d{2}|20[0-2]\d)(?!\d)', event_context)]
        if ctx_years:
            ev_year = ctx_years[-1]
            cleaned_key = _CAMERA_DATE_RE.sub("", key_name)
            img_years = [int(y) for y in re.findall(r'(?<!\d)(1[5-9]\d{2}|20[0-2]\d)(?!\d)', cleaned_key)]
            if img_years:
                if any(y == ev_year for y in img_years):
                    score += 22
                elif any(abs(y - ev_year) <= 5 for y in img_years):
                    score += 14
                elif min(img_years) > ev_year + 8 and score >= MIN_IMAGE_CONFIDENCE:
                    penalty = 50 if (min(img_years) - ev_year) > 15 else 28
                    score = max(MIN_IMAGE_CONFIDENCE, score - penalty)

    return score


def _rank_image_candidates(
    raw_candidates: List[Dict[str, Any]],
    event_context: str = "",
    animation_context=None,
) -> List[Dict[str, Any]]:
    """Score, filter, and sort candidate images (best first) for a given event context."""
    scored = []
    for c in raw_candidates:
        s = score_image(c, event_context, animation_context)
        if s is None:
            continue
        cc = dict(c)
        cc["score"] = s
        scored.append(cc)
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored


async def _resolve_commons_file_checked(fname: str, client: httpx.AsyncClient) -> tuple[Optional[Dict[str, Any]], bool]:
    """Resolve a Commons File name to a thumbnail URL + metadata via imageinfo; returns (result, ok)."""
    if not fname:
        return None, True
    try:
        url = (
            f"https://commons.wikimedia.org/w/api.php?action=query&format=json"
            f"&titles=File:{urllib.parse.quote(fname)}&prop=imageinfo"
            f"&iiprop=url|size|mime|extmetadata&iiurlwidth={DEFAULT_IMAGE_THUMB_WIDTH}"
        )
        resp = await client.get(url, headers=HEADERS, timeout=7.0)
        body = _parse_mediawiki_json(resp)
        if body is None or "query" not in body:
            return None, False
        pages = body.get("query", {}).get("pages", {})
        for _pid, page in pages.items():
            ii = page.get("imageinfo") or []
            if not ii:
                continue
            info = ii[0]
            meta = info.get("extmetadata", {}) or {}
            caption = (
                (meta.get("ObjectName", {}) or {}).get("value", "")
                or (meta.get("ImageDescription", {}) or {}).get("value", "")
            )
            caption = re.sub(r"<[^>]+>", " ", caption or "")
            return {
                "url": info.get("thumburl") or info.get("url"),
                "filename": fname,
                "caption": caption,
                "width": info.get("thumbwidth") or info.get("width") or 0,
                "mime": info.get("mime", ""),
            }, True
    except Exception:
        return None, False
    return None, True


async def _resolve_commons_file(fname: str, client: httpx.AsyncClient) -> Optional[Dict[str, Any]]:
    """Resolve a Commons File name to a thumbnail URL + metadata via imageinfo."""
    res, _ = await _resolve_commons_file_checked(fname, client)
    return res


async def _fetch_wikidata_image_checked(qid: str, client: httpx.AsyncClient) -> tuple[Optional[Dict[str, Any]], bool]:
    """Fetch Wikidata P18 canonical depiction; returns (image_dict_or_none, ok) without caching transient errors."""
    clean_qid = (qid or "").strip().upper()
    if not clean_qid:
        return None, True
    use_cache = _is_real_http_client(client)
    if use_cache:
        cached = _cache_get(_WIKIDATA_IMAGE_CACHE, clean_qid)
        if cached is not None:
            return (dict(cached), True) if isinstance(cached, dict) else (None, True)
    try:
        url = (
            f"https://www.wikidata.org/w/api.php?action=wbgetclaims"
            f"&entity={urllib.parse.quote(clean_qid)}&property=P18&format=json"
        )
        resp = await client.get(url, headers=HEADERS, timeout=6.5)
        body = _parse_mediawiki_json(resp)
        if body is None or "claims" not in body:
            return None, False
        claims = body.get("claims", {}).get("P18", [])
        if not claims:
            if use_cache:
                _cache_put(_WIKIDATA_IMAGE_CACHE, clean_qid, "")
            return None, True
        fname = claims[0].get("mainsnak", {}).get("datavalue", {}).get("value")
        if not fname:
            if use_cache:
                _cache_put(_WIKIDATA_IMAGE_CACHE, clean_qid, "")
            return None, True
        resolved, ok = await _resolve_commons_file_checked(fname, client)
        if not ok:
            return None, False
        if use_cache:
            _cache_put(_WIKIDATA_IMAGE_CACHE, clean_qid, resolved if resolved else "")
        return resolved, True
    except Exception:
        return None, False


async def fetch_wikidata_image(qid: str, client: httpx.AsyncClient) -> Optional[Dict[str, Any]]:
    """Fetch the Wikidata P18 (image) canonical depiction for an entity, resolved to a URL."""
    res, _ = await _fetch_wikidata_image_checked(qid, client)
    return res


def _strip_file_namespace(title: str) -> str:
    """Strip any localized MediaWiki File namespace prefix ('File:', 'קובץ:', 'Fichier:', 'Datei:', etc.)."""
    raw = (title or "").strip()
    return raw.split(":", 1)[1].strip() if ":" in raw else raw


async def _fetch_commons_fallback_checked(
    query: str,
    client: httpx.AsyncClient,
    limit: int = 4,
) -> tuple[List[Dict[str, Any]], bool]:
    """Search Wikimedia Commons directly as last-resort image source; returns (results, ok)."""
    clean = (query or "").strip()
    if not clean:
        return [], True
    use_cache = _is_real_http_client(client)
    cache_key = (clean.lower(), limit)
    if use_cache:
        cached = _cache_get(_COMMONS_FALLBACK_CACHE, cache_key)
        if cached is not None:
            return list(cached), True
    results: List[Dict[str, Any]] = []
    try:
        url = (
            f"https://commons.wikimedia.org/w/api.php?action=query&format=json"
            f"&generator=search&gsrsearch={urllib.parse.quote(clean)}&gsrnamespace=6&gsrlimit={limit}"
            f"&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth={DEFAULT_IMAGE_THUMB_WIDTH}"
        )
        resp = await client.get(url, headers=HEADERS, timeout=7.0)
        body = _parse_mediawiki_json(resp)
        if body is None:
            return [], False
        pages = body.get("query", {}).get("pages", {})
        for _pid, page in pages.items():
            ii = page.get("imageinfo") or []
            if not ii:
                continue
            info = ii[0]
            fname = _strip_file_namespace(page.get("title", "") or "")
            low = fname.lower()
            if low.endswith(IMAGE_REJECT_EXT) or any(k in low for k in IMAGE_JUNK_KEYWORDS):
                continue
            meta = info.get("extmetadata", {}) or {}
            caption = (
                (meta.get("ObjectName", {}) or {}).get("value", "")
                or (meta.get("ImageDescription", {}) or {}).get("value", "")
            )
            caption = re.sub(r"<[^>]+>", " ", caption or "")
            results.append({
                "url": info.get("thumburl") or info.get("url"),
                "filename": fname,
                "caption": caption,
                "width": info.get("thumbwidth") or info.get("width") or 0,
                "mime": info.get("mime", ""),
            })
    except Exception:
        return [], False
    if use_cache:
        _cache_put(_COMMONS_FALLBACK_CACHE, cache_key, results, max_entries=_IMAGE_LIST_CACHE_MAX_ENTRIES)
    return results, True


async def fetch_commons_fallback_images(
    query: str,
    client: httpx.AsyncClient,
    limit: int = 4
) -> List[Dict[str, Any]]:
    """Last-resort image source: search Wikimedia Commons directly for a named subject."""
    results, _ = await _fetch_commons_fallback_checked(query, client, limit=limit)
    return results


GIF_JUNK_KEYWORDS = (
    "draft registration", "registration card", "certificate", "census",
    "signature", "document", "manuscript", "newspaper", "scan", "declaration",
    "passport", "death certificate", "birth certificate", "receipt",
    "treaty", "archive", "nara", "affidavit", "indenture",
    "record of", "payroll",
    # Non-encyclopedic cartoons, mascots, clipart, stickers, memes
    "traveler and friends", "friends gifs", "cartoon", "clipart", "clip art",
    "sticker", "emoji", "emoticon", "meme", "challenge", "funny",
    # Meteorological radar / satellite loops accidentally matching human or event names
    "satellite loop", "radar loop", "infrared loop", "visible infrared", "satellite imagery loop",
    "blowing dust", "cira ", "(cira",
    # Demographic / statistical charts matching ancient monuments
    "population pyramid",
    # Typography puzzles / stock promos / game assets
    "ambigram", "knowledge is human", "speed dreams",
    # Celestial 3D constellations accidentally matching particle / animal subjects
    "constellation 3d", "constellation_3d",
)


async def _fetch_commons_gif_candidates_checked(
    query: str,
    client: httpx.AsyncClient,
    limit: int = 4,
) -> tuple[List[Dict[str, Any]], bool]:
    """
    Search Wikimedia Commons directly for authentic animated GIFs matching a topic.
    Returns (results, ok) where `ok` is False on HTTP/API/network failures so callers never cache degraded lists.
    """
    clean = (query or "").strip()
    if not clean:
        return [], True
    use_cache = _is_real_http_client(client)
    cache_key = (clean.lower(), limit)
    if use_cache:
        cached = _cache_get(_COMMONS_GIF_CACHE, cache_key)
        if cached is not None:
            return cached, True
    results: List[Dict[str, Any]] = []
    try:
        search_query = f"{clean} filemime:image/gif"
        url = (
            f"https://commons.wikimedia.org/w/api.php?action=query&format=json"
            f"&generator=search&gsrsearch={urllib.parse.quote(search_query)}&gsrnamespace=6&gsrlimit={limit}"
            f"&prop=imageinfo&iiprop=url|size|mime|metadata|extmetadata&iiurlwidth=400"
        )
        resp = await client.get(url, headers=HEADERS, timeout=6.5)
        body = _parse_mediawiki_json(resp)
        if body is None:
            # Never poison _COMMONS_GIF_CACHE on 429, 5xx, or MediaWiki PoolCounter error
            return [], False
        pages = body.get("query", {}).get("pages", {})
        for _pid, page in pages.items():
            ii = page.get("imageinfo") or []
            if not ii:
                continue
            info = ii[0]
            fname = _strip_file_namespace(page.get("title", "") or "")
            low = fname.lower()
            mime = (info.get("mime") or "").lower()
            if not low.endswith(".gif") and mime != "image/gif":
                continue
            low_norm = low.replace("-", " ").replace("_", " ")
            if any(k in low for k in IMAGE_JUNK_KEYWORDS) or any(k in low_norm for k in GIF_JUNK_KEYWORDS):
                continue

            # Verify multi-frame animation: reject static 1-frame GIFs (seals, scanned records, diagrams)
            raw_meta = info.get("metadata") or []
            meta_dict = {m["name"]: m["value"] for m in raw_meta if isinstance(m, dict) and "name" in m and "value" in m}
            try:
                frame_count = int(meta_dict.get("frameCount") or 1)
            except (ValueError, TypeError):
                frame_count = 1
            if frame_count <= 1:
                continue

            meta = info.get("extmetadata", {}) or {}
            caption = (
                (meta.get("ObjectName", {}) or {}).get("value", "")
                or (meta.get("ImageDescription", {}) or {}).get("value", "")
            )
            caption = re.sub(r"<[^>]+>", " ", caption or "")
            cap_norm = caption.lower().replace("-", " ").replace("_", " ")
            if any(k in cap_norm for k in GIF_JUNK_KEYWORDS):
                continue
            orig_url = info.get("url") or ""
            thumb_url = info.get("thumburl") or ""
            final_url = orig_url or thumb_url
            if final_url and "/thumb/" in final_url and ("wikimedia.org" in final_url or "wikipedia.org" in final_url):
                final_url = re.sub(r"/thumb/([^/]+/[^/]+/[^/]+)/.*", r"/\1", final_url.replace("thumb.wikimedia.org", "upload.wikimedia.org")).split("?")[0]

            results.append({
                "url": final_url,
                "filename": fname,
                "caption": caption,
                "width": info.get("width") or info.get("thumbwidth") or 0,
                "mime": "image/gif",
                "source": "commons_gif",
                "is_animated": True,
                "frame_count": frame_count,
            })
    except Exception:
        return [], False
    if use_cache:
        _cache_put(_COMMONS_GIF_CACHE, cache_key, results, max_entries=_IMAGE_LIST_CACHE_MAX_ENTRIES)
    return results, True


async def fetch_commons_gif_candidates(
    query: str,
    client: httpx.AsyncClient,
    limit: int = 4
) -> List[Dict[str, Any]]:
    """
    Search Wikimedia Commons directly for authentic animated GIFs matching a topic.
    Filters out scanned historical text documents, certificates, and junk.
    """
    results, _ = await _fetch_commons_gif_candidates_checked(query, client, limit=limit)
    return results


GIF_SEARCH_ALWAYS = "always"
GIF_SEARCH_AUTO = "auto"
GIF_SEARCH_OFF = "off"


def _gif_search_static_threshold() -> int:
    """In 'auto' mode, the Commons GIF search runs only when the article has fewer static photos."""
    raw = os.getenv("WIKI_GIF_SEARCH_MAX_STATIC_IMAGES", "").strip()
    try:
        return max(0, int(raw)) if raw else 2
    except ValueError:
        return 2


def _static_article_photo_count(file_titles: List[str], has_lead: bool) -> int:
    count = sum(
        1 for ft in file_titles
        if not _strip_file_namespace(ft).lower().endswith((".svg", ".gif"))
    )
    return max(count, 1 if has_lead else 0)


async def fetch_image_candidates(
    title: str,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    lang: str = "en",
    lead_url: Optional[str] = None,
    wikidata_qid: Optional[str] = None,
    fallback_title: Optional[str] = None,
    gif_search: str = GIF_SEARCH_ALWAYS,
    allow_commons_fallback: bool = True,
) -> List[Dict[str, Any]]:
    """
    Collect a de-duplicated set of raw (unscored) image candidates for a resolved article:
      1. MediaWiki pageimages (lead) + images list, resolved via a single batched imageinfo call.
      2. Commons search specifically for authentic motion GIFs matching the topic. `gif_search`:
         'always' (concurrently with step 1), 'auto' (only when the article has few static photos,
         i.e. when a GIF can actually win, P-03/SC-04) or 'off'.
      3. Wikidata P18 canonical depiction (great for artworks/people/specific works).
      4. Wikimedia Commons search as a last resort when the article is image-poor (only when
         `allow_commons_fallback`, i.e. for the timeline's top-ranked events).
    Scoring/ranking is per-event (context differs); results are cached per (lang, title) ONLY when
    no upstream Wikimedia request failed transiently (preventing 30-minute empty-image cache poisoning).
    """
    title = (title or "").strip()
    if not title:
        return []

    lang = normalize_wiki_lang(lang)
    use_cache = _is_real_http_client(client)
    gif_search = gif_search if gif_search in (GIF_SEARCH_ALWAYS, GIF_SEARCH_AUTO, GIF_SEARCH_OFF) else GIF_SEARCH_ALWAYS
    cache_key = (lang, title.lower(), (fallback_title or "").lower(), gif_search, bool(allow_commons_fallback))
    if use_cache:
        cached = _cache_get(_ARTICLE_IMAGES_CACHE, cache_key)
        if cached is not None:
            return cached

    candidates: List[Dict[str, Any]] = []
    seen_keys = set()
    by_key: Dict[str, Dict[str, Any]] = {}
    cacheable = True

    def _add(url, filename=None, caption="", width=0, mime="", is_lead=False, source="article", is_animated=False, frame_count=1):
        if not url:
            return
        fn = filename or _filename_from_url(url)
        key = _image_key(fn or url)
        if not key:
            return
        if key in seen_keys:
            # Same file seen again (e.g. the bare REST lead seed, then its imageinfo record):
            # keep one entry but merge in the richer metadata and higher-resolution URL.
            existing = by_key.get(key)
            if existing is not None:
                existing["isLead"] = existing["isLead"] or is_lead
                if caption and not existing["caption"]:
                    existing["caption"] = caption
                if width and width >= (existing.get("width") or 0):
                    existing["width"] = width
                    if not existing.get("is_animated"):
                        existing["url"] = url
                if mime and not existing["mime"]:
                    existing["mime"] = mime
                if is_animated and not existing["is_animated"]:
                    existing.update(is_animated=True, frame_count=frame_count, url=url)
            return
        seen_keys.add(key)
        entry = {
            "url": url,
            "filename": fn,
            "caption": caption or "",
            "width": width or 0,
            "mime": mime or "",
            "isLead": is_lead,
            "source": source,
            "key": key,
            "is_animated": is_animated,
            "frame_count": frame_count,
        }
        by_key[key] = entry
        candidates.append(entry)

    # Seed with the REST lead thumbnail so we never regress if the API calls fail.
    if lead_url:
        _add(lead_url, is_lead=True, source="article")

    async with semaphore:
        lead_name = None
        file_titles: List[str] = []

        # Commons GIF search: in parallel with the MediaWiki calls when it always runs, otherwise
        # decided once the article's own photos are known.
        gif_query = fallback_title or title
        commons_gif_task: Optional[asyncio.Task] = None
        if gif_search == GIF_SEARCH_ALWAYS:
            commons_gif_task = asyncio.create_task(
                _fetch_commons_gif_candidates_checked(gif_query, client, limit=4)
            )

        # 1. pageimages (lead) + images list + Wikidata item id (uses batch pre-warmed cache when available)
        page_rec = _cache_get(_PAGE_IMAGES_RAW_CACHE, (lang, title.strip().replace(" ", "_").lower())) if use_cache else None
        if page_rec is not None:
            lead_name = page_rec.get("lead_name")
            if page_rec.get("thumb_source"):
                _add(page_rec["thumb_source"], filename=lead_name, width=page_rec.get("thumb_width", 0), is_lead=True, source="article")
            file_titles.extend(page_rec.get("file_titles") or [])
            if not wikidata_qid and page_rec.get("wikidata_qid"):
                wikidata_qid = page_rec["wikidata_qid"]
        else:
            try:
                url = (
                    f"https://{lang}.wikipedia.org/w/api.php?action=query&format=json&redirects=1"
                    f"&titles={urllib.parse.quote(title)}&prop=pageimages|images|pageprops"
                    f"&piprop=name|thumbnail&pithumbsize={DEFAULT_IMAGE_THUMB_WIDTH}&imlimit=40&ppprop=wikibase_item"
                )
                resp = await client.get(url, headers=HEADERS, timeout=8.0)
                body = _parse_mediawiki_json(resp)
                if body is not None and "query" in body:
                    pages = body.get("query", {}).get("pages", {})
                    for _pid, page in pages.items():
                        rec = _extract_page_images_record(page)
                        lead_name = rec["lead_name"]
                        if rec["thumb_source"]:
                            _add(rec["thumb_source"], filename=lead_name, width=rec["thumb_width"], is_lead=True, source="article")
                        file_titles.extend(rec["file_titles"])
                        if not wikidata_qid and rec["wikidata_qid"]:
                            wikidata_qid = rec["wikidata_qid"]
                        if use_cache and "missing" not in page and "invalid" not in page:
                            _cache_put(_PAGE_IMAGES_RAW_CACHE, (lang, title.strip().replace(" ", "_").lower()), rec)
                else:
                    cacheable = False
            except Exception:
                cacheable = False

        if gif_search == GIF_SEARCH_AUTO and _static_article_photo_count(
            file_titles, bool(lead_name or lead_url)
        ) < _gif_search_static_threshold():
            commons_gif_task = asyncio.create_task(
                _fetch_commons_gif_candidates_checked(gif_query, client, limit=4)
            )

        # 2. Batched imageinfo for all candidate files (uses cross-event _FILE_IMAGEINFO_CACHE when pre-warmed).
        # Full file `metadata` (EXIF/XMP) is deliberately NOT requested here: for camera photos and
        # scans it can be hundreds of KB to several MB per file, and with up to 40 files per event
        # and ~25 events enriched concurrently it spiked RAM past the instance limit. Only GIFs need
        # it (frameCount), so it is fetched in a small follow-up request for those files alone.
        if file_titles:
            ii_pages, ii_ok = await _fetch_imageinfo_pages_direct(file_titles[:40], lang, client, use_cache=use_cache)
            if not ii_ok:
                cacheable = False
            for page in ii_pages:
                ii = page.get("imageinfo") or []
                if not ii:
                    continue
                info = ii[0]
                fname = _strip_file_namespace(page.get("title", "") or "")
                meta = info.get("extmetadata", {}) or {}
                caption = (
                    (meta.get("ObjectName", {}) or {}).get("value", "")
                    or (meta.get("ImageDescription", {}) or {}).get("value", "")
                )
                caption = re.sub(r"<[^>]+>", " ", caption or "")
                is_lead = bool(
                    lead_name
                    and fname.replace(" ", "_").lower() == lead_name.replace(" ", "_").lower()
                )
                file_mime = info.get("mime", "")
                is_gif = file_mime == "image/gif" or fname.lower().endswith(".gif")
                is_animated = False
                frame_count = 1
                if is_gif:
                    raw_meta = info.get("metadata") or []
                    meta_dict = {m["name"]: m["value"] for m in raw_meta if isinstance(m, dict) and "name" in m and "value" in m}
                    try:
                        frame_count = int(meta_dict.get("frameCount") or 1)
                    except (ValueError, TypeError):
                        frame_count = 1
                    is_animated = bool(frame_count > 1)

                file_url = (info.get("url") if is_gif else (info.get("thumburl") or info.get("url"))) or ""
                if is_gif and "/thumb/" in file_url and ("wikimedia.org" in file_url or "wikipedia.org" in file_url):
                    file_url = re.sub(r"/thumb/([^/]+/[^/]+/[^/]+)/.*", r"/\1", file_url.replace("thumb.wikimedia.org", "upload.wikimedia.org")).split("?")[0]
                _add(
                    file_url,
                    filename=fname,
                    caption=caption,
                    width=info.get("width") if is_gif else (info.get("thumbwidth") or info.get("width") or 0),
                    mime=file_mime,
                    is_lead=is_lead,
                    source="article",
                    is_animated=is_animated,
                    frame_count=frame_count,
                )

        # 3. Incorporate concurrent Commons GIF candidates
        try:
            commons_gifs, gif_ok = (await commons_gif_task) if commons_gif_task is not None else ([], True)
            if not gif_ok:
                cacheable = False
            for g in commons_gifs:
                _add(
                    g["url"],
                    filename=g.get("filename"),
                    caption=g.get("caption", ""),
                    width=g.get("width", 0),
                    mime=g.get("mime", "image/gif"),
                    is_lead=False,
                    source="commons_gif",
                    is_animated=g.get("is_animated", True),
                    frame_count=g.get("frame_count", 2),
                )
        except Exception:
            cacheable = False

    # What the article itself yielded (raster only, excluding external commons_gif and .svg icons).
    # The lead counts double: it is editorially confirmed.
    def _illustration_weight() -> int:
        raster = [
            c for c in candidates
            if c.get("source") == "article"
            and not c["key"].endswith(IMAGE_REJECT_EXT)
            and not c["key"].endswith(".svg")
        ]
        return len(raster) + (1 if any(c["isLead"] for c in raster) else 0)

    # 3. Wikidata P18 canonical depiction (best-effort). Only when the article is
    #    image-poor (also the common case for specific artworks/works), to limit API volume.
    if wikidata_qid and _illustration_weight() < 3:
        try:
            async with semaphore:
                p18, p18_ok = await _fetch_wikidata_image_checked(wikidata_qid, client)
            if not p18_ok:
                cacheable = False
            if p18 and p18.get("url"):
                _add(p18["url"], filename=p18.get("filename"), caption=p18.get("caption", ""),
                     width=p18.get("width", 0), mime=p18.get("mime", ""), source="wikidata")
        except Exception:
            cacheable = False

    # 4. Commons fallback when the article yielded almost nothing usable
    if allow_commons_fallback and _illustration_weight() < 2:
        try:
            async with semaphore:
                commons, commons_ok = await _fetch_commons_fallback_checked(fallback_title or title, client, limit=4)
            if not commons_ok:
                cacheable = False
            for c in commons:
                _add(c["url"], filename=c.get("filename"), caption=c.get("caption", ""),
                     width=c.get("width", 0), mime=c.get("mime", ""), source="commons")
        except Exception:
            cacheable = False

    if use_cache and cacheable:
        _cache_put(_ARTICLE_IMAGES_CACHE, cache_key, candidates, max_entries=_IMAGE_LIST_CACHE_MAX_ENTRIES)
    return candidates


_DEFAULT_FETCH_IMAGE_CANDIDATES = fetch_image_candidates
_PAGE_IMAGES_BATCH_CHUNK_SIZE = 10
_FILE_IMAGEINFO_BATCH_CHUNK_SIZE = 45


def _file_cache_key(lang: str, file_title: str) -> tuple:
    return (lang, _strip_file_namespace(file_title or "").replace(" ", "_").lower())


def _extract_page_images_record(page: Dict[str, Any]) -> Dict[str, Any]:
    lead_name = page.get("pageimage")
    thumb = page.get("thumbnail") or {}
    file_titles: List[str] = []
    for im in page.get("images") or []:
        t = im.get("title", "") or ""
        if im.get("ns") == 6 or t.lower().startswith("file:") or ":" in t:
            fname = _strip_file_namespace(t)
            low = fname.lower()
            if not low or low.endswith(IMAGE_REJECT_EXT) or any(k in low for k in IMAGE_JUNK_KEYWORDS):
                continue
            file_titles.append(t)
    wikidata_qid = ((page.get("pageprops") or {}).get("wikibase_item")) or None
    return {
        "lead_name": lead_name,
        "thumb_source": thumb.get("source"),
        "thumb_width": thumb.get("width", 0),
        "file_titles": file_titles[:40],
        "wikidata_qid": wikidata_qid,
    }


async def _fetch_imageinfo_pages_direct(
    file_titles: List[str],
    lang: str,
    client: httpx.AsyncClient,
    *,
    use_cache: bool,
) -> tuple[List[Dict[str, Any]], bool]:
    """
    Fetch MediaWiki `imageinfo` for a list of `File:` titles in chunks of up to 45 files per request,
    reusing and populating `_FILE_IMAGEINFO_CACHE` across events and timelines when `use_cache` is True.
    """
    lang = normalize_wiki_lang(lang)
    deduped_fts: List[str] = []
    seen_fkeys = set()
    for ft in file_titles:
        clean_ft = (ft or "").split("|", 1)[0].strip()
        if not clean_ft:
            continue
        fk = _file_cache_key(lang, clean_ft)
        if fk[1] and fk not in seen_fkeys:
            seen_fkeys.add(fk)
            deduped_fts.append(clean_ft)

    if not deduped_fts:
        return [], True

    cached_by_key: Dict[tuple, Dict[str, Any]] = {}
    missing_fts: List[str] = []
    if use_cache:
        for ft in deduped_fts:
            fk = _file_cache_key(lang, ft)
            hit = _cache_get(_FILE_IMAGEINFO_CACHE, fk)
            if hit is not None:
                cached_by_key[fk] = hit
            else:
                missing_fts.append(ft)
    else:
        missing_fts = deduped_fts

    all_ok = True
    fetched_pages: List[Dict[str, Any]] = []
    for idx in range(0, len(missing_fts), _FILE_IMAGEINFO_BATCH_CHUNK_SIZE):
        chunk = missing_fts[idx : idx + _FILE_IMAGEINFO_BATCH_CHUNK_SIZE]
        chunk_ok = True
        try:
            url = (
                f"https://{lang}.wikipedia.org/w/api.php?action=query&format=json"
                f"&titles={urllib.parse.quote('|'.join(chunk))}&prop=imageinfo"
                f"&iiprop=url|size|mime|extmetadata&iiextmetadatafilter=ObjectName|ImageDescription"
                f"&iiurlwidth={DEFAULT_IMAGE_THUMB_WIDTH}"
            )
            resp = await client.get(url, headers=HEADERS, timeout=8.0)
            body = _parse_mediawiki_json(resp)
            if body is None or "query" not in body:
                all_ok = False
                continue
            pages_raw = body["query"].get("pages") or {}
            chunk_pages = [
                p for p in (pages_raw.values() if isinstance(pages_raw, dict) else pages_raw)
                if isinstance(p, dict) and p.get("title")
            ]
            gif_titles = [
                p["title"]
                for p in chunk_pages
                if ((p.get("imageinfo") or [{}])[0].get("mime") == "image/gif")
                or p["title"].lower().endswith(".gif")
            ]
            if gif_titles:
                try:
                    meta_url = (
                        f"https://{lang}.wikipedia.org/w/api.php?action=query&format=json"
                        f"&titles={urllib.parse.quote('|'.join(gif_titles))}&prop=imageinfo&iiprop=metadata"
                    )
                    meta_resp = await client.get(meta_url, headers=HEADERS, timeout=8.0)
                    meta_body = _parse_mediawiki_json(meta_resp)
                    if meta_body is not None and "query" in meta_body:
                        meta_pages = meta_body["query"].get("pages") or {}
                        meta_iter = meta_pages.values() if isinstance(meta_pages, dict) else meta_pages
                        by_title = {mp.get("title"): mp for mp in meta_iter if isinstance(mp, dict) and mp.get("title")}
                        for p in chunk_pages:
                            src = by_title.get(p.get("title"))
                            src_ii = (src or {}).get("imageinfo") or []
                            ii = p.get("imageinfo") or []
                            if ii and src_ii:
                                ii[0]["metadata"] = src_ii[0].get("metadata") or []
                    else:
                        chunk_ok = False
                        all_ok = False
                except Exception:
                    chunk_ok = False
                    all_ok = False

            for p in chunk_pages:
                compact_p = {"title": p["title"], "imageinfo": p.get("imageinfo") or []}
                fetched_pages.append(compact_p)
                fk = _file_cache_key(lang, p["title"])
                if fk[1]:
                    cached_by_key[fk] = compact_p
                    if use_cache and chunk_ok:
                        _cache_put(_FILE_IMAGEINFO_CACHE, fk, compact_p)
        except Exception:
            all_ok = False

    if not use_cache:
        return fetched_pages, all_ok

    ordered: List[Dict[str, Any]] = []
    seen_out = set()
    for ft in deduped_fts:
        fk = _file_cache_key(lang, ft)
        rec = cached_by_key.get(fk)
        if rec is not None and fk not in seen_out:
            seen_out.add(fk)
            ordered.append(rec)
    # Also include any returned page whose title normalized differently (e.g. unit test mocks)
    for fp in fetched_pages:
        fk = _file_cache_key(lang, fp["title"])
        if fk not in seen_out:
            seen_out.add(fk)
            ordered.append(fp)
    return ordered, all_ok


async def _batch_fetch_page_images_chunk(
    titles: List[str],
    lang: str,
    client: httpx.AsyncClient,
) -> List[str]:
    """
    Fetch `pageimages|images|pageprops` for up to 10 articles in one MediaWiki query (with up to
    2 `imcontinue` pages if `imlimit=500` overflows), populating `_PAGE_IMAGES_RAW_CACHE`.
    """
    lang = normalize_wiki_lang(lang)
    clean_titles = [
        t.split("|", 1)[0].strip()
        for t in titles
        if t and t.split("|", 1)[0].strip()
    ][:_PAGE_IMAGES_BATCH_CHUNK_SIZE]
    if not clean_titles:
        return []

    base_url = (
        f"https://{lang}.wikipedia.org/w/api.php?action=query&format=json&redirects=1"
        f"&titles={urllib.parse.quote('|'.join(clean_titles))}&prop=pageimages|images|pageprops"
        f"&piprop=name|thumbnail&pithumbsize={DEFAULT_IMAGE_THUMB_WIDTH}&pilimit=50&imlimit=500&ppprop=wikibase_item"
    )

    merged_query: Dict[str, Any] = {"normalized": [], "redirects": [], "pages": {}}
    imcontinue: Optional[str] = None
    unfinished_pid: Optional[str] = None

    for step in range(3):
        url = f"{base_url}&imcontinue={urllib.parse.quote(imcontinue)}" if imcontinue else base_url
        try:
            resp = await client.get(url, headers=HEADERS, timeout=9.0)
            body = _parse_mediawiki_json(resp)
            if body is None or "query" not in body:
                return []
        except Exception:
            _note_transient_enrichment_error()
            return []

        q = body["query"]
        if step == 0:
            merged_query["normalized"] = q.get("normalized") or []
            merged_query["redirects"] = q.get("redirects") or []
        pages_raw = q.get("pages") or {}
        pages_items = pages_raw.items() if isinstance(pages_raw, dict) else enumerate(pages_raw)
        for pid, p in pages_items:
            if not isinstance(p, dict):
                continue
            spid = str(p.get("pageid", pid))
            dest = merged_query["pages"].get(spid)
            if dest is None:
                dest = dict(p)
                dest["images"] = list(p.get("images") or [])
                merged_query["pages"][spid] = dest
            else:
                if p.get("pageimage") and not dest.get("pageimage"):
                    dest["pageimage"] = p["pageimage"]
                if p.get("thumbnail") and not dest.get("thumbnail"):
                    dest["thumbnail"] = p["thumbnail"]
                if p.get("pageprops") and not dest.get("pageprops"):
                    dest["pageprops"] = p["pageprops"]
                if p.get("images"):
                    dest["images"].extend(p["images"])

        cont = body.get("continue") or {}
        imcontinue = cont.get("imcontinue")
        if not imcontinue:
            unfinished_pid = None
            break
        unfinished_pid = str(imcontinue).split("|", 1)[0]

    resolved = _resolve_query_title_map(merged_query, clean_titles)
    discovered_files: List[str] = []
    for orig_title, page in resolved.items():
        if page is None or "missing" in page or "invalid" in page:
            continue
        spid = str(page.get("pageid", ""))
        if unfinished_pid and (spid == unfinished_pid or not page.get("images")):
            continue
        rec = _extract_page_images_record(page)
        orig_k = (lang, orig_title.strip().replace(" ", "_").lower())
        landed_k = (lang, (page.get("title") or orig_title).strip().replace(" ", "_").lower())
        _cache_put(_PAGE_IMAGES_RAW_CACHE, orig_k, rec)
        _cache_put(_PAGE_IMAGES_RAW_CACHE, landed_k, rec)
        discovered_files.extend(rec["file_titles"])
    return discovered_files


def _wikidata_p18_batch_size() -> int:
    raw = os.getenv("WIKIDATA_P18_BATCH_SIZE", "").strip()
    try:
        return max(1, min(50, int(raw))) if raw else 25
    except ValueError:
        return 25


_WIKIDATA_P18_PERSIST_TTL = 7 * 24 * 3600


def _p18_persist_key(qid: str) -> str:
    return f"p18:{qid}"


async def _batch_prewarm_wikidata_p18(qids: List[str], client: httpx.AsyncClient) -> None:
    """
    Fills `_WIKIDATA_IMAGE_CACHE` for many Wikidata items at once (SC-04): the persistent cache
    first, then `wbgetentities` (<= 50 ids per call) for the P18 file names, then one batched
    Commons `imageinfo` per <= 45 files. `fetch_image_candidates` then needs no per-event calls.
    Only successful lookups are cached, so a transient failure falls back to the per-event path.
    """
    from services import enrichment_cache

    wanted = list(dict.fromkeys(
        q.strip().upper() for q in qids
        if isinstance(q, str) and re.fullmatch(r"\s*[Qq]\d{1,12}\s*", q)
    ))
    wanted = [q for q in wanted if _cache_get(_WIKIDATA_IMAGE_CACHE, q) is None]
    if not wanted:
        return

    persisted = await enrichment_cache.get_many([_p18_persist_key(q) for q in wanted])
    for q in list(wanted):
        value = persisted.get(_p18_persist_key(q))
        if isinstance(value, dict) and ("url" in value or value.get("none")):
            _cache_put(_WIKIDATA_IMAGE_CACHE, q, "" if value.get("none") else value)
            wanted.remove(q)
    if len(wanted) < 2:
        return  # a single item is fetched by the per-event path just as cheaply

    file_by_qid: Dict[str, Optional[str]] = {}
    chunk_size = _wikidata_p18_batch_size()
    for i in range(0, len(wanted), chunk_size):
        chunk = wanted[i : i + chunk_size]
        try:
            url = (
                "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims"
                f"&ids={urllib.parse.quote('|'.join(chunk))}"
            )
            resp = await client.get(url, headers=HEADERS, timeout=8.0)
            body = _parse_mediawiki_json(resp)
            if body is None or not isinstance(body.get("entities"), dict):
                continue
            for q in chunk:
                ent = body["entities"].get(q)
                if not isinstance(ent, dict) or "missing" in ent:
                    continue
                claims = ((ent.get("claims") or {}).get("P18")) or []
                fname = None
                if claims:
                    fname = (((claims[0] or {}).get("mainsnak") or {}).get("datavalue") or {}).get("value")
                file_by_qid[q] = fname if isinstance(fname, str) and fname.strip() else None
            body = None  # entity claims can be large: drop them before the next chunk
        except Exception:
            _note_transient_enrichment_error()

    to_persist = []
    for q, fname in file_by_qid.items():
        if fname is None:
            _cache_put(_WIKIDATA_IMAGE_CACHE, q, "")
            to_persist.append((_p18_persist_key(q), {"none": True}, _WIKIDATA_P18_PERSIST_TTL))

    files = {q: f for q, f in file_by_qid.items() if f}
    if files:
        # Commons files resolve through any Wikipedia's imageinfo (shared repository).
        by_norm = {_file_cache_key("en", f"File:{f}")[1]: q for q, f in files.items()}
        pages, _ok = await _fetch_imageinfo_pages_direct(
            [f"File:{f}" for f in files.values()], "en", client, use_cache=True
        )
        for page in pages:
            info = (page.get("imageinfo") or [None])[0]
            q = by_norm.get(_file_cache_key("en", page.get("title") or "")[1])
            if not q or not isinstance(info, dict):
                continue
            meta = info.get("extmetadata", {}) or {}
            caption = (
                (meta.get("ObjectName", {}) or {}).get("value", "")
                or (meta.get("ImageDescription", {}) or {}).get("value", "")
            )
            resolved = {
                "url": info.get("thumburl") or info.get("url"),
                "filename": files[q],
                "caption": re.sub(r"<[^>]+>", " ", caption or ""),
                "width": info.get("thumbwidth") or info.get("width") or 0,
                "mime": info.get("mime", ""),
            }
            if resolved["url"]:
                _cache_put(_WIKIDATA_IMAGE_CACHE, q, resolved)
                to_persist.append((_p18_persist_key(q), resolved, _WIKIDATA_P18_PERSIST_TTL))
    if to_persist:
        enrichment_cache.put_many(to_persist)


async def _batch_prewarm_timeline_images(
    stage1_entries: List[Dict[str, Any]],
    client: httpx.AsyncClient,
    lang: str = "en",
) -> None:
    """
    Pre-warm `_PAGE_IMAGES_RAW_CACHE`, `_FILE_IMAGEINFO_CACHE` and `_WIKIDATA_IMAGE_CACHE` across
    all resolved articles in the timeline so `fetch_image_candidates` completes without per-event
    Wikipedia API calls. After the article page-images wave, the native-language imageinfo wave,
    the English-supplement wave (+ its imageinfo) and the Wikidata P18 batch run concurrently (P-13).
    """
    lang = normalize_wiki_lang(lang)
    titles_by_lang: Dict[str, List[str]] = {}
    seen_articles = set()

    resolved_entries = []
    for entry in stage1_entries:
        if not isinstance(entry, dict):
            continue
        res = entry.get("res")
        if not isinstance(res, dict) or not res.get("wikiTitle"):
            continue
        resolved_entries.append((entry, res, normalize_wiki_lang(res.get("lang", lang))))

    for _entry, res, art_lang in resolved_entries:
        wt = res["wikiTitle"].strip()
        ak = (art_lang, wt.replace(" ", "_").lower())
        if ak not in seen_articles and _cache_get(_PAGE_IMAGES_RAW_CACHE, ak) is None:
            seen_articles.add(ak)
            titles_by_lang.setdefault(art_lang, []).append(wt)

    total_articles = sum(len(v) for v in titles_by_lang.values())
    if total_articles >= 2:
        page_tasks = []
        for art_lang, t_list in titles_by_lang.items():
            for i in range(0, len(t_list), _PAGE_IMAGES_BATCH_CHUNK_SIZE):
                page_tasks.append(_batch_fetch_page_images_chunk(t_list[i : i + _PAGE_IMAGES_BATCH_CHUNK_SIZE], art_lang, client))
        await asyncio.gather(*page_tasks, return_exceptions=True)

    def _page_rec(art_lang: str, title: str) -> Optional[Dict[str, Any]]:
        return _cache_get(_PAGE_IMAGES_RAW_CACHE, (art_lang, title.strip().replace(" ", "_").lower()))

    # English supplement articles for non-English events with <4 static article photos
    en_sup_titles: List[str] = []
    for entry, res, art_lang in resolved_entries:
        if art_lang == "en":
            continue
        en_img_title = (res.get("fallbackWikiTitle") or entry.get("wiki_key_en") or "").strip()
        if not en_img_title:
            continue
        rec = _page_rec(art_lang, res["wikiTitle"])
        static_count = sum(
            1 for ft in ((rec or {}).get("file_titles") or [])
            if not _strip_file_namespace(ft).lower().endswith((".svg", ".gif"))
        )
        if static_count < 4:
            ek = ("en", en_img_title.replace(" ", "_").lower())
            if ek not in seen_articles and _cache_get(_PAGE_IMAGES_RAW_CACHE, ek) is None:
                seen_articles.add(ek)
                en_sup_titles.append(en_img_title)

    def _imageinfo_tasks(file_lists: Dict[str, List[str]]):
        return [
            _fetch_imageinfo_pages_direct(flist, flang, client, use_cache=True)
            for flang, flist in file_lists.items()
            if len(flist) >= 2
        ]

    async def _native_imageinfo_wave() -> None:
        files_by_lang: Dict[str, List[str]] = {}
        for _entry, res, art_lang in resolved_entries:
            rec = _page_rec(art_lang, res["wikiTitle"])
            if rec and rec.get("file_titles"):
                files_by_lang.setdefault(art_lang, []).extend(rec["file_titles"])
        tasks = _imageinfo_tasks(files_by_lang)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _english_supplement_wave() -> None:
        if len(en_sup_titles) >= 2:
            await asyncio.gather(*(
                _batch_fetch_page_images_chunk(en_sup_titles[i : i + _PAGE_IMAGES_BATCH_CHUNK_SIZE], "en", client)
                for i in range(0, len(en_sup_titles), _PAGE_IMAGES_BATCH_CHUNK_SIZE)
            ), return_exceptions=True)
        en_files: List[str] = []
        for entry, res, art_lang in resolved_entries:
            if art_lang == "en":
                continue
            en_img_title = (res.get("fallbackWikiTitle") or entry.get("wiki_key_en") or "").strip()
            en_rec = _page_rec("en", en_img_title) if en_img_title else None
            if en_rec and en_rec.get("file_titles"):
                en_files.extend(en_rec["file_titles"])
        tasks = _imageinfo_tasks({"en": en_files})
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _wikidata_wave() -> None:
        qids = []
        for _entry, res, art_lang in resolved_entries:
            rec = _page_rec(art_lang, res["wikiTitle"])
            # Same condition as fetch_image_candidates: P18 is only consulted for image-poor articles.
            if rec and rec.get("wikidata_qid") and _static_article_photo_count(
                rec.get("file_titles") or [], bool(rec.get("thumb_source"))
            ) < 3:
                qids.append(rec["wikidata_qid"])
        if len(qids) >= 2:
            await _batch_prewarm_wikidata_p18(qids, client)

    await asyncio.gather(
        _native_imageinfo_wave(), _english_supplement_wave(), _wikidata_wave(), return_exceptions=True
    )


_ADJUDICATOR_DEFAULT_MODEL = "gemini-3.6-flash"


def _adjudicator_model() -> str:
    """ADJUDICATOR_MODEL (or the older GEMINI_ADJUDICATOR_MODEL); else the first flash-lite model
    configured for generation; else gemini-3.6-flash (faster to first token than 3.8-flash on
    zero-thinking JSON batches)."""
    for name in ("ADJUDICATOR_MODEL", "GEMINI_ADJUDICATOR_MODEL"):
        env_model = (os.getenv(name) or "").strip()
        if env_model:
            return env_model
    try:
        from services.gemini_service import get_gemini_models_to_try
        lite = next((m for m in get_gemini_models_to_try() if "lite" in m.lower()), None)
    except Exception:
        lite = None
    return lite or _ADJUDICATOR_DEFAULT_MODEL


def _adjudicator_budget_sec() -> float:
    raw = os.getenv("ADJUDICATOR_TIMEOUT_SEC", "").strip()
    try:
        return max(1.0, min(30.0, float(raw))) if raw else 5.5
    except ValueError:
        return 5.5


def _resolve_adjudicator_api_key(api_key: Optional[str] = None) -> Optional[str]:
    """Resolve a Gemini API key for batch enrichment adjudication, falling back to configured env keys."""
    if api_key and api_key.strip():
        return api_key.strip()
    try:
        from services.quota_service import get_next_free_key
        free_key = get_next_free_key()
        if free_key and free_key.strip():
            return free_key.strip()
    except Exception:
        pass
    env_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if env_key:
        return env_key
    return None


async def _call_gemini_adjudicator_json(
    payload: Dict[str, Any],
    api_key: str,
    preferred_model: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Execute a single fast, zero-thinking JSON batch call to Gemini Flash to adjudicate
    ambiguous Wikipedia article candidates and image selections across the timeline.
    """
    try:
        from google import genai
        from google.genai import types
    except Exception:
        return None

    # One attempt on one cheap, fast model within a fixed budget (P-03 / SC-14): the adjudicator only
    # refines an already usable result, so a slow or failing model must never hold the timeline back.
    models_to_try = [_adjudicator_model()]
    budget_sec = _adjudicator_budget_sec()

    system_instruction = (
        "You are an encyclopedic historian and visual curator adjudicating Wikipedia articles and "
        "Wikimedia Commons images for an interactive timeline.\n"
        "For each event in `events`, return a JSON object in `decisions` with:\n"
        "1. `event_index` (integer matching the input event)\n"
        "2. `article_id`: Pick the candidate ID ('A0', 'A1', ...) from `article_candidates` whose Wikipedia "
        "article genuinely represents the event's PRIMARY SUBJECT in the right historical era/context "
        "(including when the event uses a local nickname, abbreviation, or romaji alias like 'Bunten' or "
        "'Monbushō Bijutsu Tenrankai' for 'Japan Fine Arts Exhibition'). "
        "Reject namesakes, wrong-era people/events, false cross-lingual homographs (e.g. an unrelated village "
        "sharing a name with an Italian design firm, or a WWII battle on a prehistoric/geological timeline), "
        "or generic city/country/venue pages mentioned only in passing. "
        "If NO candidate in `article_candidates` is genuinely relevant and accurate for the event, return \"NONE\". "
        "If `article_candidates` is empty, return null.\n"
        "3. `image_id`: Pick the candidate ID ('I0', 'I1', ...) from `image_candidates` that most accurately "
        "and period-appropriately illustrates the specific event. "
        "Prioritize historical/period accuracy (e.g. a 1974 Mk1 car or period artwork over a modern 2019 model photo). "
        "Prefer animated GIFs (`is_animated: true`) ONLY when they genuinely depict the specific scientific or "
        "historical phenomenon of the event; a relevant static image is always better than an irrelevant GIF. "
        "Avoid picking the exact same filename for multiple events when another relevant image is available. "
        "If ALL image candidates depict the wrong subject or are misleadingly anachronistic, return \"NONE\". "
        "If `image_candidates` is empty, return null.\n"
        "Respond ONLY with compact valid JSON matching: "
        "{\"decisions\": [{\"event_index\": 0, \"article_id\": \"A0\", \"image_id\": \"I0\"}]}"
    )

    prompt_text = json.dumps(payload, ensure_ascii=False)
    try:
        from services.gemini_service import aget_gemini_client, _generate_with_retry
    except Exception:
        return None
    try:
        client = await aget_gemini_client(api_key)
    except Exception:
        return None

    for model_name in models_to_try:
        try:
            resp = await asyncio.wait_for(
                _generate_with_retry(
                    client,
                    max_retries=0,
                    model=model_name,
                    contents=prompt_text,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        temperature=0.0,
                        max_output_tokens=2048,
                        thinking_config=(
                            None if "lite" in model_name.lower() else types.ThinkingConfig(thinking_budget=0)
                        ),
                    ),
                ),
                timeout=budget_sec,
            )
            raw_text = ""
            if getattr(resp, "candidates", None):
                parts = getattr(resp.candidates[0].content, "parts", None) or []
                raw_text = "".join(
                    (getattr(p, "text", "") or "")
                    for p in parts
                    if not getattr(p, "thought", False)
                ).strip()
            if not raw_text:
                raw_text = (getattr(resp, "text", None) or "").strip()
            if not raw_text:
                continue
            if raw_text.startswith("```"):
                raw_text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_text, flags=re.DOTALL).strip()
            parsed = json.loads(raw_text)
            if isinstance(parsed, dict) and isinstance(parsed.get("decisions"), list):
                usage = getattr(resp, "usage_metadata", None)
                p_tok = (
                    int(getattr(usage, "prompt_token_count", 0) or 0)
                    + int(getattr(usage, "tool_use_prompt_token_count", 0) or 0)
                ) if usage else 0
                cached_raw = int(getattr(usage, "cached_content_token_count", 0) or 0) if usage else 0
                cached_tok = min(p_tok, max(0, cached_raw))
                c_tok = int(getattr(usage, "candidates_token_count", 0) or 0) if usage else 0
                t_tok = int(getattr(usage, "thoughts_token_count", 0) or 0) if usage else 0
                tot_tok = max(int(getattr(usage, "total_token_count", 0) or 0), p_tok + c_tok + t_tok) if usage else 0
                is_pro = "pro" in (model_name or "").lower()
                in_rate = 1.25 if is_pro else 0.10
                out_rate = 5.00 if is_pro else 0.40
                uncached_tok = p_tok - cached_tok
                in_cost = round(
                    (uncached_tok / 1_000_000.0) * in_rate
                    + (cached_tok / 1_000_000.0) * (in_rate * 0.25),
                    6,
                )
                out_cost = round(((c_tok + t_tok) / 1_000_000.0) * out_rate, 6)
                tot_cost = round(in_cost + out_cost, 6)
                logger.info(
                    "\n".join([
                        "",
                        "=" * 78,
                        f"[TOKEN USAGE & COST BREAKDOWN] Wikipedia LLM Adjudicator ({len(parsed.get('decisions', []))} events)",
                        f"Model:                      {model_name}",
                        f"Tokens (In / Think / Out):  {p_tok:,d} input | {t_tok:,d} thinking | {c_tok:,d} output | {tot_tok:,d} total",
                        f"Input Cost (Prompt):        ${in_cost:.6f} USD (~{in_cost * 100:.4f} cents)",
                        f"Output Cost (Out+Thinking): ${out_cost:.6f} USD (~{out_cost * 100:.4f} cents)",
                        f"TOTAL ESTIMATED COST:       ${tot_cost:.6f} USD (~{tot_cost * 100:.3f} cents)",
                        "=" * 78,
                    ])
                )
                parsed["_token_usage"] = {
                    "model": model_name,
                    "prompt_tokens": p_tok,
                    "cached_tokens": cached_tok,
                    "candidates_tokens": c_tok,
                    "thoughts_tokens": t_tok,
                    "total_tokens": tot_tok,
                    "estimated_cost_usd": tot_cost,
                }
                return parsed
        except Exception as e:
            logger.warning(f"Batch LLM enrichment adjudicator attempt on {model_name} failed: {e!r}")
            continue

    return None


def _image_text_tokens(cand: Dict[str, Any]) -> set:
    return _content_tokens(re.sub(r"[_\-.]", " ", f"{cand.get('filename') or ''} {cand.get('caption') or ''}"))


def _has_specific_image_challenger(
    viable: List[Dict[str, Any]], event_title: str, anchors: List[str], year: Optional[int]
) -> bool:
    """True when a lower-ranked image names something specific to this event (a model, edition or
    year that is not part of the article title) that the top-ranked image does not: the generic
    lead photo may then be the wrong period, e.g. a modern car for a 1974 launch."""
    specific = _content_tokens(event_title) - _content_tokens(" ".join(anchors))
    if isinstance(year, int) and 1000 <= abs(year) <= 9999:
        specific.add(str(abs(year)))
    if not specific:
        return False
    top_hits = _image_text_tokens(viable[0]) & specific
    return any((_image_text_tokens(c) & specific) - top_hits for c in viable[1:])


def _adjudicator_image_gap() -> int:
    raw = os.getenv("ADJUDICATOR_IMAGE_SCORE_GAP", "").strip()
    try:
        return max(0, int(raw)) if raw else 25
    except ValueError:
        return 25


async def _llm_adjudicate_enrichment(
    events_data: list,
    results: List[Dict[str, Any]],
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    lang: str = "en",
    timeline_topic: str = "",
    api_key: Optional[str] = None,
    preferred_model: Optional[str] = None,
    usage_sink: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Inspect all events after parallel Wikipedia/Commons candidate collection.
    For any event with ambiguous article resolution (disambiguation, search, zero non-title
    context overlap, or unresolved with search candidates) or competing image candidates,
    run a single fast batch LLM adjudication call and update `results` in-place.
    """
    effective_key = _resolve_adjudicator_api_key(api_key)
    if not effective_key:
        return

    batch_events = []
    event_art_maps: Dict[int, Dict[str, Dict[str, Any]]] = {}
    event_img_maps: Dict[int, Dict[str, Dict[str, Any]]] = {}

    for i, (ev, r) in enumerate(zip(events_data, results)):
        if not isinstance(ev, dict) or not isinstance(r, dict):
            continue
        res = r.get("res") if isinstance(r.get("res"), dict) else {}
        raw_art_cands = list(r.get("article_candidates") or [])

        # Guarantee the currently resolved article (if any) is A0 in the candidate list
        ordered_art_cands: List[Dict[str, Any]] = []
        if res and res.get("wikiTitle"):
            _record_article_candidate(ordered_art_cands, res)
        for ac in raw_art_cands:
            _record_article_candidate(ordered_art_cands, ac)

        zero_ctx_overlap = False
        if res and res.get("wikiTitle"):
            title_ref = (
                f"{ev.get('wikipedia_title') or ''} "
                f"{ev.get('wikipedia_title_en') or ''} "
                f"{res.get('wikiTitle') or ''}"
            )
            t_tokens = _content_tokens(title_ref)
            ev_ctx_raw = (
                f"{timeline_topic} {ev.get('title') or ''} "
                f"{ev.get('subtitle') or ''} {ev.get('category') or ''}"
            )
            non_t_ctx = " ".join(
                t for t in re.findall(r'\w{3,}', ev_ctx_raw.lower())
                if t not in _STOPWORDS and not any(are_tokens_related(t, tt) for tt in t_tokens)
            )
            art_body = f"{res.get('description') or ''} {res.get('extract') or ''}"
            if non_t_ctx and generic_token_overlap(non_t_ctx, art_body) == 0:
                zero_ctx_overlap = True

        # Only real ambiguity reaches the model (P-03): no article yet, a disambiguation/search
        # pick, a direct match whose article shares nothing with the event, other distinct
        # candidates (the article's own other-language counterpart doesn't count) on a non-direct
        # match, or close / animated image candidates.
        resolution_mode = res.get("_resolution_mode") if res else None
        own_titles = {
            (res.get("wikiTitle") or "").strip().lower(),
            (res.get("fallbackWikiTitle") or "").strip().lower(),
        } - {""} if res else set()
        has_alternatives = any(
            (ac.get("wikiTitle") or "").strip().lower() not in own_titles for ac in ordered_art_cands
        )
        needs_article_check = bool(ordered_art_cands) and (
            not (res and res.get("wikiTitle"))
            or resolution_mode in ("disambig", "search")
            or zero_ctx_overlap
            or (has_alternatives and resolution_mode not in ("direct", "bridge"))
        )

        ranked_imgs = _rank_image_candidates(
            r.get("candidates") or [],
            r.get("image_context") or "",
            r.get("anchors") or [],
        )
        viable_imgs = [c for c in ranked_imgs if c["score"] >= MIN_IMAGE_CONFIDENCE][:5]
        needs_image_check = len(viable_imgs) >= 2 and (
            any(c.get("is_animated") for c in viable_imgs)
            or (viable_imgs[0]["score"] - viable_imgs[1]["score"] <= _adjudicator_image_gap())
            or _has_specific_image_challenger(
                viable_imgs, ev.get("title") or "", r.get("anchors") or [], r.get("event_year")
            )
        )

        if not needs_article_check and not needs_image_check:
            continue

        art_map: Dict[str, Dict[str, Any]] = {}
        art_payload = []
        for a_idx, ac in enumerate(ordered_art_cands[:5]):
            aid = f"A{a_idx}"
            art_map[aid] = ac
            art_payload.append({
                "id": aid,
                "lang": ac.get("lang", lang),
                "title": ac.get("wikiTitle", ""),
                "description": (ac.get("description") or "")[:140],
                "extract": (ac.get("extract") or "")[:280],
            })
        event_art_maps[i] = art_map

        img_map: Dict[str, Dict[str, Any]] = {}
        img_payload = []
        for m_idx, ic in enumerate(viable_imgs[:5]):
            iid = f"I{m_idx}"
            img_map[iid] = ic
            img_payload.append({
                "id": iid,
                "filename": ic.get("filename") or _filename_from_url(ic.get("url") or ""),
                "caption": (ic.get("caption") or "")[:160],
                "is_animated": bool(ic.get("is_animated")),
                "is_lead": bool(ic.get("isLead")),
                "source": ic.get("source", "article"),
            })
        event_img_maps[i] = img_map

        batch_events.append({
            "event_index": i,
            "year": r.get("event_year"),
            "title": (ev.get("title") or "")[:140],
            "subtitle": (ev.get("subtitle") or "")[:260],
            "requested_wiki_title": (ev.get("wikipedia_title") or "")[:100],
            "requested_wiki_title_en": (ev.get("wikipedia_title_en") or "")[:100],
            "article_candidates": art_payload,
            "image_candidates": img_payload,
        })

    if not batch_events:
        return

    t0 = time.time()
    payload = {
        "timeline_topic": timeline_topic,
        "timeline_language": lang,
        "events": batch_events,
    }
    adjudicated = await _call_gemini_adjudicator_json(
        payload,
        api_key=effective_key,
        preferred_model=preferred_model,
    )
    if not adjudicated or not isinstance(adjudicated.get("decisions"), list):
        return

    adj_usage = adjudicated.get("_token_usage")
    if isinstance(adj_usage, dict):
        if usage_sink is not None:
            usage_sink.update(adj_usage)
        else:
            try:
                from services.activity_log import record_token_usage
                record_token_usage(
                    {
                        "operation": "Wikipedia LLM Adjudicator",
                        "model": adj_usage.get("model"),
                        "promptTokens": adj_usage.get("prompt_tokens", 0),
                        "cachedTokens": adj_usage.get("cached_tokens", 0),
                        "candidatesTokens": adj_usage.get("candidates_tokens", 0),
                        "thoughtsTokens": adj_usage.get("thoughts_tokens", 0),
                        "totalTokens": adj_usage.get("total_tokens", 0),
                        "estimatedCostUsd": adj_usage.get("estimated_cost_usd", 0.0),
                    },
                    is_auxiliary=True,
                )
            except Exception:
                pass

    switched_indices: List[int] = []
    # Pass 1: read every decision. Switching to an English article on a non-English timeline needs
    # a langlink + summary lookup; those run concurrently in pass 2 instead of one event at a time.
    pending_switches: List[tuple] = []  # (idx, chosen_art)
    for dec in adjudicated["decisions"]:
        if not isinstance(dec, dict):
            continue
        idx = dec.get("event_index")
        if not isinstance(idx, int) or idx < 0 or idx >= len(results):
            continue

        r = results[idx]
        ev = events_data[idx]
        cur_res = r.get("res") if isinstance(r.get("res"), dict) else {}
        art_map = event_art_maps.get(idx) or {}
        img_map = event_img_maps.get(idx) or {}

        article_id = dec.get("article_id")
        article_switched = False

        if article_id == "NONE" and art_map:
            logger.info(
                "LLM adjudicator suppressed false Wikipedia match '%s' for event '%s'",
                cur_res.get("wikiTitle"), ev.get("title"),
            )
            r["res"] = {}
            r["candidates"] = []
            r["_suppress_lead_fallback"] = True
            continue

        if isinstance(article_id, str) and article_id in art_map:
            chosen_art = dict(art_map[article_id])
            same_bilingual_pair = bool(
                cur_res
                and cur_res.get("wikiTitle")
                and cur_res.get("fallbackWikiTitle")
                and chosen_art.get("lang") == "en"
                and cur_res.get("fallbackWikiTitle", "").strip().lower() == chosen_art.get("wikiTitle", "").strip().lower()
            )
            if not same_bilingual_pair and (
                not cur_res
                or not cur_res.get("wikiTitle")
                or chosen_art.get("wikiTitle") != cur_res.get("wikiTitle")
                or chosen_art.get("lang") != cur_res.get("lang")
            ):
                pending_switches.append((idx, chosen_art))
                article_switched = True

        if not article_switched:
            image_id = dec.get("image_id")
            if image_id == "NONE" and img_map:
                r["candidates"] = []
                r["_suppress_lead_fallback"] = True
            elif isinstance(image_id, str) and image_id in img_map:
                r["llm_preferred_image_key"] = _image_key(img_map[image_id]["key"])

    async def _localize(idx: int, chosen_art: Dict[str, Any]) -> Dict[str, Any]:
        """If the timeline is non-English and the LLM selected an English candidate, prefer its
        canonical local-language article."""
        if not (lang != "en" and chosen_art.get("lang") == "en" and _is_real_http_client(client)):
            return chosen_art
        local_title = await _get_langlink(
            chosen_art["wikiTitle"], from_lang="en", to_lang=lang, client=client
        )
        if not local_title:
            return chosen_art
        local_res = await _get_summary_direct(
            local_title, client, lang=lang, resolve_disambig=False, year=results[idx].get("event_year")
        )
        if not (local_res and local_res.get("wikiTitle")):
            return chosen_art
        if not local_res.get("imageUrl") and chosen_art.get("imageUrl"):
            local_res["imageUrl"] = chosen_art["imageUrl"]
        elif chosen_art.get("imageUrl"):
            local_res["fallbackImageUrl"] = chosen_art["imageUrl"]
        if local_res.get("lat") is None and chosen_art.get("lat") is not None:
            local_res["lat"] = chosen_art["lat"]
            local_res["lng"] = chosen_art.get("lng")
        local_res["fallbackWikiTitle"] = chosen_art["wikiTitle"]
        return local_res

    if pending_switches:
        localized = await asyncio.gather(
            *(_localize(idx, art) for idx, art in pending_switches), return_exceptions=True
        )
        for (idx, chosen_art), final_art in zip(pending_switches, localized):
            if not isinstance(final_art, dict):
                final_art = chosen_art
            cur_res = results[idx].get("res") if isinstance(results[idx].get("res"), dict) else {}
            logger.info(
                "LLM adjudicator selected Wikipedia article '%s' (was '%s') for event '%s'",
                final_art.get("wikiTitle"), cur_res.get("wikiTitle"), events_data[idx].get("title"),
            )
            results[idx]["res"] = final_art
            switched_indices.append(idx)

    if switched_indices:
        async def _refresh_images_for_switched(idx: int):
            r = results[idx]
            ev = events_data[idx]
            res = r.get("res") or {}
            if not res.get("wikiTitle"):
                r["candidates"] = []
                return
            wiki_key = (ev.get("wikipedia_title") or "").strip()
            wiki_key_en = (ev.get("wikipedia_title_en") or "").strip()
            regular_title = (ev.get("title") or "").strip()
            fb_title = res.get("fallbackWikiTitle") or wiki_key_en or (regular_title if lang != "en" else None)
            cands = await fetch_image_candidates(
                res["wikiTitle"],
                client,
                semaphore,
                lang=res.get("lang", lang),
                lead_url=res.get("imageUrl"),
                fallback_title=fb_title,
            )
            r["candidates"] = cands
            anchor_parts = [wiki_key, wiki_key_en, res.get("wikiTitle") or "", res.get("fallbackWikiTitle") or ""]
            anchors = list(dict.fromkeys(p for p in anchor_parts if p)) or ([regular_title] if regular_title else [])
            r["anchors"] = anchors
            image_parts = [regular_title, *anchors]
            if r.get("event_year") is not None:
                image_parts.append(str(r["event_year"]))
            r["image_context"] = " ".join(dict.fromkeys(p for p in image_parts if p)).strip()

        await asyncio.gather(*[_refresh_images_for_switched(idx) for idx in switched_indices], return_exceptions=True)

    logger.info(
        "Batch LLM enrichment adjudication completed in %.2fs (%d/%d events checked, %d articles updated)",
        time.time() - t0, len(batch_events), len(events_data), len(switched_indices),
    )


_SCIENCE_GIF_HINTS = (
    "science", "scientific", "physics", "chemistry", "chemical", "biology", "astronomy", "astrophysics",
    "geology", "tectonic", "evolution", "quantum", "wave", "orbit", "planet", "solar", "galaxy", "cosmic",
    "mathemat", "geometry", "equation", "theorem", "molecule", "atom", "cell", "dna", "genetic", "climate",
    "weather", "volcan", "earthquake", "continental", "engine", "mechanic", "relativity", "electromagnet",
    "optics", "telescope", "spacecraft", "rocket", "space exploration", "anatomy", "physiology",
)
# Word-start matches only ("cell" must not match "excellent"); a hint may be a word prefix ("mathemat").
_SCIENCE_GIF_HINTS_RE = re.compile(r"\b(?:" + "|".join(re.escape(h) for h in _SCIENCE_GIF_HINTS) + ")")


def _gif_search_mode_for_event(event: Dict[str, Any], timeline_topic: str, content_mode: Optional[str]) -> str:
    """GIFs only win on science and kids timelines, or where an article has few photos (P-03)."""
    configured = (os.getenv("WIKI_GIF_SEARCH") or "auto").strip().lower()
    if configured in (GIF_SEARCH_ALWAYS, GIF_SEARCH_OFF):
        return configured
    if (content_mode or "").strip().lower() == "kids":
        return GIF_SEARCH_ALWAYS
    text = " ".join(
        str(event.get(k) or "") for k in ("category", "lane", "title", "wikipedia_title_en")
    )
    text = f"{timeline_topic} {text}".lower()
    if _SCIENCE_GIF_HINTS_RE.search(text):
        return GIF_SEARCH_ALWAYS
    return GIF_SEARCH_AUTO


def _commons_fallback_top_n() -> int:
    """Only this many top-ranked events may use the (unbatched) Commons search fallback (SC-04)."""
    raw = os.getenv("WIKI_COMMONS_FALLBACK_TOP_N", "").strip()
    try:
        return max(0, int(raw)) if raw else 15
    except ValueError:
        return 15


async def enrich_events_with_wikipedia(
    events_data: list,
    lang: str = "en",
    timeline_topic: str = "",
    is_timeline_fictional: bool = False,
    api_key: Optional[str] = None,
    preferred_model: Optional[str] = None,
    usage_sink: Optional[Dict[str, Any]] = None,
    content_mode: Optional[str] = None,
) -> list:
    """
    Given a list of event dictionaries, asynchronously fetch Wikipedia data with precision-first guarantees.
    Supports any language edition with automatic fallback to English Wikipedia.
    Images are gathered as ranked multi-source candidates and assigned in a second pass with
    timeline-wide de-duplication so the same picture never repeats and weak images are suppressed.
    """
    call_scope = _EnrichmentErrorScope()
    scope_token = _ENRICHMENT_ERROR_SCOPE.set(call_scope)
    try:
        return await _enrich_events_with_wikipedia(
            events_data,
            lang=lang,
            timeline_topic=timeline_topic,
            is_timeline_fictional=is_timeline_fictional,
            api_key=api_key,
            preferred_model=preferred_model,
            usage_sink=usage_sink,
            content_mode=content_mode,
            call_scope=call_scope,
        )
    finally:
        _ENRICHMENT_ERROR_SCOPE.reset(scope_token)


async def _enrich_events_with_wikipedia(
    events_data: list,
    *,
    lang: str,
    timeline_topic: str,
    is_timeline_fictional: bool,
    api_key: Optional[str],
    preferred_model: Optional[str],
    usage_sink: Optional[Dict[str, Any]],
    content_mode: Optional[str],
    call_scope: _EnrichmentErrorScope,
) -> list:
    try:
        per_timeline_concurrency = max(1, min(30, int(os.getenv("WIKIMEDIA_TIMELINE_CONCURRENCY", "10"))))
    except ValueError:
        per_timeline_concurrency = 10
    semaphore = asyncio.Semaphore(per_timeline_concurrency)
    lang = normalize_wiki_lang(lang)
    timeline_en_context = ""
    if lang != "en":
        en_titles = list(dict.fromkeys(
            (ev.get("wikipedia_title_en") or "").strip()
            for ev in events_data
            if isinstance(ev, dict) and (ev.get("wikipedia_title_en") or "").strip()
        ))[:12]
        timeline_en_context = " ".join(en_titles)

    # Per-event scopes: the repair pass re-fetches only events whose own requests failed (P-13).
    event_scopes = [_EnrichmentErrorScope(parent=call_scope) for _ in events_data]
    top_n = _commons_fallback_top_n()
    ranked_order = sorted(
        range(len(events_data)),
        key=lambda i: -((events_data[i].get("rank") if isinstance(events_data[i], dict) else None) or 5),
    )
    commons_allowed = set(ranked_order[:top_n])
    gif_modes = [
        _gif_search_mode_for_event(ev, timeline_topic, content_mode) if isinstance(ev, dict) else GIF_SEARCH_OFF
        for ev in events_data
    ]

    def _in_event_scope(idx: int, coro):
        async def _run():
            _ENRICHMENT_ERROR_SCOPE.set(event_scopes[idx])
            return await coro
        return _run()

    async with _http_client_scope() as client:
        use_candidate_sink = (
            fetch_wikipedia_summary is _DEFAULT_FETCH_WIKIPEDIA_SUMMARY
            and _is_real_http_client(client)
        )
        can_batch_images = (
            fetch_image_candidates is _DEFAULT_FETCH_IMAGE_CANDIDATES
            and _is_real_http_client(client)
        )

        async def resolve_article_for_event(event: dict, existing_res: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
            if not isinstance(event, dict):
                return {
                    "res": {},
                    "article_candidates": [],
                    "wiki_key": "",
                    "wiki_key_en": "",
                    "regular_title": "",
                    "event_year": None,
                }
            wiki_key = (event.get("wikipedia_title") or "").strip()
            wiki_key_en = (event.get("wikipedia_title_en") or "").strip()
            regular_title = (event.get("title") or "").strip()
            subtitle = (event.get("subtitle") or "").strip()
            lane = (event.get("lane") or "").strip()
            yt_query_en = (event.get("youtube_query_en") or "").strip()

            # On non-English timelines, if wikipedia_title_en is missing, extract any concise
            # parenthetical English entity from the title (e.g. "חוק המפעלים הבריטי (Factory Act 1833)")
            if lang != "en" and not wiki_key_en:
                for src_text in (regular_title, wiki_key):
                    m = re.search(r'\(([A-Za-z][A-Za-z0-9\s\-\'’.,&:]{2,60})\)', src_text or "")
                    if m:
                        cand_en = m.group(1).strip()
                        if is_likely_searchable_entity(cand_en):
                            wiki_key_en = cand_en
                            break

            from_dict = event.get("from")
            event_year = None
            if isinstance(from_dict, dict) and "year" in from_dict:
                event_year = from_dict.get("year")
            elif isinstance(event.get("from_year"), int):
                event_year = event.get("from_year")

            category = (event.get("category") or "").strip()
            context_parts = [timeline_topic, regular_title, category, subtitle, lane, wiki_key_en, yt_query_en, timeline_en_context]
            if event_year is not None:
                context_parts.append(str(event_year))
            context_text = " ".join([p for p in context_parts if p]).strip()

            article_candidates: List[Dict[str, Any]] = []
            sink_kw = {"candidate_sink": article_candidates} if use_candidate_sink else {}

            res = existing_res if (isinstance(existing_res, dict) and existing_res.get("wikiTitle")) else {}
            if not res:
                # 1. Try with canonical local wikipedia_title
                if wiki_key:
                    res = await fetch_wikipedia_summary(
                        wiki_key,
                        client,
                        semaphore,
                        lang=lang,
                        context_text=context_text,
                        year=event_year,
                        fallback_lang="en",
                        fallback_title=wiki_key_en or (regular_title if lang == "en" else None),
                        **sink_kw,
                    )

                # 2. If not found or not provided, try regular title ONLY if it represents a concise searchable entity
                if not res and regular_title and regular_title != wiki_key and is_likely_searchable_entity(regular_title):
                    res = await fetch_wikipedia_summary(
                        regular_title,
                        client,
                        semaphore,
                        lang=lang,
                        context_text=context_text,
                        year=event_year,
                        fallback_lang="en",
                        fallback_title=wiki_key_en,
                        **sink_kw,
                    )

                # 3. If still not found and we have an English fallback key, query English directly
                if not res and wiki_key_en and lang != "en":
                    res = await fetch_wikipedia_summary(
                        wiki_key_en,
                        client,
                        semaphore,
                        lang="en",
                        context_text=context_text,
                        year=event_year,
                        **sink_kw,
                    )

            return {
                "res": res,
                "article_candidates": article_candidates,
                "wiki_key": wiki_key,
                "wiki_key_en": wiki_key_en,
                "regular_title": regular_title,
                "event_year": event_year,
            }

        async def resolve_images_for_event(ctx: Dict[str, Any], idx: Optional[int] = None) -> Dict[str, Any]:
            res = ctx.get("res") or {}
            gif_mode = gif_modes[idx] if idx is not None else GIF_SEARCH_ALWAYS
            commons_ok = idx is None or idx in commons_allowed
            article_candidates = ctx.get("article_candidates") or []
            wiki_key = ctx.get("wiki_key") or ""
            wiki_key_en = ctx.get("wiki_key_en") or ""
            regular_title = ctx.get("regular_title") or ""
            event_year = ctx.get("event_year")

            # Gather ranked image candidates for the resolved article (multi-source).
            candidates: List[Dict[str, Any]] = []
            if isinstance(res, dict) and res.get("wikiTitle"):
                fb_title = res.get("fallbackWikiTitle") or wiki_key_en or (regular_title if lang != "en" else None)
                gate_kw = (
                    {"gif_search": gif_mode, "allow_commons_fallback": commons_ok}
                    if fetch_image_candidates is _DEFAULT_FETCH_IMAGE_CANDIDATES else {}
                )
                candidates = await fetch_image_candidates(
                    res["wikiTitle"],
                    client,
                    semaphore,
                    lang=res.get("lang", lang),
                    lead_url=res.get("imageUrl"),
                    fallback_title=fb_title,
                    **gate_kw,
                )
                # Supplement from English counterpart when non-English article has few static article photos
                en_img_title = res.get("fallbackWikiTitle") or wiki_key_en
                article_photo_count = sum(
                    1 for c in candidates
                    if c.get("source") == "article"
                    and not c.get("is_animated")
                    and not (c.get("key") or "").endswith((".svg", ".gif"))
                )
                if article_photo_count < 4 and en_img_title and res.get("lang", lang) != "en":
                    fb_cands = await fetch_image_candidates(
                        en_img_title,
                        client,
                        semaphore,
                        lang="en",
                        lead_url=res.get("fallbackImageUrl") or res.get("imageUrl"),
                        **gate_kw,
                    )
                    seen_keys = {c.get("key") for c in candidates}
                    for fc in fb_cands:
                        if fc.get("key") not in seen_keys:
                            seen_keys.add(fc.get("key"))
                            candidates.append(fc)

            # Subject anchors are canonical titles only: the AI's narrative event title contains
            # generic words ('wave', 'equation') that let unrelated animations match.
            anchor_parts = [wiki_key, wiki_key_en]
            if isinstance(res, dict):
                anchor_parts.extend([res.get("wikiTitle") or "", res.get("fallbackWikiTitle") or ""])
            anchors = list(dict.fromkeys(p for p in anchor_parts if p)) or ([regular_title] if regular_title else [])

            # Image ranking context is event-specific: timeline topic/lane/category words are shared by
            # every event, so they only reward generic on-theme images over the article's own photo.
            image_parts = [regular_title, *anchors]
            if event_year is not None:
                image_parts.append(str(event_year))
            image_context = " ".join(dict.fromkeys(p for p in image_parts if p)).strip()
            return {
                "res": res,
                "article_candidates": article_candidates,
                "candidates": candidates,
                "image_context": image_context,
                "anchors": anchors,
                "event_year": event_year,
            }

        async def fetch_for_event(event: dict, existing_res: Optional[Dict[str, Any]] = None, idx: Optional[int] = None):
            ctx = await resolve_article_for_event(event, existing_res=existing_res)
            return await resolve_images_for_event(ctx, idx)

        # Stage 1: Multi-title batch pre-warm summaries + langlinks, then resolve articles per event
        if use_candidate_sink:
            await _batch_prewarm_timeline_summaries(events_data, client, lang=lang)
        stage1_raw = await asyncio.gather(
            *(_in_event_scope(i, resolve_article_for_event(ev)) for i, ev in enumerate(events_data)),
            return_exceptions=True,
        )
        failed_events = {i for i, s in enumerate(stage1_raw) if not isinstance(s, dict)}
        stage1_ctx = [
            s if isinstance(s, dict) else {
                "res": {},
                "article_candidates": [],
                "wiki_key": "",
                "wiki_key_en": "",
                "regular_title": "",
                "event_year": None,
            }
            for s in stage1_raw
        ]

        # Stage 2: Multi-title batch pre-warm article images + file imageinfo, then gather candidates per event
        if can_batch_images:
            await _batch_prewarm_timeline_images(stage1_ctx, client, lang=lang)
        raw_results = await asyncio.gather(
            *(_in_event_scope(i, resolve_images_for_event(ctx, i)) for i, ctx in enumerate(stage1_ctx)),
            return_exceptions=True,
        )
        failed_events |= {i for i, r in enumerate(raw_results) if not isinstance(r, dict)}

        # Normalize (exceptions -> empty result)
        results = [
            r if isinstance(r, dict) else {
                "res": {},
                "article_candidates": [],
                "candidates": [],
                "image_context": "",
                "anchors": [],
                "event_year": None,
            }
            for r in raw_results
        ]

        # --- Automatic repair pass for events whose own Wikimedia requests failed ---
        # Errors are counted per enrichment call and per event (P-13): another user's 429s never
        # trigger this, and only incomplete events (missing article link or sparse/missing image
        # candidates) that actually saw an error or crashed are re-run, in the background lane.
        # Results merge monotonically so already-resolved links and images can never regress.
        errored_events = failed_events | {i for i, sc in enumerate(event_scopes) if sc.count > 0}
        if errored_events:
            repair_indices = [
                i for i, r in enumerate(results)
                if i in errored_events
                and isinstance(events_data[i], dict)
                and (not (r.get("res") or {}).get("wikiTitle") or len(r.get("candidates") or []) <= 1)
            ]
            if repair_indices:
                logger.info(
                    "Wikipedia enrichment repair pass triggered for %d/%d incomplete events "
                    "(transient_errors=%d, task_exceptions=%d)",
                    len(repair_indices), len(events_data), call_scope.count, len(failed_events),
                )
                await asyncio.sleep(0.25)
                with wikimedia_lane(WIKIMEDIA_LANE_BACKGROUND):
                    repair_tasks = [
                        fetch_for_event(
                            events_data[i],
                            existing_res=(results[i].get("res") if (results[i].get("res") or {}).get("wikiTitle") else None),
                            idx=i,
                        )
                        for i in repair_indices
                    ]
                    repair_raw = await asyncio.gather(*repair_tasks, return_exceptions=True)
                for idx, rep in zip(repair_indices, repair_raw):
                    if not isinstance(rep, dict):
                        continue
                    cur = results[idx]
                    rep_res = rep.get("res")
                    if isinstance(rep_res, dict) and rep_res.get("wikiTitle") and not (cur.get("res") or {}).get("wikiTitle"):
                        cur["res"] = rep_res
                        cur["anchors"] = rep.get("anchors") or cur.get("anchors") or []
                        cur["image_context"] = rep.get("image_context") or cur.get("image_context") or ""
                        cur["event_year"] = rep.get("event_year") if rep.get("event_year") is not None else cur.get("event_year")
                    for ac in rep.get("article_candidates") or []:
                        _record_article_candidate(cur.setdefault("article_candidates", []), ac)
                    rep_cands = rep.get("candidates") or []
                    if rep_cands:
                        existing_cands = cur.get("candidates") or []
                        seen_cand_keys = {c.get("key") for c in existing_cands if isinstance(c, dict)}
                        merged_cands = list(existing_cands)
                        for rc in rep_cands:
                            if isinstance(rc, dict) and rc.get("key") not in seen_cand_keys:
                                seen_cand_keys.add(rc.get("key"))
                                merged_cands.append(rc)
                        cur["candidates"] = merged_cands

        # --- Hybrid Batch Semantic LLM Adjudicator for ambiguous Wikipedia/image candidates ---
        if use_candidate_sink:
            try:
                await _llm_adjudicate_enrichment(
                    events_data=events_data,
                    results=results,
                    client=client,
                    semaphore=semaphore,
                    lang=lang,
                    timeline_topic=timeline_topic,
                    api_key=api_key,
                    preferred_model=preferred_model,
                    usage_sink=usage_sink,
                )
            except Exception as adj_err:
                logger.info(f"Batch LLM enrichment adjudicator skipped due to error: {adj_err}")

        stats = {"resolved": 0, "assigned": 0, "deduped": 0, "suppressed": 0}

        # --- Metadata writeback (links, extract, coordinates) ---
        for i, r in enumerate(results):
            res = r.get("res")
            if isinstance(res, dict) and res:
                stats["resolved"] += 1
                if not events_data[i].get("wikiUrl") and res.get("wikiUrl"):
                    events_data[i]["wikiUrl"] = res["wikiUrl"]
                if not events_data[i].get("wikiExtract") and res.get("extract"):
                    events_data[i]["wikiExtract"] = res["extract"]
                    events_data[i]["extract"] = res["extract"]
                elif not events_data[i].get("extract") and res.get("extract"):
                    events_data[i]["extract"] = res["extract"]
                if not events_data[i].get("wikiTitle") and res.get("wikiTitle"):
                    events_data[i]["wikiTitle"] = res["wikiTitle"]
                wiki_title_en = (
                    (res.get("fallbackWikiTitle") or "").strip()
                    or ((res.get("wikiTitle") or "").strip() if res.get("lang") == "en" else "")
                    or (events_data[i].get("wikipedia_title_en") or "").strip()
                )
                if wiki_title_en and not events_data[i].get("wikiTitleEn"):
                    events_data[i]["wikiTitleEn"] = wiki_title_en

                event_is_fictional = (
                    is_timeline_fictional
                    or bool(events_data[i].get("is_fictional"))
                )
                if event_is_fictional:
                    events_data[i]["lat"] = None
                    events_data[i]["lng"] = None
                    events_data[i]["is_fictional"] = True
                else:
                    if (events_data[i].get("lat") is None or events_data[i].get("lng") is None) and res.get("lat") is not None and res.get("lng") is not None:
                        events_data[i]["lat"] = res["lat"]
                        events_data[i]["lng"] = res["lng"]

        # --- Image assignment with timeline-wide de-duplication ---
        # Higher-ranked events get first pick of the best image; already-used images
        # are skipped so the same picture never repeats across the timeline.
        used_image_keys = set()
        for ev in events_data:
            if ev.get("imageUrl"):
                used_image_keys.add(_image_key(_filename_from_url(ev["imageUrl"]) or ev["imageUrl"]))

        order = sorted(range(len(events_data)), key=lambda i: -(events_data[i].get("rank") or 5))
        for i in order:
            ev = events_data[i]
            if ev.get("imageUrl"):
                continue  # respect a pre-existing/manual image
            ranked = _rank_image_candidates(
                results[i].get("candidates") or [],
                results[i].get("image_context") or "",
                results[i].get("anchors") or [],
            )
            pref_key = results[i].get("llm_preferred_image_key")
            if pref_key:
                ranked.sort(key=lambda c: (0 if _image_key(c["key"]) == pref_key else 1, -c["score"]))
            chosen = None
            had_candidate = False
            for c in ranked:
                if c["score"] < MIN_IMAGE_CONFIDENCE:
                    continue
                had_candidate = True
                if _image_key(c["key"]) not in used_image_keys:
                    chosen = c
                    break
            if chosen:
                ev["imageUrl"] = chosen["url"]
                if chosen.get("is_animated"):
                    ev["mediaType"] = "gif"
                used_image_keys.add(_image_key(chosen["key"]))
                stats["assigned"] += 1
            elif had_candidate:
                stats["deduped"] += 1  # all acceptable candidates already used elsewhere
            else:
                stats["suppressed"] += 1  # prefer no image over an unrelated one

        # Second pass: if an event could not claim a candidate during the first pass, fall back to
        # its article's lead image ONLY if it passes score_image quality filtering and has not
        # already been used on another event (preventing rejected junk icons or duplicate portraits).
        for i in order:
            ev = events_data[i]
            if not ev.get("imageUrl") and not results[i].get("_suppress_lead_fallback"):
                res = results[i].get("res")
                if isinstance(res, dict):
                    for fallback_url in (res.get("imageUrl"), res.get("fallbackImageUrl")):
                        if not fallback_url:
                            continue
                        fn = _filename_from_url(fallback_url) or fallback_url
                        lead_key = _image_key(fn)
                        if not lead_key or lead_key in used_image_keys:
                            continue
                        lead_cand = {
                            "url": fallback_url,
                            "filename": fn,
                            "caption": "",
                            "width": 400,
                            "mime": "",
                            "isLead": True,
                            "source": "article",
                            "key": lead_key,
                        }
                        lead_score = score_image(
                            lead_cand,
                            results[i].get("image_context") or "",
                            results[i].get("anchors") or [],
                        )
                        if lead_score is not None and lead_score >= MIN_IMAGE_CONFIDENCE:
                            ev["imageUrl"] = fallback_url
                            used_image_keys.add(lead_key)
                            stats["assigned"] += 1
                            break

        # Determine mediaType and guarantee animated GIF URLs are unscaled original files
        for ev in events_data:
            raw_img = (ev.get("imageUrl") or "")
            low_img = raw_img.lower()
            if ev.get("mediaType") == "gif":
                # Strip Wikimedia /thumb/ prefix from GIFs to ensure multi-frame animation is delivered
                if "/thumb/" in raw_img and ("wikimedia.org" in raw_img or "wikipedia.org" in raw_img):
                    ev["imageUrl"] = re.sub(
                        r"/thumb/([^/]+/[^/]+/[^/]+)/.*", r"/\1",
                        raw_img.replace("thumb.wikimedia.org", "upload.wikimedia.org")
                    ).split("?")[0]
            elif ".mp4" in low_img or ".webm" in low_img:
                ev["mediaType"] = "video"
            elif ev.get("imageUrl") and not ev.get("mediaType"):
                ev["mediaType"] = "image"

        # Final sweep: guarantee that any fictional event has lat/lng strictly set to None
        for event in events_data:
            if is_timeline_fictional or bool(event.get("is_fictional")):
                event["lat"] = None
                event["lng"] = None
                event["is_fictional"] = True

    logger.info(
        "Wikipedia enrichment: %d events | %d resolved | %d images assigned | %d deduped | %d without image",
        len(events_data), stats["resolved"], stats["assigned"], stats["deduped"], stats["suppressed"]
    )
    return events_data


# --- Nominatim (OpenStreetMap) geocoding (SC-11) ---------------------------------------------------
# Nominatim's usage policy allows at most 1 request per second for the whole site. Requests share one
# keep-alive client and one scheduler with two lanes: interactive place search (a user typing in the
# event editor) goes before batch reverse geocoding (photo import), and a batch request that has
# waited long enough still gets its turn. The batch queue is bounded, and callers enforce deadlines,
# so a busy import returns partial results instead of hanging for minutes. For real scale, point
# NOMINATIM_BASE_URL at a self-hosted Nominatim/Photon or a commercial geocoder (DEPLOYMENT_STEPS.md).
NOMINATIM_LANE_INTERACTIVE = 0
NOMINATIM_LANE_BATCH = 1
_NOMINATIM_DEFAULT_BASE_URL = "https://nominatim.openstreetmap.org"


class NominatimBusyError(RuntimeError):
    """The geocoding queue is full or the lookup's deadline passed; the caller may retry later."""


def _nominatim_base_url() -> str:
    raw = (os.getenv("NOMINATIM_BASE_URL") or "").strip().rstrip("/")
    if raw.startswith("https://") and " " not in raw:
        return raw
    return _NOMINATIM_DEFAULT_BASE_URL


def _nominatim_min_interval_sec() -> float:
    raw = os.getenv("NOMINATIM_MIN_INTERVAL_SEC", "").strip()
    try:
        return max(0.0, float(raw)) if raw else _NOMINATIM_MIN_INTERVAL_SEC
    except ValueError:
        return _NOMINATIM_MIN_INTERVAL_SEC


def _env_float(name: str, default: float, minimum: float = 0.0) -> float:
    raw = os.getenv(name, "").strip()
    try:
        return max(minimum, float(raw)) if raw else default
    except ValueError:
        return default


def _nominatim_max_batch_queue() -> int:
    raw = os.getenv("NOMINATIM_MAX_QUEUE", "").strip()
    try:
        return max(1, int(raw)) if raw else 40
    except ValueError:
        return 40


class _NominatimScheduler:
    """Grants at most one request per `min_interval` across the process, interactive lane first."""

    def __init__(self) -> None:
        self._queues: Dict[int, deque] = {NOMINATIM_LANE_INTERACTIVE: deque(), NOMINATIM_LANE_BATCH: deque()}
        self._last_grant = 0.0
        self._pump_task: Optional[asyncio.Task] = None

    def queued(self, lane: int) -> int:
        return sum(1 for _t, fut in self._queues[lane] if not fut.done())

    def _pop_next(self) -> Optional["asyncio.Future"]:
        for q in self._queues.values():
            while q and q[0][1].done():
                q.popleft()
        inter, batch = self._queues[NOMINATIM_LANE_INTERACTIVE], self._queues[NOMINATIM_LANE_BATCH]
        starve_after = _env_float("NOMINATIM_BATCH_MAX_WAIT_BEFORE_PRIORITY_SEC", 6.0)
        if batch and (not inter or time.monotonic() - batch[0][0] >= starve_after):
            return batch.popleft()[1]
        if inter:
            return inter.popleft()[1]
        return None

    async def _pump(self) -> None:
        try:
            while True:
                wait = _nominatim_min_interval_sec() - (time.monotonic() - self._last_grant)
                if wait > 0:
                    await asyncio.sleep(wait)
                fut = self._pop_next()
                if fut is None:
                    return
                self._last_grant = time.monotonic()
                fut.set_result(True)
        finally:
            self._pump_task = None

    async def acquire(self, lane: int, timeout: float) -> None:
        """Waits for this request's slot; raises NominatimBusyError when full or out of time."""
        if lane == NOMINATIM_LANE_BATCH and self.queued(lane) >= _nominatim_max_batch_queue():
            raise NominatimBusyError("geocoding queue is full")
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        self._queues[lane].append((time.monotonic(), fut))
        if self._pump_task is None or self._pump_task.done() or self._pump_task.get_loop() is not loop:
            self._pump_task = loop.create_task(self._pump())
        try:
            await asyncio.wait_for(fut, timeout=max(0.01, timeout))
        except asyncio.TimeoutError:
            raise NominatimBusyError("geocoding deadline passed") from None


_NOMINATIM_SCHEDULER: Optional[_NominatimScheduler] = None
_NOMINATIM_SCHEDULER_LOOP = None
_NOMINATIM_CLIENT: Optional[httpx.AsyncClient] = None
_NOMINATIM_CLIENT_LOOP = None


def _get_nominatim_scheduler() -> _NominatimScheduler:
    global _NOMINATIM_SCHEDULER, _NOMINATIM_SCHEDULER_LOOP
    loop = asyncio.get_running_loop()
    if _NOMINATIM_SCHEDULER is None or _NOMINATIM_SCHEDULER_LOOP is not loop:
        _NOMINATIM_SCHEDULER = _NominatimScheduler()
        _NOMINATIM_SCHEDULER_LOOP = loop
    return _NOMINATIM_SCHEDULER


def _get_nominatim_client() -> httpx.AsyncClient:
    """One keep-alive client per event loop: no new TLS handshake per lookup (P-14 / SC-11)."""
    global _NOMINATIM_CLIENT, _NOMINATIM_CLIENT_LOOP
    loop = asyncio.get_running_loop()
    if _NOMINATIM_CLIENT is None or _NOMINATIM_CLIENT.is_closed or _NOMINATIM_CLIENT_LOOP is not loop:
        _NOMINATIM_CLIENT = _ORIG_ASYNC_CLIENT(
            follow_redirects=False,
            timeout=6.0,
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
        )
        _NOMINATIM_CLIENT_LOOP = loop
    return _NOMINATIM_CLIENT


async def _nominatim_get(path: str, params: Dict[str, Any], headers: Dict[str, str], *, lane: int, timeout: float, wait_budget: float) -> httpx.Response:
    """One Nominatim GET through the shared client and scheduler (tests that patch httpx bypass both)."""
    url = f"{_nominatim_base_url()}{path}"
    if httpx.AsyncClient is not _ORIG_ASYNC_CLIENT:
        async with httpx.AsyncClient(follow_redirects=False) as client:
            return await client.get(url, params=params, headers=headers, timeout=timeout)
    await _get_nominatim_scheduler().acquire(lane, wait_budget)
    return await _get_nominatim_client().get(url, params=params, headers=headers, timeout=timeout)


async def search_geocode_candidates(query: str, limit: int = 5, lang: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Search OpenStreetMap/Nominatim for place-name candidates so the user can pick
    the correct location (and its coordinates) for a manually added/edited event,
    mirroring the Wikipedia disambiguation search used for event titles.
    Interactive: it goes before queued photo-import lookups.
    """
    clean = (query or "").strip()[:200]
    if not clean or len(clean) < 2:
        return []

    clamped_limit = max(1, min(int(limit or 5), 10))
    safe_lang = re.sub(r"[^a-zA-Z0-9,\-;=. ]", "", str(lang or "")).strip()[:32]

    use_real_http = httpx.AsyncClient is _ORIG_ASYNC_CLIENT
    cache_key = (clean.lower(), clamped_limit, safe_lang.lower())
    if use_real_http:
        cached = _cache_get(_GEOCODE_CACHE, cache_key)
        if cached is not None:
            return list(cached)

    headers = dict(HEADERS)
    if safe_lang:
        headers["Accept-Language"] = safe_lang

    params = {
        "q": clean,
        "format": "jsonv2",
        "addressdetails": 1,
        "limit": clamped_limit,
    }
    try:
        resp = await _nominatim_get(
            "/search", params, headers,
            lane=NOMINATIM_LANE_INTERACTIVE,
            timeout=5.0,
            wait_budget=_env_float("NOMINATIM_SEARCH_MAX_WAIT_SEC", 8.0, minimum=0.5),
        )
        if resp.status_code != 200:
            return []
        hits = resp.json()
    except NominatimBusyError:
        logger.info("Geocode search skipped: Nominatim queue busy for query=%r", clean)
        return []
    except Exception:
        logger.warning("Geocode search failed for query=%r", clean, exc_info=True)
        return []

    results = []
    for hit in hits or []:
        try:
            results.append({
                "displayName": hit.get("display_name"),
                "name": hit.get("name") or hit.get("display_name"),
                "lat": float(hit["lat"]),
                "lng": float(hit["lon"]),
                "type": hit.get("type"),
                "placeClass": hit.get("class"),
            })
        except (KeyError, TypeError, ValueError):
            continue
    if use_real_http:
        _cache_put(_GEOCODE_CACHE, cache_key, results)
    return results



def round_reverse_geocode_point(lat: float, lng: float) -> Optional[tuple]:
    """
    Rounds a coordinate to 2 decimals (~1 km) before it is sent anywhere: better cache hits, and
    the exact spot a photo was taken (often someone's home) never leaves the server.
    Returns None for invalid coordinates.
    """
    try:
        la, ln = float(lat), float(lng)
    except (TypeError, ValueError):
        return None
    if not (-90.0 <= la <= 90.0 and -180.0 <= ln <= 180.0) or la != la or ln != ln:
        return None
    return (round(la, 2), round(ln, 2))


def _reverse_hit_to_place(hit: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(hit, dict) or hit.get("error"):
        return None
    addr = hit.get("address") or {}
    city = (
        addr.get("city") or addr.get("town") or addr.get("village") or addr.get("hamlet")
        or addr.get("municipality") or addr.get("city_district") or None
    )
    area = addr.get("suburb") or addr.get("neighbourhood") or addr.get("quarter") or None
    region = addr.get("state") or addr.get("region") or addr.get("county") or addr.get("province") or None
    country = addr.get("country") or None
    country_code = (addr.get("country_code") or "").upper() or None
    name = hit.get("name") or None
    if not (city or area or region or country or name):
        return None
    return {
        "name": name,
        "city": city,
        "area": area,
        "region": region,
        "country": country,
        "countryCode": country_code,
        "displayName": hit.get("display_name"),
    }


def _safe_geocode_lang(lang: Optional[str]) -> str:
    return re.sub(r"[^a-zA-Z0-9,\-;=. ]", "", str(lang or "")).strip()[:32]


def _reverse_cell_persist_key(rounded: tuple, safe_lang: str) -> str:
    lang_part = re.sub(r"[^a-z0-9\-]", "", safe_lang.lower())[:16] or "any"
    return f"geo:{rounded[0]:.2f}:{rounded[1]:.2f}:{lang_part}"


async def warm_reverse_geocode_cells(cells: List[tuple], lang: Optional[str] = None) -> None:
    """Loads rounded cells missing from memory from the persistent cache in one round trip."""
    if httpx.AsyncClient is not _ORIG_ASYNC_CLIENT:
        return
    from services import enrichment_cache

    if not enrichment_cache.is_enabled():
        return
    safe_lang = _safe_geocode_lang(lang)
    wanted: Dict[str, tuple] = {}
    for cell in cells:
        rounded = round_reverse_geocode_point(cell[0], cell[1])
        if rounded is None:
            continue
        mem_key = (rounded[0], rounded[1], safe_lang.lower())
        if _cache_get(_REVERSE_GEOCODE_CACHE, mem_key) is None:
            wanted[_reverse_cell_persist_key(rounded, safe_lang)] = mem_key
    if not wanted:
        return
    found = await enrichment_cache.get_many(list(wanted))
    for pkey, value in found.items():
        if isinstance(value, dict):
            _cache_put(
                _REVERSE_GEOCODE_CACHE, wanted[pkey], value,
                ttl=_REVERSE_GEOCODE_CACHE_TTL, max_entries=_REVERSE_GEOCODE_CACHE_MAX_ENTRIES,
            )


async def reverse_geocode_point(lat: float, lng: float, lang: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Reverse-geocodes one point (rounded to ~1 km) to a city-level place via Nominatim, in the batch
    lane of the shared 1 request/second scheduler. Cached for a week (in memory and, when migration
    003 is applied, in Postgres); misses are cached too so a point in the sea is not re-queried.
    Raises NominatimBusyError when the queue is full or the lookup waited too long.
    """
    rounded = round_reverse_geocode_point(lat, lng)
    if rounded is None:
        return None
    safe_lang = _safe_geocode_lang(lang)
    cache_key = (rounded[0], rounded[1], safe_lang.lower())
    use_real_http = httpx.AsyncClient is _ORIG_ASYNC_CLIENT
    if use_real_http:
        cached = _cache_get(_REVERSE_GEOCODE_CACHE, cache_key)
        if cached is not None:
            return cached or None

    headers = dict(HEADERS)
    if safe_lang:
        headers["Accept-Language"] = safe_lang
    params = {
        "lat": f"{rounded[0]:.2f}",
        "lon": f"{rounded[1]:.2f}",
        "format": "jsonv2",
        "addressdetails": 1,
        "zoom": 14,
    }

    try:
        resp = await _nominatim_get(
            "/reverse", params, headers,
            lane=NOMINATIM_LANE_BATCH,
            timeout=6.0,
            wait_budget=_env_float("NOMINATIM_REVERSE_MAX_WAIT_SEC", 20.0, minimum=0.5),
        )
        if resp.status_code != 200:
            # Transient failures (429/5xx) are not cached, so a retry can succeed.
            return None
        place = _reverse_hit_to_place(resp.json())
    except NominatimBusyError:
        raise
    except Exception:
        logger.warning("Reverse geocode failed for %s", rounded, exc_info=True)
        return None

    if use_real_http:
        _cache_put(
            _REVERSE_GEOCODE_CACHE, cache_key, place or {},
            ttl=_REVERSE_GEOCODE_CACHE_TTL, max_entries=_REVERSE_GEOCODE_CACHE_MAX_ENTRIES,
        )
        from services import enrichment_cache

        enrichment_cache.put_many([
            (_reverse_cell_persist_key(rounded, safe_lang), place or {}, _REVERSE_GEOCODE_CACHE_TTL),
        ])
    return place
