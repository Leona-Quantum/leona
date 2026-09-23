"""Grades a candidate's Python source against an `SdkDriftTask`'s own hidden test, exactly
like `paper_to_code.grader` (sandbox guard, then subprocess `check(entry_point)`), plus one
extra check specific to this benchmark: when the run fails, was it for the CITED DRIFT
REASON rather than for something else?

Without this second check, a negative control that fails for the wrong reason (a typo, an
unrelated import error, a timeout) would be indistinguishable from one that genuinely
demonstrates the API break this task is about — the whole point of `expected_failure_pattern`
is to make that distinction checkable rather than assumed."""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

from majorana_sandbox.guard import check_python_code

from majorana_evals.sdk_drift.schema import SdkDriftTask

#: Same budget as `paper_to_code.grader.CHECK_TIMEOUT_S` / upstream `qiskit_human_eval`.
CHECK_TIMEOUT_S = 30.0


def score_sdk_drift_task(
    candidate_source: str, task: SdkDriftTask, *, timeout: float = CHECK_TIMEOUT_S
) -> tuple[bool, list[str], bool | None]:
    """Returns (passed, reasons, drift_reason_matched).

    `drift_reason_matched` is `None` when `passed` is True (nothing to match) or when the
    guard blocked the candidate before it ever ran (a blocked import is not the drift this
    task is testing for); otherwise it is whether `task.expected_failure_pattern` matched
    the captured stderr, case-insensitively."""

    guard = check_python_code(candidate_source)
    if not guard.ok:
        return False, [f"blocked by sandbox guard: {guard.reason}"], None

    script = f"{candidate_source}\n\n{task.hidden_test}\n\ncheck({task.entry_point})\n"
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".py", delete=False, encoding="utf-8"
    ) as handle:
        handle.write(script)
        script_path = handle.name
    try:
        result = subprocess.run(  # noqa: S603 - fixed interpreter, no shell
            [sys.executable, script_path],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return False, [f"check() did not complete within {timeout:.0f}s"], False
    finally:
        Path(script_path).unlink(missing_ok=True)

    if result.returncode == 0:
        return True, [], None

    tail = "\n".join(result.stderr.strip().splitlines()[-20:])
    drift_reason_matched = bool(
        re.search(task.expected_failure_pattern, result.stderr, re.IGNORECASE)
    )
    reason = f"check() failed (exit {result.returncode}): {tail}"
    if not drift_reason_matched:
        reason += (
            f" [expected_failure_pattern {task.expected_failure_pattern!r} did NOT match — "
            "this failure may not be the cited drift]"
        )
    return False, [reason], drift_reason_matched


def qiskit_installed_version() -> str:
    import qiskit

    return qiskit.__version__
