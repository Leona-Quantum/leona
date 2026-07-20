"""Allow 'statistical_native' in verification_records.method.

Revision ID: 0023
Revises: 0022

Contracts 1.4.0 adds VerificationMethod.STATISTICAL_NATIVE — reported counts
compared against a trusted framework-native re-execution of the circuit object,
the mid-circuit-capable physical check (plans/framework-native-verification.md).
Same discipline as 0021/0022: the Python enum and the database allowlist are two
gates on one value and must widen together, even though production currently
records deterministic checks on candidate_verifications JSONB.

Purely additive: the old revision never writes the value, and every value it
does write stays valid for the length of the deploy.
"""

from alembic import op

revision = "0023"
down_revision = "0022"
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
)
_METHODS_NEW = (*_METHODS_OLD, "statistical_native")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.drop_constraint(_METHOD_CONSTRAINT, "verification_records", type_="check")
    op.create_check_constraint(
        _METHOD_CONSTRAINT, "verification_records", _in("method", _METHODS_NEW)
    )


def downgrade() -> None:
    op.execute("DELETE FROM verification_records WHERE method = 'statistical_native'")
    op.drop_constraint(_METHOD_CONSTRAINT, "verification_records", type_="check")
    op.create_check_constraint(
        _METHOD_CONSTRAINT, "verification_records", _in("method", _METHODS_OLD)
    )
