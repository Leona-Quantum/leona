"""Qiskit HumanEval loader + scorer.

Dataset: `evals/public-benchmarks/qiskit-human-eval/dataset_qiskit_test_human_eval.json`,
pinned and hashed in the sibling `PROVENANCE.md`. Format is OpenAI-HumanEval-style: each
task is a function scaffold (`prompt`: imports + signature + docstring), a `canonical_solution`
(body only — concatenating `prompt + canonical_solution` yields a complete, correct function),
a `test` (source defining `check(candidate)`, which raises on failure), and `entry_point`
(the function name `check` calls).

Scoring runs the DELIVERED CANDIDATE SOURCE (whatever `majorana_agent.SimpleCircuitPipeline`
actually finalized — not a scaffold+solution reconstruction) plus the task's own `test`
source, `check(entry_point)` appended, in a subprocess with a wall-clock timeout — the same
approach and the same 30s timeout as the upstream repo's own
`scripts/test_solutions.py` (which execs canonical solutions "in isolated, secure
environments" and carries the same subprocess/signal-timeout safety note). A subprocess
rather than in-process `exec()`: this harness may eventually score real (if still
budget-bounded) LLM output, and running arbitrary model-authored code in the harness's own
process is worse hygiene than the upstream script accepts even for its own canonical,
version-controlled solutions."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from majorana_evals.public_benchmarks.schema import PublicTask

#: evals/public-benchmarks/qiskit-human-eval/dataset_qiskit_test_human_eval.json
DEFAULT_DATASET_PATH = (
    Path(__file__).resolve().parents[4]
    / "public-benchmarks"
    / "qiskit-human-eval"
    / "dataset_qiskit_test_human_eval.json"
)

#: Pinned in PROVENANCE.md — recomputed at load time and checked against this constant.
PINNED_SHA256 = "c9c87bd30bb600821f1385c9f8fc31205302823385f84966d32afd5d82c6e0f0"
PINNED_COMMIT_SHA = "c98ba538239fcfd554aa89627ee8026f4b5de450"

#: Bump when `build_nala_prompt` changes; carried into `PublicBenchmarkReport.prompt_version`
#: so a report can be told apart from one scored against different prompt wording.
PROMPT_VERSION = "qiskit-human-eval-v1"

#: Matches scripts/test_solutions.py's own EXECUTION_TIMEOUT_SECONDS upstream.
_CHECK_TIMEOUT_S = 30.0


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_qiskit_human_eval_tasks(path: Path | str = DEFAULT_DATASET_PATH) -> list[PublicTask]:
    """Load every task from the vendored dataset, sorted by task_id for determinism.

    Raises `ValueError` if the file's hash does not match `PINNED_SHA256` — a corrupted or
    hand-edited copy fails loudly rather than silently scoring against an undocumented
    dataset.
    """

    path = Path(path)
    digest = _sha256(path)
    if digest != PINNED_SHA256:
        raise ValueError(
            f"{path} does not match the pinned Qiskit HumanEval hash: "
            f"got {digest}, expected {PINNED_SHA256} (commit {PINNED_COMMIT_SHA}). "
            "Re-fetch from the pinned commit rather than editing the vendored file."
        )
    records = json.loads(path.read_text())
    tasks = [
        PublicTask(
            benchmark="qiskit-human-eval",
            task_id=record["task_id"],
            entry_point=record["entry_point"],
            nala_prompt=build_nala_prompt(record["prompt"]),
            canonical_solution=record["canonical_solution"],
            scaffold=record["prompt"],
            grading={"test": record["test"]},
            difficulty=record.get("difficulty_scale"),
        )
        for record in records
    ]
    return sorted(tasks, key=lambda task: task.task_id)


def build_nala_prompt(scaffold: str) -> str:
    """The natural-language instruction sent to Nala as `task_prompt`.

    The vendored `prompt` field is a bare scaffold (imports + signature + docstring), not
    phrased as an instruction the way QCircuitEval's own prompts already are — so it is
    wrapped here rather than handed through verbatim. Bump `PROMPT_VERSION` on any change.
    """

    return (
        "Using Qiskit, complete the following Python function. Return the complete "
        "function definition (signature and body), not just the missing body.\n\n"
        f"{scaffold}\n\n"
        "Requirements:\n"
        "- Preserve the exact function name and signature shown above.\n"
        "- The function must be self-contained and executable as written; do not include "
        "example usage, print statements, or tests.\n"
        "- Implement it using Qiskit."
    )


def score_qiskit_human_eval_task(source: str, task: PublicTask) -> tuple[bool, list[str]]:
    """Run the task's own `check(entry_point)` against the delivered candidate source.

    Returns (passed, reasons). `reasons` is empty on a pass; on failure it carries the
    subprocess's stderr tail (bounded) so a report shows why, not just that it failed.
    """

    test_source = task.grading.get("test")
    if not isinstance(test_source, str) or not test_source.strip():
        return False, ["qiskit-human-eval task is missing its 'test' grading field"]

    script = f"{source}\n\n{test_source}\n\ncheck({task.entry_point})\n"
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
            timeout=_CHECK_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return False, [f"check() did not complete within {_CHECK_TIMEOUT_S:.0f}s"]
    finally:
        Path(script_path).unlink(missing_ok=True)

    if result.returncode == 0:
        return True, []
    tail = "\n".join(result.stderr.strip().splitlines()[-20:])
    return False, [f"check() failed (exit {result.returncode}): {tail}"]
