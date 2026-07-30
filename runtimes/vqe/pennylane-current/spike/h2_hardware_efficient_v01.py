"""PennyLane evaluation of the frozen provider-neutral H2 RY-CX ansatz."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import struct
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
FIXTURE_DIR = ROOT / "docs" / "atlas" / "fixtures" / "h2_sto3g"
MANIFEST_PATH = FIXTURE_DIR / "manifest.json"
CIRCUIT_PATH = FIXTURE_DIR / "canonical_hardware_efficient_v0.1.json"
OUTPUT_PATH = FIXTURE_DIR / "raw" / "pennylane_hardware_efficient_v0.1.json"
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


def _initial_parameters(circuit_spec: dict) -> np.ndarray:
    parameters = [
        struct.unpack(">d", bytes.fromhex(item["initial_float64_hex"]))[0]
        for item in circuit_spec["initial_parameters"]
    ]
    if [item["slot_id"] for item in circuit_spec["initial_parameters"]] != circuit_spec[
        "parameter_slot_order"
    ]:
        raise ValueError("initial parameters do not follow the canonical slot order")
    return np.asarray(parameters, dtype=float)


def _parameter_map(parameters: np.ndarray, circuit_spec: dict) -> dict[str, float]:
    slots = circuit_spec["parameter_slot_order"]
    if len(parameters) != len(slots):
        raise ValueError("parameter vector does not match the hardware-efficient slot order")
    return dict(zip(slots, (float(value) for value in parameters), strict=True))


def _apply_ansatz(parameters: np.ndarray, circuit_spec: dict) -> None:
    values = _parameter_map(parameters, circuit_spec)
    for operation in circuit_spec["common_basis_operations"]:
        if operation["gate"] == "ry":
            qml.RY(values[operation["parameter_slot_id"]], wires=operation["wires"][0])
        elif operation["gate"] == "cx":
            qml.CNOT(wires=operation["wires"])
        else:
            raise ValueError(f"unsupported canonical gate {operation['gate']!r}")


def _verified_common_basis(circuit_spec: dict) -> dict:
    probe = np.linspace(-0.31, 0.29, len(circuit_spec["parameter_slot_order"]))
    with qml.tape.QuantumTape() as tape:
        _apply_ansatz(probe, circuit_spec)
    name_map = {"RY": "ry", "CNOT": "cx"}
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
            raise ValueError(
                f"unexpected PennyLane hardware-efficient gate {operation.name!r}"
            ) from exc
        wires = [int(wire) for wire in operation.wires]
        observed = {
            "gate": gate,
            "wires": wires,
            "parameter_slot_id": expected["parameter_slot_id"] if gate == "ry" else None,
        }
        if gate == "ry":
            slot_index = circuit_spec["parameter_slot_order"].index(expected["parameter_slot_id"])
            if not np.isclose(float(operation.parameters[0]), probe[slot_index]):
                raise ValueError("PennyLane RY parameter differs from the canonical slot")
        operations.append(observed)
        layer = max(wire_depth[wire] for wire in wires) + 1
        for wire in wires:
            wire_depth[wire] = layer
    metrics = {
        "depth": max(wire_depth),
        "gate_count": len(operations),
        "cnot_count": sum(operation["gate"] == "cx" for operation in operations),
        "parameter_count": len(circuit_spec["parameter_slot_order"]),
        "rotation_layer_count": circuit_spec["repetitions"],
        "entanglement_layer_count": circuit_spec["repetitions"],
    }
    digest = _canonical_json_sha256(operations)
    if digest != circuit_spec["common_basis_operation_sequence_sha256"]:
        raise ValueError("PennyLane operation sequence differs from the canonical protocol")
    if metrics != circuit_spec["common_basis_metrics"]:
        raise ValueError("PennyLane resources differ from canonical expectations")
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
    try:
        manifest_bytes = MANIFEST_PATH.read_bytes()
        manifest = json.loads(manifest_bytes)
        circuit_spec = json.loads(CIRCUIT_PATH.read_bytes())
        hamiltonian = _hamiltonian(manifest)
        nuclear_repulsion = float(manifest["nuclear_repulsion_ha"])
        device = qml.device("default.qubit", wires=4, shots=None)
        occupation = np.array([int(bit) for bit in HF_BITSTRING_QUBIT0_FIRST], dtype=int)

        @qml.qnode(device)
        def energy_circuit(parameters: np.ndarray):
            qml.BasisState(occupation, wires=range(4))
            _apply_ansatz(parameters, circuit_spec)
            return qml.expval(hamiltonian)

        @qml.qnode(device)
        def state_circuit(parameters: np.ndarray):
            qml.BasisState(occupation, wires=range(4))
            _apply_ansatz(parameters, circuit_spec)
            return qml.state()

        def energy(parameters: np.ndarray) -> float:
            return float(energy_circuit(parameters)) + nuclear_repulsion

        result = optimize_parameters(
            energy,
            algorithm="scipy_slsqp",
            initial_parameters=_initial_parameters(circuit_spec),
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
        "capability": "h2_sto3g_hardware_efficient_ry_cx_v1",
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
            "parameter_slot_order": circuit_spec["parameter_slot_order"],
            "initial_parameter_float64_hex": [
                item["initial_float64_hex"] for item in circuit_spec["initial_parameters"]
            ],
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
            "canonical_logical": {
                "qubits": 4,
                "parameter_count": len(circuit_spec["parameter_slot_order"]),
                "rotation_layers": circuit_spec["repetitions"],
                "entanglement_layers": circuit_spec["repetitions"],
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
    parser.add_argument("--stdout-only", action="store_true")
    args = parser.parse_args()
    return run(None if args.stdout_only else args.output)


if __name__ == "__main__":
    raise SystemExit(main())
