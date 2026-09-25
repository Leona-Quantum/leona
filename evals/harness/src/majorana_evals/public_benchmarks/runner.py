"""Drives PublicTasks through the SAME production code path the internal evals harness
uses: `majorana_worker.handlers.handle_run_execute`, which wires
`majorana_agent.SimpleCircuitPipeline` via `ProductionSimplePipelinePorts`. This mirrors
`majorana_evals.runner.run_case`'s direct-handler ownership (this process creates the run
row and drives the handler itself — no queue row, so a background worker cannot claim the
same case) and reuses its trusted-candidate resolution (`_latest_trusted_execution`) rather
than re-deriving it, so both harnesses agree on what "the delivered candidate" means.

Benchmark scoring is delegated to `qiskit_human_eval.score_qiskit_human_eval_task` /
`qcircuiteval.score_qcircuiteval_task`, and runs ONLY when the pipeline itself reports
`run.status == "succeeded"` with a delivered candidate — a task Nala's own review rejects is
scored as failed regardless of what the raw generated code would have done, because that is
what the product actually delivers to a user."""

from __future__ import annotations

import subprocess
import time
from pathlib import Path

from majorana_contracts import Scope
from majorana_contracts.enums import Framework
from majorana_contracts.enums import RunMode as ContractRunMode
from majorana_llm import LLMClient
from majorana_llm.models import model_for, resolve_provider
from majorana_sandbox import Sandbox

from majorana_api.repos import runs as runs_repo
from majorana_worker.agent_store import RepoAgentStore
from majorana_worker.handlers import handle_run_execute

from majorana_evals.public_benchmarks.budget import BudgetTracker
from majorana_evals.public_benchmarks.qcircuiteval import score_qcircuiteval_task
from majorana_evals.public_benchmarks.qiskit_human_eval import score_qiskit_human_eval_task
from majorana_evals.public_benchmarks.schema import (
    BenchmarkName,
    CandidateAttemptSummary,
    ModelCallUsage,
    PublicBenchmarkReport,
    PublicTask,
    PublicTaskResult,
    _LAST_CANDIDATE_SOURCE_CAP,
)
from majorana_evals.public_benchmarks.schema import RunMode as ReportRunMode
from majorana_evals.public_benchmarks.stub_llm import bind_task
from majorana_evals.runner import _latest_export_event, _latest_trusted_execution


async def run_public_task(
    task: PublicTask,
    *,
    factory,
    scope: Scope,
    llm: LLMClient,
    sandbox: Sandbox,
) -> tuple[PublicTaskResult, dict[str, ModelCallUsage], dict[str, ModelCallUsage]]:
    """Run one task end to end and score it. Returns (result, usage_by_model, usage_by_stage)
    so the caller can merge usage across a whole benchmark without re-reading events."""

    started = time.monotonic()
    async with factory() as session:
        run = await runs_repo.create_run(
            scope,
            session,
            task_prompt=task.nala_prompt,
            mode=ContractRunMode.EXECUTE,
            framework=Framework.QISKIT,
        )
        await runs_repo.append_run_event(
            scope,
            session,
            run.id,
            type="run.queued",
            payload={"mode": str(ContractRunMode.EXECUTE), "framework": str(Framework.QISKIT)},
        )
        run_id = run.id
        payload = {
            "run_id": str(run_id),
            "workspace_id": str(scope.workspace_id),
            "user_id": str(scope.user_id),
        }
        await session.commit()

    reasons: list[str] = []
    try:
        # `bind_task` is a no-op for a real LLMClient (nothing reads the contextvar); it
        # is what lets `StubPipelineLLM.generate_circuit` answer with THIS task's own
        # canonical_solution/scaffold without threading a task argument through every
        # production call site between here and it.
        with bind_task(task):
            async with factory() as session:
                await handle_run_execute(session, payload, llm=llm, sandbox=sandbox)
    except Exception as exc:  # a crash is a failed task, not a harness abort
        reasons.append(f"handler error: {type(exc).__name__}: {exc}")

    wall_time_s = time.monotonic() - started

    candidate_source: str | None = None
    candidate_fingerprint: str | None = None
    candidates_considered = 0
    candidate_attempts: list[CandidateAttemptSummary] = []
    last_candidate_source: str | None = None
    last_candidate_source_truncated = False
    usage_by_model: dict[str, ModelCallUsage] = {}
    usage_by_stage: dict[str, ModelCallUsage] = {}
    async with factory() as session:
        run = await runs_repo.get_run(scope, session, run_id)
        events = await runs_repo.list_run_events(scope, session, run_id)
        export_event = _latest_export_event(events)
        finalized_event = (
            export_event
            if export_event is not None and export_event.type == "code.finalized"
            else None
        )
        finalized_source = finalized_event.payload.get("code") if finalized_event else None
        finalized_revision = finalized_event.payload.get("revision") if finalized_event else None
        store = RepoAgentStore(scope, session)
        candidates = sorted(await store.list_candidates(run_id), key=lambda item: item.revision)
        candidates_considered = len(candidates)
        # ai-ops 372: this is the evidence that used to live ONLY in the run's own
        # Postgres — captured into the report itself now, because that database turned
        # out not to be durable (a local docker volume, gone four weeks after the run
        # that needed it). `check_contract`'s own diagnostics are not persisted anywhere
        # by the pipeline (only ExecutionEvidence/SemanticReviewEvidence are durable
        # records), so `review_decision=None` below is itself the signal that a
        # candidate never reached review — see CandidateAttemptSummary's docstring.
        for item in candidates:
            execution = await store.execution_for(run_id, item.candidate_id)
            review = await store.latest_semantic_review(run_id, item.candidate_id)
            candidate_attempts.append(
                CandidateAttemptSummary(
                    revision=item.revision,
                    source_fingerprint=item.source_fingerprint,
                    execution_succeeded=execution.succeeded if execution else None,
                    execution_failure_kind=(
                        execution.failure_kind.value
                        if execution and execution.failure_kind
                        else None
                    ),
                    execution_result_keys=(
                        sorted(str(key) for key in execution.result) if execution else []
                    ),
                    review_decision=review.decision.value if review else None,
                    review_reason_code=review.reason_code if review else None,
                    review_severity=review.severity if review else None,
                )
            )
        if candidates:
            last = candidates[-1]
            last_candidate_source = last.source[:_LAST_CANDIDATE_SOURCE_CAP]
            last_candidate_source_truncated = len(last.source) > _LAST_CANDIDATE_SOURCE_CAP
        try:
            candidate, _execution = await _latest_trusted_execution(
                store,
                run_id,
                finalized_source=finalized_source,
                finalized_revision=finalized_revision,
                finalized_event_present=finalized_event is not None,
            )
            if candidate is not None:
                candidate_source = candidate.source
                candidate_fingerprint = candidate.source_fingerprint
        except Exception as exc:  # integrity failure is a failed score, not a harness abort
            reasons.append(f"trusted candidate unavailable: {type(exc).__name__}: {exc}")

        for event in events:
            if event.type != "llm.call":
                continue
            model = event.payload.get("model") or "unknown"
            stage = event.payload.get("stage") or "unknown"
            raw_in = event.payload.get("input_tokens")
            raw_out = event.payload.get("output_tokens")
            in_tokens = (
                raw_in
                if isinstance(raw_in, int) and not isinstance(raw_in, bool) and raw_in >= 0
                else 0
            )
            out_tokens = (
                raw_out
                if isinstance(raw_out, int) and not isinstance(raw_out, bool) and raw_out >= 0
                else 0
            )
            for bucket_map, key in ((usage_by_model, model), (usage_by_stage, stage)):
                bucket = bucket_map.setdefault(key, ModelCallUsage())
                bucket.calls += 1
                bucket.input_tokens += in_tokens
                bucket.output_tokens += out_tokens

    recorded_calls = sum(bucket.calls for bucket in usage_by_model.values())
    recorded_input = sum(bucket.input_tokens for bucket in usage_by_model.values())
    recorded_output = sum(bucket.output_tokens for bucket in usage_by_model.values())

    functional_grading = (
        "implemented" if task.benchmark == "qiskit-human-eval" else "not_implemented"
    )
    if run.status != "succeeded" or candidate_source is None:
        passed = False
        if not reasons:
            reasons.append(f"run_status={run.status!r}, no delivered candidate")
    else:
        scorer = (
            score_qiskit_human_eval_task
            if task.benchmark == "qiskit-human-eval"
            else score_qcircuiteval_task
        )
        passed, score_reasons = scorer(candidate_source, task)
        reasons.extend(score_reasons)

    result = PublicTaskResult(
        benchmark=task.benchmark,
        task_id=task.task_id,
        passed=passed,
        functional_grading=functional_grading,
        run_status=run.status,
        candidates_considered=candidates_considered,
        reasons=reasons,
        recorded_llm_calls=recorded_calls,
        recorded_input_tokens=recorded_input,
        recorded_output_tokens=recorded_output,
        wall_time_s=wall_time_s,
        candidate_source_fingerprint=candidate_fingerprint,
        candidate_attempts=candidate_attempts,
        last_candidate_source=last_candidate_source,
        last_candidate_source_truncated=last_candidate_source_truncated,
    )
    return result, usage_by_model, usage_by_stage


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


async def run_public_benchmark(
    tasks: list[PublicTask],
    *,
    benchmark: BenchmarkName,
    factory,
    scope: Scope,
    llm: LLMClient,
    sandbox: Sandbox,
    run_mode: ReportRunMode,
    dataset_commit_sha: str,
    dataset_sha256: dict[str, str],
    prompt_version: str,
    note: str | None = None,
    budget: BudgetTracker | None = None,
    task_id_subset: list[str] | None = None,
) -> PublicBenchmarkReport:
    """`budget`, when given, is checked BEFORE starting each task (not mid-task — a task
    already in flight is allowed to finish; `BudgetGuardedLLM` is the mid-task stop). Once
    `budget.exceeded()`, every remaining task is recorded as skipped rather than attempted
    (and then immediately failed by `BudgetGuardedLLM` for a $0 cost) — so a report always
    accounts for all `len(tasks)` tasks, distinguishing "ran and failed" from "never
    attempted because the ceiling was already reached"."""
    results: list[PublicTaskResult] = []
    by_model: dict[str, ModelCallUsage] = {}
    by_stage: dict[str, ModelCallUsage] = {}
    for index, task in enumerate(tasks):
        if budget is not None and budget.exceeded():
            for skipped_task in tasks[index:]:
                results.append(
                    PublicTaskResult(
                        benchmark=skipped_task.benchmark,
                        task_id=skipped_task.task_id,
                        passed=False,
                        run_status="skipped_budget_ceiling",
                        reasons=[
                            f"not attempted: ${budget.spent_usd:.4f} already spent, "
                            f"${budget.ceiling_usd:.2f} ceiling reached before this task"
                        ],
                        wall_time_s=0.0,
                    )
                )
            break
        result, usage_model, usage_stage = await run_public_task(
            task, factory=factory, scope=scope, llm=llm, sandbox=sandbox
        )
        results.append(result)
        for bucket_map, usage in ((by_model, usage_model), (by_stage, usage_stage)):
            for key, bucket in usage.items():
                total = bucket_map.setdefault(key, ModelCallUsage())
                total.calls += bucket.calls
                total.input_tokens += bucket.input_tokens
                total.output_tokens += bucket.output_tokens

    total = len(results)
    passed = sum(result.passed for result in results)
    return PublicBenchmarkReport(
        benchmark=benchmark,
        run_mode=run_mode,
        generate_model=model_for("generate"),
        provider_profile=resolve_provider(),
        prompt_version=prompt_version,
        pipeline_commit_sha=_pipeline_commit_sha(),
        dataset_commit_sha=dataset_commit_sha,
        dataset_sha256=dataset_sha256,
        total=total,
        passed=passed,
        pass_rate=(passed / total if total else 0.0),
        total_wall_time_s=sum(result.wall_time_s for result in results),
        total_recorded_llm_calls=sum(result.recorded_llm_calls for result in results),
        total_recorded_input_tokens=sum(result.recorded_input_tokens for result in results),
        total_recorded_output_tokens=sum(result.recorded_output_tokens for result in results),
        by_model=by_model,
        by_stage=by_stage,
        results=results,
        note=note,
        task_id_subset=task_id_subset,
    )
