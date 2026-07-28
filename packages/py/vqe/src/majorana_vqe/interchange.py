"""Provider-neutral VQE interchange contracts for Phase 7.7.

The models in this module describe scientific objects, never provider-native
classes.  Framework adapters live under ``runtimes/vqe`` and must record a
bounded conversion witness before their output can be treated as verified.
"""

from __future__ import annotations

import hashlib
import json
import math
from enum import StrEnum
from typing import Literal, Self

from pydantic import Field, model_validator

from .canonical import (
    CanonicalHamiltonian,
    HamiltonianIdentityContext,
    hamiltonian_exact_content_digest,
)
from .models import SHA256_HEX_PATTERN, VqeBaseModel, reject_path_module_or_code
from .portable import FLOAT64_HEX_PATTERN, ieee754_hex_to_float

INTERCHANGE_SCHEMA_VERSION = "0.1.0"


def _digest(value: object, *, protocol: str) -> str:
    encoded = json.dumps(
        {"digest_protocol": protocol, "value": value},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class LadderAction(StrEnum):
    CREATE = "create"
    ANNIHILATE = "annihilate"


class LadderOperator(VqeBaseModel):
    spin_orbital: int = Field(ge=0, le=255)
    action: LadderAction


class CanonicalFermionTerm(VqeBaseModel):
    """One already-normal-ordered fermionic monomial.

    An empty operator list denotes the identity term. Coefficients use exact
    binary64 bytes so digest identity is not confused with a comparison
    tolerance.
    """

    operators: list[LadderOperator] = Field(max_length=16)
    coefficient_re_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)
    coefficient_im_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)

    @model_validator(mode="after")
    def _coefficient_is_finite(self) -> Self:
        ieee754_hex_to_float(self.coefficient_re_float64_hex)
        ieee754_hex_to_float(self.coefficient_im_float64_hex)
        return self


class CanonicalFermionOperator(VqeBaseModel):
    schema_version: Literal["0.1.0"] = INTERCHANGE_SCHEMA_VERSION
    num_spin_orbitals: int = Field(ge=1, le=256)
    spin_orbital_order_convention: str = Field(min_length=1, max_length=200)
    operator_product_convention: Literal["left_to_right"]
    normal_order_convention: Literal["creation_before_annihilation_descending_index"]
    coefficient_format: Literal["ieee754_binary64_big_endian"]
    zero_threshold_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)
    terms: list[CanonicalFermionTerm] = Field(min_length=1, max_length=16384)

    @model_validator(mode="after")
    def _terms_are_bounded_and_canonical(self) -> Self:
        reject_path_module_or_code(
            self.spin_orbital_order_convention,
            field_path="spin_orbital_order_convention",
        )
        zero_threshold = ieee754_hex_to_float(self.zero_threshold_float64_hex)
        if zero_threshold < 0:
            raise ValueError("fermionic zero threshold cannot be negative")
        keys: list[tuple[tuple[int, str], ...]] = []
        for term in self.terms:
            if any(operator.spin_orbital >= self.num_spin_orbitals for operator in term.operators):
                raise ValueError("fermionic operator references an out-of-range spin orbital")
            creation_indices = [
                operator.spin_orbital
                for operator in term.operators
                if operator.action is LadderAction.CREATE
            ]
            annihilation_indices = [
                operator.spin_orbital
                for operator in term.operators
                if operator.action is LadderAction.ANNIHILATE
            ]
            expected_actions = [LadderAction.CREATE] * len(creation_indices) + [
                LadderAction.ANNIHILATE
            ] * len(annihilation_indices)
            if [operator.action for operator in term.operators] != expected_actions:
                raise ValueError(
                    "fermionic term is not normal ordered: creation operators must precede "
                    "annihilation operators"
                )
            if creation_indices != sorted(creation_indices, reverse=True):
                raise ValueError("fermionic creation operators must use descending indices")
            if annihilation_indices != sorted(annihilation_indices, reverse=True):
                raise ValueError("fermionic annihilation operators must use descending indices")
            ladder_keys = [(operator.spin_orbital, operator.action) for operator in term.operators]
            if len(ladder_keys) != len(set(ladder_keys)):
                raise ValueError("fermionic term contains a repeated ladder operator")
            coefficient_magnitude = math.hypot(
                ieee754_hex_to_float(term.coefficient_re_float64_hex),
                ieee754_hex_to_float(term.coefficient_im_float64_hex),
            )
            if coefficient_magnitude <= zero_threshold:
                raise ValueError(
                    "fermionic term coefficient must exceed the declared zero threshold"
                )
            key = tuple(
                (operator.spin_orbital, operator.action.value) for operator in term.operators
            )
            keys.append(key)
        if keys != sorted(keys):
            raise ValueError("canonical fermion terms must be sorted by operator sequence")
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate canonical fermion term")
        return self


def canonical_fermion_operator_digest(operator: CanonicalFermionOperator) -> str:
    return _digest(
        operator.model_dump(mode="json"),
        protocol="majorana-vqe-canonical-fermion-v1",
    )


class CanonicalQubitOperator(VqeBaseModel):
    """Exact-identity wrapper around the existing canonical Hamiltonian."""

    schema_version: Literal["0.1.0"] = INTERCHANGE_SCHEMA_VERSION
    hamiltonian: CanonicalHamiltonian
    identity_context: HamiltonianIdentityContext
    exact_content_sha256: str = Field(pattern=SHA256_HEX_PATTERN)

    @model_validator(mode="after")
    def _digest_matches_content(self) -> Self:
        expected = hamiltonian_exact_content_digest(
            self.hamiltonian,
            context=self.identity_context,
        )
        if self.exact_content_sha256 != expected:
            raise ValueError("qubit operator digest does not match canonical content")
        return self


class CanonicalBasisState(VqeBaseModel):
    schema_version: Literal["0.1.0"] = INTERCHANGE_SCHEMA_VERSION
    num_qubits: int = Field(ge=1, le=64)
    occupation_qubit0_first: str = Field(pattern=r"^[01]+$", min_length=1, max_length=64)
    qubit_order_convention: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def _width_matches(self) -> Self:
        reject_path_module_or_code(
            self.qubit_order_convention,
            field_path="qubit_order_convention",
        )
        if len(self.occupation_qubit0_first) != self.num_qubits:
            raise ValueError("basis-state occupation width must equal num_qubits")
        return self


def canonical_basis_state_digest(state: CanonicalBasisState) -> str:
    return _digest(
        state.model_dump(mode="json"),
        protocol="majorana-vqe-canonical-basis-state-v1",
    )


class CanonicalParameterSlot(VqeBaseModel):
    slot_id: str = Field(min_length=1, max_length=200)
    initial_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)

    @model_validator(mode="after")
    def _slot_is_safe_and_finite(self) -> Self:
        reject_path_module_or_code(self.slot_id, field_path="slot_id")
        ieee754_hex_to_float(self.initial_float64_hex)
        return self


class SymbolicPauliRotation(VqeBaseModel):
    pauli_qubit0_first: str = Field(pattern=r"^[IXYZ]+$", min_length=1, max_length=64)
    parameter_slot_id: str = Field(min_length=1, max_length=200)
    angle_multiplier_numerator: int
    angle_multiplier_denominator: int = Field(gt=0)

    @model_validator(mode="after")
    def _slot_is_safe(self) -> Self:
        reject_path_module_or_code(self.parameter_slot_id, field_path="parameter_slot_id")
        if self.angle_multiplier_numerator == 0:
            raise ValueError("symbolic rotation multiplier cannot be zero")
        if set(self.pauli_qubit0_first) == {"I"}:
            raise ValueError("symbolic rotation cannot use the all-identity Pauli word")
        return self


class CanonicalParametricCircuit(VqeBaseModel):
    schema_version: Literal["0.1.0"] = INTERCHANGE_SCHEMA_VERSION
    num_qubits: int = Field(ge=1, le=64)
    qubit_order_convention: str = Field(min_length=1, max_length=200)
    parameter_orientation: str = Field(min_length=1, max_length=200)
    parameter_slots: list[CanonicalParameterSlot] = Field(min_length=1, max_length=256)
    rotations: list[SymbolicPauliRotation] = Field(min_length=1, max_length=16384)

    @model_validator(mode="after")
    def _references_are_valid(self) -> Self:
        reject_path_module_or_code(
            self.qubit_order_convention,
            field_path="qubit_order_convention",
        )
        reject_path_module_or_code(
            self.parameter_orientation,
            field_path="parameter_orientation",
        )
        slot_ids = [slot.slot_id for slot in self.parameter_slots]
        if len(slot_ids) != len(set(slot_ids)):
            raise ValueError("duplicate canonical parameter slot")
        valid_slots = set(slot_ids)
        for rotation in self.rotations:
            if len(rotation.pauli_qubit0_first) != self.num_qubits:
                raise ValueError("Pauli rotation width must equal num_qubits")
            if rotation.parameter_slot_id not in valid_slots:
                raise ValueError("Pauli rotation references an unknown parameter slot")
        return self


def canonical_parametric_circuit_digest(circuit: CanonicalParametricCircuit) -> str:
    return _digest(
        circuit.model_dump(mode="json"),
        protocol="majorana-vqe-canonical-parametric-circuit-v1",
    )


class InterchangeRepresentation(StrEnum):
    OPENFERMION_FERMION_OPERATOR = "openfermion_fermion_operator"
    CANONICAL_FERMION_OPERATOR = "canonical_fermion_operator"
    CANONICAL_QUBIT_OPERATOR = "canonical_qubit_operator"
    CANONICAL_BASIS_STATE = "canonical_basis_state"
    CANONICAL_PARAMETRIC_CIRCUIT = "canonical_parametric_circuit"
    QISKIT_SPARSE_PAULI_OP = "qiskit_sparse_pauli_op"
    QISKIT_QUANTUM_CIRCUIT = "qiskit_quantum_circuit"
    PENNYLANE_HAMILTONIAN = "pennylane_hamiltonian"
    PENNYLANE_TAPE = "pennylane_tape"


class ConversionRole(StrEnum):
    FERMIONIC_OPERATOR = "fermionic_operator"
    QUBIT_OPERATOR = "qubit_operator"
    STATE_PREPARATION = "state_preparation"
    PARAMETRIC_CIRCUIT = "parametric_circuit"


class ConversionEdge(VqeBaseModel):
    schema_version: Literal["0.1.0"] = INTERCHANGE_SCHEMA_VERSION
    edge_key: str = Field(min_length=1, max_length=200)
    role: ConversionRole
    source: InterchangeRepresentation
    target: InterchangeRepresentation
    adapter_release_id: str = Field(min_length=1, max_length=200)
    adapter_version: str = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def _metadata_is_safe(self) -> Self:
        for field_name in ("edge_key", "adapter_release_id", "adapter_version"):
            reject_path_module_or_code(
                str(getattr(self, field_name)),
                field_path=field_name,
            )
        if self.source is self.target:
            raise ValueError("conversion edge source and target must differ")
        return self


class ConversionVerification(StrEnum):
    EXACT_RECONSTRUCTION = "exact_reconstruction"
    MATRIX_EQUIVALENCE = "matrix_equivalence"
    STATEVECTOR_GLOBAL_PHASE = "statevector_global_phase"
    PARAMETER_SEMANTICS = "parameter_semantics"


class ConversionEvidence(VqeBaseModel):
    schema_version: Literal["0.1.0"] = INTERCHANGE_SCHEMA_VERSION
    edge: ConversionEdge
    input_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    output_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    witness_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    verification: ConversionVerification
    tolerance_float64_hex: str = Field(pattern=FLOAT64_HEX_PATTERN)
    verified: Literal[True]

    @model_validator(mode="after")
    def _tolerance_is_valid(self) -> Self:
        tolerance = ieee754_hex_to_float(self.tolerance_float64_hex)
        if tolerance < 0:
            raise ValueError("conversion verification tolerance cannot be negative")
        if self.verification is ConversionVerification.EXACT_RECONSTRUCTION and tolerance != 0:
            raise ValueError("exact reconstruction evidence requires zero tolerance")
        return self


class ConversionGraph(VqeBaseModel):
    schema_version: Literal["0.1.0"] = INTERCHANGE_SCHEMA_VERSION
    edges: list[ConversionEdge] = Field(min_length=1, max_length=256)

    @model_validator(mode="after")
    def _edge_keys_are_unique(self) -> Self:
        keys = [edge.edge_key for edge in self.edges]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate conversion edge key")
        return self

    def resolve_direct(
        self,
        *,
        role: ConversionRole,
        source: InterchangeRepresentation,
        target: InterchangeRepresentation,
    ) -> ConversionEdge:
        matches = [
            edge
            for edge in self.edges
            if edge.role is role and edge.source is source and edge.target is target
        ]
        if not matches:
            raise ValueError("no direct conversion edge for requested role and representations")
        if len(matches) != 1:
            raise ValueError("ambiguous direct conversion edge")
        return matches[0]


class ConversionEvidenceBundle(VqeBaseModel):
    """Execution-side conversion evidence, separate from scientific identity."""

    schema_version: Literal["0.1.0"] = INTERCHANGE_SCHEMA_VERSION
    scientific_spec_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    registry_resolution_sha256: str = Field(pattern=SHA256_HEX_PATTERN)
    evidence: list[ConversionEvidence] = Field(min_length=1, max_length=256)

    @model_validator(mode="after")
    def _paths_are_contiguous_per_role(self) -> Self:
        by_role: dict[ConversionRole, list[ConversionEvidence]] = {}
        for item in self.evidence:
            by_role.setdefault(item.edge.role, []).append(item)
        for role, items in by_role.items():
            for left, right in zip(items, items[1:]):
                if left.edge.target is not right.edge.source:
                    raise ValueError(f"conversion path for {role.value} is not contiguous")
                if left.output_sha256 != right.input_sha256:
                    raise ValueError(f"conversion digest chain for {role.value} is broken")
        return self
