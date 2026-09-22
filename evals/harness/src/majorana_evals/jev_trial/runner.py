"""Orchestrates one Jev-trial run: load curated cases, get the real finder's ranking
for every case in one Node subprocess call, get a ranker's (control's, stub's, or
Jev's) answer for each, score both, and build the report.

No database, no worker pipeline, no product code path — this only reads
`curated-cases.yaml` and shells out to `finder-rank.mts` (see that module's own
docstring for why it must be a bridge, not a reimplementation)."""

from __future__ import annotations

import subprocess
from datetime import datetime, timezone
from pathlib import Path

from majorana_evals.jev_trial.finder_bridge import rank_via_finder
from majorana_evals.jev_trial.metrics import (
    brier_score,
    mrr,
    reliability_bins,
    score_case,
    theoretical_chance_top1_rate,
    top_k_hit_rate,
)
from majorana_evals.jev_trial.schema import CaseScore, CuratedCase, JevTrialReport, RankerName


def _pipeline_commit_sha() -> str | None:
    try:
        completed = subprocess.run(
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


def run_jev_trial(
    cases: list[CuratedCase],
    *,
    curated_cases_sha256: str,
    ranker,
    ranker_name: RankerName,
    note: str | None = None,
) -> JevTrialReport:
    corpus_size, finder_rankings = rank_via_finder(cases)

    case_scores: list[CaseScore] = []
    confidence_pairs: list[tuple[float, bool]] = []

    for case in cases:
        pool = finder_rankings[case.id]
        if ranker_name == "current-finder":
            ranked_slugs = [c.slug for c in pool.ranked]
            confidence = None
        else:
            answer = ranker.rank(case, pool)
            ranked_slugs = answer.ranked_slugs
            confidence = answer.confidence

        score = score_case(case, pool, ranker_name, ranked_slugs, confidence)
        case_scores.append(score)
        if score.top1_confidence is not None and score.top1_correct is not None:
            confidence_pairs.append((score.top1_confidence, score.top1_correct))

    pool_sizes = {case_id: ranking.pool_size for case_id, ranking in finder_rankings.items()}

    return JevTrialReport(
        ranker=ranker_name,
        generated_at=datetime.now(timezone.utc).isoformat(),
        pipeline_commit_sha=_pipeline_commit_sha(),
        curated_cases_sha256=curated_cases_sha256,
        corpus_size=corpus_size,
        total_cases=len(cases),
        theoretical_chance_top1_rate=theoretical_chance_top1_rate(cases, pool_sizes),
        top1_hit_rate=top_k_hit_rate(case_scores, k=1),
        top3_hit_rate=top_k_hit_rate(case_scores, k=3),
        mrr=mrr(case_scores),
        brier_score=brier_score(confidence_pairs) if confidence_pairs else None,
        reliability_bins=reliability_bins(confidence_pairs) if confidence_pairs else [],
        cases=case_scores,
        note=note,
    )
