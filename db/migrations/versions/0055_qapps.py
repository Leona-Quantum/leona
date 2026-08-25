"""Add durable, private-by-default generated quantum applications.

Revision ID: 0055
Revises: 0054

The generated browser document and quantum program are stored separately. Only the
document and its JSON schemas are eligible for the public projection; the program is
read exclusively by the worker and always executes through the existing sandbox.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None

_FRAMEWORKS = ("qiskit", "pennylane", "cirq", "braket", "qibo", "qulacs")
_RUN_MODES_OLD = ("auto", "chat", "execute", "ideate", "explain")
_RUN_MODES_NEW = (*_RUN_MODES_OLD, "qapp")
_EVENT_TYPES_OLD = (
    "run.queued",
    "run.started",
    "stage.started",
    "stage.finished",
    "plan.produced",
    "research.completed",
    "llm.call",
    "llm.delta",
    "chat.delta",
    "chat.completed",
    "chat.error",
    "code.generated",
    "screen.result",
    "resource.estimate",
    "sandbox.result",
    "verification.result",
    "compilation.result",
    "code.finalized",
    "baseline.result",
    "export.classified",
    "run.analysis",
    "run.diagnosed",
    "run.restarted",
    "artifact.saved",
    "run.error",
    "run.finished",
    "run.mode_resolved",
    "run.best_effort",
    "verification.semantic_review",
    "verification.strict_attempt",
    "conversation.titled",
)
_EVENT_TYPES_NEW = (*_EVENT_TYPES_OLD, "qapp.generated")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.drop_constraint("ck_mode_enum", "runs", type_="check")
    op.create_check_constraint("ck_mode_enum", "runs", _in("mode", _RUN_MODES_NEW))

    op.drop_constraint("ck_type_enum", "run_events", type_="check")
    op.create_check_constraint("ck_type_enum", "run_events", _in("type", _EVENT_TYPES_NEW))

    op.create_table(
        "qapps",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False, unique=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("visibility", sa.Text(), nullable=False, server_default="private"),
        sa.Column("current_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("published_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by_run_id"], ["runs.id"]),
        sa.UniqueConstraint("created_by_run_id", name="uq_qapps_created_by_run"),
        sa.CheckConstraint("char_length(slug) between 1 and 160", name="ck_qapps_slug_length"),
        sa.CheckConstraint("char_length(title) between 1 and 240", name="ck_qapps_title_length"),
        sa.CheckConstraint("char_length(description) <= 4000", name="ck_qapps_description_length"),
        sa.CheckConstraint("visibility in ('private','public')", name="ck_qapps_visibility"),
        sa.CheckConstraint(
            "(visibility = 'private' and published_at is null) or "
            "(visibility = 'public' and published_at is not null)",
            name="ck_qapps_publication_stamp",
        ),
    )
    op.create_index("ix_qapps_workspace_updated", "qapps", ["workspace_id", "updated_at"])
    op.create_index(
        "ix_qapps_public_slug",
        "qapps",
        ["slug"],
        unique=True,
        postgresql_where=sa.text("visibility = 'public' and deleted_at is null"),
    )

    op.create_table(
        "qapp_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("qapp_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("framework", sa.Text(), nullable=False),
        sa.Column("qubits_estimate", sa.Integer(), nullable=False),
        sa.Column("ui_document", sa.Text(), nullable=False),
        sa.Column("quantum_source", sa.Text(), nullable=False),
        sa.Column(
            "input_schema",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "output_schema",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("fingerprint", sa.Text(), nullable=False),
        sa.Column("source_artifact_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("generation_prompt", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["qapp_id"], ["qapps.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_artifact_version_id"], ["artifact_versions.id"]),
        sa.UniqueConstraint("qapp_id", "seq", name="uq_qapp_versions_seq"),
        sa.UniqueConstraint("qapp_id", "id", name="uq_qapp_versions_identity"),
        sa.UniqueConstraint("qapp_id", "fingerprint", name="uq_qapp_versions_fingerprint"),
        sa.CheckConstraint("seq >= 1", name="ck_qapp_versions_seq"),
        sa.CheckConstraint(_in("framework", _FRAMEWORKS), name="ck_qapp_versions_framework"),
        sa.CheckConstraint("qubits_estimate between 1 and 27", name="ck_qapp_versions_qubits"),
        sa.CheckConstraint(
            "char_length(ui_document) between 1 and 300000", name="ck_qapp_versions_ui_length"
        ),
        sa.CheckConstraint(
            "char_length(quantum_source) between 1 and 200000",
            name="ck_qapp_versions_source_length",
        ),
        sa.CheckConstraint("fingerprint ~ '^[0-9a-f]{64}$'", name="ck_qapp_versions_fingerprint"),
        sa.CheckConstraint(
            "char_length(generation_prompt) between 1 and 20000",
            name="ck_qapp_versions_prompt_length",
        ),
    )
    op.create_foreign_key(
        "fk_qapps_current_version",
        "qapps",
        "qapp_versions",
        ["id", "current_version_id"],
        ["qapp_id", "id"],
        deferrable=True,
        initially="DEFERRED",
    )

    op.create_table(
        "qapp_executions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("qapp_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("qapp_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("inputs", postgresql.JSONB(), nullable=False),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column("sandbox_meta", postgresql.JSONB(), nullable=True),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("finished_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["qapp_id"], ["qapps.id"]),
        sa.ForeignKeyConstraint(["qapp_version_id"], ["qapp_versions.id"]),
        sa.CheckConstraint(
            "status in ('queued','running','succeeded','failed')", name="ck_qapp_executions_status"
        ),
    )
    op.create_index(
        "ix_qapp_executions_workspace_created",
        "qapp_executions",
        ["workspace_id", "created_at"],
    )

    op.execute("alter table qapps enable row level security")
    op.execute(
        "create policy tenant_isolation on qapps for all using ("
        "current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        "qapps.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid"
        ") with check (current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        "qapps.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid)"
    )
    op.execute(
        "create policy public_read on qapps for select using ("
        "visibility = 'public' and deleted_at is null)"
    )
    op.execute("alter table qapp_versions enable row level security")
    op.execute(
        "create policy tenant_isolation on qapp_versions for all using ("
        "current_setting('majorana.rls_enforce', true) is distinct from 'on' or exists ("
        "select 1 from qapps q where q.id = qapp_versions.qapp_id and "
        "q.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid)) "
        "with check (current_setting('majorana.rls_enforce', true) is distinct from 'on' or exists ("
        "select 1 from qapps q where q.id = qapp_versions.qapp_id and "
        "q.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid))"
    )
    op.execute(
        "create policy public_read on qapp_versions for select using (exists ("
        "select 1 from qapps q where q.id = qapp_versions.qapp_id and "
        "q.visibility = 'public' and q.deleted_at is null))"
    )
    op.execute("alter table qapp_executions enable row level security")
    op.execute(
        "create policy tenant_isolation on qapp_executions for all using ("
        "current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        "qapp_executions.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid"
        ") with check (current_setting('majorana.rls_enforce', true) is distinct from 'on' or "
        "qapp_executions.workspace_id = nullif(current_setting('majorana.workspace_id', true), '')::uuid)"
    )

    op.execute(
        """
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'app_rw') then
            grant select, insert, update, delete on qapps, qapp_versions, qapp_executions to app_rw;
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
          if exists (select 1 from qapps) or
             exists (select 1 from runs where mode = 'qapp') or
             exists (select 1 from run_events where type = 'qapp.generated') then
            raise exception 'cannot downgrade 0055: Qapp data exists';
          end if;
        end
        $$;
        """
    )
    op.drop_table("qapp_executions")
    op.drop_constraint("fk_qapps_current_version", "qapps", type_="foreignkey")
    op.drop_table("qapp_versions")
    op.drop_table("qapps")

    op.drop_constraint("ck_type_enum", "run_events", type_="check")
    op.create_check_constraint("ck_type_enum", "run_events", _in("type", _EVENT_TYPES_OLD))
    op.drop_constraint("ck_mode_enum", "runs", type_="check")
    op.create_check_constraint("ck_mode_enum", "runs", _in("mode", _RUN_MODES_OLD))
