"""Allow the targeted-synthesis result event.

Revision ID: 0063
Revises: 0062

`synthesis.result` carries every compiler's outcome for one targeted-synthesis
request (proposal 3): a device or generic-connectivity target plus an
objective, run against every compiler in the existing trusted compiler lane,
each candidate independently checked for equivalence against the original
circuit. It is the second entry point into that lane, alongside the existing
`compilation.result` (single-compiler, unverified) event.

Declared twice by design, and this is the second half — `majorana_contracts.events`
got the `SynthesisResultEvent` member in the same change; without this migration
the first real synthesis run would fail on the INSERT rather than in a test, the
same failure mode `test_run_event_type_allowlist` exists to catch before a
deploy (see 0060 for the precedent).

Numbered 0063, not 0062: PR 942 (branch fix/p12-deploy-skew-and-stream-reconnect)
independently claimed 0062 for `0062_repair_orphaned_notebook_versions.py`. This
migration must land after that PR merges, and depends on its revision id.

The event log is append-only. Downgrade refuses to discard results already given.
"""

from alembic import op

revision = "0063"
down_revision = "0062"
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
    "notebook.grades",
)
_EVENT_TYPES_NEW = (*_EVENT_TYPES_OLD, "synthesis.result")


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
            IF EXISTS (SELECT 1 FROM run_events WHERE type = 'synthesis.result') THEN
                RAISE EXCEPTION 'cannot downgrade 0062: synthesis results exist';
            END IF;
        END $$
        """
    )
    op.drop_constraint(_TYPE_CONSTRAINT, "run_events", type_="check")
    op.create_check_constraint(_TYPE_CONSTRAINT, "run_events", _in("type", _EVENT_TYPES_OLD))
