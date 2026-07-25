"""The API-side abuse backstop on run creation.

The tier allowance lives in the web BFF, which is a different server; a caller
holding a valid token can reach POST /v1/runs directly and never pass it. These
tests pin the two per-workspace ceilings that bound that path — see the
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


def _counter(counts: dict[str, int], captured: dict | None = None):
    async def count_runs_by_mode_since(_scope, _session, since):
        if captured is not None:
            captured["since"] = since
        return dict(counts)

    return count_runs_by_mode_since


async def test_execute_run_under_the_ceiling_is_admitted(scope, monkeypatch):
    monkeypatch.setattr(
        runs.runs_repo,
        "count_runs_by_mode_since",
        _counter({RunMode.EXECUTE.value: runs.EXECUTE_BACKSTOP_LIMIT - 1}),
    )
    # No exception is the assertion: the backstop must be invisible below it.
    await runs._enforce_execute_backstop(_request(RunMode.EXECUTE), scope, object())


async def test_execute_run_at_the_ceiling_is_refused(scope, monkeypatch):
    monkeypatch.setattr(
        runs.runs_repo,
        "count_runs_by_mode_since",
        _counter({RunMode.EXECUTE.value: runs.EXECUTE_BACKSTOP_LIMIT}),
    )

    with pytest.raises(HTTPException) as caught:
        await runs._enforce_execute_backstop(_request(RunMode.EXECUTE), scope, object())

    assert caught.value.status_code == 429
    detail = caught.value.detail
    assert detail["reason"] == "execute_backstop_exhausted"
    assert detail["limit"] == runs.EXECUTE_BACKSTOP_LIMIT
    # The message must not read as a plan allowance; a user who hits this has
    # not run out of credits, and telling them so would send them to Billing to
    # fix something billing cannot fix.
    assert "abuse backstop" in detail["error"]


async def test_default_mode_cannot_be_used_to_bypass_the_ceiling(scope, monkeypatch):
    """Regression: AUTO is the DEFAULT mode on CreateRunRequest.

    A first cut gated only `mode == EXECUTE`, so a caller who simply omitted
    `mode` was never counted and could submit without bound. The worker rewrites
    AUTO rows to their resolved mode only *after* admission, which is too late
    for a gate that runs at admission.
    """
    # Confirm the premise rather than trusting it: omitting mode really is AUTO.
    defaulted = runs.CreateRunRequest(task_prompt="anything", framework=Framework.QISKIT)
    assert defaulted.mode is RunMode.AUTO

    monkeypatch.setattr(
        runs.runs_repo,
        "count_runs_by_mode_since",
        _counter({RunMode.AUTO.value: runs.SUBMISSION_BACKSTOP_LIMIT}),
    )

    with pytest.raises(HTTPException) as caught:
        await runs._enforce_execute_backstop(defaulted, scope, object())
    assert caught.value.detail["reason"] == "submission_backstop_exhausted"


async def test_auto_traffic_is_not_metered_against_the_strict_execute_ceiling(scope, monkeypatch):
    """Ordinary conversation arrives as AUTO and must not hit the tight bound.

    AUTO sits far above the execute ceiling here but below the combined one, so
    a chatty workspace keeps working. Refusing legitimate users is the one thing
    a backstop must never do.
    """
    monkeypatch.setattr(
        runs.runs_repo,
        "count_runs_by_mode_since",
        _counter({RunMode.AUTO.value: runs.EXECUTE_BACKSTOP_LIMIT * 2}),
    )
    await runs._enforce_execute_backstop(_request(RunMode.AUTO), scope, object())


async def test_auto_volume_still_blocks_a_new_explicit_execute(scope, monkeypatch):
    """The combined ceiling binds every counted mode, not only AUTO itself."""
    monkeypatch.setattr(
        runs.runs_repo,
        "count_runs_by_mode_since",
        _counter({RunMode.AUTO.value: runs.SUBMISSION_BACKSTOP_LIMIT}),
    )
    with pytest.raises(HTTPException) as caught:
        await runs._enforce_execute_backstop(_request(RunMode.EXECUTE), scope, object())
    assert caught.value.detail["reason"] == "submission_backstop_exhausted"


@pytest.mark.parametrize("mode", [RunMode.CHAT, RunMode.IDEATE, RunMode.EXPLAIN])
async def test_resolved_non_execute_modes_are_never_counted_or_refused(mode, scope, monkeypatch):
    """Chat is unmetered on purpose (PR #146) and must stay that way here.

    The counters are set far above both ceilings: if any of these modes
    consulted them, the call would raise.
    """
    monkeypatch.setattr(
        runs.runs_repo,
        "count_runs_by_mode_since",
        _counter(
            {
                RunMode.EXECUTE.value: runs.SUBMISSION_BACKSTOP_LIMIT * 10,
                RunMode.AUTO.value: runs.SUBMISSION_BACKSTOP_LIMIT * 10,
            }
        ),
    )
    await runs._enforce_execute_backstop(_request(mode), scope, object())


async def test_the_window_is_a_trailing_seven_days_in_utc(scope, monkeypatch):
    captured: dict = {}
    monkeypatch.setattr(runs.runs_repo, "count_runs_by_mode_since", _counter({}, captured))

    before = dt.datetime.now(dt.timezone.utc)
    await runs._enforce_execute_backstop(_request(RunMode.EXECUTE), scope, object())
    after = dt.datetime.now(dt.timezone.utc)

    since = captured["since"]
    # Timezone-aware: runs.created_at is TIMESTAMP(timezone=True), and a naive
    # datetime would raise on comparison rather than silently mis-count.
    assert since.tzinfo is not None
    assert before - runs.EXECUTE_BACKSTOP_WINDOW <= since <= after - runs.EXECUTE_BACKSTOP_WINDOW


async def test_the_ceilings_sit_far_above_every_shipped_tier():
    """A legitimate user must never see either of these.

    The free tier is 5 execute runs/week (TIER_LIMITS in the web app). If these
    ceilings ever drift down toward that, they stop being backstops and start
    being a second, conflicting allowance.
    """
    assert runs.EXECUTE_BACKSTOP_LIMIT >= 100
    assert runs.SUBMISSION_BACKSTOP_LIMIT > runs.EXECUTE_BACKSTOP_LIMIT
    assert runs.EXECUTE_BACKSTOP_WINDOW == dt.timedelta(days=7)
