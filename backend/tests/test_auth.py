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

def test_delete_all_user_timelines_empty():
    from services.storage import delete_all_user_timelines
    assert delete_all_user_timelines("") is False
    # Valid user_id should return True without throwing
    assert delete_all_user_timelines("non-existent-user-12345") is True

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

