"""Allow semantic-review and strict-verification audit events.

Revision ID: 0030
Revises: 0029

The event log is append-only. Downgrade refuses to discard new audit history.
"""

from alembic import op

revision = "0030"
down_revision = "0029"
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
)
_EVENT_TYPES_NEW = (
    *_EVENT_TYPES_OLD,
    "verification.semantic_review",
    "verification.strict_attempt",
)


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
            IF EXISTS (
                SELECT 1 FROM run_events
                WHERE type IN ('verification.semantic_review', 'verification.strict_attempt')
            ) THEN
                RAISE EXCEPTION 'cannot downgrade 0030: verification audit events exist';
            END IF;
        END $$
        """
    )
    op.drop_constraint(_TYPE_CONSTRAINT, "run_events", type_="check")
    op.create_check_constraint(_TYPE_CONSTRAINT, "run_events", _in("type", _EVENT_TYPES_OLD))
