"""The startup model preflight, and the one property that makes it a deploy gate.

An alarm the deploy workflow cannot see is not a gate. `deploy.yml` filters worker
logs on `severity>=ERROR`; plain `logging` output from this process lands at DEFAULT
severity, so the alarm has to be a structured line carrying its own severity.
"""

import json

import pytest
from majorana_llm.preflight import ModelStatus, PreflightReport, RoleModel
from majorana_worker import __main__ as worker_main


def _report(*roles: RoleModel) -> PreflightReport:
    return PreflightReport(provider="openai", roles=roles)


UNSUPPORTED = _report(
    RoleModel("plan", "deepseek-reasoner", ModelStatus.UNSUPPORTED),
    RoleModel("chat", "deepseek-v4-pro", ModelStatus.SUPPORTED),
)
HEALTHY = _report(RoleModel("plan", "deepseek-v4-pro", ModelStatus.SUPPORTED))
UNKNOWN = _report(RoleModel("plan", "deepseek-v4-pro", ModelStatus.UNKNOWN, "timeout"))


def _pin(monkeypatch, report):
    async def fake_check(*args, **kwargs):
        return report

    monkeypatch.setattr("majorana_llm.preflight.check_with_timeout", fake_check)


def _pin_news_model(monkeypatch, role: RoleModel):
    async def fake_check_model_served(*args, **kwargs):
        return role

    monkeypatch.setattr("majorana_llm.preflight.check_model_served", fake_check_model_served)


async def test_an_unsupported_news_model_fails_the_same_gate(monkeypatch, capsys):
    """LEONA_NEWS_MODEL bypasses model_for(), so it must not bypass this gate too."""
    _pin(monkeypatch, HEALTHY)
    _pin_news_model(monkeypatch, RoleModel("news_text", "gpt-4-retired", ModelStatus.UNSUPPORTED))
    monkeypatch.setenv("LEONA_NEWS_ENABLED", "true")
    monkeypatch.setenv("LEONA_NEWS_MODEL", "gpt-4-retired")

    await worker_main._preflight_models()

    entry = json.loads(capsys.readouterr().out.strip())
    assert entry["severity"] == "ERROR"
    assert {"role": "news_text", "model": "gpt-4-retired"} in entry["unsupported"]


async def test_a_supported_news_model_stays_quiet(monkeypatch, capsys):
    _pin(monkeypatch, HEALTHY)
    _pin_news_model(monkeypatch, RoleModel("news_text", "gpt-5.5", ModelStatus.SUPPORTED))
    monkeypatch.setenv("LEONA_NEWS_ENABLED", "true")
    monkeypatch.setenv("LEONA_NEWS_MODEL", "gpt-5.5")

    await worker_main._preflight_models()

    assert capsys.readouterr().out.strip() == ""


async def test_news_disabled_never_checks_the_news_model(monkeypatch, capsys):
    """No LEONA_NEWS_ENABLED must mean no call, not merely no alarm."""
    _pin(monkeypatch, HEALTHY)
    called = False

    async def fail_if_called(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("check_model_served must not run when news is disabled")

    monkeypatch.setattr("majorana_llm.preflight.check_model_served", fail_if_called)
    monkeypatch.delenv("LEONA_NEWS_ENABLED", raising=False)
    monkeypatch.setenv("LEONA_NEWS_MODEL", "gpt-5.5")

    await worker_main._preflight_models()

    assert called is False
    assert capsys.readouterr().out.strip() == ""


async def test_a_broken_news_preflight_never_takes_the_worker_down(monkeypatch, capsys):
    _pin(monkeypatch, HEALTHY)
    monkeypatch.setenv("LEONA_NEWS_ENABLED", "true")
    monkeypatch.setenv("LEONA_NEWS_MODEL", "gpt-5.5")

    async def explode(*args, **kwargs):
        raise RuntimeError("provider SDK exploded")

    monkeypatch.setattr("majorana_llm.preflight.check_model_served", explode)

    await worker_main._preflight_models()  # must not raise

    assert capsys.readouterr().out.strip() == ""


async def test_unsupported_models_raise_a_structured_error_the_deploy_gate_can_read(
    monkeypatch, capsys
):
    _pin(monkeypatch, UNSUPPORTED)

    await worker_main._preflight_models()

    entry = json.loads(capsys.readouterr().out.strip())
    assert entry["severity"] == "ERROR", "the gate filters severity>=ERROR"
    assert "deepseek-reasoner" in entry["message"]
    assert entry["unsupported"] == [{"role": "plan", "model": "deepseek-reasoner"}]


async def test_the_alarm_is_one_line_because_the_gate_reads_jsonPayload_message(
    monkeypatch, capsys
):
    _pin(monkeypatch, UNSUPPORTED)

    await worker_main._preflight_models()

    assert len(capsys.readouterr().out.strip().splitlines()) == 1


async def test_a_healthy_configuration_stays_quiet(monkeypatch, capsys):
    _pin(monkeypatch, HEALTHY)

    await worker_main._preflight_models()

    assert capsys.readouterr().out.strip() == "", "a passing preflight must not fail a deploy"


async def test_an_unprovable_preflight_stays_quiet(monkeypatch, capsys):
    """No answer from the provider must never fail a deploy."""
    _pin(monkeypatch, UNKNOWN)

    await worker_main._preflight_models()

    assert capsys.readouterr().out.strip() == ""


async def test_a_broken_preflight_never_takes_the_worker_down(monkeypatch, capsys):
    async def explode(*args, **kwargs):
        raise RuntimeError("provider SDK exploded")

    monkeypatch.setattr("majorana_llm.preflight.check_with_timeout", explode)

    await worker_main._preflight_models()  # must not raise

    assert capsys.readouterr().out.strip() == ""


def test_structured_log_emits_parseable_json_with_its_fields(capsys):
    worker_main._structured_log("ERROR", "boom", provider="openai", checked={"plan": "m"})

    entry = json.loads(capsys.readouterr().out.strip())
    assert entry == {
        "severity": "ERROR",
        "message": "boom",
        "provider": "openai",
        "checked": {"plan": "m"},
    }


@pytest.mark.parametrize("status", [ModelStatus.SUPPORTED, ModelStatus.UNKNOWN])
def test_only_unsupported_counts_as_an_offender(status):
    report = _report(RoleModel("plan", "some-model", status))

    assert report.unsupported == ()
