from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import openfermion
import pennylane as qml
import pytest
from qiskit.quantum_info import Statevector

from majorana_vqe.canonical import (
    CanonicalHamiltonian,
    HamiltonianIdentityContext,
    PauliTerm,
    hamiltonian_exact_content_digest,
)
from majorana_vqe.circuit import build_canonical_h2_double_excitation
from majorana_vqe.interchange import (
    CanonicalBasisState,
    CanonicalParameterSlot,
    CanonicalParametricCircuit,
    CanonicalQubitOperator,
    SymbolicPauliRotation,
    canonical_fermion_operator_digest,
    canonical_parametric_circuit_digest,
)
from majorana_vqe.portable import float_to_ieee754_hex

from adapter import (
    apply_canonical_circuit_pennylane,
    apply_canonical_state_pennylane,
    canonical_circuit_to_qiskit,
    canonical_qubit_to_pennylane,
    canonical_qubit_to_qiskit,
    canonical_state_to_qiskit,
    jordan_wigner_to_canonical_qubit,
    matrix_witness_digest,
    openfermion_to_canonical_fermion,
    qiskit_array_to_qubit0_first,
    qiskit_to_canonical_qubit,
)


ROOT = Path(__file__).resolve().parents[4]
MANIFEST = ROOT / "docs/atlas/fixtures/h2_sto3g/manifest.json"


def _context() -> HamiltonianIdentityContext:
    return HamiltonianIdentityContext(
        mapping_convention="jordan_wigner",
        qubit_order_convention="canonical_qubit0_first_alpha_then_beta",
        identity_offset_convention="electronic_identity_included_nuclear_repulsion_separate",
        zero_threshold_float64_hex=float_to_ieee754_hex(1e-12),
    )


def _fixture_qubit() -> CanonicalQubitOperator:
    raw = json.loads(MANIFEST.read_text())
    hamiltonian = CanonicalHamiltonian(
        num_qubits=raw["electron_orbital_qubit_counts"]["n_qubits"],
        terms=[
            PauliTerm.model_validate(term)
            for term in raw["canonical_hamiltonian"]["terms"]
        ],
        coefficient_rounding_decimals=15,
    )
    context = _context()
    return CanonicalQubitOperator(
        hamiltonian=hamiltonian,
        identity_context=context,
        exact_content_sha256=hamiltonian_exact_content_digest(
            hamiltonian,
            context=context,
        ),
    )


def _openfermion_fixture_qubit(canonical: CanonicalQubitOperator):
    native = openfermion.QubitOperator()
    for term in canonical.hamiltonian.terms:
        factors = tuple(
            (qubit, letter)
            for qubit, letter in enumerate(term.pauli_qubit0_first)
            if letter != "I"
        )
        native += openfermion.QubitOperator(
            factors,
            complex(term.coeff_re, term.coeff_im),
        )
    return native


def _canonical_circuit() -> CanonicalParametricCircuit:
    source = build_canonical_h2_double_excitation()
    return CanonicalParametricCircuit(
        num_qubits=4,
        qubit_order_convention="canonical_qubit0_first_alpha_then_beta",
        parameter_orientation=source.parameter_orientation,
        parameter_slots=[
            CanonicalParameterSlot(
                slot_id=source.parameter_slot_id,
                initial_float64_hex=float_to_ieee754_hex(0.0),
            )
        ],
        rotations=[
            SymbolicPauliRotation(
                pauli_qubit0_first=rotation.pauli_qubit0_first,
                parameter_slot_id=rotation.parameter_slot_id,
                angle_multiplier_numerator=rotation.rz_angle_theta_numerator,
                angle_multiplier_denominator=rotation.rz_angle_theta_denominator,
            )
            for rotation in source.logical_rotations
        ],
    )


def test_openfermion_roundtrip_reaches_frozen_h2_qubit_operator():
    expected = _fixture_qubit()
    native_qubit = _openfermion_fixture_qubit(expected)
    native_fermion = openfermion.reverse_jordan_wigner(native_qubit)
    canonical_fermion = openfermion_to_canonical_fermion(
        native_fermion,
        num_spin_orbitals=4,
        spin_orbital_order_convention="canonical_rhf_alpha_then_beta",
    )
    assert len(canonical_fermion_operator_digest(canonical_fermion)) == 64
    observed = jordan_wigner_to_canonical_qubit(
        canonical_fermion,
        identity_context=_context(),
    )
    expected_matrix = openfermion.get_sparse_operator(native_qubit).toarray()
    observed_matrix = openfermion.get_sparse_operator(
        _openfermion_fixture_qubit(observed)
    ).toarray()
    # This is bounded numerical equivalence, not exact-content identity:
    # reverse-JW/normal-order/forward-JW removes the fixture's ~1e-12 numerical
    # zero. Both immutable digests are retained as distinct evidence inputs.
    assert np.max(np.abs(expected_matrix - observed_matrix)) <= 2e-12
    assert len(expected.exact_content_sha256) == 64
    assert len(observed.exact_content_sha256) == 64


def test_qiskit_and_pennylane_hamiltonians_are_matrix_equivalent():
    canonical = _fixture_qubit()
    qiskit_operator = canonical_qubit_to_qiskit(canonical)
    qiskit_roundtrip = qiskit_to_canonical_qubit(
        qiskit_operator,
        identity_context=_context(),
    )
    pennylane_operator = canonical_qubit_to_pennylane(canonical)
    qiskit_matrix = qiskit_array_to_qubit0_first(
        np.asarray(qiskit_operator.to_matrix()),
        num_qubits=4,
    )
    pennylane_matrix = np.asarray(qml.matrix(pennylane_operator, wire_order=range(4)))
    assert qiskit_roundtrip.exact_content_sha256 == canonical.exact_content_sha256
    assert np.allclose(qiskit_matrix, pennylane_matrix, atol=1e-12)
    assert matrix_witness_digest(qiskit_matrix, tolerance=1e-12) == matrix_witness_digest(
        pennylane_matrix,
        tolerance=1e-12,
    )


def test_state_and_parametric_circuit_are_cross_provider_equivalent():
    state = CanonicalBasisState(
        num_qubits=4,
        occupation_qubit0_first="1010",
        qubit_order_convention="canonical_qubit0_first_alpha_then_beta",
    )
    circuit = _canonical_circuit()
    theta = 0.371
    qiskit_circuit = canonical_state_to_qiskit(state).compose(
        canonical_circuit_to_qiskit(
            circuit,
            {circuit.parameter_slots[0].slot_id: theta},
        )
    )
    qiskit_state = qiskit_array_to_qubit0_first(
        np.asarray(Statevector.from_instruction(qiskit_circuit).data),
        num_qubits=4,
    )
    device = qml.device("default.qubit", wires=4, shots=None)

    @qml.qnode(device)
    def pennylane_circuit():
        apply_canonical_state_pennylane(state)
        apply_canonical_circuit_pennylane(
            circuit,
            {circuit.parameter_slots[0].slot_id: theta},
        )
        return qml.state()

    pennylane_state = np.asarray(pennylane_circuit())
    overlap = abs(np.vdot(qiskit_state, pennylane_state))
    assert overlap == pytest.approx(1.0, abs=1e-12)
    assert len(canonical_parametric_circuit_digest(circuit)) == 64


def test_openfermion_adapter_rejects_nonfinite_coefficients():
    native = openfermion.FermionOperator("0^ 0", complex(float("nan"), 0.0))
    with pytest.raises(ValueError, match="finite"):
        openfermion_to_canonical_fermion(
            native,
            num_spin_orbitals=1,
            spin_orbital_order_convention="single_spin_orbital",
        )


def test_circuit_adapters_reject_incomplete_extra_and_nonfinite_parameters():
    circuit = _canonical_circuit()
    slot = circuit.parameter_slots[0].slot_id
    for invalid in ({}, {slot: 0.1, "extra": 0.2}, {slot: float("nan")}):
        with pytest.raises(ValueError, match="parameter"):
            canonical_circuit_to_qiskit(circuit, invalid)
        with pytest.raises(ValueError, match="parameter"):
            apply_canonical_circuit_pennylane(circuit, invalid)


def test_matrix_witness_rejects_invalid_tolerance():
    matrix = np.eye(2)
    with pytest.raises(ValueError, match="tolerance"):
        matrix_witness_digest(matrix, tolerance=-1.0)
    with pytest.raises(ValueError, match="tolerance"):
        matrix_witness_digest(matrix, tolerance=float("nan"))
