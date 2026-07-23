"""Durable qpu_run records — the second half of the two-PR qpu_run seam.

Revision ID: 0034
Revises: 0033

Purely additive: a new table whose column set mirrors the already-shipped
majorana_contracts.QpuRunRecord (contract landed first because deploys migrate
before rollout). The CHECK constraints pin the same enum values the contract
and majorana_qpu carry; parity across all three is pinned by
services/api/tests/test_qpu_routes.py.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_JSON = postgresql.JSONB(astext_type=sa.Text())

_STATUSES = ("queued", "running", "done", "error", "cancelled")
_PROVIDERS = ("ibm", "braket")
_ESTIMATE_BASES = ("vendor_rate_card", "free_tier_allowance")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.create_table(
        "qpu_runs",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "workspace_id",
            _UUID,
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", _UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "artifact_version_id",
            _UUID,
            sa.ForeignKey("artifact_versions.id", ondelete="SET NULL"),
        ),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("device_id", sa.Text(), nullable=False),
        sa.Column("provider_job_id", sa.Text()),
        sa.Column("shots", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("source_fingerprint", sa.Text(), nullable=False),
        # The submitted program itself: the worker resubmits from the durable
        # row, never from request memory, so a crash between enqueue and
        # provider submit loses nothing.
        sa.Column("qasm", sa.Text(), nullable=False),
        # Snapshot of the estimate as confirmed — what the user agreed to,
        # not what the rate card says later.
        sa.Column("estimate_basis", sa.Text(), nullable=False),
        sa.Column("estimated_total_usd", sa.Numeric(12, 4)),
        sa.Column("rate_source", sa.Text(), nullable=False),
        sa.Column("rate_confirmed_on", sa.Text(), nullable=False),
        sa.Column("raw_counts", _JSON),
        sa.Column("error", sa.Text()),
        sa.Column("submitted_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("completed_at", sa.TIMESTAMP(timezone=True)),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(_in("status", _STATUSES), name="ck_qpu_runs_status"),
        sa.CheckConstraint(_in("provider", _PROVIDERS), name="ck_qpu_runs_provider"),
        sa.CheckConstraint(
            _in("estimate_basis", _ESTIMATE_BASES), name="ck_qpu_runs_estimate_basis"
        ),
        sa.CheckConstraint("shots >= 1", name="ck_qpu_runs_shots"),
        sa.CheckConstraint("char_length(device_id) BETWEEN 1 AND 120", name="ck_qpu_runs_device"),
        sa.CheckConstraint(
            "char_length(source_fingerprint) BETWEEN 1 AND 200", name="ck_qpu_runs_fingerprint"
        ),
    )
    op.create_index("ix_qpu_runs_workspace_created", "qpu_runs", ["workspace_id", "created_at"])
    op.create_index("ix_qpu_runs_status", "qpu_runs", ["status"])
    op.execute(
        """
        do $$ begin
            if exists (select 1 from pg_roles where rolname = 'app_rw') then
                grant select, insert, update on qpu_runs to app_rw;
                revoke delete on qpu_runs from app_rw;
            end if;
        end $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM qpu_runs WHERE provider_job_id IS NOT NULL) THEN
                RAISE EXCEPTION
                    'cannot downgrade 0034: provider-attested qpu_run records exist';
            END IF;
        END $$
        """
    )
    op.drop_table("qpu_runs")
