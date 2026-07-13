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


def test_local_dev_auth_rejects_cloud_run(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "development")
    monkeypatch.setenv("MAJORANA_LOCAL_DEV_AUTH", "true")
    monkeypatch.setenv("K_SERVICE", "majorana-api")
    with pytest.raises(RuntimeError, match="local process"):
        Settings.from_env()
