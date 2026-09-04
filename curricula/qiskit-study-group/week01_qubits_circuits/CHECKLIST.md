# Week 01 self-evaluation

Go through this after finishing `lab.ipynb` and attempting `challenge.ipynb`. It is for
you, not for anyone to grade — the point is noticing what actually happened, not checking
boxes for their own sake.

- [ ] You wrote a specific numeric prediction before running each of the four experiments
      in `lab.ipynb`, not just "about half" or "I don't know."
- [ ] You can say, without looking it up, why `X` then measure always reads `1`, while `H`
      then measure only reads `1` about half the time.
- [ ] You can explain, in your own words, why `H`, `H` cancels back to a deterministic `0`
      — the light-switch analogy, or your own version of it.
- [ ] The `role=figure` cells rendered both a circuit drawing and a histogram — if neither
      showed an image, matplotlib or pylatexenc may be missing (see
      `week00_setup/README.md`'s "Common install failures").
- [ ] Your three repeated runs of the same fair-coin circuit in the "shots and
      fluctuation" section produced close-but-not-identical counts, and you can explain
      why that is expected rather than a bug.
- [ ] All three `role=checkpoint` cells in `lab.ipynb` passed without an `AssertionError`.
- [ ] `flip_quantum_coin(shots=1000, seed=...)` runs and returns heads/tails counts near a
      50/50 split for at least two different seeds you tried yourself.
- [ ] You attempted both tasks in `challenge.ipynb` yourself — including writing a
      predicted probability for the biased coin by hand — before opening
      `challenge_solution.ipynb`.
- [ ] Your measured `p1_measured` in the challenge landed close to 0.25, and you can say
      why 0.25 is the number the formula predicts for `theta = pi / 3`.

One remaining question: _______________________________________________
