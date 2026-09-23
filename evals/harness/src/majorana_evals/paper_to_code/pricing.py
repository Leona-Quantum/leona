"""Prices a hypothetical LIVE run — never executed in this increment (no adapter here ever
calls a network; see adapters.py's docstring). Same posture and same conservative token
estimator as `resource_estimation.pricing`: a live run is architecturally one completion
call per task (a fully-specified prompt in, a complete Qiskit function out), so there is no
repair loop to price here either.

What is NOT measured, and is stated as an assumption rather than hidden as one: expected
OUTPUT token count. No live run of this benchmark has ever happened, so there is no real
completion to measure the length of; `ASSUMED_OUTPUT_TOKENS_PER_TASK` is a stated guess (a
short Qiskit function, not a multi-candidate repair transcript), not a measurement."""

from __future__ import annotations

from dataclasses import dataclass

from majorana_evals.paper_to_code.schema import PaperToCodeTask


def estimate_prompt_tokens(text: str) -> int:
    return max(1, len(text) // 4)


#: A short, self-contained Qiskit function (imports + a handful of gate calls) — an
#: assumption, not a measurement (see module docstring).
ASSUMED_OUTPUT_TOKENS_PER_TASK = 500


@dataclass(frozen=True)
class ModelPrice:
    """Current list price, USD per 1M tokens. Fetched, not estimated — cite the source and
    fetch date at the call site, exactly like `resource_estimation.pricing.ModelPrice`."""

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


def price_full_run(tasks: list[PaperToCodeTask], *, price: ModelPrice) -> RunPricing:
    """Prices one call per task: real prompt tokens (measured from `task.prompt`) plus
    `ASSUMED_OUTPUT_TOKENS_PER_TASK` (assumed) per task. No retry/repair multiplier."""

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
