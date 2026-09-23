""" "Call a published Qapp as an API" (ai-ops 349 option 2), against real Postgres.

Same reasoning as `test_estimates_and_runs_token_access_live.py`: `test_token_access.py`
proves the policy function in isolation, but a real request with a real, minted token
still has to get past the whole auth dependency chain
(`get_verified_token` -> `get_identity` -> `get_scope` -> `execute_qapp`) and reach the
handler. This file proves that for `POST /v1/qapps/{slug}/executions` and
`GET /v1/qapps/executions/{execution_id}` — the exact routes a signed-in browser
session already reaches from the Qapp's own page (ADR-0031's sandboxed execution),
now opened to a `run`-scoped personal access token.

No worker runs in this suite, so an execution this file starts never leaves `queued` —
the same limitation `test_a_run_scoped_token_can_really_start_a_run` accepts for
`POST /v1/runs` in the sibling file. What is proved here is that the request reaches
the real handler with the real authz and the real spend ceilings, not that the sandbox
itself produces a result; `services/worker/tests/test_qapp_handlers.py` covers the
worker side, unchanged by this PR.
"""

from __future__ import annotations

import contextlib
import uuid

import httpx
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_contracts.tokens import TokenScope
from matrix_helpers import requires_db

from majorana_api.app import create_app
from majorana_api.qapp_examples import EXAMPLES_REVISION, examples_by_key
from majorana_api.repos import personal_access_tokens as tokens_repo
from majorana_api.repos import qapps as qapps_repo
from majorana_api.repos import system
from majorana_api.settings import Settings

pytestmark = requires_db

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

BELL_PAIR = examples_by_key()["bell_pair"]


async def _owner_scope(db, tag: str) -> Scope:
    """A fresh user every call, `uuid.uuid4()` and all — never `f"...{tag}-{tag}"`.

    The PAT auth path this file exercises (`get_verified_token`'s personal-access-
    token branch) commits the request's session for real, on the SAME `db` object
    the `db` fixture otherwise rolls back — see that branch's own comment on why
    resolution has to commit. A deterministic id would make `test_the_per_account_
    ceiling_counts_a_tokens_calls_same_as_a_browsers` count executions a PRIOR run
    of this suite left behind against this container, rather than only the ones
    this run made; `test_qapp_ownership_live.py`'s fixtures use the same uuid4
    discipline for the same reason.
    """
    user, workspace = await system.get_or_provision_user(
        db,
        workos_user_id=f"qapp-api-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@qapp-api.test",
    )
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)


async def _copy_bell_pair(db, scope: Scope, *, tag: str):
    qapp, version, _created = await qapps_repo.create_from_example(
        scope,
        db,
        idempotency_key=f"qapp-api-{tag}",
        example_key=BELL_PAIR.key,
        example_revision=EXAMPLES_REVISION,
        title=BELL_PAIR.title,
        description=BELL_PAIR.description,
        framework=BELL_PAIR.framework,
        qubits_estimate=BELL_PAIR.qubits_estimate,
        ui_document=BELL_PAIR.ui_document,
        quantum_source=BELL_PAIR.quantum_source,
        input_schema=BELL_PAIR.input_schema,
        output_schema=BELL_PAIR.output_schema,
    )
    return qapp, version


async def _publish(db, scope: Scope, qapp, version):
    """The ADR-0031 gate: one successful sandbox run before publication. Driven
    through the repository layer, not the HTTP route under test, so a failure in
    THAT route cannot make its own fixture look broken."""
    execution = await qapps_repo.create_execution(scope, db, qapp=qapp, version=version, inputs={})
    await qapps_repo.finish_execution(
        scope, db, execution.id, result={"ok": True}, error_code=None, sandbox_meta=None
    )
    return await qapps_repo.set_visibility(scope, db, qapp.id, "public")


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


async def test_a_run_scoped_token_can_really_call_a_published_qapp(db):
    """The route `run_qapp` (packages/py/client, leona-mcp) calls:
    `POST /v1/qapps/{slug}/executions`. Proves the whole auth dependency chain lets
    a `run`-scoped token reach it, and that the counted inputs and the caller's own
    identity land on the created execution row exactly as they would for a browser."""
    owner = await _owner_scope(db, "runner")
    qapp, _version = await _copy_bell_pair(db, owner, tag="runner")
    await _publish(db, owner, qapp, _version)
    token, _row = await tokens_repo.mint(
        owner, db, name="mcp run_qapp", scopes=[TokenScope.READ, TokenScope.RUN]
    )

    async with _app_client(db) as client:
        response = await client.post(
            f"/v1/qapps/{qapp.slug}/executions",
            headers=_auth(token),
            json={"inputs": {"state": "phi_plus", "basis": "Z", "shots": 256}},
        )

    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "queued"
    assert body["qapp_id"] == str(qapp.id)
    assert body["inputs"] == {"state": "phi_plus", "basis": "Z", "shots": 256}

    async with _app_client(db) as client:
        read_back = await client.get(f"/v1/qapps/executions/{body['id']}", headers=_auth(token))
    assert read_back.status_code == 200, read_back.text
    assert read_back.json()["id"] == body["id"]


async def test_a_read_only_token_is_refused_the_run_scope_not_the_route(db):
    """Same distinction the sibling file pins for `/runs`: INSUFFICIENT_SCOPE (mint a
    wider token), never FORBIDDEN_ROUTE (which would wrongly say tokens can never
    reach this at all)."""
    owner = await _owner_scope(db, "reader")
    qapp, version = await _copy_bell_pair(db, owner, tag="reader")
    await _publish(db, owner, qapp, version)
    token, _row = await tokens_repo.mint(owner, db, name="read only", scopes=[TokenScope.READ])

    async with _app_client(db) as client:
        response = await client.post(
            f"/v1/qapps/{qapp.slug}/executions", headers=_auth(token), json={"inputs": {}}
        )

    assert response.status_code == 403
    body = response.json()
    assert body["reason"] == "token_scope_insufficient"
    assert "run scope" in body["title"]


async def test_a_strangers_private_qapp_is_404_not_403(db):
    """The authz shape the plan calls out explicitly: an unpublished/private Qapp is
    NOT FOUND for anyone but its owner — a token is not a way around `_accessible`,
    it is just a different way of presenting the same scope. Distinguishing 404 from
    403 matters: 403 would confirm the slug exists and is someone else's."""
    owner = await _owner_scope(db, "private-owner")
    qapp, _version = await _copy_bell_pair(db, owner, tag="private-owner")
    # Never published.
    stranger = await _owner_scope(db, "private-stranger")
    token, _row = await tokens_repo.mint(
        stranger, db, name="stranger token", scopes=[TokenScope.READ, TokenScope.RUN]
    )

    async with _app_client(db) as client:
        response = await client.post(
            f"/v1/qapps/{qapp.slug}/executions", headers=_auth(token), json={"inputs": {}}
        )

    assert response.status_code == 404


async def test_a_strangers_token_can_call_someone_elses_published_qapp(db):
    """The control for the test above: the SAME stranger, against the SAME owner's
    Qapp, is let through once it is published — proving the 404 above is really
    about publication and not e.g. a bug that refuses every cross-tenant token."""
    owner = await _owner_scope(db, "public-owner")
    qapp, version = await _copy_bell_pair(db, owner, tag="public-owner")
    await _publish(db, owner, qapp, version)
    stranger = await _owner_scope(db, "public-stranger")
    token, _row = await tokens_repo.mint(
        stranger, db, name="stranger token", scopes=[TokenScope.READ, TokenScope.RUN]
    )

    async with _app_client(db) as client:
        response = await client.post(
            f"/v1/qapps/{qapp.slug}/executions",
            headers=_auth(token),
            json={"inputs": {"state": "phi_plus", "basis": "Z", "shots": 100}},
        )

    assert response.status_code == 202, response.text
    # Recorded under the CALLER's own identity, never the Qapp owner's — this is
    # what makes the spend ceilings below actually bound the caller who ran it.
    assert response.json()["result"] is None


async def test_inputs_that_violate_the_qapps_own_schema_are_422(db):
    """Input validation against the Qapp's declared schema, not skipped for a token
    caller: `shots` must be an integer (bell_pair's own `_SHOTS` schema); a string
    is otherwise a complete, valid-shaped submission, so this isolates the type
    check rather than tripping over a missing required field."""
    owner = await _owner_scope(db, "invalid-owner")
    qapp, version = await _copy_bell_pair(db, owner, tag="invalid-owner")
    await _publish(db, owner, qapp, version)
    token, _row = await tokens_repo.mint(
        owner, db, name="runner", scopes=[TokenScope.READ, TokenScope.RUN]
    )

    async with _app_client(db) as client:
        response = await client.post(
            f"/v1/qapps/{qapp.slug}/executions",
            headers=_auth(token),
            json={"inputs": {"state": "phi_plus", "basis": "Z", "shots": "not-a-number"}},
        )

    assert response.status_code == 422, response.text


async def test_the_per_account_ceiling_counts_a_tokens_calls_same_as_a_browsers(db, monkeypatch):
    """ "It counts against the caller's run allowance exactly as a website run
    does" (the plan's own words): the per-account backstop
    (`QAPP_EXECUTION_BACKSTOP_PER_HOUR`) is keyed on `scope.user_id`, which a token
    resolves to its OWNER's id — so a token cannot spend a separate budget from
    the same person's browser session. Proved by exhausting a ceiling through the
    token path, then confirming the next call is refused.

    The ceiling is set to 2, not 1: `_publish` already spent one execution (the
    ADR-0031 smoke run) under this same `owner.user_id` before either HTTP call
    below, so a ceiling of 1 would refuse the FIRST token call too and this test
    would pass for the wrong reason — a fixture cost mistaken for the token's own.
    """
    import majorana_api.routes.qapps as qapps_route

    owner = await _owner_scope(db, "ceiling-owner")
    qapp, version = await _copy_bell_pair(db, owner, tag="ceiling-owner")
    await _publish(db, owner, qapp, version)  # spends 1 of the account's ceiling already
    token, _row = await tokens_repo.mint(
        owner, db, name="runner", scopes=[TokenScope.READ, TokenScope.RUN]
    )
    monkeypatch.setattr(qapps_route, "QAPP_EXECUTION_BACKSTOP_PER_HOUR", 2)
    valid_inputs = {"inputs": {"state": "phi_plus", "basis": "Z", "shots": 100}}

    async with _app_client(db) as client:
        first = await client.post(
            f"/v1/qapps/{qapp.slug}/executions", headers=_auth(token), json=valid_inputs
        )
        second = await client.post(
            f"/v1/qapps/{qapp.slug}/executions", headers=_auth(token), json=valid_inputs
        )

    assert first.status_code == 202, first.text
    assert second.status_code == 429, second.text


async def test_with_tokens_switched_off_the_qapp_route_refuses_every_token(db):
    """The kill switch (`MAJORANA_PERSONAL_ACCESS_TOKENS`, off by default) refuses a
    token before the route or scope check runs at all — checked for this route
    specifically, the same way the sibling file checks it for `/runs` and
    `/estimates/logical`."""
    owner = await _owner_scope(db, "switched-off")
    qapp, version = await _copy_bell_pair(db, owner, tag="switched-off")
    await _publish(db, owner, qapp, version)
    token, _row = await tokens_repo.mint(
        owner, db, name="should not work", scopes=[TokenScope.READ, TokenScope.RUN]
    )

    async with _app_client(db, enabled=False) as client:
        response = await client.post(
            f"/v1/qapps/{qapp.slug}/executions", headers=_auth(token), json={"inputs": {}}
        )

    assert response.status_code == 401


async def test_the_token_value_never_appears_in_a_refusal_response(db):
    owner = await _owner_scope(db, "no-leak")
    qapp, _version = await _copy_bell_pair(db, owner, tag="no-leak")
    # Never published — refused as not-found, which is the response we check here.
    token, _row = await tokens_repo.mint(owner, db, name="read only", scopes=[TokenScope.READ])

    async with _app_client(db) as client:
        response = await client.post(
            f"/v1/qapps/{qapp.slug}/executions", headers=_auth(token), json={"inputs": {}}
        )

    assert token not in response.text
