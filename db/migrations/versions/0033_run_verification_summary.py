"""Persist typed terminal verification summaries on runs.

Revision ID: 0033
Revises: 0032
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "runs",
        sa.Column("verification_summary", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM runs WHERE verification_summary IS NOT NULL) THEN
                RAISE EXCEPTION 'cannot downgrade 0033: typed run verification summaries exist';
            END IF;
        END $$
        """
    )
    op.drop_column("runs", "verification_summary")
