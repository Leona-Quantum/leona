"""API-facing resource models mirroring plans/rebuild/04-database.md §2. These are
the /v1 response shapes, not ORM rows — the repository layer maps between them."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

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
    id: UUID
    artifact_id: UUID
    seq: int = Field(ge=1)
    ir_version: str
    ir: dict[str, Any]
    code: str
    code_lang: str
    fingerprint: str = Field(description="Unique per artifact; dedupes identical versions")
    export_status: ExportStatus
    export_reason: str | None = None
    qasm: str | None = None
    framework_variants: dict[str, str] | None = None
    resource_estimates: dict[str, Any] | None = None
    limitations: str | None = None
    created_at: datetime


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
    workspace_id: UUID
    user_id: UUID
    artifact_version_id: UUID | None = None
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


class VerificationRecord(_ResourceBase):
    id: UUID
    run_id: UUID
    method: VerificationMethod
    params: dict[str, Any]
    result: VerificationResultKind
    details: dict[str, Any]
    created_at: datetime
