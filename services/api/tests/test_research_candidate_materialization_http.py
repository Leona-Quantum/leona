"""HTTP authentication boundary for Phase 9 research materialization."""

import uuid

import httpx
import pytest

from majorana_api.app import create_app
from majorana_api.auth.deps import get_session
from majorana_api.settings import Settings


@pytest.mark.anyio
async def test_materialization_route_refuses_anonymous_callers_before_database_use():
    settings = Settings(
        workos_client_id="client_test",
        workos_jwt_issuer="https://api.workos.com/user_management/client_test",
        workos_jwks_url="https://api.workos.com/sso/jwks/client_test",
        web_origin="https://web.invalid",
        environment="production",
    )
    app = create_app(settings)

    async def _no_db():
        yield None

    app.dependency_overrides[get_session] = _no_db
    envelope_id = uuid.uuid4()
    review_id = uuid.uuid4()
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            f"/v1/vqe/research-candidates/{envelope_id}/reviews/{review_id}/materialize",
            headers={"Idempotency-Key": "anonymous-materialization-must-fail"},
            json={
                "expected_review_sha256": "a" * 64,
                "expected_reviewed_candidate_sha256": "b" * 64,
                "expected_evidence_bundle_sha256": "c" * 64,
            },
        )

    assert response.status_code == 401
    assert response.json() == {
        "type": "about:blank",
        "title": "missing bearer token",
        "status": 401,
        "code": "http_error",
    }
