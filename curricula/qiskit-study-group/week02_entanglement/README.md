# Week 02 — Multiple qubits

## What this week is about

Week 01 worked with one qubit at a time. This week moves to two (and, in the
challenge, three), and adds the gate that connects them: `cx`, controlled-X. The lab
compares two qubits that never interact against two qubits linked by a `cx`, verifies
the rule Qiskit uses to write a multi-qubit result as a bitstring, then breaks the
linked circuit three different ways to isolate what each piece of it is doing.

## Why

A `cx` gate applied to a qubit that is already in superposition builds a **Bell
state** — the standard example of **entanglement**, where two qubits' measured values
are tied together in a way two independently prepared qubits' values never are. This
is the first genuinely two-qubit behavior in the course, and it is also where the most
common bitstring-reading mistake shows up: Qiskit writes qubit 0 as the *rightmost*
character of a count key, the opposite of how most people would guess. Every week
after this one assumes you can read a Qiskit bitstring correctly, so this week checks
it with an experiment instead of just stating it.

## Deliverable

A correlated-bit generator: a function that returns many correlated `(qubit_0,
qubit_1)` bit pairs from a single sampler run, built on the Bell state from the lab.

## Session plan (90 minutes)

| Time | Activity |
|---|---|
| 10 min | Warm-up: recap week 01's coin and sampling noise; two volunteers each flip a real coin twice and compare — a bridge into "what if the two flips were linked?" |
| 20 min | Concepts: two qubits and four outcomes, the `cx` gate, the bitstring order — the concept cells in `lab.nb.py` |
| 40 min | Lab: `lab.nb.py` — independent coins vs. the Bell state, the bitstring-order experiment, three ways of breaking the Bell circuit, the correlated-bit generator |
| 15 min | Challenge: `challenge.nb.py` — a three-qubit GHZ state, then an anti-correlated generator built a second way |
| 5 min | Wrap-up: compare predictions, write down the lab's open question |

## Prep

Before the session, confirm week 01's environment still works:

```bash
uv run python -c "import qiskit; print(qiskit.__version__)"
```

This should print `2.5.x`. If it does not, revisit week 00's README before this
session.

## Homework (optional)

The lab's Modify 2 built an anti-correlated pair by flipping qubit 1 *before* the
entangling `cx`; the challenge builds one by flipping qubit 1 *after*. This time, flip
qubit 0 instead: build one circuit with `x(0)` *before* `h(0)` and `cx(0, 1)`, and a
second with `x(0)` *after* them. Predict both outcomes before running either. One of
the two behaves like the lab and challenge's anti-correlated pairs; the other does not
change the counts at all. Find out which is which, and see if you can explain why
flipping the same qubit at a different point in the circuit makes the difference —
week 03 gives you a tool (`Statevector`) that makes the reason visible directly.
