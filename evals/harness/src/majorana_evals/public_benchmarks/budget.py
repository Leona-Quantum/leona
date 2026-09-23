"""Spend ceiling for a `--live` benchmark run (ai-ops#352 / ai-ops#357: hard cap approved
by the owner in chat 2026-09-23, "Yes, up to $15 total" — $10 of it for Qiskit HumanEval).

Neither `public_benchmarks` nor `resource_estimation` shipped a budget ceiling before this
module (see each package's own README/PROVENANCE: "This pass ... does not run either
benchmark for real"). This is the first code that can spend real provider money, so it is
the first place a hard stop belongs.

Cost is computed from the SAME numbers the report already aggregates — each `LLMResponse`'s
real `input_tokens`/`output_tokens` — times CURRENT list price for the model actually
served. Rates below are `deepseek-v4-pro`'s, exactly as recorded in
`evals/public-benchmarks/PRICING.md` (fetched 2026-09-20 from https://deepseek.ai/pricing,
page self-reports "last verified: September 18, 2026"); the peak window is the same one
that document states (Mon-Fri 01:00-04:00 & 06:00-10:00 UTC). A run against a different
served model still gets tracked (the tracker records tokens/cost per call regardless of
which model answered), but the $/token rate below is only correct for deepseek-v4-pro —
`BudgetTracker.rate_note` says which rate it actually used, so a report is never silently
mispriced against the wrong model's list price.

`BudgetGuardedLLM` wraps a real `LLMClient` (e.g. `default_llm()`) and refuses to place a
call once the running total is AT OR PAST the ceiling — the refusal happens BEFORE the call
that would cross it, so the tracked total can only ever undershoot the cap, never overshoot
it (a single call cannot itself be capped mid-flight; this is what "abort cleanly" can mean
without cancelling an in-flight HTTP request). `run_public_benchmark` (runner.py) separately
checks the tracker before starting each new TASK and marks every remaining task
"skipped: budget ceiling reached" rather than attempting (and immediately failing) it."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from majorana_llm import LLMClient, LLMRequest, LLMResponse

#: deepseek-v4-pro, $ / 1,000,000 tokens — PRICING.md, fetched 2026-09-20.
OFF_PEAK_RATES = {"input": 0.66, "output": 1.98}
PEAK_RATES = {"input": 1.32, "output": 3.96}

#: The model this rate table is actually priced for. A run served by a different model is
#: still tracked (tokens and call count are always real), but the resulting $ figure is
#: flagged as using the wrong rate — see `BudgetTracker.rate_mismatch`.
PRICED_MODEL = "deepseek-v4-pro"


def is_peak(now: datetime | None = None) -> bool:
    """Mon-Fri 01:00-04:00 or 06:00-10:00 UTC — PRICING.md's DeepSeek peak window."""
    now = now if now is not None else datetime.now(timezone.utc)
    if now.weekday() >= 5:  # Saturday=5, Sunday=6
        return False
    hour = now.hour
    return (1 <= hour < 4) or (6 <= hour < 10)


def current_rates(now: datetime | None = None) -> dict[str, float]:
    return dict(PEAK_RATES if is_peak(now) else OFF_PEAK_RATES)


class BudgetExceeded(RuntimeError):
    """Raised by `BudgetGuardedLLM.complete` instead of placing a call that would happen
    at-or-past the ceiling. Caught by `run_public_task`'s existing `except Exception` (a
    budget stop is a failed task, not a harness crash) and separately checked at the
    task-loop level so remaining tasks are marked "skipped", not "attempted and failed"."""

    def __init__(self, spent_usd: float, ceiling_usd: float) -> None:
        super().__init__(
            f"budget ceiling reached: ${spent_usd:.4f} spent >= ${ceiling_usd:.2f} ceiling — "
            "refusing to place another model call"
        )
        self.spent_usd = spent_usd
        self.ceiling_usd = ceiling_usd


@dataclass
class BudgetTracker:
    ceiling_usd: float
    spent_usd: float = 0.0
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    #: Any model id actually served that isn't PRICED_MODEL — real spend was still counted
    #: (tokens are always real) but at PRICED_MODEL's rate, which may not match.
    unpriced_models: set[str] = field(default_factory=set)

    def exceeded(self) -> bool:
        return self.spent_usd >= self.ceiling_usd

    def remaining_usd(self) -> float:
        return max(0.0, self.ceiling_usd - self.spent_usd)

    def record(self, *, model: str, input_tokens: int, output_tokens: int) -> float:
        """Update the running total for one completed call; returns that call's cost."""
        if model != PRICED_MODEL:
            self.unpriced_models.add(model)
        rates = current_rates()
        cost = (input_tokens / 1_000_000) * rates["input"] + (
            output_tokens / 1_000_000
        ) * rates["output"]
        self.spent_usd += cost
        self.calls += 1
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        return cost


class BudgetGuardedLLM:
    """`LLMClient` decorator (same pattern as `RetryingLLM`): wraps a real client and a
    `BudgetTracker`, refusing a call that would start at-or-past the ceiling."""

    def __init__(self, inner: "LLMClient", tracker: BudgetTracker) -> None:
        self._inner = inner
        self.tracker = tracker

    async def complete(self, request: "LLMRequest", *, on_delta=None) -> "LLMResponse":
        if self.tracker.exceeded():
            raise BudgetExceeded(self.tracker.spent_usd, self.tracker.ceiling_usd)
        response = await self._inner.complete(request, on_delta=on_delta)
        self.tracker.record(
            model=response.model,
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
        )
        return response
