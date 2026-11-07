"""In-memory fake of the Supabase PostgREST endpoints the quota store uses (Batch 3B tests)."""
import json as _json
from contextlib import contextmanager

import httpx


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = _json.dumps(payload)

    def json(self):
        return self._payload


class FakeUsageDB:
    """
    Routes GET /rest/v1/ai_usage, POST /rpc/increment_ai_usage and (optionally) POST
    /rpc/reserve_ai_credits. `reserve_ai_credits` mirrors backend/migrations/002_reserve_ai_credits.sql.
    `mode`: "ok", "error" (HTTP 500) or "timeout" (raises httpx.ReadTimeout).
    """

    def __init__(self, with_reserve_rpc=False):
        self.rows = {}
        self.requests = []
        self.mode = "ok"
        self.with_reserve_rpc = with_reserve_rpc

    # httpx.Client stand-in -------------------------------------------------------------
    def __call__(self, *args, **kwargs):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def _fail(self):
        if self.mode == "timeout":
            raise httpx.ReadTimeout("timed out")
        return FakeResponse(500, {"message": "upstream error"})

    def get(self, url, headers=None, params=None):
        self.requests.append(("get", url, params))
        if self.mode != "ok":
            return self._fail()
        date_key = params["usage_date"].removeprefix("eq.")
        raw_ids = params["identifier"].removeprefix("in.(").removesuffix(")")
        wanted = [part.strip('"') for part in raw_ids.split(",")]
        rows = [
            {"identifier": ident, "count": self.rows[(date_key, ident)]}
            for ident in wanted
            if (date_key, ident) in self.rows
        ]
        return FakeResponse(200, rows)

    def post(self, url, headers=None, json=None):
        self.requests.append(("post", url, json))
        if self.mode != "ok":
            return self._fail()
        if url.endswith("/rpc/increment_ai_usage"):
            key = (json["p_date"], json["p_identifier"])
            self.rows[key] = max(0, self.rows.get(key, 0) + json["p_delta"])
            return FakeResponse(200, self.rows[key])
        if url.endswith("/rpc/reserve_ai_credits") and self.with_reserve_rpc:
            return FakeResponse(200, self._reserve(json))
        return FakeResponse(404, {"code": "PGRST202", "message": "Could not find the function"})

    def _reserve(self, p):
        day, delta = p["p_date"], p["p_delta"]
        before = dict(self.rows)
        counts, any_over, any_straddled = {}, False, False
        order = sorted(range(len(p["p_identifiers"])), key=lambda i: (p["p_identifiers"][i], i))
        for i in order:
            ident, cap = p["p_identifiers"][i], p["p_caps"][i]
            new = max(0, self.rows.get((day, ident), 0) + delta)
            self.rows[(day, ident)] = new
            counts[ident] = new
            if new > cap:
                any_over = True
                if new - delta < cap:
                    any_straddled = True
        within = not any_over
        kept = within or (p["p_keep_overlimit"] and not any_straddled)
        if not kept:
            self.rows = before
        reads = {
            ident: self.rows[(day, ident)]
            for ident in (p.get("p_read_identifiers") or [])
            if (day, ident) in self.rows
        }
        return {"within_limit": within, "kept": kept, "counts": counts, "reads": reads}

    # helpers ------------------------------------------------------------------------------
    def count(self, kind, suffix=""):
        return len([r for r in self.requests if r[0] == kind and r[1].endswith(suffix)])


def install_fake_store(monkeypatch, qs, db):
    """Points quota_service's store at `db` without touching the global httpx.Client (so a
    FastAPI TestClient keeps working in the same test)."""

    @contextmanager
    def _client():
        yield db

    monkeypatch.setattr(qs, "usage_store_is_durable", lambda: True)
    monkeypatch.setattr(qs, "_supabase_config", lambda: ("https://fake.supabase.co", "svc-key"))
    monkeypatch.setattr(qs, "_remote_http_client", _client)
    monkeypatch.setattr(qs, "prune_expired_remote_usage", lambda force=False: False)
    qs.reset_usage_store_breaker()
    qs.invalidate_community_status_cache()
    return db
