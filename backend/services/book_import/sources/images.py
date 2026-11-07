"""Image sources (scans / phone photos of pages): safe decoding, orientation, sizing for the model."""

from __future__ import annotations

from typing import Tuple

from PIL import Image

from .. import photos as ph

MAX_PIXELS = 60_000_000
MAX_SIDE = 12_000
WORKING_MAX_PX = 4000  # the normalized page image kept for crops


def load_page_image(data: bytes) -> Image.Image:
    """Decodes an uploaded page image with the pixel-bomb guard, applies EXIF orientation and caps the
    working size (photos are cropped from this image, the model gets a smaller copy)."""
    from services.image_safety import open_image_checked

    img = open_image_checked(data, max_pixels=MAX_PIXELS, max_side=MAX_SIDE, formats=("JPEG", "PNG", "WEBP"))
    img.load()
    img = ph.exif_upright(img).convert("RGB")
    return ph.fit_long_edge(img, WORKING_MAX_PX)


def size_of(img: Image.Image) -> Tuple[int, int]:
    return img.size
