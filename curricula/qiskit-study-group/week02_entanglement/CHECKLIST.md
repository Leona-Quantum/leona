# Week 02 self-evaluation

Go through this after finishing `lab.ipynb` and attempting `challenge.ipynb`. It is for
you, not for anyone to grade — the point is noticing what actually happened, not
checking boxes for their own sake.

- [ ] You wrote a specific numeric guess for the four-outcome distribution *before*
      running the independent-coins circuit, and again before running the Bell circuit
      — not just "about equal" or "mostly the same."
- [ ] You can say, without looking it up, which two of the four outcomes a Bell state
      (`h(0)`, `cx(0, 1)`) almost never produces.
- [ ] You can explain the Bell state's correlation in your own words without saying
      anything about one qubit influencing the other, sending a signal, or acting at a
      distance — only what the `cx` gate built into the state.
- [ ] Before looking at the observe cell, you correctly guessed whether flipping only
      qubit 0 reads as `"01"` or `"10"`. If you guessed wrong the first time, you can
      now state Qiskit's bitstring-order rule from memory.
- [ ] You can say what went wrong in each of the lab's three "break the Bell state"
      modifications — the swapped `cx` arguments, the pre-entangling flip, and measuring
      only one qubit — in your own words, not by re-reading the explain cells.
- [ ] All four `role=checkpoint` cells in `lab.ipynb` passed without an
      `AssertionError`.
- [ ] `correlated_bit_pairs(20, seed=7)` printed pairs you can read directly — you can
      point at one tuple and say which number is qubit 0's bit and which is qubit 1's.
- [ ] You attempted `challenge.ipynb` yourself — including writing down a prediction for
      both tasks — before opening `challenge_solution.ipynb`.
- [ ] In the challenge, you can explain why flipping a qubit *after* the entangling
      gates still produces anti-correlated pairs, the same as the lab's Modify 2 did by
      flipping a qubit *before* them, rather than breaking the correlation outright.

One remaining question: _______________________________________________
