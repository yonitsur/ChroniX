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
    assert result == {"isShared": True}


@pytest.mark.asyncio
async def test_set_timeline_share_status_not_found(monkeypatch):
    monkeypatch.setattr(main, "get_timeline_with_meta", lambda tid: None)
    with pytest.raises(HTTPException) as exc:
        await main.set_timeline_share_status("missing-id", body={"enabled": True}, user={"id": "user-a"})
    assert exc.value.status_code == 404


def test_get_timeline_with_meta_round_trip():
    # Saved without a user_id (no auth) — owner_id should reflect that, and sharing
    # defaults to off (save_timeline_data always writes is_public: False).
    saved = storage.save_timeline_data({"id": "test-sharing-round-trip", "title": "Round Trip Test"})
    meta = storage.get_timeline_with_meta(saved["id"])
    assert meta is not None
    assert meta["data"]["id"] == "test-sharing-round-trip"
    assert meta["owner_id"] is None
    assert meta["is_shared"] is False
