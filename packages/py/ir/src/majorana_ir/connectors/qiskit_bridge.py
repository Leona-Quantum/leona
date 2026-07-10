"""Qiskit <-> IR bridge. The sandbox emits OpenQASM (needs no SDK), so the common
path is `from_openqasm`; this module handles a live QuantumCircuit object when
qiskit is installed. Ported from quepo `qhte.connectors.qiskit`."""

from __future__ import annotations

from typing import Any

from majorana_ir.canonical import canonicalize_circuit
from majorana_ir.connectors.openqasm import from_openqasm, to_openqasm
from majorana_ir.models import Circuit, Operation, upgrade_to_v3


class QiskitDependencyError(RuntimeError):
    pass


def _from_qiskit_object(quantum_circuit: Any, metadata: dict[str, Any] | None) -> Circuit:
    operations: list[Operation] = []
    qubits = quantum_circuit.num_qubits
    classical_bits = quantum_circuit.num_clbits
    qubit_index = {bit: index for index, bit in enumerate(quantum_circuit.qubits)}
    clbit_index = {bit: index for index, bit in enumerate(quantum_circuit.clbits)}

    for instruction, qargs, cargs in quantum_circuit.data:
        name = instruction.name.lower()
        if name == "measure":
            operations.append(
                Operation(
                    gate="measure",
                    qubits=[qubit_index[qargs[0]]],
                    clbits=[clbit_index[cargs[0]]],
                )
            )
        else:
            operations.append(
                Operation(
                    gate=name,
                    qubits=[qubit_index[arg] for arg in qargs],
                    params=[
                        float(param) if isinstance(param, int | float) else str(param)
                        for param in instruction.params
                    ],
                )
            )
    return canonicalize_circuit(
        upgrade_to_v3(
            Circuit(
                qubits=qubits,
                classical_bits=classical_bits,
                operations=operations,
                metadata=metadata or {},
            )
        )
    )


def from_qiskit(payload: Any, metadata: dict[str, Any] | None = None) -> Circuit:
    """Import a Qiskit circuit object or OpenQASM string emitted by Qiskit."""
    if isinstance(payload, str):
        return from_openqasm(payload, metadata=metadata)
    if hasattr(payload, "data") and hasattr(payload, "num_qubits"):
        return _from_qiskit_object(payload, metadata=metadata)
    if isinstance(payload, dict) and isinstance(payload.get("qasm"), str):
        return from_openqasm(payload["qasm"], metadata=metadata)
    raise TypeError("qiskit payload must be a QuantumCircuit, OpenQASM string, or {'qasm': ...}")


def to_qiskit(circuit: Circuit, require_sdk: bool = False) -> Any:
    """Export to a Qiskit QuantumCircuit when available, otherwise OpenQASM text."""
    qasm = to_openqasm(circuit)
    try:
        from qiskit import QuantumCircuit  # type: ignore
    except Exception as exc:
        if require_sdk:
            raise QiskitDependencyError(
                "install majorana-ir[qiskit] to export a QuantumCircuit object"
            ) from exc
        return qasm

    if hasattr(QuantumCircuit, "from_qasm_str"):
        return QuantumCircuit.from_qasm_str(qasm)
    return qasm
