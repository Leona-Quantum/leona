"""Prices one full benchmark run from a MEASURED dry-run report.

Methodology, written down rather than left implicit:

1. `StubPipelineLLM` (see its docstring) exercises the fixed single-candidate happy path —
   one title call, one plan call, one generate call, one review call, one explain call per
   task — with real prompt text (so real prompt token counts) and stubbed but
   representatively-shaped completions (fixed JSON for the three schema'd calls; short
   prose for the two free-text ones). A dry-run report's `by_stage` breakdown is therefore
   a real, measured per-task token cost AT ONE CANDIDATE.

2. A real paid run repairs a fraction of tasks. `packages/py/agent/simple_pipeline.py`'s
   `SimplePipelineBudget` allows up to `max_generation_attempts=8` candidates and up to
   `max_review_attempts_per_candidate=2` review attempts each; a repair candidate re-runs
   both the GENERATE and VERIFY stages, not PLAN or the one-off title/explain calls. This
   module therefore scales only the GENERATE- and VERIFY-stage token totals by a
   candidates-per-task multiplier and leaves PLAN/ANALYZE (and the title call, folded into
   the GENERATE stage bucket — see the note below) at their measured one-candidate cost.

3. Three named multiplier scenarios (`PRICING_SCENARIOS`), so a single number is never
   presented as the only possibility — see each `PricingAssumptions.source` for where its
   number comes from. None of them is a measurement of either public benchmark: neither has
   been run (this pass is build-and-price only), so the multiplier is necessarily an
   assumption, not an observation.

Known imprecision, stated rather than hidden: `MeteredAgentLLM._ROLE_STAGE`
(services/worker/src/majorana_worker/agent_llm.py) has no entry for the conversation-title
call, so production itself files it under `Stage.GENERATE` alongside the real code-generation
call — this harness's `by_stage["generate"]` inherits that mixing on purpose, so it prices
the same buckets production bills against. Scaling the whole GENERATE bucket by the
candidates-per-task multiplier therefore also scales the (small, one-off) title call, which
is a minor over-count relative to a full source-code completion — not corrected here.

Pricing assumes a SINGLE model serves every stage, true of the production-default
openai/deepseek profile (`majorana_llm.models._DEFAULTS["openai"]` puts every role on
`deepseek-v4-pro`) but not of the anthropic profile (different roles, different models).
`price_full_run` raises if the report's `by_model` shows more than one model; pricing a
mixed-model profile needs a (stage, model) joint breakdown this pass does not build."""

from __future__ import annotations

from dataclasses import dataclass

from majorana_evals.public_benchmarks.schema import PublicBenchmarkReport

#: Stages a repair candidate re-runs. PLAN and ANALYZE (and the title call folded into
#: GENERATE — see module docstring) fire ~once per task regardless of repair count.
_SCALED_STAGES = frozenset({"generate", "verify"})


@dataclass(frozen=True)
class ModelPrice:
    """Current list price, USD per 1M tokens. Fetched, not estimated — see PRICING.md for
    the source URL and fetch date behind each instance actually used."""

    model: str
    input_per_million: float
    output_per_million: float
    source: str


@dataclass(frozen=True)
class PricingAssumptions:
    candidates_per_task: float
    label: str
    source: str


FIRST_CANDIDATE = PricingAssumptions(
    candidates_per_task=1.0,
    label="first_candidate",
    source=(
        "every task accepted on its first generated candidate — "
        "SimplePipelineBudget's best case, not a measurement"
    ),
)

EMPIRICAL_INTERNAL_CORPUS = PricingAssumptions(
    # Token-weighted mean of `mean_candidates` across every evals/report-*.json in this
    # repo as of 2026-09-20: 71 report files, 299 cases total, weighted by each report's
    # `total` so a 10-case run does not count the same as a 1-case run.
    # Recompute: python3 -c "
    #   import json, glob
    #   num = den = 0
    #   for f in glob.glob('evals/report-*.json'):
    #       d = json.load(open(f)); mc = d.get('mean_candidates'); tot = d.get('total')
    #       if mc is None or not tot: continue
    #       num += mc * tot; den += tot
    #   print(num / den)"
    candidates_per_task=2.197324414715719,
    label="empirical_internal_corpus",
    source=(
        "token-weighted mean of `mean_candidates` across 71 evals/report-*.json files in "
        "this repo (299 cases total) as of 2026-09-20 — Nala's OWN internal-corpus repair "
        "rate on its existing (non-public) eval corpus, used as the best available prior; "
        "NOT a measurement on either public benchmark, which has not been run"
    ),
)

BUDGET_EXHAUSTED = PricingAssumptions(
    candidates_per_task=8.0,
    label="budget_exhausted",
    source=(
        "packages/py/agent/simple_pipeline.py SimplePipelineBudget.max_generation_attempts "
        "— the product's own worst-case ceiling, not a typical run"
    ),
)

PRICING_SCENARIOS = (FIRST_CANDIDATE, EMPIRICAL_INTERNAL_CORPUS, BUDGET_EXHAUSTED)


@dataclass(frozen=True)
class RunPricing:
    assumptions: PricingAssumptions
    price: ModelPrice
    tasks: int
    input_tokens: float
    output_tokens: float
    usd: float


def price_full_run(
    report: PublicBenchmarkReport,
    *,
    price: ModelPrice,
    assumptions: PricingAssumptions,
) -> RunPricing:
    """Price a full run of `report.total` tasks, scaled from the report's measured
    one-candidate `by_stage` usage by `assumptions.candidates_per_task`."""

    if report.total == 0:
        raise ValueError("report has no tasks to price")
    if len(report.by_model) > 1:
        raise ValueError(
            "price_full_run assumes a single model serves every stage; "
            f"report.by_model has {sorted(report.by_model)} — build a (stage, model) "
            "joint breakdown before pricing a mixed-model profile"
        )

    scaled_input = scaled_output = 0.0
    flat_input = flat_output = 0.0
    for stage, usage in report.by_stage.items():
        if stage in _SCALED_STAGES:
            scaled_input += usage.input_tokens
            scaled_output += usage.output_tokens
        else:
            flat_input += usage.input_tokens
            flat_output += usage.output_tokens

    total_input = flat_input + scaled_input * assumptions.candidates_per_task
    total_output = flat_output + scaled_output * assumptions.candidates_per_task

    usd = (
        total_input / 1_000_000 * price.input_per_million
        + total_output / 1_000_000 * price.output_per_million
    )
    return RunPricing(
        assumptions=assumptions,
        price=price,
        tasks=report.total,
        input_tokens=total_input,
        output_tokens=total_output,
        usd=usd,
    )
