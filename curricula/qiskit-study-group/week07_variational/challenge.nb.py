# ---
# title: Week 07 — Hybrid algorithms challenge
# kind: challenge
# summary: Write the objective for a given one-qubit Hamiltonian, minimize it, and see
#   what starving the optimizer of iterations does to the answer.
# objectives:
#   - Write an objective function for a Hamiltonian scipy.optimize.minimize has not seen
#   - Report the angle and energy a variational solve converges to
#   - See what an insufficient maxiter does to a hybrid optimization
# prerequisites:
#   - lab.nb.py completed
# duration_minutes: 15
# ---

# %% [markdown] role=objective
# ## What you will build
# `lab.nb.py` built a `variational_solve` function for one Hamiltonian. Here you write
# the objective yourself for a different one, minimize it, and then watch what happens
# when the optimizer is not given enough iterations to finish the job.

# %% role=setup
import numpy as np
import qiskit
from qiskit.circuit import Parameter
from qiskit.primitives import StatevectorEstimator
from qiskit.quantum_info import SparsePauliOp
from scipy.optimize import minimize

print(f"qiskit {qiskit.__version__}")

estimator = StatevectorEstimator()
theta = Parameter("theta")
ansatz = qiskit.QuantumCircuit(1)
ansatz.ry(theta, 0)

H_task = SparsePauliOp.from_list([("Z", 0.6), ("X", 0.2)])
x0 = [0.0]

# %% [markdown] role=exercise
# ## Task 1: write the objective and minimize it
# Using `H_task`, `ansatz`, `estimator`, and `x0` from the setup cell: write a function
# `objective(params)` that returns `<H_task>` for the bound circuit as a plain Python
# float, then minimize it with
# `minimize(objective, x0, method="COBYLA", options={"maxiter": 100})`. Store the
# `OptimizeResult` in `result`, the angle it found in `best_theta` (a float), and the
# minimum energy in `best_energy` (a float).

# %% role=solution stub="best_theta = None\nbest_energy = None\nresult = None\n"
def objective(params):
    job = estimator.run([(ansatz, H_task, [list(params)])])
    evs = job.result()[0].data.evs
    return float(np.asarray(evs).reshape(-1)[0])


result = minimize(objective, x0, method="COBYLA", options={"maxiter": 100})
best_theta = float(result.x[0])
best_energy = float(result.fun)
print(f"best_theta={best_theta:.4f}  best_energy={best_energy:.4f}")

# %% [markdown] role=hint
# This is the same shape as `lab.nb.py`'s objective: build the expectation value with
# `estimator.run([(ansatz, H_task, [list(params)])])`, then pull a plain float out of
# `.data.evs` with `float(np.asarray(evs).reshape(-1)[0])`. `minimize` calls your
# function once per candidate `theta` and never looks inside it.

# %% role=checkpoint
if best_energy is not None:
    exact_ground = -np.sqrt(0.6**2 + 0.2**2)
    assert abs(best_energy - exact_ground) < 0.05, (
        f"expected within 0.05 of the exact ground energy {exact_ground:.4f}, got {best_energy:.4f}"
    )

# %% role=checkpoint
if best_theta is not None:
    check_job = estimator.run([(ansatz, H_task, [[best_theta]])])
    check_energy = float(np.asarray(check_job.result()[0].data.evs).reshape(-1)[0])
    assert abs(check_energy - best_energy) < 0.001, (
        f"best_theta={best_theta:.4f} should reproduce best_energy={best_energy:.4f}, "
        f"got {check_energy:.4f} instead"
    )

# %% [markdown] role=exercise
# ## Task 2: what does maxiter=3 do?
# Rerun the same minimization, changing only `options={"maxiter": 3}` — same
# `objective`, same `x0`, same method. Predict first: will 3 iterations reach an
# energy close to `best_energy`, or something clearly worse? Store the new result in
# `short_result` and its minimum in `short_energy` (a float).

# %% role=solution stub="short_energy = None\nshort_result = None\n"
short_result = minimize(objective, x0, method="COBYLA", options={"maxiter": 3})
short_energy = float(short_result.fun)
print(f"maxiter=3   -> energy={short_energy:.4f}, evaluations={short_result.nfev}")
print(f"maxiter=100 -> energy={best_energy:.4f}, evaluations={result.nfev}")

# %% [markdown] role=hint
# COBYLA needs room to shrink its trust region before it can refine an answer; three
# evaluations barely gets past the starting guess. Compare `short_result.nfev` with
# `result.nfev` from task 1 — `maxiter` is a ceiling on evaluations, not a target.

# %% role=checkpoint
if best_energy is not None and short_energy is not None:
    assert short_energy > best_energy + 0.1, (
        f"expected maxiter=3 to land clearly worse than maxiter=100 "
        f"({short_energy:.4f} vs {best_energy:.4f}); if this fails, cross-check "
        "your objective function against lab.nb.py's"
    )

# %% [markdown] role=explain
# Three COBYLA evaluations are not enough to shrink the trust region from its starting
# guess. `maxiter` caps how many times the optimizer may call `objective` — COBYLA can
# stop earlier on its own once it judges itself converged, but it can never exceed
# that cap. A `maxiter` too low for the problem is a common way for a variational
# algorithm to report a confident-looking answer that is really just unfinished.

# %% [markdown] role=summary
# ## What you built
# An `objective` function connecting a Hamiltonian you were handed to
# `scipy.optimize.minimize`, and a direct look at what starving the optimizer of
# iterations does to the answer. Compare your work with the reference solution
# notebook and its self-evaluation checklist.
