"""A `hardware`-scoped personal access token against real Postgres (ai-ops 376).

`test_token_access.py::test_a_hardware_token_may_submit_but_neither_a_read_nor_a_run_
only_token_may` proves the POLICY function in isolation. This file proves the same
property `test_estimates_and_runs_token_access_live.py` proves for `run`: that a real
request, with a real minted token, gets past the WHOLE auth dependency chain
(`get_verified_token` -> `get_identity` -> `get_scope` -> the route) and reaches the
handler — and, specific to hardware, two things a scope check alone cannot prove:

- **The weekly hardware spend allowance applies to a token exactly as it applies to a
  browser session**, because both authenticate into the same `Scope` and the same
  handler runs either way — `reserve_qpu_spend_slot` has no branch on how the caller
  authenticated. Proved by staging an identical ceiling and firing an identical
  request through each of the two paths and comparing the refusal.
- **A token-initiated submission is recorded as such**, on the existing `audit_log`
  table, where a browser-initiated one is not — the fact `routes/qpu.py::qpu_submit`'s
  own docstring names as the reason this file's `audit` tests exist at all: without
  it, `qpu_runs.user_id` is identical either way and the two are indistinguishable.

Uses the `db` fixture (`authz/conftest.py`), which rolls back per test, and the
`_app_client` pattern from `test_estimates_and_runs_token_access_live.py`: sequential
requests inside one test share the same open transaction, so a later request sees an
earlier one's writes without either being committed.
"""

from __future__ import annotations

import contextlib

import httpx
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_contracts.tokens import TokenScope
from matrix_helpers import requires_db

from majorana_api.app import create_app
from majorana_api.repos import audit as audit_repo
from majorana_api.repos import personal_access_tokens as tokens_repo
from majorana_api.repos import system
from majorana_api.routes import qpu as qpu_routes
from majorana_api.settings import Settings

pytestmark = requires_db

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

FORTE = "braket.ionq.forte"
OPEN_PLAN = "ibm.open_plan"
QASM = 'OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; bit[1] c; h q[0]; c[0] = measure q[0];'

#: Mirrors `test_qpu_spend_allowance_live.py`'s own staged ceiling: small enough that
#: a single Forte submission of any real size does not fit, so the refusal this file
#: is about (the allowance, not the credential or deployment gate) is what fires.
STAGED_BUDGET = 5.0


def _body(device_id: str, shots: int, tag: str) -> dict:
    return {
        "device_id": device_id,
        "shots": shots,
        "qasm": QASM,
        "source_fingerprint": f"hw-token-live-{tag}",
    }


async def _owner_scope(db, tag: str) -> Scope:
    user, workspace = await system.get_or_provision_user(
        db,
        workos_user_id=f"hwtok-{tag}-{tag}",
        email=f"{tag}@hwtok.test",
        display_name=tag.title(),
    )
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)


def _app_client(db, *, scope: Scope | None = None, user=None, workspace=None) -> httpx.AsyncClient:
    """A real ASGI client over the real app.

    `scope`/`user`/`workspace` given: a BROWSER session (dependency-overridden, the
    same shape `test_qpu_spend_allowance_live.py::_client` uses). Omitted: a client
    that resolves auth the real way — `get_session`/`auth_session_factory` point at
    THIS test's already-open `db` session, so a personal access token minted on it in
    the same test is visible to the lookup a `Bearer lq_pat_...` header triggers.
    """
    from majorana_api.auth import deps as auth_deps
    from majorana_api.orm import User

    app = create_app(Settings(**{**SETTINGS_KWARGS, "personal_access_tokens_enabled": True}))
    app.dependency_overrides[auth_deps.get_session] = lambda: db

    @contextlib.asynccontextmanager
    async def _fixture_session():
        yield db

    app.state.auth_session_factory = lambda: _fixture_session()
    if scope is not None:
        app.dependency_overrides[auth_deps.get_scope] = lambda: scope
        app.dependency_overrides[auth_deps.get_identity] = lambda: (
            User(id=user.id, email=user.email, plan=user.plan),
            workspace,
        )
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _browser_scope_and_identity(db, tag: str):
    """A committed-shaped user/workspace pair for the dependency-override path.

    `test_qpu_spend_allowance_live.py`'s `_client` reads `user.plan`/`user.email` off
    a real ORM row when building the override identity, so this mirrors that rather
    than constructing a lighter stand-in that could silently diverge from what a
    browser session's `get_identity` actually returns.
    """
    from majorana_api.orm import User

    user, workspace = await system.get_or_provision_user(
        db,
        workos_user_id=f"hwtok-browser-{tag}",
        email=f"{tag}@hwtok-browser.test",
        display_name=tag.title(),
    )
    scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)
    full_user = await db.get(User, user.id)
    return scope, full_user, workspace


async def _open_every_gate(monkeypatch) -> None:
    """Every gate in front of the spend check, opened — the same fixture
    `test_qpu_spend_allowance_live.py` uses, inlined here as a function (not an
    autouse fixture) so it is applied identically to both the token and the browser
    client built inside one test, rather than once per test function."""

    import majorana_qpu.models as qpu_models

    async def connected(scope, session) -> bool:
        return True

    monkeypatch.setattr(qpu_routes, "submission_block_reason", lambda **_: None)
    monkeypatch.setattr(qpu_routes, "_caller_can_submit", connected)
    # FORTE has no submit adapter in this deployment's default routing (only IBM
    # does today); `test_qpu_spend_allowance_live.py` opens the same gate for the
    # identical reason — this file is about the SPEND ceiling and the audit trail,
    # not about provider routing, which has its own coverage in
    # `test_qpu_routes.py`.
    monkeypatch.setattr(qpu_models, "SUBMITTABLE_PROVIDERS", frozenset(qpu_models.QpuProviderKey))


async def test_a_hardware_token_over_the_weekly_allowance_is_refused_the_same_way_a_browser_is(
    db, monkeypatch
):
    """The core claim: the allowance and every gate in front of it apply to a
    token-authenticated submission exactly as they apply to a browser one, because
    both reach the identical handler through the identical `Scope`.

    Two DIFFERENT accounts (a token cannot be minted for the browser's own scope
    without also giving that account a live session to compare against, and two
    independent accounts is the stronger proof anyway: nothing about EITHER
    account's identity is what produces the refusal, only the ceiling and the
    estimate are). Same staged ceiling, same device, same shot count, same QASM —
    and the refusal is byte-for-byte the same reason, at the same numbers, through
    both paths.
    """
    import dataclasses

    from majorana_api.tiers import TIER_LIMITS

    await _open_every_gate(monkeypatch)
    for tier, limits in list(TIER_LIMITS.items()):
        monkeypatch.setitem(
            TIER_LIMITS, tier, dataclasses.replace(limits, qpu_spend_usd_per_week=STAGED_BUDGET)
        )

    token_scope = await _owner_scope(db, "hwspend")
    token, _row = await tokens_repo.mint(
        token_scope, db, name="hardware", scopes=[TokenScope.READ, TokenScope.HARDWARE]
    )
    browser_scope, browser_user, browser_workspace = await _browser_scope_and_identity(
        db, "hwspend"
    )

    async with _app_client(db) as token_client:
        token_response = await token_client.post(
            "/v1/qpu/submissions",
            headers=_auth(token),
            json=_body(FORTE, 10_000, "token"),
        )
    async with _app_client(
        db, scope=browser_scope, user=browser_user, workspace=browser_workspace
    ) as browser_client:
        browser_response = await browser_client.post(
            "/v1/qpu/submissions", json=_body(FORTE, 10_000, "browser")
        )

    assert token_response.status_code == 429, token_response.text
    assert browser_response.status_code == 429, browser_response.text
    token_body = token_response.json()
    browser_body = browser_response.json()
    assert token_body["reason"] == browser_body["reason"] == "qpu_spend_exhausted"
    assert token_body["limit_usd"] == browser_body["limit_usd"] == STAGED_BUDGET
    assert token_body["spent_usd"] == browser_body["spent_usd"] == 0.0
    assert token_body["estimate_usd"] == browser_body["estimate_usd"]


async def test_a_hardware_token_can_really_submit_to_the_free_queue(db, monkeypatch):
    """Sanity for the allowed side, over real HTTP: `test_token_access.py` proves the
    policy function says yes; this proves the whole chain actually lets the request
    through and writes the durable row, the way `test_estimates_and_runs_token_
    access_live.py::test_a_run_scoped_token_can_really_start_a_run` does for `run`."""
    await _open_every_gate(monkeypatch)
    scope = await _owner_scope(db, "hwfree")
    token, _row = await tokens_repo.mint(
        scope, db, name="hardware", scopes=[TokenScope.READ, TokenScope.HARDWARE]
    )

    async with _app_client(db) as client:
        response = await client.post(
            "/v1/qpu/submissions",
            headers=_auth(token),
            json=_body(OPEN_PLAN, 4096, "free"),
        )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["device_id"] == OPEN_PLAN
    assert body["user_id"] == str(scope.user_id)


async def test_a_run_only_token_is_refused_hardware_submission_with_insufficient_scope(
    db, monkeypatch
):
    """The chain-level twin of `test_token_access.py`'s pure-policy check: a token
    that can already start Leona's own verified runs is refused here with
    INSUFFICIENT_SCOPE, not FORBIDDEN_ROUTE — fixable by minting a token with
    `hardware`, not by signing in on the website, which is what FORBIDDEN_ROUTE
    would tell the holder instead."""
    await _open_every_gate(monkeypatch)
    scope = await _owner_scope(db, "hwrunonly")
    token, _row = await tokens_repo.mint(
        scope, db, name="run only", scopes=[TokenScope.READ, TokenScope.RUN]
    )

    async with _app_client(db) as client:
        response = await client.post(
            "/v1/qpu/submissions",
            headers=_auth(token),
            json=_body(OPEN_PLAN, 4096, "run-only"),
        )

    assert response.status_code == 403
    body = response.json()
    assert body["reason"] == "token_scope_insufficient"


async def test_a_token_initiated_submission_is_recorded_and_a_browser_one_is_not(db, monkeypatch):
    """What `routes/qpu.py::qpu_submit`'s docstring calls the one fact `qpu_runs`
    cannot record about itself. Both submissions land in the SAME workspace/user (the
    browser override reuses the token's own owner), so the only thing that
    distinguishes the two rows is which one carries an audit entry — proving the
    write is keyed on "a token was presented", not on which account made the call.
    """
    await _open_every_gate(monkeypatch)
    scope = await _owner_scope(db, "hwaudit")
    token, _row = await tokens_repo.mint(
        scope, db, name="hardware", scopes=[TokenScope.READ, TokenScope.HARDWARE]
    )
    from majorana_api.orm import User

    full_user = await db.get(User, scope.user_id)
    from majorana_api.repos import system as system_repo

    workspace_row = await system_repo.find_live_workspace(db, workspace_id=scope.workspace_id)

    async with _app_client(db) as token_client:
        token_response = await token_client.post(
            "/v1/qpu/submissions",
            headers=_auth(token),
            json=_body(OPEN_PLAN, 4096, "audit-token"),
        )
    async with _app_client(
        db, scope=scope, user=full_user, workspace=workspace_row
    ) as browser_client:
        browser_response = await browser_client.post(
            "/v1/qpu/submissions", json=_body(OPEN_PLAN, 4096, "audit-browser")
        )

    assert token_response.status_code == 201, token_response.text
    assert browser_response.status_code == 201, browser_response.text
    token_run_id = token_response.json()["id"]
    browser_run_id = browser_response.json()["id"]

    rows = await audit_repo.list_audit(scope, db)
    by_target = {str(row.target_id): row for row in rows if row.target_kind == "qpu_run"}

    assert token_run_id in by_target, "the token-initiated submission wrote no audit row"
    assert by_target[token_run_id].action == "qpu.submission.created"
    assert by_target[token_run_id].meta == {"token_id": str(_row.id)}

    assert browser_run_id not in by_target, (
        "a browser-initiated submission wrote an audit row — it should not, since a "
        "browser session needs no token id to be distinguishable"
    )
