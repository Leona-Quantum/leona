"""Add VQE live-readiness and append-only launch decision evidence.

Revision ID: vqe_launch_0057
Revises: vqe_reconcile_0056
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "vqe_launch_0057"
down_revision = "vqe_reconcile_0056"
branch_labels = None
depends_on = None

_DECISION_FUNCTION = "majorana_reject_vqe_launch_decision_mutation"
_DECISION_TRIGGER = "trg_vqe_launch_decisions_append_only"


def upgrade() -> None:
    op.create_table(
        "vqe_runtime_readiness",
        sa.Column("runtime_profile_id", sa.Text(), primary_key=True),
        sa.Column("generation", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("worker_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("detail_sha256", sa.Text(), nullable=False),
        sa.Column("observed_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "status in ('ready', 'unavailable')",
            name="ck_vqe_runtime_readiness_status",
        ),
        sa.CheckConstraint(
            "detail_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_runtime_readiness_detail_sha256",
        ),
        sa.CheckConstraint(
            "expires_at > observed_at",
            name="ck_vqe_runtime_readiness_expiry",
        ),
    )
    op.create_index(
        "ix_vqe_runtime_readiness_expires_at",
        "vqe_runtime_readiness",
        ["expires_at"],
    )

    op.create_table(
        "vqe_launch_decisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workspaces.id"),
            nullable=False,
        ),
        sa.Column("actor_hmac_sha256", sa.Text(), nullable=False),
        sa.Column("request_id", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column(
            "workflow_artifact_version_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("artifact_versions.id"),
            nullable=False,
        ),
        sa.Column(
            "experiment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vqe_experiments.id"),
            nullable=True,
        ),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("primary_reason_code", sa.Text(), nullable=True),
        sa.Column("blockers_json", postgresql.JSONB(), nullable=False),
        sa.Column("projection_sha256", sa.Text(), nullable=False),
        sa.Column("registry_snapshot_sha256", sa.Text(), nullable=False),
        sa.Column("readiness_snapshot_json", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "actor_hmac_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_launch_decisions_actor_hmac",
        ),
        sa.CheckConstraint(
            "projection_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_launch_decisions_projection_sha256",
        ),
        sa.CheckConstraint(
            "registry_snapshot_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_vqe_launch_decisions_registry_snapshot_sha256",
        ),
        sa.CheckConstraint(
            "action in ('create_validated_draft', 'create_experiment', 'start_execution')",
            name="ck_vqe_launch_decisions_action",
        ),
        sa.CheckConstraint(
            "decision in "
            "('accepted', 'blocked', 'stale_rejected', 'invariant_rejected', "
            "'conflict_rejected')",
            name="ck_vqe_launch_decisions_decision",
        ),
    )
    op.create_index(
        "ix_vqe_launch_decisions_workspace_created",
        "vqe_launch_decisions",
        ["workspace_id", "created_at"],
    )
    op.create_index(
        "ix_vqe_launch_decisions_request_id",
        "vqe_launch_decisions",
        ["request_id"],
    )
    op.execute(
        sa.text(
            f"""
            create function {_DECISION_FUNCTION}()
            returns trigger language plpgsql as $$
            begin
                raise exception 'VQE launch decisions are append-only'
                    using errcode = '55000';
            end;
            $$;
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            create trigger {_DECISION_TRIGGER}
            before update or delete on vqe_launch_decisions
            for each row execute function {_DECISION_FUNCTION}();
            """
        )
    )
    op.execute(
        sa.text(
            """
            do $$ begin
                if exists (select 1 from pg_roles where rolname = 'app_rw') then
                    grant select, insert on vqe_launch_decisions to app_rw;
                    revoke update, delete on vqe_launch_decisions from app_rw;
                end if;
            end $$;
            """
        )
    )


def downgrade() -> None:
    decision_count = (
        op.get_bind().execute(sa.text("select count(*) from vqe_launch_decisions")).scalar_one()
    )
    if decision_count:
        raise RuntimeError("cannot downgrade 0057 while VQE launch decision evidence exists")
    op.execute(sa.text(f"drop trigger if exists {_DECISION_TRIGGER} on vqe_launch_decisions"))
    op.execute(sa.text(f"drop function if exists {_DECISION_FUNCTION}()"))
    op.drop_index("ix_vqe_launch_decisions_request_id", table_name="vqe_launch_decisions")
    op.drop_index(
        "ix_vqe_launch_decisions_workspace_created",
        table_name="vqe_launch_decisions",
    )
    op.drop_table("vqe_launch_decisions")
    op.drop_index("ix_vqe_runtime_readiness_expires_at", table_name="vqe_runtime_readiness")
    op.drop_table("vqe_runtime_readiness")
