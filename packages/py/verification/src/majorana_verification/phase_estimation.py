"""Deterministic checks for noiseless, exactly representable QPE phases."""

from __future__ import annotations

import math
from collections.abc import Mapping

from majorana_contracts.plan import ExactPhaseEstimationReference

EXACT_QPE_MIN_PEAK_PROBABILITY = 0.99


class PhaseEstimationReferenceError(ValueError):
    """The declared QPE reference or protected RESULT cannot be evaluated."""


def _finite_number(result: Mapping[str, object], key: str) -> float:
    value = result.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise PhaseEstimationReferenceError(f"{key}: finite numeric RESULT value is missing")
    number = float(value)
    if not math.isfinite(number):
        raise PhaseEstimationReferenceError(f"{key}: RESULT value is not finite")
    return number


def _counts(result: Mapping[str, object], key: str, width: int) -> dict[str, int]:
    raw = result.get(key)
    if not isinstance(raw, Mapping) or not raw:
        raise PhaseEstimationReferenceError(f"{key}: non-empty count mapping is missing")
    counts: dict[str, int] = {}
    for raw_bitstring, raw_count in raw.items():
        if not isinstance(raw_bitstring, str):
            raise PhaseEstimationReferenceError(f"{key}: count key is not a bitstring")
        bitstring = raw_bitstring.replace(" ", "")
        if len(bitstring) != width or set(bitstring) - {"0", "1"}:
            raise PhaseEstimationReferenceError(
                f"{key}: bitstring {raw_bitstring!r} does not have width {width}"
            )
        if isinstance(raw_count, bool) or not isinstance(raw_count, int) or raw_count < 0:
            raise PhaseEstimationReferenceError(
                f"{key}: count for {raw_bitstring!r} is not a nonnegative integer"
            )
        counts[bitstring] = counts.get(bitstring, 0) + raw_count
    if sum(counts.values()) <= 0:
        raise PhaseEstimationReferenceError(f"{key}: total shot count must be positive")
    return counts


def exact_phase_estimation_comparison(
    reference: ExactPhaseEstimationReference,
    result: Mapping[str, object],
    *,
    requested_shots: int | None = None,
) -> tuple[bool, dict[str, object]]:
    """Compare four bound RESULT fields with exact dyadic QPE truth.

    The peak probability is recomputed from protected counts rather than trusted as
    a model-authored scalar. A concentrated direct or reversed raw bitstring is
    accepted because register-to-classical-bit mapping is an artifact choice; the
    reported decoded integer and phase are checked independently.
    """

    scale = 1 << reference.counting_qubits
    scaled_phase = reference.eigenphase * scale
    expected_integer = int(round(scaled_phase)) % scale
    if not math.isclose(scaled_phase, round(scaled_phase), rel_tol=0.0, abs_tol=1e-10):
        raise PhaseEstimationReferenceError(
            "declared eigenphase is not exactly representable by the counting register"
        )

    phase_integer = _finite_number(result, reference.phase_integer_result_key)
    phase_estimate = _finite_number(result, reference.phase_estimate_result_key)
    reported_peak = _finite_number(result, reference.peak_probability_result_key)
    counts = _counts(result, reference.counts_result_key, reference.counting_qubits)
    total = sum(counts.values())
    dominant_bitstring, dominant_count = max(counts.items(), key=lambda item: item[1])
    observed_peak = dominant_count / total
    expected_bitstring = format(expected_integer, f"0{reference.counting_qubits}b")

    disagreements: list[str] = []
    if not math.isclose(phase_integer, expected_integer, rel_tol=0.0, abs_tol=1e-9):
        disagreements.append(
            f"{reference.phase_integer_result_key}: {phase_integer} != {expected_integer}"
        )
    if not math.isclose(
        phase_estimate,
        reference.eigenphase,
        rel_tol=0.0,
        abs_tol=1e-12,
    ):
        disagreements.append(
            f"{reference.phase_estimate_result_key}: {phase_estimate} != {reference.eigenphase}"
        )
    if not math.isclose(reported_peak, observed_peak, rel_tol=0.0, abs_tol=1e-12):
        disagreements.append(
            f"{reference.peak_probability_result_key}: reported {reported_peak} != "
            f"counts-derived {observed_peak}"
        )
    if observed_peak < EXACT_QPE_MIN_PEAK_PROBABILITY:
        disagreements.append(
            f"counts-derived peak probability {observed_peak} < "
            f"{EXACT_QPE_MIN_PEAK_PROBABILITY} for an exactly representable phase"
        )
    if requested_shots is not None and total != requested_shots:
        disagreements.append(f"counts total {total} != requested shots {requested_shots}")
    if dominant_bitstring not in {expected_bitstring, expected_bitstring[::-1]}:
        disagreements.append(
            f"dominant bitstring {dominant_bitstring!r} is neither the exact phase "
            f"encoding {expected_bitstring!r} nor its explicit register reversal"
        )

    return not disagreements, {
        "protocol": {
            "name": "exact_dyadic_phase_estimation",
            "counting_qubits": reference.counting_qubits,
            "minimum_peak_probability": EXACT_QPE_MIN_PEAK_PROBABILITY,
        },
        "scores": {
            "exact_phase_integer": expected_integer,
            "exact_phase_estimate": reference.eigenphase,
            "counts_derived_peak_probability": observed_peak,
            "reported_peak_probability": reported_peak,
            "counts_total": total,
            "dominant_bitstring": dominant_bitstring,
        },
        "disagreements": disagreements,
    }
