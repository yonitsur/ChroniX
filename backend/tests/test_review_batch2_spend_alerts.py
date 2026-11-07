"""SC-10: spend-cap circuit breakers alert once per threshold per UTC day, are visible to admins,
and production warns at startup while the $5/day community default is still in place."""
import logging

import pytest

import services.quota_service as quota

ADMIN = {"id": "spend-admin", "email": "spend-admin@example.com"}


@pytest.fixture(autouse=True)
def spend_env(monkeypatch):
    for name in ("DAILY_COMMUNITY_USD_LIMIT", "DAILY_USD_CAP_REGISTERED", "DAILY_USD_CAP_GUEST",
                 "GUEST_IP_DAILY_USD_CAP", "APP_ENV", "RENDER"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("ADMIN_EMAILS", ADMIN["email"])
    quota._spend_alerts_fired.clear()
    yield
    quota._spend_alerts_fired.clear()


def _alerts(caplog, scope):
    return [r for r in caplog.records if r.getMessage().startswith(f"SPEND_ALERT scope={scope} ")]


def test_community_thresholds_fire_once_each(monkeypatch, caplog):
    monkeypatch.setenv("DAILY_COMMUNITY_USD_LIMIT", "1.00")
    caplog.set_level(logging.WARNING, logger="ChroniXQuota")
    spends = [0.30, 0.25, 0.10, 0.20, 0.20, 0.50]  # cumulative: .30 .55 .65 .85 1.05 1.55
    for n, usd in enumerate(spends):
        quota.record_identity_spend_usd({"id": f"spender-{n}"}, None, usd)

    alerts = _alerts(caplog, "community")
    assert [("threshold=50%" in a.getMessage(), "threshold=80%" in a.getMessage(), "threshold=100%" in a.getMessage())
            for a in alerts] == [(True, False, False), (False, True, False), (False, False, True)]
    assert alerts[-1].levelno == logging.ERROR
    assert "limit_usd=1.00" in alerts[0].getMessage()


def test_one_large_spend_crossing_several_thresholds_fires_each(monkeypatch, caplog):
    monkeypatch.setenv("DAILY_COMMUNITY_USD_LIMIT", "1.00")
    caplog.set_level(logging.WARNING, logger="ChroniXQuota")
    quota.record_identity_spend_usd({"id": "whale"}, None, 0.9)
    messages = [a.getMessage() for a in _alerts(caplog, "community")]
    assert len(messages) == 2
    assert "threshold=50%" in messages[0] and "threshold=80%" in messages[1]


def test_threshold_alerts_are_deduplicated_per_day(caplog):
    caplog.set_level(logging.WARNING, logger="ChroniXQuota")
    quota._check_spend_thresholds("2026-11-05", "community", 0, 600_000, 1.0)
    quota._check_spend_thresholds("2026-11-05", "community", 0, 600_000, 1.0)
    assert len(_alerts(caplog, "community")) == 1
    quota._check_spend_thresholds("2026-11-06", "community", 0, 600_000, 1.0)
    assert len(_alerts(caplog, "community")) == 2


def test_personal_cap_hits_are_counted_and_alerted_once(caplog):
    caplog.set_level(logging.WARNING, logger="ChroniXQuota")
    quota.record_identity_spend_usd({"id": "heavy-1"}, None, 0.60)  # over the $0.50 default
    quota.record_identity_spend_usd({"id": "heavy-1"}, None, 0.10)  # already over: not a new hit
    quota.record_identity_spend_usd({"id": "heavy-2"}, None, 0.60)
    status = quota.get_community_usd_cap_status()
    assert status["personal_cap_hits_today"] == 2
    assert len(_alerts(caplog, "personal_cap_hits")) == 1


def test_admin_quota_payload_exposes_community_usd_cap():
    quota.record_identity_spend_usd({"id": "someone"}, None, 1.25)
    info = quota.get_user_quota_info(ADMIN)
    cap = info["community_usd_cap"]
    assert cap["enabled"] is True
    assert cap["limit_usd"] == pytest.approx(5.0)
    assert cap["is_default_limit"] is True
    assert cap["spent_usd_today"] == pytest.approx(1.25)
    assert cap["percent_used"] == 25
    assert cap["capped"] is False


def test_non_admin_quota_payload_does_not_expose_cap_details():
    info = quota.get_user_quota_info({"id": "regular", "email": "regular@example.com"})
    assert "community_usd_cap" not in info


def test_startup_warns_about_default_cap_in_production(monkeypatch, caplog):
    caplog.set_level(logging.WARNING, logger="ChroniXQuota")
    quota.log_spend_cap_startup_warnings()
    assert not caplog.records  # not production

    monkeypatch.setenv("RENDER", "true")
    quota.log_spend_cap_startup_warnings()
    assert any("DAILY_COMMUNITY_USD_LIMIT is the default" in r.getMessage() for r in caplog.records)

    caplog.clear()
    monkeypatch.setenv("DAILY_COMMUNITY_USD_LIMIT", "125")
    quota.log_spend_cap_startup_warnings()
    assert not caplog.records


def test_default_community_cap_is_unchanged():
    # Spend defaults are the owner's decision (SC-10): only alerts and docs were added.
    assert quota.get_community_daily_usd_limit() == pytest.approx(5.0)
    assert quota.get_registered_daily_usd_cap() == pytest.approx(0.50)
    assert quota.get_guest_daily_usd_cap() == pytest.approx(0.20)
