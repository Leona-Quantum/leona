"""Typed QPU surface. Every estimate names its basis and its source.

The evidence rules from the Stage-8 plan apply here the same way they apply to
verification: a number the vendor has not published is not shown as a price,
and a submission the deployment cannot make is a named block, never a spinner.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field


class QpuProviderKey(StrEnum):
    IBM = "ibm"
    BRAKET = "braket"


#: Providers a submission can actually be sent to. The rate card prices more
#: providers than this (every Braket device), because an estimate needs only the
#: vendor's published rates. A submission needs an adapter in the worker, and
#: the worker has one for IBM only. A provider joins this set in the same change
#: that adds its adapter; until then the API refuses the submission and the
#: worker refuses the job, so a Braket device can never be run on IBM hardware
#: under a Braket label and a Braket price.
SUBMITTABLE_PROVIDERS: frozenset[QpuProviderKey] = frozenset({QpuProviderKey.IBM})


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

    @computed_field  # type: ignore[prop-decorator]
    @property
    def submittable(self) -> bool:
        """Whether Leona can send a job to this device today, or only price it."""
        return self.provider in SUBMITTABLE_PROVIDERS


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
    #: The device is priced but its provider has no submit adapter (see
    #: `SUBMITTABLE_PROVIDERS`).
    PROVIDER_NOT_SUPPORTED = "provider_not_supported"


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


class QpuRunJobPayload(BaseModel):
    """jobs.payload contract for kind "qpu.run" — the API is the only producer
    and the worker the only consumer, so the shape lives here where both sides
    already depend. UUIDs travel as strings like every other job payload, and
    the worker resumes exactly this scope, never a broader one. No producer
    exists until the durable qpu_run record storage lands (two-PR schema
    change); the type ships first so both sides agree before the migration."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    workspace_id: str
    user_id: str
    # The durable qpu_runs row this job executes. The worker loads the program
    # and every attested value from the row, so the payload stays a pointer
    # plus the scope it resumes — never a second copy of the submission.
    qpu_run_id: str
    artifact_version_id: str | None = None
    device_id: str
    shots: int = Field(ge=1)
    qasm: str
    source_fingerprint: str


#: Longest backend name the record keeps; `qpu_runs.ck_qpu_runs_backend_name`
#: (migration 0065) enforces the same bound. IBM's names are short
#: (`ibm_brisbane`), so this only ever refuses something that is not a name.
MAX_BACKEND_NAME_CHARS = 120


def reported_backend_name(value: object) -> str | None:
    """The provider's backend name if it reported a usable one, else None.

    Never raises, and that is the point of it. It runs on the submit path
    AFTER the provider has accepted the job, and the worker writes its result in
    the same transition that records the provider job id. A name that failed
    validation there would lose the job id of a job that is already running and
    billing, so anything that is not a plain, non-blank string within the
    column's bound becomes None: "not reported", which is true. Nothing is
    truncated or tidied into a name the provider did not send.
    """
    if not isinstance(value, str):
        return None
    name = value.strip()
    if not name or len(name) > MAX_BACKEND_NAME_CHARS:
        return None
    return name


class QpuJobRecord(BaseModel):
    """Attestation-first job record: provider job id, device, shots, and the
    raw counts exactly as returned — never averaged or corrected in place."""

    model_config = ConfigDict(frozen=True)

    provider: QpuProviderKey
    provider_job_id: str
    device_id: str
    shots: int
    status: QpuJobStatus
    # Set by submit(); a poll() view reports provider-side state only and
    # does not re-attest the submission time it never observed.
    submitted_at: str | None = None
    source_fingerprint: str
    raw_counts: dict[str, int] | None = None
    error: str | None = None
    #: The physical machine the provider handed the job to, as it named it.
    #: `device_id` is Leona's catalog entry (`ibm.open_plan`); IBM picks the
    #: machine itself with `least_busy`, so this is the only place that choice
    #: is recorded. Set by submit() through `reported_backend_name`; None when
    #: the provider did not say.
    backend_name: str | None = None
