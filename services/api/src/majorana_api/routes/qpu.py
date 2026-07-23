"""QPU catalog, deterministic estimates, the submission gate, and submission.

The rate card is code (majorana_qpu) and the estimate is arithmetic over it.
Submission is fail-closed behind the deployment gates; when every gate is
open, POST /qpu/submissions writes the durable qpu_runs attestation row
(migration 0034) and its qpu.run job in one transaction and returns the
record. The worker owns every provider interaction after that.
"""

import uuid

from fastapi import APIRouter, HTTPException
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

from ..auth.deps import CurrentScope, DbSession
from ..jobs import QPU_RUN_JOB_KIND
from ..orm import QpuRun as QpuRunRow
from ..repos import qpu_runs as qpu_runs_repo
from ..repos import system

router = APIRouter()

MAX_ESTIMATE_SHOTS = 1_000_000
# Generous bound for a submitted OpenQASM program; the Studio surface caps far
# lower — this only stops abuse of the raw endpoint.
MAX_SUBMISSION_QASM_CHARS = 200_000


class QpuBackendsResponse(BaseModel):
    backends: list[QpuBackendInfo]


class QpuEstimateRequest(BaseModel):
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


class QpuSubmissionRequest(BaseModel):
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


@router.post("/qpu/submissions", response_model=QpuRunRecord, status_code=201)
async def qpu_submit(
    body: QpuSubmissionRequest, scope: CurrentScope, session: DbSession
) -> QpuRunRecord:
    """Real submission: device validated, every deployment gate consulted, and
    on an open path the durable qpu_run attestation row and the qpu.run job
    are written in the same transaction — neither can become visible alone.
    The estimate is snapshotted onto the row exactly as the rate card computes
    it now, so the record proves what was agreed to at confirmation time."""
    try:
        backend = backend_info(body.device_id)
    except UnknownDeviceError:
        raise HTTPException(status_code=404, detail="unknown QPU device") from None
    reason = submission_block_reason()
    if reason is not None:
        raise HTTPException(status_code=409, detail={"blocked_reason": reason.value})
    estimate = rate_card_estimate(body.device_id, body.shots)
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
