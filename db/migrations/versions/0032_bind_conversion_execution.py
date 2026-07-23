"""Bind conversion evidence to the exact framework-native execution.

Revision ID: 0032
Revises: 0031
"""

import sqlalchemy as sa
from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None

_FK = "fk_candidate_conversions_execution_binding"


def upgrade() -> None:
    op.add_column(
        "candidate_conversions",
        sa.Column("execution_id", sa.UUID(), nullable=True),
    )
    op.execute(
        """
        UPDATE candidate_conversions AS conversion
        SET execution_id = execution.id
        FROM candidate_executions AS execution
        WHERE execution.candidate_id = conversion.candidate_id
          AND execution.source_fingerprint = conversion.source_fingerprint
        """
    )
    op.alter_column("candidate_conversions", "execution_id", nullable=False)
    op.create_foreign_key(
        _FK,
        "candidate_conversions",
        "candidate_executions",
        ["execution_id", "candidate_id", "source_fingerprint"],
        ["id", "candidate_id", "source_fingerprint"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM candidate_conversions) THEN
                RAISE EXCEPTION 'cannot downgrade 0032: execution-bound conversion evidence exists';
            END IF;
        END $$
        """
    )
    op.drop_constraint(_FK, "candidate_conversions", type_="foreignkey")
    op.drop_column("candidate_conversions", "execution_id")
