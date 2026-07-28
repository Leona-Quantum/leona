from __future__ import annotations

import pytest

from majorana_api.repos.vqe import (
    ComparisonIntegrityError,
    _validate_concrete_comparison_configuration,
)


def test_concrete_configuration_matches_immutable_optimizer() -> None:
    _validate_concrete_comparison_configuration(
        label="candidate",
        declared={"algorithm": "scipy_slsqp", "max_function_evaluations": "256"},
        optimizer_spec_json={
            "algorithm": "scipy_slsqp",
            "max_function_evaluations": 256,
        },
    )


@pytest.mark.parametrize(
    "declared",
    [
        {"max_objective_evaluations": "1"},
        {"algorithm": "invented"},
        {"algorithm": "scipy_slsqp", "unknown": "value"},
    ],
)
def test_concrete_configuration_rejects_unbound_claims(
    declared: dict[str, str],
) -> None:
    with pytest.raises(ComparisonIntegrityError):
        _validate_concrete_comparison_configuration(
            label="candidate",
            declared=declared,
            optimizer_spec_json={
                "algorithm": "scipy_slsqp",
                "max_function_evaluations": 256,
            },
        )


def test_structured_definition_without_provider_configuration_is_unchanged() -> None:
    _validate_concrete_comparison_configuration(
        label="candidate",
        declared={"algorithm": "structured_slsqp"},
        optimizer_spec_json={"kind": "component_definition"},
    )
