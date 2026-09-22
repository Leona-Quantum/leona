# Resource-estimation benchmark — spec (first increment)

ai-ops#357 ("Which benchmark should Leona build under its own name…"), option 1
(recommended), first increment. Owner ruling: "all of them perhaps?", read as build options
1, 2, and 3 in sequence — this increment is option 1 only. Design rationale:
`~/Developer/ai-ops/desk/leona/plans/strategy-20260921/benchmarks-and-jev.md` §3.

## Why this benchmark

Nobody owns an LLM benchmark for fault-tolerant resource estimation. A task asks a model to
estimate the cost of running a *specific, published* quantum algorithm on a *specific,
fully-stated* hardware/QEC configuration — logical qubits, T- or Toffoli-gate count, physical
qubits, and/or runtime. Grading is arithmetic (log-relative error against a paper-derived
reference), not a judgment call, so it cannot be gamed by fluent prose. Every reference number
traces to one paper's specific table, page, or equation — never to Leona's own estimator
(`packages/py/estimation`, estimator v2 from PR 948) — which is the whole credibility case:
a benchmark that grades against its own maker's tool is not evidence of anything.

## Task format

Each case (`cases/<task_id>.yaml`, validated against
`majorana_evals.resource_estimation.schema.ResourceEstimationTask`) has:

- `algorithm`, `problem_size`, `hardware_assumptions` — structured fields for humans and
  tooling to scan at a glance.
- `prompt` — the actual, self-contained text a model is given. States the algorithm, problem
  size, and EVERY hardware/QEC assumption needed to determine the pinned quantities up to the
  stated tolerance. A model is never expected to infer an unstated assumption; if a paper's
  answer depends on something (a code distance, an error budget, a distillation scheme,
  which of several tables/rows), the prompt says so explicitly.
- `assumptions` — the same numbers, each with its exact paper location (table/page/equation),
  for a human reviewer to check the prompt against the source.
- `quantities_pinned` — a subset of `{logical_qubits, t_count, toffoli_count,
  physical_qubits, runtime_value}`, naming only what the SOURCE PAPER actually pins for this
  exact configuration. A case never invents a number the paper doesn't give (see
  "Transcription discipline" below); several cases in this corpus deliberately grade only 2
  or 3 of the 4 possible quantities because the paper doesn't unambiguously pin the rest.
- `reference` / `units` / `tolerance_log10` / `tolerance_rationale` — the answer key, per
  quantity, each with its own justified error band (see "Grading rule").
- `source` — arXiv id, title, full author list (checked against arXiv's own abstract page,
  not a search snippet), venue, exact location, retrieval date.
- `cross_check` — an independent second-tool estimate where one could be run (see "Second-tool
  cross-checks"), or `ran: false` with a stated reason.

### What a model must return

For each quantity in `quantities_pinned`: a plain number (integer for qubit/gate counts; a
number plus a unit string for `runtime_value` — any of `seconds/minutes/hours/days/months/
years`, converted deterministically by the grader). Nothing else is scored. `T-count` and
`Toffoli-count` are never interchangeable in this benchmark: a task asks for whichever gate
type its source paper reports, and a model that answers with the other gate type (even if
numerically converted) is answering a different question the grader does not accept — the
conventional ~4-T-per-Toffoli relationship is architecture- and compilation-dependent, not an
exact identity, so silently converting would launder a wrong answer into a right-looking one.

## Grading rule

**Log-relative error against a per-quantity, per-case band**, in log10 units (0.301 = a
factor of 2; 0.176 = a factor of 1.5). A quantity passes when
`abs(log10(model_value / reference_value)) <= tolerance_log10`, and scores continuously via
linear falloff to 0 at the band edge (`score = max(0, 1 - error/band)`). A task's overall
score is the mean across its pinned quantities; `passed` requires every pinned quantity to
pass.

**Why log-relative, not absolute or linear-relative:** these quantities span nine-plus orders
of magnitude across the corpus (hundreds of logical qubits to 10^11+ gates). A model "wrong by
2x" should be graded the same way whether the reference is 100 or 10^10; a fixed absolute
tolerance cannot do that, and a fixed linear-relative tolerance ("within 20%") barely
constrains huge numbers because a source paper's own rounding is itself usually multiplicative
("~20 million," not "20,000,000 ± 50,000").

**Why every band is justified per quantity, per case, not from one global constant:** how
tightly a number is determined varies with how the source paper itself computed and presented
it — see each case's own `tolerance_rationale`. In outline:

- **Closed-form / exact-arithmetic quantities** (e.g. a logical-qubit count derived from a
  stated register-size formula) get the tightest bands (log10 ≈ 0.03–0.06, factor 1.07–1.15):
  there is essentially no legitimate room for a correct answer to differ.
- **Precise table entries with no disclosed alternative reading** (a paper's own single
  printed number for a fully-specified configuration) get a moderate band (log10 ≈ 0.08–0.10,
  factor 1.2–1.26) to allow for the source's own 2-significant-figure rounding.
- **Numerically-optimized outputs** (a paper's own code-distance/factory-count/Trotter-step
  search over the stated assumptions) get a wider band (log10 ≈ 0.15, factor ~1.4): a
  different but equally valid search over the same assumptions can legitimately land tens of
  percent away.
- **A paper's own internally inconsistent figures** (two different numbers given for what is
  textually the same configuration — this happens more often than a first read suggests; see
  `PROVENANCE.md`) get a band widened just enough to cover the paper's own spread, with the
  spread stated explicitly in `tolerance_rationale` rather than silently picking one number
  and hiding the other.

**Every band is invariant-checked at load time to be strictly less than 1.0** (schema.py's
validator) — a full order of magnitude could not be told apart from the benchmark's own
10x-perturbation negative control, so this is enforced structurally, not left to case-authoring
discipline.

## Anti-contamination argument

A model cannot pass this benchmark by memorizing "the answer" to a famous problem, for two
structural reasons:

1. **The same algorithm and problem size appears under different hardware assumptions with
   different correct answers.** `gidney-ekera-2019-rsa2048`, `gidney-2025-rsa2048`, and
   `beverland-2022-factoring-majorana` all estimate resources for factoring the SAME 2048-bit
   RSA modulus, but under three different constructions/hardware assumptions (plain surface
   code with windowed arithmetic; surface code with approximate residue arithmetic, yoked
   codes and magic state cultivation; Majorana qubits with a Hastings-Haah code) — giving
   physical-qubit answers that differ by roughly 20x and runtimes that differ by roughly 12x
   across the three. A model that has only memorized "RSA-2048 costs ~20 million qubits" from
   one famous paper, without actually using the stated hardware assumptions, fails the other
   two.
2. **Grading is arithmetic under stated assumptions, not free-text matching.** The prompt
   states every assumption needed to determine the answer; the grader checks a number against
   a band. There is no rubric to game with confident, well-formatted prose, and no partial
   credit for citing the right paper while ignoring its stated configuration.

A future, larger increment could raise the bar further by including cases where the SAME
paper's OWN internal parameter sweep (e.g. Kivlichan et al.'s many lattice-size/error-rate
combinations) is queried at multiple different points, so a model must actually interpolate
the paper's own methodology rather than recall one headline number — the corpus already leans
this way (`kivlichan-2020-hubbard-8x8` pins one specific cell out of dozens the paper reports).

## Second-tool cross-checks

Where a case gives a clean logical resource count (qubits + a single gate-type count), it was
independently cross-checked with **Microsoft's Quantum Development Kit resource estimator**
(`qdk` Python package, `qdk.estimator.LogicalCounts.estimate()` — the modern replacement for
the deprecated `qsharp.estimate_custom`), feeding the paper's own logical counts and physical
error rate through the tool's generic surface-code (or, for Majorana qubits, floquet-code)
cost model. Version and exact command are recorded per case in `cross_check`. This ran locally
in under half a second per case (no CPU concern; nothing here needed the cluster).

**Agreement was not required and was not manufactured.** Several cases disagree with the
cross-check by an order of magnitude or more, with a stated, understood cause (a bespoke
technique the generic estimator doesn't model, or an older paper's non-factory-throughput
clocking assumption) — see `PROVENANCE.md` for the full account per case. The REFERENCE value
used for grading is always the source paper's own number: this benchmark tests whether a model
knows what a specific paper reports, not whether that paper's own estimate agrees with a
different, generic tool's model.

## Controls (all zero-spend, no model API call of any kind)

Implemented as offline `ModelAdapter`s in `adapters.py`, exercised in
`evals/harness/tests/test_resource_estimation.py` and via the CLI:

| Adapter | What it does | Required result | Measured result |
|---|---|---|---|
| `reference` | Echoes each task's own reference values verbatim | 100% pass, mean score 1.000 | **9/9 passed, mean score 1.000** |
| `perturbed-10x` | Every pinned quantity × 10 | 0% pass, mean score 0.000 (guaranteed by the `tolerance_log10 < 1` schema invariant — not a coincidence of today's bands) | **0/9 passed, mean score 0.000** |
| `constant-guess` | The same fixed numbers for every task, chosen before consulting any case's own values | Near-zero mean score | **0/9 passed, mean score 0.003** |

**Mutation-check performed during this build** (not a permanent artifact — the point was to
prove the grader is not vacuously passing): `grader.py`'s `passed = log10_abs_error <=
tolerance_log10` line was temporarily replaced with `passed = True`. Re-running the
`perturbed-10x` control against the mutated grader flipped its result to **9/9 "passed"**
(score stayed 0.000, since `score` and `passed` are computed independently — the mutation only
broke the boolean gate). The grader was then reverted and the control re-run, confirming it
correctly returned to 0/9 passed. This shows the control is actually exercising the comparison
logic, not passing/failing regardless of what the grader does.

## What options 2 and 3 would need (next increments, not built here)

**Option 2 — rolling paper-to-code benchmark.** Needs: a pipeline that pulls arXiv papers
newer than every candidate model's training cutoff (a freshness filter re-evaluated per model,
since cutoffs differ), a per-paper curation pass to extract one implementable, well-specified
circuit or subroutine (expert time per paper — the plan estimates 20-30 papers/quarter), and a
grader that checks statevector/unitary equivalence for small circuits (<=20 qubits, exact) or a
behavior contract for larger ones (following this repo's own QCircuitEval-style structural
grading where a functional grader isn't available). Contamination-proofness comes entirely
from freshness, so the pipeline must re-check cutoffs and retire aging cases on a schedule, not
just add new ones.

**Option 3 — SDK-drift leaderboard, re-run on every Qiskit/PennyLane/Cirq release.** Needs: a
small, version-independent task set (a seed could come from this repo's existing
`quantum-api-drift`-style comparison), a CI trigger keyed to upstream SDK releases (not a fixed
schedule — the value is catching a release-triggered regression quickly), and a public
leaderboard page that shows the SAME tasks scored across SDK versions side by side, since the
signal is the DELTA across versions, not any single version's absolute score. As a one-off
(not re-run on every release) this would just repackage the existing MIT-licensed
`quantum-api-drift` benchmark, which is not worth doing under Leona's own name — the value is
entirely in the "live, re-run" property.

## Layout

```
evals/resource-estimation-benchmark/
  SPEC.md            — this file
  README.md          — how to run it
  PROVENANCE.md       — how every case was verified, and why 3 candidates were dropped
  cases/*.yaml        — the 9 cases
evals/harness/src/majorana_evals/resource_estimation/
  schema.py           — ResourceEstimationTask, ModelAnswer, grading result types
  grader.py           — log-relative-error grading
  adapters.py         — ModelAdapter protocol + the 3 offline controls
  loader.py           — case loading, validation, dataset hashing
  runner.py           — drives an adapter over the corpus, aggregates a report
  pricing.py          — prices a hypothetical live run (never executed)
  __main__.py         — CLI
evals/harness/tests/test_resource_estimation.py
```
