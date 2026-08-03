"""Independent dense baselines for bounded real quantum linear-system tasks."""

from __future__ import annotations

import math
from collections.abc import Mapping

import numpy as np
from majorana_contracts.plan import ExactLinearSystemReference, LinearSystemResultSpec

EXACT_LINEAR_SYSTEM_TOLERANCE = 0.01
EXACT_LINEAR_SYSTEM_MAX_CONDITION = 1e10
_CANONICAL_PHASE_TIE_ATOL = 1e-12


class LinearSystemReferenceError(ValueError):
    """The declared matrix or protected RESULT cannot be evaluated honestly."""


def _canonical_normalized_solution(solution: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(solution))
    if not math.isfinite(norm) or norm <= 1e-15:
        raise LinearSystemReferenceError("linear-system solution has zero or non-finite norm")
    normalized = solution / norm
    magnitudes = np.abs(normalized)
    maximum = float(np.max(magnitudes))
    # Independent circuit and dense solves can perturb exactly tied magnitudes in
    # opposite directions. Choose the lowest index among numerical ties so a global
    # sign convention cannot turn the same physical state into a false mismatch.
    pivot = int(
        np.flatnonzero(np.isclose(magnitudes, maximum, rtol=0.0, atol=_CANONICAL_PHASE_TIE_ATOL))[0]
    )
    if normalized[pivot] < 0:
        normalized = -normalized
    return normalized


def exact_linear_system_values(
    reference: ExactLinearSystemReference,
) -> tuple[dict[str, float], dict[str, float]]:
    """Solve the declared system and derive each bound scalar."""

    matrix = np.asarray(reference.matrix, dtype=float)
    rhs = np.asarray(reference.rhs, dtype=float)
    try:
        condition = float(np.linalg.cond(matrix))
        if not math.isfinite(condition) or condition > EXACT_LINEAR_SYSTEM_MAX_CONDITION:
            raise LinearSystemReferenceError(
                f"linear-system condition number {condition} exceeds the bounded reference"
            )
        solution = np.linalg.solve(matrix, rhs)
    except np.linalg.LinAlgError as exc:
        raise LinearSystemReferenceError("linear-system matrix is singular") from exc
    normalized = _canonical_normalized_solution(solution)
    residual = float(np.linalg.norm(matrix @ solution - rhs))

    values: dict[str, float] = {}
    for spec in reference.results:
        values[spec.result_key] = _result_value(
            spec,
            solution=solution,
            normalized=normalized,
            residual=residual,
        )
    return values, {"condition_number": condition, "solution_norm": float(np.linalg.norm(solution))}


def linear_system_references_equivalent(
    first: ExactLinearSystemReference,
    second: ExactLinearSystemReference,
) -> tuple[bool, dict[str, object]]:
    """Compare problem data and RESULT meanings, without comparing only answers."""

    first_matrix = np.asarray(first.matrix, dtype=float)
    second_matrix = np.asarray(second.matrix, dtype=float)
    if first_matrix.shape != second_matrix.shape:
        return False, {"reason": "linear_system_dimension_mismatch"}
    if not np.allclose(first_matrix, second_matrix, rtol=0.0, atol=1e-12):
        return False, {"reason": "linear_system_matrix_mismatch"}
    if not np.allclose(
        np.asarray(first.rhs, dtype=float),
        np.asarray(second.rhs, dtype=float),
        rtol=0.0,
        atol=1e-12,
    ):
        return False, {"reason": "linear_system_rhs_mismatch"}

    first_results = {result.result_key: result for result in first.results}
    second_results = {result.result_key: result for result in second.results}
    if first_results.keys() != second_results.keys():
        return False, {"reason": "linear_system_result_key_mismatch"}
    for key, first_result in first_results.items():
        second_result = second_results[key]
        if first_result.metric != second_result.metric:
            return False, {
                "reason": "linear_system_result_metric_mismatch",
                "result_key": key,
            }
        if (
            first_result.index,
            first_result.numerator_index,
            first_result.denominator_index,
        ) != (
            second_result.index,
            second_result.numerator_index,
            second_result.denominator_index,
        ):
            return False, {
                "reason": "linear_system_result_target_mismatch",
                "result_key": key,
            }
    return True, {
        "reason": "equivalent_linear_system_problem",
        "dimension": first_matrix.shape[0],
        "results": len(first_results),
    }


def _result_value(
    spec: LinearSystemResultSpec,
    *,
    solution: np.ndarray,
    normalized: np.ndarray,
    residual: float,
) -> float:
    if spec.metric == "normalized_solution_component":
        assert spec.index is not None
        return float(normalized[spec.index])
    if spec.metric == "solution_component":
        assert spec.index is not None
        return float(solution[spec.index])
    if spec.metric == "component_ratio":
        assert spec.numerator_index is not None and spec.denominator_index is not None
        denominator = float(normalized[spec.denominator_index])
        if abs(denominator) <= 1e-15:
            raise LinearSystemReferenceError("declared component ratio divides by zero")
        return float(normalized[spec.numerator_index] / denominator)
    if spec.metric == "residual_norm":
        return residual
    if spec.metric == "state_fidelity":
        return 1.0
    raise LinearSystemReferenceError(f"unsupported linear-system metric {spec.metric!r}")


def exact_linear_system_comparison(
    reference: ExactLinearSystemReference,
    result: Mapping[str, object],
    *,
    tolerance: float = EXACT_LINEAR_SYSTEM_TOLERANCE,
) -> tuple[bool, dict[str, object]]:
    """Compare all declared RESULT scalars against one independently solved system."""

    exact, diagnostics = exact_linear_system_values(reference)
    scores: dict[str, dict[str, float | str | int]] = {}
    disagreements: list[str] = []
    specs = {spec.result_key: spec for spec in reference.results}
    for key, expected in exact.items():
        observed = result.get(key)
        # Every declared key gets a `scores` entry even when the RESULT value is
        # unusable, because the caller reads `scores[primary_metric]["exact"]` to
        # decide whether the Plan's expected_range excludes the truth. Skipping the
        # entry made that an uncaught KeyError for a RESULT that reported the metric
        # as a string, null or bool — present, so the caller's `metric not in result`
        # guard let it through — which crashed the review step instead of returning
        # the honest verdict the repair loop needs. `exact_lindblad_comparison`
        # records the entry on this path; this is the same contract.
        if isinstance(observed, bool) or not isinstance(observed, int | float):
            disagreements.append(f"{key}: finite numeric RESULT value is missing")
            scores[key] = {"metric": specs[key].metric, "exact": expected, "reported": "missing"}
            continue
        reported = float(observed)
        if not math.isfinite(reported):
            disagreements.append(f"{key}: RESULT value is not finite")
            scores[key] = {
                "metric": specs[key].metric,
                "exact": expected,
                "reported": "not_finite",
            }
            continue
        error = abs(reported - expected)
        scores[key] = {
            "metric": specs[key].metric,
            "exact": expected,
            "reported": reported,
            "absolute_error": error,
        }
        if error > tolerance and not math.isclose(
            reported,
            expected,
            rel_tol=0.0,
            abs_tol=tolerance,
        ):
            disagreements.append(
                f"{key}: reported {reported} differs from exact {expected} by {error}"
            )
    return not disagreements, {
        "protocol": {
            "name": "exact_dense_linear_system",
            "dimension": len(reference.matrix),
            "tolerance": tolerance,
            "phase_convention": (
                "lowest_index_within_1e-12_of_largest_magnitude_component_positive"
            ),
        },
        "scores": scores,
        "diagnostics": diagnostics,
        "disagreements": disagreements,
    }
