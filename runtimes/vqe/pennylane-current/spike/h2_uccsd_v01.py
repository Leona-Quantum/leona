"""PennyLane evaluation of the frozen provider-neutral H2 UCCSD circuit."""

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
    from optimizer_protocol import optimize_parameters
except ModuleNotFoundError:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from optimizer_protocol import optimize_parameters


def _fixture_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "manifest.json").is_file():
            return parent
    raise RuntimeError("frozen H2 fixture root is unavailable")


ROOT = _fixture_root()
MANIFEST_PATH = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "manifest.json"
CIRCUIT_PATH = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "canonical_uccsd_v0.1.json"
OUTPUT_PATH = (
    ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g" / "raw" / "pennylane_uccsd_v0.1.json"
)
HF_BITSTRING_QUBIT0_FIRST = "1010"


def _canonical_json_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _parameter_map(parameters: np.ndarray, circuit_spec: dict) -> dict[str, float]:
    slots = circuit_spec["parameter_slot_order"]
    if len(parameters) != len(slots):
        raise ValueError("parameter vector does not match the UCCSD slot order")
    return dict(zip(slots, (float(parameter) for parameter in parameters), strict=True))


def _apply_canonical_uccsd(parameters: np.ndarray, circuit_spec: dict) -> None:
    values = _parameter_map(parameters, circuit_spec)
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
            theta = values[operation["parameter_slot_id"]]
            angle = (
                theta * operation["angle_theta_numerator"] / operation["angle_theta_denominator"]
            )
            qml.RZ(angle, wires=wires[0])
        else:
            raise ValueError(f"unsupported canonical gate {gate!r}")


def _observed_common_basis(circuit_spec: dict) -> tuple[list[dict], dict]:
    probe = np.asarray([0.123, -0.234, 0.345])
    values = _parameter_map(probe, circuit_spec)
    with qml.tape.QuantumTape() as tape:
        _apply_canonical_uccsd(probe, circuit_spec)
    name_map = {
        "Hadamard": "h",
        "S": "s",
        "Adjoint(S)": "sdg",
        "CNOT": "cx",
        "RZ": "rz",
    }
    operations: list[dict] = []
    wire_depth = [0, 0, 0, 0]
    for operation, expected in zip(
        tape.operations,
        circuit_spec["common_basis_operations"],
        strict=True,
    ):
        try:
            gate = name_map[operation.name]
        except KeyError as exc:
            raise ValueError(f"unexpected PennyLane UCCSD gate {operation.name!r}") from exc
        wires = [int(wire) for wire in operation.wires]
        observed: dict = {
            "gate": gate,
            "wires": wires,
            "parameter_slot_id": None,
            "angle_theta_numerator": None,
            "angle_theta_denominator": None,
        }
        if gate == "rz":
            slot = expected["parameter_slot_id"]
            ratio = float(operation.parameters[0]) / values[slot]
            denominator = expected["angle_theta_denominator"]
            numerator = int(round(ratio * denominator))
            if not math.isclose(ratio, numerator / denominator, abs_tol=1e-12):
                raise ValueError("PennyLane RZ angle differs from the canonical UCCSD grid")
            observed.update(
                {
                    "parameter_slot_id": slot,
                    "angle_theta_numerator": numerator,
                    "angle_theta_denominator": denominator,
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
        "parameter_count": 3,
        "pauli_rotation_count": 12,
    }
    return operations, metrics


def _verified_common_basis(circuit_spec: dict) -> dict:
    operations, metrics = _observed_common_basis(circuit_spec)
    digest = _canonical_json_sha256(operations)
    if digest != circuit_spec["common_basis_operation_sequence_sha256"]:
        raise ValueError("PennyLane UCCSD operation sequence differs from the canonical protocol")
    if metrics != circuit_spec["common_basis_metrics"]:
        raise ValueError("PennyLane UCCSD resources differ from canonical expectations")
    return {
        **metrics,
        "operation_sequence_sha256": digest,
        "compilation_protocol_sha256": circuit_spec["compilation_protocol_sha256"],
        "adapter_verification": "passed",
        "metric_scope": "ansatz_only",
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


def run(output_path: Path | None = OUTPUT_PATH) -> int:
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
    def energy_circuit(parameters: np.ndarray):
        qml.BasisState(occupation, wires=range(4))
        _apply_canonical_uccsd(parameters, circuit_spec)
        return qml.expval(hamiltonian)

    @qml.qnode(device)
    def state_circuit(parameters: np.ndarray):
        qml.BasisState(occupation, wires=range(4))
        _apply_canonical_uccsd(parameters, circuit_spec)
        return qml.state()

    def energy(parameters: np.ndarray) -> float:
        return float(energy_circuit(parameters)) + nuclear_repulsion

    try:
        result = optimize_parameters(
            energy,
            algorithm="scipy_slsqp",
            initial_parameters=[0.0, 0.0, 0.0],
        )
        final_parameters = np.asarray(result.final_parameters)
        common_basis_resources = _verified_common_basis(circuit_spec)
        final_state = np.asarray(state_circuit(final_parameters))
        dense_hamiltonian = np.asarray(qml.matrix(hamiltonian, wire_order=range(4)))
        eigenvalues, eigenvectors = np.linalg.eigh(dense_hamiltonian)
        exact_total_energy = float(eigenvalues[0].real) + nuclear_repulsion
        fidelity = float(abs(np.vdot(eigenvectors[:, 0], final_state)) ** 2)
        resource_info = qml.specs(energy_circuit)(final_parameters)["resources"]
    except Exception as exc:
        report = {
            "schema_version": "0.1.0",
            "status": "failed",
            "failure_code": "execution_failed",
            "error_type": type(exc).__name__,
            "error_message": str(exc),
        }
        if output_path is not None:
            output_path.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
        return 1

    report = {
        "schema_version": "0.1.0",
        "status": "succeeded",
        "capability": "h2_sto3g_uccsd_v1",
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
            "generator_order": circuit_spec["generator_order"],
            "parameter_slot_order": circuit_spec["parameter_slot_order"],
            "parameter_orientation": "exp_theta_generator",
        },
        "optimization": {
            "algorithm": result.algorithm,
            "success": result.success,
            "message": result.message,
            "iterations": result.iterations,
            "function_evaluations": result.function_evaluations,
            "gradient_evaluations": result.gradient_evaluations,
            "final_parameters": list(result.final_parameters),
            "best_energy_ha": result.best_energy_ha,
            "exact_energy_ha": exact_total_energy,
            "absolute_error_ha": abs(result.best_energy_ha - exact_total_energy),
            "final_state_fidelity": fidelity,
            "trajectory": list(result.trajectory),
        },
        "resources": {
            "semantic_block": {
                "canonical_uccsd_generators": 3,
                "product_formula_order": "double_then_singles",
            },
            "canonical_logical": {
                "qubits": 4,
                "parameter_count": 3,
                "pauli_rotation_blocks": len(circuit_spec["logical_rotations"]),
                "canonical_circuit_sha256": circuit_spec["canonical_circuit_sha256"],
            },
            "common_basis_compiled": common_basis_resources,
            "provider_native_diagnostic": {
                "depth": int(resource_info.depth),
                "gate_count": int(resource_info.num_gates),
                "two_qubit_gate_count": int(resource_info.gate_sizes.get(2, 0)),
                "includes_reference_state": True,
                "comparison_eligible": False,
            },
        },
        "wall_time_s": time.perf_counter() - started,
    }
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument(
        "--stdout-only",
        action="store_true",
        help="Do not write the default fixture path; emit the report only.",
    )
    args = parser.parse_args()
    return run(None if args.stdout_only else args.output)


if __name__ == "__main__":
    raise SystemExit(main())
