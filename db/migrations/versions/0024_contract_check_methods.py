"""Allow the six contract-check names in verification_records.method.

Revision ID: 0024
Revises: 0023

`VerificationMethod` gains `structural`, `resource_contract`, `measurement_policy`,
`success_criteria`, `native_optimization_evidence` and `statistical_reproducibility`
— names the verifier has always emitted but the enum never carried, so
`agent_events.py` dropped them and six of the panel's ten checks never reached
`run_events`. Same discipline as 0021/0022/0023: the Python enum and the database
allowlist are two gates on one value and widen together in one deploy.

Unlike 0023 this pairing is now enforced rather than remembered —
packages/py/contracts/tests/test_method_allowlist.py parses this file and fails if
the two lists drift.

Purely additive: the old revision never writes these values, and every value it
does write stays valid for the length of the deploy.
"""

from alembic import op

revision = "0024"
down_revision = "0023"
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
)
_METHODS_NEW = (
    *_METHODS_OLD,
    "structural",
    "resource_contract",
    "measurement_policy",
    "success_criteria",
    "native_optimization_evidence",
    "statistical_reproducibility",
)


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
    op.execute(f"DELETE FROM verification_records WHERE method in ({quoted})")
    op.drop_constraint(_METHOD_CONSTRAINT, "verification_records", type_="check")
    op.create_check_constraint(
        _METHOD_CONSTRAINT, "verification_records", _in("method", _METHODS_OLD)
    )
