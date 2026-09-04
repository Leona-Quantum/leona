# ---
# title: Week 01 challenge — Biased coins and three coins
# kind: challenge
# summary: Build a biased coin with RY(theta) and a three-qubit "three coins" circuit.
# objectives:
#   - Use RY(theta) to dial a qubit's measurement probability away from a fair 50/50 split
#   - Predict a probability from an angle before running the circuit
#   - Extend one qubit to three independent qubits sampled at once
# prerequisites:
#   - lab.ipynb completed
# duration_minutes: 15
# ---

# %% [markdown] role=objective
# ## What you will build
# `lab.ipynb` gave you a fair coin with `H` and a deterministic flip with `X`. This
# challenge builds something in between: a *biased* coin using the `RY(theta)` gate, plus a
# three-qubit circuit that flips three independent coins in a single sample.

# %% [markdown] role=concept
# ## `RY(theta)`: a dial between `X` and doing nothing
# `H` gives you exactly one mixture: 50/50. `RY(theta, qubit)` gives you a whole dial —
# `theta` is an angle you choose, and it controls how far the qubit leans toward `1`.
# Applied to a fresh qubit, the fact you need for this challenge is:
#
# `P(measuring 1) = sin(theta / 2) ** 2`
#
# At `theta = 0` nothing happens (`P(1) = 0`, same as never touching the qubit). At
# `theta = pi` you get the same deterministic flip as `X` (`P(1) = 1`). Every angle in
# between gives you a coin biased somewhere in between — this is how Qiskit represents
# "partway between 0 and 1" without any new gates beyond the one you already know how to
# apply.

# %% [markdown] role=predict
# Using the fact above, `theta = math.pi / 3`: work out `P(1)` by hand before you write any
# code. Write your predicted probability as a number between 0 and 1.

# %% [markdown] role=exercise
# ## Task 1: the biased coin
# Build a one-qubit circuit named `biased_qc`: apply `ry(theta, 0)` with
# `theta = math.pi / 3`, then call `measure_all()`. Sample it with
# `StatevectorSampler(seed=55)` at `shots=2000`, store the result in `counts`, and compute
# the measured probability of `1` as `p1_measured = counts.get("1", 0) / 2000`.

# %% role=solution stub="theta = None\nbiased_qc = None  # ry(theta, 0), then measure_all()\ncounts = None\np1_measured = None\n"
import math

from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler

theta = math.pi / 3
biased_qc = QuantumCircuit(1)
biased_qc.ry(theta, 0)
biased_qc.measure_all()

counts = StatevectorSampler(seed=55).run([biased_qc], shots=2000).result()[0].data.meas.get_counts()
p1_measured = counts.get("1", 0) / 2000
p1_measured

# %% [markdown] role=hint
# `qc.ry(theta, 0)` works exactly like `qc.h(0)` in how you call it — the difference is the
# extra `theta` argument, which is what lets you dial the mixture instead of always landing
# on a fair 50/50.

# %% role=checkpoint
if p1_measured is not None:
    # A band, not the exact 0.25 the formula predicts: 2000 samples of a real coin flip.
    assert 0.15 < p1_measured < 0.35, f"expected P(1) near 0.25 for theta=pi/3, got {p1_measured}"

# %% [markdown] role=explain
# `sin(pi/6) ** 2 = 0.25` exactly, and `p1_measured` should land close to that — within the
# same kind of sampling noise you saw with `H` in `lab.ipynb`, just centered on 0.25 instead
# of 0.5. If your hand prediction was off, recompute `sin(theta / 2) ** 2` for
# `theta = math.pi / 3` and compare.

# %% [markdown] role=exercise
# ## Task 2: three coins
# Build a three-qubit circuit named `three_coins_qc`: apply `h` to qubits 0, 1, and 2 (one
# `H` per qubit — no gate should touch more than one qubit), then call `measure_all()`.
# Sample it with `StatevectorSampler(seed=77)` at `shots=1000` and store the result in
# `three_coins_counts`.

# %% role=solution stub="three_coins_qc = None  # h on qubits 0, 1, 2, then measure_all()\nthree_coins_counts = None\n"
three_coins_qc = QuantumCircuit(3)
three_coins_qc.h(0)
three_coins_qc.h(1)
three_coins_qc.h(2)
three_coins_qc.measure_all()

three_coins_counts = (
    StatevectorSampler(seed=77).run([three_coins_qc], shots=1000).result()[0].data.meas.get_counts()
)
three_coins_counts

# %% [markdown] role=hint
# Three separate `.h(i)` calls for `i` in `0, 1, 2` — or `for q in range(3): qc.h(q)` — then
# one `measure_all()` at the end, the same shape as the single-qubit circuits in
# `lab.ipynb`.

# %% role=checkpoint
if three_coins_counts is not None:
    total = sum(three_coins_counts.values())
    assert total == 1000, f"expected 1000 total shots, got {total}"
    assert all(len(outcome) == 3 for outcome in three_coins_counts), (
        f"expected 3-character outcomes, saw {sorted(three_coins_counts)}"
    )
    # A band on how many of the 8 possible outcomes show up, not an exact count: with
    # three independent fair coins and 1000 shots, most of the 8 combinations should
    # appear at least once, but exactly 8 is not guaranteed.
    assert len(three_coins_counts) >= 5, (
        f"expected most of the 8 three-coin outcomes to appear, saw {sorted(three_coins_counts)}"
    )

# %% [markdown] role=summary
# ## What you built
# A biased coin whose probability you predicted from an angle before running anything, and
# a three-qubit circuit that samples three independent coins in one shot. Nothing here
# links the three qubits together — Week 02 introduces the gate that does, and shows how
# its counts look different from this challenge's. Compare your answers with the reference
# solution notebook and its self-evaluation checklist.
