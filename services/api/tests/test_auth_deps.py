"""The local development token still goes through the API auth dependency."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request

from majorana_api.auth.deps import get_identity, get_verified_token
from majorana_api.auth.jwt import VerifiedToken
from majorana_api.settings import Settings


def _request(method: str = "POST", route_path: str = "/runs") -> Request:
    """A routed request, as every caller of get_verified_token now has one.

    These tests are about which credential authenticates, not about which route
    it may reach, so they all present a request the deploy probe would also be
    allowed on — that keeps a refusal here attributable to the credential.
    """
    return Request(
        {
            "type": "http",
            "method": method,
            "path": "/v1" + route_path,
            "headers": [],
            "route": SimpleNamespace(path=route_path),
        }
    )


@pytest.fixture
def local_settings() -> Settings:
    return Settings(
        workos_client_id="local-dev",
        workos_jwt_issuer="https://local.invalid",
        workos_jwks_url="https://local.invalid/jwks",
        web_origin="http://localhost:3000",
        environment="development",
        local_dev_auth=True,
    )


async def test_local_dev_token_returns_synthetic_identity(local_settings: Settings):
    token = await get_verified_token(_request(), local_settings, "Bearer majorana-local-dev")
    assert token.workos_user_id == "local-dev-user"
    assert token.claims["email"] == "local-dev@majorana.test"


async def test_local_dev_token_still_fails_closed(local_settings: Settings):
    with pytest.raises(HTTPException) as exc:
        await get_verified_token(_request(), local_settings, "Bearer wrong-token")
    assert exc.value.status_code == 401


LOCK_TOKEN = "l" * 48


@pytest.fixture
def lock_settings() -> Settings:
    return Settings(
        workos_client_id="client_x",
        workos_jwt_issuer="https://api.workos.com/user_management/client_x",
        workos_jwks_url="https://api.workos.com/sso/jwks/client_x",
        web_origin="https://majorana.example",
        environment="production",
        single_user_lock=True,
        single_user_lock_token=LOCK_TOKEN,
    )


async def test_lock_token_returns_the_operator_identity(lock_settings: Settings):
    token = await get_verified_token(_request(), lock_settings, f"Bearer {LOCK_TOKEN}")
    assert token.workos_user_id == "single-user-lock"
    # An email claim is mandatory downstream: get_identity 403s without one, so
    # provisioning would break even though auth succeeded.
    assert token.claims["email"] == "operator@leonaquantum.com"


async def test_lock_rejects_the_public_placeholder_the_web_app_used_to_send(
    lock_settings: Settings,
):
    with pytest.raises(HTTPException) as exc:
        await get_verified_token(_request(), lock_settings, "Bearer majorana-single-user-lock")
    assert exc.value.status_code == 401


async def test_lock_mode_does_not_also_accept_workos_tokens(lock_settings, monkeypatch):
    """The perimeter is only real if a WorkOS JWT cannot walk around it.

    While the lock is on the app is single-operator, so a valid WorkOS token —
    which anyone can obtain by signing up — must not authenticate. Assert the
    JWKS path is never even reached.
    """

    async def explode(*args, **kwargs):  # pragma: no cover - must not run
        raise AssertionError("WorkOS verification must not run while the lock is on")

    monkeypatch.setattr("majorana_api.auth.deps.verify_bearer_token", explode)

    with pytest.raises(HTTPException) as exc:
        await get_verified_token(_request(), lock_settings, "Bearer eyJhbGciOiJSUzI1NiJ9.fake.jwt")
    assert exc.value.status_code == 401


async def test_reserved_service_identity_cannot_enter_human_auth_flow():
    token = VerifiedToken(
        workos_user_id="system:catalog-public-reader",
        session_id="attacker-session",
        claims={"email": "attacker@example.com"},
    )
    with pytest.raises(HTTPException) as exc:
        await get_identity(token, None)
    assert exc.value.status_code == 401
