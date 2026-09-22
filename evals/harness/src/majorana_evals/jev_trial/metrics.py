"""Scoring for the Jev trial: top-1/top-3 hit rate, MRR, and (for a ranker that
reports a probability/confidence) Brier score + reliability bins.

## Why top-k hit rate + MRR, not NDCG

`CuratedCase.expected_slugs` is a BINARY relevance set: a candidate is either one of
the catalog's own answers for a case, or it is not (see
`evals/jev-trial/DERIVATION.md`). Nothing in the corpus states a graded relevance
(e.g. "this method is a 7/10 fit") for any record — inventing one to feed NDCG's
graded-gain formula would be exactly the fabrication this repo's corpus code
consistently refuses to do (see finder.ts's own module header on the same point,
applied to a different field). MRR and top-k hit rate need only the binary set this
harness actually has, and both have a direct, arguably more legible reading for a
"did we surface the right answer near the top" question than a graded-gain metric
would add here.

## Why Brier score, not log loss, for calibration

Log loss is undefined (infinite) the moment a confident prediction is wrong — which
a random or poorly-calibrated ranker will produce routinely on a small case set, and
an infinite aggregate is not a useful summary. Brier score (mean squared error
between confidence and outcome) stays bounded on `[0, 1]` regardless, and is the
metric named directly in the task brief."""

from __future__ import annotations

from majorana_evals.jev_trial.schema import CaseScore, CuratedCase, FinderRanking, ReliabilityBin


def top_k_hit(ranked_slugs: list[str], expected_slugs: list[str], k: int) -> bool:
    expected = set(expected_slugs)
    return any(slug in expected for slug in ranked_slugs[:k])


def reciprocal_rank(ranked_slugs: list[str], expected_slugs: list[str]) -> float:
    expected = set(expected_slugs)
    for i, slug in enumerate(ranked_slugs, start=1):
        if slug in expected:
            return 1.0 / i
    return 0.0


def score_case(
    case: CuratedCase,
    pool: FinderRanking,
    ranker_name: str,
    ranked_slugs: list[str],
    confidence: float | None,
) -> CaseScore:
    """Pure scoring — no I/O. `ranked_slugs` must be a permutation of `pool`'s
    candidate slugs (not asserted here; `runner.py`'s caller is expected to pass
    exactly what a ranker returned)."""

    top1 = top_k_hit(ranked_slugs, case.expected_slugs, 1)
    top3 = top_k_hit(ranked_slugs, case.expected_slugs, 3)
    rr = reciprocal_rank(ranked_slugs, case.expected_slugs)
    top1_correct = (ranked_slugs[0] in set(case.expected_slugs)) if ranked_slugs else False
    return CaseScore(
        case_id=case.id,
        ranker=ranker_name,  # type: ignore[arg-type]
        ranked_slugs=ranked_slugs,
        top1_hit=top1,
        top3_hit=top3,
        reciprocal_rank=rr,
        top1_confidence=confidence,
        top1_correct=top1_correct if confidence is not None else None,
    )


def mrr(scores: list[CaseScore]) -> float:
    if not scores:
        return 0.0
    return sum(s.reciprocal_rank for s in scores) / len(scores)


def top_k_hit_rate(scores: list[CaseScore], *, k: int) -> float:
    if not scores:
        return 0.0
    hits = sum(1 for s in scores if (s.top1_hit if k == 1 else s.top3_hit))
    return hits / len(scores)


def brier_score(pairs: list[tuple[float, bool]]) -> float | None:
    """`pairs` = (confidence, was_correct) for every case's TOP pick. None when no
    ranker in this run reports confidence (the current finder — see
    `RankedAnswer.confidence`'s docstring)."""

    if not pairs:
        return None
    return sum((p - (1.0 if correct else 0.0)) ** 2 for p, correct in pairs) / len(pairs)


def theoretical_chance_top1_rate(cases: list[CuratedCase], pool_sizes: dict[str, int]) -> float:
    """mean(|expected_slugs| / pool_size) across `cases` — the top-1 hit rate a
    ranker with NO information (a uniform-random permutation) would score IN
    EXPECTATION over infinitely many draws.

    A single seeded `RandomRanker` run (`controls.py`) is exactly ONE such draw, and
    at n=18 heterogeneous cases its sampling variance is large — an empirical draw of
    35-40% against a ~26%-ish theoretical mean is ordinary variance, not evidence the
    control is broken or biased. This function gives the number to compare the draw
    against, rather than leaving a reader to eyeball "near chance.\""""

    if not cases:
        return 0.0
    rates = [len(set(case.expected_slugs)) / pool_sizes[case.id] for case in cases]
    return sum(rates) / len(rates)


def reliability_bins(pairs: list[tuple[float, bool]], n_bins: int = 5) -> list[ReliabilityBin]:
    """Buckets `pairs` into `n_bins` equal-width confidence bins over [0, 1] and
    reports, per non-empty bin, the mean predicted confidence vs. the empirical hit
    rate — a well-calibrated ranker has the two close in every bin; this trial's
    controls are used to sanity-check the metric itself (see the PR body / README
    for the mutation-check: breaking this function's bin boundary and confirming the
    oracle's single bin moves)."""

    width = 1.0 / n_bins
    bins: list[ReliabilityBin] = []
    for i in range(n_bins):
        lower, upper = i * width, (i + 1) * width
        in_bin = [
            (p, correct)
            for p, correct in pairs
            if (lower <= p < upper) or (i == n_bins - 1 and p == 1.0)
        ]
        if not in_bin:
            bins.append(ReliabilityBin(lower=lower, upper=upper, count=0))
            continue
        mean_conf = sum(p for p, _ in in_bin) / len(in_bin)
        hit_rate = sum(1 for _, correct in in_bin if correct) / len(in_bin)
        bins.append(
            ReliabilityBin(
                lower=lower,
                upper=upper,
                count=len(in_bin),
                mean_confidence=mean_conf,
                empirical_hit_rate=hit_rate,
            )
        )
    return bins
