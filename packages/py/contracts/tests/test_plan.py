import pytest
from pydantic import ValidationError

from majorana_contracts import Plan, PlannableVerificationMethod
from majorana_contracts.enums import VerificationMethod

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


def _with_state_claim(*, algorithm="Bell", family="bell", qubits=2, phase=0.0):
    return {
        **VALID,
        "algorithm": algorithm,
        "qubits_estimate": qubits,
        "verification_plan": {
            "methods": ["return_contract"],
            "state_preparation_claim": {
                "family": family,
                "qubits": qubits,
                "relative_phase_radians": phase,
            },
        },
    }


def test_state_preparation_claim_preserves_noncanonical_relative_phase():
    plan = Plan.model_validate(_with_state_claim(phase=3.141592653589793))

    assert plan.verification_plan is not None
    assert plan.verification_plan.state_preparation_claim is not None
    assert plan.verification_plan.state_preparation_claim.relative_phase_radians == pytest.approx(
        3.141592653589793
    )


@pytest.mark.parametrize(
    "payload",
    [
        _with_state_claim(algorithm="QFT"),
        _with_state_claim(algorithm="Bell", family="ghz"),
        _with_state_claim(algorithm="Bell", qubits=3),
        _with_state_claim(algorithm="GHZ", family="ghz", qubits=2),
    ],
)
def test_state_preparation_claim_must_match_algorithm_and_width(payload):
    with pytest.raises(ValidationError):
        Plan.model_validate(payload)


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


@pytest.mark.parametrize("removed_field", ["reference_source", "reference_qasm"])
def test_removed_reference_qasm_fields_are_rejected(removed_field):
    payload = {
        **VALID,
        "verification_plan": {
            "methods": ["return_contract"],
            removed_field: "plan-authored reference",
        },
    }
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(payload)
    assert removed_field in str(exc.value)


def test_exact_cannot_be_selected_by_a_new_plan():
    payload = {
        **VALID,
        "verification_plan": {"methods": ["exact", "return_contract"]},
    }
    plan = Plan.model_validate(payload)
    assert plan.verification_plan is not None
    assert plan.verification_plan.methods == [VerificationMethod.RETURN_CONTRACT]
    assert "exact" not in {method.value for method in PlannableVerificationMethod}


def test_plan_schema_contains_no_reference_qasm_fields_or_exact_choice():
    schema = Plan.model_json_schema()
    verification = schema["$defs"]["VerificationPlan"]
    assert "reference_source" not in verification["properties"]
    assert "reference_qasm" not in verification["properties"]
    assert "exact" not in verification["properties"]["methods"]["items"]["enum"]


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


_HAMILTONIAN = [
    {"coefficient": 0.5, "pauli": "ZI"},
    {"coefficient": 1.2, "pauli": "IZ"},
    {"coefficient": 0.8, "pauli": "XX"},
]


def _with_exact_diag(**verification) -> dict:
    return {
        **VALID,
        "expected_output_keys": ["ground_state_energy", "optimal_params"],
        "success_criteria": {"primary_metric": "ground_state_energy"},
        "verification_plan": {
            "methods": ["exact_diag", "return_contract"],
            "reference_result_key": "ground_state_energy",
            "reference_hamiltonian": _HAMILTONIAN,
            **verification,
        },
    }


def test_exact_diag_is_plannable_at_last():
    """`exact_diag` sat in VerificationMethod and in the database allowlist from
    migration 0001 with no implementation and no way for a plan to request it, so
    every VQE this product ran could only ever grade `structural`."""
    plan = Plan.model_validate(_with_exact_diag())
    assert plan.verification_plan is not None
    assert plan.verification_plan.reference_hamiltonian is not None
    assert len(plan.verification_plan.reference_hamiltonian) == 3
    assert plan.verification_plan.reference_hamiltonian[0].pauli == "ZI"
    assert plan.verification_plan.reference_result_key == "ground_state_energy"


def test_exact_diag_with_no_reference_at_all_normalizes_to_yesterdays_behaviour():
    """`exact_diag` parsed fine before it was plannable — _drop_unplannable_methods
    normalized it away — and durable plan revisions re-validate every stored plan on
    rehydration. Hard-failing this shape would kill runs resuming across the
    deploy on plans that used to parse. Dropping the check is weaker, not wrong."""
    plan = Plan.model_validate(
        {
            **_with_exact_diag(),
            "verification_plan": {"methods": ["exact_diag", "return_contract"]},
        }
    )
    assert plan.verification_plan is not None
    assert plan.verification_plan.methods == [VerificationMethod.RETURN_CONTRACT]


def test_exact_diag_as_the_only_method_still_leaves_a_check_behind():
    plan = Plan.model_validate(
        {**_with_exact_diag(), "verification_plan": {"methods": ["exact_diag"]}}
    )
    assert plan.verification_plan is not None
    assert plan.verification_plan.methods == [VerificationMethod.RETURN_CONTRACT]


def test_ragged_pauli_strings_are_rejected_with_the_padding_remedy():
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(
            _with_exact_diag(
                reference_hamiltonian=[
                    {"coefficient": 0.5, "pauli": "ZI"},
                    {"coefficient": 0.8, "pauli": "X"},
                ]
            )
        )
    assert "different lengths" in str(exc.value)
    assert "pad the shorter ones" in str(exc.value)


def test_a_hamiltonian_above_the_diagonalizer_ceiling_is_rejected():
    from majorana_contracts.plan import EXACT_DIAG_MAX_QUBITS

    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(
            _with_exact_diag(
                reference_hamiltonian=[
                    {"coefficient": 1.0, "pauli": "Z" * (EXACT_DIAG_MAX_QUBITS + 1)}
                ]
            )
        )
    assert "at most" in str(exc.value)


def test_a_non_pauli_character_is_rejected_by_the_field_itself():
    with pytest.raises(ValidationError):
        Plan.model_validate(
            _with_exact_diag(reference_hamiltonian=[{"coefficient": 1.0, "pauli": "ZQ"}])
        )


def test_exact_diag_whose_bound_result_is_not_a_promised_key_is_rejected():
    """The check reads reference_result_key out of the result dict. A metric the code
    was never asked to print fails identically on every candidate."""
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(_with_exact_diag(reference_result_key="energy_Ha"))
    assert "does not promise that key" in str(exc.value)


def test_exact_diag_still_requires_the_PRIMARY_metric_to_be_promised():
    """`reference_result_key` may differ from the primary metric; it may not replace it.

    Introducing the key moved this validator from checking primary_metric to checking
    reference_result_key, so a Plan promising only the reference key started passing
    validation. Nothing else pins the primary metric — there is no global rule — and
    `_success_criteria_check` reads it out of RESULT on every run regardless of which
    key the reference reads. Such a Plan therefore fails EVERY candidate with "primary
    metric is missing from RESULT" and no `fault`, so the repair loop attributes a Plan
    defect to correct code and spends the whole candidate budget on it.
    """
    payload = _with_exact_diag()
    payload["success_criteria"] = {"primary_metric": "energy_error"}

    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(payload)
    assert "is read out of the result on every run" in str(exc.value)

    # Promising both keys is the fix, and the two staying different is still fine.
    payload["expected_output_keys"] = ["ground_state_energy", "optimal_params", "energy_error"]
    plan = Plan.model_validate(payload)
    assert plan.verification_plan is not None
    assert plan.verification_plan.reference_result_key == "ground_state_energy"
    assert plan.success_criteria.primary_metric == "energy_error"


def test_legacy_exact_diag_without_explicit_binding_falls_back_to_primary_metric():
    payload = _with_exact_diag()
    payload["verification_plan"].pop("reference_result_key")

    plan = Plan.model_validate(payload)

    assert plan.verification_plan is not None
    assert plan.verification_plan.reference_result_key is None


def test_a_plan_without_exact_diag_needs_no_hamiltonian():
    """Scoped to the contradiction, like every other rule here."""
    plan = Plan.model_validate({**VALID, "verification_plan": {"methods": ["return_contract"]}})
    assert plan.verification_plan is not None
    assert plan.verification_plan.reference_hamiltonian is None


_DYNAMICS_REFERENCE = {
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


def _with_exact_dynamics(reference=None) -> dict:
    return {
        **VALID,
        "algorithm": "Simulation",
        "qubits_estimate": 2,
        "expected_output_keys": ["value"],
        "success_criteria": {"primary_metric": "value"},
        "verification_plan": {
            "methods": ["return_contract"],
            "exact_dynamics_reference": _DYNAMICS_REFERENCE if reference is None else reference,
        },
    }


def test_bounded_exact_dynamics_reference_is_preserved():
    plan = Plan.model_validate(_with_exact_dynamics())

    assert plan.verification_plan is not None
    reference = plan.verification_plan.exact_dynamics_reference
    assert reference is not None
    assert reference.initial_basis_state == "00"
    assert reference.observable is not None
    assert [factor.qubit for factor in reference.observable[0].factors] == [0]


@pytest.mark.parametrize(
    "reference,fragment",
    [
        (
            {**_DYNAMICS_REFERENCE, "initial_basis_state": "0"},
            "one bit per declared qubit",
        ),
        (
            {
                **_DYNAMICS_REFERENCE,
                "hamiltonian": [
                    {
                        "coefficient": 1.0,
                        "factors": [
                            {"qubit": 0, "pauli": "Z"},
                            {"qubit": 0, "pauli": "X"},
                        ],
                    }
                ],
            },
            "duplicate qubit factors",
        ),
        (
            {
                **_DYNAMICS_REFERENCE,
                "metric": "survival_probability",
            },
            "does not use",
        ),
        (
            {
                **_DYNAMICS_REFERENCE,
                "observable": [
                    {
                        "coefficient": 1.0,
                        "factors": [{"qubit": 2, "pauli": "Z"}],
                    }
                ],
            },
            "lies outside the declared 2-qubit register",
        ),
    ],
)
def test_inconsistent_exact_dynamics_shapes_are_rejected(reference, fragment):
    with pytest.raises(ValidationError, match=fragment):
        Plan.model_validate(_with_exact_dynamics(reference))


def test_survival_reference_requires_no_observable():
    reference = {key: value for key, value in _DYNAMICS_REFERENCE.items() if key != "observable"}
    reference["metric"] = "survival_probability"

    plan = Plan.model_validate(_with_exact_dynamics(reference))

    assert plan.verification_plan is not None
    assert plan.verification_plan.exact_dynamics_reference is not None


def test_exact_dynamics_metric_must_be_a_promised_result_key():
    payload = _with_exact_dynamics()
    payload["success_criteria"] = {"primary_metric": "missing_metric"}
    payload["verification_plan"]["exact_dynamics_reference"] = {
        **_DYNAMICS_REFERENCE,
        "result_key": "missing_metric",
    }

    with pytest.raises(ValidationError, match="does not promise that key"):
        Plan.model_validate(payload)


def test_exact_dynamics_result_key_must_equal_the_primary_metric():
    reference = {**_DYNAMICS_REFERENCE, "result_key": "another_metric"}

    with pytest.raises(ValidationError, match="must equal success_criteria.primary_metric"):
        Plan.model_validate(_with_exact_dynamics(reference))


_QPE_REFERENCE = {
    "counting_qubits": 5,
    "eigenphase": 11 / 32,
    "phase_integer_result_key": "phase_integer",
    "phase_estimate_result_key": "phase_estimate",
    "peak_probability_result_key": "peak_probability",
    "counts_result_key": "counts",
}


def _with_exact_qpe(reference=None) -> dict:
    return {
        **VALID,
        "algorithm": "QPE",
        "qubits_estimate": 6,
        "parameters": {"shots": 4096},
        "expected_output_keys": [
            "phase_integer",
            "phase_estimate",
            "peak_probability",
            "counts",
        ],
        "success_criteria": {"primary_metric": "phase_estimate"},
        "verification_plan": {
            "methods": ["return_contract"],
            "exact_phase_estimation_reference": (
                _QPE_REFERENCE if reference is None else reference
            ),
        },
    }


def test_bounded_exact_qpe_reference_is_preserved():
    plan = Plan.model_validate(_with_exact_qpe())

    assert plan.verification_plan is not None
    reference = plan.verification_plan.exact_phase_estimation_reference
    assert reference is not None
    assert reference.counting_qubits == 5
    assert reference.eigenphase == pytest.approx(11 / 32)


def test_exact_qpe_rejects_a_nonrepresentable_phase():
    with pytest.raises(ValidationError, match="exactly representable"):
        Plan.model_validate(_with_exact_qpe({**_QPE_REFERENCE, "eigenphase": 1 / 3}))


def test_exact_qpe_requires_all_bound_result_keys_to_be_promised():
    payload = _with_exact_qpe()
    payload["expected_output_keys"].remove("peak_probability")

    with pytest.raises(ValidationError, match="unpromised RESULT keys"):
        Plan.model_validate(payload)


def test_exact_qpe_requires_algorithm_and_target_qubit_capacity():
    wrong_algorithm = _with_exact_qpe()
    wrong_algorithm["algorithm"] = "QFT"
    with pytest.raises(ValidationError, match="requires algorithm QPE"):
        Plan.model_validate(wrong_algorithm)

    too_narrow = _with_exact_qpe()
    too_narrow["qubits_estimate"] = 5
    with pytest.raises(ValidationError, match="requires at least one target qubit"):
        Plan.model_validate(too_narrow)


_LINEAR_REFERENCE = {
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
        {
            "result_key": "amplitude_ratio",
            "metric": "component_ratio",
            "numerator_index": 1,
            "denominator_index": 0,
        },
        {"result_key": "residual_norm", "metric": "residual_norm"},
        {"result_key": "state_fidelity", "metric": "state_fidelity"},
    ],
}


def _with_exact_linear(reference=None) -> dict:
    return {
        **VALID,
        "algorithm": "other",
        "qubits_estimate": 5,
        "expected_output_keys": [
            "solution_x0",
            "solution_x1",
            "amplitude_ratio",
            "residual_norm",
            "state_fidelity",
        ],
        "success_criteria": {"primary_metric": "state_fidelity"},
        "verification_plan": {
            "methods": ["return_contract"],
            "exact_linear_system_reference": (
                _LINEAR_REFERENCE if reference is None else reference
            ),
        },
    }


def test_bounded_exact_linear_system_reference_is_preserved():
    plan = Plan.model_validate(_with_exact_linear())

    assert plan.verification_plan is not None
    reference = plan.verification_plan.exact_linear_system_reference
    assert reference is not None
    assert reference.matrix[0][1] == pytest.approx(0.25)
    assert reference.results[2].numerator_index == 1


@pytest.mark.parametrize(
    ("reference", "fragment"),
    [
        ({**_LINEAR_REFERENCE, "matrix": [[1.0, 0.2], [0.3, 1.0]]}, "symmetric"),
        (
            {**_LINEAR_REFERENCE, "matrix": [[1.0] * 3 for _ in range(3)], "rhs": [1.0] * 3},
            "power of two",
        ),
        ({**_LINEAR_REFERENCE, "rhs": [1.0]}, "at least 2"),
        (
            {
                **_LINEAR_REFERENCE,
                "results": [
                    {
                        "result_key": "solution_x0",
                        "metric": "normalized_solution_component",
                        "index": 2,
                    }
                ],
            },
            "outside the matrix",
        ),
    ],
)
def test_inconsistent_exact_linear_system_shapes_are_rejected(reference, fragment):
    with pytest.raises(ValidationError, match=fragment):
        Plan.model_validate(_with_exact_linear(reference))


def test_exact_linear_system_cannot_check_an_unpromised_result():
    payload = _with_exact_linear()
    payload["expected_output_keys"].remove("amplitude_ratio")

    with pytest.raises(ValidationError, match="unpromised RESULT keys"):
        Plan.model_validate(payload)


_LINDBLAD_REFERENCE = {
    "num_qubits": 1,
    "initial_product_state": ["plus"],
    "hamiltonian": None,
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
        },
        {
            "rate": 0.1,
            "jump": {
                "terms": [
                    {
                        "coefficient": {"real": 1.0},
                        "factors": [{"qubit": 0, "operator": "Z"}],
                    }
                ]
            },
        },
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


def _with_exact_lindblad(reference=None) -> dict:
    return {
        **VALID,
        "algorithm": "Simulation",
        "qubits_estimate": 3,
        "expected_output_keys": ["excited_population", "coherence_real", "purity"],
        "success_criteria": {"primary_metric": "excited_population"},
        "verification_plan": {
            "methods": ["return_contract"],
            "exact_lindblad_reference": (_LINDBLAD_REFERENCE if reference is None else reference),
        },
    }


def test_bounded_exact_lindblad_reference_is_preserved():
    plan = Plan.model_validate(_with_exact_lindblad())

    assert plan.verification_plan is not None
    reference = plan.verification_plan.exact_lindblad_reference
    assert reference is not None
    assert reference.dissipators[0].jump.terms[0].factors[0].operator == "lowering"
    assert [result.result_key for result in reference.results] == [
        "excited_population",
        "coherence_real",
        "purity",
    ]


@pytest.mark.parametrize(
    "reference,fragment",
    [
        (
            {**_LINDBLAD_REFERENCE, "initial_product_state": ["plus", "zero"]},
            "one state per qubit",
        ),
        (
            {
                **_LINDBLAD_REFERENCE,
                "dissipators": [
                    {
                        "rate": 0.7,
                        "jump": {
                            "terms": [
                                {
                                    "coefficient": {"real": 1.0},
                                    "factors": [{"qubit": 1, "operator": "lowering"}],
                                }
                            ]
                        },
                    }
                ],
            },
            "lies outside the declared 1-qubit register",
        ),
        (
            {
                **_LINDBLAD_REFERENCE,
                "results": [
                    {
                        "result_key": "excited_population",
                        "metric": "population",
                    }
                ],
            },
            "population requires only basis_state",
        ),
    ],
)
def test_inconsistent_exact_lindblad_shapes_are_rejected(reference, fragment):
    with pytest.raises(ValidationError, match=fragment):
        Plan.model_validate(_with_exact_lindblad(reference))


def test_exact_lindblad_reference_must_cover_the_primary_metric():
    reference = {
        **_LINDBLAD_REFERENCE,
        "results": [{"result_key": "purity", "metric": "purity"}],
    }

    with pytest.raises(ValidationError, match="must include success_criteria.primary_metric"):
        Plan.model_validate(_with_exact_lindblad(reference))


def test_exact_lindblad_reference_cannot_check_an_unpromised_result():
    reference = {
        **_LINDBLAD_REFERENCE,
        "results": [*_LINDBLAD_REFERENCE["results"], {"result_key": "extra", "metric": "purity"}],
    }

    with pytest.raises(ValidationError, match="unpromised RESULT keys: extra"):
        Plan.model_validate(_with_exact_lindblad(reference))


_MAXCUT_PROBLEM = {
    "kind": "maxcut",
    "num_variables": 4,
    "terms": [
        {"i": 0, "j": 1, "weight": 1.0},
        {"i": 1, "j": 2, "weight": 2.0},
        {"i": 2, "j": 3, "weight": 1.0},
        {"i": 0, "j": 3, "weight": 2.0},
    ],
}


def _with_brute_force(**verification) -> dict:
    return {
        **VALID,
        "expected_output_keys": ["best_cut_weight", "best_assignment"],
        "success_criteria": {"primary_metric": "best_cut_weight"},
        "verification_plan": {
            "methods": ["brute_force", "return_contract"],
            "reference_problem": _MAXCUT_PROBLEM,
            **verification,
        },
    }


def test_brute_force_is_plannable_at_last():
    """`brute_force` sat in VerificationMethod and in the database allowlist from
    migration 0001 with no implementation and no way for a plan to request it —
    the same dormancy `exact_diag` came out of, for the metric family exact_diag
    structurally cannot grade (production run 019f7f81-4a61)."""
    plan = Plan.model_validate(_with_brute_force())
    assert plan.verification_plan is not None
    assert plan.verification_plan.reference_problem is not None
    assert plan.verification_plan.reference_problem.kind == "maxcut"
    assert len(plan.verification_plan.reference_problem.terms) == 4


def test_brute_force_with_no_problem_at_all_normalizes_to_yesterdays_behaviour():
    """`brute_force` parsed fine before it was plannable — _drop_unplannable_methods
    normalized it away — and durable plan revisions re-validate every stored plan on
    rehydration. Hard-failing this shape would kill runs resuming across the
    deploy on plans that used to parse. Dropping the check is weaker, not wrong."""
    plan = Plan.model_validate(
        {
            **_with_brute_force(),
            "verification_plan": {"methods": ["brute_force", "return_contract"]},
        }
    )
    assert plan.verification_plan is not None
    assert plan.verification_plan.methods == [VerificationMethod.RETURN_CONTRACT]


def test_brute_force_as_the_only_method_still_leaves_a_check_behind():
    plan = Plan.model_validate(
        {**_with_brute_force(), "verification_plan": {"methods": ["brute_force"]}}
    )
    assert plan.verification_plan is not None
    assert plan.verification_plan.methods == [VerificationMethod.RETURN_CONTRACT]


def test_a_term_outside_the_declared_variable_count_is_rejected():
    """ProblemTerm's own bounds only see the global ceiling; the instance's own
    width is a whole-plan fact."""
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(
            _with_brute_force(
                reference_problem={
                    "kind": "maxcut",
                    "num_variables": 3,
                    "terms": [{"i": 0, "j": 3, "weight": 1.0}],
                }
            )
        )
    assert "outside 0..2" in str(exc.value)


def test_a_maxcut_self_loop_is_rejected_with_the_reason():
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(
            _with_brute_force(
                reference_problem={
                    "kind": "maxcut",
                    "num_variables": 3,
                    "terms": [{"i": 1, "j": 1, "weight": 1.0}],
                }
            )
        )
    assert "self-loop" in str(exc.value)


def test_a_qubo_diagonal_term_is_not_a_self_loop():
    """For qubo, i == j is how the linear coefficient is declared; rejecting it
    would reject every instance with a linear part."""
    plan = Plan.model_validate(
        _with_brute_force(
            reference_problem={
                "kind": "qubo",
                "num_variables": 2,
                "terms": [
                    {"i": 0, "j": 0, "weight": 1.0},
                    {"i": 0, "j": 1, "weight": -2.0},
                ],
            }
        )
    )
    assert plan.verification_plan is not None
    assert plan.verification_plan.reference_problem is not None


def test_qubo_reference_can_preserve_offset_direction_and_linear_constraints():
    plan = Plan.model_validate(
        _with_brute_force(
            reference_problem={
                "kind": "qubo",
                "num_variables": 3,
                "terms": [
                    {"i": 0, "j": 0, "weight": 8.0},
                    {"i": 1, "j": 1, "weight": 5.0},
                    {"i": 2, "j": 2, "weight": 6.0},
                ],
                "offset": 4.0,
                "objective": "maximize",
                "constraints": [
                    {
                        "terms": [
                            {"i": 0, "weight": 4.0},
                            {"i": 1, "weight": 2.0},
                            {"i": 2, "weight": 3.0},
                        ],
                        "sense": "le",
                        "rhs": 7.0,
                    }
                ],
            }
        )
    )

    assert plan.verification_plan is not None
    problem = plan.verification_plan.reference_problem
    assert problem is not None
    assert problem.offset == 4.0
    assert problem.objective == "maximize"
    assert problem.constraints[0].sense == "le"
    assert problem.constraints[0].terms[2].i == 2


def test_constraint_term_outside_the_declared_variable_count_is_rejected():
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(
            _with_brute_force(
                reference_problem={
                    "kind": "qubo",
                    "num_variables": 2,
                    "terms": [{"i": 0, "j": 0, "weight": 1.0}],
                    "constraints": [
                        {
                            "terms": [{"i": 2, "weight": 1.0}],
                            "sense": "eq",
                            "rhs": 1.0,
                        }
                    ],
                }
            )
        )
    assert "constraint term 2" in str(exc.value)


def test_maxcut_cannot_reverse_its_fixed_objective_direction():
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(
            _with_brute_force(reference_problem={**_MAXCUT_PROBLEM, "objective": "minimize"})
        )
    assert "fixed maximize semantics" in str(exc.value)


def test_an_instance_above_the_enumeration_ceiling_is_rejected_by_the_field():
    from majorana_contracts.plan import BRUTE_FORCE_MAX_VARIABLES

    with pytest.raises(ValidationError):
        Plan.model_validate(
            _with_brute_force(
                reference_problem={
                    "kind": "maxcut",
                    "num_variables": BRUTE_FORCE_MAX_VARIABLES + 1,
                    "terms": [{"i": 0, "j": 1, "weight": 1.0}],
                }
            )
        )


def test_a_non_finite_weight_is_rejected_by_the_field_itself():
    with pytest.raises(ValidationError):
        Plan.model_validate(
            _with_brute_force(
                reference_problem={
                    "kind": "maxcut",
                    "num_variables": 2,
                    "terms": [{"i": 0, "j": 1, "weight": float("inf")}],
                }
            )
        )


def test_brute_force_whose_metric_is_not_a_promised_key_is_rejected():
    """The check reads primary_metric out of the result dict. A metric the code
    was never asked to print fails identically on every candidate."""
    with pytest.raises(ValidationError) as exc:
        Plan.model_validate(
            {**_with_brute_force(), "success_criteria": {"primary_metric": "cut_value"}}
        )
    assert "does not promise that key" in str(exc.value)


def test_a_plan_without_brute_force_needs_no_problem():
    """Scoped to the contradiction, like every other rule here."""
    plan = Plan.model_validate({**VALID, "verification_plan": {"methods": ["return_contract"]}})
    assert plan.verification_plan is not None
    assert plan.verification_plan.reference_problem is None


def test_a_dynamics_reference_that_cannot_move_is_refused_with_the_remedy():
    """Three shapes whose value does not depend on the evolution at all.

    Measured against the real check: each one returned "primary metric matches exact
    Plan-declared dynamics" for a candidate that printed a single 1.0, so the run
    earned the exact-evolution verdict without evolving anything.

    - `evolution_time` 0 makes U the identity for every Hamiltonian.
    - A Hamiltonian of identity terms only (`factors: []`) makes U a global phase.
    - A DIAGONAL Hamiltonian makes the computational-basis initial state an
      eigenstate, so its survival probability is exactly 1 at every time and for
      every coefficient. This is the reachable one: an Ising Hamiltonian written
      with ZZ and Z terms is the ordinary way to ask for a quench.

    A plan carrying the reference has asked for the check, so each is a hard error
    with a corrective objection — exact_diag's rule for a reference that IS present.
    """
    zero_time = {**_DYNAMICS_REFERENCE, "evolution_time": 0.0}
    with pytest.raises(ValidationError, match="is the identity for every Hamiltonian"):
        Plan.model_validate(_with_exact_dynamics(zero_time))

    identity_only = {
        **_DYNAMICS_REFERENCE,
        "hamiltonian": [{"coefficient": 2.5, "factors": []}],
    }
    with pytest.raises(ValidationError, match="is the identity \\(no "):
        Plan.model_validate(_with_exact_dynamics(identity_only))

    diagonal_survival = {
        **_DYNAMICS_REFERENCE,
        "metric": "survival_probability",
        "observable": None,
        "hamiltonian": [
            {"coefficient": 1.3, "factors": [{"qubit": 0, "pauli": "Z"}]},
            {
                "coefficient": 0.4,
                "factors": [{"qubit": 0, "pauli": "Z"}, {"qubit": 1, "pauli": "Z"}],
            },
        ],
    }
    with pytest.raises(ValidationError, match="survival probability is exactly 1"):
        Plan.model_validate(_with_exact_dynamics(diagonal_survival))

    # The discriminating cases are untouched: one X factor is enough to move the
    # basis state, and a diagonal Hamiltonian is still fine for an expectation.
    moving = {**diagonal_survival}
    moving["hamiltonian"] = [
        *diagonal_survival["hamiltonian"],
        {"coefficient": 0.2, "factors": [{"qubit": 0, "pauli": "X"}]},
    ]
    assert Plan.model_validate(_with_exact_dynamics(moving)).verification_plan is not None
    assert Plan.model_validate(_with_exact_dynamics()).verification_plan is not None
