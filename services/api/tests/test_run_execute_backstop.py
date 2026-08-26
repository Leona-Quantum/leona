"""The per-WORKSPACE abuse backstop on explicit EXECUTE submissions.

`EXECUTE_BACKSTOP_LIMIT` is the one ceiling ai-ops 86 (2026-08-14) left alone: a
flat, workspace-scoped, tier-blind number bounding a token holder who calls
POST /v1/runs directly with `mode="execute"`. It sits above every tier's actual
allowance and exists so that gate — moved server-side by #164 — is never the
only thing standing between a compromised token and unbounded spend.

Two OTHER things live in `_enforce_execute_backstop` and are not this file's
concern:

  * The TIER gate — the account's actual plan allowance — see
    `test_run_tier_allowance.py`.
  * The per-ACCOUNT, tier-aware submission backstop (EXECUTE+AUTO combined),
    which ai-ops 86 rewrote from a flat per-workspace 1000 to ten times the
    tier's own weekly allowance — see `test_submission_backstop.py` and
    `test_submission_backstop_race_live.py`.

These tests pin the backstop, so they run as a DEVELOPER identity: unlimited
weekly runs means the tier gate is a no-op, and the submission backstop —
unlimited for the same identity — takes no lock and refuses nothing, so each
assertion here is about `EXECUTE_BACKSTOP_LIMIT` alone.
"""

import datetime as dt

import pytest
from fastapi import HTTPException
from majorana_contracts.enums import Framework, RunMode

from majorana_api.orm import User, Workspace
from majorana_api.routes import runs
from majorana_api.settings import Settings


def _settings(developer_emails: frozenset[str] = frozenset()) -> Settings:
    return Settings(
        workos_client_id="test",
        workos_jwt_issuer="https://issuer.invalid",
        workos_jwks_url="https://jwks.invalid",
        web_origin="https://web.invalid",
        developer_emails=developer_emails,
    )


def _identity(email: str = "local-dev@majorana.test", plan: str | None = None):
    """A DEVELOPER identity by default — the operator address needs no config."""
    return User(email=email, plan=plan), Workspace()


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


@pytest.fixture(autouse=True)
def _no_submission_backstop(monkeypatch):
    """Keep the per-account submission backstop out of the way; it has its own
    files. Mechanical, not behavioural: the developer identity these tests use
    is unlimited there too, but `reserve_submission_backstop_slot` still calls
    `count_submitted_runs_for_account_since` on that path, which would
    otherwise reach a real `session.execute` that this file's bare `object()`
    session cannot answer.
    """

    async def count_submitted_runs_for_account_since(_scope, _session, _since):
        return 0

    monkeypatch.setattr(
        runs.runs_repo,
        "count_submitted_runs_for_account_since",
        count_submitted_runs_for_account_since,
    )


async def test_execute_run_under_the_ceiling_is_admitted(scope, monkeypatch):
    monkeypatch.setattr(
        runs.runs_repo,
        "count_runs_by_mode_since",
        _counter({RunMode.EXECUTE.value: runs.EXECUTE_BACKSTOP_LIMIT - 1}),
    )
    # No exception is the assertion: the backstop must be invisible below it.
    await runs._enforce_execute_backstop(
        _request(RunMode.EXECUTE), scope, object(), _identity(), _settings()
    )


async def test_execute_run_at_the_ceiling_is_refused(scope, monkeypatch):
    monkeypatch.setattr(
        runs.runs_repo,
        "count_runs_by_mode_since",
        _counter({RunMode.EXECUTE.value: runs.EXECUTE_BACKSTOP_LIMIT}),
    )

    with pytest.raises(HTTPException) as caught:
        await runs._enforce_execute_backstop(
            _request(RunMode.EXECUTE), scope, object(), _identity(), _settings()
        )

    assert caught.value.status_code == 429
    detail = caught.value.detail
    assert detail["reason"] == "execute_backstop_exhausted"
    assert detail["limit"] == runs.EXECUTE_BACKSTOP_LIMIT
    # The message must not read as a plan allowance; a user who hits this has
    # not run out of credits, and telling them so would send them to Billing to
    # fix something billing cannot fix.
    assert "abuse backstop" in detail["error"]
    # And it must name the right noun: this ceiling is workspace-scoped, unlike
    # the account-scoped submission backstop below it.
    assert "workspace" in detail["error"]


async def test_auto_traffic_is_never_counted_toward_the_execute_ceiling(scope, monkeypatch):
    """`executed` reads only the EXECUTE key of the per-mode dict — AUTO volume
    must not leak into the ceiling that is meant to be EXECUTE-only."""
    monkeypatch.setattr(
        runs.runs_repo,
        "count_runs_by_mode_since",
        _counter({RunMode.AUTO.value: runs.EXECUTE_BACKSTOP_LIMIT * 5}),
    )
    await runs._enforce_execute_backstop(
        _request(RunMode.AUTO), scope, object(), _identity(), _settings()
    )


@pytest.mark.parametrize("mode", [RunMode.CHAT, RunMode.IDEATE, RunMode.EXPLAIN])
async def test_resolved_non_execute_modes_are_never_counted_or_refused(mode, scope, monkeypatch):
    """Chat is unmetered on purpose (PR #146) and must stay that way here.

    The counter is set far above the ceiling: if this mode consulted it, the
    call would raise.
    """
    monkeypatch.setattr(
        runs.runs_repo,
        "count_runs_by_mode_since",
        _counter({RunMode.EXECUTE.value: runs.EXECUTE_BACKSTOP_LIMIT * 10}),
    )
    await runs._enforce_execute_backstop(_request(mode), scope, object(), _identity(), _settings())


async def test_the_window_is_a_trailing_seven_days_in_utc(scope, monkeypatch):
    captured: dict = {}
    monkeypatch.setattr(runs.runs_repo, "count_runs_by_mode_since", _counter({}, captured))

    before = dt.datetime.now(dt.timezone.utc)
    await runs._enforce_execute_backstop(
        _request(RunMode.EXECUTE), scope, object(), _identity(), _settings()
    )
    after = dt.datetime.now(dt.timezone.utc)

    since = captured["since"]
    # Timezone-aware: runs.created_at is TIMESTAMP(timezone=True), and a naive
    # datetime would raise on comparison rather than silently mis-count.
    assert since.tzinfo is not None
    assert before - runs.EXECUTE_BACKSTOP_WINDOW <= since <= after - runs.EXECUTE_BACKSTOP_WINDOW


def test_the_ceiling_sits_far_above_every_shipped_tier():
    """A legitimate user must never see this one.

    The free tier is 5 execute runs/week (`tiers.TIER_LIMITS`). If this ceiling
    ever drifts down toward that, it stops being a backstop and starts being a
    second, conflicting allowance.
    """
    assert runs.EXECUTE_BACKSTOP_LIMIT >= 100
    assert runs.EXECUTE_BACKSTOP_WINDOW == dt.timedelta(days=7)


def _compiler_request() -> runs.CreateRunRequest:
    """The code-free compiler preview the Studio submits.

    It is `mode=EXECUTE` with a `circuit_optimization` body and no source, and
    it skips the TIER gate on purpose — no LLM tokens are spent on it, so
    charging it against the account's weekly agent-token allowance would be
    wrong. `test_run_tier_allowance.py` pins that skip.
    """
    return runs.CreateRunRequest(
        task_prompt="Compile the bounded Studio circuit with qiskit.",
        framework=Framework.QISKIT,
        mode=RunMode.EXECUTE,
        circuit_optimization={
            "compiler": "qiskit",
            "qubit_count": 1,
            "operations": [{"gate": "H", "qubits": [0]}],
        },
    )


async def test_compiler_preview_under_the_ceiling_is_admitted(scope, monkeypatch):
    monkeypatch.setattr(
        runs.runs_repo,
        "count_runs_by_mode_since",
        _counter({RunMode.EXECUTE.value: runs.EXECUTE_BACKSTOP_LIMIT - 1}),
    )
    # No exception is the assertion, same as the plain EXECUTE case above.
    await runs._enforce_execute_backstop(
        _compiler_request(), scope, object(), _identity(), _settings()
    )


async def test_compiler_preview_still_meets_the_execute_ceiling(scope, monkeypatch):
    """Skipping the tier gate must not skip the abuse backstop.

    ## Why this test is in THIS file and not beside the skip it guards

    The skip is pinned in `test_run_tier_allowance.py`, and that file cannot
    hold this assertion: its autouse `_no_backstop` fixture zeroes BOTH
    backstops for every test in it, so a regression that gated
    `EXECUTE_BACKSTOP_LIMIT` on `circuit_optimization is None` — exactly the
    one-line change that produced the tier skip — would pass there in silence.
    A test that cannot fail is not evidence, and the skip was shipped with the
    positive half pinned and the negative half unpinned.

    The distinction being defended: the tier gate meters **LLM spend**, which a
    code-free compile does not incur, while this ceiling bounds **submission
    volume** from a token holder, which a code-free compile incurs exactly as
    much as any other run. The first is a reason to skip; the second is not.
    """
    monkeypatch.setattr(
        runs.runs_repo,
        "count_runs_by_mode_since",
        _counter({RunMode.EXECUTE.value: runs.EXECUTE_BACKSTOP_LIMIT}),
    )

    with pytest.raises(HTTPException) as caught:
        await runs._enforce_execute_backstop(
            _compiler_request(), scope, object(), _identity(), _settings()
        )

    assert caught.value.status_code == 429
    assert caught.value.detail["reason"] == "execute_backstop_exhausted"
    assert caught.value.detail["limit"] == runs.EXECUTE_BACKSTOP_LIMIT
