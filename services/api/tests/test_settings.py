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


def _production_lock_env(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "production")
    monkeypatch.setenv("WORKOS_CLIENT_ID", "client_x")
    monkeypatch.setenv("SINGLE_USER_LOCK", "true")
    monkeypatch.delenv("MAJORANA_LOCAL_DEV_AUTH", raising=False)


def test_single_user_lock_requires_a_token(monkeypatch):
    _production_lock_env(monkeypatch)
    monkeypatch.delenv("SINGLE_USER_LOCK_API_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="requires SINGLE_USER_LOCK_API_TOKEN"):
        Settings.from_env()


def test_single_user_lock_refuses_the_public_placeholder(monkeypatch):
    """The web app shipped this constant in-repo; accepting it protects nothing."""
    _production_lock_env(monkeypatch)
    monkeypatch.setenv("SINGLE_USER_LOCK_API_TOKEN", "majorana-single-user-lock")
    with pytest.raises(RuntimeError, match="public placeholder"):
        Settings.from_env()


def test_single_user_lock_refuses_a_low_entropy_token(monkeypatch):
    _production_lock_env(monkeypatch)
    monkeypatch.setenv("SINGLE_USER_LOCK_API_TOKEN", "hunter2")
    with pytest.raises(RuntimeError, match="at least 32 characters"):
        Settings.from_env()


def test_single_user_lock_starts_with_a_real_token(monkeypatch):
    _production_lock_env(monkeypatch)
    monkeypatch.setenv("SINGLE_USER_LOCK_API_TOKEN", "t" * 48)
    settings = Settings.from_env()
    assert settings.single_user_lock is True
    assert settings.single_user_lock_user_id == "single-user-lock"


def test_single_user_lock_and_local_dev_auth_are_mutually_exclusive(monkeypatch):
    for name in ("CI", "VERCEL", "K_SERVICE", "K_REVISION", "K_CONFIGURATION"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("MAJORANA_ENV", "development")
    monkeypatch.setenv("WORKOS_CLIENT_ID", "client_x")
    monkeypatch.setenv("SINGLE_USER_LOCK", "true")
    monkeypatch.setenv("SINGLE_USER_LOCK_API_TOKEN", "t" * 48)
    monkeypatch.setenv("MAJORANA_LOCAL_DEV_AUTH", "true")
    with pytest.raises(RuntimeError, match="mutually exclusive"):
        Settings.from_env()


def test_local_dev_auth_rejects_cloud_run(monkeypatch):
    monkeypatch.setenv("MAJORANA_ENV", "development")
    monkeypatch.setenv("MAJORANA_LOCAL_DEV_AUTH", "true")
    monkeypatch.setenv("K_SERVICE", "majorana-api")
    with pytest.raises(RuntimeError, match="local process"):
        Settings.from_env()
