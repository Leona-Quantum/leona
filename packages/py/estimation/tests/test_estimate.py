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
    AdvantageVerdict,
    BUILTIN_ASSUMPTION_SETS,
    COMPOSED_TRAPPED_ION,
    GIDNEY_2025,
    AdvantageStatus,
    AssumptionSet,
    FactoryTiming,
    LogicalCost,
    PatchFootprint,
    SpeedupClass,
    ValueProvenance,
    assess_advantage,
    choose_code_distance,
    estimate,
)


def a_set(**overrides) -> AssumptionSet:
    """A well-formed set a test can vary in exactly one field.

    The structured fields get their `gidney-2025` shapes rather than invented
    ones, so a test that builds a set by hand is still costing something a
    source states — and so adding a field to `AssumptionSet` breaks one helper
    rather than six literals, which is how the last two fields got added to
    every hand-built set in this file with a plausible-looking wrong value.
    """
    base: dict = {
        "name": "hypothetical",
        "version": 1,
        "source_citation": "hypothetical, constructed by a test",
        "physical_error_rate": 1e-3,
        "threshold": 1e-2,
        "logical_error_prefactor": 0.1,
        "routing_factor": 2.0,
        "factory_footprint_logical": 12.0,
        "cycle_time_s": 1e-6,
        "reaction_time_s": 10e-6,
        "factory_cycles_per_state": FactoryTiming(
            constant_rounds=14.7 / 8, rounds_per_distance=0.5
        ),
        "t_per_toffoli": 8,
        "physical_qubits_per_patch": PatchFootprint(coefficient=2.0, distance_offset=1),
    }
    base.update(overrides)
    return AssumptionSet(**base)


# Lee et al. 2021, tensor hypercontraction: the smallest well-costed FTQC
# chemistry target.
#
# **2,196 and 6.7e9, not the round 2,100 and 6e9 this fixture carried until
# 2026-08-05.** Those were a rounding of the source, applied in the direction
# that makes the machine smaller, under a label naming the source. Webber et al.
# (arXiv:2108.12371) figure 1 states them: "The associated logical resources
# required are 2196 logical qubits and 6.7 billion Toffoli gates", citing Lee et
# al. for both.
#
# `non_clifford_depth` is **ours, not theirs**, and it is the one number here
# with no source: Webber says in as many words that the measurement depth "was
# not provided along with the other logical requirements", which is why his
# figure 1 sweeps T_count, T_count/10 and T_count/100 instead of using one.
# Charging one serial layer per Toffoli is the worst case, which is the safe
# direction for a runtime floor and is stated rather than assumed silently.
FEMOCO_TOFFOLIS = 6_700_000_000
FEMOCO = LogicalCost(
    logical_qubits=2_196,
    toffoli_count=FEMOCO_TOFFOLIS,
    non_clifford_depth=FEMOCO_TOFFOLIS,
    label="FeMoco ground state (Lee et al. 2021, as costed by Webber et al. fig. 1)",
)


def test_an_assumption_set_refuses_to_exist_above_threshold():
    # Above threshold, more distance makes things worse. A returned distance
    # would look like an answer, so the set itself must refuse.
    with pytest.raises(ValueError, match="does not converge"):
        a_set(name="broken", physical_error_rate=2e-2)


def test_estimates_under_different_assumption_sets_are_not_comparable():
    other = dataclasses.replace(GIDNEY_2025, version=3)
    # Every number is identical; only the version differs. Still not comparable:
    # a version is a separate claim about hardware, and one can be revised.
    assert not GIDNEY_2025.comparable_with(other)
    assert not estimate(FEMOCO, GIDNEY_2025).comparable_with(estimate(FEMOCO, other))
    assert estimate(FEMOCO, GIDNEY_2025).assumption_set == "gidney-2025@v2"


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
    # 2(d+1)^2, which is the conversion arXiv:2505.15917 states for itself and
    # not the one this package applied to every set until 2026-08-05.
    assert choice.physical_per_logical == 2 * (choice.code_distance + 1) ** 2


def test_femoco_reproduces_the_plans_arithmetic():
    """The plan's §1 headline, recomputed from constants inside this test."""
    result = estimate(FEMOCO, GIDNEY_2025)

    # --- magic states: 6.7e9 Toffoli at 8 T states each, which is what the
    # cited paper's 8T-to-CCZ pipeline costs a Toffoli. Four is the common
    # measurement-and-fixup figure and is what this set charged until v2.
    assert result.runtime.magic_states == FEMOCO_TOFFOLIS * 8

    # --- the reaction-limited floor: ~19 hours, and no factory count beats it
    reaction_floor = FEMOCO_TOFFOLIS * GIDNEY_2025.reaction_time_s
    assert result.runtime.reaction_limited_seconds == pytest.approx(reaction_floor)
    assert result.runtime.reaction_limited_seconds / 3600 == pytest.approx(18.6, abs=0.1)

    # --- the crossover, computed here from the rate rather than read back, and
    # now at the chosen distance because factory time depends on it.
    d = result.distance.code_distance
    rounds_per_state = 14.7 / 8 + 0.5 * d
    rate = 1.0 / (rounds_per_state * 1e-6)
    expected_crossover = math.ceil(FEMOCO_TOFFOLIS * 8 / (rate * reaction_floor))
    assert result.runtime.factory_crossover == expected_crossover

    # --- the paper's own figure falls out at the paper's own distance: 14.7
    # rounds of cultivation plus six lattice-surgery layers at 2d/3 each is
    # 114.7 rounds per CCZ state at d = 25.
    assert GIDNEY_2025.factory_cycles_per_state.rounds(25) * GIDNEY_2025.t_per_toffoli == (
        pytest.approx(114.7)
    )

    # --- at the crossover the reaction floor has taken over
    assert result.runtime.binding_term == "reaction"
    assert result.runtime.throughput_seconds <= result.runtime.reaction_limited_seconds

    # --- footprint: data patches are logical x 2(d+1)^2
    per_logical = result.distance.physical_per_logical
    assert result.footprint.data_patch_qubits == 2_196 * per_logical
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
    crossover = estimate(FEMOCO, GIDNEY_2025).runtime.factory_crossover
    at_crossover = estimate(FEMOCO, GIDNEY_2025, factory_count=crossover)
    far_past_it = estimate(FEMOCO, GIDNEY_2025, factory_count=crossover * 100)

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
    better = dataclasses.replace(
        GIDNEY_2025, name="gidney-2025-halved-error", physical_error_rate=5e-4
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
        a_set(name="non-finite", cycle_time_s=bad)


def test_idle_patch_rounds_are_charged_in_cycles_not_layers():
    """Layer 4 counts serial layers; Layer 2 counts patch-rounds. One layer is
    `cycles_per_reaction` rounds, and conflating them understates the volume
    tenfold under gidney-2025 — which moves `d`, and `d` squares."""
    assert GIDNEY_2025.cycles_per_reaction == 10

    choice = choose_code_distance(FEMOCO, GIDNEY_2025, target_failure_probability=0.01)

    magic_states = FEMOCO_TOFFOLIS * GIDNEY_2025.t_per_toffoli
    idle_rounds = 2_196 * FEMOCO_TOFFOLIS * 10
    assert choice.logical_operations == magic_states + idle_rounds


def test_a_target_no_distance_can_reach_raises_rather_than_returning_a_number():
    # only just below threshold
    marginal = a_set(name="marginal", physical_error_rate=9.9e-3)
    with pytest.raises(ValueError, match="no code distance"):
        choose_code_distance(FEMOCO, marginal, target_failure_probability=1e-3)


def test_a_quadratic_speedup_is_not_advantage_bearing_and_nothing_makes_it_one():
    """There is no oracle size that rescues it, because there was never a ceiling.

    This module used to hold `BABBUSH_QUADRATIC_ORACLE_OPERATION_BOUND = 68` and
    return ADVANTAGE_BEARING below it. arXiv:2011.04149v2 contains no such bound
    — the words "oracle", "binary operation" and "week" do not appear in it at
    all — so the escape hatch was returning the one answer this module exists to
    prevent, on a fabricated threshold.
    """
    verdict = assess_advantage(SpeedupClass.QUADRATIC)

    assert verdict.status is AdvantageStatus.NOT_ADVANTAGE_BEARING
    assert not verdict.may_be_ranked_beside_superpolynomial
    assert verdict.citation is not None

    # The signature no longer accepts one, so the old call site fails loudly
    # rather than silently ignoring the argument.
    with pytest.raises(TypeError):
        assess_advantage(SpeedupClass.QUADRATIC, oracle_binary_operations=10)  # type: ignore[call-arg]


def test_the_quadratic_verdict_states_the_papers_own_breakeven_numbers():
    """The reason has to carry something checkable, or it is just a mood.

    100 days and 880 years are Table I of the cited paper: its most generous
    constructed case and its one realistically compiled example, both against a
    thousand parallel classical cores.
    """
    reason = assess_advantage(SpeedupClass.QUADRATIC).reason

    assert "100 days" in reason
    assert "880 years" in reason
    assert "100 Toffoli" in reason


def test_only_a_superpolynomial_speedup_ranks_beside_shor():
    ranked = [
        speedup
        for speedup in SpeedupClass
        if assess_advantage(speedup).may_be_ranked_beside_superpolynomial
    ]

    assert ranked == [SpeedupClass.SUPERPOLYNOMIAL]


def test_the_ranking_predicate_stays_narrower_than_the_status_it_reads():
    """`may_be_ranked_beside_superpolynomial` and `status is ADVANTAGE_BEARING`
    now coincide, and the predicate must not be collapsed into the status.

    They coincide only because nothing but a superpolynomial speedup currently
    reaches ADVANTAGE_BEARING. The two tests that used to hold them apart both
    ran through the fabricated 68-operation ceiling, so removing it removed the
    only case that distinguished them. This pins the *shape* instead: the
    predicate additionally requires the speedup class, so a future verdict that
    admits a quartic speedup does not silently start sorting beside Shor.
    """
    admitted = AdvantageVerdict(
        status=AdvantageStatus.ADVANTAGE_BEARING,
        speedup=SpeedupClass.QUARTIC,
        reason="hypothetical: a quartic speedup whose crossover was computed",
    )

    assert admitted.status is AdvantageStatus.ADVANTAGE_BEARING
    assert not admitted.may_be_ranked_beside_superpolynomial


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

    assert loose.identity == "gidney-2025@v2+eps=1e-06"
    assert tight.identity == "gidney-2025@v2+eps=1e-10"
    assert not loose.comparable_with(tight)


def test_an_estimate_under_a_precision_will_not_rank_against_one_without():
    """The refusal has to fire on the pair it exists for. Before eps entered
    the identity this returned True: same name, same version, different cost
    model for every rotation in the circuit."""
    rotations = LogicalCost(logical_qubits=4, t_count=60, non_clifford_depth=1)

    stated = estimate(rotations, GIDNEY_2025.with_rotation_precision(1e-6))
    unstated = estimate(rotations, GIDNEY_2025)

    assert not stated.comparable_with(unstated)
    assert stated.assumption_set == "gidney-2025@v2+eps=1e-06"


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
    assert GIDNEY_2025.with_rotation_precision(1e-6).identity == "gidney-2025@v2+eps=1e-06"


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

    `gidney-2025` used to take three of its nine values from common practice
    rather than from the cited paper. That was recorded in a module docstring
    while the string rendered on `/repository` said the source stated its
    assumptions in one place — so a visitor read a citation implying nine
    sourced numbers where six were. `citation` is composed from the source plus
    the allowances precisely so the two cannot drift apart again.

    **Neither built-in set has a working allowance any more**, because reading
    the papers found a stated value behind each one. The mechanism still has to
    work for the next set that needs it, so it is exercised on a set built here
    rather than deleted along with its last user.
    """
    unsourced = a_set(working_allowances=("routing_factor", "factory_footprint_logical"))
    rendered = unsourced.citation

    for allowance in unsourced.working_allowances:
        assert allowance in rendered, f"{allowance} is undisclosed to the reader"
    assert unsourced.source_citation in rendered
    assert "working allowances" in rendered

    assert GIDNEY_2025.working_allowances == ()
    assert COMPOSED_TRAPPED_ION.working_allowances == ()


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
        "composed-trapped-ion@v2",
        "gidney-2025@v2",
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

    # The cycle-time ratio alone is 235x. In v2 the factories differ too — this
    # set uses the 116-to-12 block Litinski selects at 1e-3 where gidney-2025
    # uses the paper's own cultivation-plus-8T-to-CCZ factory — so the delivery
    # rates are further apart than the clocks. Computed at one distance because
    # both timings are functions of it.
    d = 21
    rate_ratio = GIDNEY_2025.magic_states_per_second_per_factory(
        d
    ) / COMPOSED_TRAPPED_ION.magic_states_per_second_per_factory(d)
    cycle_ratio = COMPOSED_TRAPPED_ION.cycle_time_s / GIDNEY_2025.cycle_time_s
    assert math.isclose(cycle_ratio, 235.0, rel_tol=1e-9)
    assert rate_ratio > cycle_ratio

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


def test_gidney_states_every_value_this_set_holds():
    """v1's audit found three unsourced values here, then a fourth. There were six.

    Reading arXiv:2505.15917 rather than the docstring turned up a stated figure
    behind every one of them — 2(d+1)^2 physical qubits per logical patch, a 3x4
    factory, 8T-to-CCZ so eight T states per Toffoli, and 14.7 + 4d rounds per
    CCZ state — plus the fact that the suppression law this model uses is not in
    that paper at all. So v2 has no `working_allowances`: every value names a
    paper, and what is left to disclose is which paper, and one departure.

    Fourth time an audit's own count of what it fixed has turned out to be a
    floor. Treat the next one that way too.
    """
    assert GIDNEY_2025.working_allowances == ()

    rendered = GIDNEY_2025.citation
    for name in ("threshold", "logical_error_prefactor", "routing_factor"):
        assert name in rendered, f"{name}'s source is undisclosed to the reader"
    # The suppression law is Fowler and Gidney, not the paper the set is named
    # for — which is the sort of thing only reading both turns up.
    assert "arXiv:1808.06709" in rendered

    # The departure: the paper derives 114.7 rounds per CCZ state and then
    # rounds it to 150 for slack, carrying 150 forward. This set takes the
    # derivation, so it is faster at distillation than the figure the paper
    # reports, and says so.
    assert "150" in rendered
    per_ccz = GIDNEY_2025.factory_cycles_per_state.rounds(25) * GIDNEY_2025.t_per_toffoli
    assert per_ccz == pytest.approx(114.7)
    assert math.isclose(150 / per_ccz, 1.308, rel_tol=1e-3)


def test_the_factory_constant_term_is_the_papers_cultivation_cost():
    """Checked a second way, because the first way was dividing by eight.

    The paper states 30000 physical qubit-rounds to cultivate one T state, and
    separately that a factory covers a 3x4 area of patches. Those two numbers
    never pass through the 14.7, so reproducing the constant term from them is
    evidence rather than restatement.
    """
    factory_qubits = GIDNEY_2025.factory_footprint_logical * (
        GIDNEY_2025.physical_qubits_per_patch.physical_qubits(25)
    )
    assert factory_qubits == 3 * 4 * 26**2 * 2  # the paper's own arithmetic

    rounds_to_cultivate_one = 30_000 / factory_qubits
    assert rounds_to_cultivate_one == pytest.approx(
        GIDNEY_2025.factory_cycles_per_state.constant_rounds, rel=0.01
    )


def test_a_factory_that_takes_no_time_is_refused_at_the_set():
    """Both terms zero divides by zero inside the runtime layer, several frames
    from the set that stated it."""
    with pytest.raises(ValueError, match="takes some time"):
        FactoryTiming()


def test_a_patch_conversion_must_be_one_of_the_two_sourced_shapes():
    """`coefficient * (d + offset)^2` holds 2(d+1)^2 and 2d^2 and nothing else.

    The form is narrow on purpose: it was `d^2 + (d-1)^2` hard-coded in
    `estimate.py` for every set, which is an unrotated patch's data qubits and
    counts no measure qubits at all — about 10% under either figure a cited
    source states.
    """
    assert GIDNEY_2025.physical_qubits_per_patch.physical_qubits(25) == 2 * 26**2
    assert COMPOSED_TRAPPED_ION.physical_qubits_per_patch.physical_qubits(9) == 2 * 81
    # The conversion this package used to apply to both, for the size of it.
    assert 9**2 + 8**2 == 145
    assert COMPOSED_TRAPPED_ION.physical_qubits_per_patch.physical_qubits(9) == 162

    with pytest.raises(ValueError, match="positive number"):
        PatchFootprint(coefficient=0.0)
