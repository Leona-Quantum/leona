"""API-facing resource models mirroring plans/rebuild/04-database.md §2. These are
the /v1 response shapes, not ORM rows — the repository layer maps between them."""

from datetime import datetime
from typing import Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .enums import (
    ExportStatus,
    Framework,
    Role,
    RunMode,
    RunStatus,
    VerificationMethod,
    VerificationResultKind,
    VerifierDecision,
    Visibility,
    WorkspaceKind,
)


class _ResourceBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Workspace(_ResourceBase):
    id: UUID
    kind: WorkspaceKind
    name: str
    owner_user_id: UUID
    plan: str
    created_at: datetime
    deleted_at: datetime | None = None


class WorkspaceMember(_ResourceBase):
    user_id: UUID
    email: str
    display_name: str | None = None
    role: Role
    created_at: datetime


class WorkspaceOverview(_ResourceBase):
    workspace: Workspace
    members: list[WorkspaceMember]
    artifact_count: int = Field(ge=0)
    run_count: int = Field(ge=0)


class WorkspaceFolder(_ResourceBase):
    id: UUID
    workspace_id: UUID
    name: str = Field(min_length=1, max_length=80)
    created_at: datetime
    updated_at: datetime


class Artifact(_ResourceBase):
    id: UUID
    workspace_id: UUID
    slug: str = Field(description="Unique; used for public pages")
    title: str
    family: str = Field(description="Algorithm category")
    framework: Framework
    visibility: Visibility
    parent_artifact_id: UUID | None = Field(default=None, description="Provenance edge")
    current_version_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class ArtifactVersion(_ResourceBase):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "allOf": [
                {
                    "if": {
                        "required": ["qasm"],
                        "properties": {"qasm": {"type": "string"}},
                    },
                    "then": {
                        "required": ["qasm_version"],
                        "properties": {"qasm_version": {"const": "3.0"}},
                    },
                }
            ]
        },
    )

    id: UUID
    artifact_id: UUID
    seq: int = Field(ge=1)
    qasm_version: Literal["3.0"] | None = Field(
        default=None, description="OpenQASM language version; 3.0 for new circuit artifacts"
    )
    qasm: str | None = Field(default=None, description="Canonical circuit source of truth")
    metadata: dict[str, Any] | None = Field(
        default=None,
        description="Provenance and legacy migration data; never the canonical circuit source",
    )
    code: str
    code_lang: str
    fingerprint: str = Field(description="Unique per artifact; dedupes identical versions")
    export_status: ExportStatus
    export_reason: str | None = None
    framework_variants: dict[str, str] | None = None
    resource_estimates: dict[str, Any] | None = None
    limitations: str | None = None
    created_at: datetime

    @model_validator(mode="after")
    def validate_qasm_version(self) -> Self:
        """Require canonical QASM text and its version marker to appear together."""
        if self.qasm is None and self.qasm_version is not None:
            raise ValueError("qasm_version must be null when qasm is null")
        if self.qasm is not None and self.qasm_version != "3.0":
            raise ValueError('qasm_version must be "3.0" when qasm is present')
        return self


class ResourceMetrics(_ResourceBase):
    """Comparable circuit-resource measurements recorded before and after compilation."""

    qubits: int = Field(ge=0)
    depth: int | None = Field(default=None, ge=0)
    gate_count: int | None = Field(default=None, ge=0)
    two_qubit_gate_count: int | None = Field(default=None, ge=0)
    measurement_count: int | None = Field(default=None, ge=0)
    estimated_runtime_ms: int | None = Field(default=None, ge=0)


class Run(_ResourceBase):
    id: UUID
    conversation_id: UUID
    workspace_id: UUID
    user_id: UUID
    artifact_version_id: UUID | None = None
    folder_id: UUID | None = None
    task_prompt: str
    mode: RunMode
    status: RunStatus
    framework: Framework
    seed: int | None = None
    shots: int | None = None
    tolerances: dict[str, float] | None = None
    timeout_s: int | None = None
    sandbox_provider: str | None = None
    sandbox_meta: dict[str, Any] | None = Field(
        default=None, description="Duration, memory, exit code as reported by the provider"
    )
    verifier_decision: VerifierDecision | None = None
    residual_risks: str | None = None
    baseline: dict[str, Any] | None = Field(
        default=None, description="Baseline result, or {not_applicable_reason}"
    )
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ConversationTurn(_ResourceBase):
    run: Run
    events: list[dict[str, Any]] = Field(default_factory=list)


class Conversation(_ResourceBase):
    id: UUID
    workspace_id: UUID
    turns: list[ConversationTurn] = Field(default_factory=list)


class VerificationRecord(_ResourceBase):
    id: UUID
    run_id: UUID
    method: VerificationMethod
    params: dict[str, Any]
    result: VerificationResultKind
    details: dict[str, Any]
    created_at: datetime
