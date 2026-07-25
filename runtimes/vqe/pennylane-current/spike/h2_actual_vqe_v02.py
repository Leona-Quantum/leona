"""Phase 4.5 H2 actual-VQE spike on the frozen canonical Hamiltonian.

This is intentionally independent of the Qiskit script while consuming the
same immutable manifest, parameter slot, two-level generator convention, and
SciPy bounded optimizer contract.
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
import pennylane as qml
import scipy
from scipy.optimize import minimize_scalar

ROOT = Path(__file__).resolve().parents[3].parent
MANIFEST_PATH = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "manifest.json"
OUTPUT_PATH = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "raw" / "pennylane_vqe_v0.2.json"
HF_BITSTRING_QUBIT0_FIRST = "1010"
EXCITED_BITSTRING_QUBIT0_FIRST = "0101"
PARAMETER_SLOT_ID = "theta.double.occ0_occ2.to.virt1_virt3"


def _basis_index_pennylane(bitstring_qubit0_first: str) -> int:
    return int(bitstring_qubit0_first, 2)


def _canonical_double_excitation_unitary(theta: float) -> np.ndarray:
    """exp(theta/2 * (|exc><hf| - |hf><exc|)) in PennyLane wire order."""
    size = 2**4
    matrix = np.eye(size, dtype=complex)
    hf = _basis_index_pennylane(HF_BITSTRING_QUBIT0_FIRST)
    excited = _basis_index_pennylane(EXCITED_BITSTRING_QUBIT0_FIRST)
    cosine = math.cos(theta / 2.0)
    sine = math.sin(theta / 2.0)
    matrix[hf, hf] = cosine
    matrix[excited, excited] = cosine
    matrix[excited, hf] = sine
    matrix[hf, excited] = -sine
    return matrix


def _pauli_word(label: str):
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


def _hamiltonian(manifest: dict):
    coefficients = []
    operators = []
    for term in manifest["canonical_hamiltonian"]["terms"]:
        coefficient = complex(term["coeff_re"], term["coeff_im"])
        if abs(coefficient.imag) > 1e-15:
            raise ValueError("H2 canonical Hamiltonian unexpectedly has imaginary coefficients")
        coefficients.append(coefficient.real)
        operators.append(_pauli_word(term["pauli_qubit0_first"]))
    return qml.Hamiltonian(coefficients, operators)


def run(output_path: Path = OUTPUT_PATH) -> int:
    started = time.perf_counter()
    manifest_bytes = MANIFEST_PATH.read_bytes()
    manifest = json.loads(manifest_bytes)
    hamiltonian = _hamiltonian(manifest)
    nuclear_repulsion = float(manifest["nuclear_repulsion_ha"])
    device = qml.device("default.qubit", wires=4, shots=None)
    occupation = np.array([int(bit) for bit in HF_BITSTRING_QUBIT0_FIRST], dtype=int)

    @qml.qnode(device)
    def energy_circuit(theta: float):
        qml.BasisState(occupation, wires=range(4))
        qml.QubitUnitary(_canonical_double_excitation_unitary(theta), wires=range(4))
        return qml.expval(hamiltonian)

    @qml.qnode(device)
    def state_circuit(theta: float):
        qml.BasisState(occupation, wires=range(4))
        qml.QubitUnitary(_canonical_double_excitation_unitary(theta), wires=range(4))
        return qml.state()

    trajectory: list[dict[str, float]] = []

    def energy(theta: float) -> float:
        value = float(energy_circuit(float(theta))) + nuclear_repulsion
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
        final_state = np.asarray(state_circuit(final_theta))
        dense_hamiltonian = np.asarray(qml.matrix(hamiltonian, wire_order=range(4)))
        eigenvalues, eigenvectors = np.linalg.eigh(dense_hamiltonian)
        exact_total_energy = float(eigenvalues[0].real) + nuclear_repulsion
        fidelity = float(abs(np.vdot(eigenvectors[:, 0], final_state)) ** 2)
        resource_info = qml.specs(energy_circuit)(final_theta)["resources"]
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
        "framework": "pennylane",
        "provider_versions": {
            "pennylane": qml.__version__,
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
            "provider_native": {
                "depth": int(resource_info.depth),
                "gate_count": int(resource_info.num_gates),
                "gate_types": dict(resource_info.gate_types),
                "shots": None,
            },
        },
        "wall_time_s": time.perf_counter() - started,
    }
    output_path.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
