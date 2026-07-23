"""Allow the durable replan agent tool.

Revision ID: 0028
Revises: 0027

The value is additive. Downgrade refuses to discard completed or in-flight
replan history because those steps are part of crash-replay authority.
"""

from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None

_NAME_CONSTRAINT = "ck_agent_steps_name"
_NAMES_OLD = (
    "request_plan",
    "simulate_qiskit",
    "simulate_cirq",
    "simulate_pennylane",
    "verify_intent_alignment",
    "convert_to_openqasm",
    "publish_artifact",
)
_NAMES_NEW = (*_NAMES_OLD, "replan")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.drop_constraint(_NAME_CONSTRAINT, "agent_steps", type_="check")
    op.create_check_constraint(_NAME_CONSTRAINT, "agent_steps", _in("name", _NAMES_NEW))


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM agent_steps WHERE name = 'replan') THEN
                RAISE EXCEPTION 'cannot downgrade 0028: replan tool history exists';
            END IF;
        END $$
        """
    )
    op.drop_constraint(_NAME_CONSTRAINT, "agent_steps", type_="check")
    op.create_check_constraint(_NAME_CONSTRAINT, "agent_steps", _in("name", _NAMES_OLD))
