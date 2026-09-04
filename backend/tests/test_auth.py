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
