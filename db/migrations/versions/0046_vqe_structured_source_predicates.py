"""Add the container predicate for deterministic source extraction.

Revision ID: 0044
Revises: 0043

This migration widens only the private append-only metadata assertion
predicate allowlist. It creates no public component, claim, or artifact.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None

_CONSTRAINT = "ck_github_metadata_assertions_predicate"
_OLD_PREDICATES = (
    "license_file_present",
    "citation_file_present",
    "dependency_declaration_present",
    "ci_workflow_present",
)
_NEW_PREDICATES = (*_OLD_PREDICATES, "container_declaration_present")


def _predicate_check(values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"predicate in ({quoted})"


def upgrade() -> None:
    op.drop_constraint(_CONSTRAINT, "github_metadata_assertions", type_="check")
    op.create_check_constraint(
        _CONSTRAINT,
        "github_metadata_assertions",
        _predicate_check(_NEW_PREDICATES),
    )


def downgrade() -> None:
    count = (
        op.get_bind()
        .execute(
            sa.text(
                "select count(*) from github_metadata_assertions "
                "where predicate = 'container_declaration_present'"
            )
        )
        .scalar_one()
    )
    if count:
        raise RuntimeError("cannot downgrade 0044 while container source evidence exists")
    op.drop_constraint(_CONSTRAINT, "github_metadata_assertions", type_="check")
    op.create_check_constraint(
        _CONSTRAINT,
        "github_metadata_assertions",
        _predicate_check(_OLD_PREDICATES),
    )
