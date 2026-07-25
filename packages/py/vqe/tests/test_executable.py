from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from majorana_vqe.executable import (
    AnsatzDefinitionSpec,
    ExecutableCompositionError,
    parse_executable_component,
    validate_h2_executable_composition,
)
from majorana_vqe.models import ComponentType

ROOT = Path(__file__).resolve().parents[4]
COMPONENT_FIXTURE = (
    ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "executable_components_v0.2.json"
)


def _fixture() -> dict[ComponentType, dict[str, object]]:
    raw = json.loads(COMPONENT_FIXTURE.read_text())
    return {ComponentType(role): value for role, value in raw.items()}


def test_review_candidate_h2_components_form_one_executable_workflow():
    workflow = validate_h2_executable_composition(_fixture())

    assert workflow.problem.molecule == "H2"
    assert workflow.reference_state.bitstring_qubit0_first == "1010"
    assert workflow.ansatz.expected_parameter_count == 1
    assert workflow.operator_pool.generator_ids == [workflow.ansatz.generator_id]
    assert workflow.compilation.primary_resource_stages == [
        "canonical_logical",
        "common_basis_compiled",
    ]
    assert workflow.compilation.expected_common_basis_cnot_count == 48
    assert workflow.compilation.expected_common_basis_depth == 83


def test_component_type_and_payload_kind_must_agree():
    problem = _fixture()[ComponentType.PROBLEM]
    with pytest.raises(ExecutableCompositionError, match="requires AnsatzDefinitionSpec"):
        parse_executable_component(ComponentType.ANSATZ, problem)


def test_unknown_fields_fail_closed():
    ansatz = dict(_fixture()[ComponentType.ANSATZ])
    ansatz["undeclared_generator_magic"] = True
    with pytest.raises(ValidationError, match="undeclared_generator_magic"):
        AnsatzDefinitionSpec.model_validate(ansatz)


def test_qubit_width_mismatch_fails_before_execution():
    fixture = _fixture()
    fixture[ComponentType.REFERENCE_STATE] = {
        **fixture[ComponentType.REFERENCE_STATE],
        "bitstring_qubit0_first": "1000",
    }
    with pytest.raises(ValidationError, match="active_electrons"):
        validate_h2_executable_composition(fixture)


def test_parameter_slot_must_bind_the_declared_generator():
    ansatz = dict(_fixture()[ComponentType.ANSATZ])
    slots = [dict(ansatz["parameter_slots"][0])]
    slots[0]["generator_id"] = "double.other"
    ansatz["parameter_slots"] = slots
    with pytest.raises(ValidationError, match="parameter slot"):
        AnsatzDefinitionSpec.model_validate(ansatz)


def test_missing_compilation_protocol_fails_closed():
    fixture = _fixture()
    del fixture[ComponentType.COMPILATION_BACKEND]
    with pytest.raises(ExecutableCompositionError, match="compilation_backend"):
        validate_h2_executable_composition(fixture)
