"""Prices a hypothetical LIVE run — never executed in this increment. Same posture as
`paper_to_code.pricing` / `resource_estimation.pricing`: one completion call per task, real
prompt tokens measured, output tokens an explicitly stated assumption."""

from __future__ import annotations

from dataclasses import dataclass

from majorana_evals.sdk_drift.schema import SdkDriftTask


def estimate_prompt_tokens(text: str) -> int:
    return max(1, len(text) // 4)


#: A short, self-contained Qiskit function — assumption, not measurement.
ASSUMED_OUTPUT_TOKENS_PER_TASK = 400


@dataclass(frozen=True)
class ModelPrice:
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


def price_full_run(tasks: list[SdkDriftTask], *, price: ModelPrice) -> RunPricing:
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
