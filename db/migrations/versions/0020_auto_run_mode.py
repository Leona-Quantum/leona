"""Admit the 'auto' run mode and the event that resolves it.

Revision ID: 0020
Revises: 0019

Until now the caller had to name the mode, and every UI submission named
'execute' — so "hi" entered the plan/generate/verify pipeline and failed there
instead of being answered. A run may now be created as 'auto', meaning "decide
from what the user actually asked for". The worker resolves it before dispatch
and rewrites runs.mode to the resolved value, so 'auto' is a transient request
state: it is legal in the column because the row exists between creation and
resolution, not because a finished run should ever hold it.

'run.mode_resolved' records that decision in the event log, which is the only
place a reader can see that a mode was changed and why (ADR-0008: the UI is a
pure renderer of this stream).
"""

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None

_MODE_CONSTRAINT = "ck_mode_enum"
_MODES_OLD = ("chat", "execute", "ideate", "explain")
_MODES_NEW = ("auto", *_MODES_OLD)

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
)
_EVENT_TYPES_NEW = (*_EVENT_TYPES_OLD, "run.mode_resolved")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.drop_constraint(_MODE_CONSTRAINT, "runs", type_="check")
    op.create_check_constraint(_MODE_CONSTRAINT, "runs", _in("mode", _MODES_NEW))

    op.drop_constraint(_TYPE_CONSTRAINT, "run_events", type_="check")
    op.create_check_constraint(_TYPE_CONSTRAINT, "run_events", _in("type", _EVENT_TYPES_NEW))


def downgrade() -> None:
    # A run still sitting in 'auto' has not been dispatched, so no stage output
    # depends on the choice; 'chat' is the safe landing because it is the mode
    # the router itself falls back to when it cannot decide.
    op.execute("UPDATE runs SET mode = 'chat' WHERE mode = 'auto'")
    op.execute("DELETE FROM run_events WHERE type = 'run.mode_resolved'")

    op.drop_constraint(_TYPE_CONSTRAINT, "run_events", type_="check")
    op.create_check_constraint(_TYPE_CONSTRAINT, "run_events", _in("type", _EVENT_TYPES_OLD))

    op.drop_constraint(_MODE_CONSTRAINT, "runs", type_="check")
    op.create_check_constraint(_MODE_CONSTRAINT, "runs", _in("mode", _MODES_OLD))
