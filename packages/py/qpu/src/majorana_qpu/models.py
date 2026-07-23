"""Typed QPU surface. Every estimate names its basis and its source.

The evidence rules from the Stage-8 plan apply here the same way they apply to
verification: a number the vendor has not published is not shown as a price,
and a submission the deployment cannot make is a named block, never a spinner.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class QpuProviderKey(StrEnum):
    IBM = "ibm"
    BRAKET = "braket"


class QpuAccess(StrEnum):
    """How the device is reached commercially."""

    FREE_QUEUE = "free_queue"  # included allowance, queue-based (IBM Open Plan)
    ON_DEMAND = "on_demand"  # per-task + per-shot billing (Braket)


class EstimateBasis(StrEnum):
    VENDOR_RATE_CARD = "vendor_rate_card"
    FREE_TIER_ALLOWANCE = "free_tier_allowance"


class QpuBackendInfo(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider: QpuProviderKey
    device_id: str
    display_name: str
    vendor: str
    technology: Literal["superconducting", "trapped_ion", "neutral_atom"]
    access: QpuAccess
    # None means the vendor-published rate card was not verified for this
    # device — the UI must show the absence, not a guess.
    qubit_count: int | None = None
    per_task_usd: float | None = None
    per_shot_usd: float | None = None
    allowance_note: str | None = None
    rate_source: str
    rate_confirmed_on: str  # ISO date the source was fetched


class QpuCostEstimate(BaseModel):
    model_config = ConfigDict(frozen=True)

    device_id: str
    shots: int = Field(ge=1)
    basis: EstimateBasis
    currency: Literal["USD"] = "USD"
    task_fee_usd: float | None = None
    shot_fees_usd: float | None = None
    total_usd: float | None = None
    allowance_note: str | None = None
    rate_source: str
    rate_confirmed_on: str
    disclaimer: str


class QpuSubmissionBlockReason(StrEnum):
    SUBMISSION_DISABLED = "submission_disabled"
    CREDENTIALS_UNCONFIGURED = "credentials_unconfigured"
    PROVIDER_DEPENDENCY_MISSING = "provider_dependency_missing"
    UNKNOWN_DEVICE = "unknown_device"


class QpuJobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    CANCELLED = "cancelled"


class QpuJobRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    device_id: str
    shots: int = Field(ge=1)
    qasm: str
    source_fingerprint: str


class QpuJobRecord(BaseModel):
    """Attestation-first job record: provider job id, device, shots, and the
    raw counts exactly as returned — never averaged or corrected in place."""

    model_config = ConfigDict(frozen=True)

    provider: QpuProviderKey
    provider_job_id: str
    device_id: str
    shots: int
    status: QpuJobStatus
    submitted_at: str
    source_fingerprint: str
    raw_counts: dict[str, int] | None = None
    error: str | None = None
