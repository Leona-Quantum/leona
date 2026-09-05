"""Allow the notebook grading verdict event.

Revision ID: 0060
Revises: 0059

`notebook.grades` carries the verdicts for one reader's attempt at a notebook's
graded cells. Grading executes the reader's code in the sandbox, so the route
answers 202 and the verdicts arrive on that run's event stream — which means the
database has to accept the type before the worker can write one.

Declared twice by design, and this is the second half. `majorana_contracts.events`
got the `NotebookGrades` member in the same change; without this migration the
first real attempt would fail on the INSERT rather than in a test, and a reader
would be told their grading run errored. That is exactly the failure
`test_run_event_type_allowlist` exists to catch before a deploy, and it did.

The event log is append-only. Downgrade refuses to discard verdicts already given.
"""

from alembic import op

revision = "0060"
down_revision = "0059"
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
    "conversation.titled",
    "qapp.generated",
)
_EVENT_TYPES_NEW = (*_EVENT_TYPES_OLD, "notebook.grades")


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
            IF EXISTS (SELECT 1 FROM run_events WHERE type = 'notebook.grades') THEN
                RAISE EXCEPTION 'cannot downgrade 0060: grading verdicts exist';
            END IF;
        END $$
        """
    )
    op.drop_constraint(_TYPE_CONSTRAINT, "run_events", type_="check")
    op.create_check_constraint(_TYPE_CONSTRAINT, "run_events", _in("type", _EVENT_TYPES_OLD))
