"""Batch 2B: the frontend reads Retry-After on job-start 503/429, so CORS must expose it cross-origin."""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

import main


def test_retry_after_is_exposed_to_cross_origin_frontends(monkeypatch):
    for name in ("CORS_ORIGINS", "CORS_ORIGIN_REGEX", "ALLOW_ANY_CORS_ORIGIN", "APP_ENV", "RENDER"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CORS_ORIGINS", "https://chronix.example")
    app = FastAPI()
    app.add_middleware(CORSMiddleware, **main._cors_middleware_kwargs())

    @app.post("/start")
    def start():
        raise HTTPException(status_code=503, detail="The server is restarting.", headers={"Retry-After": "15"})

    res = TestClient(app).post("/start", headers={"Origin": "https://chronix.example"})
    assert res.status_code == 503
    assert res.headers.get("retry-after") == "15"
    exposed = {h.strip().lower() for h in res.headers.get("access-control-expose-headers", "").split(",")}
    assert "retry-after" in exposed
    assert main.AI_TIER_HEADER.lower() in exposed
