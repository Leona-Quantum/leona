"""The local development token still goes through the API auth dependency."""

import pytest
from fastapi import HTTPException

from majorana_api.auth.deps import get_verified_token
from majorana_api.settings import Settings


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
    token = await get_verified_token(local_settings, "Bearer majorana-local-dev")
    assert token.workos_user_id == "local-dev-user"
    assert token.claims["email"] == "local-dev@majorana.test"


async def test_local_dev_token_still_fails_closed(local_settings: Settings):
    with pytest.raises(HTTPException) as exc:
        await get_verified_token(local_settings, "Bearer wrong-token")
    assert exc.value.status_code == 401
