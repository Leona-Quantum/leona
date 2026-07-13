"""RunEvent — the typed event log. One row in run_events per event; the UI is a pure
renderer of this stream (ADR-0008), so stored runs replay identically. Discriminated
on `type`; additive changes only within /v1 (new event types are fine, changing or
removing fields is not)."""

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

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
from .models import ResourceMetrics
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


class ResearchCitation(BaseModel):
    """A bounded public reference shown as provenance for the planning decision."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=500)
    url: str = Field(min_length=1, max_length=2048)
    excerpt: str = Field(min_length=1, max_length=4000)


class ResearchCompleted(_EventBase):
    type: Literal["research.completed"] = "research.completed"
    query: str = Field(min_length=1, max_length=300)
    sources: list[ResearchCitation] = Field(default_factory=list, max_length=5)
    error: str | None = Field(default=None, max_length=120)


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
    kind: Literal["reasoning", "output"] = "output"
    text: str


class CodeGenerated(_EventBase):
    type: Literal["code.generated"] = "code.generated"
    language: str
    code: str
    revision: int = Field(ge=1, description="1 = first generation; +1 per repair iteration")


class ScreenResult(_EventBase):
    type: Literal["screen.result"] = "screen.result"
    lint_ok: bool
    typecheck_ok: bool
    diagnostics: list[str] = Field(default_factory=list)


class ResourceEstimateResult(_EventBase):
    type: Literal["resource.estimate"] = "resource.estimate"
    phase: Literal["pre_verify", "compiled"]
    source: Literal["plan_static", "ir", "compiler"]
    metrics: ResourceMetrics
    notes: list[str] = Field(default_factory=list)


class CompilationResult(_EventBase):
    type: Literal["compilation.result"] = "compilation.result"
    accepted: bool
    mode: Literal["not_applicable", "unchanged", "transpiled", "compressed", "rejected"]
    target: str | None = None
    source_fingerprint: str | None = None
    compiled_fingerprint: str | None = None
    before: ResourceMetrics | None = None
    after: ResourceMetrics | None = None
    compatibility: dict[str, Any] = Field(default_factory=dict)
    reason: str | None = None


class CodeVariant(BaseModel):
    """A deterministic, copyable framework rendering of the verified circuit."""

    model_config = ConfigDict(extra="forbid")

    language: str
    code: str
    export_status: ExportStatus
    export_reason: str | None = None


class CodeFinalized(_EventBase):
    type: Literal["code.finalized"] = "code.finalized"
    language: str
    code: str
    revision: int = Field(ge=1)
    compilation_applied: bool
    simulation_plausible: bool
    qpu_available: bool
    framework_variants: dict[str, CodeVariant] = Field(default_factory=dict)
    conversion_options: list[str] = Field(default_factory=list)
    execution_options: list[Literal["simulate", "qpu"]] = Field(default_factory=list)
    export_status: ExportStatus
    export_reason: str | None = None
    finalization_reason: str | None = None


class QasmEmission(BaseModel):
    """Provenance for the OpenQASM payload recovered from sandbox stdout.

    ``sandbox_epilogue`` is Majorana's observed serialization of ``FINAL_CIRCUIT``;
    ``model_stdout`` is a compatibility fallback and is not equivalent evidence.
    """

    model_config = ConfigDict(extra="forbid")

    epilogue_applied: bool
    source: Literal["sandbox_epilogue", "model_stdout", "missing"]
    available: bool
    epilogue_error: str | None = Field(
        default=None,
        description="Exception type only; raw sandbox exception text is never persisted here.",
    )


class SandboxResult(_EventBase):
    type: Literal["sandbox.result"] = "sandbox.result"
    phase: Literal["verification", "final"] = "verification"
    exit_code: int
    duration_ms: int = Field(ge=0)
    memory_mb: int | None = Field(default=None, ge=0)
    stdout: str
    stderr: str
    truncated: bool = False
    qasm_emission: QasmEmission | None = None


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

    @model_validator(mode="after")
    def _reason_required_when_lossy(self) -> "ExportClassified":
        if self.status is ExportStatus.LOSSY_WITH_REASON and not self.reason:
            raise ValueError("reason is required when status is lossy_with_reason")
        return self


class ArtifactSaved(_EventBase):
    type: Literal["artifact.saved"] = "artifact.saved"
    artifact_id: UUID
    version_id: UUID
    version_seq: int = Field(ge=1)


class RunAnalysis(_EventBase):
    type: Literal["run.analysis"] = "run.analysis"
    summary: str
    interpretation: str
    results: dict[str, Any] = Field(default_factory=dict)
    comparison: dict[str, Any] = Field(default_factory=dict)
    residual_risks: str | None = None


class RunDiagnosed(_EventBase):
    type: Literal["run.diagnosed"] = "run.diagnosed"
    failed_stage: Stage
    restart_from: Stage | None = None
    code: str
    message: str
    attempt: int = Field(ge=1)


class RunRestarted(_EventBase):
    type: Literal["run.restarted"] = "run.restarted"
    from_stage: Stage
    attempt: int = Field(ge=1)
    reason: str


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
    | ResearchCompleted
    | LlmCall
    | LlmDelta
    | CodeGenerated
    | ScreenResult
    | ResourceEstimateResult
    | CompilationResult
    | CodeFinalized
    | SandboxResult
    | VerificationResult
    | BaselineResult
    | ExportClassified
    | ArtifactSaved
    | RunAnalysis
    | RunDiagnosed
    | RunRestarted
    | RunErrorEvent
    | RunFinished,
    Field(discriminator="type"),
]

run_event_adapter: TypeAdapter[RunEvent] = TypeAdapter(RunEvent)
