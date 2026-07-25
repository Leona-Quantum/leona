"""The API-side abuse backstop on execute-run creation.

The tier allowance lives in the web BFF, which is a different server; a caller
holding a valid token can reach POST /v1/runs directly and never pass it. These
tests pin the flat per-workspace ceiling that bounds that path — see the
rationale block above `_enforce_execute_backstop` in routes/runs.py.
"""

import datetime as dt

import pytest
from fastapi import HTTPException
from majorana_contracts.enums import Framework, RunMode

from majorana_api.routes import runs


def _request(mode: RunMode) -> runs.CreateRunRequest:
    return runs.CreateRunRequest(
        task_prompt="Build a Bell pair",
        framework=Framework.QISKIT,
        mode=mode,
    )


def _counter(count: int, captured: dict | None = None):
    async def count_execute_runs_since(_scope, _session, since):
        if captured is not None:
            captured["since"] = since
        return count

    return count_execute_runs_since


async def test_execute_run_under_the_ceiling_is_admitted(scope, monkeypatch):
    monkeypatch.setattr(
        runs.runs_repo,
        "count_execute_runs_since",
        _counter(runs.EXECUTE_BACKSTOP_LIMIT - 1),
    )
    # No exception is the assertion: the backstop must be invisible below it.
    await runs._enforce_execute_backstop(_request(RunMode.EXECUTE), scope, object())


async def test_execute_run_at_the_ceiling_is_refused(scope, monkeypatch):
    monkeypatch.setattr(
        runs.runs_repo, "count_execute_runs_since", _counter(runs.EXECUTE_BACKSTOP_LIMIT)
    )

    with pytest.raises(HTTPException) as caught:
        await runs._enforce_execute_backstop(_request(RunMode.EXECUTE), scope, object())

    assert caught.value.status_code == 429
    detail = caught.value.detail
    assert detail["reason"] == "execute_backstop_exhausted"
    assert detail["limit"] == runs.EXECUTE_BACKSTOP_LIMIT
    assert detail["used"] == runs.EXECUTE_BACKSTOP_LIMIT
    # The message must not read as a plan allowance; a user who hits this has
    # not run out of credits, and telling them so would send them to Billing to
    # fix something billing cannot fix.
    assert "abuse backstop" in detail["error"]


@pytest.mark.parametrize("mode", [RunMode.CHAT, RunMode.IDEATE, RunMode.EXPLAIN])
async def test_non_execute_modes_are_never_counted_or_refused(mode, scope, monkeypatch):
    """Chat is unmetered on purpose (PR #146) and must stay that way here.

    The counter is set far above the ceiling: if any of these modes consulted
    it, the call would raise.
    """
    monkeypatch.setattr(
        runs.runs_repo,
        "count_execute_runs_since",
        _counter(runs.EXECUTE_BACKSTOP_LIMIT * 10),
    )
    await runs._enforce_execute_backstop(_request(mode), scope, object())


async def test_the_window_is_a_trailing_seven_days_in_utc(scope, monkeypatch):
    captured: dict = {}
    monkeypatch.setattr(runs.runs_repo, "count_execute_runs_since", _counter(0, captured))

    before = dt.datetime.now(dt.timezone.utc)
    await runs._enforce_execute_backstop(_request(RunMode.EXECUTE), scope, object())
    after = dt.datetime.now(dt.timezone.utc)

    since = captured["since"]
    # Timezone-aware: runs.created_at is TIMESTAMP(timezone=True), and a naive
    # datetime would raise on comparison rather than silently mis-count.
    assert since.tzinfo is not None
    assert before - runs.EXECUTE_BACKSTOP_WINDOW <= since <= after - runs.EXECUTE_BACKSTOP_WINDOW


async def test_the_ceiling_sits_far_above_every_shipped_tier():
    """A legitimate user must never see this.

    The free tier is 5 execute runs/week (TIER_LIMITS in the web app). If this
    ceiling ever drifts down toward that, it stops being a backstop and starts
    being a second, conflicting allowance.
    """
    assert runs.EXECUTE_BACKSTOP_LIMIT >= 100
    assert runs.EXECUTE_BACKSTOP_WINDOW == dt.timedelta(days=7)
