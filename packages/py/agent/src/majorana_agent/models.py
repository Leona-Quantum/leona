"""Durable domain records for framework-native circuit generation.

Every record is immutable at the orchestration boundary.  A repair creates a new
candidate revision; execution and verification evidence bind to the exact source
fingerprint instead of accepting source or results resubmitted by the model.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from majorana_contracts.enums import Framework, VerifierDecision
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram
from pydantic import BaseModel, ConfigDict, Field, model_validator


class _Record(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AgentState(StrEnum):
    NEW = "new"
    PLANNED = "planned"
    EXECUTED = "executed"
    REPAIR_REQUIRED = "repair_required"
    RESOURCE_EXHAUSTED = "resource_exhausted"
    VERIFIED = "verified"
    QASM_ATTEMPTED = "qasm_attempted"
    PUBLISHED = "published"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CandidateStatus(StrEnum):
    CREATED = "created"
    EXECUTED = "executed"
    REPAIR_REQUIRED = "repair_required"
    RESOURCE_EXHAUSTED = "resource_exhausted"
    VERIFIED = "verified"
    PUBLISHED = "published"


class ExecutionFailureKind(StrEnum):
    CODE_ERROR = "code_error"
    TIMEOUT = "timeout"
    MEMORY_EXHAUSTED = "memory_exhausted"
    RESOURCE_LIMIT = "resource_limit"


class ToolName(StrEnum):
    REQUEST_PLAN = "request_plan"
    SIMULATE_QISKIT = "simulate_qiskit"
    SIMULATE_CIRQ = "simulate_cirq"
    SIMULATE_PENNYLANE = "simulate_pennylane"
    VERIFY_INTENT_ALIGNMENT = "verify_intent_alignment"
    CONVERT_TO_OPENQASM = "convert_to_openqasm"
    PUBLISH_ARTIFACT = "publish_artifact"


SIMULATION_TOOL_BY_FRAMEWORK: dict[Framework, ToolName] = {
    Framework.QISKIT: ToolName.SIMULATE_QISKIT,
    Framework.CIRQ: ToolName.SIMULATE_CIRQ,
    Framework.PENNYLANE: ToolName.SIMULATE_PENNYLANE,
}


class AgentBudget(_Record):
    max_steps: int = Field(default=14, ge=1, le=64)
    max_candidates: int = Field(default=4, ge=1, le=12)
    max_sandbox_runs: int = Field(default=6, ge=1, le=20)
    max_verifications: int = Field(default=4, ge=1, le=12)
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
