"""Add durable direct-chat turns and provider-native chat events.

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

_EVENT_TYPES = (
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
)


def _check(values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"type in ({quoted})"


def upgrade() -> None:
    op.add_column("runs", sa.Column("conversation_id", UUID(as_uuid=True), nullable=True))
    op.execute("UPDATE runs SET conversation_id = id WHERE conversation_id IS NULL")
    op.alter_column("runs", "conversation_id", nullable=False)
    op.create_index(
        "ix_runs_workspace_conversation",
        "runs",
        ["workspace_id", "conversation_id", "created_at"],
    )

    op.drop_constraint("ck_mode_enum", "runs", type_="check")
    op.create_check_constraint(
        "ck_mode_enum",
        "runs",
        "mode in ('chat', 'execute', 'ideate', 'explain')",
    )

    op.drop_constraint("ck_type_enum", "run_events", type_="check")
    op.create_check_constraint("ck_type_enum", "run_events", _check(_EVENT_TYPES))


def downgrade() -> None:
    # Revisions before 0007 cannot represent provider-native chat events or the
    # chat run mode. Remove the chat-only event stream and retain its parent run as
    # an explanatory run before restoring the older constraints.
    op.execute("DELETE FROM run_events WHERE type LIKE 'chat.%'")
    op.execute("UPDATE runs SET mode = 'explain' WHERE mode = 'chat'")

    op.drop_constraint("ck_type_enum", "run_events", type_="check")
    previous = tuple(value for value in _EVENT_TYPES if not value.startswith("chat."))
    op.create_check_constraint("ck_type_enum", "run_events", _check(previous))

    op.drop_constraint("ck_mode_enum", "runs", type_="check")
    op.create_check_constraint(
        "ck_mode_enum",
        "runs",
        "mode in ('execute', 'ideate', 'explain')",
    )
    op.drop_index("ix_runs_workspace_conversation", table_name="runs")
    op.drop_column("runs", "conversation_id")
