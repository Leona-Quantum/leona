"""RunEvent — the typed event log. One row in run_events per event; the UI is a pure
renderer of this stream (ADR-0008), so stored runs replay identically. Discriminated
on `type`; additive changes only within /v1 (new event types are fine, changing or
removing fields is not)."""

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from .enums import (
    BaselineKind,
    ExportStatus,
    Framework,
    RunMode,
    RunStatus,
    Stage,
    VerificationMethod,
    VerificationResultKind,
    VerifierDecision,
)
from .plan import Plan


class _EventBase(BaseModel):
    """Envelope shared by every event; maps 1:1 to run_events columns
    (run_id, seq, ts, type) with the remaining fields as the payload."""

    model_config = ConfigDict(extra="forbid")

    run_id: UUID
    seq: int = Field(ge=0, description="Unique per run; powers replay and SSE Last-Event-ID")
    ts: datetime


class RunQueued(_EventBase):
    type: Literal["run.queued"] = "run.queued"
    mode: RunMode
    framework: Framework


class RunStarted(_EventBase):
    type: Literal["run.started"] = "run.started"


class StageStarted(_EventBase):
    type: Literal["stage.started"] = "stage.started"
    stage: Stage


class StageFinished(_EventBase):
    type: Literal["stage.finished"] = "stage.finished"
    stage: Stage
    ok: bool
    duration_ms: int = Field(ge=0)


class PlanProduced(_EventBase):
    type: Literal["plan.produced"] = "plan.produced"
    plan: Plan


class LlmCall(_EventBase):
    """One completed LLM call; every call is logged with token counts (ADR-0009)."""

    type: Literal["llm.call"] = "llm.call"
    stage: Stage
    model: str
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    duration_ms: int = Field(ge=0)


class LlmDelta(_EventBase):
    """Streaming text fragment for live UI rendering; not required for replay
    correctness (the terminal events carry the full state)."""

    type: Literal["llm.delta"] = "llm.delta"
    stage: Stage
    text: str


class CodeGenerated(_EventBase):
    type: Literal["code.generated"] = "code.generated"
    language: str
    code: str
    revision: int = Field(ge=1, description="1 = first generation; +1 per repair iteration")


class SandboxResult(_EventBase):
    type: Literal["sandbox.result"] = "sandbox.result"
    exit_code: int
    duration_ms: int = Field(ge=0)
    memory_mb: int | None = Field(default=None, ge=0)
    stdout: str
    stderr: str
    truncated: bool = False


class VerificationResult(_EventBase):
    type: Literal["verification.result"] = "verification.result"
    method: VerificationMethod
    result: VerificationResultKind
    details: dict[str, Any] = Field(default_factory=dict)


class BaselineResult(_EventBase):
    type: Literal["baseline.result"] = "baseline.result"
    kind: BaselineKind
    result: dict[str, Any] | None = None
    not_applicable_reason: str | None = None


class ExportClassified(_EventBase):
    type: Literal["export.classified"] = "export.classified"
    status: ExportStatus
    reason: str | None = Field(
        default=None, description="Required when status is lossy_with_reason"
    )
    qasm_available: bool


class ArtifactSaved(_EventBase):
    type: Literal["artifact.saved"] = "artifact.saved"
    artifact_id: UUID
    version_id: UUID
    version_seq: int = Field(ge=1)


class RunErrorEvent(_EventBase):
    type: Literal["run.error"] = "run.error"
    stage: Stage | None = None
    code: str = Field(description="Machine-readable error code (RFC 9457 style)")
    message: str


class RunFinished(_EventBase):
    type: Literal["run.finished"] = "run.finished"
    status: RunStatus
    verifier_decision: VerifierDecision | None = None
    residual_risks: str | None = None


RunEvent = Annotated[
    RunQueued
    | RunStarted
    | StageStarted
    | StageFinished
    | PlanProduced
    | LlmCall
    | LlmDelta
    | CodeGenerated
    | SandboxResult
    | VerificationResult
    | BaselineResult
    | ExportClassified
    | ArtifactSaved
    | RunErrorEvent
    | RunFinished,
    Field(discriminator="type"),
]

run_event_adapter: TypeAdapter[RunEvent] = TypeAdapter(RunEvent)
