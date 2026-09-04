# ---
# title: Week 06 — Grover search challenge
# kind: challenge
# summary: Generalize Grover search to three qubits with the right number of iterations, then deliberately over-rotate a two-qubit search and measure the drop.
# objectives:
#   - Generalize the oracle and diffusion operator from lab.ipynb to three qubits
#   - Compute the optimal iteration count for a given number of items and use it
#   - Observe and measure over-rotation, where more iterations makes things worse
# prerequisites:
#   - lab.ipynb completed
# duration_minutes: 25
# ---

# %% [markdown] role=objective
# ## What you will build
# Two extensions of lab.ipynb's two-qubit Grover circuit: a three-qubit version that
# needs more than one iteration to work, and a deliberately over-rotated two-qubit
# version that shows what happens when you run more iterations than the problem calls
# for.

# %% role=setup
import qiskit

print(qiskit.__version__)

from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler
from qiskit.quantum_info import Statevector
import numpy as np


def multi_controlled_z(qc, qubits):
    """Flip the sign of the state where every qubit in `qubits` is 1, using the
    H - multi-controlled-X - H trick. For two qubits this is exactly the CZ gate
    lab.ipynb used directly — this is the same idea, generalized."""
    target = qubits[-1]
    controls = list(qubits[:-1])
    qc.h(target)
    qc.mcx(controls, target)
    qc.h(target)


def oracle_for(bitstring):
    """A phase oracle marking one computational basis state, given as a bitstring
    such as '101'. Qiskit reads the rightmost character as qubit 0, same as
    lab.ipynb's oracle_for."""
    n = len(bitstring)
    marked = QuantumCircuit(n, name=f"oracle_{bitstring}")
    bits = [int(b) for b in reversed(bitstring)]
    flip = [i for i, b in enumerate(bits) if b == 0]
    for i in flip:
        marked.x(i)
    multi_controlled_z(marked, list(range(n)))
    for i in flip:
        marked.x(i)
    return marked


def diffusion_operator(n):
    """H, X, a multi-controlled Z, X, H on every qubit — the n-qubit generalisation
    of lab.ipynb's two-qubit diffusion operator."""
    diff = QuantumCircuit(n, name="diffusion")
    diff.h(range(n))
    diff.x(range(n))
    multi_controlled_z(diff, list(range(n)))
    diff.x(range(n))
    diff.h(range(n))
    return diff


shots = 4000

# %% [markdown] role=exercise
# ## Task 1 — three qubits, two iterations
# Eight possible three-qubit states, one of them marked as `target = "101"`. Build a
# circuit that starts from the equal superposition and applies exactly **two** Grover
# iterations (oracle, then diffusion, twice). Store the exact probability of measuring
# `target` in `prob_101`, and the sampled result of running the circuit at
# `shots=4000` with `StatevectorSampler(seed=11)` in `counts`.
#
# Predict the exact success probability before you run anything. With more states, one
# iteration under-rotates — two iterations is the right number here.

# %% [markdown] role=hint
# The rotation angle for `N` states with one marked state is
# `theta = math.asin(math.sqrt(1 / N))`. The iteration count that gets closest to a full
# 90-degree rotation is `round(math.pi / (4 * theta) - 1/2)`. After `r` iterations, the
# exact success probability is `math.sin((2*r + 1) * theta) ** 2`. Plug in `N = 8` and
# `r = 2` for your numeric prediction — or build the two-iteration circuit and read the
# probability straight off `Statevector(...).probabilities_dict()`.

# %% role=solution stub="prob_101 = None\ncounts = None\n"
n = 3
target = "101"

grover3 = QuantumCircuit(n)
grover3.h(range(n))
for _ in range(2):
    grover3.compose(oracle_for(target), inplace=True)
    grover3.compose(diffusion_operator(n), inplace=True)

prob_101 = Statevector(grover3).probabilities_dict().get(target, 0.0)
print(f"exact probability of '{target}':", round(prob_101, 4))

measured = grover3.copy()
measured.measure_all()
counts = (
    StatevectorSampler(seed=11).run([measured], shots=shots).result()[0].data.meas.get_counts()
)
print(f"counts out of {shots} shots:", counts)

# %% role=checkpoint
if prob_101 is not None and counts is not None:
    # A band, not the exact 0.9453125: room for floating-point noise, none for
    # sampling noise since this checks the exact statevector value.
    assert prob_101 > 0.90, (
        f"two iterations on three qubits should push the marked amplitude above 90%, "
        f"got {prob_101}"
    )
    assert counts.get("101", 0) > 0.85 * shots, (
        f"counts for '101' should dominate the {shots} shots, got {counts}"
    )

# %% [markdown] role=exercise
# ## Task 2 — over-rotate a two-qubit search
# In lab.ipynb, one Grover iteration on two qubits (four states, one marked) pushed the
# probability of measuring the marked state to essentially 100%. Predict what happens if
# you keep going instead of stopping there: build the same two-qubit search for
# `target2 = "11"`, but run **three** iterations instead of one. Will the probability of
# measuring `11` end up higher than after one iteration, about the same, or lower? Write
# a specific percentage guess, then store the exact probability in `prob_11` and the
# sampled result (`shots=4000`, `StatevectorSampler(seed=23)`) in `counts2`.

# %% [markdown] role=hint
# Use the same formula as Task 1, now with `N = 4`: `theta = math.asin(math.sqrt(1/4))`
# is exactly 30 degrees, and one iteration lands the rotation at `3 * theta = 90`
# degrees — the peak lab.ipynb measured. A third iteration keeps rotating past that
# peak and back down, the way a pendulum released at the top swings back down past the
# bottom rather than staying there. Compute `math.sin((2*3 + 1) * theta) ** 2` for your
# prediction.

# %% role=solution stub="prob_11 = None\ncounts2 = None\n"
n2 = 2
target2 = "11"

grover2 = QuantumCircuit(n2)
grover2.h(range(n2))
for _ in range(3):
    grover2.compose(oracle_for(target2), inplace=True)
    grover2.compose(diffusion_operator(n2), inplace=True)

prob_11 = Statevector(grover2).probabilities_dict().get(target2, 0.0)
print(f"exact probability of '{target2}' after 3 iterations:", round(prob_11, 4))

measured2 = grover2.copy()
measured2.measure_all()
counts2 = (
    StatevectorSampler(seed=23).run([measured2], shots=shots).result()[0].data.meas.get_counts()
)
print(f"counts out of {shots} shots:", counts2)

# %% role=checkpoint
if prob_11 is not None and counts2 is not None:
    # A band around the exact 0.25: comfortably below the ~1.0 that one iteration gave
    # in lab.ipynb, with room for sampling noise.
    assert prob_11 < 0.40, (
        f"three iterations on two qubits should overshoot well below the 1-iteration "
        f"peak of ~1.0, got {prob_11}"
    )
    assert counts2.get("11", 0) < 0.40 * shots, (
        f"counts should show the collapse from over-rotation, got {counts2}"
    )

# %% [markdown] role=summary
# ## What you found
# Two iterations on three qubits pushed the marked state above 90% — under-rotating
# with only one iteration would have left it far short. Three iterations on two qubits,
# where one iteration was already exact, threw most of that probability away instead of
# adding to it. Grover's algorithm has a sweet spot set by how many states you are
# searching, and running past it costs you rather than helping — the same rotation
# that carries you up to the peak keeps going and carries you back down.
