# Week 01 — Qubits and circuits

Your first real quantum-computing session, about 90 minutes. You will build a one-qubit
circuit, apply the two gates that matter most for this week (`X` and `H`), sample it, and
turn it into a small working function.

**Deliverable:** a quantum coin — `flip_quantum_coin(shots, seed)` from `lab.ipynb`, a
function that samples a fair-coin circuit and reports heads-versus-tails counts.

## Prep reading (before the session)

Fifteen minutes, no notebook needed:

- Skim this file's "What a qubit is" section below once, so the coin-flip framing is
  already familiar when the session starts.
- Reread `week00_setup/README.md`'s "What the setup cell must print" section if it has
  been a while since Week 00 — you should have `qiskit 2.5.x` printing cleanly before this
  session starts.
- Optional: open `lab.ipynb` and read through it without running anything, just to see the
  shape of the session. Do not run cells yet — the predictions only mean something if you
  write your guess before you see the answer.

## What a qubit is

A classical bit is always exactly 0 or 1, nothing in between. A qubit is a piece of quantum
hardware you can put into a state that is not yet either one — like a coin the instant
after you flip it, still spinning in the air, where "heads" and "tails" are both still live
possibilities. The moment the coin lands, one of them becomes the answer, and not before.
A qubit works the same way: code can prepare a "spinning" qubit, and *measuring* it is what
makes it land on one definite classical bit. Different gates prepare different kinds of
spin — some leave the coin certain to land a particular way, some make it a genuine
50/50 toss, and this week you build both kinds and watch the difference.

## The 90-minute plan

- **Warm-up (10 min).** Recap Week 00's install check together. Ask: did everyone's setup
  cell print `qiskit 2.5.x`? Then pose the coin-flip framing above out loud — "spinning
  coin, not yet landed" — and let people react before opening any notebook.
- **Concepts (20 min).** Walk through `lab.ipynb`'s first five cells as a group: what a
  qubit is, the `|0⟩`/`|1⟩` labels, and what "shots" and "counts" mean. Stop after each and
  ask someone to restate it in their own words before moving on.
- **Lab (40 min).** Everyone works through the rest of `lab.ipynb` at their own pace,
  writing a prediction before running each experiment cell. Circulate and check that
  people are actually writing a number down, not just running cells and reading the
  output.
- **Challenge (15 min).** Open `challenge.ipynb` and attempt both tasks without opening
  `solutions/week01_qubits_circuits/challenge_solution.ipynb`. It is fine to finish only
  the first task in the time available.
- **Wrap-up (5 min).** Compare answers as a group. Everyone writes down one remaining
  question — from the summary cell's prompt, or their own — before leaving.

## Homework (optional)

Not required for Week 02, but worth doing if you want more practice:

- Finish `challenge.ipynb` if you did not get to Task 2 during the session, then compare
  with the reference solution and complete
  `solutions/week01_qubits_circuits/SELF_EVALUATION.md`.
- In `lab.ipynb`, add one more experiment cell of your own: try `H`, `X`, `H` (an `X`
  *between* the two `H` gates, not before or after them) and predict the result before
  running it. It lands on the same deterministic outcome as plain `H`, `H` — as if the `X`
  in the middle had no effect at all, even though `X` alone always flips a qubit. See if
  you can work out why before Week 03 covers the machinery that explains it.

## Next

Week 02 introduces a second qubit and the `CX` gate, which is the first gate in this course
that touches more than one qubit at a time — the challenge's three-coins circuit deliberately
avoided that. Bring a working `flip_quantum_coin` function; Week 02 builds directly on the
one-qubit intuition from this session.
