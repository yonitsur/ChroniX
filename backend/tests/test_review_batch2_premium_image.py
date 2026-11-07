"""B-05: a charged premium AI image must come from a Gemini image model, never the free generator."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import main
from services import gemini_service, quota_service
from services.auth_service import get_current_user_optional, get_current_user_required
from services.gemini_service import PremiumImageUnavailableError, generate_event_image_with_gemini

USER = {"id": "img-user-1", "email": "img-user@example.com"}
ADMIN = {"id": "img-admin-1", "email": "admin@example.com"}


@pytest.fixture
def image_env(monkeypatch):
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "25")
    monkeypatch.delenv("CREDIT_COST_GEMINI_IMAGE", raising=False)
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY")
    monkeypatch.setenv("ENABLE_FREE_IMAGE_FALLBACK", "true")
    monkeypatch.setattr(quota_service, "_KEY_COOLDOWNS", {})
    main.event_suggest_rate_limiter.records.clear()

    pollinations_calls = []

    async def fake_pollinations(**kwargs):
        pollinations_calls.append(kwargs)
        return {"imageUrl": "data:image/jpeg;base64,FREE", "imageSource": "ai", "model": "pollinations-flux"}

    monkeypatch.setattr(gemini_service, "_generate_event_image_with_pollinations", fake_pollinations)

    current = {"user": USER}
    main.app.dependency_overrides[get_current_user_optional] = lambda: current["user"]
    main.app.dependency_overrides[get_current_user_required] = lambda: current["user"]
    with TestClient(main.app) as client:
        yield {"client": client, "pollinations": pollinations_calls, "as_user": lambda u: current.__setitem__("user", u)}
    main.app.dependency_overrides.clear()


def _fail_all_gemini_image_models(monkeypatch):
    calls = []

    async def failing_generate_images(**kwargs):
        calls.append(kwargs.get("model"))
        raise RuntimeError("503 UNAVAILABLE: model overloaded")

    async def failing_generate_with_retry(client, model, **kwargs):
        calls.append(model)
        raise RuntimeError("503 UNAVAILABLE: model overloaded")

    fake_client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_images=failing_generate_images)))
    monkeypatch.setattr(gemini_service, "get_gemini_client", lambda key=None: fake_client)
    monkeypatch.setattr(gemini_service, "_generate_with_retry", failing_generate_with_retry)
    monkeypatch.setattr(gemini_service, "get_gemini_image_models_to_try", lambda: ["gemini-3.1-flash-image", "imagen-4"])
    return calls


def test_premium_with_paid_key_on_cooldown_is_declined_without_charge_or_free_image(image_env, monkeypatch):
    client = image_env["client"]
    called = []

    async def must_not_run(**kwargs):
        called.append(kwargs)
        return {"imageUrl": "x", "model": "pollinations-flux"}

    monkeypatch.setattr(main, "generate_event_image_with_gemini", must_not_run)
    quota_service.mark_key_exhausted("PAID_KEY", cooldown_seconds=600)
    used_before = quota_service.get_user_daily_usage(USER["id"])

    res = client.post("/api/timeline/generate-event-image", json={"title": "Moon Landing", "engine": "premium"})

    assert res.status_code == 503
    assert "free image generator" in res.json()["detail"]
    assert called == [] and image_env["pollinations"] == []
    assert quota_service.get_user_daily_usage(USER["id"]) == used_before


def test_premium_when_every_gemini_image_model_fails_errors_and_refunds(image_env, monkeypatch):
    client = image_env["client"]
    model_calls = _fail_all_gemini_image_models(monkeypatch)
    quota_service.record_prompt_usage(USER["id"], credits=2)
    used_before = quota_service.get_user_daily_usage(USER["id"])

    res = client.post("/api/timeline/generate-event-image", json={"title": "Moon Landing", "engine": "premium"})

    assert res.status_code == 503
    assert "free image generator" in res.json()["detail"]
    assert model_calls == ["gemini-3.1-flash-image", "imagen-4"]  # only the paid key, once per model
    assert image_env["pollinations"] == []
    assert quota_service.get_user_daily_usage(USER["id"]) == used_before


def test_free_engine_path_unchanged(image_env):
    client = image_env["client"]
    used_before = quota_service.get_user_daily_usage(USER["id"])

    res = client.post("/api/timeline/generate-event-image", json={"title": "Moon Landing", "engine": "free"})

    assert res.status_code == 200
    assert res.json()["model"] == "pollinations-flux"
    assert len(image_env["pollinations"]) == 1
    assert quota_service.get_user_daily_usage(USER["id"]) == used_before


def test_admin_premium_keeps_free_fallback(image_env, monkeypatch):
    """Admins are never charged, so their existing fallback behaviour is kept."""
    image_env["as_user"](ADMIN)
    _fail_all_gemini_image_models(monkeypatch)

    res = image_env["client"].post("/api/timeline/generate-event-image", json={"title": "Moon Landing", "engine": "premium"})

    assert res.status_code == 200
    assert res.json()["model"] == "pollinations-flux"


@pytest.mark.asyncio
async def test_generate_event_image_without_free_fallback_rejects_free_key_and_total_failure(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY")
    monkeypatch.setenv("ENABLE_FREE_IMAGE_FALLBACK", "true")
    pollinations = []

    async def fake_pollinations(**kwargs):
        pollinations.append(kwargs)
        return {"imageUrl": "data:image/jpeg;base64,FREE", "model": "pollinations-flux"}

    monkeypatch.setattr(gemini_service, "_generate_event_image_with_pollinations", fake_pollinations)
    _fail_all_gemini_image_models(monkeypatch)

    with pytest.raises(PremiumImageUnavailableError):
        await generate_event_image_with_gemini(title="X", api_key="FREE_KEY", allow_free_fallback=False)
    with pytest.raises(PremiumImageUnavailableError):
        await generate_event_image_with_gemini(title="X", api_key="PAID_KEY", allow_free_fallback=False)
    assert pollinations == []

    # Default (uncharged callers) still falls back to the free generator.
    result = await generate_event_image_with_gemini(title="X", api_key="PAID_KEY")
    assert result["model"] == "pollinations-flux" and len(pollinations) == 1


def test_charge_premium_credits_require_paid_key(monkeypatch):
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "25")
    monkeypatch.setenv("ADMIN_EMAILS", "admin@example.com")
    monkeypatch.setenv("GEMINI_API_KEY", "PAID_KEY")
    monkeypatch.setenv("GEMINI_API_KEY_FREE", "FREE_KEY")
    monkeypatch.setattr(quota_service, "_KEY_COOLDOWNS", {})

    ok, key, tier, inc, pool = quota_service.charge_premium_credits(USER, credits=6, require_paid_key=True)
    assert (ok, key, tier) == (True, "PAID_KEY", "paid") and inc
    quota_service.refund_user_quota(USER, refund_pool=pool, credits=6)

    quota_service.mark_key_exhausted("PAID_KEY", cooldown_seconds=600)
    used_before = quota_service.get_user_daily_usage(USER["id"])
    declined = quota_service.charge_premium_credits(USER, credits=6, require_paid_key=True)
    assert declined == (False, None, quota_service.PREMIUM_KEY_UNAVAILABLE_TIER, False, False)
    assert quota_service.get_user_daily_usage(USER["id"]) == used_before

    # BYOK and admin behaviour unchanged.
    assert quota_service.charge_premium_credits(USER, "AIzaSyPersonal", credits=6, require_paid_key=True)[:3] == (
        True, "AIzaSyPersonal", "custom",
    )
    admin_ok, admin_key, admin_tier, _, _ = quota_service.charge_premium_credits(ADMIN, credits=6, require_paid_key=True)
    assert admin_ok and admin_tier == "admin_paid" and admin_key == "FREE_KEY"
