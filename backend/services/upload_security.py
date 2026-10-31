"""
Defense-in-depth file upload validation and abuse protection for ChroniX.

Pure-Python (zero external dependencies beyond the standard library + FastAPI)
implementation providing:
  1. Pre-flight Content-Length & bounded 64 KB chunked streaming reads (anti-OOM).
  2. Filename sanitization (path traversal, NUL/control chars, Unicode RTLO spoofing)
     and strict extension allowlist / executable & script blocklist.
  3. Magic-byte file signature sniffing & anti-polyglot checks (never trusting
     client-supplied Content-Type headers).
  4. Image decompression / pixel-flood bomb protection (PNG, JPEG, WebP header parsing).
  5. PDF structural inspection: trailer verification, encrypted-PDF rejection,
     bounded object-stream inspection, and per-tier page-count caps (anti-token-bomb).
  6. Safe UTF-8 `.txt` / `.md` extraction with binary-byte rejection, control-char
     stripping, and strict character-count budgets.
  7. Tier-aware policies (anonymous guests vs. registered users vs. BYOK/admins)
     and SHA-256 duplicate-file deduplication within a single submission.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import struct
import zlib
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, Request, UploadFile

from services.auth_service import is_admin_user, is_guest_user

logger = logging.getLogger("ChroniXUploadSecurity")

ALLOWED_IMAGE_MIME_TYPES = frozenset({
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
})
ALLOWED_PDF_MIME_TYPES = frozenset({"application/pdf"})
ALLOWED_BINARY_MIME_TYPES = ALLOWED_IMAGE_MIME_TYPES | ALLOWED_PDF_MIME_TYPES
ALLOWED_TEXT_MIME_TYPES = frozenset({
    "text/plain",
    "text/markdown",
    "text/x-markdown",
})
ALLOWED_UPLOAD_MIME_TYPES = ALLOWED_BINARY_MIME_TYPES | ALLOWED_TEXT_MIME_TYPES

IMAGE_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"})
PDF_EXTENSIONS = frozenset({".pdf"})
TEXT_EXTENSIONS = frozenset({".txt", ".md", ".markdown"})
ALLOWED_EXTENSIONS = IMAGE_EXTENSIONS | PDF_EXTENSIONS | TEXT_EXTENSIONS

BLOCKED_DANGEROUS_EXTENSIONS = frozenset({
    ".exe", ".dll", ".bat", ".cmd", ".com", ".scr", ".msi", ".ps1", ".vbs",
    ".sh", ".bash", ".zsh", ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx",
    ".html", ".htm", ".xhtml", ".svg", ".svgz", ".xml", ".php", ".py", ".rb",
    ".pl", ".jar", ".war", ".apk", ".ipa", ".dmg", ".iso", ".zip", ".rar",
    ".7z", ".tar", ".gz", ".bz2", ".xz", ".docm", ".xlsm", ".pptm", ".lnk",
    ".reg", ".inf", ".hta", ".wasm", ".elf", ".bin",
})

STREAM_CHUNK_BYTES = 64 * 1024  # 64 KB incremental read chunks
MULTIPART_OVERHEAD_ALLOWANCE = 1 * 1024 * 1024  # 1 MB allowance for multipart headers/form fields

MAX_IMAGE_DIMENSION = 16_000  # Max width or height in pixels
MAX_IMAGE_PIXELS = 75_000_000  # 75 MP ceiling (blocks decompression / pixel-flood bombs)

MAX_OBJSTM_DECOMPRESSED_BYTES = 512 * 1024  # 512 KB cap per PDF /ObjStm stream
MAX_OBJSTM_STREAMS_TO_INSPECT = 64

# Control chars & Unicode BiDi override characters (blocks RTLO filename spoofing like `fdp.exe`)
_UNSAFE_FILENAME_CHARS_RE = re.compile(
    r"[\x00-\x1f\x7f\u200e\u200f\u202a-\u202e\u2066-\u2069]"
)
_UNSAFE_TEXT_CONTROL_RE = re.compile(
    r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e]"
)
_POLYGLOT_MARKERS = (b"<script", b"<!doctype html", b"<html", b"<svg", b"<?php")

_HEIC_BRANDS = frozenset({b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis"})
_HEIF_BRANDS = frozenset({b"mif1", b"msf1", b"heif"})

_PDF_LEAF_PAGE_RE = re.compile(rb"/Type\s*/Page\b(?!s)")
_PDF_PAGES_COUNT_RE = re.compile(rb"/Type\s*/Pages\b[^>]{0,400}?/Count\s+(\d{1,6})\b", re.DOTALL)
_PDF_COUNT_FIRST_RE = re.compile(rb"/Count\s+(\d{1,6})\b[^>]{0,400}?/Type\s*/Pages\b", re.DOTALL)
_PDF_ENCRYPT_RE = re.compile(rb"/Encrypt\b")
_PDF_OBJSTM_RE = re.compile(
    rb"<<(?=[^>]{0,500}?/Type\s*/ObjStm\b)(?=[^>]{0,500}?/Filter\s*/FlateDecode\b)[^>]{0,500}?>>\s*stream\r?\n(.*?)\r?\nendstream",
    re.DOTALL,
)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if raw:
        try:
            return max(1, int(raw))
        except ValueError:
            pass
    return default


@dataclass(frozen=True)
class UploadPolicy:
    max_files: int
    max_binary_file_bytes: int
    max_text_file_bytes: int
    max_total_bytes: int
    max_pdf_pages: int
    max_raw_text_chars: int
    max_uploaded_text_chars: int


@dataclass
class ValidatedUploads:
    binary_files: List[Tuple[bytes, str]] = field(default_factory=list)
    extracted_documents: List[Tuple[str, str]] = field(default_factory=list)
    total_bytes: int = 0
    total_pdf_pages: int = 0
    image_count: int = 0
    pdf_count: int = 0
    text_file_count: int = 0
    deduplicated_count: int = 0

    @property
    def total_accepted_files(self) -> int:
        return len(self.binary_files) + len(self.extracted_documents)

    @property
    def doc_count(self) -> int:
        return self.pdf_count + self.text_file_count


def get_upload_policy(
    user: Optional[Dict[str, Any]] = None,
    has_custom_key: bool = False,
    prompt_mode: bool = False,
    is_chat: bool = False,
) -> UploadPolicy:
    """
    Returns tier-aware upload limits:
      - Admins or users supplying their own Gemini API key (BYOK) get generous limits.
      - Registered users on shared server keys get full standard limits (5 files / 24 MB on
        Home PromptBar; 20 files / 30 MB in Personal Timeline & Chat).
      - Anonymous guest sessions on shared server keys get tighter caps to protect the
        shared Community AI Pool from automated token/bandwidth exhaustion.
    """
    admin = is_admin_user(user)
    guest = is_guest_user(user) and not admin

    if admin or has_custom_key:
        return UploadPolicy(
            max_files=8 if prompt_mode else 20,
            max_binary_file_bytes=10 * 1024 * 1024,
            max_text_file_bytes=256 * 1024,
            max_total_bytes=30 * 1024 * 1024,
            max_pdf_pages=_env_int("UPLOAD_MAX_PDF_PAGES_BYOK", 120),
            max_raw_text_chars=20_000,
            max_uploaded_text_chars=50_000,
        )

    if guest:
        return UploadPolicy(
            max_files=3 if prompt_mode else 5,
            max_binary_file_bytes=5 * 1024 * 1024,
            max_text_file_bytes=128 * 1024,
            max_total_bytes=(10 if prompt_mode else 12) * 1024 * 1024,
            max_pdf_pages=_env_int("UPLOAD_MAX_PDF_PAGES_GUEST", 15 if prompt_mode else 20),
            max_raw_text_chars=20_000,
            max_uploaded_text_chars=20_000,
        )

    return UploadPolicy(
        max_files=5 if prompt_mode else 20,
        max_binary_file_bytes=8 * 1024 * 1024,
        max_text_file_bytes=256 * 1024,
        max_total_bytes=(24 if prompt_mode else 30) * 1024 * 1024,
        max_pdf_pages=_env_int("UPLOAD_MAX_PDF_PAGES_REGISTERED", 40 if prompt_mode else 50),
        max_raw_text_chars=20_000,
        max_uploaded_text_chars=40_000,
    )


def sanitize_upload_filename(raw_name: Optional[str]) -> str:
    """
    Strips directory components, NUL bytes, control chars, and Unicode BiDi override
    characters (anti-RTLO spoofing), returning a safe bounded display name.
    """
    if not raw_name:
        return "attachment"
    # Normalize slashes and keep only basename
    base = raw_name.replace("\\", "/").split("/")[-1]
    base = _UNSAFE_FILENAME_CHARS_RE.sub("", base).strip()
    # Prevent hidden dot-only names like "." or ".."
    base = base.lstrip(".")
    if not base:
        return "attachment"
    if len(base) > 80:
        stem, dot, ext = base.rpartition(".")
        if dot and len(ext) <= 10:
            base = f"{stem[:80 - len(ext) - 1]}.{ext}"
        else:
            base = base[:80]
    return base


def extract_and_validate_extension(clean_name: str) -> str:
    """
    Validates file extension against blocked executable/script/archive extensions
    and allowed media/document extensions. Returns lowercase `.ext` or `""` if extensionless.
    """
    lower = clean_name.lower()
    if "." not in lower:
        return ""
    _, _, last_ext = lower.rpartition(".")
    ext = f".{last_ext}"
    if ext in BLOCKED_DANGEROUS_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported or unsafe file type '{ext}' in '{clean_name}'.",
        )
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file extension '{ext}' in '{clean_name}'. Allowed: PDF, TXT, MD, JPG, PNG, WEBP, HEIC.",
        )
    return ext


def sniff_binary_mime(data: bytes) -> Optional[str]:
    """
    Inspects leading magic bytes (file signature) to determine the real binary MIME type.
    Returns None if bytes do not match any supported binary format.
    """
    n = len(data)
    if n < 8:
        return None

    # 1. PNG: 89 50 4E 47 0D 0A 1A 0A
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        head_lower = data[:4096].lower()
        if any(marker in head_lower for marker in _POLYGLOT_MARKERS):
            return None
        return "image/png"

    # 2. JPEG: FF D8 FF
    if data[:3] == b"\xff\xd8\xff":
        head_lower = data[:4096].lower()
        if any(marker in head_lower for marker in _POLYGLOT_MARKERS):
            return None
        return "image/jpeg"

    # 3. WebP: "RIFF" .... "WEBP"
    if n >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        head_lower = data[:4096].lower()
        if any(marker in head_lower for marker in _POLYGLOT_MARKERS):
            return None
        return "image/webp"

    # 4. ISO Base Media File Format (HEIC / HEIF): bytes 4..8 == "ftyp"
    if n >= 12 and data[4:8] == b"ftyp":
        box_size = struct.unpack(">I", data[:4])[0]
        scan_end = min(n, max(16, min(box_size, 64)))
        major_brand = data[8:12]
        brands = {major_brand}
        for offset in range(16, scan_end - 3, 4):
            brands.add(data[offset:offset + 4])
        if brands & _HEIC_BRANDS:
            return "image/heic"
        if brands & _HEIF_BRANDS:
            return "image/heif"

    # 5. PDF: "%PDF-1." or "%PDF-2." near offset 0 (blocks polyglots hiding %PDF deep in HTML/EXE)
    leading = data[:24].lstrip(b"\xef\xbb\xbf \t\r\n")
    if leading.startswith((b"%PDF-1.", b"%PDF-2.")):
        return "application/pdf"

    return None


def inspect_image_dimensions(data: bytes, mime: str, display_name: str) -> Tuple[Optional[int], Optional[int]]:
    """
    Parses image pixel dimensions in pure Python (PNG, WebP, JPEG) and rejects
    corrupted headers or decompression / pixel-flood bombs (>16,000 px side or >75 MP).
    """
    width: Optional[int] = None
    height: Optional[int] = None

    if mime == "image/png":
        if len(data) < 24 or data[12:16] != b"IHDR":
            raise HTTPException(status_code=400, detail=f"'{display_name}' is not a valid PNG image.")
        width, height = struct.unpack(">II", data[16:24])

    elif mime == "image/webp":
        if len(data) < 30:
            raise HTTPException(status_code=400, detail=f"'{display_name}' is not a valid WebP image.")
        chunk_type = data[12:16]
        if chunk_type == b"VP8 ":
            if data[23:26] != b"\x9d\x01\x2a":
                raise HTTPException(status_code=400, detail=f"'{display_name}' has a malformed WebP header.")
            raw_w, raw_h = struct.unpack("<HH", data[26:30])
            width = raw_w & 0x3FFF
            height = raw_h & 0x3FFF
        elif chunk_type == b"VP8L":
            if data[20] != 0x2F:
                raise HTTPException(status_code=400, detail=f"'{display_name}' has a malformed WebP header.")
            bits = struct.unpack("<I", data[21:25])[0]
            width = (bits & 0x3FFF) + 1
            height = ((bits >> 14) & 0x3FFF) + 1
        elif chunk_type == b"VP8X":
            width = (data[24] | (data[25] << 8) | (data[26] << 16)) + 1
            height = (data[27] | (data[28] << 8) | (data[29] << 16)) + 1

    elif mime == "image/jpeg":
        idx = 2
        n = len(data)
        while idx + 4 < n:
            if data[idx] != 0xFF:
                idx += 1
                continue
            while idx < n and data[idx] == 0xFF:
                idx += 1
            if idx >= n:
                break
            marker = data[idx]
            idx += 1
            # Standalone markers without length payload
            if marker in (0xD8, 0xD9) or (0xD0 <= marker <= 0xD7) or marker == 0x01:
                continue
            if marker == 0xDA:  # Start of Scan — header finished
                break
            if idx + 2 > n:
                break
            seg_len = struct.unpack(">H", data[idx:idx + 2])[0]
            if seg_len < 2 or idx + seg_len > n:
                break
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                if idx + 7 <= n:
                    height, width = struct.unpack(">HH", data[idx + 3:idx + 7])
                break
            idx += seg_len

    if width is not None and height is not None:
        if width <= 0 or height <= 0:
            raise HTTPException(status_code=400, detail=f"'{display_name}' has invalid image dimensions.")
        if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION or (width * height) > MAX_IMAGE_PIXELS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"'{display_name}' image resolution ({width}×{height}) exceeds the safety limit "
                    f"(max {MAX_IMAGE_DIMENSION}px per side / {MAX_IMAGE_PIXELS // 1_000_000}MP)."
                ),
            )

    return width, height


def _strip_pdf_streams(data: bytes) -> bytes:
    """Replaces binary PDF stream payloads with spaces so regex checks only inspect PDF dictionaries."""
    return re.sub(rb"stream\r?\n.*?\r?\nendstream", b"stream endstream", data, flags=re.DOTALL)


def inspect_pdf_structure(data: bytes, display_name: str, max_pages_allowed: int, cumulative_limit: int) -> int:
    """
    Validates a PDF byte buffer:
      - Ensures valid `%PDF-` header and `%%EOF` trailer.
      - Rejects password-protected / encrypted PDFs (`/Encrypt`).
      - Counts pages across standard dictionaries and Flate-compressed `/ObjStm` object streams
        (with strict decompression byte caps against zip bombs).
      - Enforces `max_pages_allowed` to prevent token-exhaustion attacks.
    Returns estimated page count (>= 1).
    """
    if b"%%EOF" not in data[-4096:]:
        raise HTTPException(
            status_code=400,
            detail=f"'{display_name}' appears to be truncated or corrupted (missing PDF EOF marker).",
        )

    dict_only = _strip_pdf_streams(data)

    if _PDF_ENCRYPT_RE.search(dict_only):
        raise HTTPException(
            status_code=400,
            detail=f"'{display_name}' is password-protected or encrypted. Please upload an unencrypted PDF.",
        )

    leaf_pages = len(_PDF_LEAF_PAGE_RE.findall(dict_only))

    # Inspect compressed PDF 1.5+ /ObjStm streams (bounded decompression) if leaf pages aren't visible
    objstm_leaf_pages = 0
    for idx, match in enumerate(_PDF_OBJSTM_RE.finditer(data)):
        if idx >= MAX_OBJSTM_STREAMS_TO_INSPECT:
            break
        raw_stream = match.group(1)
        try:
            decomp = zlib.decompressobj()
            inflated = decomp.decompress(raw_stream, MAX_OBJSTM_DECOMPRESSED_BYTES)
            if decomp.unconsumed_tail:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{display_name}' contains an abnormally compressed stream and was rejected for safety.",
                )
            objstm_leaf_pages += len(_PDF_LEAF_PAGE_RE.findall(inflated))
        except HTTPException:
            raise
        except Exception:
            continue

    tree_counts = [
        int(m)
        for m in (_PDF_PAGES_COUNT_RE.findall(dict_only) + _PDF_COUNT_FIRST_RE.findall(dict_only))
    ]
    max_tree_count = max(tree_counts) if tree_counts else 0

    total_leaf = leaf_pages + objstm_leaf_pages
    # Prefer the larger of explicit leaf pages or declared /Pages /Count so neither incremental
    # updates nor compressed page trees can under-report a huge PDF.
    page_count = max(total_leaf, max_tree_count)

    if page_count <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"'{display_name}' contains no readable PDF pages or is malformed.",
        )

    if page_count > max_pages_allowed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"'{display_name}' has {page_count} pages, exceeding the limit of "
                f"{cumulative_limit} total PDF pages per request. Try uploading a shorter excerpt or chapter."
            ),
        )

    return page_count


def inspect_and_decode_text_bytes(data: bytes, display_name: str) -> str:
    """
    Verifies that a `.txt` / `.md` upload is genuine UTF-8 text (zero NUL bytes,
    not a disguised binary), strips unsafe control characters, and normalizes newlines.
    """
    if b"\x00" in data:
        raise HTTPException(
            status_code=400,
            detail=f"'{display_name}' contains binary data and is not a valid plain-text file.",
        )
    try:
        decoded = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail=f"'{display_name}' must be encoded as UTF-8 plain text or Markdown.",
        )

    cleaned = decoded.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = _UNSAFE_TEXT_CONTROL_RE.sub("", cleaned).strip()
    if not cleaned:
        raise HTTPException(
            status_code=400,
            detail=f"'{display_name}' contains no readable text.",
        )
    return cleaned


async def _read_upload_stream_bounded(
    upload: UploadFile,
    display_name: str,
    max_file_bytes: int,
    remaining_total_bytes: int,
    max_total_bytes: int,
) -> bytes:
    """
    Reads an UploadFile in 64 KB chunks, aborting immediately if per-file or
    cumulative byte caps are exceeded so oversized uploads never buffer into RAM.
    """
    buf = bytearray()
    while True:
        chunk = await upload.read(STREAM_CHUNK_BYTES)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > max_file_bytes:
            if max_file_bytes >= 1024 * 1024:
                limit_label = f"{max_file_bytes // (1024 * 1024)}MB"
            else:
                limit_label = f"{max_file_bytes // 1024}KB"
            raise HTTPException(
                status_code=400,
                detail=f"'{display_name}' is too large (max {limit_label} per file).",
            )
        if len(buf) > remaining_total_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"Total upload size exceeds {max_total_bytes // (1024 * 1024)}MB.",
            )

    if len(buf) == 0:
        raise HTTPException(
            status_code=400,
            detail=f"'{display_name}' is empty (0 bytes).",
        )
    return bytes(buf)


def precheck_request_content_length(request: Optional[Request], policy: UploadPolicy) -> None:
    """Rejects obviously oversized multipart payloads upfront via Content-Length before streaming."""
    if request is None:
        return
    raw_len = request.headers.get("content-length")
    if not raw_len:
        return
    try:
        content_len = int(raw_len)
    except ValueError:
        return
    if content_len > policy.max_total_bytes + MULTIPART_OVERHEAD_ALLOWANCE:
        raise HTTPException(
            status_code=413,
            detail=f"Upload payload is too large (max {policy.max_total_bytes // (1024 * 1024)}MB total).",
        )


def _is_intended_text_upload(declared_mime: str, ext: str) -> bool:
    if ext in TEXT_EXTENSIONS:
        return True
    if declared_mime in ALLOWED_TEXT_MIME_TYPES and ext == "":
        return True
    return False


async def validate_and_read_uploads(
    files: List[UploadFile],
    raw_text: str = "",
    *,
    request: Optional[Request] = None,
    user: Optional[Dict[str, Any]] = None,
    has_custom_key: bool = False,
    prompt_mode: bool = False,
    is_chat: bool = False,
    require_files_only: bool = False,
) -> ValidatedUploads:
    """
    Full defense-in-depth validation pipeline for uploaded files + optional raw text.
    Always run BEFORE charging quota or reserving Community Pool credits.
    """
    policy = get_upload_policy(
        user=user,
        has_custom_key=has_custom_key,
        prompt_mode=prompt_mode,
        is_chat=is_chat,
    )
    precheck_request_content_length(request, policy)

    if raw_text and len(raw_text) > policy.max_raw_text_chars:
        raise HTTPException(
            status_code=400,
            detail=f"Pasted text is too long (max {policy.max_raw_text_chars} characters).",
        )

    if require_files_only:
        if not files:
            raise HTTPException(status_code=400, detail="Please attach at least one file.")
    else:
        if not files and not raw_text:
            raise HTTPException(
                status_code=400,
                detail="Please attach at least one file or paste some text.",
            )

    if len(files) > policy.max_files:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files (max {policy.max_files}).",
        )

    result = ValidatedUploads()
    seen_hashes: set[str] = set()
    accumulated_text_chars = 0

    for f in files:
        display_name = sanitize_upload_filename(f.filename)
        ext = extract_and_validate_extension(display_name)
        declared_mime = (f.content_type or "").split(";")[0].strip().lower()

        is_text = _is_intended_text_upload(declared_mime, ext)

        # Quick reject if neither declared MIME nor extension corresponds to an allowed type
        if not is_text:
            if (
                declared_mime not in ALLOWED_BINARY_MIME_TYPES
                and not (declared_mime in ("", "application/octet-stream") and ext in (IMAGE_EXTENSIONS | PDF_EXTENSIONS))
            ):
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file type: {declared_mime or display_name}",
                )

        per_file_cap = policy.max_text_file_bytes if is_text else policy.max_binary_file_bytes
        remaining_total = policy.max_total_bytes - result.total_bytes

        data = await _read_upload_stream_bounded(
            f,
            display_name=display_name,
            max_file_bytes=per_file_cap,
            remaining_total_bytes=remaining_total,
            max_total_bytes=policy.max_total_bytes,
        )
        result.total_bytes += len(data)

        # Deduplicate byte-identical attachments within the same request
        digest = hashlib.sha256(data).hexdigest()
        if digest in seen_hashes:
            result.deduplicated_count += 1
            logger.info(f"Skipped duplicate uploaded file '{display_name}' (sha256={digest[:12]})")
            continue
        seen_hashes.add(digest)

        if is_text:
            # Make sure someone didn't rename a PDF/EXE/PNG to .txt
            sniffed = sniff_binary_mime(data)
            if sniffed is not None:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{display_name}' has extension '{ext or '.txt'}' but contains '{sniffed}' binary data.",
                )
            text_content = inspect_and_decode_text_bytes(data, display_name)
            if accumulated_text_chars + len(text_content) > policy.max_uploaded_text_chars:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Uploaded text files exceed the maximum text length "
                        f"({policy.max_uploaded_text_chars:,} characters total)."
                    ),
                )
            accumulated_text_chars += len(text_content)
            result.extracted_documents.append((display_name, text_content))
            result.text_file_count += 1
            continue

        # Binary file (Image or PDF): verify real magic bytes!
        real_mime = sniff_binary_mime(data)
        if real_mime is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"'{display_name}' failed file signature verification "
                    f"(corrupted file or disguised unsupported format)."
                ),
            )

        # Prevent cross-category spoofing (e.g. claiming application/pdf for an image or vice-versa)
        if declared_mime == "application/pdf" and real_mime != "application/pdf":
            raise HTTPException(
                status_code=400,
                detail=f"'{display_name}' was declared as PDF but its content is '{real_mime}'.",
            )
        if declared_mime in ALLOWED_IMAGE_MIME_TYPES and real_mime == "application/pdf":
            raise HTTPException(
                status_code=400,
                detail=f"'{display_name}' was declared as an image but its content is a PDF.",
            )
        if ext == ".pdf" and real_mime != "application/pdf":
            raise HTTPException(
                status_code=400,
                detail=f"'{display_name}' has a .pdf extension but is not a valid PDF document.",
            )
        if ext in IMAGE_EXTENSIONS and real_mime not in ALLOWED_IMAGE_MIME_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"'{display_name}' has an image extension ({ext}) but is not a valid image.",
            )

        if real_mime in ALLOWED_IMAGE_MIME_TYPES:
            inspect_image_dimensions(data, real_mime, display_name)
            result.binary_files.append((data, real_mime))
            result.image_count += 1
        elif real_mime == "application/pdf":
            remaining_pages = policy.max_pdf_pages - result.total_pdf_pages
            pages = inspect_pdf_structure(
                data,
                display_name=display_name,
                max_pages_allowed=remaining_pages,
                cumulative_limit=policy.max_pdf_pages,
            )
            result.total_pdf_pages += pages
            result.binary_files.append((data, real_mime))
            result.pdf_count += 1

    return result
