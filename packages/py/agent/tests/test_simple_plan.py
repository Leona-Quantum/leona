import json

from majorana_agent import SimplePlan, parse_simple_plan
from majorana_agent.templates import known_reference_for_task
from majorana_contracts.enums import Framework, MeasurementPolicy


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


def _exact_diag_payload() -> dict:
    """An H2 plan whose reference is the real Kandala et al. two-qubit operator."""

    payload = _payload()
    payload["expected_output_keys"] = ["ground_state_energy_Ha"]
    payload["verification_plan"] = {
        "methods": ["exact_diag"],
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


def test_declared_tolerance_lands_under_the_metric_specific_threshold_key():
    payload = _exact_diag_payload()
    payload["verification_plan"]["tolerance"] = 0.002

    durable = _durable(payload)

    assert durable.verification_plan is not None
    assert durable.verification_plan.thresholds == {"ground_state_energy_Ha_error_max": 0.002}


def test_exact_diag_without_a_hamiltonian_degrades_instead_of_failing_the_run():
    """No stage can repair a missing reference, so every candidate would fail alike.

    Dropping the check grades the run exactly as it was graded before references
    existed, which is weaker but honest; raising here would burn the whole
    candidate budget on code that is not the defect.
    """

    payload = _exact_diag_payload()
    payload["verification_plan"].pop("reference_hamiltonian")

    assert _durable(payload).verification_plan is None


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
            "kind": "maxcut",
            "num_variables": 4,
            "terms": [
                {"i": 0, "j": 1, "weight": 2.0},
                {"i": 1, "j": 2, "weight": 1.0},
                {"i": 2, "j": 3, "weight": 3.0},
            ],
        },
    }

    durable = _durable(payload)

    assert durable.verification_plan is not None
    assert [method.value for method in durable.verification_plan.methods] == ["brute_force"]
    problem = durable.verification_plan.reference_problem
    assert problem is not None and problem.num_variables == 4
    assert durable.verification_plan.reference_hamiltonian is None
