"""Exact dyadic QPE reference checks."""

import pytest
from majorana_contracts import ExactPhaseEstimationReference
from majorana_verification import (
    PhaseEstimationReferenceError,
    exact_phase_estimation_comparison,
)


def _reference() -> ExactPhaseEstimationReference:
    return ExactPhaseEstimationReference(
        counting_qubits=5,
        eigenphase=11 / 32,
        phase_integer_result_key="phase_integer",
        phase_estimate_result_key="phase_estimate",
        peak_probability_result_key="peak_probability",
        counts_result_key="counts",
    )


def test_exact_qpe_accepts_a_concentrated_protected_distribution():
    passed, details = exact_phase_estimation_comparison(
        _reference(),
        {
            "phase_integer": 11,
            "phase_estimate": 11 / 32,
            "peak_probability": 1.0,
            "counts": {"01011": 4096},
        },
        requested_shots=4096,
    )

    assert passed
    assert details["scores"]["exact_phase_integer"] == 11
    assert details["disagreements"] == []


def test_exact_qpe_rejects_the_diffuse_distribution_accepted_live():
    passed, details = exact_phase_estimation_comparison(
        _reference(),
        {
            "phase_integer": 11,
            "phase_estimate": 11 / 32,
            "peak_probability": 0.56884765625,
            "counts": {"01011": 2330, "00101": 1766},
        },
        requested_shots=4096,
    )

    assert not passed
    assert details["scores"]["counts_derived_peak_probability"] == pytest.approx(0.56884765625)
    assert any("exactly representable" in item for item in details["disagreements"])


def test_exact_qpe_does_not_trust_a_fabricated_peak_scalar():
    passed, details = exact_phase_estimation_comparison(
        _reference(),
        {
            "phase_integer": 11,
            "phase_estimate": 11 / 32,
            "peak_probability": 1.0,
            "counts": {"01011": 3000, "11010": 1096},
        },
        requested_shots=4096,
    )

    assert not passed
    assert any("reported 1.0" in item for item in details["disagreements"])


def test_exact_qpe_rejects_malformed_counts_without_inventing_evidence():
    with pytest.raises(PhaseEstimationReferenceError, match="width 5"):
        exact_phase_estimation_comparison(
            _reference(),
            {
                "phase_integer": 11,
                "phase_estimate": 11 / 32,
                "peak_probability": 1.0,
                "counts": {"1011": 4096},
            },
        )
