import pytest
from pydantic import ValidationError

from majorana_vqe.uccsd import (
    H2_UCCSD_GENERATOR_ORDER,
    H2_UCCSD_PARAMETER_SLOTS,
    build_canonical_h2_uccsd,
)


def test_h2_uccsd_canonical_circuit_is_deterministic() -> None:
    first = build_canonical_h2_uccsd()
    second = build_canonical_h2_uccsd()

    assert first == second
    assert len(first.logical_rotations) == 12
    assert first.generator_order == list(H2_UCCSD_GENERATOR_ORDER)
    assert first.parameter_slot_order == list(H2_UCCSD_PARAMETER_SLOTS)
    assert first.common_basis_metrics.parameter_count == 3
    assert first.common_basis_metrics.pauli_rotation_count == 12
    assert first.common_basis_metrics.cnot_count == 56


def test_h2_uccsd_uses_standard_exp_theta_generator_scaling() -> None:
    circuit = build_canonical_h2_uccsd()
    double_rotations = circuit.logical_rotations[:8]
    single_rotations = circuit.logical_rotations[8:]

    assert {rotation.rz_angle_theta_denominator for rotation in double_rotations} == {4}
    assert {rotation.rz_angle_theta_denominator for rotation in single_rotations} == {1}


def test_h2_uccsd_rejects_parameter_slot_relabeling() -> None:
    circuit = build_canonical_h2_uccsd()
    payload = circuit.model_dump(mode="json")
    payload["logical_rotations"][0]["parameter_slot_id"] = H2_UCCSD_PARAMETER_SLOTS[1]

    with pytest.raises(ValidationError, match="does not match its generator"):
        type(circuit).model_validate(payload)


def test_h2_uccsd_is_not_the_frozen_half_angle_ansatz() -> None:
    circuit = build_canonical_h2_uccsd()

    assert circuit.parameter_orientation == "exp_theta_generator"
    assert circuit.circuit_id != "h2.double.occ0_occ2.to.virt1_virt3.jw.v1"
