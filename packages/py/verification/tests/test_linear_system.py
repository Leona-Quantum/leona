"""Bounded independent linear-system references."""

import pytest
from majorana_contracts import ExactLinearSystemReference
from majorana_verification import (
    LinearSystemReferenceError,
    exact_linear_system_comparison,
    exact_linear_system_values,
    linear_system_references_equivalent,
)


def _reference() -> ExactLinearSystemReference:
    return ExactLinearSystemReference.model_validate(
        {
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
    )


def test_exact_linear_system_values_match_an_external_solve():
    values, diagnostics = exact_linear_system_values(_reference())

    assert values == pytest.approx(
        {
            "solution_x0": 0.8804710999221753,
            "solution_x1": -0.4740998230350174,
            "amplitude_ratio": -0.5384615384615384,
            "residual_norm": 0.0,
            "state_fidelity": 1.0,
        },
        abs=1e-12,
    )
    assert diagnostics["condition_number"] == pytest.approx(2.0)


def test_equal_magnitude_components_use_a_stable_lowest_index_phase_convention():
    reference = _reference().model_copy(
        update={
            "matrix": [[0.5, -0.375], [-0.375, 0.5]],
            "rhs": [-1.0, 1.0],
        }
    )

    values, _ = exact_linear_system_values(reference)

    assert values["solution_x0"] == pytest.approx(2**-0.5, abs=1e-12)
    assert values["solution_x1"] == pytest.approx(-(2**-0.5), abs=1e-12)
    assert values["amplitude_ratio"] == pytest.approx(-1.0, abs=1e-12)


def test_exact_linear_system_rejects_the_wrong_live_hhl_result():
    passed, details = exact_linear_system_comparison(
        _reference(),
        {
            "solution_x0": 0.6513219908377317,
            "solution_x1": -0.7110180413709063,
            "amplitude_ratio": -0.9160414404983659,
            "residual_norm": 0.7036114084173234,
            "state_fidelity": 0.8449126017578782,
        },
    )

    assert not passed
    assert set(details["scores"]) == {
        "solution_x0",
        "solution_x1",
        "amplitude_ratio",
        "residual_norm",
        "state_fidelity",
    }
    assert len(details["disagreements"]) == 5


def test_exact_linear_system_rejects_singular_input_without_fabricating_truth():
    reference = _reference().model_copy(update={"matrix": [[1.0, 1.0], [1.0, 1.0]]})

    with pytest.raises(LinearSystemReferenceError, match="condition number|singular"):
        exact_linear_system_values(reference)


def test_linear_system_consensus_compares_result_meanings_not_only_answers():
    wrong_normalization = _reference().model_copy(
        update={
            "results": [
                result.model_copy(update={"metric": "solution_component"})
                if result.result_key == "solution_x0"
                else result
                for result in _reference().results
            ]
        }
    )
    equivalent, comparison = linear_system_references_equivalent(_reference(), wrong_normalization)

    assert not equivalent
    assert comparison == {
        "reason": "linear_system_result_metric_mismatch",
        "result_key": "solution_x0",
    }


def test_linear_system_consensus_is_order_insensitive_but_rejects_ratio_reversal():
    reordered = _reference().model_copy(update={"results": list(reversed(_reference().results))})
    equivalent, _ = linear_system_references_equivalent(_reference(), reordered)
    assert equivalent

    reversed_ratio = _reference().model_copy(
        update={
            "results": [
                result.model_copy(update={"numerator_index": 0, "denominator_index": 1})
                if result.result_key == "amplitude_ratio"
                else result
                for result in _reference().results
            ]
        }
    )
    equivalent, comparison = linear_system_references_equivalent(_reference(), reversed_ratio)
    assert not equivalent
    assert comparison["reason"] == "linear_system_result_target_mismatch"


def test_every_declared_key_scores_even_when_its_RESULT_value_is_unusable():
    """The caller reads `scores[primary_metric]["exact"]`, so the entry has to exist.

    `_success_criteria_check` admits a metric that is PRESENT in RESULT — its guard is
    `metric not in execution.result` — so a string, null or bool reaches this function.
    Skipping the score entry for those turned the caller's lookup into an uncaught
    KeyError that crashed the review step, and a crashed review step gives the repair
    loop nothing to repair from. Verdicts fail; they do not raise.
    """

    for unusable in ("not-computed", None, True, float("nan")):
        passed, details = exact_linear_system_comparison(
            _reference(),
            {
                "solution_x0": 0.8804710999221753,
                "solution_x1": -0.4740998230350174,
                "amplitude_ratio": -0.5384615384615384,
                "residual_norm": 0.0,
                "state_fidelity": unusable,
            },
        )

        assert not passed
        assert "state_fidelity" in details["scores"], unusable
        assert details["scores"]["state_fidelity"]["exact"] == pytest.approx(1.0)
        assert details["scores"]["state_fidelity"]["metric"] == "state_fidelity"
        assert any("state_fidelity" in line for line in details["disagreements"])


def test_a_reference_built_only_from_constants_is_refused_by_the_schema():
    """`residual_norm` references 0 and `state_fidelity` references 1, always.

    Neither is derived from the declared matrix and rhs, so neither says anything
    about the candidate's own solution vector: a program that prints those two
    numbers and computes nothing passed `exact_linear_system` with the verdict
    "all declared scalars match the independently solved linear system". At least
    one solution-bound component has to be checked for that sentence to be true.
    """

    with pytest.raises(ValueError, match="must bind at least one of"):
        ExactLinearSystemReference.model_validate(
            {
                "matrix": [[0.75, 0.25], [0.25, 0.75]],
                "rhs": [1.0, -0.25],
                "results": [
                    {"result_key": "state_fidelity", "metric": "state_fidelity"},
                    {"result_key": "residual_norm", "metric": "residual_norm"},
                ],
            }
        )

    # One bound component is enough, and the constants may ride along with it.
    bound = ExactLinearSystemReference.model_validate(
        {
            "matrix": [[0.75, 0.25], [0.25, 0.75]],
            "rhs": [1.0, -0.25],
            "results": [
                {"result_key": "state_fidelity", "metric": "state_fidelity"},
                {"result_key": "x0", "metric": "normalized_solution_component", "index": 0},
            ],
        }
    )
    assert len(bound.results) == 2
