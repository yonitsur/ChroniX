import json
import os
import logging
from pathlib import Path
from typing import List, Optional
from datetime import datetime
import httpx
from models import TimelineData, TimelineArticle, TimelineDate, TimelineLane, TimelineTimeBand

logger = logging.getLogger("ChroniXStorage")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TIMELINES_FILE = DATA_DIR / "timelines.json"

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

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
        initial_data = [get_sample_timeline()]
        with open(TIMELINES_FILE, "w", encoding="utf-8") as f:
            json.dump(initial_data, f, indent=2, ensure_ascii=False)

def get_sample_timeline() -> dict:
    return {
        "id": "sample-us-presidents",
        "title": "Presidents of the United States (Key Figures)",
        "description": "An interactive timeline highlighting transformative presidents in American history.",
        "timeScale": "calendar",
        "lanes": [
            {"id": "early", "title": "18th & 19th Century", "color": "#2b5278", "order": 1},
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

def list_all_timelines(user_id: Optional[str] = None) -> List[dict]:
    """
    List timelines. If Supabase is configured and reachable, fetches from Supabase PostgreSQL.
    Otherwise, falls back to local JSON storage.
    """
    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            params = {
                "select": "id,title,description,time_scale,data,created_at,updated_at,user_id",
                "order": "updated_at.desc"
            }
            if user_id:
                params["or"] = f"(is_public.eq.true,user_id.eq.{user_id})"
            else:
                params["is_public"] = "eq.true"

            with httpx.Client(timeout=5.0) as client:
                resp = client.get(url, headers=headers, params=params)
                if resp.status_code == 200:
                    rows = resp.json()
                    results = []
                    for row in rows:
                        data = row.get("data") or {}
                        articles = data.get("articles", [])
                        results.append({
                            "id": row["id"],
                            "title": row["title"],
                            "description": row.get("description", ""),
                            "articleCount": len(articles),
                            "timeScale": row.get("time_scale", "calendar"),
                            "updatedAt": row.get("updated_at", row.get("created_at", "")),
                            "isOwner": bool(user_id and row.get("user_id") == user_id)
                        })
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
                    "updatedAt": item.get("updatedAt", item.get("createdAt", ""))
                }
                for item in data
            ]
    except Exception:
        return []

def get_timeline_by_id(timeline_id: str) -> Optional[dict]:
    """
    Get a timeline by ID. Tries Supabase first, then falls back to local storage.
    """
    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            params = {
                "id": f"eq.{timeline_id}",
                "select": "*"
            }
            with httpx.Client(timeout=5.0) as client:
                resp = client.get(url, headers=headers, params=params)
                if resp.status_code == 200:
                    rows = resp.json()
                    if rows:
                        return rows[0].get("data")
        except Exception as e:
            logger.warning(f"Supabase get_timeline failed: {e}")

    ensure_data_dir()
    try:
        with open(TIMELINES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            for item in data:
                if item["id"] == timeline_id:
                    return item
    except Exception:
        pass
    return None

def save_timeline_data(timeline: dict, user_id: Optional[str] = None) -> dict:
    """
    Save timeline data. Tries Supabase first, and mirrors to local storage for backup.
    """
    timeline["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    if "createdAt" not in timeline or not timeline["createdAt"]:
        timeline["createdAt"] = timeline["updatedAt"]

    # Try saving to Supabase
    if _supabase_is_configured():
        try:
            url = f"{SUPABASE_URL}/rest/v1/timelines"
            headers = _get_supabase_headers()
            headers["Prefer"] = "resolution=merge-duplicates,return=representation"
            
            payload = {
                "id": timeline["id"],
                "title": timeline.get("title", "Untitled Timeline"),
                "description": timeline.get("description", ""),
                "time_scale": timeline.get("timeScale", "calendar"),
                "data": timeline,
                "is_public": True,
                "updated_at": timeline["updatedAt"]
            }
            if user_id:
                payload["user_id"] = user_id

            with httpx.Client(timeout=5.0) as client:
                resp = client.post(url, headers=headers, json=payload)
                if resp.status_code in (200, 201):
                    logger.info(f"Timeline {timeline['id']} successfully saved to Supabase")
                else:
                    logger.warning(f"Supabase save status {resp.status_code}: {resp.text}")
        except Exception as e:
            logger.warning(f"Failed to save timeline to Supabase: {e}")

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

            with httpx.Client(timeout=5.0) as client:
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
