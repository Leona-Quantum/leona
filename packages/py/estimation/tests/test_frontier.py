"""Tests for the qubits-vs-runtime Pareto frontier.

`test_the_frontier_never_contains_a_dominated_point` is the load-bearing one
for the no-dominated-point property: it is a randomised sweep over synthetic
points (not real estimates), so it is checking `pareto_frontier`'s logic
directly rather than hoping the estimator's own monotonicity happens to hide
a bug in the filter.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

import pytest
from majorana_estimation import COMPOSED_TRAPPED_ION, GIDNEY_2025, LogicalCost
from majorana_estimation.frontier import (
    compute_frontier,
    pareto_frontier,
    sweep_estimates,
)

TINY = LogicalCost(logical_qubits=4, toffoli_count=100, non_clifford_depth=100)
CLIFFORD_ONLY = LogicalCost(logical_qubits=6)


# --- the hand-checkable small case ------------------------------------------


def test_hand_checkable_three_point_frontier():
    """Three factory counts under one set, arithmetic checked against `estimate` directly.

    Below the crossover, doubling `factory_count` exactly halves the
    throughput term (see `test_below_the_crossover...` in test_estimate.py) —
    so factory_count=1 and factory_count=2 are two distinct, non-dominated
    points: 2 costs more qubits and less time than 1. At the crossover the
    reaction floor binds, which is the cheapest runtime this set states for
    this circuit; past it, more factories change nothing but the footprint.
    """
    crossover = sweep_estimates(TINY, assumption_sets=[GIDNEY_2025], factory_counts=(1,))[
        0
    ].estimate.runtime.factory_crossover
    assert crossover is not None and crossover > 2, "fixture needs a real crossover to test around"

    counts = (1, 2, crossover, crossover * 10)
    points = sweep_estimates(TINY, assumption_sets=[GIDNEY_2025], factory_counts=counts)
    by_count = {p.factory_count: p for p in points}

    # Hand-check the monotonicity the frontier logic relies on.
    assert by_count[1].total_physical_qubits < by_count[2].total_physical_qubits
    assert by_count[1].runtime_seconds == pytest.approx(2 * by_count[2].runtime_seconds)
    assert by_count[crossover].runtime_seconds < by_count[2].runtime_seconds
    assert (
        by_count[crossover * 10].total_physical_qubits > by_count[crossover].total_physical_qubits
    )
    # Past the crossover the reaction floor binds for both, so runtime does
    # not move — this is exactly what makes crossover*10 dominated.
    assert by_count[crossover * 10].runtime_seconds == pytest.approx(
        by_count[crossover].runtime_seconds
    )

    frontier = pareto_frontier(points)
    kept_counts = {p.factory_count for p in frontier}
    assert kept_counts == {1, 2, crossover}, (
        "crossover*10 is dominated by crossover and must be dropped"
    )
    # Sorted by qubits ascending, which is also runtime descending here.
    assert [p.factory_count for p in frontier] == [1, 2, crossover]


def test_compute_frontier_excludes_the_dominated_point_end_to_end():
    result = compute_frontier(TINY, assumption_sets=[GIDNEY_2025], factory_counts=(1, 2, 4, 4000))
    counts = sorted(p.factory_count for p in result.points)
    assert 4000 not in counts or all(
        p.runtime_seconds
        < min(q.runtime_seconds for q in result.points if q.factory_count != p.factory_count)
        for p in result.points
        if p.factory_count == 4000
    ), "a factory count far past the crossover must not survive unless it is still strictly fastest"
    assert result.considered == 4


# --- across assumption sets, still labelled ---------------------------------


def test_frontier_across_assumption_sets_labels_every_point():
    """Azure-style: points from two hardware sets on one frontier, each named."""
    result = compute_frontier(
        TINY,
        assumption_sets=[GIDNEY_2025, COMPOSED_TRAPPED_ION],
        factory_counts=(1,),
    )
    identities = {p.assumption_set for p in result.points}
    # Both sets contribute at least one non-dominated point at factory_count=1
    # (gidney is faster per qubit spent; trapped-ion is not dominated on
    # qubits alone at this single sample), and every point states which.
    assert identities <= {GIDNEY_2025.identity, COMPOSED_TRAPPED_ION.identity}
    assert identities, "the frontier must not be empty"
    for p in result.points:
        assert p.estimate.assumption_set == p.assumption_set


def test_clifford_only_circuit_has_no_runtime_axis_to_rank_on():
    result = compute_frontier(CLIFFORD_ONLY, assumption_sets=[GIDNEY_2025])
    assert result.points == ()
    assert len(result.excluded_unstated_runtime) == 1
    assert result.excluded_unstated_runtime[0].runtime_seconds is None


def test_pareto_frontier_refuses_a_point_with_unstated_runtime():
    points = sweep_estimates(CLIFFORD_ONLY, assumption_sets=[GIDNEY_2025])
    with pytest.raises(ValueError, match="unstated runtime"):
        pareto_frontier(points)


# --- the general property: no returned point dominates another ------------


@dataclass(frozen=True)
class _SyntheticPoint:
    """Duck-types `FrontierPoint`'s two ranked fields plus the label field
    `pareto_frontier`'s error message reads, without going through the
    estimator — the property under test is about the filter, not physics."""

    total_physical_qubits: int
    runtime_seconds: float
    assumption_set: str = "synthetic"


def _is_dominated(candidate: _SyntheticPoint, by: _SyntheticPoint) -> bool:
    not_worse = (
        by.total_physical_qubits <= candidate.total_physical_qubits
        and by.runtime_seconds <= candidate.runtime_seconds
    )
    strictly_better = (
        by.total_physical_qubits < candidate.total_physical_qubits
        or by.runtime_seconds < candidate.runtime_seconds
    )
    return not_worse and strictly_better


def test_the_frontier_never_contains_a_dominated_point():
    """Randomised sweep, fixed seed for reproducibility.

    Checks three invariants against 200 synthetic points with duplicates and
    ties deliberately included (the `% 7` and `% 11` moduli manufacture
    repeats): soundness (every kept point was in the input), the
    no-dominated-point property this test is named for, and completeness
    (every dropped point really was dominated by something kept — so the
    filter is not simply too aggressive).
    """
    rng = random.Random(20260921)
    points = tuple(
        _SyntheticPoint(
            total_physical_qubits=rng.randint(1, 50) % 7 + 1,
            runtime_seconds=float(rng.randint(1, 50) % 11 + 1),
        )
        for _ in range(200)
    )

    frontier = pareto_frontier(points)  # type: ignore[arg-type]  # duck-typed on purpose

    frontier_set = set(frontier)
    assert frontier_set <= set(points), "the frontier must only contain points that were swept"
    assert frontier, "a non-empty sweep must produce a non-empty frontier"

    for kept in frontier:
        for other in frontier:
            if kept is other:
                continue
            assert not _is_dominated(kept, by=other), (
                f"{kept} is dominated by {other} but both are in the frontier"
            )

    for dropped in points:
        if dropped in frontier_set:
            continue
        assert any(_is_dominated(dropped, by=kept) for kept in frontier), (
            f"{dropped} was dropped but nothing in the frontier dominates it"
        )


def test_sweep_estimates_rejects_an_empty_assumption_set_list():
    with pytest.raises(ValueError, match="at least one assumption set"):
        sweep_estimates(TINY, assumption_sets=[])


def test_sweep_estimates_rejects_an_empty_failure_probability_list():
    with pytest.raises(ValueError, match="at least one target_failure_probability"):
        sweep_estimates(TINY, target_failure_probabilities=())


def test_sample_factory_counts_always_brackets_the_crossover():
    from majorana_estimation.frontier import _sample_factory_counts

    for crossover in (1, 2, 12, 13, 1000, 155_280):
        samples = _sample_factory_counts(crossover)
        assert samples[0] == 1
        assert samples[-1] == crossover
        assert samples == tuple(sorted(set(samples))), "must be sorted and deduplicated"
        assert all(1 <= s <= crossover for s in samples)
        assert len(samples) <= 12


def test_default_sweep_samples_rather_than_visits_every_factory_count():
    """A huge crossover must not make the default sweep explode.

    Uses the trapped-ion set specifically because `docs/estimation/assumption-sets.md`
    records a 155,280-factory crossover for a small circuit under it — the
    exact case `_sample_factory_counts` exists for.
    """
    points = sweep_estimates(TINY, assumption_sets=[COMPOSED_TRAPPED_ION])
    assert len(points) <= 12
