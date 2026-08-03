"""Independent classical ground truth for variational runs.

Standing lesson 10: confirm conventions by running them, not by reasoning about
them. Every expected number below is either derived in closed form on paper (and
the derivation written out) or computed by a second, independent route — never by
calling the function under test and pasting what it said.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from majorana_contracts.enums import VerificationMethod, VerificationResultKind
from majorana_verification import (
    EXACT_DIAG_MAX_QUBITS,
    HamiltonianError,
    energy_tolerance,
    ground_state_energy,
    hamiltonian_matrix,
    verify_exact_diag,
)

# Production VQE run 019f7f2d-9504's Hamiltonian: H = 0.5*Z0 + 1.2*Z1 + 0.8*X0X1.
_VQE_TERMS = [(0.5, "ZI"), (1.2, "IZ"), (0.8, "XX")]

# Closed form, by hand. X0X1 flips both qubits, so it couples |00> to |11> and
# |01> to |10>, splitting H into two 2x2 blocks:
#   [[ 1.7, 0.8], [0.8, -1.7]]  ->  eigenvalues +-sqrt(1.7**2 + 0.8**2)
#   [[ 0.7, 0.8], [0.8, -0.7]]  ->  eigenvalues +-sqrt(0.7**2 + 0.8**2)
# The ground state is the more negative of the two.
_VQE_GROUND = -math.sqrt(1.7**2 + 0.8**2)
_VQE_FIRST_EXCITED = -math.sqrt(0.7**2 + 0.8**2)


def test_the_ground_state_matches_the_closed_form():
    assert ground_state_energy(_VQE_TERMS) == pytest.approx(_VQE_GROUND, abs=1e-12)
    assert _VQE_GROUND == pytest.approx(-1.8788294228, abs=1e-9)


def test_the_matrix_is_hermitian_and_traceless_for_non_identity_terms():
    """Two properties provable without diagonalizing: every Pauli string other
    than the all-identity one is traceless, and real coefficients keep H
    Hermitian. If either fails, `eigvalsh` is being applied to a matrix it is not
    entitled to assume anything about."""
    matrix = hamiltonian_matrix(_VQE_TERMS)
    assert np.allclose(matrix, matrix.conj().T)
    assert np.trace(matrix) == pytest.approx(0.0, abs=1e-12)


def test_a_y_term_is_hermitian_too():
    """Y is the one Pauli with imaginary entries; a sign slip in it produces an
    anti-Hermitian matrix whose 'eigenvalues' eigvalsh would still cheerfully
    return."""
    matrix = hamiltonian_matrix([(1.0, "YY")])
    assert np.allclose(matrix, matrix.conj().T)
    # YY has eigenvalues +-1, each twice.
    assert sorted(np.linalg.eigvalsh(matrix).round(12)) == [-1.0, -1.0, 1.0, 1.0]


def test_qubit_zero_is_the_leftmost_character():
    """The documented convention, pinned rather than trusted. 'ZI' must act as Z
    on the first tensor factor — checked against an explicitly built kron."""
    assert np.allclose(hamiltonian_matrix([(1.0, "ZI")]), np.kron(np.diag([1, -1]), np.eye(2)))
    assert np.allclose(hamiltonian_matrix([(1.0, "IZ")]), np.kron(np.eye(2), np.diag([1, -1])))


def test_the_spectrum_is_permutation_invariant():
    """Documented limitation, made explicit: relabelling qubits cannot change the
    ground energy, so this check — unlike the circuit checks — proves nothing
    about wire ordering. A test that asserts a limitation stops someone from
    later claiming the check covers it."""
    swapped = [(coefficient, pauli[::-1]) for coefficient, pauli in _VQE_TERMS]
    assert ground_state_energy(swapped) == pytest.approx(ground_state_energy(_VQE_TERMS))


def _plan_shaped(reported: float, **kwargs):
    return verify_exact_diag(_VQE_TERMS, reported, shots=4096, **kwargs)


def test_a_converged_vqe_passes():
    """Within the shot-noise-plus-optimizer allowance, which at 4096 shots is
    about 0.145 for this Hamiltonian."""
    outcome = _plan_shaped(_VQE_GROUND + 0.03)
    assert outcome.result is VerificationResultKind.PASS
    assert outcome.method is VerificationMethod.EXACT_DIAG
    assert outcome.details["scores"]["exact_ground_state_energy"] == pytest.approx(_VQE_GROUND)


def test_converging_to_the_first_excited_state_fails_and_says_so():
    """The failure that actually happens to VQE. Standing lesson 12 — the
    evidence has to name which eigenvalue was found, not just report a distance."""
    outcome = _plan_shaped(_VQE_FIRST_EXCITED)
    assert outcome.result is VerificationResultKind.FAIL
    disagreement = outcome.details["disagreement"]
    assert "EXCITED" in disagreement
    assert "several initial parameter vectors" in disagreement
    assert outcome.details["scores"]["nearest_eigenvalue"] == pytest.approx(_VQE_FIRST_EXCITED)


def test_an_energy_below_the_ground_state_is_named_as_impossible():
    """A different bug with a different repair: no variational method can go
    below the minimum, so the estimator is wrong rather than the optimizer."""
    outcome = _plan_shaped(_VQE_GROUND - 1.0)
    assert outcome.result is VerificationResultKind.FAIL
    disagreement = outcome.details["disagreement"]
    assert "BELOW" in disagreement
    assert "estimator is wrong" in disagreement


def test_a_missing_metric_fails_as_absent_evidence_not_as_a_wrong_answer():
    outcome = verify_exact_diag(_VQE_TERMS, None, shots=4096)
    assert outcome.result is VerificationResultKind.FAIL
    assert outcome.details["error"] == "required evidence unavailable"


def test_a_boolean_is_not_an_energy():
    """`isinstance(True, int)` is True in Python, and a bool reaching float()
    would silently become 1.0."""
    outcome = verify_exact_diag(_VQE_TERMS, True, shots=4096)
    assert outcome.result is VerificationResultKind.FAIL
    assert outcome.details["error"] == "required evidence unavailable"


def test_a_plan_declared_tolerance_may_tighten_but_never_loosen():
    """The reason this accepts a plan-supplied number at all: a plan value that
    RELAXES a bound can manufacture a physical grade, so min() keeps the safe
    direction only. The unrestricted `Run.tolerances` field was deleted in
    2026-07 rather than made directional — it never had a safe consumer."""
    loose = _plan_shaped(_VQE_GROUND + 0.9, declared_tolerance=5.0)
    assert loose.result is VerificationResultKind.FAIL, "a plan must not widen its own bar"
    assert loose.details["protocol"]["tolerance_source"] == "shot_noise_and_optimizer_allowance"

    tight = _plan_shaped(_VQE_GROUND + 0.05, declared_tolerance=0.001)
    assert tight.result is VerificationResultKind.FAIL, "a plan may hold itself to more"
    assert tight.details["protocol"]["tolerance_source"] == "plan"


def test_the_tolerance_shrinks_as_shots_grow():
    """The shot-noise half must actually depend on shots, or it is a constant
    wearing a derivation."""
    assert energy_tolerance(_VQE_TERMS, 1024) > energy_tolerance(_VQE_TERMS, 16384)


def test_a_shotless_plan_gets_only_scale_aware_numerical_allowance():
    tolerance = energy_tolerance(_VQE_TERMS, None)
    assert tolerance == pytest.approx(1e-6 * (0.5 + 1.2 + 0.8))


def test_exact_statevector_does_not_accept_the_observed_unconverged_vqe_error():
    """Regression from a real unseen trial, expressed independently of its task data.

    A noiseless variational result seven millihartree above a known ground state is
    optimizer/ansatz error, not shot noise. Even an old Plan-authored 0.5% threshold
    must not widen the fixed verifier's numerical allowance.
    """
    outcome = verify_exact_diag(
        _VQE_TERMS,
        _VQE_GROUND + 0.007,
        shots=None,
        declared_tolerance=0.005 * sum(abs(coefficient) for coefficient, _ in _VQE_TERMS),
    )

    assert outcome.result is VerificationResultKind.FAIL
    assert outcome.details["protocol"]["tolerance"] == pytest.approx(2.5e-6)
    assert outcome.details["protocol"]["tolerance_source"] == (
        "exact_expectation_numerical_allowance"
    )
    assert outcome.details["protocol"]["expectation_mode"] == "exact_statevector"
    assert outcome.details["failure_mode"] == "reported_above_ground_state"


@pytest.mark.parametrize(
    "terms, fragment",
    [
        ([], "no Pauli terms"),
        ([(1.0, "ZI"), (1.0, "Z")], "same number of qubits"),
        ([(1.0, "ZQ")], "not a Pauli operator"),
        ([(float("nan"), "ZI")], "not a finite number"),
        ([(1.0, "I" * (EXACT_DIAG_MAX_QUBITS + 1))], "exceeds the exact-diagonalization ceiling"),
    ],
)
def test_a_malformed_hamiltonian_raises_rather_than_returning_a_number(terms, fragment):
    with pytest.raises(HamiltonianError) as exc:
        hamiltonian_matrix(terms)
    assert fragment in str(exc.value)


def test_a_malformed_hamiltonian_blames_the_plan_not_the_candidate():
    """A reference the plan got wrong must not read as a defect in the code — the
    repair loop would rewrite correct code to satisfy it, four times."""
    outcome = verify_exact_diag([(1.0, "ZI"), (1.0, "Z")], -1.0, shots=1024)
    assert outcome.result is VerificationResultKind.FAIL
    assert outcome.details["fault"] == "plan"


def test_the_ceiling_matches_the_contract():
    """Two copies of one number: the contract rejects plans above the ceiling and
    the diagonalizer enforces it. Drift means a plan the contract accepts and the
    verifier is forced to fail."""
    from majorana_contracts.plan import EXACT_DIAG_MAX_QUBITS as CONTRACT_CEILING

    assert CONTRACT_CEILING == EXACT_DIAG_MAX_QUBITS


def test_a_ten_qubit_hamiltonian_is_still_diagonalizable():
    """The ceiling has to be a value that actually works, not an aspiration."""
    terms = [(1.0, "Z" + "I" * 9), (0.5, "X" * 10)]
    energy = ground_state_energy(terms)
    # |sum of coefficients| bounds the spectrum: ||H|| <= sum|c| = 1.5.
    assert -1.5 <= energy <= 0.0


def test_the_real_production_candidate_passes_comfortably():
    """The false-negative guard, against real model output rather than a fixture.

    Production VQE run 019f7f2d-9504 wrote a correct candidate — `FINAL_CIRCUIT`
    bound to the unmeasured ansatz, energy estimated from separate per-basis
    measured copies — and the run died anyway on a plan defect. That exact program
    was re-executed with qiskit-aer outside CI and reported
    **-1.875830078125** in 47 COBYLA evaluations.

    A new check's first duty is not to fail correct code. This one passes that
    candidate with roughly 48x margin, so the tolerance is not sitting on a knife
    edge against the output a real model actually produces. The number is pinned
    rather than recomputed because qiskit-aer is not in the dev/CI venv (only in
    infra/sandbox/Dockerfile) — recomputing here would silently exercise nothing.
    """
    reported = -1.875830078125
    outcome = verify_exact_diag(_VQE_TERMS, reported, shots=4096)
    assert outcome.result is VerificationResultKind.PASS
    error = outcome.details["scores"]["absolute_error"]
    tolerance = outcome.details["protocol"]["tolerance"]
    assert error == pytest.approx(0.003, abs=1e-4)
    assert tolerance > 10 * error, "a bound this close to real output would fail correct code"


def test_the_bound_only_separates_eigenvalues_further_apart_than_itself():
    """The documented hole, asserted rather than left implicit (standing lesson 13).

    The tolerance scales with the Hamiltonian, so "near-degenerate" has to mean
    near-degenerate RELATIVE TO ITS OWN SCALE — my first attempt at this test used
    two tiny coefficients and the bound shrank with them, which is the check
    behaving correctly. `1.0*Z0 + 0.01*Z1` has a spectrum of +-1.01, +-0.99: the
    two lowest sit 0.02 apart while the bound is about 0.083, so the first excited
    state passes. More shots shrink the shot-noise term; the 2%-of-scale optimizer
    allowance is a floor that does not.
    """
    near_degenerate = [(1.0, "ZI"), (0.01, "IZ")]
    spectrum = sorted(np.linalg.eigvalsh(hamiltonian_matrix(near_degenerate)))
    ground, excited = spectrum[0], spectrum[1]
    assert ground == pytest.approx(-1.01, abs=1e-12)
    assert excited - ground == pytest.approx(0.02, abs=1e-12)

    tolerance = energy_tolerance(near_degenerate, 4096)
    assert tolerance > excited - ground, "premise of this test: the gap is inside the bound"
    outcome = verify_exact_diag(near_degenerate, excited, shots=4096)
    assert outcome.result is VerificationResultKind.PASS, (
        "documented limitation: a gap narrower than the bound is not resolvable"
    )
