# Week 08 — Mini project

This is the capstone session. There is no new Qiskit concept this week — instead, a
team of 2-3 builds one small project that integrates several weeks of the course at
once, then demos it. The deliverable is the demo itself, not a written report.

**Deliverable:** Team demo — a working checkpoint, a stated prediction, and one
explained modification, shown live to the rest of the study group.

## Before the session

1. Form a team of 2-3. Working alone is possible but the 90-minute budget assumes a
   team splitting the milestones.
2. As a team, pick **one** of the three project templates below. Skim its README entry
   and its `templates/*.nb.py` file before the session so you are not choosing cold.
3. Make sure `uv sync --locked --extra notebooks` has been run and your kernel is
   selected — this week assumes Week 00's environment already works. If it does not,
   fix that first; do not spend project time on install problems.

## The 90-minute format

| Time | What happens |
|---|---|
| 0–10 min | Form teams, pick a template, read its milestones together. Agree who owns which milestone. |
| 10–65 min | Work through the template's milestones in order. Each milestone is a `role=exercise` cell followed by scaffold code that already runs — extend or verify it, do not rewrite it from scratch. Get the `role=checkpoint` cell(s) passing. |
| 65–80 min | Prepare the demo: write down the prediction each milestone asked for (if you have not already), pick **one** modification to make and try it, and be ready to explain what changed and why. |
| 80–90 min | Team demos. With more than 3-4 teams, keep each demo to 2-3 minutes — show the checkpoint passing, state the prediction you made, and explain your one modification. |

If your team finishes the milestones early, use the remaining time on the modification
and the explanation, not on a second template — depth beats breadth this week.

## Rubric

A team demo is evaluated on four things, not on how much extra code got written:

- **Correctness.** The template's `role=checkpoint` cell(s) pass, unedited or edited
  honestly (loosening a checkpoint to force a pass does not count as correct). Compare
  against the matching `reference/*.nb.py` file if you are unsure your approach is
  sound.
- **Explanation quality.** The team can say, in their own words and without reading
  from the notebook, *why* the checkpoint passes — not just that it does. "The
  correlation is near 1 because measuring the same basis on both qubits of a Bell pair
  always agrees" is an explanation; "the assert didn't fail" is not.
- **One modification, explained.** Every team changes one thing beyond the milestones —
  a different marked state, a different shot count, a broken variant that fails the
  checkpoint on purpose — and explains what changed and why. Each template's
  `README.md` entry below and its notebook's final exercise cell suggest a natural one;
  you are not required to use that exact suggestion.
- **Predictions recorded.** Each milestone that asks for a prediction has one written
  down — a specific guess, not "I don't know" — from *before* the team ran that cell,
  not reconstructed afterward. This is the same predict-before-run habit from every
  earlier week, applied to a bigger unit of work.

## The three project templates

Each template is a working starting point in `templates/`, with milestone cells your
team completes and extends, plus a `role=checkpoint` verifying the integration. Each
has a matching complete answer in `reference/` for after your team has a passing
checkpoint — read it, do not start from it.

### `random_bits.nb.py` — quantum random bit generator

Build a bit generator from a one-qubit circuit, then check the resulting stream for
bias and for clumping (a runs test). Integrates:

- **Week 01** — the `H` gate and measurement that make each bit.
- **Week 02** — bitstring order (qubit 0 is the rightmost character), which matters
  once you are reading many single-bit outcomes in sequence.
- **Week 05** — `SamplerV2` and its result objects, called once per bit.

The notebook is explicit that the simulator's randomness is a seeded PRNG, not physical
randomness — the project is about the circuit-and-verification pipeline, which is the
same pipeline you would use against a real QPU's hardware-sourced bits.

### `bell_certifier.nb.py` — Bell-pair certifier

Measure a Bell pair in the Z basis and the X basis with `SamplerV2`, compute a
correlation coefficient for each, and check both land near +1 — then build a
non-entangled control circuit and confirm its correlation lands near 0. Integrates:

- **Week 02** — the `CX` gate, the Bell state, and the idea of correlation between two
  qubits' outcomes.
- **Week 03** — basis rotation: applying `H` before measurement changes which basis you
  are effectively measuring.
- **Week 05** — `SamplerV2` and result objects, called in two different bases.

### `grover_3q.nb.py` — 3-qubit Grover search

Extend Week 06's 2-qubit Grover oracle and diffusion operator to 3 qubits, transpile
the result to a target with `GenericBackendV2`, and compare the ideal circuit's depth
against the ISA circuit's — then compare 1 vs. 2 vs. 3 Grover iterations and see the
success probability peak and then fall. Integrates:

- **Week 04** — `Target`, basis gates, `generate_preset_pass_manager`, and what an ISA
  circuit is.
- **Week 05** — `SamplerV2` and result objects.
- **Week 06** — the oracle/diffusion construction itself, extended by one qubit.

## After the session

Complete `CHECKLIST.md` (rendered into `solutions/week08_project/SELF_EVALUATION.md`)
as a team. If your team wants to see how the other two templates work, the
`reference/` notebooks for all three are worth ten minutes each on your own time — Week
08 is the last teaching week before the optional hardware bonus chapter and the
certification track.
