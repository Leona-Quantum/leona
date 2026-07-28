"""Add immutable controlled VQE comparison plans and results.

Revision ID: 0039
Revises: 0038
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_JSON = postgresql.JSONB(astext_type=sa.Text())
_FUNCTION = "majorana_reject_vqe_comparison_mutation"
_TABLES = ("vqe_controlled_comparison_specs", "vqe_controlled_comparison_runs")


def _append_only(table: str) -> None:
    op.execute(
        f"""
        create trigger trg_{table}_append_only
        before update or delete on {table}
        for each row execute function {_FUNCTION}();
        """
    )
    op.execute(
        f"""
        do $$ begin
            if exists (select 1 from pg_roles where rolname = 'app_rw') then
                grant select, insert on {table} to app_rw;
                revoke update, delete on {table} from app_rw;
            end if;
        end $$;
        """
    )


def upgrade() -> None:
    op.create_table(
        "vqe_controlled_comparison_specs",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "workspace_id",
            _UUID,
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", _UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "baseline_workflow_artifact_version_id",
            _UUID,
            sa.ForeignKey("artifact_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "candidate_workflow_artifact_version_id",
            _UUID,
            sa.ForeignKey("artifact_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("changed_role", sa.Text(), nullable=False),
        sa.Column("spec_json", _JSON, nullable=False),
        sa.Column("spec_sha256", sa.Text(), nullable=False),
        sa.Column("request_idempotency_key", sa.Text()),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "changed_role = 'parameter_optimizer'",
            name="ck_vqe_controlled_comparison_specs_phase76_role",
        ),
        sa.CheckConstraint(
            "spec_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_controlled_comparison_specs_sha",
        ),
        sa.UniqueConstraint(
            "workspace_id",
            "request_idempotency_key",
            name="uq_vqe_controlled_comparison_specs_idempotency",
        ),
    )
    op.create_index(
        "ix_vqe_controlled_comparison_specs_workspace",
        "vqe_controlled_comparison_specs",
        ["workspace_id", "created_at"],
    )

    op.create_table(
        "vqe_controlled_comparison_runs",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "comparison_spec_id",
            _UUID,
            sa.ForeignKey("vqe_controlled_comparison_specs.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "baseline_execution_id",
            _UUID,
            sa.ForeignKey("vqe_executions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "candidate_execution_id",
            _UUID,
            sa.ForeignKey("vqe_executions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("run_json", _JSON, nullable=False),
        sa.Column("run_sha256", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "status in ('planned','running','comparable','comparability_failed',"
            "'inconclusive','failed')",
            name="ck_vqe_controlled_comparison_runs_status",
        ),
        sa.CheckConstraint(
            "baseline_execution_id <> candidate_execution_id",
            name="ck_vqe_controlled_comparison_runs_distinct_executions",
        ),
        sa.CheckConstraint(
            "run_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_controlled_comparison_runs_sha",
        ),
        sa.UniqueConstraint(
            "comparison_spec_id",
            "baseline_execution_id",
            "candidate_execution_id",
            name="uq_vqe_controlled_comparison_runs_identity",
        ),
    )
    op.create_index(
        "ix_vqe_controlled_comparison_runs_spec",
        "vqe_controlled_comparison_runs",
        ["comparison_spec_id", "created_at"],
    )
    op.execute(
        f"""
        create function {_FUNCTION}()
        returns trigger language plpgsql as $$
        begin
            raise exception 'VQE controlled comparison records are append-only';
        end;
        $$;
        """
    )
    for table in _TABLES:
        _append_only(table)


def downgrade() -> None:
    count = (
        op.get_bind()
        .execute(
            sa.text(
                "select (select count(*) from vqe_controlled_comparison_specs) + "
                "(select count(*) from vqe_controlled_comparison_runs)"
            )
        )
        .scalar_one()
    )
    if count:
        raise RuntimeError("cannot downgrade 0039 while comparison evidence exists")
    for table in reversed(_TABLES):
        op.execute(f"drop trigger if exists trg_{table}_append_only on {table}")
    op.execute(f"drop function if exists {_FUNCTION}()")
    op.drop_index(
        "ix_vqe_controlled_comparison_runs_spec",
        table_name="vqe_controlled_comparison_runs",
    )
    op.drop_table("vqe_controlled_comparison_runs")
    op.drop_index(
        "ix_vqe_controlled_comparison_specs_workspace",
        table_name="vqe_controlled_comparison_specs",
    )
    op.drop_table("vqe_controlled_comparison_specs")
