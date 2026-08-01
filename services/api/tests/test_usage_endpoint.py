"""GET /v1/usage — the numbers a user sees before they run out, not after.

The thing these tests exist to stop is a *disagreement*. Every number this route
reports has a gate elsewhere that refuses on the same quantity, and the failure
that matters is not "the endpoint 500s" — it is the screen saying two runs are
left and the submission refusing anyway. So the first test compares the two
statements rather than the two answers, and the last one walks the same count
through both the report and the gate.
"""

import datetime as dt

import pytest
from fastapi import HTTPException
from majorana_contracts.enums import Framework, RunMode
from repo_test_helpers import compiled

from majorana_api.orm import User, Workspace
from majorana_api.repos import runs as runs_repo
from majorana_api.routes import runs as runs_routes
from majorana_api.routes import usage as usage_routes
from majorana_api.settings import Settings
from majorana_api.tiers import TIER_LIMITS, TIER_WINDOW

FREE_WEEKLY = TIER_LIMITS["free"].agent_runs_per_week
FREE_ARTIFACTS = TIER_LIMITS["free"].private_artifacts
FREE_WORKSPACES = TIER_LIMITS["free"].owned_workspaces
assert FREE_WEEKLY is not None and FREE_ARTIFACTS is not None and FREE_WORKSPACES is not None

NOW = dt.datetime(2026, 8, 1, 12, 0, tzinfo=dt.timezone.utc)


def _settings(developer_emails: frozenset[str] = frozenset()) -> Settings:
    return Settings(
        workos_client_id="test",
        workos_jwt_issuer="https://issuer.invalid",
        workos_jwks_url="https://jwks.invalid",
        web_origin="https://web.invalid",
        developer_emails=developer_emails,
    )


def _identity(email: str = "someone@example.com", plan: str | None = None):
    return User(email=email, plan=plan), Workspace()


def _wire(monkeypatch, *, executed: int, oldest: list[dt.datetime], kept: int = 0, owned: int = 1):
    """Stand in for the three repositories the route reads, recording its calls."""
    seen: dict = {}

    async def count_execute_runs_since(_scope, _session, since):
        seen["count_since"] = since
        return executed

    async def oldest_allowance_runs_since(_scope, _session, since, *, count):
        seen["oldest_since"] = since
        seen["oldest_count"] = count
        return oldest[:count]

    async def get_overview(_scope, _session):
        return object(), [], kept, 0

    async def count_owned_workspaces(_session, *, user_id):
        return owned

    monkeypatch.setattr(
        usage_routes.runs_repo, "count_execute_runs_since", count_execute_runs_since
    )
    monkeypatch.setattr(
        usage_routes.runs_repo, "oldest_allowance_runs_since", oldest_allowance_runs_since
    )
    monkeypatch.setattr(usage_routes.workspaces_repo, "get_overview", get_overview)
    monkeypatch.setattr(usage_routes.system, "count_owned_workspaces", count_owned_workspaces)
    return seen


async def _usage(scope, monkeypatch, *, email: str = "someone@example.com", **wiring):
    seen = _wire(monkeypatch, **wiring)
    result = await usage_routes.usage(_identity(email), scope, object(), _settings())
    return result, seen


# --- the anti-drift test, which is the point of the file -------------------


def test_the_count_and_the_timestamps_select_the_same_rows(scope):
    """One predicate, two statements — asserted on the SQL, not on two answers.

    If these ever diverge the endpoint keeps returning a number and the gate
    keeps returning a different one, with nothing failing. Comparing the
    compiled WHERE clauses is the only check that notices before a user does.
    """
    since = NOW - TIER_WINDOW
    count_sql, count_params = compiled(runs_repo.execute_allowance_stmt(scope, since))
    oldest_sql, oldest_params = compiled(
        runs_repo.oldest_allowance_runs_stmt(scope, since, count=1)
    )

    def where(sql: str) -> str:
        return sql.split("WHERE", 1)[1].split("ORDER BY", 1)[0].split("LIMIT", 1)[0].strip()

    assert where(count_sql) == where(oldest_sql)
    for key in ("user_id_1", "mode_1", "created_at_1"):
        assert count_params[key] == oldest_params[key]


def test_the_timestamp_query_is_account_wide_like_the_count(scope):
    """The one repo query that must NOT bind workspace_id now has a sibling.

    `count_execute_runs_since` is deliberately the only unscoped read in the
    repository layer (its docstring argues the case at length). The timestamps
    query inherits that exemption by construction; this pins it, because a
    later reviewer adding `workspace_id` "for consistency" would silently make
    the reported reset date disagree with the enforced one for anybody in more
    than one workspace.
    """
    sql, params = compiled(runs_repo.oldest_allowance_runs_stmt(scope, NOW, count=1))
    assert scope.user_id in params.values()
    assert scope.workspace_id not in params.values()
    assert "ORDER BY" in sql and "created_at ASC" in sql.replace("runs.", "")


def test_the_oldest_query_reads_ascending_not_descending(scope):
    """Descending would answer "the most recent run", which is the wrong run.

    The index behind this is DESC, so a copy-paste from the gate's ordering is
    the plausible mistake — and it would report a reset date up to seven days
    late without ever being wrong-shaped.
    """
    sql, _ = compiled(runs_repo.oldest_allowance_runs_stmt(scope, NOW, count=3))
    ordering = sql.split("ORDER BY", 1)[1]
    assert "DESC" not in ordering.upper()


async def test_no_rows_are_fetched_when_none_are_asked_for(scope, session):
    assert await runs_repo.oldest_allowance_runs_since(scope, session, NOW, count=0) == []
    assert session.statements == [], "a zero-row request must not reach the database"


# --- the arithmetic --------------------------------------------------------


@pytest.mark.parametrize(
    ("used", "limit", "expected"),
    [
        (1, 5, 1),  # ordinary: your oldest run returns and you are back under
        (5, 5, 1),  # exactly spent: still just the oldest
        (7, 5, 3),  # over the limit — three must age out before 6 < 5 is false
        (0, 5, 1),
        (3, None, 0),  # unlimited: nothing is waiting on anything
    ],
)
def test_how_many_runs_must_expire(used, limit, expected):
    assert usage_routes._runs_still_to_expire(used, limit) == expected


# --- the route -------------------------------------------------------------


async def test_a_free_account_sees_what_is_left_and_when_it_returns(scope, monkeypatch):
    spent = NOW - dt.timedelta(days=2)
    result, seen = await _usage(
        scope, monkeypatch, executed=2, oldest=[spent, spent + dt.timedelta(hours=1)]
    )

    assert result.tier == "free"
    assert result.runs.used == 2
    assert result.runs.limit == FREE_WEEKLY
    assert result.runs.remaining == FREE_WEEKLY - 2
    assert result.runs.exhausted is False
    assert result.runs.window_days == 7
    # Five days from now, not "next Monday" — the window rolls.
    assert result.runs.next_slot_at == spent + TIER_WINDOW
    assert seen["oldest_count"] == 1, "only the oldest run matters while under the limit"


async def test_an_exhausted_account_still_gets_a_date(scope, monkeypatch):
    spent = NOW - dt.timedelta(days=6)
    result, _ = await _usage(
        scope,
        monkeypatch,
        executed=FREE_WEEKLY,
        oldest=[spent + dt.timedelta(minutes=i) for i in range(FREE_WEEKLY)],
    )

    assert result.runs.exhausted is True
    assert result.runs.remaining == 0
    assert result.runs.next_slot_at == spent + TIER_WINDOW


async def test_an_over_limit_account_waits_for_the_run_that_actually_frees_it(scope, monkeypatch):
    """Reachable without a bug: spend five as a developer, then get metered down.

    Reporting the oldest run's expiry here would promise a slot that arrives
    while the account is still refused.
    """
    stamps = [NOW - dt.timedelta(days=6) + dt.timedelta(hours=i) for i in range(7)]
    result, seen = await _usage(scope, monkeypatch, executed=7, oldest=stamps)

    assert seen["oldest_count"] == 3
    assert result.runs.next_slot_at == stamps[2] + TIER_WINDOW
    assert result.runs.remaining == 0


async def test_an_unspent_allowance_has_nothing_to_wait_for(scope, monkeypatch):
    result, seen = await _usage(scope, monkeypatch, executed=0, oldest=[])
    assert result.runs.next_slot_at is None
    assert result.runs.remaining == FREE_WEEKLY
    assert "oldest_count" not in seen, "no spent runs means no reason to query for one"


async def test_a_developer_account_is_reported_as_unmetered(scope, monkeypatch):
    seen = _wire(monkeypatch, executed=99, oldest=[NOW], kept=400, owned=9)
    result = await usage_routes.usage(
        _identity("dev@example.invalid", plan="developer"), scope, object(), _settings()
    )

    assert result.tier == "developer"
    for allowance in (result.runs, result.artifacts, result.workspaces):
        assert allowance.limit is None
        assert allowance.remaining is None, "unlimited must be null, never a large integer"
        assert allowance.exhausted is False
    assert result.runs.next_slot_at is None
    assert "oldest_count" not in seen, "an unmetered account waits for nothing"


async def test_both_reads_use_one_window_boundary(scope, monkeypatch):
    """A second `now()` could include a run the count never saw."""
    _result, seen = await _usage(
        scope, monkeypatch, executed=3, oldest=[NOW - dt.timedelta(days=1)]
    )
    assert seen["count_since"] == seen["oldest_since"]


async def test_artifacts_and_workspaces_report_their_own_caps(scope, monkeypatch):
    result, _ = await _usage(scope, monkeypatch, executed=0, oldest=[], kept=25, owned=3)

    assert result.artifacts.used == 25
    assert result.artifacts.limit == FREE_ARTIFACTS
    assert result.artifacts.exhausted is True
    assert result.workspaces.used == 3
    assert result.workspaces.limit == FREE_WORKSPACES
    assert result.workspaces.exhausted is True


async def test_remaining_never_goes_negative(scope, monkeypatch):
    result, _ = await _usage(scope, monkeypatch, executed=0, oldest=[], kept=FREE_ARTIFACTS + 4)
    assert result.artifacts.remaining == 0


# --- the agreement the whole file is about ---------------------------------


@pytest.mark.parametrize("executed", list(range(0, 8)))
async def test_exhausted_says_yes_exactly_when_the_gate_refuses(executed, scope, monkeypatch):
    """The screen and the gate, walked through the same count.

    `exhausted` is what the profile menu will colour red and what stops the
    composer offering a verified run. If it disagreed with `_enforce_execute_
    backstop` in either direction the product either refuses a run it advertised
    or advertises a refusal that never comes.
    """
    reported, _ = await _usage(scope, monkeypatch, executed=executed, oldest=[NOW])

    async def counted(_scope, _session, _since):
        return executed

    async def no_backstop(*_args, **_kwargs):
        return {}

    monkeypatch.setattr(runs_routes.runs_repo, "count_execute_runs_since", counted)
    monkeypatch.setattr(runs_routes.runs_repo, "count_runs_by_mode_since", no_backstop)

    request = runs_routes.CreateRunRequest(
        task_prompt="Build a Bell pair", framework=Framework.QISKIT, mode=RunMode.EXECUTE
    )
    try:
        await runs_routes._enforce_execute_backstop(
            request, scope, object(), _identity(), _settings()
        )
        gate_refused = False
    except HTTPException as refusal:
        assert refusal.detail["reason"] == "run_allowance_exhausted"
        gate_refused = True

    assert reported.runs.exhausted is gate_refused
