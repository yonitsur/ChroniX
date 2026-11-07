"""S-05 (CORS fails closed in production), SC-16 (real health check, 413 carries CORS headers)."""
import asyncio
import logging

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

import main

_CORS_ENV = ("CORS_ORIGINS", "CORS_ORIGIN_REGEX", "ALLOW_ANY_CORS_ORIGIN", "APP_ENV", "RENDER")


def _cors_client(monkeypatch, **env):
    for name in _CORS_ENV:
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    app = FastAPI()
    app.add_middleware(CORSMiddleware, **main._cors_middleware_kwargs())

    @app.get("/ping")
    def ping():
        return {"ok": True}

    return TestClient(app)


def _acao(client, origin):
    return client.get("/ping", headers={"Origin": origin}).headers.get("access-control-allow-origin")


def test_production_without_cors_origins_fails_closed(monkeypatch, caplog):
    with caplog.at_level(logging.CRITICAL, logger="ChroniXAPI"):
        client = _cors_client(monkeypatch, RENDER="true")
    assert _acao(client, "https://evil.example") is None
    preflight = client.options(
        "/ping", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"}
    )
    assert preflight.headers.get("access-control-allow-origin") is None
    assert any("CORS_ORIGINS is not set in production" in r.message for r in caplog.records)


def test_app_env_production_also_fails_closed(monkeypatch):
    client = _cors_client(monkeypatch, APP_ENV="production")
    assert _acao(client, "https://evil.example") is None


def test_explicit_escape_hatch_allows_any_origin_in_production(monkeypatch):
    client = _cors_client(monkeypatch, RENDER="true", ALLOW_ANY_CORS_ORIGIN="true")
    assert _acao(client, "https://anything.example") == "*"


def test_allowed_origin_works_with_credentials(monkeypatch):
    client = _cors_client(monkeypatch, RENDER="true", CORS_ORIGINS="https://chronix.example, https://www.chronix.example/")
    res = client.get("/ping", headers={"Origin": "https://www.chronix.example"})
    assert res.headers.get("access-control-allow-origin") == "https://www.chronix.example"
    assert res.headers.get("access-control-allow-credentials") == "true"
    assert _acao(client, "https://evil.example") is None


def test_origin_regex_allows_preview_deployments(monkeypatch):
    client = _cors_client(
        monkeypatch,
        RENDER="true",
        CORS_ORIGINS="https://chronix.example",
        CORS_ORIGIN_REGEX=r"https://.*-myteam\.vercel\.app",
    )
    assert _acao(client, "https://chronix-git-pr-12-myteam.vercel.app") == "https://chronix-git-pr-12-myteam.vercel.app"
    assert _acao(client, "https://chronix.example") == "https://chronix.example"
    assert _acao(client, "https://myteam.vercel.app.evil.example") is None


def test_regex_only_in_production_is_enough(monkeypatch):
    client = _cors_client(monkeypatch, RENDER="true", CORS_ORIGIN_REGEX=r"https://.*-myteam\.vercel\.app")
    assert _acao(client, "https://a-myteam.vercel.app") == "https://a-myteam.vercel.app"
    assert _acao(client, "https://evil.example") is None


def test_dev_default_stays_permissive(monkeypatch):
    client = _cors_client(monkeypatch)
    assert _acao(client, "http://localhost:5173") == "*"
    # APP_ENV wins over RENDER, e.g. for a staging service that should stay open.
    client = _cors_client(monkeypatch, RENDER="true", APP_ENV="development")
    assert _acao(client, "http://192.168.1.20:5173") == "*"


def test_cors_is_the_outermost_middleware():
    assert main.app.user_middleware[0].cls is CORSMiddleware


def test_413_response_carries_cors_headers(monkeypatch):
    monkeypatch.setattr(main, "MAX_JSON_BODY_BYTES", 1024)
    cors_kwargs = main.app.user_middleware[0].kwargs
    allowed = cors_kwargs.get("allow_origins") or []
    origin = "https://frontend.example" if allowed in ([], ["*"]) else allowed[0]
    if not allowed and not cors_kwargs.get("allow_origin_regex"):
        pytest.skip("CORS closed in this environment")
    client = TestClient(main.app)
    res = client.post(
        "/api/timeline/job/cancel/nonexistent",
        content=b"x" * 2048,
        headers={"Content-Type": "application/json", "Origin": origin},
    )
    assert res.status_code == 413
    assert res.headers.get("access-control-allow-origin") in ("*", origin)


# --- /api/health ---------------------------------------------------------------------------

def test_health_payload_has_legacy_and_new_fields():
    res = TestClient(main.app).get("/api/health")
    assert res.status_code == 200
    body = res.json()
    for key in ("status", "has_server_gemini_key", "message"):
        assert key in body
    assert body["status"] == "ok"
    assert body["draining"] is False
    assert isinstance(body["pending_jobs"], int)
    assert "event_loop_lag_ms" in body and "rss_mb" in body


def test_health_returns_503_while_draining(monkeypatch):
    monkeypatch.setattr(main, "_SERVER_DRAINING", True)
    res = TestClient(main.app).get("/api/health")
    assert res.status_code == 503
    assert res.json()["status"] == "draining"
    assert res.json()["draining"] is True


def test_health_returns_503_when_event_loop_lags(monkeypatch):
    monkeypatch.setattr(main, "_current_event_loop_lag", lambda: 9.0)
    res = TestClient(main.app).get("/api/health")
    assert res.status_code == 503
    assert res.json()["status"] == "degraded"
    assert res.json()["event_loop_lag_ms"] == 9000

    monkeypatch.setenv("HEALTH_MAX_LOOP_LAG_SECONDS", "0")  # 0 disables the lag check
    assert TestClient(main.app).get("/api/health").status_code == 200


def test_lag_sampler_records_lag_and_runs_throttled_cleanup(monkeypatch):
    monkeypatch.setattr(main, "_LOOP_LAG_SAMPLE_SECONDS", 0.01)
    monkeypatch.setitem(main._LOOP_HEALTH, "lag_seconds", None)
    monkeypatch.setitem(main._LOOP_HEALTH, "last_tick", None)
    cleanups = []
    monkeypatch.setattr(main, "_maybe_cleanup_ai_jobs", lambda: cleanups.append(1))

    async def scenario():
        task = asyncio.create_task(main._event_loop_lag_sampler())
        await asyncio.sleep(0.1)
        lag = main._current_event_loop_lag()
        task.cancel()
        return lag

    lag = asyncio.run(scenario())
    assert lag is not None and lag >= 0
    assert main._LOOP_HEALTH["lag_seconds"] is not None
    assert cleanups
