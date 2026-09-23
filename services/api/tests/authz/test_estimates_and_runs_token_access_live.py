"""The two Phase C routes `leona-mcp`'s acting tools call, against real Postgres.

Proposal 7 Phase C (ai-ops 349, ai-ops 362). `test_token_access.py` proves the POLICY
function in isolation, and `test_every_write_route_is_refused_unless_it_was_deliberately_allowed`
proves it against the live OpenAPI schema — but "the schema has an entry" is not the
same fact as "a real request with a real, minted token gets past the whole auth
dependency chain and reaches the handler". This file proves that for the two routes
this PR's `leona_mcp`/`leona_client` acting tools call: starting a run, and the
`estimate_resources` allowlist widening this PR makes to `token_access.READ_WRITES`.

Uses `httpx.ASGITransport` against the real app, the same pattern
`test_personal_access_tokens_live.py` uses, for the same reason: the auth dependency
chain (`get_verified_token` -> `get_identity` -> `get_scope` -> the route) is the thing
under test, not a hand-written stand-in for it.
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


async def _owner_scope(db, tag: str) -> Scope:
    user, workspace = await system.get_or_provision_user(
        db,
        workos_user_id=f"pat-{tag}-{tag}",
        email=f"{tag}@pat.test",
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


async def test_a_run_scoped_token_can_really_start_a_run(db):
    """The route this PR's `run_verified` MCP tool calls: `POST /v1/runs`. Already
    allowlisted before this PR (`token_access.RUN_WRITES`) — this proves the whole
    chain, not just the policy function, actually lets it through."""
    scope = await _owner_scope(db, "runner")
    token, _row = await tokens_repo.mint(
        scope, db, name="mcp run_verified", scopes=[TokenScope.READ, TokenScope.RUN]
    )

    async with _app_client(db) as client:
        response = await client.post(
            "/v1/runs",
            headers=_auth(token),
            json={"task_prompt": "Build a 2-qubit Bell pair and verify it"},
        )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["task_prompt"] == "Build a 2-qubit Bell pair and verify it"
    assert body["status"] == "queued"
    assert body["user_id"] == str(scope.user_id)
    assert body["workspace_id"] == str(scope.workspace_id)


async def test_a_read_only_token_is_refused_the_run_scope_not_the_route(db):
    """The distinction `run_verified`'s error message depends on: a read-only token
    is refused with INSUFFICIENT_SCOPE (fixable by minting a wider token), not
    FORBIDDEN_ROUTE (which would tell the holder to sign in on the website instead)."""
    scope = await _owner_scope(db, "reader")
    token, _row = await tokens_repo.mint(scope, db, name="read only", scopes=[TokenScope.READ])

    async with _app_client(db) as client:
        response = await client.post(
            "/v1/runs", headers=_auth(token), json={"task_prompt": "Anything"}
        )

    assert response.status_code == 403
    # The API's error middleware answers RFC 7807 Problem+JSON, not a bare
    # `{"detail": ...}` — "reason" sits at the top level, and the refusal text
    # `token_access.check` wrote is under "title", not "detail".
    body = response.json()
    assert body["reason"] == "token_scope_insufficient"
    assert "run scope" in body["title"]


async def test_a_read_only_token_can_now_call_estimate_resources(db):
    """This PR's widening: `POST /v1/estimates/logical` moved into
    `token_access.READ_WRITES`, so a `read`-only token — the same one `run_verified`
    would be refused with above — can reach `estimate_resources`. Proved against the
    real route, which does the actual arithmetic, not a stub."""
    scope = await _owner_scope(db, "estimator")
    token, _row = await tokens_repo.mint(scope, db, name="read only", scopes=[TokenScope.READ])

    async with _app_client(db) as client:
        response = await client.post(
            "/v1/estimates/logical",
            headers=_auth(token),
            json={"points": [{"label": "12 electrons", "logical_qubits": 40, "toffoli_count": 10_000}]},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["points"][0]["label"] == "12 electrons"
    assert body["points"][0]["fastest"] is not None


async def test_with_tokens_switched_off_both_routes_refuse_every_token(db):
    """The kill switch, checked against the two routes this PR touches specifically
    — `MAJORANA_PERSONAL_ACCESS_TOKENS` (off by default everywhere) refuses a token
    before any route or scope check runs at all."""
    scope = await _owner_scope(db, "switched-off")
    token, _row = await tokens_repo.mint(
        scope, db, name="should not work", scopes=[TokenScope.READ, TokenScope.RUN]
    )

    async with _app_client(db, enabled=False) as client:
        run_response = await client.post(
            "/v1/runs", headers=_auth(token), json={"task_prompt": "Anything"}
        )
        estimate_response = await client.post(
            "/v1/estimates/logical",
            headers=_auth(token),
            json={"points": [{"label": "x", "logical_qubits": 4, "toffoli_count": 1}]},
        )

    assert run_response.status_code == 401
    assert estimate_response.status_code == 401


async def test_the_token_value_never_appears_in_a_refusal_response(db):
    scope = await _owner_scope(db, "no-leak")
    token, _row = await tokens_repo.mint(scope, db, name="read only", scopes=[TokenScope.READ])

    async with _app_client(db) as client:
        response = await client.post(
            "/v1/runs", headers=_auth(token), json={"task_prompt": "Anything"}
        )

    assert token not in response.text
