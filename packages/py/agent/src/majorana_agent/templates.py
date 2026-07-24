"""Minimal framework-native examples for the generation prompt.

Each example follows the fixed pipeline's protected ``FINAL_CIRCUIT``/``RESULT``
contract and current simulator APIs. They are syntax/runtime references only, never
verification evidence.
"""

from __future__ import annotations

from majorana_contracts.enums import Framework

REFERENCE_TEMPLATES: dict[Framework, str] = {
    Framework.QISKIT: """\
from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator

qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()

simulator = AerSimulator()
transpiled = transpile(qc, simulator, seed_transpiler=1234)
job = simulator.run(transpiled, shots=1024, seed_simulator=1234)
counts = job.result().get_counts()

FINAL_CIRCUIT = transpiled
RESULT = {"counts": dict(counts)}
""",
    Framework.CIRQ: """\
import cirq

q0, q1 = cirq.LineQubit.range(2)
circuit = cirq.Circuit([cirq.H(q0), cirq.CNOT(q0, q1)])
circuit = cirq.optimize_for_target_gateset(circuit, gateset=cirq.CZTargetGateset())
circuit.append(cirq.measure(q0, q1, key="result"))

simulator = cirq.Simulator(seed=1234)
result = simulator.run(circuit, repetitions=1024)
counts = result.histogram(key="result")
readable_counts = {format(bitstring, "02b"): int(count) for bitstring, count in counts.items()}

FINAL_CIRCUIT = circuit
RESULT = {"counts": readable_counts}
""",
    Framework.PENNYLANE: """\
import pennylane as qml

device = qml.device("default.qubit", wires=2, seed=1234)


@qml.set_shots(1024)
@qml.qnode(device)
def circuit():
    qml.Hadamard(wires=0)
    qml.CNOT(wires=[0, 1])
    return qml.counts()


FINAL_CIRCUIT = qml.compile(circuit)
raw_counts = FINAL_CIRCUIT()
RESULT = {"counts": {str(k): int(v) for k, v in raw_counts.items()}}
""",
}
