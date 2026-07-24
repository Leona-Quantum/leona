"""comparison dimension model (plan Part III §14). classify_comparison() is
an MVP heuristic (see comparison.py docstring) -- these tests check its own
internal logical consistency, not that it matches real published VQE papers'
judgments (that is Phase 2/4's human-curated job)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from majorana_vqe.comparison import (
    ComparisonClassification,
    ComparisonDimension,
    ComparisonDimensionName,
    ComparisonDimensionStatus,
    ComparisonResult,
    classify_comparison,
)

ALL_FIXED = [
    ComparisonDimension(name=name, status=ComparisonDimensionStatus.FIXED)
    for name in ComparisonDimensionName
]


def _with_status(name: ComparisonDimensionName, status: ComparisonDimensionStatus):
    return [
        ComparisonDimension(name=n, status=status if n is name else ComparisonDimensionStatus.FIXED)
        for n in ComparisonDimensionName
    ]


class TestClassifyComparison:
    def test_all_fixed_is_strict(self):
        assert classify_comparison(ALL_FIXED) is ComparisonClassification.STRICT

    def test_changed_problem_digest_is_invalid(self):
        dims = _with_status(
            ComparisonDimensionName.PROBLEM_DIGEST, ComparisonDimensionStatus.CHANGED
        )
        assert classify_comparison(dims) is ComparisonClassification.INVALID

    def test_changed_hamiltonian_equivalence_is_invalid(self):
        dims = _with_status(
            ComparisonDimensionName.HAMILTONIAN_DIGEST_OR_EQUIVALENCE,
            ComparisonDimensionStatus.CHANGED,
        )
        assert classify_comparison(dims) is ComparisonClassification.INVALID

    def test_unknown_never_upgrades_to_strict(self):
        dims = _with_status(ComparisonDimensionName.SEED, ComparisonDimensionStatus.UNKNOWN)
        assert classify_comparison(dims) is ComparisonClassification.PARTIAL

    def test_changed_non_blocking_dimension_is_controlled(self):
        dims = _with_status(
            ComparisonDimensionName.OPTIMIZER_CONFIGURATION, ComparisonDimensionStatus.CHANGED
        )
        assert classify_comparison(dims) is ComparisonClassification.CONTROLLED

    def test_unknown_takes_priority_over_non_blocking_changed(self):
        dims = [
            ComparisonDimension(
                name=ComparisonDimensionName.OPTIMIZER_CONFIGURATION,
                status=ComparisonDimensionStatus.CHANGED,
            ),
            ComparisonDimension(
                name=ComparisonDimensionName.SEED, status=ComparisonDimensionStatus.UNKNOWN
            ),
        ] + [
            ComparisonDimension(name=n, status=ComparisonDimensionStatus.FIXED)
            for n in ComparisonDimensionName
            if n
            not in (ComparisonDimensionName.OPTIMIZER_CONFIGURATION, ComparisonDimensionName.SEED)
        ]
        assert classify_comparison(dims) is ComparisonClassification.PARTIAL

    def test_invalid_takes_priority_over_unknown(self):
        dims = [
            ComparisonDimension(
                name=ComparisonDimensionName.PROBLEM_DIGEST,
                status=ComparisonDimensionStatus.CHANGED,
            ),
            ComparisonDimension(
                name=ComparisonDimensionName.SEED, status=ComparisonDimensionStatus.UNKNOWN
            ),
        ] + [
            ComparisonDimension(name=n, status=ComparisonDimensionStatus.FIXED)
            for n in ComparisonDimensionName
            if n not in (ComparisonDimensionName.PROBLEM_DIGEST, ComparisonDimensionName.SEED)
        ]
        assert classify_comparison(dims) is ComparisonClassification.INVALID


class TestComparisonResultCompleteness:
    def test_requires_every_fixed_dimension_present(self):
        incomplete = ALL_FIXED[:-1]
        with pytest.raises(ValidationError):
            ComparisonResult(dimensions=incomplete, classification=ComparisonClassification.STRICT)

    def test_rejects_duplicate_dimension_name(self):
        dup = ALL_FIXED + [ALL_FIXED[0]]
        with pytest.raises(ValidationError):
            ComparisonResult(dimensions=dup, classification=ComparisonClassification.STRICT)

    def test_accepts_a_complete_result(self):
        result = ComparisonResult(
            dimensions=ALL_FIXED, classification=ComparisonClassification.STRICT
        )
        assert result.classification is ComparisonClassification.STRICT

    def test_detail_rejects_path_like_content(self):
        with pytest.raises(ValidationError):
            ComparisonDimension(
                name=ComparisonDimensionName.SEED,
                status=ComparisonDimensionStatus.UNKNOWN,
                detail="../not/a/label",
            )
