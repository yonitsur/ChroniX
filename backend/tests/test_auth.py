import pytest
from services.auth_service import verify_supabase_token, get_current_user_optional

@pytest.mark.asyncio
async def test_verify_supabase_token_empty():
    user = await verify_supabase_token("")
    assert user is None

@pytest.mark.asyncio
async def test_get_current_user_optional_no_header():
    user = await get_current_user_optional(None)
    assert user is None

@pytest.mark.asyncio
async def test_get_current_user_optional_invalid_format():
    user = await get_current_user_optional("NotBearer token123")
    assert user is None

@pytest.mark.asyncio
async def test_delete_supabase_user_missing_config():
    from services.auth_service import delete_supabase_user
    # When Supabase is not configured or user_id is empty
    res = await delete_supabase_user("")
    assert res is False

def test_delete_all_user_timelines_empty(monkeypatch):
    from services import storage
    # Force the local-file fallback — backend/.env may hold real Supabase credentials,
    # and this must never issue a DELETE against a live database.
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    assert storage.delete_all_user_timelines("") is False
    # Valid user_id should return True without throwing
    assert storage.delete_all_user_timelines("non-existent-user-12345") is True

@pytest.mark.asyncio
async def test_delete_user_account_rejects_guest():
    from main import delete_user_account
    from fastapi import HTTPException
    guest_user = {"id": "guest-1", "is_anonymous": True}
    with pytest.raises(HTTPException) as exc:
        await delete_user_account(user=guest_user)
    assert exc.value.status_code == 400
    assert "Guest accounts cannot be deleted" in exc.value.detail

@pytest.mark.asyncio
async def test_delete_user_account_registered_user(monkeypatch):
    import main

    async def fake_delete(user_id):
        return True

    monkeypatch.setattr(main, "delete_supabase_user", fake_delete)

    registered_user = {"id": "reg-user-1", "email": "test@example.com", "is_anonymous": False}
    resp = await main.delete_user_account(user=registered_user)
    assert resp.get("success") is True


@pytest.mark.asyncio
async def test_delete_all_timelines_endpoint(tmp_path, monkeypatch):
    import main
    from services import storage

    monkeypatch.setattr(storage, "TIMELINES_FILE", tmp_path / "timelines.json")
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    storage.save_timeline_data({"id": "t1", "title": "Timeline 1", "articles": [{"id": "a1", "title": "Ev"}]})
    assert len(storage.list_all_timelines()) == 1

    user = {"id": "user-123", "is_anonymous": False}
    resp = await main.delete_all_timelines(user=user)
    assert resp == {"success": True}
    assert storage.list_all_timelines() == []
    admin_list = storage.list_all_timelines(all_users=True)
    assert len(admin_list) == 1
    assert admin_list[0]["id"] == "t1"
    assert admin_list[0]["isDeleted"] is True
    assert admin_list[0]["deletedAt"] is not None


@pytest.mark.asyncio
async def test_soft_delete_single_timeline_kept_for_admin(tmp_path, monkeypatch):
    import main
    from fastapi import HTTPException
    from services import storage

    monkeypatch.setattr(storage, "TIMELINES_FILE", tmp_path / "timelines.json")
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)
    storage.save_timeline_data({"id": "t-single", "title": "Single Timeline", "articles": [{"id": "a1", "title": "Ev"}]})

    user = {"id": "user-123", "email": "user@example.com", "is_anonymous": False}
    del_resp = await main.delete_timeline("t-single", user=user)
    assert del_resp == {"success": True}

    # Hidden from regular user list
    assert storage.list_all_timelines(user_id="user-123", all_users=False) == []

    # Still visible in Admin Panel list with isDeleted=True
    admin_list = storage.list_all_timelines(user_id="admin-1", all_users=True)
    assert len(admin_list) == 1
    assert admin_list[0]["id"] == "t-single"
    assert admin_list[0]["isDeleted"] is True

    # Non-admin cannot open a soft-deleted timeline
    monkeypatch.setattr(main, "is_admin_user", lambda u: False)
    with pytest.raises(HTTPException) as exc:
        await main.get_single_timeline("t-single", user=user)
    assert exc.value.status_code == 404

    # Admin can still open the soft-deleted timeline
    monkeypatch.setattr(main, "is_admin_user", lambda u: True)
    tl = await main.get_single_timeline("t-single", user={"id": "admin-1", "email": "admin@example.com"})
    assert tl["id"] == "t-single"


def test_save_timeline_compresses_large_base64_images(tmp_path, monkeypatch):
    import base64
    import io
    import os
    from PIL import Image
    from services import storage

    monkeypatch.setattr(storage, "TIMELINES_FILE", tmp_path / "timelines.json")
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)

    # Create a noisy PNG image > 100 KB when base64-encoded
    noise = os.urandom(300 * 300 * 3)
    img = Image.frombytes("RGB", (300, 300), noise)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    big_png_b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    assert len(big_png_b64) > 80_000

    saved = storage.save_timeline_data({
        "id": "tl-heavy",
        "title": "Heavy Timeline",
        "articles": [{"id": "a1", "title": "Event", "imageUrl": big_png_b64}]
    })
    compressed_url = saved["articles"][0]["imageUrl"]
    assert compressed_url.startswith("data:image/jpeg;base64,")
    assert len(compressed_url) < len(big_png_b64)



