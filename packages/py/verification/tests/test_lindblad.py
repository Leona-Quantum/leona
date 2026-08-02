"""Independent exact checks for bounded time-independent open-system tasks."""

import math

import pytest
from majorana_verification import (
    LindbladReferenceError,
    exact_lindblad_comparison,
    exact_lindblad_values,
    lindblad_references_equivalent,
)


def _term(coefficient, *factors):
    return complex(coefficient), list(factors)


def _v5_specification():
    return {
        "num_qubits": 1,
        "initial_product_state": ["plus"],
        "hamiltonian": None,
        "dissipators": [
            (0.7, [_term(1.0, (0, "lowering"))]),
            (0.1, [_term(1.0, (0, "Z"))]),
        ],
        "evolution_time": 1.3,
        "results": [
            {
                "result_key": "excited_population",
                "metric": "population",
                "basis_state": "1",
            },
            {
                "result_key": "coherence_real",
                "metric": "density_element_real",
                "row_state": "0",
                "column_state": "1",
            },
            {"result_key": "purity", "metric": "purity"},
        ],
    }


def test_amplitude_damping_and_dephasing_match_the_analytic_solution():
    values = exact_lindblad_values(**_v5_specification())

    expected_excited = 0.5 * math.exp(-0.7 * 1.3)
    expected_coherence = 0.5 * math.exp(-(0.7 / 2 + 0.2) * 1.3)
    expected_purity = (1 - expected_excited) ** 2 + expected_excited**2 + 2 * expected_coherence**2
    assert values["excited_population"] == pytest.approx(expected_excited, abs=1e-12)
    assert values["coherence_real"] == pytest.approx(expected_coherence, abs=1e-12)
    assert values["purity"] == pytest.approx(expected_purity, abs=1e-12)


def test_lowering_is_fixed_by_the_server_basis_not_left_to_candidate_convention():
    values = exact_lindblad_values(
        num_qubits=1,
        initial_product_state=["one"],
        dissipators=[(0.4, [_term(1.0, (0, "lowering"))])],
        evolution_time=2.0,
        results=[
            {
                "result_key": "excited_population",
                "metric": "population",
                "basis_state": "1",
            }
        ],
    )

    assert values["excited_population"] == pytest.approx(math.exp(-0.8), abs=1e-12)


def test_collective_jump_remains_one_operator_sum():
    values = exact_lindblad_values(
        num_qubits=2,
        initial_product_state=["one", "one"],
        dissipators=[
            (
                0.3,
                [
                    _term(1.0, (0, "lowering")),
                    _term(1.0, (1, "lowering")),
                ],
            )
        ],
        evolution_time=1.1,
        results=[{"result_key": "purity", "metric": "purity"}],
    )

    assert 0.25 <= values["purity"] <= 1.0


def test_reference_consensus_accepts_equivalent_jump_scalings():
    first = _v5_specification()
    second = {
        **first,
        # rate*D[cL] = rate*|c|^2*D[L]
        "dissipators": [
            (0.7 / 4, [_term(2.0, (0, "lowering"))]),
            (0.1, [_term(1.0, (0, "Z"))]),
        ],
    }

    equivalent, details = lindblad_references_equivalent(first, second)

    assert equivalent is True
    assert details["reason"] == "equivalent_lindblad_problem"


def test_reference_consensus_rejects_raising_for_lowering():
    first = _v5_specification()
    second = {
        **first,
        "dissipators": [
            (0.7, [_term(1.0, (0, "raising"))]),
            (0.1, [_term(1.0, (0, "Z"))]),
        ],
    }

    equivalent, details = lindblad_references_equivalent(first, second)

    assert equivalent is False
    assert details["reason"] == "lindblad_generator_mismatch"


def test_comparison_checks_secondary_results_not_only_the_primary_metric():
    specification = _v5_specification()
    exact = exact_lindblad_values(**specification)
    reported = {**exact, "purity": exact["purity"] + 0.01}

    passed, details = exact_lindblad_comparison(specification, reported)

    assert passed is False
    assert any(item.startswith("purity:") for item in details["disagreements"])


def test_nonhermitian_hamiltonian_is_rejected_as_a_reference_defect():
    with pytest.raises(LindbladReferenceError, match="Hamiltonian is not Hermitian"):
        exact_lindblad_values(
            num_qubits=1,
            initial_product_state=["zero"],
            hamiltonian=[_term(1.0, (0, "lowering"))],
            dissipators=[(0.2, [_term(1.0, (0, "lowering"))])],
            evolution_time=1.0,
            results=[{"result_key": "purity", "metric": "purity"}],
        )


def test_more_than_three_qubits_is_outside_the_bounded_reference():
    with pytest.raises(LindbladReferenceError, match="ceiling"):
        exact_lindblad_values(
            num_qubits=4,
            initial_product_state=["zero"] * 4,
            dissipators=[(0.2, [_term(1.0, (3, "lowering"))])],
            evolution_time=1.0,
            results=[{"result_key": "purity", "metric": "purity"}],
        )
