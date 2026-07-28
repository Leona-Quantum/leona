"""Phase 4.5 H2 actual-VQE spike on the frozen canonical Hamiltonian.

This is intentionally independent of the Qiskit script while consuming the
same immutable manifest, parameter slot, two-level generator convention, and
SciPy bounded optimizer contract.
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
import pennylane as qml
import scipy

try:
    from optimizer_protocol import OptimizerAlgorithm, optimize_one_parameter
except ModuleNotFoundError:  # Local checkout; the container copies it beside this script.
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from optimizer_protocol import OptimizerAlgorithm, optimize_one_parameter


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
OUTPUT_PATH = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "raw" / "pennylane_vqe_v0.2.json"
HF_BITSTRING_QUBIT0_FIRST = "1010"
PARAMETER_SLOT_ID = "theta.double.occ0_occ2.to.virt1_virt3"


def _apply_canonical_excitation(theta: float, circuit_spec: dict) -> None:
    for operation in circuit_spec["common_basis_operations"]:
        gate = operation["gate"]
        wires = operation["wires"]
        if gate == "h":
            qml.Hadamard(wires=wires[0])
        elif gate == "s":
            qml.S(wires=wires[0])
        elif gate == "sdg":
            qml.adjoint(qml.S)(wires=wires[0])
        elif gate == "cx":
            qml.CNOT(wires=wires)
        elif gate == "rz":
            angle = (
                theta * operation["angle_theta_numerator"] / operation["angle_theta_denominator"]
            )
            qml.RZ(angle, wires=wires[0])
        else:
            raise ValueError(f"unsupported canonical gate {gate!r}")


def _canonical_json_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _observed_common_basis(theta: float, circuit_spec: dict) -> tuple[list[dict], dict]:
    """Reconstruct and inspect the ansatz in PennyLane, independently of fixture metrics."""
    if abs(theta) < 1e-12:
        raise ValueError("resource verification requires a non-zero theta")
    with qml.tape.QuantumTape() as tape:
        _apply_canonical_excitation(theta, circuit_spec)
    name_map = {
        "Hadamard": "h",
        "S": "s",
        "Adjoint(S)": "sdg",
        "CNOT": "cx",
        "RZ": "rz",
    }
    operations: list[dict] = []
    wire_depth = [0, 0, 0, 0]
    for operation in tape.operations:
        try:
            gate = name_map[operation.name]
        except KeyError as exc:
            raise ValueError(f"unexpected PennyLane canonical gate {operation.name!r}") from exc
        wires = [int(wire) for wire in operation.wires]
        observed: dict = {
            "gate": gate,
            "wires": wires,
            "parameter_slot_id": None,
            "angle_theta_numerator": None,
            "angle_theta_denominator": None,
        }
        if gate == "rz":
            ratio = float(operation.parameters[0]) / theta
            numerator = int(round(ratio * 8))
            if not math.isclose(ratio, numerator / 8, abs_tol=1e-12):
                raise ValueError("PennyLane RZ angle does not match the canonical theta/8 grid")
            observed.update(
                {
                    "parameter_slot_id": PARAMETER_SLOT_ID,
                    "angle_theta_numerator": numerator,
                    "angle_theta_denominator": 8,
                }
            )
        operations.append(observed)
        layer = max(wire_depth[wire] for wire in wires) + 1
        for wire in wires:
            wire_depth[wire] = layer
    metrics = {
        "depth": max(wire_depth),
        "gate_count": len(operations),
        "cnot_count": sum(operation["gate"] == "cx" for operation in operations),
        "parameter_count": 1,
    }
    return operations, metrics


def _verified_common_basis(theta: float, circuit_spec: dict) -> dict:
    operations, observed_metrics = _observed_common_basis(theta, circuit_spec)
    operation_digest = _canonical_json_sha256(operations)
    if operation_digest != circuit_spec["common_basis_operation_sequence_sha256"]:
        raise ValueError("PennyLane ansatz operation sequence differs from the canonical protocol")
    if observed_metrics != circuit_spec["common_basis_metrics"]:
        raise ValueError("PennyLane-observed ansatz resources differ from canonical expectations")
    protocol = circuit_spec["compilation_protocol"]
    return {
        **observed_metrics,
        "basis_gates": protocol["basis_gates"],
        "compilation_protocol_sha256": circuit_spec["compilation_protocol_sha256"],
        "operation_sequence_sha256": operation_digest,
        "adapter_verification": "passed",
        "metric_scope": protocol["metric_scope"],
        "includes_reference_state": False,
        "includes_measurement": False,
        "includes_hardware_optimization_or_routing": False,
    }


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


def run(
    output_path: Path | None = OUTPUT_PATH,
    *,
    optimizer_algorithm: OptimizerAlgorithm = "scipy_minimize_scalar_bounded",
) -> int:
    started = time.perf_counter()
    manifest_bytes = MANIFEST_PATH.read_bytes()
    manifest = json.loads(manifest_bytes)
    circuit_bytes = CIRCUIT_PATH.read_bytes()
    circuit_spec = json.loads(circuit_bytes)
    hamiltonian = _hamiltonian(manifest)
    nuclear_repulsion = float(manifest["nuclear_repulsion_ha"])
    device = qml.device("default.qubit", wires=4, shots=None)
    occupation = np.array([int(bit) for bit in HF_BITSTRING_QUBIT0_FIRST], dtype=int)

    @qml.qnode(device)
    def energy_circuit(theta: float):
        qml.BasisState(occupation, wires=range(4))
        _apply_canonical_excitation(theta, circuit_spec)
        return qml.expval(hamiltonian)

    @qml.qnode(device)
    def state_circuit(theta: float):
        qml.BasisState(occupation, wires=range(4))
        _apply_canonical_excitation(theta, circuit_spec)
        return qml.state()

    def energy(theta: float) -> float:
        return float(energy_circuit(float(theta))) + nuclear_repulsion

    try:
        result = optimize_one_parameter(
            energy,
            algorithm=optimizer_algorithm,
        )
        final_theta = result.final_parameter
        common_basis_resources = _verified_common_basis(final_theta, circuit_spec)
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
        if output_path is not None:
            output_path.write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
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
            "canonical_circuit_sha256": circuit_spec["canonical_circuit_sha256"],
            "compilation_protocol_sha256": circuit_spec["compilation_protocol_sha256"],
            "hamiltonian_digest_legacy": manifest["hamiltonian_digest_sha256"],
            "reference_bitstring_qubit0_first": HF_BITSTRING_QUBIT0_FIRST,
            "excited_bitstring_qubit0_first": "0101",
            "parameter_slot_id": PARAMETER_SLOT_ID,
            "parameter_orientation": "exp_theta_over_2_generator",
        },
        "optimization": {
            "algorithm": result.algorithm,
            "success": result.success,
            "message": result.message,
            "iterations": result.iterations,
            "function_evaluations": result.function_evaluations,
            "gradient_evaluations": result.gradient_evaluations,
            "final_parameter": final_theta,
            "best_energy_ha": result.best_energy_ha,
            "exact_energy_ha": exact_total_energy,
            "absolute_error_ha": abs(result.best_energy_ha - exact_total_energy),
            "final_state_fidelity": fidelity,
            "trajectory": list(result.trajectory),
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
                **common_basis_resources,
            },
            "provider_native_diagnostic": {
                "depth": int(resource_info.depth),
                "gate_count": int(resource_info.num_gates),
                "gate_types": dict(resource_info.gate_types),
                "shots": None,
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
    parser.add_argument(
        "--optimizer",
        choices=("scipy_minimize_scalar_bounded", "scipy_slsqp"),
        default="scipy_minimize_scalar_bounded",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="write a new evidence file; never use this option for a frozen fixture",
    )
    args = parser.parse_args()
    selected_output = None if args.stdout_only else (args.output or OUTPUT_PATH)
    raise SystemExit(
        run(
            selected_output,
            optimizer_algorithm=args.optimizer,
        )
    )
