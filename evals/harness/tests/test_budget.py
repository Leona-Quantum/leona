"""Tests for the `--live` spend ceiling (budget.py) — the first code in either benchmark
that can place a real, paid model call, so this is pinned before it is ever pointed at a
real provider. Pure: no DB, no network."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from majorana_evals.public_benchmarks.budget import (
    BudgetExceeded,
    BudgetGuardedLLM,
    BudgetTracker,
    OFF_PEAK_RATES,
    PEAK_RATES,
    current_rates,
    is_peak,
)


# ---------------------------------------------------------------------------
# is_peak / current_rates
# ---------------------------------------------------------------------------


def test_is_peak_true_inside_early_window_on_a_weekday():
    # Wednesday 02:30 UTC — inside 01:00-04:00.
    assert is_peak(datetime(2026, 9, 23, 2, 30, tzinfo=timezone.utc))


def test_is_peak_true_inside_late_window_on_a_weekday():
    # Wednesday 07:00 UTC — inside 06:00-10:00.
    assert is_peak(datetime(2026, 9, 23, 7, 0, tzinfo=timezone.utc))


def test_is_peak_false_between_the_two_windows():
    # Wednesday 05:00 UTC — between 04:00 and 06:00.
    assert not is_peak(datetime(2026, 9, 23, 5, 0, tzinfo=timezone.utc))


def test_is_peak_false_outside_either_window():
    # Wednesday 12:00 UTC.
    assert not is_peak(datetime(2026, 9, 23, 12, 0, tzinfo=timezone.utc))


def test_is_peak_false_on_saturday_even_during_the_hour_window():
    # Saturday 07:00 UTC would be "peak hours" on a weekday; PRICING.md's window is
    # Mon-Fri only.
    assert not is_peak(datetime(2026, 9, 26, 7, 0, tzinfo=timezone.utc))


def test_is_peak_boundary_is_half_open():
    # 04:00 and 10:00 exactly are the END of a peak window (half-open [start, end)).
    assert not is_peak(datetime(2026, 9, 23, 4, 0, tzinfo=timezone.utc))
    assert not is_peak(datetime(2026, 9, 23, 10, 0, tzinfo=timezone.utc))
    # 01:00 and 06:00 exactly are the START of a peak window.
    assert is_peak(datetime(2026, 9, 23, 1, 0, tzinfo=timezone.utc))
    assert is_peak(datetime(2026, 9, 23, 6, 0, tzinfo=timezone.utc))


def test_current_rates_selects_peak_vs_off_peak():
    assert current_rates(datetime(2026, 9, 23, 7, 0, tzinfo=timezone.utc)) == PEAK_RATES
    assert current_rates(datetime(2026, 9, 23, 12, 0, tzinfo=timezone.utc)) == OFF_PEAK_RATES


# ---------------------------------------------------------------------------
# BudgetTracker
# ---------------------------------------------------------------------------


def test_record_computes_cost_from_off_peak_rates():
    tracker = BudgetTracker(ceiling_usd=10.0)
    # Force off-peak for a deterministic expected cost.
    import majorana_evals.public_benchmarks.budget as budget_mod

    original = budget_mod.current_rates
    budget_mod.current_rates = lambda now=None: dict(OFF_PEAK_RATES)
    try:
        cost = tracker.record(
            model="deepseek-v4-pro", input_tokens=1_000_000, output_tokens=1_000_000
        )
    finally:
        budget_mod.current_rates = original
    assert cost == pytest.approx(OFF_PEAK_RATES["input"] + OFF_PEAK_RATES["output"])
    assert tracker.spent_usd == pytest.approx(cost)
    assert tracker.calls == 1
    assert tracker.input_tokens == 1_000_000
    assert tracker.output_tokens == 1_000_000


def test_record_flags_a_model_priced_at_the_wrong_rate():
    tracker = BudgetTracker(ceiling_usd=10.0)
    tracker.record(model="claude-sonnet-5", input_tokens=100, output_tokens=100)
    assert "claude-sonnet-5" in tracker.unpriced_models


def test_exceeded_is_false_below_ceiling_and_true_at_or_above_it():
    tracker = BudgetTracker(ceiling_usd=1.0)
    assert not tracker.exceeded()
    tracker.spent_usd = 0.999999
    assert not tracker.exceeded()
    tracker.spent_usd = 1.0
    assert tracker.exceeded()  # AT the ceiling counts as exceeded, not just past it
    tracker.spent_usd = 1.5
    assert tracker.exceeded()


def test_remaining_usd_never_goes_negative():
    tracker = BudgetTracker(ceiling_usd=1.0, spent_usd=5.0)
    assert tracker.remaining_usd() == 0.0


# ---------------------------------------------------------------------------
# BudgetGuardedLLM
# ---------------------------------------------------------------------------


class _FakeLLM:
    """Records every call it actually makes; never charges real money."""

    def __init__(self, *, input_tokens: int, output_tokens: int, model: str = "deepseek-v4-pro"):
        self.calls = 0
        self._input_tokens = input_tokens
        self._output_tokens = output_tokens
        self._model = model

    async def complete(self, request, *, on_delta=None):
        from majorana_llm import LLMResponse

        self.calls += 1
        return LLMResponse(
            text="{}",
            model=self._model,
            input_tokens=self._input_tokens,
            output_tokens=self._output_tokens,
        )


def _request():
    from majorana_llm import LLMRequest

    return LLMRequest(model="deepseek-v4-pro", system="s", user="u")


async def test_guarded_llm_places_calls_and_accumulates_spend_below_ceiling():
    inner = _FakeLLM(input_tokens=1000, output_tokens=1000)
    tracker = BudgetTracker(ceiling_usd=10.0)
    guarded = BudgetGuardedLLM(inner, tracker)
    await guarded.complete(_request())
    assert inner.calls == 1
    assert tracker.calls == 1
    assert 0.0 < tracker.spent_usd < 10.0


async def test_guarded_llm_refuses_a_call_once_the_ceiling_is_already_reached():
    """The core safety property: once `spent_usd >= ceiling_usd`, the INNER client must
    never be invoked again — this is what makes the guard's overshoot exactly zero rather
    than "one more call's worth"."""
    inner = _FakeLLM(input_tokens=1_000_000_000, output_tokens=1_000_000_000)
    tracker = BudgetTracker(ceiling_usd=0.01)
    guarded = BudgetGuardedLLM(inner, tracker)
    # The first call is allowed through (tracker starts at $0, not yet exceeded) and this
    # particular call blows way past the ceiling — the guard cannot cap an in-flight call,
    # only refuse the NEXT one. Confirm that.
    await guarded.complete(_request())
    assert inner.calls == 1
    assert tracker.exceeded()
    inner.calls = 0
    with pytest.raises(BudgetExceeded):
        await guarded.complete(_request())
    assert inner.calls == 0, "inner LLM must not be called once the ceiling is reached"


async def test_guarded_llm_stops_exactly_at_the_boundary_not_one_call_late():
    """Mutation-style check: with a ceiling that a single call exactly meets, the SECOND
    call must be refused. If the guard's comparison were `>` instead of `>=`, this would
    let one extra call through at spend == ceiling."""
    inner = _FakeLLM(input_tokens=1_000_000, output_tokens=0)  # costs exactly $0.66 off-peak
    import majorana_evals.public_benchmarks.budget as budget_mod

    original = budget_mod.current_rates
    budget_mod.current_rates = lambda now=None: dict(OFF_PEAK_RATES)
    try:
        tracker = BudgetTracker(ceiling_usd=OFF_PEAK_RATES["input"])
        guarded = BudgetGuardedLLM(inner, tracker)
        await guarded.complete(_request())
        assert tracker.spent_usd == pytest.approx(tracker.ceiling_usd)
        with pytest.raises(BudgetExceeded):
            await guarded.complete(_request())
        assert inner.calls == 1
    finally:
        budget_mod.current_rates = original
