import json
import pytest
from fastapi.testclient import TestClient

import main
from models import TimelineData
from services import storage


def _make_sample_timeline(
    tid: str,
    title: str,
    *,
    is_library: bool = False,
    is_featured: bool = False,
    is_shared: bool = False,
    content_mode: str = "classic",
    description: str = "",
    articles=None,
):
    if articles is None:
        articles = [
            {
                "id": "evt-1",
                "title": "First Milestone",
                "subtitle": "Early step",
                "from": {"year": 1957, "precision": "year"},
                "rank": 5,
                "imageUrl": "https://upload.wikimedia.org/low-rank.jpg",
                "lat": 45.96,
                "lng": 63.30,
            },
            {
                "id": "evt-2",
                "title": "Moon Landing",
                "subtitle": "Apollo 11",
                "from": {"year": 1969, "month": 7, "day": 20, "precision": "day"},
                "rank": 10,
                "imageUrl": "https://upload.wikimedia.org/high-rank-apollo.jpg",
            },
        ]
    return {
        "id": tid,
        "title": title,
        "description": description,
        "contentMode": content_mode,
        "isLibrary": is_library,
        "isFeatured": is_featured,
        "is_shared": is_shared,
        "is_public": is_shared,
        "updatedAt": "2026-10-15T12:00:00Z",
        "articles": articles,
    }


def test_extract_library_card_meta_hebrew_and_english():
    heb_tl = _make_sample_timeline(
        "tl-he-space",
        "המרוץ לחלל וחקר הירח",
        description="תולדות תוכנית אפולו ושיגור לוויינים",
        is_library=True,
        is_featured=True,
        content_mode="kids",
    )
    card = storage._extract_library_card_meta(heb_tl)
    assert card is not None
    assert card["id"] == "tl-he-space"
    assert card["language"] == "he"
    assert card["coverImageUrl"] == "https://upload.wikimedia.org/high-rank-apollo.jpg"
    assert card["minYear"] == 1957
    assert card["maxYear"] == 1969
    assert card["articleCount"] == 2
    assert card["hasGeo"] is True
    assert card["isFeatured"] is True
    assert card["contentMode"] == "kids"
    assert "space" in card["categoryKeys"] or "history" in card["categoryKeys"]

    # Deleted or empty timelines are never included in the library catalog
    assert storage._extract_library_card_meta({**heb_tl, "isDeleted": True}) is None
    assert storage._extract_library_card_meta({**heb_tl, "articles": []}) is None


def test_merged_timeline_model_validation():
    raw = {
        "id": "merged-1",
        "title": "ציר משולב: ישראל × חלל",
        "creationSource": "merged",
        "isLibrary": False,
        "mergedSources": [
            {"id": "src-1", "title": "תולדות ישראל", "color": "#2563eb", "articleCount": 12, "laneId": "layer-1"},
            {"id": "src-2", "title": "המרוץ לחלל", "color": "#059669", "articleCount": 10, "laneId": "layer-2"},
        ],
        "lanes": [
            {"id": "layer-1", "title": "תולדות ישראל", "order": 0},
            {"id": "layer-2", "title": "המרוץ לחלל", "order": 1},
        ],
        "timeBands": [
            {
                "id": "L1__band-1",
                "title": "העשור הראשון",
                "from": {"year": 1948, "precision": "year"},
                "to": {"year": 1958, "precision": "year"},
                "sourceLayerId": "layer-1",
            }
        ],
        "articles": [
            {
                "id": "L1__evt-1",
                "title": "הכרזת העצמאות",
                "from": {"year": 1948, "month": 5, "day": 14, "precision": "day"},
                "lane": "layer-1",
                "sourceTimelineId": "src-1",
                "sourceTimelineTitle": "תולדות ישראל",
            }
        ],
    }
    parsed = TimelineData.model_validate(raw)
    assert parsed.creationSource == "merged"
    assert len(parsed.mergedSources) == 2
    assert parsed.mergedSources[0].title == "תולדות ישראל"
    assert parsed.timeBands[0].sourceLayerId == "layer-1"


def test_personal_and_merged_library_card_meta_and_filtering(tmp_path, monkeypatch):
    local_file = tmp_path / "timelines.json"
    monkeypatch.setattr(storage, "TIMELINES_FILE", local_file)
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    storage._LOCAL_TIMELINES_CACHE_KEY = None
    storage._LOCAL_TIMELINES_CACHE_DATA = None
    storage.invalidate_library_cache()

    merged_personal = {
        **_make_sample_timeline(
            "demo-personal-trilogy",
            "משני קצוות תבל לבית אחד: שלוש שושלות על ציר זמן אחד",
            description="סיפור משפחתי בשלוש שכבות ממרקש ומווינה לירושלים",
            is_library=True,
            is_featured=True,
        ),
        "isPersonal": True,
        "creationSource": "merged",
        "mergedSources": [
            {"id": "s1", "title": "שושלת סבא", "color": "#2563eb", "articleCount": 12, "laneId": "layer-1"},
            {"id": "s2", "title": "שושלת סבתא", "color": "#059669", "articleCount": 12, "laneId": "layer-2"},
            {"id": "s3", "title": "הסיפור המשותף", "color": "#d97706", "articleCount": 13, "laneId": "layer-3"},
        ],
    }
    hist_item = _make_sample_timeline(
        "lib-hist-1",
        "The Roman Empire",
        description="Senators, legions, and emperors of Rome",
        is_library=True,
    )
    local_file.write_text(json.dumps([merged_personal, hist_item], ensure_ascii=False), encoding="utf-8")

    client = TestClient(main.app)
    personal_resp = client.get("/api/library?category=personal")
    assert personal_resp.status_code == 200
    p_items = personal_resp.json()["items"]
    assert [it["id"] for it in p_items] == ["demo-personal-trilogy"]
    assert p_items[0]["isPersonal"] is True
    assert p_items[0]["mergedLayerCount"] == 3
    assert p_items[0]["categoryKeys"] == ["personal"]
    assert any(d["key"] == "personal" for d in personal_resp.json()["domains"])

    all_items = {it["id"]: it for it in client.get("/api/library").json()["items"]}
    assert all_items["lib-hist-1"]["mergedLayerCount"] == 0


def test_public_library_endpoints_and_privacy_isolation(tmp_path, monkeypatch):
    local_file = tmp_path / "timelines.json"
    monkeypatch.setattr(storage, "TIMELINES_FILE", local_file)
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    storage._LOCAL_TIMELINES_CACHE_KEY = None
    storage._LOCAL_TIMELINES_CACHE_DATA = None
    storage.invalidate_library_cache()

    items = [
        # 1. Privately link-shared timeline -> MUST NOT leak into /api/library!
        _make_sample_timeline(
            "private-whatsapp-link",
            "הסיפור המשפחתי של משפחת כהן",
            is_library=False,
            is_shared=True,
        ),
        # 2. Curated Hebrew classic library timeline
        _make_sample_timeline(
            "lib-he-ai",
            "מהפכת המחשבים והבינה המלאכותית",
            description="ממכונת טיורינג ועד מודלי שפה",
            is_library=True,
            is_featured=False,
            content_mode="classic",
        ),
        # 3. Featured English kids library timeline
        _make_sample_timeline(
            "lib-en-dino",
            "Dinosaurs and Prehistoric Life",
            description="Evolution of dinosaurs on Earth",
            is_library=True,
            is_featured=True,
            content_mode="kids",
        ),
    ]
    local_file.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")

    client = TestClient(main.app)

    # Anonymous GET /api/library returns ONLY isLibrary=True items, sorted with featured first
    resp = client.get("/api/library")
    assert resp.status_code == 200
    body = resp.json()
    returned_ids = [it["id"] for it in body["items"]]
    assert returned_ids == ["lib-en-dino", "lib-he-ai"]
    assert "private-whatsapp-link" not in returned_ids

    # Language & content_mode filtering
    he_resp = client.get("/api/library?lang=he")
    assert [it["id"] for it in he_resp.json()["items"]] == ["lib-he-ai"]

    kids_resp = client.get("/api/library?content_mode=kids")
    assert [it["id"] for it in kids_resp.json()["items"]] == ["lib-en-dino"]

    # Non-admin user cannot publish or unpublish via PATCH /api/timelines/{id}/library
    main.app.dependency_overrides[main.get_current_user_required] = lambda: {
        "id": "regular-user-1",
        "email": "user@example.com",
    }
    monkeypatch.setattr(main, "is_admin_user", lambda u: bool(u and u.get("role") == "admin"))
    try:
        forbidden = client.patch("/api/timelines/private-whatsapp-link/library", json={"isLibrary": True})
        assert forbidden.status_code == 403

        # Regular user also cannot self-publish via POST /api/timelines
        spoof_resp = client.post(
            "/api/timelines",
            json=_make_sample_timeline("spoof-tl", "Spoofed Library Attempt", is_library=True, is_featured=True),
        )
        assert spoof_resp.status_code == 200
        assert not spoof_resp.json().get("isLibrary")
        assert "spoof-tl" not in [it["id"] for it in client.get("/api/library").json()["items"]]

        # Admin user CAN curate and feature timelines
        main.app.dependency_overrides[main.get_current_user_required] = lambda: {
            "id": "admin-1",
            "email": "admin@example.com",
            "role": "admin",
        }
        pub = client.patch(
            "/api/timelines/lib-he-ai/library",
            json={"isLibrary": True, "isFeatured": True},
        )
        assert pub.status_code == 200
        assert pub.json()["isLibrary"] is True
        assert pub.json()["isFeatured"] is True

        # Admin can cycle coverImageUrl and drag coverImagePositionX/Y without resetting isLibrary/isFeatured
        cov_resp = client.patch(
            "/api/timelines/lib-he-ai/library",
            json={
                "coverImageUrl": "https://upload.wikimedia.org/low-rank.jpg",
                "coverImagePositionX": 22.5,
                "coverImagePositionY": 78.4,
            },
        )
        assert cov_resp.status_code == 200
        cov_json = cov_resp.json()
        assert cov_json["isLibrary"] is True
        assert cov_json["isFeatured"] is True
        assert cov_json["coverImageUrl"] == "https://upload.wikimedia.org/low-rank.jpg"
        assert cov_json["coverImagePositionX"] == 22.5
        assert cov_json["coverImagePositionY"] == 78.4

        # Cover candidates (for cover cycling) are only sent to admins (P-05).
        assert "coverImageCandidates" not in client.get("/api/library?lang=he").json()["items"][0]
        main.app.dependency_overrides[main.get_current_user_optional] = lambda: {
            "id": "admin-1",
            "email": "admin@example.com",
            "role": "admin",
        }
        lib_after_cov = client.get("/api/library?lang=he").json()["items"][0]
        assert lib_after_cov["coverImageUrl"] == "https://upload.wikimedia.org/low-rank.jpg"
        assert lib_after_cov["coverImagePositionX"] == 22.5
        assert lib_after_cov["coverImagePositionY"] == 78.4
        assert lib_after_cov["coverImageCandidates"] == [
            "https://upload.wikimedia.org/high-rank-apollo.jpg",
            "https://upload.wikimedia.org/low-rank.jpg",
        ]

        # Switching coverImageUrl without position resets custom position cleanly
        switch_resp = client.patch(
            "/api/timelines/lib-he-ai/library",
            json={"coverImageUrl": "https://upload.wikimedia.org/high-rank-apollo.jpg"},
        )
        assert switch_resp.status_code == 200
        assert switch_resp.json()["coverImageUrl"] == "https://upload.wikimedia.org/high-rank-apollo.jpg"
        assert switch_resp.json()["coverImagePositionX"] is None
        assert switch_resp.json()["coverImagePositionY"] is None

        # Unpublishing automatically clears isFeatured
        unpub = client.patch("/api/timelines/lib-he-ai/library", json={"isLibrary": False})
        assert unpub.status_code == 200
        assert unpub.json()["isLibrary"] is False
        assert unpub.json()["isFeatured"] is False
        assert [it["id"] for it in client.get("/api/library").json()["items"]] == ["lib-en-dino"]
    finally:
        main.app.dependency_overrides.clear()


def test_library_timeline_is_publicly_readable_without_share_link(monkeypatch):
    sample_tl = _make_sample_timeline("lib-only-1", "Public Library Timeline", is_library=True, is_shared=False)
    monkeypatch.setattr(
        main,
        "get_timeline_with_meta",
        lambda tid: {
            "data": sample_tl,
            "owner_id": "owner-uuid-999",
            "is_shared": False,
            "is_library": True,
            "is_featured": False,
        }
        if tid == "lib-only-1"
        else {
            "data": _make_sample_timeline("priv-1", "Secret", is_library=False, is_shared=False),
            "owner_id": "owner-uuid-999",
            "is_shared": False,
            "is_library": False,
            "is_featured": False,
        },
    )

    client = TestClient(main.app)
    # Anonymous visitor can open a library timeline (read-only: isOwner=False)
    ok_resp = client.get("/api/timelines/lib-only-1")
    assert ok_resp.status_code == 200
    payload = ok_resp.json()
    assert payload["isLibrary"] is True
    assert payload["isOwner"] is False

    # Anonymous visitor still gets 404 on a private non-library timeline
    priv_resp = client.get("/api/timelines/priv-1")
    assert priv_resp.status_code == 404


def test_public_library_admin_featured_reordering(tmp_path, monkeypatch):
    local_file = tmp_path / "timelines.json"
    monkeypatch.setattr(storage, "TIMELINES_FILE", local_file)
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    storage._LOCAL_TIMELINES_CACHE_KEY = None
    storage._LOCAL_TIMELINES_CACHE_DATA = None
    storage.invalidate_library_cache()

    items = [
        {
            **_make_sample_timeline("lib-a", "ציר ראשון", is_library=True, is_featured=False),
            "updatedAt": "2026-10-10T10:00:00Z",
        },
        {
            **_make_sample_timeline("lib-b", "ציר שני", is_library=True, is_featured=False),
            "updatedAt": "2026-10-12T10:00:00Z",
        },
        {
            **_make_sample_timeline("lib-c", "ציר שלישי", is_library=True, is_featured=True),
            "updatedAt": "2026-10-11T10:00:00Z",
        },
        _make_sample_timeline("private-x", "ציר פרטי", is_library=False, is_shared=True),
    ]
    local_file.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")

    client = TestClient(main.app)
    monkeypatch.setattr(main, "is_admin_user", lambda u: bool(u and u.get("role") == "admin"))

    # Default initial order: featured first (lib-c), then updatedAt desc (lib-b, lib-a)
    initial_ids = [it["id"] for it in client.get("/api/library").json()["items"]]
    assert initial_ids == ["lib-c", "lib-b", "lib-a"]

    try:
        # Regular user cannot reorder the Public Library
        main.app.dependency_overrides[main.get_current_user_required] = lambda: {
            "id": "regular-user-1",
            "email": "user@example.com",
        }
        forbidden = client.put("/api/library/order", json={"orderedIds": ["lib-a", "lib-b", "lib-c"]})
        assert forbidden.status_code == 403

        # Admin user reorders Featured display order (putting unstarred lib-a at #1, lib-c at #2,
        # omitting lib-b which must be preserved at the end, and ignoring private-x)
        main.app.dependency_overrides[main.get_current_user_required] = lambda: {
            "id": "admin-1",
            "email": "admin@example.com",
            "role": "admin",
        }
        reorder_resp = client.put(
            "/api/library/order",
            json={"orderedIds": ["private-x", "lib-a", "lib-c"]},
        )
        assert reorder_resp.status_code == 200
        assert reorder_resp.json()["orderedIds"] == ["lib-a", "lib-c", "lib-b"]

        after_items = client.get("/api/library").json()["items"]
        assert [it["id"] for it in after_items] == ["lib-a", "lib-c", "lib-b"]
        assert [it["featuredOrder"] for it in after_items] == [0, 1, 2]

        # Re-saving lib-a as admin without featuredOrder in body preserves featuredOrder=0
        resave_payload = _make_sample_timeline("lib-a", "ציר ראשון מעודכן", is_library=True, is_featured=False)
        resave = client.post("/api/timelines", json=resave_payload)
        assert resave.status_code == 200
        assert resave.json().get("featuredOrder") == 0
        assert [it["id"] for it in client.get("/api/library").json()["items"]] == ["lib-a", "lib-c", "lib-b"]

        # Newly featuring lib-b (without explicit featuredOrder) promotes it to #1 above manual orders
        promote = client.patch("/api/timelines/lib-b/library", json={"isFeatured": True})
        assert promote.status_code == 200
        assert promote.json()["featuredOrder"] is None
        assert [it["id"] for it in client.get("/api/library").json()["items"]] == ["lib-b", "lib-a", "lib-c"]

        # Unpublishing lib-a clears featuredOrder
        unpub = client.patch("/api/timelines/lib-a/library", json={"isLibrary": False})
        assert unpub.status_code == 200
        assert unpub.json()["featuredOrder"] is None
    finally:
        main.app.dependency_overrides.clear()


def test_fast_first_page_supabase_hydrates_only_requested_limit_and_reuses_card_cache(monkeypatch):
    storage.invalidate_library_cache()
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: True)
    monkeypatch.setattr(storage, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(storage, "_trigger_background_library_refresh", lambda: None)

    from services import podcast_store
    list_episodes_calls = []
    monkeypatch.setattr(
        podcast_store,
        "list_episodes",
        lambda tid: list_episodes_calls.append(tid) or [],
    )
    monkeypatch.setattr(
        podcast_store,
        "list_episode_timeline_folders",
        lambda: {"he-tl-02"},
    )

    all_db_rows = {}
    for idx in range(20):
        tid = f"he-tl-{idx:02d}"
        tl = _make_sample_timeline(
            tid,
            f"ציר היסטורי מספר {idx}",
            description="תיאור בעברית",
            is_library=True,
            is_featured=(idx < 2),
            content_mode="classic",
        )
        all_db_rows[tid] = {
            "id": tid,
            "title": tl["title"],
            "description": tl["description"],
            "time_scale": None,
            "updated_at": f"2026-10-{20 - (idx % 15):02d}T10:00:00Z",
            "created_at": "2026-10-01T10:00:00Z",
            "data": tl,
        }
    for idx in range(10):
        tid = f"en-tl-{idx:02d}"
        tl = _make_sample_timeline(
            tid,
            f"English History Timeline {idx}",
            description="English description",
            is_library=True,
            is_featured=False,
            content_mode="classic",
        )
        all_db_rows[tid] = {
            "id": tid,
            "title": tl["title"],
            "description": tl["description"],
            "time_scale": None,
            "updated_at": "2026-10-05T10:00:00Z",
            "created_at": "2026-10-01T10:00:00Z",
            "data": tl,
        }

    hydrated_ids_log = []
    index_query_count = 0

    class FakeResp:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self._payload = payload

        def json(self):
            return self._payload

    class FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, headers=None, params=None):
            nonlocal index_query_count
            params = params or {}
            select_val = params.get("select", "")
            if select_val == storage._LIGHT_LIBRARY_INDEX_SELECT:
                index_query_count += 1
                light_rows = []
                for r in all_db_rows.values():
                    d = r["data"]
                    light_rows.append({
                        "id": r["id"],
                        "title": r["title"],
                        "description": r["description"],
                        "time_scale": r["time_scale"],
                        "updated_at": r["updated_at"],
                        "created_at": r["created_at"],
                        "is_featured": "true" if d.get("isFeatured") else "false",
                        "featured_order": str(d["featuredOrder"]) if d.get("featuredOrder") is not None else None,
                        "is_deleted": "false",
                        "content_mode": d.get("contentMode", "classic"),
                        "detected_lang": None,
                        "cover_url": d.get("coverImageUrl"),
                        "cover_x": None,
                        "cover_y": None,
                    })
                return FakeResp(200, light_rows)

            if "id" in params and params["id"].startswith("in.("):
                # PostgREST-style: ids are double-quoted inside in.(...).
                raw_ids = [i.strip('"') for i in params["id"][4:-1].split(",")]
                hydrated_ids_log.append(list(raw_ids))
                return FakeResp(200, [all_db_rows[i] for i in raw_ids if i in all_db_rows])

            return FakeResp(500, [])

    monkeypatch.setattr(storage, "_supabase_http_client", lambda: FakeClient())

    client = TestClient(main.app)
    resp = client.get("/api/library?lang=he&content_mode=classic&limit=6")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 6
    assert body["total"] == 20
    # First 2 items are featured
    assert body["items"][0]["id"] in ("he-tl-00", "he-tl-01")
    # Podcast folder check resolved `hasPodcast` without N+1 `list_episodes` calls
    he02 = next((it for it in body["items"] if it["id"] == "he-tl-02"), None)
    if he02:
        assert he02["hasPodcast"] is True
    assert list_episodes_calls == []

    # Fast first page only hydrated at most limit+3 (9) rows instead of all 30 timelines
    assert index_query_count == 1
    assert len(hydrated_ids_log) == 1
    assert len(hydrated_ids_log[0]) <= 9
    already_hydrated = set(hydrated_ids_log[0])

    # Subsequent full catalog load reuses the already-cached cards and only fetches the remaining uncached IDs
    hydrated_ids_log.clear()
    full_resp = client.get("/api/library?limit=200")
    assert full_resp.status_code == 200
    full_body = full_resp.json()
    assert full_body["total"] == 30
    newly_hydrated = {tid for batch in hydrated_ids_log for tid in batch}
    assert already_hydrated.isdisjoint(newly_hydrated)
    assert len(already_hydrated) + len(newly_hydrated) == 30
    assert list_episodes_calls == []


def test_deleting_user_saved_timelines_preserves_public_library_items(tmp_path, monkeypatch):
    """
    Deleting personal saved timelines (either single DELETE or 'Delete All') must NEVER remove
    published timelines from the Public Library; instead they are hidden from the personal
    'My Saved Timelines' list (`hiddenFromSaved=True`) while remaining live in `/api/library`
    and visible in the Admin Panel (`/api/timelines?all_users=true`).
    """
    local_file = tmp_path / "timelines.json"
    monkeypatch.setattr(storage, "TIMELINES_FILE", local_file)
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    storage._LOCAL_TIMELINES_CACHE_KEY = None
    storage._LOCAL_TIMELINES_CACHE_DATA = None
    storage.invalidate_library_cache()

    lib_tl = _make_sample_timeline(
        "tl-admin-curated-he",
        "תולדות הקולנוע",
        description="ציר זמן מקיף בעברית",
        is_library=True,
        is_featured=True,
    )
    lib_tl["user_id"] = "admin-1"

    personal_tl = _make_sample_timeline("tl-admin-scratch", "Personal Draft Timeline", description="Draft notes")
    personal_tl["user_id"] = "admin-1"

    storage._save_local_timelines([lib_tl, personal_tl])

    admin_user = {"id": "admin-1", "email": "yonatan.back@gmail.com", "role": "admin"}
    main.app.dependency_overrides[main.get_current_user_required] = lambda: admin_user
    main.app.dependency_overrides[main.get_current_user_optional] = lambda: admin_user
    monkeypatch.setattr(main, "is_admin_user", lambda u: bool(u and u.get("role") == "admin"))
    try:
        client = TestClient(main.app)

        # Before Delete All: both appear in personal saved timelines
        saved_before = client.get("/api/timelines").json()
        assert {r["id"] for r in saved_before} == {"tl-admin-curated-he", "tl-admin-scratch"}

        # Admin clicks 'Delete All' in SavedTimelinesModal
        del_resp = client.delete("/api/timelines")
        assert del_resp.status_code == 200

        # Personal 'Saved Timelines' list is now completely empty
        saved_after = client.get("/api/timelines").json()
        assert saved_after == []

        # Public Library still contains the curated timeline intact!
        lib_resp = client.get("/api/library")
        assert lib_resp.status_code == 200
        lib_ids = [item["id"] for item in lib_resp.json()["items"]]
        assert "tl-admin-curated-he" in lib_ids

        # Admin Panel (`all=true`) shows curated timeline as active (not deleted) and in library
        admin_list = client.get("/api/timelines?all=true").json()
        by_id = {r["id"]: r for r in admin_list}
        assert by_id["tl-admin-curated-he"]["isDeleted"] is False
        assert by_id["tl-admin-curated-he"]["isLibrary"] is True
        assert by_id["tl-admin-scratch"]["isDeleted"] is True
    finally:
        main.app.dependency_overrides.clear()


def test_single_delete_preserves_public_library_timeline(tmp_path, monkeypatch):
    """Single timeline deletion (`DELETE /api/timelines/{id}`) hides a library timeline from Saved without unpublishing it."""
    local_file = tmp_path / "timelines.json"
    monkeypatch.setattr(storage, "TIMELINES_FILE", local_file)
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    storage._LOCAL_TIMELINES_CACHE_KEY = None
    storage._LOCAL_TIMELINES_CACHE_DATA = None
    storage.invalidate_library_cache()

    lib_tl = _make_sample_timeline("tl-lib-single", "Ancient Egypt", description="From Narmer to Cleopatra", is_library=True)
    lib_tl["user_id"] = "admin-1"
    storage._save_local_timelines([lib_tl])

    admin_user = {"id": "admin-1", "email": "yonatan.back@gmail.com", "role": "admin"}
    main.app.dependency_overrides[main.get_current_user_required] = lambda: admin_user
    main.app.dependency_overrides[main.get_current_user_optional] = lambda: admin_user
    monkeypatch.setattr(main, "is_admin_user", lambda u: bool(u and u.get("role") == "admin"))
    try:
        client = TestClient(main.app)
        resp = client.delete("/api/timelines/tl-lib-single")
        assert resp.status_code == 200

        # Hidden from personal saved list
        assert client.get("/api/timelines").json() == []

        # Still live in Public Library
        lib_items = client.get("/api/library").json()["items"]
        assert [x["id"] for x in lib_items] == ["tl-lib-single"]
    finally:
        main.app.dependency_overrides.clear()


def test_admin_can_restore_soft_deleted_timeline_by_publishing(tmp_path, monkeypatch):
    """Admin can restore a soft-deleted timeline by calling `PATCH /api/timelines/{id}/library` with `isLibrary=True`."""
    local_file = tmp_path / "timelines.json"
    monkeypatch.setattr(storage, "TIMELINES_FILE", local_file)
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    storage._LOCAL_TIMELINES_CACHE_KEY = None
    storage._LOCAL_TIMELINES_CACHE_DATA = None
    storage.invalidate_library_cache()

    tl = _make_sample_timeline("tl-soft-deleted", "Restorable Timeline", description="Was soft-deleted earlier")
    tl["user_id"] = "admin-1"
    tl["isDeleted"] = True
    tl["deletedAt"] = "2026-11-05T10:00:00Z"
    storage._save_local_timelines([tl])

    admin_user = {"id": "admin-1", "email": "yonatan.back@gmail.com", "role": "admin"}
    main.app.dependency_overrides[main.get_current_user_required] = lambda: admin_user
    monkeypatch.setattr(main, "is_admin_user", lambda u: bool(u and u.get("role") == "admin"))
    try:
        client = TestClient(main.app)
        resp = client.patch("/api/timelines/tl-soft-deleted/library", json={"isLibrary": True})
        assert resp.status_code == 200
        assert resp.json()["isLibrary"] is True

        lib_items = client.get("/api/library").json()["items"]
        assert [x["id"] for x in lib_items] == ["tl-soft-deleted"]
    finally:
        main.app.dependency_overrides.clear()


def test_extract_language_keeps_english_timeline_with_french_proper_nouns():
    """English timelines containing French film titles (e.g. Lumière, Le Voyage dans la Lune) must stay 'en'."""
    cinema_tl = {
        "title": "History of Cinema: From the Lumière Brothers to Modern CGI",
        "description": "Explore the evolution of cinema from early silent films to the digital age and beyond.",
        "detectedLanguage": "en",
        "articles": [
            {"title": "L'Arrivée d'un train en gare de La Ciotat"},
            {"title": "Le Voyage dans la Lune by Georges Méliès"},
            {"title": "Les Quatre Cents Coups and the French New Wave"},
            {"title": "The Rise of Hollywood Studios and the Golden Age"},
        ],
    }
    assert storage._extract_language(cinema_tl) == "en"




def test_library_facets_group_by_language_and_mode():
    cards = [
        {"language": "en", "contentMode": "classic", "categoryKeys": ["history", "space"]},
        {"language": "en", "contentMode": "classic", "categoryKeys": ["history"]},
        {"language": "he", "contentMode": "kids", "categoryKeys": []},
        {"language": "en", "contentMode": "classic", "category": "arts"},
    ]
    assert storage.build_library_facets(cards) == [
        {"language": "en", "contentMode": "classic", "total": 3, "categories": {"history": 2, "space": 1, "arts": 1}},
        {"language": "he", "contentMode": "kids", "total": 1, "categories": {"history": 1}},
    ]


def test_fast_first_page_carries_catalog_facets_only_when_catalog_is_complete(monkeypatch):
    cards = [
        {"id": "a", "title": "A", "language": "en", "contentMode": "classic", "categoryKeys": ["space"]},
        {"id": "b", "title": "B", "language": "he", "contentMode": "classic", "categoryKeys": ["history"]},
    ]
    monkeypatch.setattr(main, "list_library_timelines_fast_page", lambda *a, **k: (cards[:1], 1))
    main.shared_view_rate_limiter.records.clear()
    client = TestClient(main.app)

    storage.invalidate_library_cache()
    assert "facets" not in client.get("/api/library?limit=6&lang=en").json()

    with storage._LIBRARY_CACHE_LOCK:
        storage._LIBRARY_CACHE_ITEMS = list(cards)
        storage._LIBRARY_CACHE_TS = storage.time.monotonic()
        storage._LIBRARY_CACHE_PARTIAL = False
    try:
        body = client.get("/api/library?limit=6&lang=en").json()
        assert body["facets"] == storage.build_library_facets(cards)

        with storage._LIBRARY_CACHE_LOCK:
            storage._LIBRARY_CACHE_PARTIAL = True
        assert "facets" not in client.get("/api/library?limit=6&lang=he").json()
        # The full catalog pages stay as they were.
        with storage._LIBRARY_CACHE_LOCK:
            storage._LIBRARY_CACHE_PARTIAL = False
        monkeypatch.setattr(main, "list_library_timelines", lambda force_refresh=False: list(cards))
        assert "facets" not in client.get("/api/library?limit=200").json()
    finally:
        storage.invalidate_library_cache()
