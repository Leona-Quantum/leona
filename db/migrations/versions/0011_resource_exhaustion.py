"""Persist terminal resource-exhaustion evidence.

Revision ID: 0011
Revises: 0010
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_agent_runs_state", "agent_runs", type_="check")
    op.create_check_constraint(
        "ck_agent_runs_state",
        "agent_runs",
        "state IN ('new','planned','executed','repair_required','resource_exhausted',"
        "'verified','qasm_attempted','published','completed','failed','cancelled')",
    )
    op.drop_constraint("ck_run_candidates_status", "run_candidates", type_="check")
    op.create_check_constraint(
        "ck_run_candidates_status",
        "run_candidates",
        "status IN ('created','executed','repair_required','resource_exhausted',"
        "'verified','published')",
    )
    op.add_column("candidate_executions", sa.Column("failure_kind", sa.Text()))
    # Preserve pre-0011 failed executions as ordinary code failures. Without this
    # backfill, old evidence would violate the new invariant and could not be read.
    op.execute(
        "UPDATE candidate_executions SET failure_kind = 'code_error' "
        "WHERE exit_code <> 0 AND failure_kind IS NULL"
    )
    op.create_check_constraint(
        "ck_candidate_executions_failure_kind",
        "candidate_executions",
        "(exit_code = 0 AND failure_kind IS NULL) OR "
        "(exit_code <> 0 AND failure_kind IN "
        "('code_error','timeout','memory_exhausted','resource_limit'))",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_candidate_executions_failure_kind", "candidate_executions", type_="check"
    )
    op.drop_column("candidate_executions", "failure_kind")
    op.execute(
        "UPDATE run_candidates SET status = 'repair_required' WHERE status = 'resource_exhausted'"
    )
    op.drop_constraint("ck_run_candidates_status", "run_candidates", type_="check")
    op.create_check_constraint(
        "ck_run_candidates_status",
        "run_candidates",
        "status IN ('created','executed','repair_required','verified','published')",
    )
    op.execute("UPDATE agent_runs SET state = 'failed' WHERE state = 'resource_exhausted'")
    op.drop_constraint("ck_agent_runs_state", "agent_runs", type_="check")
    op.create_check_constraint(
        "ck_agent_runs_state",
        "agent_runs",
        "state IN ('new','planned','executed','repair_required','verified',"
        "'qasm_attempted','published','completed','failed','cancelled')",
    )
