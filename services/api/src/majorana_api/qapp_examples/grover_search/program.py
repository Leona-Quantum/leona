"""Grover search: mark one item out of 2**n, run a chosen number of Grover
iterations, and watch the probability of finding it rise and fall.

Runs in the Qapp sandbox, which injects QAPP_INPUTS and reads RESULT.
"""

import math

from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

MAX_ITERATIONS = 8

qubits = QAPP_INPUTS.get("qubits", 3)
marked = QAPP_INPUTS.get("marked", 5)
iterations = QAPP_INPUTS.get("iterations", 2)
shots = QAPP_INPUTS.get("shots", 1000)
for name, value in (
    ("qubits", qubits),
    ("marked", marked),
    ("iterations", iterations),
    ("shots", shots),
):
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{name} must be a whole number")
if not 2 <= qubits <= min(5, QAPP_MAX_QUBITS):
    raise ValueError("qubits must be from 2 to 5")
if not 0 <= marked < 2**qubits:
    raise ValueError(f"with {qubits} qubits the marked item must be from 0 to {2**qubits - 1}")
if not 0 <= iterations <= MAX_ITERATIONS:
    raise ValueError(f"iterations must be from 0 to {MAX_ITERATIONS}")
if not 1 <= shots <= 8192:
    raise ValueError("shots must be from 1 to 8192")


def phase_flip_on(n, index):
    """Flip the sign of basis state |index> and leave every other state alone."""
    circuit = QuantumCircuit(n)
    zeros = [q for q in range(n) if not (index >> q) & 1]
    if zeros:
        circuit.x(zeros)
    circuit.mcp(math.pi, list(range(n - 1)), n - 1)
    if zeros:
        circuit.x(zeros)
    return circuit


oracle = phase_flip_on(qubits, marked)
# Reflection about the uniform superposition: H, then a phase flip on |0...0>, then H.
diffuser = QuantumCircuit(qubits)
diffuser.h(range(qubits))
diffuser.compose(phase_flip_on(qubits, 0), inplace=True)
diffuser.h(range(qubits))
step = oracle.compose(diffuser)

start = QuantumCircuit(qubits)
start.h(range(qubits))
state = Statevector.from_instruction(start)
by_iteration = []
chosen = state
for k in range(MAX_ITERATIONS + 1):
    if k == iterations:
        chosen = state
    by_iteration.append(round(float(state.probabilities()[marked]), 6))
    state = state.evolve(step)

# Qiskit bitstrings put qubit 0 on the right, which is also how a binary number
# is written, so the marked item's bitstring is just its binary form.
label = format(marked, f"0{qubits}b")
counts = {key: int(value) for key, value in sorted(chosen.sample_counts(shots).items())}
angle = math.asin(1 / math.sqrt(2**qubits))

RESULT = {
    "qubits": qubits,
    "marked": marked,
    "marked_bitstring": label,
    "iterations": iterations,
    "shots": shots,
    "counts": counts,
    "success_probability": by_iteration[iterations],
    "measured_success": round(counts.get(label, 0) / shots, 6),
    "probability_by_iteration": by_iteration,
    "optimal_iterations": math.floor(math.pi / (4 * angle)),
}
