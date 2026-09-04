# ---
# title: Week 06 — Grover search
# kind: lab
# summary: Build a phase oracle and a diffusion operator by hand, run one Grover iteration, and get a marked two-qubit state back with near-certainty.
# objectives:
#   - Build a phase oracle that flips the sign of one marked state without changing any measurement probability
#   - Build the two-qubit diffusion operator by hand and explain what it does in one sentence
#   - Run one full Grover iteration and predict, then confirm, the exact success probability
#   - Compare a hand-built Grover circuit against qiskit.circuit.library.grover_operator
#   - Change which state the oracle marks and confirm the same recipe still works
# prerequisites:
#   - Week 03 (phase and Statevector) and Week 05 (StatevectorSampler) completed
# duration_minutes: 60
# ---

# %% [markdown] role=objective
# ## What you will build
# Four possible two-qubit states — `00`, `01`, `10`, `11` — and a black-box oracle that
# recognizes exactly one of them, say `11`, without telling you which one in advance. A
# classical search checks states one at a time: up to three checks in the worst case,
# 2.5 checks on average. By the end of this session you will have a two-qubit circuit
# that finds the marked state with a **single query** to the oracle, and you will have
# built every piece of it — the oracle and the diffusion operator — yourself.

# %% [markdown] role=concept
# ## The search problem
# Picture four closed boxes, numbered `00` through `11`, and a prize in exactly one of
# them. You cannot look inside a box directly; you can only ask an oracle "is this the
# one?" A classical strategy opens boxes one at a time: if the first three come back
# empty, the fourth is guaranteed to hold the prize, so the worst case is 3 queries and
# the average is 2.5. There is no cleverer classical strategy — with no structure to
# exploit, one query per box is the best you can do.
#
# Grover's algorithm answers a different kind of query. Instead of asking "is this the
# one?" and getting a yes/no answer, it asks all four boxes the question **at once**, in
# superposition, and gets back a state whose *sign* (not its measured value) depends on
# the answer. That single query is not enough to read out the answer directly — you saw
# in Week 03 that a global sign on a state does not change what you measure — but it is
# enough to set up interference that concentrates all of the probability onto the marked
# box. That is the whole trick, and it is what this notebook builds step by step.

# %% role=setup
import qiskit

print(qiskit.__version__)

from qiskit import QuantumCircuit
from qiskit.circuit.library import grover_operator
from qiskit.primitives import StatevectorSampler
from qiskit.quantum_info import Statevector
from qiskit.visualization import plot_histogram
import numpy as np

# %% [markdown] role=concept
# ## What an oracle means here
# An oracle, in this context, is a small circuit that "knows" which state is marked and
# encodes that knowledge as a sign flip on exactly that state — a **phase oracle**. It
# never writes an answer to a separate output qubit and it never measures anything.
#
# Phase oracles are usually built from a more familiar kind of oracle: a **bit-flip**
# oracle that flips a separate output qubit whenever the input matches the marked item.
# If you prepare that output qubit in the state `(|0> - |1>) / sqrt(2)` first, the flip
# turns into a global minus sign on the matching input, and the output qubit itself ends
# up unchanged. Turning a bit flip on an ancilla into a phase flip on the input this way
# is called **phase kickback** — the effect of the flip "kicks back" onto the register
# you actually care about.
#
# For two qubits marking one exact computational state, that whole ancilla dance
# collapses to a single gate: a controlled-Z gate multiplies `|11>` by `-1` and leaves
# every other computational basis state alone, with no separate output qubit needed at
# all. That is the oracle you will build next.

# %% [markdown] role=concept
# ## The oracle for `11`
# `qc.cz(0, 1)` applies a controlled-Z between qubits 0 and 1. On the four computational
# basis states it does exactly one thing: multiply the `11` state by `-1`. `00`, `01`,
# and `10` are untouched. That is the entire oracle for this lab.

# %% [markdown] role=predict
# Before you run anything: start from the equal superposition of all four states (an `h`
# on each qubit), then apply the `cz(0, 1)` oracle. Every state currently has probability
# 25%. Write a specific prediction — a number, not "it changes" — for the probability of
# measuring `11` immediately after the oracle runs, and for the other three outcomes.

# %% role=run
qc = QuantumCircuit(2)
qc.h(0)
qc.h(1)
sv_before = Statevector(qc)

qc.cz(0, 1)
sv_after = Statevector(qc)

print("amplitudes before:", np.round(sv_before.data, 3))
print("amplitudes after: ", np.round(sv_after.data, 3))
print("probabilities before:", sv_before.probabilities_dict())
print("probabilities after: ", sv_after.probabilities_dict())

# %% [markdown] role=observe
# The two probability dictionaries are identical: every outcome is still at 25%. The
# amplitudes tell a different story — the last entry, the amplitude of `11`, changed
# from `0.5` to `-0.5`. Everything else stayed exactly the same.

# %% [markdown] role=explain
# This is the surprising part, and it is not a bug: probability comes from the squared
# *magnitude* of an amplitude, and `(-0.5)**2` equals `(0.5)**2`. Flipping a sign is
# invisible to a measurement taken right now. The oracle did real work — it marked `11`
# by phase kickback in miniature, using the sign itself as the flag — but that work only
# pays off once something else reacts to the sign. That something else is the diffusion
# operator, built next.

# %% role=modify
# Check programmatically, not just by eye, that only the |11> amplitude moved.
unchanged = np.allclose(sv_before.data[:3], sv_after.data[:3])
flipped = np.isclose(sv_after.data[3], -sv_before.data[3])
print("first three amplitudes stayed identical:", unchanged)
print("the |11> amplitude flipped sign:        ", flipped)

# %% role=checkpoint
outcomes = ["00", "01", "10", "11"]
before_probs = np.array([sv_before.probabilities_dict().get(k, 0.0) for k in outcomes])
after_probs = np.array([sv_after.probabilities_dict().get(k, 0.0) for k in outcomes])
assert np.allclose(before_probs, after_probs, atol=1e-9), (
    f"a phase oracle must not move any measurement probability: before={before_probs}, "
    f"after={after_probs}"
)
assert unchanged and flipped, "expected only the |11> amplitude to change sign"

# %% [markdown] role=concept
# ## The diffusion operator
# In one sentence: the diffusion operator **reflects every amplitude about their
# average**. An amplitude that starts below the average — like the one you just flipped
# negative — ends up further from the average than it started, and in the right
# direction to grow.
#
# For two qubits, you build it from five gates, applied to both qubits: `H`, `X`, a
# controlled-Z, `X`, `H`.

# %% role=run
def diffusion_operator():
    """H, X, CZ, X, H on both qubits: reflect every amplitude about their average."""
    diff = QuantumCircuit(2, name="diffusion")
    diff.h([0, 1])
    diff.x([0, 1])
    diff.cz(0, 1)
    diff.x([0, 1])
    diff.h([0, 1])
    return diff


print(diffusion_operator().draw("text"))

# %% [markdown] role=explain
# Here is the "reflect about the average" sentence made concrete, using the exact
# amplitudes from a few cells ago: `[0.5, 0.5, 0.5, -0.5]`. Their average is `0.25`.
# Reflecting an amplitude `a` about a mean `m` means computing `2*m - a`. For the marked
# amplitude, that is `2*0.25 - (-0.5) = 1.0`. For each of the other three, it is
# `2*0.25 - 0.5 = 0.0`. One reflection has pushed the marked amplitude from `-0.5` all
# the way to `1.0`, and squeezed the rest down toward `0`. (Run the diffusion circuit
# and you will see this pattern in the amplitudes up to an overall sign, which does not
# affect any probability — the next run cell prints it.)

# %% [markdown] role=predict
# Put the oracle and the diffusion operator together — superposition, then `cz(0, 1)`,
# then diffusion — and use the reflection arithmetic above to predict the probability of
# measuring `11` after this **one** combined step. Write down an exact percentage, not a
# direction.

# %% role=run
oracle = QuantumCircuit(2, name="oracle_11")
oracle.cz(0, 1)

grover_iter1 = QuantumCircuit(2)
grover_iter1.h([0, 1])
grover_iter1.compose(oracle, inplace=True)
grover_iter1.compose(diffusion_operator(), inplace=True)

sv_iter1 = Statevector(grover_iter1)
print("exact amplitudes after 1 iteration:   ", np.round(sv_iter1.data, 3))
print("exact probabilities after 1 iteration:", sv_iter1.probabilities_dict())

measured = grover_iter1.copy()
measured.measure_all()

shots = 4000
sampler = StatevectorSampler(seed=42)
counts = sampler.run([measured], shots=shots).result()[0].data.meas.get_counts()
print(f"counts out of {shots} shots:", counts)

# %% role=checkpoint
assert counts.get("11", 0) > 0.95 * shots, (
    f"one full Grover iteration should put over 95% of {shots} shots on '11', got {counts}"
)
assert sv_iter1.probabilities_dict().get("11", 0.0) > 0.999, (
    f"the exact probability of '11' should be essentially 1.0, got {sv_iter1.probabilities_dict()}"
)

# %% [markdown] role=observe
# Essentially every one of the `shots` samples landed on `11`. The exact statevector
# probability is not just higher than the others — it rounds to `1.0`. One query to the
# oracle, one diffusion step, and the answer comes back with certainty.

# %% [markdown] role=explain
# This whole pattern — mark with a phase oracle, then amplify with diffusion, repeated
# as many times as the problem needs — is called **amplitude amplification**, and
# Grover's algorithm is its best-known instance. For four items with exactly one marked,
# the reflection arithmetic above happens to land the marked amplitude at exactly `1.0`
# after a single iteration, so a single iteration is also the *most* you should run:
# apply the oracle and diffusion a second time and you would be reflecting an
# already-large amplitude back down, not up. The challenge notebook has you measure
# that over-rotation directly.

# %% [markdown] role=concept
# ## The library shortcut
# You built the oracle and the diffusion operator separately and composed them by hand.
# Qiskit's circuit library packages that same combination — phase oracle, then
# diffusion — as one reusable operator: `grover_operator(oracle)`. It takes only the
# oracle circuit and builds the rest.

# %% role=run
grover_op = grover_operator(oracle)

grover_lib = QuantumCircuit(2)
grover_lib.h([0, 1])
grover_lib.compose(grover_op, inplace=True)
sv_lib = Statevector(grover_lib)

print("hand-built probabilities:", sv_iter1.probabilities_dict())
print("library probabilities:  ", sv_lib.probabilities_dict())

# %% role=checkpoint
hand_probs = np.array([sv_iter1.probabilities_dict().get(k, 0.0) for k in outcomes])
lib_probs = np.array([sv_lib.probabilities_dict().get(k, 0.0) for k in outcomes])
assert np.allclose(hand_probs, lib_probs, atol=1e-6), (
    f"grover_operator should reproduce the same probabilities: hand-built={hand_probs}, "
    f"library={lib_probs}"
)

# %% [markdown] role=note
# ## Before you mark a different state
# `11` was a convenient first target: it reads the same whether qubit 0 or qubit 1 is
# "first." The next state you will mark, `01`, is not symmetric. Remember Qiskit's
# convention from Week 02: qubit 0 is the **rightmost** character of a bitstring, so in
# `01`, qubit 0 is `1` and qubit 1 is `0`.

# %% [markdown] role=predict
# Nothing in the reflection arithmetic above depended on `11` specifically — only on one
# amplitude starting below the average and the rest starting above it. Predict: if the
# oracle instead marks `01`, does one Grover iteration still find it with (essentially)
# 100% probability? Write down yes or no, and one sentence for why.

# %% role=modify
def oracle_for(bitstring):
    """A phase oracle marking one two-qubit computational basis state, e.g. '01'.
    Qiskit reads the rightmost character as qubit 0, so bitstring[-1] is qubit 0
    and bitstring[-2] is qubit 1. Sandwiching the CZ in X gates on the qubits whose
    bit is 0 makes it fire on that state instead of on |11>."""
    marked = QuantumCircuit(2, name=f"oracle_{bitstring}")
    q0, q1 = int(bitstring[-1]), int(bitstring[-2])
    if q0 == 0:
        marked.x(0)
    if q1 == 0:
        marked.x(1)
    marked.cz(0, 1)
    if q0 == 0:
        marked.x(0)
    if q1 == 0:
        marked.x(1)
    return marked


oracle_01 = oracle_for("01")

grover_01 = QuantumCircuit(2)
grover_01.h([0, 1])
grover_01.compose(oracle_01, inplace=True)
grover_01.compose(diffusion_operator(), inplace=True)

sv_01 = Statevector(grover_01)
print("exact probabilities, marking '01':", sv_01.probabilities_dict())

measured_01 = grover_01.copy()
measured_01.measure_all()
counts_01 = (
    StatevectorSampler(seed=7).run([measured_01], shots=shots).result()[0].data.meas.get_counts()
)
print(f"counts out of {shots} shots:", counts_01)

# %% [markdown] role=observe
# Same shape of result as before, just moved to a different outcome: essentially every
# shot lands on `01` instead of `11`.

# %% [markdown] role=explain
# The recipe never looked at which state was marked, only at the fact that exactly one
# of four amplitudes started below the group's average. Sandwiching the CZ in `X` gates
# just relabels which computational state plays that role before the CZ fires, then
# relabels it back — the reflection arithmetic that follows is identical either way.
# That is why one iteration amplifies any single marked state out of four to (near)
# certainty, not just `11`.

# %% role=checkpoint
assert counts_01.get("01", 0) > 0.95 * shots, (
    f"marking '01' should behave exactly like marking '11': over 95% of {shots} shots on "
    f"'01', got {counts_01}"
)

# %% role=figure
print("circuit that marks '01' and amplifies it in one iteration:")
print(grover_01.draw("text"))
grover_01.draw("mpl")

# %% role=figure
print(f"counts out of {shots} shots:", counts_01)
plot_histogram(counts_01)

# %% [markdown] role=summary
# ## What you built
# A two-qubit Grover circuit, entirely from gates you assembled yourself: a phase oracle
# built as a single controlled-Z (or a CZ sandwiched in X gates for a different target),
# and a diffusion operator built as H, X, CZ, X, H. One query, one iteration, and the
# marked state comes back with essentially 100% probability — confirmed against an exact
# statevector calculation, against 4000 sampled shots, and against Qiskit's own
# `grover_operator`. You also confirmed the recipe does not care which of the four
# states is marked.
#
# One remaining question worth sitting with: you saw that a *second* iteration would
# reflect an already-large amplitude back down rather than further up. Exactly how far
# down, and does three qubits behave the same way? The challenge notebook measures both.
