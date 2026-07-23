"""Score provider-free Verification v2 routing observations.

The corpus contains expectations only. Callers must supply observations produced by
tests or an actual run; absence is a failed case, never an inferred PASS.
"""

from __future__ import annotations

from majorana_contracts.enums import VerifierDecision

from majorana_evals.schema import (
    RoutingCaseResult,
    RoutingMetrics,
    RoutingOutcome,
    RoutingReport,
    SeededCase,
)


_FIELDS = (
    "decision",
    "semantic_review_decision",
    "failure_class",
    "retry_target",
    "candidate_revisions_consumed",
    "evidence_strength",
    "materialized",
    "public_eligible",
    "verdict_preserved",
    "readable",
)


def _ratio(matches: int, total: int) -> float:
    return matches / total if total else 0.0


def score_seeded_corpus(
    cases: list[SeededCase], observations: dict[str, RoutingOutcome]
) -> RoutingReport:
    """Compare independently observed outcomes with the seeded expectations."""

    results: list[RoutingCaseResult] = []
    for case in cases:
        observed = observations.get(case.id)
        mismatches: list[str] = []
        if observed is None:
            mismatches.append("observation missing")
        else:
            for field in _FIELDS:
                expected_value = getattr(case.expected, field)
                observed_value = getattr(observed, field)
                if observed_value != expected_value:
                    mismatches.append(
                        f"{field}: observed {observed_value!r} != expected {expected_value!r}"
                    )
        results.append(
            RoutingCaseResult(
                id=case.id,
                passed=not mismatches,
                mismatches=mismatches,
                expected=case.expected,
                observed=observed,
            )
        )

    paired = [(case.expected, observations[case.id]) for case in cases if case.id in observations]
    total = len(cases)

    def accuracy(field: str) -> float:
        return _ratio(
            sum(
                getattr(expected, field) == getattr(observed, field)
                for expected, observed in paired
            ),
            total,
        )

    expected_pass = [pair for pair in paired if pair[0].decision is VerifierDecision.PASS]
    expected_not_pass = [pair for pair in paired if pair[0].decision is not VerifierDecision.PASS]
    expected_inconclusive = [
        pair for pair in paired if pair[0].decision is VerifierDecision.INCONCLUSIVE
    ]
    metrics = RoutingMetrics(
        decision_accuracy=accuracy("decision"),
        semantic_review_accuracy=accuracy("semantic_review_decision"),
        failure_class_accuracy=accuracy("failure_class"),
        retry_target_accuracy=accuracy("retry_target"),
        candidate_revision_accuracy=accuracy("candidate_revisions_consumed"),
        candidate_revisions_consumed=sum(
            observed.candidate_revisions_consumed for _, observed in paired
        ),
        false_negative_rate=_ratio(
            sum(observed.decision is not VerifierDecision.PASS for _, observed in expected_pass),
            len(expected_pass),
        ),
        false_positive_rate=_ratio(
            sum(observed.decision is VerifierDecision.PASS for _, observed in expected_not_pass),
            len(expected_not_pass),
        ),
        inconclusive_calibration=_ratio(
            sum(
                observed.decision is VerifierDecision.INCONCLUSIVE
                for _, observed in expected_inconclusive
            ),
            len(expected_inconclusive),
        ),
        evidence_strength_honesty=accuracy("evidence_strength"),
        materialization_behavior_accuracy=accuracy("materialized"),
        publication_behavior_accuracy=accuracy("public_eligible"),
        verdict_preservation_accuracy=accuracy("verdict_preserved"),
        replay_readability_accuracy=accuracy("readable"),
    )
    passed = sum(result.passed for result in results)
    return RoutingReport(
        total=total,
        passed=passed,
        pass_rate=_ratio(passed, total),
        missing_observations=[case.id for case in cases if case.id not in observations],
        metrics=metrics,
        cases=results,
    )
