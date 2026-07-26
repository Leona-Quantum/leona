"""Allow the conversation-naming event.

Revision ID: 0035
Revises: 0034

`conversation.titled` carries the short name the model gives a conversation on
its opening turn. Without widening ck_type_enum the worker's first attempt to
emit it fails at the database, not in a test — which is exactly what
test_run_event_type_allowlist exists to catch before a deploy.

The event log is append-only. Downgrade refuses to discard names already given.
"""

from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None

_TYPE_CONSTRAINT = "ck_type_enum"
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
)
_EVENT_TYPES_NEW = (*_EVENT_TYPES_OLD, "conversation.titled")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.drop_constraint(_TYPE_CONSTRAINT, "run_events", type_="check")
    op.create_check_constraint(_TYPE_CONSTRAINT, "run_events", _in("type", _EVENT_TYPES_NEW))


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM run_events WHERE type = 'conversation.titled') THEN
                RAISE EXCEPTION 'cannot downgrade 0035: conversation names exist';
            END IF;
        END $$
        """
    )
    op.drop_constraint(_TYPE_CONSTRAINT, "run_events", type_="check")
    op.create_check_constraint(_TYPE_CONSTRAINT, "run_events", _in("type", _EVENT_TYPES_OLD))
