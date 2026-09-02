# ---
# title: Week 07 — Hybrid algorithms
# kind: lab
# summary: Build a one-qubit variational solver — a parameterized ansatz, an objective
#   function, and a classical optimizer working together.
# objectives:
#   - Build a one-qubit ansatz with a Parameter and read its energy landscape
#   - Write an objective function that a classical optimizer can call
#   - Minimize a Hamiltonian's expectation value with scipy.optimize.minimize
#   - Explain the hybrid loop — classical optimizer proposes, quantum primitive estimates
#   - Scale the same pattern to a two-qubit ansatz with real_amplitudes
# prerequisites:
#   - Week 05 primitives — EstimatorV2 and SparsePauliOp observables
#   - Week 06 Grover search
# duration_minutes: 40
# ---

# %% [markdown] role=objective
# ## What you will build
# A *variational* circuit: one qubit, one rotation angle, and a classical optimizer
# that searches for the angle minimizing an observable's expectation value. This is
# the same loop behind VQE (the Variational Quantum Eigensolver) and QAOA — a quantum
# circuit whose behavior depends on parameters, and a classical routine that adjusts
# those parameters using a number the circuit reports back. By the end you will have
# a small function that solves this kind of problem for any one-qubit Hamiltonian.

# %% role=setup
import numpy as np
import qiskit
from qiskit.circuit import Parameter
from qiskit.primitives import StatevectorEstimator
from qiskit.quantum_info import SparsePauliOp
from scipy.optimize import minimize

print(f"qiskit {qiskit.__version__}")

# %% [markdown] role=concept
# ## The ansatz: a circuit with a knob
# Every circuit you have built so far had gates with fixed angles. A *variational*
# circuit — an **ansatz** — instead has a gate whose angle is a `Parameter`: a
# placeholder you bind to a numeric value later, without rebuilding the circuit.
# `RY(theta)` rotates a qubit around the Y axis by `theta` radians. Starting from
# $|0\rangle$, it produces $\cos(\theta/2)|0\rangle + \sin(\theta/2)|1\rangle$ — a
# state whose measurement statistics you can predict from `theta` alone.

# %% [markdown] role=predict
# Before you compute anything: for `RY(theta)` starting at $|0\rangle$, what do you
# expect $\langle Z \rangle$ (the expectation value of the `Z` observable) to equal at
# `theta = 0`? At `theta = pi`? `Z` reads `+1` on $|0\rangle$ and `-1` on $|1\rangle$.
# Write down two specific numbers.

# %% role=run
estimator = StatevectorEstimator()
z_obs = SparsePauliOp("Z")

theta = Parameter("theta")
ansatz = qiskit.QuantumCircuit(1)
ansatz.ry(theta, 0)

thetas = np.linspace(0, 2 * np.pi, 25)
job = estimator.run([(ansatz, z_obs, [[t] for t in thetas])])
z_values = job.result()[0].data.evs

for t, z in list(zip(thetas, z_values))[::6]:
    print(f"theta={t:.3f}  <Z>={z:.3f}")

# %% role=figure
# The same circuit, two ways: the text form always works; the image is easier to scan.
print(ansatz.draw("text"))
ansatz.draw("mpl")

# %% role=figure
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(5, 3))
ax.plot(thetas, z_values, marker="o", markersize=3)
ax.axhline(0, color="gray", linewidth=0.5)
ax.set_xlabel("theta (radians)")
ax.set_ylabel("<Z>")
ax.set_title("Energy landscape: <Z> vs theta")

print(f"min <Z> = {z_values.min():.3f} at theta = {thetas[np.argmin(z_values)]:.3f}")
print(f"max <Z> = {z_values.max():.3f} at theta = {thetas[np.argmax(z_values)]:.3f}")

# %% [markdown] role=observe
# The curve is a cosine. `<Z>` starts at 1 when `theta = 0`, crosses zero near
# `theta = pi/2`, bottoms out at -1 near `theta = pi`, then climbs back to 1 by
# `theta = 2*pi`. Your two predicted values should match the curve's endpoints almost
# exactly — this circuit is simple enough to reason about by hand.

# %% [markdown] role=explain
# `RY(theta)|0>` equals $\cos(\theta/2)|0\rangle + \sin(\theta/2)|1\rangle$. Squaring
# those amplitudes and weighting by `Z`'s `+1`/`-1` eigenvalues works out to
# $\cos(\theta)$ — the curve you just plotted. Week 03 covered this identity in more
# detail; here you are using it, not re-deriving it.

# %% role=modify
x_obs = SparsePauliOp("X")
job_x = estimator.run([(ansatz, x_obs, [[t] for t in thetas])])
x_values = job_x.result()[0].data.evs

for t, x in list(zip(thetas, x_values))[::6]:
    print(f"theta={t:.3f}  <X>={x:.3f}")

# %% role=checkpoint
assert abs(z_values[0] - 1.0) < 0.01, f"expected <Z>~1 at theta=0, got {z_values[0]:.3f}"
mid_index = len(thetas) // 2
assert abs(z_values[mid_index] - (-1.0)) < 0.05, (
    f"expected <Z>~-1 near theta=pi, got {z_values[mid_index]:.3f}"
)

# %% role=checkpoint
# Swapping the observable from Z to X should trace out sin(theta) instead of
# cos(theta) — the same state, read a different way.
expected_x = np.sin(thetas)
max_gap = float(np.max(np.abs(x_values - expected_x)))
assert max_gap < 0.01, f"<X> should track sin(theta); max gap was {max_gap:.4f}"

# %% [markdown] role=concept
# ## The objective: a Python function an optimizer can call
# So far you supplied `theta` and read off a number. A **variational algorithm** flips
# this around: a classical optimizer supplies candidate values of `theta`, and your
# job is to hand back a single float — the **objective** — that the optimizer wants to
# shrink. The optimizer does not need to know the objective calls a quantum primitive;
# it only sees an ordinary Python function that takes an array of parameters and
# returns a number.
#
# The target here is the Hamiltonian $H = 0.5 Z + 0.3 X$, written as a
# `SparsePauliOp`. Finding its lowest expectation value over every state this ansatz
# can reach is a miniature version of what VQE does for a molecule's electronic
# Hamiltonian.

# %% role=run
H = SparsePauliOp.from_list([("Z", 0.5), ("X", 0.3)])


def objective(params):
    job = estimator.run([(ansatz, H, [list(params)])])
    evs = job.result()[0].data.evs
    return float(np.asarray(evs).reshape(-1)[0])


h_values = np.array([objective([t]) for t in thetas])
grid_min_index = int(np.argmin(h_values))
print(f"grid minimum: <H> = {h_values[grid_min_index]:.4f} at theta = {thetas[grid_min_index]:.3f}")

# %% role=figure
fig, ax = plt.subplots(figsize=(5, 3))
ax.plot(thetas, h_values, marker="o", markersize=3, color="tab:orange")
ax.axhline(0, color="gray", linewidth=0.5)
ax.set_xlabel("theta (radians)")
ax.set_ylabel("<H>")
ax.set_title("Energy landscape: <H> = 0.5<Z> + 0.3<X>")

for t, h in list(zip(thetas, h_values))[::6]:
    print(f"theta={t:.3f}  <H>={h:.3f}")

# %% [markdown] role=predict
# `scipy.optimize.minimize` searches continuously between the 25 grid points above,
# so predict: will its answer land noticeably lower than the grid's best point, or
# about the same? The exact ground energy of `H` — the lowest eigenvalue of
# $0.5Z + 0.3X$ — is $-\sqrt{0.5^2 + 0.3^2} \approx -0.5831$. How close do you expect
# the optimizer to get?

# %% role=run
x0 = [0.1]
result = minimize(objective, x0, method="COBYLA", options={"maxiter": 100})

print(result.message)
print(f"minimum <H> = {result.fun:.6f}")
print(f"theta*      = {result.x[0]:.4f}")
print(f"function evaluations: {result.nfev}")

# %% [markdown] role=observe
# COBYLA needed only a few dozen evaluations, and `result.fun` sits below the grid's
# best sampled point — the grid only checked 25 values of `theta`, and the true
# minimum sits between two of them. Compare `result.fun` to your predicted -0.5831.

# %% [markdown] role=explain
# This is the hybrid loop. COBYLA — a purely classical algorithm — proposes a
# candidate `theta`. `objective(theta)` builds the bound circuit, hands it to
# `StatevectorEstimator`, and returns one float: the quantum step. COBYLA reads that
# float, decides where to look next, and repeats. COBYLA never asks what is inside
# `objective` — it could just as well be a slow database query, as long as it takes an
# array and returns a number. Classical optimizer proposes, quantum primitive
# estimates: that division is what makes an algorithm "variational."

# %% role=checkpoint
exact_ground = -np.sqrt(0.5**2 + 0.3**2)
assert abs(result.fun - exact_ground) < 0.05, (
    f"expected within 0.05 of the exact ground energy {exact_ground:.4f}, got {result.fun:.4f}"
)

# %% role=modify
result_b = minimize(objective, [3.0], method="COBYLA", options={"maxiter": 100})
print(f"x0=[0.1] -> fun={result.fun:.6f}, theta*={result.x[0]:.4f}")
print(f"x0=[3.0] -> fun={result_b.fun:.6f}, theta*={result_b.x[0]:.4f}")

# %% role=checkpoint
# Different starting points, same landscape: COBYLA should still land on the same
# minimum, since this landscape has exactly one minimum in [0, 2*pi).
assert abs(result.fun - result_b.fun) < 0.01, (
    f"two starting points found different minima: {result.fun:.4f} vs {result_b.fun:.4f}"
)

# %% role=modify
H_mod = SparsePauliOp.from_list([("Z", 0.2), ("X", 0.9)])


def objective_mod(params):
    job = estimator.run([(ansatz, H_mod, [list(params)])])
    evs = job.result()[0].data.evs
    return float(np.asarray(evs).reshape(-1)[0])


result_mod = minimize(objective_mod, x0, method="COBYLA", options={"maxiter": 100})
exact_ground_mod = -np.sqrt(0.2**2 + 0.9**2)
print(f"new H: minimum <H> = {result_mod.fun:.6f}, exact = {exact_ground_mod:.6f}")

# %% role=checkpoint
assert abs(result_mod.fun - exact_ground_mod) < 0.05, (
    f"expected within 0.05 of {exact_ground_mod:.4f}, got {result_mod.fun:.4f}"
)

# %% [markdown] role=concept
# ## Scaling up: two qubits
# The same predict-run-observe-explain-modify pattern works with more qubits and more
# parameters — only the ansatz and the Hamiltonian grow. `real_amplitudes(2, reps=1)`
# builds a two-qubit ansatz out of `RY` rotations and one `CX` gate, giving it 4
# parameters instead of 1.
#
# The Hamiltonian below is a toy stand-in shaped like the ones chemists build for the
# hydrogen molecule (H2) in a minimal basis — it is *not* the real H2 electronic
# Hamiltonian, just a small multi-term operator (identity, `ZI`, `IZ`, `ZZ`, `XX`
# terms) that needs the ansatz's entangling `CX` gate to reach its true ground state.

# %% [markdown] role=predict
# With 4 parameters instead of 1, COBYLA has a larger space to search from a single
# starting point. Predict: will it still converge to (roughly) the true minimum within
# a couple hundred iterations, or would you expect it to need a much better starting
# guess than the one-qubit case did?

# %% role=run
import time

from qiskit.circuit.library import real_amplitudes

ansatz2 = real_amplitudes(2, reps=1)

H2_toy = SparsePauliOp.from_list(
    [
        ("II", -1.0),
        ("ZI", 0.4),
        ("IZ", 0.4),
        ("ZZ", 0.2),
        ("XX", 0.3),
    ]
)

exact_ground_2q = float(np.linalg.eigvalsh(H2_toy.to_matrix())[0])


def objective2(params):
    job = estimator.run([(ansatz2, H2_toy, [list(params)])])
    evs = job.result()[0].data.evs
    return float(np.asarray(evs).reshape(-1)[0])


x0_2q = np.array([0.2, -0.3, 0.1, 0.4])
started = time.perf_counter()
result_2q = minimize(objective2, x0_2q, method="COBYLA", options={"maxiter": 150})
elapsed = time.perf_counter() - started

print(f"exact ground energy: {exact_ground_2q:.6f}")
print(f"found minimum:       {result_2q.fun:.6f}")
print(f"elapsed: {elapsed:.3f} s, evaluations: {result_2q.nfev}")

# %% role=figure
print(ansatz2.draw("text"))
ansatz2.draw("mpl")

# %% [markdown] role=observe
# The optimizer lands within a hundredth of the exact ground energy, using well under
# a second of wall time — four parameters and a two-qubit statevector are still tiny
# for a classical computer to simulate exactly.

# %% [markdown] role=explain
# This stays fast because a 2-qubit statevector has only 4 amplitudes; every one of
# COBYLA's evaluations is a handful of matrix multiplications, not a physical
# experiment. The `CX` gate matters for correctness, not speed: without it, the
# ansatz could only produce product states, and could never reach the entangled ground
# state that the `ZZ` and `XX` terms in `H2_toy` reward.

# %% role=modify
ansatz2_deep = real_amplitudes(2, reps=2)
print(f"reps=1: {ansatz2.num_parameters} parameters   reps=2: {ansatz2_deep.num_parameters} parameters")


def objective2_deep(params):
    job = estimator.run([(ansatz2_deep, H2_toy, [list(params)])])
    evs = job.result()[0].data.evs
    return float(np.asarray(evs).reshape(-1)[0])


x0_deep = np.array([0.2, -0.3, 0.1, 0.4, 0.0, 0.5])
result_2q_deep = minimize(objective2_deep, x0_deep, method="COBYLA", options={"maxiter": 150})
print(f"reps=1 minimum: {result_2q.fun:.6f}")
print(f"reps=2 minimum: {result_2q_deep.fun:.6f}")

# %% role=checkpoint
# Convergence, not an exact match: the optimizer should land close to the exact
# ground energy, well below the identity term alone (-1.0) — for both the reps=1
# ansatz above and the reps=2 ansatz from the modify cell.
assert result_2q.fun < exact_ground_2q + 0.05, (
    f"expected convergence within 0.05 of {exact_ground_2q:.4f}, got {result_2q.fun:.4f}"
)
assert result_2q_deep.fun < exact_ground_2q + 0.05, (
    f"expected reps=2 convergence within 0.05 of {exact_ground_2q:.4f}, got {result_2q_deep.fun:.4f}"
)

# %% [markdown] role=concept
# ## The deliverable: a reusable variational solver
# Every one-qubit example above followed the same shape: build an ansatz, define an
# objective from a Hamiltonian, minimize it. Package that shape as a function, and it
# works for any one-qubit, two-term Hamiltonian you hand it — not just the two you
# tried above.

# %% role=run
def variational_solve(H, x0, maxiter=100):
    """Find the minimum expectation value of a one-qubit Hamiltonian over RY(theta).

    H: a one-qubit SparsePauliOp. x0: a fixed starting angle, as a one-element list.
    Returns the scipy OptimizeResult, with the minimum in .fun and the angle in .x[0].
    """

    def objective(params):
        job = estimator.run([(ansatz, H, [list(params)])])
        evs = job.result()[0].data.evs
        return float(np.asarray(evs).reshape(-1)[0])

    return minimize(objective, x0, method="COBYLA", options={"maxiter": maxiter})


solved_h = variational_solve(H, x0=[0.1])
solved_h_mod = variational_solve(H_mod, x0=[0.1])
print(f"H:     minimum={solved_h.fun:.6f}  theta*={solved_h.x[0]:.4f}")
print(f"H_mod: minimum={solved_h_mod.fun:.6f}  theta*={solved_h_mod.x[0]:.4f}")

# %% role=checkpoint
assert abs(solved_h.fun - result.fun) < 0.01, (
    "variational_solve should reproduce the earlier direct calculation for H"
)
assert abs(solved_h_mod.fun - result_mod.fun) < 0.01, (
    "variational_solve should reproduce the earlier direct calculation for H_mod"
)

# %% [markdown] role=summary
# ## What you built
# A one-qubit ansatz with a real `Parameter`, an objective function bridging a
# quantum estimator and a classical optimizer, and a `variational_solve` function
# that finds a Hamiltonian's ground energy without diagonalizing anything by hand.
# You saw the same pattern scale to two qubits and four parameters without changing
# its shape.
#
# One remaining question worth sitting with: COBYLA never asked for a gradient, and
# this notebook's ansatz was small enough that a full grid sweep could find the answer
# by eye. What has to change — about the ansatz, or about the optimizer — once neither
# of those is true?
