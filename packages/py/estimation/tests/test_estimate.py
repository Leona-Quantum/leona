"""Tests for the four-layer estimator.

The load-bearing one is `test_femoco_reproduces_the_plans_arithmetic`: it
recomputes the plan's headline numbers from the raw constants *inside the test*
rather than calling the estimator twice, so agreement is evidence and not a
tautology.
"""

from __future__ import annotations

import dataclasses
import math

import pytest
from majorana_estimation import (
    BABBUSH_QUADRATIC_ORACLE_OPERATION_BOUND,
    BUILTIN_ASSUMPTION_SETS,
    COMPOSED_TRAPPED_ION,
    GIDNEY_2025,
    AdvantageStatus,
    AssumptionSet,
    LogicalCost,
    SpeedupClass,
    ValueProvenance,
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
            source_citation="none",
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
        source_citation=GIDNEY_2025.source_citation,
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
        source_citation="hypothetical, for a sensitivity check only",
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
    clifford = LogicalCost(logical_qubits=50)

    result = estimate(clifford, GIDNEY_2025)

    assert result.runtime.magic_states == 0
    assert result.footprint.factory_qubits == 0
    assert result.runtime.factory_count == 0


def test_a_clifford_only_circuit_cannot_claim_a_non_clifford_depth():
    # There is no non-Clifford chain to have a depth, and `_runtime` would
    # otherwise charge a feed-forward reaction per layer for operations that
    # never wait on a measurement.
    with pytest.raises(ValueError, match="no non-Clifford dependency chain"):
        LogicalCost(logical_qubits=50, non_clifford_depth=1_000)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("logical_qubits", 2.5),
        ("toffoli_count", 1.5),
        ("non_clifford_depth", True),
    ],
)
def test_a_discrete_count_refuses_a_float_or_a_bool(field, value):
    # Annotations do not run. Without this, `t_per_toffoli=1.5` reaches the
    # arithmetic and a fractional gate count reaches a reported qubit total.
    with pytest.raises(TypeError, match="must be an int"):
        LogicalCost(**{"logical_qubits": 10, field: value})


@pytest.mark.parametrize("bad", [float("nan"), float("inf")])
def test_an_assumption_set_refuses_a_non_finite_number(bad):
    # NaN compares false against every bound below and reaches the arithmetic
    # intact; inf makes the factory rate zero and divides by zero later.
    with pytest.raises(ValueError, match="must be finite"):
        AssumptionSet(
            name="non-finite",
            version=1,
            source_citation="none",
            physical_error_rate=1e-3,
            threshold=1e-2,
            logical_error_prefactor=0.1,
            routing_factor=2.0,
            factory_footprint_logical=15.0,
            cycle_time_s=bad,
            reaction_time_s=10e-6,
            factory_cycles_per_state=11,
            t_per_toffoli=4,
        )


def test_idle_patch_rounds_are_charged_in_cycles_not_layers():
    """Layer 4 counts serial layers; Layer 2 counts patch-rounds. One layer is
    `cycles_per_reaction` rounds, and conflating them understates the volume
    tenfold under gidney-2025 — which moves `d`, and `d` squares."""
    assert GIDNEY_2025.cycles_per_reaction == 10

    choice = choose_code_distance(FEMOCO, GIDNEY_2025, target_failure_probability=0.01)

    magic_states = 6_000_000_000 * 4
    idle_rounds = 2_100 * 6_000_000_000 * 10
    assert choice.logical_operations == magic_states + idle_rounds


def test_a_target_no_distance_can_reach_raises_rather_than_returning_a_number():
    marginal = AssumptionSet(
        name="marginal",
        version=1,
        source_citation="hypothetical",
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


def test_a_quadratic_speedup_inside_the_ceiling_still_does_not_rank_beside_shor():
    # The case the sweep above misses, because it supplies no oracle size: a
    # bounded oracle IS advantage-bearing, and is still a different and far more
    # fragile claim than Shor. Flattening the two is what the ledger prevents.
    verdict = assess_advantage(SpeedupClass.QUADRATIC, oracle_binary_operations=10)

    assert verdict.status is AdvantageStatus.ADVANTAGE_BEARING
    assert not verdict.may_be_ranked_beside_superpolynomial


def test_a_negative_oracle_size_is_refused_rather_than_slipping_under_the_ceiling():
    with pytest.raises(ValueError, match="oracle_binary_operations"):
        assess_advantage(SpeedupClass.QUADRATIC, oracle_binary_operations=-1)


# --- Rotation synthesis: making an arbitrary angle countable, deliberately ----


def test_a_set_with_no_stated_precision_has_no_t_count_per_rotation():
    """Defaulting here would turn "nobody stated a budget" into a specific
    number, shown next to exactly-counted ones on the same page."""
    with pytest.raises(ValueError, match="rotation_synthesis_epsilon"):
        _ = GIDNEY_2025.t_per_rotation


def test_the_sourced_set_states_no_precision():
    """The budget is the algorithm's error allowance split among its rotations,
    not a hardware property, so no built-in set may quietly carry one."""
    assert GIDNEY_2025.rotation_synthesis_epsilon is None


def test_t_per_rotation_follows_the_ross_selinger_leading_term():
    stated = dataclasses.replace(
        GIDNEY_2025,
        version=2,
        rotation_synthesis_epsilon=1e-6,
        rotation_t_coefficient=3.0,
    )

    # Computed here rather than quoted: 3 * log2(1/1e-6) = 59.79..., and a
    # fraction of a T is not something a factory can distil, so it rounds up.
    assert stated.t_per_rotation == math.ceil(3.0 * math.log2(1e6)) == 60


def test_a_tighter_precision_costs_more_t_gates():
    loose = dataclasses.replace(GIDNEY_2025, version=2, rotation_synthesis_epsilon=1e-3)
    tight = dataclasses.replace(GIDNEY_2025, version=3, rotation_synthesis_epsilon=1e-12)

    assert tight.t_per_rotation > loose.t_per_rotation


@pytest.mark.parametrize("epsilon", [0.0, 1.0, 1.5, -1e-6])
def test_a_precision_outside_the_unit_interval_is_refused(epsilon):
    """eps >= 1 is not a loose budget; log2(1/eps) <= 0 would hand back a zero
    or negative T-count for a rotation that certainly costs something."""
    with pytest.raises(ValueError):
        dataclasses.replace(GIDNEY_2025, version=2, rotation_synthesis_epsilon=epsilon)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_a_non_finite_rotation_coefficient_is_refused_at_construction(bad):
    """NaN fails every comparison and inf passes `> 0`, so both survive a bare
    positivity check and surface later out of math.ceil in t_per_rotation."""
    with pytest.raises(ValueError):
        dataclasses.replace(GIDNEY_2025, version=2, rotation_t_coefficient=bad)


def test_the_precision_is_part_of_the_identity_an_estimate_carries():
    """Two costings that differ only in eps are different claims.

    A thousand rotations cost 60,000 T at 1e-6 and 100,000 at 1e-10, so a
    ranking that mixed them would be ordering by an assumption rather than by
    the circuits.
    """
    loose = GIDNEY_2025.with_rotation_precision(1e-6)
    tight = GIDNEY_2025.with_rotation_precision(1e-10)

    assert loose.identity == "gidney-2025@v1+eps=1e-06"
    assert tight.identity == "gidney-2025@v1+eps=1e-10"
    assert not loose.comparable_with(tight)


def test_an_estimate_under_a_precision_will_not_rank_against_one_without():
    """The refusal has to fire on the pair it exists for. Before eps entered
    the identity this returned True: same name, same version, different cost
    model for every rotation in the circuit."""
    rotations = LogicalCost(logical_qubits=4, t_count=60, non_clifford_depth=1)

    stated = estimate(rotations, GIDNEY_2025.with_rotation_precision(1e-6))
    unstated = estimate(rotations, GIDNEY_2025)

    assert not stated.comparable_with(unstated)
    assert stated.assumption_set == "gidney-2025@v1+eps=1e-06"


def test_naming_a_precision_leaves_the_hardware_untouched():
    """`with_rotation_precision` must not be a way to edit an assumption set.
    Only the synthesis budget moves; every sourced number stays put, and the
    original is unchanged."""
    derived = GIDNEY_2025.with_rotation_precision(1e-6)

    assert GIDNEY_2025.rotation_synthesis_epsilon is None
    assert derived.t_per_rotation == 60
    assert dataclasses.replace(derived, rotation_synthesis_epsilon=None) == GIDNEY_2025


def test_a_precision_the_arithmetic_cannot_use_is_refused_at_the_boundary():
    """Refuse where the caller is, not eight frames later inside math.log2."""
    for bad in (0.0, 1.0, -1e-6, float("nan")):
        with pytest.raises(ValueError):
            GIDNEY_2025.with_rotation_precision(bad)


def test_a_clifford_only_circuit_reports_no_runtime_rather_than_zero():
    """0.0 seconds is the one wrong answer that reads as a measurement.

    Both runtime terms are magic-state terms, so a circuit consuming none
    drives both to zero — and `max(0, 0)` is a circuit that runs instantly.
    The footprint is still real and is still reported.
    """
    result = estimate(LogicalCost(logical_qubits=50), GIDNEY_2025)

    assert result.runtime.seconds is None
    assert result.runtime_seconds is None
    assert result.runtime.binding_term == "unstated"
    assert result.footprint.total_physical_qubits > 0
    assert any("runtime is not" in note for note in result.notes)


def test_two_precisions_that_round_alike_still_get_different_identities():
    """`:g` renders six significant figures, so 1.234561e-6 and 1.234562e-6 both
    become "1.23456e-06" — two budgets, one identity, and `comparable_with`
    ranking them against each other. The identity has to round-trip the float."""
    a = GIDNEY_2025.with_rotation_precision(1.234561e-6)
    b = GIDNEY_2025.with_rotation_precision(1.234562e-6)

    assert a.identity != b.identity
    assert not a.comparable_with(b)
    # The common case still reads the way a person would write it.
    assert GIDNEY_2025.with_rotation_precision(1e-6).identity == "gidney-2025@v1+eps=1e-06"


def test_a_clifford_only_circuit_is_costed_with_no_factories_even_when_asked_for_some():
    """Factories a circuit cannot use are not part of what it needs.

    Honouring the request adds 15 logical patches apiece to a footprint whose
    own `magic_states` is 0 — a report that contradicts itself line by line.
    """
    clifford = LogicalCost(logical_qubits=2)

    asked = estimate(clifford, GIDNEY_2025, factory_count=5)
    unasked = estimate(clifford, GIDNEY_2025)

    assert asked.runtime.factory_count == 0
    assert asked.footprint.factory_qubits == 0
    assert asked.footprint.total_physical_qubits == unasked.footprint.total_physical_qubits
    assert any("consumes no magic states" in note for note in asked.notes)


def test_a_circuit_that_does_consume_magic_states_keeps_the_factories_it_was_given():
    """The normalisation above must not swallow a real factory count."""
    costly = LogicalCost(logical_qubits=2, t_count=100, non_clifford_depth=1)

    result = estimate(costly, GIDNEY_2025, factory_count=3)

    assert result.runtime.factory_count == 3
    assert result.footprint.factory_qubits > 0


# --- the citation a reader actually sees -----------------------------------


def test_the_rendered_citation_names_every_value_the_source_does_not_state():
    """The disclosure has to reach the page, not just the docstring.

    `gidney-2025` takes three of its nine values from common practice rather
    than from the cited paper. That was recorded in a module docstring while
    the string rendered on `/repository` said the source stated its assumptions
    in one place — so a visitor read a citation implying nine sourced numbers
    where six were. `citation` is composed from the source plus the allowances
    precisely so the two cannot drift apart again.
    """
    rendered = GIDNEY_2025.citation

    assert GIDNEY_2025.working_allowances == (
        "routing_factor",
        "factory_footprint_logical",
        "t_per_toffoli",
    )
    for allowance in GIDNEY_2025.working_allowances:
        assert allowance in rendered, f"{allowance} is undisclosed to the reader"
    assert GIDNEY_2025.source_citation in rendered
    assert "working allowances" in rendered


def test_a_set_whose_source_states_everything_renders_no_disclosure():
    """The sentence is a disclosure, not decoration — absent when nothing to disclose."""
    fully_sourced = dataclasses.replace(GIDNEY_2025, working_allowances=(), value_provenance=())

    assert fully_sourced.citation == fully_sourced.source_citation


def test_a_misspelled_allowance_is_refused_rather_than_silently_undisclosed():
    """A typo would render a disclosure that discloses nothing.

    `factory_footprint` is not a field; without this check the name would drop
    out of the rendered string and the set would look more sourced than it is —
    the exact failure the field exists to end.
    """
    with pytest.raises(ValueError, match="no such field"):
        dataclasses.replace(GIDNEY_2025, working_allowances=("factory_footprint",))


def test_an_assumption_set_must_cite_something():
    with pytest.raises(ValueError, match="must cite its source"):
        dataclasses.replace(GIDNEY_2025, source_citation="")


# --- a set composed from more than one paper --------------------------------


def test_the_second_set_is_composed_and_says_so_per_value():
    """A composed set has to name which paper each value came from.

    Requiring one paper to state all ten fields is a bar the trapped-ion
    literature does not clear, so the alternative to composing is having one
    set — and one set makes the refusal to rank across sets untestable on any
    real pair. Composing is fine; composing silently is the thing that would
    turn a citation into a claim the sources do not support.
    """
    rendered = COMPOSED_TRAPPED_ION.citation

    assert COMPOSED_TRAPPED_ION.working_allowances == ()
    attributed = [name for entry in COMPOSED_TRAPPED_ION.value_provenance for name in entry.fields]
    assert attributed == [
        "routing_factor",
        "factory_footprint_logical",
        "factory_cycles_per_state",
    ]
    for name in attributed:
        assert name in rendered, f"{name}'s source is undisclosed to the reader"
    # Both papers reachable from the page, not just the primary one.
    assert "arXiv:2108.12371" in rendered
    assert "arXiv:1808.02892" in rendered


def test_the_two_builtin_sets_are_a_pair_the_ordering_refusal_can_refuse():
    """E4 built the machinery that refuses to rank across sets and left it with
    one set, so every test of that path used two epsilons on the same hardware.
    This is the case it was written for: different hardware, same precision."""
    assert sorted(BUILTIN_ASSUMPTION_SETS) == [
        "composed-trapped-ion@v1",
        "gidney-2025@v1",
    ]

    superconducting = GIDNEY_2025.with_rotation_precision(1e-6)
    trapped_ion = COMPOSED_TRAPPED_ION.with_rotation_precision(1e-6)

    assert not superconducting.comparable_with(trapped_ion)
    assert not estimate(FEMOCO, superconducting).comparable_with(estimate(FEMOCO, trapped_ion))


def test_the_trapped_ion_set_costs_its_slower_cycle_in_factories_not_distance():
    """The second set earns its place by disagreeing where it matters.

    It shares p, p_th and A with `gidney-2025`, so the code distance barely
    moves; a 235 us cycle against 1 us is the whole difference, and it lands on
    the factory count and the wall-clock. That is the cited paper's own
    conclusion — slower hardware can still hit a target runtime, but only by
    being far more scalable — reproduced by this arithmetic rather than quoted.
    """
    superconducting = estimate(FEMOCO, GIDNEY_2025)
    trapped_ion = estimate(FEMOCO, COMPOSED_TRAPPED_ION)

    # One factory is ~235x slower, exactly the cycle-time ratio.
    rate_ratio = (
        GIDNEY_2025.magic_states_per_second_per_factory
        / COMPOSED_TRAPPED_ION.magic_states_per_second_per_factory
    )
    assert math.isclose(rate_ratio, 235.0, rel_tol=1e-9)

    assert trapped_ion.runtime.factory_count > 20 * superconducting.runtime.factory_count
    assert trapped_ion.runtime.seconds > superconducting.runtime.seconds
    assert abs(trapped_ion.distance.code_distance - superconducting.distance.code_distance) <= 2


def test_a_reaction_faster_than_a_code_cycle_still_charges_one_round():
    """Trapped ions invert the usual order: 68.75 us feed-forward against a
    235 us cycle. `cycles_per_reaction` is a patch-round count and rounds to
    zero here, which would erase the idle term from the spacetime volume."""
    assert COMPOSED_TRAPPED_ION.reaction_time_s < COMPOSED_TRAPPED_ION.cycle_time_s
    assert COMPOSED_TRAPPED_ION.cycles_per_reaction == 1


def test_a_value_cannot_be_both_unsourced_and_attributed_to_a_source():
    """The two disclosures are contradictory claims, and a citation that made
    both would be self-refuting one sentence apart."""
    with pytest.raises(ValueError, match="both a working allowance"):
        dataclasses.replace(
            GIDNEY_2025,
            working_allowances=("routing_factor",),
            value_provenance=(ValueProvenance(fields=("routing_factor",), note="from somewhere"),),
        )


def test_a_misspelled_attribution_is_refused_like_a_misspelled_allowance():
    """Same failure, same guard: a name that is not a field would drop out of
    the rendered string and leave the set looking better sourced than it is."""
    with pytest.raises(ValueError, match="no such field"):
        dataclasses.replace(
            GIDNEY_2025,
            value_provenance=(ValueProvenance(fields=("factory_footprint",), note="from a paper"),),
        )


def test_the_same_field_cannot_be_attributed_to_two_sources():
    with pytest.raises(ValueError, match="attributes the same field twice"):
        dataclasses.replace(
            GIDNEY_2025,
            value_provenance=(
                ValueProvenance(fields=("routing_factor",), note="paper A"),
                ValueProvenance(fields=("routing_factor",), note="paper B"),
            ),
        )


@pytest.mark.parametrize(
    "kwargs",
    [
        {"fields": (), "note": "a source"},
        {"fields": ("routing_factor", "routing_factor"), "note": "a source"},
        {"fields": ("routing_factor",), "note": "   "},
    ],
)
def test_an_empty_attribution_is_refused_at_construction(kwargs):
    """An attribution that names no field, repeats one, or says nothing
    discloses nothing while occupying the slot where a disclosure would go."""
    with pytest.raises(ValueError):
        ValueProvenance(**kwargs)


def test_gidney_discloses_the_factory_timing_it_departs_from():
    """The pass that introduced `working_allowances` found three unsourced
    values in this set. There were four.

    `factory_cycles_per_state=11` was carried as sourced. The paper budgets
    114.7 rounds per CCZ state and rounds it to 150; one CCZ is one Toffoli, so
    in this model's per-magic-state accounting that is ~37.5 rounds, not 11.
    The number is left alone — moving it moves a published estimate — but the
    citation no longer claims the paper for it.
    """
    assert "factory_cycles_per_state" not in GIDNEY_2025.working_allowances
    rendered = GIDNEY_2025.citation
    assert "factory_cycles_per_state" in rendered
    assert "150" in rendered

    # The arithmetic behind "roughly 3.4x", computed here rather than quoted.
    stated_rounds_per_ccz = 150
    magic_states_per_ccz = GIDNEY_2025.t_per_toffoli
    assert math.isclose(
        stated_rounds_per_ccz / magic_states_per_ccz / GIDNEY_2025.factory_cycles_per_state,
        3.409,
        rel_tol=1e-3,
    )
