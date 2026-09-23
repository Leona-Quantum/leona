"""Drives a `ModelAdapter` over a list of tasks and aggregates a `BenchmarkReport`.

Deliberately NOT built on `majorana_evals.public_benchmarks.runner`'s pattern of driving
Nala's own production pipeline (`handle_run_execute`) through a real Postgres-backed
`Scope`/session: this benchmark tests a MODEL's direct answer to a fully-specified numeric
question, not whether Nala's code-generation product can produce a working circuit. There is
no database, no sandbox, and no product pipeline in the loop — `run_benchmark` is a plain
synchronous loop, which is also why every adapter in `adapters.py` is synchronous. A future
live adapter wrapping a real (paid) LLM call can still implement `ModelAdapter` synchronously
(blocking on the HTTP call) or the signature can grow an async variant then; nothing here
needs to anticipate that today."""

from __future__ import annotations

import inspect
import subprocess
from pathlib import Path

from majorana_evals.public_benchmarks.budget import BudgetTracker
from majorana_evals.resource_estimation.adapters import ModelAdapter
from majorana_evals.resource_estimation.grader import grade_task
from majorana_evals.resource_estimation.schema import BenchmarkReport, ResourceEstimationTask
from majorana_evals.resource_estimation.schema import RunMode as ReportRunMode


def _pipeline_commit_sha() -> str | None:
    try:
        completed = subprocess.run(  # noqa: S603, S607 - fixed args, no shell, best-effort
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            cwd=Path(__file__).resolve().parent,
            timeout=5.0,
        )
    except Exception:
        return None
    if completed.returncode != 0:
        return None
    return completed.stdout.strip() or None


async def run_benchmark(
    tasks: list[ResourceEstimationTask],
    *,
    adapter: ModelAdapter,
    run_mode: ReportRunMode,
    dataset_sha256: str,
    note: str | None = None,
    budget: BudgetTracker | None = None,
) -> BenchmarkReport:
    """Async so a real (paid) adapter's `answer()` — a coroutine, since it calls a real
    `LLMClient` — can be awaited. The three offline adapters in `adapters.py` return a
    plain `ModelAnswer` (not awaitable); `inspect.isawaitable` tells the two apart so
    neither needs a different call site.

    `budget`, when given, is checked BEFORE each task; once exceeded, every remaining task
    is graded against an empty `ModelAnswer` (== "no answer" for every pinned quantity,
    scored 0 by `grade_task`, never a fabricated skip status) with a note saying why —
    `resource_estimation.BenchmarkReport` has no per-task run_status field to mark
    "skipped" the way `public_benchmarks` does, so the reason lives in `TaskResult.reasons`
    via the same "no answer given" path grading already produces for a missing key."""
    from majorana_evals.resource_estimation.schema import ModelAnswer

    results = []
    for task in tasks:
        if budget is not None and budget.exceeded():
            empty = ModelAnswer(
                task_id=task.task_id,
                values={},
                raw=(
                    f"not attempted: ${budget.spent_usd:.4f} already spent, "
                    f"${budget.ceiling_usd:.2f} ceiling reached before this task"
                ),
            )
            results.append(grade_task(task, empty))
            continue
        maybe_answer = adapter.answer(task)
        answer = await maybe_answer if inspect.isawaitable(maybe_answer) else maybe_answer
        results.append(grade_task(task, answer))
    total = len(results)
    passed = sum(1 for result in results if result.passed)
    mean_score = sum(result.score for result in results) / total if total else 0.0
    return BenchmarkReport(
        run_mode=run_mode,
        adapter_name=adapter.name,
        pipeline_commit_sha=_pipeline_commit_sha(),
        dataset_sha256=dataset_sha256,
        total=total,
        passed=passed,
        pass_rate=(passed / total if total else 0.0),
        mean_score=mean_score,
        results=results,
        note=note,
    )
