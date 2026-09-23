"""CLI for the resource-estimation benchmark.

  # Zero-spend self-tests / controls — see SPEC.md "Controls":
  uv run --package majorana-evals python -m majorana_evals.resource_estimation run \\
      --adapter reference --out /tmp/re-reference.json
  uv run --package majorana-evals python -m majorana_evals.resource_estimation run \\
      --adapter perturbed-10x --out /tmp/re-perturbed.json
  uv run --package majorana-evals python -m majorana_evals.resource_estimation run \\
      --adapter constant-guess --out /tmp/re-constant.json

  # A REAL run spends provider money on every task (one call per task; no product
  # pipeline in the loop — see live_adapter.py). --budget-usd is a hard, required ceiling.
  uv run --package majorana-evals python -m majorana_evals.resource_estimation run \\
      --adapter live --live --budget-usd 5 --out evals/resource-estimation-report.json

`--adapter live` needs a configured provider profile (OPENAI_API_KEY+DEEPSEEK_API_KEY, or
ANTHROPIC_API_KEY with MAJORANA_LLM_PROVIDER=anthropic) — same as `public_benchmarks`.
Unlike that harness, no DATABASE_URL is needed here at all (see README.md)."""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from majorana_llm import default_llm, model_for

from majorana_evals.public_benchmarks.budget import BudgetGuardedLLM, BudgetTracker
from majorana_evals.resource_estimation.adapters import (
    ConstantGuessAdapter,
    ModelAdapter,
    PerturbedAdapter,
    ReferenceAdapter,
)
from majorana_evals.resource_estimation.live_adapter import LiveModelAdapter
from majorana_evals.resource_estimation.loader import (
    DEFAULT_CASES_DIR,
    load_resource_estimation_tasks,
)
from majorana_evals.resource_estimation.runner import run_benchmark
from majorana_evals.resource_estimation.schema import BenchmarkReport, RunMode

_ADAPTER_RUN_MODE: dict[str, RunMode] = {
    "reference": "stub-reference",
    "perturbed-10x": "stub-perturbed-10x",
    "constant-guess": "stub-constant-guess",
    "live": "live",
}


def _build_adapter(name: str, *, tracker: BudgetTracker | None) -> ModelAdapter:
    if name == "reference":
        return ReferenceAdapter()
    if name == "perturbed-10x":
        return PerturbedAdapter(factor=10.0)
    if name == "constant-guess":
        return ConstantGuessAdapter()
    if name == "live":
        assert tracker is not None  # enforced by _run before calling this
        model = model_for("generate")
        return LiveModelAdapter(BudgetGuardedLLM(default_llm(), tracker), model)
    raise ValueError(f"unknown adapter {name!r}")


def _write_markdown_summary(report: BenchmarkReport, path: Path) -> None:
    lines = [
        f"# resource-estimation — {report.run_mode}",
        "",
        f"- adapter: `{report.adapter_name}`",
        f"- tasks: {report.total}",
        f"- passed: {report.passed} ({report.pass_rate:.1%})",
        f"- mean score: {report.mean_score:.3f}",
        f"- pipeline commit: `{report.pipeline_commit_sha or 'unknown'}`",
        f"- dataset sha256: `{report.dataset_sha256}`",
    ]
    if report.note:
        lines += ["", f"note: {report.note}"]
    failed = [result for result in report.results if not result.passed]
    if failed:
        lines += ["", "## Failed tasks", ""]
        for result in failed:
            reason = result.reasons[0] if result.reasons else "(no reason recorded)"
            lines.append(f"- `{result.task_id}` (score={result.score:.2f}): {reason}")
    path.write_text("\n".join(lines) + "\n")


async def _run(args: argparse.Namespace) -> int:
    tasks, sha256 = load_resource_estimation_tasks(args.cases_dir)
    if args.limit is not None:
        tasks = tasks[: args.limit]

    tracker: BudgetTracker | None = None
    if args.adapter == "live":
        if not args.live:
            raise SystemExit("--adapter live requires --live (confirms real spend)")
        if args.budget_usd is None:
            raise SystemExit(
                "--adapter live requires --budget-usd (a hard spend ceiling) — "
                "see evals/public-benchmarks/PRICING.md for current rates"
            )
        tracker = BudgetTracker(ceiling_usd=args.budget_usd)
        note = f"LIVE run: spent real provider tokens, ${args.budget_usd:.2f} ceiling."
    else:
        note = (
            f"zero-spend offline adapter ({args.adapter}) — a control for the harness/grader "
            "itself, never a measurement of a real model's resource-estimation ability"
        )

    adapter = _build_adapter(args.adapter, tracker=tracker)
    run_mode = _ADAPTER_RUN_MODE[args.adapter]

    report = await run_benchmark(
        tasks,
        adapter=adapter,
        run_mode=run_mode,
        dataset_sha256=sha256,
        note=note,
        budget=tracker,
    )

    out_path = Path(args.out)
    out_path.write_text(report.model_dump_json(indent=2) + "\n")
    if args.markdown_out:
        _write_markdown_summary(report, Path(args.markdown_out))
    print(
        f"{report.passed}/{report.total} passed ({report.pass_rate:.0%}), "
        f"mean score {report.mean_score:.3f} [{args.adapter}] -> {out_path}"
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
    parser = argparse.ArgumentParser(prog="majorana_evals.resource_estimation")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument(
        "--adapter",
        choices=["reference", "perturbed-10x", "constant-guess", "live"],
        required=True,
    )
    run_parser.add_argument("--out", required=True)
    run_parser.add_argument("--markdown-out", default=None)
    run_parser.add_argument("--limit", type=int, default=None)
    run_parser.add_argument("--cases-dir", default=DEFAULT_CASES_DIR)
    run_parser.add_argument("--live", action="store_true", help="spend real provider tokens")
    run_parser.add_argument(
        "--budget-usd",
        type=float,
        default=None,
        help="hard spend ceiling in USD, required with --adapter live",
    )

    args = parser.parse_args()
    if args.command == "run":
        raise SystemExit(asyncio.run(_run(args)))


if __name__ == "__main__":
    main()
