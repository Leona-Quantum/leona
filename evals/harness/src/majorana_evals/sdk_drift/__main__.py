"""CLI for the SDK-drift benchmark (first increment: offline adapters only).

  # Zero-spend self-tests / controls — see SPEC.md "Controls":
  uv run --package majorana-evals python -m majorana_evals.sdk_drift run \\
      --adapter canonical --out /tmp/sdk-canonical.json
  uv run --package majorana-evals python -m majorana_evals.sdk_drift run \\
      --adapter outdated --out /tmp/sdk-outdated.json

  # The "re-run on every release" half — zero-spend, no model call, just re-runs the
  # canonical (reference) solutions against WHATEVER Qiskit is installed right now:
  uv run --package majorana-evals python -m majorana_evals.sdk_drift drift-check \\
      --out /tmp/sdk-drift-check.json

No `--live` flag exists yet: this increment ships no adapter that calls a model of any kind.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from majorana_evals.sdk_drift.adapters import CanonicalAdapter, ModelAdapter, OutdatedAdapter
from majorana_evals.sdk_drift.loader import DEFAULT_CASES_DIR, load_sdk_drift_tasks
from majorana_evals.sdk_drift.runner import run_benchmark
from majorana_evals.sdk_drift.schema import BenchmarkReport, RunMode

_ADAPTER_RUN_MODE: dict[str, RunMode] = {
    "canonical": "stub-canonical",
    "outdated": "stub-outdated",
}


def _build_adapter(name: str) -> ModelAdapter:
    if name == "canonical":
        return CanonicalAdapter()
    if name == "outdated":
        return OutdatedAdapter()
    raise ValueError(f"unknown adapter {name!r}")


def _write_markdown_summary(report: BenchmarkReport, path: Path, *, heading: str) -> None:
    lines = [
        f"# sdk-drift — {heading}",
        "",
        f"- adapter: `{report.adapter_name}`",
        f"- qiskit version: `{report.qiskit_version}`",
        f"- tasks: {report.total}",
        f"- passed: {report.passed} ({report.pass_rate:.1%})",
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
            drift = (
                "drift-reason match"
                if result.drift_reason_matched
                else "NOT the expected drift reason"
                if result.drift_reason_matched is False
                else "n/a"
            )
            lines.append(f"- `{result.task_id}` [{drift}]: {reason}")
    path.write_text("\n".join(lines) + "\n")


def _run(args: argparse.Namespace) -> int:
    tasks, sha256 = load_sdk_drift_tasks(args.cases_dir)
    if args.limit is not None:
        tasks = tasks[: args.limit]

    adapter = _build_adapter(args.adapter)
    run_mode = _ADAPTER_RUN_MODE[args.adapter]
    note = (
        f"zero-spend offline adapter ({args.adapter}) — a control for the harness/grader "
        "itself, never a measurement of a real model's SDK-currency"
    )

    report = run_benchmark(
        tasks, adapter=adapter, run_mode=run_mode, dataset_sha256=sha256, note=note
    )

    out_path = Path(args.out)
    out_path.write_text(report.model_dump_json(indent=2) + "\n")
    if args.markdown_out:
        _write_markdown_summary(report, Path(args.markdown_out), heading=args.adapter)
    print(
        f"{report.passed}/{report.total} passed ({report.pass_rate:.0%}) "
        f"[{args.adapter}, qiskit {report.qiskit_version}] -> {out_path}"
    )
    return 0


def _drift_check(args: argparse.Namespace) -> int:
    """Re-runs the CANONICAL (reference) solutions against whatever Qiskit is installed
    right now. Zero spend, no model call — this is the "does the reference itself drift on
    a new SDK release" half described in SPEC.md. A non-zero exit means at least one
    reference solution that used to pass no longer does, which is exactly the signal a
    scheduled, secretless CI job (see the workflow this ships with) watches for."""

    tasks, sha256 = load_sdk_drift_tasks(args.cases_dir)
    adapter = CanonicalAdapter()
    report = run_benchmark(
        tasks,
        adapter=adapter,
        run_mode="live",
        dataset_sha256=sha256,
        note=(
            "reference-solution drift check: re-runs every task's own MODERN-idiom "
            "canonical solution against the currently installed Qiskit. A failure here "
            "means a task's reference itself has drifted, not that a model was graded."
        ),
    )
    out_path = Path(args.out)
    out_path.write_text(report.model_dump_json(indent=2) + "\n")
    drifted = [result for result in report.results if not result.passed]
    if drifted:
        print(
            f"DRIFT DETECTED: {len(drifted)}/{report.total} reference solutions now fail "
            f"against qiskit {report.qiskit_version}:"
        )
        for result in drifted:
            print(f"  - {result.task_id}: {result.reasons[0] if result.reasons else ''}")
        return 1
    print(
        f"no drift: {report.total}/{report.total} references still pass qiskit {report.qiskit_version}"
    )
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="majorana_evals.sdk_drift")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--adapter", choices=["canonical", "outdated"], required=True)
    run_parser.add_argument("--out", required=True)
    run_parser.add_argument("--markdown-out", default=None)
    run_parser.add_argument("--limit", type=int, default=None)
    run_parser.add_argument("--cases-dir", default=DEFAULT_CASES_DIR)

    drift_parser = subparsers.add_parser("drift-check")
    drift_parser.add_argument("--out", required=True)
    drift_parser.add_argument("--cases-dir", default=DEFAULT_CASES_DIR)

    args = parser.parse_args()
    if args.command == "run":
        raise SystemExit(_run(args))
    if args.command == "drift-check":
        raise SystemExit(_drift_check(args))


if __name__ == "__main__":
    main()
