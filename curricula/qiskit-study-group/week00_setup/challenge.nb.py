# ---
# title: Week 00 — Setup challenge
# kind: challenge
# summary: Build a two-qubit circuit with a Hadamard on each qubit and predict all four outcomes.
# objectives:
#   - Extend the one-qubit circuit from lab.ipynb to two independent qubits
#   - Predict and then observe a four-outcome distribution
# prerequisites:
#   - lab.ipynb completed
# duration_minutes: 15
# ---

# %% [markdown] role=objective
# ## What you will build
# One circuit with a Hadamard gate on each of two qubits, sampled locally. You saw a
# one-qubit coin in lab.ipynb; this is two of them, run at once.

# %% [markdown] role=concept
# ## Two qubits, no connection between them
# Nothing in this circuit links qubit 0 to qubit 1 — no gate touches both. So each
# qubit should behave like its own independent coin, and the two-bit outcome should
# look like two coin flips happening together. Week 02 introduces a gate that removes
# that independence; this challenge does not use one.

# %% [markdown] role=predict
# Before you write any code: with `shots=1000`, how many of the four two-bit outcomes
# (`00`, `01`, `10`, `11`) do you expect to see, and roughly what fraction of the 1000
# shots do you expect to land on each one? Write a specific guess.

# %% [markdown] role=exercise
# Build a two-qubit circuit named `qc`: apply `h` to qubit 0 and to qubit 1, then call
# `measure_all()`. Sample it with `StatevectorSampler(seed=42)` at `shots=1000` and
# store the result in a dictionary named `counts`.

# %% role=solution stub="qc = None\ncounts = None\n"
from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler

qc = QuantumCircuit(2)
qc.h(0)
qc.h(1)
qc.measure_all()

counts = StatevectorSampler(seed=42).run([qc], shots=1000).result()[0].data.meas.get_counts()
for outcome, shots in sorted(counts.items()):
    print(f"{outcome}: {shots} ({shots / 1000:.3f})")

# %% [markdown] role=hint
# Two independent `h` calls, one `measure_all()`, then
# `StatevectorSampler(seed=42).run([qc], shots=1000).result()[0].data.meas.get_counts()`
# — the same primitive call as lab.ipynb, just with a two-qubit `qc`.

# %% role=checkpoint
if counts is not None:
    total = sum(counts.values())
    assert total == 1000, f"expected 1000 total shots, got {total}"

# %% role=checkpoint
if counts is not None:
    assert len(counts) == 4, f"expected all four two-bit outcomes, saw {sorted(counts)}"
    for outcome, shots in counts.items():
        fraction = shots / 1000
        # A band, not an exact count: four independent-ish outcomes near 1/4 each.
        assert 0.15 < fraction < 0.35, f"'{outcome}' landed at {fraction:.3f}, far from 1/4"

# %% [markdown] role=explain
# If your counts came back close to 250 for each of the four outcomes, that matches
# two independent coins: each qubit is 50/50 on its own, and with no gate linking them
# the two results combine without favoring any pairing. The exact numbers will not be
# 250/250/250/250 — that is the same sampling noise you saw in lab.ipynb, just spread
# across four outcomes instead of two.

# %% [markdown] role=summary
# ## What you built
# A two-qubit circuit sampled locally, with a prediction checked against an actual
# four-outcome distribution. Compare your answer with the reference solution notebook
# and its self-evaluation checklist.
