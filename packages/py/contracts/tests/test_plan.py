import pytest
from pydantic import ValidationError

from majorana_contracts import Plan
from majorana_contracts.plan import EXACT_MAX_QUBITS

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


BELL_QASM = """OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
h q[0];
cx q[0], q[1];
"""


def _with_exact(verification: dict, **plan_fields) -> dict:
    return {
        **VALID,
        **plan_fields,
        "verification_plan": {"methods": ["exact", "return_contract"], **verification},
    }


def test_exact_is_plannable_with_a_declared_reference():
    """`exact` was in VerificationMethod but not in the planner's schema, so no plan
    could ever request it and verify_exact had no caller."""
    plan = Plan.model_validate(
        _with_exact({"reference_source": "plan_declared", "reference_qasm": BELL_QASM})
    )
    assert plan.verification_plan is not None
    assert plan.verification_plan.reference_qasm == BELL_QASM


def test_exact_is_plannable_against_the_parent_artifact():
    plan = Plan.model_validate(_with_exact({"reference_source": "parent_artifact"}))
    assert plan.verification_plan is not None
    assert plan.verification_plan.reference_source == "parent_artifact"


def test_exact_without_a_reference_source_is_rejected():
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(_with_exact({}))
    assert "reference_source" in str(exc.value)


def test_plan_declared_reference_without_qasm_is_rejected():
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(_with_exact({"reference_source": "plan_declared"}))
    assert "reference_qasm" in str(exc.value)


def test_parent_reference_carrying_qasm_is_rejected():
    """A reference the verifier will ignore misstates what was checked."""
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(
            _with_exact({"reference_source": "parent_artifact", "reference_qasm": BELL_QASM})
        )
    assert "ignored" in str(exc.value)


def test_exact_above_the_qubit_ceiling_is_rejected():
    """exact_equivalence raises above its ceiling and verify_exact turns that into a
    FAIL — a check no repair can fix, which is the #90 failure shape."""
    reference = {"reference_source": "plan_declared", "reference_qasm": BELL_QASM}
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(_with_exact(reference, qubits_estimate=EXACT_MAX_QUBITS + 1))
    assert "at most" in str(exc.value)
    assert (
        Plan.model_validate(
            _with_exact(reference, qubits_estimate=EXACT_MAX_QUBITS)
        ).qubits_estimate
        == EXACT_MAX_QUBITS
    )


def test_a_plan_without_exact_may_still_omit_a_reference():
    """The rule is scoped to the contradiction: nothing else needs a reference."""
    plan = Plan.model_validate(
        {**VALID, "qubits_estimate": 24, "verification_plan": {"methods": ["return_contract"]}}
    )
    assert plan.verification_plan is not None
    assert plan.verification_plan.reference_source is None


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


def test_exact_on_a_non_circuit_artifact_is_rejected():
    """artifact_type 'other' gets no trusted observer, so no interchange QASM is
    emitted and the exact check has nothing to compare — an unfixable failure on
    every candidate, the same shape as the other three rules here."""
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(
            _with_exact(
                {"reference_source": "plan_declared", "reference_qasm": BELL_QASM},
                artifact_contract={
                    "artifact_type": "other",
                    "measurement_policy": "none",
                    "top_level_execution": "required",
                },
            )
        )
    assert "non-circuit artifact" in str(exc.value)


def test_exact_on_a_circuit_artifact_is_still_allowed():
    plan = Plan.model_validate(
        _with_exact(
            {"reference_source": "plan_declared", "reference_qasm": BELL_QASM},
            artifact_contract={
                "artifact_type": "QuantumCircuit",
                # `specified`, not `measure_all`: VALID promises two scalars and no
                # distribution, so `measure_all` is now rejected in its own right
                # (see _measure_all_needs_a_distribution_to_show_for_it below). The
                # policy is incidental to what this test asserts, which is that
                # artifact_type alone does not block `exact`.
                "measurement_policy": "specified",
                "top_level_execution": "required",
            },
        )
    )
    assert plan.artifact_contract is not None


# The plan production VQE run 019f7f2d-9504 actually emitted, trimmed to the fields
# the rule reads. Its `measure_all` failed the one candidate that bound the correct
# unmeasured ansatz, on every attempt, until the candidate budget ran out.
_VQE_019f7f2d = {
    **VALID,
    "expected_output_keys": ["ground_state_energy", "optimal_params", "iterations"],
    "success_criteria": {
        "primary_metric": "ground_state_energy",
        "expected_range": {"min": -1.92883, "max": -1.82883},
    },
    "artifact_contract": {
        "artifact_type": "script",
        "measurement_policy": "measure_all",
        "top_level_execution": "required",
        "expected_return_type": "dict",
    },
    "verification_plan": {"methods": ["return_contract"]},
}


def test_measure_all_without_a_promised_distribution_is_rejected():
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(_VQE_019f7f2d)
    message = str(exc.value)
    assert "measure_all" in message
    # The objection must name the substitute, not just the violation (lesson 2).
    assert "'none'" in message and "'specified'" in message


def test_measure_all_is_allowed_when_the_run_reports_the_distribution():
    """A QAOA that really does publish a measured circuit and report counts is not
    the shape this rule is aimed at, and must keep planning."""
    plan = Plan.model_validate(
        {
            **_VQE_019f7f2d,
            "expected_output_keys": ["counts", "approximation_ratio"],
            "success_criteria": {"primary_metric": "approximation_ratio"},
        }
    )
    assert plan.artifact_contract is not None
    assert plan.artifact_contract.measurement_policy.value == "measure_all"


@pytest.mark.parametrize("policy", ["none", "specified", "only_if_requested"])
def test_the_variational_shape_plans_cleanly_under_every_other_policy(policy):
    """The remedy the objection names has to actually work — otherwise the planner
    re-emit lands on a second rejection and the run dies one step later."""
    plan = Plan.model_validate(
        {
            **_VQE_019f7f2d,
            "artifact_contract": {
                **_VQE_019f7f2d["artifact_contract"],
                "measurement_policy": policy,
            },
        }
    )
    assert plan.artifact_contract is not None
    assert plan.artifact_contract.measurement_policy.value == policy


def test_a_plan_with_no_artifact_contract_is_untouched_by_the_rule():
    plan = Plan.model_validate({**VALID, "artifact_contract": None})
    assert plan.artifact_contract is None
