"""Drives a `ModelAdapter` over a list of tasks and aggregates a `BenchmarkReport`.

Same "no product pipeline in the loop" posture as `paper_to_code.runner` — this is a plain
synchronous loop over subprocess-graded tasks, no DB, no sandbox worker queue. The report
also records `qiskit.__version__` actually installed in the running environment, since the
whole point of this benchmark is that its result can differ across Qiskit versions — a
report that didn't say which version it ran under would be unusable for the "did the
reference itself drift" question this benchmark exists to answer."""

from __future__ import annotations

import subprocess
import time
from pathlib import Path

from majorana_evals.sdk_drift.adapters import ModelAdapter
from majorana_evals.sdk_drift.grader import qiskit_installed_version, score_sdk_drift_task
from majorana_evals.sdk_drift.schema import BenchmarkReport, SdkDriftTask, TaskResult
from majorana_evals.sdk_drift.schema import RunMode as ReportRunMode


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
    tasks: list[SdkDriftTask],
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
        passed, reasons, drift_reason_matched = score_sdk_drift_task(candidate_source, task)
        results.append(
            TaskResult(
                task_id=task.task_id,
                passed=passed,
                reasons=reasons,
                drift_reason_matched=drift_reason_matched,
                wall_time_s=time.monotonic() - started,
            )
        )
    total = len(results)
    passed_count = sum(1 for result in results if result.passed)
    return BenchmarkReport(
        run_mode=run_mode,
        adapter_name=adapter.name,
        pipeline_commit_sha=_pipeline_commit_sha(),
        dataset_sha256=dataset_sha256,
        qiskit_version=qiskit_installed_version(),
        total=total,
        passed=passed_count,
        pass_rate=(passed_count / total if total else 0.0),
        results=results,
        note=note,
    )
