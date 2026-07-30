"""Provider-neutral H2 hardware-efficient RY-CX ansatz.

The bounded Phase 7.8 configuration is an Atlas-neutral scientific definition,
not a serialized Qiskit or PennyLane template.  Both providers must consume the
same ordered operation list and the same explicit non-zero initialization.
"""

from __future__ import annotations

import hashlib
import json
import struct
from typing import Literal, Self

from pydantic import Field, model_validator

from .models import SHA256_HEX_PATTERN, VqeBaseModel

H2_HEA_CIRCUIT_SCHEMA_VERSION = "0.1.0"
H2_HEA_PARAMETER_SLOTS = tuple(
    f"theta.layer{layer}.qubit{qubit}" for layer in range(2) for qubit in range(4)
)
H2_HEA_INITIAL_PARAMETERS = (-0.2, -0.1, 0.1, 0.2, 0.2, 0.1, -0.1, -0.2)
H2_HEA_LINEAR_ENTANGLERS = ((0, 1), (1, 2), (2, 3))


def _float64_hex(value: float) -> str:
    return struct.pack(">d", value).hex()


class HardwareEfficientPrimitiveGate(VqeBaseModel):
    gate: Literal["ry", "cx"]
    wires: list[int] = Field(min_length=1, max_length=2)
    parameter_slot_id: str | None = None

    @model_validator(mode="after")
    def _shape_matches_gate(self) -> Self:
        if any(wire < 0 or wire >= 4 for wire in self.wires):
            raise ValueError("wire outside canonical four-qubit register")
        if len(self.wires) != len(set(self.wires)):
            raise ValueError("a gate cannot repeat a wire")
        if self.gate == "cx":
            if len(self.wires) != 2:
                raise ValueError("cx requires control and target")
            if tuple(self.wires) not in H2_HEA_LINEAR_ENTANGLERS:
                raise ValueError("cx does not belong to the frozen directed linear topology")
            if self.parameter_slot_id is not None:
                raise ValueError("cx cannot carry a parameter slot")
        else:
            if len(self.wires) != 1:
                raise ValueError("ry requires one wire")
            if self.parameter_slot_id not in H2_HEA_PARAMETER_SLOTS:
                raise ValueError("ry references an unknown parameter slot")
        return self


class HardwareEfficientParameter(VqeBaseModel):
    slot_id: str
    initial_float64_hex: str = Field(pattern=r"^[0-9a-f]{16}$")

    @model_validator(mode="after")
    def _slot_is_known(self) -> Self:
        if self.slot_id not in H2_HEA_PARAMETER_SLOTS:
            raise ValueError("hardware-efficient parameter slot is not canonical")
        return self


class HardwareEfficientResourceMetrics(VqeBaseModel):
    depth: Literal[7] = 7
    gate_count: Literal[14] = 14
    cnot_count: Literal[6] = 6
    parameter_count: Literal[8] = 8
    rotation_layer_count: Literal[2] = 2
    entanglement_layer_count: Literal[2] = 2


class H2HardwareEfficientCanonicalCircuit(VqeBaseModel):
    schema_version: Literal["0.1.0"] = H2_HEA_CIRCUIT_SCHEMA_VERSION
    circuit_id: Literal["h2.hardware_efficient.ry_linear_cx.reps2.v1"]
    num_qubits: Literal[4]
    rotation_gate: Literal["ry"]
    entanglement_gate: Literal["cx"]
    entanglement_topology: Literal["directed_linear_0_1_2_3"]
    repetitions: Literal[2]
    final_rotation_layer: Literal[False]
    parameter_sharing: Literal["none"]
    reference_state_policy: Literal["external_hartree_fock_1010"]
    parameter_slot_order: list[str] = Field(min_length=8, max_length=8)
    initial_parameters: list[HardwareEfficientParameter] = Field(min_length=8, max_length=8)
    common_basis_operations: list[HardwareEfficientPrimitiveGate] = Field(
        min_length=14,
        max_length=14,
    )
    common_basis_operation_sequence_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    common_basis_metrics: HardwareEfficientResourceMetrics
    compilation_protocol_id: Literal["majorana.h2.hea_ry_cx.common_cnot_depth.v1"]
    compilation_protocol_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    canonical_circuit_sha256: str = Field(pattern=SHA256_HEX_PATTERN)

    @model_validator(mode="after")
    def _ordered_configuration_is_complete(self) -> Self:
        if self.parameter_slot_order != list(H2_HEA_PARAMETER_SLOTS):
            raise ValueError("hardware-efficient parameter-slot order differs from the frozen spec")
        if [item.slot_id for item in self.initial_parameters] != list(H2_HEA_PARAMETER_SLOTS):
            raise ValueError("initial parameters do not follow the frozen slot order")
        expected_initial = [_float64_hex(value) for value in H2_HEA_INITIAL_PARAMETERS]
        if [item.initial_float64_hex for item in self.initial_parameters] != expected_initial:
            raise ValueError("initial parameters differ from the frozen palindromic seed")
        return self


def _canonical_digest(value: object) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _operations() -> list[HardwareEfficientPrimitiveGate]:
    operations: list[HardwareEfficientPrimitiveGate] = []
    for layer in range(2):
        operations.extend(
            HardwareEfficientPrimitiveGate(
                gate="ry",
                wires=[qubit],
                parameter_slot_id=f"theta.layer{layer}.qubit{qubit}",
            )
            for qubit in range(4)
        )
        operations.extend(
            HardwareEfficientPrimitiveGate(gate="cx", wires=list(edge))
            for edge in H2_HEA_LINEAR_ENTANGLERS
        )
    return operations


def _resource_metrics(
    operations: list[HardwareEfficientPrimitiveGate],
) -> HardwareEfficientResourceMetrics:
    wire_depth = [0, 0, 0, 0]
    for operation in operations:
        layer = max(wire_depth[wire] for wire in operation.wires) + 1
        for wire in operation.wires:
            wire_depth[wire] = layer
    return HardwareEfficientResourceMetrics(
        depth=max(wire_depth),
        gate_count=len(operations),
        cnot_count=sum(operation.gate == "cx" for operation in operations),
    )


def build_canonical_h2_hardware_efficient() -> H2HardwareEfficientCanonicalCircuit:
    """Build the deterministic two-layer H2 RY-linear-CX ansatz."""

    operations = _operations()
    operation_json = [operation.model_dump(mode="json") for operation in operations]
    protocol = {
        "protocol_id": "majorana.h2.hea_ry_cx.common_cnot_depth.v1",
        "input_stage": "canonical_ordered_parameterized_gate_list",
        "compiler": "majorana_identity_common_basis_compiler",
        "compiler_version": "0.1.0",
        "basis_gates": ["ry", "cx"],
        "topology": "four_qubit_directed_linear_0_1_2_3",
        "initial_layout": [0, 1, 2, 3],
        "routing_policy": "none",
        "optimization_level": 0,
        "compiler_seed": 0,
        "parameter_binding": "independent_float64_slot_per_ry",
        "metric_scope": "ansatz_only",
        "reference_state_inclusion_policy": "excluded",
        "measurement_inclusion_policy": "excluded",
        "hardware_optimization_inclusion_policy": "excluded",
        "depth_definition": "asap_dependency_layers_each_gate_duration_one",
        "cnot_definition": "count_gate_name_cx",
    }
    unsigned = {
        "schema_version": H2_HEA_CIRCUIT_SCHEMA_VERSION,
        "circuit_id": "h2.hardware_efficient.ry_linear_cx.reps2.v1",
        "num_qubits": 4,
        "rotation_gate": "ry",
        "entanglement_gate": "cx",
        "entanglement_topology": "directed_linear_0_1_2_3",
        "repetitions": 2,
        "final_rotation_layer": False,
        "parameter_sharing": "none",
        "reference_state_policy": "external_hartree_fock_1010",
        "parameter_slot_order": list(H2_HEA_PARAMETER_SLOTS),
        "initial_parameters": [
            {
                "slot_id": slot_id,
                "initial_float64_hex": _float64_hex(value),
            }
            for slot_id, value in zip(
                H2_HEA_PARAMETER_SLOTS,
                H2_HEA_INITIAL_PARAMETERS,
                strict=True,
            )
        ],
        "common_basis_operations": operation_json,
        "common_basis_operation_sequence_sha256": _canonical_digest(operation_json),
        "common_basis_metrics": _resource_metrics(operations).model_dump(mode="json"),
        "compilation_protocol_id": protocol["protocol_id"],
        "compilation_protocol_sha256": _canonical_digest(protocol),
    }
    return H2HardwareEfficientCanonicalCircuit(
        **unsigned,
        canonical_circuit_sha256=_canonical_digest(unsigned),
    )
