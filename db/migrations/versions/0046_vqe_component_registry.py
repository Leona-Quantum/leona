"""VQE Registry and Portable Experiment Persistence (Phase 4.5, ADR-0030).

Revision ID: 0046
Revises: 0045

Five purely additive tables. Component/Workflow registry identity is an existing
ArtifactVersion (ADR-0024) — no parallel identity system. Enum-shaped text
columns carry CHECK constraints pinned to majorana_vqe.models's own enums
(ComponentType/validation/review states/ExecutionStatus/FailureCode), the same
defense-in-depth pattern migration 0034 used for QpuRunStatus/QpuProvider.

vqe_experiments stores one portable scientific identity. vqe_executions binds
that identity to zero or more framework/runtime executions; attempts and
observations belong to an execution, not directly to the scientific spec.
vqe_observations is strictly
append-only (ADR-0026): PostgreSQL rejects UPDATE/DELETE through both role
privileges and a trigger, so evidence immutability does not depend on every
application caller remembering a repository convention.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0046"
down_revision = "0045"
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
    "stopping_protocol",
    "workflow",
)
_MACHINE_VALIDATION_STATES = ("unvalidated", "machine_validated", "validation_failed")
_REVIEW_STATES = (
    "unreviewed",
    "human_reviewed",
    "author_confirmed",
    "review_rejected",
    "conflicting",
)
_EXECUTION_STATUSES = ("succeeded", "failed")
_EXECUTION_LIFECYCLE = ("planned", "queued", "running", "succeeded", "failed", "cancelled")
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
_FRAMEWORKS = ("qiskit", "pennylane")
_OBSERVATION_APPEND_ONLY_FUNCTION = "majorana_reject_vqe_observation_mutation"
_OBSERVATION_APPEND_ONLY_TRIGGER = "trg_vqe_observations_append_only"
_SCIENTIFIC_APPEND_ONLY_FUNCTION = "majorana_reject_vqe_scientific_mutation"
_SCIENTIFIC_APPEND_ONLY_TABLES = (
    "vqe_component_specs",
    "vqe_workflow_components",
    "vqe_experiments",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def _grant(table: str, *, allow_update: bool = False) -> None:
    privileges = "select, insert, update" if allow_update else "select, insert"
    revoked = "delete" if allow_update else "update, delete"
    op.execute(
        f"""
        do $$ begin
            if exists (select 1 from pg_roles where rolname = 'app_rw') then
                grant {privileges} on {table} to app_rw;
                revoke {revoked} on {table} from app_rw;
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
        sa.Column("semantic_key", sa.Text(), nullable=False),
        sa.Column("spec_json", _JSON, nullable=False, server_default="{}"),
        sa.Column("normalized_spec_sha256", sa.Text(), nullable=False),
        sa.Column(
            "machine_validation_state",
            sa.Text(),
            nullable=False,
            server_default="unvalidated",
        ),
        sa.Column("review_state", sa.Text(), nullable=False, server_default="unreviewed"),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            _in("component_type", _COMPONENT_TYPES), name="ck_vqe_component_specs_type"
        ),
        sa.CheckConstraint(
            _in("machine_validation_state", _MACHINE_VALIDATION_STATES),
            name="ck_vqe_component_specs_machine_validation_state",
        ),
        sa.CheckConstraint(
            _in("review_state", _REVIEW_STATES),
            name="ck_vqe_component_specs_review_state",
        ),
        sa.CheckConstraint(
            "normalized_spec_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_component_specs_sha256_shape",
        ),
        # Identical scientific content may legitimately be mirrored by
        # different workspaces.  Global content uniqueness here would leak
        # cross-tenant existence through integrity errors and make a public
        # catalog entry prevent a private provenance record.
        sa.CheckConstraint(
            "char_length(semantic_key) BETWEEN 1 AND 200",
            name="ck_vqe_component_specs_semantic_key_length",
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
        sa.Column("registry_resolution_json", _JSON, nullable=False),
        sa.Column("registry_resolution_sha256", sa.Text(), nullable=False),
        # HTTP request replay key. This is deliberately distinct from the
        # server-generated execution identity defined by ADR-0024, which can
        # only be computed after an ExecutionBinding exists.
        sa.Column("request_idempotency_key", sa.Text()),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "scientific_spec_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_experiments_spec_sha256_shape",
        ),
        sa.CheckConstraint(
            "registry_resolution_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_experiments_resolution_sha256_shape",
        ),
    )
    op.create_index(
        "ix_vqe_experiments_workspace_created", "vqe_experiments", ["workspace_id", "created_at"]
    )
    # The HTTP Idempotency-Key is workspace-scoped and used only for safe
    # request replay; it is not the scientific execution identity.
    op.create_index(
        "ix_vqe_experiments_workspace_request_idempotency",
        "vqe_experiments",
        ["workspace_id", "request_idempotency_key"],
        unique=True,
        postgresql_where=sa.text("request_idempotency_key is not null"),
    )
    _grant("vqe_experiments")

    op.create_table(
        "vqe_executions",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "experiment_id",
            _UUID,
            sa.ForeignKey("vqe_experiments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("run_id", _UUID, sa.ForeignKey("runs.id", ondelete="SET NULL"), unique=True),
        sa.Column("framework", sa.Text(), nullable=False),
        sa.Column("provider_versions", _JSON, nullable=False),
        sa.Column("runtime_profile_id", sa.Text(), nullable=False),
        sa.Column("runtime_image_digest", sa.Text(), nullable=False),
        sa.Column("adapter_release_id", sa.Text(), nullable=False),
        sa.Column("execution_binding_json", _JSON, nullable=False),
        sa.Column("execution_identity_sha256", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="planned"),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(_in("framework", _FRAMEWORKS), name="ck_vqe_executions_framework"),
        sa.CheckConstraint(
            _in("status", _EXECUTION_LIFECYCLE),
            name="ck_vqe_executions_status",
        ),
        sa.CheckConstraint(
            "runtime_image_digest ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_vqe_executions_runtime_image_digest_shape",
        ),
        sa.CheckConstraint(
            "execution_identity_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_executions_identity_sha256_shape",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(execution_binding_json) = 'object' "
            "and execution_binding_json->>'framework' = framework "
            "and execution_binding_json->>'runtime_profile_id' = runtime_profile_id "
            "and execution_binding_json->>'container_digest' = runtime_image_digest "
            "and execution_binding_json->>'adapter_release_id' = adapter_release_id",
            name="ck_vqe_executions_binding_matches_columns",
        ),
        sa.UniqueConstraint(
            "experiment_id",
            "execution_identity_sha256",
            name="uq_vqe_executions_experiment_identity",
        ),
    )
    op.create_index("ix_vqe_executions_experiment", "vqe_executions", ["experiment_id"])
    _grant("vqe_executions", allow_update=True)

    op.create_table(
        "vqe_observations",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "execution_id",
            _UUID,
            sa.ForeignKey("vqe_executions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("result_contract_json", _JSON, nullable=False),
        sa.Column("result_contract_sha256", sa.Text(), nullable=False),
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
            "result_contract_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_observations_result_sha256_shape",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(result_contract_json) = 'object' "
            "and result_contract_json->>'status' = status",
            name="ck_vqe_observations_result_status_matches",
        ),
        sa.CheckConstraint(
            "(detail_object_uri is null and detail_sha256 is null and detail_size_bytes is null) "
            "or (detail_object_uri is not null and detail_sha256 ~ '^[0-9a-f]{64}$' "
            "and detail_size_bytes >= 0)",
            name="ck_vqe_observations_detail_ref_consistency",
        ),
        sa.UniqueConstraint(
            "execution_id", "attempt", name="uq_vqe_observations_execution_attempt"
        ),
    )
    op.create_index("ix_vqe_observations_execution", "vqe_observations", ["execution_id"])
    _grant("vqe_observations", allow_update=False)
    op.execute(
        sa.text(
            f"""
            CREATE FUNCTION {_OBSERVATION_APPEND_ONLY_FUNCTION}()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                RAISE EXCEPTION
                    'vqe_observations is append-only; insert a new attempt'
                    USING ERRCODE = '55000';
            END;
            $$
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            CREATE FUNCTION {_SCIENTIFIC_APPEND_ONLY_FUNCTION}()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                RAISE EXCEPTION
                    '% is immutable; create a new ArtifactVersion or experiment', TG_TABLE_NAME
                    USING ERRCODE = '55000';
            END;
            $$
            """
        )
    )
    for table in _SCIENTIFIC_APPEND_ONLY_TABLES:
        op.execute(
            sa.text(
                f"""
                CREATE TRIGGER trg_{table}_append_only
                BEFORE UPDATE OR DELETE ON {table}
                FOR EACH ROW EXECUTE FUNCTION {_SCIENTIFIC_APPEND_ONLY_FUNCTION}()
                """
            )
        )
    op.execute(
        sa.text(
            f"""
            CREATE TRIGGER {_OBSERVATION_APPEND_ONLY_TRIGGER}
            BEFORE UPDATE OR DELETE ON vqe_observations
            FOR EACH ROW EXECUTE FUNCTION {_OBSERVATION_APPEND_ONLY_FUNCTION}()
            """
        )
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM vqe_component_specs)
               OR EXISTS (SELECT 1 FROM vqe_workflow_components)
               OR EXISTS (SELECT 1 FROM vqe_experiments)
               OR EXISTS (SELECT 1 FROM vqe_executions)
               OR EXISTS (SELECT 1 FROM vqe_observations) THEN
                RAISE EXCEPTION
                    'cannot downgrade 0046: VQE registry or execution evidence exists';
            END IF;
        END $$
        """
    )
    op.execute(
        sa.text(f"DROP TRIGGER IF EXISTS {_OBSERVATION_APPEND_ONLY_TRIGGER} ON vqe_observations")
    )
    op.execute(sa.text(f"DROP FUNCTION IF EXISTS {_OBSERVATION_APPEND_ONLY_FUNCTION}()"))
    for table in reversed(_SCIENTIFIC_APPEND_ONLY_TABLES):
        op.execute(sa.text(f"DROP TRIGGER IF EXISTS trg_{table}_append_only ON {table}"))
    op.execute(sa.text(f"DROP FUNCTION IF EXISTS {_SCIENTIFIC_APPEND_ONLY_FUNCTION}()"))
    op.drop_table("vqe_observations")
    op.drop_table("vqe_executions")
    op.drop_table("vqe_experiments")
    op.drop_table("vqe_workflow_components")
    op.drop_table("vqe_component_specs")
