import json
import os
from pathlib import Path
from typing import List, Optional
from datetime import datetime
from models import TimelineData, TimelineArticle, TimelineDate, TimelineLane, TimelineTimeBand

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TIMELINES_FILE = DATA_DIR / "timelines.json"

def ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not TIMELINES_FILE.exists():
        # Initialize with sample timeline
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
            {"id": "early", "title": "18th & 19th Century", "color": "#2563eb", "order": 1},
            {"id": "modern", "title": "20th Century", "color": "#059669", "order": 2},
            {"id": "contemporary", "title": "21st Century", "color": "#7c3aed", "order": 3}
        ],
        "timeBands": [
            {"id": "founding", "title": "Founding & Civil War Era", "from": {"year": 1789, "precision": "year"}, "to": {"year": 1877, "precision": "year"}, "color": "rgba(37, 99, 235, 0.08)"},
            {"id": "twentieth", "title": "20th Century & Cold War", "from": {"year": 1900, "precision": "year"}, "to": {"year": 1999, "precision": "year"}, "color": "rgba(5, 150, 105, 0.08)"},
            {"id": "twentyfirst", "title": "21st Century", "from": {"year": 2000, "precision": "year"}, "to": {"year": 2026, "precision": "year"}, "color": "rgba(124, 58, 237, 0.08)"}
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
                "rank": 10
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
                "rank": 10
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
                "rank": 8
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
                "rank": 10
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
                "rank": 9
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
                "rank": 9
            }
        ],
        "createdAt": "2026-09-03T11:00:00Z",
        "updatedAt": "2026-09-03T11:00:00Z"
    }

def list_all_timelines() -> List[dict]:
    ensure_data_dir()
    try:
        with open(TIMELINES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Return list of summaries
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

def save_timeline_data(timeline: dict) -> dict:
    ensure_data_dir()
    timeline["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    if "createdAt" not in timeline or not timeline["createdAt"]:
        timeline["createdAt"] = timeline["updatedAt"]

    data = []
    try:
        with open(TIMELINES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = []

    # Replace existing or append
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

    return timeline

def delete_timeline_data(timeline_id: str) -> bool:
    ensure_data_dir()
    try:
        with open(TIMELINES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        filtered = [item for item in data if item["id"] != timeline_id]
        if len(filtered) != len(data):
            with open(TIMELINES_FILE, "w", encoding="utf-8") as f:
                json.dump(filtered, f, indent=2, ensure_ascii=False)
            return True
    except Exception:
        pass
    return False
