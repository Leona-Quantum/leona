"""Allow audited semantic-review and strict-verification transitions.

Revision ID: 0029
Revises: 0028

Legacy tool/state values remain readable for immutable run history. Downgrade
fails closed when new history exists instead of deleting audit evidence.
"""

from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None

_TOOL_NAMES_OLD = (
    "request_plan",
    "simulate_qiskit",
    "simulate_cirq",
    "simulate_pennylane",
    "verify_intent_alignment",
    "convert_to_openqasm",
    "publish_artifact",
    "replan",
)
_TOOL_NAMES_NEW = (
    *_TOOL_NAMES_OLD,
    "review_candidate",
    "strict_verify",
    "materialize_artifact",
)
_CANDIDATE_STATUSES_OLD = (
    "created",
    "executed",
    "repair_required",
    "resource_exhausted",
    "verified",
    "published",
)
_CANDIDATE_STATUSES_NEW = (*_CANDIDATE_STATUSES_OLD, "reviewed", "inconclusive")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.drop_constraint("ck_agent_steps_name", "agent_steps", type_="check")
    op.create_check_constraint("ck_agent_steps_name", "agent_steps", _in("name", _TOOL_NAMES_NEW))
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
            IF EXISTS (
                SELECT 1 FROM agent_steps
                WHERE name IN ('review_candidate', 'strict_verify', 'materialize_artifact')
            ) THEN
                RAISE EXCEPTION 'cannot downgrade 0029: audited tool history exists';
            END IF;
            IF EXISTS (
                SELECT 1 FROM run_candidates WHERE status IN ('reviewed', 'inconclusive')
            ) THEN
                RAISE EXCEPTION 'cannot downgrade 0029: audited candidate status exists';
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
    op.drop_constraint("ck_agent_steps_name", "agent_steps", type_="check")
    op.create_check_constraint("ck_agent_steps_name", "agent_steps", _in("name", _TOOL_NAMES_OLD))
