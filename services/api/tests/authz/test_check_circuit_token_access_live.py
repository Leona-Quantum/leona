"""`POST /v1/checks/circuit` with real, minted tokens against real Postgres.

The agent connector's `check_circuit` (ai-ops 382 option 1). `test_check_circuit_route.py`
proves the same outcomes with the token path's two database reads stubbed, which is what
runs on a developer machine; this file proves them with nothing stubbed, the pattern
`test_estimates_and_runs_token_access_live.py` uses: `httpx.ASGITransport` against the
real app, so `get_verified_token` -> `token_access.check` -> `get_identity` ->
`get_scope` -> the route is the thing under test.
"""

from __future__ import annotations

import contextlib

import httpx
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_contracts.tokens import TokenScope
from matrix_helpers import requires_db

from majorana_api.app import create_app
from majorana_api.repos import personal_access_tokens as tokens_repo
from majorana_api.repos import system
from majorana_api.settings import Settings

pytestmark = requires_db

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

BELL = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nh q[0];\ncx q[0], q[1];\n'
BODY = {"qasm": BELL, "property": {"kind": "state", "subject": "circuit", "reference": "bell"}}


async def _owner_scope(db, tag: str) -> Scope:
    user, workspace = await system.get_or_provision_user(
        db,
        workos_user_id=f"check-{tag}-{tag}",
        email=f"{tag}@check.test",
        display_name=tag.title(),
    )
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)


@contextlib.asynccontextmanager
async def _fixture_session(db):
    yield db


def _app_client(db, *, enabled: bool = True) -> httpx.AsyncClient:
    from majorana_api.auth import deps as auth_deps

    app = create_app(Settings(**{**SETTINGS_KWARGS, "personal_access_tokens_enabled": enabled}))
    app.dependency_overrides[auth_deps.get_session] = lambda: db
    app.state.auth_session_factory = lambda: _fixture_session(db)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_a_run_scoped_token_gets_a_verdict_with_teeth(db):
    scope = await _owner_scope(db, "checker")
    token, _row = await tokens_repo.mint(
        scope, db, name="mcp check_circuit", scopes=[TokenScope.READ, TokenScope.RUN]
    )
    async with _app_client(db) as client:
        response = await client.post("/v1/checks/circuit", headers=_auth(token), json=BODY)
    assert response.status_code == 200, response.text
    verdict = response.json()["verdict"]
    assert verdict["status"] == "pass"
    assert verdict["teeth"]["status"] == "measured"


async def test_a_read_only_token_is_refused_the_run_scope_not_the_route(db):
    scope = await _owner_scope(db, "check-reader")
    token, _row = await tokens_repo.mint(scope, db, name="read only", scopes=[TokenScope.READ])
    async with _app_client(db) as client:
        response = await client.post("/v1/checks/circuit", headers=_auth(token), json=BODY)
    assert response.status_code == 403
    body = response.json()
    assert body["reason"] == "token_scope_insufficient"
    assert "run scope" in body["title"]
    assert token not in response.text


async def test_with_tokens_switched_off_a_check_is_refused_like_every_other_route(db):
    scope = await _owner_scope(db, "check-switched-off")
    token, _row = await tokens_repo.mint(
        scope, db, name="should not work", scopes=[TokenScope.READ, TokenScope.RUN]
    )
    async with _app_client(db, enabled=False) as client:
        response = await client.post("/v1/checks/circuit", headers=_auth(token), json=BODY)
    assert response.status_code == 401
