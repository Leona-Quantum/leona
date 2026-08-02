"""Exact bounded Lindblad evolution from typed data, independent of candidate code."""

from __future__ import annotations

import math
from typing import Any, Literal, NotRequired, TypedDict

import numpy as np
from scipy.linalg import expm

EXACT_LINDBLAD_MAX_QUBITS = 3
_RELATIVE_TOLERANCE = 1e-9

LocalOperator = Literal[
    "X",
    "Y",
    "Z",
    "lowering",
    "raising",
    "projector_zero",
    "projector_one",
]
ProductState = Literal["zero", "one", "plus", "minus", "plus_i", "minus_i"]
OperatorSpec = list[tuple[complex, list[tuple[int, LocalOperator | str]]]]
DissipatorSpec = tuple[float, OperatorSpec]
ResultSpec = dict[str, Any]


class LindbladSpecification(TypedDict):
    num_qubits: int
    initial_product_state: list[ProductState | str]
    hamiltonian: NotRequired[OperatorSpec | None]
    dissipators: list[DissipatorSpec]
    evolution_time: float
    results: list[ResultSpec]


class LindbladReferenceError(ValueError):
    """The declared generator or result cannot be evaluated exactly as typed."""


_I = np.eye(2, dtype=np.complex128)
_LOCAL_OPERATORS: dict[str, np.ndarray] = {
    "X": np.array([[0, 1], [1, 0]], dtype=np.complex128),
    "Y": np.array([[0, -1j], [1j, 0]], dtype=np.complex128),
    "Z": np.array([[1, 0], [0, -1]], dtype=np.complex128),
    # Basis order |0>,|1>: lowering maps |1> to |0>.
    "lowering": np.array([[0, 1], [0, 0]], dtype=np.complex128),
    "raising": np.array([[0, 0], [1, 0]], dtype=np.complex128),
    "projector_zero": np.array([[1, 0], [0, 0]], dtype=np.complex128),
    "projector_one": np.array([[0, 0], [0, 1]], dtype=np.complex128),
}
_PRODUCT_STATES: dict[str, np.ndarray] = {
    "zero": np.array([1, 0], dtype=np.complex128),
    "one": np.array([0, 1], dtype=np.complex128),
    "plus": np.array([1, 1], dtype=np.complex128) / np.sqrt(2),
    "minus": np.array([1, -1], dtype=np.complex128) / np.sqrt(2),
    "plus_i": np.array([1, 1j], dtype=np.complex128) / np.sqrt(2),
    "minus_i": np.array([1, -1j], dtype=np.complex128) / np.sqrt(2),
}


def _validated_width(num_qubits: int) -> int:
    if not 1 <= num_qubits <= EXACT_LINDBLAD_MAX_QUBITS:
        raise LindbladReferenceError(
            f"{num_qubits} qubits is outside the exact-Lindblad ceiling of "
            f"{EXACT_LINDBLAD_MAX_QUBITS}"
        )
    return num_qubits


def operator_matrix(operator: OperatorSpec, num_qubits: int) -> np.ndarray:
    """Materialize a complex operator sum with q0 as the leftmost tensor factor."""

    width = _validated_width(num_qubits)
    if not operator:
        raise LindbladReferenceError("operator has no terms")
    result = np.zeros((1 << width, 1 << width), dtype=np.complex128)
    for coefficient, factors in operator:
        if not math.isfinite(coefficient.real) or not math.isfinite(coefficient.imag):
            raise LindbladReferenceError("operator coefficient is not finite")
        indices = [index for index, _ in factors]
        if len(indices) != len(set(indices)):
            raise LindbladReferenceError("operator term contains duplicate qubit factors")
        local = [_I] * width
        for index, name in factors:
            if not 0 <= index < width:
                raise LindbladReferenceError(
                    f"operator factor q{index} lies outside the {width}-qubit register"
                )
            try:
                local[index] = _LOCAL_OPERATORS[name]
            except KeyError as exc:
                raise LindbladReferenceError(f"unsupported local operator {name!r}") from exc
        term = local[0]
        for factor in local[1:]:
            term = np.kron(term, factor)
        result += coefficient * term
    return result


def _initial_density(states: list[ProductState | str], num_qubits: int) -> np.ndarray:
    width = _validated_width(num_qubits)
    if len(states) != width:
        raise LindbladReferenceError("initial product state must contain one state per qubit")
    try:
        vector = _PRODUCT_STATES[states[0]]
        for state in states[1:]:
            vector = np.kron(vector, _PRODUCT_STATES[state])
    except KeyError as exc:
        raise LindbladReferenceError(f"unsupported product state {exc.args[0]!r}") from exc
    return np.outer(vector, vector.conj())


def _liouvillian(
    num_qubits: int,
    hamiltonian: OperatorSpec | None,
    dissipators: list[DissipatorSpec],
) -> tuple[np.ndarray, np.ndarray]:
    width = _validated_width(num_qubits)
    dimension = 1 << width
    identity = np.eye(dimension, dtype=np.complex128)
    if hamiltonian is None:
        h_matrix = np.zeros((dimension, dimension), dtype=np.complex128)
    else:
        h_matrix = operator_matrix(hamiltonian, width)
        if not np.allclose(h_matrix, h_matrix.conj().T, rtol=0.0, atol=1e-11):
            raise LindbladReferenceError("Hamiltonian is not Hermitian")
    generator = -1j * (np.kron(identity, h_matrix) - np.kron(h_matrix.T, identity))
    if not dissipators:
        raise LindbladReferenceError("no Lindblad dissipators were supplied")
    for rate, jump in dissipators:
        if not math.isfinite(rate) or rate <= 0:
            raise LindbladReferenceError("dissipator rate must be finite and positive")
        jump_matrix = operator_matrix(jump, width)
        number = jump_matrix.conj().T @ jump_matrix
        generator += rate * (
            np.kron(jump_matrix.conj(), jump_matrix)
            - 0.5 * np.kron(identity, number)
            - 0.5 * np.kron(number.T, identity)
        )
    return generator, h_matrix


def evolved_density_matrix(
    num_qubits: int,
    initial_product_state: list[ProductState | str],
    dissipators: list[DissipatorSpec],
    evolution_time: float,
    *,
    hamiltonian: OperatorSpec | None = None,
) -> np.ndarray:
    """Evaluate rho(t)=exp(t*L)rho(0) using column-major vectorization."""

    if not math.isfinite(evolution_time) or evolution_time < 0:
        raise LindbladReferenceError("evolution time must be finite and nonnegative")
    initial = _initial_density(initial_product_state, num_qubits)
    generator, _ = _liouvillian(num_qubits, hamiltonian, dissipators)
    evolved_vector = expm(evolution_time * generator) @ initial.reshape(-1, order="F")
    dimension = 1 << num_qubits
    evolved = evolved_vector.reshape((dimension, dimension), order="F")
    evolved = (evolved + evolved.conj().T) / 2
    trace = np.trace(evolved)
    if abs(trace - 1.0) > 1e-9:
        raise LindbladReferenceError(f"evolved density matrix has trace {trace!r}, not one")
    eigenvalues = np.linalg.eigvalsh(evolved)
    if float(eigenvalues.min()) < -1e-9:
        raise LindbladReferenceError("evolved density matrix is not positive semidefinite")
    return evolved / trace.real


def _basis_index(state: Any, num_qubits: int, field: str) -> int:
    if not isinstance(state, str) or len(state) != num_qubits or set(state) - {"0", "1"}:
        raise LindbladReferenceError(f"{field} must be a {num_qubits}-bit basis state")
    return int(state, 2)


def exact_lindblad_values(
    num_qubits: int,
    initial_product_state: list[ProductState | str],
    dissipators: list[DissipatorSpec],
    evolution_time: float,
    results: list[ResultSpec],
    *,
    hamiltonian: OperatorSpec | None = None,
) -> dict[str, float]:
    """Compute every declared protected RESULT scalar from one exact rho(t)."""

    density = evolved_density_matrix(
        num_qubits,
        initial_product_state,
        dissipators,
        evolution_time,
        hamiltonian=hamiltonian,
    )
    values: dict[str, float] = {}
    for result in results:
        key = result.get("result_key")
        metric = result.get("metric")
        if not isinstance(key, str) or not key or key in values:
            raise LindbladReferenceError("Lindblad result keys must be nonempty and unique")
        if metric == "population":
            index = _basis_index(result.get("basis_state"), num_qubits, "basis_state")
            value = density[index, index]
        elif metric in {"density_element_real", "density_element_imag"}:
            row = _basis_index(result.get("row_state"), num_qubits, "row_state")
            column = _basis_index(result.get("column_state"), num_qubits, "column_state")
            element = density[row, column]
            values[key] = float(element.real if metric.endswith("real") else element.imag)
            continue
        elif metric == "purity":
            value = np.trace(density @ density)
        elif metric == "observable_expectation":
            observable = result.get("observable")
            if not isinstance(observable, list):
                raise LindbladReferenceError("observable_expectation requires an operator")
            matrix = operator_matrix(observable, num_qubits)
            if not np.allclose(matrix, matrix.conj().T, rtol=0.0, atol=1e-11):
                raise LindbladReferenceError("result observable is not Hermitian")
            value = np.trace(density @ matrix)
        else:
            raise LindbladReferenceError(f"unsupported Lindblad result metric {metric!r}")
        scale = max(1.0, float(np.linalg.norm(density, ord="fro")))
        if abs(float(value.imag)) > 1e-10 * scale:
            raise LindbladReferenceError(f"Lindblad result {key!r} has a numerical imaginary part")
        values[key] = float(value.real)
    return values


def _result_semantics(results: list[ResultSpec], num_qubits: int) -> dict[str, tuple[Any, ...]]:
    semantics: dict[str, tuple[Any, ...]] = {}
    for result in results:
        key = result.get("result_key")
        metric = result.get("metric")
        if not isinstance(key, str) or key in semantics:
            raise LindbladReferenceError("Lindblad result keys must be unique")
        if metric == "observable_expectation":
            observable = result.get("observable")
            if not isinstance(observable, list):
                raise LindbladReferenceError("observable result is missing its operator")
            semantics[key] = (metric, operator_matrix(observable, num_qubits))
        elif metric == "population":
            semantics[key] = (
                metric,
                _basis_index(result.get("basis_state"), num_qubits, "basis_state"),
            )
        elif metric in {"density_element_real", "density_element_imag"}:
            semantics[key] = (
                metric,
                _basis_index(result.get("row_state"), num_qubits, "row_state"),
                _basis_index(result.get("column_state"), num_qubits, "column_state"),
            )
        elif metric == "purity":
            semantics[key] = (metric,)
        else:
            raise LindbladReferenceError(f"unsupported Lindblad result metric {metric!r}")
    return semantics


def lindblad_references_equivalent(
    first: LindbladSpecification,
    second: LindbladSpecification,
) -> tuple[bool, dict[str, Any]]:
    """Require equal initial data, generator, time, and requested result meanings."""

    if first["num_qubits"] != second["num_qubits"]:
        return False, {"reason": "num_qubits_mismatch"}
    width = first["num_qubits"]
    first_initial = _initial_density(first["initial_product_state"], width)
    second_initial = _initial_density(second["initial_product_state"], width)
    if not np.allclose(first_initial, second_initial, rtol=0.0, atol=1e-11):
        return False, {"reason": "initial_state_mismatch"}
    first_generator, _ = _liouvillian(width, first.get("hamiltonian"), first["dissipators"])
    second_generator, _ = _liouvillian(width, second.get("hamiltonian"), second["dissipators"])
    if not np.allclose(first_generator, second_generator, rtol=0.0, atol=1e-10):
        return False, {"reason": "lindblad_generator_mismatch"}
    if not math.isclose(
        first["evolution_time"], second["evolution_time"], rel_tol=0.0, abs_tol=1e-12
    ):
        return False, {"reason": "evolution_time_mismatch"}
    first_results = _result_semantics(first["results"], width)
    second_results = _result_semantics(second["results"], width)
    if first_results.keys() != second_results.keys():
        return False, {"reason": "result_key_mismatch"}
    for key, first_semantics in first_results.items():
        second_semantics = second_results[key]
        if first_semantics[0] != second_semantics[0]:
            return False, {"reason": "result_metric_mismatch", "result_key": key}
        if first_semantics[0] == "observable_expectation":
            if not np.allclose(first_semantics[1], second_semantics[1], rtol=0.0, atol=1e-11):
                return False, {"reason": "result_observable_mismatch", "result_key": key}
        elif first_semantics != second_semantics:
            return False, {"reason": "result_target_mismatch", "result_key": key}
    return True, {
        "reason": "equivalent_lindblad_problem",
        "num_qubits": width,
        "liouvillian_dimension": 4**width,
        "results": len(first_results),
    }


def exact_lindblad_comparison(
    specification: LindbladSpecification,
    reported_values: dict[str, Any],
) -> tuple[bool, dict[str, Any]]:
    """Compare every declared scalar with a fixed floating-point-only tolerance."""

    exact = exact_lindblad_values(**specification)
    scores: dict[str, Any] = {}
    failures: list[str] = []
    for key, expected in exact.items():
        observed = reported_values.get(key)
        if (
            isinstance(observed, bool)
            or not isinstance(observed, int | float)
            or not math.isfinite(float(observed))
        ):
            failures.append(f"{key}: finite numeric RESULT value is missing")
            scores[key] = {"exact": expected, "reported": observed}
            continue
        tolerance = _RELATIVE_TOLERANCE * max(1.0, abs(expected))
        error = abs(float(observed) - expected)
        scores[key] = {
            "exact": expected,
            "reported": float(observed),
            "absolute_error": error,
            "tolerance": tolerance,
        }
        if error > tolerance:
            failures.append(
                f"{key}: reported {float(observed):.12g} differs from exact "
                f"{expected:.12g} by {error:.6g}"
            )
    details: dict[str, Any] = {
        "protocol": {
            "name": "exact_lindblad_evolution",
            "qubits": specification["num_qubits"],
            "liouvillian_dimension": 4 ** specification["num_qubits"],
            "dissipators": len(specification["dissipators"]),
            "results": len(exact),
            "evolution_time": specification["evolution_time"],
            "tolerance_source": "floating_point_only",
            "basis_order": "q0_leftmost; local |0>,|1>",
        },
        "scores": scores,
        "evidence_scope": (
            "all declared scalars match exact evolution of the independently "
            "reconciled typed Lindblad problem"
        ),
    }
    if failures:
        details["disagreements"] = failures
        return False, details
    return True, details
