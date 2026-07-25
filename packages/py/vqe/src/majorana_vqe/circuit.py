"""Framework-neutral canonical H2 double-excitation circuit.

The scientific generator is

    G = a†_1 a†_3 a_2 a_0 - a†_0 a†_2 a_3 a_1

and the ansatz block is exp(theta / 2 * G).  Under the frozen Jordan-Wigner
and qubit-0-first conventions, G is an exactly commuting sum of eight
imaginary Pauli words.  Each word is compiled deterministically to basis
changes, a CNOT parity ladder, and one RZ rotation.  No provider-native
UnitaryGate/QubitUnitary is part of this resource protocol.
"""

from __future__ import annotations

import hashlib
import json
from typing import Literal, Self

from pydantic import Field, model_validator

from .models import SHA256_HEX_PATTERN, VqeBaseModel

CANONICAL_CIRCUIT_SCHEMA_VERSION = "0.2.0"
CANONICAL_PARAMETER_SLOT = "theta.double.occ0_occ2.to.virt1_virt3"


class PauliRotation(VqeBaseModel):
    pauli_qubit0_first: str = Field(pattern=r"^[IXYZ]{4}$")
    generator_imaginary_coefficient_numerator: Literal[-1, 1]
    generator_imaginary_coefficient_denominator: Literal[8] = 8
    rz_angle_theta_numerator: Literal[-1, 1]
    rz_angle_theta_denominator: Literal[8] = 8
    parameter_slot_id: Literal["theta.double.occ0_occ2.to.virt1_virt3"] = CANONICAL_PARAMETER_SLOT

    @model_validator(mode="after")
    def _rz_angle_matches_generator(self) -> Self:
        if self.rz_angle_theta_numerator != -self.generator_imaginary_coefficient_numerator:
            raise ValueError("RZ angle must be -theta times the imaginary generator coefficient")
        return self


class PrimitiveGate(VqeBaseModel):
    gate: Literal["h", "s", "sdg", "rz", "cx"]
    wires: list[int] = Field(min_length=1, max_length=2)
    parameter_slot_id: str | None = None
    angle_theta_numerator: int | None = None
    angle_theta_denominator: int | None = None

    @model_validator(mode="after")
    def _shape_matches_gate(self) -> Self:
        if any(wire < 0 or wire >= 4 for wire in self.wires):
            raise ValueError("wire outside canonical four-qubit register")
        if len(self.wires) != len(set(self.wires)):
            raise ValueError("a gate cannot repeat a wire")
        if self.gate == "cx":
            if len(self.wires) != 2:
                raise ValueError("cx requires control and target")
        elif len(self.wires) != 1:
            raise ValueError(f"{self.gate} requires one wire")
        angle_fields = (
            self.parameter_slot_id,
            self.angle_theta_numerator,
            self.angle_theta_denominator,
        )
        if self.gate == "rz":
            if any(value is None for value in angle_fields):
                raise ValueError("rz requires a complete symbolic theta angle")
            if self.angle_theta_denominator != 8:
                raise ValueError("canonical excitation RZ denominator must be 8")
        elif any(value is not None for value in angle_fields):
            raise ValueError("only rz may carry a symbolic angle")
        return self


class ResourceMetrics(VqeBaseModel):
    depth: int = Field(ge=0)
    gate_count: int = Field(ge=0)
    cnot_count: int = Field(ge=0)
    parameter_count: Literal[1] = 1


class CommonCompilationProtocol(VqeBaseModel):
    schema_version: Literal["0.2.0"] = CANONICAL_CIRCUIT_SCHEMA_VERSION
    protocol_id: Literal["majorana.h2.common_cnot_depth.v2"]
    input_stage: Literal["canonical_logical_pauli_rotations"]
    compiler: Literal["majorana_deterministic_pauli_rotation_compiler"]
    compiler_version: Literal["0.2.0"]
    basis_gates: list[str]
    topology: Literal["four_qubit_all_to_all"]
    initial_layout: list[int]
    routing_policy: Literal["none"]
    optimization_level: Literal[0]
    compiler_seed: Literal[0]
    parameter_binding: Literal["same_float64_theta_for_all_rotations"]
    metric_scope: Literal["ansatz_only"]
    reference_state_inclusion_policy: Literal["excluded"]
    measurement_inclusion_policy: Literal["excluded"]
    hardware_optimization_inclusion_policy: Literal["excluded"]
    depth_definition: Literal["asap_dependency_layers_each_gate_duration_one"]
    cnot_definition: Literal["count_gate_name_cx"]
    allowed_primary_stages: list[Literal["canonical_logical", "common_basis_compiled"]]
    diagnostic_stage: Literal["provider_native_diagnostic"]


class CanonicalExcitationCircuit(VqeBaseModel):
    schema_version: Literal["0.2.0"] = CANONICAL_CIRCUIT_SCHEMA_VERSION
    circuit_id: Literal["h2.double.occ0_occ2.to.virt1_virt3.jw.v1"]
    generator_definition: Literal["create1_create3_annihilate2_annihilate0_minus_adjoint"]
    generator_orientation: Literal["occupied_0_2_to_virtual_1_3"]
    generator_convention: Literal["antihermitian_tau_minus_tau_dagger"]
    parameter_orientation: Literal["exp_theta_over_2_generator"]
    qubit_order: Literal["qubit0_first"]
    parameter_slot_id: Literal["theta.double.occ0_occ2.to.virt1_virt3"] = CANONICAL_PARAMETER_SLOT
    logical_rotations: list[PauliRotation] = Field(min_length=8, max_length=8)
    common_basis_operations: list[PrimitiveGate] = Field(min_length=1)
    common_basis_operation_sequence_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    common_basis_metrics: ResourceMetrics
    compilation_protocol: CommonCompilationProtocol
    compilation_protocol_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    canonical_circuit_sha256: str = Field(pattern=SHA256_HEX_PATTERN)


# Coefficients a in G = i * sum(a P), using qubit-0-first Pauli labels.
_GENERATOR_TERMS: tuple[tuple[str, int], ...] = (
    ("XXXY", -1),
    ("XXYX", 1),
    ("XYXX", -1),
    ("XYYY", -1),
    ("YXXX", 1),
    ("YXYY", 1),
    ("YYXY", -1),
    ("YYYX", 1),
)


def _canonical_digest(value: object) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _rotation_operations(rotation: PauliRotation) -> list[PrimitiveGate]:
    operations: list[PrimitiveGate] = []
    for wire, letter in enumerate(rotation.pauli_qubit0_first):
        if letter == "X":
            operations.append(PrimitiveGate(gate="h", wires=[wire]))
        elif letter == "Y":
            operations.extend(
                [
                    PrimitiveGate(gate="sdg", wires=[wire]),
                    PrimitiveGate(gate="h", wires=[wire]),
                ]
            )
    active = [wire for wire, letter in enumerate(rotation.pauli_qubit0_first) if letter != "I"]
    for control, target in zip(active, active[1:]):
        operations.append(PrimitiveGate(gate="cx", wires=[control, target]))
    operations.append(
        PrimitiveGate(
            gate="rz",
            wires=[active[-1]],
            parameter_slot_id=rotation.parameter_slot_id,
            angle_theta_numerator=rotation.rz_angle_theta_numerator,
            angle_theta_denominator=rotation.rz_angle_theta_denominator,
        )
    )
    for control, target in reversed(list(zip(active, active[1:]))):
        operations.append(PrimitiveGate(gate="cx", wires=[control, target]))
    for wire, letter in reversed(list(enumerate(rotation.pauli_qubit0_first))):
        if letter == "X":
            operations.append(PrimitiveGate(gate="h", wires=[wire]))
        elif letter == "Y":
            operations.extend(
                [
                    PrimitiveGate(gate="h", wires=[wire]),
                    PrimitiveGate(gate="s", wires=[wire]),
                ]
            )
    return operations


def _resource_metrics(operations: list[PrimitiveGate]) -> ResourceMetrics:
    wire_depth = [0, 0, 0, 0]
    for operation in operations:
        layer = max(wire_depth[wire] for wire in operation.wires) + 1
        for wire in operation.wires:
            wire_depth[wire] = layer
    return ResourceMetrics(
        depth=max(wire_depth),
        gate_count=len(operations),
        cnot_count=sum(operation.gate == "cx" for operation in operations),
    )


def build_canonical_h2_double_excitation() -> CanonicalExcitationCircuit:
    rotations = [
        PauliRotation(
            pauli_qubit0_first=pauli,
            generator_imaginary_coefficient_numerator=coefficient,
            rz_angle_theta_numerator=-coefficient,
        )
        for pauli, coefficient in _GENERATOR_TERMS
    ]
    operations = [
        operation for rotation in rotations for operation in _rotation_operations(rotation)
    ]
    protocol = CommonCompilationProtocol(
        protocol_id="majorana.h2.common_cnot_depth.v2",
        input_stage="canonical_logical_pauli_rotations",
        compiler="majorana_deterministic_pauli_rotation_compiler",
        compiler_version="0.2.0",
        basis_gates=["h", "s", "sdg", "rz", "cx"],
        topology="four_qubit_all_to_all",
        initial_layout=[0, 1, 2, 3],
        routing_policy="none",
        optimization_level=0,
        compiler_seed=0,
        parameter_binding="same_float64_theta_for_all_rotations",
        metric_scope="ansatz_only",
        reference_state_inclusion_policy="excluded",
        measurement_inclusion_policy="excluded",
        hardware_optimization_inclusion_policy="excluded",
        depth_definition="asap_dependency_layers_each_gate_duration_one",
        cnot_definition="count_gate_name_cx",
        allowed_primary_stages=["canonical_logical", "common_basis_compiled"],
        diagnostic_stage="provider_native_diagnostic",
    )
    protocol_json = protocol.model_dump(mode="json")
    operation_json = [operation.model_dump(mode="json") for operation in operations]
    unsigned = {
        "schema_version": CANONICAL_CIRCUIT_SCHEMA_VERSION,
        "circuit_id": "h2.double.occ0_occ2.to.virt1_virt3.jw.v1",
        "generator_definition": ("create1_create3_annihilate2_annihilate0_minus_adjoint"),
        "generator_orientation": "occupied_0_2_to_virtual_1_3",
        "generator_convention": "antihermitian_tau_minus_tau_dagger",
        "parameter_orientation": "exp_theta_over_2_generator",
        "qubit_order": "qubit0_first",
        "parameter_slot_id": CANONICAL_PARAMETER_SLOT,
        "logical_rotations": [rotation.model_dump(mode="json") for rotation in rotations],
        "common_basis_operations": operation_json,
        "common_basis_operation_sequence_sha256": _canonical_digest(operation_json),
        "common_basis_metrics": _resource_metrics(operations).model_dump(mode="json"),
        "compilation_protocol": protocol_json,
        "compilation_protocol_sha256": _canonical_digest(protocol_json),
    }
    return CanonicalExcitationCircuit(
        **unsigned,
        canonical_circuit_sha256=_canonical_digest(unsigned),
    )
