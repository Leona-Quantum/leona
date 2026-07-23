"""API-facing resource models mirroring plans/rebuild/04-database.md §2. These are
the /v1 response shapes, not ORM rows — the repository layer maps between them."""

from datetime import datetime
from typing import Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .enums import (
    EvidenceStrength,
    ExportStatus,
    Framework,
    Role,
    RunMode,
    RunStatus,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerificationMethod,
    VerificationResultKind,
    VerifierDecision,
    Visibility,
    WorkspaceKind,
)


class _ResourceBase(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VerificationSummary(_ResourceBase):
    """Typed final verification state shared by events and API resources.

    The object is optional on legacy resources, but every newly written summary is
    complete enough to explain the decision without inferring trust from absence.
    """

    decision: VerifierDecision
    semantic_review_decision: SemanticReviewDecision | None = None
    evidence_strength: EvidenceStrength | None = None
    reason_code: str = Field(min_length=1, max_length=120)
    candidate_defect_observed: bool
    failure_class: VerificationFailureClass | None = None
    retry_target: RetryTarget
    unverified_claims: list[str] = Field(default_factory=list, max_length=50)
    checks: list["VerificationCheckSummary"] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def inconclusive_never_blames_the_candidate(self) -> Self:
        if self.decision is VerifierDecision.INCONCLUSIVE and self.candidate_defect_observed:
            raise ValueError("inconclusive requires candidate_defect_observed=false")
        return self


class VerificationCheckSummary(_ResourceBase):
    """Bounded public projection of one trusted verification check."""

    method: VerificationMethod
    result: VerificationResultKind


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
    # From the current version's verification_summary, carried on the LIST
    # resource so the Vault list can say what each artifact's verdict was proved
    # by without opening it. Until 2026-07-20 the list had no grade at all, so
    # the web fabricated "verified" as the default and an unopened structurally-
    # verified artifact over-claimed until its detail page corrected it. None
    # means the version predates the summary (or there is no version) — absence,
    # not a verdict.
    verifier_decision: VerifierDecision | None = None
    evidence_strength: EvidenceStrength | None = None
    verification_summary: VerificationSummary | None = None
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
        default=None, description="Optional OpenQASM interchange version"
    )
    qasm: str | None = Field(
        default=None,
        description="Optional normalized OpenQASM interchange for framework conversion",
    )
    metadata: dict[str, Any] | None = Field(
        default=None,
        description="Canonical-source role, provenance, and legacy migration data",
    )
    code: str
    code_lang: str
    fingerprint: str = Field(
        description=(
            "Digest of the framework and normalized selected-framework source; "
            "identical source may share a fingerprint across artifact versions"
        )
    )
    export_status: ExportStatus
    export_reason: str | None = None
    framework_variants: dict[str, str] | None = None
    resource_estimates: dict[str, Any] | None = None
    limitations: str | None = None
    verification_summary: VerificationSummary | None = None
    created_at: datetime

    @model_validator(mode="after")
    def validate_qasm_version(self) -> Self:
        """Require canonical QASM text and its version marker to appear together."""
        if self.qasm is None and self.qasm_version is not None:
            raise ValueError("qasm_version must be null when qasm is null")
        if self.qasm is not None and self.qasm_version != "3.0":
            raise ValueError('qasm_version must be "3.0" when qasm is present')
        return self


class CatalogProvenance(_ResourceBase):
    """How a published catalog entry entered the catalog (repository Step 6).

    For the ADR-0019 bootstrap corpus this is the pinned-manifest identity: the
    import provider, the manifest's pinned source commit, the per-item manifest
    identity, and the content hash of the exact source bytes. It anchors the
    entry to reproducible provenance without trusting any field inside `record`.
    """

    import_provider: str | None = None
    upstream_ref: str | None = Field(
        default=None, description="Pinned upstream ref (e.g. the manifest source commit)"
    )
    upstream_identity: str | None = Field(
        default=None, description="Per-item manifest identity; equals the public slug"
    )
    source_blob_sha256: str | None = Field(
        default=None, description="sha256 of the exact stored source bytes"
    )


class PublicCatalogEntry(_ResourceBase):
    """A published catalog record served to anonymous readers (repository Step 6).

    The typed fields are database-authoritative facts: the stable public `slug`
    (the pinned manifest identity), the honest `execution_state`, the update
    timestamp, and reproducible `provenance`. `record` carries the pinned
    catalog source blob verbatim — the rich presentation entry (algorithm
    family, category, classical comparisons, verification prose, code variants,
    localized copy). Everything in `record` is *asserted catalog metadata from
    the pinned source*, NOT passing-run evidence or legal approval (ADR-0019);
    clients must render it as a claim. Only accepted+public records are returned.
    """

    slug: str = Field(description="Stable public identity (pinned manifest identity)")
    execution_state: str = Field(
        description="Authoritative honest lifecycle state; the bootstrap corpus is template_only"
    )
    updated_at: datetime
    provenance: CatalogProvenance | None = None
    record: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Pinned catalog source record (the rich presentation entry). A source "
            "claim from the pinned manifest, not execution evidence or legal approval."
        ),
    )


class ResourceMetrics(_ResourceBase):
    """Comparable circuit-resource measurements for selected-framework source."""

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
    timeout_s: int | None = None
    sandbox_provider: str | None = None
    sandbox_meta: dict[str, Any] | None = Field(
        default=None, description="Duration, memory, exit code as reported by the provider"
    )
    verifier_decision: VerifierDecision | None = None
    verification_summary: VerificationSummary | None = None
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
