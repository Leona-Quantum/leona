"""Cross-framework circuit smoke coverage for the public connector promise."""

import pytest

from majorana_ir import Circuit, Operation
from majorana_ir.connectors import cirq_code, pennylane_code, qiskit_code
from majorana_ir.export import classify_export


def bell_circuit() -> Circuit:
    return Circuit(
        qubits=2,
        classical_bits=2,
        operations=[
            Operation(gate="h", qubits=[0]),
            Operation(gate="cx", qubits=[0, 1]),
            Operation(gate="measure", qubits=[0], clbits=[0]),
            Operation(gate="measure", qubits=[1], clbits=[1]),
        ],
    )


@pytest.mark.parametrize(
    ("renderer", "markers"),
    [
        (qiskit_code, ("QuantumCircuit", "circuit.h", "circuit.cx", "circuit.measure")),
        (pennylane_code, ("qml.device", "qml.Hadamard", "qml.CNOT", "qml.sample")),
        (cirq_code, ("cirq.LineQubit.range", "cirq.H", "cirq.CNOT", "cirq.measure")),
    ],
)
def test_bell_circuit_renders_for_each_public_framework(renderer, markers):
    code = renderer(bell_circuit())
    assert all(marker in code for marker in markers)


@pytest.mark.parametrize("target", ["qiskit", "pennylane", "cirq"])
def test_bell_circuit_has_an_explicit_export_classification(target):
    result = classify_export(bell_circuit(), target)
    assert result.code
    assert result.qasm_available
    assert result.status.value in {"lossless", "lossy_with_reason"}
