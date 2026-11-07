import asyncio
import gzip
import json
import time

import httpx
import pytest

from services import wiki_enricher
from services.wiki_enricher import _WikimediaPoliteTransport, _is_wikimedia_host


def _client(handler, max_concurrency=5, max_rps=0.0, max_attempts=None):
    inner = httpx.MockTransport(handler)
    return httpx.AsyncClient(
        transport=_WikimediaPoliteTransport(
            inner,
            max_concurrency=max_concurrency,
            max_rps=max_rps,
            max_attempts=max_attempts,
        )
    )


@pytest.fixture
def isolated_wiki_caches():
    caches = (
        wiki_enricher._RAW_SUMMARY_CACHE,
        wiki_enricher._SEARCH_CACHE,
        wiki_enricher._LANGLINK_CACHE,
        wiki_enricher._PROBE_CACHE,
        wiki_enricher._COMMONS_GIF_CACHE,
        wiki_enricher._WIKIDATA_IMAGE_CACHE,
        wiki_enricher._COMMONS_FALLBACK_CACHE,
        wiki_enricher._PAGE_IMAGES_RAW_CACHE,
        wiki_enricher._FILE_IMAGEINFO_CACHE,
        wiki_enricher._ARTICLE_IMAGES_CACHE,
    )
    for c in caches:
        c.clear()
    try:
        yield
    finally:
        for c in caches:
            c.clear()


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
async def test_other_hosts_and_plain_http_are_blocked():
    async def handler(request):
        return httpx.Response(200)

    async with _client(handler, max_concurrency=1) as client:
        with pytest.raises(httpx.UnsupportedProtocol):
            await client.get("https://example.supabase.co/x/0")
        with pytest.raises(httpx.UnsupportedProtocol):
            await client.get("http://en.wikipedia.org/w/api.php")


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
async def test_persistent_429_is_returned_after_max_retries(monkeypatch):
    monkeypatch.setattr(wiki_enricher, "_retry_after_seconds", lambda _resp: 0.01)
    calls = {"n": 0}

    async def handler(request):
        calls["n"] += 1
        return httpx.Response(429)

    async with _client(handler) as client:
        resp = await client.get("https://commons.wikimedia.org/w/api.php?x=1")
    assert resp.status_code == 429
    assert calls["n"] == wiki_enricher._WIKIMEDIA_GET_MAX_ATTEMPTS


@pytest.mark.asyncio
async def test_multiple_429s_and_503_recover_within_retry_budget(monkeypatch):
    monkeypatch.setattr(wiki_enricher, "_retry_after_seconds", lambda _resp: 0.01)
    statuses = [429, 429, 503, 200]
    seen = []

    async def handler(request):
        idx = len(seen)
        seen.append(idx)
        code = statuses[idx]
        if code == 200:
            return httpx.Response(200, json={"title": "Recovered"})
        return httpx.Response(code)

    transport = _WikimediaPoliteTransport(httpx.MockTransport(handler), max_rps=0.0)
    async with httpx.AsyncClient(transport=transport) as client:
        resp = await client.get("https://en.wikipedia.org/api/rest_v1/page/summary/Recovered")
    assert resp.status_code == 200
    assert resp.json() == {"title": "Recovered"}
    assert len(seen) == 4
    assert transport.rate_limit_count == 2
    assert transport.transient_error_count == 3


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
async def test_medium_retry_after_above_10s_waits_instead_of_failing_fast(monkeypatch):
    """Previously _WIKIMEDIA_MAX_QUEUE_WAIT_SEC=10s caused any Retry-After > 10s to fail fast with fake 429s."""
    assert wiki_enricher._wikimedia_max_queue_wait_sec() >= 60.0

    clock = {"now": 1000.0}
    sleeps = []

    monkeypatch.setattr(wiki_enricher.time, "monotonic", lambda: clock["now"])

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        clock["now"] += seconds

    monkeypatch.setattr(wiki_enricher.asyncio, "sleep", fake_sleep)

    calls = {"n": 0}

    async def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "18"})
        return httpx.Response(200, json={"ok": True})

    async with _client(handler, max_concurrency=4, max_rps=25.0) as client:
        r1, r2 = await asyncio.gather(
            client.get("https://en.wikipedia.org/w/api.php?q=1"),
            client.get("https://en.wikipedia.org/w/api.php?q=2"),
        )
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert any(s >= 17.5 for s in sleeps)


@pytest.mark.asyncio
async def test_rps_token_bucket_paces_burst_and_prevents_post_429_stampede(monkeypatch):
    monkeypatch.setattr(wiki_enricher, "_retry_after_seconds", lambda _resp: 0.04)
    timestamps = []
    sent = {"n": 0}

    async def handler(request):
        sent["n"] += 1
        now = time.monotonic()
        if sent["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "1"})
        timestamps.append(now)
        return httpx.Response(200, json={"ok": sent["n"]})

    # max_rps=40 -> 25ms spacing once post-429 burst is reset to 1 token
    async with _client(handler, max_concurrency=5, max_rps=40.0) as client:
        responses = await asyncio.gather(*(
            client.get(f"https://en.wikipedia.org/w/api.php?item={i}") for i in range(5)
        ))
    assert all(r.status_code == 200 for r in responses)
    assert len(timestamps) == 5
    timestamps.sort()
    # After 429 cooldown, 5 requests should trickle over ~4 * 25ms (~100ms), not stampede in <10ms
    assert timestamps[-1] - timestamps[0] >= 0.075


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


@pytest.mark.asyncio
async def test_transient_failures_never_poison_negative_caches(isolated_wiki_caches, monkeypatch):
    monkeypatch.setattr(wiki_enricher, "_retry_after_seconds", lambda _resp: 0.005)
    mode = {"fail": True}

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if mode["fail"]:
            # Mix HTTP 429 and HTTP-200 MediaWiki maxlag errors to test both failure shapes
            if "list=search" in url or "prop=langlinks" in url:
                return httpx.Response(200, json={"error": {"code": "maxlag", "info": "Waiting for replica"}})
            return httpx.Response(429, headers={"Retry-After": "1"})

        if "/page/summary/" in url:
            if "Missing_Page_404" in url:
                return httpx.Response(404, json={"type": "not_found"})
            return httpx.Response(200, json={
                "title": "Apollo 11",
                "type": "standard",
                "description": "1969 crewed lunar landing",
                "extract": "Apollo 11 landed humans on the Moon in 1969.",
                "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Apollo_11"}},
                "thumbnail": {"source": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Apollo11.jpg/320px-Apollo11.jpg", "width": 320},
            })
        if "list=search" in url:
            return httpx.Response(200, json={"query": {"search": [{"title": "Apollo 11"}]}})
        if "action=opensearch" in url:
            return httpx.Response(200, json=["Apollo 11", ["Apollo 11"], [""], ["https://en.wikipedia.org/wiki/Apollo_11"]])
        if "prop=langlinks" in url:
            return httpx.Response(200, json={"query": {"pages": {"1": {"title": "אפולו 11", "langlinks": [{"*": "Apollo 11"}]}}}})
        if "prop=pageprops" in url and "prop=pageimages" not in url:
            return httpx.Response(200, json={"query": {"pages": {"1": {"title": "Apollo 11"}}}})
        if "gsrnamespace=6" in url and "filemime" in url:
            return httpx.Response(200, json={
                "query": {
                    "pages": {
                        "10": {
                            "title": "File:Apollo_11_launch.gif",
                            "imageinfo": [{
                                "url": "https://upload.wikimedia.org/wikipedia/commons/1/11/Apollo_11_launch.gif",
                                "width": 480,
                                "height": 360,
                                "mime": "image/gif",
                                "metadata": [{"name": "frameCount", "value": 12}],
                                "extmetadata": {"ObjectName": {"value": "Apollo 11 launch"}},
                            }],
                        }
                    }
                }
            })
        if "prop=pageimages" in url:
            return httpx.Response(200, json={
                "query": {
                    "pages": {
                        "1": {
                            "title": "Apollo 11",
                            "pageimage": "Apollo11.jpg",
                            "thumbnail": {"source": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Apollo11.jpg/800px-Apollo11.jpg", "width": 800},
                            "images": [{"ns": 6, "title": "File:Buzz_Aldrin_on_Moon.jpg"}],
                        }
                    }
                }
            })
        if "prop=imageinfo" in url:
            return httpx.Response(200, json={
                "query": {
                    "pages": {
                        "2": {
                            "title": "File:Buzz_Aldrin_on_Moon.jpg",
                            "imageinfo": [{
                                "url": "https://upload.wikimedia.org/wikipedia/commons/b/b2/Buzz_Aldrin_on_Moon.jpg",
                                "thumburl": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/Buzz_Aldrin_on_Moon.jpg/800px-Buzz_Aldrin_on_Moon.jpg",
                                "width": 1200,
                                "height": 900,
                                "mime": "image/jpeg",
                                "extmetadata": {"ObjectName": {"value": "Buzz Aldrin on the Moon"}},
                            }],
                        }
                    }
                }
            })
        return httpx.Response(200, json={"query": {"pages": {}}})

    sem = asyncio.Semaphore(5)
    async with _client(handler, max_concurrency=5, max_attempts=1) as client:
        assert wiki_enricher._is_real_http_client(client)

        # Phase 1: Wikimedia fails everywhere — nothing may be cached as negative/partial
        assert await wiki_enricher._get_summary_direct("Apollo 11", client, lang="en") is None
        assert len(wiki_enricher._RAW_SUMMARY_CACHE) == 0

        assert await wiki_enricher._search_wikipedia_titles("Apollo 11 landing", client, lang="en") == []
        assert len(wiki_enricher._SEARCH_CACHE) == 0

        assert await wiki_enricher._get_langlink("אפולו 11", "he", "en", client) is None
        assert len(wiki_enricher._LANGLINK_CACHE) == 0

        assert await wiki_enricher._probe_title("Apollo 11", "en", "he", client) is None
        assert len(wiki_enricher._PROBE_CACHE) == 0

        assert await wiki_enricher.fetch_commons_gif_candidates("Apollo 11", client) == []
        assert len(wiki_enricher._COMMONS_GIF_CACHE) == 0

        partial_imgs = await wiki_enricher.fetch_image_candidates(
            "Apollo 11",
            client,
            sem,
            lang="en",
            lead_url="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Apollo11.jpg/800px-Apollo11.jpg",
        )
        # Lead URL still returned immediately, yet degraded run is NOT cached into _ARTICLE_IMAGES_CACHE
        assert len(partial_imgs) == 1
        assert len(wiki_enricher._ARTICLE_IMAGES_CACHE) == 0

        # Phase 2: Wikimedia recovers — subsequent lookups get full data instead of 30-min poisoned cache
        mode["fail"] = False
        summary = await wiki_enricher._get_summary_direct("Apollo 11", client, lang="en")
        assert summary is not None and summary["wikiTitle"] == "Apollo 11"

        # Genuine 404 IS still cached negatively
        assert await wiki_enricher._get_summary_direct("Missing_Page_404", client, lang="en") is None
        assert ("en", "missing_page_404") in wiki_enricher._RAW_SUMMARY_CACHE

        assert await wiki_enricher._search_wikipedia_titles("Apollo 11 landing", client, lang="en") == ["Apollo 11"]
        assert await wiki_enricher._get_langlink("אפולו 11", "he", "en", client) == "Apollo 11"
        assert (await wiki_enricher._probe_title("Apollo 11", "en", "he", client))["exists"] is True
        assert len(await wiki_enricher.fetch_commons_gif_candidates("Apollo 11", client)) == 1

        full_imgs = await wiki_enricher.fetch_image_candidates(
            "Apollo 11",
            client,
            sem,
            lang="en",
            lead_url="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Apollo11.jpg/800px-Apollo11.jpg",
        )
        assert len(full_imgs) >= 2
        assert len(wiki_enricher._ARTICLE_IMAGES_CACHE) == 1


@pytest.mark.asyncio
async def test_hebrew_summary_with_image_and_coords_skips_speculative_english_prefetch(isolated_wiki_caches):
    en_requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "en.wikipedia.org":
            en_requests.append(str(request.url))
        if request.url.host == "he.wikipedia.org" and "/page/summary/" in str(request.url):
            return httpx.Response(200, json={
                "title": "ירושלים",
                "type": "standard",
                "description": "עיר הבירה של ישראל",
                "extract": "ירושלים היא עיר עתיקה בהרי יהודה.",
                "content_urls": {"desktop": {"page": "https://he.wikipedia.org/wiki/%D7%99%D7%A8%D7%95%D7%A9%D7%9C%D7%99%D7%9D"}},
                "thumbnail": {"source": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Jerusalem.jpg/640px-Jerusalem.jpg", "width": 640},
                "coordinates": {"lat": 31.778, "lon": 35.235},
            })
        return httpx.Response(200, json={"query": {"pages": {}}})

    sem = asyncio.Semaphore(5)
    async with _client(handler) as client:
        res = await wiki_enricher.fetch_wikipedia_summary(
            "ירושלים",
            client,
            sem,
            lang="he",
            fallback_lang="en",
            fallback_title="Jerusalem",
        )
    assert res["wikiTitle"] == "ירושלים"
    assert res["imageUrl"]
    assert res["lat"] == 31.778
    assert en_requests == []


@pytest.mark.asyncio
async def test_four_concurrent_timelines_under_429_storm_recover_all_links_and_images(isolated_wiki_caches, monkeypatch):
    """
    End-to-end simulation of 4 browser tabs / users generating timelines concurrently on one server:
    - Shares a single _WikimediaPoliteTransport client across all 4 enrich_events_with_wikipedia calls.
    - Injects both recoverable 429 bursts AND a 5x-429 spike that exhausts pass-1 retries on an event
      so the automatic repair pass must recover its missing wikiUrl and imageUrl.
    - Verifies 100% of events across all 4 timelines receive both wikiUrl and imageUrl.
    """
    monkeypatch.setattr(wiki_enricher, "_retry_after_seconds", lambda _resp: 0.005)
    # Disable external LLM call during unit test
    monkeypatch.setattr(wiki_enricher, "_llm_adjudicate_enrichment", lambda **_kw: asyncio.sleep(0))

    per_slug_failures = {}
    total_429s = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        # Event "tl2_ev1" suffers 5 consecutive 429s on summary (exceeding _WIKIMEDIA_GET_MAX_ATTEMPTS=4 on pass 1),
        # so pass 1 returns empty {} and only the repair pass can rescue its link + image!
        if "Topic_2_Event_1" in url and "/page/summary/" in url:
            cnt = per_slug_failures.get("Topic_2_Event_1", 0)
            if cnt < 5:
                per_slug_failures["Topic_2_Event_1"] = cnt + 1
                total_429s["n"] += 1
                return httpx.Response(429, headers={"Retry-After": "1"})

        # Periodic 429s across all timelines/endpoints (every 5th call initially) to simulate multi-tab burst
        call_idx = per_slug_failures.get("_global", 0) + 1
        per_slug_failures["_global"] = call_idx
        if call_idx <= 45 and call_idx % 5 == 0:
            total_429s["n"] += 1
            return httpx.Response(429, headers={"Retry-After": "1"})

        if "/page/summary/" in url:
            slug = urllib.parse.unquote(url.rsplit("/", 1)[-1])
            clean_title = slug.replace("_", " ")
            return httpx.Response(200, json={
                "title": clean_title,
                "type": "standard",
                "description": f"Historical article for {clean_title}",
                "extract": f"{clean_title} occurred in 1950 and is well documented.",
                "content_urls": {"desktop": {"page": f"https://en.wikipedia.org/wiki/{slug}"}},
                "coordinates": {"lat": 40.0, "lon": -74.0},
            })

        if "prop=pageimages" in url:
            m = [p.split("=", 1)[1] for p in request.url.query.decode("utf-8").split("&") if p.startswith("titles=")]
            slug = urllib.parse.unquote(m[0]) if m else "Article"
            file_slug = slug.replace(" ", "_")
            return httpx.Response(200, json={
                "query": {
                    "pages": {
                        "100": {
                            "title": slug,
                            "pageimage": f"{file_slug}.jpg",
                            "thumbnail": {
                                "source": f"https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/{file_slug}.jpg/800px-{file_slug}.jpg",
                                "width": 800,
                            },
                            "images": [{"ns": 6, "title": f"File:{file_slug}_photo.jpg"}],
                        }
                    }
                }
            })

        if "prop=imageinfo" in url:
            m = [p.split("=", 1)[1] for p in request.url.query.decode("utf-8").split("&") if p.startswith("titles=")]
            raw_file = urllib.parse.unquote(m[0]) if m else "File:Default.jpg"
            fname = raw_file.split(":", 1)[-1].replace(" ", "_")
            return httpx.Response(200, json={
                "query": {
                    "pages": {
                        "200": {
                            "title": raw_file,
                            "imageinfo": [{
                                "url": f"https://upload.wikimedia.org/wikipedia/commons/2/22/{fname}",
                                "thumburl": f"https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/{fname}/800px-{fname}",
                                "width": 1200,
                                "height": 800,
                                "mime": "image/jpeg",
                                "extmetadata": {"ObjectName": {"value": fname.replace("_", " ")}},
                            }],
                        }
                    }
                }
            })

        return httpx.Response(200, json={"query": {"pages": {}}})

    import urllib.parse

    shared_transport = _WikimediaPoliteTransport(
        httpx.MockTransport(handler),
        max_concurrency=8,
        max_rps=200.0,
    )
    shared_client = httpx.AsyncClient(transport=shared_transport)
    monkeypatch.setattr(wiki_enricher, "_get_shared_http_client", lambda: shared_client)

    timelines = [
        [
            {
                "id": f"tl{t}_ev{e}",
                "title": f"Topic {t} Event {e}",
                "wikipedia_title": f"Topic_{t}_Event_{e}",
                "from": {"year": 1950},
            }
            for e in range(4)
        ]
        for t in range(4)
    ]

    try:
        enriched = await asyncio.gather(*(
            wiki_enricher.enrich_events_with_wikipedia(events, lang="en", timeline_topic=f"Topic {idx}")
            for idx, events in enumerate(timelines)
        ))
    finally:
        await shared_client.aclose()

    assert total_429s["n"] >= 10
    for t_idx, events in enumerate(enriched):
        for e_idx, ev in enumerate(events):
            assert ev.get("wikiUrl") == f"https://en.wikipedia.org/wiki/Topic_{t_idx}_Event_{e_idx}", (
                f"Missing wikiUrl on timeline {t_idx} event {e_idx}: {ev}"
            )
            assert ev.get("imageUrl"), f"Missing imageUrl on timeline {t_idx} event {e_idx}: {ev}"


@pytest.mark.asyncio
async def test_wikimedia_access_token_injects_bearer_header_and_falls_back_on_401(monkeypatch):
    # Placeholder from .env.example is safely ignored
    monkeypatch.setenv("WIKIMEDIA_ACCESS_TOKEN", "your_wikimedia_personal_api_token_here")
    assert wiki_enricher._wikimedia_access_token() == ""
    assert wiki_enricher._wikimedia_max_rps() == wiki_enricher._WIKIMEDIA_DEFAULT_MAX_RPS

    # Valid token (with or without leading "Bearer ") normalizes cleanly and raises default limits
    monkeypatch.setenv("WIKIMEDIA_ACCESS_TOKEN", "  Bearer eyJ_test_oauth2_jwt  ")
    assert wiki_enricher._wikimedia_access_token() == "eyJ_test_oauth2_jwt"
    assert wiki_enricher._wikimedia_max_rps() == wiki_enricher._WIKIMEDIA_AUTH_DEFAULT_MAX_RPS
    assert wiki_enricher._wikimedia_max_concurrency() == wiki_enricher._WIKIMEDIA_AUTH_DEFAULT_MAX_CONCURRENCY

    seen_auth_headers = []
    reject_token = {"on": False}

    async def handler(request: httpx.Request) -> httpx.Response:
        auth = request.headers.get("Authorization")
        seen_auth_headers.append(auth)
        if reject_token["on"] and auth:
            return httpx.Response(401, json={"error": "invalid_token"})
        return httpx.Response(200, json={"ok": True, "authenticated": bool(auth)})

    async with _client(handler) as client:
        # 1. Authenticated call carries Bearer token to Wikimedia HTTPS host
        r1 = await client.get("https://en.wikipedia.org/w/api.php?q=auth1")
        assert r1.status_code == 200
        assert r1.json()["authenticated"] is True
        assert seen_auth_headers[-1] == "Bearer eyJ_test_oauth2_jwt"

        # 2. Non-Wikimedia host is still strictly blocked before any token could leave
        with pytest.raises(httpx.UnsupportedProtocol):
            await client.get("https://nominatim.openstreetmap.org/search?q=Rome")

        # 3. Expired/revoked token (HTTP 401) automatically retries anonymously without failing
        reject_token["on"] = True
        r2 = await client.get("https://commons.wikimedia.org/w/api.php?q=auth2")
        assert r2.status_code == 200
        assert r2.json()["authenticated"] is False
        assert seen_auth_headers[-2:] == ["Bearer eyJ_test_oauth2_jwt", None]


@pytest.mark.asyncio
async def test_multi_title_batch_prewarming_collapses_wikipedia_calls(isolated_wiki_caches, monkeypatch):
    """
    Verifies that a 12-event timeline (including redirects and cross-lingual langlinks) resolves
    summaries + article images + file imageinfo in a handful of batched MediaWiki requests rather
    than 36+ individual per-event Wikipedia calls.
    """
    import urllib.parse

    monkeypatch.setattr(wiki_enricher, "_llm_adjudicate_enrichment", lambda **_kw: asyncio.sleep(0))

    stats = {"rest_summary": 0, "batch_extracts": 0, "batch_pageimages": 0, "batch_imageinfo": 0, "commons_gif": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        host = request.url.host
        params = dict(urllib.parse.parse_qsl(request.url.query.decode("utf-8")))

        if host == "commons.wikimedia.org":
            stats["commons_gif"] += 1
            return httpx.Response(200, json={"query": {"pages": {}}})

        if "/api/rest_v1/page/summary/" in url:
            stats["rest_summary"] += 1
            slug = urllib.parse.unquote(url.rsplit("/", 1)[-1])
            return httpx.Response(200, json={"title": slug.replace("_", " "), "extract": "Fallback REST summary."})

        prop = params.get("prop", "")
        raw_titles = [t for t in params.get("titles", "").split("|") if t]

        # 1. Batched summary + redirect + coordinates + langlinks query
        if "extracts" in prop:
            stats["batch_extracts"] += 1
            normalized = []
            redirects = []
            pages = {}
            for idx, rt in enumerate(raw_titles, start=1):
                norm_t = rt.replace("_", " ")
                if norm_t != rt:
                    normalized.append({"from": rt, "to": norm_t})
                landed = f"Canonical {norm_t}" if norm_t.startswith("Alias ") else norm_t
                if landed != norm_t:
                    redirects.append({"from": norm_t, "to": landed})
                slug = landed.replace(" ", "_")
                pages[str(idx)] = {
                    "pageid": idx,
                    "title": landed,
                    "description": f"Encyclopedic article for {landed}",
                    "extract": f"{landed} took place in 1969 as a landmark historical milestone.\nSecond paragraph ignored.",
                    "thumbnail": {
                        "source": f"https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/{slug}.jpg/1280px-{slug}.jpg",
                        "width": 1280,
                    },
                    "coordinates": [{"lat": 30.0 + idx * 0.1, "lon": 35.0 + idx * 0.1, "primary": "", "globe": "earth"}],
                    "fullurl": f"https://{host}/wiki/{slug}",
                    "pageprops": {"wikibase_item": f"Q{1000 + idx}"},
                }
            return httpx.Response(200, json={"batchcomplete": "", "query": {"normalized": normalized, "redirects": redirects, "pages": pages}})

        # 2. Batched pageimages|images|pageprops query
        if "images" in prop and "pageimages" in prop:
            stats["batch_pageimages"] += 1
            pages = {}
            for idx, rt in enumerate(raw_titles, start=100):
                slug = rt.replace(" ", "_")
                pages[str(idx)] = {
                    "pageid": idx,
                    "title": rt,
                    "pageimage": f"{slug}.jpg",
                    "thumbnail": {
                        "source": f"https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/{slug}.jpg/1280px-{slug}.jpg",
                        "width": 1280,
                    },
                    "images": [
                        {"ns": 6, "title": f"File:{slug}_gallery_1.jpg"},
                        {"ns": 6, "title": f"File:{slug}_gallery_2.jpg"},
                    ],
                    "pageprops": {"wikibase_item": f"Q{idx}"},
                }
            return httpx.Response(200, json={"batchcomplete": "", "query": {"pages": pages}})

        # 3. Batched File: imageinfo query
        if prop == "imageinfo":
            stats["batch_imageinfo"] += 1
            pages = {}
            for idx, ft in enumerate(raw_titles, start=500):
                fname = ft.split(":", 1)[-1].replace(" ", "_")
                pages[str(-idx)] = {
                    "title": ft.replace("_", " "),
                    "missing": "",
                    "imagerepository": "shared",
                    "imageinfo": [{
                        "url": f"https://upload.wikimedia.org/wikipedia/commons/3/33/{fname}",
                        "thumburl": f"https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/{fname}/1280px-{fname}",
                        "thumbwidth": 1280,
                        "width": 2000,
                        "height": 1400,
                        "mime": "image/jpeg",
                        "extmetadata": {"ObjectName": {"value": fname.replace("_", " ")}},
                    }],
                }
            return httpx.Response(200, json={"batchcomplete": "", "query": {"pages": pages}})

        return httpx.Response(200, json={"query": {"pages": {}}})

    shared_client = _client(handler, max_concurrency=8, max_rps=0.0)
    monkeypatch.setattr(wiki_enricher, "_get_shared_http_client", lambda: shared_client)

    events = [
        {
            "id": f"ev_{i}",
            "title": f"Milestone Event {i}",
            "wikipedia_title": (f"Alias_Milestone_{i}" if i % 3 == 0 else f"Milestone_{i}"),
            "from": {"year": 1969},
        }
        for i in range(12)
    ]

    try:
        out = await wiki_enricher.enrich_events_with_wikipedia(events, lang="en", timeline_topic="Milestones")
    finally:
        await shared_client.aclose()

    # Zero individual REST summary calls — all 12 events (including redirects) resolved in 1 batch!
    assert stats["rest_summary"] == 0
    assert stats["batch_extracts"] == 1
    assert stats["batch_pageimages"] == 2  # 12 articles in chunks of 10 -> 2 calls instead of 12
    assert stats["batch_imageinfo"] == 1   # 24 File: titles in 1 chunk of <=45 -> 1 call instead of 12

    for i, ev in enumerate(out):
        expected_slug = f"Canonical_Alias_Milestone_{i}" if i % 3 == 0 else f"Milestone_{i}"
        assert ev.get("wikiUrl") == f"https://en.wikipedia.org/wiki/{expected_slug}"
        assert "1969" in (ev.get("extract") or "")
        assert "Second paragraph" not in (ev.get("extract") or "")
        assert ev.get("lat") is not None and ev.get("lng") is not None
        assert ev.get("imageUrl"), f"Missing imageUrl on event {i}"
