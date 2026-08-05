"""Add Amazon Braket to persisted framework and simulation-tool values.

Revision ID: 0048
Revises: 0047

This is expand-only for the deployed application: existing values remain valid.
Downgrade fails closed when Braket history exists instead of deleting or rewriting
immutable candidate and tool evidence.
"""

from alembic import op

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None

_FRAMEWORKS_OLD = ("qiskit", "cirq", "pennylane")
_FRAMEWORKS_NEW = (*_FRAMEWORKS_OLD, "braket")

_TOOL_NAMES_OLD = (
    "request_plan",
    "simulate_qiskit",
    "simulate_cirq",
    "simulate_pennylane",
    "verify_intent_alignment",
    "convert_to_openqasm",
    "publish_artifact",
    "replan",
    "review_candidate",
    "strict_verify",
    "materialize_artifact",
)
_TOOL_NAMES_NEW = (*_TOOL_NAMES_OLD, "simulate_braket")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.drop_constraint("ck_run_candidates_framework", "run_candidates", type_="check")
    op.create_check_constraint(
        "ck_run_candidates_framework",
        "run_candidates",
        _in("framework", _FRAMEWORKS_NEW),
    )
    op.drop_constraint("ck_agent_steps_name", "agent_steps", type_="check")
    op.create_check_constraint(
        "ck_agent_steps_name",
        "agent_steps",
        _in("name", _TOOL_NAMES_NEW),
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM run_candidates WHERE framework = 'braket'
            ) THEN
                RAISE EXCEPTION 'cannot downgrade 0048: Amazon Braket candidates exist';
            END IF;
            IF EXISTS (
                SELECT 1 FROM agent_steps WHERE name = 'simulate_braket'
            ) THEN
                RAISE EXCEPTION 'cannot downgrade 0048: Amazon Braket tool history exists';
            END IF;
        END $$
        """
    )
    op.drop_constraint("ck_agent_steps_name", "agent_steps", type_="check")
    op.create_check_constraint(
        "ck_agent_steps_name",
        "agent_steps",
        _in("name", _TOOL_NAMES_OLD),
    )
    op.drop_constraint("ck_run_candidates_framework", "run_candidates", type_="check")
    op.create_check_constraint(
        "ck_run_candidates_framework",
        "run_candidates",
        _in("framework", _FRAMEWORKS_OLD),
    )
