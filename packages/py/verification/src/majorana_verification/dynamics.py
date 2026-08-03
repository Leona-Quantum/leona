"""Deterministic finite-time scalar references for small Pauli systems.

This is deliberately a data-to-number path. It never imports or executes the
candidate program: a dense NumPy eigendecomposition evolves the basis state the
Plan declared, and the worker compares that value with protected RESULT evidence.
The reference remains Plan-authored, so this catches implementation disagreement
but does not prove that the model transcribed the user's operator correctly.
"""

from __future__ import annotations

import math
from typing import Any, Literal

import numpy as np

from majorana_verification.hamiltonian import HamiltonianError, hamiltonian_matrix

EXACT_DYNAMICS_MAX_QUBITS = 8
_RELATIVE_TOLERANCE = 1e-9

DynamicsMetric = Literal["survival_probability", "observable_expectation"]


class DynamicsReferenceError(ValueError):
    """The declared finite-time reference cannot be evaluated as typed."""


def _validated_width(terms: list[tuple[float, str]], initial_basis_state: str) -> int:
    if not terms:
        raise DynamicsReferenceError("no Hamiltonian terms were supplied")
    widths = {len(pauli) for _, pauli in terms}
    if len(widths) != 1:
        raise DynamicsReferenceError("Hamiltonian Pauli strings use different widths")
    width = widths.pop()
    if width > EXACT_DYNAMICS_MAX_QUBITS:
        raise DynamicsReferenceError(
            f"{width} qubits exceeds the exact-dynamics ceiling of {EXACT_DYNAMICS_MAX_QUBITS}"
        )
    if len(initial_basis_state) != width or set(initial_basis_state) - {"0", "1"}:
        raise DynamicsReferenceError(
            f"initial basis state must contain exactly {width} binary digits"
        )
    return width


def exact_dynamics_value(
    terms: list[tuple[float, str]],
    initial_basis_state: str,
    evolution_time: float,
    metric: DynamicsMetric | str,
    observable: list[tuple[float, str]] | None = None,
) -> float:
    """Compute one exact scalar under ``U=exp(-i*t*H)``.

    Qubit 0 is the leftmost Pauli character and the leftmost basis-state bit,
    matching ``hamiltonian_matrix``. Hermitian eigendecomposition avoids a SciPy
    runtime dependency while producing the same exact dense evolution.
    """

    width = _validated_width(terms, initial_basis_state)
    if not math.isfinite(evolution_time):
        raise DynamicsReferenceError("evolution time is not finite")
    if metric not in ("survival_probability", "observable_expectation"):
        raise DynamicsReferenceError(f"unsupported exact-dynamics metric {metric!r}")

    try:
        hamiltonian = hamiltonian_matrix(terms)
    except HamiltonianError as exc:
        raise DynamicsReferenceError(str(exc)) from exc
    initial = np.zeros(1 << width, dtype=np.complex128)
    initial[int(initial_basis_state, 2)] = 1.0
    eigenvalues, eigenvectors = np.linalg.eigh(hamiltonian)
    eigenbasis_state = eigenvectors.conj().T @ initial
    evolved = eigenvectors @ (np.exp(-1j * evolution_time * eigenvalues) * eigenbasis_state)

    if metric == "survival_probability":
        if observable is not None:
            raise DynamicsReferenceError("survival_probability does not use an observable")
        value = float(abs(np.vdot(initial, evolved)) ** 2)
        # Eigensolver roundoff can produce 1+epsilon or -epsilon. Clamp only that
        # representation noise; a materially invalid probability is an error.
        if value < -1e-12 or value > 1.0 + 1e-12:
            raise DynamicsReferenceError("computed survival probability is outside [0, 1]")
        return min(1.0, max(0.0, value))

    if not observable:
        raise DynamicsReferenceError("observable_expectation requires observable terms")
    if {len(pauli) for _, pauli in observable} != {width}:
        raise DynamicsReferenceError(
            f"observable Pauli strings must all use the Hamiltonian's {width}-qubit width"
        )
    try:
        operator = hamiltonian_matrix(observable)
    except HamiltonianError as exc:
        raise DynamicsReferenceError(str(exc)) from exc
    complex_value = np.vdot(evolved, operator @ evolved)
    scale = max(1.0, sum(abs(coefficient) for coefficient, _ in observable))
    if abs(float(complex_value.imag)) > 1e-10 * scale:
        raise DynamicsReferenceError("observable expectation has a non-numerical imaginary part")
    return float(complex_value.real)


def exact_dynamics_tolerance(
    metric: DynamicsMetric | str,
    observable: list[tuple[float, str]] | None = None,
) -> float:
    """Floating-point allowance only; the model cannot loosen this bound."""

    if metric == "survival_probability":
        scale = 1.0
    elif metric == "observable_expectation" and observable:
        scale = max(1.0, sum(abs(coefficient) for coefficient, _ in observable))
    else:
        raise DynamicsReferenceError("metric and observable do not form a dynamics scalar")
    return _RELATIVE_TOLERANCE * scale


def exact_dynamics_comparison(
    terms: list[tuple[float, str]],
    initial_basis_state: str,
    evolution_time: float,
    metric: DynamicsMetric | str,
    observable: list[tuple[float, str]] | None,
    reported_value: float,
) -> tuple[bool, dict[str, Any]]:
    """Compare protected RESULT against the independently computed Plan reference."""

    if isinstance(reported_value, bool) or not isinstance(reported_value, int | float):
        raise DynamicsReferenceError("reported dynamics value is not numeric")
    if not math.isfinite(float(reported_value)):
        raise DynamicsReferenceError("reported dynamics value is not finite")
    exact = exact_dynamics_value(
        terms,
        initial_basis_state,
        evolution_time,
        metric,
        observable,
    )
    tolerance = exact_dynamics_tolerance(metric, observable)
    error = float(reported_value) - exact
    details: dict[str, Any] = {
        "protocol": {
            "name": "exact_pauli_dynamics",
            "qubits": len(initial_basis_state),
            "hamiltonian_terms": len(terms),
            "metric": metric,
            "observable_terms": len(observable or []),
            "evolution_time": evolution_time,
            "tolerance": tolerance,
            "tolerance_source": "floating_point_only",
            "tensor_convention": "q0_leftmost",
        },
        "scores": {
            "exact_dynamics_value": exact,
            "reported_value": float(reported_value),
            "absolute_error": abs(error),
        },
        "evidence_scope": (
            "the reported scalar matches exact evolution of the Plan-declared Pauli "
            "system; request-to-reference transcription is separately model-audited"
        ),
    }
    if abs(error) <= tolerance:
        return True, details
    details["disagreement"] = (
        f"reported {float(reported_value):.12g} differs from exact {exact:.12g} by "
        f"{abs(error):.6g}, beyond floating-point tolerance {tolerance:.3g}; check "
        "Pauli/tensor ordering, the basis-state index, evolution sign/time, and the "
        "reported observable"
    )
    return False, details
