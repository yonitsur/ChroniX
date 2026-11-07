"""
Google Photos Picker API proxy.

The browser signs the user in with Google (scope `photospicker.mediaitems.readonly`) and sends
the short-lived access token with each request; it is forwarded to Google and never stored or
logged. Everything goes through the server because Google's photo URLs (`baseUrl`) don't allow
cross-origin reads from a browser.

Photos are fetched at the size each step needs (thumbnail, AI copy, stored copy) rather than as
originals: the Picker gives the capture time in `createTime`, and its downloads never include the
location anyway (Google strips it).

Docs: https://developers.google.com/photos/picker/reference/rest
"""
import logging
import re
from typing import Any, Dict, Optional, Tuple

import httpx

from services.http_clients import shared_async_client

logger = logging.getLogger(__name__)

PICKER_API = "https://photospicker.googleapis.com/v1"
GOOGLE_PHOTOS_SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly"
PICKER_MAX_ITEMS = 2000          # Google's own per-session ceiling
LIST_PAGE_SIZE = 100             # Google's maximum page size
MEDIA_MAX_BYTES = 12 * 1024 * 1024
ALLOWED_MEDIA_SIZES = (256, 320, 384, 512, 640, 768, 800, 1024, 1600)

_TIMEOUT = httpx.Timeout(20.0, connect=6.0)
# Picked items are served from Google's user-content CDN; nothing else may be fetched (SSRF guard).
_MEDIA_HOST_RE = re.compile(r"^[a-z0-9-]+\.googleusercontent\.com$")
_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,200}$")


class GooglePhotosError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def clean_token(token: Optional[str]) -> str:
    t = (token or "").strip()
    if t.lower().startswith("bearer "):
        t = t[7:].strip()
    if not t or len(t) > 4096 or any(c.isspace() for c in t):
        raise GooglePhotosError(401, "Connect Google Photos first.")
    return t


def check_session_id(session_id: str) -> str:
    if not _SESSION_ID_RE.match(session_id or ""):
        raise GooglePhotosError(400, "Invalid Google Photos session.")
    return session_id


def _google_error(resp: httpx.Response) -> Tuple[str, str]:
    """(status, message) from a Google API error body, e.g. ("PERMISSION_DENIED", "...")."""
    try:
        err = (resp.json() or {}).get("error") or {}
    except Exception:
        return "", resp.text[:300]
    reasons = " ".join(str(d.get("reason", "")) for d in err.get("details") or [] if isinstance(d, dict))
    return f"{err.get('status', '')} {reasons}".strip(), str(err.get("message", ""))[:300]


def _raise_for(resp: httpx.Response, what: str) -> None:
    if resp.status_code < 400:
        return
    if resp.status_code == 401:
        raise GooglePhotosError(401, "Google Photos access expired - connect again.")
    if resp.status_code == 403:
        # 403 is a setup problem, not an expired token: say which one (no token is logged).
        status, message = _google_error(resp)
        logger.warning("Google Photos %s refused (403): %s | %s", what, status, message)
        text = f"{status} {message}".lower()
        if "service_disabled" in text or "has not been used" in text or "is disabled" in text:
            raise GooglePhotosError(
                403,
                "The Photos Picker API isn't enabled in the Google Cloud project of this sign-in client. "
                "Enable it (APIs & Services -> Library -> Photos Picker API), wait a minute, and try again.",
            )
        if "scope" in text or "access_token_scope_insufficient" in text:
            raise GooglePhotosError(
                403,
                "Google Photos permission wasn't granted. Connect again and tick the Google Photos box on Google's screen.",
            )
        raise GooglePhotosError(403, f"Google refused the request: {message or status or 'permission denied'}")
    if resp.status_code == 404:
        raise GooglePhotosError(404, "This Google Photos selection is no longer available.")
    if resp.status_code == 400 and "FAILED_PRECONDITION" in resp.text:
        raise GooglePhotosError(409, "Still picking in Google Photos.")
    if resp.status_code == 429:
        raise GooglePhotosError(429, "Google Photos is busy - try again in a minute.")
    logger.warning("Google Photos %s failed: %s %s", what, resp.status_code, resp.text[:300])
    raise GooglePhotosError(502, "Google Photos didn't respond as expected.")


def _session_view(data: Dict[str, Any]) -> Dict[str, Any]:
    polling = data.get("pollingConfig") or {}
    return {
        "id": data.get("id"),
        "pickerUri": data.get("pickerUri"),
        "mediaItemsSet": bool(data.get("mediaItemsSet")),
        "pollInterval": polling.get("pollInterval"),
        "timeoutIn": polling.get("timeoutIn"),
        "expireTime": data.get("expireTime"),
    }


async def create_session(token: str, max_items: int = PICKER_MAX_ITEMS) -> Dict[str, Any]:
    n = max(1, min(int(max_items or PICKER_MAX_ITEMS), PICKER_MAX_ITEMS))
    async with shared_async_client("google_photos", timeout=_TIMEOUT, follow_redirects=False) as client:
        resp = await client.post(
            f"{PICKER_API}/sessions",
            headers=_auth_headers(token),
            json={"pickingConfig": {"maxItemCount": str(n)}},
        )
    _raise_for(resp, "session create")
    return _session_view(resp.json())


async def get_session(token: str, session_id: str) -> Dict[str, Any]:
    async with shared_async_client("google_photos", timeout=_TIMEOUT, follow_redirects=False) as client:
        resp = await client.get(f"{PICKER_API}/sessions/{check_session_id(session_id)}", headers=_auth_headers(token))
    _raise_for(resp, "session get")
    return _session_view(resp.json())


async def delete_session(token: str, session_id: str) -> None:
    async with shared_async_client("google_photos", timeout=_TIMEOUT, follow_redirects=False) as client:
        resp = await client.delete(f"{PICKER_API}/sessions/{check_session_id(session_id)}", headers=_auth_headers(token))
    if resp.status_code not in (200, 204, 404):
        _raise_for(resp, "session delete")


def _item_view(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    media = item.get("mediaFile") or {}
    meta = media.get("mediaFileMetadata") or {}
    if item.get("type") == "VIDEO" or not media.get("baseUrl"):
        return None
    mime = str(media.get("mimeType") or "")
    if mime and not mime.startswith("image/"):
        return None
    return {
        "id": item.get("id"),
        "createTime": item.get("createTime"),
        "baseUrl": media.get("baseUrl"),
        "mimeType": mime or "image/jpeg",
        "filename": media.get("filename") or "",
        "width": meta.get("width"),
        "height": meta.get("height"),
    }


async def list_items(token: str, session_id: str, page_token: Optional[str] = None) -> Dict[str, Any]:
    params: Dict[str, Any] = {"sessionId": check_session_id(session_id), "pageSize": LIST_PAGE_SIZE}
    if page_token:
        if len(page_token) > 2000:
            raise GooglePhotosError(400, "Invalid page token.")
        params["pageToken"] = page_token
    async with shared_async_client("google_photos", timeout=_TIMEOUT, follow_redirects=False) as client:
        resp = await client.get(f"{PICKER_API}/mediaItems", headers=_auth_headers(token), params=params)
    _raise_for(resp, "media list")
    data = resp.json()
    raw = data.get("mediaItems") or []
    items = [v for v in (_item_view(i) for i in raw) if v]
    return {"items": items, "skipped": len(raw) - len(items), "nextPageToken": data.get("nextPageToken")}


def _is_media_url(url: httpx.URL) -> bool:
    return (
        url.scheme == "https"
        and not url.userinfo
        and url.port in (None, 443)
        and bool(_MEDIA_HOST_RE.match((url.host or "").lower()))
    )


def sized_media_url(base_url: str, size: int) -> str:
    """
    Validates a picked item's baseUrl and appends a size (fit inside size x size).
    The fetch URL is rebuilt from the parsed host and path (S-14): checking a parsed URL but fetching
    an edited raw string let `https://evil.com=@lh3.googleusercontent.com/x` pass the host check and
    then be fetched from evil.com with the user's Google token.
    """
    raw = str(base_url or "")
    if not raw or len(raw) > 4096 or any(c.isspace() or ord(c) < 0x20 or c == "\\" for c in raw):
        raise GooglePhotosError(400, "Invalid photo address.")
    try:
        u = httpx.URL(raw)
    except Exception:
        raise GooglePhotosError(400, "Invalid photo address.")
    # The raw authority must be a bare host: no userinfo, no '=' tricks, no unusual port.
    authority = raw.split("://", 1)[1].split("/", 1)[0] if "://" in raw else ""
    if not _is_media_url(u) or "@" in authority or "=" in authority or authority.lower() != (u.host or "").lower():
        raise GooglePhotosError(400, "Invalid photo address.")
    if size not in ALLOWED_MEDIA_SIZES:
        raise GooglePhotosError(400, "Unsupported photo size.")
    # Any size parameters already on the path are replaced; Picker baseUrls carry no query.
    path = (u.raw_path.decode("ascii").split("?", 1)[0] or "/").split("=", 1)[0]
    sized = u.copy_with(raw_path=f"{path}=w{size}-h{size}".encode("ascii"), fragment=None)
    if not _is_media_url(sized) or sized.host != u.host:
        raise GooglePhotosError(400, "Invalid photo address.")
    return str(sized)


async def fetch_media(token: str, base_url: str, size: int) -> Tuple[bytes, str]:
    url = sized_media_url(base_url, size)
    # Last check on exactly what is fetched, since the Google bearer token goes with it.
    if not _is_media_url(httpx.URL(url)):
        raise GooglePhotosError(400, "Invalid photo address.")
    async with shared_async_client("google_photos", timeout=_TIMEOUT, follow_redirects=False) as client:
        async with client.stream("GET", url, headers=_auth_headers(token)) as resp:
            if resp.status_code >= 400:
                await resp.aread()
                _raise_for(resp, "media fetch")
            ctype = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
            if not ctype.startswith("image/"):
                raise GooglePhotosError(502, "Google Photos returned something that isn't a photo.")
            chunks = []
            total = 0
            async for chunk in resp.aiter_bytes():
                total += len(chunk)
                if total > MEDIA_MAX_BYTES:
                    raise GooglePhotosError(413, "Photo too large.")
                chunks.append(chunk)
    return b"".join(chunks), ctype
