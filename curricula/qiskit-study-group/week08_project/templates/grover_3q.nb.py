# ---
# title: "Week 08 — Project template: 3-qubit Grover search"
# kind: project
# summary: >-
#   Build a 3-qubit Grover search for one marked state, transpile it to a target with
#   GenericBackendV2, and compare the ideal circuit's depth against the ISA circuit's.
# objectives:
#   - Implement a 3-qubit oracle and diffusion operator by hand, gate by gate
#   - Transpile the circuit to a target and compare depth before and after
#   - Explain why adding more Grover iterations does not always raise success probability
# prerequisites:
#   - Week 04 — Target, basis gates, routing, ISA circuit, preset pass manager
#   - Week 05 — SamplerV2 and result objects
#   - Week 06 — oracle, phase kickback, diffusion, amplitude amplification
# duration_minutes: 90
# ---

# %% [markdown] role=objective
# ## What your team will build
# A 3-qubit Grover search that finds one marked 3-bit state among the 8 possible
# outcomes, built from an oracle and a diffusion operator your team writes (Week 06
# covered 2 qubits; this extends the same construction to 3). Then you transpile that
# circuit to a target with `GenericBackendV2` and compare its depth against the ideal
# version — the same before/after comparison from Week 04, applied to an algorithm
# instead of a toy circuit. This is the "3-qubit Grover" template from the Week 08
# project brief (`README.md`). Work through the milestones, then compare with
# `reference/grover_3q.nb.py`.

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

# %% [markdown] role=concept
# ## Oracle and diffusion, extended to 3 qubits
# The two building blocks are the same shape as Week 06, just with a third qubit as an
# extra control. To mark one target bitstring (say `"101"`, using Qiskit's convention
# that qubit 0 is the rightmost character): flip the qubits that should read `0` with
# `x`, apply a controlled-Z across all 3 qubits (built here from `h` + `mcx` + `h` on
# the last qubit, since `mcx` alone only flips a bit, not a phase), then flip those same
# qubits back. The diffusion operator is the mirror image, without the target-specific
# `x` gates: it inverts every amplitude about their average, amplifying whatever the
# oracle marked. With 3 qubits there are 8 possible outcomes, so the optimal number of
# iterations is small — around 2, not 20.

# %% [markdown] role=exercise
# ### Milestone 1 — build the oracle and diffusion, verify locally
# Complete `oracle(qc, qubits, marked)` and `diffusion(qc, qubits)` below, then
# `build_grover_circuit(marked, iterations)`. Build a circuit for `marked="101"` with
# `iterations=2` and sample it locally (no transpile yet). Predict before running: with
# 8 equally likely outcomes to start, do you expect one bitstring to dominate the counts
# after 2 iterations, or something closer to a flat distribution?

# %% role=run
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
    f"expected '{marked_state}' to be the most common outcome, "
    f"most common was '{max(grover_counts, key=grover_counts.get)}'"
)
assert marked_fraction > 0.7, f"marked-state fraction too low: {marked_fraction:.3f}"

# %% [markdown] role=exercise
# ### Milestone 2 — transpile to a target, compare depth
# Transpile `grover_qc` for a 3-qubit `GenericBackendV2` with
# `generate_preset_pass_manager(optimization_level=1, backend=backend)`, the same call
# from Week 04. Compare `qc.depth()` before and after: the ISA circuit should be
# noticeably deeper, since `mcx` and `h` are not in the target's basis and have to be
# decomposed into `cx`/`rz`/`sx`/`x`.

# %% role=run
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
# Predict first: do you expect `iterations=1` to find the marked state more or less
# reliably than `iterations=2`? Run both with `build_grover_circuit` and compare their
# marked-state fractions.

# %% role=run
def marked_fraction_for(iterations, marked=marked_state, shots=1000, seed=42):
    qc = build_grover_circuit(marked, iterations)
    counts = StatevectorSampler(seed=seed).run([qc], shots=shots).result()[0].data.meas.get_counts()
    total = sum(counts.values())
    return counts.get(marked, 0) / total


fraction_1_iteration = marked_fraction_for(1)
fraction_2_iterations = marked_fraction_for(2)
print(f"1 iteration:  fraction on '{marked_state}' = {fraction_1_iteration:.3f}")
print(f"2 iterations: fraction on '{marked_state}' = {fraction_2_iterations:.3f}")

# %% role=checkpoint
assert fraction_2_iterations > fraction_1_iteration, (
    "expected 2 iterations to outperform 1 for this marked state and qubit count"
)

# %% [markdown] role=explain
# Grover's success probability rises and falls with the iteration count — it does not
# keep climbing forever. For `N` possible outcomes, the optimal iteration count is close
# to `floor(pi/4 * sqrt(N))`; for `N = 8` that is close to 2, which is why `iterations=2`
# outperforms `iterations=1` here. Push past the optimum (try `iterations=3` if you have
# time) and the marked-state fraction falls again, back toward — or even below — where
# it started, because the amplification keeps rotating past the marked state instead of
# stopping on it.

# %% [markdown] role=summary
# ## What your team has now
# A hand-built oracle and diffusion operator that finds a 3-bit marked state reliably in
# 2 iterations, a transpile step showing the ISA circuit is deeper than the ideal one
# while staying within the target's basis, and a 1-vs-2-iteration comparison. For the
# demo: state your Milestone 1 and Milestone 3 predictions before showing the results,
# and be ready to explain what changed if you tried `iterations=3` as your modification.
# Compare your implementation with `reference/grover_3q.nb.py`.
