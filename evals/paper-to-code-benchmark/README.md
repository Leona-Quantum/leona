# Paper-to-code benchmark (ai-ops#357 option 2, first increment)

ai-ops#357 option 2: a benchmark built from arXiv quantum-computing papers newer than every
model's training cutoff. See `SPEC.md` for the task format, the cutoff-sourcing argument
(including the one model with no published cutoff at all), and the grading rule;
`PROVENANCE.md` for how every task was sourced and verified, and what was dropped.

**This increment builds and validates the harness. It does not run any real model.** Every
number below comes from one of two zero-spend offline adapters (`adapters.py`) — no adapter
here has ever called a network or a paid model API. A real (future, paid) adapter is out of
scope for this PR.

**Read this before quoting any score from this benchmark**: freshness (a paper posted
after every model's cutoff) does not by itself mean a task is contamination-proof — a
fresh paper can still restate a construction that predates it by years. Every task carries
a `novelty` field (`paper-specific` or `restated`, see `SPEC.md`/`PROVENANCE.md`'s "How
new is each task?"), and every report gives the `paper-specific` score SEPARATELY from the
combined total. **Only the `paper-specific` figure supports a "a model can't have
memorized this" claim.** In this increment that is 2 of the 5 tasks.

## Layout

```
cases/*.yaml          5 cases, each built from one specific arXiv paper (posted 2026-08-18
                       through 2026-09-08, all within 30 days of this PR)
SPEC.md               task format, freshness/cutoff argument, grading rule, controls
PROVENANCE.md         per-task paper sourcing + verification, dropped candidates
```
The harness code (schema, grader, adapters, loader, runner, CLI) lives in
`evals/harness/src/majorana_evals/paper_to_code/`, a sibling module to `resource_estimation`
(PR 953) and `sdk_drift` (this same PR series), reusing their conventions — and reusing
`majorana_sandbox.guard`'s import allowlist directly, the same guard production runs on
model-generated code before it reaches any runner.

## Running it

```bash
# Zero-spend controls — what "run the harness" means until a real model adapter exists:
uv run --package majorana-evals python -m majorana_evals.paper_to_code run \
    --adapter canonical --out /tmp/ptc-canonical.json
uv run --package majorana-evals python -m majorana_evals.paper_to_code run \
    --adapter garbage --out /tmp/ptc-garbage.json
```

No database, no sandbox worker queue, no `DATABASE_URL` needed — this grades a candidate's
Python source directly against its own hidden test in a subprocess, never through Nala's
production pipeline (the same architectural choice `resource_estimation` and `sdk_drift`
made, for the same reason: this benchmark tests a model's raw ability to write a correct
Qiskit function, not whether Nala's code-generation PRODUCT can deliver one).

## What the offline controls found (measured, not simulated)

| Adapter | All 5 tasks | `paper-specific` only (2 tasks) |
|---|---|---|
| `canonical` (positive control) | **5/5 passed (100%)** | **2/2 passed (100%)** |
| `garbage` (negative control — a deliberately wrong body) | **0/5 passed (0%)** | **0/2 passed (0%)** |

The grader was mutation-tested during this build (see `SPEC.md`'s "Controls" section for the
break/observe/revert procedure) to confirm these numbers reflect a real comparison, not a
vacuously-passing check.

## How new is each task?

| Task | Paper | Grading | `novelty` |
|---|---|---|---|
| `virtual-rz-single-layer-ansatz` | 2608.17249 (Fujii) | statevector equivalence | `restated` — a generic hardware-efficient-ansatz template, applied not invented |
| `dicke-state-k1-preparation` | 2608.22892 (Tao, Wang, Zuo) | output distribution | `restated` — the W state, textbook, the paper's own stated special case |
| `belief-propagation-tree-state-prep` | 2608.26840 (Hernández Vera et al.) | output distribution | `paper-specific` — this paper's own BP-to-angle formula and tree composition |
| `ma-qaoa-single-layer` | 2609.02793 (Ashfaq, Byun, Kim) | statevector equivalence | `restated` — multi-angle QAOA is a known prior ansatz variant, restated here |
| `lcu-block-encoding-rate-matrix` | 2609.08432 (Ikeda et al.) | unitary block equivalence | `paper-specific` — this paper's own rate matrix and LCU decomposition |

**Only the 2 `paper-specific` tasks support a freshness/"not memorizable" claim** — see the
banner at the top of this file and `SPEC.md`'s "How new is each task?" for the full
per-task reasoning, checked against each paper by a human reviewer, not self-assessed.

See `PROVENANCE.md` for exactly what each task grades, the verbatim excerpt it is built
from, how each reference solution was independently verified (every one was actually run
against `qiskit==2.5.2` and checked numerically during authoring — never asserted from
reading the paper alone), and the reasoning behind every `novelty` classification.
