# Paper-to-code benchmark — spec (first increment)

ai-ops#357 ("Which benchmark should Leona build under its own name…"), option 2. Owner
ruling: "all of them perhaps?", read as build options 1, 2, and 3 in sequence — option 1
(resource-estimation) shipped in PR 953, this is option 2, option 3 (SDK-drift) ships
alongside this PR. Design rationale:
`~/Developer/ai-ops/desk/leona/plans/strategy-20260921/benchmarks-and-jev.md` §3, and
`../resource-estimation-benchmark/SPEC.md`'s "what option 2 would need next" section
(written during that PR, before this one existed).

## Why this benchmark

A model cannot have memorized the answer to a task built from a paper it was never trained
on. LiveCodeBench pioneered this "freshness" contamination defense for ordinary code; nobody
has applied it to quantum-computing paper-to-circuit implementation specifically (the survey
in the strategy doc found no such benchmark). Each task here asks a model to implement one
precisely-described circuit, ansatz, or subroutine from an arXiv paper posted after the
training-data cutoff of every model this benchmark is meant to grade, then grades the result
BEHAVIOURALLY (statevector/unitary equivalence, or an output distribution on a small
instance) — never by matching source structure, so a correct-but-differently-written
solution still passes and a plausible-looking-but-wrong one still fails.

## Cutoff sourcing and the freshness window

Production's code-generation model (`packages/py/llm/src/majorana_llm/models.py`,
`model_for("generate")`) resolves to `deepseek-v4-pro` under the "openai" profile — the
code comments state this is "the effective production default" (owner-confirmed OpenAI +
DeepSeek providers) — or to `claude-sonnet-5` under the alternate "anthropic" profile
(`MAJORANA_LLM_PROVIDER=anthropic`). Both profiles' other roles (`claude-opus-4-8`,
`claude-haiku-4-5-20251001`) were checked too, since any of them could plausibly be asked to
implement a circuit.

Vendor-published training-data cutoffs, fetched directly from each vendor's own docs
(2026-09-23):

| Model | Training data cutoff | Source |
|---|---|---|
| `claude-sonnet-5` | January 2026 | `platform.claude.com/docs/en/models/sonnet-5/overview` — independently confirms this session's own system-prompt statement ("Assistant knowledge cutoff is January 2026") |
| `claude-opus-4-8` | January 2026 | `platform.claude.com/docs/en/models/opus-4-8/overview` |
| `claude-haiku-4-5-20251001` | July 2025 (reliable cutoff: February 2025) | `platform.claude.com/docs/en/models/haiku-4-5/overview` |
| `deepseek-v4-pro` | **not published** | DeepSeek's own model card (`deepseek-V4-model-card-EN.pdf`) documents release date (April 24, 2026) and data SOURCING but states no cutoff date anywhere; a further check found DeepSeek does not publish knowledge-cutoff dates for its models as a general practice |

**Per this task's own instruction ("if you cannot establish a cutoff from a primary source,
say so and use papers from the last 30 days")**: `deepseek-v4-pro` — the actual production
default — has no published cutoff, so this increment does not rely on any specific cutoff
date. Every task is built from a paper posted **within the 30 days before this PR's
authoring date (2026-09-23)**, i.e. on or after **2026-08-24** — safely after every
Anthropic-profile model's cutoff too (January 2026 / July 2025), so the corpus is fresh with
respect to every model this benchmark was checked against.

| Task | arXiv id | Submitted |
|---|---|---|
| `virtual-rz-single-layer-ansatz` | 2608.17249 | 2026-08-18 |
| `dicke-state-k1-preparation` | 2608.22892 | 2026-08-24 |
| `belief-propagation-tree-state-prep` | 2608.26840 | 2026-08-27 |
| `ma-qaoa-single-layer` | 2609.02793 | 2026-09-02 |
| `lcu-block-encoding-rate-matrix` | 2609.08432 | 2026-09-08 |

One task (`virtual-rz-single-layer-ansatz`, 2026-08-18) is 6 days before the strict 30-day
window; kept because it easily clears every established cutoff above (all before July 2025
at the latest) and was one of the most concretely-specified candidates found — see
`PROVENANCE.md` for the full candidate list and why the other four were dropped.

## Task format

Each case (`cases/<task_id>.yaml`, validated against
`majorana_evals.paper_to_code.schema.PaperToCodeTask`) has:

- `source` — `arxiv_id`, `title` (checked against the paper's own arXiv abstract page, not
  a search snippet), `authors`, `submitted` (arXiv v1 date), `location` (equation/figure/
  section), `url`, `license`, `retrieved`.
- `quoted_excerpt` — a short, verbatim quotation the task statement is built from.
- `prompt` — the self-contained instruction: the paper's construction restated precisely
  enough that a model is never expected to infer an unstated convention, plus the exact
  function signature to preserve.
- `entry_point` / `scaffold` — imports + function signature + docstring, no body.
- `canonical_solution` — body only. A reference implementation written from the paper (or,
  where noted, from the paper's own general formula applied to a concrete instance the
  paper does not itself work through numerically — always stated plainly, never silently).
- `hidden_test` — Python source defining `check(candidate)`: raises on failure, checked
  BEHAVIOURALLY via `qiskit.quantum_info` (`Statevector.equiv`, `Operator`, or a measured
  probability distribution), never by inspecting source structure.
- `grading_method` — `statevector` / `unitary` / `distribution`.
- `qubits` — the graded instance's qubit count (kept small enough for exact classical
  simulation; max 24 here, all tasks are 3-4 qubits).
- `novelty` (required) — `"paper-specific"` or `"restated"`, plus a required one-line
  `novelty_reason`. See "How new is each task?" below — this field exists because
  freshness (posted after every model's cutoff) is NOT the same claim as "a model can't
  have memorized this."

## How new is each task?

**A task built from a fresh paper is not automatically contamination-proof.** A paper
posted last week can still restate a construction that has been in every textbook and
every model's training data for years (a special case, a standard ansatz template the
paper applies rather than invents). Passing such a task shows a model can build a known
circuit correctly — a real, useful signal, but a different one from "this model read a
paper it could not have seen before." `novelty` records which claim each task actually
supports, checked against the paper by a human reviewer rather than left as a
self-assessment:

| Task | `novelty` | Why |
|---|---|---|
| `virtual-rz-single-layer-ansatz` | `restated` | Local-rotation + entangling-layer "hardware-efficient ansatz" templates predate this paper by years; it applies (not invents) that layer shape for a new problem (PDE state prep) |
| `ma-qaoa-single-layer` | `restated` | Multi-angle QAOA (independent angle per Pauli term) is a known ansatz variant from prior literature; Eq. 18 restates that general form for this paper's SYK application |
| `dicke-state-k1-preparation` | `restated` | The k=1 Dicke state is the W state — textbook, predates this paper; the paper's Eq. 9 is its own stated special case of a known result, not its novel contribution |
| `belief-propagation-tree-state-prep` | `paper-specific` | The 2-CNOT rotation gate is a known primitive, but the specific BP-marginal-to-angle formula and its recursive tree composition (Eqs. 34, 38-40) are presented as this paper's own method, not cited from elsewhere |
| `lcu-block-encoding-rate-matrix` | `paper-specific` | LCU/block-encoding is a known framework, but the specific rate matrix `A=k(S-I)` and its 2-term decomposition (Eq. 34) is this paper's own contribution for polymerization kinetics |

**Only the `paper-specific` score supports a "not memorizable" claim.** Every
`BenchmarkReport` carries BOTH the combined total (`total`/`passed`/`pass_rate`, across all
5 tasks) and a `paper_specific_total`/`paper_specific_passed`/`paper_specific_pass_rate`
restricted to the 2 `paper-specific` tasks. Quoting the combined figure as evidence a model
"couldn't have memorized this" would be wrong — 3 of the 5 tasks test constructions a model
could plausibly already know. The `restated` tasks are still shipped (they exercise the
full harness end to end and give a broader correctness signal), just never as freshness
evidence.

**First-increment honesty, not a design flaw to fix silently**: 3 of 5 landing on
`restated` reflects how hard it is to find SMALL, EXACTLY-VERIFIABLE circuits that are
BOTH freshly-published AND genuinely the paper's own invention — see `PROVENANCE.md`'s
"Candidates investigated and dropped" section for 6 papers whose potentially
paper-specific content could not be pinned down precisely enough to trust a hand-written
reference. Growing the `paper-specific` fraction is real future work, not a one-line fix.

## Grading rule

Same two-layer convention as `sdk_drift`:

1. **The sandbox guard's import allowlist** (`majorana_sandbox.guard.check_python_code`) —
   checked against every reference solution at LOAD time.
2. **Behavioural equivalence via subprocess execution** — candidate source + `hidden_test` +
   `check(entry_point)`, run with a 30s timeout.

## Controls (all zero-spend, no model API call of any kind)

| Adapter | What it does | Required result (all 5) | Measured (all 5) | Measured (`paper-specific` only, 2 tasks) |
|---|---|---|---|---|
| `canonical` | Echoes each task's own `scaffold + canonical_solution` | 100% pass | **5/5 passed** | **2/2 passed** |
| `garbage` | The scaffold with a deliberately wrong body (`return None`) | 0% pass | **0/5 passed** | **0/2 passed** |

**Mutation-check performed during this build**: `grader.py`'s `if result.returncode == 0:`
line was temporarily replaced with `if True:`. Re-running the `garbage` control against the
mutated grader flipped its result to **5/5 "passed"**; the grader was reverted (confirmed
byte-identical via `diff`) and the control re-run, confirming it correctly returned to
**0/5 passed**.

## Candidates dropped for correctness or verifiability reasons

Several strong-looking candidates from the initial arXiv search were investigated in depth
and dropped when their circuit construction could not be pinned down precisely enough from
the paper's own text to write a reference solution with confidence — see `PROVENANCE.md` for
the full account (a magic-state-prep paper that cites a PRIOR paper for its own encoding
step; a block-encoding paper with no worked small example; an encoded-QAOA paper whose
inter-block gate depends on a figure a text fetch cannot faithfully convey; a collision-model
Dicke-state paper whose angles live only in a companion dataset, not the paper text). Dropping
these in favor of tasks that could be independently, numerically verified end to end was a
deliberate choice — a wrong "reference" solution would be worse than a smaller corpus.

## Sandbox guard compatibility

Every canonical solution in this corpus uses only `qiskit` (and its `qiskit.quantum_info`,
`qiskit.circuit.library` submodules) and `numpy` — both allowlisted at the top level by
`majorana_sandbox.guard.ALLOWED_IMPORTS`. No candidate in this increment needed
`qiskit_ibm_runtime` or any other blocked import.

## Layout

```
evals/paper-to-code-benchmark/
  SPEC.md            — this file
  README.md          — how to run it
  PROVENANCE.md       — per-task paper sourcing + verification, dropped candidates
  cases/*.yaml        — 5 cases
evals/harness/src/majorana_evals/paper_to_code/
  schema.py           — PaperToCodeTask, grading result types
  grader.py           — sandbox-guard + subprocess execution
  adapters.py         — ModelAdapter protocol + the 2 offline controls
  loader.py           — case loading, validation, dataset hashing
  runner.py           — drives an adapter over the corpus, aggregates a report
  pricing.py          — prices a hypothetical live run (never executed)
  __main__.py         — CLI
evals/harness/tests/test_paper_to_code.py
```

## What this increment does NOT build

A pipeline that automatically pulls fresh arXiv papers on a schedule, a per-paper curation
UI, or any live model grading — all future work, matching the "what option 2 would need
next" section written into the resource-estimation benchmark's own SPEC.md before this PR
existed. This increment is 5 hand-curated, hand-verified tasks; growing the corpus to the
strategy doc's suggested "20-30 papers/quarter" cadence needs a repeatable curation process,
not just more of this same manual pass.
