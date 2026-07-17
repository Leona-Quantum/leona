"""Add fenced leases and bounded retries to durable jobs.

Revision ID: 0012
Revises: 0011
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("lease_token", postgresql.UUID(as_uuid=True)))
    op.add_column("jobs", sa.Column("lease_expires_at", sa.TIMESTAMP(timezone=True)))
    op.add_column("jobs", sa.Column("last_heartbeat_at", sa.TIMESTAMP(timezone=True)))
    op.add_column(
        "jobs",
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="3"),
    )
    op.add_column("jobs", sa.Column("last_error_kind", sa.Text()))
    op.add_column("jobs", sa.Column("dead_lettered_at", sa.TIMESTAMP(timezone=True)))
    op.add_column("jobs", sa.Column("dead_letter_error", sa.Text()))
    op.add_column(
        "jobs",
        sa.Column("dead_letter_attempts", sa.Integer(), nullable=False, server_default="0"),
    )

    # A deploy must normally drain workers before migration. If a legacy worker
    # was interrupted, make its running row immediately recoverable instead of
    # leaving it permanently locked. The row id is only a temporary fencing token;
    # no post-migration worker can successfully heartbeat with it.
    op.execute(
        "UPDATE jobs SET lease_token = id, lease_expires_at = now(), "
        "last_heartbeat_at = now(), last_error_kind = 'migration_lease_reset' "
        "WHERE status = 'running'"
    )
    op.execute(
        "UPDATE jobs SET locked_by = NULL, locked_at = NULL, lease_token = NULL, "
        "lease_expires_at = NULL, last_heartbeat_at = NULL "
        "WHERE status <> 'running'"
    )
    # Terminal rows predate the callback marker. Treat them as historical and
    # already delivered so deploying this migration cannot replay old failures.
    op.execute(
        "UPDATE jobs SET dead_lettered_at = COALESCE(updated_at, now()) "
        "WHERE status IN ('failed', 'dead')"
    )

    op.create_check_constraint(
        "ck_jobs_max_attempts",
        "jobs",
        "max_attempts BETWEEN 1 AND 20",
    )
    op.create_check_constraint(
        "ck_jobs_dead_letter_attempts",
        "jobs",
        "dead_letter_attempts >= 0",
    )
    op.create_check_constraint(
        "ck_jobs_lease_shape",
        "jobs",
        "(status = 'running' AND locked_by IS NOT NULL AND locked_at IS NOT NULL "
        "AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR "
        "(status <> 'running' AND locked_by IS NULL AND locked_at IS NULL "
        "AND lease_token IS NULL AND lease_expires_at IS NULL)",
    )
    op.create_index(
        "ix_jobs_running_lease_expiry",
        "jobs",
        ["lease_expires_at"],
        postgresql_where=sa.text("status = 'running'"),
    )
    op.create_index(
        "ix_jobs_pending_dead_letter",
        "jobs",
        ["updated_at"],
        postgresql_where=sa.text("status IN ('failed', 'dead') AND dead_lettered_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_jobs_pending_dead_letter", table_name="jobs")
    op.drop_index("ix_jobs_running_lease_expiry", table_name="jobs")
    op.drop_constraint("ck_jobs_lease_shape", "jobs", type_="check")
    op.drop_constraint("ck_jobs_dead_letter_attempts", "jobs", type_="check")
    op.drop_constraint("ck_jobs_max_attempts", "jobs", type_="check")
    op.drop_column("jobs", "dead_letter_attempts")
    op.drop_column("jobs", "dead_letter_error")
    op.drop_column("jobs", "dead_lettered_at")
    op.drop_column("jobs", "last_error_kind")
    op.drop_column("jobs", "max_attempts")
    op.drop_column("jobs", "last_heartbeat_at")
    op.drop_column("jobs", "lease_expires_at")
    op.drop_column("jobs", "lease_token")
