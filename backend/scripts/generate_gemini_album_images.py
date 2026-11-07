"""
Generate authentic, era-accurate album photographs for ChroniX Personal Demo Timelines
using Gemini Image AI (gemini-3.1-flash-image) with persistent character physical anchors
and upload directly to Supabase Storage (`library-media`).

Safe, Resumable & Rate-Limited:
- Checks Supabase Storage HEAD before each image; skips already-uploaded images.
- Supports additionalImages (2 extra photos per event for the RV trip slideshow showcase).
- Can run for a single timeline (--timeline-id), all Hebrew (--lang he), or everything (--all).
"""

import argparse
import asyncio
import copy
import io
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BACKEND_DIR = Path(__file__).resolve().parents[1]
from dotenv import load_dotenv

load_dotenv(BACKEND_DIR / ".env")
sys.path.insert(0, str(BACKEND_DIR))

import httpx
from PIL import Image, ImageOps
from google.genai import types

from models import TimelineData
from services import gemini_service, storage
from scripts.personal_demos.album_prompts import build_coherent_album_prompt
from scripts.personal_demos.rv_trip_en import RV_TRIP_EN
from scripts.personal_demos.rv_extra_images import RV_EXTRA_IMAGES_SPEC

RV_EN_BY_INDEX = {idx: art for idx, art in enumerate(RV_TRIP_EN["articles"], start=1)}

BUCKET_NAME = "library-media"
MODEL_NAME = "gemini-3.1-flash-image"


def _normalize_jpeg_16x9(raw_bytes: bytes, width: int = 1024, height: int = 576, quality: int = 86) -> bytes:
    with Image.open(io.BytesIO(raw_bytes)) as im:
        if im.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", im.size, (255, 255, 255))
            rgba = im.convert("RGBA")
            bg.paste(rgba, mask=rgba.split()[3])
            im = bg
        elif im.mode != "RGB":
            im = im.convert("RGB")
        fitted = ImageOps.fit(im, (width, height), method=Image.Resampling.LANCZOS)
        out = io.BytesIO()
        fitted.save(out, format="JPEG", quality=quality, optimize=True)
        return out.getvalue()


async def generate_single_gemini_image(
    client: Any,
    prompt: str,
    title: str,
    max_retries: int = 4,
) -> bytes:
    """Invokes Gemini multimodal image generation with exponential backoff on rate limits."""
    last_err = None
    for attempt in range(max_retries):
        try:
            resp = await client.aio.models.generate_content(
                model=MODEL_NAME,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"],
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(
                        disable=True, maximum_remote_calls=None
                    ),
                ),
            )
            extracted = gemini_service._extract_image_bytes_from_response(resp)
            if extracted and extracted[0]:
                return extracted[0]
            refusal = gemini_service._extract_image_refusal_reason(resp)
            raise ValueError(f"Gemini returned no image data ({refusal or 'empty parts'})")
        except Exception as err:
            err_msg = str(err)
            last_err = err
            if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg or "quota" in err_msg.lower():
                wait_sec = 15.0 * (attempt + 1)
                print(f"    [rate-limit 429] Waiting {wait_sec:.0f}s before retry ({attempt + 1}/{max_retries})...")
                await asyncio.sleep(wait_sec)
            else:
                print(f"    [error] Attempt {attempt + 1} failed for '{title[:30]}': {err_msg[:120]}")
                await asyncio.sleep(5.0)

    raise last_err or RuntimeError(f"Failed generating image for '{title}'")


async def _ensure_extra_image(
    client: Any,
    storage_client: httpx.AsyncClient,
    supabase_url: str,
    storage_headers: Dict[str, str],
    idx: int,
    extra_idx: int,
    spec: Dict[str, str],
    is_he: bool,
) -> Dict[str, Any]:
    extra_obj_path = f"personal-demos/rv-trip-shared/day-{idx}-extra-{extra_idx}.jpg"
    extra_public_url = f"{supabase_url}/storage/v1/object/public/{BUCKET_NAME}/{extra_obj_path}"
    caption = spec["caption_he"] if is_he else spec["caption_en"]

    try:
        h_resp = await storage_client.head(extra_public_url)
        if h_resp.status_code == 200:
            return {
                "item": {"url": extra_public_url, "caption": caption, "imageSource": "ai"},
                "generated": False,
            }
    except Exception:
        pass

    full_extra_prompt = (
        f"{spec['prompt']}\n\n"
        "CRITICAL: Single seamless 16:9 documentary photograph. "
        "Absolutely NO text overlays, watermarks, borders, frames, or collages."
    )
    t_ex_start = time.time()
    ex_raw = await generate_single_gemini_image(client, full_extra_prompt, f"day-{idx}-extra-{extra_idx}")
    ex_jpeg = await asyncio.to_thread(_normalize_jpeg_16x9, ex_raw)
    ex_up = await storage_client.post(
        f"{supabase_url}/storage/v1/object/{BUCKET_NAME}/{extra_obj_path}",
        headers={
            **storage_headers,
            "Content-Type": "image/jpeg",
            "x-upsert": "true",
            "Cache-Control": "31536000",
        },
        content=ex_jpeg,
    )
    if ex_up.status_code not in (200, 201):
        raise RuntimeError(f"Extra storage upload failed ({ex_up.status_code}): {ex_up.text[:140]}")
    print(f"    [extra {extra_idx}/2] Generated day-{idx}-extra-{extra_idx} in {time.time() - t_ex_start:.1f}s ({len(ex_jpeg) // 1024} KB)")
    return {
        "item": {"url": extra_public_url, "caption": caption, "imageSource": "ai"},
        "generated": True,
    }


async def process_timeline(
    timeline_id: str,
    supabase_url: str,
    service_key: str,
    gemini_key: str,
    cover_article_id: Optional[str] = None,
) -> None:
    client = gemini_service.get_gemini_client(gemini_key)
    tl_raw = storage.get_timeline_by_id(timeline_id)
    if not tl_raw:
        print(f"[skip] Timeline {timeline_id} not found in DB")
        return

    articles = tl_raw.get("articles") or []
    print(f"\n========================================================")
    print(f"Processing '{tl_raw.get('title')}' ({timeline_id})")
    print(f"Total events: {len(articles)}")
    print(f"========================================================")

    storage_headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }

    updated_count = 0
    reused_count = 0
    t0 = time.time()

    async with httpx.AsyncClient(timeout=30.0) as storage_client:
        for idx, art in enumerate(articles, start=1):
            art_id = art["id"]
            title = art.get("title", "")
            subtitle = art.get("subtitle", "")
            f_obj = art.get("from") or {}
            year = f_obj.get("year") if isinstance(f_obj, dict) else None
            loc = art.get("locationName")

            obj_path = f"personal-demos/{timeline_id}/{art_id}.jpg"
            public_url = f"{supabase_url}/storage/v1/object/public/{BUCKET_NAME}/{obj_path}"

            main_reused = False
            try:
                head_resp = await storage_client.head(public_url)
                if head_resp.status_code == 200:
                    art["imageUrl"] = public_url
                    art["imageSource"] = "ai"
                    art["imageModel"] = MODEL_NAME
                    art["imageCostUsd"] = 0.03
                    reused_count += 1
                    main_reused = True
                    print(f"  [{idx}/{len(articles)}] Reused main: {art_id} ({title[:35]})")
            except Exception:
                pass

            if not main_reused:
                prompt_title = title
                prompt_subtitle = subtitle
                prompt_loc = loc
                if "rv-trip" in timeline_id and idx in RV_EN_BY_INDEX:
                    en_art = RV_EN_BY_INDEX[idx]
                    prompt_title = en_art.get("title", title)
                    prompt_subtitle = en_art.get("subtitle", subtitle)
                    prompt_loc = en_art.get("locationName", loc)

                prompt = build_coherent_album_prompt(
                    timeline_id=timeline_id,
                    title=prompt_title,
                    subtitle=prompt_subtitle,
                    year=year,
                    location_name=prompt_loc,
                )

                print(f"  [{idx}/{len(articles)}] Generating: {art_id} ({year or 'undated'}) - '{title[:40]}'...")
                t_gen_start = time.time()
                raw_bytes = await generate_single_gemini_image(client, prompt, prompt_title)
                jpeg_bytes = await asyncio.to_thread(_normalize_jpeg_16x9, raw_bytes)

                # Upload to Supabase Storage
                up_resp = await storage_client.post(
                    f"{supabase_url}/storage/v1/object/{BUCKET_NAME}/{obj_path}",
                    headers={
                        **storage_headers,
                        "Content-Type": "image/jpeg",
                        "x-upsert": "true",
                        "Cache-Control": "31536000",
                    },
                    content=jpeg_bytes,
                )
                if up_resp.status_code not in (200, 201):
                    raise RuntimeError(f"Storage upload failed ({up_resp.status_code}): {up_resp.text[:140]}")

                # Mirror shared North America RV trip images between HE & EN timelines
                if timeline_id == "demo-personal-en-rv-trip":
                    mirror_path = f"personal-demos/demo-personal-he-rv-trip/rv-he-{idx}.jpg"
                    await storage_client.post(
                        f"{supabase_url}/storage/v1/object/{BUCKET_NAME}/{mirror_path}",
                        headers={
                            **storage_headers,
                            "Content-Type": "image/jpeg",
                            "x-upsert": "true",
                            "Cache-Control": "31536000",
                        },
                        content=jpeg_bytes,
                    )
                elif timeline_id == "demo-personal-he-rv-trip":
                    mirror_path = f"personal-demos/demo-personal-en-rv-trip/rv-en-{idx}.jpg"
                    await storage_client.post(
                        f"{supabase_url}/storage/v1/object/{BUCKET_NAME}/{mirror_path}",
                        headers={
                            **storage_headers,
                            "Content-Type": "image/jpeg",
                            "x-upsert": "true",
                            "Cache-Control": "31536000",
                        },
                        content=jpeg_bytes,
                    )

                art["imageUrl"] = public_url
                art["imageSource"] = "ai"
                art["imageModel"] = MODEL_NAME
                art["imageCostUsd"] = 0.03
                updated_count += 1
                print(f"    -> Done in {time.time() - t_gen_start:.1f}s ({len(jpeg_bytes) // 1024} KB JPEG)")
                await asyncio.sleep(2.0)

            # Generate or attach 2 additional images per event for the RV trip slideshow showcase
            if "rv-trip" in timeline_id and idx in RV_EXTRA_IMAGES_SPEC:
                is_he = "-he-" in timeline_id
                specs = RV_EXTRA_IMAGES_SPEC[idx]
                results = await asyncio.gather(
                    *[
                        _ensure_extra_image(
                            client=client,
                            storage_client=storage_client,
                            supabase_url=supabase_url,
                            storage_headers=storage_headers,
                            idx=idx,
                            extra_idx=e_idx,
                            spec=sp,
                            is_he=is_he,
                        )
                        for e_idx, sp in enumerate(specs, start=1)
                    ]
                )
                art["additionalImages"] = [r["item"] for r in results]
                gen_any = any(r["generated"] for r in results)
                for r in results:
                    if r["generated"]:
                        updated_count += 1
                    else:
                        reused_count += 1
                if gen_any:
                    await asyncio.sleep(1.5)

    # Choose cover image
    chosen_cover = None
    if cover_article_id:
        for a in articles:
            if a["id"] == cover_article_id and a.get("imageUrl"):
                chosen_cover = a["imageUrl"]
                break
    if not chosen_cover and articles and articles[0].get("imageUrl"):
        chosen_cover = articles[0]["imageUrl"]

    if chosen_cover:
        tl_raw["coverImageUrl"] = chosen_cover

    # Persist updated timeline to DB
    validated = TimelineData.model_validate(tl_raw)
    payload = validated.model_dump(by_alias=True, exclude_none=True)
    storage.save_timeline_data(payload, user_id=None)
    storage.set_timeline_library_status(
        timeline_id,
        is_library=True,
        is_featured=tl_raw.get("isFeatured", False),
        featured_order=tl_raw.get("featuredOrder"),
        cover_image_url=chosen_cover,
    )
    print(f"Saved {timeline_id} to Supabase with {len(articles)} events! (Generated={updated_count}, Reused={reused_count}, Total Time={time.time() - t0:.1f}s)\n")


async def main():
    parser = argparse.ArgumentParser(description="Generate coherent album photos with Gemini Image AI")
    parser.add_argument("--timeline-id", type=str, help="Specific timeline ID to generate for")
    parser.add_argument("--lang", type=str, choices=["he", "en", "all"], default="he", help="Language group to generate for")
    parser.add_argument("--limit-events", type=int, default=None, help="Limit number of events per timeline (useful for quick visual testing)")
    args = parser.parse_args()

    supabase_url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    service_key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    gemini_key = (os.getenv("GEMINI_API_KEY") or "").strip()

    if not supabase_url or not service_key:
        raise RuntimeError("Missing SUPABASE credentials in backend/.env")
    if not gemini_key:
        raise RuntimeError("Missing GEMINI_API_KEY in backend/.env")

    # Map of flagship timelines and preferred cover events
    COVER_MAP = {
        "demo-personal-he-rv-trip": "rv-he-14",       # Monument Valley RV sunrise
        "demo-personal-en-rv-trip": "rv-en-14",       # Monument Valley RV sunrise
        "demo-personal-he-grandpa": "gp-he-14",       # 1948 reunion on Nahariya beach
        "demo-personal-he-grandma": "gm-he-18",       # 1949 concert for wounded soldiers
        "demo-personal-he-shared-family": "sh-he-3",  # 1964 rooftop wedding in Rehavia
        "demo-personal-he-wedding": "wd-he-27",       # 2024 sunrise proposal at Mitzpe Ramon
        "demo-personal-he-life80": "lf-he-30",        # 2026 80th birthday at Kinneret
        "demo-personal-he-kids": "kd-he-17",          # 2021 backyard treehouse building
        "demo-personal-en-grandpa": "gp-en-14",
        "demo-personal-en-grandma": "gm-en-16",
        "demo-personal-en-shared-family": "sh-en-3",
        "demo-personal-en-wedding": "wd-en-27",
        "demo-personal-en-life80": "lf-en-30",
        "demo-personal-en-kids": "kd-en-17",
    }

    timelines_to_run = []
    if args.timeline_id:
        timelines_to_run = [args.timeline_id]
    elif args.lang == "he":
        timelines_to_run = [
            "demo-personal-he-rv-trip",
            "demo-personal-he-grandpa",
            "demo-personal-he-grandma",
            "demo-personal-he-shared-family",
            "demo-personal-he-wedding",
            "demo-personal-he-life80",
            "demo-personal-he-kids",
        ]
    elif args.lang == "en":
        timelines_to_run = [
            "demo-personal-en-rv-trip",
            "demo-personal-en-grandpa",
            "demo-personal-en-grandma",
            "demo-personal-en-shared-family",
            "demo-personal-en-wedding",
            "demo-personal-en-life80",
            "demo-personal-en-kids",
        ]
    else:
        timelines_to_run = list(COVER_MAP.keys())

    for tid in timelines_to_run:
        await process_timeline(
            timeline_id=tid,
            supabase_url=supabase_url,
            service_key=service_key,
            gemini_key=gemini_key,
            cover_article_id=COVER_MAP.get(tid),
        )

    storage.invalidate_library_cache()
    print("ALL REQUESTED TIMELINES COMPLETED SUCCESSFULLY!")


if __name__ == "__main__":
    asyncio.run(main())
