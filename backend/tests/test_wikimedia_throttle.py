import asyncio
import gzip
import json
import time

import httpx
import pytest

from services import wiki_enricher
from services.wiki_enricher import _WikimediaPoliteTransport, _is_wikimedia_host


def _client(handler, max_concurrency=5):
    inner = httpx.MockTransport(handler)
    return httpx.AsyncClient(transport=_WikimediaPoliteTransport(inner, max_concurrency=max_concurrency))


def test_wikimedia_host_matching():
    assert _is_wikimedia_host("en.wikipedia.org")
    assert _is_wikimedia_host("commons.wikimedia.org")
    assert _is_wikimedia_host("www.wikidata.org")
    assert _is_wikimedia_host("wikipedia.org")
    assert not _is_wikimedia_host("notwikipedia.org")
    assert not _is_wikimedia_host("supabase.co")


@pytest.mark.asyncio
async def test_caps_concurrent_wikimedia_requests():
    active = {"now": 0, "peak": 0}

    async def handler(request):
        active["now"] += 1
        active["peak"] = max(active["peak"], active["now"])
        await asyncio.sleep(0.02)
        active["now"] -= 1
        return httpx.Response(200, json={"ok": True})

    async with _client(handler, max_concurrency=3) as client:
        responses = await asyncio.gather(*(
            client.get(f"https://en.wikipedia.org/w/api.php?q={i}") for i in range(12)
        ))
    assert all(r.status_code == 200 for r in responses)
    assert active["peak"] == 3


@pytest.mark.asyncio
async def test_other_hosts_are_not_throttled():
    active = {"now": 0, "peak": 0}

    async def handler(request):
        active["now"] += 1
        active["peak"] = max(active["peak"], active["now"])
        await asyncio.sleep(0.02)
        active["now"] -= 1
        return httpx.Response(200)

    async with _client(handler, max_concurrency=1) as client:
        await asyncio.gather(*(client.get(f"https://example.supabase.co/x/{i}") for i in range(5)))
    assert active["peak"] == 5


@pytest.mark.asyncio
async def test_429_pauses_wikimedia_traffic_and_retries_once(monkeypatch):
    monkeypatch.setattr(wiki_enricher, "_retry_after_seconds", lambda _resp: 0.05)
    calls = []

    async def handler(request):
        calls.append(asyncio.get_running_loop().time())
        if len(calls) == 1:
            return httpx.Response(429, text="Your bot is making too many requests")
        return httpx.Response(200, json={"title": "Timbuktu"})

    async with _client(handler) as client:
        resp = await client.get("https://en.wikipedia.org/api/rest_v1/page/summary/Timbuktu")
    assert resp.status_code == 200
    assert resp.json() == {"title": "Timbuktu"}
    assert len(calls) == 2
    assert calls[1] - calls[0] >= 0.04  # waited out the cooldown before retrying


@pytest.mark.asyncio
async def test_persistent_429_is_returned_after_one_retry(monkeypatch):
    monkeypatch.setattr(wiki_enricher, "_retry_after_seconds", lambda _resp: 0.01)
    calls = {"n": 0}

    async def handler(request):
        calls["n"] += 1
        return httpx.Response(429)

    async with _client(handler) as client:
        resp = await client.get("https://commons.wikimedia.org/w/api.php?x=1")
    assert resp.status_code == 429
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_long_cooldown_fails_fast_without_hitting_wikimedia():
    calls = {"n": 0}

    async def handler(request):
        calls["n"] += 1
        return httpx.Response(200)

    transport = _WikimediaPoliteTransport(httpx.MockTransport(handler))
    transport._cooldown_until = time.monotonic() + 600
    async with httpx.AsyncClient(transport=transport) as client:
        resp = await client.get("https://en.wikipedia.org/w/api.php?x=1")
    assert resp.status_code == 429
    assert calls["n"] == 0


@pytest.mark.asyncio
async def test_identical_concurrent_gets_share_one_upstream_request():
    calls = {"n": 0}
    payload = {"query": {"pages": {"1": {"title": "File:Timbuktu.jpg"}}}}

    async def handler(request):
        calls["n"] += 1
        await asyncio.sleep(0.02)
        return httpx.Response(
            200,
            headers={"Content-Encoding": "gzip", "Content-Type": "application/json"},
            content=gzip.compress(json.dumps(payload).encode("utf-8")),
        )

    url = "https://he.wikipedia.org/w/api.php?action=query&titles=File%3ATimbuktu.jpg"
    async with _client(handler) as client:
        first, second = await asyncio.gather(client.get(url), client.get(url))
        third = await client.get(url)  # after completion: a fresh request, not a stale cache
    assert first.json() == payload
    assert second.json() == payload
    assert third.json() == payload
    assert calls["n"] == 2
