"""Migration 0062 — the one-off repair for a notebook stuck 'generating' by
the gap PR 930 (commit 74da0744) closed.

No live-database fixture is exercised here (none is available in this
session, and the repair is a one-off, run-once-in-production data migration,
not a schema change worth standing up an ephemeral Postgres for). Instead,
same pattern as `test_openqasm_migration.py` for migrations 0008/0009: import
the migration module directly and exercise its pure `is_stuck_version()`
predicate, which is built from the exact two constants the migration's SQL
`stuck` CTE also uses — see that module's own docstring for why this is the
one part of the migration most worth proving in isolation.
"""

import importlib.util
from pathlib import Path


def _migration_module():
    path = (
        Path(__file__).resolve().parents[3]
        / "db"
        / "migrations"
        / "versions"
        / "0062_repair_orphaned_notebook_versions.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0062", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_queued_version_behind_a_terminal_run_is_stuck():
    module = _migration_module()
    assert module.is_stuck_version("queued", "failed") is True
    assert module.is_stuck_version("queued", "succeeded") is True
    assert module.is_stuck_version("queued", "cancelled") is True


def test_a_running_version_behind_a_terminal_run_is_stuck():
    module = _migration_module()
    assert module.is_stuck_version("running", "failed") is True
    assert module.is_stuck_version("running", "succeeded") is True
    assert module.is_stuck_version("running", "cancelled") is True


def test_a_version_whose_run_is_still_in_flight_is_never_touched():
    # The dangerous direction to get wrong: a version legitimately still
    # generating, behind a run that has not finished, must never be marked
    # failed out from under it.
    module = _migration_module()
    assert module.is_stuck_version("queued", "queued") is False
    assert module.is_stuck_version("queued", "running") is False
    assert module.is_stuck_version("running", "queued") is False
    assert module.is_stuck_version("running", "running") is False


def test_an_already_resolved_version_is_never_touched_again():
    module = _migration_module()
    for version_status in ("ready", "failed"):
        for run_status in ("queued", "running", "succeeded", "failed", "cancelled"):
            assert module.is_stuck_version(version_status, run_status) is False, (
                f"a {version_status!r} version must be left alone regardless of its run's status"
            )


def test_reader_facing_copy_matches_the_established_prefix_convention():
    # handle_notebook_dead_letter and _fail_orphaned_notebook_version
    # (services/worker/src/majorana_worker/{notebook_handlers,handlers}.py)
    # both write a chat turn shaped "I couldn't finish this: {reason}" — this
    # migration's copy follows the same shape rather than inventing a new one,
    # and the two strings must actually agree (not merely look similar) or a
    # downgrade using _ERROR_TEXT would stop matching what upgrade wrote.
    module = _migration_module()
    assert module._TURN_CONTENT == f"I couldn't finish this: {module._ERROR_TEXT}"
