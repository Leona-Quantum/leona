# Week 07 self-evaluation

Go through this after finishing `lab.ipynb` and attempting `challenge.ipynb`. It is for
you, not for anyone to grade — the point is noticing what actually happened, not
checking boxes for their own sake.

- [ ] You predicted `<Z>` at `theta = 0` and `theta = pi` before running the sweep, and
      your predictions matched the curve's endpoints.
- [ ] You can explain, without looking it up, why an `objective(params) -> float`
      function is what a classical optimizer needs — and why it does not need to know
      a quantum primitive is inside it.
- [ ] You predicted the minimum energy from the coarse sweep before running
      `scipy.optimize.minimize`, and the optimizer's answer landed below your
      grid-based guess.
- [ ] `result.fun` came out within `0.05` of the exact ground energy
      $-\sqrt{0.5^2 + 0.3^2} \approx -0.5831$.
- [ ] Two different starting points (`x0 = [0.1]` and `x0 = [3.0]`) converged to the
      same minimum, within `0.01`.
- [ ] You changed the Hamiltonian's coefficients and confirmed the optimizer's answer
      tracked the new exact ground energy, not the old one.
- [ ] You can say, in your own words, what "hybrid" means here: which part is
      classical, which part is quantum, and where the boundary between them sits.
- [ ] The two-qubit `real_amplitudes(2, reps=1)` run converged to within `0.05` of its
      exact ground energy, in well under a second.
- [ ] You can explain why the two-qubit run stayed fast (a 4-amplitude statevector),
      and why the `CX` gate in the ansatz was necessary for correctness, not speed.
- [ ] `variational_solve(H, x0)` reproduced the same minimum you had already found by
      hand for both Hamiltonians in the lab.
- [ ] All checkpoint cells in `lab.ipynb` passed without an `AssertionError`.
- [ ] You attempted `challenge.ipynb` yourself — including predicting what `maxiter=3`
      would do — before opening `challenge_solution.ipynb`.

One remaining question: _______________________________________________
