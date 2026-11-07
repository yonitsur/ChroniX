"""SC-14 / P-15 / P-12: per-(key, model) Gemini pacing, client cache sizing and close-on-evict,
hedged free image generation and the heuristic English prompt."""
import asyncio
from types import SimpleNamespace

import pytest

from services import gemini_service as gs
from services.ai_errors import AiErrorKind, LocalRateLimitError, classify_ai_error, key_cooldown_seconds


@pytest.fixture(autouse=True)
def fresh_buckets():
    gs._GEMINI_RPM_BUCKETS.clear()
    yield
    gs._GEMINI_RPM_BUCKETS.clear()


# --- token bucket (SC-14) ---------------------------------------------------------------------

def test_rpm_bucket_off_by_default_and_paces_when_configured(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "paid-key")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "free-key")
    for name in ("GEMINI_RPM_PER_KEY_MODEL", "GEMINI_PAID_RPM_PER_KEY_MODEL", "GEMINI_FREE_RPM_PER_KEY_MODEL", "GEMINI_BYOK_RPM_PER_KEY_MODEL"):
        monkeypatch.delenv(name, raising=False)
    assert all(gs._reserve_gemini_rpm_slot("free-key", "m", now=100.0) == 0.0 for _ in range(50))

    monkeypatch.setenv("GEMINI_FREE_RPM_PER_KEY_MODEL", "6")  # burst 1, then one per 10 s
    monkeypatch.setenv("GEMINI_RATE_LIMIT_MAX_WAIT_SEC", "12")
    gs._GEMINI_RPM_BUCKETS.clear()
    assert gs._reserve_gemini_rpm_slot("free-key", "m", now=0.0) == 0.0
    assert gs._reserve_gemini_rpm_slot("free-key", "m", now=0.0) == pytest.approx(10.0)  # short wait
    with pytest.raises(LocalRateLimitError) as err:
        gs._reserve_gemini_rpm_slot("free-key", "m", now=0.0)  # would wait 20 s > 12 s: rotate instead
    assert err.value.retry_after == pytest.approx(20.0)
    # Other models and the paid key have their own (here: unlimited) budgets.
    assert gs._reserve_gemini_rpm_slot("free-key", "other-model", now=0.0) == 0.0
    assert gs._reserve_gemini_rpm_slot("paid-key", "m", now=0.0) == 0.0
    # BYOK keys are never paced unless explicitly configured.
    assert gs._reserve_gemini_rpm_slot("user-own-key", "m", now=0.0) == 0.0
    # Refill.
    assert gs._reserve_gemini_rpm_slot("free-key", "m", now=40.0) == 0.0


def test_local_rate_limit_rotates_with_short_cooldown():
    exc = RuntimeError("Gemini is busy")
    exc.__cause__ = LocalRateLimitError(retry_after=4.0)
    assert classify_ai_error(exc) == AiErrorKind.RATE_LIMIT
    cooldown = key_cooldown_seconds(AiErrorKind.RATE_LIMIT, exc, is_paid_key=False)
    assert 4.0 <= cooldown <= 7.0


@pytest.mark.asyncio
async def test_generate_with_retry_applies_pacing(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "free-key")
    monkeypatch.setenv("GEMINI_FREE_RPM_PER_KEY_MODEL", "60")
    monkeypatch.setenv("GEMINI_RATE_LIMIT_MAX_WAIT_SEC", "0")
    calls = []

    class Models:
        async def generate_content(self, **kwargs):
            calls.append(kwargs["model"])
            return SimpleNamespace(text="ok")

    client = SimpleNamespace(_api_client=SimpleNamespace(api_key="free-key"), aio=SimpleNamespace(models=Models()))
    for _ in range(10):  # burst of 10 at 60 RPM
        await gs._generate_with_retry(client, model="m", contents="x")
    with pytest.raises(LocalRateLimitError):
        await gs._generate_with_retry(client, model="m", contents="x")
    assert len(calls) == 10  # the 11th never reached Google


# --- client cache (P-15) ----------------------------------------------------------------------

class _FakeAio:
    def __init__(self):
        self.closed = False

    async def aclose(self):
        self.closed = True


class _FakeClient:
    created = []

    def __init__(self, api_key, http_options=None):
        self.api_key = api_key
        self.closed = False
        self.aio = _FakeAio()
        _FakeClient.created.append(self)

    def close(self):
        self.closed = True


@pytest.fixture
def fake_clients(monkeypatch):
    _FakeClient.created = []
    monkeypatch.setattr(gs.genai, "Client", _FakeClient)
    monkeypatch.setattr(gs, "_ORIG_GENAI_CLIENT", _FakeClient)
    monkeypatch.setattr(gs, "_GEMINI_CLIENT_CACHE", gs.OrderedDict())
    monkeypatch.setattr(gs, "_GEMINI_SERVER_CLIENT_CACHE", {})
    monkeypatch.setattr(gs, "_GEMINI_CLIENT_INFLIGHT", {})
    monkeypatch.setattr(gs, "_RETIRED_CLIENT_IDLE_GRACE_SEC", 0.01)
    return _FakeClient


@pytest.mark.asyncio
async def test_server_keys_never_evicted_by_byok_churn(monkeypatch, fake_clients):
    monkeypatch.setenv("GEMINI_API_KEY", "paid")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "f1,f2,f3,f4,f5,f6,f7")
    monkeypatch.setattr(gs, "_MAX_CACHED_GEMINI_CLIENTS", 2)
    server = {k: await gs.aget_gemini_client(k) for k in ["paid", "f1", "f2", "f3", "f4", "f5", "f6", "f7"]}
    for i in range(10):
        await gs.aget_gemini_client(f"byok-{i}")
    for key, client in server.items():
        assert await gs.aget_gemini_client(key) is client  # 8 server keys > old cap of 6: all kept
        assert not client.closed
    assert len(gs._GEMINI_CLIENT_CACHE) == 2
    assert len(fake_clients.created) == 8 + 10


@pytest.mark.asyncio
async def test_evicted_byok_client_closed_only_when_idle(monkeypatch, fake_clients):
    monkeypatch.setenv("GEMINI_API_KEY", "paid")
    monkeypatch.delenv("GEMINI_API_KEY_FREE", raising=False)
    monkeypatch.setattr(gs, "_MAX_CACHED_GEMINI_CLIENTS", 1)
    first = await gs.aget_gemini_client("byok-a")
    gs._GEMINI_CLIENT_INFLIGHT[id(first)] = 1  # a request is still running on it
    await gs.aget_gemini_client("byok-b")  # evicts byok-a
    assert first.closed is True  # sync transport closed immediately, as before
    await asyncio.sleep(0.05)
    assert first.aio.closed is False  # async transport kept while the request runs
    gs._GEMINI_CLIENT_INFLIGHT.pop(id(first))
    await asyncio.sleep(1.2)
    assert first.aio.closed is True


@pytest.mark.asyncio
async def test_new_clients_are_built_off_the_event_loop(monkeypatch, fake_clients):
    import threading

    loop_thread = threading.get_ident()
    built_on = []
    real_build = gs._build_gemini_client

    def tracking_build(key):
        built_on.append(threading.get_ident())
        return real_build(key)

    monkeypatch.setattr(gs, "_build_gemini_client", tracking_build)
    c1 = await gs.aget_gemini_client("byok-x")
    c2 = await gs.aget_gemini_client("byok-x")
    assert c1 is c2 and len(built_on) == 1
    assert built_on[0] != loop_thread


@pytest.mark.asyncio
async def test_inflight_counter_tracks_running_requests(fake_clients):
    seen = []

    class Models:
        async def generate_content(self, **kwargs):
            seen.append(gs._GEMINI_CLIENT_INFLIGHT.get(id(client)))
            return SimpleNamespace(text="ok")

    client = SimpleNamespace(aio=SimpleNamespace(models=Models()))
    await gs._generate_with_retry(client, model="m", contents="x")
    assert seen == [1] and id(client) not in gs._GEMINI_CLIENT_INFLIGHT


# --- hedged free image (P-12) -----------------------------------------------------------------

@pytest.mark.asyncio
async def test_slow_hugging_face_is_hedged_with_pollinations(monkeypatch):
    monkeypatch.setenv("FREE_IMAGE_HEDGE_AFTER_SEC", "0.1")
    hf_cancelled = asyncio.Event()

    async def slow_hf(**kwargs):
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            hf_cancelled.set()
            raise

    async def fast_poll(flux_prompt, seed, title, t_start):
        return {"imageUrl": "data:image/jpeg;base64,AAA", "model": "pollinations-flux"}

    monkeypatch.setattr(gs, "_generate_with_hf_flux_space", slow_hf)
    monkeypatch.setattr(gs, "_generate_with_pollinations_service", fast_poll)
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    res = await gs._hedged_free_image("prompt", 1, "Title", 0.0)
    assert res["model"] == "pollinations-flux"
    assert loop.time() - t0 < 2
    await asyncio.wait_for(hf_cancelled.wait(), 1)  # the loser is cancelled


@pytest.mark.asyncio
async def test_fast_hugging_face_wins_without_pollinations(monkeypatch):
    monkeypatch.setenv("FREE_IMAGE_HEDGE_AFTER_SEC", "5")
    poll_calls = []

    async def fast_hf(**kwargs):
        return {"imageUrl": "data:image/jpeg;base64,HF", "model": "flux.1-schnell-hf"}

    async def poll(*a):
        poll_calls.append(a)
        return {"model": "pollinations-flux"}

    monkeypatch.setattr(gs, "_generate_with_hf_flux_space", fast_hf)
    monkeypatch.setattr(gs, "_generate_with_pollinations_service", poll)
    res = await gs._hedged_free_image("prompt", 1, "Title", 0.0)
    assert res["model"] == "flux.1-schnell-hf" and poll_calls == []


@pytest.mark.asyncio
async def test_hedge_keeps_waiting_for_hf_when_pollinations_fails(monkeypatch):
    monkeypatch.setenv("FREE_IMAGE_HEDGE_AFTER_SEC", "0.05")

    async def hf(**kwargs):
        await asyncio.sleep(0.3)
        return {"model": "flux.1-schnell-hf"}

    async def failing_poll(*a):
        raise RuntimeError("Free image generator is cooling down (30s remaining between free images).")

    monkeypatch.setattr(gs, "_generate_with_hf_flux_space", hf)
    monkeypatch.setattr(gs, "_generate_with_pollinations_service", failing_poll)
    assert (await gs._hedged_free_image("p", 1, "T", 0.0))["model"] == "flux.1-schnell-hf"

    async def failing_hf(**kwargs):
        raise RuntimeError("HF down")

    monkeypatch.setattr(gs, "_generate_with_hf_flux_space", failing_hf)
    with pytest.raises(RuntimeError, match="cooling down"):
        await gs._hedged_free_image("p", 1, "T", 0.0)  # Pollinations' message is the one shown


@pytest.mark.asyncio
async def test_english_title_prompt_skips_llm_rewrite(monkeypatch):
    calls = []

    async def fake_generate(_client, **kwargs):
        calls.append(kwargs.get("model"))
        return SimpleNamespace(candidates=[], text="A vivid scene of a historic moment in detail")

    monkeypatch.setattr(gs, "_generate_with_retry", fake_generate)
    long_subtitle = "The first crewed landing on the Moon, watched live by hundreds of millions of people " * 3
    prompt = await gs._build_concise_english_flux_prompt(
        client=SimpleNamespace(), title="Apollo 11 Moon landing", subtitle=long_subtitle, year=1969,
    )
    assert calls == []
    assert "Apollo 11 Moon landing" in prompt and "no text or watermarks" in prompt
