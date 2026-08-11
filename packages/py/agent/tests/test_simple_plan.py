import json

import pytest
from majorana_agent import SimplePlan, parse_simple_plan
from majorana_agent.templates import known_reference_for_task
from majorana_contracts.enums import Framework, MeasurementPolicy, VerificationMethod
from pydantic import ValidationError


def _payload() -> dict:
    return {
        "domain": "chemistry",
        "framework": "pennylane",
        "algorithm": "VQE",
        "problem_summary": "Estimate the H2 ground-state energy",
        "algorithm_rationale": "VQE targets the requested minimum eigenvalue",
        "parameters": {"optimizer": "COBYLA", "max_iterations": 100},
        "qubits_estimate": 2,
        "expected_runtime_sec": 60,
        "success_criteria": {
            "primary_metric": "ground_state_energy_Ha",
            "expected_range": {"min": -1.2, "max": -1.0},
        },
        "expected_output_keys": ["exact_energy_Ha"],
    }


def test_simple_plan_schema_includes_small_artifact_contract():
    schema = SimplePlan.model_json_schema()

    assert "artifact_contract" in schema["properties"]
    assert "measurement_policy" in json.dumps(schema)


def test_simple_plan_preserves_industrial_scale_for_artifact_only_delivery():
    payload = _payload()
    payload["qubits_estimate"] = 480

    simple = parse_simple_plan(json.dumps(payload))
    durable = simple.to_durable_plan(
        selected_framework=Framework.QISKIT,
        requested_shots=None,
        requested_seed=None,
    )

    assert simple.qubits_estimate == durable.qubits_estimate == 480


def test_simple_plan_schema_offers_only_the_two_reference_checks():
    """The planner may declare a reference, but only one it can state as data.

    Schema-guided decoding must not be able to request a method with no dispatch
    branch, which is why methods carries an explicit enum rather than accepting the
    whole VerificationMethod taxonomy.
    """

    schema = SimplePlan.model_json_schema()

    assert "verification_plan" in schema["properties"]
    methods = schema["$defs"]["SimpleVerificationPlan"]["properties"]["methods"]
    assert methods["items"]["enum"] == ["exact_diag", "brute_force"]
    assert "reference_result_key" in schema["$defs"]["SimpleVerificationPlan"]["properties"]


def test_known_reference_is_scoped_to_equilibrium_h2():
    reference = known_reference_for_task(
        "Estimate the H2 ground-state energy at bond length 0.735 Angstrom"
    )

    assert reference is not None
    assert "-1.0523732" in reference
    assert known_reference_for_task("Estimate the H2 molecular ground-state energy") is not None
    assert known_reference_for_task("Estimate LiH at 1.6 Angstrom with VQE") is None
    assert known_reference_for_task("Estimate H2 at 1.5 Angstrom with VQE") is None
    assert known_reference_for_task("Estimate H2 at 0.739 Angstrom with VQE") is None
    assert known_reference_for_task("Estimate non-equilibrium H2 with VQE") is None
    assert known_reference_for_task("Estimate equilibrium H2 in the 6-31G basis") is None


def test_simple_plan_preserves_shape_and_normalizes_unsupported_measure_all():
    payload = _payload()
    payload["artifact_contract"] = {
        "artifact_type": "script",
        "measurement_policy": "measure_all",
        "top_level_execution": "required",
    }
    payload["verification_plan"] = {"methods": ["exact"]}

    simple = parse_simple_plan(json.dumps(payload))
    durable = simple.to_durable_plan(
        selected_framework=Framework.QISKIT,
        requested_shots=1024,
        requested_seed=7,
    )

    assert durable.framework is Framework.QISKIT
    assert durable.parameters.shots == 1024
    assert durable.parameters.seed == 7
    assert durable.artifact_contract is not None
    assert durable.artifact_contract.artifact_type.value == "script"
    assert durable.artifact_contract.measurement_policy is MeasurementPolicy.ONLY_IF_REQUESTED
    assert durable.verification_plan is None
    assert durable.expected_output_keys == [
        "exact_energy_Ha",
        "ground_state_energy_Ha",
    ]


def test_simple_plan_normalizes_one_additional_note_to_a_list():
    payload = _payload()
    payload["success_criteria"]["additional_notes"] = "Compare with exact diagonalization"

    simple = parse_simple_plan(json.dumps(payload))

    assert simple.success_criteria.additional_notes == ["Compare with exact diagonalization"]


def test_broad_lindblad_reference_can_be_ignored_before_typed_validation():
    payload = _payload()
    payload["verification_plan"] = {
        "methods": [],
        "exact_lindblad_reference": {"malformed": "broad planner copy"},
    }

    with pytest.raises(ValidationError):
        parse_simple_plan(json.dumps(payload))

    simple = parse_simple_plan(
        json.dumps(payload),
        omit_broad_lindblad_reference=True,
    )
    assert simple.verification_plan is not None
    assert simple.verification_plan.exact_lindblad_reference is None


def _exact_diag_payload() -> dict:
    """An H2 plan whose reference is the real Kandala et al. two-qubit operator."""

    payload = _payload()
    payload["expected_output_keys"] = ["ground_state_energy_Ha"]
    payload["verification_plan"] = {
        "methods": ["exact_diag"],
        "reference_result_key": "ground_state_energy_Ha",
        "reference_hamiltonian": [
            {"coefficient": -1.0523732, "pauli": "II"},
            {"coefficient": 0.39793742, "pauli": "IZ"},
            {"coefficient": -0.39793742, "pauli": "ZI"},
            {"coefficient": -0.0112801, "pauli": "ZZ"},
            {"coefficient": 0.18093119, "pauli": "XX"},
        ],
    }
    return payload


def _durable(payload: dict):
    return parse_simple_plan(json.dumps(payload)).to_durable_plan(
        selected_framework=Framework.PENNYLANE,
        requested_shots=None,
        requested_seed=None,
    )


def test_declared_reference_hamiltonian_reaches_the_durable_plan():
    durable = _durable(_exact_diag_payload())

    assert durable.verification_plan is not None
    assert [method.value for method in durable.verification_plan.methods] == ["exact_diag"]
    terms = durable.verification_plan.reference_hamiltonian
    assert terms is not None
    assert [term.pauli for term in terms] == ["II", "IZ", "ZI", "ZZ", "XX"]
    assert durable.verification_plan.reference_result_key == "ground_state_energy_Ha"
    assert durable.verification_plan.thresholds is not None
    assert durable.verification_plan.thresholds["ground_state_energy_Ha_error_max"] == (
        pytest.approx(2.04045933e-6)
    )


def test_exact_diag_requires_an_explicit_energy_result_binding():
    payload = _exact_diag_payload()
    payload["verification_plan"].pop("reference_result_key")

    with pytest.raises(ValidationError, match="reference_result_key"):
        SimplePlan.model_validate(payload)


@pytest.mark.parametrize(
    "wrong_key",
    [
        "energy_error",
        "exact_energy",
        "dense_ground_energy",
        "diagonalized_energy",
        "state_fidelity",
    ],
)
def test_exact_diag_rejects_derived_or_baseline_result_bindings(wrong_key):
    payload = _exact_diag_payload()
    payload["expected_output_keys"].append(wrong_key)
    payload["verification_plan"]["reference_result_key"] = wrong_key

    with pytest.raises(ValidationError, match="reference_result_key"):
        SimplePlan.model_validate(payload)


def test_exact_diag_accepts_a_variational_expectation_without_energy_in_its_key():
    payload = _exact_diag_payload()
    payload["expected_output_keys"] = [
        "optimized_expectation",
        "dense_ground_energy",
        "absolute_gap",
    ]
    payload["success_criteria"] = {"primary_metric": "absolute_gap"}
    payload["verification_plan"]["reference_result_key"] = "optimized_expectation"

    simple = SimplePlan.model_validate(payload)

    assert simple.verification_plan is not None
    assert simple.verification_plan.reference_result_key == "optimized_expectation"


def test_declared_tolerance_lands_under_the_metric_specific_threshold_key():
    payload = _exact_diag_payload()
    payload["verification_plan"]["tolerance"] = 1e-6

    durable = _durable(payload)

    assert durable.verification_plan is not None
    assert durable.verification_plan.thresholds == {"ground_state_energy_Ha_error_max": 1e-6}


def test_zero_tolerance_uses_the_verifiers_deterministic_default():
    payload = _exact_diag_payload()
    payload["verification_plan"]["tolerance"] = 0.0

    simple = SimplePlan.model_validate(payload)
    durable = simple.to_durable_plan(
        selected_framework=Framework.QISKIT,
        requested_shots=None,
        requested_seed=None,
    )

    assert simple.verification_plan is not None
    assert simple.verification_plan.tolerance is None
    assert durable.verification_plan is not None
    assert durable.verification_plan.thresholds is not None


def test_negative_tolerance_remains_invalid():
    payload = _exact_diag_payload()
    payload["verification_plan"]["tolerance"] = -0.1

    with pytest.raises(ValidationError, match="greater than 0"):
        SimplePlan.model_validate(payload)


def test_shot_based_vqe_keeps_the_verifiers_sampling_aware_tolerance():
    simple = parse_simple_plan(json.dumps(_exact_diag_payload()))
    durable = simple.to_durable_plan(
        selected_framework=Framework.QISKIT,
        requested_shots=1024,
        requested_seed=None,
    )

    assert durable.verification_plan is not None
    assert durable.verification_plan.thresholds is None


def test_exact_expectation_tolerance_rejects_optimizer_error_not_sampling_noise():
    payload = _exact_diag_payload()
    # A model-authored tolerance may tighten the fixed rule but cannot restore the
    # old 0.5%-of-scale allowance that admitted materially unconverged statevectors.
    payload["verification_plan"]["tolerance"] = 0.008

    durable = _durable(payload)

    assert durable.verification_plan is not None
    assert durable.verification_plan.thresholds == {
        "ground_state_energy_Ha_error_max": pytest.approx(2.04045933e-6)
    }


def test_exact_diag_without_a_hamiltonian_degrades_instead_of_failing_the_run():
    """No stage can repair a missing reference, so every candidate would fail alike.

    Dropping the check grades the run exactly as it was graded before references
    existed, which is weaker but honest; raising here would burn the whole
    candidate budget on code that is not the defect.
    """

    payload = _exact_diag_payload()
    payload["verification_plan"].pop("reference_hamiltonian")

    assert _durable(payload).verification_plan is None


def test_exact_diag_rejects_a_finite_time_observable_with_incompatible_units():
    payload = _exact_diag_payload()
    payload.update(
        {
            "algorithm": "Simulation",
            "problem_summary": "Evolve an Ising chain to t=0.8 and report magnetization",
            "algorithm_rationale": "Suzuki-Trotter approximates finite-time dynamics",
            "success_criteria": {"primary_metric": "magnetization_z"},
            "expected_output_keys": ["magnetization_z"],
        }
    )
    payload["verification_plan"]["reference_result_key"] = "magnetization_z"

    with pytest.raises(ValueError, match="ground-state energy/minimum eigenvalue"):
        parse_simple_plan(json.dumps(payload))


def test_exact_diag_allows_a_non_vqe_exact_ground_state_calculation():
    payload = _exact_diag_payload()
    payload.update(
        {
            "algorithm": "Simulation",
            "problem_summary": "Compute the Hamiltonian ground state by exact diagonalization",
            "algorithm_rationale": "The lowest eigenvalue is the requested result",
        }
    )

    assert _durable(payload).verification_plan is not None


def test_unsupported_reference_method_is_normalized_away():
    payload = _payload()
    payload["verification_plan"] = {"methods": ["return_contract", "statistical"]}

    assert _durable(payload).verification_plan is None


def test_declared_brute_force_instance_reaches_the_durable_plan():
    payload = _payload()
    payload["algorithm"] = "QAOA"
    payload["expected_output_keys"] = ["cut_weight"]
    payload["success_criteria"] = {"primary_metric": "cut_weight"}
    payload["verification_plan"] = {
        "methods": ["brute_force"],
        "reference_problem": {
            "num_variables": 4,
            "business_objective": {
                "direction": "maximize",
                # Sum w*(x_i+x_j-2*x_i*x_j) for the three written edges.
                "linear_coefficients": [
                    {"variable": 0, "coefficient": 2.0},
                    {"variable": 1, "coefficient": 3.0},
                    {"variable": 2, "coefficient": 4.0},
                    {"variable": 3, "coefficient": 3.0},
                ],
                "quadratic_coefficients": [
                    {"left": 0, "right": 1, "coefficient": -4.0},
                    {"left": 1, "right": 2, "coefficient": -2.0},
                    {"left": 2, "right": 3, "coefficient": -6.0},
                ],
            },
        },
    }

    durable = _durable(payload)

    assert durable.verification_plan is not None
    assert [method.value for method in durable.verification_plan.methods] == ["brute_force"]
    problem = durable.verification_plan.reference_problem
    assert problem is not None and problem.num_variables == 4
    assert problem.kind == "qubo"
    assert durable.verification_plan.reference_hamiltonian is None


def _brute_force_payload(objective: dict, *, num_variables: int) -> dict:
    payload = _payload()
    payload["algorithm"] = "QAOA"
    payload["expected_output_keys"] = ["best_value"]
    payload["success_criteria"] = {"primary_metric": "best_value"}
    payload["verification_plan"] = {
        "methods": ["brute_force"],
        "reference_problem": {
            "num_variables": num_variables,
            "business_objective": objective,
        },
    }
    return payload


def _values_of_the_written_objective(objective: dict, *, num_variables: int) -> list[float]:
    """Enumerate the objective exactly as written, without the plan models.

    Deliberately independent of the code under test: it applies x*x == x here,
    in the test, so that "the fold changed no value" is checked against binary
    algebra rather than against the folding itself.
    """
    values: list[float] = []
    for assignment in range(1 << num_variables):
        bits = [(assignment >> variable) & 1 for variable in range(num_variables)]
        value = float(objective.get("constant", 0.0))
        for term in objective.get("linear_coefficients", []):
            value += term["coefficient"] * bits[term["variable"]]
        for term in objective.get("quadratic_coefficients", []):
            value += term["coefficient"] * bits[term["left"]] * bits[term["right"]]
        values.append(value)
    return values


def test_binary_diagonal_terms_fold_into_the_linear_coefficients():
    # x_1*x_1 == x_1 for a binary variable, so this used to be rejected for a
    # distinction the evaluator does not make.
    objective = {
        "direction": "maximize",
        "constant": 1.5,
        "linear_coefficients": [{"variable": 0, "coefficient": 8.0}],
        "quadratic_coefficients": [
            {"left": 1, "right": 1, "coefficient": 5.0},
            {"left": 0, "right": 0, "coefficient": 2.0},
            {"left": 0, "right": 1, "coefficient": -3.0},
        ],
    }

    durable = _durable(_brute_force_payload(objective, num_variables=2))

    problem = durable.verification_plan.reference_problem
    assert problem is not None
    # Variable 0 already had a linear coefficient, so its diagonal term is
    # summed into it; variable 1 gains one. Only the genuine pair survives as
    # an off-diagonal term.
    assert sorted((term.i, term.j, term.weight) for term in problem.terms) == [
        (0, 0, 10.0),
        (0, 1, -3.0),
        (1, 1, 5.0),
    ]

    # And the durable QUBO scores every assignment the way the objective was
    # written, which is the property the fold has to preserve.
    expected = _values_of_the_written_objective(objective, num_variables=2)
    for assignment in range(4):
        bits = [(assignment >> variable) & 1 for variable in range(2)]
        scored = problem.offset + sum(
            term.weight * (bits[term.i] if term.i == term.j else bits[term.i] * bits[term.j])
            for term in problem.terms
        )
        assert scored == pytest.approx(expected[assignment])


def test_a_quadratic_pair_reaches_the_durable_plan_in_one_canonical_order():
    # Two extractions of one instance must not read as a disagreement over
    # which endpoint was written first: a reference mismatch drops the
    # brute-force check silently rather than failing the run.
    written_one_way = {
        "direction": "maximize",
        "linear_coefficients": [{"variable": 0, "coefficient": 8.0}],
        "quadratic_coefficients": [{"left": 2, "right": 0, "coefficient": -3.0}],
    }
    written_the_other_way = {
        "direction": "maximize",
        "linear_coefficients": [{"variable": 0, "coefficient": 8.0}],
        "quadratic_coefficients": [{"left": 0, "right": 2, "coefficient": -3.0}],
    }

    one = _durable(_brute_force_payload(written_one_way, num_variables=3))
    other = _durable(_brute_force_payload(written_the_other_way, num_variables=3))

    assert one.verification_plan.reference_problem is not None
    assert (
        one.verification_plan.reference_problem.terms
        == other.verification_plan.reference_problem.terms
    )
    assert (2, 0) not in [
        (term.i, term.j) for term in one.verification_plan.reference_problem.terms
    ]


def test_constrained_reference_fields_reach_the_durable_plan():
    payload = _payload()
    payload["algorithm"] = "QAOA"
    payload["expected_output_keys"] = ["best_value"]
    payload["success_criteria"] = {"primary_metric": "best_value"}
    payload["verification_plan"] = {
        "methods": ["brute_force"],
        "reference_problem": {
            "num_variables": 2,
            "business_objective": {
                "direction": "maximize",
                "constant": 2.5,
                "linear_coefficients": [
                    {"variable": 0, "coefficient": 8.0},
                    {"variable": 1, "coefficient": 5.0},
                ],
            },
            "business_constraints": [
                {
                    "coefficients": [
                        {"variable": 0, "coefficient": 4.0},
                        {"variable": 1, "coefficient": 2.0},
                    ],
                    "sense": "le",
                    "rhs": 4.0,
                }
            ],
        },
    }

    durable = _durable(payload)

    assert durable.verification_plan is not None
    problem = durable.verification_plan.reference_problem
    assert problem is not None
    assert problem.offset == 2.5
    assert problem.objective == "maximize"
    assert problem.constraints[0].terms[0].weight == 4.0


def test_exact_dynamics_reference_reaches_the_durable_plan_without_a_new_method_enum():
    payload = _payload()
    payload["algorithm"] = "Simulation"
    payload["qubits_estimate"] = 2
    payload["expected_output_keys"] = ["value"]
    payload["success_criteria"] = {"primary_metric": "value"}
    payload["verification_plan"] = {
        "exact_dynamics_reference": {
            "num_qubits": 2,
            "hamiltonian": [
                {"coefficient": 0.8, "factors": [{"qubit": 0, "pauli": "Z"}]},
                {"coefficient": 0.4, "factors": [{"qubit": 1, "pauli": "Z"}]},
                {
                    "coefficient": 0.2,
                    "factors": [
                        {"qubit": 0, "pauli": "X"},
                        {"qubit": 1, "pauli": "X"},
                    ],
                },
            ],
            "initial_basis_state": "00",
            "evolution_time": 1.2,
            "result_key": "value",
            "metric": "observable_expectation",
            "observable": [{"coefficient": 1.0, "factors": [{"qubit": 0, "pauli": "Z"}]}],
        }
    }

    durable = _durable(payload)

    assert durable.verification_plan is not None
    assert [method.value for method in durable.verification_plan.methods] == ["return_contract"]
    reference = durable.verification_plan.exact_dynamics_reference
    assert reference is not None
    assert [
        [(factor.qubit, factor.pauli) for factor in term.factors] for term in reference.hamiltonian
    ] == [[(0, "Z")], [(1, "Z")], [(0, "X"), (1, "X")]]
    assert reference.initial_basis_state == "00"


def test_misbound_optional_dynamics_reference_degrades_instead_of_failing_plan():
    payload = _payload()
    payload["algorithm"] = "Simulation"
    payload["qubits_estimate"] = 1
    payload["expected_output_keys"] = ["approximation_fidelity", "exact_z"]
    payload["success_criteria"] = {"primary_metric": "approximation_fidelity"}
    payload["verification_plan"] = {
        "exact_dynamics_reference": {
            "num_qubits": 1,
            "hamiltonian": [
                {"coefficient": 0.7, "factors": [{"qubit": 0, "pauli": "X"}]},
            ],
            "initial_basis_state": "0",
            "evolution_time": 0.5,
            "result_key": "exact_z",
            "metric": "observable_expectation",
            "observable": [
                {"coefficient": 1.0, "factors": [{"qubit": 0, "pauli": "Z"}]},
            ],
        }
    }

    durable = _durable(payload)

    assert durable.verification_plan is None


def test_exact_lindblad_reference_reaches_the_durable_plan_without_a_new_method_enum():
    payload = _payload()
    payload["algorithm"] = "Simulation"
    payload["qubits_estimate"] = 3
    payload["expected_output_keys"] = ["excited_population", "purity"]
    payload["success_criteria"] = {"primary_metric": "excited_population"}
    payload["verification_plan"] = {
        "exact_lindblad_reference": {
            "num_qubits": 1,
            "initial_product_state": ["plus"],
            "dissipators": [
                {
                    "rate": 0.7,
                    "jump": {
                        "terms": [
                            {
                                "coefficient": {"real": 1.0},
                                "factors": [{"qubit": 0, "operator": "lowering"}],
                            }
                        ]
                    },
                }
            ],
            "evolution_time": 1.3,
            "results": [
                {
                    "result_key": "excited_population",
                    "metric": "population",
                    "basis_state": "1",
                },
                {"result_key": "purity", "metric": "purity"},
            ],
        }
    }

    durable = _durable(payload)

    assert durable.verification_plan is not None
    assert durable.verification_plan.methods == [VerificationMethod.RETURN_CONTRACT]
    reference = durable.verification_plan.exact_lindblad_reference
    assert reference is not None
    assert reference.dissipators[0].jump.terms[0].factors[0].operator == "lowering"


def test_exact_qpe_reference_reaches_the_durable_plan_without_a_new_method_enum():
    payload = _payload()
    payload["algorithm"] = "QPE"
    payload["framework"] = "qiskit"
    payload["parameters"] = {"shots": 4096}
    payload["qubits_estimate"] = 6
    payload["problem_summary"] = "Estimate the exact eigenphase 11/32"
    payload["algorithm_rationale"] = "Five counting qubits represent the phase exactly"
    payload["expected_output_keys"] = [
        "phase_integer",
        "phase_estimate",
        "peak_probability",
        "counts",
    ]
    payload["success_criteria"] = {"primary_metric": "phase_estimate"}
    payload["verification_plan"] = {
        "exact_phase_estimation_reference": {
            "counting_qubits": 5,
            "eigenphase": 11 / 32,
            "phase_integer_result_key": "phase_integer",
            "phase_estimate_result_key": "phase_estimate",
            "peak_probability_result_key": "peak_probability",
            "counts_result_key": "counts",
        }
    }

    durable = _durable(payload)

    assert durable.verification_plan is not None
    assert durable.verification_plan.methods == [VerificationMethod.RETURN_CONTRACT]
    reference = durable.verification_plan.exact_phase_estimation_reference
    assert reference is not None
    assert reference.eigenphase == pytest.approx(11 / 32)


def test_exact_linear_system_reference_reaches_the_durable_plan():
    payload = _payload()
    payload["algorithm"] = "other"
    payload["framework"] = "qiskit"
    payload["qubits_estimate"] = 5
    payload["problem_summary"] = "Solve a two-dimensional symmetric linear system"
    payload["algorithm_rationale"] = "HHL-style phase estimation extracts the solution state"
    payload["expected_output_keys"] = ["solution_x0", "solution_x1", "state_fidelity"]
    payload["success_criteria"] = {"primary_metric": "state_fidelity"}
    payload["verification_plan"] = {
        "exact_linear_system_reference": {
            "matrix": [[0.75, 0.25], [0.25, 0.75]],
            "rhs": [1.0, -0.25],
            "results": [
                {
                    "result_key": "solution_x0",
                    "metric": "normalized_solution_component",
                    "index": 0,
                },
                {
                    "result_key": "solution_x1",
                    "metric": "normalized_solution_component",
                    "index": 1,
                },
                {"result_key": "state_fidelity", "metric": "state_fidelity"},
            ],
        }
    }

    durable = _durable(payload)

    assert durable.verification_plan is not None
    reference = durable.verification_plan.exact_linear_system_reference
    assert reference is not None
    assert reference.rhs == [1.0, -0.25]
