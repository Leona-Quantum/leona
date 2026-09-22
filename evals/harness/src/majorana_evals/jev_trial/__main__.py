"""CLI for the Jev offline trial (ai-ops#358).

  # Zero-spend: the production finder's own ranking, as a baseline.
  uv run --package majorana-evals python -m majorana_evals.jev_trial run \\
      --ranker current-finder --out /tmp/jev-trial-finder.json

  # Zero-spend controls (see controls.py):
  uv run --package majorana-evals python -m majorana_evals.jev_trial run \\
      --ranker oracle   --out /tmp/jev-trial-oracle.json
  uv run --package majorana-evals python -m majorana_evals.jev_trial run \\
      --ranker random   --out /tmp/jev-trial-random.json
  uv run --package majorana-evals python -m majorana_evals.jev_trial run \\
      --ranker stub-jev --out /tmp/jev-trial-stub-jev.json
  uv run --package majorana-evals python -m majorana_evals.jev_trial run \\
      --ranker lexical  --out /tmp/jev-trial-lexical.json

  # A REAL run — spends a fraction of a cent (18 cases, ~1-2k input tokens each at
  # $42/billion input tokens; output is unbilled per typesafe.ai's own pricing page)
  # but is still a real call to a third party with the case's problem-statement text
  # as Input. Needs TYPESAFE_API_KEY in the environment (see jev_client.py) — the
  # operator loads it from ~/Developer/projects/leona-secrets/llm-keys.txt. This
  # harness refuses outright, before any network attempt, if the key is absent.
  uv run --package majorana-evals python -m majorana_evals.jev_trial run \\
      --ranker live-jev --out evals/report-jev-trial-live-<date>.json \\
      --markdown-out evals/report-jev-trial-live-<date>.md

No DATABASE_URL, no sandbox, no worker pipeline — see runner.py's docstring."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from majorana_evals.jev_trial.controls import (
    LexicalOverlapRanker,
    OracleRanker,
    RandomRanker,
    StubJevClient,
)
from majorana_evals.jev_trial.curated_cases import load_curated_cases
from majorana_evals.jev_trial.jev_client import JevClient, JevKeyMissing, require_api_key
from majorana_evals.jev_trial.live_jev import LiveJevRanker
from majorana_evals.jev_trial.runner import run_jev_trial
from majorana_evals.jev_trial.schema import JevTrialReport


def _write_markdown_summary(report: JevTrialReport, path: Path) -> None:
    lines = [
        f"# Jev offline trial — {report.ranker}",
        "",
        f"- cases: {report.total_cases}",
        f"- corpus size: {report.corpus_size}",
        f"- theoretical chance top-1 rate (reference, any ranker): {report.theoretical_chance_top1_rate:.1%}",
        f"- top-1 hit rate: {report.top1_hit_rate:.1%}",
        f"- top-3 hit rate: {report.top3_hit_rate:.1%}",
        f"- MRR: {report.mrr:.3f}",
        f"- Brier score: {report.brier_score:.3f}"
        if report.brier_score is not None
        else "- Brier score: n/a (this ranker reports no confidence)",
        f"- billed input tokens: {report.total_input_tokens} "
        f"(about ${report.total_input_tokens * 42 / 1e9:.6f} at $42 per billion)"
        if report.total_input_tokens is not None
        else "- billed input tokens: none (zero-spend ranker)",
        f"- pipeline commit: `{report.pipeline_commit_sha or 'unknown'}`",
        f"- curated cases sha256: `{report.curated_cases_sha256}`",
    ]
    if report.reliability_bins:
        lines += ["", "## Reliability bins (confidence vs. empirical hit rate)", ""]
        lines.append("| range | n | mean confidence | empirical hit rate |")
        lines.append("|---|---|---|---|")
        for b in report.reliability_bins:
            conf = f"{b.mean_confidence:.2f}" if b.mean_confidence is not None else "-"
            hit = f"{b.empirical_hit_rate:.2f}" if b.empirical_hit_rate is not None else "-"
            lines.append(f"| [{b.lower:.1f}, {b.upper:.1f}) | {b.count} | {conf} | {hit} |")
    misses = [c for c in report.cases if not c.top1_hit]
    if misses:
        lines += ["", "## Cases that missed top-1", ""]
        for c in misses:
            lines.append(f"- `{c.case_id}`: ranked {c.ranked_slugs[:3]}...")
    if report.note:
        lines += ["", f"note: {report.note}"]
    path.write_text("\n".join(lines) + "\n")


def _build_ranker(name: str):
    if name == "current-finder":
        return None  # runner.py special-cases this: no separate ranker object needed
    if name == "oracle":
        return OracleRanker()
    if name == "random":
        return RandomRanker()
    if name == "stub-jev":
        return StubJevClient()
    if name == "lexical":
        return LexicalOverlapRanker()
    if name == "live-jev":
        api_key = require_api_key(os.environ)  # raises JevKeyMissing if absent
        return LiveJevRanker(JevClient(api_key=api_key))
    raise ValueError(f"unknown ranker {name!r}")


def _run(args: argparse.Namespace) -> int:
    cases, digest = load_curated_cases()
    if args.limit is not None:
        cases = cases[: args.limit]

    try:
        ranker = _build_ranker(args.ranker)
    except JevKeyMissing as exc:
        print(f"REFUSING to run --ranker live-jev: {exc}")
        return 2

    note = {
        "current-finder": "the production finder's own ranking (satisfied-count + tie-break; no confidence)",
        "oracle": "zero-spend positive control — expected: 100% on every metric",
        "random": "zero-spend negative control — expected: near chance",
        "stub-jev": "zero-spend wiring test — canned response in Jev's real envelope shape, NOT a quality measurement",
        "lexical": "zero-spend control — TF-IDF word overlap on the same text Jev is sent; the bar Jev must clear to show more than keyword matching",
        "live-jev": "LIVE run: spent real TypeSafe AI tokens",
    }[args.ranker]

    report = run_jev_trial(
        cases, curated_cases_sha256=digest, ranker=ranker, ranker_name=args.ranker, note=note
    )

    out_path = Path(args.out)
    out_path.write_text(report.model_dump_json(indent=2) + "\n")
    if args.markdown_out:
        _write_markdown_summary(report, Path(args.markdown_out))
    brier_part = f" brier={report.brier_score:.3f}" if report.brier_score is not None else ""
    print(
        f"[{args.ranker}] top1={report.top1_hit_rate:.0%} top3={report.top3_hit_rate:.0%} "
        f"mrr={report.mrr:.3f}{brier_part}"
    )
    print(f"-> {out_path}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="majorana_evals.jev_trial")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument(
        "--ranker",
        choices=["current-finder", "oracle", "random", "stub-jev", "lexical", "live-jev"],
        required=True,
    )
    run_parser.add_argument("--out", required=True)
    run_parser.add_argument("--markdown-out", default=None)
    run_parser.add_argument("--limit", type=int, default=None)

    args = parser.parse_args()
    if args.command == "run":
        raise SystemExit(_run(args))


if __name__ == "__main__":
    main()
