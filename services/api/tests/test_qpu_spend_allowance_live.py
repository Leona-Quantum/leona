"""The weekly hardware spend machinery over real HTTP, against real Postgres.

`test_qpu_spend_allowance.py` proves the arithmetic and the route's shape with
doubles. It cannot prove the thing that was actually broken, because what was
broken was that real requests were accepted: the measurement that produced this
work drove this endpoint with the deployment gate open and a free-tier account,
and got twenty-one 201s worth $96,006.30. So this file drives the endpoint.

**No tier caps hardware spend as of 2026-08-02** — the owner ruled it an
individual user's decision, and submissions move onto the submitting user's own
provider credential. Two consequences for this file:

- The refusal tests stage a ceiling on the tier table, where the route reads it.
  They are about the reservation, the 429 and the SQL sum, all of which are what
  a user-set budget (or a reinstated operator-token ceiling) refuses through.
  Deleting them would leave that path unexercised until the day it matters.
- One test asserts the opposite end to end: the $80,000.30 submission that
  started all of this is accepted now, and its estimate is on the durable row —
  because what the measurement was really about was an amount nobody could see,
  and that half is still enforced.

What is only checkable here:

- **The refusal is a refusal.** A durable `qpu_runs` row and a `qpu.run` job are
  written in one transaction, so a check that raises after the write would leave
  a submission the worker still performs.
- **The sum is the SQL sum**, over rows a previous request committed, not a
  number a double returned.
- **The exclusion selects a real state.** A record that errored before reaching
  the provider is produced by `worker.handlers`, not by this suite's imagination.
- **The lock works**, which takes two connections: one process cannot interleave
  its own read and write, so a burst inside one event loop passes against no
  lock at all.
- **The index is used.** The planner is what silently stops using it.

Committing, and therefore responsible for its own teardown.
"""

import asyncio
import dataclasses
import datetime as dt
import os
import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import QpuRunStatus, Role
from repo_test_helpers import delete_committed_tenants, slot_taken_or_the_reason_why

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import QpuRun, User
from majorana_api.repos import qpu_runs as qpu_runs_repo
from majorana_api.repos import system
from majorana_api.routes import qpu as qpu_routes
from majorana_api.settings import Settings
from majorana_api.tiers import TEAM_PLAN, TIER_LIMITS, TIER_WINDOW

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="the hardware spend allowance needs DATABASE_URL"
)

pytestmark = requires_db

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

FORTE = "braket.ionq.forte"
GARNET = "braket.iqm.garnet"
OPEN_PLAN = "ibm.open_plan"
QASM = 'OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; bit[1] c; h q[0]; c[0] = measure q[0];'

#: The ceiling the refusal tests stage. No tier ships one, so this is a
#: stand-in for the next thing that sets a number here — a budget the user picks
#: for themselves, or the operator ceiling that has to return if customer
#: submissions ever run on a shared operator-owned provider token again.
#:
#: $25 rather than a round $100 because the Garnet arithmetic below is written
#: against it: two 10,000-shot jobs at $14.80 do not both fit, and a 1,000-shot
#: job at $1.75 fits in what is left. A budget these tests derived from the tier
#: table would go back to proving nothing the moment the table says `None`.
STAGED_BUDGET = 25.0

BLOCKED_FOR_S = 1.5


@pytest.fixture
def staged_budget(monkeypatch):
    """Put `STAGED_BUDGET` on every tier, where the route reads it.

    Through `TIER_LIMITS` rather than by calling the reservation with a number,
    because what these tests are for is the path from the tier table to the 429
    — a route that stopped consulting the table would still pass a test that
    handed the repository a limit directly.
    """
    for tier, limits in list(TIER_LIMITS.items()):
        monkeypatch.setitem(
            TIER_LIMITS, tier, dataclasses.replace(limits, qpu_spend_usd_per_week=STAGED_BUDGET)
        )
    return STAGED_BUDGET


@pytest.fixture
def no_billed_hardware(monkeypatch):
    """A $0 ceiling on the free tier: what free carried until 2026-08-02.

    Kept as a fixture rather than deleted with the number, because `0.0` is the
    interesting edge — an account that may submit only what costs nothing — and
    it is the shape a "no paid hardware on this plan" tier would take again.
    """
    monkeypatch.setitem(
        TIER_LIMITS, "free", dataclasses.replace(TIER_LIMITS["free"], qpu_spend_usd_per_week=0.0)
    )
    return 0.0


def _body(device_id: str, shots: int, tag: str = "probe") -> dict:
    return {
        "device_id": device_id,
        "shots": shots,
        "qasm": QASM,
        "source_fingerprint": f"fnv1a-{tag}",
    }


@pytest.fixture(autouse=True)
def open_the_deployment_gate(monkeypatch):
    """Every gate this route consults is deployment-wide, and all of them are
    closed in a test process. Opening them is what puts the account-level
    question — the one this file is about — on the path at all."""
    monkeypatch.setattr(qpu_routes, "submission_block_reason", lambda: None)


async def _provision(session, tag: str, *, plan: str | None = None):
    """A committed account. `plan=None` means whatever a real sign-up gets.

    Not `users.plan = None`: that column is NOT NULL, and writing None over the
    default is a NotNullViolation in the fixture rather than a free-tier
    account. The free case is the DEFAULT case, which is the one worth
    exercising anyway — the account this route was measured accepting $96,006.30
    from had signed up and changed nothing.
    """
    user, workspace = await system.get_or_provision_user(
        session,
        workos_user_id=f"qpuspend-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@qpuspend.test",
        display_name=tag.title(),
    )
    if plan is not None:
        user.plan = plan
    await session.flush()
    return user, workspace


def _client(factory, engine, scope, user, workspace, settings) -> httpx.AsyncClient:
    app = create_app(settings)
    app.state.engine = engine
    app.state.session_factory = factory
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: (
        User(id=user.id, email=user.email, plan=user.plan),
        workspace,
    )
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def account(request):
    """One committed account and a client for it, on the plan the test asks for.

    Committed rather than rolled back: the sums under test are over rows an
    EARLIER request wrote, and a fixture living inside one transaction would
    make every one of them read zero.
    """
    plan = getattr(request, "param", None)
    engine = engine_from_env()
    factory = session_factory(engine)
    settings = Settings(**SETTINGS_KWARGS)
    async with factory() as session:
        user, workspace = await _provision(session, "solo", plan=plan)
        scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)
        await session.commit()
    client = _client(factory, engine, scope, user, workspace, settings)
    try:
        yield client, factory, scope, user
    finally:
        await client.aclose()
        await delete_committed_tenants(factory, [workspace.id], [user.id])
        await engine.dispose()


# ------------------------------------------ the measurement, against a ceiling


@pytest.mark.parametrize("account", [None], indirect=True)
async def test_the_submission_that_cost_eighty_thousand_dollars_is_refused(
    account, no_billed_hardware
):
    """The exact request from the measurement: free tier, IonQ Forte, 1,000,000
    shots, $80,000.30. It was a 201, and against a $0 ceiling it is a 429.

    The ceiling is staged, because no tier carries one any more. What this pins
    is that a number in the tier table still binds real HTTP requests all the
    way down to the durable row — the property a per-user budget depends on.
    """
    client, factory, scope, _user = account
    response = await client.post("/v1/qpu/submissions", json=_body(FORTE, 1_000_000))

    assert response.status_code == 429, response.text
    detail = response.json()
    assert detail["reason"] == "qpu_spend_exhausted"
    assert detail["estimate_usd"] == pytest.approx(80_000.30)
    assert detail["limit_usd"] == 0.0
    assert detail["spent_usd"] == 0.0

    async with factory() as session:
        rows = (
            await session.execute(
                QpuRun.__table__.select().where(QpuRun.workspace_id == scope.workspace_id)
            )
        ).all()
    assert rows == [], "a refused submission wrote a durable attestation row"


@pytest.mark.parametrize("account", [None], indirect=True)
async def test_twenty_submissions_against_a_zero_ceiling_authorize_nothing(
    account, no_billed_hardware
):
    """The other half of the measurement: 20 x 10,000 shots on Forte, every one
    a 201, $16,006.00. Driven as a loop for the same reason it was measured as
    one — the first refusal is the interesting number."""
    client, _factory, _scope, _user = account
    accepted = 0
    for index in range(20):
        response = await client.post(
            "/v1/qpu/submissions", json=_body(FORTE, 10_000, f"burst-{index}")
        )
        if response.status_code != 201:
            break
        accepted += 1
    assert accepted == 0, f"{accepted} billed submissions accepted against a $0 ceiling"


@pytest.mark.parametrize("account", [None], indirect=True)
async def test_the_shipped_tiers_accept_the_measured_submission_and_record_it(account):
    """And with the table exactly as it ships: a 201, and the dollars written down.

    The owner's ruling, end to end — "hardware spend shouldn't have a limit,
    since this is an individual user decision" — on the same request that
    produced the $96,006.30 measurement. No fixture stages a ceiling here on
    purpose: this is the shipped configuration.

    The estimate on the durable row is the assertion that matters beside the
    201. What made that measurement a problem was that the amount existed
    nowhere anybody could look, and this is the row `authorized_spend_since`
    sums for `GET /v1/usage`. The ceiling is gone; the ledger is not.
    """
    client, factory, scope, _user = account
    response = await client.post("/v1/qpu/submissions", json=_body(FORTE, 1_000_000, "uncapped"))

    assert response.status_code == 201, response.text
    assert response.json()["estimated_total_usd"] == pytest.approx(80_000.30)

    async with factory() as session:
        spent = await qpu_runs_repo.authorized_spend_since(
            scope, session, dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
        )
    assert spent == pytest.approx(80_000.30), (
        "the spend was authorized but not recorded, which is the half of the "
        "$96,006.30 measurement that is still a bug"
    )


@pytest.mark.parametrize("account", [None], indirect=True)
async def test_a_free_account_still_reaches_the_free_queue(account, no_billed_hardware):
    """A $0 ceiling is not a hardware ban. IBM's Open Plan carries no per-shot
    price, so its estimate has no total and the submission costs nothing to
    authorize — which is the whole reason this allowance counts dollars rather
    than submissions."""
    client, factory, scope, _user = account
    response = await client.post("/v1/qpu/submissions", json=_body(OPEN_PLAN, 4096))

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["estimated_total_usd"] is None
    assert body["estimate_basis"] == "free_tier_allowance"

    async with factory() as session:
        spent = await qpu_runs_repo.authorized_spend_since(
            scope, session, dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
        )
    assert spent == 0.0, "a free-queue submission spent part of a paid allowance"


# ---------------------------------------------------------- a staged budget


@pytest.mark.parametrize("account", [TEAM_PLAN], indirect=True)
async def test_an_account_spends_a_staged_budget_down_and_is_then_refused(account, staged_budget):
    """Accepted while it fits, refused when it does not, and the sum the refusal
    reports is the sum of what was accepted — not a recount that could differ."""
    client, _factory, _scope, _user = account

    # Garnet: $0.30 per task + $0.00145 per shot. 10,000 shots = $14.80.
    first = await client.post("/v1/qpu/submissions", json=_body(GARNET, 10_000, "one"))
    assert first.status_code == 201, first.text
    assert first.json()["estimated_total_usd"] == pytest.approx(14.80)

    second = await client.post("/v1/qpu/submissions", json=_body(GARNET, 10_000, "two"))
    assert second.status_code == 429, second.text
    detail = second.json()
    assert detail["spent_usd"] == pytest.approx(14.80)
    assert detail["limit_usd"] == pytest.approx(STAGED_BUDGET)
    assert detail["estimate_usd"] == pytest.approx(14.80)

    # And something that DOES fit in the $10.20 remaining is still accepted —
    # the account is not locked out, it is bounded.
    third = await client.post("/v1/qpu/submissions", json=_body(GARNET, 1_000, "three"))
    assert third.status_code == 201, third.text
    assert third.json()["estimated_total_usd"] == pytest.approx(1.75)


@pytest.mark.parametrize("account", [TEAM_PLAN], indirect=True)
async def test_a_submission_that_never_reached_the_provider_does_not_spend(account, staged_budget):
    """`worker.handlers.handle_qpu_run` closes a record as ERROR with
    `submitted_at` still NULL when the deployment gate shuts between enqueue and
    dequeue. Nothing was billed, so nothing is charged — otherwise an operator
    toggling the gate off for ten minutes burns every affected account's week.

    The budget is staged because the last assertion is about a slot being freed,
    and against no ceiling at all "the retry is accepted" is true either way."""
    client, factory, scope, _user = account
    accepted = await client.post("/v1/qpu/submissions", json=_body(GARNET, 10_000, "doomed"))
    assert accepted.status_code == 201, accepted.text
    record_id = uuid.UUID(accepted.json()["id"])

    since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
    async with factory() as session:
        assert await qpu_runs_repo.authorized_spend_since(scope, session, since) == pytest.approx(
            14.80
        )
        await qpu_runs_repo.transition(
            scope,
            session,
            record_id,
            QpuRunStatus.ERROR,
            error="submission gate closed after enqueue: submission_disabled",
        )
        await session.commit()

    async with factory() as session:
        assert await qpu_runs_repo.authorized_spend_since(scope, session, since) == 0.0

    # And the budget it was holding is spendable again.
    again = await client.post("/v1/qpu/submissions", json=_body(GARNET, 10_000, "retry"))
    assert again.status_code == 201, again.text


@pytest.mark.parametrize("account", [TEAM_PLAN], indirect=True)
async def test_a_queued_record_cancelled_before_the_provider_saw_it_does_not_spend(account):
    """The transition nothing produces YET, which is the point.

    `_ALLOWED_TRANSITIONS` permits QUEUED -> CANCELLED and no code path takes
    it, so a predicate written as `status == ERROR` answers this case correctly
    today and would go on answering it correctly right up until somebody adds a
    "cancel my hardware job" route — at which point cancelled submissions that
    never reached a provider would spend a week's budget each, silently. The
    rule is about whether the provider saw it.
    """
    client, factory, scope, _user = account
    accepted = await client.post("/v1/qpu/submissions", json=_body(GARNET, 10_000, "cancelled"))
    assert accepted.status_code == 201, accepted.text
    record_id = uuid.UUID(accepted.json()["id"])

    since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
    async with factory() as session:
        await qpu_runs_repo.transition(scope, session, record_id, QpuRunStatus.CANCELLED)
        await session.commit()

    async with factory() as session:
        record = await qpu_runs_repo.get_record(scope, session, record_id)
        assert record.submitted_at is None, (
            "the fixture staged a submitted record, not a queued one"
        )
        assert await qpu_runs_repo.authorized_spend_since(scope, session, since) == 0.0


@pytest.mark.parametrize("account", [TEAM_PLAN], indirect=True)
async def test_a_record_cancelled_after_submission_still_spends(account):
    """A provider that accepted the job and then cancelled it has still run a
    queue slot against the account. Same side of the predicate as an error after
    submission, and the case that stops the rule above being a blanket refund."""
    client, factory, scope, _user = account
    accepted = await client.post("/v1/qpu/submissions", json=_body(GARNET, 10_000, "late-cancel"))
    assert accepted.status_code == 201, accepted.text
    record_id = uuid.UUID(accepted.json()["id"])

    async with factory() as session:
        await qpu_runs_repo.transition(
            scope,
            session,
            record_id,
            QpuRunStatus.RUNNING,
            provider_job_id="provider-late",
            submitted_at=dt.datetime.now(dt.UTC),
        )
        await qpu_runs_repo.transition(scope, session, record_id, QpuRunStatus.CANCELLED)
        await session.commit()

    async with factory() as session:
        spent = await qpu_runs_repo.authorized_spend_since(
            scope, session, dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
        )
    assert spent == pytest.approx(14.80)


@pytest.mark.parametrize("account", [TEAM_PLAN], indirect=True)
async def test_a_record_that_errored_after_submission_still_spends(account):
    """The other side of the same predicate, and the one that costs money: a
    provider that ran the job and then failed it has billed for the work. A
    blanket "errored rows are free" rule would refund exactly the spend that
    really happened."""
    client, factory, scope, _user = account
    accepted = await client.post("/v1/qpu/submissions", json=_body(GARNET, 10_000, "ran"))
    assert accepted.status_code == 201, accepted.text
    record_id = uuid.UUID(accepted.json()["id"])

    async with factory() as session:
        await qpu_runs_repo.transition(
            scope,
            session,
            record_id,
            QpuRunStatus.RUNNING,
            provider_job_id="provider-abc",
            submitted_at=dt.datetime.now(dt.UTC),
        )
        await qpu_runs_repo.transition(
            scope, session, record_id, QpuRunStatus.ERROR, error="device calibration failed"
        )
        await session.commit()

    async with factory() as session:
        spent = await qpu_runs_repo.authorized_spend_since(
            scope, session, dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
        )
    assert spent == pytest.approx(14.80)


@pytest.mark.parametrize("account", [TEAM_PLAN], indirect=True)
async def test_spend_outside_the_window_is_not_counted(account, staged_budget):
    """The allowance rolls. A job from eight days ago is not this week's money.

    Staged, because the closing assertion is that a fresh job fits once the old
    one ages out — which no ceiling would make true for the wrong reason."""
    client, factory, scope, _user = account
    accepted = await client.post("/v1/qpu/submissions", json=_body(GARNET, 10_000, "old"))
    assert accepted.status_code == 201, accepted.text

    async with factory() as session:
        await session.execute(
            QpuRun.__table__.update()
            .where(QpuRun.workspace_id == scope.workspace_id)
            .values(created_at=dt.datetime.now(dt.UTC) - dt.timedelta(days=8))
        )
        await session.commit()

    async with factory() as session:
        spent = await qpu_runs_repo.authorized_spend_since(
            scope, session, dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
        )
    assert spent == 0.0
    fresh = await client.post("/v1/qpu/submissions", json=_body(GARNET, 10_000, "new"))
    assert fresh.status_code == 201, fresh.text


@pytest.mark.parametrize("account", [TEAM_PLAN], indirect=True)
async def test_another_accounts_spend_is_not_charged_to_this_one(account, staged_budget):
    """Per USER. A sum missing its identity predicate reads plausibly and
    charges strangers for each other's hardware."""
    client, factory, scope, _user = account
    async with factory() as session:
        other_user, other_workspace = await _provision(session, "stranger", plan=TEAM_PLAN)
        other_scope = Scope(user_id=other_user.id, workspace_id=other_workspace.id, role=Role.OWNER)
        # Written through the repository rather than over HTTP: what is under
        # test is which rows the SUM selects, and a second ASGI client would
        # only be a slower way to insert the same row.
        await qpu_runs_repo.create_record(
            other_scope,
            session,
            device_id=GARNET,
            provider="braket",
            shots=10_000,
            qasm=QASM,
            source_fingerprint="fnv1a-stranger",
            estimate_basis="vendor_rate_card",
            estimated_total_usd=14.80,
            rate_source="https://aws.amazon.com/braket/pricing/",
            rate_confirmed_on="2026-07-23",
        )
        await session.commit()

    # `finally`, not a trailing statement: a failing assertion below would
    # otherwise leave this stranger's workspace in the shared database, and
    # `delete_committed_tenants` documents what that does to suites that never
    # mention sharing — CI runs every live suite in ONE invocation against ONE
    # database, so a test that fails must not also break its neighbours.
    try:
        async with factory() as session:
            spent = await qpu_runs_repo.authorized_spend_since(
                scope, session, dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
            )
        assert spent == 0.0
        mine = await client.post("/v1/qpu/submissions", json=_body(GARNET, 10_000, "mine"))
        assert mine.status_code == 201, mine.text
    finally:
        await delete_committed_tenants(factory, [other_workspace.id], [other_user.id])


@pytest.mark.parametrize("account", [TEAM_PLAN], indirect=True)
async def test_a_second_workspace_of_the_same_account_spends_the_same_budget(
    account, staged_budget
):
    """Per USER, and this is the case a workspace predicate would miss entirely.

    A bill follows the account. One person owning two tenants is an ordinary
    thing here — the tier table budgets for up to ten of them — and a sum keyed
    on `workspace_id` would give that person a fresh hardware budget per
    workspace while reading perfectly plausibly.
    """
    client, factory, scope, user = account
    async with factory() as session:
        second, _membership = await system.create_team_workspace(
            session,
            owner=await session.get(User, user.id),
            name="Second Tenant",
            owned_workspace_limit=None,
        )
        second_id = second.id
        second_scope = Scope(user_id=user.id, workspace_id=second_id, role=Role.OWNER)
        await qpu_runs_repo.create_record(
            second_scope,
            session,
            device_id=GARNET,
            provider="braket",
            shots=10_000,
            qasm=QASM,
            source_fingerprint="fnv1a-second",
            estimate_basis="vendor_rate_card",
            estimated_total_usd=14.80,
            rate_source="https://aws.amazon.com/braket/pricing/",
            rate_confirmed_on="2026-07-23",
        )
        await session.commit()

    try:
        async with factory() as session:
            spent = await qpu_runs_repo.authorized_spend_since(
                scope, session, dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
            )
        assert spent == pytest.approx(14.80), (
            "spend from the account's other workspace was invisible to its budget"
        )
        # $14.80 of a $25 budget is gone, so a second $14.80 job does not fit —
        # asserted through the route, because the route is what a person meets.
        refused = await client.post("/v1/qpu/submissions", json=_body(GARNET, 10_000, "first-ws"))
        assert refused.status_code == 429, refused.text
    finally:
        await delete_committed_tenants(factory, [second_id], [])


# ------------------------------------------------------ the at-most-once claim


@pytest.mark.parametrize("account", [TEAM_PLAN], indirect=True)
async def test_only_one_caller_can_claim_a_submission_attempt(account):
    """The claim is a fenced UPDATE, not a read-then-write.

    `worker.handlers.handle_qpu_run` stamps this before it contacts the provider
    so that a redelivered job cannot contact them twice — and two workers can
    hold the same job at the boundary of a lease expiry, which is exactly when
    the second one must lose. Checked against real Postgres rather than against
    the handler's double: the guarantee is in the WHERE clause, and a double
    that returns True twice would make the handler's own tests agree with a
    version of this function that has no guarantee at all.
    """
    client, factory, scope, _user = account
    accepted = await client.post("/v1/qpu/submissions", json=_body(GARNET, 1_000, "claimed"))
    assert accepted.status_code == 201, accepted.text
    record_id = uuid.UUID(accepted.json()["id"])

    async with factory() as session:
        first = await qpu_runs_repo.claim_submission_attempt(scope, session, record_id)
        await session.commit()
    async with factory() as session:
        second = await qpu_runs_repo.claim_submission_attempt(scope, session, record_id)
        await session.commit()

    assert first is True
    assert second is False, "two callers both claimed the right to contact the provider"

    async with factory() as session:
        record = await qpu_runs_repo.get_record(scope, session, record_id)
    assert record.submitted_at is not None
    assert record.status == QpuRunStatus.QUEUED.value, (
        "the claim must not move the record's status; the provider has not answered yet"
    )


@pytest.mark.parametrize("account", [TEAM_PLAN], indirect=True)
async def test_a_claimed_submission_spends_even_if_it_never_confirms(account):
    """The pessimistic direction, stated as a test.

    Once the claim is stamped the request may have reached the provider, so the
    account is charged whether or not it confirmed. The alternative — refunding
    anything unconfirmed — bills the operator for jobs nobody is tracking, and
    no later reconciliation gets that money back.
    """
    client, factory, scope, _user = account
    accepted = await client.post("/v1/qpu/submissions", json=_body(GARNET, 10_000, "unconfirmed"))
    assert accepted.status_code == 201, accepted.text
    record_id = uuid.UUID(accepted.json()["id"])

    async with factory() as session:
        assert await qpu_runs_repo.claim_submission_attempt(scope, session, record_id)
        await qpu_runs_repo.transition(
            scope,
            session,
            record_id,
            QpuRunStatus.ERROR,
            error="a submission for this record was already attempted and did not confirm",
        )
        await session.commit()

    async with factory() as session:
        spent = await qpu_runs_repo.authorized_spend_since(
            scope, session, dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
        )
    assert spent == pytest.approx(14.80), (
        "a submission that may have reached the provider was refunded"
    )


@pytest.mark.parametrize("account", [TEAM_PLAN], indirect=True)
async def test_a_claim_cannot_reach_another_tenants_record(account):
    """Workspace-scoped like every write in this layer: an id from outside the
    scope matches zero rows and reads back False, the same answer as a record
    that never existed."""
    client, factory, scope, user = account
    accepted = await client.post("/v1/qpu/submissions", json=_body(GARNET, 1_000, "mine-only"))
    assert accepted.status_code == 201, accepted.text
    record_id = uuid.UUID(accepted.json()["id"])

    async with factory() as session:
        stranger, stranger_workspace = await _provision(session, "outsider", plan=TEAM_PLAN)
        await session.commit()
    stranger_scope = Scope(user_id=stranger.id, workspace_id=stranger_workspace.id, role=Role.OWNER)
    try:
        async with factory() as session:
            assert not await qpu_runs_repo.claim_submission_attempt(
                stranger_scope, session, record_id
            )
            await session.commit()
        async with factory() as session:
            record = await qpu_runs_repo.get_record(scope, session, record_id)
        assert record.submitted_at is None
    finally:
        await delete_committed_tenants(factory, [stranger_workspace.id], [stranger.id])


# ---------------------------------------------------------------------- the lock


@pytest.mark.asyncio
async def test_the_last_dollars_cannot_be_spent_twice_by_two_connections():
    """Two connections, because one cannot show this.

    A burst inside a single event loop runs each request's read and write to
    completion before starting the next, so eight concurrent submissions pass
    against no lock at all — the mistake `reserve_artifact_slot` records having
    made. The API autoscales; two real requests are two processes.

    Removing `with_for_update()` from `reserve_qpu_spend_slot` fails this with
    caller B reporting a reservation it should not have got.

    Calls the reservation directly with `STAGED_BUDGET`, so it needs no tier to
    carry a ceiling: the lock is the property under test, and it is the property
    a user-set budget will depend on the day one exists.
    """
    assert STAGED_BUDGET > 0
    engine = engine_from_env()
    factory = session_factory(engine)

    async with factory() as session:
        user, workspace = await _provision(session, "race", plan=TEAM_PLAN)
        scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)
        await session.commit()

    # Fill the budget to exactly one dollar remaining, so both callers below are
    # racing for the same last dollar rather than for room neither needs.
    staged = round(STAGED_BUDGET - 1.0, 6)
    async with factory() as session:
        await qpu_runs_repo.create_record(
            scope,
            session,
            device_id=GARNET,
            provider="braket",
            shots=1,
            qasm=QASM,
            source_fingerprint="fnv1a-fill",
            estimate_basis="vendor_rate_card",
            estimated_total_usd=staged,
            rate_source="https://aws.amazon.com/braket/pricing/",
            rate_confirmed_on="2026-07-23",
        )
        await session.commit()

    since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
    async with factory() as session:
        assert await qpu_runs_repo.authorized_spend_since(scope, session, since) == pytest.approx(
            staged
        ), "the two callers below would not be racing for the last dollar"

    a_has_the_slot = asyncio.Event()
    b_outcome: list[object] = []

    async def caller_a() -> None:
        async with factory() as session:
            await qpu_runs_repo.reserve_qpu_spend_slot(scope, session, since, STAGED_BUDGET, 1.0)
            a_has_the_slot.set()
            # Hold the transaction open so B has to wait on the row rather than
            # merely arriving after A committed.
            await asyncio.sleep(BLOCKED_FOR_S)
            await qpu_runs_repo.create_record(
                scope,
                session,
                device_id=GARNET,
                provider="braket",
                shots=1,
                qasm=QASM,
                source_fingerprint="fnv1a-a",
                estimate_basis="vendor_rate_card",
                estimated_total_usd=1.0,
                rate_source="https://aws.amazon.com/braket/pricing/",
                rate_confirmed_on="2026-07-23",
            )
            await session.commit()

    async def caller_b() -> None:
        await slot_taken_or_the_reason_why(a_has_the_slot, task_a)
        async with factory() as session:
            try:
                await qpu_runs_repo.reserve_qpu_spend_slot(
                    scope, session, since, STAGED_BUDGET, 1.0
                )
                b_outcome.append("reserved")
            except qpu_runs_repo.QpuSpendReached as reached:
                b_outcome.append(reached)

    task_a = asyncio.create_task(caller_a())
    task_b = asyncio.create_task(caller_b())

    # The gather is INSIDE the try. A racer that raises — the failure mode this
    # whole test exists to provoke — would otherwise skip the teardown entirely
    # and leave its committed rows for the next suite in CI's single invocation.
    try:
        await asyncio.gather(task_a, task_b)
        assert len(b_outcome) == 1
        assert isinstance(b_outcome[0], qpu_runs_repo.QpuSpendReached), (
            "the second caller reserved the same last dollar the first one did — "
            "the account row was not held across the read and the write"
        )
        assert b_outcome[0].spent == pytest.approx(STAGED_BUDGET)
    finally:
        await delete_committed_tenants(factory, [workspace.id], [user.id])
        await engine.dispose()


# --------------------------------------------------------------------- the index


@pytest.mark.parametrize("account", [TEAM_PLAN], indirect=True)
async def test_the_allowance_sum_rides_its_index(account):
    """Migration 0044 exists for this statement and nothing else.

    Asserted against the statement the repository builds, not a copy of the SQL:
    a copy keeps passing while a refactor of the predicates drops the real query
    back to the sequential scan the index was added to remove.
    """
    from sqlalchemy import text
    from sqlalchemy.dialects import postgresql

    _client, factory, scope, _user = account
    stmt = qpu_runs_repo.authorized_spend_stmt(
        scope, dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
    )
    sql = str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    async with factory() as session:
        # A tiny table is sequentially scanned whatever the index says.
        await session.execute(text("set local enable_seqscan = off"))
        plan = "\n".join(row[0] for row in (await session.execute(text("EXPLAIN " + sql))).all())

    assert "ix_qpu_runs_user_created" in plan, plan
