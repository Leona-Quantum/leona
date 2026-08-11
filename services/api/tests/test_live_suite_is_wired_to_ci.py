"""Every `*_live.py` suite is actually run by CI.

A live test only runs where `DATABASE_URL` is set, and the workflow names the
files it runs one by one. So a suite can exist, be green on a laptop, be counted
in review as coverage — and never once execute in CI. It does not fail; it is
not there. Seven files were in exactly that state when this guard was written,
two of them added in the preceding two sessions.

The same shape as `apps/web/package.json`'s explicit `test` file list: a name
missing from a hand-maintained list is silence, not an error.

Deliberate exclusions belong in `NOT_RUN_IN_CI` with the reason written down, so
that "we chose not to run this" and "nobody noticed" stop looking identical.
"""

import re
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
# Both services keep live suites; the worker's directory joined this scan on
# 2026-08-11, when its only live suite turned out to be named by no workflow —
# the exact dark state described above, one directory over from the guard.
_TEST_DIRS = (
    Path(__file__).resolve().parent,
    _REPO_ROOT / "services" / "worker" / "tests",
)
_WORKFLOWS = _REPO_ROOT / ".github" / "workflows"

#: `filename -> why it is deliberately not run in CI`. Empty today, on purpose.
NOT_RUN_IN_CI: dict[str, str] = {}


def _live_files_on_disk() -> set[str]:
    return {path.name for tests in _TEST_DIRS for path in tests.glob("test_*_live.py")}


_LIVE_PATH = re.compile(r"services/(?:api|worker)/tests/(test_[a-z0-9_]+_live\.py)")


def _uncommented(text: str) -> str:
    """Workflow text with comments removed.

    A path inside a `#` comment is documentation, not execution, and counting it
    would make this guard agree that a commented-out suite still runs — the
    silent pass this file exists to prevent. `#` never appears inside a quoted
    string in these workflows; if that changes, this needs a YAML parser rather
    than a regex, and `test_a_commented_out_path_does_not_count` will not notice
    on its own.
    """
    return "\n".join(re.sub(r"#.*$", "", line) for line in text.splitlines())


def _files_named_by_workflows() -> set[str]:
    named: set[str] = set()
    for workflow in _WORKFLOWS.glob("*.yml"):
        named.update(_LIVE_PATH.findall(_uncommented(workflow.read_text())))
    return named


def test_the_scan_can_see_the_files_it_is_meant_to_guard():
    """Positive control: a scan that finds nothing must fail, not pass."""
    on_disk = _live_files_on_disk()
    assert len(on_disk) >= 10, f"expected the live suites to be found on disk, saw {on_disk}"
    assert _files_named_by_workflows(), "no workflow appears to name any live suite"


def test_a_commented_out_path_does_not_count_as_ci_execution():
    """The scan reads text, so a commented path looks exactly like a run one."""
    active = "          uv run pytest services/api/tests/test_run_terminal_live.py -q"
    commented = "          # uv run pytest services/api/tests/test_job_queue_live.py -q"
    found = set(_LIVE_PATH.findall(_uncommented(f"{active}\n{commented}")))
    assert found == {"test_run_terminal_live.py"}, (
        "a suite that CI does not run must not be counted as covered"
    )


def test_every_live_suite_is_named_by_a_workflow():
    missing = _live_files_on_disk() - _files_named_by_workflows() - set(NOT_RUN_IN_CI)
    assert not missing, (
        "these live suites never run in CI — add them to the live-database job in "
        f".github/workflows/ci.yml, or record why not in NOT_RUN_IN_CI: {sorted(missing)}"
    )


def test_no_workflow_names_a_live_suite_that_no_longer_exists():
    """The reverse audit. A renamed file leaves the workflow pointing at nothing,
    and pytest exits 4 on a missing path — loud — but a *stale extra* name in the
    exclusion list is silent, so check both directions."""
    stale_in_workflows = _files_named_by_workflows() - _live_files_on_disk()
    assert not stale_in_workflows, (
        f"workflow names files that do not exist: {sorted(stale_in_workflows)}"
    )
    stale_exclusions = set(NOT_RUN_IN_CI) - _live_files_on_disk()
    assert not stale_exclusions, (
        f"NOT_RUN_IN_CI names files that do not exist: {sorted(stale_exclusions)}"
    )
