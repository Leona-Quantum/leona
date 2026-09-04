"""Unit tests for `shared.results`. These import no Qiskit and run in
milliseconds; `test_examples.py` covers the Qiskit-backed environment check."""

from __future__ import annotations

import pytest

from shared.results import probabilities, top_outcomes, within_band


def test_probabilities_basic() -> None:
    counts = {"0": 750, "1": 250}
    probs = probabilities(counts, shots=1000)
    assert probs["0"] == pytest.approx(0.75)
    assert probs["1"] == pytest.approx(0.25)


def test_probabilities_missing_outcome_is_simply_absent() -> None:
    # An outcome with zero occurrences is never in `counts` at all; the
    # caller decides whether to treat it as 0.0 probability.
    probs = probabilities({"00": 1000}, shots=1000)
    assert probs == {"00": 1.0}
    assert "11" not in probs


def test_probabilities_rejects_non_positive_shots() -> None:
    with pytest.raises(ValueError):
        probabilities({"0": 5}, shots=0)
    with pytest.raises(ValueError):
        probabilities({"0": 5}, shots=-10)


def test_top_outcomes_orders_by_count_descending() -> None:
    counts = {"00": 100, "11": 900, "01": 5, "10": 3}
    assert top_outcomes(counts, k=2) == [("11", 900), ("00", 100)]


def test_top_outcomes_breaks_ties_by_bitstring() -> None:
    counts = {"01": 500, "10": 500}
    assert top_outcomes(counts, k=2) == [("01", 500), ("10", 500)]


def test_top_outcomes_k_larger_than_distinct_outcomes() -> None:
    counts = {"0": 1000}
    assert top_outcomes(counts, k=5) == [("0", 1000)]


def test_within_band_accepts_expected_center() -> None:
    # p=0.5 over 1000 shots expects 500; 512 is well within a 10% band.
    assert within_band(count=512, shots=1000, p=0.5, tolerance=0.1)


def test_within_band_rejects_far_outlier() -> None:
    # p=0.5 over 1000 shots expects 500; 950 is far outside a 10% band.
    assert not within_band(count=950, shots=1000, p=0.5, tolerance=0.1)


def test_within_band_edge_of_tolerance() -> None:
    # p=0.5 over 1000 shots: margin is 100, so 600 is exactly on the edge.
    assert within_band(count=600, shots=1000, p=0.5, tolerance=0.1)
    assert not within_band(count=601, shots=1000, p=0.5, tolerance=0.1)
