# Week 06 self-evaluation

Go through this after finishing `lab.ipynb` and attempting `challenge.ipynb`. It is for
you, not for anyone to grade — the point is noticing what actually happened, not
checking boxes for their own sake.

- [ ] You wrote a specific numeric prediction (not "it should go up") for the
      probability of `11` right after the CZ oracle ran, before running the cell that
      revealed it was unchanged at 25%.
- [ ] You can explain, in your own words, why flipping an amplitude's sign from `0.5`
      to `-0.5` did not change any measurement probability, and what would have to
      happen for that sign flip to matter.
- [ ] You can state the diffusion operator's one-sentence description ("reflect every
      amplitude about their average") and connect it to the actual arithmetic:
      `2 * mean - amplitude`.
- [ ] You predicted the exact success probability after one Grover iteration on two
      qubits — a number, not a direction — before running the cell that confirmed it.
- [ ] Both the hand-built circuit (oracle composed with your own `diffusion_operator`)
      and `qiskit.circuit.library.grover_operator(oracle)` gave the same probabilities
      when you compared them.
- [ ] You changed the marked state from `11` to `01` yourself and got the same
      near-certain result, and you can say why the recipe did not need to change.
- [ ] Every `role=checkpoint` cell in `lab.ipynb` passed without an `AssertionError`.
- [ ] In `challenge.ipynb`, your three-qubit, two-iteration circuit found its target
      more than 90% of the time — close to the 94.5% the exact statevector gives.
- [ ] In `challenge.ipynb`, running a third iteration on the two-qubit search made
      things *worse*, not better, and you can explain why in terms of the reflection
      going past its peak rather than stopping there.
- [ ] You attempted `challenge.ipynb` yourself before opening
      `challenge_solution.ipynb`.

One remaining question: _______________________________________________
