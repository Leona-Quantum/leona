# Week 03 — Gates and state

## What this week is about

Weeks 01 and 02 treated a circuit as something you sample: build it, measure it,
count outcomes. This week opens the circuit up far enough to look at what Qiskit
computes *before* any measurement happens — the numbers behind the counts — and uses
that view to predict what a gate will do instead of only observing it afterward.

## Why

Two different circuits can produce identical counts while being different states
underneath, and one gate you meet this week (`RZ`) can change a qubit's state while
leaving every probability exactly where it started. Neither of those is visible if
sampling is the only tool you have. This week adds the smallest amount of math that
makes both visible, then hands you `Statevector` and a Bloch-sphere picture as the
tools for seeing them.

## The math this week adds — and nothing more

- **Amplitude.** Two complex numbers per qubit, one attached to each outcome.
  `Statevector` computes them; you only need to read them.
- **Probability.** `probability = |amplitude| ** 2`.
- **Phase.** The angle part of an amplitude. Invisible in counts alone — visible either
  as a direction on a Bloch-sphere picture, or as a probability shift once a second
  gate makes it interfere with another amplitude.

No matrices are required anywhere in this week. `Operator(qc)` appears exactly once in
the lab, only to show that "the whole circuit" is already one object Qiskit builds for
you — not something you need to construct or read by hand.

## Deliverable

Gate prediction experiments: by the end of the lab and challenge, you can compute a
single-qubit rotation circuit's outcome probabilities — and the angle needed to hit a
target probability — without running the circuit first.

## Session plan (90 minutes)

| Time | Activity |
|---|---|
| 10 min | Warm-up: recap week 02's Bell state and bitstring order; compare who predicted correctly last week |
| 20 min | Concepts: amplitude, probability, phase — the second cell of `lab.nb.py` |
| 40 min | Lab: `lab.nb.py` — predict, run, and explain `RX`, `RY`, `RZ`, and the `H`-`Z`-`H` interference experiment |
| 15 min | Challenge: `challenge.nb.py` — gate prediction experiments |
| 5 min | Wrap-up: compare answers, write down the lab's open question |

## Prep

Before the session, confirm week 02's environment still works:

```bash
uv run python -c "import qiskit; print(qiskit.__version__)"
```

This should print `2.5.x`. If it does not, revisit week 00's README before this
session — this week assumes a working install, not a fresh one.

## Homework (optional)

Pick any single-qubit circuit built from `RX`, `RY`, `RZ`, `H`, and `Z` gates that you
did not try in the lab or challenge. Predict its outcome probabilities on paper first,
then check yourself with `Statevector`. If your prediction was wrong, find which gate's
effect you misjudged — usually it is confusing a probability change with a phase-only
change, the exact distinction this week is about.
