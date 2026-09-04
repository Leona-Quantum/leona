# ---
# title: Week 02 — Multiple qubits
# kind: lab
# summary: Build a Bell state with CX, compare it against two independent coins, learn
#   Qiskit's bitstring order, and build a correlated-bit generator from one sampler run.
# objectives:
#   - Predict and observe how a CX gate correlates two qubits, against two independent coins
#   - State Qiskit's bitstring order (qubit 0 is the rightmost character) and verify it
#   - Explain the correlation in a Bell state without appealing to any influence between qubits
#   - Build a function that returns many correlated bit pairs from a single sampler run
# prerequisites:
#   - Week 01 — Qubits and circuits (X, H, measurement, shots, sampling noise)
# duration_minutes: 40
# ---

# %% [markdown] role=objective
# ## What you will build
# Two qubits instead of one. You will compare two independent coins against a Bell
# state — the two-qubit circuit that makes both qubits agree every time — learn the rule
# Qiskit uses to write a multi-qubit result as a bitstring, break the Bell state three
# different ways to see what each piece of it is doing, and finish with a function that
# hands back many correlated bit pairs from a single sampler run.

# %% role=setup
import qiskit

print(qiskit.__version__)

from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler

# %% [markdown] role=concept
# ## Two qubits, four outcomes
# Week 01's circuits had one qubit and two possible results, `0` or `1`. A two-qubit
# circuit has four: `00`, `01`, `10`, `11`. Nothing new is required to picture that — it
# is the same idea as flipping two coins and looking at both landings together.
#
# The new gate this week is `cx(control, target)` — controlled-X, also called CNOT. It
# flips the target qubit, but only when the control qubit is `1`. Written on its own, on
# a fresh `|00⟩` pair, it does nothing (the control is `0`), because there is nothing yet
# to condition on. It becomes interesting once the control qubit is in superposition —
# which is exactly what this lab builds next. As in week 01, `|00⟩` is just a label:
# shorthand for "both qubits measured 0," not new math to learn.

# %% [markdown] role=predict
# ### Experiment 1: two independent coins
# Build a two-qubit circuit with `h` on qubit 0 *and* `h` on qubit 1 — no `cx`, nothing
# linking them. Before running: with `shots=1000`, how many of the four outcomes (`00`,
# `01`, `10`, `11`) do you expect to see, and roughly what fraction of the 1000 shots do
# you expect on each? Write a specific guess.

# %% role=run
independent_qc = QuantumCircuit(2)
independent_qc.h(0)
independent_qc.h(1)
independent_qc.measure_all()

independent_counts = (
    StatevectorSampler(seed=42).run([independent_qc], shots=1000).result()[0].data.meas.get_counts()
)
independent_counts

# %% role=observe
independent_total = sum(independent_counts.values())
for outcome in sorted(independent_counts):
    fraction = independent_counts[outcome] / independent_total
    print(f"{outcome}: {independent_counts[outcome]} ({fraction:.1%})")

# %% [markdown] role=explain
# All four outcomes show up, each near 1000 / 4 = 250, none exactly. Each qubit is its
# own fair coin from its own `h`, and nothing in the circuit connects them, so the
# two-bit result is just two independent flips reported together — the same sampling
# noise from week 01, now spread across four bins instead of two.

# %% [markdown] role=predict
# ### Experiment 2: entangle them with `cx`
# Now add one gate: `cx(0, 1)` right after `h(0)` — qubit 0 stays the only one touched
# by `h`, and it becomes the control for the `cx`. Before running: which of the four
# outcomes do you expect to disappear, and roughly what fraction of the 1000 shots do
# you expect on the ones that remain? Write specific numbers.

# %% role=run
bell_qc = QuantumCircuit(2)
bell_qc.h(0)
bell_qc.cx(0, 1)
bell_qc.measure_all()

bell_counts = StatevectorSampler(seed=42).run([bell_qc], shots=1000).result()[0].data.meas.get_counts()
bell_counts

# %% role=observe
bell_total = sum(bell_counts.values())
for outcome in sorted(bell_counts):
    fraction = bell_counts[outcome] / bell_total
    print(f"{outcome}: {bell_counts[outcome]} ({fraction:.1%})")
mismatched = bell_counts.get("01", 0) + bell_counts.get("10", 0)
print(f"mismatched (01 or 10): {mismatched} of {bell_total}")

# %% [markdown] role=explain
# Only `00` and `11` ever appear. `01` and `10` are effectively gone. Physicists write
# this state as `|00⟩ + |11⟩` (up to a normalizing factor) — read that as shorthand for
# "the only two labels this state assigns any probability to." The `cx` gate ties qubit
# 1's outcome to qubit 0's: because qubit 0 was in a `h`-created superposition when the
# `cx` fired, the gate built a state where the two qubits' measured values must match.
# This is a statement about what the gate did to the state at circuit-construction time
# — a mathematical fact you can check by looking at the circuit, not a claim that
# measuring one qubit reaches over and changes the other. Nothing here needs anything to
# travel between the qubits; a Bell state, built once, is already correlated before
# either qubit is measured.
#
# This two-qubit state has a name: a **Bell state** (there are four; this is the one
# usually called `|Φ+⟩`). It is the standard example of **entanglement** — a correlation
# between qubits that a `cx` (or a gate like it) builds directly into the state, stronger
# than anything two qubits prepared independently could produce.

# %% role=checkpoint
assert mismatched / bell_total < 0.05, (
    f"a Bell state should almost never produce 01 or 10, got {mismatched}/{bell_total}"
)

# %% [markdown] role=concept
# ## The bitstring order
# Every count key you have seen so far — `01`, `10`, and so on — follows one rule:
# **qubit 0 is the rightmost character.** Qubit 1 is next to its left, qubit 2 to its
# left again, and so on for larger circuits. A key like `"01"` reads right to left:
# rightmost `1` is qubit 0, leftmost `0` is qubit 1.
#
# This is easy to misread the first time, because it runs opposite to how most people
# would naturally write "qubit 0, then qubit 1" left to right. Every week from here on
# assumes you can read a Qiskit bitstring correctly, so the next experiment checks it
# directly rather than just stating it.

# %% [markdown] role=predict
# ### Experiment 3: flip only qubit 0
# Build a two-qubit circuit with `x(0)` and nothing else — qubit 0 flips to `1`, qubit 1
# stays at `0`. Before running: using the rule above, which single bitstring do you
# expect to see on every shot — `"01"` or `"10"`?

# %% role=run
flip_qc = QuantumCircuit(2)
flip_qc.x(0)
flip_qc.measure_all()

flip_counts = StatevectorSampler(seed=42).run([flip_qc], shots=20).result()[0].data.meas.get_counts()
flip_counts

# %% role=observe
print(f"every one of {sum(flip_counts.values())} shots read: {list(flip_counts)[0]}")

# %% [markdown] role=explain
# Every shot reads `"01"`, not `"10"`. Qubit 0 was flipped to `1` and qubit 1 stayed at
# `0`; qubit 0 sits in the rightmost position, so the string reads leftmost-to-rightmost
# as qubit 1 then qubit 0: `0` then `1`, giving `"01"`. If you guessed `"10"`, you read
# the string left to right as qubit 0 then qubit 1 — the opposite of Qiskit's rule, and
# an easy mistake to make exactly once before it sticks.

# %% role=checkpoint
assert set(flip_counts.keys()) == {"01"}, (
    f"flipping only qubit 0 should always read as '01', got {sorted(flip_counts)}"
)

# %% [markdown] role=modify
# ### Modify: break the Bell state three ways
# Each change below touches exactly one piece of the Bell circuit. Predict the outcome
# before reading its explanation.

# %% role=modify
# Modify 1: swap the CX's control and target — cx(1, 0) instead of cx(0, 1).
# Predict first, specifically: which two of the four outcomes do you expect to see, and
# roughly what fraction of the 1000 shots on each — the same split as the Bell state, or
# something else?
swapped_qc = QuantumCircuit(2)
swapped_qc.h(0)
swapped_qc.cx(1, 0)
swapped_qc.measure_all()

swapped_counts = StatevectorSampler(seed=42).run([swapped_qc], shots=1000).result()[0].data.meas.get_counts()
swapped_counts

# %% [markdown] role=explain
# `00` and `01` appear — no `11` at all, and no entanglement. `h(0)` puts qubit 0 in
# superposition and leaves qubit 1 fixed at `0`. `cx(1, 0)` makes qubit 1 the *control*,
# but qubit 1 is deterministically `0`, so the gate's condition is never met and it never
# fires. Swapping the two arguments swapped which qubit has to be in superposition for
# anything to happen — and that qubit, in this circuit, is qubit 0, sitting in the
# target slot instead of the control slot. `cx(control, target)` is not cosmetic
# ordering; it names which qubit the correlation is built from.

# %% role=modify
# Modify 2: flip qubit 1 before entangling — x(1), then h(0), then cx(0, 1).
# Predict first: which two outcomes do you expect now, and which two disappear?
preflip_qc = QuantumCircuit(2)
preflip_qc.x(1)
preflip_qc.h(0)
preflip_qc.cx(0, 1)
preflip_qc.measure_all()

preflip_counts = StatevectorSampler(seed=42).run([preflip_qc], shots=1000).result()[0].data.meas.get_counts()
preflip_counts

# %% [markdown] role=explain
# `01` and `10` appear — never `00`, never `11`. Flipping qubit 1 to `1` before the `cx`
# changes which pair of outcomes the gate links: the two qubits now always *disagree*
# instead of always agreeing. This is an anti-correlated pair generator — the two bits
# are exactly as tightly linked as the original Bell state, just linked to opposite
# values instead of matching ones.

# %% role=modify
# Modify 3: rebuild the Bell circuit, but measure only qubit 0.
# Predict first, with a number: what fraction of the 1000 shots do you expect to read
# `0` on qubit 0 alone, and does that fraction show any sign of the correlation with
# qubit 1?
marginal_qc = QuantumCircuit(2, 1)
marginal_qc.h(0)
marginal_qc.cx(0, 1)
marginal_qc.measure(0, 0)

marginal_counts = StatevectorSampler(seed=42).run([marginal_qc], shots=1000).result()[0].data.c.get_counts()
marginal_counts

# %% [markdown] role=explain
# A plain 50/50 split between `"0"` and `"1"` — indistinguishable from a single fair
# coin, and identical to what qubit 0 alone looked like back in week 01. Measuring only
# one qubit throws away the other half of every pair, and the correlation lives entirely
# in how the *two* results relate to each other — it leaves no trace in either qubit's
# outcomes considered alone. This is why the deliverable below hands back matched pairs,
# never two separate lists.

# %% role=figure
from qiskit.visualization import plot_histogram

print(bell_qc.draw("text"))
print(bell_counts)
circuit_figure = bell_qc.draw("mpl")
histogram_figure = plot_histogram(bell_counts, title="Bell state, 1000 shots")
display(circuit_figure)
display(histogram_figure)

# %% [markdown] role=note
# ## Deliverable: a correlated-bit generator
# A real backend queues jobs — submitting one circuit with `n` shots and unpacking the
# results afterward is far cheaper than submitting `n` separate one-shot jobs. The
# function below asks a Bell circuit for `n` shots in a single `sampler.run` call, then
# turns the sampler's per-shot bitstrings into `n` correlated `(qubit_0, qubit_1)` pairs,
# using the same rightmost-is-qubit-0 rule verified above.

# %% role=run
def _pair_from_bitstring(bitstring):
    """Split a 2-qubit bitstring into (qubit_0, qubit_1) using Qiskit's bit order:
    qubit 0 is the rightmost character, qubit 1 the one to its left."""
    return int(bitstring[-1]), int(bitstring[-2])


def correlated_bit_pairs(n, seed=0):
    """Return n correlated (qubit_0, qubit_1) bit pairs from a single sampler run."""
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    qc.measure_all()
    result = StatevectorSampler(seed=seed).run([qc], shots=n).result()
    bitstrings = result[0].data.meas.get_bitstrings()
    return [_pair_from_bitstring(bitstring) for bitstring in bitstrings]


sample_pairs = correlated_bit_pairs(20, seed=7)
sample_pairs

# %% role=observe
sample_matches = sum(1 for q0, q1 in sample_pairs if q0 == q1)
print(f"{sample_matches} of {len(sample_pairs)} sample pairs agree")
for pair in sample_pairs[:8]:
    print(pair)

# %% [markdown] role=explain
# One call to `sampler.run` produced all `n` shots from a single circuit submission;
# `get_bitstrings()` then hands back one bitstring per shot, in the order the sampler
# produced them, and `_pair_from_bitstring` splits each one the same way Experiment 3
# did. That is one job, not `n` jobs — the difference that matters once "job" means a
# queued submission to a real backend instead of a local, instant computation.

# %% role=checkpoint
parity_pairs = correlated_bit_pairs(3000, seed=123)
parity_mismatched = sum(1 for q0, q1 in parity_pairs if q0 != q1)
assert parity_mismatched / len(parity_pairs) < 0.05, (
    f"correlated pairs should mismatch on well under 5% of shots, "
    f"got {parity_mismatched}/{len(parity_pairs)}"
)

# %% role=checkpoint
assert _pair_from_bitstring("01") == (1, 0)
assert _pair_from_bitstring("10") == (0, 1)
assert _pair_from_bitstring("11") == (1, 1)
assert _pair_from_bitstring("00") == (0, 0)

# %% [markdown] role=summary
# ## What you built
# Two independent coins next to a Bell state, three ways of breaking the Bell circuit
# (wrong `cx` argument order, a pre-entangling flip, measuring only one qubit), a
# checked reading of Qiskit's bitstring order, and a `correlated_bit_pairs` function that
# gets `n` correlated pairs from one sampler run.
#
# One remaining question to carry forward: Modify 2 built an anti-correlated pair by
# flipping a qubit *before* the `cx`. The challenge asks you to reach the same
# anti-correlation a different way — starting from the finished Bell state and flipping
# a qubit *after*. Are those two circuits actually the same underneath, or only the same
# in what you measure? Week 03 gives you the tool (`Statevector`) to check for yourself.
