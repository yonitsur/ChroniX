import pytest
from fastapi import HTTPException

import main
from services import storage


@pytest.fixture(autouse=True)
def no_live_supabase(monkeypatch):
    monkeypatch.setattr(storage, "_supabase_is_configured", lambda: False)


def test_sanitize_chat_messages_whitelists_fields():
    messages = [
        {"id": "u-1", "role": "user", "content": "hi", "canUndo": True, "extra": "x"},
        {"id": "a-2", "role": "assistant", "content": "hello", "action": "edit", "undone": True,
         "sources": [{"title": "ok", "url": "https://example.com"}, {"title": "bad", "url": "javascript:alert(1)"}]},
        {"id": "s-3", "role": "system", "content": "nope"},
        {"id": "u-4", "role": "user", "content": 42},
        "garbage",
    ]
    clean = main._sanitize_chat_messages(messages)
    assert clean == [
        {"id": "u-1", "role": "user", "content": "hi"},
        {"id": "a-2", "role": "assistant", "content": "hello", "action": "edit", "undone": True,
         "sources": [{"title": "ok", "url": "https://example.com"}]},
    ]


def test_sanitize_chat_messages_caps_count_and_rejects_non_list():
    many = [{"id": f"u-{i}", "role": "user", "content": "x"} for i in range(250)]
    clean = main._sanitize_chat_messages(many)
    assert len(clean) == main.MAX_STORED_CHAT_MESSAGES
    assert clean[-1]["id"] == "u-249"
    with pytest.raises(HTTPException) as exc:
        main._sanitize_chat_messages({"not": "a list"})
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_get_chat_returns_null_messages_when_store_unavailable():
    result = await main.get_timeline_chat_endpoint("tl-1", user={"id": "user-a"})
    assert result == {"messages": None, "updatedAt": None}


@pytest.mark.asyncio
async def test_save_chat_requires_ownership(monkeypatch):
    saved = []
    monkeypatch.setattr(main, "get_timeline_owner", lambda tid: {"owner_id": "user-a"})
    monkeypatch.setattr(main, "save_timeline_chat", lambda tid, uid, msgs: saved.append((tid, uid, msgs)) or True)
    body = {"messages": [{"id": "u-1", "role": "user", "content": "hi"}]}

    with pytest.raises(HTTPException) as exc:
        await main.save_timeline_chat_endpoint("tl-1", body=body, user={"id": "user-b"})
    assert exc.value.status_code == 403
    assert saved == []

    result = await main.save_timeline_chat_endpoint("tl-1", body=body, user={"id": "user-a"})
    assert result == {"success": True, "count": 1}
    assert saved == [("tl-1", "user-a", [{"id": "u-1", "role": "user", "content": "hi"}])]


@pytest.mark.asyncio
async def test_save_chat_missing_timeline_is_404(monkeypatch):
    monkeypatch.setattr(main, "get_timeline_owner", lambda tid: None)
    with pytest.raises(HTTPException) as exc:
        await main.save_timeline_chat_endpoint("missing", body={"messages": []}, user={"id": "user-a"})
    assert exc.value.status_code == 404
