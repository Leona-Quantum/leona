"""Allow run.best_effort in the append-only run-event log.

Revision ID: 0021
Revises: 0020

#96 added the `run.best_effort` event without extending `ck_type_enum`, and the
first production run that exhausted its budget dead-lettered on the insert —
turning "the loop had no passing candidate" into "the job died". The Python
contract and the database allowlist are two separate gates on the same value and
both have to be widened.

Purely additive, which is what makes it safe under the deploy order established
in #92: migrations run before the rollout, so for the length of the deploy the
old revision is still serving traffic. It never writes `run.best_effort`, and
every value it does write stays valid.
"""

from alembic import op

revision = "0021"
down_revision = "0020"
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
)
_EVENT_TYPES_NEW = (*_EVENT_TYPES_OLD, "run.best_effort")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.drop_constraint(_TYPE_CONSTRAINT, "run_events", type_="check")
    op.create_check_constraint(_TYPE_CONSTRAINT, "run_events", _in("type", _EVENT_TYPES_NEW))


def downgrade() -> None:
    # Rows written while 0021 was applied would violate the narrower constraint,
    # so they are removed rather than left to fail validation. They are
    # diagnostic evidence about failed runs, never artifacts anything reads back.
    op.execute("DELETE FROM run_events WHERE type = 'run.best_effort'")
    op.drop_constraint(_TYPE_CONSTRAINT, "run_events", type_="check")
    op.create_check_constraint(_TYPE_CONSTRAINT, "run_events", _in("type", _EVENT_TYPES_OLD))
