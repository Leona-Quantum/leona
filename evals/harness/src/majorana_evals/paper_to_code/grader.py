"""Grades a candidate's Python source against a `PaperToCodeTask`'s own hidden test.

Two layers, both required to pass:

1. **The sandbox guard's import allowlist** (`majorana_sandbox.guard.check_python_code`) —
   the SAME static check production runs on model-generated code before it reaches any
   runner (see that module's docstring). A candidate is never executed if it imports
   anything outside the allowlist or trips a denied token; this is reported as a failure
   with the guard's own violation list, not silently skipped.
2. **Behavioural equivalence**, exactly the `qiskit_human_eval` convention: candidate source
   + the task's own `hidden_test` source + `check(entry_point)`, concatenated and run as a
   throwaway script in a subprocess with a wall-clock timeout. `check()` raises on failure;
   a clean exit means the candidate's circuit/state/distribution matched the paper-derived
   reference within whatever tolerance that task's own test encodes."""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from majorana_sandbox.guard import check_python_code

from majorana_evals.paper_to_code.schema import PaperToCodeTask

#: Matches `qiskit_human_eval`'s own `_CHECK_TIMEOUT_S` / upstream `test_solutions.py`
#: convention — statevector/unitary comparisons on <=24 qubits and small-instance sampling
#: both comfortably fit this budget.
CHECK_TIMEOUT_S = 30.0


def score_paper_to_code_task(
    candidate_source: str, task: PaperToCodeTask, *, timeout: float = CHECK_TIMEOUT_S
) -> tuple[bool, list[str]]:
    """Returns (passed, reasons). `reasons` is empty on a pass; on failure it carries either
    the guard's violations or the subprocess's stderr tail (bounded), so a report shows why,
    not just that it failed."""

    guard = check_python_code(candidate_source)
    if not guard.ok:
        return False, [f"blocked by sandbox guard: {guard.reason}"]

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
        return False, [f"check() did not complete within {timeout:.0f}s"]
    finally:
        Path(script_path).unlink(missing_ok=True)

    if result.returncode == 0:
        return True, []
    tail = "\n".join(result.stderr.strip().splitlines()[-20:])
    return False, [f"check() failed (exit {result.returncode}): {tail}"]
