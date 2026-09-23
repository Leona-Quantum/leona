"""Bell pair: prepare one of the four Bell states, measure both qubits in the
same basis, and compare the sampled correlation with the exact one.

Runs in the Qapp sandbox, which injects QAPP_INPUTS and reads RESULT.
"""

from qiskit import QuantumCircuit
from qiskit.quantum_info import SparsePauliOp, Statevector

STATES = ("phi_plus", "phi_minus", "psi_plus", "psi_minus")
BASES = ("Z", "X")
OUTCOMES = ("00", "01", "10", "11")

state = QAPP_INPUTS.get("state", "phi_plus")
basis = QAPP_INPUTS.get("basis", "Z")
shots = QAPP_INPUTS.get("shots", 1000)
if state not in STATES:
    raise ValueError("state must be one of " + ", ".join(STATES))
if basis not in BASES:
    raise ValueError("basis must be Z or X")
if not isinstance(shots, int) or isinstance(shots, bool) or not 1 <= shots <= 8192:
    raise ValueError("shots must be a whole number from 1 to 8192")
if QAPP_MAX_QUBITS < 2:
    raise ValueError("this app needs 2 qubits")

circuit = QuantumCircuit(2, name="bell")
circuit.h(0)
circuit.cx(0, 1)
if state in ("psi_plus", "psi_minus"):
    circuit.x(1)
if state in ("phi_minus", "psi_minus"):
    circuit.z(0)
if basis == "X":
    # Measuring X on both qubits is a Hadamard on each, then a Z measurement.
    circuit.h([0, 1])

final = Statevector.from_instruction(circuit)
# Qiskit writes qubit 0 as the RIGHTMOST character; reverse so the first
# character is qubit A (qubit 0) and the second is qubit B (qubit 1).
exact = {outcome: 0.0 for outcome in OUTCOMES}
for key, probability in final.probabilities_dict().items():
    exact[key[::-1]] = round(float(probability), 6)
counts = {outcome: 0 for outcome in OUTCOMES}
for key, count in final.sample_counts(shots).items():
    counts[key[::-1]] += int(count)

# A shot scores +1 when the two qubits agree and -1 when they differ, which is
# the eigenvalue of Z⊗Z on the (possibly rotated) state.
sampled = sum(count if key[0] == key[1] else -count for key, count in counts.items()) / shots
ideal = float(final.expectation_value(SparsePauliOp("ZZ")).real)

drawn = circuit.copy()
drawn.measure_all()

RESULT = {
    "state": state,
    "basis": basis,
    "shots": shots,
    "counts": counts,
    "probabilities": exact,
    "correlation": round(sampled, 6),
    "exact_correlation": round(ideal, 6),
    "circuit": str(drawn.draw(output="text")),
}
