"""CLI for the resource-estimation benchmark (first increment: offline adapters only).

  # Zero-spend self-tests / controls — see SPEC.md "Controls":
  uv run --package majorana-evals python -m majorana_evals.resource_estimation run \\
      --adapter reference --out /tmp/re-reference.json
  uv run --package majorana-evals python -m majorana_evals.resource_estimation run \\
      --adapter perturbed-10x --out /tmp/re-perturbed.json
  uv run --package majorana-evals python -m majorana_evals.resource_estimation run \\
      --adapter constant-guess --out /tmp/re-constant.json

No `--live` flag exists yet: this increment ships no adapter that calls a model of any kind
(see the PR this ships in — "spend nothing" was a hard constraint). Wiring a real adapter in
is future work; `run_benchmark` already accepts anything satisfying `ModelAdapter`."""

from __future__ import annotations

import argparse
from pathlib import Path

from majorana_evals.resource_estimation.adapters import (
    ConstantGuessAdapter,
    ModelAdapter,
    PerturbedAdapter,
    ReferenceAdapter,
)
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
}


def _build_adapter(name: str) -> ModelAdapter:
    if name == "reference":
        return ReferenceAdapter()
    if name == "perturbed-10x":
        return PerturbedAdapter(factor=10.0)
    if name == "constant-guess":
        return ConstantGuessAdapter()
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


def _run(args: argparse.Namespace) -> int:
    tasks, sha256 = load_resource_estimation_tasks(args.cases_dir)
    if args.limit is not None:
        tasks = tasks[: args.limit]

    adapter = _build_adapter(args.adapter)
    run_mode = _ADAPTER_RUN_MODE[args.adapter]
    note = (
        f"zero-spend offline adapter ({args.adapter}) — a control for the harness/grader "
        "itself, never a measurement of a real model's resource-estimation ability"
    )

    report = run_benchmark(
        tasks, adapter=adapter, run_mode=run_mode, dataset_sha256=sha256, note=note
    )

    out_path = Path(args.out)
    out_path.write_text(report.model_dump_json(indent=2) + "\n")
    if args.markdown_out:
        _write_markdown_summary(report, Path(args.markdown_out))
    print(
        f"{report.passed}/{report.total} passed ({report.pass_rate:.0%}), "
        f"mean score {report.mean_score:.3f} [{args.adapter}] -> {out_path}"
    )
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="majorana_evals.resource_estimation")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument(
        "--adapter", choices=["reference", "perturbed-10x", "constant-guess"], required=True
    )
    run_parser.add_argument("--out", required=True)
    run_parser.add_argument("--markdown-out", default=None)
    run_parser.add_argument("--limit", type=int, default=None)
    run_parser.add_argument("--cases-dir", default=DEFAULT_CASES_DIR)

    args = parser.parse_args()
    if args.command == "run":
        raise SystemExit(_run(args))


if __name__ == "__main__":
    main()
