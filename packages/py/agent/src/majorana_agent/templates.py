"""Minimal framework-native examples for the generation prompt.

Each example follows the fixed pipeline's protected ``FINAL_CIRCUIT``/``RESULT``
contract and current simulator APIs. They are syntax/runtime references only, never
verification evidence.
"""

from __future__ import annotations

from majorana_contracts.enums import Algorithm, Framework

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

# Known-correct physical reference data for tasks whose numbers the model would
# otherwise have to reconstruct from memory and sometimes fabricates instead. A
# live H2 VQE run (019f9763, 2026-07-25) produced a self-consistent but non-
# physical answer, -1.419 Ha rather than the textbook -1.137 Ha, because the
# generated Hamiltonian used ad hoc coefficients with duplicated Pauli terms
# (XX and YY each appeared twice) that no real Jordan-Wigner reduction
# produces. The structural checks (RESULT contains the key, the value is in
# the Plan's own guessed range) cannot catch this: the Plan's "exact" reference
# was computed from the same fabricated Hamiltonian, so nothing independent
# ever checked the physics. Giving the model the real constants up front, the
# same way REFERENCE_TEMPLATES removes API hallucination, removes this failure
# mode for the cases covered instead of relying on the model recalling them
# correctly under pressure to look complete.
KNOWN_REFERENCE_CONSTANTS: dict[Algorithm, str] = {
    Algorithm.VQE: """\
For H2 at its equilibrium bond length (~0.735 Å) in the STO-3G minimal basis, \
Jordan-Wigner-mapped and parity-reduced to 2 qubits (Kandala et al., Nature 549, \
242 (2017)), the qubit Hamiltonian is exactly:
    ("II", -1.0523732), ("IZ", 0.39793742), ("ZI", -0.39793742),
    ("ZZ", -0.0112801), ("XX", 0.18093119)
Its true ground-state energy is approximately -1.137 Hartree. If the planned task
is this molecule at this bond length, use these exact coefficients verbatim
instead of reconstructing or inventing different ones. For any other molecule,
bond length, or basis, no verified reference is available here: say so in the
Plan or result rather than fabricating coefficients that only look plausible.""",
}
