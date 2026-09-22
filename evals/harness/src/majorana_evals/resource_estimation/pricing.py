"""Prices a hypothetical LIVE run — never executed in this increment (no adapter here ever
calls a network; see adapters.py's docstring).

Unlike `majorana_evals.public_benchmarks.pricing` (which scales a MEASURED multi-stage
product-pipeline dry run by a candidates-per-task repair multiplier), this benchmark has no
product pipeline behind it at all: a live run is architecturally ONE completion call per task
— a fully-specified prompt in, a small structured JSON answer out — so there is no repair
loop to price and no `by_stage` breakdown to scale.

What IS measured, honestly: prompt token counts, computed directly from the real prompt text
of every case in the corpus (`len(text) // 4`, the same conservative estimator
`majorana_llm.OpenAICompatibleLLM` falls back to when a provider omits usage, and the same one
`public_benchmarks.stub_llm` uses — kept consistent across this repo's evals rather than
invented fresh here).

What is NOT measured, and is stated as an assumption rather than hidden as one: expected
OUTPUT token count. No live run of this benchmark has ever happened (this pass is
build-and-price only, same posture as PR 944's), so there is no real completion to measure
the length of. `ASSUMED_OUTPUT_TOKENS_PER_TASK` is a stated guess (a short structured-JSON
answer plus brief reasoning), not a measurement — treat every price below as scaling with
that guess."""

from __future__ import annotations

from dataclasses import dataclass

from majorana_evals.resource_estimation.schema import ResourceEstimationTask


def estimate_prompt_tokens(text: str) -> int:
    return max(1, len(text) // 4)


#: A short structured answer (up to 5 numeric fields) plus a few sentences of reasoning —
#: an assumption, not a measurement (see module docstring). Sized against this corpus's own
#: `reference` fields: no case pins more than 4 quantities.
ASSUMED_OUTPUT_TOKENS_PER_TASK = 300


@dataclass(frozen=True)
class ModelPrice:
    """Current list price, USD per 1M tokens. Fetched, not estimated — cite the source and
    fetch date at the call site, exactly like `public_benchmarks.pricing.ModelPrice`."""

    model: str
    input_per_million: float
    output_per_million: float
    source: str


@dataclass(frozen=True)
class RunPricing:
    price: ModelPrice
    tasks: int
    input_tokens: int
    output_tokens: int
    usd: float


def price_full_run(tasks: list[ResourceEstimationTask], *, price: ModelPrice) -> RunPricing:
    """Prices one call per task: real prompt tokens (measured) plus
    `ASSUMED_OUTPUT_TOKENS_PER_TASK` (assumed) per task. No retry/repair multiplier — a
    malformed-JSON retry would at most double a single task's cost, not scale the whole run
    the way a generation-repair budget does in the code-generation harness."""

    if not tasks:
        raise ValueError("no tasks to price")
    input_tokens = sum(estimate_prompt_tokens(task.prompt) for task in tasks)
    output_tokens = ASSUMED_OUTPUT_TOKENS_PER_TASK * len(tasks)
    usd = (
        input_tokens / 1_000_000 * price.input_per_million
        + output_tokens / 1_000_000 * price.output_per_million
    )
    return RunPricing(
        price=price,
        tasks=len(tasks),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        usd=usd,
    )
