"""
Pixel-bomb protection for every Pillow decode of untrusted image bytes.

A ~100 KB PNG can declare 13k x 13k pixels and needs >1 GB of RAM to decode, which OOM-kills the
single backend process. Every decode site therefore reads the dimensions from the header first
(pure-Python sniffing; Pillow's own `Image.open` is only used for formats where it is header-only)
and refuses anything over the caps below, for every caller including admins and BYOK users.
"""
import io
import logging
import os
import struct
from typing import Iterable, Optional, Tuple

from PIL import Image

logger = logging.getLogger(__name__)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if raw:
        try:
            val = int(raw)
            if val > 0:
                return val
        except ValueError:
            pass
    return default


# Inline timeline images (data: URLs on articles, AI/model output, photo-import AI thumbnails).
# Legit clients downscale to <=1600 px before sending, so 12 MP leaves plenty of headroom.
MAX_INLINE_IMAGE_PIXELS = _env_int("MAX_INLINE_IMAGE_PIXELS", 12_000_000)
MAX_IMAGE_SIDE = _env_int("MAX_IMAGE_SIDE", 8192)
# Hosted photo uploads: the client sends <=1280 px, but direct camera images (24 MP, 6000x4000)
# within the 2 MB byte cap stay accepted; the server re-encodes them down to 2048 px.
MAX_HOSTED_PHOTO_PIXELS = _env_int("MAX_HOSTED_PHOTO_PIXELS", 24_000_000)
MAX_HOSTED_PHOTO_SIDE = _env_int("MAX_HOSTED_PHOTO_SIDE", 12_000)
# Process-wide Pillow backstop for any decode path that forgets the explicit check: Pillow warns
# above this and raises DecompressionBombError above twice this.
PIL_MAX_IMAGE_PIXELS = _env_int("PIL_MAX_IMAGE_PIXELS", 40_000_000)

# Pillow plugins we ever need to open; restricting them keeps exotic parsers off untrusted input.
SAFE_PIL_FORMATS: Tuple[str, ...] = ("PNG", "JPEG", "WEBP", "GIF", "BMP")


class ImageTooLargeError(ValueError):
    """The image header declares more pixels than the caller's safety cap allows."""


def install_pillow_pixel_limit() -> None:
    """Lowers Pillow's global decompression-bomb threshold (idempotent)."""
    current = Image.MAX_IMAGE_PIXELS
    if current is None or current > PIL_MAX_IMAGE_PIXELS:
        Image.MAX_IMAGE_PIXELS = PIL_MAX_IMAGE_PIXELS


install_pillow_pixel_limit()


def _sniff_png(data: bytes) -> Optional[Tuple[int, int]]:
    if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR":
        return struct.unpack(">II", data[16:24])
    return None


def _sniff_gif(data: bytes) -> Optional[Tuple[int, int]]:
    if len(data) >= 10 and data[:6] in (b"GIF87a", b"GIF89a"):
        return struct.unpack("<HH", data[6:10])
    return None


def _sniff_webp(data: bytes) -> Optional[Tuple[int, int]]:
    if len(data) < 30 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    chunk = data[12:16]
    if chunk == b"VP8 " and data[23:26] == b"\x9d\x01\x2a":
        w, h = struct.unpack("<HH", data[26:30])
        return w & 0x3FFF, h & 0x3FFF
    if chunk == b"VP8L" and data[20] == 0x2F:
        bits = struct.unpack("<I", data[21:25])[0]
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if chunk == b"VP8X":
        w = (data[24] | (data[25] << 8) | (data[26] << 16)) + 1
        h = (data[27] | (data[28] << 8) | (data[29] << 16)) + 1
        return w, h
    return None


def _sniff_jpeg(data: bytes) -> Optional[Tuple[int, int]]:
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    idx, n = 2, len(data)
    while idx + 4 <= n:
        if data[idx] != 0xFF:
            idx += 1
            continue
        while idx < n and data[idx] == 0xFF:
            idx += 1
        if idx >= n:
            break
        marker = data[idx]
        idx += 1
        if marker in (0xD8, 0xD9, 0x01) or 0xD0 <= marker <= 0xD7:
            continue
        if marker == 0xDA or idx + 2 > n:
            break
        seg_len = struct.unpack(">H", data[idx:idx + 2])[0]
        if seg_len < 2:
            break
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            if idx + 7 <= n:
                h, w = struct.unpack(">HH", data[idx + 3:idx + 7])
                return w, h
            break
        idx += seg_len
    return None


def sniff_image_size(data: bytes) -> Optional[Tuple[int, int]]:
    """(width, height) parsed from PNG / GIF / WebP / JPEG headers without Pillow, else None."""
    if not data:
        return None
    for sniff in (_sniff_png, _sniff_jpeg, _sniff_webp, _sniff_gif):
        size = sniff(data)
        if size is not None:
            return size
    return None


def _within(size: Tuple[int, int], max_pixels: int, max_side: int) -> bool:
    w, h = size
    return 0 < w <= max_side and 0 < h <= max_side and w * h <= max_pixels


def open_image_checked(
    data: bytes,
    *,
    max_pixels: int = MAX_INLINE_IMAGE_PIXELS,
    max_side: int = MAX_IMAGE_SIDE,
    formats: Iterable[str] = SAFE_PIL_FORMATS,
) -> "Image.Image":
    """
    Opens `data` lazily (nothing decoded yet) after verifying its declared size is within the caps.
    Raises ImageTooLargeError for oversized images and ValueError for unreadable ones.
    """
    size = sniff_image_size(data)
    if size is None and data[:4] == b"RIFF":
        # Pillow's WebP plugin allocates full canvas buffers inside Image.open itself.
        raise ValueError("Unreadable WebP header.")
    if size is not None and not _within(size, max_pixels, max_side):
        raise ImageTooLargeError(f"Image {size[0]}x{size[1]} exceeds the safety limit.")
    try:
        img = Image.open(io.BytesIO(data), formats=list(formats))
    except Image.DecompressionBombError as e:
        raise ImageTooLargeError("Image exceeds the safety limit.") from e
    except Exception as e:
        raise ValueError("Unreadable image.") from e
    if not _within(img.size, max_pixels, max_side):
        img.close()
        raise ImageTooLargeError(f"Image {img.size[0]}x{img.size[1]} exceeds the safety limit.")
    return img
