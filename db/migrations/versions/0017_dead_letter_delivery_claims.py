"""Add fenced, expiring reservations for Dead Letter callback delivery.

Revision ID: 0017
Revises: 0016
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("dead_letter_locked_by", sa.Text()))
    op.add_column("jobs", sa.Column("dead_letter_lease_token", postgresql.UUID(as_uuid=True)))
    op.add_column("jobs", sa.Column("dead_letter_lease_expires_at", sa.TIMESTAMP(timezone=True)))
    op.create_check_constraint(
        "ck_jobs_dead_letter_lease_shape",
        "jobs",
        "(dead_letter_locked_by IS NULL AND dead_letter_lease_token IS NULL "
        "AND dead_letter_lease_expires_at IS NULL) OR "
        "(status IN ('failed', 'dead') AND dead_lettered_at IS NULL "
        "AND dead_letter_locked_by IS NOT NULL AND dead_letter_lease_token IS NOT NULL "
        "AND dead_letter_lease_expires_at IS NOT NULL)",
    )
    op.create_index(
        "ix_jobs_pending_dead_letter_delivery",
        "jobs",
        ["run_after", "dead_letter_lease_expires_at"],
        postgresql_where=sa.text("status IN ('failed', 'dead') AND dead_lettered_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_jobs_pending_dead_letter_delivery", table_name="jobs")
    op.drop_constraint("ck_jobs_dead_letter_lease_shape", "jobs", type_="check")
    op.drop_column("jobs", "dead_letter_lease_expires_at")
    op.drop_column("jobs", "dead_letter_lease_token")
    op.drop_column("jobs", "dead_letter_locked_by")
