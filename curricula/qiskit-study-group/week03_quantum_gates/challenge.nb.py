# ---
# title: Week 03 — Gate prediction experiments
# kind: challenge
# summary: Predict the outcome probabilities of three single-qubit circuits, then find the angle that gives a target probability.
# objectives:
#   - Compute outcome probabilities for a rotation circuit without running it
#   - Use interference (H, RZ(theta), H) to hit a target probability by solving for theta
# prerequisites:
#   - Week 03 lab (Statevector, RX/RY/RZ, the H-Z-H interference experiment)
# duration_minutes: 15
# ---

# %% [markdown] role=objective
# ## Gate prediction experiments
# You are given three circuits, each starting from `|0>`, described in words and code
# — no `Statevector` output shown yet. Predict the outcome probabilities for each one
# using the formulas from the lab, then write your predictions into
# `predicted_probabilities` and check them. A second task asks you to find the
# rotation angle that hits an exact target probability.

# %% [markdown] role=concept
# ### Formulas from the lab, for reference
# - `probability = |amplitude| ** 2`.
# - `RY(theta)` on `|0>` gives `P(0) = cos(theta / 2) ** 2` and
#   `P(1) = sin(theta / 2) ** 2`.
# - `RX(theta)` on `|0>` gives the same two probabilities as `RY(theta)`, through
#   different (partly imaginary) amplitudes.
# - `RZ`, applied on its own to `|0>`, never changes probability — `|0>` has no second
#   outcome for a phase change to act against.
# - `H`, then `RZ(theta)`, then `H`, on `|0>`, gives `P(1) = sin(theta / 2) ** 2` — the
#   same shape as `RY(theta)`, reached through interference instead of a direct
#   rotation.

# %% role=setup
import qiskit
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
import numpy as np

print("Qiskit version:", qiskit.__version__)

# %% [markdown] role=exercise
# ### Task 1 — predict, then check
# Three circuits, each acting on a qubit that starts at `|0>`:
#
# - **Circuit A**: `qc.rx(np.pi, 0)`
# - **Circuit B**: `qc.ry(np.pi / 2, 0)` then `qc.z(0)`
# - **Circuit C**: `qc.h(0)`, then `qc.rz(np.pi / 3, 0)`, then `qc.h(0)`
#
# For each one, work out `P(0)` and `P(1)` using the formulas above — Circuit B needs
# the observation from the lab that `Z` only changes phase, never magnitude, so it
# cannot move probability that `RY` already put in place.
#
# Fill in `predicted_probabilities` below: a list of three dictionaries, in order A,
# B, C, each shaped like `{"0": p0, "1": p1}`.

# %% role=run
circuit_a = QuantumCircuit(1)
circuit_a.rx(np.pi, 0)

circuit_b = QuantumCircuit(1)
circuit_b.ry(np.pi / 2, 0)
circuit_b.z(0)

circuit_c = QuantumCircuit(1)
circuit_c.h(0)
circuit_c.rz(np.pi / 3, 0)
circuit_c.h(0)

for name, circuit in [("A", circuit_a), ("B", circuit_b), ("C", circuit_c)]:
    print(f"Circuit {name}:")
    print(circuit.draw("text"))

# %% [markdown] role=hint
# Circuit A is a full rotation by `pi`, the same angle that turned `|0>` all the way
# into `|1>` in the lab's `RY` experiment — plug `theta = pi` into the same
# `cos(theta / 2) ** 2` / `sin(theta / 2) ** 2` formula. Circuit C matches the lab's
# `H`, `RZ(theta)`, `H` shape exactly, with `theta = pi / 3`.

# %% role=solution stub="predicted_probabilities = None  # list of three dicts like {'0': p0, '1': p1}, one per circuit A, B, C"
predicted_probabilities = [
    {"0": 0.0, "1": 1.0},  # Circuit A: RX(pi) flips |0> all the way to |1>.
    {"0": 0.5, "1": 0.5},  # Circuit B: Z only changes phase, so RY(pi/2)'s 50/50 split survives.
    {  # Circuit C: H, RZ(pi/3), H has the same shape as RY(theta), with theta = pi/3.
        "0": float(np.cos(np.pi / 6) ** 2),
        "1": float(np.sin(np.pi / 6) ** 2),
    },
]
print(predicted_probabilities)

# %% role=checkpoint
if predicted_probabilities is not None:
    actual = [
        Statevector(circuit).probabilities_dict()
        for circuit in (circuit_a, circuit_b, circuit_c)
    ]
    for name, predicted, real in zip("ABC", predicted_probabilities, actual):
        for outcome in ("0", "1"):
            p_predicted = predicted.get(outcome, 0.0)
            p_actual = real.get(outcome, 0.0)
            # A band, not exact equality: your prediction only needs to be close, not
            # bit-for-bit identical to what Statevector computes.
            assert np.isclose(p_predicted, p_actual, atol=0.05), (
                f"Circuit {name}, outcome {outcome}: predicted {p_predicted}, "
                f"Statevector says {p_actual}"
            )
    print("checkpoint ok: all three predictions are within 0.05 of Statevector")

# %% [markdown] role=exercise
# ### Task 2 — hit a target probability
# Using the `H`, `RZ(theta)`, `H` shape from the lab, find a value of `theta` (in
# radians) so that `P(1)` comes out to `0.9`. Write it into `theta_for_p1_09` below.

# %% [markdown] role=hint
# `P(1) = sin(theta / 2) ** 2` for this shape, so `sin(theta / 2) = sqrt(0.9)`.
# `np.arcsin` inverts `sin` and gives you `theta / 2` back.

# %% role=solution stub="theta_for_p1_09 = None  # radians"
theta_for_p1_09 = 2 * np.arcsin(np.sqrt(0.9))
print(theta_for_p1_09)

# %% role=checkpoint
if theta_for_p1_09 is not None:
    qc = QuantumCircuit(1)
    qc.h(0)
    qc.rz(theta_for_p1_09, 0)
    qc.h(0)
    p1 = Statevector(qc).probabilities_dict().get("1", 0.0)
    # A band, not exact equality: any theta that lands close to P(1) = 0.9 counts.
    assert np.isclose(p1, 0.9, atol=0.02), f"P(1) came out to {p1}, not close to 0.9"
    print(f"checkpoint ok: theta={theta_for_p1_09:.4f} gives P(1)={p1:.4f}")

# %% [markdown] role=summary
# ## Where this leaves you
# If both checkpoints passed, you can now go from a gate sequence to a probability
# without running anything, and invert that: from a target probability back to an
# angle. Week 04 picks the story back up at the point where a circuit like this one
# has to survive being rewritten for a real device's gate set.
