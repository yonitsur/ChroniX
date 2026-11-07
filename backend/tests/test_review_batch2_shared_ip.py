"""SC-12: guests behind one IP (classrooms, carrier NAT) are counted by guest id, with IP only as
a much higher secondary ceiling: concurrent jobs, rate limits and the daily credit backstop."""
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

import main
from services import quota_service

SCHOOL_IP = "203.0.113.77"


def _guest(n):
    return {"id": f"classroom-guest-{n}", "is_anonymous": True}


@pytest.fixture(autouse=True)
def isolated_jobs(monkeypatch):
    saved = dict(main._AI_JOBS)
    main._AI_JOBS.clear()
    for name in ("MAX_CONCURRENT_JOBS_PER_USER", "MAX_CONCURRENT_JOBS_PER_IP", "GUEST_RATE_LIMIT_IP_MULTIPLIER"):
        monkeypatch.delenv(name, raising=False)
    yield
    main._AI_JOBS.clear()
    main._AI_JOBS.update(saved)


# --- concurrent jobs ------------------------------------------------------------------------

def test_two_guests_on_one_ip_each_get_their_own_two_jobs():
    a, b = _guest("a"), _guest("b")
    main._create_ai_job(a, client_ip=SCHOOL_IP)
    main._create_ai_job(a, client_ip=SCHOOL_IP)

    with pytest.raises(HTTPException) as exc:
        main._enforce_concurrent_job_limit(a, SCHOOL_IP)
    assert exc.value.status_code == 429 and "already running" in exc.value.detail

    # Guest B on the same school IP is unaffected by guest A's jobs.
    main._enforce_concurrent_job_limit(b, SCHOOL_IP)
    main._create_ai_job(b, client_ip=SCHOOL_IP)
    main._enforce_concurrent_job_limit(b, SCHOOL_IP)


def test_ip_ceiling_still_blocks_floods_from_one_network():
    assert main._max_concurrent_jobs_per_ip() == 12
    for n in range(12):
        main._create_ai_job(_guest(n), client_ip=SCHOOL_IP)

    with pytest.raises(HTTPException) as exc:
        main._enforce_concurrent_job_limit(_guest("13th"), SCHOOL_IP)
    assert exc.value.status_code == 429
    assert "network" in exc.value.detail
    assert exc.value.headers.get("Retry-After")

    # Another network is unaffected.
    main._enforce_concurrent_job_limit(_guest("elsewhere"), "198.51.100.1")


def test_ip_ceiling_is_env_configurable_and_ignores_admin_jobs(monkeypatch):
    monkeypatch.setenv("MAX_CONCURRENT_JOBS_PER_IP", "2")
    monkeypatch.setenv("ADMIN_EMAILS", "teacher-admin@example.com")
    admin = {"id": "admin-x", "email": "teacher-admin@example.com"}
    main._create_ai_job(admin, client_ip=SCHOOL_IP)
    main._create_ai_job(_guest(1), client_ip=SCHOOL_IP)
    main._enforce_concurrent_job_limit(_guest(2), SCHOOL_IP)  # admin job doesn't count
    main._create_ai_job(_guest(2), client_ip=SCHOOL_IP)
    with pytest.raises(HTTPException):
        main._enforce_concurrent_job_limit(_guest(3), SCHOOL_IP)

    monkeypatch.setenv("MAX_CONCURRENT_JOBS_PER_IP", "0")  # 0 disables the IP ceiling
    main._enforce_concurrent_job_limit(_guest(3), SCHOOL_IP)


# --- rate limiter ---------------------------------------------------------------------------

def _request(ip=SCHOOL_IP):
    req = MagicMock()
    req.headers.get.return_value = None
    req.client.host = ip
    return req


def test_rate_limiter_identifiers():
    limiter = main.SimpleRateLimiter(max_requests=2, name="sc12-ids")
    req = _request("10.1.2.3")
    assert limiter.get_identifier(req, {"id": "reg-1", "email": "r@example.com"}) == "user:reg-1"
    assert limiter.get_identifier(req, _guest("x")) == "guest:classroom-guest-x|guest_ip_all:10.1.2.3"
    assert limiter.get_identifier(req, None) == "guest_ip:10.1.2.3"


@pytest.mark.asyncio
async def test_guests_on_one_ip_have_separate_rate_limits_and_refunds_hit_both_buckets():
    limiter = main.SimpleRateLimiter(max_requests=2, name="sc12-rl")
    req = _request()
    a, b = _guest("rl-a"), _guest("rl-b")
    await limiter(req, x_gemini_api_key=None, user=a)
    await limiter(req, x_gemini_api_key=None, user=a)
    with pytest.raises(HTTPException) as exc:
        await limiter(req, x_gemini_api_key=None, user=a)
    assert exc.value.status_code == 429

    await limiter(req, x_gemini_api_key=None, user=b)  # B has its own allowance
    ip_bucket = f"guest_ip_all:{SCHOOL_IP}"
    assert len(limiter.records[ip_bucket]) == 3

    limiter.refund(limiter.get_identifier(req, a))
    assert len(limiter.records[f"guest:{a['id']}"]) == 1
    assert len(limiter.records[ip_bucket]) == 2
    await limiter(req, x_gemini_api_key=None, user=a)


@pytest.mark.asyncio
async def test_guest_rate_limit_ip_ceiling(monkeypatch):
    monkeypatch.setenv("GUEST_RATE_LIMIT_IP_MULTIPLIER", "2")
    limiter = main.SimpleRateLimiter(max_requests=2, name="sc12-ceiling")
    req = _request()
    for n in range(4):  # ceiling = 2 x 2 per IP per window
        await limiter(req, x_gemini_api_key=None, user=_guest(f"c{n}"))
    with pytest.raises(HTTPException) as exc:
        await limiter(req, x_gemini_api_key=None, user=_guest("c5"))
    assert exc.value.status_code == 429
    # Another IP is unaffected.
    await limiter(_request("198.51.100.2"), x_gemini_api_key=None, user=_guest("c5"))


def test_default_guest_rate_limit_ip_multiplier_is_five():
    assert main.SimpleRateLimiter.guest_ip_ceiling_multiplier() == 5


@pytest.mark.asyncio
async def test_unauthenticated_callers_are_still_keyed_by_ip():
    limiter = main.SimpleRateLimiter(max_requests=1, name="sc12-anon")
    await limiter(_request(), x_gemini_api_key=None, user=None)
    with pytest.raises(HTTPException):
        await limiter(_request(), x_gemini_api_key=None, user=None)


def test_job_refund_uses_composite_guest_identifier():
    main.timeline_rate_limiter.records.clear()
    guest = _guest("refund")
    ident = main.timeline_rate_limiter.get_identifier(_request(), guest)
    for key in ident.split("|"):
        main.timeline_rate_limiter.records[key].append(1e12)
    job_id = main._create_ai_job(guest, client_ip=SCHOOL_IP, rate_limit_identifier=ident)
    main._refund_job_quota_and_limits(main._AI_JOBS[job_id], guest)
    for key in ident.split("|"):
        assert key not in main.timeline_rate_limiter.records


# --- guest per-IP daily credit backstop -----------------------------------------------------

@pytest.fixture
def guest_credit_env(monkeypatch):
    for name in ("GUEST_DAILY_PAID_PROMPTS", "GUEST_IP_DAILY_PAID_PROMPTS", "DAILY_USD_CAP_GUEST",
                 "GUEST_IP_DAILY_USD_CAP", "DAILY_COMMUNITY_PAID_LIMIT", "MONTHLY_COMMUNITY_PAID_LIMIT"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GUEST_API_KEY_MODE", "limited")


def test_guest_ip_backstop_defaults_to_five_times_the_guest_limit(guest_credit_env, monkeypatch):
    assert quota_service.get_guest_daily_limit() == 10  # policy: 10 credits per guest
    assert quota_service.get_guest_ip_daily_limit() == 50
    assert quota_service.get_guest_ip_daily_usd_cap() == pytest.approx(1.00)

    monkeypatch.setenv("GUEST_IP_DAILY_PAID_PROMPTS", "200")
    monkeypatch.setenv("GUEST_IP_DAILY_USD_CAP", "4")
    assert quota_service.get_guest_ip_daily_limit() == 200
    assert quota_service.get_guest_ip_daily_usd_cap() == pytest.approx(4.0)

    # Overrides can never go below the per-guest allowance.
    monkeypatch.setenv("GUEST_IP_DAILY_PAID_PROMPTS", "3")
    assert quota_service.get_guest_ip_daily_limit() == 10


def test_classmates_each_get_their_own_credits_until_the_ip_backstop(guest_credit_env):
    for n in range(4):
        quota_service.record_guest_usage(_guest(f"cred{n}"), SCHOOL_IP, credits=10)
        assert quota_service.get_user_quota_info(_guest(f"cred{n}"), SCHOOL_IP)["remaining_paid"] == 0

    fifth = quota_service.get_user_quota_info(_guest("cred4"), SCHOOL_IP)
    assert fifth["remaining_paid"] == 10
    quota_service.record_guest_usage(_guest("cred4"), SCHOOL_IP, credits=10)

    # 50 credits used on this IP today: a sixth session gets nothing from the backstop.
    sixth = quota_service.get_user_quota_info(_guest("cred5"), SCHOOL_IP)
    assert sixth["remaining_paid"] == 0
