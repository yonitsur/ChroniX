import json
import os
import re
import logging
from pathlib import Path
from typing import List, Optional
from datetime import datetime
from dotenv import load_dotenv
load_dotenv()
import httpx
from models import TimelineData, TimelineArticle, TimelineDate, TimelineLane, TimelineTimeBand

logger = logging.getLogger("ChroniXStorage")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TIMELINES_FILE = DATA_DIR / "timelines.json"

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Free-tier Supabase projects pause after inactivity and can take 10-30s to cold-start
# on the first request back - a short timeout here silently drops saves to the
# ephemeral local-file fallback, which is wiped on every redeploy.
SUPABASE_TIMEOUT = httpx.Timeout(20.0, connect=10.0)

def _get_supabase_headers():
    if not SUPABASE_SERVICE_ROLE_KEY:
        return None
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json"
    }

def _supabase_is_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)

def ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not TIMELINES_FILE.exists():
        with open(TIMELINES_FILE, "w", encoding="utf-8") as f:
            json.dump([], f, indent=2, ensure_ascii=False)

def get_sample_timeline() -> dict:
    return {
        "id": "sample-us-presidents",
        "title": "Presidents of the United States (Key Figures)",
        "description": "An interactive timeline highlighting transformative presidents in American history.",
        "timeScale": "calendar",
        "lanes": [
            {"id": "early", "title": "18th & 19th Century", "color": "#454b52", "order": 1},
            {"id": "modern", "title": "20th Century", "color": "#2e6b56", "order": 2},
            {"id": "contemporary", "title": "21st Century", "color": "#6e395e", "order": 3}
        ],
        "timeBands": [
            {"id": "founding", "title": "Founding & Civil War Era", "from": {"year": 1789, "precision": "year"}, "to": {"year": 1877, "precision": "year"}, "color": "rgba(43, 82, 120, 0.08)"},
            {"id": "twentieth", "title": "20th Century & Cold War", "from": {"year": 1900, "precision": "year"}, "to": {"year": 1999, "precision": "year"}, "color": "rgba(46, 107, 86, 0.08)"},
            {"id": "twentyfirst", "title": "21st Century", "from": {"year": 2000, "precision": "year"}, "to": {"year": 2026, "precision": "year"}, "color": "rgba(110, 57, 94, 0.08)"}
        ],
        "articles": [
            {
                "id": "george-washington",
                "title": "George Washington",
                "subtitle": "1st U.S. President & Founding Father",
                "lane": "early",
                "from": {"year": 1789, "month": 4, "day": 30, "precision": "day"},
                "to": {"year": 1797, "month": 3, "day": 4, "precision": "day"},
                "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Gilbert_Stuart_Williamstown_Portrait_of_George_Washington.jpg/440px-Gilbert_Stuart_Williamstown_Portrait_of_George_Washington.jpg",
                "wikiTitle": "George Washington",
                "wikiUrl": "https://en.wikipedia.org/wiki/George_Washington",
                "extract": "George Washington was an American military officer, statesman, and Founding Father who served as the first president of the United States from 1789 to 1797.",
                "rank": 10,
                "locationName": "Philadelphia & Mount Vernon, USA",
                "lat": 38.7081,
                "lng": -77.0861,
                "googleMapsUrl": "https://www.google.com/maps/search/?api=1&query=38.7081,-77.0861"
            },
            {
                "id": "abraham-lincoln",
                "title": "Abraham Lincoln",
                "subtitle": "16th U.S. President, Civil War & Emancipation",
                "lane": "early",
                "from": {"year": 1861, "month": 3, "day": 4, "precision": "day"},
                "to": {"year": 1865, "month": 4, "day": 15, "precision": "day"},
                "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Abraham_Lincoln_O-77_matte_collodion_print.jpg/440px-Abraham_Lincoln_O-77_matte_collodion_print.jpg",
                "wikiTitle": "Abraham Lincoln",
                "wikiUrl": "https://en.wikipedia.org/wiki/Abraham_Lincoln",
                "extract": "Abraham Lincoln was an American lawyer, politician, and statesman who served as the 16th president of the United States from 1861 until his assassination in 1865. Lincoln led the nation through the American Civil War and issued the Emancipation Proclamation.",
                "rank": 10,
                "locationName": "Washington D.C. & Springfield, USA",
                "lat": 38.8977,
                "lng": -77.0365,
                "googleMapsUrl": "https://www.google.com/maps/search/?api=1&query=38.8977,-77.0365"
            },
            {
                "id": "theodore-roosevelt",
                "title": "Theodore Roosevelt",
                "subtitle": "26th U.S. President, Progressive Era & Conservation",
                "lane": "modern",
                "from": {"year": 1901, "month": 9, "day": 14, "precision": "day"},
                "to": {"year": 1909, "month": 3, "day": 4, "precision": "day"},
                "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Theodore_Roosevelt_typical_c1904.jpg/440px-Theodore_Roosevelt_typical_c1904.jpg",
                "wikiTitle": "Theodore Roosevelt",
                "wikiUrl": "https://en.wikipedia.org/wiki/Theodore_Roosevelt",
                "extract": "Theodore Roosevelt Jr. was an American politician, statesman, soldier, conservationist, and writer who served as the 26th president of the United States from 1901 to 1909.",
                "rank": 8,
                "locationName": "Oyster Bay, New York, USA",
                "lat": 40.8718,
                "lng": -73.5321,
                "googleMapsUrl": "https://www.google.com/maps/search/?api=1&query=40.8718,-73.5321"
            },
            {
                "id": "franklin-d-roosevelt",
                "title": "Franklin D. Roosevelt",
                "subtitle": "32nd U.S. President, New Deal & World War II",
                "lane": "modern",
                "from": {"year": 1933, "month": 3, "day": 4, "precision": "day"},
                "to": {"year": 1945, "month": 4, "day": 12, "precision": "day"},
                "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/FDR_1944_Color_Portrait.jpg/440px-FDR_1944_Color_Portrait.jpg",
                "wikiTitle": "Franklin D. Roosevelt",
                "wikiUrl": "https://en.wikipedia.org/wiki/Franklin_D._Roosevelt",
                "extract": "Franklin Delano Roosevelt was an American statesman and political leader who served as the 32nd president of the United States from 1933 until his death in 1945. He led the nation through the Great Depression and World War II.",
                "rank": 10,
                "locationName": "Hyde Park, New York, USA",
                "lat": 41.7684,
                "lng": -73.9351,
                "googleMapsUrl": "https://www.google.com/maps/search/?api=1&query=41.7684,-73.9351"
            },
            {
                "id": "john-f-kennedy",
                "title": "John F. Kennedy",
                "subtitle": "35th U.S. President, Space Race & Civil Rights",
                "lane": "modern",
                "from": {"year": 1961, "month": 1, "day": 20, "precision": "day"},
                "to": {"year": 1963, "month": 11, "day": 22, "precision": "day"},
                "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/John_F._Kennedy%2C_White_House_color_photo_portrait.jpg/440px-John_F._Kennedy%2C_White_House_color_photo_portrait.jpg",
                "wikiTitle": "John F. Kennedy",
                "wikiUrl": "https://en.wikipedia.org/wiki/John_F._Kennedy",
                "extract": "John Fitzgerald Kennedy, often referred to by his initials JFK, was an American politician who served as the 35th president of the United States from 1961 until his assassination in 1963.",
                "rank": 9,
                "locationName": "Dallas, Texas, USA",
                "lat": 32.7788,
                "lng": -96.8087,
                "googleMapsUrl": "https://www.google.com/maps/search/?api=1&query=32.7788,-96.8087"
            },
            {
                "id": "barack-obama",
                "title": "Barack Obama",
                "subtitle": "44th U.S. President, First African-American President",
                "lane": "contemporary",
                "from": {"year": 2009, "month": 1, "day": 20, "precision": "day"},
                "to": {"year": 2017, "month": 1, "day": 20, "precision": "day"},
                "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/President_Barack_Obama.jpg/440px-President_Barack_Obama.jpg",
                "wikiTitle": "Barack Obama",
                "wikiUrl": "https://en.wikipedia.org/wiki/Barack_Obama",
                "extract": "Barack Hussein Obama II is an American retired politician who served as the 44th president of the United States from 2009 to 2017. A member of the Democratic Party, he was the first African-American president.",
                "rank": 9,
                "locationName": "Chicago, Illinois, USA",
                "lat": 41.8781,
                "lng": -87.6298,
                "googleMapsUrl": "https://www.google.com/maps/search/?api=1&query=41.8781,-87.6298"
            }
        ],
        "createdAt": "2026-09-03T11:00:00Z",
        "updatedAt": "2026-09-03T11:00:00Z"
    }

def list_all_timelines(user_id: Optional[str] = None, all_users: bool = False) -> List[dict]:
    """
    List timelines. If Supabase is configured and reachable, fetches from Supabase PostgreSQL.
    Otherwise, falls back to local JSON storage.

    When all_users=True (admin only, enforced by the caller), returns every saved
    timeline regardless of owner, including the owning user_id on each row.
    """
    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            # Lightweight select: avoids transferring the full "data" JSON blob (every
            # article's text/images) just to list titles - falls back to the legacy
            # full-data select if the "article_count" generated column doesn't exist yet
            # (see backend/README/SUPABASE setup for the migration that adds it).
            base_params = {"order": "updated_at.desc"}
            if all_users:
                # Admin view: no owner filter, cap to a reasonable page size.
                base_params["limit"] = "500"
            elif user_id:
                # Each user only sees their own saved timelines.
                base_params["user_id"] = f"eq.{user_id}"
            else:
                # No authenticated user: return nothing rather than leaking others' data.
                return []

            with httpx.Client(timeout=SUPABASE_TIMEOUT) as client:
                light_params = {
                    **base_params,
                    "select": "id,title,description,time_scale,article_count,is_personal,is_pinned,is_public,created_at,updated_at,user_id"
                }
                resp = client.get(url, headers=headers, params=light_params)
                if resp.status_code == 200:
                    rows = resp.json()
                    results = []
                    for row in rows:
                        entry = {
                            "id": row["id"],
                            "title": row["title"],
                            "description": row.get("description", ""),
                            "articleCount": row.get("article_count") or 0,
                            "timeScale": row.get("time_scale", "calendar"),
                            "updatedAt": row.get("updated_at", row.get("created_at", "")),
                            "isOwner": bool(user_id and row.get("user_id") == user_id),
                            "isPersonal": bool(row.get("is_personal", False)),
                            "isPinned": bool(row.get("is_pinned", False)),
                            "isShared": bool(row.get("is_public", False))
                        }
                        if all_users:
                            entry["ownerId"] = row.get("user_id")
                        if entry["articleCount"] > 0:
                            results.append(entry)
                    return results

                # Column(s) not present yet (pre-migration) - fall back to the full-data select.
                full_params = {**base_params, "select": "id,title,description,time_scale,data,is_public,created_at,updated_at,user_id"}
                resp = client.get(url, headers=headers, params=full_params)
                if resp.status_code == 200:
                    rows = resp.json()
                    results = []
                    for row in rows:
                        data = row.get("data") or {}
                        articles = data.get("articles", [])
                        entry = {
                            "id": row["id"],
                            "title": row["title"],
                            "description": row.get("description", ""),
                            "articleCount": len(articles),
                            "timeScale": row.get("time_scale", "calendar"),
                            "updatedAt": row.get("updated_at", row.get("created_at", "")),
                            "isOwner": bool(user_id and row.get("user_id") == user_id),
                            "isPersonal": bool(data.get("isPersonal", False)),
                            "isPinned": bool(data.get("isPinned", False)),
                            "isShared": bool(row.get("is_public", False))
                        }
                        if all_users:
                            entry["ownerId"] = row.get("user_id")
                        if entry["articleCount"] > 0:
                            results.append(entry)
                    return results
                else:
                    logger.warning(f"Supabase list_all_timelines status {resp.status_code}: {resp.text}")
        except Exception as e:
            logger.warning(f"Supabase fetch failed, falling back to local file: {e}")

    # Fallback to local JSON storage
    ensure_data_dir()
    try:
        with open(TIMELINES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return [
                {
                    "id": item["id"],
                    "title": item["title"],
                    "description": item.get("description", ""),
                    "articleCount": len(item.get("articles", [])),
                    "timeScale": item.get("timeScale", "calendar"),
                    "updatedAt": item.get("updatedAt", item.get("createdAt", "")),
                    "isPersonal": bool(item.get("isPersonal", False)),
                    "isPinned": bool(item.get("isPinned", False)),
                    "isShared": bool(item.get("is_public", False))
                }
                for item in data
                if len(item.get("articles", [])) > 0
            ]
    except Exception:
        return []

def get_timeline_by_id(timeline_id: str) -> Optional[dict]:
    """
    Get a timeline by ID. Tries Supabase first, then falls back to local storage.
    """
    meta = get_timeline_with_meta(timeline_id)
    return meta.get("data") if meta else None

def get_timeline_with_meta(timeline_id: str) -> Optional[dict]:
    """
    Get a timeline by ID along with ownership/sharing metadata, used to enforce
    "shared link" read access (owner or a timeline explicitly marked as shared).
    Returns {"data": <timeline dict>, "owner_id": str|None, "is_shared": bool}.
    The local JSON fallback has no per-item owner tracking (single-user dev mode),
    so it's treated as always shared/owned to preserve prior dev behavior.
    """
    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            params = {
                "id": f"eq.{timeline_id}",
                "select": "*"
            }
            with httpx.Client(timeout=SUPABASE_TIMEOUT) as client:
                resp = client.get(url, headers=headers, params=params)
                if resp.status_code == 200:
                    rows = resp.json()
                    if rows:
                        row = rows[0]
                        return {
                            "data": row.get("data"),
                            "owner_id": row.get("user_id"),
                            "is_shared": bool(row.get("is_shared") or row.get("is_public", False)),
                        }
        except Exception as e:
            logger.warning(f"Supabase get_timeline failed: {e}")

    ensure_data_dir()
    try:
        with open(TIMELINES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            for item in data:
                if item["id"] == timeline_id:
                    return {"data": item, "owner_id": None, "is_shared": True}
    except Exception:
        pass
    return None

def set_timeline_shared(timeline_id: str, user_id: str, enabled: bool, author_name: Optional[str] = None) -> bool:
    """
    Enables/disables the "anyone with the link" share flag on a timeline.
    Caller MUST have already verified ownership. Returns True on success.
    """
    # Always update local JSON file
    try:
        if TIMELINES_FILE.exists():
            with open(TIMELINES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            for item in data:
                if item["id"] == timeline_id:
                    item["is_shared"] = enabled
                    item["is_public"] = enabled
                    if author_name:
                        item["author_name"] = author_name
                    break
            with open(TIMELINES_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"Failed to update local timeline share flag: {e}")

    if not _supabase_is_configured():
        return True

    try:
        url = f"{SUPABASE_URL}/rest/v1/timelines"
        headers = _get_supabase_headers()
        headers["Prefer"] = "return=minimal"
        params = {"id": f"eq.{timeline_id}"}
        meta = get_timeline_with_meta(timeline_id)
        if user_id and meta and meta.get("owner_id"):
            params["user_id"] = f"eq.{user_id}"
        payload = {"is_public": enabled, "is_shared": enabled}
        if author_name:
            payload["author_name"] = author_name

        if meta and meta.get("data"):
            tl_data = meta["data"]
            payload["categories"] = _extract_categories(tl_data)
            payload["tags"] = _extract_tags(tl_data)
            payload["language"] = _extract_language(tl_data)

        with httpx.Client(timeout=SUPABASE_TIMEOUT) as client:
            resp = client.patch(url, headers=headers, params=params, json=payload)
            if resp.status_code in (200, 204):
                return True
            logger.warning(f"Supabase set_timeline_shared status {resp.status_code}: {resp.text}")
    except Exception as e:
        logger.warning(f"Failed to update timeline share flag in Supabase: {e}")
    return False

def save_timeline_data(timeline: dict, user_id: Optional[str] = None) -> dict:
    """
    Save timeline data. Tries Supabase first, and mirrors to local storage for backup.
    Refuses to persist empty timelines (0 articles).
    """
    articles = timeline.get("articles") or []
    if not articles or len(articles) == 0:
        logger.warning(
            f"Refusing to save empty timeline to storage (id={timeline.get('id')}, title={timeline.get('title')}) - no articles."
        )
        return timeline

    timeline["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    if "createdAt" not in timeline or not timeline["createdAt"]:
        timeline["createdAt"] = timeline["updatedAt"]

    # Try saving to Supabase
    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            headers["Prefer"] = "resolution=merge-duplicates,return=representation"
            
            cats = _extract_categories(timeline)
            tags = _extract_tags(timeline)
            lang = _extract_language(timeline)

            payload = {
                "id": timeline["id"],
                "title": timeline.get("title", "Untitled Timeline"),
                "description": timeline.get("description", ""),
                "time_scale": timeline.get("timeScale", "calendar"),
                "data": timeline,
                "is_public": bool(timeline.get("isShared") or timeline.get("is_shared") or timeline.get("is_public", False)),
                "updated_at": timeline["updatedAt"],
                "categories": cats,
                "tags": tags,
                "language": lang
            }
            if user_id:
                payload["user_id"] = user_id

            supabase_saved = False
            last_error = None
            for attempt in range(2):  # one retry: covers a paused project's cold-start timeout
                try:
                    with httpx.Client(timeout=SUPABASE_TIMEOUT) as client:
                        resp = client.post(url, headers=headers, json=payload)
                        if resp.status_code in (200, 201):
                            logger.info(f"Timeline {timeline['id']} successfully saved to Supabase")
                            supabase_saved = True
                            break
                        else:
                            last_error = f"status {resp.status_code}: {resp.text}"
                except Exception as e:
                    last_error = str(e)
            if not supabase_saved:
                logger.error(
                    f"Timeline {timeline['id']} FAILED to save to Supabase after retry "
                    f"(will only persist to the ephemeral local file): {last_error}"
                )
        except Exception as e:
            logger.error(f"Failed to save timeline to Supabase: {e}")

    # Mirror to local file for backup/offline resilience
    ensure_data_dir()
    try:
        data = []
        try:
            with open(TIMELINES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = []

        found = False
        for i, item in enumerate(data):
            if item["id"] == timeline["id"]:
                data[i] = timeline
                found = True
                break
        if not found:
            data.insert(0, timeline)

        with open(TIMELINES_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error saving to local backup: {e}")

    return timeline

def delete_timeline_data(timeline_id: str, user_id: Optional[str] = None) -> bool:
    """
    Delete timeline data from Supabase and local storage.
    """
    deleted = False
    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            params = {"id": f"eq.{timeline_id}"}
            if user_id:
                params["user_id"] = f"eq.{user_id}"

            with httpx.Client(timeout=SUPABASE_TIMEOUT) as client:
                resp = client.delete(url, headers=headers, params=params)
                if resp.status_code in (200, 204):
                    deleted = True
        except Exception as e:
            logger.warning(f"Supabase delete failed: {e}")

    ensure_data_dir()
    try:
        with open(TIMELINES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        filtered = [item for item in data if item["id"] != timeline_id]
        if len(filtered) != len(data):
            with open(TIMELINES_FILE, "w", encoding="utf-8") as f:
                json.dump(filtered, f, indent=2, ensure_ascii=False)
            deleted = True
    except Exception:
        pass

    return deleted

def delete_all_user_timelines(user_id: str) -> bool:
    """
    Deletes all timelines belonging to user_id from Supabase and local storage.
    """
    if not user_id:
        return False

    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            params = {"user_id": f"eq.{user_id}"}
            with httpx.Client(timeout=SUPABASE_TIMEOUT) as client:
                resp = client.delete(url, headers=headers, params=params)
                if resp.status_code not in (200, 204):
                    logger.warning(f"Supabase delete_all_user_timelines status {resp.status_code}: {resp.text}")
        except Exception as e:
            logger.warning(f"Supabase delete_all_user_timelines failed: {e}")

    # Also clean local storage if matching timelines exist
    ensure_data_dir()
    try:
        if TIMELINES_FILE.exists():
            with open(TIMELINES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            filtered = [item for item in data if item.get("user_id") != user_id]
            if len(filtered) != len(data):
                with open(TIMELINES_FILE, "w", encoding="utf-8") as f:
                    json.dump(filtered, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"Failed cleaning local storage for user {user_id}: {e}")

    return True





CURATED_DOMAINS = [
    {
        "key": "history",
        "label": "History & Politics",
        "aliases": [
            "history", "politics", "political", "war", "ancient", "medieval", "modern history", "empire", "revolution", "diplomacy", "treaty", "monarchy", "president",
            "historia", "política", "imperio", "revolución", "monarquía", "presidente", "diplomacia", "tratado",
            "histoire", "politique", "révolution", "président", "diplomatie", "traité", "moyen âge",
            "geschichte", "politik", "kaiserreich", "monarchie", "vertrag", "mittelalter",
            "história", "político", "império", "revolução",
            "تاريخ", "سياسة", "سياسي", "إمبراطورية", "ثورة", "معاهدة"
        ]
    },
    {
        "key": "technology",
        "label": "Science & Technology",
        "aliases": [
            "technology", "tech", "computing", "computer", "internet", "software", "ai", "hardware", "engineering", "telecom", "electronics", "robotics", "science", "physics", "physicist", "chemistry", "mathematics", "einstein", "discovery",
            "ciencia", "tecnología", "informática", "computación", "inteligencia artificial", "ingeniería", "física", "química", "matemáticas", "científico",
            "technologie", "ordinateur", "logiciel", "physique", "chimie", "mathématiques", "scientifique",
            "wissenschaft", "technik", "rechner", "informatik", "mathematik", "wissenschaftler",
            "ciência", "computador", "engenharia", "matemática",
            "علم", "تكنولوجيا", "تقنية", "حاسوب", "ذكاء اصطناعي", "هندسة", "فيزياء", "كيمياء", "رياضيات"
        ]
    },
    {
        "key": "space",
        "label": "Space & Aviation",
        "aliases": [
            "space", "astronomy", "aviation", "flight", "aerospace", "nasa", "planet", "rocket", "cosmic", "satellite", "moon", "apollo",
            "espacio", "astronomía", "aviación", "vuelo", "aeroespacial", "cohete", "satélite", "luna", "cosmos",
            "espace", "astronomie", "fusée", "lune", "astronautique",
            "raumfahrt", "weltraum", "luftfahrt", "rakete", "satellit", "mond", "kosmos",
            "espaço", "aviação", "foguete",
            "فضاء", "علم الفلك", "طيران", "صاروخ", "قمر صناعي"
        ]
    },
    {
        "key": "geography",
        "label": "Geography & Nations",
        "aliases": [
            "geography", "nations", "countries", "america", "usa", "united states", "europe", "asia", "israel", "middle east", "africa", "cities", "britain", "france", "germany", "japan", "vikings", "viking", "nordic", "scandinavia",
            "geografía", "naciones", "países", "estados unidos", "oriente medio", "vikingos", "escandinavia",
            "géographie", "pays", "états-unis", "moyen-orient", "scandinavie",
            "geographie", "länder", "staaten", "wikinger", "skandinavien",
            "geografia", "nações", "países", "escandinávia",
            "جغرافيا", "أمم", "دول", "بلدان", "الشرق الأوسط", "فايكنج", "إسكندنافيا"
        ]
    },
    {
        "key": "nature",
        "label": "Nature & Evolution",
        "aliases": [
            "nature", "evolution", "biology", "animals", "earth", "paleontology", "prehistory", "environment", "species", "fauna", "flora", "geology", "horse", "dinosaur", "volcano", "volcanoes", "eruption", "geological",
            "naturaleza", "evolución", "biología", "animales", "tierra", "paleontología", "prehistoria", "fósiles", "dinosaurios", "volcán", "volcanes",
            "évolution", "animaux", "paléontologie", "préhistoire", "espèces", "dinosaures",
            "evolution", "tiere", "erde", "paläontologie", "urgeschichte", "dinosaurier", "vulkan",
            "natureza", "evolução", "fósseis", "dinossauros",
            "طبيعة", "تطور", "أحياء", "حيوانات", "أحافير", "ديناصورات", "بركان"
        ]
    },
    {
        "key": "arts",
        "label": "Arts & Culture",
        "aliases": [
            "arts", "culture", "art", "music", "cinema", "literature", "painting", "architecture", "theatre", "film", "sculpture", "fashion",
            "arte", "cultura", "música", "cine", "literatura", "pintura", "arquitectura", "teatro", "escultura",
            "musique", "littérature", "peinture", "sculpture",
            "kunst", "kultur", "malerei", "architektur", "theater", "bildhauerei",
            "música", "arquitetura",
            "فن", "فنون", "ثقافة", "موسيقى", "سينما", "أدب", "رسم", "عمارة", "مسرح"
        ]
    },
    {
        "key": "biography",
        "label": "Biographies & Figures",
        "aliases": [
            "biography", "biographies", "people", "figures", "leaders", "scientists", "artists", "life of", "inventor", "philosopher", "albert", "einstein", "dirac",
            "biografía", "biografías", "personajes", "líderes", "vida de", "inventor",
            "biographies", "dirigeants", "vie de", "penseur",
            "biografie", "biografien", "persönlichkeiten", "lebensgeschichte", "erfinder",
            "biografia",
            "سيرة", "سيرة ذاتية", "شخصيات", "قادة", "مخترع"
        ]
    },
    {
        "key": "military",
        "label": "Military & Wars",
        "aliases": [
            "military", "war", "battle", "weapons", "army", "conflict", "navy", "conquest", "invasion", "crusade", "six-day", "six day",
            "militar", "guerra", "batalla", "armas", "ejército", "conflicto", "armada", "conquista", "invasión", "cruzada", "bélico",
            "militaire", "guerre", "bataille", "armée", "conquête", "croisade",
            "militär", "krieg", "schlacht", "waffen", "armee", "heer", "eroberung", "kreuzzug",
            "batalha", "exército", "invasão",
            "عسكري", "حرب", "معركة", "أسلحة", "جيش", "صراع", "غزو", "احتلال"
        ]
    },
    {
        "key": "business",
        "label": "Economy & Business",
        "aliases": [
            "business", "economy", "finance", "trade", "industry", "money", "markets", "commerce", "capitalism", "silicon valley",
            "economía", "económico", "negocios", "finanzas", "comercio", "industria", "dinero", "mercados",
            "économie", "économique", "affaires", "finance", "marchés",
            "wirtschaft", "finanzen", "handel", "märkte", "unternehmen",
            "economia", "negócios",
            "اقتصاد", "اقتصادي", "أعمال", "تمويل", "تجارة", "صناعة", "أسواق"
        ]
    },
    {
        "key": "society",
        "label": "Society & Philosophy",
        "aliases": [
            "society", "philosophy", "religion", "social", "movements", "law", "ethics", "rights", "education", "schools of thought", "greece", "ancient greece", "plato", "aristotle",
            "sociedad", "social", "filosofía", "religión", "leyes", "ética", "derechos", "educación", "platón", "aristóteles",
            "société", "philosophie", "droits", "éthique", "éducation", "platon", "aristote",
            "gesellschaft", "sozial", "rechte", "bildung", "aristoteles",
            "sociedade", "filosofia", "religião", "direitos",
            "مجتمع", "فلسفة", "دين", "قانون", "أخلاق", "حقوق", "تعليم", "أفلاطون", "أرسطو"
        ]
    }
]


def _alias_matches(alias: str, text: str) -> bool:
    alias = alias.lower().strip()
    if not alias:
        return False
    text = text.lower()
    if " " in alias or "-" in alias or '"' in alias:
        return alias in text
    pattern = r'(?:^|[\s\.,!?:;"\'\(\)\[\]/\\])' + re.escape(alias) + r'(?:$|[\s\.,!?:;"\'\(\)\[\]/\\])'
    if re.search(pattern, text):
        return True
    return bool(re.search(r'\b' + re.escape(alias) + r'\b', text))


def _extract_categories(data: dict) -> List[str]:
    """
    Extract 1-3 categories from explicit timeline fields or infer them smartly from
    articles, lanes, title, and description across multiple languages.
    """
    explicit = (data or {}).get("categories")
    if explicit and isinstance(explicit, list) and len(explicit) > 0:
        cleaned = [str(c).strip() for c in explicit if str(c).strip()]
        if cleaned:
            return cleaned[:3]

    text_corpus = (
        f"{(data or {}).get('title', '')} {(data or {}).get('description', '')} " +
        " ".join([str(a.get('category', '')) + " " + str(a.get('title', '')) for a in ((data or {}).get('articles') or [])[:25]])
    ).lower()

    matched = []
    for domain in CURATED_DOMAINS:
        for alias in domain["aliases"]:
            if _alias_matches(alias, text_corpus):
                if domain["label"] not in matched:
                    matched.append(domain["label"])
                break
        if len(matched) >= 3:
            break

    if not matched:
        matched = ["History & Politics"]
    return matched


def _extract_tags(data: dict) -> List[str]:
    """
    Extract 3-5 tags from explicit timeline fields or infer them smartly from
    title, article categories, and key historical/scientific terms across all languages.
    """
    explicit = (data or {}).get("tags")
    if explicit and isinstance(explicit, list) and len(explicit) > 0:
        cleaned = [str(t).strip().lstrip('#') for t in explicit if str(t).strip()]
        if len(cleaned) >= 3:
            return cleaned[:5]
        inferred = list(cleaned)
    else:
        inferred = []

    title = str((data or {}).get("title", "")).strip()
    desc = str((data or {}).get("description", "")).strip()
    articles = (data or {}).get("articles") or []

    # 1. Add article event categories (high-value themes)
    for a in articles:
        if isinstance(a, dict):
            c = a.get("category")
            if c and isinstance(c, str):
                c_clean = c.strip().lstrip('#')
                if c_clean and c_clean not in inferred and len(c_clean) > 2:
                    inferred.append(c_clean)
                    if len(inferred) >= 5:
                        break

    # 2. Multilingual entity keywords mapping
    multilingual_entity_keywords = [
        ("Albert Einstein", ["albert einstein", "einstein"]),
        ("Physics", ["physics", "quantum", "relativity"]),
        ("Science", ["science", "scientific"]),
        ("Biography", ["biography", "life of"]),
        ("Six-Day War", ["six-day war", "six day war"]),
        ("Israel", ["israel", "idf"]),
        ("Middle East", ["middle east"]),
        ("Military History", ["military", "war", "battle"]),
        ("Vikings", ["vikings", "viking"]),
        ("Scandinavia", ["scandinavia", "nordic"]),
        ("Medieval", ["medieval", "middle ages"]),
        ("Ancient Greece", ["ancient greece", "greece"]),
        ("Philosophy", ["philosophy", "philosophers"]),
        ("Ancient Rome", ["rome", "roman empire"]),
        ("Space Exploration", ["space", "nasa", "apollo", "moon"]),
        ("Geology", ["geology", "volcano", "earth"]),
        ("Evolution", ["evolution", "prehistory", "paleontology"]),
        ("Aviation", ["aviation", "aircraft", "flight"])
    ]

    text_corpus = f"{title} {desc}".lower()
    for tag_name, kws in multilingual_entity_keywords:
        for kw in kws:
            if _alias_matches(kw, text_corpus):
                if tag_name not in inferred and not any(kw in str(ex).lower() for ex in inferred):
                    inferred.append(tag_name)
                break
        if len(inferred) >= 5:
            break

    # 3. Extract meaningful phrases from title if under 3 tags
    if len(inferred) < 3 and title:
        parts = [p.strip() for p in re.split(r'[:–—\-]', title) if p.strip()]
        for part in parts:
            if len(inferred) >= 5:
                break
            if 3 < len(part) < 28 and part not in inferred:
                inferred.append(part)

    # 4. Fill to at least 3 with curated domain-specific tags
    if len(inferred) < 3:
        cats = _extract_categories(data)
        domain_fallbacks = {
            "Military & Wars": ["MilitaryHistory", "Conflicts", "ArmedForces"],
            "Science & Technology": ["Science", "Innovation", "Research"],
            "Biographies & Figures": ["Biography", "HistoricalFigures", "Leaders"],
            "Geography & Nations": ["WorldHistory", "Civilizations", "Nations"],
            "Nature & Evolution": ["Nature", "Evolution", "EarthHistory"],
            "Society & Philosophy": ["Philosophy", "Society", "Culture"],
            "Space & Aviation": ["Space", "Aviation", "Cosmos"],
            "Arts & Culture": ["Culture", "ArtHistory", "Heritage"],
            "Economy & Business": ["Economy", "Commerce", "Industry"]
        }
        for cat in cats:
            for fallback in domain_fallbacks.get(cat, ["History", "WorldEvents", "Chronology"]):
                if fallback not in inferred:
                    inferred.append(fallback)
                    if len(inferred) >= 3:
                        break
            if len(inferred) >= 3:
                break

    return inferred[:5]


def _get_category_keys(categories: List[str]) -> List[str]:
    """Map category display names or aliases to standard keys."""
    keys = []
    for cat in categories:
        cat_lower = str(cat).lower()
        for d in CURATED_DOMAINS:
            if d["key"] == cat_lower or d["label"].lower() == cat_lower:
                if d["key"] not in keys:
                    keys.append(d["key"])
            elif any(_alias_matches(a, cat_lower) for a in d["aliases"]):
                if d["key"] not in keys:
                    keys.append(d["key"])
    return keys


def _extract_language(data: dict) -> str:
    """
    Detect the natural language of the timeline from text script or explicit metadata.
    Supports all 11 languages (he, ar, hi, ko, ja, zh, ru, es, fr, de, pt, en).
    """
    text = f"{(data or {}).get('title', '')} {(data or {}).get('description', '')}"
    articles = (data or {}).get("articles") or []
    if articles and isinstance(articles, list):
        text += " " + " ".join([f"{a.get('title', '')} {a.get('subtitle', '')}" for a in articles[:5] if isinstance(a, dict)])

    # 1. Distinct non-Latin script detection takes absolute priority over any English default:
    if re.search(r'[\u0590-\u05FF]', text):
        return 'he'
    if re.search(r'[\u0600-\u06FF]', text):
        return 'ar'
    if re.search(r'[\u0900-\u097F]', text):
        return 'hi'
    if re.search(r'[\uAC00-\uD7AF]', text):
        return 'ko'
    if re.search(r'[\u3040-\u30FF]', text):
        return 'ja'
    if re.search(r'[\u4E00-\u9FFF]', text):
        return 'zh'
    if re.search(r'[\u0400-\u04FF]', text):
        return 'ru'

    # 2. Check explicit detected_language or language if valid 2-letter code
    lang = (data or {}).get("detectedLanguage") or (data or {}).get("detected_language") or (data or {}).get("language")
    if lang and isinstance(lang, str) and len(lang.strip()) == 2:
        lang_code = lang.strip().lower()
        if lang_code != "en":
            return lang_code

    # 3. European Latin language signature words check (Spanish, German, French, Portuguese):
    text_lower = text.lower()
    es_indicators = [" de ", " la ", " el ", " los ", " las ", " y ", " en ", " del ", " por ", " una ", " un "]
    fr_indicators = [" de ", " le ", " la ", " les ", " et ", " des ", " du ", " dans ", " une ", " un "]
    de_indicators = [" der ", " die ", " das ", " und ", " in ", " von ", " mit ", " für ", " auf "]
    pt_indicators = [" de ", " do ", " da ", " dos ", " das ", " e ", " em ", " para ", " com "]

    es_score = sum(1 for w in es_indicators if w in text_lower)
    fr_score = sum(1 for w in fr_indicators if w in text_lower)
    de_score = sum(1 for w in de_indicators if w in text_lower)
    pt_score = sum(1 for w in pt_indicators if w in text_lower)

    max_score = max(es_score, fr_score, de_score, pt_score)
    if max_score >= 3:
        if de_score == max_score:
            return 'de'
        if fr_score == max_score:
            return 'fr'
        if pt_score == max_score and pt_score > es_score:
            return 'pt'
        if es_score == max_score:
            return 'es'

    if lang and isinstance(lang, str) and len(lang.strip()) == 2:
        return lang.strip().lower()

    return 'en'


def _extract_author(data: dict) -> str:
    """
    Extract author display name, honoring anonymous choice if requested.
    """
    if (data or {}).get("isAnonymous"):
        return "Explorer"
    author = (data or {}).get("authorName") or (data or {}).get("author_name")
    if author and isinstance(author, str) and author.strip():
        return author.strip()
    tid = (data or {}).get("id", "")
    if tid in ("apollo", "tl-nature-horse", "sample-us-presidents"):
        return "ChroniX Curators"
    return "Guest Explorer"


def _extract_preview_lanes(data: dict) -> List[dict]:
    lanes = (data or {}).get("lanes", [])
    result = []
    for l in lanes[:4]:
        if isinstance(l, dict) and l.get("title"):
            result.append({
                "id": l.get("id"),
                "title": l.get("title"),
                "color": l.get("color") or "#4a7c59"
            })
    filtered = [
        c for c in comments
        if not (c.get("id") == comment_id and (is_admin or c.get("user_id") == user_id))
    ]
    if len(filtered) < before_len:
        _save_local_comments(filtered)
        return True
    return False


