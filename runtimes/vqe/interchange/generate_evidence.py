"""Generate bounded local Phase 7.7 conversion evidence.

The report is deterministic except for platform metadata. It records observed
digests and numerical residuals; it does not promote the result to public or
human-reviewed evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
from pathlib import Path

import numpy as np
import openfermion
import pennylane as qml
import qiskit
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
    canonical_basis_state_digest,
    canonical_fermion_operator_digest,
    canonical_parametric_circuit_digest,
)
from majorana_vqe.portable import float_to_ieee754_hex

from adapter import (
    ADAPTER_VERSION,
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

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = ROOT / "docs/atlas/fixtures/h2_sto3g/manifest.json"
LOCK = ROOT / "runtimes/vqe/interchange/uv.lock"
ADAPTER = ROOT / "runtimes/vqe/interchange/adapter.py"
DEFAULT_OUTPUT = ROOT / "docs/atlas/evidence/phase77/local_conversion_evidence.json"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _context() -> HamiltonianIdentityContext:
    return HamiltonianIdentityContext(
        mapping_convention="jordan_wigner",
        qubit_order_convention="canonical_qubit0_first_alpha_then_beta",
        identity_offset_convention="electronic_identity_included_nuclear_repulsion_separate",
        zero_threshold_float64_hex=float_to_ieee754_hex(1e-12),
    )


def _canonical_qubit() -> CanonicalQubitOperator:
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


def _to_openfermion(operator: CanonicalQubitOperator):
    result = openfermion.QubitOperator()
    for term in operator.hamiltonian.terms:
        factors = tuple(
            (qubit, letter)
            for qubit, letter in enumerate(term.pauli_qubit0_first)
            if letter != "I"
        )
        result += openfermion.QubitOperator(
            factors,
            complex(term.coeff_re, term.coeff_im),
        )
    return result


def _circuit() -> CanonicalParametricCircuit:
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


def generate() -> dict:
    canonical = _canonical_qubit()
    native_qubit = _to_openfermion(canonical)
    canonical_fermion = openfermion_to_canonical_fermion(
        openfermion.reverse_jordan_wigner(native_qubit),
        num_spin_orbitals=4,
        spin_orbital_order_convention="canonical_rhf_alpha_then_beta",
    )
    jw_observed = jordan_wigner_to_canonical_qubit(
        canonical_fermion,
        identity_context=_context(),
    )
    openfermion_expected_matrix = openfermion.get_sparse_operator(native_qubit).toarray()
    openfermion_observed_matrix = openfermion.get_sparse_operator(
        _to_openfermion(jw_observed)
    ).toarray()

    qiskit_operator = canonical_qubit_to_qiskit(canonical)
    qiskit_roundtrip = qiskit_to_canonical_qubit(
        qiskit_operator,
        identity_context=_context(),
    )
    qiskit_matrix = qiskit_array_to_qubit0_first(
        np.asarray(qiskit_operator.to_matrix()),
        num_qubits=4,
    )
    pennylane_matrix = np.asarray(
        qml.matrix(canonical_qubit_to_pennylane(canonical), wire_order=range(4))
    )

    state = CanonicalBasisState(
        num_qubits=4,
        occupation_qubit0_first="1010",
        qubit_order_convention="canonical_qubit0_first_alpha_then_beta",
    )
    circuit = _circuit()
    theta = 0.371
    slot = circuit.parameter_slots[0].slot_id
    qiskit_circuit = canonical_state_to_qiskit(state).compose(
        canonical_circuit_to_qiskit(circuit, {slot: theta})
    )
    qiskit_state = qiskit_array_to_qubit0_first(
        np.asarray(Statevector.from_instruction(qiskit_circuit).data),
        num_qubits=4,
    )
    device = qml.device("default.qubit", wires=4, shots=None)

    @qml.qnode(device)
    def pennylane_state_circuit():
        apply_canonical_state_pennylane(state)
        apply_canonical_circuit_pennylane(circuit, {slot: theta})
        return qml.state()

    pennylane_state = np.asarray(pennylane_state_circuit())
    return {
        "schema_version": "0.1.0",
        "phase": "7.7",
        "status": "local_adapter_verified",
        "claim_scope": "private_bounded_conversion_evidence_only",
        "public_execution": "blocked",
        "performance_claims": "blocked",
        "human_review": "unreviewed",
        "source": {
            "manifest_sha256": _sha256(MANIFEST),
            "adapter_sha256": _sha256(ADAPTER),
            "uv_lock_sha256": _sha256(LOCK),
            "adapter_version": ADAPTER_VERSION,
        },
        "runtime": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "python": sys.version,
            "openfermion": openfermion.__version__,
            "qiskit": qiskit.__version__,
            "pennylane": qml.__version__,
            "numpy": np.__version__,
        },
        "canonical_inputs": {
            "qubit_exact_sha256": canonical.exact_content_sha256,
            "basis_state_sha256": canonical_basis_state_digest(state),
            "parametric_circuit_sha256": canonical_parametric_circuit_digest(circuit),
            "fermion_sha256": canonical_fermion_operator_digest(canonical_fermion),
        },
        "openfermion_jordan_wigner": {
            "input_qubit_exact_sha256": canonical.exact_content_sha256,
            "output_qubit_exact_sha256": jw_observed.exact_content_sha256,
            "max_abs_matrix_difference": float(
                np.max(
                    np.abs(
                        openfermion_expected_matrix - openfermion_observed_matrix
                    )
                )
            ),
            "tolerance": 2e-12,
            "verification": "matrix_equivalence",
            "exact_content_identity_claimed": False,
            "limitation": (
                "The fermionic input is reverse-JW derived from the frozen qubit fixture; "
                "this is structural round-trip evidence, not an independent chemistry derivation."
            ),
        },
        "qiskit": {
            "roundtrip_qubit_exact_sha256": qiskit_roundtrip.exact_content_sha256,
            "exact_content_match": (
                qiskit_roundtrip.exact_content_sha256
                == canonical.exact_content_sha256
            ),
        },
        "qiskit_pennylane_equivalence": {
            "max_abs_hamiltonian_matrix_difference": float(
                np.max(np.abs(qiskit_matrix - pennylane_matrix))
            ),
            "hamiltonian_matrix_witness_sha256": matrix_witness_digest(
                qiskit_matrix,
                tolerance=1e-12,
            ),
            "statevector_overlap_absolute": float(
                abs(np.vdot(qiskit_state, pennylane_state))
            ),
            "tolerance": 1e-12,
        },
        "inherited_unresolved_issue": (
            "Phase 7.6 selected WorkOS account and /api/me identity were not "
            "demonstrated to be the same identity; no repeated login requested."
        ),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--stdout-only", action="store_true")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    report = generate()
    if not args.stdout_only:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, indent=2, sort_keys=True))
