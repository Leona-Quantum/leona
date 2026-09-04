# ---
# title: Week 02 challenge — GHZ states and anti-correlated bits
# kind: challenge
# summary: Extend the Bell state to three qubits, then build an anti-correlated-pair
#   generator by flipping one qubit of a finished Bell state.
# objectives:
#   - Build a three-qubit GHZ state and predict its measurement distribution
#   - Build a generator for anti-correlated bit pairs from a Bell state plus one gate
# prerequisites:
#   - Week 02 lab — cx, the Bell state, correlation, the bitstring order
# duration_minutes: 15
# ---

# %% [markdown] role=objective
# ## What you will build
# Two extensions of the lab's Bell state: a three-qubit version where all three qubits
# agree every time, and a two-qubit pair generator where the two bits always disagree.
# Both reuse exactly what the lab already showed you.

# %% [markdown] role=concept
# ## From two qubits to three
# The lab's Bell state chained one `cx`: `h(0)` puts qubit 0 in superposition, then
# `cx(0, 1)` links qubit 1 to it. A three-qubit version chains a second `cx`, using
# qubit 1 — now itself entangled with qubit 0 — as the control for qubit 2. Whatever
# qubit 0 measures, qubit 1 is forced to match it, and whatever qubit 1 measures, qubit 2
# is forced to match that. All three end up locked to the same value.
#
# This three-qubit generalization of the Bell state has its own name too: a **GHZ
# state**, after Greenberger, Horne, and Zeilinger, who first described it. Same idea as
# the Bell state, just chained one qubit further.

# %% [markdown] role=predict
# ### Task 1: a three-qubit GHZ state
# Before writing any code: a 3-qubit circuit has eight possible outcomes, `"000"`
# through `"111"`. Given the concept above, which two of the eight do you expect to see,
# and roughly what fraction of the shots should land on each? Write specific numbers.

# %% [markdown] role=exercise
# Build a 3-qubit circuit named `ghz_qc`: `h` on qubit 0, `cx(0, 1)`, then `cx(1, 2)`,
# then `measure_all()`. Sample it with `StatevectorSampler(seed=42)` at `shots=2000` and
# store the result in a dictionary named `ghz_counts`.

# %% role=solution stub="ghz_qc = None\nghz_counts = None\n"
from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler

ghz_qc = QuantumCircuit(3)
ghz_qc.h(0)
ghz_qc.cx(0, 1)
ghz_qc.cx(1, 2)
ghz_qc.measure_all()

ghz_counts = StatevectorSampler(seed=42).run([ghz_qc], shots=2000).result()[0].data.meas.get_counts()
for outcome, shots in sorted(ghz_counts.items()):
    print(f"{outcome}: {shots} ({shots / 2000:.3f})")

# %% [markdown] role=hint
# Chain the entanglement one `cx` at a time: `cx(0, 1)` first, then `cx(1, 2)` — each
# `cx`'s control must be a qubit that is already in superposition (or already entangled
# with one), or the lab's "swapped `cx`" experiment showed you exactly what goes wrong.

# %% role=checkpoint
if ghz_counts is not None:
    assert set(ghz_counts) <= {"000", "111"}, (
        f"expected only 000 and 111, saw {sorted(ghz_counts)}"
    )
    ghz_total = sum(ghz_counts.values())
    for outcome in ("000", "111"):
        fraction = ghz_counts.get(outcome, 0) / ghz_total
        assert 0.35 < fraction < 0.65, f"'{outcome}' landed at {fraction:.3f}, far from half"

# %% [markdown] role=explain
# If your circuit matched the hint, only `"000"` and `"111"` appear, each near half the
# shots. The same rule from the lab's Bell state applies with one more qubit: a chain of
# `cx` gates, each controlled by an already-entangled qubit, forces every qubit in the
# chain to agree.

# %% [markdown] role=predict
# ### Task 2: anti-correlated bits, a different way
# The lab's Modify 2 built an anti-correlated pair by flipping a qubit *before* the
# entangling `cx`. This task reaches the same kind of pair a different way: build the
# ordinary Bell state first, then flip one qubit *after* it is finished. Before writing
# any code: which two of the four two-bit outcomes do you expect, using the lab's
# bitstring-order rule to name them?

# %% [markdown] role=exercise
# Build a 2-qubit circuit named `anti_qc`: `h(0)`, `cx(0, 1)`, then `x(1)` — the ordinary
# Bell circuit, plus one `x` gate on qubit 1 applied after the `cx` — then
# `measure_all()`. Sample it with `StatevectorSampler(seed=7)` at `shots=2000`. Using
# `result[0].data.meas.get_bitstrings()` and the lab's rightmost-is-qubit-0 rule, turn
# the per-shot bitstrings into a list of `(qubit_0, qubit_1)` tuples named `anti_pairs`.

# %% role=solution stub="anti_qc = None\nanti_pairs = None\n"
from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler

anti_qc = QuantumCircuit(2)
anti_qc.h(0)
anti_qc.cx(0, 1)
anti_qc.x(1)
anti_qc.measure_all()

anti_result = StatevectorSampler(seed=7).run([anti_qc], shots=2000).result()
anti_bitstrings = anti_result[0].data.meas.get_bitstrings()
anti_pairs = [(int(bitstring[-1]), int(bitstring[-2])) for bitstring in anti_bitstrings]
print(anti_pairs[:8])

# %% [markdown] role=hint
# Reuse the lab's rule directly: for a bitstring `bs`, `int(bs[-1])` is qubit 0 and
# `int(bs[-2])` is qubit 1. Applying `x(1)` *after* `cx(0, 1)` does not touch the
# correlation the `cx` built — it just flips qubit 1's half of every already-correlated
# pair, turning "always agree" into "always disagree."

# %% role=checkpoint
if anti_pairs is not None:
    anti_matches = sum(1 for q0, q1 in anti_pairs if q0 == q1)
    assert anti_matches / len(anti_pairs) < 0.05, (
        f"expected almost no matching pairs, got {anti_matches}/{len(anti_pairs)}"
    )

# %% [markdown] role=explain
# Only `(0, 1)` and `(1, 0)` should appear — the two qubits disagree on essentially every
# shot. The `cx` still built the same correlation as the lab's Bell state; the trailing
# `x(1)` just relabels qubit 1's outcome afterward, without touching what the `cx` linked
# it to. Whether you flip a qubit before entangling (the lab's Modify 2) or after (this
# task), the measured pairs end up anti-correlated either way.

# %% [markdown] role=summary
# ## What you built
# A three-qubit GHZ state where all three qubits agree, and an anti-correlated pair
# generator built by flipping one qubit of a finished Bell state. Compare your answers
# with the reference solution notebook and its self-evaluation checklist.
