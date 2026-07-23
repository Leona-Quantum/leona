"""Separate private materialization from legacy publication state.

Revision ID: 0031
Revises: 0030

The new JSON record is additive and immutable at the repository boundary.
Downgrade refuses to discard materialization history.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None

_CANDIDATE_STATUSES_OLD = (
    "created",
    "executed",
    "repair_required",
    "resource_exhausted",
    "verified",
    "published",
    "reviewed",
    "inconclusive",
)
_CANDIDATE_STATUSES_NEW = (*_CANDIDATE_STATUSES_OLD, "materialized")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.add_column(
        "agent_runs",
        sa.Column("materialization", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.drop_constraint("ck_run_candidates_status", "run_candidates", type_="check")
    op.create_check_constraint(
        "ck_run_candidates_status",
        "run_candidates",
        _in("status", _CANDIDATE_STATUSES_NEW),
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM agent_runs WHERE materialization IS NOT NULL) THEN
                RAISE EXCEPTION 'cannot downgrade 0031: materialization history exists';
            END IF;
            IF EXISTS (SELECT 1 FROM run_candidates WHERE status = 'materialized') THEN
                RAISE EXCEPTION 'cannot downgrade 0031: materialized candidate status exists';
            END IF;
        END $$
        """
    )
    op.drop_constraint("ck_run_candidates_status", "run_candidates", type_="check")
    op.create_check_constraint(
        "ck_run_candidates_status",
        "run_candidates",
        _in("status", _CANDIDATE_STATUSES_OLD),
    )
    op.drop_column("agent_runs", "materialization")
