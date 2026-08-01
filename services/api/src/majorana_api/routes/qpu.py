"""QPU catalog, deterministic estimates, the submission gate, and submission.

The rate card is code (majorana_qpu) and the estimate is arithmetic over it.
Submission is fail-closed behind the deployment gates; when every gate is
open, POST /qpu/submissions writes the durable qpu_runs attestation row
(migration 0034) and its qpu.run job in one transaction and returns the
record. The worker owns every provider interaction after that.
"""

import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from majorana_contracts import QpuRunRecord
from pydantic import BaseModel, ConfigDict, Field

from majorana_qpu import (
    QpuBackendInfo,
    QpuCostEstimate,
    QpuRunJobPayload,
    UnknownDeviceError,
    backend_info,
    estimate as rate_card_estimate,
    list_backends,
    submission_block_reason,
)

from ..auth.deps import CurrentIdentity, CurrentScope, DbSession, get_settings
from ..request_models import RequestModel
from ..jobs import QPU_RUN_JOB_KIND
from ..orm import QpuRun as QpuRunRow
from ..repos import qpu_runs as qpu_runs_repo
from ..repos import system
from ..settings import Settings
from ..tiers import TIER_WINDOW, limits_for, tier_of

router = APIRouter()

MAX_ESTIMATE_SHOTS = 1_000_000
# Generous bound for a submitted OpenQASM program; the Studio surface caps far
# lower — this only stops abuse of the raw endpoint.
MAX_SUBMISSION_QASM_CHARS = 200_000


class QpuBackendsResponse(BaseModel):
    backends: list[QpuBackendInfo]


class QpuEstimateRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    device_id: str = Field(min_length=1, max_length=120)
    shots: int = Field(ge=1, le=MAX_ESTIMATE_SHOTS)


class QpuSubmissionGateResponse(BaseModel):
    """Whether this deployment could submit to hardware right now, and if not,
    the exact reason. `blocked_reason` is None only when every gate is open."""

    submission_available: bool
    blocked_reason: str | None


@router.get("/qpu/backends", response_model=QpuBackendsResponse)
async def qpu_backends(scope: CurrentScope) -> QpuBackendsResponse:
    return QpuBackendsResponse(backends=list(list_backends()))


@router.post("/qpu/estimates", response_model=QpuCostEstimate)
async def qpu_estimate(body: QpuEstimateRequest, scope: CurrentScope) -> QpuCostEstimate:
    try:
        return rate_card_estimate(body.device_id, body.shots)
    except UnknownDeviceError:
        raise HTTPException(status_code=404, detail="unknown QPU device") from None


@router.get("/qpu/submission-gate", response_model=QpuSubmissionGateResponse)
async def qpu_submission_gate(scope: CurrentScope) -> QpuSubmissionGateResponse:
    reason = submission_block_reason()
    return QpuSubmissionGateResponse(
        submission_available=reason is None,
        blocked_reason=None if reason is None else reason.value,
    )


class QpuSubmissionRequest(RequestModel):
    model_config = ConfigDict(extra="forbid")

    device_id: str = Field(min_length=1, max_length=120)
    shots: int = Field(ge=1, le=MAX_ESTIMATE_SHOTS)
    qasm: str = Field(min_length=1, max_length=MAX_SUBMISSION_QASM_CHARS)
    source_fingerprint: str = Field(min_length=1, max_length=200)


def _to_qpu_run_resource(record: QpuRunRow) -> QpuRunRecord:
    return QpuRunRecord(
        id=record.id,
        workspace_id=record.workspace_id,
        user_id=record.user_id,
        artifact_version_id=record.artifact_version_id,
        provider=record.provider,
        device_id=record.device_id,
        provider_job_id=record.provider_job_id,
        shots=record.shots,
        status=record.status,
        source_fingerprint=record.source_fingerprint,
        estimate_basis=record.estimate_basis,
        estimated_total_usd=(
            float(record.estimated_total_usd) if record.estimated_total_usd is not None else None
        ),
        rate_source=record.rate_source,
        rate_confirmed_on=record.rate_confirmed_on,
        raw_counts=record.raw_counts,
        error=record.error,
        submitted_at=record.submitted_at,
        completed_at=record.completed_at,
        created_at=record.created_at,
    )


def qpu_spend_refusal(spent: float, limit: float, estimate: float) -> HTTPException:
    """The refusal an account sees when a hardware submission does not fit.

    Names all three numbers, because "you cannot do that" is unactionable for a
    limit denominated in money: what the user needs to know is whether to wait
    for the window to roll, pick a cheaper device, or drop the shot count. A
    free account reads the `limit: 0.0` case, which is the honest sentence —
    billed hardware is not part of that plan, and the free queue still is.

    429 rather than 402: this is an allowance that refills, the same shape as
    `tier_allowance_refusal` next door, not a demand for payment.

    The numeric fields are rounded to cents, and not only for tidiness. `spent`
    is a sum of floats read back from a `Numeric` column, so it can land at
    `25.000000000000004` — and a client that renders these fields rather than
    parsing the sentence would put that on screen as an amount of money. The
    sentence itself has always been formatted to two places; these now agree
    with it rather than disagreeing in the twelfth decimal.
    """
    return HTTPException(
        status_code=429,
        detail={
            "error": (
                f"This submission is estimated at ${estimate:,.2f}. Your plan includes "
                f"${limit:,.2f} of hardware time per week and ${spent:,.2f} is already "
                "authorized. Free-queue devices and browser simulation stay available."
            ),
            "reason": "qpu_spend_exhausted",
            "spent_usd": round(spent, 2),
            "limit_usd": round(limit, 2),
            "estimate_usd": round(estimate, 2),
        },
    )


@router.post("/qpu/submissions", response_model=QpuRunRecord, status_code=201)
async def qpu_submit(
    body: QpuSubmissionRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
) -> QpuRunRecord:
    """Real submission: device validated, every deployment gate consulted, the
    account's weekly hardware spend reserved under its own lock, and on an open
    path the durable qpu_run attestation row and the qpu.run job are written in
    the same transaction — neither can become visible alone. The estimate is
    snapshotted onto the row exactly as the rate card computes it now, so the
    record proves what was agreed to at confirmation time.

    `identity` is here for one reason: without it this handler has no tier, and
    a handler with no tier cannot check an allowance. It had none, and the
    result was $96,006.30 accepted from a free account over twenty-one requests
    — see `qpu_runs.reserve_qpu_spend_slot`, which carries the measurement.

    The spend check runs AFTER the deployment gate deliberately. A closed
    deployment is not the account's problem, and telling somebody their budget
    is spent when nothing in this deployment could have submitted anything would
    be the wrong sentence."""
    try:
        backend = backend_info(body.device_id)
    except UnknownDeviceError:
        raise HTTPException(status_code=404, detail="unknown QPU device") from None
    reason = submission_block_reason()
    if reason is not None:
        raise HTTPException(status_code=409, detail={"blocked_reason": reason.value})
    estimate = rate_card_estimate(body.device_id, body.shots)
    user, _workspace = identity
    limits = limits_for(tier_of(user, settings))
    try:
        await qpu_runs_repo.reserve_qpu_spend_slot(
            scope,
            session,
            dt.datetime.now(dt.timezone.utc) - TIER_WINDOW,
            limits.qpu_spend_usd_per_week,
            # A free-queue device has no total to charge, and this `or 0.0` is
            # the whole of how it stays free: the reservation returns on a zero
            # estimate, so an account whose ceiling is $0 still reaches the IBM
            # Open Plan queue.
            estimate.total_usd or 0.0,
        )
    except qpu_runs_repo.QpuSpendReached as reached:
        raise qpu_spend_refusal(reached.spent, reached.limit, reached.estimate) from reached
    record = await qpu_runs_repo.create_record(
        scope,
        session,
        device_id=body.device_id,
        provider=backend.provider.value,
        shots=body.shots,
        qasm=body.qasm,
        source_fingerprint=body.source_fingerprint,
        estimate_basis=estimate.basis.value,
        estimated_total_usd=estimate.total_usd,
        rate_source=estimate.rate_source,
        rate_confirmed_on=estimate.rate_confirmed_on,
    )
    payload = QpuRunJobPayload(
        workspace_id=str(scope.workspace_id),
        user_id=str(scope.user_id),
        qpu_run_id=str(record.id),
        device_id=body.device_id,
        shots=body.shots,
        qasm=body.qasm,
        source_fingerprint=body.source_fingerprint,
    )
    await system.enqueue_job(
        session,
        kind=QPU_RUN_JOB_KIND,
        payload=payload.model_dump(mode="json"),
    )
    return _to_qpu_run_resource(record)


@router.get("/qpu/runs/{record_id}", response_model=QpuRunRecord)
async def qpu_run_record(
    record_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> QpuRunRecord:
    try:
        record = await qpu_runs_repo.get_record(scope, session, record_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="unknown qpu_run") from None
    return _to_qpu_run_resource(record)
