"""Allow fixed-policy Bell and GHZ state-property verification methods.

Revision ID: 0027
Revises: 0026

The new values are additive. Downgrade refuses to erase immutable verification
evidence that uses them; an operator must retain the expanded schema or archive
that evidence explicitly before retrying.
"""

from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None

_METHOD_CONSTRAINT = "ck_method_enum"
_METHODS_OLD = (
    "exact",
    "statistical",
    "brute_force",
    "exact_diag",
    "return_contract",
    "qasm_parse",
    "statistical_native",
    "structural",
    "resource_contract",
    "measurement_policy",
    "success_criteria",
    "native_optimization_evidence",
    "statistical_reproducibility",
)
_METHODS_NEW = (*_METHODS_OLD, "bell_state_property", "ghz_state_property")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.drop_constraint(_METHOD_CONSTRAINT, "verification_records", type_="check")
    op.create_check_constraint(
        _METHOD_CONSTRAINT, "verification_records", _in("method", _METHODS_NEW)
    )


def downgrade() -> None:
    added = tuple(value for value in _METHODS_NEW if value not in _METHODS_OLD)
    quoted = ", ".join(f"'{value}'" for value in added)
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM verification_records WHERE method in ({quoted})
            ) THEN
                RAISE EXCEPTION
                    'cannot downgrade 0027: Bell/GHZ property evidence exists';
            END IF;
        END $$
        """
    )
    op.drop_constraint(_METHOD_CONSTRAINT, "verification_records", type_="check")
    op.create_check_constraint(
        _METHOD_CONSTRAINT, "verification_records", _in("method", _METHODS_OLD)
    )
