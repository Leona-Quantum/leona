"""Allow bounded research provenance in the append-only run-event log.

Revision ID: 0004
Revises: 0003

The event is additive: existing event values remain valid and the downgrade
restores the exact 0003 allowlist.
"""

from alembic import op

revision = "0004"
down_revision = "0003"
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

_PREVIOUS_EVENT_TYPES = (
    "run.queued",
    "run.started",
    "stage.started",
    "stage.finished",
    "plan.produced",
    "llm.call",
    "llm.delta",
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
    op.drop_constraint("ck_type_enum", "run_events", type_="check")
    op.create_check_constraint("ck_type_enum", "run_events", _check(_EVENT_TYPES))


def downgrade() -> None:
    op.drop_constraint("ck_type_enum", "run_events", type_="check")
    op.create_check_constraint("ck_type_enum", "run_events", _check(_PREVIOUS_EVENT_TYPES))
