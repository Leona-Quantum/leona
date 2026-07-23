"""Durable domain records for framework-native circuit generation.

Every record is immutable at the orchestration boundary.  A repair creates a new
candidate revision; execution and verification evidence bind to the exact source
fingerprint instead of accepting source or results resubmitted by the model.
"""

from __future__ import annotations

import hashlib
import json
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from majorana_contracts.enums import (
    EvidenceStrength,
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerifierDecision,
)
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram
from pydantic import BaseModel, ConfigDict, Field, model_validator


class _Record(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AgentState(StrEnum):
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


SIMULATION_TOOL_BY_FRAMEWORK: dict[Framework, ToolName] = {
    Framework.QISKIT: ToolName.SIMULATE_QISKIT,
    Framework.CIRQ: ToolName.SIMULATE_CIRQ,
    Framework.PENNYLANE: ToolName.SIMULATE_PENNYLANE,
}


class AgentBudget(_Record):
    # Overall circuit breaker. It must sit above the sum of useful per-lane
    # attempts now that review and strict verification are distinct durable steps.
    max_steps: int = Field(default=32, ge=1, le=64)
    max_candidates: int = Field(default=4, ge=1, le=12)
    max_plan_attempts: int = Field(default=4, ge=1, le=12)
    max_plan_revisions: int = Field(default=3, ge=1, le=8)
    max_sandbox_runs: int = Field(default=6, ge=1, le=20)
    max_semantic_review_attempts: int = Field(default=8, ge=1, le=12)
    max_strict_attempts: int = Field(default=8, ge=1, le=12)
    max_conversions: int = Field(default=3, ge=0, le=8)


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


class PlanRecord(_Record):
    plan_id: UUID
    run_id: UUID
    plan: Plan


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
    execution_id: UUID | None = None
    verification_id: UUID | None = None

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

    @model_validator(mode="after")
    def failure_kind_matches_exit(self) -> "ExecutionEvidence":
        if self.exit_code == 0 and self.failure_kind is not None:
            raise ValueError("successful execution cannot have a failure_kind")
        if self.exit_code != 0 and self.failure_kind is None:
            raise ValueError("failed execution requires a failure_kind")
        return self


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


class StrictVerificationAttempt(_Record):
    attempt_id: UUID
    candidate_id: UUID
    execution_id: UUID
    semantic_review_id: UUID
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    attempt_seq: int = Field(ge=1)
    checks: list[dict[str, Any]] = Field(default_factory=list)
    decision: VerifierDecision
    evidence_strength: EvidenceStrength | None = None
    claim_coverage: list[dict[str, Any]] = Field(default_factory=list)
    reason_code: str = Field(min_length=1, max_length=120)
    candidate_defect_observed: bool
    failure_class: VerificationFailureClass | None = None
    retry_target: RetryTarget
    unverified_claims: list[str] = Field(default_factory=list, max_length=50)
    verifier_version: str = Field(min_length=1, max_length=120)

    @model_validator(mode="after")
    def inconclusive_never_establishes_a_candidate_defect(self) -> "StrictVerificationAttempt":
        if self.decision is VerifierDecision.INCONCLUSIVE and self.candidate_defect_observed:
            raise ValueError("inconclusive verification cannot establish a candidate defect")
        if (
            self.decision is VerifierDecision.INCONCLUSIVE
            and self.failure_class is VerificationFailureClass.CANDIDATE_DEFECT
        ):
            raise ValueError("inconclusive verification cannot classify a candidate defect")
        if self.decision is VerifierDecision.PASS and (
            self.failure_class is not None
            or self.retry_target is not RetryTarget.NONE
            or self.candidate_defect_observed
        ):
            raise ValueError("passing verification cannot carry failure routing")
        if self.decision is VerifierDecision.FAIL:
            expected = {
                VerificationFailureClass.CANDIDATE_DEFECT: (
                    RetryTarget.CODE_GENERATION,
                    True,
                ),
                VerificationFailureClass.PLAN_DEFECT: (RetryTarget.PLANNING, False),
            }.get(self.failure_class)
            if expected is None or (self.retry_target, self.candidate_defect_observed) != expected:
                raise ValueError("failed verification has inconsistent typed routing")
        return self

    def assert_binding(
        self,
        candidate: "CandidateRevision",
        execution: ExecutionEvidence,
        review: SemanticReviewEvidence,
    ) -> None:
        review.assert_binding(candidate, execution)
        if self.candidate_id != candidate.candidate_id:
            raise ValueError("strict verification references a different candidate")
        if self.execution_id != execution.execution_id:
            raise ValueError("strict verification references a different execution")
        if self.semantic_review_id != review.review_id:
            raise ValueError("strict verification references a different semantic review")
        if not (
            self.source_fingerprint
            == review.source_fingerprint
            == execution.source_fingerprint
            == candidate.source_fingerprint
        ):
            raise ValueError("strict verification evidence fingerprint mismatch")


class RepairInstruction(_Record):
    category: str = Field(min_length=1, max_length=120)
    evidence: list[str] = Field(default_factory=list, max_length=20)
    repairs: list[str] = Field(default_factory=list, max_length=20)
    preserve_invariants: list[str] = Field(default_factory=list, max_length=20)
    required_rechecks: list[str] = Field(default_factory=list, max_length=20)
    # How bad, and how sure. The verifier's gate already turns on these two —
    # a low-confidence pass and a blocking mismatch are both rejections — but
    # until 2026-07-20 neither reached the repair, so every rejection arrived
    # framed identically. They are optional because a deterministic failure has
    # no confidence to report.
    severity: Literal["none", "minor", "major", "blocking"] | None = None
    confidence: Literal["high", "medium", "low"] | None = None
    failure_class: VerificationFailureClass | None = None
    retry_target: RetryTarget | None = None


class VerificationEvidence(_Record):
    verification_id: UUID
    candidate_id: UUID
    execution_id: UUID
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    decision: VerifierDecision
    deterministic_checks: list[dict[str, Any]] = Field(default_factory=list)
    critic: dict[str, Any] | None = None
    repair: RepairInstruction | None = None

    @model_validator(mode="after")
    def failure_requires_repair(self) -> "VerificationEvidence":
        if self.decision is VerifierDecision.FAIL and self.repair is None:
            raise ValueError("failed verification requires a repair instruction")
        if self.decision is VerifierDecision.PASS and self.repair is not None:
            raise ValueError("passed verification cannot request repair")
        return self


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


class PublishedArtifact(_Record):
    artifact_id: UUID
    version_id: UUID
    version_seq: int = Field(ge=1)
    candidate_id: UUID
    framework: Framework
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")


class MaterializedArtifact(_Record):
    """A private immutable Studio version; it is not a publication claim."""

    artifact_id: UUID
    version_id: UUID
    version_seq: int = Field(ge=1)
    candidate_id: UUID
    framework: Framework
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
