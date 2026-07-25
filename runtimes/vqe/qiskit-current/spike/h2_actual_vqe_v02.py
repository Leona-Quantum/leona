"""Phase 4.5 H2 actual-VQE spike on the frozen canonical Hamiltonian.

The chemistry-generation cross-check remains in h2_sto3g_spike.py.  This
script tests a different claim: Qiskit and PennyLane receive exactly the same
Hamiltonian and canonical one-parameter ansatz, then independently optimize
that parameter.  Every reported number is measured during this run.
"""

from __future__ import annotations

import hashlib
import json
import math
import platform
import sys
import time
from pathlib import Path

import numpy as np
import qiskit
import scipy
from qiskit import QuantumCircuit, transpile
from qiskit.quantum_info import SparsePauliOp, Statevector
from scipy.optimize import minimize_scalar

ROOT = Path(__file__).resolve().parents[3].parent
MANIFEST_PATH = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "manifest.json"
OUTPUT_PATH = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "raw" / "qiskit_vqe_v0.2.json"
HF_BITSTRING_QUBIT0_FIRST = "1010"
EXCITED_BITSTRING_QUBIT0_FIRST = "0101"
PARAMETER_SLOT_ID = "theta.double.occ0_occ2.to.virt1_virt3"


def _basis_index_qiskit(bitstring_qubit0_first: str) -> int:
    return int(bitstring_qubit0_first[::-1], 2)


def _canonical_double_excitation_unitary(theta: float) -> np.ndarray:
    """exp(theta/2 * (|exc><hf| - |hf><exc|)) in Qiskit basis order."""
    size = 2**4
    matrix = np.eye(size, dtype=complex)
    hf = _basis_index_qiskit(HF_BITSTRING_QUBIT0_FIRST)
    excited = _basis_index_qiskit(EXCITED_BITSTRING_QUBIT0_FIRST)
    cosine = math.cos(theta / 2.0)
    sine = math.sin(theta / 2.0)
    matrix[hf, hf] = cosine
    matrix[excited, excited] = cosine
    matrix[excited, hf] = sine
    matrix[hf, excited] = -sine
    return matrix


def _circuit(theta: float) -> QuantumCircuit:
    circuit = QuantumCircuit(4)
    for qubit, occupied in enumerate(HF_BITSTRING_QUBIT0_FIRST):
        if occupied == "1":
            circuit.x(qubit)
    circuit.unitary(
        _canonical_double_excitation_unitary(theta),
        list(range(4)),
        label="canonical_double_excitation",
    )
    return circuit


def _hamiltonian(manifest: dict) -> SparsePauliOp:
    terms = [
        (
            term["pauli_qubit0_first"][::-1],
            complex(term["coeff_re"], term["coeff_im"]),
        )
        for term in manifest["canonical_hamiltonian"]["terms"]
    ]
    return SparsePauliOp.from_list(terms)


def run(output_path: Path = OUTPUT_PATH) -> int:
    started = time.perf_counter()
    manifest_bytes = MANIFEST_PATH.read_bytes()
    manifest = json.loads(manifest_bytes)
    hamiltonian = _hamiltonian(manifest)
    nuclear_repulsion = float(manifest["nuclear_repulsion_ha"])
    trajectory: list[dict[str, float]] = []

    def energy(theta: float) -> float:
        state = Statevector.from_instruction(_circuit(float(theta)))
        value = float(np.real(state.expectation_value(hamiltonian))) + nuclear_repulsion
        trajectory.append({"theta": float(theta), "energy_ha": value})
        return value

    try:
        result = minimize_scalar(
            energy,
            method="bounded",
            bounds=(-math.pi, math.pi),
            options={"xatol": 1e-12, "maxiter": 256},
        )
        final_theta = float(result.x)
        final_circuit = _circuit(final_theta)
        final_state = np.asarray(Statevector.from_instruction(final_circuit).data)
        dense_hamiltonian = np.asarray(hamiltonian.to_matrix())
        eigenvalues, eigenvectors = np.linalg.eigh(dense_hamiltonian)
        exact_total_energy = float(eigenvalues[0].real) + nuclear_repulsion
        fidelity = float(abs(np.vdot(eigenvectors[:, 0], final_state)) ** 2)
        compiled = transpile(
            final_circuit,
            basis_gates=["rz", "sx", "x", "cx"],
            optimization_level=0,
            seed_transpiler=0,
        )
    except Exception as exc:
        report = {
            "schema_version": "0.2.0",
            "status": "failed",
            "failure_code": "execution_failed",
            "error_type": type(exc).__name__,
            "error_message": str(exc),
        }
        output_path.write_text(json.dumps(report, indent=2))
        return 1

    report = {
        "schema_version": "0.2.0",
        "status": "succeeded",
        "capability": "h2_sto3g_actual_vqe_v1",
        "framework": "qiskit",
        "provider_versions": {
            "qiskit": qiskit.__version__,
            "scipy": scipy.__version__,
            "numpy": np.__version__,
        },
        "platform": platform.platform(),
        "python_version": sys.version,
        "canonical_input": {
            "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
            "hamiltonian_digest_legacy": manifest["hamiltonian_digest_sha256"],
            "reference_bitstring_qubit0_first": HF_BITSTRING_QUBIT0_FIRST,
            "excited_bitstring_qubit0_first": EXCITED_BITSTRING_QUBIT0_FIRST,
            "parameter_slot_id": PARAMETER_SLOT_ID,
            "parameter_orientation": "exp_theta_over_2_generator",
        },
        "optimization": {
            "algorithm": "scipy_minimize_scalar_bounded",
            "success": bool(result.success),
            "message": str(result.message),
            "iterations": int(result.nit),
            "function_evaluations": int(result.nfev),
            "final_parameter": final_theta,
            "best_energy_ha": float(result.fun),
            "exact_energy_ha": exact_total_energy,
            "absolute_error_ha": abs(float(result.fun) - exact_total_energy),
            "final_state_fidelity": fidelity,
            "trajectory": trajectory,
        },
        "resources": {
            "logical": {
                "qubits": 4,
                "parameters": 1,
                "canonical_double_excitation_blocks": 1,
            },
            "provider_native_compiled": {
                "depth": int(compiled.depth()),
                "gate_count": int(sum(compiled.count_ops().values())),
                "two_qubit_gate_count": int(compiled.count_ops().get("cx", 0)),
                "basis_gates": ["rz", "sx", "x", "cx"],
                "optimization_level": 0,
                "compiler_seed": 0,
            },
        },
        "wall_time_s": time.perf_counter() - started,
    }
    output_path.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
