import pytest
from dotenv import load_dotenv
load_dotenv()

from fastapi import HTTPException
import main
from services import storage


def _meta(owner_id=None, is_shared=False, data=None):
    return {"data": data or {"id": "tl-1", "title": "Test Timeline"}, "owner_id": owner_id, "is_shared": is_shared}


@pytest.mark.asyncio
async def test_get_single_timeline_not_found(monkeypatch):
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: None)
    with pytest.raises(HTTPException) as exc:
        await main.get_single_timeline("missing-id", user=None)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_single_timeline_private_hides_from_others(monkeypatch):
    # Owned by user A, not shared: an anonymous visitor and a different user both get 404.
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: _meta(owner_id="user-a", is_shared=False))

    with pytest.raises(HTTPException) as exc:
        await main.get_single_timeline("tl-1", user=None)
    assert exc.value.status_code == 404

    with pytest.raises(HTTPException) as exc:
        await main.get_single_timeline("tl-1", user={"id": "user-b"})
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_get_single_timeline_owner_always_sees_it(monkeypatch):
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: _meta(owner_id="user-a", is_shared=False))
    result = await main.get_single_timeline("tl-1", user={"id": "user-a"})
    assert result["isOwner"] is True
    assert result["isShared"] is False


@pytest.mark.asyncio
async def test_get_single_timeline_shared_allows_anonymous_readonly(monkeypatch):
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: _meta(owner_id="user-a", is_shared=True))

    anon_result = await main.get_single_timeline("tl-1", user=None)
    assert anon_result["isOwner"] is False
    assert anon_result["isShared"] is True

    other_user_result = await main.get_single_timeline("tl-1", user={"id": "user-b"})
    assert other_user_result["isOwner"] is False
    assert other_user_result["isShared"] is True

    owner_result = await main.get_single_timeline("tl-1", user={"id": "user-a"})
    assert owner_result["isOwner"] is True


@pytest.mark.asyncio
async def test_set_timeline_share_status_requires_ownership(monkeypatch):
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: _meta(owner_id="user-a", is_shared=False))

    with pytest.raises(HTTPException) as exc:
        await main.set_timeline_share_status("tl-1", body={"enabled": True}, user={"id": "user-b"})
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_set_timeline_share_status_owner_can_toggle(monkeypatch):
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: _meta(owner_id="user-a", is_shared=False))
    monkeypatch.setattr(main, "set_timeline_shared", lambda tid, uid, enabled: True)

    result = await main.set_timeline_share_status("tl-1", body={"enabled": True}, user={"id": "user-a"})
    assert result["isShared"] is True


@pytest.mark.asyncio
async def test_set_timeline_share_status_not_found(monkeypatch):
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: None)
    with pytest.raises(HTTPException) as exc:
        await main.set_timeline_share_status("missing-id", body={"enabled": True}, user={"id": "user-a"})
    assert exc.value.status_code == 404


def test_get_timeline_with_meta_round_trip(monkeypatch, tmp_path):
    # Force the local-file fallback — backend/.env (loaded above) may hold real
    # Supabase credentials, and this must never write to a live database.
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    monkeypatch.setattr(storage, "TIMELINES_FILE", tmp_path / "timelines.json")
    # Saved without a user_id (no auth) — owner_id should reflect that, and sharing
    # defaults to off (save_timeline_data always writes is_public: False).
    saved = storage.save_timeline_data({
        "id": "test-sharing-round-trip",
        "title": "Round Trip Test",
        "articles": [{"id": "ev-1", "title": "Test Event", "from": {"year": 2000}}]
    })
    meta = storage.get_timeline_with_meta(saved["id"])
    assert meta is not None
    assert meta["data"]["id"] == "test-sharing-round-trip"
    assert meta["owner_id"] is None
    # Local-file fallback has no per-item owner tracking, so it's always treated as shared.
    assert meta["is_shared"] is True

@pytest.mark.asyncio
async def test_save_timeline_prevents_non_owner_overwrite(monkeypatch):
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: _meta(owner_id="owner-user", is_shared=True))
    with pytest.raises(HTTPException) as exc:
        await main.save_timeline({"id": "tl-1", "title": "Hacked Title"}, user={"id": "different-user", "email": "other@example.com"})
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_admin_can_unshare_and_delete_any_timeline(monkeypatch):
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: _meta(owner_id="user-a", is_shared=True))
    monkeypatch.setattr(main, "set_timeline_shared", lambda tid, uid, enabled, **kw: True)
    monkeypatch.setattr(main, "delete_timeline_data", lambda tid, user_id=None: True)
    monkeypatch.setattr(main, "is_admin_user", lambda u: True)

    # Admin unshares someone else's timeline
    unshare_res = await main.set_timeline_share_status("tl-1", body={"enabled": False}, user={"id": "admin-user", "email": "admin@example.com"})
    assert unshare_res["isShared"] is False

    # Admin deletes someone else's timeline
    del_res = await main.delete_timeline("tl-1", user={"id": "admin-user", "email": "admin@example.com"})
    assert del_res == {"success": True}


@pytest.mark.asyncio
async def test_get_single_timeline_admin_can_access_private_timeline(monkeypatch):
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: _meta(owner_id="user-a", is_shared=False))
    monkeypatch.setattr(main, "is_admin_user", lambda u: True if u and u.get("email") == "admin@example.com" else False)

    admin_user = {"id": "admin-user", "email": "admin@example.com"}
    result = await main.get_single_timeline("tl-1", user=admin_user)
    assert result["id"] == "tl-1"
    assert result["isOwner"] is True
    assert result["isShared"] is False
    assert result["isAdmin"] is True


@pytest.mark.asyncio
async def test_get_single_timeline_admin_can_access_guest_private_timeline(monkeypatch):
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: _meta(owner_id="guest-anon-123", is_shared=False))
    monkeypatch.setattr(main, "is_admin_user", lambda u: True if u and u.get("email") == "admin@example.com" else False)

    admin_user = {"id": "admin-user", "email": "admin@example.com"}
    result = await main.get_single_timeline("tl-guest", user=admin_user)
    assert result["id"] == "tl-1"
    assert result["isOwner"] is True
    assert result["isShared"] is False
    assert result["isAdmin"] is True


@pytest.mark.asyncio
async def test_admin_save_preserves_original_owner(monkeypatch):
    saved_calls = []
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: _meta(owner_id="original-author", is_shared=False))
    monkeypatch.setattr(main, "is_admin_user", lambda u: True if u and u.get("email") == "admin@example.com" else False)
    monkeypatch.setattr(main, "save_timeline_data", lambda tl, user_id=None: saved_calls.append((tl, user_id)) or tl)

    admin_user = {"id": "admin-user", "email": "admin@example.com"}
    await main.save_timeline({"id": "tl-1", "title": "Updated by admin"}, user=admin_user)
    assert len(saved_calls) == 1
    # Original author ID is preserved, not overwritten by admin's user_id
    assert saved_calls[0][1] == "original-author"


