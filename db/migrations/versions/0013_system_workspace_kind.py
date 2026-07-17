"""Add the isolated system workspace kind for the public catalog authority.

Revision ID: 0013
Revises: 0012

This migration changes only the allowed workspace-kind values. Service
principals and the catalog workspace are provisioned explicitly after the
migration, never implicitly during deploy.
"""

from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_kind_enum", "workspaces", type_="check")
    op.create_check_constraint(
        "ck_kind_enum",
        "workspaces",
        "kind in ('personal', 'team', 'system')",
    )


def downgrade() -> None:
    connection = op.get_bind()
    system_count = connection.execute(
        sa.text("SELECT count(*) FROM workspaces WHERE kind = 'system'")
    ).scalar_one()
    if system_count:
        raise RuntimeError(
            "cannot downgrade 0013 while system workspaces exist; "
            "deprovision the empty catalog authority first"
        )
    op.drop_constraint("ck_kind_enum", "workspaces", type_="check")
    op.create_check_constraint(
        "ck_kind_enum",
        "workspaces",
        "kind in ('personal', 'team')",
    )
