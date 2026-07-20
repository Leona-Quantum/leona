"""Allow 'skipped' in verification_records.result.

Revision ID: 0022
Revises: 0021

Contracts 1.3.0 adds VerificationResultKind.SKIPPED — a check that was
structurally incapable of evaluating the circuit (mid-circuit measurement /
classical control flow against the statistical check's statevector path,
production run 019f7e46-d688), as opposed to one that ran and disagreed. The
enum's docstring promises its values match the DB CHECK constraints, so the
allowlist widens in the same PR even though production currently records
deterministic checks on candidate_verifications JSONB rather than in this table.

Purely additive: the old revision never writes 'skipped', and every value it
does write stays valid for the length of the deploy.
"""

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None

_RESULT_CONSTRAINT = "ck_result_enum"
_RESULTS_OLD = ("pass", "fail")
_RESULTS_NEW = (*_RESULTS_OLD, "skipped")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.drop_constraint(_RESULT_CONSTRAINT, "verification_records", type_="check")
    op.create_check_constraint(
        _RESULT_CONSTRAINT, "verification_records", _in("result", _RESULTS_NEW)
    )


def downgrade() -> None:
    # A skipped check is "no evidence either way"; rows recording one would
    # violate the narrower constraint, so they are removed rather than rewritten
    # into a verdict they never were.
    op.execute("DELETE FROM verification_records WHERE result = 'skipped'")
    op.drop_constraint(_RESULT_CONSTRAINT, "verification_records", type_="check")
    op.create_check_constraint(
        _RESULT_CONSTRAINT, "verification_records", _in("result", _RESULTS_OLD)
    )
