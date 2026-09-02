# ---
# title: "Week 08 — Reference: 3-qubit Grover search"
# kind: solution
# summary: >-
#   Complete reference implementation of the 3-qubit Grover project: an oracle and
#   diffusion operator, a target-compatible transpile, and an ideal-vs-ISA depth and
#   iteration-count comparison.
# objectives:
#   - Show a complete 3-qubit oracle and diffusion operator, built by hand, gate by gate
#   - Demonstrate the transpiled circuit is deeper but still target-compatible
#   - Compare 1 vs 2 Grover iterations and explain the overshoot at 3
# prerequisites:
#   - templates/grover_3q.nb.py attempted first
# duration_minutes: 20
# ---

# %% [markdown] role=objective
# ## Reference solution: 3-qubit Grover search
# This is the complete answer to `templates/grover_3q.nb.py`: a hand-built oracle and
# diffusion operator that finds a 3-bit marked state, a transpile to `GenericBackendV2`
# showing the ISA circuit is deeper but still target-compatible, and a comparison across
# 1, 2, and 3 Grover iterations. Read this after attempting the template yourself.

# %% role=setup
import qiskit
from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler
from qiskit.providers.fake_provider import GenericBackendV2
from qiskit.transpiler import generate_preset_pass_manager

print(f"qiskit {qiskit.__version__}")
assert qiskit.__version__.startswith("2.5"), (
    f"expected Qiskit 2.5.x, found {qiskit.__version__} instead"
)

# %% [markdown] role=exercise
# ### Milestone 1 — build the oracle and diffusion, verify locally
# Build `oracle(qc, qubits, marked)`, `diffusion(qc, qubits)`, and
# `build_grover_circuit(marked, iterations)`. Build a circuit for `marked="101"` with
# `iterations=2` and sample it locally.

# %% role=solution
def oracle(qc, qubits, marked):
    """Flip the phase of the |marked> basis state, leave every other state alone."""
    n = len(qubits)
    marked_reversed = marked[::-1]  # marked_reversed[i] is qubits[i]'s target bit
    for i in range(n):
        if marked_reversed[i] == "0":
            qc.x(qubits[i])
    qc.h(qubits[-1])
    qc.mcx(qubits[:-1], qubits[-1])
    qc.h(qubits[-1])
    for i in range(n):
        if marked_reversed[i] == "0":
            qc.x(qubits[i])


def diffusion(qc, qubits):
    """Invert every amplitude about their mean (inversion about average)."""
    qc.h(qubits)
    qc.x(qubits)
    qc.h(qubits[-1])
    qc.mcx(qubits[:-1], qubits[-1])
    qc.h(qubits[-1])
    qc.x(qubits)
    qc.h(qubits)


def build_grover_circuit(marked, iterations, n=3):
    qubits = list(range(n))
    qc = QuantumCircuit(n)
    qc.h(qubits)
    for _ in range(iterations):
        oracle(qc, qubits, marked)
        diffusion(qc, qubits)
    qc.measure_all()
    return qc


marked_state = "101"
grover_qc = build_grover_circuit(marked_state, iterations=2)
grover_counts = (
    StatevectorSampler(seed=42).run([grover_qc], shots=1000).result()[0].data.meas.get_counts()
)
total_shots = sum(grover_counts.values())
marked_fraction = grover_counts.get(marked_state, 0) / total_shots
print(f"counts: {dict(sorted(grover_counts.items(), key=lambda kv: -kv[1]))}")
print(f"fraction on marked state '{marked_state}': {marked_fraction:.3f}")

# %% role=figure
print(grover_qc.draw("text"))
grover_qc.draw("mpl", fold=-1)

# %% role=checkpoint
assert max(grover_counts, key=grover_counts.get) == marked_state, (
    f"expected '{marked_state}' to be the most common outcome"
)
assert marked_fraction > 0.7, f"marked-state fraction too low: {marked_fraction:.3f}"

# %% [markdown] role=exercise
# ### Milestone 2 — transpile to a target, compare depth
# Transpile `grover_qc` for a 3-qubit `GenericBackendV2` with
# `generate_preset_pass_manager(optimization_level=1, backend=backend)` and compare
# `qc.depth()` before and after, then confirm the ISA circuit only uses instructions
# from the target's basis.

# %% role=solution
backend = GenericBackendV2(num_qubits=3, seed=1)
pass_manager = generate_preset_pass_manager(optimization_level=1, backend=backend)
isa_grover_qc = pass_manager.run(grover_qc)

ideal_depth = grover_qc.depth()
isa_depth = isa_grover_qc.depth()
print(f"ideal depth: {ideal_depth}")
print(f"ISA depth:   {isa_depth}")

isa_instruction_names = sorted({instr.operation.name for instr in isa_grover_qc.data})
print(f"ISA instruction names: {isa_instruction_names}")

# %% role=figure
print(isa_grover_qc.draw("text"))
isa_grover_qc.draw("mpl", fold=-1)

# %% role=checkpoint
assert isa_depth > ideal_depth, (
    f"expected the ISA circuit to be deeper than the ideal one, got ideal={ideal_depth} "
    f"isa={isa_depth}"
)
allowed_names = set(backend.target.operation_names) | {"barrier"}
assert set(isa_instruction_names) <= allowed_names, (
    f"ISA circuit used instructions outside the target's basis: "
    f"{set(isa_instruction_names) - allowed_names}"
)

# %% [markdown] role=exercise
# ### Milestone 3 — compare iteration counts
# Compare marked-state fractions for `iterations=1`, `2`, and `3` and confirm the
# overshoot past the optimum.

# %% role=solution
def marked_fraction_for(iterations, marked=marked_state, shots=1000, seed=42):
    qc = build_grover_circuit(marked, iterations)
    counts = StatevectorSampler(seed=seed).run([qc], shots=shots).result()[0].data.meas.get_counts()
    total = sum(counts.values())
    return counts.get(marked, 0) / total


fractions_by_iteration = {k: marked_fraction_for(k) for k in (1, 2, 3)}
for k, frac in fractions_by_iteration.items():
    print(f"{k} iteration(s): fraction on '{marked_state}' = {frac:.3f}")

# %% role=checkpoint
assert fractions_by_iteration[2] > fractions_by_iteration[1], (
    "expected 2 iterations to outperform 1 for this marked state and qubit count"
)
assert fractions_by_iteration[3] < fractions_by_iteration[2], (
    "expected 3 iterations to overshoot the optimum found at 2 for N=8"
)

# %% [markdown] role=explain
# For `N = 8` possible outcomes, the optimal Grover iteration count is close to
# `floor(pi/4 * sqrt(8))`, which rounds to 2 — matching the peak seen above. Iteration 3
# rotates the state past the marked outcome instead of further toward it, so its
# marked-state fraction drops back down. This is why Grover's speedup is stated as a
# specific iteration count, not "more iterations is always better": overshooting costs
# you the same way undershooting does.

# %% [markdown] role=summary
# ## What this reference shows
# A working oracle and diffusion operator finding `"101"` with over 90% probability at
# 2 iterations, a transpile step that is deeper but stays inside the target's basis, and
# an iteration sweep confirming the overshoot past the theoretical optimum. Compare this
# against your own `templates/grover_3q.nb.py` attempt, then use `CHECKLIST.md` for your
# team's self-evaluation before the demo.
