import pytest
from pydantic import ValidationError

from majorana_contracts import Plan

VALID = {
    "domain": "chemistry",
    "framework": "qiskit",
    "algorithm": "VQE",
    "problem_summary": "Ground state energy of H2 at equilibrium bond length",
    "algorithm_rationale": "Small molecule; VQE with a UCCSD ansatz is the standard choice",
    "parameters": {"shots": 4000, "optimizer": "COBYLA", "custom": {"molecule": "H2"}},
    "qubits_estimate": 4,
    "expected_runtime_sec": 60,
    "success_criteria": {
        "primary_metric": "ground_state_energy_Ha",
        "expected_range": {"min": -1.2, "max": -1.0},
    },
    "expected_output_keys": ["ground_state_energy_Ha", "optimal_params"],
    "verification_plan": {
        "methods": ["exact_diag", "return_contract"],
        "thresholds": {"energy_error_max": 1.6e-3},
        "reference_method": "exact diagonalization",
    },
    "baseline_plan": {"kind": "hamiltonian", "reason": "compare against exact diagonalization"},
}


def test_valid_plan_parses():
    plan = Plan.model_validate(VALID)
    assert plan.qubits_estimate == 4
    assert plan.verification_plan is not None


def test_qubit_ceiling_is_27():
    with pytest.raises(ValidationError):
        Plan.model_validate({**VALID, "qubits_estimate": 28})
    assert Plan.model_validate({**VALID, "qubits_estimate": 27}).qubits_estimate == 27


def test_unknown_framework_rejected():
    with pytest.raises(ValidationError):
        Plan.model_validate({**VALID, "framework": "braket"})


def test_empty_verification_methods_rejected():
    with pytest.raises(ValidationError):
        Plan.model_validate({**VALID, "verification_plan": {"methods": []}})


def test_extra_fields_rejected():
    with pytest.raises(ValidationError):
        Plan.model_validate({**VALID, "vibes": "good"})


def _with_statistical(output_keys: list[str]) -> dict:
    return {
        **VALID,
        "expected_output_keys": output_keys,
        "verification_plan": {"methods": ["statistical", "return_contract"]},
    }


def test_statistical_without_a_promised_distribution_is_rejected():
    """The exact shape of the 2026-07-20 production QAOA failure: three scalars and a
    statistical check, which fails "required evidence unavailable" on every candidate
    until the budget is exhausted."""
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(_with_statistical(["optimal_cut", "qaoa_cut", "approximation_ratio"]))
    assert "statistical" in str(exc.value)
    assert "expected_output_keys" in str(exc.value)


@pytest.mark.parametrize(
    "key", ["counts", "measurement_counts", "results", "samples", "probability_distribution"]
)
def test_statistical_allowed_when_a_distribution_key_is_promised(key):
    plan = Plan.model_validate(_with_statistical([key, "approximation_ratio"]))
    assert plan.verification_plan is not None


def test_scalar_only_plan_without_statistical_is_still_fine():
    """The rule is scoped to the contradiction — it must not make scalar-output tasks
    unplannable."""
    plan = Plan.model_validate(
        {
            **VALID,
            "expected_output_keys": ["optimal_cut", "approximation_ratio"],
            "verification_plan": {"methods": ["return_contract"]},
        }
    )
    assert plan.expected_output_keys == ["optimal_cut", "approximation_ratio"]
