from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from majorana_vqe.models import ComponentSpec, ComponentType
from majorana_vqe.protocol import (
    ComponentTypeMismatchError,
    EvaluationProtocol,
    StoppingCriterion,
    StoppingProtocol,
    parse_evaluation_protocol,
    parse_stopping_protocol,
)


class TestEvaluationProtocol:
    def test_exact_estimator_forbids_shots(self):
        with pytest.raises(ValidationError):
            EvaluationProtocol(estimator="exact", shots=1000)

    def test_finite_shot_estimator_requires_shots(self):
        with pytest.raises(ValidationError):
            EvaluationProtocol(estimator="finite_shot")

    def test_valid_exact_protocol(self):
        protocol = EvaluationProtocol(estimator="exact", exact_diagonalization_tolerance_ha=1e-10)
        assert protocol.shots is None

    def test_valid_finite_shot_protocol(self):
        protocol = EvaluationProtocol(estimator="finite_shot", shots=8192)
        assert protocol.shots == 8192


class TestStoppingProtocol:
    def test_max_iterations_criterion_requires_max_iterations(self):
        with pytest.raises(ValidationError):
            StoppingProtocol(criterion=StoppingCriterion.MAX_ITERATIONS)

    def test_valid_max_iterations_protocol(self):
        protocol = StoppingProtocol(criterion=StoppingCriterion.MAX_ITERATIONS, max_iterations=200)
        assert protocol.max_iterations == 200

    def test_energy_convergence_criterion_requires_tolerance(self):
        with pytest.raises(ValidationError):
            StoppingProtocol(criterion=StoppingCriterion.ENERGY_CONVERGENCE)


class TestParseEvaluationProtocol:
    def test_rejects_component_of_wrong_type(self):
        component = ComponentSpec(
            artifact_version_id=uuid4(),
            component_type=ComponentType.ANSATZ,
            spec_json={"estimator": "exact"},
        )
        with pytest.raises(ComponentTypeMismatchError):
            parse_evaluation_protocol(component)

    def test_parses_a_correctly_typed_component(self):
        component = ComponentSpec(
            artifact_version_id=uuid4(),
            component_type=ComponentType.EVALUATION_PROTOCOL,
            spec_json={"estimator": "exact", "exact_diagonalization_tolerance_ha": 1e-10},
        )
        protocol = parse_evaluation_protocol(component)
        assert protocol.estimator.value == "exact"


class TestParseStoppingProtocol:
    def test_rejects_component_of_wrong_type(self):
        component = ComponentSpec(
            artifact_version_id=uuid4(),
            component_type=ComponentType.EVALUATION_PROTOCOL,
            spec_json={"criterion": "max_iterations", "max_iterations": 100},
        )
        with pytest.raises(ComponentTypeMismatchError):
            parse_stopping_protocol(component)

    def test_parses_a_correctly_typed_component(self):
        component = ComponentSpec(
            artifact_version_id=uuid4(),
            component_type=ComponentType.STOPPING_PROTOCOL,
            spec_json={"criterion": "gradient_norm", "gradient_norm_tolerance": 1e-3},
        )
        protocol = parse_stopping_protocol(component)
        assert protocol.criterion is StoppingCriterion.GRADIENT_NORM
