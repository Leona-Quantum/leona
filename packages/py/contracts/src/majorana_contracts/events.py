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
    EvidenceStrength,
    ExportStatus,
    Framework,
    RunMode,
    RunStatus,
    RetryTarget,
    SemanticReviewDecision,
    Stage,
    VerificationMethod,
    VerificationFailureClass,
    VerificationResultKind,
    VerifierDecision,
)
from .models import ResourceMetrics, SynthesisResult, VerificationSummary
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


class RunModeResolved(_EventBase):
    """How a run's requested mode became the mode it actually ran in.

    Emitted whenever the worker's intent router had a say — including when it
    left the requested mode alone. Without this the resolution is invisible: a
    "hi" that quietly answered as chat and a quantum task that quietly skipped
    the pipeline look identical from the outside.
    """

    type: Literal["run.mode_resolved"] = "run.mode_resolved"
    requested: RunMode
    resolved: RunMode
    source: Literal["passthrough", "heuristic", "classifier", "fallback"]
    reason: str


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


class ChatDelta(_EventBase):
    """A provider-native chat fragment; no stage or output schema is imposed."""

    type: Literal["chat.delta"] = "chat.delta"
    kind: Literal["reasoning", "output"] = "output"
    text: str = Field(min_length=1, max_length=12_000)


class ChatCompleted(_EventBase):
    type: Literal["chat.completed"] = "chat.completed"
    text: str = Field(min_length=1, max_length=200_000)
    model: str = Field(min_length=1, max_length=200)
    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    duration_ms: int = Field(ge=0)
    #: Present only for the readiness-gate's clarification turn (worker
    #: `_finish_missing_inputs_clarification`) — the task-specific inputs it
    #: could not find in the prompt. `apps/web`'s live-run view reads both of
    #: these fields to render the bullet list and the "proceed anyway" action;
    #: they were added to the wire payload by #485 without being added here,
    #: which made every such turn raise `extra_forbidden` in production instead
    #: of ever reaching a reader (see test_events.py for the regression case).
    missing_inputs: list[str] | None = None
    allow_ai_assumptions_available: bool = False


class ChatError(_EventBase):
    type: Literal["chat.error"] = "chat.error"
    code: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=2_000)


class ConversationTitled(_EventBase):
    """A short name for the conversation, written by the model on its first turn.

    Emitted at most once per conversation and never for a later turn, so the name
    a user sees in their sidebar does not shift under them mid-thread. The title
    is the model's own words in the language the user wrote in — deriving it from
    the prompt text is what produced sidebar rows that were whole paragraphs, and
    translating it is what mixed two languages into one list.
    """

    type: Literal["conversation.titled"] = "conversation.titled"
    title: str = Field(min_length=1, max_length=120)
    source: Literal["model", "fallback"] = "model"


class QappGenerated(_EventBase):
    type: Literal["qapp.generated"] = "qapp.generated"
    qapp_id: UUID
    version_id: UUID
    slug: str = Field(min_length=1, max_length=160)
    title: str = Field(min_length=1, max_length=240)
    visibility: Literal["private"] = "private"


class NotebookGrades(_EventBase):
    """The verdicts for one reader's attempt at a notebook's graded cells.

    A run event rather than a response body because grading executes the reader's code
    in the sandbox: the route answers 202 with a run id and the verdicts arrive on that
    run's stream, like every other notebook result.

    Registered HERE and not only emitted, which is the whole point of this union:
    `RepoEventSink` validates every event against it before persisting, so an event type
    that is not in this list is REJECTED at emit time — the run reports an error and the
    reader never receives a verdict. A fake sink in a test accepts anything and cannot
    show that.
    """

    type: Literal["notebook.grades"] = "notebook.grades"
    version_id: UUID
    #: The full `GradeReport`, carried as-is so a client renders per-cell verdicts
    #: without a second fetch. Typed loosely here because `notebooks.py` owns its shape
    #: and importing it would make this module depend on the notebook contracts.
    grades: dict[str, Any]
    passed: int = Field(ge=0)
    failed: int = Field(ge=0)
    attempted: int = Field(ge=0)
    #: Why nothing could be graded, when that is the answer — a guard refusal, a
    #: sandbox note. Empty on an ordinary wrong answer.
    note: str = ""


class NotebookDraftDelta(_EventBase):
    """A streamed fragment of the notebook lane's own model output — Nala writing a
    notebook cell by cell (plan 10-notebook-ide, "Live" lane), not `llm.call`'s wrapper
    (`MeteredAgentLLM`, `services/worker/agent_llm.py`), which the notebook lane's
    `ProductionNotebookPorts._complete` does not go through.

    **Pre-redacted, not raw.** The run's event stream is workspace-scoped, not
    author-scoped (`services/api/.../repos/runs.py` `get_run` filters on
    `Run.workspace_id` alone), the same gap `NotebookSpec.for_learner()` closes for a
    finished notebook (ai-ops#260) applies to every character streamed live. A cell
    whose header (`# %%` line) marks it `role=solution`/`role=answer` or carries
    `check=`/`answer=` is withheld from this stream entirely by
    `leona_notebooks.live_draft.LiveDraftGuard` before a chunk ever reaches here — a
    later, correctly redacted `notebook.draft.parsed` cannot un-send a byte that
    already went out on the wire.
    """

    type: Literal["notebook.draft.delta"] = "notebook.draft.delta"
    text: str = Field(min_length=1)
    #: Which draft/repair completion this fragment belongs to — a single counter on
    #: the port, incremented once per streaming LLM call for this run (draft's own
    #: retry-on-bad-structure loop and each repair call share it), so a client can
    #: tell "this is a fresh attempt" from "more of the one already showing" without
    #: threading stage/role through every delta.
    attempt: int = Field(ge=1)


class NotebookLiveCell(BaseModel):
    """One cell as parsed so far from a streaming draft — already redacted the way
    `NotebookSpec.for_learner()` redacts a finished one (same reason as
    `NotebookDraftDelta`)."""

    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["markdown", "code"]
    role: str | None = None
    source: str = ""


class NotebookDraftParsed(_EventBase):
    """The draft's cells, once the streamed text parses as notebook source — the live
    view's replacement for the incremental parse it does itself from raw
    `notebook.draft.delta` text, with the roles and structure the incremental parse
    cannot see (a partial cell has no closing marker yet)."""

    type: Literal["notebook.draft.parsed"] = "notebook.draft.parsed"
    cells: list[NotebookLiveCell] = Field(default_factory=list)


class NotebookLiveCellResult(BaseModel):
    """One cell's execution outcome, status and error name/value only — no stdout, no
    outputs, no figures. What raised is often exactly what a graded cell's assertion
    was checking, so even this is not risk-free for a non-author viewer; see the
    "Live" lane's report for the residual flag this carries forward rather than
    resolves."""

    model_config = ConfigDict(extra="forbid")

    id: str
    status: Literal["ok", "error", "skipped", "not_run"]
    ename: str | None = None
    evalue: str | None = None
    duration_ms: int = Field(default=0, ge=0)
    #: A `role=check` cell's verdict (`CellResult.check.status`), judged on the worker
    #: right after the dispatch; `None` for every other cell. Status only, like the rest
    #: of this event: the full verdict is in the stored report.
    check: Literal["pass", "fail", "inconclusive"] | None = None


class NotebookCells(_EventBase):
    """Every code cell's result after one sandbox dispatch — the initial run and each
    repair's rerun alike, so "attempt" counts dispatches of `NotebookPorts.run_notebook`
    for this run, not repairs specifically (a repair attempt and an execute attempt are
    different counters watching the same loop)."""

    type: Literal["notebook.cells"] = "notebook.cells"
    attempt: int = Field(ge=1)
    ok: bool
    cells: list[NotebookLiveCellResult] = Field(default_factory=list)


class NotebookRepair(_EventBase):
    """A repair's own lifecycle, cell-scoped: distinct from the generic
    `stage.started`/`stage.finished(stage=GENERATE)` pair `ProductionNotebookPorts.observe`
    already emits for `notebook.repair`, which names no cell. `source` (the repaired
    cell's new text) is carried only on `status="finished"`, and only when that cell is
    not graded/solution-only — the same redaction `NotebookDraftDelta` applies, reused
    rather than re-derived because a cell being repaired is read from the SAME spec
    `for_learner()` would redact."""

    type: Literal["notebook.repair"] = "notebook.repair"
    cell_id: str
    status: Literal["started", "finished", "failed"] = "started"
    #: "<ename>: <evalue>" of the error this repair addresses (started/finished), or
    #: the provider failure's own message when the repair's LLM call itself failed
    #: (failed) — two different failures sharing one field because a client shows
    #: exactly one error string per repair regardless of which kind it is.
    error: str | None = None
    attempt: int = Field(ge=1)
    of: int = Field(ge=1)
    #: `True` when the linter proved this cell would fail before any sandbox time was
    #: spent on it (`leona_notebooks.pipeline._first_definite_finding`), mirroring
    #: `RepairContext.before_running`.
    before_running: bool = False
    source: str | None = None


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
    source: Literal["plan_static", "openqasm", "compiler"]
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


class SynthesisResultEvent(_EventBase):
    """Every compiler the targeted-synthesis lane tried for one request, each
    independently checked for equivalence. The second, target-aware entry
    point into the same trusted compiler lane ``compilation.result`` reports
    on; unlike that event this one always carries every attempted compiler,
    not one selected candidate.

    ``result`` is populated exactly when ``accepted`` is true — a
    request-level refusal (an unrecognised device, a malformed target) has
    no candidates to report, only ``reason``.
    """

    type: Literal["synthesis.result"] = "synthesis.result"
    accepted: bool
    reason: str | None = None
    result: SynthesisResult | None = None

    @model_validator(mode="after")
    def result_present_iff_accepted(self) -> "SynthesisResultEvent":
        if self.accepted and self.result is None:
            raise ValueError("an accepted synthesis result states its result")
        if not self.accepted and self.result is not None:
            raise ValueError("a refused synthesis request states no result")
        return self


class CodeVariant(BaseModel):
    """A deterministic, copyable selected-framework source variant."""

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
    """Provenance for optional OpenQASM interchange from a protected sandbox result.

    ``sandbox_epilogue`` is Majorana's observed serialization of ``FINAL_CIRCUIT``;
    ``model_stdout`` is retained only for replaying legacy events.
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
    result: dict[str, Any] = Field(
        default_factory=dict,
        description="Bounded JSON result captured from the protected sandbox sidecar.",
    )
    stdout: str
    stderr: str
    truncated: bool = False
    qasm_emission: QasmEmission | None = None


class VerificationResult(_EventBase):
    type: Literal["verification.result"] = "verification.result"
    method: VerificationMethod
    result: VerificationResultKind
    details: dict[str, Any] = Field(default_factory=dict)
    attempt_id: UUID | None = None
    candidate_id: UUID | None = None
    source_fingerprint: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    attempt_seq: int | None = Field(default=None, ge=1)
    check_index: int | None = Field(default=None, ge=0)


class SemanticReviewRecorded(_EventBase):
    type: Literal["verification.semantic_review"] = "verification.semantic_review"
    review_id: UUID
    candidate_id: UUID
    execution_id: UUID
    attempt_seq: int = Field(ge=1)
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    decision: SemanticReviewDecision
    reason_code: str = Field(min_length=1, max_length=120)
    failure_class: VerificationFailureClass | None = None
    retry_target: RetryTarget
    confidence: Literal["high", "medium", "low"] | None = None
    severity: Literal["none", "minor", "major", "blocking"] | None = None
    feedback: dict[str, Any] = Field(default_factory=dict)


class StrictVerificationRecorded(_EventBase):
    type: Literal["verification.strict_attempt"] = "verification.strict_attempt"
    attempt_id: UUID
    candidate_id: UUID
    execution_id: UUID
    semantic_review_id: UUID
    attempt_seq: int = Field(ge=1)
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    decision: VerifierDecision
    evidence_strength: EvidenceStrength | None = None
    reason_code: str = Field(min_length=1, max_length=120)
    candidate_defect_observed: bool
    failure_class: VerificationFailureClass | None = None
    retry_target: RetryTarget
    claim_coverage: list[dict[str, Any]] = Field(default_factory=list)
    unverified_claims: list[str] = Field(default_factory=list, max_length=50)
    verifier_version: str = Field(min_length=1, max_length=120)


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


class RunBestEffort(_EventBase):
    """The best candidate a run produced when it ended without one passing
    verification.

    Emitted instead of nothing. The loop pays for up to four candidates, ranks them
    against each other nowhere, and used to end a spent budget with a bare failure —
    the worst possible output for a user who waited. This carries the code anyway,
    with the evidence that stopped it.

    Budget exhaustion is the case it was built for, but it is emitted on any agent
    failure that left candidates behind: a run that died some other way still leaves
    the user with the same nothing. `exhausted_budget` is therefore nullable and
    carries whatever the runtime recorded, which is not always a budget.

    It is deliberately NOT an artifact and never becomes one: `verified` is a literal
    False, publication still requires a verification PASS, and nothing here is
    written to the Vault. The event says "this is the closest we got, and here is
    exactly what is wrong with it", which is a different claim from "this works".
    """

    type: Literal["run.best_effort"] = "run.best_effort"
    verified: Literal[False] = False
    language: str = Field(min_length=1, max_length=40)
    code: str = Field(min_length=1)
    revision: int = Field(ge=1)
    candidates_considered: int = Field(ge=1)
    exhausted_budget: str | None = Field(
        default=None,
        description=(
            "Why the loop gave up, usually a budget, e.g. candidate_budget_exhausted. "
            "Null when the runtime recorded no reason."
        ),
    )
    failed_checks: list[str] = Field(default_factory=list, max_length=30)
    critic_summary: str | None = Field(default=None, max_length=2_000)
    residual_risks: list[str] = Field(default_factory=list, max_length=20)


class RunErrorEvent(_EventBase):
    type: Literal["run.error"] = "run.error"
    stage: Stage | None = None
    code: str = Field(description="Machine-readable error code (RFC 9457 style)")
    message: str


class RunFinished(_EventBase):
    type: Literal["run.finished"] = "run.finished"
    status: RunStatus
    verifier_decision: VerifierDecision | None = None
    # What the decision was proved by. `pass` alone does not distinguish a run
    # compared against the physics from one whose only check read a dict key, and
    # this event is the durable, replayable record the run page reads.
    evidence_strength: EvidenceStrength | None = None
    verification_summary: VerificationSummary | None = None
    residual_risks: str | None = None
    reason_code: str | None = Field(
        default=None,
        min_length=1,
        max_length=120,
        description=(
            "Machine-readable terminal reason. Optional only for replaying historical events; "
            "current failed terminal writes require it at the repository boundary."
        ),
    )


RunEvent = Annotated[
    RunQueued
    | RunStarted
    | RunModeResolved
    | StageStarted
    | StageFinished
    | PlanProduced
    | ResearchCompleted
    | LlmCall
    | LlmDelta
    | ChatDelta
    | ChatCompleted
    | ChatError
    | ConversationTitled
    | QappGenerated
    | NotebookGrades
    | NotebookDraftDelta
    | NotebookDraftParsed
    | NotebookCells
    | NotebookRepair
    | CodeGenerated
    | ScreenResult
    | ResourceEstimateResult
    | CompilationResult
    | SynthesisResultEvent
    | CodeFinalized
    | SandboxResult
    | VerificationResult
    | SemanticReviewRecorded
    | StrictVerificationRecorded
    | BaselineResult
    | ExportClassified
    | ArtifactSaved
    | RunAnalysis
    | RunDiagnosed
    | RunRestarted
    | RunBestEffort
    | RunErrorEvent
    | RunFinished,
    Field(discriminator="type"),
]

run_event_adapter: TypeAdapter[RunEvent] = TypeAdapter(RunEvent)
