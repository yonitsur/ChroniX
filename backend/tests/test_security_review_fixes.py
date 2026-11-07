import concurrent.futures
import time
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

import main as backend_main
from models import TimelineArticle, TimelineDate
from services import auth_service, gemini_service, quota_service, storage, wiki_enricher


# --- C1: Privilege escalation via user_metadata.email ---

def test_c1_admin_ignores_user_metadata_email_spoofing(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "realadmin@chronix.example")
    # Spoofed user_metadata.email on regular or anonymous user MUST NOT grant admin
    assert auth_service.is_admin_user({
        "id": "u-attacker",
        "email": "attacker@evil.test",
        "email_confirmed_at": "2026-01-01T00:00:00Z",
        "is_anonymous": False,
        "user_metadata": {"email": "realadmin@chronix.example"},
    }) is False

    # Anonymous user with matching top-level email or unconfirmed email MUST NOT grant admin
    assert auth_service.is_admin_user({
        "id": "u-anon",
        "email": "realadmin@chronix.example",
        "email_confirmed_at": "2026-01-01T00:00:00Z",
        "is_anonymous": True,
    }) is False
    assert auth_service.is_admin_user({
        "id": "u-unconfirmed",
        "email": "realadmin@chronix.example",
        "email_confirmed_at": None,
        "is_anonymous": False,
    }) is False

    # Confirmed non-anonymous top-level email OR server-only app_metadata.role == 'admin' succeeds
    assert auth_service.is_admin_user({
        "id": "u-admin",
        "email": "realadmin@chronix.example",
        "email_confirmed_at": "2026-01-01T00:00:00Z",
        "is_anonymous": False,
    }) is True
    assert auth_service.is_admin_user({
        "id": "u-role-admin",
        "email": "staff@other.example",
        "is_anonymous": False,
        "app_metadata": {"role": "admin"},
    }) is True


# --- C3 + Public Library: IDOR overwrite & non-admin edit unpublishes curated library timeline ---

@pytest.mark.anyio
async def test_c3_verify_timeline_mutation_target_blocks_non_owner(monkeypatch):
    monkeypatch.setattr(
        backend_main,
        "_get_timeline_access_meta_sync",
        lambda tl_id: {"owner_id": "owner-victim", "is_shared": True, "is_library": True},
    )
    attacker = {"id": "attacker-123", "email": "a@b.c", "is_anonymous": False}
    with pytest.raises(HTTPException) as exc:
        await backend_main._verify_timeline_mutation_target("tl-victim", attacker)
    assert exc.value.status_code == 403


@pytest.mark.anyio
async def test_public_library_non_admin_owner_edit_unpublishes_curated_timeline(monkeypatch):
    captured = {}

    def fake_save(tl_dict, user_id=None, existing_meta=None):
        captured["tl"] = dict(tl_dict)
        captured["user_id"] = user_id
        return dict(tl_dict)

    monkeypatch.setattr(backend_main, "save_timeline_data", fake_save)
    owner = {"id": "owner-1", "email": "owner@example.com", "is_anonymous": False}
    existing_meta = {"owner_id": "owner-1", "is_shared": True, "is_library": True, "is_featured": True}

    await backend_main._persist_timeline_dict(
        {
            "id": "tl-curated",
            "title": "Edited by owner",
            "isLibrary": True,
            "isFeatured": True,
            "isShared": True,
            "articles": [],
        },
        user=owner,
        target_owner="owner-1",
        existing_meta=existing_meta,
    )
    assert captured["user_id"] == "owner-1"
    assert captured["tl"].get("isLibrary") is False
    assert captured["tl"].get("isFeatured") is False
    assert "isShared" not in captured["tl"]


# --- H1: Wikipedia lang SSRF & outbound transport host/scheme lock ---

def test_h1_normalize_wiki_lang_blocks_ssrf_and_path_traversal():
    assert wiki_enricher.normalize_wiki_lang("en") == "en"
    assert wiki_enricher.normalize_wiki_lang("zh-min-nan") == "zh-min-nan"
    assert wiki_enricher.normalize_wiki_lang("simple") == "simple"

    for payload in [
        "attacker.com#",
        "attacker.com/api?",
        "en.wikipedia.org@evil.com",
        "../../etc/passwd",
        "127.0.0.1",
    ]:
        assert wiki_enricher.normalize_wiki_lang(payload) == "en"
        with pytest.raises(ValueError):
            wiki_enricher.normalize_wiki_lang(payload, strict=True)


# --- H2 & H9: SafeIdStr XSS/attribute injection defense & request body size limit ---

def test_h2_safe_id_str_rejects_xss_chars_and_overlong_ids():
    with pytest.raises(ValidationError):
        TimelineArticle(
            id='x" onclick="alert(1)',
            title="Bad",
            **{"from": TimelineDate(year=2000)},
        )
    with pytest.raises(ValidationError):
        TimelineArticle(
            id="<img src=x>",
            title="Bad",
            **{"from": TimelineDate(year=2000)},
        )
    with pytest.raises(ValidationError):
        TimelineArticle(
            id="a" * 129,
            title="Too Long",
            **{"from": TimelineDate(year=2000)},
        )


def test_h9_request_size_limit_middleware_rejects_oversized_payload(monkeypatch):
    monkeypatch.setattr(backend_main, "MAX_JSON_BODY_BYTES", 1024)
    client = TestClient(backend_main.app)
    resp = client.post(
        "/api/timeline/job/cancel/nonexistent",
        content=b"x" * 2048,
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 413


# --- H3: Cancel-and-refund loop caps ---

def test_h3_cancel_refund_cap_and_non_refundable_lock():
    backend_main._CANCEL_REFUND_HISTORY.clear()
    caller = {"id": "u-loop", "email": "loop@test.dev", "is_anonymous": False}

    assert backend_main._allow_cancel_refund_for_caller(caller, "203.0.113.5") is True
    assert backend_main._allow_cancel_refund_for_caller(caller, "203.0.113.5") is True
    # 3rd cancel within window is denied refund
    assert backend_main._allow_cancel_refund_for_caller(caller, "203.0.113.5") is False

    job_id = backend_main._create_ai_job(caller, client_ip="203.0.113.5", incremented_quota=True)
    try:
        assert backend_main._AI_JOBS[job_id]["can_refund_on_cancel"] is True
        backend_main._mark_job_non_refundable_on_cancel(job_id)
        assert backend_main._AI_JOBS[job_id]["can_refund_on_cancel"] is False
    finally:
        backend_main._AI_JOBS.pop(job_id, None)


# --- H4: Spoofable X-Forwarded-For protection ---

def _make_fake_request(peer_ip: str, headers: dict):
    return SimpleNamespace(
        client=SimpleNamespace(host=peer_ip),
        headers=headers,
    )


def test_h4_get_client_ip_ignores_spoofed_xff_unless_proxy_trusted(monkeypatch):
    req = _make_fake_request("198.51.100.77", {"X-Forwarded-For": "1.2.3.4, 203.0.113.9"})

    monkeypatch.setenv("TRUST_PROXY_HEADERS", "0")
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    # Untrusted mode ignores XFF completely and uses peer socket IP
    assert backend_main.get_client_ip(req) == "198.51.100.77"

    # Trusted single-hop proxy reads right-to-left (203.0.113.9), ignoring client-prepended 1.2.3.4!
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "1")
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")
    assert backend_main.get_client_ip(req) == "203.0.113.9"


# --- H5: Supabase fail-closed (never silently fall back to unowned local JSON) ---

def test_h5_storage_fails_closed_when_supabase_errors(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "SUPABASE_URL", "https://broken.supabase.co")
    monkeypatch.setattr(storage, "SUPABASE_SERVICE_ROLE_KEY", "service-key")
    local_file = tmp_path / "timelines.json"
    local_file.write_text('[{"id": "leaked", "title": "Secret", "articles": []}]', encoding="utf-8")
    monkeypatch.setattr(storage, "TIMELINES_FILE", local_file)

    class BrokenClient:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, *args, **kwargs):
            raise httpx.ConnectError("DB unreachable")

        def get(self, *args, **kwargs):
            raise httpx.ConnectError("DB unreachable")

    monkeypatch.setattr(storage, "_supabase_http_client", lambda: BrokenClient())
    monkeypatch.setattr(storage, "get_timeline_access_meta", lambda tl_id: None)

    with pytest.raises(RuntimeError):
        storage.save_timeline_data(
            {
                "id": "tl-1",
                "title": "Test",
                "articles": [{"id": "a1", "title": "Ev", "from": {"year": 2020}}],
            },
            user_id="u-1",
        )
    # Local file was NOT overwritten with user's private timeline
    assert "tl-1" not in local_file.read_text(encoding="utf-8")
    # Listing fails closed with [] instead of leaking local timelines.json's "leaked" item
    assert storage.list_all_timelines(user_id="u-1") == []


# --- H8: Finished AI job eviction isolates per-user caps ---

def test_h8_cleanup_ai_jobs_isolates_per_user_cap():
    saved_jobs = dict(backend_main._AI_JOBS)
    backend_main._AI_JOBS.clear()
    try:
        now = time.time()
        # User A has 1 undelivered finished job
        backend_main._AI_JOBS["job-victim"] = {
            "status": "done",
            "user_id": "user-victim",
            "updated": now - 10,
        }
        # User B floods 10 finished jobs
        for i in range(10):
            backend_main._AI_JOBS[f"job-flood-{i}"] = {
                "status": "done",
                "user_id": "user-flooder",
                "updated": now + i,
            }
        backend_main._cleanup_ai_jobs()
        # Victim's job survives even though flooder exceeded per-user cap (6)
        assert "job-victim" in backend_main._AI_JOBS
        flooder_remaining = [k for k in backend_main._AI_JOBS if k.startswith("job-flood-")]
        assert len(flooder_remaining) == backend_main._MAX_FINISHED_AI_JOBS_PER_USER
    finally:
        backend_main._AI_JOBS.clear()
        backend_main._AI_JOBS.update(saved_jobs)


# --- M1 & M2: Atomic credit charging & fail-closed when no free keys exist ---

def test_m1_charge_premium_credits_is_atomic_under_concurrency(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setattr(quota_service, "DATA_DIR", tmp_path)
    monkeypatch.setattr(quota_service, "USAGE_FILE", tmp_path / "quota.json")
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "10")
    monkeypatch.setenv("COMMUNITY_POOL_MONTHLY_BUDGET_USD", "1000")
    monkeypatch.setenv("GEMINI_API_KEY", "paid-secret-key")
    quota_service._WARNED_MISSING_FREE_KEYS = False

    user = {"id": "u-race", "email": "race@test.dev", "is_anonymous": False}

    def attempt(_):
        allowed, *_ = quota_service.charge_premium_credits(user, credits=6)
        return bool(allowed)

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        outcomes = list(pool.map(attempt, range(5)))

    # With 10 daily credits and 6 credits per call, AT MOST 1 of 5 parallel calls can succeed!
    assert outcomes.count(True) == 1
    assert quota_service.get_usage_for_identifiers(["u-race"]).get("u-race") == 6


def test_m2_no_free_keys_fails_closed_instead_of_using_paid_key(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setattr(quota_service, "DATA_DIR", tmp_path)
    monkeypatch.setattr(quota_service, "USAGE_FILE", tmp_path / "quota_m2.json")
    monkeypatch.setenv("API_KEY_MODE", "limited")
    monkeypatch.setenv("DAILY_PAID_PROMPTS", "1")
    monkeypatch.setenv("COMMUNITY_POOL_MONTHLY_BUDGET_USD", "1000")
    monkeypatch.setenv("GEMINI_API_KEY", "paid-only-key")
    for k in list(quota_service.os.environ.keys()):
        if k.startswith("GEMINI_API_KEY_FREE"):
            monkeypatch.delenv(k, raising=False)

    assert quota_service.get_all_free_keys() == []
    user = {"id": "u-over", "email": "over@test.dev", "is_anonymous": False}

    # First call uses the 1 paid credit
    key1, tier1, _ = quota_service.resolve_gemini_key(user, increment_usage=True)
    assert key1 == "paid-only-key"
    assert tier1 == "paid"

    # Second call is over limit and MUST fail closed with 429, never silently returning paid-only-key!
    with pytest.raises(HTTPException) as exc:
        quota_service.resolve_gemini_key(user, increment_usage=True)
    assert exc.value.status_code == 429


# --- M3: Hugging Face Space URL validation ---

def test_m3_validate_hf_space_image_url_blocks_foreign_hosts():
    base = "https://black-forest-labs-flux-1-schnell.hf.space"
    assert (
        gemini_service._validate_hf_space_image_url("/gradio_api/file=/tmp/out.webp", base)
        == f"{base}/gradio_api/file=/tmp/out.webp"
    )
    with pytest.raises(ValueError):
        gemini_service._validate_hf_space_image_url("https://attacker.evil.example/steal", base)
    with pytest.raises(ValueError):
        gemini_service._validate_hf_space_image_url("http://black-forest-labs-flux-1-schnell.hf.space/img.webp", base)


# --- L1 & L8: Per-gender Gemini TTS credit tracking & Ko-fi currency/tx_id validation ---

def test_l1_per_gender_gemini_tts_unlock_isolation():
    doc = {
        "voice_gender": "female",
        "audio": {
            "gemini": {
                "charged": True,
                "charged_genders": ["female"],
                "by_gender": {"female": {"charged": True}},
            }
        },
    }
    assert backend_main._is_gemini_gender_charged(doc, "female") is True
    assert backend_main._is_gemini_gender_charged(doc, "male") is False


def test_l8_kofi_webhook_rejects_missing_tx_id_and_non_usd_currency(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setattr(quota_service, "DATA_DIR", tmp_path)
    monkeypatch.setattr(quota_service, "USAGE_FILE", tmp_path / "ledger.json")

    res_no_tx = quota_service.record_community_donation_usd(5.0, tx_id="", currency="USD")
    assert res_no_tx.get("recorded") is False

    res_bad_curr = quota_service.record_community_donation_usd(1000.0, tx_id="tx-xyz-1", currency="XYZ")
    assert res_bad_curr.get("recorded") is False

    res_ok = quota_service.record_community_donation_usd(5.0, tx_id="tx-usd-1", currency="USD")
    assert res_ok.get("recorded") is True
    # Duplicate tx_id is idempotent
    res_dup = quota_service.record_community_donation_usd(5.0, tx_id="tx-usd-1", currency="USD")
    assert res_dup.get("recorded") is False
    assert res_dup.get("duplicate") is True
