"""Phase 4.5 H2 actual-VQE spike on the frozen canonical Hamiltonian.

The chemistry-generation cross-check remains in h2_sto3g_spike.py.  This
script tests a different claim: Qiskit and PennyLane receive exactly the same
Hamiltonian and canonical one-parameter ansatz, then independently optimize
that parameter.  Every reported number is measured during this run.
"""

from __future__ import annotations

import argparse
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


def _fixture_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "manifest.json").is_file():
            return parent
    raise RuntimeError("frozen H2 fixture root is unavailable")


ROOT = _fixture_root()
MANIFEST_PATH = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "manifest.json"
CIRCUIT_PATH = (
    ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "canonical_double_excitation_v0.2.json"
)
OUTPUT_PATH = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "raw" / "qiskit_vqe_v0.2.json"
HF_BITSTRING_QUBIT0_FIRST = "1010"
PARAMETER_SLOT_ID = "theta.double.occ0_occ2.to.virt1_virt3"


def _apply_canonical_excitation(
    circuit: QuantumCircuit,
    theta: float,
    circuit_spec: dict,
) -> None:
    for operation in circuit_spec["common_basis_operations"]:
        gate = operation["gate"]
        wires = operation["wires"]
        if gate == "h":
            circuit.h(wires[0])
        elif gate == "s":
            circuit.s(wires[0])
        elif gate == "sdg":
            circuit.sdg(wires[0])
        elif gate == "cx":
            circuit.cx(wires[0], wires[1])
        elif gate == "rz":
            angle = (
                theta * operation["angle_theta_numerator"] / operation["angle_theta_denominator"]
            )
            circuit.rz(angle, wires[0])
        else:
            raise ValueError(f"unsupported canonical gate {gate!r}")


def _circuit(theta: float, circuit_spec: dict) -> QuantumCircuit:
    circuit = QuantumCircuit(4)
    for qubit, occupied in enumerate(HF_BITSTRING_QUBIT0_FIRST):
        if occupied == "1":
            circuit.x(qubit)
    _apply_canonical_excitation(circuit, theta, circuit_spec)
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


def run(output_path: Path | None = OUTPUT_PATH) -> int:
    started = time.perf_counter()
    manifest_bytes = MANIFEST_PATH.read_bytes()
    manifest = json.loads(manifest_bytes)
    circuit_bytes = CIRCUIT_PATH.read_bytes()
    circuit_spec = json.loads(circuit_bytes)
    hamiltonian = _hamiltonian(manifest)
    nuclear_repulsion = float(manifest["nuclear_repulsion_ha"])
    trajectory: list[dict[str, float]] = []

    def energy(theta: float) -> float:
        state = Statevector.from_instruction(_circuit(float(theta), circuit_spec))
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
        final_circuit = _circuit(final_theta, circuit_spec)
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
            "canonical_circuit_sha256": circuit_spec["canonical_circuit_sha256"],
            "compilation_protocol_sha256": circuit_spec["compilation_protocol_sha256"],
            "hamiltonian_digest_legacy": manifest["hamiltonian_digest_sha256"],
            "reference_bitstring_qubit0_first": HF_BITSTRING_QUBIT0_FIRST,
            "excited_bitstring_qubit0_first": "0101",
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
            "semantic_block": {
                "canonical_double_excitation_blocks": 1,
            },
            "canonical_logical": {
                "qubits": 4,
                "parameter_count": 1,
                "pauli_rotation_blocks": len(circuit_spec["logical_rotations"]),
                "canonical_circuit_sha256": circuit_spec["canonical_circuit_sha256"],
            },
            "common_basis_compiled": {
                **circuit_spec["common_basis_metrics"],
                "basis_gates": circuit_spec["compilation_protocol"]["basis_gates"],
                "compilation_protocol_sha256": circuit_spec["compilation_protocol_sha256"],
            },
            "provider_native_diagnostic": {
                "depth": int(compiled.depth()),
                "gate_count": int(sum(compiled.count_ops().values())),
                "two_qubit_gate_count": int(compiled.count_ops().get("cx", 0)),
                "basis_gates": ["rz", "sx", "x", "cx"],
                "optimization_level": 0,
                "compiler_seed": 0,
                "includes_reference_state": True,
                "comparison_eligible": False,
            },
        },
        "wall_time_s": time.perf_counter() - started,
    }
    if output_path is not None:
        output_path.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--stdout-only",
        action="store_true",
        help="emit bounded JSON to stdout without mutating a fixture file",
    )
    args = parser.parse_args()
    raise SystemExit(run(None if args.stdout_only else OUTPUT_PATH))
