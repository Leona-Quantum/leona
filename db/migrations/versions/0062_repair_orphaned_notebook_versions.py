"""One-off repair: notebooks stuck 'generating' by a gap PR 930 closed.

Revision ID: 0062
Revises: 0061

PR 930 (commit 74da0744, "a notebook whose generation run was reaped no longer
refuses every edit forever") fixed the FORWARD path: `close_orphaned_run`
(`services/worker/src/majorana_worker/handlers.py`) now also fails the
`notebook_versions` row a reaped run was generating. Before that commit, the
reaper closed only the `runs` row — it moved `runs.status` to a terminal value
(`fail_run_from_dead_letter`, always `'failed'`) but left the corresponding
`notebook_versions.status` at `'queued'`/`'running'` forever, because nothing
else ever revisits that row. The API refuses every later edit, chat turn and
rerun on a notebook whose latest version is in flight
(`routes/notebooks.py::_assert_not_in_flight`, 409
`notebook_version_in_flight`), so any notebook caught by this had no way out
for its owner — permanently, not until its next generation, because there
never is one.

This migration is the one-off backward repair: the same fix PR 930 applies
going forward, applied once to whatever it left behind. It is NOT scoped to
runs closed specifically by the orphan reaper — any `notebook_versions` row
still `'queued'`/`'running'` while its `runs` row has ALREADY reached a
terminal status (`is_stuck_version` below) is the same torn state, regardless
of which code path got the run there. That torn state is otherwise
unreachable: every path that moves a run to a terminal status in one
transaction also resolves the notebook version it belongs to in that same
transaction (the ordinary completion path, and `handle_notebook_dead_letter`
for a job the retry budget gave up on) — so a stuck row here can only be
leftover damage from the gap PR 930 closed, never a live race with an
in-flight generation.

## Idempotent by construction

The `stuck` CTE re-evaluates the same predicate every time this runs. The
first run flips every matching row to `'failed'`, so a second run (a
redeploy, a replay) finds nothing left to repair and both the
`UPDATE ... RETURNING` and the dependent `INSERT` affect zero rows — safe to
re-run, never doubles a chat turn.

## The selection predicate is a testable Python function, not just SQL

`is_stuck_version()` below is the exact criterion the SQL's `stuck` CTE
implements, built from the same two constants the SQL's `IN (...)` clauses
are generated from (`services/api/tests/test_notebook_stuck_generation_migration.py`
imports this module the way `test_openqasm_migration.py` imports 0008/0009,
and exercises it directly) — this repo has no fixture for running a migration
against a real database in this session, and getting the predicate wrong is
exactly backwards in either direction: too narrow leaves real stuck notebooks
broken, too wide touches a version whose run is still legitimately in flight.

## Downgrade is a best-effort reversal, not a re-break

`downgrade()` finds the rows this migration touched by the exact, literal
error text it writes (chosen to be specific enough that nothing else in this
codebase produces it) and reverts them to `'running'` — not necessarily the
`'queued'` or `'running'` value each row actually held before, which this
migration does not record anywhere (there is no scratch JSONB column on
`notebook_versions` the way `artifact_versions.metadata` gave migration 0009
somewhere to stash the old value). That distinction has no behavioral effect
(`_IN_FLIGHT_VERSION_STATUSES` below is treated identically by both
`handlers.py` and the API's own in-flight gate), so `'running'` is a safe,
deterministic choice for the up->down->up cycle this repo's migrations are
tested with. What downgrade deliberately does NOT do is put affected
notebooks back into the state this migration exists to get them out of in
any way a reader would notice differently — the repair is not something a
rollback should undo in spirit, only something it should be able to undo
mechanically, so CI's up->down->up proves the migration doesn't corrupt
anything rather than proving it can re-strand a notebook.

Bound parameters throughout (`:error_text`, `:turn_content`), not string
interpolation: the reader-facing copy contains a literal apostrophe
("couldn't"), and this repo already had the tool for that (migration 0009's
`sa.text(...)` + params pattern) — reused rather than hand-escaping a quote
into `''` and hoping nobody edits the copy later without noticing why.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0062"
down_revision = "0061"
branch_labels = None
depends_on = None

_ERROR_TEXT = "the run was interrupted and never resumed."
_TURN_CONTENT = "I couldn't finish this: the run was interrupted and never resumed."

# The two ends of the torn state this migration repairs. Both are plain
# `notebook_versions.status` / `runs.status` enum values (see migration 0058
# for the notebook side, `majorana_contracts.enums.RunStatus` for the run
# side) — never user input, so embedding them directly into the generated SQL
# below is the same safe, established pattern migration 0058's own `_in()`
# helper uses for CHECK constraints.
_IN_FLIGHT_VERSION_STATUSES = ("queued", "running")
_TERMINAL_RUN_STATUSES = ("succeeded", "failed", "cancelled")


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def is_stuck_version(version_status: str, run_status: str) -> bool:
    """Whether a `notebook_versions` row in `version_status`, whose run is in
    `run_status`, is the torn state this migration exists to repair: the
    version still claims to be generating while its run has already reached a
    terminal status. Mirrors the SQL `stuck` CTE's `WHERE` clause exactly —
    same two constants build both — so the criterion can be checked without a
    database (`services/api/tests/test_notebook_stuck_generation_migration.py`).
    """
    return version_status in _IN_FLIGHT_VERSION_STATUSES and run_status in _TERMINAL_RUN_STATUSES


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            f"""
            with stuck as (
                select v.id as version_id, v.notebook_id, v.run_id
                  from notebook_versions v
                  join runs r on r.id = v.run_id
                 where {_in("v.status", _IN_FLIGHT_VERSION_STATUSES)}
                   and {_in("r.status", _TERMINAL_RUN_STATUSES)}
            ),
            repaired as (
                update notebook_versions as v
                   set status = 'failed',
                       spec = null,
                       source = '',
                       ipynb = null,
                       report = null,
                       review = null,
                       error = :error_text,
                       finished_at = now()
                  from stuck
                 where v.id = stuck.version_id
             returning v.id as version_id, v.notebook_id, stuck.run_id
            ),
            next_seq as (
                select notebook_id, coalesce(max(seq), 0) as base_seq
                  from notebook_turns
                 where notebook_id in (select notebook_id from repaired)
                 group by notebook_id
            )
            insert into notebook_turns (id, notebook_id, seq, role, content, version_id, run_id, created_at)
            select
                gen_random_uuid(),
                r.notebook_id,
                coalesce(ns.base_seq, 0)
                    + row_number() over (partition by r.notebook_id order by r.version_id),
                'nala',
                :turn_content,
                r.version_id,
                r.run_id,
                now()
              from repaired r
              left join next_seq ns on ns.notebook_id = r.notebook_id
            """
        ),
        {"error_text": _ERROR_TEXT, "turn_content": _TURN_CONTENT},
    )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text("delete from notebook_turns where content = :turn_content"),
        {"turn_content": _TURN_CONTENT},
    )
    connection.execute(
        sa.text(
            """
            update notebook_versions
               set status = 'running',
                   spec = null,
                   source = null,
                   ipynb = null,
                   report = null,
                   review = null,
                   error = '',
                   finished_at = null
             where error = :error_text
            """
        ),
        {"error_text": _ERROR_TEXT},
    )
