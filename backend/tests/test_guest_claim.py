import pytest
from fastapi import HTTPException

import main
from services import auth_service


REGISTERED = {"id": "user-real", "is_anonymous": False}
GUEST = {"id": "user-guest", "is_anonymous": True}


def _fake_resolver(result):
    async def _resolve(access_token, refresh_token=None):
        return result
    return _resolve


@pytest.mark.asyncio
async def test_claim_moves_guest_timelines_to_account(monkeypatch):
    calls = []
    monkeypatch.setattr(main, "resolve_guest_session_user", _fake_resolver(GUEST))
    monkeypatch.setattr(main, "transfer_user_timelines", lambda src, dst: calls.append((src, dst)) or ["tl-1", "tl-2"])

    result = await main.claim_guest_work(body={"guestAccessToken": "tok"}, user=REGISTERED)

    assert calls == [("user-guest", "user-real")]
    assert result == {"transferred": 2, "timelineIds": ["tl-1", "tl-2"]}


@pytest.mark.asyncio
async def test_claim_rejects_invalid_guest_session(monkeypatch):
    monkeypatch.setattr(main, "resolve_guest_session_user", _fake_resolver(None))
    monkeypatch.setattr(main, "transfer_user_timelines", lambda src, dst: pytest.fail("must not transfer"))

    with pytest.raises(HTTPException) as exc:
        await main.claim_guest_work(body={"guestAccessToken": "bad"}, user=REGISTERED)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_claim_requires_registered_target(monkeypatch):
    monkeypatch.setattr(main, "transfer_user_timelines", lambda src, dst: pytest.fail("must not transfer"))
    with pytest.raises(HTTPException) as exc:
        await main.claim_guest_work(body={"guestAccessToken": "tok"}, user={"id": "other-guest", "is_anonymous": True})
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_claim_same_user_is_noop(monkeypatch):
    monkeypatch.setattr(main, "resolve_guest_session_user", _fake_resolver({**GUEST, "id": "user-real"}))
    monkeypatch.setattr(main, "transfer_user_timelines", lambda src, dst: pytest.fail("must not transfer"))
    result = await main.claim_guest_work(body={"guestAccessToken": "tok"}, user=REGISTERED)
    assert result["transferred"] == 0


@pytest.mark.asyncio
async def test_resolver_never_returns_registered_accounts(monkeypatch):
    async def _verify(token):
        return {"id": "someone", "is_anonymous": False}
    monkeypatch.setattr(auth_service, "verify_supabase_token", _verify)
    assert await auth_service.resolve_guest_session_user("tok") is None
