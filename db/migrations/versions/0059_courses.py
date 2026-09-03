"""Add Courses: an ordered plan of notebooks, generated from one prompt.

Revision ID: 0059
Revises: 0058

Precedent is migration 0058 (Notebooks), and the differences from it are the
whole design:

- **No versions table.** A course's content is its plan, and the plan lives in
  one `courses.plan` JSONB column plus the `course_modules` rows derived from
  it. There is no immutable revision history of a plan the way there is of a
  notebook, because the durable artefacts a course produces ARE notebooks, and
  those already have one. A plan revision rewrites the modules in place
  (`repos.courses.replace_modules`), keeping the rows whose slug is unchanged.
- **`course_modules.notebook_id` is `ON DELETE SET NULL`, not CASCADE.** A
  notebook generated for a module is an ordinary notebook the reader may delete
  on its own; that must strip the module back to `planned`, never delete the
  module. The reverse edge does cascade: dropping a course drops its modules.
- **No `visibility` column and no `current_*` deferred FK.** Courses are private
  to the workspace in this slice, and a course points at its modules rather than
  at a current anything.
- `runs.mode` is NOT widened. A course's plan/revise runs are `mode=notebook`,
  reusing the quota counters, the abuse backstop and the SSE stream that the
  notebook lane already registered in 0058 — so this migration touches
  `ck_mode_enum` neither on the way up nor on the way down.

RLS is enabled with 0058's permissive policy text and the same conditional
`app_rw` grant block: installed, never enforced (ADR-0028). `course_modules`
and `course_turns` resolve their tenant through `courses`, exactly as
`notebook_versions`/`notebook_turns` resolve theirs through `notebooks`.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0059"
down_revision = "0058"
branch_labels = None
depends_on = None

_COURSE_STATUSES = ("planning", "planned", "generating", "ready", "failed")
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
_TURN_ROLES = ("user", "nala")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def _tenant_policy(table: str) -> str:
    """0058's own policy text for a table that carries `workspace_id` itself."""
    predicate = (
        "current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        f"{table}.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid"
    )
    return (
        f"create policy tenant_isolation on {table} for all using ({predicate}) "
        f"with check ({predicate})"
    )


def _child_policy(table: str) -> str:
    """0058's policy text for a child table that resolves through its parent."""
    predicate = (
        "current_setting('majorana.rls_enforce', true) is distinct from 'on' or exists ("
        f"select 1 from courses c where c.id = {table}.course_id and "
        "c.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid)"
    )
    return (
        f"create policy tenant_isolation on {table} for all using ({predicate}) "
        f"with check ({predicate})"
    )


def upgrade() -> None:
    op.create_table(
        "courses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("brief", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "audience", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "style", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "framework", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("language", sa.Text(), nullable=False, server_default="en"),
        sa.Column("status", sa.Text(), nullable=False, server_default="planning"),
        sa.Column("plan_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        # The plan the planner returned, verbatim. `course_modules` is the queryable
        # projection of it; this column is what a revision diffs against.
        sa.Column("plan", postgresql.JSONB(), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["plan_run_id"], ["runs.id"]),
        sa.UniqueConstraint("workspace_id", "slug", name="uq_courses_workspace_slug"),
        sa.CheckConstraint("char_length(slug) between 1 and 80", name="ck_courses_slug_length"),
        sa.CheckConstraint("char_length(title) between 1 and 240", name="ck_courses_title_length"),
        sa.CheckConstraint("char_length(summary) <= 2000", name="ck_courses_summary_length"),
        sa.CheckConstraint("char_length(brief) <= 8000", name="ck_courses_brief_length"),
        sa.CheckConstraint(_in("status", _COURSE_STATUSES), name="ck_courses_status"),
        sa.CheckConstraint("language in ('en','ja')", name="ck_courses_language"),
    )
    op.create_index("ix_courses_workspace_id", "courses", ["workspace_id", "id"])

    op.create_table(
        "course_modules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("course_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("topic", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "key_concepts",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "objectives", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("deliverable", sa.Text(), nullable=False, server_default=""),
        sa.Column("kind", sa.Text(), nullable=False, server_default="lesson"),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column(
            "prerequisites",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("brief", sa.Text(), nullable=False, server_default=""),
        sa.Column("notebook_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        # Deleting the notebook strips the module back to `planned`; it never
        # deletes the module, and it must never fail the reader's delete.
        sa.ForeignKeyConstraint(["notebook_id"], ["notebooks.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("course_id", "seq", name="uq_course_modules_seq"),
        sa.UniqueConstraint("course_id", "slug", name="uq_course_modules_slug"),
        sa.CheckConstraint("seq >= 1", name="ck_course_modules_seq"),
        sa.CheckConstraint(
            "char_length(slug) between 1 and 80", name="ck_course_modules_slug_length"
        ),
        sa.CheckConstraint(
            "char_length(title) between 1 and 240", name="ck_course_modules_title_length"
        ),
        sa.CheckConstraint("char_length(brief) <= 4000", name="ck_course_modules_brief_length"),
        sa.CheckConstraint(_in("kind", _NOTEBOOK_KINDS), name="ck_course_modules_kind"),
        sa.CheckConstraint(
            "duration_minutes is null or duration_minutes between 1 and 600",
            name="ck_course_modules_duration",
        ),
    )
    op.create_index("ix_course_modules_course_id", "course_modules", ["course_id", "seq"])
    op.create_index("ix_course_modules_notebook_id", "course_modules", ["notebook_id"])

    op.create_table(
        "course_turns",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("course_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.UniqueConstraint("course_id", "seq", name="uq_course_turns_seq"),
        sa.CheckConstraint("seq >= 1", name="ck_course_turns_seq"),
        sa.CheckConstraint(_in("role", _TURN_ROLES), name="ck_course_turns_role"),
        sa.CheckConstraint(
            "char_length(content) between 1 and 8000", name="ck_course_turns_content_length"
        ),
    )

    op.execute("alter table courses enable row level security")
    op.execute(_tenant_policy("courses"))
    op.execute("alter table course_modules enable row level security")
    op.execute(_child_policy("course_modules"))
    op.execute("alter table course_turns enable row level security")
    op.execute(_child_policy("course_turns"))

    op.execute(
        """
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'app_rw') then
            grant select, insert, update, delete
              on courses, course_modules, course_turns to app_rw;
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
          if exists (select 1 from courses) then
            raise exception 'cannot downgrade 0059: Course data exists';
          end if;
        end
        $$;
        """
    )
    op.drop_table("course_turns")
    op.drop_index("ix_course_modules_notebook_id", table_name="course_modules")
    op.drop_index("ix_course_modules_course_id", table_name="course_modules")
    op.drop_table("course_modules")
    op.drop_index("ix_courses_workspace_id", table_name="courses")
    op.drop_table("courses")
