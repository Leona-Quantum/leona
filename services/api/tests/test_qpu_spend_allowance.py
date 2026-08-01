"""The weekly hardware spend allowance, without a database.

`POST /v1/qpu/submissions` computed a dollar estimate, wrote it onto the durable
row, and compared it to nothing. Measured over real HTTP against the live schema
with the deployment gate opened, by a FREE-tier account: twenty 10,000-shot
submissions to IonQ Forte accepted for $16,006.00, then one 1,000,000-shot
submission accepted for $80,000.30. $96,006.30 in twenty-one requests, from an
account that is refused its sixth *simulator* run of the week.

Every gate that route consulted — `MAJORANA_QPU_SUBMIT_ENABLED`, the provider
token, the provider dependency — is deployment-wide. Each answers "may this
DEPLOYMENT submit"; none answers "may this ACCOUNT spend".

What is checkable here: the tier table carries the number, the reservation
compares the right way round, the route passes the tier's number rather than a
constant, and a free account keeps the free queue. The lock's *effect* needs two
connections and lives in `test_qpu_spend_allowance_live.py`.
"""

import datetime as dt
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from repo_test_helpers import LockOnlySession, make_scope

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
    return SimpleNamespace(developer_emails=frozenset(), team_emails=frozenset())


def _since() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)


# ---------------------------------------------------------------- the tier table


def test_every_tier_states_a_hardware_spend_number():
    """A tier added without one is a tier with no ceiling on provider spend.

    `TierLimits` is a frozen dataclass with no default on this field, so this
    cannot fail at runtime — it can only fail by somebody adding a default. The
    assertion is that the field is never optional, which is the shape the four
    limits before it already have and the reason none of them was the one that
    shipped unbounded.
    """
    for tier in ACCOUNT_TIERS:
        limits = TIER_LIMITS[tier]
        assert hasattr(limits, "qpu_spend_usd_per_week")
        assert limits.qpu_spend_usd_per_week is None or limits.qpu_spend_usd_per_week >= 0.0


def test_free_authorizes_no_billed_hardware_and_developer_is_unmetered():
    """The two numbers that are not preferences.

    Free's `0.0` is what stops an account that has paid nothing from spending on
    the operator's provider account, and it is compatible with free hardware
    access because a free-queue submission costs `0.0` to make. Developer's
    `None` is the operator, who is not a customer.

    Team's number is deliberately NOT pinned here: it is a chosen figure that
    should move when billing exists, and a test that pins it would make raising
    it look like breaking something.
    """
    assert limits_for("free").qpu_spend_usd_per_week == 0.0
    assert limits_for("developer").qpu_spend_usd_per_week is None
    assert limits_for("team").qpu_spend_usd_per_week is not None


def test_a_paid_tier_is_not_more_restricted_than_free():
    """Monotonic in the direction the product sells. Cheap, and it has teeth: the
    limits are written out per tier rather than derived, so a transposed pair of
    literals is a one-character mistake that nothing else would catch."""
    free = limits_for("free").qpu_spend_usd_per_week
    team = limits_for("team").qpu_spend_usd_per_week
    assert free is not None and team is not None
    assert team >= free


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


async def test_the_route_refuses_a_free_account_the_submission_that_was_measured(monkeypatch):
    """The exact request that was accepted for $80,000.30, now a 429."""
    _open_the_gate(monkeypatch)
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
    assert excinfo.value.detail["limit_usd"] == 0.0
    # The sentence has to name the money; "too many requests" is unactionable
    # for a limit denominated in dollars.
    assert "$80,000.30" in excinfo.value.detail["error"]
    assert reserved == [(0.0, pytest.approx(80_000.30))]


async def test_nothing_is_written_when_the_submission_is_refused(monkeypatch):
    """No durable row, no job. The refusal is not an attestation of anything."""
    _open_the_gate(monkeypatch)
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


@pytest.mark.parametrize("plan", ["free", "team", "developer"])
async def test_the_route_passes_the_tier_number_and_not_a_constant(monkeypatch, plan):
    """Audited by signature, not by value: whatever the tier table says for this
    plan is what reaches the reservation. A route that hardcoded any single
    number would pass for one tier and silently meter the other two wrongly."""
    _open_the_gate(monkeypatch)
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
    access survives its $0 ceiling, which a submission COUNT would have taken
    away.
    """
    _open_the_gate(monkeypatch)
    estimates: list[float] = []

    async def fake_reserve(scope, session, since, limit, estimate):
        estimates.append(estimate)

    async def fake_create_record(scope_arg, session_arg, **kwargs):
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

    async def fake_enqueue_job(*args, **kwargs):
        return None

    monkeypatch.setattr(qpu_runs_repo, "reserve_qpu_spend_slot", fake_reserve)
    monkeypatch.setattr(qpu_routes.qpu_runs_repo, "create_record", fake_create_record)
    monkeypatch.setattr(qpu_routes.system, "enqueue_job", fake_enqueue_job)

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
