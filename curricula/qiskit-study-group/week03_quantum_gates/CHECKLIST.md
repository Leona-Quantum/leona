# Week 03 self-evaluation

Work through this after comparing your challenge attempt with the solution notebook.
It is for you, not for anyone to grade — the point is noticing what actually happened,
not checking boxes for their own sake.

## Concepts

- [ ] I can state, without looking it up, that `probability = |amplitude| ** 2`.
- [ ] I can explain why `RZ` applied on its own to `|0>` never changes any
      probability.
- [ ] I can explain, in terms of amplitudes adding, why `H`, `Z`, `H` turns an
      invisible phase flip into a full, visible flip.
- [ ] I can read a Bloch-sphere picture: distance from a pole is probability,
      rotation around the vertical axis is phase.

## Skills

- [ ] I can get a circuit's amplitudes with `Statevector(qc)` before adding any
      measurement.
- [ ] I know that `Statevector.probabilities_dict()` drops outcomes at exactly zero
      probability, and I default with `.get(outcome, 0.0)` instead of indexing
      directly.
- [ ] I can compute `P(0)` and `P(1)` for `RY(theta)` applied to `|0>` from `theta`
      alone, without running the circuit.
- [ ] I can find the angle `theta` that makes an `H`, `RZ(theta)`, `H` circuit hit a
      target `P(1)`.

## Where I got stuck

Write down anything from the lab or challenge that still does not make sense — bring
it to the next session, or check it against
`solutions/week03_quantum_gates/challenge_solution.ipynb`.

## One remaining question

_(from the lab's closing cell, or your own)_

______________________________________________________________________
