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
    estimate as rate_card_estimate,
    list_backends,
    submission_block_reason,
)

from ..auth.deps import CurrentScope

router = APIRouter()

MAX_ESTIMATE_SHOTS = 1_000_000


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
