"""CLI for the public-benchmark harness (proposal 1).

  # Zero-spend self-test: proves the harness end to end with the stub controls.
  uv run --package majorana-evals python -m majorana_evals.public_benchmarks run \\
      --benchmark qiskit-human-eval --stub canonical --out /tmp/qhe-canonical.json

  uv run --package majorana-evals python -m majorana_evals.public_benchmarks run \\
      --benchmark qiskit-human-eval --stub garbage --out /tmp/qhe-garbage.json

  # A REAL run spends provider money on every task — see the PR body / PRICING.md
  # for the estimate before ever passing --live.
  uv run --package majorana-evals python -m majorana_evals.public_benchmarks run \\
      --benchmark qcircuiteval --live --out evals/public-benchmarks-report.json

Needs DATABASE_URL always (the pipeline persists through the repository layer regardless of
which LLM is injected); `--live` additionally needs a configured provider profile
(OPENAI_API_KEY+DEEPSEEK_API_KEY, or ANTHROPIC_API_KEY with MAJORANA_LLM_PROVIDER=anthropic).
"""

from __future__ import annotations

import argparse
import asyncio
import uuid
from pathlib import Path

from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_llm import default_llm

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import system
from majorana_sandbox import LocalSubprocessSandbox

from majorana_evals.public_benchmarks.qcircuiteval import (
    DEFAULT_CORE_PATH,
    DEFAULT_QEC_PATH,
    PINNED_COMMIT_SHA as QCE_COMMIT_SHA,
    PINNED_SHA256 as QCE_SHA256,
    PROMPT_VERSION as QCE_PROMPT_VERSION,
    load_qcircuiteval_tasks,
)
from majorana_evals.public_benchmarks.qiskit_human_eval import (
    DEFAULT_DATASET_PATH,
    PINNED_COMMIT_SHA as QHE_COMMIT_SHA,
    PINNED_SHA256 as QHE_SHA256,
    PROMPT_VERSION as QHE_PROMPT_VERSION,
    load_qiskit_human_eval_tasks,
)
from majorana_evals.public_benchmarks.budget import BudgetGuardedLLM, BudgetTracker
from majorana_evals.public_benchmarks.runner import run_public_benchmark
from majorana_evals.public_benchmarks.schema import PublicBenchmarkReport
from majorana_evals.public_benchmarks.stub_llm import StubPipelineLLM


def _write_markdown_summary(report: PublicBenchmarkReport, path: Path) -> None:
    # ai-ops 372 review round 2: a subset score (--task-ids or --limit) must never read
    # like a full-benchmark one. The headline says so explicitly rather than leaving a
    # reader to notice `tasks: 36` is smaller than the benchmark they know is 151.
    subset_suffix = (
        f" (subset of {len(report.task_id_subset)} tasks)" if report.task_id_subset else ""
    )
    lines = [
        f"# {report.benchmark} — {report.run_mode}{subset_suffix}",
        "",
        f"- tasks: {report.total}",
        f"- passed: {report.passed} ({report.pass_rate:.1%})",
        f"- model (generate): `{report.generate_model}` (provider profile: {report.provider_profile})",
        f"- prompt version: `{report.prompt_version}`",
        f"- pipeline commit: `{report.pipeline_commit_sha or 'unknown'}`",
        f"- dataset commit: `{report.dataset_commit_sha}`",
        f"- dataset hash(es): {report.dataset_sha256}",
        f"- total wall time: {report.total_wall_time_s:.1f}s",
        f"- recorded LLM calls: {report.total_recorded_llm_calls} "
        f"({report.total_recorded_input_tokens} in / {report.total_recorded_output_tokens} out tokens)",
    ]
    if report.task_id_subset:
        lines += [
            "",
            f"**SUBSET RUN — {len(report.task_id_subset)} task(s), not the full benchmark.**",
            f"task_id_subset: {', '.join(f'`{task_id}`' for task_id in report.task_id_subset)}",
        ]
    if report.note:
        lines += ["", f"note: {report.note}"]
    failed = [result for result in report.results if not result.passed]
    if failed:
        lines += ["", "## Failed tasks", ""]
        for result in failed[:50]:
            reason = result.reasons[0] if result.reasons else "(no reason recorded)"
            lines.append(f"- `{result.task_id}` (status={result.run_status}): {reason}")
        if len(failed) > 50:
            lines.append(f"- … and {len(failed) - 50} more")
    path.write_text("\n".join(lines) + "\n")


async def _run(args: argparse.Namespace) -> int:
    if args.benchmark == "qiskit-human-eval":
        tasks = load_qiskit_human_eval_tasks(DEFAULT_DATASET_PATH)
        dataset_commit_sha = QHE_COMMIT_SHA
        dataset_sha256 = {"dataset_qiskit_test_human_eval.json": QHE_SHA256}
        prompt_version = QHE_PROMPT_VERSION
    else:
        tasks = load_qcircuiteval_tasks(
            core_path=DEFAULT_CORE_PATH, qec_path=DEFAULT_QEC_PATH, include_qec=not args.no_qec
        )
        dataset_commit_sha = QCE_COMMIT_SHA
        dataset_sha256 = dict(QCE_SHA256)
        prompt_version = QCE_PROMPT_VERSION

    task_id_subset: list[str] | None = None
    if args.task_ids is not None:
        wanted = {task_id.strip() for task_id in args.task_ids.split(",") if task_id.strip()}
        tasks = [task for task in tasks if task.task_id in wanted]
        missing = wanted - {task.task_id for task in tasks}
        if missing:
            raise SystemExit(f"--task-ids named task_ids not in this benchmark: {sorted(missing)}")
        task_id_subset = sorted(wanted)

    if args.limit is not None:
        tasks = tasks[: args.limit]
        # A --limit slice is ALSO a subset — the report must say so the same way
        # --task-ids does, or a --limit run's score reads as a full-benchmark one.
        if task_id_subset is None:
            task_id_subset = sorted(task.task_id for task in tasks)

    tracker: BudgetTracker | None = None
    if args.live:
        if args.budget_usd is None:
            raise SystemExit(
                "--live requires --budget-usd (a hard spend ceiling) — "
                "see evals/public-benchmarks/PRICING.md before choosing one"
            )
        tracker = BudgetTracker(ceiling_usd=args.budget_usd)
        llm = BudgetGuardedLLM(default_llm(), tracker)
        run_mode = "live"
        note = f"LIVE run: spent real provider tokens, ${args.budget_usd:.2f} ceiling."
    else:
        llm = StubPipelineLLM(mode=args.stub)
        run_mode = f"stub-{args.stub}"
        note = (
            f"zero-spend stub run ({args.stub}) — a control for the harness itself, "
            "not a measurement of Nala's real quality on this benchmark"
        )

    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        async with factory() as session:
            user, ws = await system.get_or_provision_user(
                session,
                workos_user_id=f"public-bench-{uuid.uuid4()}",
                email=f"public-bench-{uuid.uuid4().hex[:8]}@eval.majorana",
            )
            await session.commit()
            scope = Scope(user_id=user.id, workspace_id=ws.id, role=Role.OWNER)

        report = await run_public_benchmark(
            tasks,
            benchmark=args.benchmark,
            factory=factory,
            scope=scope,
            llm=llm,
            sandbox=LocalSubprocessSandbox(),
            run_mode=run_mode,
            dataset_commit_sha=dataset_commit_sha,
            dataset_sha256=dataset_sha256,
            prompt_version=prompt_version,
            note=note,
            budget=tracker,
            task_id_subset=task_id_subset,
        )
    finally:
        await engine.dispose()

    out_path = Path(args.out)
    out_path.write_text(report.model_dump_json(indent=2) + "\n")
    if args.markdown_out:
        _write_markdown_summary(report, Path(args.markdown_out))
    subset_note = (
        f" (SUBSET of {len(report.task_id_subset)} tasks, not the full benchmark)"
        if report.task_id_subset
        else ""
    )
    print(
        f"{report.passed}/{report.total} passed ({report.pass_rate:.0%}) "
        f"[{run_mode}]{subset_note} -> {out_path}"
    )
    if tracker is not None:
        rate_note = (
            f" (rates priced for {tracker.unpriced_models}, NOT the served model — "
            "figure may be wrong)"
            if tracker.unpriced_models
            else ""
        )
        print(
            f"spend: ${tracker.spent_usd:.4f} of ${tracker.ceiling_usd:.2f} ceiling, "
            f"{tracker.calls} calls, {tracker.input_tokens} in / {tracker.output_tokens} "
            f"out tokens{rate_note}"
        )
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="majorana_evals.public_benchmarks")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument(
        "--benchmark", choices=["qiskit-human-eval", "qcircuiteval"], required=True
    )
    run_parser.add_argument("--out", required=True)
    run_parser.add_argument("--markdown-out", default=None)
    run_parser.add_argument("--limit", type=int, default=None)
    run_parser.add_argument(
        "--task-ids",
        default=None,
        help=(
            "comma-separated task_ids to run instead of the whole benchmark "
            "(ai-ops 372: restricting a --live diagnostic re-run to only the "
            "tasks that need it). Applied before --limit."
        ),
    )
    run_parser.add_argument(
        "--no-qec", action="store_true", help="qcircuiteval: skip the 12 QEC tasks"
    )
    mode = run_parser.add_mutually_exclusive_group()
    mode.add_argument("--stub", choices=["canonical", "garbage"], default="canonical")
    mode.add_argument("--live", action="store_true", help="spend real provider tokens")
    run_parser.add_argument(
        "--budget-usd",
        type=float,
        default=None,
        help="hard spend ceiling in USD, required with --live (see PRICING.md)",
    )

    args = parser.parse_args()
    if args.command == "run":
        raise SystemExit(asyncio.run(_run(args)))


if __name__ == "__main__":
    main()
