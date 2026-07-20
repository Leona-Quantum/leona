"""Exact diagonalization of a small Pauli Hamiltonian — independent ground truth.

Every other physical check in this package compares a candidate against *itself*:
`statistical` against the Born distribution of the circuit that ran,
`statistical_native` against a trusted re-execution of that same circuit object.
Those prove the code does what the code says. They are structurally unable to
notice that the code computes the wrong quantity, and for a variational algorithm
they cannot run at all — a VQE reports a scalar, so there is no distribution to
compare and no reference circuit to be unitarily equivalent to. Until 2026-07-20
that meant **every VQE this product ever ran could only grade `structural`**: a
passing verdict whose whole content was "the result dict has the promised keys".

This module is the missing side. The planner writes the Hamiltonian down as Pauli
terms before any code exists; numpy diagonalizes it; the reported energy is
compared against the true ground-state eigenvalue. The reference is *data we
parse*, never code we run — the same discipline `verify_exact` applies to
reference OpenQASM, and for the same reason: a reference that has to be executed
to mean anything admits a second piece of model-authored code as ground truth.

**What it proves, and what it does not.** It proves the reported number is the
minimum eigenvalue of the operator the plan declared. It cannot prove the plan
declared the right operator — reference and implementation share an author, so
this is `plan_declared`-strength evidence, exactly like `exact`'s weaker source.
And note the spectrum of a Pauli Hamiltonian is invariant under permuting qubits,
so unlike the circuit checks this one cannot catch a wire-ordering mistake. It
catches the failure that actually dominates variational runs: converging to an
excited state, or to no state at all.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

_PAULI: dict[str, np.ndarray] = {
    "I": np.array([[1, 0], [0, 1]], dtype=np.complex128),
    "X": np.array([[0, 1], [1, 0]], dtype=np.complex128),
    "Y": np.array([[0, -1j], [1j, 0]], dtype=np.complex128),
    "Z": np.array([[1, 0], [0, -1]], dtype=np.complex128),
}

# 10 qubits materializes one 1024x1024 complex128 matrix (16 MB) and eigvalsh
# needs a workspace of the same order. 12 would be 268 MB apiece, which the
# worker does not have to spare. Pinned here and re-exported through
# majorana_contracts.plan so a plan can never request a check the verifier is
# forced to fail — the shape that burned four run budgets before #90.
EXACT_DIAG_MAX_QUBITS = 10


class HamiltonianError(ValueError):
    """The declared terms are not a Hamiltonian this module can diagonalize."""


def hamiltonian_matrix(terms: list[tuple[float, str]]) -> np.ndarray:
    """Dense matrix of `sum(coefficient * PauliString)`.

    Qubit 0 is the LEFTMOST character of each Pauli string, so "ZI" is Z on qubit
    0 and identity on qubit 1. Stated because a convention nobody wrote down is a
    convention someone will read backwards (standing lesson 10) — though for this
    check specifically the choice is unobservable: relabelling qubits conjugates
    the matrix by a permutation and leaves the spectrum alone.
    """
    if not terms:
        raise HamiltonianError("no Pauli terms were supplied")
    width = len(terms[0][1])
    if width == 0:
        raise HamiltonianError("a Pauli string cannot be empty")
    if width > EXACT_DIAG_MAX_QUBITS:
        raise HamiltonianError(
            f"{width} qubits exceeds the exact-diagonalization ceiling of {EXACT_DIAG_MAX_QUBITS}"
        )
    dimension = 1 << width
    matrix = np.zeros((dimension, dimension), dtype=np.complex128)
    for coefficient, pauli in terms:
        if len(pauli) != width:
            raise HamiltonianError(
                f"Pauli strings must all act on the same number of qubits; got "
                f"{len(pauli)} for '{pauli}' after {width}"
            )
        if not math.isfinite(coefficient):
            raise HamiltonianError(f"coefficient for '{pauli}' is not a finite number")
        operator = np.array([[1.0 + 0j]])
        for character in pauli:
            factor = _PAULI.get(character.upper())
            if factor is None:
                raise HamiltonianError(
                    f"'{character}' in '{pauli}' is not a Pauli operator; use I, X, Y or Z"
                )
            operator = np.kron(operator, factor)
        matrix += coefficient * operator
    return matrix


def ground_state_energy(terms: list[tuple[float, str]]) -> float:
    """Smallest eigenvalue of the declared Hamiltonian.

    `eigvalsh`, not `eigvals`: real coefficients times Hermitian Pauli strings are
    Hermitian by construction, and the symmetric routine both returns sorted real
    eigenvalues and cannot hand back a spurious imaginary part for a matrix that
    has none.
    """
    return float(np.linalg.eigvalsh(hamiltonian_matrix(terms))[0])


def energy_tolerance(terms: list[tuple[float, str]], shots: int | None) -> float:
    """How far a correct variational run may honestly land from the true minimum.

    Two independent budgets, added:

    - **Shot noise.** Each Pauli expectation is estimated from finite samples with
      variance at most 1/shots, so the energy's standard error is bounded by
      `sqrt(sum(c**2)/shots)`. Four of those is a wide interval on purpose.
    - **Optimizer slack**, 2% of the Hamiltonian's scale `sum(|c|)`. A classical
      optimizer stopping near, not at, the minimum is correct behaviour, and a
      bound that forbade it would fail correct code — the one outcome this
      codebase treats as worse than the alternative.

    Deliberately loose. It is not trying to certify convergence quality; it is
    trying to catch a run that converged to an excited state or to nothing, which
    is the failure that actually happens. The number lands in the evidence so a
    reader can see how much slack was allowed.
    """
    sum_of_squares = sum(coefficient**2 for coefficient, _ in terms)
    scale = sum(abs(coefficient) for coefficient, _ in terms)
    shot_noise = 4.0 * math.sqrt(sum_of_squares / shots) if shots and shots > 0 else 0.0
    return shot_noise + 0.02 * scale


def ground_state_comparison(
    terms: list[tuple[float, str]],
    reported_energy: float,
    *,
    tolerance: float,
    tolerance_source: str,
) -> tuple[bool, dict[str, Any]]:
    """Compare a reported energy against the declared Hamiltonian's true minimum.

    Returns (passed, details). The details name which SIDE the disagreement is on,
    because the two sides are different bugs with different repairs and a bare
    absolute error says neither (standing lesson 12):

    - below the minimum — variationally impossible. The energy estimator is wrong,
      or the code is not measuring the Hamiltonian it was asked to.
    - above the minimum — the optimizer did not reach the ground state, most often
      because it converged into an excited eigenvalue.
    """
    exact = ground_state_energy(terms)
    error = reported_energy - exact
    details: dict[str, Any] = {
        "protocol": {
            "name": "exact_diagonalization",
            "qubits": len(terms[0][1]),
            "terms": len(terms),
            "tolerance": tolerance,
            "tolerance_source": tolerance_source,
        },
        "scores": {
            "exact_ground_state_energy": exact,
            "reported_energy": reported_energy,
            "absolute_error": abs(error),
        },
        "evidence_scope": (
            "the reported energy is the minimum eigenvalue of the Hamiltonian the "
            "planner declared; reference and implementation share an author"
        ),
    }
    if abs(error) <= tolerance:
        return True, details
    if error < 0:
        spectrum = np.linalg.eigvalsh(hamiltonian_matrix(terms))
        details["disagreement"] = (
            f"the reported energy {reported_energy:.6f} is BELOW the true ground "
            f"state {exact:.6f}, which no variational method can reach. The energy "
            "estimator is wrong, not the optimizer: check the sign and grouping of "
            "each Pauli term, that expectation values are normalized by the total "
            "shot count, and that each term is measured in its own basis (apply H "
            "before measuring X, S-dagger then H before measuring Y)."
        )
        details["scores"]["spectrum"] = [float(value) for value in spectrum[:8]]
        return False, details
    spectrum = np.linalg.eigvalsh(hamiltonian_matrix(terms))
    nearest = min(spectrum, key=lambda value: abs(value - reported_energy))
    details["scores"]["spectrum"] = [float(value) for value in spectrum[:8]]
    details["scores"]["nearest_eigenvalue"] = float(nearest)
    if abs(nearest - reported_energy) <= tolerance and not math.isclose(nearest, exact):
        details["disagreement"] = (
            f"the reported energy {reported_energy:.6f} matches the EXCITED "
            f"eigenvalue {float(nearest):.6f}, not the ground state {exact:.6f}. The "
            "estimator is measuring the Hamiltonian correctly and the optimizer "
            "settled in the wrong minimum: widen the ansatz or restart it from "
            "several initial parameter vectors and keep the lowest energy."
        )
    else:
        details["disagreement"] = (
            f"the reported energy {reported_energy:.6f} is {abs(error):.6f} above "
            f"the true ground state {exact:.6f}, more than the {tolerance:.6f} this "
            "run is allowed for shot noise and optimizer slack, and it does not "
            "match any eigenvalue of the declared Hamiltonian. Check that every "
            "term's expectation is being measured and summed with its coefficient."
        )
    return False, details
