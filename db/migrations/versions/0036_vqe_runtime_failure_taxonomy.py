"""Add bounded-output failure evidence for the VQE runtime.

Revision ID: 0036
Revises: 0035

The application contract gained ``output_limit_exceeded`` so a deterministic
runtime safety violation is not mislabeled as transient infrastructure
unavailability. The downgrade refuses to erase evidence that uses the new
closed-set value.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None

_OLD_FAILURE_CODES = (
    "invalid_spec",
    "unsupported_capability",
    "runtime_unavailable",
    "runtime_timeout",
    "runtime_oom",
    "execution_failed",
    "result_contract_failed",
    "numerical_mismatch",
    "inconclusive",
)
_NEW_FAILURE_CODES = (*_OLD_FAILURE_CODES, "output_limit_exceeded")
_CONSTRAINT = "ck_vqe_observations_failure_code"


def _predicate(values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"failure_code is null or failure_code in ({quoted})"


def upgrade() -> None:
    op.drop_constraint(_CONSTRAINT, "vqe_observations", type_="check")
    op.create_check_constraint(
        _CONSTRAINT,
        "vqe_observations",
        _predicate(_NEW_FAILURE_CODES),
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            do $$ begin
                if exists (
                    select 1
                    from vqe_observations
                    where failure_code = 'output_limit_exceeded'
                ) then
                    raise exception
                        'cannot downgrade 0036: output-limit evidence exists';
                end if;
            end $$;
            """
        )
    )
    op.drop_constraint(_CONSTRAINT, "vqe_observations", type_="check")
    op.create_check_constraint(
        _CONSTRAINT,
        "vqe_observations",
        _predicate(_OLD_FAILURE_CODES),
    )
