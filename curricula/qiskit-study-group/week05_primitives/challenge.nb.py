# ---
# title: Week 05 — Primitives challenge
# kind: challenge
# summary: Turn the lab's primitive-selection table into a checkable dict, then compute one more expectation value on a three-qubit GHZ state.
# objectives:
#   - Formalize a Sampler-or-Estimator decision as a dict Python can check
#   - Compute a two-qubit observable's expectation value on a three-qubit state
# prerequisites:
#   - Week 05 lab completed (StatevectorSampler, StatevectorEstimator, SparsePauliOp)
# duration_minutes: 15
# ---

# %% [markdown] role=objective
# ## What you will do
# Two short tasks. First, turn the primitive-selection table from the lab into a dict
# Python can check. Second, compute an expectation value on a three-qubit GHZ state —
# the same `SparsePauliOp` idea from the lab, extended to one more qubit.

# %% role=setup
import numpy as np
import qiskit

print("qiskit version:", qiskit.__version__)

from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorEstimator
from qiskit.quantum_info import SparsePauliOp

# %% [markdown] role=exercise
# ## Task 1: primitive selection, as a dict
# In the lab you matched five tasks to `Sampler` or `Estimator` by hand. Here, turn
# that into a dict Python can check: keys are the task ids below, values are the
# string `"sampler"` or `"estimator"` (lowercase, exactly those two words).
#
# - `"outcome_distribution"`: Get the full distribution of measurement outcomes from a
#   Grover circuit.
# - `"cost_expectation"`: Compute the expectation value of a cost Hamiltonian to score
#   one set of variational parameters.
# - `"most_frequent_bitstring"`: Find the single most frequent bitstring a circuit
#   produces over many shots.
# - `"parameter_sweep"`: Track how `<Z>` changes as a variational parameter sweeps
#   across a range of values, in one call.
# - `"named_register_readout"`: Read the final value of a named classical register
#   after a circuit with a mid-circuit measurement.
#
# Fill in `selection` below with one entry per task.

# %% role=solution stub="selection = None\n"
selection = {
    "outcome_distribution": "sampler",
    "cost_expectation": "estimator",
    "most_frequent_bitstring": "sampler",
    "parameter_sweep": "estimator",
    "named_register_readout": "sampler",
}

# %% [markdown] role=hint
# If a task ends in a single number — an expectation to score or minimize — that's
# `Estimator`. If a task ends in a distribution, a specific bitstring, or a classical
# register's value, that's `Sampler`. For the parameter sweep, ask the same question
# the other tasks answer: at each point in the sweep, does the primitive hand back a
# whole distribution of outcomes, or one number? Several points swept in a single call
# doesn't change what each point is.

# %% role=checkpoint
_expected_selection = {
    "outcome_distribution": "sampler",
    "cost_expectation": "estimator",
    "most_frequent_bitstring": "sampler",
    "parameter_sweep": "estimator",
    "named_register_readout": "sampler",
}
if selection is not None:
    assert selection == _expected_selection

# %% [markdown] role=exercise
# ## Task 2: an observable on a GHZ-3 state
# A GHZ state is the Bell state's three-qubit cousin: instead of two qubits always
# agreeing, all three do. Build one with `h(0)`, then `cx(0, 1)`, then `cx(1, 2)`. Using
# `StatevectorEstimator`, compute `<Z⊗Z⊗I>` — the same idea as `<ZZ>` from the lab, but
# naming the Pauli string so it applies `Z` to qubits 0 and 1 and leaves qubit 2 alone.
# Remember qubit 0 is the rightmost character in the label.
#
# Store the circuit in `ghz` and the expectation value in `ghz_zz_ev`.

# %% role=solution stub="ghz_zz_ev = None\n"
ghz = QuantumCircuit(3)
ghz.h(0)
ghz.cx(0, 1)
ghz.cx(1, 2)

ghz_zz_result = StatevectorEstimator().run([(ghz, SparsePauliOp("IZZ"))]).result()
ghz_zz_ev = ghz_zz_result[0].data.evs

# %% [markdown] role=hint
# `IZZ` reads right-to-left like a bitstring: the rightmost `Z` is qubit 0, the next
# `Z` is qubit 1, and the leftmost `I` is qubit 2 — the same qubit whose gates you can
# check against the circuit you built. A GHZ state has every pair of qubits agreeing on
# `00...0` or `11...1`, the same all-or-nothing correlation the Bell state had between
# its two qubits, so a two-qubit `ZZ`-style observable on any pair should look familiar.

# %% role=checkpoint
if ghz_zz_ev is not None:
    assert np.isclose(ghz_zz_ev, 1.0, atol=1e-6)

# %% [markdown] role=summary
# ## Summary
# `selection` names the deliverable from the lab as data instead of a filled-in table,
# and `ghz_zz_ev` confirms that GHZ-3's pairwise correlation looks exactly like the
# Bell pair's, one qubit larger. Compare your answers with
# `solutions/week05_primitives/challenge_solution.ipynb` and complete
# `solutions/week05_primitives/SELF_EVALUATION.md`.
