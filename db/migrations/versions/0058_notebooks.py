"""Add Notebooks: AI-generated Jupyter lessons as a versioned resource.

Revision ID: 0058
Revises: 0057

Precedent is Qapps (migration 0055): a durable, private-by-default generated
object with an immutable version history and a `current_version_id` deferred
FK back onto the version it points at. The differences from that shape:

- A notebook's versions are not content-addressed (no `fingerprint`/dedup by
  originating run) — each version is a distinct generation or revision turn,
  never collapsed with an earlier one.
- There is a third table, `notebook_turns`: the chat-style back-and-forth
  ("make this harder", "add a figure") that produces new versions, kept
  separate from the versions themselves so the conversation can be replayed
  independently of which version is current.
- No `public_read` RLS policy. Notebooks carry a `visibility` column for a
  future public surface, but nothing in this slice serves one — adding the
  policy ahead of a route that uses it would be an unused escape hatch in a
  RLS-enabled table, which is exactly the kind of thing ADR-0028 asks to be
  reviewed deliberately rather than shipped by habit.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None

_RUN_MODES_OLD = ("auto", "chat", "execute", "ideate", "explain", "qapp")
_RUN_MODES_NEW = (*_RUN_MODES_OLD, "notebook")

_NOTEBOOK_KINDS = (
    "lesson",
    "lab",
    "challenge",
    "solution",
    "walkthrough",
    "demo",
    "quiz",
    "hardware",
    "benchmark",
    "project",
    "scratch",
)
_VERSION_STATUSES = ("queued", "running", "ready", "failed")
_AUTHORS = ("user", "nala")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.drop_constraint("ck_mode_enum", "runs", type_="check")
    op.create_check_constraint("ck_mode_enum", "runs", _in("mode", _RUN_MODES_NEW))

    op.create_table(
        "notebooks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("visibility", sa.Text(), nullable=False, server_default="private"),
        sa.Column("language", sa.Text(), nullable=False, server_default="en"),
        sa.Column(
            "framework",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("current_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.UniqueConstraint("workspace_id", "slug", name="uq_notebooks_workspace_slug"),
        sa.CheckConstraint("char_length(slug) between 1 and 80", name="ck_notebooks_slug_length"),
        sa.CheckConstraint(
            "char_length(title) between 1 and 240", name="ck_notebooks_title_length"
        ),
        sa.CheckConstraint("char_length(summary) <= 2000", name="ck_notebooks_summary_length"),
        sa.CheckConstraint(_in("kind", _NOTEBOOK_KINDS), name="ck_notebooks_kind"),
        sa.CheckConstraint("visibility in ('private','public')", name="ck_notebooks_visibility"),
        sa.CheckConstraint("language in ('en','ja')", name="ck_notebooks_language"),
    )
    op.create_index("ix_notebooks_workspace_id", "notebooks", ["workspace_id", "id"])

    op.create_table(
        "notebook_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("notebook_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "request",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("spec", postgresql.JSONB(), nullable=True),
        sa.Column("source", sa.Text(), nullable=True),
        sa.Column("ipynb", postgresql.JSONB(), nullable=True),
        sa.Column("report", postgresql.JSONB(), nullable=True),
        sa.Column("review", postgresql.JSONB(), nullable=True),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("finished_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["notebook_id"], ["notebooks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.UniqueConstraint("notebook_id", "seq", name="uq_notebook_versions_seq"),
        sa.UniqueConstraint("notebook_id", "id", name="uq_notebook_versions_identity"),
        sa.CheckConstraint("seq >= 1", name="ck_notebook_versions_seq"),
        sa.CheckConstraint(_in("status", _VERSION_STATUSES), name="ck_notebook_versions_status"),
        sa.CheckConstraint(_in("created_by", _AUTHORS), name="ck_notebook_versions_created_by"),
        sa.CheckConstraint(
            "char_length(message) <= 2000", name="ck_notebook_versions_message_length"
        ),
        sa.CheckConstraint(
            "source is null or char_length(source) <= 400000",
            name="ck_notebook_versions_source_length",
        ),
        sa.CheckConstraint("char_length(error) <= 4000", name="ck_notebook_versions_error_length"),
    )
    op.create_foreign_key(
        "fk_notebooks_current_version",
        "notebooks",
        "notebook_versions",
        ["id", "current_version_id"],
        ["notebook_id", "id"],
        deferrable=True,
        initially="DEFERRED",
    )

    op.create_table(
        "notebook_turns",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("notebook_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["notebook_id"], ["notebooks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["notebook_versions.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.UniqueConstraint("notebook_id", "seq", name="uq_notebook_turns_seq"),
        sa.CheckConstraint("seq >= 1", name="ck_notebook_turns_seq"),
        sa.CheckConstraint(_in("role", _AUTHORS), name="ck_notebook_turns_role"),
        sa.CheckConstraint(
            "char_length(content) between 1 and 8000", name="ck_notebook_turns_content_length"
        ),
    )

    op.execute("alter table notebooks enable row level security")
    op.execute(
        "create policy tenant_isolation on notebooks for all using ("
        "current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        "notebooks.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid"
        ") with check (current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        "notebooks.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid)"
    )
    op.execute("alter table notebook_versions enable row level security")
    op.execute(
        "create policy tenant_isolation on notebook_versions for all using ("
        "current_setting('majorana.rls_enforce', true) is distinct from 'on' or exists ("
        "select 1 from notebooks n where n.id = notebook_versions.notebook_id and "
        "n.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid)) "
        "with check (current_setting('majorana.rls_enforce', true) is distinct from 'on' or exists ("
        "select 1 from notebooks n where n.id = notebook_versions.notebook_id and "
        "n.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid))"
    )
    op.execute("alter table notebook_turns enable row level security")
    op.execute(
        "create policy tenant_isolation on notebook_turns for all using ("
        "current_setting('majorana.rls_enforce', true) is distinct from 'on' or exists ("
        "select 1 from notebooks n where n.id = notebook_turns.notebook_id and "
        "n.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid)) "
        "with check (current_setting('majorana.rls_enforce', true) is distinct from 'on' or exists ("
        "select 1 from notebooks n where n.id = notebook_turns.notebook_id and "
        "n.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid))"
    )

    op.execute(
        """
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'app_rw') then
            grant select, insert, update, delete
              on notebooks, notebook_versions, notebook_turns to app_rw;
          end if;
        end
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        do $$
        begin
          if exists (select 1 from notebooks) or
             exists (select 1 from runs where mode = 'notebook') then
            raise exception 'cannot downgrade 0058: Notebook data exists';
          end if;
        end
        $$;
        """
    )
    op.drop_table("notebook_turns")
    op.drop_constraint("fk_notebooks_current_version", "notebooks", type_="foreignkey")
    op.drop_table("notebook_versions")
    op.drop_table("notebooks")

    op.drop_constraint("ck_mode_enum", "runs", type_="check")
    op.create_check_constraint("ck_mode_enum", "runs", _in("mode", _RUN_MODES_OLD))
