# ---
# title: Week 00 — Setup
# kind: lab
# summary: Verify the Qiskit 2.5 install, build a one-qubit circuit, and sample it locally.
# objectives:
#   - Confirm Qiskit, NumPy and Matplotlib are installed and report the right versions
#   - Build a one-qubit circuit and read both its text and image drawings
#   - Sample a circuit locally with StatevectorSampler and see shot count change the result
# prerequisites:
#   - README.md's install steps completed (uv sync, JupyterLab open, kernel selected)
# duration_minutes: 30
# ---

# %% [markdown] role=objective
# ## What you will build
# By the end of this session you will have a working Qiskit 2.5 environment and a
# one-qubit circuit that you built, drew, and sampled yourself. There is no physics to
# learn yet — Week 01 starts that. Today just proves the tools work.

# %% [markdown] role=concept
# ## Thirty minutes, one goal
# This notebook has three parts: check the install, build a tiny circuit, then sample it
# twice with different shot counts to see what changes. Run each cell in order with
# Shift+Enter. If a cell errors, read the message before moving on — most Week 00
# failures are an environment problem, not a code problem, and the error text usually
# says which.

# %% role=setup
import matplotlib
import numpy as np
import qiskit

print(f"qiskit    {qiskit.__version__}")
print(f"numpy     {np.__version__}")
print(f"matplotlib {matplotlib.__version__}")

assert qiskit.__version__.startswith("2.5"), (
    f"expected Qiskit 2.5.x, found {qiskit.__version__} instead — see README.md, "
    "section 'Common install failures'"
)

# %% [markdown] role=note
# ## Why this check matters
# A mismatched Qiskit version is the most common reason a study-group session stalls:
# an old install prints different API errors than the ones this course expects, and the
# fix (re-running `uv sync`) is quick once you know that's the cause. The assertion above
# stops the notebook here, with a clear message, instead of failing confusingly three
# cells later.

# %% [markdown] role=concept
# ## Building your first circuit
# A `QuantumCircuit` starts with every qubit in the same fixed, known state. The `h(0)`
# call applies a Hadamard gate to qubit 0, which puts it into an equal superposition —
# for now, read that as "makes the eventual measurement 50/50 instead of certain."
# `measure_all()` adds a classical register named `meas` and measures every qubit into
# it. Nothing runs yet; `QuantumCircuit` only describes the circuit.

# %% role=run
from qiskit import QuantumCircuit

qc = QuantumCircuit(1)
qc.h(0)
qc.measure_all()

print(qc.draw("text"))

# %% role=figure
# The text drawing above and the image below describe the same circuit. Keep both —
# the image is easier to scan, the text form works anywhere, including here if the
# image never renders.
print(qc.draw("text"))
qc.draw("mpl")

# %% [markdown] role=concept
# ## Sampling: shots and counts
# `QuantumCircuit` describes what to build; a primitive is what actually runs it.
# `StatevectorSampler` runs the circuit locally, once per "shot," and returns how many
# shots landed on each measured bitstring — a dictionary called `counts`. More shots
# means more individual coin flips, not a different coin.

# %% [markdown] role=predict
# Before you run anything: with `shots=100`, do you expect the counts for `0` and `1`
# to be exactly equal? Write a specific guess — for example, "close but not exact,
# maybe a 45/55 split" — then compare it with what you actually see two cells down.

# %% role=run
from qiskit.primitives import StatevectorSampler

sampler = StatevectorSampler(seed=42)
job_100 = sampler.run([qc], shots=100)
counts_100 = job_100.result()[0].data.meas.get_counts()
print(counts_100)

# %% role=observe
total_100 = sum(counts_100.values())
fraction_1 = counts_100.get("1", 0) / total_100
print(f"total shots: {total_100}")
print(f"fraction landing on '1': {fraction_1:.3f}")

# %% role=figure
from qiskit.visualization import plot_histogram

print(counts_100)
plot_histogram(counts_100)

# %% [markdown] role=explain
# The split at 100 shots is close to 50/50 but rarely exact — each shot is an
# independent random draw, like a coin flip, and small samples fluctuate. This is
# sampling noise, not a bug: it shrinks as you take more shots, roughly like
# `1 / sqrt(shots)`, so 10000 shots should land much closer to an even split than 100
# did.

# %% role=modify
job_10000 = sampler.run([qc], shots=10000)
counts_10000 = job_10000.result()[0].data.meas.get_counts()
total_10000 = sum(counts_10000.values())
fraction_1_big = counts_10000.get("1", 0) / total_10000
print(counts_10000)
print(f"fraction landing on '1': {fraction_1_big:.3f}")

# %% role=checkpoint
assert total_100 == 100, f"expected 100 shots, counted {total_100}"
assert total_10000 == 10000, f"expected 10000 shots, counted {total_10000}"
assert set(counts_100) == {"0", "1"}, f"expected both outcomes at 100 shots, saw {set(counts_100)}"
assert set(counts_10000) == {"0", "1"}, (
    f"expected both outcomes at 10000 shots, saw {set(counts_10000)}"
)
# A band, not an exact number: sampling noise means fraction_1_big is close to 0.5,
# not equal to it.
assert 0.45 < fraction_1_big < 0.55, f"expected close to an even split, got {fraction_1_big:.3f}"

# %% role=checkpoint
# The version check from the setup cell still holds — nothing later in this notebook
# should have changed which Qiskit is installed.
assert qiskit.__version__.startswith("2.5"), (
    f"qiskit version changed unexpectedly: {qiskit.__version__}"
)
# The explain cell claimed more shots land closer to 0.5: check it against your own
# two runs, not just take it on faith.
distance_100 = abs(fraction_1 - 0.5)
distance_10000 = abs(fraction_1_big - 0.5)
assert distance_10000 < distance_100, (
    f"expected the 10000-shot fraction ({fraction_1_big:.3f}) to land closer to 0.5 than "
    f"the 100-shot fraction ({fraction_1:.3f}) did, got distances {distance_10000:.4f} "
    f"vs {distance_100:.4f}"
)

# %% [markdown] role=note
# ## Local statevector vs. hardware
# Everything above ran on your own machine: `StatevectorSampler` computes the exact
# probabilities and then draws random samples from them, with no queue and no noise.
# A real quantum computer instead measures physical qubits, so it queues your job,
# takes noise and connectivity into account, and needs an IBM Quantum account — that
# path is covered later, in the optional hardware bonus chapter.

# %% [markdown] role=summary
# ## What you verified
# Qiskit 2.5.x is installed and importable, you built and drew a one-qubit circuit two
# ways, and you sampled it locally at two shot counts, watching the split tighten
# around 50/50 as shots increased. Week 01 starts building circuits that do more than
# flip one coin.
