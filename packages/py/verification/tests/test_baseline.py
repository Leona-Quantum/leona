"""Brute-force ground truth for combinatorial runs.

Standing lesson 10: confirm conventions by running them, not by reasoning about
them. Every expected optimum below is derived by hand and the derivation written
out — never by calling the function under test and pasting what it said.
"""

from __future__ import annotations

import numpy as np
import pytest
from majorana_contracts.enums import VerificationMethod, VerificationResultKind
from majorana_verification import (
    BRUTE_FORCE_MAX_VARIABLES,
    BaselineProblemError,
    objective_values,
    optimal_objective,
    verify_brute_force,
)

# A weighted triangle, small enough to enumerate on paper. Edges:
# (0,1) w=2.5, (1,2) w=1.5, (0,2) w=1.0. Three nontrivial partitions:
#   {0} vs {1,2}: cuts (0,1) and (0,2) -> 2.5 + 1.0 = 3.5
#   {1} vs {0,2}: cuts (0,1) and (1,2) -> 2.5 + 1.5 = 4.0
#   {2} vs {0,1}: cuts (1,2) and (0,2) -> 1.5 + 1.0 = 2.5
# The maximum cut weight is 4.0.
_TRIANGLE = [(0, 1, 2.5), (1, 2, 1.5), (0, 2, 1.0)]
_TRIANGLE_MAX_CUT = 4.0
_TRIANGLE_CUT_VALUES = {0.0, 2.5, 3.5, 4.0}

# A two-variable QUBO, enumerated on paper: minimize
#   1.0*x0 - 2.0*x1 + 3.0*x0*x1
#   00 -> 0.0   10 -> 1.0   01 -> -2.0   11 -> 1.0 - 2.0 + 3.0 = 2.0
# The minimum is -2.0 at assignment x0=0, x1=1.
_QUBO = [(0, 0, 1.0), (1, 1, -2.0), (0, 1, 3.0)]
_QUBO_MIN = -2.0


def test_the_triangle_maximum_matches_the_hand_enumeration():
    assert optimal_objective("maxcut", 3, _TRIANGLE) == pytest.approx(_TRIANGLE_MAX_CUT)


def test_every_triangle_cut_value_matches_the_hand_enumeration():
    """Not only the optimum: the whole achievable-value set drives the
    suboptimal-vs-impossible distinction below, so it is pinned too."""
    values = objective_values("maxcut", 3, _TRIANGLE)
    assert values.size == 8
    assert set(np.round(values, 12)) == _TRIANGLE_CUT_VALUES


def test_the_qubo_minimum_matches_the_hand_enumeration():
    assert optimal_objective("qubo", 2, _QUBO) == pytest.approx(_QUBO_MIN)
    assert set(np.round(objective_values("qubo", 2, _QUBO), 12)) == {0.0, 1.0, -2.0, 2.0}


def test_a_qubo_diagonal_term_is_linear_not_squared():
    """x**2 == x for binary variables; a solver that squared the diagonal would
    agree on 0/1 anyway, so pin the semantics through a two-sided instance: the
    minimum of -2*x0 is -2, reached at x0=1, not -4."""
    assert optimal_objective("qubo", 1, [(0, 0, -2.0)]) == pytest.approx(-2.0)


def test_duplicate_edges_add_their_weights():
    doubled = [(0, 1, 1.0), (0, 1, 1.0), (1, 0, 1.0)]
    assert optimal_objective("maxcut", 2, doubled) == pytest.approx(3.0)


def test_an_isolated_variable_changes_nothing_but_the_enumeration_size():
    padded = optimal_objective("maxcut", 4, _TRIANGLE)
    assert padded == pytest.approx(_TRIANGLE_MAX_CUT)
    assert objective_values("maxcut", 4, _TRIANGLE).size == 16


def test_the_ceiling_instance_is_still_enumerable():
    """The ceiling has to be a value that actually works, not an aspiration: a
    16-variable ring, whose maximum cut severs every edge (alternate the sides),
    so the optimum equals the total weight."""
    n = BRUTE_FORCE_MAX_VARIABLES
    ring = [(i, (i + 1) % n, 1.0) for i in range(n)]
    assert optimal_objective("maxcut", n, ring) == pytest.approx(float(n))


@pytest.mark.parametrize(
    "kind, num_variables, terms, fragment",
    [
        ("maxcut", 3, [], "no terms"),
        ("maxcut", 3, [(0, 3, 1.0)], "outside 0..2"),
        ("maxcut", 3, [(1, 1, 1.0)], "self-loop"),
        ("maxcut", 3, [(0, 1, float("inf"))], "not a finite number"),
        ("maxcut", BRUTE_FORCE_MAX_VARIABLES + 1, [(0, 1, 1.0)], "ceiling"),
        ("tsp", 3, [(0, 1, 1.0)], "not a brute-force problem kind"),
    ],
)
def test_a_malformed_instance_raises_rather_than_returning_a_number(
    kind, num_variables, terms, fragment
):
    with pytest.raises(BaselineProblemError) as exc:
        objective_values(kind, num_variables, terms)
    assert fragment in str(exc.value)


def test_a_qubo_diagonal_is_not_a_self_loop():
    """The self-loop rule is maxcut's alone: for qubo, i == j is how the linear
    coefficient is declared, and rejecting it would reject every instance with a
    linear part."""
    assert optimal_objective("qubo", 1, [(0, 0, 1.0)]) == pytest.approx(0.0)


def _triangle_shaped(reported):
    return verify_brute_force("maxcut", 3, _TRIANGLE, reported)


def test_the_true_optimum_passes():
    outcome = _triangle_shaped(4.0)
    assert outcome.result is VerificationResultKind.PASS
    assert outcome.method is VerificationMethod.BRUTE_FORCE
    assert outcome.details["scores"]["optimal_value"] == pytest.approx(4.0)
    assert outcome.details["protocol"]["objective"] == "maximize"


def test_float_noise_from_a_different_summation_order_still_passes():
    """The whole reason the tolerance exists: the candidate re-sums the same
    declared weights, and addition ordering perturbs the last bits."""
    outcome = _triangle_shaped(4.0 + 1e-12)
    assert outcome.result is VerificationResultKind.PASS


def test_a_real_but_suboptimal_cut_fails_and_names_the_search():
    """The failure that actually happens to QAOA. Standing lesson 12 — the
    evidence names which side the disagreement is on: 3.5 is an achievable cut,
    so the scoring code is right and the search fell short."""
    outcome = _triangle_shaped(3.5)
    assert outcome.result is VerificationResultKind.FAIL
    disagreement = outcome.details["disagreement"]
    assert "SUBOPTIMAL" in disagreement
    assert "ALL sampled assignments" in disagreement
    assert outcome.details["scores"]["nearest_achievable_value"] == pytest.approx(3.5)


def test_a_value_no_assignment_achieves_names_the_scoring_code():
    """3.0 is not the weight of any cut of the triangle, so the number was
    computed wrongly — a different bug with a different repair."""
    outcome = _triangle_shaped(3.0)
    assert outcome.result is VerificationResultKind.FAIL
    assert "not the objective value of ANY assignment" in outcome.details["disagreement"]


def test_a_cut_heavier_than_the_maximum_is_named_as_impossible():
    outcome = _triangle_shaped(5.0)
    assert outcome.result is VerificationResultKind.FAIL
    disagreement = outcome.details["disagreement"]
    assert "BEYOND" in disagreement
    assert "scoring code is wrong" in disagreement


def test_a_qubo_value_below_the_minimum_is_the_impossible_side():
    """Direction flips with the objective: for a minimization no assignment sits
    BELOW the minimum, while values above it are merely suboptimal."""
    below = verify_brute_force("qubo", 2, _QUBO, -3.0)
    assert below.result is VerificationResultKind.FAIL
    assert "BEYOND" in below.details["disagreement"]

    above = verify_brute_force("qubo", 2, _QUBO, 1.0)
    assert above.result is VerificationResultKind.FAIL
    assert "SUBOPTIMAL" in above.details["disagreement"]

    assert verify_brute_force("qubo", 2, _QUBO, -2.0).result is VerificationResultKind.PASS


def test_a_missing_metric_fails_as_absent_evidence_not_as_a_wrong_answer():
    outcome = _triangle_shaped(None)
    assert outcome.result is VerificationResultKind.FAIL
    assert outcome.details["error"] == "required evidence unavailable"


def test_a_boolean_is_not_an_objective_value():
    """`isinstance(True, int)` is True in Python, and a bool reaching float()
    would silently become 1.0."""
    outcome = _triangle_shaped(True)
    assert outcome.result is VerificationResultKind.FAIL
    assert outcome.details["error"] == "required evidence unavailable"


def test_a_malformed_instance_blames_the_plan_not_the_candidate():
    """A reference the plan got wrong must not read as a defect in the code —
    the repair loop would rewrite correct code to satisfy it (the exact_diag
    lesson, kept)."""
    outcome = verify_brute_force("maxcut", 3, [(0, 0, 1.0)], 4.0)
    assert outcome.result is VerificationResultKind.FAIL
    assert outcome.details["fault"] == "plan"


def test_the_ceiling_matches_the_contract():
    """Two copies of one number: the contract rejects plans above the ceiling and
    the enumerator enforces it. Drift means a plan the contract accepts and the
    verifier is forced to fail."""
    from majorana_contracts.plan import BRUTE_FORCE_MAX_VARIABLES as CONTRACT_CEILING

    assert CONTRACT_CEILING == BRUTE_FORCE_MAX_VARIABLES


def test_the_live_qaoa_instance_shape_passes_at_its_known_optimum():
    """The false-negative guard, shaped after production run 019f7f81-4a61: a
    4-node weighted MaxCut whose maximum cut weight of 6.0 was verified by brute
    force BEFORE the probe was submitted (fifteenth session), and which the model
    then reported correctly on every candidate. Edges: (0,1) w=1, (1,2) w=2,
    (2,3) w=1, (0,3) w=2 — a ring, so alternating sides {0,2} vs {1,3} severs
    every edge: 1+2+1+2 = 6.0, and no cut can exceed the total weight.

    A new check's first duty is not to fail correct code: the value a correct
    QAOA run reports for this instance must pass.
    """
    ring = [(0, 1, 1.0), (1, 2, 2.0), (2, 3, 1.0), (0, 3, 2.0)]
    outcome = verify_brute_force("maxcut", 4, ring, 6.0)
    assert outcome.result is VerificationResultKind.PASS
