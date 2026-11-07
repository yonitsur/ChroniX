"""
Seed the curated Personal Timeline demos (6 Hebrew + 6 English individual timelines,
25-40 events each, without AI images so the curator can add custom images manually)
into the ChroniX Public Library.

Also supports `--build-merged-from-db` to build & publish the 3-layer pre-merged Family Trilogy
(`demo-personal-he-trilogy-merged` & `demo-personal-en-trilogy-merged`) directly from the live
Supabase rows AFTER the curator has added images to the 3 individual family timelines.
"""

import argparse
import copy
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BACKEND_DIR = Path(__file__).resolve().parents[1]
from dotenv import load_dotenv

load_dotenv(BACKEND_DIR / ".env")
sys.path.insert(0, str(BACKEND_DIR))

import httpx
from models import TimelineData
from services import storage

from scripts.personal_demos.trilogy_he import (
    GRANDPA_HE,
    GRANDMA_HE,
    SHARED_FAMILY_HE,
    TRILOGY_MERGED_META_HE,
)
from scripts.personal_demos.trilogy_en import (
    GRANDPA_EN,
    GRANDMA_EN,
    SHARED_FAMILY_EN,
    TRILOGY_MERGED_META_EN,
)
from scripts.personal_demos.milestones_he import WEDDING_HE, LIFE80_HE, KIDS_HE
from scripts.personal_demos.milestones_en import WEDDING_EN, LIFE80_EN, KIDS_EN
from scripts.personal_demos.rv_trip_he import RV_TRIP_HE
from scripts.personal_demos.rv_trip_en import RV_TRIP_EN

LAYER_ACCENT_COLORS = [
    "#2563a2",  # Prussian Blue
    "#2e6b56",  # Deep Sage
    "#b87326",  # Burnished Ochre
    "#6e395e",  # Imperial Plum
]


def _strip_all_images(tl: Dict[str, Any]) -> None:
    """Ensure no AI or placeholder images remain on the timeline or any of its articles."""
    for key in (
        "coverImageUrl",
        "cover_image_url",
        "coverImagePositionX",
        "coverImagePositionY",
        "cover_image_position_x",
        "cover_image_position_y",
    ):
        tl.pop(key, None)
    for art in tl.get("articles") or []:
        for k in (
            "_image_prompt",
            "imageUrl",
            "imageSource",
            "image_source",
            "imageModel",
            "image_model",
            "imageCostUsd",
            "image_cost_usd",
            "imagePositionX",
            "imagePositionY",
        ):
            art.pop(k, None)


def _compute_bounds(articles: List[Dict[str, Any]]) -> Tuple[Optional[int], Optional[int]]:
    min_y: Optional[int] = None
    max_y: Optional[int] = None
    for a in articles:
        for k in ("from", "to"):
            obj = a.get(k)
            if isinstance(obj, dict) and isinstance(obj.get("year"), int):
                y = obj["year"]
                min_y = y if min_y is None else min(min_y, y)
                max_y = y if max_y is None else max(max_y, y)
    return min_y, max_y


def build_merged_timeline(sources: List[Dict[str, Any]], merged_meta: Dict[str, Any]) -> Dict[str, Any]:
    """
    Python mirror of `frontend/src/utils/mergeTimelines.js` (`expandSubLanes=False`) so
    `TimelineLayerBar` and `extractSourceTimelines` work seamlessly on load.
    """
    lanes: List[Dict[str, Any]] = []
    merged_articles: List[Dict[str, Any]] = []
    merged_bands: List[Dict[str, Any]] = []
    merged_sources: List[Dict[str, Any]] = []
    all_tags: List[str] = []
    chat_questions: List[str] = []

    for idx, src in enumerate(sources):
        layer_num = idx + 1
        layer_id = f"layer-{layer_num}"
        prefix = f"L{layer_num}__"
        layer_color = LAYER_ACCENT_COLORS[idx % len(LAYER_ACCENT_COLORS)]
        src_title = src["title"]
        raw_sub_lanes = copy.deepcopy(src.get("lanes") or [])
        sub_lane_map = {str(l["id"]): l for l in raw_sub_lanes if l.get("id")}

        lanes.append(
            {
                "id": layer_id,
                "title": src_title,
                "color": layer_color,
                "order": idx,
            }
        )

        src_articles = src.get("articles") or []
        for art in src_articles:
            orig_lane_id = str(art.get("lane")) if art.get("lane") else None
            orig_sub = sub_lane_map.get(orig_lane_id) if orig_lane_id else None
            orig_cat = art.get("category")
            effective_cat = orig_cat or (orig_sub["title"] if orig_sub else None)

            art_copy = copy.deepcopy(art)
            art_copy.update(
                {
                    "id": f"{prefix}{art['id']}",
                    "lane": layer_id,
                    "category": effective_cat,
                    "sourceLayerId": layer_id,
                    "sourceTimelineId": src["id"],
                    "sourceTimelineTitle": src_title,
                    "_origCategory": orig_cat,
                    "_origSubLaneId": orig_lane_id,
                    "_origSubLaneTitle": orig_sub["title"] if orig_sub else None,
                }
            )
            merged_articles.append(art_copy)

        for tb in src.get("timeBands") or []:
            tb_copy = copy.deepcopy(tb)
            tb_copy["id"] = f"{prefix}{tb['id']}"
            tb_copy["title"] = f"{src_title}: {tb['title']}"
            tb_copy["sourceLayerId"] = layer_id
            merged_bands.append(tb_copy)

        min_y, max_y = _compute_bounds(src_articles)
        merged_sources.append(
            {
                "id": src["id"],
                "title": src_title,
                "description": src.get("description", ""),
                "overview": src.get("overview", ""),
                "color": layer_color,
                "articleCount": len(src_articles),
                "laneId": layer_id,
                "laneIds": [layer_id],
                "minYear": min_y,
                "maxYear": max_y,
                "timeScale": "calendar",
                "contentMode": src.get("contentMode", "classic"),
                "detectedLanguage": src.get("detectedLanguage", "en"),
                "isPersonal": True,
                "isFictional": False,
                "subLanes": raw_sub_lanes,
                "categories": ["Personal & Family Stories"],
                "tags": copy.deepcopy(src.get("tags") or []),
            }
        )

        for t_item in src.get("tags") or []:
            if t_item not in all_tags and len(all_tags) < 8:
                all_tags.append(t_item)
        for cq in src.get("chatQuestions") or []:
            if cq not in chat_questions and len(chat_questions) < 6:
                chat_questions.append(cq)

    return {
        "id": merged_meta["id"],
        "title": merged_meta["title"],
        "description": merged_meta["description"],
        "overview": merged_meta["overview"],
        "timeScale": "calendar",
        "lanes": lanes,
        "timeBands": merged_bands,
        "articles": merged_articles,
        "categories": ["Personal & Family Stories"],
        "tags": all_tags,
        "chatQuestions": chat_questions,
        "detectedLanguage": sources[0].get("detectedLanguage", "en"),
        "contentMode": "classic",
        "creationSource": "merged",
        "mergedSources": merged_sources,
        "subLanesExpanded": False,
        "isPersonal": True,
        "isFictional": False,
        "isManual": False,
        "isLibrary": True,
        "quiz": copy.deepcopy(merged_meta.get("quiz") or []),
    }


def _patch_secondary_updated_at(supabase_url: str, service_key: str, timeline_id: str, iso_ts: str) -> None:
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    with httpx.Client(timeout=15.0) as client:
        resp = client.patch(
            f"{supabase_url}/rest/v1/timelines",
            headers=headers,
            params={"id": f"eq.{timeline_id}"},
            json={"updated_at": iso_ts},
        )
        if resp.status_code not in (200, 204):
            print(f"  [warn] updated_at patch for {timeline_id} returned {resp.status_code}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed ChroniX Personal Library Demo Timelines")
    parser.add_argument(
        "--build-merged-from-db",
        action="store_true",
        help="Build & publish the 3-layer pre-merged Family Trilogy from the live DB source timelines (preserving any images added by the curator).",
    )
    parser.add_argument(
        "--only-ids",
        nargs="*",
        default=None,
        help="Optional list of specific timeline IDs to seed (so existing timelines with images are untouched).",
    )
    args = parser.parse_args()

    supabase_url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    service_key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not supabase_url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env")
    if not storage.get_system_owner_user_id():
        # Unowned (NULL) rows are admin-only editable; set SYSTEM_OWNER_USER_ID to own new seeds instead.
        print("Note: SYSTEM_OWNER_USER_ID is not set; new curated timelines will be saved unowned (admin-only).")

    if args.build_merged_from_db:
        print("Building 3-layer merged Family Trilogy timelines from live Supabase source rows...")
        he_sources = [
            storage.get_timeline_by_id("demo-personal-he-grandpa"),
            storage.get_timeline_by_id("demo-personal-he-grandma"),
            storage.get_timeline_by_id("demo-personal-he-shared-family"),
        ]
        en_sources = [
            storage.get_timeline_by_id("demo-personal-en-grandpa"),
            storage.get_timeline_by_id("demo-personal-en-grandma"),
            storage.get_timeline_by_id("demo-personal-en-shared-family"),
        ]
        if not all(he_sources) or not all(en_sources):
            raise RuntimeError("All 6 source trilogy timelines must exist in DB before running --build-merged-from-db")

        merged_he = build_merged_timeline(he_sources, TRILOGY_MERGED_META_HE)
        merged_en = build_merged_timeline(en_sources, TRILOGY_MERGED_META_EN)
        for tl in (merged_he, merged_en):
            tid = tl["id"]
            tl["authorName"] = "ChroniX Curators"
            tl["isFeatured"] = True
            tl["featuredOrder"] = 0
            cover_candidates = [a["imageUrl"] for a in tl["articles"] if a.get("imageUrl")]
            cover_url = cover_candidates[0] if cover_candidates else None
            if cover_url:
                tl["coverImageUrl"] = cover_url
            validated = TimelineData.model_validate(tl)
            payload = validated.model_dump(by_alias=True, exclude_none=True)
            storage.save_timeline_data(payload, user_id=storage.get_system_owner_user_id())
            storage.set_timeline_shared(tid, "", True, author_name="ChroniX Curators")
            storage.set_timeline_library_status(
                tid, is_library=True, is_featured=True, featured_order=0, cover_image_url=cover_url
            )
            print(f"  [published merged] {tid} | events={len(tl['articles'])} | cover={bool(cover_url)}")
        storage.invalidate_library_cache()
        return

    source_timelines = [
        copy.deepcopy(GRANDPA_HE),
        copy.deepcopy(GRANDMA_HE),
        copy.deepcopy(SHARED_FAMILY_HE),
        copy.deepcopy(GRANDPA_EN),
        copy.deepcopy(GRANDMA_EN),
        copy.deepcopy(SHARED_FAMILY_EN),
        copy.deepcopy(WEDDING_HE),
        copy.deepcopy(WEDDING_EN),
        copy.deepcopy(LIFE80_HE),
        copy.deepcopy(LIFE80_EN),
        copy.deepcopy(KIDS_HE),
        copy.deepcopy(KIDS_EN),
        copy.deepcopy(RV_TRIP_HE),
        copy.deepcopy(RV_TRIP_EN),
    ]

    publish_plan: Dict[str, Dict[str, Any]] = {
        "demo-personal-he-rv-trip": {
            "featured": True,
            "order": None,
        },
        "demo-personal-en-rv-trip": {
            "featured": True,
            "order": None,
        },
        "demo-personal-he-shared-family": {
            "featured": True,
            "order": 0,
        },
        "demo-personal-he-wedding": {
            "featured": True,
            "order": 1,
        },
        "demo-personal-he-life80": {
            "featured": False,
            "order": None,
            "archive_ts": "2025-01-15T12:00:00Z",
        },
        "demo-personal-he-kids": {
            "featured": False,
            "order": None,
            "archive_ts": "2025-01-14T18:00:00Z",
        },
        "demo-personal-he-grandpa": {
            "featured": False,
            "order": None,
            "archive_ts": "2025-01-13T12:00:00Z",
        },
        "demo-personal-he-grandma": {
            "featured": False,
            "order": None,
            "archive_ts": "2025-01-12T12:00:00Z",
        },
        "demo-personal-en-shared-family": {
            "featured": True,
            "order": 0,
        },
        "demo-personal-en-wedding": {
            "featured": True,
            "order": 1,
        },
        "demo-personal-en-life80": {
            "featured": False,
            "order": None,
            "archive_ts": "2025-01-15T12:00:00Z",
        },
        "demo-personal-en-kids": {
            "featured": False,
            "order": None,
            "archive_ts": "2025-01-14T18:00:00Z",
        },
        "demo-personal-en-grandpa": {
            "featured": False,
            "order": None,
            "archive_ts": "2025-01-13T12:00:00Z",
        },
        "demo-personal-en-grandma": {
            "featured": False,
            "order": None,
            "archive_ts": "2025-01-12T12:00:00Z",
        },
    }

    if args.only_ids:
        only_set = set(args.only_ids)
        source_timelines = [tl for tl in source_timelines if tl["id"] in only_set]

    print(f"Validating & persisting {len(source_timelines)} Personal Demo timelines (no images) to Supabase...")
    for tl in source_timelines:
        tid = tl["id"]
        assert tid.startswith("demo-personal-"), f"Safety guard: unexpected ID {tid}"
        _strip_all_images(tl)
        plan = publish_plan[tid]

        tl["isPersonal"] = True
        tl["isManual"] = False
        tl["isLibrary"] = True
        tl["authorName"] = "ChroniX Curators"
        tl["isFeatured"] = bool(plan["featured"])
        if plan["order"] is not None:
            tl["featuredOrder"] = plan["order"]
        else:
            tl.pop("featuredOrder", None)

        validated = TimelineData.model_validate(tl)
        payload = validated.model_dump(by_alias=True, exclude_none=True)

        assert 25 <= len(payload["articles"]) <= 45, (
            f"{tid} has {len(payload['articles'])} events (expected 25..40)"
        )

        storage.save_timeline_data(payload, user_id=storage.get_system_owner_user_id())
        storage.set_timeline_shared(tid, "", True, author_name="ChroniX Curators")
        lib_res = storage.set_timeline_library_status(
            tid,
            is_library=True,
            is_featured=bool(plan["featured"]),
            featured_order=plan["order"],
            cover_image_url=None,
        )
        if not lib_res:
            raise RuntimeError(f"Failed publishing {tid} to Public Library")

        if plan.get("archive_ts"):
            _patch_secondary_updated_at(supabase_url, service_key, tid, plan["archive_ts"])

        print(
            f"  [published] {tid} | lang={tl['detectedLanguage']} | mode={tl['contentMode']} "
            f"| events={len(tl['articles'])} | featured={plan['featured']}",
            flush=True,
        )

    storage.invalidate_library_cache()
    items = storage.list_library_timelines(force_refresh=True)
    personal_items = [i for i in items if i.get("isPersonal")]
    print(f"\nDONE! Total Public Library items: {len(items)} (Personal Demo items: {len(personal_items)})")


if __name__ == "__main__":
    main()
