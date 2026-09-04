# Week 07 — Hybrid algorithms

A 90-minute session on the pattern behind VQE and QAOA: a parameterized circuit, an
objective function, and a classical optimizer that never looks inside the circuit —
it just calls a Python function and reads back a number.

**Deliverable:** a one-qubit variational solver — `lab.ipynb` run top to bottom, with
`variational_solve(H, x0)` finding the ground energy of a Hamiltonian you did not
diagonalize by hand.

## Prep before the session

- Have Week 05 (primitives) fresh: this week reuses `StatevectorEstimator` and
  `SparsePauliOp` exactly as they appeared there, just with a parameterized circuit
  instead of a fixed one.
- Skim `qiskit.circuit.Parameter` in the Qiskit API reference if you have not used a
  parameterized circuit before — the lab introduces it from scratch, but a first
  glance helps.
- No new install steps. If `lab.ipynb` does not open cleanly, revisit
  `week00_setup/README.md`.

## The 90 minutes

| Segment | Minutes | What happens |
|---|---|---|
| Warm-up | 10 | Recap Week 06's Grover circuit; ask: what would it mean for a circuit to have a *tunable* gate instead of a fixed one? |
| Concepts | 20 | `Parameter`, the objective-function pattern, and what "hybrid" means: classical optimizer proposes, quantum primitive estimates. |
| Lab | 40 | Work through `lab.ipynb`: sweep a one-qubit landscape, minimize it with `scipy.optimize.minimize`, then scale to two qubits. |
| Challenge | 15 | Attempt `challenge.ipynb` without opening the solutions. |
| Wrap-up | 5 | Compare answers, record one remaining question. |

## What the lab covers

1. **An ansatz with a knob.** `RY(theta)` on one qubit, with `theta` a `Parameter`
   instead of a fixed number. You sweep it and watch `<Z>` trace out a cosine.
2. **The objective function.** A Hamiltonian `H = 0.5*Z + 0.3*X`, and a plain Python
   function `objective(params) -> float` that builds the circuit, asks
   `StatevectorEstimator` for `<H>`, and returns a float. Nothing about the function's
   signature reveals a quantum computer is inside it.
3. **The optimizer.** `scipy.optimize.minimize` with `method="COBYLA"` searches for
   the `theta` that minimizes `objective`. You predict the answer from a coarse sweep
   first, then check it against the exact ground energy,
   $-\sqrt{0.5^2 + 0.3^2} \approx -0.5831$.
4. **Scaling up.** The identical pattern — ansatz, objective, optimizer — applied to a
   two-qubit `real_amplitudes(2, reps=1)` ansatz and a small toy Hamiltonian shaped
   like a minimal-basis H2 problem. Same shape, four parameters instead of one.
5. **The deliverable.** `variational_solve(H, x0)`: the whole one-qubit pattern
   packaged as a function you can hand any two-term Hamiltonian.

## Common sticking points

- **`objective` returns an array, and `scipy.optimize.minimize` errors with
  `TypeError: only length-1 arrays can be converted to Python scalars`.**
  `job.result()[0].data.evs` is a NumPy array, even for a single parameter binding.
  Pull out a plain float: `float(np.asarray(evs).reshape(-1)[0])`.
- **The Estimator call raises about measurements.** A circuit you pass to
  `StatevectorEstimator` must have no `measure` instructions — that is what makes it
  an expectation value instead of a sample. Keep `measure_all()` out of `ansatz`.
- **Two different `x0` values gave visibly different minima.** For the Hamiltonians in
  this lab there is exactly one minimum in `[0, 2*pi)`, so both runs should agree
  within about `0.01`. If they do not, check that both calls reused the same `H` and
  the same `objective` function — a stale `H` from an earlier cell is the usual cause.
- **`real_amplitudes(2, reps=1).num_parameters` is not what you expected.** `reps`
  counts entangling layers, not parameters; each layer adds one `RY` per qubit. At
  `reps=1` on 2 qubits that is 4 parameters (2 before the `CX`, 2 after).
- **The 2-qubit checkpoint is close but not exact.** The checkpoint is a threshold —
  "below the exact ground energy plus a margin" — not equality. COBYLA with a finite
  `maxiter` is not guaranteed to land on the exact minimum, only close to it.

## Homework (optional)

- Attempt `challenge.ipynb` fully before comparing against
  `solutions/week07_variational/challenge_solution.ipynb`, then complete
  `solutions/week07_variational/SELF_EVALUATION.md` and record one remaining question.
- If you want to go further: pick your own one-qubit Hamiltonian
  `H = a*Z + b*X` (any two real coefficients) and call `variational_solve(H, x0=[0.1])`.
  Compare `result.fun` against `-sqrt(a**2 + b**2)`, computed by hand from the
  coefficients you chose. Nothing in `lab.ipynb` checks this — it is a way to confirm
  the function generalizes past the two Hamiltonians it was built and tested against.

## Next

Week 08 is the mini project — pick a template that builds on the primitive and
optimizer patterns from this week.
