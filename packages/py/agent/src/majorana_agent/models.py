"""Durable domain records for framework-native circuit generation.

Every record is immutable at the orchestration boundary.  A repair creates a new
candidate revision; execution and verification evidence bind to the exact source
fingerprint instead of accepting source or results resubmitted by the model.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from majorana_contracts.enums import (
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
)
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram
from pydantic import BaseModel, ConfigDict, Field, model_validator


class _Record(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AgentState(StrEnum):
    """Persisted step states.

    New runs emit only the fixed-pipeline subset. Historical values remain so
    repository readers can decode old completed steps without reviving their
    orchestration engine.
    """

    NEW = "new"
    PLANNED = "planned"
    EXECUTED = "executed"
    REVIEWED = "reviewed"
    READY_FOR_STRICT_VERIFICATION = "ready_for_strict_verification"
    REPAIR_REQUIRED = "repair_required"
    REPLAN_REQUIRED = "replan_required"
    RESOURCE_EXHAUSTED = "resource_exhausted"
    VERIFIED = "verified"
    INCONCLUSIVE = "inconclusive"
    QASM_ATTEMPTED = "qasm_attempted"
    PUBLISHED = "published"
    MATERIALIZED = "materialized"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CandidateStatus(StrEnum):
    """Persisted candidate statuses, including read-only historical values."""

    CREATED = "created"
    EXECUTED = "executed"
    REVIEWED = "reviewed"
    REPAIR_REQUIRED = "repair_required"
    RESOURCE_EXHAUSTED = "resource_exhausted"
    VERIFIED = "verified"
    INCONCLUSIVE = "inconclusive"
    MATERIALIZED = "materialized"
    PUBLISHED = "published"


class ExecutionFailureKind(StrEnum):
    CODE_ERROR = "code_error"
    TIMEOUT = "timeout"
    MEMORY_EXHAUSTED = "memory_exhausted"
    RESOURCE_LIMIT = "resource_limit"


class ToolName(StrEnum):
    """Persisted step names, including read-only historical values."""

    REQUEST_PLAN = "request_plan"
    REPLAN = "replan"
    SIMULATE_QISKIT = "simulate_qiskit"
    SIMULATE_CIRQ = "simulate_cirq"
    SIMULATE_PENNYLANE = "simulate_pennylane"
    VERIFY_INTENT_ALIGNMENT = "verify_intent_alignment"
    REVIEW_CANDIDATE = "review_candidate"
    STRICT_VERIFY = "strict_verify"
    CONVERT_TO_OPENQASM = "convert_to_openqasm"
    PUBLISH_ARTIFACT = "publish_artifact"
    MATERIALIZE_ARTIFACT = "materialize_artifact"


class ToolCall(_Record):
    tool_call_id: str = Field(min_length=1, max_length=200)
    name: ToolName
    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolResult(_Record):
    tool_call_id: str
    name: ToolName
    ok: bool
    state: AgentState
    payload: dict[str, Any] = Field(default_factory=dict)
    error_code: str | None = None
    error_message: str | None = None


def _plan_fingerprint(plan: Plan) -> str:
    canonical = json.dumps(plan.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


class PlanRevision(_Record):
    plan_id: UUID
    run_id: UUID
    revision: int = Field(ge=1)
    parent_plan_id: UUID | None = None
    plan: Plan
    plan_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    replan_reason: str | None = Field(default=None, min_length=1, max_length=2_000)

    @model_validator(mode="after")
    def revision_chain_and_fingerprint_are_valid(self) -> "PlanRevision":
        if self.revision == 1 and self.parent_plan_id is not None:
            raise ValueError("first Plan revision cannot have a parent")
        if self.revision > 1 and self.parent_plan_id is None:
            raise ValueError("revised Plan must reference its parent")
        if self.revision == 1 and self.replan_reason is not None:
            raise ValueError("first Plan revision cannot have a replan reason")
        if self.revision > 1 and self.replan_reason is None:
            raise ValueError("revised Plan requires a replan reason")
        if self.plan_fingerprint != _plan_fingerprint(self.plan):
            raise ValueError("plan_fingerprint does not match Plan content")
        return self


class CandidateRevision(_Record):
    candidate_id: UUID
    run_id: UUID
    tool_call_id: str = Field(min_length=1, max_length=200)
    revision: int = Field(ge=1)
    parent_candidate_id: UUID | None = None
    plan_id: UUID
    framework: Framework
    source: str = Field(min_length=1, max_length=200_000)
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    status: CandidateStatus = CandidateStatus.CREATED

    @model_validator(mode="after")
    def fingerprint_matches_source(self) -> "CandidateRevision":
        actual = FrameworkProgram(framework=self.framework, source=self.source).fingerprint
        if self.source_fingerprint != actual:
            raise ValueError("source_fingerprint does not match framework-native source")
        if self.revision == 1 and self.parent_candidate_id is not None:
            raise ValueError("first candidate revision cannot have a parent")
        if self.revision > 1 and self.parent_candidate_id is None:
            raise ValueError("repair revisions must reference their parent candidate")
        return self


class ExecutionEvidence(_Record):
    execution_id: UUID
    candidate_id: UUID
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    environment_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    sandbox_provider: str = Field(min_length=1, max_length=100)
    exit_code: int
    failure_kind: ExecutionFailureKind | None = None
    duration_ms: int = Field(ge=0)
    result: dict[str, Any] = Field(default_factory=dict)
    observation: dict[str, Any] = Field(default_factory=dict)

    @property
    def succeeded(self) -> bool:
        return self.exit_code == 0

    @property
    def resource_exhausted(self) -> bool:
        return self.failure_kind in {
            ExecutionFailureKind.MEMORY_EXHAUSTED,
            ExecutionFailureKind.RESOURCE_LIMIT,
        }

    @property
    def was_not_run(self) -> bool:
        """Whether trusted preflight skipped execution for backend capacity.

        A generic resource failure is not enough: code that started and exhausted
        memory must still fail.  Artifact-only delivery is reserved for a provider-
        authored preflight decision that records zero sandbox runs.
        """

        reason_code = self.observation.get("execution_reason_code")
        return (
            self.exit_code != 0
            and self.failure_kind is ExecutionFailureKind.RESOURCE_LIMIT
            and self.duration_ms == 0
            and not self.result
            and self.observation.get("execution_status") == "not_run"
            and self.observation.get("sandbox_runs") == 0
            and isinstance(reason_code, str)
            and bool(reason_code.strip())
        )

    @model_validator(mode="after")
    def failure_kind_matches_exit(self) -> "ExecutionEvidence":
        if self.exit_code == 0 and self.failure_kind is not None:
            raise ValueError("successful execution cannot have a failure_kind")
        if self.exit_code != 0 and self.failure_kind is None:
            raise ValueError("failed execution requires a failure_kind")
        return self


@dataclass(frozen=True)
class ExecutionOutput:
    """Raw output returned by the single sandbox execution adapter."""

    environment_fingerprint: str
    sandbox_provider: str
    exit_code: int
    duration_ms: int
    result: dict[str, Any]
    observation: dict[str, Any]
    failure_kind: ExecutionFailureKind | None = None


class SemanticReviewEvidence(_Record):
    review_id: UUID
    candidate_id: UUID
    execution_id: UUID
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    attempt_seq: int = Field(ge=1)
    decision: SemanticReviewDecision
    confidence: Literal["high", "medium", "low"] | None = None
    severity: Literal["none", "minor", "major", "blocking"] | None = None
    reason_code: str = Field(min_length=1, max_length=120)
    failure_class: VerificationFailureClass | None = None
    retry_target: RetryTarget
    feedback: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def routing_is_typed(self) -> "SemanticReviewEvidence":
        expected = {
            SemanticReviewDecision.READY: (None, RetryTarget.NONE),
            SemanticReviewDecision.CODE_REPAIR: (
                VerificationFailureClass.CANDIDATE_DEFECT,
                RetryTarget.CODE_GENERATION,
            ),
            SemanticReviewDecision.REPLAN: (
                VerificationFailureClass.PLAN_DEFECT,
                RetryTarget.PLANNING,
            ),
        }.get(self.decision)
        if expected is not None and (self.failure_class, self.retry_target) != expected:
            raise ValueError("semantic review decision has inconsistent typed routing")
        if (
            self.decision is SemanticReviewDecision.INCONCLUSIVE
            and self.failure_class is VerificationFailureClass.CANDIDATE_DEFECT
        ):
            raise ValueError("inconclusive semantic review cannot blame the candidate")
        return self

    def evidence_is_complete(self) -> bool:
        """Is this candidate's TRUSTED evidence complete, whatever the reviewer decided?

        Only evidence the model cannot author counts: every deterministic check
        recorded against the candidate passed, and the reviewer found no blocking or
        major defect. The reviewer's `decision` is deliberately excluded — a reviewer
        that keeps requesting improvements is expressing a preference, not
        contradicting the evidence.

        Lives on the record rather than in the pipeline because the durable stores
        enforce the same rule before they will write a conversion or a
        materialization. Keeping one definition is what stops the store's fail-closed
        guard from encoding a policy the orchestrator has since changed — which is
        exactly what happened when the guard still demanded READY.
        """

        if self.severity in {"major", "blocking"}:
            return False
        checks = self.feedback.get("basic_checks")
        if not isinstance(checks, list) or not checks:
            return False
        return all(isinstance(check, dict) and check.get("result") == "pass" for check in checks)

    def is_deliverable(self) -> bool:
        """May this review's candidate be exported and saved?"""
        # READY is advisory model output, not a substitute for trusted checks.
        # Production review construction records the checks before this boundary;
        # missing or failed evidence must therefore fail closed for every decision.
        return self.evidence_is_complete()

    def assert_binding(self, candidate: "CandidateRevision", execution: ExecutionEvidence) -> None:
        if self.candidate_id != candidate.candidate_id:
            raise ValueError("semantic review references a different candidate")
        if self.execution_id != execution.execution_id:
            raise ValueError("semantic review references a different execution")
        if execution.candidate_id != candidate.candidate_id:
            raise ValueError("execution references a different candidate")
        if not (
            self.source_fingerprint == execution.source_fingerprint == candidate.source_fingerprint
        ):
            raise ValueError("semantic review evidence fingerprint mismatch")


class ConversionEvidence(_Record):
    candidate_id: UUID
    execution_id: UUID
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    status: Literal["available", "unavailable"]
    qasm: str | None = None
    reason: str | None = None

    @model_validator(mode="after")
    def availability_is_consistent(self) -> "ConversionEvidence":
        if self.status == "available" and not self.qasm:
            raise ValueError("available conversion requires OpenQASM")
        if self.status == "unavailable" and self.qasm is not None:
            raise ValueError("unavailable conversion cannot contain OpenQASM")
        return self


class MaterializedArtifact(_Record):
    """A private immutable Studio version; it is not a publication claim."""

    artifact_id: UUID
    version_id: UUID
    version_seq: int = Field(ge=1)
    candidate_id: UUID
    framework: Framework
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    execution_status: Literal["executed", "not_run"] = "executed"
