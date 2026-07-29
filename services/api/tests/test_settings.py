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
    # Let both derive from the client id. A developer with either of these left
    # in their shell would otherwise fail every test below for a reason that has
    # nothing to do with what the test is about.
    monkeypatch.delenv("WORKOS_JWT_ISSUER", raising=False)
    monkeypatch.delenv("WORKOS_JWKS_URL", raising=False)


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


PRODUCTION_CLIENT = "client_01KX3TN2Y37QDVCWG1M7M5WRG8"
STAGING_CLIENT = "client_01KX3TN2D9X2JHZ75WZJQ95N9X"


def test_the_issuer_follows_the_client_id_when_it_is_not_pinned(monkeypatch):
    """The default is derived, and the derivation is the one WorkOS publishes.

    Checked against both clients' `.well-known/openid-configuration` on
    2026-07-29 — this is the shape, not a guess.
    """
    _production_env(monkeypatch)
    monkeypatch.setenv("WORKOS_CLIENT_ID", PRODUCTION_CLIENT)
    settings = Settings.from_env()
    assert settings.workos_jwt_issuer == (
        f"https://api.workos.com/user_management/{PRODUCTION_CLIENT}"
    )
    assert settings.workos_jwks_url == f"https://api.workos.com/sso/jwks/{PRODUCTION_CLIENT}"


def test_a_half_finished_environment_cutover_is_refused(monkeypatch):
    """The exact mistake: move the client id, leave the pinned issuer behind.

    Production pins all three rather than taking the default, so the WorkOS
    environment cutover has to change every one of them. Changing only the
    client id leaves token validation on the environment we left: every request
    403s, sign-in included, and the service reports itself healthy throughout.
    """
    _production_env(monkeypatch)
    monkeypatch.setenv("WORKOS_CLIENT_ID", PRODUCTION_CLIENT)
    monkeypatch.setenv(
        "WORKOS_JWT_ISSUER", f"https://api.workos.com/user_management/{STAGING_CLIENT}"
    )
    with pytest.raises(RuntimeError, match="WORKOS_JWT_ISSUER names client"):
        Settings.from_env()


def test_a_stale_jwks_url_is_refused_the_same_way(monkeypatch):
    """The signing keys are per-client too, and this one fails identically."""
    _production_env(monkeypatch)
    monkeypatch.setenv("WORKOS_CLIENT_ID", PRODUCTION_CLIENT)
    monkeypatch.setenv("WORKOS_JWKS_URL", f"https://api.workos.com/sso/jwks/{STAGING_CLIENT}")
    with pytest.raises(RuntimeError, match="WORKOS_JWKS_URL names client"):
        Settings.from_env()


def test_a_matching_pinned_pair_is_accepted(monkeypatch):
    """Production pins them explicitly and must keep starting when they agree.

    Without this the guard could be satisfied by refusing every pinned value,
    which would take the service down rather than protect it.
    """
    _production_env(monkeypatch)
    monkeypatch.setenv("WORKOS_CLIENT_ID", PRODUCTION_CLIENT)
    monkeypatch.setenv(
        "WORKOS_JWT_ISSUER", f"https://api.workos.com/user_management/{PRODUCTION_CLIENT}"
    )
    monkeypatch.setenv("WORKOS_JWKS_URL", f"https://api.workos.com/sso/jwks/{PRODUCTION_CLIENT}")
    assert Settings.from_env().workos_client_id == PRODUCTION_CLIENT


def test_a_custom_auth_domain_is_left_alone(monkeypatch):
    """A value that is not WorkOS-shaped is a deliberate override.

    There is no client id embedded in it to disagree with, and refusing it would
    break the custom-domain seam the field exists for.
    """
    _production_env(monkeypatch)
    monkeypatch.setenv("WORKOS_CLIENT_ID", PRODUCTION_CLIENT)
    monkeypatch.setenv("WORKOS_JWT_ISSUER", "https://auth.leonaqt.com")
    assert Settings.from_env().workos_jwt_issuer == "https://auth.leonaqt.com"


def test_the_guard_holds_for_a_directly_constructed_settings():
    """`from_env` is not the only way in — the deploy probe and the tests build
    Settings directly, and a guard with a second construction path around it is
    not a guard."""
    with pytest.raises(RuntimeError, match="WORKOS_JWT_ISSUER names client"):
        Settings(
            workos_client_id=PRODUCTION_CLIENT,
            workos_jwt_issuer=f"https://api.workos.com/user_management/{STAGING_CLIENT}",
            workos_jwks_url=f"https://api.workos.com/sso/jwks/{PRODUCTION_CLIENT}",
            web_origin="https://leonaqt.com",
        )
