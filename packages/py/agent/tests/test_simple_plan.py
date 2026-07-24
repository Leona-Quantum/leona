import json

from majorana_agent import SimplePlan, parse_simple_plan
from majorana_contracts.enums import Framework


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


def test_simple_plan_schema_excludes_legacy_strict_contracts():
    schema = SimplePlan.model_json_schema()

    assert "artifact_contract" not in schema["properties"]
    assert "verification_plan" not in schema["properties"]
    assert "measurement_policy" not in json.dumps(schema)


def test_simple_plan_ignores_legacy_extras_and_maps_to_safe_durable_plan():
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
    assert durable.artifact_contract is None
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
