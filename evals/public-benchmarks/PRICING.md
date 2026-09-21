# Price of one full run

**No paid call produced any number in this document.** Every token count below is measured
from a zero-spend `StubPipelineLLM` dry run driving the REAL production pipeline
(`majorana_worker.handlers.handle_run_execute`) end to end — real prompt text, real
plan/review/explain calls, stubbed completions (see `stub_llm.py`'s docstring). Prices are
current list prices, fetched and dated below, not estimated.

## Method

1. Run `python -m majorana_evals.public_benchmarks run --benchmark <b> --stub canonical`
   under `MAJORANA_LLM_PROVIDER=openai` (the confirmed production default —
   `packages/py/llm/src/majorana_llm/models.py`, "OpenAI-compatible profile is therefore the
   effective production default") so every `model_for(role)` call resolves to the model
   production actually uses. `StubPipelineLLM` never reaches a network; it computes
   `input_tokens`/`output_tokens` from the real request text length (`len(text)//4`, the
   same conservative estimator `OpenAICompatibleLLM` falls back to when a provider omits
   usage — see `client.py`), so the completion length is synthetic but the PROMPT length is
   real, per the task brief's instruction to measure token counts this way.
2. Read `by_stage` off the resulting `PublicBenchmarkReport` — real, per-stage,
   `llm.call`-event-sourced totals (`runner.py`), not a hand list of roles.
3. Multiply by `pricing.price_full_run`'s three scenarios (`pricing.py`, each with its
   `source` stated) and by current list price for `deepseek-v4-pro` (fetched from
   https://deepseek.ai/pricing 2026-09-20, page self-reports "last verified: September 18,
   2026"):

   | | input $/M | output $/M |
   |---|---|---|
   | off-peak (cache miss) | $0.66 | $1.98 |
   | peak (Mon–Fri 01:00–04:00 & 06:00–10:00 UTC) | $1.32 | $3.96 |

   (Cached-input rate, $0.022/M off-peak, is not used here — these are one-shot novel
   prompts per task, not expected to hit a cache.)

## A caveat the numbers below do not hide

The measured baseline is a full 151/70-task run, not an idealized "every task on its first
try" run: `SimplePipelineBudget` genuinely retries a candidate up to its ceiling
(`max_generation_attempts=8`) even when the candidate is failing for a reason no retry can
fix — e.g. every Qiskit HumanEval task that needs `qiskit_ibm_runtime` (blocked by
`majorana_sandbox.guard.ALLOWED_IMPORTS`, see the PR body) burned real repair-loop calls
before giving up. So the "first_candidate" scenario below is not a pure single-shot
estimate; it already contains some of this real, naturally-occurring repair overhead for the
tasks that hit it. The `empirical_internal_corpus` and `budget_exhausted` scenarios then
scale the whole GENERATE/VERIFY total by an additional multiplier on top — for the ~30% of
tasks already retried to exhaustion in the baseline, this double-counts some of that
overhead, so those two scenarios are a genuine (if imprecise) upper bound, not a tight one.
A cleaner number needs a per-task first-attempt/repaired split this pass did not build.

## Qiskit HumanEval — 151 tasks

Measured (2026-09-20, `feature/p1-public-benchmarks`, dataset commit `c98ba538`):

| | calls | input tokens | output tokens |
|---|---|---|---|
| plan (incl. the once-per-run research-triage call, folded in — see `pricing.py`) | 392 | 1,290,088 | 24,193 |
| generate (incl. the once-per-run title call — see `pricing.py`'s known-imprecision note) | 287 | 1,188,543 | 65,214 |
| verify | 106 | 299,974 | 6,784 |
| analyze (on success only) | 106 | 201,483 | 1,802 |
| **total** | **891** | **2,980,088** | **97,993** |

Priced against `deepseek-v4-pro`, off-peak / peak:

| scenario | candidates/task | full-run price (off-peak) | full-run price (peak) |
|---|---|---|---|
| `first_candidate` (see caveat above) | 1.0 (measured) | **$2.16** | $4.32 |
| `empirical_internal_corpus` — token-weighted mean `mean_candidates` across 71 `evals/report-*.json` files in this repo (299 cases), 2026-09-20 | 2.197 | **$3.51** | $7.02 |
| `budget_exhausted` — `SimplePipelineBudget.max_generation_attempts` | 8.0 | **$10.04** | $20.07 |

**Recommendation: budget ~$2–4 for one Qiskit HumanEval run** against the production
deepseek/openai profile — even the worst-case scenario is $10 off-peak / $20 at peak. A
rough sanity check pricing the SAME measured tokens against Claude Opus 4.8 rates
everywhere (an overstatement — `verify`/`plan` would really be Opus under the anthropic
profile, but `generate`/`route`/`writeback` would be Sonnet/Haiku, which this harness's
per-stage-not-per-role breakdown cannot currently split; see `pricing.py`'s stated
limitation) puts the same two scenarios at **$17.35** / **$28.42** — still small.

## QCircuitEval — 70 tasks (58 core + 12 QEC)

Measured (2026-09-20, `feature/p1-public-benchmarks`, dataset commit `e7e4eb30`):

| | calls | input tokens | output tokens |
|---|---|---|---|
| plan (incl. research-triage) | 140 | 385,987 | 7,210 |
| generate (incl. title) | 72 | 275,883 | 14,528 |
| verify | 70 | 211,077 | 4,480 |
| analyze | 70 | 146,041 | 1,190 |
| **total** | **352** | **1,018,988** | **27,408** |

Priced against `deepseek-v4-pro`, same rates as above:

| scenario | candidates/task | full-run price (off-peak) | full-run price (peak) |
|---|---|---|---|
| `first_candidate` | 1.0 (measured) | **$0.73** | $1.45 |
| `empirical_internal_corpus` | 2.197 | **$1.16** | $2.31 |
| `budget_exhausted` | 8.0 | **$3.24** | $6.48 |

Rough Opus-everywhere sanity bound (same overstatement caveat as above): $5.78 /
$9.26 for the same two scenarios — still small.

**Recommendation: budget ~$1–2 for one QCircuitEval (Qiskit-framework, 70-task) run.**
Cheaper than Qiskit HumanEval mainly because it has fewer tasks (70 vs 151), not because
each task costs materially less per call.

**A structural caveat this number does not capture**: this harness's QCircuitEval scorer
implements structural grading only, not the functional distribution check (see
`qcircuiteval/PROVENANCE.md`). Nothing about that gap inflates or deflates the PRICE — the
LLM calls happen identically either way — but it means a real QCircuitEval run at this price
would produce a `passed` count this harness cannot fully stand behind as "QCircuitEval says
this is correct" until the functional grader question below is resolved.

## Assumptions, listed once more for anyone skimming to the number

- Production-default provider profile (`openai`/`deepseek-v4-pro` for every role) — the
  `anthropic` profile is not pinned by the plan per `packages/py/llm/AGENTS.md` and would
  cost differently (see the rough bound above).
- Off-peak DeepSeek pricing unless a workflow is scheduled to run inside DeepSeek's
  Mon–Fri 01:00–04:00 / 06:00–10:00 UTC peak window, in which case double it.
- `MAJORANA_RESEARCH` left at its production default (enabled) — every run spends one
  small `research_triage` call even though neither benchmark ever needs an arXiv lookup;
  not disabled here because disabling it would price a configuration production does not
  actually run.
- No cache-hit discount assumed (one-shot prompts).
- Both benchmarks' `--stub canonical` runs completed in a few minutes on a laptop against a
  local Postgres + `LocalSubprocessSandbox`; a real run additionally waits on live provider
  latency per call, not priced in USD but relevant to how long a workflow run takes.
