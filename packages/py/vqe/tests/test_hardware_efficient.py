import pytest
from pydantic import ValidationError

from majorana_vqe.hardware_efficient import (
    H2_HEA_INITIAL_PARAMETERS,
    H2_HEA_PARAMETER_SLOTS,
    build_canonical_h2_hardware_efficient,
)


def test_h2_hardware_efficient_circuit_is_deterministic() -> None:
    first = build_canonical_h2_hardware_efficient()
    second = build_canonical_h2_hardware_efficient()

    assert first == second
    assert first.parameter_slot_order == list(H2_HEA_PARAMETER_SLOTS)
    assert first.common_basis_metrics.depth == 7
    assert first.common_basis_metrics.gate_count == 14
    assert first.common_basis_metrics.cnot_count == 6
    assert first.common_basis_metrics.parameter_count == 8


def test_h2_hardware_efficient_operation_order_is_explicit() -> None:
    circuit = build_canonical_h2_hardware_efficient()
    gates = [operation.gate for operation in circuit.common_basis_operations]

    assert gates == ["ry"] * 4 + ["cx"] * 3 + ["ry"] * 4 + ["cx"] * 3
    assert [
        tuple(operation.wires)
        for operation in circuit.common_basis_operations
        if operation.gate == "cx"
    ] == [(0, 1), (1, 2), (2, 3)] * 2


def test_h2_hardware_efficient_seed_is_nonzero_palindromic_and_frozen() -> None:
    circuit = build_canonical_h2_hardware_efficient()

    assert H2_HEA_INITIAL_PARAMETERS == tuple(reversed(H2_HEA_INITIAL_PARAMETERS))
    assert all(value != 0.0 for value in H2_HEA_INITIAL_PARAMETERS)
    assert len(circuit.initial_parameters) == 8


def test_h2_hardware_efficient_rejects_parameter_relabeling() -> None:
    circuit = build_canonical_h2_hardware_efficient()
    payload = circuit.model_dump(mode="json")
    payload["common_basis_operations"][0]["parameter_slot_id"] = "theta.unknown"

    with pytest.raises(ValidationError, match="unknown parameter slot"):
        type(circuit).model_validate(payload)


def test_h2_hardware_efficient_rejects_noncanonical_seed() -> None:
    circuit = build_canonical_h2_hardware_efficient()
    payload = circuit.model_dump(mode="json")
    payload["initial_parameters"][0]["initial_float64_hex"] = "0000000000000000"

    with pytest.raises(ValidationError, match="frozen palindromic seed"):
        type(circuit).model_validate(payload)
