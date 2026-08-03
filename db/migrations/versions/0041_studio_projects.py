"""Studio's artifact grouping ("Projects") becomes a workspace row.

Revision ID: 0041
Revises: 0040

Projects have existed since the Vault retirement, but only in the browser:
`apps/web/lib/artifact-folders.ts` kept the list under
`majorana.artifact-folders.v1` and the assignments under
`majorana.artifact-folder-assignments.v1`, both in per-account localStorage. So a
person's grouping did not survive a second device, a cleared browser, or a
teammate — three people in one workspace each saw a different set of projects
over the same artifacts, and none of them was wrong.

Run's Folders were moved server-side in 0006 for exactly this reason. This is the
same move for Studio, and it is also the precursor to sharing: a grouping that
exists only in one browser cannot be granted to anyone.

Shaped after `workspace_folders` deliberately, so the two groupings stay one
mental model:

- `position` is a plain integer and is NOT unique — a unique (workspace_id,
  position) makes every reorder an ordering problem of its own (see 0040's note),
  and ties fall back to `(created_at, id)`, the order a fresh table already has.
- `artifacts.project_id` is a nullable FK with **no cascade**, matching
  `runs.folder_id`. Deleting a project must never delete the artifacts in it, so
  the repository NULLs them first; without the FK that discipline would be
  optional, and with a cascade it would be impossible.
- An artifact is in at most one project. A many-to-many would let one artifact
  reach a workspace through two different grants once sharing lands, which is a
  second authorization path *inside* the second authorization path.

Nullable on purpose: `db/seeds/seed.py` inserts artifacts with raw SQL and does
not name this column, so a NOT NULL addition here takes the `db` CI job down.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "workspace_id", UUID(as_uuid=True), sa.ForeignKey("workspaces.id"), nullable=False
        ),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    # Case-insensitive uniqueness per workspace, exactly as folders have. The
    # repository compares lowercased names before writing so the caller gets a
    # sentence rather than an IntegrityError, but the database is what makes it
    # true under two concurrent creates.
    op.create_index(
        "uq_projects_workspace_name_lower",
        "projects",
        ["workspace_id", sa.text("lower(name)")],
        unique=True,
    )
    # Serves `order by position, created_at, id` within one workspace — the query
    # behind every Studio sidebar render.
    op.create_index("ix_projects_workspace_position", "projects", ["workspace_id", "position"])
    op.add_column("artifacts", sa.Column("project_id", UUID(as_uuid=True)))
    op.create_foreign_key(
        "fk_artifacts_project_id", "artifacts", "projects", ["project_id"], ["id"]
    )
    op.create_index("ix_artifacts_workspace_project", "artifacts", ["workspace_id", "project_id"])
    op.execute(
        """
        do $$
        begin
            if exists (select 1 from pg_roles where rolname = 'app_rw') then
                grant select, insert, update, delete on projects to app_rw;
            end if;
        end $$;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_artifacts_workspace_project", table_name="artifacts")
    op.drop_constraint("fk_artifacts_project_id", "artifacts", type_="foreignkey")
    op.drop_column("artifacts", "project_id")
    op.drop_index("ix_projects_workspace_position", table_name="projects")
    op.drop_index("uq_projects_workspace_name_lower", table_name="projects")
    op.drop_table("projects")
