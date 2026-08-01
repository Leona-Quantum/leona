"""SQLAlchemy models mirroring db/migrations/versions/0001_schema_v1.py.

The migration owns constraints, indexes, and server defaults; these mappings
declare only what queries and inserts need. Columns with DB-side defaults
(created_at, ts, status, …) are left unset on insert so Postgres fills them.
"""

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import (
    TIMESTAMP,
    BigInteger,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    LargeBinary,
    Numeric,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

_UUID = UUID(as_uuid=True)


class Base(DeclarativeBase):
    type_annotation_map = {
        uuid.UUID: _UUID,
        dict[str, Any]: JSONB,
        str: Text,
        dt.datetime: TIMESTAMP(timezone=True),
    }


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workos_user_id: Mapped[str] = mapped_column(unique=True)
    email: Mapped[str]
    display_name: Mapped[str | None]
    plan: Mapped[str | None] = mapped_column(server_default="free")
    # Migration 0037. NULL = the personal workspace. A preference, never a grant:
    # re-checked against `memberships` on every request, and a stale value falls
    # back to personal instead of refusing the request.
    active_workspace_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspaces.id"))
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    kind: Mapped[str]
    name: Mapped[str]
    owner_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    plan: Mapped[str | None] = mapped_column(server_default="free")
    # Read at save time (migration 0036). False means a finished run materializes
    # its artifact but leaves it out of the Vault list until the user keeps it.
    auto_keep_artifacts: Mapped[bool] = mapped_column(server_default=text("false"))
    deleted_at: Mapped[dt.datetime | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class Membership(Base):
    __tablename__ = "memberships"

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role: Mapped[str]
    # Migration 0038. Who attached this person, for the notice that tells them.
    # NULL for a membership somebody made for themselves, and for one whose
    # inviter's account has since been deleted.
    invited_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    # Migration 0038. NULL means the person has not been told this membership
    # exists. Written when they open the workspace, dismiss the notice, or leave.
    acknowledged_at: Mapped[dt.datetime | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class WorkspaceFolder(Base):
    __tablename__ = "workspace_folders"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    name: Mapped[str]
    # Migration 0040. User-chosen order for the sidebar. Not unique — ties fall
    # back to (created_at, id), which is the order this table had before, so a
    # collision degrades to the old behaviour rather than to a random one.
    position: Mapped[int] = mapped_column(Integer, server_default="0")
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    slug: Mapped[str] = mapped_column(unique=True)
    title: Mapped[str]
    family: Mapped[str]
    framework: Mapped[str]
    visibility: Mapped[str | None] = mapped_column(server_default="private")
    parent_artifact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("artifacts.id"))
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(_UUID)
    # Catalog classification (migration 0014): NULL for every artifact outside
    # the Step 3 private staging path (repos/catalog.py).
    artifact_kind: Mapped[str | None]
    execution_state: Mapped[str | None]
    review_state: Mapped[str | None]
    publication_state: Mapped[str | None]
    # Migration 0036. NULL = materialized (so the run keeps its conversion tabs
    # and can be forked from) but deliberately NOT in the Vault list. This is
    # separate from deleted_at: never kept is not the same as thrown away.
    kept_at: Mapped[dt.datetime | None]
    deleted_at: Mapped[dt.datetime | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class ArtifactVersion(Base):
    __tablename__ = "artifact_versions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    artifact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("artifacts.id"))
    seq: Mapped[int] = mapped_column(Integer)
    qasm_version: Mapped[str | None]
    qasm: Mapped[str | None]
    artifact_metadata: Mapped[dict[str, Any] | None] = mapped_column("metadata")
    code: Mapped[str]
    code_lang: Mapped[str]
    fingerprint: Mapped[str]
    export_status: Mapped[str]
    export_reason: Mapped[str | None]
    framework_variants: Mapped[dict[str, Any] | None]
    resource_estimates: Mapped[dict[str, Any] | None]
    limitations: Mapped[str | None]
    # Catalog hash fields (migration 0014): NULL outside Step 3 staging. See
    # catalog_hashing.py for source_blob_sha256/normalized_source_hash
    # meanings; normalized_source_hash carries a global UNIQUE constraint.
    metadata_schema_version: Mapped[str | None]
    authoritative_framework: Mapped[str | None]
    authoritative_framework_version: Mapped[str | None]
    source_language: Mapped[str | None]
    source_blob_sha256: Mapped[str | None]
    normalized_source_hash: Mapped[str | None]
    semantic_fingerprint: Mapped[str | None]
    semantic_fingerprint_algorithm: Mapped[str | None]
    toolchain_digest: Mapped[str | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class ArtifactSource(Base):
    """Provenance (migration 0015): one pinned source record per version."""

    __tablename__ = "artifact_sources"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    artifact_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artifact_versions.id"), unique=True
    )
    source_kind: Mapped[str]
    repository: Mapped[str | None]
    ref: Mapped[str | None]
    path: Mapped[str | None]
    package_version: Mapped[str | None]
    retrieved_at: Mapped[dt.datetime]
    retrieval_metadata: Mapped[dict[str, Any] | None]
    content_hash: Mapped[str]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class LicenseAssertion(Base):
    """Append-only rights ledger (migration 0015): never UPDATEd; a
    correction is a new row with supersedes_assertion_id set."""

    __tablename__ = "license_assertions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    artifact_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("artifact_versions.id"))
    spdx_id: Mapped[str | None]
    assertion_kind: Mapped[str]
    evidence_hash: Mapped[str | None]
    license_scope: Mapped[str]
    confidence: Mapped[float | None] = mapped_column(Numeric)
    reviewer_decision: Mapped[str] = mapped_column(server_default="pending")
    reviewer_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    supersedes_assertion_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("license_assertions.id")
    )
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class ArtifactCitation(Base):
    __tablename__ = "artifact_citations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    artifact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("artifacts.id"))
    doi: Mapped[str | None]
    arxiv_id: Mapped[str | None]
    url: Mapped[str | None]
    specification_ref: Mapped[str | None]
    authors: Mapped[list[str] | None] = mapped_column(JSONB)
    year: Mapped[int | None] = mapped_column(Integer)
    relation: Mapped[str]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class ArtifactTag(Base):
    __tablename__ = "artifact_tags"

    artifact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("artifacts.id"), primary_key=True)
    tag: Mapped[str] = mapped_column(primary_key=True)
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    conversation_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    artifact_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("artifact_versions.id")
    )
    folder_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspace_folders.id"))
    task_prompt: Mapped[str]
    mode: Mapped[str]
    idempotency_key: Mapped[str | None]
    status: Mapped[str | None] = mapped_column(server_default="queued")
    framework: Mapped[str]
    seed: Mapped[int | None] = mapped_column(BigInteger)
    shots: Mapped[int | None] = mapped_column(Integer)
    timeout_s: Mapped[int | None] = mapped_column(Integer)
    sandbox_provider: Mapped[str | None]
    sandbox_meta: Mapped[dict[str, Any] | None]
    verifier_decision: Mapped[str | None]
    verification_summary: Mapped[dict[str, Any] | None]
    residual_risks: Mapped[str | None]
    baseline: Mapped[dict[str, Any] | None]
    started_at: Mapped[dt.datetime | None]
    finished_at: Mapped[dt.datetime | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class RunEvent(Base):
    __tablename__ = "run_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"))
    seq: Mapped[int] = mapped_column(Integer)
    ts: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    type: Mapped[str]
    payload: Mapped[dict[str, Any]]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class VerificationRecord(Base):
    __tablename__ = "verification_records"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"))
    method: Mapped[str]
    params: Mapped[dict[str, Any] | None] = mapped_column(server_default=text("'{}'::jsonb"))
    result: Mapped[str]
    details: Mapped[dict[str, Any] | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class AgentRun(Base):
    __tablename__ = "agent_runs"
    __table_args__ = (
        UniqueConstraint("run_id", "plan_id"),
        ForeignKeyConstraint(
            ["run_id", "current_plan_id"],
            ["run_plans.run_id", "run_plans.id"],
            name="fk_agent_runs_current_plan_same_run",
        ),
    )

    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"), primary_key=True)
    state: Mapped[str] = mapped_column(server_default="new")
    plan_id: Mapped[uuid.UUID | None] = mapped_column(_UUID)
    current_plan_id: Mapped[uuid.UUID | None] = mapped_column(_UUID)
    plan: Mapped[dict[str, Any] | None]
    materialization: Mapped[dict[str, Any] | None]
    publication: Mapped[dict[str, Any] | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class RunPlan(Base):
    __tablename__ = "run_plans"
    __table_args__ = (
        UniqueConstraint("run_id", "revision", name="uq_run_plans_run_revision"),
        UniqueConstraint("run_id", "id", name="uq_run_plans_run_id"),
        ForeignKeyConstraint(
            ["run_id", "parent_plan_id"],
            ["run_plans.run_id", "run_plans.id"],
            name="fk_run_plans_parent_same_run",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agent_runs.run_id"))
    revision: Mapped[int] = mapped_column(Integer)
    parent_plan_id: Mapped[uuid.UUID | None]
    plan: Mapped[dict[str, Any]]
    plan_fingerprint: Mapped[str]
    replan_reason: Mapped[str | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class AgentStep(Base):
    __tablename__ = "agent_steps"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"))
    tool_call_id: Mapped[str]
    name: Mapped[str]
    arguments: Mapped[dict[str, Any]]
    status: Mapped[str] = mapped_column(server_default="started")
    state: Mapped[str | None]
    result: Mapped[dict[str, Any] | None]
    error_code: Mapped[str | None]
    error_message: Mapped[str | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    completed_at: Mapped[dt.datetime | None]


class AgentLLMCall(Base):
    __tablename__ = "agent_llm_calls"
    __table_args__ = (UniqueConstraint("run_id", "request_fingerprint"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"))
    request_fingerprint: Mapped[str]
    response: Mapped[dict[str, Any]]
    duration_ms: Mapped[int] = mapped_column(Integer)
    metered: Mapped[bool] = mapped_column(server_default=text("false"))
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    metered_at: Mapped[dt.datetime | None]


class RunCandidate(Base):
    __tablename__ = "run_candidates"
    __table_args__ = (
        UniqueConstraint("run_id", "id"),
        UniqueConstraint("id", "source_fingerprint"),
        ForeignKeyConstraint(
            ["run_id", "parent_candidate_id"], ["run_candidates.run_id", "run_candidates.id"]
        ),
        ForeignKeyConstraint(
            ["run_id", "plan_id"],
            ["run_plans.run_id", "run_plans.id"],
            name="fk_run_candidates_plan_same_run",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"))
    tool_call_id: Mapped[str]
    revision: Mapped[int] = mapped_column(Integer)
    parent_candidate_id: Mapped[uuid.UUID | None]
    plan_id: Mapped[uuid.UUID]
    framework: Mapped[str]
    source: Mapped[str]
    source_fingerprint: Mapped[str]
    status: Mapped[str] = mapped_column(server_default="created")
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class CandidateExecution(Base):
    __tablename__ = "candidate_executions"
    __table_args__ = (
        UniqueConstraint("id", "candidate_id", "source_fingerprint"),
        ForeignKeyConstraint(
            ["candidate_id", "source_fingerprint"],
            ["run_candidates.id", "run_candidates.source_fingerprint"],
            ondelete="CASCADE",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    candidate_id: Mapped[uuid.UUID] = mapped_column(unique=True)
    source_fingerprint: Mapped[str]
    environment_fingerprint: Mapped[str]
    sandbox_provider: Mapped[str]
    exit_code: Mapped[int] = mapped_column(Integer)
    failure_kind: Mapped[str | None]
    duration_ms: Mapped[int] = mapped_column(Integer)
    result: Mapped[dict[str, Any]]
    observation: Mapped[dict[str, Any]]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class CandidateVerification(Base):
    __tablename__ = "candidate_verifications"
    __table_args__ = (
        ForeignKeyConstraint(
            ["execution_id", "candidate_id", "source_fingerprint"],
            [
                "candidate_executions.id",
                "candidate_executions.candidate_id",
                "candidate_executions.source_fingerprint",
            ],
            ondelete="CASCADE",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    candidate_id: Mapped[uuid.UUID] = mapped_column(unique=True)
    execution_id: Mapped[uuid.UUID]
    source_fingerprint: Mapped[str]
    decision: Mapped[str]
    deterministic_checks: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    critic: Mapped[dict[str, Any] | None]
    repair: Mapped[dict[str, Any] | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class CandidateSemanticReview(Base):
    __tablename__ = "candidate_semantic_reviews"
    __table_args__ = (
        UniqueConstraint("candidate_id", "attempt_seq", name="uq_semantic_reviews_attempt"),
        UniqueConstraint(
            "id",
            "candidate_id",
            "execution_id",
            "source_fingerprint",
            name="uq_semantic_reviews_binding",
        ),
        ForeignKeyConstraint(
            ["execution_id", "candidate_id", "source_fingerprint"],
            [
                "candidate_executions.id",
                "candidate_executions.candidate_id",
                "candidate_executions.source_fingerprint",
            ],
            name="fk_semantic_reviews_execution_binding",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    candidate_id: Mapped[uuid.UUID]
    execution_id: Mapped[uuid.UUID]
    source_fingerprint: Mapped[str]
    attempt_seq: Mapped[int] = mapped_column(Integer)
    decision: Mapped[str]
    confidence: Mapped[str | None]
    severity: Mapped[str | None]
    reason_code: Mapped[str]
    failure_class: Mapped[str | None]
    retry_target: Mapped[str]
    feedback: Mapped[dict[str, Any]]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class CandidateVerificationAttempt(Base):
    __tablename__ = "candidate_verification_attempts"
    __table_args__ = (
        UniqueConstraint("candidate_id", "attempt_seq", name="uq_verification_attempts_attempt"),
        ForeignKeyConstraint(
            ["execution_id", "candidate_id", "source_fingerprint"],
            [
                "candidate_executions.id",
                "candidate_executions.candidate_id",
                "candidate_executions.source_fingerprint",
            ],
            name="fk_verification_attempts_execution_binding",
        ),
        ForeignKeyConstraint(
            ["semantic_review_id", "candidate_id", "execution_id", "source_fingerprint"],
            [
                "candidate_semantic_reviews.id",
                "candidate_semantic_reviews.candidate_id",
                "candidate_semantic_reviews.execution_id",
                "candidate_semantic_reviews.source_fingerprint",
            ],
            name="fk_verification_attempts_review_binding",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    candidate_id: Mapped[uuid.UUID]
    execution_id: Mapped[uuid.UUID]
    semantic_review_id: Mapped[uuid.UUID]
    source_fingerprint: Mapped[str]
    attempt_seq: Mapped[int] = mapped_column(Integer)
    checks: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    decision: Mapped[str]
    evidence_strength: Mapped[str | None]
    claim_coverage: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    reason_code: Mapped[str]
    candidate_defect_observed: Mapped[bool]
    failure_class: Mapped[str | None]
    retry_target: Mapped[str]
    unverified_claims: Mapped[list[str]] = mapped_column(JSONB)
    verifier_version: Mapped[str]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class CandidateConversion(Base):
    __tablename__ = "candidate_conversions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["candidate_id", "source_fingerprint"],
            ["run_candidates.id", "run_candidates.source_fingerprint"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["execution_id", "candidate_id", "source_fingerprint"],
            [
                "candidate_executions.id",
                "candidate_executions.candidate_id",
                "candidate_executions.source_fingerprint",
            ],
            name="fk_candidate_conversions_execution_binding",
        ),
    )

    candidate_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    execution_id: Mapped[uuid.UUID]
    source_fingerprint: Mapped[str]
    status: Mapped[str]
    qasm: Mapped[str | None]
    reason: Mapped[str | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class ImportJob(Base):
    """Durable import batch tracking (migration 0016, Step 5a). Dispatched by
    the existing Job lease/heartbeat/retry loop (job_id); item outcomes are
    tracked independently in ImportItem so one bad input can't roll back or
    publish an entire batch."""

    __tablename__ = "import_jobs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id"), unique=True)
    provider: Mapped[str]
    upstream_ref: Mapped[str]
    idempotency_key: Mapped[str] = mapped_column(unique=True)
    status: Mapped[str] = mapped_column(server_default="queued")
    item_count: Mapped[int] = mapped_column(Integer, server_default="0")
    accepted_count: Mapped[int] = mapped_column(Integer, server_default="0")
    rejected_count: Mapped[int] = mapped_column(Integer, server_default="0")
    dead_count: Mapped[int] = mapped_column(Integer, server_default="0")
    started_at: Mapped[dt.datetime | None]
    finished_at: Mapped[dt.datetime | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class ImportItem(Base):
    __tablename__ = "import_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    import_job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_jobs.id"))
    upstream_identity: Mapped[str]
    state: Mapped[str] = mapped_column(server_default="queued")
    failure_code: Mapped[str | None]
    raw_metadata: Mapped[dict[str, Any] | None]
    source_blob_sha256: Mapped[str | None]
    resulting_artifact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("artifacts.id"))
    resulting_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("artifact_versions.id")
    )
    attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    max_attempts: Mapped[int] = mapped_column(Integer, server_default="3")
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class GitHubRepositorySnapshotRow(Base):
    """Private append-only Phase 7 source snapshot (migration 0043)."""

    __tablename__ = "github_repository_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    repository_id: Mapped[int] = mapped_column(BigInteger)
    repository_node_id: Mapped[str]
    full_name: Mapped[str]
    canonical_repository_url: Mapped[str]
    requested_ref: Mapped[str | None]
    default_branch: Mapped[str]
    archived: Mapped[bool]
    disabled: Mapped[bool]
    api_version: Mapped[str]
    commit_sha: Mapped[str]
    tree_sha: Mapped[str]
    tree_entry_count: Mapped[int] = mapped_column(Integer)
    tree_manifest_sha256: Mapped[str]
    selected_metadata_bytes: Mapped[int] = mapped_column(Integer)
    metadata_manifest_sha256: Mapped[str]
    skipped_oversized_paths: Mapped[list[str]] = mapped_column(JSONB)
    importer_policy_version: Mapped[str]
    audit_manifest_json: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class GitHubRepositorySnapshotFileRow(Base):
    """Content-addressed selected metadata bytes for one immutable snapshot."""

    __tablename__ = "github_repository_snapshot_files"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("github_repository_snapshots.id", ondelete="CASCADE")
    )
    path: Mapped[str]
    mode: Mapped[str]
    blob_sha: Mapped[str]
    size: Mapped[int] = mapped_column(Integer)
    content_sha256: Mapped[str]
    content: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class GitHubSnapshotImportRequestRow(Base):
    """Append-only request replay ledger, separate from source identity."""

    __tablename__ = "github_snapshot_import_requests"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    idempotency_key: Mapped[str] = mapped_column(unique=True)
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("github_repository_snapshots.id", ondelete="RESTRICT")
    )
    request_descriptor_json: Mapped[dict[str, Any]] = mapped_column(JSONB)
    request_descriptor_sha256: Mapped[str]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class GitHubMetadataAssertionRow(Base):
    """Append-only direct observations over one bounded source snapshot."""

    __tablename__ = "github_metadata_assertions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("github_repository_snapshots.id", ondelete="RESTRICT")
    )
    assertion_key: Mapped[str]
    extractor_version: Mapped[str]
    source_key: Mapped[str]
    predicate: Mapped[str]
    observed: Mapped[bool]
    evidence_paths: Mapped[list[str]] = mapped_column(JSONB)
    evidence_content_sha256: Mapped[list[str]] = mapped_column(JSONB)
    assertion_json: Mapped[dict[str, Any]] = mapped_column(JSONB)
    assertion_sha256: Mapped[str]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class VqeComponentImplementationCandidateRow(Base):
    """Private provider-source candidate; never a published component."""

    __tablename__ = "vqe_component_implementation_candidates"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("github_repository_snapshots.id", ondelete="RESTRICT")
    )
    candidate_key: Mapped[str]
    adapter_version: Mapped[str]
    source_key: Mapped[str]
    provider_key: Mapped[str]
    component_semantic_key: Mapped[str | None]
    match_state: Mapped[str]
    candidate_json: Mapped[dict[str, Any]] = mapped_column(JSONB)
    candidate_sha256: Mapped[str]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class VqeResearchCandidateEnvelopeRow(Base):
    """Private validated LLM proposal; never reviewed or published in place."""

    __tablename__ = "vqe_research_candidate_envelopes"
    __table_args__ = (
        UniqueConstraint("workspace_id", "envelope_sha256"),
        UniqueConstraint("id", "workspace_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    source_snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("github_repository_snapshots.id")
    )
    envelope_version: Mapped[str]
    prompt_version: Mapped[str]
    policy_version: Mapped[str]
    response_schema_version: Mapped[str]
    repository_id: Mapped[int] = mapped_column(BigInteger)
    commit_sha: Mapped[str]
    snapshot_sha256: Mapped[str]
    input_bundle_sha256: Mapped[str]
    response_sha256: Mapped[str]
    provider: Mapped[str]
    requested_model: Mapped[str]
    served_model: Mapped[str]
    input_tokens: Mapped[int] = mapped_column(Integer)
    output_tokens: Mapped[int] = mapped_column(Integer)
    candidate_count: Mapped[int] = mapped_column(Integer)
    machine_validation_state: Mapped[str]
    human_review_state: Mapped[str]
    publication_eligible: Mapped[bool]
    materialization_eligible: Mapped[bool]
    envelope_json: Mapped[dict[str, Any]] = mapped_column(JSONB)
    envelope_sha256: Mapped[str]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class VqeResearchCandidatePersistRequestRow(Base):
    """Append-only transport replay ledger for one candidate envelope."""

    __tablename__ = "vqe_research_candidate_persist_requests"
    __table_args__ = (
        ForeignKeyConstraint(
            ["envelope_id", "workspace_id"],
            [
                "vqe_research_candidate_envelopes.id",
                "vqe_research_candidate_envelopes.workspace_id",
            ],
        ),
        UniqueConstraint("workspace_id", "idempotency_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID]
    envelope_id: Mapped[uuid.UUID]
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    idempotency_key: Mapped[str]
    request_descriptor_json: Mapped[dict[str, Any]] = mapped_column(JSONB)
    request_descriptor_sha256: Mapped[str]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    kind: Mapped[str]
    payload: Mapped[dict[str, Any]]
    status: Mapped[str | None] = mapped_column(server_default="queued")
    run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("runs.id"))
    attempts: Mapped[int | None] = mapped_column(Integer, server_default="0")
    max_attempts: Mapped[int | None] = mapped_column(Integer, server_default="3")
    locked_by: Mapped[str | None]
    locked_at: Mapped[dt.datetime | None]
    lease_token: Mapped[uuid.UUID | None] = mapped_column(_UUID)
    lease_expires_at: Mapped[dt.datetime | None]
    last_heartbeat_at: Mapped[dt.datetime | None]
    run_after: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    last_error: Mapped[str | None]
    last_error_kind: Mapped[str | None]
    dead_lettered_at: Mapped[dt.datetime | None]
    dead_letter_error: Mapped[str | None]
    dead_letter_attempts: Mapped[int | None] = mapped_column(Integer, server_default="0")
    dead_letter_locked_by: Mapped[str | None]
    dead_letter_lease_token: Mapped[uuid.UUID | None] = mapped_column(_UUID)
    dead_letter_lease_expires_at: Mapped[dt.datetime | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class UsageEvent(Base):
    __tablename__ = "usage_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str]
    quantity: Mapped[float] = mapped_column(Numeric)
    meta: Mapped[dict[str, Any] | None]
    ts: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspaces.id"))
    actor_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str]
    target_kind: Mapped[str | None]
    target_id: Mapped[uuid.UUID | None] = mapped_column(_UUID)
    ip: Mapped[str | None] = mapped_column(INET)
    ts: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    meta: Mapped[dict[str, Any] | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class QpuRun(Base):
    """Durable provider-attested hardware run (migration 0034). Mirrors
    majorana_contracts.QpuRunRecord; `qasm` is storage-only so the worker can
    resubmit from the row rather than from request memory."""

    __tablename__ = "qpu_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    artifact_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("artifact_versions.id")
    )
    provider: Mapped[str]
    device_id: Mapped[str]
    provider_job_id: Mapped[str | None]
    shots: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(server_default="queued")
    source_fingerprint: Mapped[str]
    qasm: Mapped[str]
    estimate_basis: Mapped[str]
    estimated_total_usd: Mapped[float | None] = mapped_column(Numeric)
    rate_source: Mapped[str]
    rate_confirmed_on: Mapped[str]
    raw_counts: Mapped[dict[str, Any] | None]
    error: Mapped[str | None]
    submitted_at: Mapped[dt.datetime | None]
    completed_at: Mapped[dt.datetime | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class VqeComponentSpec(Base):
    """Typed VQE metadata attached to an existing ArtifactVersion (migration
    0035, ADR-0024). Component identity IS the ArtifactVersion — this table
    adds VQE-specific typed fields without a second identity/provenance/
    license system alongside the one artifacts/artifact_versions already own."""

    __tablename__ = "vqe_component_specs"

    artifact_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artifact_versions.id"), primary_key=True
    )
    schema_version: Mapped[str]
    component_type: Mapped[str]
    semantic_key: Mapped[str]
    spec_json: Mapped[dict[str, Any]]
    normalized_spec_sha256: Mapped[str]
    machine_validation_state: Mapped[str] = mapped_column(server_default="unvalidated")
    review_state: Mapped[str] = mapped_column(server_default="unreviewed")
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class VqeWorkflowComponent(Base):
    """Links a Workflow ArtifactVersion to one of its component
    ArtifactVersions with an explicit role and ordinal (migration 0041,
    ADR-0024)."""

    __tablename__ = "vqe_workflow_components"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workflow_artifact_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artifact_versions.id")
    )
    component_role: Mapped[str]
    component_artifact_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artifact_versions.id")
    )
    ordinal: Mapped[int] = mapped_column(Integer)
    binding_metadata: Mapped[dict[str, Any] | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class VqeExperiment(Base):
    """One portable scientific identity plus its registry-resolution proof."""

    __tablename__ = "vqe_experiments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    schema_version: Mapped[str]
    workflow_artifact_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artifact_versions.id")
    )
    scientific_spec_json: Mapped[dict[str, Any]]
    scientific_spec_sha256: Mapped[str]
    registry_resolution_json: Mapped[dict[str, Any]]
    registry_resolution_sha256: Mapped[str]
    request_idempotency_key: Mapped[str | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class VqeExecution(Base):
    """One framework/runtime binding of a portable VQE experiment."""

    __tablename__ = "vqe_executions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    experiment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vqe_experiments.id"))
    run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("runs.id"), unique=True)
    framework: Mapped[str]
    provider_versions: Mapped[dict[str, Any]]
    runtime_profile_id: Mapped[str]
    runtime_image_digest: Mapped[str]
    adapter_release_id: Mapped[str]
    execution_binding_json: Mapped[dict[str, Any]]
    execution_identity_sha256: Mapped[str]
    status: Mapped[str] = mapped_column(server_default="planned")
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
    updated_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class VqeObservation(Base):
    """Append-only execution evidence (migration 0041, ADR-0026) — never
    UPDATEd; a retry is a new row with an incremented `attempt`, never a
    mutation of a prior row."""

    __tablename__ = "vqe_observations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    execution_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vqe_executions.id"))
    attempt: Mapped[int] = mapped_column(Integer)
    status: Mapped[str]
    result_contract_json: Mapped[dict[str, Any]]
    result_contract_sha256: Mapped[str]
    detail_object_uri: Mapped[str | None]
    detail_sha256: Mapped[str | None]
    detail_size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    evidence_json: Mapped[dict[str, Any] | None]
    failure_code: Mapped[str | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class VqeControlledComparisonSpec(Base):
    """Immutable comparison plan; it is not a measured result."""

    __tablename__ = "vqe_controlled_comparison_specs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    baseline_workflow_artifact_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artifact_versions.id")
    )
    candidate_workflow_artifact_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artifact_versions.id")
    )
    changed_role: Mapped[str]
    spec_json: Mapped[dict[str, Any]]
    spec_sha256: Mapped[str]
    request_idempotency_key: Mapped[str | None]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())


class VqeControlledComparisonRun(Base):
    """Append-only observed outcome for one comparison plan."""

    __tablename__ = "vqe_controlled_comparison_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    comparison_spec_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vqe_controlled_comparison_specs.id")
    )
    baseline_execution_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vqe_executions.id"))
    candidate_execution_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vqe_executions.id"))
    status: Mapped[str]
    run_json: Mapped[dict[str, Any]]
    run_sha256: Mapped[str]
    created_at: Mapped[dt.datetime | None] = mapped_column(server_default=func.now())
