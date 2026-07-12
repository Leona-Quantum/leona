"""Expand the append-only run-event allowlist for the canonical pipeline.

Revision ID: 0003
Revises: 0002

The stage choreography is additive: legacy ``simulate``/``export`` event values
remain readable, while new runs also persist screening, resource, compilation,
finalization, diagnosis, restart, and analysis events.
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

_EVENT_TYPES = (
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

_LEGACY_EVENT_TYPES = (
    "run.queued",
    "run.started",
    "stage.started",
    "stage.finished",
    "plan.produced",
    "llm.call",
    "llm.delta",
    "code.generated",
    "sandbox.result",
    "verification.result",
    "baseline.result",
    "export.classified",
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
    op.create_check_constraint("ck_type_enum", "run_events", _check(_LEGACY_EVENT_TYPES))
