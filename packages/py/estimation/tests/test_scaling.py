"""Tests for the problem-size scaling curve.

No built-in `ScalingLaw` ships in `majorana_estimation` (see the module
docstring: an n-dependence is an algorithmic fact this package will not
invent), so every fixture here is an explicit, labelled test formula — the
same convention `test_estimate.py`'s `a_set()` uses for a hand-built
`AssumptionSet` ("hypothetical, constructed by a test"), never dressed up as
a real paper's claim.
"""

from __future__ import annotations

import random

import pytest
from majorana_estimation import GIDNEY_2025, LogicalCost, choose_code_distance
from majorana_estimation.scaling import ScalingLaw, compute_scaling_curve

LINEAR_TOFFOLI_LAW = ScalingLaw(
    parameter_name="n",
    source="synthetic, constructed by this test: NOT a claim about any real algorithm",
    logical_cost=lambda n: LogicalCost(
        logical_qubits=4 + n,
        toffoli_count=100 * n,
        non_clifford_depth=100 * n,
        label=f"synthetic linear circuit at n={n}",
    ),
)


def test_a_scaling_law_must_cite_where_its_n_dependence_comes_from():
    with pytest.raises(ValueError, match="must cite"):
        ScalingLaw(
            parameter_name="n", source="", logical_cost=lambda n: LogicalCost(logical_qubits=n)
        )
    with pytest.raises(ValueError, match="must cite"):
        ScalingLaw(
            parameter_name="n", source="   ", logical_cost=lambda n: LogicalCost(logical_qubits=n)
        )


def test_a_scaling_law_must_be_named():
    with pytest.raises(ValueError, match="must name its problem parameter"):
        ScalingLaw(
            parameter_name="",
            source="a paper",
            logical_cost=lambda n: LogicalCost(logical_qubits=n),
        )


def test_domain_is_enforced_and_names_the_source_in_the_error():
    law = ScalingLaw(
        parameter_name="n",
        source="a test paper that states this formula only for even n",
        logical_cost=lambda n: LogicalCost(logical_qubits=4, toffoli_count=n),
        valid_n=lambda n: n % 2 == 0,
    )
    assert law.cost_at(4).toffoli_count == 4
    with pytest.raises(ValueError, match="a test paper that states this formula only for even n"):
        law.cost_at(3)


# --- the hand-checkable small case ------------------------------------------


def test_hand_checkable_scaling_curve_at_three_points():
    """n = 1, 2, 4 under gidney-2025, arithmetic re-derived independently."""
    curve = compute_scaling_curve(LINEAR_TOFFOLI_LAW, GIDNEY_2025, ns=[4, 1, 2], factory_count=1)

    # compute_scaling_curve sorts ascending regardless of input order.
    assert [p.n for p in curve.points] == [1, 2, 4]
    assert curve.assumption_set == GIDNEY_2025.identity

    for point in curve.points:
        n = point.n
        logical = LINEAR_TOFFOLI_LAW.cost_at(n)
        assert point.estimate.logical == logical
        # magic states: t_per_toffoli (8) per Toffoli, exactly as `estimate()` computes.
        assert point.estimate.runtime.magic_states == 100 * n * 8
        # distance re-derived directly from Layer 2, not from the curve.
        expected_distance = choose_code_distance(
            logical, GIDNEY_2025, target_failure_probability=0.01
        )
        assert point.estimate.distance.code_distance == expected_distance.code_distance

    # n=1 -> n=4 is a 4x increase in Toffolis and depth: strictly more physical
    # qubits, since both logical width and the spacetime volume grew.
    assert curve.points[0].total_physical_qubits < curve.points[-1].total_physical_qubits


def test_compute_scaling_curve_rejects_empty_or_duplicate_ns():
    with pytest.raises(ValueError, match="at least one value"):
        compute_scaling_curve(LINEAR_TOFFOLI_LAW, GIDNEY_2025, ns=[])
    with pytest.raises(ValueError, match="repeated n"):
        compute_scaling_curve(LINEAR_TOFFOLI_LAW, GIDNEY_2025, ns=[2, 2])


# --- the property: a componentwise non-decreasing law costs out non-decreasing ---


def _monotone_law(rng: random.Random, max_n: int) -> ScalingLaw:
    """A synthetic law whose logical_qubits, toffoli_count and
    non_clifford_depth are each non-decreasing step functions of n (n >= 1,
    the default domain), built from cumulative sums of non-negative random
    increments.
    """
    qubit_steps = [rng.randint(0, 5) for _ in range(max_n + 1)]
    toffoli_steps = [rng.randint(0, 50) for _ in range(max_n + 1)]
    depth_steps = [rng.randint(0, 50) for _ in range(max_n + 1)]

    def cumulative(steps: list[int], n: int) -> int:
        return sum(steps[:n])

    def cost(n: int) -> LogicalCost:
        toffoli = cumulative(toffoli_steps, n)
        depth = cumulative(depth_steps, n)
        # A circuit needs at least 1 logical qubit, and non_clifford_depth
        # must be 0 when there are no magic states (LogicalCost's own rule).
        return LogicalCost(
            logical_qubits=1 + cumulative(qubit_steps, n),
            toffoli_count=toffoli,
            non_clifford_depth=depth if toffoli > 0 else 0,
        )

    return ScalingLaw(
        parameter_name="n",
        source="synthetic, constructed by this test for the monotonicity property",
        logical_cost=cost,
    )


def test_a_componentwise_nondecreasing_law_produces_a_nondecreasing_footprint():
    """Randomised, fixed seed. Uses a FIXED `factory_count` deliberately:

    with `factory_count=None` the auto-selected crossover is itself a ratio
    of two quantities that both grow with n, and that ratio is not
    guaranteed monotonic — so the property under test here is specifically
    about the data/routing footprint's monotonicity, isolated by holding the
    factory choice constant across the curve (see `compute_scaling_curve`'s
    docstring on why the default does not do this).
    """
    rng = random.Random(20260921)
    for trial in range(20):
        law = _monotone_law(rng, max_n=10)
        curve = compute_scaling_curve(law, GIDNEY_2025, ns=range(1, 11), factory_count=4)
        qubit_counts = [p.total_physical_qubits for p in curve.points]
        for earlier, later in zip(qubit_counts, qubit_counts[1:]):
            assert later >= earlier, (
                f"trial {trial}: physical qubits decreased along a componentwise "
                f"non-decreasing scaling law: {qubit_counts}"
            )
