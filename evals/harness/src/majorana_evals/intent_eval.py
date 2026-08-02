"""Real-provider AUTO-routing eval, deliberately separate from execution scoring."""

from __future__ import annotations

import argparse
import asyncio
from collections import defaultdict
from pathlib import Path
from typing import Literal

from majorana_contracts.enums import RunMode
from majorana_llm import LLMClient, default_llm
from majorana_worker.intent import resolve_mode

from majorana_evals.intent_procedural import (
    INTENT_PROCEDURAL_VERSION,
    generate_procedural_intent_cases,
)
from majorana_evals.schema import (
    IntentCase,
    IntentCaseResult,
    IntentReport,
    load_intent_corpus,
)


def _load_intent_eval_cases(
    corpus: str,
    *,
    split: Literal["calibration", "holdout"] | None,
    procedural_seed: int | None,
    procedural_cases_per_family: int,
) -> list[IntentCase]:
    cases = load_intent_corpus(corpus, split=split)
    if procedural_cases_per_family:
        if procedural_seed is None:
            raise ValueError("procedural_seed is required for procedural intent cases")
        if split == "calibration":
            raise ValueError("procedural intent cases belong to the holdout split")
        cases.extend(
            generate_procedural_intent_cases(
                procedural_seed,
                cases_per_family=procedural_cases_per_family,
            )
        )
    elif procedural_seed is not None:
        raise ValueError("procedural_cases_per_family is required with procedural_seed")
    if len({case.id for case in cases}) != len(cases):
        raise ValueError("static and procedural intent case IDs must be unique")
    return cases


async def run_intent_corpus(
    cases: list[IntentCase],
    *,
    llm: LLMClient,
    note: str | None = None,
) -> IntentReport:
    """Classify sequentially so an evaluation cannot create a provider rate spike."""

    results: list[IntentCaseResult] = []
    for case in cases:
        decision = await resolve_mode(case.prompt, RunMode.AUTO, llm)
        observed = decision.resolved.value
        results.append(
            IntentCaseResult(
                id=case.id,
                split=case.split,
                cohort=case.cohort,
                expected_mode=case.expected_mode,
                observed_mode=observed,
                correct=observed == case.expected_mode,
                decision_source=decision.source,
                reason=decision.reason,
            )
        )

    cohort_counts: dict[str, dict[str, int]] = defaultdict(lambda: {"correct": 0, "total": 0})
    for result in results:
        cohort_counts[result.cohort]["total"] += 1
        cohort_counts[result.cohort]["correct"] += int(result.correct)
    correct = sum(result.correct for result in results)
    return IntentReport(
        total=len(results),
        correct=correct,
        accuracy=correct / len(results) if results else 0.0,
        by_cohort=dict(sorted(cohort_counts.items())),
        cases=results,
        note=note,
    )


async def _main(
    corpus: str,
    out: str,
    split: Literal["calibration", "holdout"] | None,
    procedural_seed: int | None = None,
    procedural_cases_per_family: int = 0,
) -> int:
    cases = _load_intent_eval_cases(
        corpus,
        split=split,
        procedural_seed=procedural_seed,
        procedural_cases_per_family=procedural_cases_per_family,
    )
    report = await run_intent_corpus(
        cases,
        llm=default_llm(),
        note=(
            f"real-provider AUTO routing eval (split={split or 'all'}, "
            f"procedural={INTENT_PROCEDURAL_VERSION if procedural_cases_per_family else 'none'}, "
            f"seed={procedural_seed if procedural_cases_per_family else 'none'}, "
            f"cases_per_family={procedural_cases_per_family})"
        ),
    )
    Path(out).write_text(report.model_dump_json(indent=2) + "\n")
    print(f"{report.correct}/{report.total} correct ({report.accuracy:.0%}) → {out}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="majorana_intent_eval")
    parser.add_argument("--corpus", default="evals/intent-corpus.yaml")
    parser.add_argument("--out", default="evals/intent-report.json")
    parser.add_argument("--split", choices=("calibration", "holdout"))
    parser.add_argument("--procedural-seed", type=int)
    parser.add_argument("--procedural-cases-per-family", type=int, default=0)
    args = parser.parse_args()
    if not 0 <= args.procedural_cases_per_family <= 20:
        parser.error("--procedural-cases-per-family must be between zero and twenty")
    if args.procedural_seed is not None and not 0 <= args.procedural_seed < 2**63:
        parser.error("--procedural-seed must be in 0..2**63-1")
    if args.procedural_cases_per_family and args.procedural_seed is None:
        parser.error("--procedural-seed is required when procedural cases are requested")
    if args.procedural_seed is not None and not args.procedural_cases_per_family:
        parser.error("--procedural-cases-per-family is required with --procedural-seed")
    if args.split == "calibration" and args.procedural_cases_per_family:
        parser.error("procedural intent cases belong to the holdout split")
    raise SystemExit(
        asyncio.run(
            _main(
                args.corpus,
                args.out,
                args.split,
                args.procedural_seed,
                args.procedural_cases_per_family,
            )
        )
    )


if __name__ == "__main__":
    main()
