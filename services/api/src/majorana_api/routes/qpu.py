"""QPU catalog, deterministic estimates, and the submission gate.

Stateless by design in this slice: the rate card is code (majorana_qpu), the
estimate is arithmetic over it, and the submission endpoint reports exactly
why hardware submission is blocked in this deployment instead of pretending a
job was created. The durable `qpu_run` job row is a schema change and lands
as its own two-PR migration (deploy migrates before rollout).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from majorana_qpu import (
    QpuBackendInfo,
    QpuCostEstimate,
    UnknownDeviceError,
    backend_info,
    estimate as rate_card_estimate,
    list_backends,
    submission_block_reason,
)

from ..auth.deps import CurrentScope

router = APIRouter()

MAX_ESTIMATE_SHOTS = 1_000_000
# Generous bound for a submitted OpenQASM program; the Studio surface caps far
# lower — this only stops abuse of the raw endpoint.
MAX_SUBMISSION_QASM_CHARS = 200_000

# Blocked reason for the seam gap itself: every provider gate can be open and
# submission still refuses until the durable qpu_run record storage exists
# (two-PR schema change; the migration is the second half). A hardware job
# with nowhere to attest its provider job id and raw counts must not start.
DURABLE_RECORD_UNAVAILABLE = "durable_record_unavailable"


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


@router.post("/qpu/submissions")
async def qpu_submit(body: QpuSubmissionRequest, scope: CurrentScope) -> None:
    """Real submission flow up to the enqueue: device is validated, then every
    deployment gate is consulted, and the refusal names its reason. In this
    slice no path enqueues — even with all provider gates open the endpoint
    refuses with DURABLE_RECORD_UNAVAILABLE until the qpu_run record migration
    lands. The follow-up PR replaces only that terminal branch with
    enqueue(QPU_RUN_JOB_KIND) + the attestation row; the success shape is
    already contracted as majorana_contracts.QpuRunRecord."""
    try:
        backend_info(body.device_id)
    except UnknownDeviceError:
        raise HTTPException(status_code=404, detail="unknown QPU device") from None
    reason = submission_block_reason()
    if reason is not None:
        raise HTTPException(status_code=409, detail={"blocked_reason": reason.value})
    raise HTTPException(status_code=409, detail={"blocked_reason": DURABLE_RECORD_UNAVAILABLE})
