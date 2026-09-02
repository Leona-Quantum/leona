# Week 05 — Primitives

## What this week is about

Weeks 01–04 sampled circuits by hand and read counts off `result[0].data.meas` (or
transpiled them for a target). This week names the tool that has been doing that work
— `Sampler` — and introduces its counterpart, `Estimator`, which skips sampling
altogether and hands back one number: the exact average of an observable on a
circuit's state.

Every quantum program you write after this week is really answering one of two
questions: "what outcomes come out, and how often?" (`Sampler`) or "what is the
average value of this observable?" (`Estimator`). Learning to tell which question a
task is asking is the actual skill — the API calls are short once you know which
primitive to reach for.

## Why

Grover's algorithm in week 06 wants a distribution over outcomes: which bitstring got
amplified. The variational solver in week 07 wants a single number to minimize: an
energy. Both are primitive calls you already know how to make by the end of this week
— the only new judgment is picking the right one, which is why the deliverable is a
selection exercise rather than another circuit to build.

## Deliverable

Primitive selection exercise: a short table matching five realistic tasks to `Sampler`
or `Estimator`, filled in during the lab and turned into a checkable dict in the
challenge notebook.

## Session plan (90 minutes)

| Time | Activity |
|---|---|
| 10 min | Warm-up: recall how `result[0].data.meas.get_counts()` worked in week 01–02 |
| 20 min | Concepts: the two questions, the PUB, `SparsePauliOp` observables |
| 40 min | Lab: Sampler counts and bitstrings, Estimator on a Bell state (`ZZ`, `ZI`, `XX`), a `Parameter` sweep, the selection table |
| 15 min | Challenge: the selection dict, an observable on a GHZ-3 state |
| 5 min | Wrap-up: one remaining question, self-evaluation |

## Prep

Before the session, skim your week 02 notes on the Bell circuit (`h(0)`, `cx(0, 1)`)
and its bit order — this week reuses that circuit throughout instead of building a new
one, so the new material is the primitive, not the circuit.

## Homework

Optional: pick one of the five tasks from the lab's selection table and write, in a
sentence or two, what a wrong choice would actually cost — for example, what happens
if you call `Sampler` on a task that needed an exact average, or `Estimator` on a task
that needed a specific bitstring. This is not graded; it is meant to make the
distinction stick before week 06 hands you a task that needs one specific answer.

## Next

Once both notebooks run clean, compare your challenge answers with
`solutions/week05_primitives/challenge_solution.ipynb` and complete
`solutions/week05_primitives/SELF_EVALUATION.md`. Week 06 uses `Sampler` to read out
Grover's amplified state.
