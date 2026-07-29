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


async def test_reserved_service_identity_cannot_enter_human_auth_flow():
    token = VerifiedToken(
        workos_user_id="system:catalog-public-reader",
        session_id="attacker-session",
        claims={"email": "attacker@example.com"},
    )
    with pytest.raises(HTTPException) as exc:
        await get_identity(token, None)
    assert exc.value.status_code == 401
