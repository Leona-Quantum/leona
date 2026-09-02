# Week 05 self-evaluation

Go through this after finishing `lab.ipynb` and attempting `challenge.ipynb`. It is for
you, not for anyone to grade — the point is noticing what actually happened, not
checking boxes for their own sake.

- [ ] You can say, without looking it up, which primitive answers "what outcomes come
      out and how often" and which answers "what is this observable's average."
- [ ] You read counts off two different classical registers — `meas` (from
      `measure_all()`) and `c` (a register you named yourself) — and can say why the
      attribute name changed between them.
- [ ] `<ZZ>` on the Bell circuit came out extremely close to `1.0`, and you can explain
      why in terms of the two outcomes you saw from `Sampler`, not just "the checkpoint
      passed."
- [ ] You predicted `<ZI>` and `<XX>` before running them, and your prediction for at
      least one of them was wrong in a way you can now explain — entanglement showing
      up in a basis other than the one you measured in.
- [ ] The `theta` sweep produced nine expectation values in a single `run` call, and
      you can point to where in the PUB the nine parameter values went.
- [ ] Every `role=checkpoint` cell in `lab.ipynb` passed without an `AssertionError`.
- [ ] You filled in the five-task selection table yourself, before opening the
      challenge notebook.
- [ ] Your `selection` dict in `challenge.ipynb` matched the checkpoint on the first
      try — or, if it didn't, you can now say which task you had backwards and why.
- [ ] You attempted `challenge.ipynb` yourself before opening
      `challenge_solution.ipynb`.

One remaining question: _______________________________________________
