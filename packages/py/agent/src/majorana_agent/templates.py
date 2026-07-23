"""Static reference templates, one per framework.

A minimal Bell-state program per framework, following the exact FINAL_CIRCUIT/RESULT
contract and current API conventions AGENT_SYSTEM_PROMPT requires (Qiskit 2.x
AerSimulator, cirq.optimize_for_target_gateset, PennyLane qml.set_shots/qml.compile).
Each was run through majorana_sandbox.LocalSubprocessSandbox by hand and confirmed
exit_code 0 with no warnings before being pinned here — that is a sandbox-execution
check, not a claim of pipeline verification, and the prompt must say so: never call
these "verified".

A workspace's own past verified artifacts were tried as dynamic few-shot exemplars
here (LLM work list item 4) but were removed: retrieval selected by recency within a
framework only, with no relevance filter to the current plan's algorithm (and no way
to add one — the plan doesn't exist yet when retrieval runs, before request_plan). An
unrelated "known-good" example is worse than a plain, honest baseline template.
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
