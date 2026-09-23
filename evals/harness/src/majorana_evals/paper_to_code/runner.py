"""Drives a `ModelAdapter` over a list of tasks and aggregates a `BenchmarkReport`.

Deliberately NOT built on `majorana_evals.public_benchmarks.runner`'s pattern of driving
Nala's own production pipeline through a real Postgres-backed `Scope`/session: this
benchmark grades a candidate's Python source directly against the task's own hidden test
(subprocess execution, no DB, no sandbox worker queue) — the same "no product pipeline in
the loop" posture `resource_estimation.runner` documents, adapted here for a code-shaped
answer instead of a numeric one."""

from __future__ import annotations

import subprocess
import time
from pathlib import Path

from majorana_evals.paper_to_code.adapters import ModelAdapter
from majorana_evals.paper_to_code.grader import score_paper_to_code_task
from majorana_evals.paper_to_code.schema import BenchmarkReport, PaperToCodeTask, TaskResult
from majorana_evals.paper_to_code.schema import RunMode as ReportRunMode


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


def run_benchmark(
    tasks: list[PaperToCodeTask],
    *,
    adapter: ModelAdapter,
    run_mode: ReportRunMode,
    dataset_sha256: str,
    note: str | None = None,
) -> BenchmarkReport:
    results: list[TaskResult] = []
    for task in tasks:
        started = time.monotonic()
        candidate_source = adapter.answer(task)
        passed, reasons = score_paper_to_code_task(candidate_source, task)
        results.append(
            TaskResult(
                task_id=task.task_id,
                novelty=task.novelty,
                passed=passed,
                reasons=reasons,
                wall_time_s=time.monotonic() - started,
            )
        )
    total = len(results)
    passed_count = sum(1 for result in results if result.passed)
    paper_specific_results = [result for result in results if result.novelty == "paper-specific"]
    paper_specific_total = len(paper_specific_results)
    paper_specific_passed = sum(1 for result in paper_specific_results if result.passed)
    return BenchmarkReport(
        run_mode=run_mode,
        adapter_name=adapter.name,
        pipeline_commit_sha=_pipeline_commit_sha(),
        dataset_sha256=dataset_sha256,
        total=total,
        passed=passed_count,
        pass_rate=(passed_count / total if total else 0.0),
        paper_specific_total=paper_specific_total,
        paper_specific_passed=paper_specific_passed,
        paper_specific_pass_rate=(
            paper_specific_passed / paper_specific_total if paper_specific_total else 0.0
        ),
        results=results,
        note=note,
    )
