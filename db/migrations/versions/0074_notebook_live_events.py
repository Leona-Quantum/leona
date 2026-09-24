"""Allow the notebook "Live" lane's streaming/execution/repair events.

Revision ID: 0074
Revises: 0073

Plan 10-notebook-ide, "Live" lane: a notebook developing in real time. Four new
`RunEvent` members, all emitted by `ProductionNotebookPorts`
(`services/worker/src/majorana_worker/notebook_handlers.py`), no route changes:

- `notebook.draft.delta` — a streamed, pre-redacted fragment of the draft/repair text
  as the model writes it.
- `notebook.draft.parsed` — the draft's cells once the streamed text parses, redacted
  the same way `NotebookSpec.for_learner()` redacts a finished version.
- `notebook.cells` — every code cell's status/error name/value after one sandbox
  dispatch (the initial run, and each repair's rerun).
- `notebook.repair` — a repair's own start/finish/fail, cell-scoped, with the
  repaired source redacted for a graded/solution-only cell.

Declared twice by design, and this is the second half (see 0060 for the precedent,
and `test_run_event_type_allowlist` for what catches a missed one before a deploy):
`majorana_contracts.events` got the four new `RunEvent` members
(`packages/py/contracts/src/majorana_contracts/events.py`, CONTRACTS_VERSION 2.35.0)
in the same change. Without this migration the first live-streamed draft would fail
on the INSERT rather than in a test.

The event log is append-only. Downgrade refuses to discard events already written.
"""

from alembic import op

revision = "0074"
down_revision = "0073"
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
    "synthesis.result",
)
_NEW_EVENT_TYPES = (
    "notebook.draft.delta",
    "notebook.draft.parsed",
    "notebook.cells",
    "notebook.repair",
)
_EVENT_TYPES_NEW = (*_EVENT_TYPES_OLD, *_NEW_EVENT_TYPES)


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.drop_constraint(_TYPE_CONSTRAINT, "run_events", type_="check")
    op.create_check_constraint(_TYPE_CONSTRAINT, "run_events", _in("type", _EVENT_TYPES_NEW))


def downgrade() -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM run_events WHERE type IN ({
            ", ".join(f"'{t}'" for t in _NEW_EVENT_TYPES)
        })) THEN
                RAISE EXCEPTION 'cannot downgrade 0074: live notebook events exist';
            END IF;
        END $$
        """
    )
    op.drop_constraint(_TYPE_CONSTRAINT, "run_events", type_="check")
    op.create_check_constraint(_TYPE_CONSTRAINT, "run_events", _in("type", _EVENT_TYPES_OLD))
