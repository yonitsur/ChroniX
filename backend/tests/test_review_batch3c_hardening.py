"""Batch 3C: S-08 API headers, S-09 timeline ids, S-14 Google Photos URLs, S-15 hardening items."""
import asyncio
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

import main
from services import gemini_service, google_photos, storage
from services.auth_service import get_current_user_required

OWNER = {"id": "owner-3c", "email": "owner3c@example.com"}
ADMIN = {"id": "admin-3c", "email": "admin@example.com"}


@pytest.fixture
def as_user(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    current = {"user": OWNER}
    main.app.dependency_overrides[get_current_user_required] = lambda: current["user"]
    yield current
    main.app.dependency_overrides.clear()


# --- S-08: security headers on API responses --------------------------------------------------

def test_api_responses_carry_security_headers():
    with TestClient(main.app) as client:
        res = client.get("/api/guest-policy")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert res.headers["referrer-policy"] == "no-referrer"


def test_security_headers_middleware_keeps_route_headers_and_streams():
    sent = []

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": [(b"x-frame-options", b"SAMEORIGIN")]})
        await send({"type": "http.response.body", "body": b"a", "more_body": True})
        await send({"type": "http.response.body", "body": b"b"})

    async def send(message):
        sent.append(message)

    asyncio.run(main.SecurityHeadersMiddleware(app)({"type": "http"}, None, send))
    headers = dict(sent[0]["headers"])
    assert headers[b"x-frame-options"] == b"SAMEORIGIN"
    assert headers[b"x-content-type-options"] == b"nosniff"
    assert [m.get("body") for m in sent[1:]] == [b"a", b"b"]  # body chunks pass through unbuffered


# --- S-09: timeline ids -----------------------------------------------------------------------

def test_generated_timeline_ids_carry_a_full_uuid4():
    tid = gemini_service.new_timeline_id("The Roman Empire")
    prefix, _, slug = tid.partition("-")
    assert slug == "the-roman-empire"
    parsed = uuid.UUID(hex=prefix)
    assert parsed.version == 4 and parsed.hex == prefix  # 122 random bits
    ids = {gemini_service.new_timeline_id("Rome") for _ in range(2000)}
    assert len(ids) == 2000
    long_id = gemini_service.new_timeline_id("שלום " * 200)
    assert len(long_id) <= 128
    assert uuid.UUID(hex=gemini_service.new_timeline_id("")).version == 4


# --- S-14: Google Photos media URL --------------------------------------------------------------

def test_google_photos_url_built_from_parsed_parts():
    base = "https://lh3.googleusercontent.com/ppa/AbC-dEf_123"
    assert google_photos.sized_media_url(base, 320) == f"{base}=w320-h320"
    assert google_photos.sized_media_url(f"{base}=w2048-h1024-c", 512) == f"{base}=w512-h512"
    for bad in [
        "https://attacker.com=@lh3.googleusercontent.com/x",
        "https://user:pw@lh3.googleusercontent.com/x",
        "https://lh3.googleusercontent.com@attacker.com/x",
        "https://attacker.com\\@lh3.googleusercontent.com/x",
        "https://lh3.googleusercontent.com:443@attacker.com/x",
        "https://lh3.googleusercontent.com /x",
        "ftp://lh3.googleusercontent.com/x",
        "",
    ]:
        with pytest.raises(google_photos.GooglePhotosError):
            google_photos.sized_media_url(bad, 320)


def test_google_photos_fetch_rechecks_the_final_host(monkeypatch):
    monkeypatch.setattr(google_photos, "sized_media_url", lambda base_url, size: "https://attacker.com/x=w320-h320")

    class NoNetwork:
        def __init__(self, *a, **k):
            raise AssertionError("must not fetch a non-Google host")

    monkeypatch.setattr(google_photos.httpx, "AsyncClient", NoNetwork)
    with pytest.raises(google_photos.GooglePhotosError) as err:
        asyncio.run(google_photos.fetch_media("tok", "https://lh3.googleusercontent.com/x", 320))
    assert err.value.status == 400


# --- S-15 --------------------------------------------------------------------------------------

def test_library_id_in_filter_quotes_every_value():
    assert storage._postgrest_in_list(["a", "b"]) == 'in.("a","b")'
    assert storage._postgrest_in_list(['x,y)', 'q"z', "b\\s"]) == 'in.("x,y)","q\\"z","b\\\\s")'


def test_delete_all_wipes_unowned_local_rows_only_for_admins(monkeypatch, as_user):
    calls = []
    monkeypatch.setattr(main, "delete_all_user_timelines", lambda uid, include_unowned: calls.append((uid, include_unowned)) or True)
    with TestClient(main.app) as client:
        assert client.delete("/api/timelines").status_code == 200
        as_user["user"] = ADMIN
        assert client.delete("/api/timelines").status_code == 200
    assert calls == [(OWNER["id"], False), (ADMIN["id"], True)]


def _game_env(monkeypatch, meta):
    saved = []
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: meta)
    monkeypatch.setattr(main, "save_timeline_data", lambda data, user_id=None, existing_meta=None: saved.append(data) or True)
    return saved


def test_quiz_round_on_library_timeline_is_not_persisted_for_non_admin_owner(monkeypatch):
    meta = {"data": {"id": "lib-3c", "title": "T"}, "owner_id": OWNER["id"], "is_library": True}
    saved = _game_env(monkeypatch, meta)
    result = {"questions": [{"q": 1}], "tokenUsage": {"model": "m"}}
    asyncio.run(main._persist_generated_game("lib-3c", OWNER, "quiz", "quizModel", result["questions"], result))
    assert saved == []
    asyncio.run(main._persist_generated_game("lib-3c", ADMIN, "whoami", "whoamiModel", [{"w": 1}], {}))
    assert saved and saved[0]["whoami"] == [{"w": 1}] and saved[0]["isLibrary"] is True


def test_quiz_round_on_own_private_timeline_is_still_persisted(monkeypatch):
    meta = {"data": {"id": "own-3c", "title": "T"}, "owner_id": OWNER["id"], "is_library": False}
    saved = _game_env(monkeypatch, meta)
    result = {"questions": [{"q": 1}], "tokenUsage": {"model": "m"}}
    asyncio.run(main._persist_generated_game("own-3c", OWNER, "quiz", "quizModel", result["questions"], result))
    assert saved[0]["quiz"] == [{"q": 1}] and saved[0]["quizModel"] == "m"
    saved.clear()
    asyncio.run(main._persist_generated_game("own-3c", {"id": "someone-else"}, "quiz", "quizModel", [{"q": 2}], {}))
    assert saved == []


def test_share_author_name_is_validated_and_capped(monkeypatch, as_user):
    meta = {"data": {"id": "tl-3c"}, "owner_id": OWNER["id"]}
    stored = []
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: meta)
    monkeypatch.setattr(main, "set_timeline_shared", lambda tid, uid, enabled, author_name=None: stored.append(author_name) or True)
    with TestClient(main.app) as client:
        res = client.patch("/api/timelines/tl-3c/share", json={"enabled": True, "authorName": "  Ada‮\x00 Love\nlace  " + "x" * 200})
        assert res.status_code == 200
        name = res.json()["authorName"]
        assert len(name) == main.MAX_SHARE_AUTHOR_NAME_CHARS
        assert name.startswith("Ada Love lace") and "‮" not in name and "\x00" not in name
        assert stored[-1] == name
        assert client.patch("/api/timelines/tl-3c/share", json={"enabled": True, "authorName": {"x": 1}}).status_code == 400
        assert client.patch("/api/timelines/tl-3c/share", json={"enabled": True, "authorName": ["a"]}).status_code == 400
        assert client.patch("/api/timelines/tl-3c/share", json={"enabled": True, "authorName": " \t "}).json()["authorName"] is None
        assert client.patch("/api/timelines/tl-3c/share", json={"enabled": False}).json()["authorName"] is None
