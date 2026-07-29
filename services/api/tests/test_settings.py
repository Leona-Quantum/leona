"""Configuration guards for the explicit WorkOS-free local development seam."""

import pytest

from majorana_api.settings import Settings


def test_local_dev_auth_can_start_without_workos(monkeypatch):
    monkeypatch.delenv("WORKOS_CLIENT_ID", raising=False)
    for name in ("CI", "VERCEL", "K_SERVICE", "K_REVISION", "K_CONFIGURATION"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("MAJORANA_ENV", "development")
    monkeypatch.setenv("MAJORANA_LOCAL_DEV_AUTH", "true")
    settings = Settings.from_env()
    assert settings.local_dev_auth is True
    assert settings.workos_client_id == "local-dev"


def test_workos_is_required_without_local_dev_auth(monkeypatch):
    monkeypatch.delenv("WORKOS_CLIENT_ID", raising=False)
    monkeypatch.delenv("MAJORANA_LOCAL_DEV_AUTH", raising=False)
    monkeypatch.delenv("MAJORANA_ENV", raising=False)
    with pytest.raises(RuntimeError, match="WORKOS_CLIENT_ID is required"):
        Settings.from_env()


def test_local_dev_auth_rejects_non_development_environment(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "production")
    monkeypatch.setenv("MAJORANA_LOCAL_DEV_AUTH", "true")
    with pytest.raises(RuntimeError, match="MAJORANA_ENV=development"):
        Settings.from_env()


def _production_env(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "production")
    monkeypatch.setenv("WORKOS_CLIENT_ID", "client_x")
    monkeypatch.delenv("MAJORANA_LOCAL_DEV_AUTH", raising=False)


def test_the_deploy_probe_is_off_unless_a_token_is_set(monkeypatch):
    """Every environment except production leaves DEPLOY_PROBE_TOKEN unset."""
    _production_env(monkeypatch)
    monkeypatch.delenv("DEPLOY_PROBE_TOKEN", raising=False)
    assert Settings.from_env().deploy_probe_token == ""


def test_the_deploy_probe_refuses_a_public_placeholder(monkeypatch):
    """A literal that appears in this public repository protects nothing."""
    _production_env(monkeypatch)
    monkeypatch.setenv("DEPLOY_PROBE_TOKEN", "majorana-deploy-probe")
    with pytest.raises(RuntimeError, match="public placeholder"):
        Settings.from_env()


def test_the_deploy_probe_refuses_a_low_entropy_token(monkeypatch):
    _production_env(monkeypatch)
    monkeypatch.setenv("DEPLOY_PROBE_TOKEN", "hunter2")
    with pytest.raises(RuntimeError, match="at least 32 characters"):
        Settings.from_env()


def test_the_deploy_probe_starts_with_a_real_token(monkeypatch):
    _production_env(monkeypatch)
    monkeypatch.setenv("DEPLOY_PROBE_TOKEN", "t" * 48)
    settings = Settings.from_env()
    assert settings.deploy_probe_token == "t" * 48
    assert settings.deploy_probe_email == "deploy-probe@leonaquantum.com"


def test_local_dev_auth_rejects_cloud_run(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "development")
    monkeypatch.setenv("MAJORANA_LOCAL_DEV_AUTH", "true")
    monkeypatch.setenv("K_SERVICE", "majorana-api")
    with pytest.raises(RuntimeError, match="local process"):
        Settings.from_env()


def test_vqe_candidate_execution_is_local_development_only(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "production")
    monkeypatch.setenv("WORKOS_CLIENT_ID", "client_x")
    monkeypatch.setenv("MAJORANA_VQE_CANDIDATE_EXECUTION", "true")
    with pytest.raises(RuntimeError, match="local process"):
        Settings.from_env()


def test_vqe_candidate_execution_rejects_cloud_markers(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "development")
    monkeypatch.setenv("WORKOS_CLIENT_ID", "client_x")
    monkeypatch.setenv("MAJORANA_VQE_CANDIDATE_EXECUTION", "true")
    monkeypatch.setenv("K_SERVICE", "majorana-api")
    with pytest.raises(RuntimeError, match="local process"):
        Settings.from_env()


def test_vqe_production_execution_requires_production_environment(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "development")
    monkeypatch.setenv("WORKOS_CLIENT_ID", "client_x")
    monkeypatch.setenv("MAJORANA_VQE_PRODUCTION_EXECUTION", "true")
    with pytest.raises(RuntimeError, match="MAJORANA_ENV=production"):
        Settings.from_env()


def test_vqe_production_execution_can_be_enabled_for_control_plane(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "production")
    monkeypatch.setenv("WORKOS_CLIENT_ID", "client_x")
    monkeypatch.setenv("MAJORANA_VQE_PRODUCTION_EXECUTION", "true")
    settings = Settings.from_env()
    assert settings.vqe_production_execution is True
    assert settings.vqe_candidate_execution is False
