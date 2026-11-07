"""B-29: unsupported Ko-fi currencies are kept (not dropped), and a store outage during the dedupe
claim answers 503 so Ko-fi retries instead of the claim landing in an ephemeral local counter."""
import json
import logging

import pytest
from fastapi.testclient import TestClient

import main
from services import quota_service as qs

TOKEN = "kofi-secret-token-4b"


def _payload(tx, amount="12.00", currency="USD"):
    return {"data": json.dumps({
        "verification_token": TOKEN, "kofi_transaction_id": tx, "amount": amount, "currency": currency, "type": "Donation",
    })}


@pytest.fixture
def kofi(monkeypatch, tmp_path):
    monkeypatch.setattr(qs, "USAGE_FILE", tmp_path / "usage.json")
    monkeypatch.setattr(qs, "usage_store_is_durable", lambda: False)
    monkeypatch.setattr(qs, "_supabase_config", lambda: ("", ""))
    monkeypatch.setenv("KOFI_VERIFICATION_TOKEN", TOKEN)
    return TestClient(main.app)


def test_unknown_currency_is_kept_as_unconverted_and_logged(kofi, caplog):
    with caplog.at_level(logging.ERROR):
        res = kofi.post("/api/webhooks/kofi", data=_payload("tx-brl-1", "50.00", "BRL"))
    assert res.status_code == 200
    body = res.json()
    assert body["recorded"] is False and body["unconverted"] is True and body["pending_currency"] == "BRL"
    usage = qs.get_usage_for_identifiers(
        ["kofi_unconverted:BRL:minor", "kofi_unconverted:BRL:count"], date_str=qs.COMMUNITY_LEDGER_DATE
    )
    assert usage == {"kofi_unconverted:BRL:minor": 5000, "kofi_unconverted:BRL:count": 1}
    assert any("unsupported currency BRL" in r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR)
    # The USD ledger is untouched, and a retried delivery is not counted twice.
    assert qs.get_community_ledger()["donated_usd"] == 0.0
    again = kofi.post("/api/webhooks/kofi", data=_payload("tx-brl-1", "50.00", "BRL")).json()
    assert again["duplicate"] is True
    assert qs.get_usage_for_identifiers(["kofi_unconverted:BRL:minor"], date_str=qs.COMMUNITY_LEDGER_DATE)[
        "kofi_unconverted:BRL:minor"
    ] == 5000


def test_remote_store_failure_during_the_claim_returns_503(kofi, monkeypatch):
    # Supabase configured, local fallback allowed (dev): the claim must still not use the local file.
    monkeypatch.setattr(qs, "usage_store_is_durable", lambda: True)
    monkeypatch.setattr(qs, "_usage_remote_available", lambda: True)
    monkeypatch.setattr(qs, "_remote_change_usage", lambda *a, **k: None)
    local_writes = []
    monkeypatch.setattr(qs, "_local_change_usage", lambda *a, **k: local_writes.append(a) or 1)
    res = kofi.post("/api/webhooks/kofi", data=_payload("tx-usd-503"))
    assert res.status_code == 503
    assert local_writes == []


def test_failed_amount_write_releases_the_claim_so_the_retry_counts(kofi, monkeypatch):
    calls = []
    real = qs._change_ledger_counter_strict

    def flaky(identifier, delta):
        calls.append((identifier, delta))
        if identifier == qs.COMMUNITY_DONATED_CENTS_ID and len([c for c in calls if c[0] == identifier]) == 1:
            raise qs.UsageStoreUnavailable("blip")
        return real(identifier, delta)

    monkeypatch.setattr(qs, "_change_ledger_counter_strict", flaky)
    assert kofi.post("/api/webhooks/kofi", data=_payload("tx-usd-retry")).status_code == 503
    retry = kofi.post("/api/webhooks/kofi", data=_payload("tx-usd-retry"))
    assert retry.status_code == 200 and retry.json()["recorded"] is True
    assert qs.get_community_ledger()["donated_usd"] == 12.0
