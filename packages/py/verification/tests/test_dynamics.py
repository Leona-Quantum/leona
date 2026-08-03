"""Independent exact finite-time references and their tensor convention."""

from __future__ import annotations

import math

import pytest
from majorana_verification import (
    EXACT_DYNAMICS_MAX_QUBITS,
    DynamicsReferenceError,
    exact_dynamics_comparison,
    exact_dynamics_value,
)


def test_single_qubit_survival_matches_the_closed_form():
    # exp(-i*t*X)|0> = cos(t)|0> - i*sin(t)|1>.
    value = exact_dynamics_value([(1.0, "X")], "0", math.pi / 4, "survival_probability")

    assert value == pytest.approx(0.5, abs=1e-12)


def test_single_qubit_z_expectation_matches_the_closed_form():
    # <Z>(t) under X from |0> is cos(2t).
    value = exact_dynamics_value(
        [(1.0, "X")],
        "0",
        math.pi / 4,
        "observable_expectation",
        [(1.0, "Z")],
    )

    assert value == pytest.approx(0.0, abs=1e-12)


def test_two_qubit_corpus_observable_matches_its_external_oracle():
    value = exact_dynamics_value(
        [(0.8, "ZI"), (0.4, "IZ"), (0.2, "XX")],
        "00",
        1.2,
        "observable_expectation",
        [(1.0, "ZI")],
    )

    assert value == pytest.approx(0.9466084218, abs=1e-10)


_QUENCH = [
    (0.7, "ZZII"),
    (0.7, "IZZI"),
    (0.7, "IIZZ"),
    (0.5, "XIII"),
    (0.5, "IXII"),
    (0.5, "IIXI"),
    (0.5, "IIIX"),
    (0.2, "ZIII"),
]


def test_unseen_quench_survival_matches_the_external_oracle():
    value = exact_dynamics_value(_QUENCH, "0101", 0.6, "survival_probability")

    assert value == pytest.approx(0.7304907088549235, abs=1e-12)


def test_unseen_quench_mean_z_matches_the_external_oracle():
    mean_z = [(0.25, "ZIII"), (0.25, "IZII"), (0.25, "IIZI"), (0.25, "IIIZ")]

    value = exact_dynamics_value(
        _QUENCH,
        "0101",
        0.6,
        "observable_expectation",
        mean_z,
    )

    assert value == pytest.approx(-0.0011475365876325028, abs=1e-12)


def test_comparison_rejects_the_reversed_tensor_result_seen_live():
    passed, details = exact_dynamics_comparison(
        _QUENCH,
        "0101",
        0.6,
        "survival_probability",
        None,
        # The v4 candidate accepted before this reference path existed.
        0.7350447,
    )

    assert not passed
    assert details["scores"]["absolute_error"] > 0.004
    assert details["protocol"]["tolerance_source"] == "floating_point_only"


@pytest.mark.parametrize(
    "terms,state,time,metric,observable,fragment",
    [
        ([], "0", 1.0, "survival_probability", None, "no Hamiltonian"),
        ([(1.0, "ZI")], "0", 1.0, "survival_probability", None, "exactly 2"),
        ([(1.0, "Z")], "0", float("nan"), "survival_probability", None, "not finite"),
        ([(1.0, "Z")], "0", 1.0, "observable_expectation", None, "requires"),
        (
            [(1.0, "Z" * (EXACT_DYNAMICS_MAX_QUBITS + 1))],
            "0" * (EXACT_DYNAMICS_MAX_QUBITS + 1),
            1.0,
            "survival_probability",
            None,
            "ceiling",
        ),
    ],
)
def test_unusable_reference_raises_instead_of_fabricating_a_scalar(
    terms, state, time, metric, observable, fragment
):
    with pytest.raises(DynamicsReferenceError, match=fragment):
        exact_dynamics_value(terms, state, time, metric, observable)


def test_the_ceiling_matches_the_contract():
    from majorana_contracts.plan import EXACT_DYNAMICS_MAX_QUBITS as CONTRACT_CEILING

    assert CONTRACT_CEILING == EXACT_DYNAMICS_MAX_QUBITS
