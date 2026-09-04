"""Shared fixture text for the leona-notebooks tests."""

LESSON = """\
# ---
# title: Quantum coin
# kind: lesson
# summary: A one-qubit circuit that behaves like a fair coin.
# objectives:
#   - Build a one-qubit circuit and sample it
# duration_minutes: 20
# ---

# %% [markdown] role=objective
# ## What you will build
# A circuit that behaves like a *fair coin*, with $p = 1/2$.

# %% role=setup
import qiskit
print(qiskit.__version__)

# %% [markdown] role=concept
# A qubit starts in $|0\\rangle$.

# %% [markdown] role=predict
# Before running: how many of 1000 shots land on `1`?

# %% role=run
from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler
qc = QuantumCircuit(1)
qc.h(0)
qc.measure_all()
counts = StatevectorSampler(seed=7).run([qc], shots=1000).result()[0].data.meas.get_counts()
counts

# %% [markdown] role=observe
# Roughly half and half.

# %% [markdown] role=explain
# The Hadamard gate puts the qubit in an equal superposition.

# %% role=modify
qc2 = QuantumCircuit(1)
qc2.x(0)
qc2.measure_all()

# %% role=checkpoint
assert 400 < counts.get("1", 0) < 600, f"expected a fair coin, got {counts}"

# %% [markdown] role=summary
# You built a quantum coin.
"""
