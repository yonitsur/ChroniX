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
    saved = storage.save_timeline_data({"id": "test-sharing-round-trip", "title": "Round Trip Test"})
    meta = storage.get_timeline_with_meta(saved["id"])
    assert meta is not None
    assert meta["data"]["id"] == "test-sharing-round-trip"
    assert meta["owner_id"] is None
    # Local-file fallback has no per-item owner tracking, so it's always treated as shared.
    assert meta["is_shared"] is True


def test_public_timelines_storage(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    monkeypatch.setattr(storage, "TIMELINES_FILE", tmp_path / "timelines.json")
    monkeypatch.setattr(storage, "LIKES_FILE", tmp_path / "timeline_likes.json")
    monkeypatch.setattr(storage, "COMMENTS_FILE", tmp_path / "timeline_comments.json")

    # Create two timelines
    storage.save_timeline_data({"id": "t1", "title": "Ancient Egypt", "description": "Pyramids", "is_public": True, "articles": [{"title": "Event 1", "imageUrl": "http://img1.png"}]})
    storage.save_timeline_data({"id": "t2", "title": "Space Race", "description": "Moon landing", "is_public": True, "articles": []})

    # Test listing
    res = storage.list_public_timelines(user_id="user-1", sort="newest")
    assert res["total"] >= 2
    titles = [t["title"] for t in res["timelines"]]
    assert "Ancient Egypt" in titles
    assert "Space Race" in titles

    # Test likes
    like_res1 = storage.toggle_timeline_like("t1", "user-1")
    assert like_res1["hasLiked"] is True
    assert like_res1["likesCount"] == 1

    # Check that user-1 hasLiked is reflected
    res_after_like = storage.list_public_timelines(user_id="user-1")
    t1_entry = next(t for t in res_after_like["timelines"] if t["id"] == "t1")
    assert t1_entry["hasLiked"] is True
    assert t1_entry["likesCount"] == 1

    # Toggle like off
    like_res2 = storage.toggle_timeline_like("t1", "user-1")
    assert like_res2["hasLiked"] is False
    assert like_res2["likesCount"] == 0

    # Test comments
    c1 = storage.create_timeline_comment("t1", "user-1", "Alice", "Fascinating history!")
    assert c1["content"] == "Fascinating history!"
    assert c1["userName"] == "Alice"

    comments = storage.list_timeline_comments("t1")
    assert len(comments) == 1
    assert comments[0]["content"] == "Fascinating history!"

    # Test delete comment
    deleted = storage.delete_timeline_comment("t1", c1["id"], "user-1")
    assert deleted is True
    assert len(storage.list_timeline_comments("t1")) == 0


@pytest.mark.asyncio
async def test_community_endpoints(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    monkeypatch.setattr(storage, "TIMELINES_FILE", tmp_path / "timelines.json")
    monkeypatch.setattr(storage, "LIKES_FILE", tmp_path / "timeline_likes.json")
    monkeypatch.setattr(storage, "COMMENTS_FILE", tmp_path / "timeline_comments.json")

    storage.save_timeline_data({"id": "t-comm", "title": "Renaissance Art", "description": "Masterpieces", "is_public": True})

    # Test GET /api/community/timelines
    comm_res = await main.get_community_timelines(sort="popular", user={"id": "u-test"})
    assert comm_res["total"] >= 1
    assert any(t["id"] == "t-comm" for t in comm_res["timelines"])

    # Test POST /api/timelines/{id}/like
    like_res = await main.like_timeline("t-comm", user={"id": "u-test"})
    assert like_res["hasLiked"] is True
    assert like_res["likesCount"] == 1

    # Test POST /api/timelines/{id}/comments
    comment_res = await main.post_timeline_comment(
        "t-comm",
        body={"content": "Love Leonardo da Vinci!", "userName": "ArtLover"},
        user={"id": "u-test"}
    )
    assert comment_res["content"] == "Love Leonardo da Vinci!"
    assert comment_res["userName"] == "ArtLover"

    # Test GET /api/timelines/{id}/comments
    all_comments = await main.get_timeline_comments("t-comm")
    assert len(all_comments) == 1

    # Test DELETE /api/timelines/{id}/comments/{cid}
    del_res = await main.remove_timeline_comment("t-comm", comment_res["id"], user={"id": "u-test"})
    assert del_res == {"success": True}
    assert len(await main.get_timeline_comments("t-comm")) == 0


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

