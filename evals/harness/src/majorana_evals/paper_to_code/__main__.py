"""CLI for the paper-to-code benchmark (first increment: offline adapters only).

  # Zero-spend self-tests / controls — see SPEC.md "Controls":
  uv run --package majorana-evals python -m majorana_evals.paper_to_code run \\
      --adapter canonical --out /tmp/ptc-canonical.json
  uv run --package majorana-evals python -m majorana_evals.paper_to_code run \\
      --adapter garbage --out /tmp/ptc-garbage.json

No `--live` flag exists yet: this increment ships no adapter that calls a model of any kind.
Wiring a real adapter in is future work; `run_benchmark` already accepts anything satisfying
`ModelAdapter`."""

from __future__ import annotations

import argparse
from pathlib import Path

from majorana_evals.paper_to_code.adapters import CanonicalAdapter, GarbageAdapter, ModelAdapter
from majorana_evals.paper_to_code.loader import DEFAULT_CASES_DIR, load_paper_to_code_tasks
from majorana_evals.paper_to_code.runner import run_benchmark
from majorana_evals.paper_to_code.schema import BenchmarkReport, RunMode

_ADAPTER_RUN_MODE: dict[str, RunMode] = {
    "canonical": "stub-canonical",
    "garbage": "stub-garbage",
}


def _build_adapter(name: str) -> ModelAdapter:
    if name == "canonical":
        return CanonicalAdapter()
    if name == "garbage":
        return GarbageAdapter()
    raise ValueError(f"unknown adapter {name!r}")


def _write_markdown_summary(report: BenchmarkReport, path: Path) -> None:
    lines = [
        f"# paper-to-code — {report.run_mode}",
        "",
        f"- adapter: `{report.adapter_name}`",
        f"- tasks (all, including `restated`): {report.total}",
        f"- passed (all): {report.passed} ({report.pass_rate:.1%})",
        f"- **paper-specific tasks only: {report.paper_specific_passed}/"
        f"{report.paper_specific_total} ({report.paper_specific_pass_rate:.1%})** — "
        'only THIS figure supports a "not memorizable" claim; `restated` tasks predate '
        "their cited paper and are excluded (see SPEC.md / PROVENANCE.md)",
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
            lines.append(f"- `{result.task_id}`: {reason}")
    path.write_text("\n".join(lines) + "\n")


def _run(args: argparse.Namespace) -> int:
    tasks, sha256 = load_paper_to_code_tasks(args.cases_dir)
    if args.limit is not None:
        tasks = tasks[: args.limit]

    adapter = _build_adapter(args.adapter)
    run_mode = _ADAPTER_RUN_MODE[args.adapter]
    note = (
        f"zero-spend offline adapter ({args.adapter}) — a control for the harness/grader "
        "itself, never a measurement of a real model's paper-to-code ability"
    )

    report = run_benchmark(
        tasks, adapter=adapter, run_mode=run_mode, dataset_sha256=sha256, note=note
    )

    out_path = Path(args.out)
    out_path.write_text(report.model_dump_json(indent=2) + "\n")
    if args.markdown_out:
        _write_markdown_summary(report, Path(args.markdown_out))
    print(
        f"{report.passed}/{report.total} passed ({report.pass_rate:.0%}) [{args.adapter}]; "
        f"paper-specific only: {report.paper_specific_passed}/{report.paper_specific_total} "
        f"({report.paper_specific_pass_rate:.0%}) -> {out_path}"
    )
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="majorana_evals.paper_to_code")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--adapter", choices=["canonical", "garbage"], required=True)
    run_parser.add_argument("--out", required=True)
    run_parser.add_argument("--markdown-out", default=None)
    run_parser.add_argument("--limit", type=int, default=None)
    run_parser.add_argument("--cases-dir", default=DEFAULT_CASES_DIR)

    args = parser.parse_args()
    if args.command == "run":
        raise SystemExit(_run(args))


if __name__ == "__main__":
    main()
