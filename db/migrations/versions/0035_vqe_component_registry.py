"""VQE Component Registry and Experiment Persistence (Phase 3, ADR-0023/0025).

Revision ID: 0035
Revises: 0034

Four purely additive tables. Component/Workflow identity is an existing
ArtifactVersion (ADR-0023) — no parallel identity system. Enum-shaped text
columns carry CHECK constraints pinned to majorana_vqe.models's own enums
(ComponentType/AnnotationState/ExecutionStatus/FailureCode), the same
defense-in-depth pattern migration 0034 used for QpuRunStatus/QpuProvider.

vqe_experiments.run_id is nullable and UNIQUE-when-present: Phase 3 persists
the immutable scientific spec, but does not create a `runs` row, because
there is no approved ExecutionBinding to resolve a framework to until
Phase 5 ships real, promoted runtime profiles (ADR-0024) — see the Phase 3
handoff report for the full rationale. vqe_observations is strictly
append-only at the application layer (ADR-0025); this migration does not
attempt a DB-level trigger enforcing that (Group D item, explicitly
deferred per the original CodeRabbit-fix plan's precedent for this kind of
heavier DB-level invariant).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_JSON = postgresql.JSONB(astext_type=sa.Text())

_COMPONENT_TYPES = (
    "problem",
    "problem_preparation",
    "representation",
    "reference_state",
    "ansatz",
    "operator_pool",
    "search_selection",
    "growth_batching",
    "parameter_optimizer",
    "compression",
    "measurement",
    "error_mitigation",
    "compilation_backend",
    "learning_training",
    "evaluation_protocol",
    "workflow",
)
_ANNOTATION_STATES = ("draft", "human_reviewed", "unknown", "conflicting")
_EXECUTION_STATUSES = ("succeeded", "failed")
_FAILURE_CODES = (
    "invalid_spec",
    "unsupported_capability",
    "runtime_unavailable",
    "runtime_timeout",
    "runtime_oom",
    "execution_failed",
    "result_contract_failed",
    "numerical_mismatch",
    "inconclusive",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def _grant(table: str) -> None:
    op.execute(
        f"""
        do $$ begin
            if exists (select 1 from pg_roles where rolname = 'app_rw') then
                grant select, insert, update on {table} to app_rw;
                revoke delete on {table} from app_rw;
            end if;
        end $$;
        """
    )


def upgrade() -> None:
    op.create_table(
        "vqe_component_specs",
        sa.Column(
            "artifact_version_id",
            _UUID,
            sa.ForeignKey("artifact_versions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("schema_version", sa.Text(), nullable=False),
        sa.Column("component_type", sa.Text(), nullable=False),
        sa.Column("spec_json", _JSON, nullable=False, server_default="{}"),
        sa.Column("normalized_spec_sha256", sa.Text()),
        sa.Column("annotation_state", sa.Text(), nullable=False, server_default="draft"),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            _in("component_type", _COMPONENT_TYPES), name="ck_vqe_component_specs_type"
        ),
        sa.CheckConstraint(
            _in("annotation_state", _ANNOTATION_STATES),
            name="ck_vqe_component_specs_annotation_state",
        ),
        sa.CheckConstraint(
            "normalized_spec_sha256 is null or normalized_spec_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_component_specs_sha256_shape",
        ),
    )
    op.create_index("ix_vqe_component_specs_type", "vqe_component_specs", ["component_type"])
    _grant("vqe_component_specs")

    op.create_table(
        "vqe_workflow_components",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "workflow_artifact_version_id",
            _UUID,
            sa.ForeignKey("artifact_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("component_role", sa.Text(), nullable=False),
        sa.Column(
            "component_artifact_version_id",
            _UUID,
            sa.ForeignKey("artifact_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("binding_metadata", _JSON),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("ordinal >= 0", name="ck_vqe_workflow_components_ordinal"),
        sa.CheckConstraint(
            "char_length(component_role) BETWEEN 1 AND 100",
            name="ck_vqe_workflow_components_role",
        ),
        sa.UniqueConstraint(
            "workflow_artifact_version_id",
            "component_role",
            "ordinal",
            name="uq_vqe_workflow_components_role_ordinal",
        ),
    )
    op.create_index(
        "ix_vqe_workflow_components_workflow",
        "vqe_workflow_components",
        ["workflow_artifact_version_id"],
    )
    _grant("vqe_workflow_components")

    op.create_table(
        "vqe_experiments",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column("run_id", _UUID, sa.ForeignKey("runs.id", ondelete="SET NULL"), unique=True),
        sa.Column(
            "workspace_id",
            _UUID,
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", _UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("schema_version", sa.Text(), nullable=False),
        sa.Column(
            "workflow_artifact_version_id",
            _UUID,
            sa.ForeignKey("artifact_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("scientific_spec_json", _JSON, nullable=False),
        sa.Column("scientific_spec_sha256", sa.Text(), nullable=False),
        sa.Column("protocol_version", sa.Text(), nullable=False),
        sa.Column("idempotency_key", sa.Text()),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "scientific_spec_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_experiments_spec_sha256_shape",
        ),
    )
    op.create_index(
        "ix_vqe_experiments_workspace_created", "vqe_experiments", ["workspace_id", "created_at"]
    )
    # Idempotency-Key is workspace-scoped, matching runs.idempotency_key's own
    # (unindexed-but-queried) convention -- indexed here since experiment
    # lookup-by-key is this table's primary create-time query.
    op.create_index(
        "ix_vqe_experiments_workspace_idempotency",
        "vqe_experiments",
        ["workspace_id", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key is not null"),
    )
    _grant("vqe_experiments")

    op.create_table(
        "vqe_observations",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "experiment_id",
            _UUID,
            sa.ForeignKey("vqe_experiments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("framework", sa.Text(), nullable=False),
        sa.Column("provider_versions", _JSON),
        sa.Column("runtime_profile_id", sa.Text(), nullable=False),
        sa.Column("runtime_image_digest", sa.Text(), nullable=False),
        sa.Column("adapter_release_id", sa.Text(), nullable=False),
        sa.Column("architecture", sa.Text(), nullable=False),
        sa.Column("dataset_snapshot_id", sa.Text()),
        sa.Column("protocol_version", sa.Text(), nullable=False),
        sa.Column("scientific_spec_sha256", sa.Text(), nullable=False),
        sa.Column("hamiltonian_digest", sa.Text()),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("summary_json", _JSON),
        sa.Column("detail_object_uri", sa.Text()),
        sa.Column("detail_sha256", sa.Text()),
        sa.Column("detail_size_bytes", sa.BigInteger()),
        sa.Column("evidence_json", _JSON),
        sa.Column("failure_code", sa.Text()),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("attempt >= 1", name="ck_vqe_observations_attempt"),
        sa.CheckConstraint(_in("status", _EXECUTION_STATUSES), name="ck_vqe_observations_status"),
        sa.CheckConstraint(
            "failure_code is null or " + _in("failure_code", _FAILURE_CODES),
            name="ck_vqe_observations_failure_code",
        ),
        # Mirrors majorana_vqe.models.ResultContract's own Pydantic-level
        # invariant (status_and_evidence_are_consistent) at the DB layer:
        # failed requires a failure_code, succeeded must not carry one.
        sa.CheckConstraint(
            "(status = 'failed' and failure_code is not null) or "
            "(status = 'succeeded' and failure_code is null)",
            name="ck_vqe_observations_status_failure_code_consistency",
        ),
        sa.CheckConstraint(
            "scientific_spec_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_observations_spec_sha256_shape",
        ),
        sa.CheckConstraint(
            "hamiltonian_digest is null or hamiltonian_digest ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_observations_hamiltonian_digest_shape",
        ),
        sa.UniqueConstraint(
            "experiment_id", "attempt", name="uq_vqe_observations_experiment_attempt"
        ),
    )
    op.create_index("ix_vqe_observations_experiment", "vqe_observations", ["experiment_id"])
    _grant("vqe_observations")


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM vqe_observations WHERE status = 'succeeded') THEN
                RAISE EXCEPTION
                    'cannot downgrade 0035: successful vqe_observations evidence exists';
            END IF;
        END $$
        """
    )
    op.drop_table("vqe_observations")
    op.drop_table("vqe_experiments")
    op.drop_table("vqe_workflow_components")
    op.drop_table("vqe_component_specs")
