import os
import sys
from pathlib import Path
import httpx

# Add backend root to sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(backend_dir / ".env")

from services.storage import (
    SUPABASE_URL,
    _get_supabase_headers,
    _supabase_is_configured,
    _extract_categories,
    _extract_tags,
    _extract_language,
    TIMELINES_FILE
)
import json

def backfill():
    print("Checking Supabase connection...")
    if not _supabase_is_configured():
        print("Supabase is not configured.")
        return

    headers = _get_supabase_headers()
    client = httpx.Client(timeout=30.0)

    resp = client.get(f"{SUPABASE_URL}/rest/v1/timelines?select=*", headers=headers)
    if resp.status_code != 200:
        print(f"Failed to fetch timelines: {resp.status_code} {resp.text}")
        return

    rows = resp.json()
    print(f"Found {len(rows)} timelines in Supabase. Backfilling metadata columns...")

    for row in rows:
        tid = row["id"]
        title = row.get("title", "")
        data = row.get("data") or {}

        # 1. Categories
        existing_cats = data.get("categories") or row.get("categories") or []
        if existing_cats and len(existing_cats) > 0:
            cats = existing_cats[:3]
        else:
            cats = _extract_categories(data if data else row)

        # 2. Tags
        existing_tags = data.get("tags") or row.get("tags") or []
        if existing_tags and len(existing_tags) >= 3:
            tags = existing_tags[:5]
        else:
            tags = _extract_tags(data if data else row)

        # 3. Language
        lang = _extract_language(data if data else row)

        # 4. Article count
        articles = data.get("articles") or []
        art_count = len(articles) if articles else row.get("article_count", 0)

        patch_payload = {
            "categories": cats,
            "tags": tags,
            "language": lang,
            "article_count": art_count
        }

        import urllib.parse
        encoded_tid = urllib.parse.quote(tid)
        patch_resp = client.patch(
            f"{SUPABASE_URL}/rest/v1/timelines?id=eq.{encoded_tid}",
            headers=headers,
            json=patch_payload
        )
        if patch_resp.status_code not in (200, 204):
            print(f"Error status on item: {patch_resp.status_code}")
    print(f"Finished backfilling {len(rows)} timelines in Supabase.")

    # Also update local backup file if it exists
    if TIMELINES_FILE.exists():
        try:
            with open(TIMELINES_FILE, "r", encoding="utf-8") as f:
                local_data = json.load(f)
            for item in local_data:
                item["categories"] = _extract_categories(item)
                item["tags"] = _extract_tags(item)
                item["language"] = _extract_language(item)
            with open(TIMELINES_FILE, "w", encoding="utf-8") as f:
                json.dump(local_data, f, indent=2, ensure_ascii=False)
            print("Successfully updated local timelines.json backup file.")
        except Exception as e:
            print(f"Failed to update local timelines.json: {e}")

if __name__ == "__main__":
    backfill()
