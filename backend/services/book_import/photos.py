"""Image helpers shared by the stages: box math, set-of-marks overlays, crops, dedupe hashes, encoding."""

from __future__ import annotations

import io
from typing import Iterable, List, Optional, Sequence, Tuple

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps, ImageStat

MIN_BOX_SPAN = 15  # 1.5% of the unit: anything smaller isn't a usable photo


def clamp_box(box: Optional[Sequence[int]]) -> Optional[List[int]]:
    """Validates a model box (ymin, xmin, ymax, xmax in 0-1000); swaps inverted edges, drops tiny ones."""
    if not box or len(box) != 4:
        return None
    try:
        y0, x0, y1, x1 = (max(0, min(1000, int(round(float(v))))) for v in box)
    except (TypeError, ValueError):
        return None
    if y1 < y0:
        y0, y1 = y1, y0
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 - y0 < MIN_BOX_SPAN or x1 - x0 < MIN_BOX_SPAN:
        return None
    return [y0, x0, y1, x1]


def box_iou(a: Sequence[int], b: Sequence[int]) -> float:
    iy = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    ix = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = iy * ix
    if inter <= 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / float(area_a + area_b - inter)


def box_to_pixels(box: Sequence[int], width: int, height: int) -> Tuple[int, int, int, int]:
    y0, x0, y1, x1 = box
    return (
        int(round(x0 / 1000 * width)),
        int(round(y0 / 1000 * height)),
        int(round(x1 / 1000 * width)),
        int(round(y1 / 1000 * height)),
    )


def _font(size: int) -> ImageFont.ImageFont:
    for name in ("arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_marks(image: Image.Image, marks: Iterable[Tuple[str, Sequence[int]]]) -> Image.Image:
    """Set-of-marks overlay: a thin magenta outline and a 'P3' chip inside each box, so the model can
    refer to embedded images by label instead of re-deriving their coordinates."""
    out = image.convert("RGB").copy()
    draw = ImageDraw.Draw(out)
    w, h = out.size
    stroke = max(2, round(max(w, h) / 900))
    font = _font(max(14, round(max(w, h) / 85)))
    for label, box in marks:
        x0, y0, x1, y1 = box_to_pixels(box, w, h)
        draw.rectangle([x0, y0, x1, y1], outline=(236, 0, 140), width=stroke)
        tb = draw.textbbox((0, 0), label, font=font)
        tw, th = tb[2] - tb[0], tb[3] - tb[1]
        pad = max(3, stroke * 2)
        cx0, cy0 = x0 + stroke + 2, y0 + stroke + 2
        draw.rectangle([cx0, cy0, cx0 + tw + 2 * pad, cy0 + th + 2 * pad], fill=(236, 0, 140))
        draw.text((cx0 + pad - tb[0], cy0 + pad - tb[1]), label, fill=(255, 255, 255), font=font)
    return out


def crop_box(image: Image.Image, box: Sequence[int], pad: int = 0) -> Image.Image:
    w, h = image.size
    x0, y0, x1, y1 = box_to_pixels(box, w, h)
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(w, x1 + pad), min(h, y1 + pad)
    return image.crop((x0, y0, max(x0 + 1, x1), max(y0 + 1, y1)))


def trim_uniform_border(image: Image.Image, tolerance: int = 18, max_trim_ratio: float = 0.12) -> Image.Image:
    """Removes a near-uniform margin (page paper / scanner bed) around a crop, never more than
    `max_trim_ratio` of either side, so a loose model box tightens onto the photo."""
    rgb = image.convert("RGB")
    w, h = rgb.size
    if w < 40 or h < 40:
        return image
    corner = rgb.getpixel((1, 1))
    bg = Image.new("RGB", rgb.size, corner)
    diff = ImageChops.difference(rgb, bg).convert("L").point(lambda v: 255 if v > tolerance else 0)
    bbox = diff.getbbox()
    if not bbox:
        return image
    x0, y0, x1, y1 = bbox
    max_dx, max_dy = int(w * max_trim_ratio), int(h * max_trim_ratio)
    x0, y0 = min(x0, max_dx), min(y0, max_dy)
    x1, y1 = max(x1, w - max_dx), max(y1, h - max_dy)
    if (x1 - x0) * (y1 - y0) >= 0.98 * w * h:
        return image
    return image.crop((x0, y0, x1, y1))


def perspective_fix(image: Image.Image, corners: Sequence[int]) -> Optional[Image.Image]:
    """Warps a skewed quadrilateral (8 ints y,x for TL, TR, BR, BL in 0-1000 of `image`) to a rectangle."""
    if not corners or len(corners) != 8:
        return None
    w, h = image.size
    try:
        pts = [(float(corners[i + 1]) / 1000 * w, float(corners[i]) / 1000 * h) for i in range(0, 8, 2)]
    except (TypeError, ValueError):
        return None
    (tlx, tly), (trx, try_), (brx, bry), (blx, bly) = pts
    out_w = int(round(max(((trx - tlx) ** 2 + (try_ - tly) ** 2) ** 0.5, ((brx - blx) ** 2 + (bry - bly) ** 2) ** 0.5)))
    out_h = int(round(max(((blx - tlx) ** 2 + (bly - tly) ** 2) ** 0.5, ((brx - trx) ** 2 + (bry - try_) ** 2) ** 0.5)))
    if out_w < 40 or out_h < 40:
        return None
    quad = (tlx, tly, blx, bly, brx, bry, trx, try_)
    return image.transform((out_w, out_h), Image.Transform.QUAD, quad, resample=Image.Resampling.BICUBIC)


def dhash(image: Image.Image, size: int = 8) -> str:
    """Difference hash (64 bits as hex) for near-duplicate photo detection."""
    small = image.convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
    px = list(small.getdata())
    bits = 0
    for row in range(size):
        for col in range(size):
            left = px[row * (size + 1) + col]
            right = px[row * (size + 1) + col + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return f"{bits:0{size * size // 4}x}"


def dhash_distance(a: str, b: str) -> int:
    try:
        return bin(int(a, 16) ^ int(b, 16)).count("1")
    except ValueError:
        return 64


def is_near_flat(image: Image.Image, threshold: float = 6.0) -> bool:
    small = image.convert("L").copy()
    small.thumbnail((64, 64))
    return max(ImageStat.Stat(small).stddev) < threshold


def fit_long_edge(image: Image.Image, max_px: int) -> Image.Image:
    w, h = image.size
    if max(w, h) <= max_px:
        return image
    im = image.copy()
    im.thumbnail((max_px, max_px), Image.Resampling.LANCZOS)
    return im


def encode_webp(image: Image.Image, max_px: int = 2048, quality: int = 82) -> bytes:
    im = fit_long_edge(image.convert("RGB"), max_px)
    buf = io.BytesIO()
    im.save(buf, format="WEBP", quality=quality, method=4)
    return buf.getvalue()


def encode_jpeg(image: Image.Image, max_px: int, quality: int = 88) -> bytes:
    im = fit_long_edge(image.convert("RGB"), max_px)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def rotate_upright(image: Image.Image, clockwise_degrees: int) -> Image.Image:
    deg = int(clockwise_degrees or 0) % 360
    if deg in (90, 180, 270):
        return image.rotate(-deg, expand=True)
    return image


def exif_upright(image: Image.Image) -> Image.Image:
    try:
        return ImageOps.exif_transpose(image)
    except Exception:
        return image
