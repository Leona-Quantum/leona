# Week 04 self-evaluation

Go through this after finishing `lab.ipynb` and attempting `challenge.ipynb`. It is for
you, not for anyone to grade — the point is noticing what actually happened, not
checking boxes for their own sake.

- [ ] You can say, in your own words, what a `Target` describes and how the basis gates
      and the coupling map are two different pieces of that description.
- [ ] You correctly predicted, before running it, what `H` becomes once transpiled into
      a `cx, id, rz, sx, x` basis.
- [ ] You can explain why a `SWAP` gate costs three `CX` gates once it is transpiled into
      this basis, and why that shows up as extra `cx` count rather than a new gate name.
- [ ] You built a circuit whose two-qubit gates needed a qubit pair the line backend did
      not directly connect, and watched the `cx` count and depth both grow.
- [ ] You compared `optimization_level=0` and `optimization_level=3` on the same circuit
      and saw the depth not increase between them.
- [ ] You can read an ISA circuit's drawing and explain what a `q_0 -> N` label means.
- [ ] Every instruction in each ISA circuit you produced — apart from `barrier` — came
      from that backend's own `target.operation_names`, not a gate list you memorized.
- [ ] All four `role=checkpoint` cells in `lab.ipynb` passed without an `AssertionError`.
- [ ] You attempted `challenge.ipynb` yourself — including finding the branch backend's
      connected pairs by reading its coupling map, not by transpiling something and
      guessing from the result — before opening `challenge_solution.ipynb`.

One remaining question: _______________________________________________
