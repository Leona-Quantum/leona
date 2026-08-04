"""Tests for the four-layer estimator.

The load-bearing one is `test_femoco_reproduces_the_plans_arithmetic`: it
recomputes the plan's headline numbers from the raw constants *inside the test*
rather than calling the estimator twice, so agreement is evidence and not a
tautology.
"""

from __future__ import annotations

import math

import pytest
from majorana_estimation import (
    BABBUSH_QUADRATIC_ORACLE_OPERATION_BOUND,
    GIDNEY_2025,
    AdvantageStatus,
    AssumptionSet,
    LogicalCost,
    SpeedupClass,
    assess_advantage,
    choose_code_distance,
    estimate,
)

# Lee et al. 2021, tensor hypercontraction: the smallest well-costed FTQC
# chemistry target. ~2,100 logical qubits and ~6e9 Toffolis.
FEMOCO = LogicalCost(
    logical_qubits=2_100,
    toffoli_count=6_000_000_000,
    non_clifford_depth=6_000_000_000,
    label="FeMoco ground state (Lee et al. 2021)",
)


def test_an_assumption_set_refuses_to_exist_above_threshold():
    # Above threshold, more distance makes things worse. A returned distance
    # would look like an answer, so the set itself must refuse.
    with pytest.raises(ValueError, match="does not converge"):
        AssumptionSet(
            name="broken",
            version=1,
            citation="none",
            physical_error_rate=2e-2,
            threshold=1e-2,
            logical_error_prefactor=0.1,
            routing_factor=2.0,
            factory_footprint_logical=15.0,
            cycle_time_s=1e-6,
            reaction_time_s=10e-6,
            factory_cycles_per_state=11,
            t_per_toffoli=4,
        )


def test_estimates_under_different_assumption_sets_are_not_comparable():
    other = AssumptionSet(
        name="gidney-2025",
        version=2,  # same name, bumped version
        citation=GIDNEY_2025.citation,
        physical_error_rate=1e-3,
        threshold=1e-2,
        logical_error_prefactor=0.1,
        routing_factor=2.0,
        factory_footprint_logical=15.0,
        cycle_time_s=1e-6,
        reaction_time_s=10e-6,
        factory_cycles_per_state=11,
        t_per_toffoli=4,
    )
    # Every number is identical; only the version differs. Still not comparable:
    # a version is a separate claim about hardware, and one can be revised.
    assert not GIDNEY_2025.comparable_with(other)
    assert not estimate(FEMOCO, GIDNEY_2025).comparable_with(estimate(FEMOCO, other))
    assert estimate(FEMOCO, GIDNEY_2025).assumption_set == "gidney-2025@v1"


def test_chosen_distance_actually_clears_the_target_and_is_the_smallest_that_does():
    choice = choose_code_distance(FEMOCO, GIDNEY_2025, target_failure_probability=0.01)

    assert choice.code_distance % 2 == 1
    assert choice.achieved_error_per_operation <= choice.required_error_per_operation
    # Recomputed here from the raw form rather than from the estimator, so this
    # checks the suppression law and not just internal consistency.
    ratio = GIDNEY_2025.physical_error_rate / GIDNEY_2025.threshold
    below = choice.code_distance - 2
    assert (
        GIDNEY_2025.logical_error_prefactor * ratio ** ((below + 1) // 2)
        > choice.required_error_per_operation
    ), "a smaller distance would also have cleared the target"
    assert choice.physical_per_logical == (
        choice.code_distance**2 + (choice.code_distance - 1) ** 2
    )


def test_femoco_reproduces_the_plans_arithmetic():
    """The plan's §1 headline, recomputed from constants inside this test."""
    result = estimate(FEMOCO, GIDNEY_2025)

    # --- magic states: 6e9 Toffoli at 4 states each
    assert result.runtime.magic_states == 24_000_000_000

    # --- the reaction-limited floor: ~17 hours, and no factory count beats it
    assert result.runtime.reaction_limited_seconds == pytest.approx(6.0e4)
    assert result.runtime.reaction_limited_seconds / 3600 == pytest.approx(16.67, abs=0.01)

    # --- the crossover, computed here from the rate rather than read back.
    # Note 11 cycles/state at 1 us gives 90,909 states/s, not the round 1e5 the
    # plan's prose first used; that rounding is why the crossover is five and
    # not four, and why this is computed rather than quoted.
    rate = 1.0 / (11 * 1e-6)
    assert rate == pytest.approx(90_909.09, abs=0.01)
    expected_crossover = math.ceil(24_000_000_000 / (rate * 6.0e4))
    assert result.runtime.factory_crossover == expected_crossover == 5

    # --- one factory alone: about three days
    one_factory = estimate(FEMOCO, GIDNEY_2025, factory_count=1)
    assert one_factory.runtime.seconds / 86_400 == pytest.approx(3.06, abs=0.01)

    # --- at the crossover the reaction floor has taken over
    assert result.runtime.binding_term == "reaction"
    assert result.runtime.throughput_seconds <= result.runtime.reaction_limited_seconds

    # --- footprint: data patches are logical x (d^2 + (d-1)^2)
    per_logical = result.distance.physical_per_logical
    assert result.footprint.data_patch_qubits == 2_100 * per_logical
    assert result.footprint.total_physical_qubits == (
        result.footprint.data_patch_qubits
        + result.footprint.routing_qubits
        + result.footprint.factory_qubits
    )
    # The finding that raising the ceiling bought: FeMoco fits inside ten
    # million physical qubits, and did not inside one hundred thousand.
    assert result.footprint.total_physical_qubits < 10_000_000
    assert result.footprint.total_physical_qubits > 100_000


def test_more_factories_than_the_crossover_buy_nothing():
    at_crossover = estimate(FEMOCO, GIDNEY_2025, factory_count=5)
    far_past_it = estimate(FEMOCO, GIDNEY_2025, factory_count=500)

    assert at_crossover.runtime.seconds == pytest.approx(far_past_it.runtime.seconds)
    assert far_past_it.runtime.binding_term == "reaction"
    # ...and they are not free: the wasted factories are real hardware.
    assert far_past_it.footprint.factory_qubits > at_crossover.footprint.factory_qubits


def test_below_the_crossover_the_throughput_term_binds_and_more_factories_help():
    one = estimate(FEMOCO, GIDNEY_2025, factory_count=1)
    two = estimate(FEMOCO, GIDNEY_2025, factory_count=2)

    assert one.runtime.binding_term == "throughput"
    assert one.runtime.seconds == pytest.approx(2 * two.runtime.seconds)


def test_halving_the_error_rate_cuts_the_footprint():
    """The claim in the plan's §4 table: error rate has more leverage than anything."""
    better = AssumptionSet(
        name="gidney-2025-halved-error",
        version=1,
        citation="hypothetical, for a sensitivity check only",
        physical_error_rate=5e-4,
        threshold=1e-2,
        logical_error_prefactor=0.1,
        routing_factor=2.0,
        factory_footprint_logical=15.0,
        cycle_time_s=1e-6,
        reaction_time_s=10e-6,
        factory_cycles_per_state=11,
        t_per_toffoli=4,
    )
    baseline = estimate(FEMOCO, GIDNEY_2025)
    improved = estimate(FEMOCO, better)

    assert improved.distance.code_distance < baseline.distance.code_distance
    assert improved.footprint.total_physical_qubits < baseline.footprint.total_physical_qubits


def test_an_unstated_serial_depth_is_reported_rather_than_assumed():
    without_depth = LogicalCost(logical_qubits=100, toffoli_count=1_000_000)

    result = estimate(without_depth, GIDNEY_2025)

    assert result.runtime.factory_crossover is None
    assert result.runtime.binding_term == "throughput"
    assert any("lower bound on wall-clock" in note for note in result.notes)


def test_a_clifford_only_circuit_needs_no_factory():
    clifford = LogicalCost(logical_qubits=50, non_clifford_depth=1_000)

    result = estimate(clifford, GIDNEY_2025)

    assert result.runtime.magic_states == 0
    assert result.footprint.factory_qubits == 0
    assert result.runtime.binding_term == "reaction"


def test_a_target_no_distance_can_reach_raises_rather_than_returning_a_number():
    marginal = AssumptionSet(
        name="marginal",
        version=1,
        citation="hypothetical",
        physical_error_rate=9.9e-3,  # only just below threshold
        threshold=1e-2,
        logical_error_prefactor=0.1,
        routing_factor=2.0,
        factory_footprint_logical=15.0,
        cycle_time_s=1e-6,
        reaction_time_s=10e-6,
        factory_cycles_per_state=11,
        t_per_toffoli=4,
    )
    with pytest.raises(ValueError, match="no code distance"):
        choose_code_distance(FEMOCO, marginal, target_failure_probability=1e-3)


def test_quadratic_speedup_is_not_advantage_bearing_at_a_realistic_oracle():
    verdict = assess_advantage(SpeedupClass.QUADRATIC, oracle_binary_operations=1_000)

    assert verdict.status is AdvantageStatus.NOT_ADVANTAGE_BEARING
    assert not verdict.may_be_ranked_beside_superpolynomial
    assert str(BABBUSH_QUADRATIC_ORACLE_OPERATION_BOUND) in verdict.reason
    assert verdict.citation is not None


def test_an_unstated_oracle_size_is_undetermined_not_advantage_bearing():
    verdict = assess_advantage(SpeedupClass.QUADRATIC)

    assert verdict.status is AdvantageStatus.UNDETERMINED
    assert not verdict.may_be_ranked_beside_superpolynomial


def test_only_a_superpolynomial_speedup_ranks_beside_shor():
    ranked = [
        speedup
        for speedup in SpeedupClass
        if assess_advantage(speedup).may_be_ranked_beside_superpolynomial
    ]

    assert ranked == [SpeedupClass.SUPERPOLYNOMIAL]
