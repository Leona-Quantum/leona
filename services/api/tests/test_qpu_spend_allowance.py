"""The weekly hardware spend machinery, without a database.

`POST /v1/qpu/submissions` computed a dollar estimate, wrote it onto the durable
row, and compared it to nothing. Measured over real HTTP against the live schema
with the deployment gate opened, by a FREE-tier account: twenty 10,000-shot
submissions to IonQ Forte accepted for $16,006.00, then one 1,000,000-shot
submission accepted for $80,000.30. $96,006.30 in twenty-one requests, from an
account that is refused its sixth *simulator* run of the week.

Every gate that route consulted — `MAJORANA_QPU_SUBMIT_ENABLED`, the provider
token, the provider dependency — is deployment-wide. Each answers "may this
DEPLOYMENT submit"; none answers "may this ACCOUNT spend".

**No tier sets a ceiling as of 2026-08-02.** The owner ruled hardware spend an
individual user's decision, and the companion change on
`feature/byo-ibm-credentials` puts submissions on the user's own provider
credential, which is what makes that safe. So the tier-table section below pins
the opposite of what it used to: that nothing is capped, and that a cap
reintroduced by accident fails a test.

The reservation, the 429 and the three-number sentence are NOT gone and are not
untested here. They are what a user-set budget will refuse through, and they are
what has to come back if a shared operator-owned token ever returns. Every test
that covers them now stages an explicit limit — through the tier table where the
route reads it, so the wiring under test is still the real wiring.

The lock's *effect* needs two connections and lives in
`test_qpu_spend_allowance_live.py`.
"""

import dataclasses
import datetime as dt
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from repo_test_helpers import LockOnlySession, empty_tier_sources, make_scope

from majorana_api.repos import qpu_runs as qpu_runs_repo
from majorana_api.routes import qpu as qpu_routes
from majorana_api.routes.qpu import QpuSubmissionRequest
from majorana_api.tiers import ACCOUNT_TIERS, TIER_LIMITS, limits_for

#: The most expensive device on the rate card, which is where an unbounded
#: route costs the most: $0.30 per task plus $0.08 per shot.
FORTE = "braket.ionq.forte"
#: The free-queue device. Its estimate carries no total at all.
OPEN_PLAN = "ibm.open_plan"

QASM = 'OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; bit[1] c; h q[0]; c[0] = measure q[0];'


def _submission(device_id: str = FORTE, shots: int = 128) -> QpuSubmissionRequest:
    return QpuSubmissionRequest(
        device_id=device_id,
        shots=shots,
        qasm=QASM,
        source_fingerprint="fnv1a-deadbeef",
    )


def _identity(plan: str):
    return (SimpleNamespace(email=f"{plan}@spend.test", plan=plan), object())


def _sources():
    return empty_tier_sources()


def _since() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)


#: A ceiling staged for the tests that cover the refusal path. Deliberately not
#: a number any tier carries: it is a stand-in for a limit somebody sets later —
#: a per-user budget, or the ceiling that has to return if customer submissions
#: ever run on an operator-owned token again — not a value this table ships.
STAGED_LIMIT_USD = 25.0


def _stage_a_ceiling(monkeypatch, tier: str, limit: float) -> None:
    """Put a hardware ceiling on one tier, where the ROUTE reads it.

    Through `TIER_LIMITS` rather than by passing a number to the reservation,
    because the thing worth keeping covered is the whole path: the route reads
    the tier's limit, hands it to the reservation, and turns the exception into
    the 429 a user reads. A test that called the repository directly would still
    pass with the route hardcoding `None`.
    """
    monkeypatch.setitem(
        TIER_LIMITS, tier, dataclasses.replace(TIER_LIMITS[tier], qpu_spend_usd_per_week=limit)
    )


# ---------------------------------------------------------------- the tier table


def test_every_tier_states_a_hardware_spend_number():
    """A tier added without one is a tier that never states its position.

    `TierLimits` is a frozen dataclass with no default on this field, so this
    cannot fail at runtime — it can only fail by somebody adding a default. The
    assertion is that the field is never optional, which is the shape the four
    limits before it already have and the reason none of them was the one that
    shipped unbounded. It matters more now that the shipped value is `None`
    everywhere: a default would let a tier be added that says nothing about
    spend and reads exactly like the four that say "no ceiling, deliberately".
    """
    for tier in ACCOUNT_TIERS:
        limits = TIER_LIMITS[tier]
        assert hasattr(limits, "qpu_spend_usd_per_week")
        assert limits.qpu_spend_usd_per_week is None or limits.qpu_spend_usd_per_week >= 0.0


def test_the_shipped_tier_table_caps_nobody():
    """The owner's ruling, as an assertion: "hardware spend shouldn't have a
    limit, since this is an individual user decision."

    Every tier, not just the free one that was measured — a ceiling
    reintroduced on any single tier fails here, which is the point. This is the
    test that has to be deleted deliberately if the decision is ever reversed,
    and the field's own comment states the one condition that would reverse it:
    customer submissions running on an operator-owned provider token again.
    """
    capped = {
        tier: TIER_LIMITS[tier].qpu_spend_usd_per_week
        for tier in ACCOUNT_TIERS
        if TIER_LIMITS[tier].qpu_spend_usd_per_week is not None
    }
    assert capped == {}, (
        f"these tiers cap hardware spend: {capped}. The owner ruled it an "
        "individual user's decision, and submissions run on the user's own "
        "provider credential."
    )


def test_the_ledger_and_the_reservation_survive_the_ceiling():
    """Removing the limit must not remove the machinery that reports the spend.

    `$96,006.30` was authorized because the amount existed nowhere anybody could
    look, not merely because nothing refused it. These four are what make it
    visible and what a user-set budget would refuse through, so a change that
    deleted them along with the number would take away the recovery as well as
    the cap.
    """
    assert callable(qpu_runs_repo.reserve_qpu_spend_slot)
    assert callable(qpu_runs_repo.authorized_spend_since)
    assert issubclass(qpu_runs_repo.QpuSpendReached, Exception)
    assert callable(qpu_routes.qpu_spend_refusal)


# ------------------------------------------------------------- the reservation


async def test_an_unmetered_tier_takes_no_lock():
    """`limit is None` returns before touching the session at all."""
    session = LockOnlySession()
    await qpu_runs_repo.reserve_qpu_spend_slot(make_scope(), session, _since(), None, 12.34)
    assert session.statements == []


async def test_a_free_queue_submission_takes_no_lock():
    """A zero estimate cannot carry any account over any ceiling.

    This is the path a FREE account takes for every hardware submission it is
    allowed to make — its ceiling is `0.0`, so a zero-cost job is the only kind
    that fits. Serializing it behind a per-account row lock would put every free
    hardware submission on the platform through one exclusive lock.
    """
    session = LockOnlySession()
    await qpu_runs_repo.reserve_qpu_spend_slot(make_scope(), session, _since(), 0.0, 0.0)
    assert session.statements == []


async def test_a_metered_submission_locks_the_account_row_before_counting(monkeypatch):
    """The lock is taken, and it is taken BEFORE the sum is read.

    A reservation that counted first and locked second would be the read-then-
    write shape every other cap in this layer exists to close.
    """
    order: list[str] = []

    class Recording(LockOnlySession):
        async def execute(self, statement, *args, **kwargs):
            order.append("lock")
            return await super().execute(statement, *args, **kwargs)

    async def fake_spend(scope, session, since):
        order.append("count")
        return 0.0

    monkeypatch.setattr(qpu_runs_repo, "authorized_spend_since", fake_spend)
    await qpu_runs_repo.reserve_qpu_spend_slot(make_scope(), Recording(), _since(), 100.0, 1.0)
    assert order == ["lock", "count"]


@pytest.mark.parametrize(
    ("spent", "estimate", "limit", "fits"),
    [
        # An empty allowance admits a submission that exactly equals it. This is
        # the case `spent >= limit` — the shape every other reservation here
        # uses — would refuse, and it is the ordinary one: the first job of the
        # week that happens to cost the whole budget.
        (0.0, 25.0, 25.0, True),
        (0.0, 25.000001, 25.0, False),
        (24.0, 1.0, 25.0, True),
        (24.0, 1.5, 25.0, False),
        (25.0, 0.01, 25.0, False),
        # Already over — a ceiling lowered after the fact, or a tier moved down.
        # A limit gates the NEXT write; it is never an invariant over rows
        # already written.
        (400.0, 0.01, 25.0, False),
    ],
)
async def test_a_submission_is_admitted_when_it_fits_not_when_the_budget_is_untouched(
    monkeypatch, spent, estimate, limit, fits
):
    async def fake_spend(scope, session, since):
        return spent

    monkeypatch.setattr(qpu_runs_repo, "authorized_spend_since", fake_spend)

    async def reserve():
        await qpu_runs_repo.reserve_qpu_spend_slot(
            make_scope(), LockOnlySession(), _since(), limit, estimate
        )

    if fits:
        await reserve()
    else:
        with pytest.raises(qpu_runs_repo.QpuSpendReached):
            await reserve()


async def test_float_noise_never_refuses_a_submission_that_exactly_fits(monkeypatch):
    """Six cents of a rate card, summed, must not exceed a limit it equals.

    0.1 + 0.2 is 0.30000000000000004 in IEEE 754, so a limit of 0.3 refuses a
    submission that costs exactly what is left. The rate card rounds to six
    places and so does the comparison.
    """

    async def fake_spend(scope, session, since):
        return 0.1

    monkeypatch.setattr(qpu_runs_repo, "authorized_spend_since", fake_spend)
    await qpu_runs_repo.reserve_qpu_spend_slot(make_scope(), LockOnlySession(), _since(), 0.3, 0.2)


async def test_the_refusal_carries_all_three_numbers(monkeypatch):
    async def fake_spend(scope, session, since):
        return 20.0

    monkeypatch.setattr(qpu_runs_repo, "authorized_spend_since", fake_spend)
    with pytest.raises(qpu_runs_repo.QpuSpendReached) as excinfo:
        await qpu_runs_repo.reserve_qpu_spend_slot(
            make_scope(), LockOnlySession(), _since(), 25.0, 80_000.30
        )
    assert excinfo.value.spent == 20.0
    assert excinfo.value.limit == 25.0
    assert excinfo.value.estimate == 80_000.30


# -------------------------------------------------------------------- the route


def _open_the_gate(monkeypatch):
    monkeypatch.setattr(qpu_routes, "submission_block_reason", lambda: None)


async def _fake_create_record(scope_arg, session_arg, **kwargs):
    """The durable row, echoing back what the route decided to write on it.

    Echoing rather than returning a fixed shape: the estimate the route
    snapshots is the number `GET /v1/usage` later sums, so a double that
    invented its own would hide a route that wrote the wrong one.
    """
    return SimpleNamespace(
        id=make_scope().workspace_id,
        workspace_id=make_scope().workspace_id,
        user_id=make_scope().user_id,
        artifact_version_id=None,
        provider=kwargs["provider"],
        device_id=kwargs["device_id"],
        provider_job_id=None,
        shots=kwargs["shots"],
        status="queued",
        source_fingerprint=kwargs["source_fingerprint"],
        estimate_basis=kwargs["estimate_basis"],
        estimated_total_usd=kwargs["estimated_total_usd"],
        rate_source=kwargs["rate_source"],
        rate_confirmed_on=kwargs["rate_confirmed_on"],
        raw_counts=None,
        error=None,
        submitted_at=None,
        completed_at=None,
        created_at=dt.datetime.now(dt.UTC),
    )


async def _fake_enqueue_job(*args, **kwargs):
    return None


async def test_a_ceiling_turns_the_measured_submission_into_a_429(monkeypatch):
    """The exact request that was accepted for $80,000.30, against a ceiling.

    No tier carries one today, so this stages `STAGED_LIMIT_USD` on the free
    tier — which is what a per-user budget will do, and what reinstating an
    operator-token ceiling would do. What is under test is everything between
    the tier table and the sentence a user reads: the route reads the limit,
    passes it to the reservation, and renders all three numbers.
    """
    _open_the_gate(monkeypatch)
    _stage_a_ceiling(monkeypatch, "free", STAGED_LIMIT_USD)
    reserved: list[tuple] = []

    async def fake_reserve(scope, session, since, limit, estimate):
        reserved.append((limit, estimate))
        raise qpu_runs_repo.QpuSpendReached(0.0, limit, estimate)

    monkeypatch.setattr(qpu_runs_repo, "reserve_qpu_spend_slot", fake_reserve)

    with pytest.raises(HTTPException) as excinfo:
        await qpu_routes.qpu_submit(
            _submission(FORTE, shots=1_000_000),
            scope=make_scope(),
            session=object(),
            identity=_identity("free"),
            settings=_sources(),
        )
    assert excinfo.value.status_code == 429
    assert excinfo.value.detail["reason"] == "qpu_spend_exhausted"
    assert excinfo.value.detail["estimate_usd"] == pytest.approx(80_000.30)
    assert excinfo.value.detail["limit_usd"] == pytest.approx(STAGED_LIMIT_USD)
    assert excinfo.value.detail["spent_usd"] == 0.0
    # The sentence has to name the money; "too many requests" is unactionable
    # for a limit denominated in dollars. All three numbers, because the user's
    # next move depends on which of them is the problem.
    assert "$80,000.30" in excinfo.value.detail["error"]
    assert "$25.00" in excinfo.value.detail["error"]
    assert "$0.00" in excinfo.value.detail["error"]
    assert reserved == [(STAGED_LIMIT_USD, pytest.approx(80_000.30))]


async def test_the_shipped_tiers_accept_that_submission_because_nothing_caps_it(monkeypatch):
    """And the same request with the table as it ships: nothing to compare to.

    The other half of the ruling, asserted where a user meets it rather than in
    the tier table. `None` reaches the reservation, which returns without
    reading anything, and the submission is written like any other.
    """
    _open_the_gate(monkeypatch)
    reserved: list[tuple] = []

    async def fake_reserve(scope, session, since, limit, estimate):
        reserved.append((limit, estimate))

    monkeypatch.setattr(qpu_runs_repo, "reserve_qpu_spend_slot", fake_reserve)
    monkeypatch.setattr(qpu_routes.qpu_runs_repo, "create_record", _fake_create_record)
    monkeypatch.setattr(qpu_routes.system, "enqueue_job", _fake_enqueue_job)

    result = await qpu_routes.qpu_submit(
        _submission(FORTE, shots=1_000_000),
        scope=make_scope(),
        session=object(),
        identity=_identity("free"),
        settings=_sources(),
    )
    assert result.status.value == "queued"
    assert reserved == [(None, pytest.approx(80_000.30))]
    # And the estimate is still snapshotted onto the row. The dollars are not
    # refused, but they are recorded — that is what `GET /v1/usage` reports and
    # what a budget the user sets would later be measured against.
    assert result.estimated_total_usd == pytest.approx(80_000.30)


async def test_nothing_is_written_when_the_submission_is_refused(monkeypatch):
    """No durable row, no job. The refusal is not an attestation of anything."""
    _open_the_gate(monkeypatch)
    _stage_a_ceiling(monkeypatch, "free", STAGED_LIMIT_USD)
    wrote: list[str] = []

    async def fake_reserve(scope, session, since, limit, estimate):
        raise qpu_runs_repo.QpuSpendReached(0.0, limit, estimate)

    async def fake_create_record(*args, **kwargs):
        wrote.append("record")

    async def fake_enqueue_job(*args, **kwargs):
        wrote.append("job")

    monkeypatch.setattr(qpu_runs_repo, "reserve_qpu_spend_slot", fake_reserve)
    monkeypatch.setattr(qpu_routes.qpu_runs_repo, "create_record", fake_create_record)
    monkeypatch.setattr(qpu_routes.system, "enqueue_job", fake_enqueue_job)

    with pytest.raises(HTTPException):
        await qpu_routes.qpu_submit(
            _submission(),
            scope=make_scope(),
            session=object(),
            identity=_identity("free"),
            settings=_sources(),
        )
    assert wrote == []


@pytest.mark.parametrize("plan", ["free", "pro", "team", "developer"])
async def test_the_route_passes_the_tier_number_and_not_a_constant(monkeypatch, plan):
    """Audited by signature, not by value: whatever the tier table says for this
    plan is what reaches the reservation. A route that hardcoded any single
    number would pass for one tier and silently meter the others wrongly.

    Load-bearing now that the table says `None` everywhere: this is what proves
    the route still READS the table rather than having been simplified to pass
    `None` itself, which would look identical today and ignore the ceiling the
    day one comes back. `_stage_a_ceiling` on one tier is the other half — a
    route passing a constant fails there.
    """
    _open_the_gate(monkeypatch)
    _stage_a_ceiling(monkeypatch, "team", STAGED_LIMIT_USD)
    seen: list[float | None] = []

    async def fake_reserve(scope, session, since, limit, estimate):
        seen.append(limit)
        raise qpu_runs_repo.QpuSpendReached(0.0, limit or 0.0, estimate)

    monkeypatch.setattr(qpu_runs_repo, "reserve_qpu_spend_slot", fake_reserve)
    with pytest.raises(HTTPException):
        await qpu_routes.qpu_submit(
            _submission(),
            scope=make_scope(),
            session=object(),
            identity=_identity(plan),
            settings=_sources(),
        )
    assert seen == [limits_for(plan).qpu_spend_usd_per_week]


async def test_the_window_the_route_reserves_against_is_the_tier_window(monkeypatch):
    """One window, shared with the run allowance.

    A second copy of "seven days" is a second thing to drift, and the direction
    it drifts in is a user reading "your budget returns Tuesday" on a surface
    that refuses them until Thursday.
    """
    from majorana_api.tiers import TIER_WINDOW

    _open_the_gate(monkeypatch)
    _stage_a_ceiling(monkeypatch, "free", STAGED_LIMIT_USD)
    seen: list[dt.datetime] = []

    async def fake_reserve(scope, session, since, limit, estimate):
        seen.append(since)
        raise qpu_runs_repo.QpuSpendReached(0.0, limit or 0.0, estimate)

    monkeypatch.setattr(qpu_runs_repo, "reserve_qpu_spend_slot", fake_reserve)
    with pytest.raises(HTTPException):
        await qpu_routes.qpu_submit(
            _submission(),
            scope=make_scope(),
            session=object(),
            identity=_identity("free"),
            settings=_sources(),
        )
    expected = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
    assert abs((seen[0] - expected).total_seconds()) < 5


async def test_a_free_account_still_reaches_the_free_queue(monkeypatch):
    """The point of metering dollars rather than submissions.

    IBM's Open Plan is an included allowance, not per-shot billing, so its
    estimate carries no total — `estimate.total_usd or 0.0` is zero and the
    reservation returns before it compares anything. A free account's hardware
    access survived its $0 ceiling, which a submission COUNT would have taken
    away; the ceiling staged here is what makes that still checkable now that
    the shipped table has none.
    """
    _open_the_gate(monkeypatch)
    _stage_a_ceiling(monkeypatch, "free", 0.0)
    estimates: list[float] = []

    async def fake_reserve(scope, session, since, limit, estimate):
        estimates.append(estimate)

    monkeypatch.setattr(qpu_runs_repo, "reserve_qpu_spend_slot", fake_reserve)
    monkeypatch.setattr(qpu_routes.qpu_runs_repo, "create_record", _fake_create_record)
    monkeypatch.setattr(qpu_routes.system, "enqueue_job", _fake_enqueue_job)

    result = await qpu_routes.qpu_submit(
        _submission(OPEN_PLAN, shots=4096),
        scope=make_scope(),
        session=object(),
        identity=_identity("free"),
        settings=_sources(),
    )
    assert result.status.value == "queued"
    assert result.estimated_total_usd is None
    assert estimates == [0.0]


async def test_the_deployment_gate_is_read_before_the_account_is_charged(monkeypatch):
    """A closed deployment is not the account's problem.

    Telling somebody their week's hardware budget is spent, when nothing in this
    deployment could have submitted anything to begin with, points them at the
    wrong thing entirely.
    """
    monkeypatch.delenv("MAJORANA_QPU_SUBMIT_ENABLED", raising=False)
    reached: list[str] = []

    async def fake_reserve(*args, **kwargs):
        reached.append("reserved")

    monkeypatch.setattr(qpu_runs_repo, "reserve_qpu_spend_slot", fake_reserve)
    with pytest.raises(HTTPException) as excinfo:
        await qpu_routes.qpu_submit(
            _submission(),
            scope=make_scope(),
            session=object(),
            identity=_identity("free"),
            settings=_sources(),
        )
    assert excinfo.value.status_code == 409
    assert reached == []
