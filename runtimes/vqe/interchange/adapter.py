"""Bounded provider adapters for the Phase 7.7 interchange contracts.

This module is deliberately outside ``majorana_vqe`` because it imports
OpenFermion, Qiskit, and PennyLane. It accepts and returns typed canonical
models at every scientific boundary.
"""

from __future__ import annotations

import hashlib
import json

import numpy as np
import openfermion
import pennylane as qml
from openfermion import FermionOperator, QubitOperator
from qiskit import QuantumCircuit
from qiskit.quantum_info import SparsePauliOp

from majorana_vqe.canonical import (
    CanonicalHamiltonian,
    HamiltonianIdentityContext,
    PauliTerm,
    hamiltonian_exact_content_digest,
)
from majorana_vqe.interchange import (
    CanonicalBasisState,
    CanonicalFermionOperator,
    CanonicalFermionTerm,
    CanonicalParametricCircuit,
    CanonicalQubitOperator,
    LadderAction,
    LadderOperator,
)
from majorana_vqe.portable import float_to_ieee754_hex, ieee754_hex_to_float

ADAPTER_VERSION = "0.1.0"
ZERO_THRESHOLD = 1e-12


def _json_digest(value: object, *, protocol: str) -> str:
    encoded = json.dumps(
        {"digest_protocol": protocol, "value": value},
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def openfermion_to_canonical_fermion(
    operator: FermionOperator,
    *,
    num_spin_orbitals: int,
    spin_orbital_order_convention: str,
    zero_threshold: float = ZERO_THRESHOLD,
) -> CanonicalFermionOperator:
    if not np.isfinite(zero_threshold) or zero_threshold < 0:
        raise ValueError("zero_threshold must be finite and non-negative")
    normal = openfermion.normal_ordered(operator)
    terms: list[CanonicalFermionTerm] = []
    for native_term, coefficient in normal.terms.items():
        coefficient = complex(coefficient)
        if not np.isfinite(coefficient.real) or not np.isfinite(coefficient.imag):
            raise ValueError("OpenFermion coefficient must be finite")
        if abs(coefficient) <= zero_threshold:
            continue
        ladder_operators = [
            LadderOperator(
                spin_orbital=index,
                action=LadderAction.CREATE if action == 1 else LadderAction.ANNIHILATE,
            )
            for index, action in native_term
        ]
        terms.append(
            CanonicalFermionTerm(
                operators=ladder_operators,
                coefficient_re_float64_hex=float_to_ieee754_hex(coefficient.real),
                coefficient_im_float64_hex=float_to_ieee754_hex(coefficient.imag),
            )
        )
    terms.sort(
        key=lambda term: tuple(
            (operator.spin_orbital, operator.action.value) for operator in term.operators
        )
    )
    if not terms:
        raise ValueError("OpenFermion operator is empty after the declared zero threshold")
    return CanonicalFermionOperator(
        num_spin_orbitals=num_spin_orbitals,
        spin_orbital_order_convention=spin_orbital_order_convention,
        operator_product_convention="left_to_right",
        normal_order_convention="creation_before_annihilation_descending_index",
        coefficient_format="ieee754_binary64_big_endian",
        zero_threshold_float64_hex=float_to_ieee754_hex(zero_threshold),
        terms=terms,
    )


def canonical_fermion_to_openfermion(
    operator: CanonicalFermionOperator,
) -> FermionOperator:
    native = FermionOperator()
    for term in operator.terms:
        native_term = tuple(
            (
                item.spin_orbital,
                1 if item.action is LadderAction.CREATE else 0,
            )
            for item in term.operators
        )
        coefficient = complex(
            ieee754_hex_to_float(term.coefficient_re_float64_hex),
            ieee754_hex_to_float(term.coefficient_im_float64_hex),
        )
        native += FermionOperator(native_term, coefficient)
    return native


def qubit_operator_to_canonical(
    operator: QubitOperator,
    *,
    num_qubits: int,
    identity_context: HamiltonianIdentityContext,
    zero_threshold: float = ZERO_THRESHOLD,
) -> CanonicalQubitOperator:
    terms: list[PauliTerm] = []
    for native_term, coefficient in operator.terms.items():
        coefficient = complex(coefficient)
        if not np.isfinite(coefficient.real) or not np.isfinite(coefficient.imag):
            raise ValueError("OpenFermion qubit coefficient must be finite")
        if abs(coefficient) <= zero_threshold:
            continue
        label = ["I"] * num_qubits
        for qubit, pauli in native_term:
            if qubit >= num_qubits:
                raise ValueError("OpenFermion term references an out-of-range qubit")
            label[qubit] = pauli
        terms.append(
            PauliTerm(
                pauli_qubit0_first="".join(label),
                coeff_re=coefficient.real,
                coeff_im=coefficient.imag,
            )
        )
    terms.sort(key=lambda term: term.pauli_qubit0_first)
    hamiltonian = CanonicalHamiltonian(
        num_qubits=num_qubits,
        terms=terms,
        coefficient_rounding_decimals=15,
    )
    digest = hamiltonian_exact_content_digest(hamiltonian, context=identity_context)
    return CanonicalQubitOperator(
        hamiltonian=hamiltonian,
        identity_context=identity_context,
        exact_content_sha256=digest,
    )


def jordan_wigner_to_canonical_qubit(
    operator: CanonicalFermionOperator,
    *,
    identity_context: HamiltonianIdentityContext,
) -> CanonicalQubitOperator:
    native = canonical_fermion_to_openfermion(operator)
    mapped = openfermion.jordan_wigner(native)
    return qubit_operator_to_canonical(
        mapped,
        num_qubits=operator.num_spin_orbitals,
        identity_context=identity_context,
        zero_threshold=ieee754_hex_to_float(operator.zero_threshold_float64_hex),
    )


def canonical_qubit_to_qiskit(operator: CanonicalQubitOperator) -> SparsePauliOp:
    return SparsePauliOp.from_list(
        [
            (
                term.pauli_qubit0_first[::-1],
                complex(term.coeff_re, term.coeff_im),
            )
            for term in operator.hamiltonian.terms
        ]
    )


def qiskit_to_canonical_qubit(
    operator: SparsePauliOp,
    *,
    identity_context: HamiltonianIdentityContext,
) -> CanonicalQubitOperator:
    terms = [
        PauliTerm(
            pauli_qubit0_first=label[::-1],
            coeff_re=complex(coefficient).real,
            coeff_im=complex(coefficient).imag,
        )
        for label, coefficient in operator.to_list()
    ]
    terms.sort(key=lambda term: term.pauli_qubit0_first)
    hamiltonian = CanonicalHamiltonian(
        num_qubits=operator.num_qubits,
        terms=terms,
        coefficient_rounding_decimals=15,
    )
    return CanonicalQubitOperator(
        hamiltonian=hamiltonian,
        identity_context=identity_context,
        exact_content_sha256=hamiltonian_exact_content_digest(
            hamiltonian,
            context=identity_context,
        ),
    )


def _pennylane_word(label: str):
    factors = []
    for wire, letter in enumerate(label):
        if letter == "X":
            factors.append(qml.PauliX(wire))
        elif letter == "Y":
            factors.append(qml.PauliY(wire))
        elif letter == "Z":
            factors.append(qml.PauliZ(wire))
    if not factors:
        return qml.Identity(0)
    word = factors[0]
    for factor in factors[1:]:
        word = word @ factor
    return word


def canonical_qubit_to_pennylane(operator: CanonicalQubitOperator):
    coefficients = []
    observables = []
    for term in operator.hamiltonian.terms:
        coefficient = complex(term.coeff_re, term.coeff_im)
        if abs(coefficient.imag) > ZERO_THRESHOLD:
            raise ValueError("PennyLane Hamiltonian adapter requires real Hermitian coefficients")
        coefficients.append(coefficient.real)
        observables.append(_pennylane_word(term.pauli_qubit0_first))
    return qml.Hamiltonian(coefficients, observables)


def canonical_state_to_qiskit(state: CanonicalBasisState) -> QuantumCircuit:
    circuit = QuantumCircuit(state.num_qubits)
    for qubit, occupation in enumerate(state.occupation_qubit0_first):
        if occupation == "1":
            circuit.x(qubit)
    return circuit


def apply_canonical_state_pennylane(state: CanonicalBasisState) -> None:
    qml.BasisState(
        np.array([int(bit) for bit in state.occupation_qubit0_first], dtype=int),
        wires=range(state.num_qubits),
    )


def _apply_qiskit_pauli_rotation(
    circuit: QuantumCircuit,
    *,
    label: str,
    angle: float,
) -> None:
    active = []
    for wire, letter in enumerate(label):
        if letter == "X":
            circuit.h(wire)
            active.append(wire)
        elif letter == "Y":
            circuit.sdg(wire)
            circuit.h(wire)
            active.append(wire)
        elif letter == "Z":
            active.append(wire)
    for control, target in zip(active, active[1:]):
        circuit.cx(control, target)
    circuit.rz(angle, active[-1])
    for control, target in reversed(list(zip(active, active[1:]))):
        circuit.cx(control, target)
    for wire, letter in reversed(list(enumerate(label))):
        if letter == "X":
            circuit.h(wire)
        elif letter == "Y":
            circuit.h(wire)
            circuit.s(wire)


def _validated_parameter_values(
    circuit: CanonicalParametricCircuit,
    parameter_values: dict[str, float],
) -> dict[str, float]:
    expected = {slot.slot_id for slot in circuit.parameter_slots}
    observed = set(parameter_values)
    if observed != expected:
        missing = sorted(expected - observed)
        extra = sorted(observed - expected)
        raise ValueError(
            f"parameter values must match canonical slots exactly; missing={missing}, extra={extra}"
        )
    normalized = {slot: float(value) for slot, value in parameter_values.items()}
    if not all(np.isfinite(value) for value in normalized.values()):
        raise ValueError("parameter values must be finite")
    return normalized


def canonical_circuit_to_qiskit(
    circuit: CanonicalParametricCircuit,
    parameter_values: dict[str, float],
) -> QuantumCircuit:
    parameter_values = _validated_parameter_values(circuit, parameter_values)
    native = QuantumCircuit(circuit.num_qubits)
    for rotation in circuit.rotations:
        value = parameter_values[rotation.parameter_slot_id]
        angle = value * rotation.angle_multiplier_numerator / rotation.angle_multiplier_denominator
        _apply_qiskit_pauli_rotation(
            native,
            label=rotation.pauli_qubit0_first,
            angle=angle,
        )
    return native


def apply_canonical_circuit_pennylane(
    circuit: CanonicalParametricCircuit,
    parameter_values: dict[str, float],
) -> None:
    parameter_values = _validated_parameter_values(circuit, parameter_values)
    for rotation in circuit.rotations:
        value = parameter_values[rotation.parameter_slot_id]
        angle = value * rotation.angle_multiplier_numerator / rotation.angle_multiplier_denominator
        label = rotation.pauli_qubit0_first
        active = []
        for wire, letter in enumerate(label):
            if letter == "X":
                qml.Hadamard(wires=wire)
                active.append(wire)
            elif letter == "Y":
                qml.adjoint(qml.S)(wires=wire)
                qml.Hadamard(wires=wire)
                active.append(wire)
            elif letter == "Z":
                active.append(wire)
        for control, target in zip(active, active[1:]):
            qml.CNOT(wires=[control, target])
        qml.RZ(angle, wires=active[-1])
        for control, target in reversed(list(zip(active, active[1:]))):
            qml.CNOT(wires=[control, target])
        for wire, letter in reversed(list(enumerate(label))):
            if letter == "X":
                qml.Hadamard(wires=wire)
            elif letter == "Y":
                qml.Hadamard(wires=wire)
                qml.S(wires=wire)


def matrix_witness_digest(matrix: np.ndarray, *, tolerance: float) -> str:
    if matrix.ndim != 2 or matrix.shape[0] != matrix.shape[1]:
        raise ValueError("matrix witness requires a square matrix")
    if not np.isfinite(tolerance) or tolerance < 0:
        raise ValueError("matrix witness tolerance must be finite and non-negative")
    rounded = np.round(matrix.real, 14) + 1j * np.round(matrix.imag, 14)
    payload = {
        "shape": list(rounded.shape),
        "real_float64_hex": [
            float_to_ieee754_hex(float(value)) for value in rounded.real.reshape(-1)
        ],
        "imag_float64_hex": [
            float_to_ieee754_hex(float(value)) for value in rounded.imag.reshape(-1)
        ],
        "tolerance_float64_hex": float_to_ieee754_hex(tolerance),
    }
    return _json_digest(payload, protocol="majorana-vqe-matrix-witness-v1")


def qiskit_array_to_qubit0_first(array: np.ndarray, *, num_qubits: int) -> np.ndarray:
    """Reindex Qiskit's little-endian basis array into canonical q0-first order.

    This is a representation conversion only; it does not apply a physical
    SWAP or mutate the circuit. Vectors and both matrix axes are supported.
    """
    array = np.asarray(array)
    dimension = 2**num_qubits
    permutation = np.array(
        [int(format(index, f"0{num_qubits}b")[::-1], 2) for index in range(dimension)],
        dtype=int,
    )
    if array.shape == (dimension,):
        return array[permutation]
    if array.shape == (dimension, dimension):
        return array[np.ix_(permutation, permutation)]
    raise ValueError("Qiskit basis array has an unexpected shape")
