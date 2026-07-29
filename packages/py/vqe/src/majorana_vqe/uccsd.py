"""Provider-neutral canonical H2 UCCSD configuration and circuit.

This module deliberately does not reuse the frozen one-parameter circuit's
``exp(theta / 2 * G)`` convention.  It defines a separate, explicitly ordered
first-order UCCSD product with three independent ``exp(theta * G)`` factors.
"""

from __future__ import annotations

import hashlib
import json
from typing import Literal, Self

from pydantic import Field, model_validator

from .models import SHA256_HEX_PATTERN, VqeBaseModel

H2_UCCSD_CIRCUIT_SCHEMA_VERSION = "0.1.0"

DOUBLE_GENERATOR_ID = "double.occ0_occ2.to.virt1_virt3"
ALPHA_SINGLE_GENERATOR_ID = "single.occ0.to.virt1"
BETA_SINGLE_GENERATOR_ID = "single.occ2.to.virt3"
H2_UCCSD_GENERATOR_ORDER = (
    DOUBLE_GENERATOR_ID,
    ALPHA_SINGLE_GENERATOR_ID,
    BETA_SINGLE_GENERATOR_ID,
)

H2_UCCSD_PARAMETER_SLOTS = (
    "theta.double.occ0_occ2.to.virt1_virt3",
    "theta.single.occ0.to.virt1",
    "theta.single.occ2.to.virt3",
)


class UccsdPauliRotation(VqeBaseModel):
    generator_id: Literal[
        "double.occ0_occ2.to.virt1_virt3",
        "single.occ0.to.virt1",
        "single.occ2.to.virt3",
    ]
    pauli_qubit0_first: str = Field(pattern=r"^[IXYZ]{4}$")
    generator_imaginary_coefficient_numerator: int
    generator_imaginary_coefficient_denominator: Literal[2, 8]
    rz_angle_theta_numerator: int
    rz_angle_theta_denominator: Literal[1, 4]
    parameter_slot_id: Literal[
        "theta.double.occ0_occ2.to.virt1_virt3",
        "theta.single.occ0.to.virt1",
        "theta.single.occ2.to.virt3",
    ]

    @model_validator(mode="after")
    def _angle_implements_exp_theta_generator(self) -> Self:
        # G = i * a * P and RZ(phi) implements exp(-i phi P / 2),
        # therefore exp(theta G) requires phi = -2 * a * theta.
        left = self.rz_angle_theta_numerator * self.generator_imaginary_coefficient_denominator
        right = (
            -2 * self.generator_imaginary_coefficient_numerator * self.rz_angle_theta_denominator
        )
        if left != right:
            raise ValueError("RZ angle must implement exp(theta * generator)")
        expected_slot = {
            DOUBLE_GENERATOR_ID: H2_UCCSD_PARAMETER_SLOTS[0],
            ALPHA_SINGLE_GENERATOR_ID: H2_UCCSD_PARAMETER_SLOTS[1],
            BETA_SINGLE_GENERATOR_ID: H2_UCCSD_PARAMETER_SLOTS[2],
        }[self.generator_id]
        if self.parameter_slot_id != expected_slot:
            raise ValueError("rotation parameter slot does not match its generator")
        return self


class UccsdPrimitiveGate(VqeBaseModel):
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
                raise ValueError("rz requires a complete symbolic angle")
            if self.parameter_slot_id not in H2_UCCSD_PARAMETER_SLOTS:
                raise ValueError("rz references an unknown UCCSD parameter slot")
            if self.angle_theta_denominator not in (1, 4):
                raise ValueError("UCCSD RZ denominator must be 1 or 4")
        elif any(value is not None for value in angle_fields):
            raise ValueError("only rz may carry a symbolic angle")
        return self


class UccsdResourceMetrics(VqeBaseModel):
    depth: int = Field(ge=0)
    gate_count: int = Field(ge=0)
    cnot_count: int = Field(ge=0)
    parameter_count: Literal[3] = 3
    pauli_rotation_count: Literal[12] = 12


class H2UccsdCanonicalCircuit(VqeBaseModel):
    schema_version: Literal["0.1.0"] = H2_UCCSD_CIRCUIT_SCHEMA_VERSION
    circuit_id: Literal["h2.uccsd.first_order.double_then_singles.jw.v1"]
    num_qubits: Literal[4]
    generator_convention: Literal["antihermitian_tau_minus_tau_dagger"]
    parameter_orientation: Literal["exp_theta_generator"]
    product_formula_order: Literal["double_then_singles"]
    trotter_order: Literal[1]
    trotter_steps: Literal[1]
    parameter_sharing: Literal["none"]
    generator_order: list[str] = Field(min_length=3, max_length=3)
    parameter_slot_order: list[str] = Field(min_length=3, max_length=3)
    logical_rotations: list[UccsdPauliRotation] = Field(min_length=12, max_length=12)
    common_basis_operations: list[UccsdPrimitiveGate] = Field(min_length=1)
    common_basis_operation_sequence_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    common_basis_metrics: UccsdResourceMetrics
    compilation_protocol_id: Literal["majorana.h2.uccsd.common_cnot_depth.v1"]
    compilation_protocol_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    canonical_circuit_sha256: str = Field(pattern=SHA256_HEX_PATTERN)

    @model_validator(mode="after")
    def _ordered_configuration_is_complete(self) -> Self:
        if self.generator_order != list(H2_UCCSD_GENERATOR_ORDER):
            raise ValueError("UCCSD generator order differs from the frozen configuration")
        if self.parameter_slot_order != list(H2_UCCSD_PARAMETER_SLOTS):
            raise ValueError("UCCSD parameter-slot order differs from the frozen configuration")
        seen = {rotation.generator_id for rotation in self.logical_rotations}
        if seen != set(H2_UCCSD_GENERATOR_ORDER):
            raise ValueError("UCCSD logical rotations do not cover every generator")
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


def _rotation_operations(rotation: UccsdPauliRotation) -> list[UccsdPrimitiveGate]:
    operations: list[UccsdPrimitiveGate] = []
    for wire, letter in enumerate(rotation.pauli_qubit0_first):
        if letter == "X":
            operations.append(UccsdPrimitiveGate(gate="h", wires=[wire]))
        elif letter == "Y":
            operations.extend(
                [
                    UccsdPrimitiveGate(gate="sdg", wires=[wire]),
                    UccsdPrimitiveGate(gate="h", wires=[wire]),
                ]
            )
    active = [wire for wire, letter in enumerate(rotation.pauli_qubit0_first) if letter != "I"]
    for control, target in zip(active, active[1:]):
        operations.append(UccsdPrimitiveGate(gate="cx", wires=[control, target]))
    operations.append(
        UccsdPrimitiveGate(
            gate="rz",
            wires=[active[-1]],
            parameter_slot_id=rotation.parameter_slot_id,
            angle_theta_numerator=rotation.rz_angle_theta_numerator,
            angle_theta_denominator=rotation.rz_angle_theta_denominator,
        )
    )
    for control, target in reversed(list(zip(active, active[1:]))):
        operations.append(UccsdPrimitiveGate(gate="cx", wires=[control, target]))
    for wire, letter in reversed(list(enumerate(rotation.pauli_qubit0_first))):
        if letter == "X":
            operations.append(UccsdPrimitiveGate(gate="h", wires=[wire]))
        elif letter == "Y":
            operations.extend(
                [
                    UccsdPrimitiveGate(gate="h", wires=[wire]),
                    UccsdPrimitiveGate(gate="s", wires=[wire]),
                ]
            )
    return operations


def _resource_metrics(operations: list[UccsdPrimitiveGate]) -> UccsdResourceMetrics:
    wire_depth = [0, 0, 0, 0]
    for operation in operations:
        layer = max(wire_depth[wire] for wire in operation.wires) + 1
        for wire in operation.wires:
            wire_depth[wire] = layer
    return UccsdResourceMetrics(
        depth=max(wire_depth),
        gate_count=len(operations),
        cnot_count=sum(operation.gate == "cx" for operation in operations),
    )


def _rotations() -> list[UccsdPauliRotation]:
    double_terms = (
        ("XXXY", -1),
        ("XXYX", 1),
        ("XYXX", -1),
        ("XYYY", -1),
        ("YXXX", 1),
        ("YXYY", 1),
        ("YYXY", -1),
        ("YYYX", 1),
    )
    rotations = [
        UccsdPauliRotation(
            generator_id=DOUBLE_GENERATOR_ID,
            pauli_qubit0_first=pauli,
            generator_imaginary_coefficient_numerator=coefficient,
            generator_imaginary_coefficient_denominator=8,
            rz_angle_theta_numerator=-coefficient,
            rz_angle_theta_denominator=4,
            parameter_slot_id=H2_UCCSD_PARAMETER_SLOTS[0],
        )
        for pauli, coefficient in double_terms
    ]
    for generator_id, parameter_slot, offset in (
        (ALPHA_SINGLE_GENERATOR_ID, H2_UCCSD_PARAMETER_SLOTS[1], 0),
        (BETA_SINGLE_GENERATOR_ID, H2_UCCSD_PARAMETER_SLOTS[2], 2),
    ):
        labels = ["I"] * 4
        labels[offset] = "X"
        labels[offset + 1] = "Y"
        rotations.append(
            UccsdPauliRotation(
                generator_id=generator_id,
                pauli_qubit0_first="".join(labels),
                generator_imaginary_coefficient_numerator=-1,
                generator_imaginary_coefficient_denominator=2,
                rz_angle_theta_numerator=1,
                rz_angle_theta_denominator=1,
                parameter_slot_id=parameter_slot,
            )
        )
        labels[offset] = "Y"
        labels[offset + 1] = "X"
        rotations.append(
            UccsdPauliRotation(
                generator_id=generator_id,
                pauli_qubit0_first="".join(labels),
                generator_imaginary_coefficient_numerator=1,
                generator_imaginary_coefficient_denominator=2,
                rz_angle_theta_numerator=-1,
                rz_angle_theta_denominator=1,
                parameter_slot_id=parameter_slot,
            )
        )
    return rotations


def build_canonical_h2_uccsd() -> H2UccsdCanonicalCircuit:
    """Build the deterministic three-parameter H2 UCCSD circuit."""

    rotations = _rotations()
    operations = [
        operation for rotation in rotations for operation in _rotation_operations(rotation)
    ]
    protocol = {
        "protocol_id": "majorana.h2.uccsd.common_cnot_depth.v1",
        "input_stage": "canonical_logical_pauli_rotations",
        "compiler": "majorana_deterministic_pauli_rotation_compiler",
        "compiler_version": "0.2.0",
        "basis_gates": ["h", "s", "sdg", "rz", "cx"],
        "topology": "four_qubit_all_to_all",
        "initial_layout": [0, 1, 2, 3],
        "routing_policy": "none",
        "optimization_level": 0,
        "compiler_seed": 0,
        "parameter_binding": "independent_float64_theta_per_generator",
        "metric_scope": "ansatz_only",
        "reference_state_inclusion_policy": "excluded",
        "measurement_inclusion_policy": "excluded",
        "hardware_optimization_inclusion_policy": "excluded",
        "depth_definition": "asap_dependency_layers_each_gate_duration_one",
        "cnot_definition": "count_gate_name_cx",
    }
    operation_json = [operation.model_dump(mode="json") for operation in operations]
    unsigned = {
        "schema_version": H2_UCCSD_CIRCUIT_SCHEMA_VERSION,
        "circuit_id": "h2.uccsd.first_order.double_then_singles.jw.v1",
        "num_qubits": 4,
        "generator_convention": "antihermitian_tau_minus_tau_dagger",
        "parameter_orientation": "exp_theta_generator",
        "product_formula_order": "double_then_singles",
        "trotter_order": 1,
        "trotter_steps": 1,
        "parameter_sharing": "none",
        "generator_order": list(H2_UCCSD_GENERATOR_ORDER),
        "parameter_slot_order": list(H2_UCCSD_PARAMETER_SLOTS),
        "logical_rotations": [rotation.model_dump(mode="json") for rotation in rotations],
        "common_basis_operations": operation_json,
        "common_basis_operation_sequence_sha256": _canonical_digest(operation_json),
        "common_basis_metrics": _resource_metrics(operations).model_dump(mode="json"),
        "compilation_protocol_id": protocol["protocol_id"],
        "compilation_protocol_sha256": _canonical_digest(protocol),
    }
    return H2UccsdCanonicalCircuit(
        **unsigned,
        canonical_circuit_sha256=_canonical_digest(unsigned),
    )
