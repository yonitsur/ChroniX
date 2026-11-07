"""P-04 (gzip for JSON, never for audio) and P-05 (one cover per Library card; candidates for admins only)."""
import copy
import gzip

import pytest
from fastapi.testclient import TestClient

import main
from services import podcast_store, storage
from services.auth_service import get_current_user_optional

ADMIN = {"id": "lib-admin", "email": "admin@example.com", "app_metadata": {"role": "admin"}}
REGULAR = {"id": "lib-user", "email": "user@example.com"}
BIG_DATA_COVER = "data:image/jpeg;base64," + "A" * 120_000


def _card(i: int, cover: str, candidates):
    return {
        "id": f"lib-{i}",
        "title": f"Library timeline {i}",
        "description": "A curated timeline " * 10,
        "coverImageUrl": cover,
        "coverImageCandidates": list(candidates),
        "language": "en",
        "contentMode": "classic",
        "isFeatured": False,
        "categories": ["History & Politics"],
        "categoryKeys": ["history"],
        "tags": [],
    }


@pytest.fixture
def library_env(monkeypatch):
    http_candidates = [f"https://upload.wikimedia.org/c-{j}.jpg" for j in range(24)]
    cards = [_card(i, http_candidates[0], http_candidates) for i in range(30)]
    cards.append(_card(30, BIG_DATA_COVER, [BIG_DATA_COVER, "https://upload.wikimedia.org/fallback.jpg"]))
    cards.append(_card(31, BIG_DATA_COVER, [BIG_DATA_COVER]))
    snapshot = copy.deepcopy(cards)

    monkeypatch.setattr(main, "list_library_timelines", lambda force_refresh=False: list(cards))
    monkeypatch.setattr(
        main, "list_library_timelines_fast_page",
        lambda lang, mode, featured, limit: (list(cards)[:limit], len(cards)),
    )
    main.shared_view_rate_limiter.records.clear()
    current = {"user": None}
    main.app.dependency_overrides[get_current_user_optional] = lambda: current["user"]
    with TestClient(main.app) as client:
        yield {"client": client, "cards": cards, "snapshot": snapshot, "as_user": lambda u: current.__setitem__("user", u)}
    main.app.dependency_overrides.clear()


@pytest.mark.parametrize("query", ["/api/library?limit=200", "/api/library?limit=12"])
@pytest.mark.parametrize("viewer", [None, REGULAR])
def test_non_admin_library_has_one_cover_and_no_candidates(library_env, query, viewer):
    library_env["as_user"](viewer)
    items = library_env["client"].get(query).json()["items"]
    assert items
    for item in items:
        assert "coverImageCandidates" not in item
        cover = item["coverImageUrl"]
        assert cover is None or not cover.startswith("data:") or len(cover) <= 70_000
    by_id = {it["id"]: it for it in items}
    if "lib-30" in by_id:
        assert by_id["lib-30"]["coverImageUrl"] == "https://upload.wikimedia.org/fallback.jpg"
        assert by_id["lib-31"]["coverImageUrl"] is None
    assert library_env["cards"] == library_env["snapshot"]  # shared cache objects untouched


@pytest.mark.parametrize("query", ["/api/library?limit=200", "/api/library?limit=12"])
def test_admin_library_keeps_cover_candidates(library_env, query):
    library_env["as_user"](ADMIN)
    items = library_env["client"].get(query).json()["items"]
    assert items and all(len(it["coverImageCandidates"]) >= 1 for it in items)
    assert items[0]["coverImageCandidates"] == library_env["snapshot"][0]["coverImageCandidates"]
    assert library_env["cards"] == library_env["snapshot"]


def test_card_builder_never_picks_an_oversized_data_cover():
    tl = {
        "id": "tl-big",
        "title": "Big covers",
        "coverImageUrl": BIG_DATA_COVER,
        "articles": [
            {"id": "e1", "title": "One", "from": {"year": 1900}, "rank": 10, "imageUrl": BIG_DATA_COVER},
            {"id": "e2", "title": "Two", "from": {"year": 1901}, "rank": 1, "imageUrl": "https://x.org/a.jpg"},
        ],
    }
    card = storage._extract_library_card_meta(tl, podcast_folders=set())
    assert card["coverImageUrl"] == "https://x.org/a.jpg"
    only_big = {**tl, "articles": [tl["articles"][0]]}
    assert storage._extract_library_card_meta(only_big, podcast_folders=set())["coverImageUrl"] is None


# --- P-04 ----------------------------------------------------------------------------------------

def test_large_json_is_gzipped_and_decodes(library_env):
    client = library_env["client"]
    res = client.get("/api/library?limit=200", headers={"Accept-Encoding": "gzip"})
    assert res.status_code == 200
    assert res.headers.get("content-encoding") == "gzip"
    assert "accept-encoding" in res.headers.get("vary", "").lower()
    assert len(res.json()["items"]) == 32  # httpx transparently decodes

    with client.stream("GET", "/api/library?limit=200", headers={"Accept-Encoding": "gzip"}) as streamed:
        compressed = b"".join(streamed.iter_raw())
    assert gzip.decompress(compressed).startswith(b"{")

    plain = client.get("/api/library?limit=200", headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in plain.headers


def test_small_json_is_not_gzipped(library_env):
    res = library_env["client"].get("/api/podcast/options?lang=en", headers={"Accept-Encoding": "gzip"})
    assert res.status_code == 200
    assert len(res.content) < 1024 and "content-encoding" not in res.headers


def test_cors_headers_still_present_on_gzipped_response(library_env):
    res = library_env["client"].get(
        "/api/library?limit=200", headers={"Accept-Encoding": "gzip", "Origin": "https://example.org"}
    )
    assert res.headers.get("content-encoding") == "gzip"
    assert res.headers.get("access-control-allow-origin")


@pytest.mark.parametrize("range_header", [None, "bytes=0-99"])
def test_podcast_audio_is_never_gzipped(library_env, monkeypatch, tmp_path, range_header):
    audio = b"\xff\xf3\x44\xc4" * 5000
    # Clips are served from the stored file now (SC-05), not from an in-memory copy.
    monkeypatch.setenv("PODCAST_STORAGE_BACKEND", "local")
    monkeypatch.setattr(podcast_store, "LOCAL_DIR", tmp_path / "podcasts")
    podcast_store.put_clip("a" * 64, audio, {"key": "a" * 64})
    main.podcast_stream_rate_limiter.records.clear()
    headers = {"Accept-Encoding": "gzip"}
    if range_header:
        headers["Range"] = range_header
    res = library_env["client"].get("/api/podcast-audio/" + "a" * 64 + ".mp3", headers=headers)
    assert res.status_code == (206 if range_header else 200)
    assert "content-encoding" not in res.headers
    assert res.content == (audio[:100] if range_header else audio)
