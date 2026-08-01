"""How many artifacts a shared project may hold.

Revision ID: 0043
Revises: 0042

0042 gave a grantee the right to *edit* circuits in a project shared with them. It
deliberately stopped short of letting them ADD one, and the reason was an accounting
problem rather than a security one: a new artifact in somebody else's project is a
row in **their** workspace, counted against **their** tier allowance. Nobody should
be able to spend another account's allowance without that account having said how
much.

This column is that consent. It bounds the project's contents, and it is checked
when a grantee contributes.

Three choices worth the words:

- **The limit is on the PROJECT, not on the grant.** A per-grant limit of fifty
  shared with four people is a two-hundred-artifact project, which is not what
  anybody typing "fifty" means. The thing being bounded is the container.
- **NULL is the platform default, not "unlimited".** Every project that existed
  before this migration has NULL, and they are all shareable — so if NULL meant
  unbounded, this migration would ship the exact hole it exists to close, and it
  would be worst for the accounts whose allowance is unlimited. NULL resolves to
  `DEFAULT_PROJECT_ARTIFACT_LIMIT` in `repos/shares.py`, which means the number can
  be changed later for everyone who never chose one.
- **Zero is a legal value and it means something.** "Edit what is here, add
  nothing" is a real permission, and it is the one a person who shares a finished
  body of work for review actually wants. Expressing it as a limit rather than as a
  third ShareRole keeps `ShareRole` at two values that map cleanly onto
  `Role.MEMBER` / `Role.VIEWER` — the property that makes `require_admin` refuse a
  grantee every destructive operation without a denylist.

The CHECK constraint is in the database rather than only in Pydantic because the
column bounds what another tenant may write into this one's workspace. A negative
limit would be an unbounded one after the `count >= limit` comparison.
"""

import sqlalchemy as sa
from alembic import op

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("max_artifacts", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_projects_max_artifacts_range",
        "projects",
        "max_artifacts is null or (max_artifacts >= 0 and max_artifacts <= 500)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_projects_max_artifacts_range", "projects", type_="check")
    op.drop_column("projects", "max_artifacts")
