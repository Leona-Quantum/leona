# Week 06 — Grover search

Oracles, phase marking, and interference: the session where "flip a sign nobody can
see" turns into "find the answer in one query." You will build every gate yourself,
from `QuantumCircuit` primitives — the oracle and the diffusion operator are both
things you assemble by hand, not something you import ready-made.

**Deliverable:** a two-qubit Grover circuit — a phase oracle plus a diffusion operator,
composed into one Grover iteration, that finds a single marked state out of four with
better than 95% success on 4000 sampled shots.

## Before the session

- **Week 03** (phase, `Statevector`) and **Week 05** (`StatevectorSampler`) should
  already be comfortable. This lab leans on both: reading amplitudes out of a
  `Statevector`, and sampling a circuit with a seeded primitive.
- No new install. If `qc.draw("mpl")` or `plot_histogram` errored for you in an
  earlier week, revisit Week 00's README before this session — the fix is the same one.
- Skim the objective and first concept cell of `lab.ipynb` beforehand if you can; the
  rest works better live, with a partner to compare predictions against.

## Key ideas, one paragraph each

**Phase oracle.** An oracle that answers "is this the marked item?" by flipping the
*sign* of the marked state's amplitude, not by writing a yes/no answer anywhere you can
read directly. For two qubits marking a specific computational state, that oracle is a
single controlled-Z gate.

**Phase kickback.** The general mechanism behind phase oracles: a bit-flip oracle
(one that flips a separate output qubit when the input matches) becomes a phase oracle
when that output qubit starts in `(|0> - |1>) / sqrt(2)` — the flip "kicks back" onto
the input as a global sign instead of showing up on the output qubit. The lab's direct
CZ oracle is the two-qubit case where that ancilla step is not needed.

**Diffusion.** An operator that reflects every amplitude about their average. An
amplitude sitting below the average — like the one the oracle just made negative —
ends up further from the average and on the positive side after one reflection.

**Amplitude amplification.** The pattern of alternating a phase oracle with a
diffusion step, repeated the right number of times for how many items you are
searching. Grover's algorithm is the best-known instance of it. For four items with
one marked, one iteration is exact; the challenge notebook shows what happens with
more items, and with too many iterations.

## Session plan (90 minutes)

| Time | What |
|---|---|
| 10 min | Warm-up: recap Week 03's amplitude-vs-probability distinction and Week 05's `StatevectorSampler` call, since both are load-bearing here. |
| 20 min | Concepts: work through the oracle, phase kickback, and diffusion sections of `lab.ipynb` as a group, pausing at each `role=predict` cell to write a guess before running. |
| 40 min | Lab: run `lab.ipynb` top to bottom, in pairs if possible — one person predicts out loud, the other runs the cell. |
| 15 min | Challenge: attempt `challenge.ipynb` without opening the solution. |
| 5 min | Wrap-up: compare your Task 2 prediction (three iterations on two qubits) against what you actually measured, and write down the one remaining question. |

## Homework (optional)

- Attempt `challenge.ipynb` fully before comparing against
  `solutions/week06_grover/challenge_solution.ipynb`.
- Complete `solutions/week06_grover/SELF_EVALUATION.md` and record one remaining
  question.
- If you want to go further: predict what the optimal iteration count and success
  probability would be for five qubits with one marked state (32 items), using the
  same `theta = arcsin(sqrt(1/N))` formula the challenge notebook's hints introduce.
  Nothing in `challenge.ipynb` checks this — it is just a way to see the pattern
  generalize past three qubits.

## Next

Week 07 moves from a fixed circuit that already computes the right answer to a
circuit with adjustable knobs — `Parameter`, an objective function, and a classical
optimizer searching for the setting that minimizes it. Grover search still counts as
one query per iteration; Week 07's hybrid loop counts iterations of a very different
kind.
