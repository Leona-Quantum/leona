"""Durable qpu_run records — the attestation row a hardware job lives in.

Every mutation is workspace-scoped and status transitions are validated here,
not by callers: a record that has reached a terminal state never changes
again, and raw provider counts are written exactly once, with the transition
that completes the record.

This module also owns the weekly hardware SPEND allowance, because the number
it compares against lives on these rows and nowhere else.
"""

import datetime as dt
import uuid
from typing import Any

from majorana_contracts import Scope
from majorana_contracts.enums import QpuRunStatus
from sqlalchemy import and_, func, not_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import QpuRun, User
from ._base import require_write

_TERMINAL = {QpuRunStatus.DONE, QpuRunStatus.ERROR, QpuRunStatus.CANCELLED}

_ALLOWED_TRANSITIONS: dict[QpuRunStatus, set[QpuRunStatus]] = {
    QpuRunStatus.QUEUED: {QpuRunStatus.RUNNING, QpuRunStatus.ERROR, QpuRunStatus.CANCELLED},
    QpuRunStatus.RUNNING: {QpuRunStatus.DONE, QpuRunStatus.ERROR, QpuRunStatus.CANCELLED},
}


class QpuSpendReached(Exception):
    """This submission does not fit in what is left of the weekly spend allowance.

    Carries all three numbers because the refusal a user reads names them: what
    the submission would cost, what has already been authorized, and the ceiling.
    A caller that had to recount to build that sentence would be reading outside
    the lock that made the numbers true.
    """

    def __init__(self, spent: float, limit: float, estimate: float) -> None:
        super().__init__(
            f"${estimate:,.2f} does not fit in ${limit:,.2f} with ${spent:,.2f} already authorized"
        )
        self.spent = spent
        self.limit = limit
        self.estimate = estimate


def _authorized_spend(scope: Scope, since: dt.datetime):
    """The rows that spend the weekly hardware allowance. ONE definition.

    Written once for the same reason `runs._spends_the_weekly_allowance` is: the
    gate refuses on this predicate and any surface that reports "you have $X
    left" has to select the same rows, or the product refuses a submission on a
    screen that had just said it would fit.

    Per USER, not per workspace. A provider bill follows the account, and two
    submissions from two workspaces of the same account are exactly the case a
    workspace predicate would miss.

    ## The one exclusion, and why it is about a fact rather than a status

    A record that CLOSED without ever being handed to the provider —
    `submitted_at IS NULL` and terminal — cost nothing anywhere. That is a real
    state with real producers in `worker.handlers`: the deployment gate closing
    between enqueue and dequeue, a payload the handler cannot parse, and a
    dead-lettered job chain. Charging for those would mean an operator toggling
    the gate off for ten minutes burns every affected account's week, which is a
    refusal the user cannot act on and cannot understand.

    The predicate names `_TERMINAL` rather than ERROR alone, and that is the
    difference between a rule that is right and a rule that is right by
    accident. Every never-submitted record in the product today closes as ERROR,
    so `status == ERROR` gave the same answer — but `_ALLOWED_TRANSITIONS`
    permits QUEUED -> CANCELLED, so the first "cancel my hardware job" route
    ever added would produce records that never reached a provider and went on
    spending a week's budget, with nothing failing. What makes a submission cost
    money is that it reached the provider, not which word closed it.

    Everything else counts, including a record that errored or was cancelled
    AFTER submission. The provider bills for work it did, so a job that ran and
    then failed is money spent; and at the moment of the check a QUEUED record
    has not been billed either, but it is about to be, so treating "not yet
    billed" as "free" would let a burst of pending submissions authorize the
    same dollars twice.
    """
    return (
        QpuRun.user_id == scope.user_id,
        QpuRun.created_at >= since,
        not_(
            and_(
                QpuRun.submitted_at.is_(None),
                QpuRun.status.in_([status.value for status in _TERMINAL]),
            )
        ),
    )


def authorized_spend_stmt(scope: Scope, since: dt.datetime):
    """The allowance sum as a statement, so a test can EXPLAIN this exact one.

    Split out rather than restated in the test, for the reason
    `runs.execute_allowance_stmt` gives: this query runs on every hardware
    submission and `ix_qpu_runs_user_created` (migration 0044) exists solely to
    serve it. A refactor that changed the predicates would silently drop back to
    the sequential scan the index was added to remove, and a test carrying its
    own copy of the SQL would keep passing while it happened.
    """
    return select(func.coalesce(func.sum(QpuRun.estimated_total_usd), 0)).where(
        *_authorized_spend(scope, since)
    )


async def authorized_spend_since(scope: Scope, session: AsyncSession, since: dt.datetime) -> float:
    """Dollars this account has authorized in the window, as a float.

    `estimated_total_usd` is `Numeric`, so the driver hands back a `Decimal` and
    every arithmetic comparison against the rate card — which computes in floats
    and rounds to six places — would raise `TypeError` at the boundary. Converted
    here, once, rather than at each call site.
    """
    total = (await session.execute(authorized_spend_stmt(scope, since))).scalar_one()
    return float(total if total is not None else 0.0)


#: Money is compared at six decimal places, which is where `pricing.estimate`
#: rounds. Without it a sum of floats can land a fraction of a millionth of a
#: cent above a limit it exactly equals, and refuse a submission that fits.
_USD_PLACES = 6


async def reserve_qpu_spend_slot(
    scope: Scope,
    session: AsyncSession,
    since: dt.datetime,
    limit: float | None,
    estimate: float,
) -> None:
    """Take the account's lock and refuse a submission that does not fit.

    ## Why this exists at all

    `POST /v1/qpu/submissions` computed an estimate, wrote it onto the durable
    row, and compared it to nothing. Measured over real HTTP against this schema,
    with the deployment gate opened and a FREE-tier account: twenty submissions
    of 10,000 shots on IonQ Forte were accepted for $16,006.00, and a single
    1,000,000-shot submission for $80,000.30 — $96,006.30 authorized in
    twenty-one requests by an account whose sixth *simulator* run of the week is
    refused. The route took no `CurrentIdentity` at all, so it had no tier to
    compare against and could not have checked one.

    Every gate that route did consult — `MAJORANA_QPU_SUBMIT_ENABLED`, the
    provider token, the provider dependency — is deployment-wide. Each answers
    "may this DEPLOYMENT submit"; none answers "may this ACCOUNT spend". Those
    are two operations, and only the first was implemented.

    ## Why `>` and not `>=`

    Every other reservation in this layer refuses on `held >= limit`, because it
    is about to add exactly one to a count of whole things. This one is
    continuous: the caller says what its submission would cost, and the question
    is whether that amount FITS. `spent >= limit` would refuse the first
    submission an empty allowance can obviously afford; `spent + estimate > limit`
    admits exactly the submissions that stay inside it.

    ## What takes no lock

    `limit is None` — an unmetered tier has nothing to serialize.

    `estimate == 0.0` — a free-queue submission adds nothing to the sum, so it
    cannot carry any account over any ceiling, and there is nothing to serialize
    against. This matters beyond the saved round trip: a free account's ceiling
    is `0.0`, so a zero-cost submission is the ONLY kind it can make, and making
    that path queue behind a row lock would put every free hardware submission
    the product has through one exclusive lock per account.

    ## Lock ordering

    A user row is the last lock any path takes — `artifact → project →
    workspace → user`. This route holds nothing else, so there is nothing here
    to order against, and this is the same row `runs.reserve_execute_run_slot`
    takes.
    """
    if limit is None or estimate == 0.0:
        return
    await session.execute(select(User.id).where(User.id == scope.user_id).with_for_update())
    spent = await authorized_spend_since(scope, session, since)
    if round(spent + estimate, _USD_PLACES) > round(limit, _USD_PLACES):
        raise QpuSpendReached(spent, limit, estimate)


async def create_record(
    scope: Scope,
    session: AsyncSession,
    *,
    device_id: str,
    provider: str,
    shots: int,
    qasm: str,
    source_fingerprint: str,
    estimate_basis: str,
    estimated_total_usd: float | None,
    rate_source: str,
    rate_confirmed_on: str,
    artifact_version_id: uuid.UUID | None = None,
) -> QpuRun:
    require_write(scope)
    record = QpuRun(
        id=uuid7(),
        workspace_id=scope.workspace_id,
        user_id=scope.user_id,
        artifact_version_id=artifact_version_id,
        provider=provider,
        device_id=device_id,
        shots=shots,
        status=QpuRunStatus.QUEUED.value,
        source_fingerprint=source_fingerprint,
        qasm=qasm,
        estimate_basis=estimate_basis,
        estimated_total_usd=estimated_total_usd,
        rate_source=rate_source,
        rate_confirmed_on=rate_confirmed_on,
    )
    session.add(record)
    await session.flush()
    return record


async def get_record(scope: Scope, session: AsyncSession, record_id: uuid.UUID) -> QpuRun:
    stmt = select(QpuRun).where(QpuRun.id == record_id, QpuRun.workspace_id == scope.workspace_id)
    record = (await session.execute(stmt)).scalar_one_or_none()
    if record is None:
        raise LookupError(f"qpu_run {record_id} is not visible in this workspace")
    return record


async def transition(
    scope: Scope,
    session: AsyncSession,
    record_id: uuid.UUID,
    status: QpuRunStatus,
    *,
    provider_job_id: str | None = None,
    raw_counts: dict[str, int] | None = None,
    error: str | None = None,
    submitted_at: dt.datetime | None = None,
    completed_at: dt.datetime | None = None,
) -> QpuRun:
    """Move a record along its lifecycle; refuses terminal rewrites.

    The WHERE clause repeats the from-status predicate so two workers cannot
    both complete the same record: whoever loses the race matches zero rows
    and reads back the winner's terminal state instead of overwriting it.
    """
    require_write(scope)
    record = await get_record(scope, session, record_id)
    current = QpuRunStatus(record.status)
    if status not in _ALLOWED_TRANSITIONS.get(current, set()):
        raise ValueError(f"qpu_run cannot move {current.value} -> {status.value}")
    values: dict[str, Any] = {"status": status.value, "updated_at": dt.datetime.now(dt.UTC)}
    if provider_job_id is not None:
        values["provider_job_id"] = provider_job_id
    if raw_counts is not None:
        values["raw_counts"] = raw_counts
    if error is not None:
        values["error"] = error[:2000]
    if submitted_at is not None:
        values["submitted_at"] = submitted_at
    if status in _TERMINAL:
        values["completed_at"] = completed_at or dt.datetime.now(dt.UTC)
    result = await session.execute(
        update(QpuRun)
        .where(
            QpuRun.id == record_id,
            QpuRun.workspace_id == scope.workspace_id,
            QpuRun.status == current.value,
        )
        .values(**values)
    )
    if result.rowcount != 1:
        raise RuntimeError(f"qpu_run {record_id} changed concurrently")
    await session.refresh(record)
    return record
