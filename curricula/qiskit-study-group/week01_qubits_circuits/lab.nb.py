# ---
# title: Week 01 — Qubits and circuits
# kind: lab
# summary: Build one-qubit circuits with X and H, sample them, and see measurement and shot count shape the results.
# objectives:
#   - Explain what a qubit is and what measurement does to it, without any physics background
#   - Build one-qubit circuits with X and H and predict what measuring them will show
#   - Explain why H creates a fair coin and why H, H cancels back to certainty
#   - Explain why sampled counts fluctuate between runs even when the circuit never changes
#   - Package a fair-coin circuit as a reusable function
# prerequisites:
#   - Week 00 setup completed (lab.ipynb run, both checkpoints passing)
# duration_minutes: 60
# ---

# %% [markdown] role=objective
# ## What you will build
# A quantum coin: a one-qubit circuit you can flip and sample, plus a small function that
# reports how often it lands on `1`. Along the way you will flip a qubit deterministically
# with `X`, turn it into a genuine coin flip with `H`, watch two `H` gates in a row cancel
# back to certainty, and see why running the exact same circuit twice can still give you
# slightly different counts.

# %% role=setup
import qiskit

print(qiskit.__version__)

from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler

# %% [markdown] role=concept
# ## What is a qubit?
# A classical bit is always exactly 0 or 1, full stop. A qubit is a piece of quantum
# hardware you can put into a state that is not yet either — think of a coin the instant
# after you flip it, still spinning in the air. While it spins, "heads" and "tails" are
# both still live possibilities. The moment it lands, one of them becomes the answer. A
# qubit works the same way: code can prepare a "spinning" qubit, and *measuring* it is
# what makes it land on one definite classical bit, 0 or 1. Before measurement there is no
# hidden answer waiting to be read off — the landing is what produces the answer.

# %% [markdown] role=concept
# ## Notation: `|0>` and `|1>`
# Quantum-computing writing uses `|0⟩` and `|1⟩` as labels for the two things a qubit's
# measurement can come out as — nothing more mysterious than that. `|0⟩` is the label for
# "measures to 0," `|1⟩` is the label for "measures to 1." A fresh qubit in Qiskit starts
# in `|0⟩`. The vertical bar and angle bracket together are called a "ket," but for this
# course you can just read `|0⟩` as "the 0 label" and `|1⟩` as "the 1 label."

# %% [markdown] role=concept
# ## Sampling: shots and counts
# `QuantumCircuit` only describes a circuit; it does not run anything. `StatevectorSampler`
# is what actually runs it — once per "shot," which is one full build-and-measure. Ask for
# `shots=1000` and you get 1000 independent measurements back, tallied into a dictionary
# called `counts` (for example `{"0": 511, "1": 489}`). Every circuit below is sampled with
# `measure_all()`, which adds a classical register named `meas` and measures every qubit
# into it — that is why the counts always come from `result[0].data.meas.get_counts()`.

# %% [markdown] role=predict
# ### Experiment 1: `X` then measure
# A fresh qubit starts at `|0⟩`. The `X` gate is quantum computing's version of NOT — it
# flips a qubit. Before running anything: if you apply `X` to a fresh qubit and then
# measure it 1000 times, what fraction of the 1000 results do you expect to read `1`?
# Write a specific number.

# %% role=run
qc_x = QuantumCircuit(1)
qc_x.x(0)
qc_x.measure_all()

counts_x = StatevectorSampler(seed=101).run([qc_x], shots=1000).result()[0].data.meas.get_counts()
counts_x

# %% [markdown] role=observe
# Every one of the 1000 shots reads `1`. There is no spread at all — check the count above
# against 1000.

# %% [markdown] role=explain
# `X` does not create any mixture; it deterministically turns `|0⟩` into `|1⟩`. Measuring a
# qubit that is fully in `|1⟩` always reads `1`, the same way a fully-`|0⟩` qubit always
# reads `0`. Nothing here is random — the randomness later in this lab comes entirely from
# `H`, never from measurement by itself.

# %% role=modify
# Modify: apply X twice in a row before measuring, then predict the result before running.
qc_xx = QuantumCircuit(1)
qc_xx.x(0)
qc_xx.x(0)
qc_xx.measure_all()

counts_xx = StatevectorSampler(seed=102).run([qc_xx], shots=1000).result()[0].data.meas.get_counts()
counts_xx

# %% [markdown] role=predict
# ### Experiment 2: `H` then measure — the fair coin
# The `H` (Hadamard) gate is the one that actually creates a mixture: applied to a qubit in
# a single definite state, it produces an equal blend of both. Before running: if you apply
# `H` to a fresh qubit and measure it 1000 times, roughly what fraction do you expect to
# read `1`? Write a specific number, not just "about half."

# %% role=run
qc_h = QuantumCircuit(1)
qc_h.h(0)
qc_h.measure_all()

counts_h = StatevectorSampler(seed=201).run([qc_h], shots=1000).result()[0].data.meas.get_counts()
counts_h

# %% [markdown] role=observe
# Roughly half of the 1000 shots read `1` and half read `0` — close to your prediction, but
# almost certainly not exactly 500/500.

# %% [markdown] role=explain
# `H` puts the qubit into an equal mixture of the `|0⟩` and `|1⟩` labels, so each individual
# measurement really is a coin flip with probability 1/2 for each outcome. Because it is a
# coin flip and not a fixed rule, 1000 individual flips will not land exactly 500/500 any
# more reliably than 1000 real coin flips would — that is sampling noise, not a bug. The
# "shots and fluctuation" section later in this lab measures it directly.

# %% role=checkpoint
assert 400 < counts_h.get("1", 0) < 600, f"expected roughly a fair coin, got {counts_h}"

# %% role=figure
# The text drawing and the image below describe the same circuit — keep both, since the
# text form works even where the image never renders.
print(qc_h.draw("text"))
qc_h.draw("mpl")

# %% role=figure
from qiskit.visualization import plot_histogram

print(counts_h)
plot_histogram(counts_h)

# %% role=modify
# Modify: sample the same H circuit at 100 shots instead of 1000. Predict first — will the
# count of 1s look closer to or farther from a perfect 50/50 split than it did at 1000?
counts_h_100 = StatevectorSampler(seed=202).run([qc_h], shots=100).result()[0].data.meas.get_counts()
counts_h_100

# %% [markdown] role=predict
# ### Experiment 3: `H`, `H` then measure — a surprise
# You just watched `H` turn a definite qubit into a coin flip. Now apply `H` twice in a row
# to a fresh qubit, then measure. Before running: write a specific prediction — out of 1000
# shots, roughly how many do you expect to read `1`, and how many to read `0`?

# %% role=run
qc_hh = QuantumCircuit(1)
qc_hh.h(0)
qc_hh.h(0)
qc_hh.measure_all()

counts_hh = StatevectorSampler(seed=301).run([qc_hh], shots=1000).result()[0].data.meas.get_counts()
counts_hh

# %% [markdown] role=observe
# All 1000 shots read `0`. No coin-flip spread at all — every single shot lands the same
# way, exactly as if you had never touched the qubit.

# %% [markdown] role=explain
# This is the surprise: two `H` gates in a row cancel out completely. `H` is reversible,
# and applying the same reversible operation twice undoes it — the way flipping a light
# switch on and then off leaves the room exactly as it started. `H` followed by `H` returns
# the qubit to exactly where it began (`|0⟩`), so measuring it is fully deterministic again
# — no coin flip survives. This is also why "the qubit secretly already had a 0 or 1 the
# whole time" cannot be the right story: if that were true, doing `H` twice would still
# look random about half the time, and it does not.

# %% role=checkpoint
assert counts_hh.get("0", 0) > 950, f"expected H, H to cancel back to a deterministic 0, got {counts_hh}"

# %% role=modify
# Modify: since H, H cancels to "do nothing," predict what X, H, H should do to a fresh
# qubit before running this.
qc_xhh = QuantumCircuit(1)
qc_xhh.x(0)
qc_xhh.h(0)
qc_xhh.h(0)
qc_xhh.measure_all()

counts_xhh = StatevectorSampler(seed=302).run([qc_xhh], shots=1000).result()[0].data.meas.get_counts()
counts_xhh

# %% [markdown] role=predict
# ### Experiment 4: `X` then `H` then measure
# Start from `|1⟩` this time (apply `X` first), then apply `H`, then measure. Before
# running: write your prediction for the fraction of 1000 shots that read `1`.

# %% role=run
qc_xh = QuantumCircuit(1)
qc_xh.x(0)
qc_xh.h(0)
qc_xh.measure_all()

counts_xh = StatevectorSampler(seed=401).run([qc_xh], shots=1000).result()[0].data.meas.get_counts()
counts_xh

# %% [markdown] role=observe
# Roughly half and half again — close to what plain `H` on `|0⟩` gave you in Experiment 2.

# %% [markdown] role=explain
# `H` creates an equal mixture no matter which definite state it starts from — from `|0⟩`
# or from `|1⟩`, the result is a 50/50 coin. The two mixtures are not identical underneath
# (later weeks show a way to tell them apart without measuring), but a single round of
# counts alone cannot distinguish them — one reason quantum programs sometimes need more
# than one way of looking at the same circuit.

# %% role=modify
# Modify: swap the order to H then X instead of X then H. Predict first — does swapping the
# order of these two particular gates change anything here?
qc_hx = QuantumCircuit(1)
qc_hx.h(0)
qc_hx.x(0)
qc_hx.measure_all()

counts_hx = StatevectorSampler(seed=402).run([qc_hx], shots=1000).result()[0].data.meas.get_counts()
counts_hx

# %% [markdown] role=predict
# ### Shots and fluctuation
# Run the exact same fair-coin circuit (`qc_h`) three separate times, each with 1000 shots
# but a different sampler seed. Before running: will the three counts of `1` come out
# identical, or different? If different, roughly how far apart do you expect them to be?

# %% role=run
run_a = StatevectorSampler(seed=11).run([qc_h], shots=1000).result()[0].data.meas.get_counts()
run_b = StatevectorSampler(seed=22).run([qc_h], shots=1000).result()[0].data.meas.get_counts()
run_c = StatevectorSampler(seed=33).run([qc_h], shots=1000).result()[0].data.meas.get_counts()

for label, run_counts in [("run A", run_a), ("run B", run_b), ("run C", run_c)]:
    print(label, run_counts.get("1", 0))

# %% [markdown] role=observe
# The three counts of `1` are close to each other and all near 500, but not identical — a
# spread of a few tens is typical at 1000 shots.

# %% [markdown] role=explain
# Same circuit, same fixed 1/2 probability, three different tallies — this is sampling
# noise, not a change in the underlying circuit. More shots do not make the noise vanish;
# they shrink it relative to the total, the same way flipping a real coin 10,000 times gets
# you closer to exactly 50% than flipping it 10 times does. A checkpoint that demanded
# `counts["1"] == 500` exactly would fail most of the time for exactly this reason — every
# checkpoint in this lab checks a range instead.

# %% [markdown] role=note
# ## Deliverable: the quantum coin
# Package what you have built into a function: build a fair-coin circuit, sample it, and
# report "heads" (`1`) versus "tails" (`0`) — reusable any time you want a random bit.

# %% role=run
def flip_quantum_coin(shots=1000, seed=None):
    """Build a one-qubit fair-coin circuit, sample it, and report heads/tails counts."""
    coin = QuantumCircuit(1)
    coin.h(0)
    coin.measure_all()
    result = StatevectorSampler(seed=seed).run([coin], shots=shots).result()
    counts = result[0].data.meas.get_counts()
    return {"tails": counts.get("0", 0), "heads": counts.get("1", 0)}


coin_result = flip_quantum_coin(shots=1000, seed=2024)
coin_result

# %% role=checkpoint
assert 400 < coin_result["heads"] < 600, (
    f"the quantum coin should land heads roughly half the time, got {coin_result}"
)

# %% [markdown] role=summary
# ## What you built
# Four one-qubit circuits, a working explanation for why `H` is a fair coin and `H, H`
# cancels back to certainty, and a reusable `flip_quantum_coin` function. You also watched
# sampling counts move around run to run even though the underlying circuit never changed
# — every checkpoint in this lab checks a range for exactly that reason.
#
# One remaining question to carry into the challenge: if `H, H` cancels completely, is
# there a gate *between* `X` and `H` that gives you a coin biased toward `1` — say, landing
# on `1` about a quarter of the time instead of half? The challenge picks this up with
# `RY(theta)`.
