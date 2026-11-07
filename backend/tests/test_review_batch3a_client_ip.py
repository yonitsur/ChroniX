"""Batch 3A - S-07: client-IP derivation behind proxies, and IPv6 /64 + /56 guest buckets."""
from pathlib import Path

import pytest
from starlette.requests import Request

import main
from services import quota_service


def _request(peer="10.1.2.3", headers=()):
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers],
        "client": (peer, 40000) if peer else None,
    }
    return Request(scope)


@pytest.fixture(autouse=True)
def proxy_env(monkeypatch):
    for var in ("TRUST_PROXY_HEADERS", "TRUSTED_PROXY_HOPS", "TRUST_X_REAL_IP", "TRUSTED_CLIENT_IP_HEADER",
                "RAILWAY_ENVIRONMENT", "LOG_FORWARDED_HEADERS_ONCE", "GUEST_IPV6_56_MULTIPLIER"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setattr(main, "_FORWARDED_HEADERS_LOGGED", False)


def test_multiple_xff_header_lines_are_joined_in_order():
    req = _request(headers=[("X-Forwarded-For", "6.6.6.6"), ("X-Forwarded-For", "203.0.113.9")])
    assert main.get_client_ip(req) == "203.0.113.9"


def test_spoofed_leftmost_entries_are_ignored(monkeypatch):
    req = _request(headers=[("X-Forwarded-For", "1.1.1.1, 2.2.2.2, garbage, 198.51.100.4")])
    assert main.get_client_ip(req) == "198.51.100.4"
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    assert main.get_client_ip(req) == "2.2.2.2"


def test_x_real_ip_ignored_unless_enabled(monkeypatch):
    req = _request(peer="10.0.0.9", headers=[("X-Real-IP", "7.7.7.7")])
    assert main.get_client_ip(req) == "10.0.0.9"
    monkeypatch.setenv("TRUST_X_REAL_IP", "true")
    assert main.get_client_ip(req) == "7.7.7.7"


def test_edge_header_used_only_when_configured(monkeypatch):
    req = _request(headers=[("CF-Connecting-IP", "192.0.2.44"), ("X-Forwarded-For", "203.0.113.9")])
    assert main.get_client_ip(req) == "203.0.113.9"
    monkeypatch.setenv("TRUSTED_CLIENT_IP_HEADER", "CF-Connecting-IP")
    assert main.get_client_ip(req) == "192.0.2.44"
    # An unparsable edge value falls through to X-Forwarded-For.
    bad = _request(headers=[("CF-Connecting-IP", "nope"), ("X-Forwarded-For", "203.0.113.9")])
    assert main.get_client_ip(bad) == "203.0.113.9"


def test_untrusted_proxy_uses_socket_peer_only(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "0")
    monkeypatch.setenv("TRUSTED_CLIENT_IP_HEADER", "CF-Connecting-IP")
    monkeypatch.setenv("TRUST_X_REAL_IP", "true")
    req = _request(peer="198.51.100.77", headers=[
        ("X-Forwarded-For", "1.2.3.4"), ("X-Real-IP", "5.6.7.8"), ("CF-Connecting-IP", "9.9.9.9"),
    ])
    assert main.get_client_ip(req) == "198.51.100.77"


def test_forwarded_headers_diagnostic_logs_once(monkeypatch, caplog):
    monkeypatch.setenv("LOG_FORWARDED_HEADERS_ONCE", "true")
    req = _request(headers=[("X-Forwarded-For", "203.0.113.9")])
    with caplog.at_level("WARNING", logger="ChroniXAPI"):
        main.get_client_ip(req)
        main.get_client_ip(req)
    hits = [r for r in caplog.records if "Forwarding headers" in r.getMessage()]
    assert len(hits) == 1 and "203.0.113.9" in hits[0].getMessage()


def test_procfile_does_not_trust_every_proxy():
    procfile = (Path(main.__file__).parent / "Procfile").read_text()
    assert 'forwarded-allow-ips="*"' not in procfile
    assert "--proxy-headers" not in procfile


# --- IPv6 bucketing ---------------------------------------------------------------------------------

def test_ipv6_buckets_by_64_and_56():
    a = "2001:db8:abcd:1200:1111:2222:3333:4444"
    same64 = "2001:db8:abcd:1200:ffff::1"
    other64_same56 = "2001:db8:abcd:12ff::1"
    other56 = "2001:db8:abcd:1300::1"
    assert quota_service.normalize_client_ip(a) == quota_service.normalize_client_ip(same64)
    assert quota_service.normalize_client_ip(a) != quota_service.normalize_client_ip(other64_same56)
    assert quota_service.ipv6_coarse_network(a) == quota_service.ipv6_coarse_network(other64_same56)
    assert quota_service.ipv6_coarse_network(a) != quota_service.ipv6_coarse_network(other56)
    assert quota_service.ipv6_coarse_network("203.0.113.9") is None
    assert quota_service.ipv6_coarse_network("::1") is None


def test_ipv6_56_bucket_can_be_disabled(monkeypatch):
    monkeypatch.setenv("GUEST_IPV6_56_MULTIPLIER", "0")
    assert quota_service.ipv6_coarse_network("2001:db8::1") is None
    assert len(quota_service.get_guest_identifiers({"id": "g"}, "2001:db8::1")) == 2


def test_guest_credit_ceiling_spans_64s_inside_one_56(monkeypatch):
    monkeypatch.setenv("GUEST_DAILY_PAID_PROMPTS", "5")
    monkeypatch.setenv("GUEST_IP_DAILY_PAID_PROMPTS", "10")
    monkeypatch.setenv("GUEST_IPV6_56_MULTIPLIER", "2")
    ids = quota_service.get_guest_identifiers({"id": "g1"}, "2001:db8:0:1::5")
    assert any(i.startswith("guest_ip56:h_") for i in ids)
    # Fill two /64s of one /56 to their per-IP ceiling (10 each): the /56 bucket (cap 20) is now full.
    for n in range(20):
        prefix = f"2001:db8:0:{1 if n < 10 else 2}::5"
        quota_service.record_guest_usage({"id": f"g{n}"}, prefix)
    fresh = {"id": "fresh"}
    assert quota_service.get_guest_usage(fresh, "2001:db8:0:3::5") == 5  # third /64: blocked by the /56
    assert quota_service.get_guest_usage(fresh, "2001:db8:1:3::5") == 0  # another /56: untouched


def test_rate_limiter_adds_56_bucket_for_ipv6_guests(monkeypatch):
    monkeypatch.setenv("RENDER", "")
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "0")
    limiter = main.SimpleRateLimiter(max_requests=2, name="t")
    v6 = limiter.get_identifier(_request(peer="2001:db8:0:1::5"), {"id": "g", "is_anonymous": True})
    assert v6.split("|")[0] == "guest:g"
    assert any(part.startswith("guest_ip56_all:2001:db8::/56") for part in v6.split("|"))
    v4 = limiter.get_identifier(_request(peer="203.0.113.9"), {"id": "g", "is_anonymous": True})
    assert "guest_ip56_all" not in v4
