# Week 04 — Transpilation

## What this week is about

Weeks 01 through 03 treated a circuit as something you build and then either sample or
inspect directly. This week looks at what has to happen *between* writing a circuit and
running it on a specific backend: reading a backend's `Target` — its basis gates and its
coupling map — and using `generate_preset_pass_manager` to rewrite an abstract circuit
into one that backend can actually execute. No sampling happens this week. The whole lab
is about the shape of a circuit before it runs; Week 05 covers running it.

## Why

A real backend supports only a handful of physical gates, and its qubits are wired
together in a fixed, usually sparse pattern. Every circuit you write — no matter which
gates you reach for — has to be rewritten in terms of that backend's own basis, and every
two-qubit gate has to land on a connection the backend actually has. Skipping this step,
or misjudging what it costs, is one of the most common places a working circuit turns
into a much bigger, much slower one once it meets real hardware. This week makes that
translation visible and checkable instead of a black box between "I wrote a circuit" and
"it ran."

## Vocabulary this week adds

- **Target** — an object describing everything a specific backend supports: its basis
  gates, and which qubit pairs its two-qubit gates can act on.
- **Basis gates** — the small set of physical gates a backend actually implements;
  everything else gets rewritten in terms of them.
- **Coupling map** — the list of qubit pairs a backend can run a two-qubit gate on
  directly.
- **Routing** — inserting SWAP gates so a two-qubit gate lands on a connected pair, when
  the qubits it names are not directly wired together.
- **ISA circuit** — the output of transpilation: instructions from the target's basis,
  addressed to physical qubits, respecting the coupling map. The only kind of circuit a
  real backend, or a faithful simulator of one, can run.
- **`generate_preset_pass_manager`** — builds the pipeline that performs all of the above
  for a chosen backend and optimization level.

## Deliverable

Target-compatible circuit: by the end of the lab you have `to_target_compatible(circuit,
backend)`, a function that turns any small circuit into an ISA circuit for a given
backend, checked against that backend's own `Target` rather than a hardcoded gate list.

## Session plan (90 minutes)

| Time | Activity |
|---|---|
| 10 min | Warm-up: recap week 03's statevector view; compare who predicted the `H`-gate rewrite correctly before running `lab.nb.py`'s first experiment |
| 20 min | Concepts: Target, basis gates, coupling map, ISA circuit — the concept cells in `lab.nb.py` |
| 40 min | Lab: `lab.nb.py` — predict, run, and explain gate decomposition, routing, and optimization levels; build `to_target_compatible` |
| 15 min | Challenge: `challenge.nb.py` — a 4-qubit GHZ and a new coupling map |
| 5 min | Wrap-up: compare answers, write down the lab's open question |

## Prep

Before the session, confirm week 03's environment still works:

```bash
uv run python -c "import qiskit; print(qiskit.__version__)"
```

This should print `2.5.x`. If it does not, revisit week 00's README before this
session — this week assumes a working install, not a fresh one.

## Homework (optional)

Pick any circuit from an earlier week — the Bell state from week 02, or one of the
rotation circuits from week 03 — and run it through `to_target_compatible` on both
backends this lab builds: the fully connected one and the line-topology one. Predict the
depth on each backend before you check it. If the two depths differ by a lot, find which
of the circuit's two-qubit gates the line backend does not directly connect — that gate
is where the extra cost comes from.
