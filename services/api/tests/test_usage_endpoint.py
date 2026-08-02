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
from majorana_contracts.enums import CHAT_USAGE_ROLE, Framework, RunMode
from repo_test_helpers import LockOnlySession, compiled

from majorana_api.orm import User, Workspace
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import usage as usage_repo
from majorana_api.repos.usage import TokenSpendRow
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


def _wire(
    monkeypatch,
    *,
    executed: int,
    oldest: list[dt.datetime],
    kept: int = 0,
    owned: int = 1,
    shared_projects: int = 0,
    spend: list[TokenSpendRow] | None = None,
    hardware_spend_usd: float = 0.0,
):
    """Stand in for the six repositories the route reads, recording its calls."""
    seen: dict = {}

    async def count_execute_runs_since(_scope, _session, since):
        seen["count_since"] = since
        return executed

    async def oldest_allowance_runs_since(_scope, _session, since, *, count):
        seen["oldest_since"] = since
        seen["oldest_count"] = count
        return oldest[:count]

    async def count_kept_against_quota(_scope, _session):
        # Named for the function the route actually calls. It used to be
        # `get_overview`, whose number is the Vault total — the route moved to
        # the QUOTA count when the two stopped being the same integer, and a
        # double still standing in for the old one would have kept passing
        # against a route reading something else.
        seen["counted_against_quota"] = True
        return kept

    async def count_owned_workspaces(_session, *, user_id):
        return owned

    async def count_shared_projects(_session, user_id):
        seen["shared_projects_subject"] = user_id
        return shared_projects

    async def token_spend_since(_scope, _session, since):
        seen["spend_since"] = since
        return spend or []

    async def authorized_spend_since(_scope, _session, since):
        # The reservation's own function, named for it. The hardware allowance is
        # the one place the endpoint and a 429 must agree on a number, so the
        # double stands in for the thing the gate calls and nothing else.
        seen["hardware_spend_since"] = since
        return hardware_spend_usd

    monkeypatch.setattr(
        usage_routes.runs_repo, "count_execute_runs_since", count_execute_runs_since
    )
    monkeypatch.setattr(
        usage_routes.runs_repo, "oldest_allowance_runs_since", oldest_allowance_runs_since
    )
    monkeypatch.setattr(
        usage_routes.artifacts_repo, "count_kept_against_quota", count_kept_against_quota
    )
    monkeypatch.setattr(usage_routes.system, "count_owned_workspaces", count_owned_workspaces)
    monkeypatch.setattr(usage_routes.shares_repo, "count_shared_projects", count_shared_projects)
    monkeypatch.setattr(usage_routes.usage_repo, "token_spend_since", token_spend_since)
    monkeypatch.setattr(
        usage_routes.qpu_runs_repo, "authorized_spend_since", authorized_spend_since
    )
    return seen


async def _usage(
    scope, monkeypatch, *, email: str = "someone@example.com", plan: str | None = None, **wiring
):
    seen = _wire(monkeypatch, **wiring)
    result = await usage_routes.usage(_identity(email, plan=plan), scope, object(), _settings())
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


# --- token spend -----------------------------------------------------------
#
# The allowance numbers above have a gate to disagree with. This block has no
# gate at all — nothing refuses on tokens — so its failure mode is different and
# quieter: a number that is simply wrong, on a screen where nothing else says
# what the right one would have been. The tests are therefore about the two ways
# it can be wrong without looking wrong: an event landing in the wrong bucket,
# and an event landing in no bucket.


def _spend(*rows: TokenSpendRow):
    return usage_routes._fold_spend(rows, window_days=7)


def test_the_chat_role_is_the_literal_already_in_the_ledger():
    """`usage_events` is append-only — this string cannot be migrated.

    Every chat row written since the last release carries `"chat"` in its meta
    and the table's grant revokes UPDATE, so renaming the constant does not
    rename the history: it makes every existing chat turn read as a run, on a
    screen with nothing to check the number against. The pin belongs here and
    not only in the worker's handler test, which asserts what is written.
    """
    assert CHAT_USAGE_ROLE == "chat"


def test_chat_and_runs_partition_the_total():
    report = _spend(
        TokenSpendRow(role=CHAT_USAGE_ROLE, model="deepseek-chat", calls=4, tokens=9_000),
        TokenSpendRow(role="circuit_plan", model="deepseek-chat", calls=2, tokens=5_000),
        TokenSpendRow(role="verification_review", model="deepseek-reasoner", calls=1, tokens=800),
    )

    assert report.chat.tokens == 9_000
    assert report.chat.calls == 4
    assert report.runs.tokens == 5_800, "every non-chat role is a run stage"
    assert report.runs.calls == 3
    assert report.total.tokens == report.chat.tokens + report.runs.tokens
    assert report.total.calls == report.chat.calls + report.runs.calls


def test_an_unknown_role_counts_as_a_run_and_not_as_chat():
    """The bucketing is `== "chat"`, never a list of the stages that exist.

    Roles come from the agent request's `schema_name`, so the pipeline gaining a
    stage renames this set without touching this file. Bucketing by exclusion
    means a new stage is counted as a run — visible, if slightly coarse. The
    other way round it would be counted as chat, and the one number this feature
    exists to produce would drift upward every time the agent changed.
    """
    report = _spend(TokenSpendRow(role="a_stage_added_next_year", model="m", calls=1, tokens=10))

    assert report.chat.tokens == 0
    assert report.runs.tokens == 10


def test_a_role_that_merely_contains_chat_is_not_chat():
    report = _spend(TokenSpendRow(role="chat_summary_review", model="m", calls=1, tokens=10))
    assert report.chat.tokens == 0


def test_the_per_model_list_accounts_for_every_token():
    """`by_model` is a partition of `total`, not a highlights list.

    A per-model breakdown that dropped rows would still render, still look
    plausible, and still be smaller than the total printed above it — the exact
    shape of wrong that nobody reports.
    """
    report = _spend(
        TokenSpendRow(role=CHAT_USAGE_ROLE, model="deepseek-chat", calls=1, tokens=100),
        TokenSpendRow(role="circuit_plan", model="deepseek-chat", calls=1, tokens=50),
        TokenSpendRow(role="circuit_plan", model="deepseek-reasoner", calls=1, tokens=700),
        TokenSpendRow(role=CHAT_USAGE_ROLE, model="", calls=1, tokens=3),
    )

    assert sum(entry.tokens for entry in report.by_model) == report.total.tokens
    assert sum(entry.calls for entry in report.by_model) == report.total.calls
    # One model, spent by both chat and a run stage, is one row.
    assert [(entry.model, entry.tokens) for entry in report.by_model] == [
        ("deepseek-reasoner", 700),
        ("deepseek-chat", 150),
        ("", 3),
    ]


def test_an_event_with_no_model_keeps_its_tokens():
    """A row whose meta never carried a model is unattributed, not absent."""
    report = _spend(TokenSpendRow(role=CHAT_USAGE_ROLE, model="", calls=1, tokens=42))

    assert report.total.tokens == 42
    assert [entry.model for entry in report.by_model] == [""]


def test_models_that_tie_have_a_stable_order():
    """Two requests over the same rows must not swap two rows on a screen."""
    rows = (
        TokenSpendRow(role="circuit_plan", model="bravo", calls=1, tokens=500),
        TokenSpendRow(role="circuit_plan", model="alpha", calls=1, tokens=500),
    )
    assert [entry.model for entry in _spend(*rows).by_model] == ["alpha", "bravo"]
    assert [entry.model for entry in _spend(*reversed(rows)).by_model] == ["alpha", "bravo"]


def test_a_workspace_that_has_spent_nothing_reports_zeroes_not_nulls():
    """Null would make the client choose between "none" and "unknown"."""
    report = _spend()

    assert report.total.tokens == 0 and report.total.calls == 0
    assert report.chat.tokens == 0 and report.runs.tokens == 0
    assert report.by_model == []
    assert report.window_days == 7


def test_the_spend_query_is_scoped_to_the_workspace(scope):
    """Unlike the allowance beside it, which is deliberately account-wide.

    Copying `_spends_the_weekly_allowance`'s exemption into this query would
    sum a second tenant's chat into this workspace's number — with a 200 and
    nothing to notice it by.
    """
    sql, params = compiled(usage_repo.token_spend_stmt(scope, NOW))

    assert scope.workspace_id in params.values()
    assert "GROUP BY" in sql
    assert "llm_tokens" in params.values(), "one kind, not every metered quantity"


async def test_the_spend_window_is_the_one_the_runs_figure_used(scope, monkeypatch):
    """One `now()` for the whole response — the two are read as one sentence."""
    _result, seen = await _usage(
        scope, monkeypatch, executed=1, oldest=[NOW - dt.timedelta(days=1)]
    )
    assert seen["spend_since"] == seen["count_since"]


async def test_the_route_reports_the_folded_ledger(scope, monkeypatch):
    result, _ = await _usage(
        scope,
        monkeypatch,
        executed=0,
        oldest=[],
        spend=[
            TokenSpendRow(role=CHAT_USAGE_ROLE, model="deepseek-chat", calls=6, tokens=12_345),
            TokenSpendRow(role="circuit_plan", model="deepseek-chat", calls=2, tokens=2_000),
        ],
    )

    assert result.spend.chat.tokens == 12_345
    assert result.spend.runs.tokens == 2_000
    assert result.spend.total.calls == 8
    assert result.spend.window_days == TIER_WINDOW.days


async def test_an_unmetered_account_still_gets_its_spend(scope, monkeypatch):
    """Spend is not an allowance, so being unmetered does not silence it.

    A developer account is the one most likely to want the number, and every
    other block on this response goes null for it.
    """
    _wire(
        monkeypatch,
        executed=99,
        oldest=[NOW],
        spend=[TokenSpendRow(role=CHAT_USAGE_ROLE, model="m", calls=1, tokens=77)],
    )
    result = await usage_routes.usage(
        _identity("dev@example.invalid", plan="developer"), scope, object(), _settings()
    )

    assert result.runs.limit is None
    assert result.spend.chat.tokens == 77


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
    session = LockOnlySession()
    try:
        await runs_routes._enforce_execute_backstop(
            request, scope, session, _identity(), _settings()
        )
        gate_refused = False
    except HTTPException as refusal:
        assert refusal.detail["reason"] == "run_allowance_exhausted"
        gate_refused = True

    assert reported.runs.exhausted is gate_refused
    # The gate reserved rather than merely counted. Without this the double
    # would happily stand in for a version that dropped the lock again.
    assert session.statements, "the allowance gate issued no statement of its own"


# --- the hardware allowance, which is the one denominated in money ----------


async def test_the_hardware_allowance_is_reported_in_dollars_against_the_tier(scope, monkeypatch):
    """Until now this ceiling existed only in the 429 that enforced it.

    `POST /v1/qpu/submissions` refuses on a weekly DOLLAR limit, and nothing the
    account page could read said the limit was there — so a user could not
    anticipate the refusal, only be told about it afterwards.
    """
    result, seen = await _usage(
        scope,
        monkeypatch,
        executed=0,
        oldest=[],
        hardware_spend_usd=6.25,
    )

    assert result.hardware_spend.used_usd == pytest.approx(6.25)
    assert result.hardware_spend.limit_usd == pytest.approx(0.0)  # free tier
    assert result.hardware_spend.window_days == TIER_WINDOW.days
    # The same instant the runs figure used: two windows would be two different
    # weeks presented as one sentence.
    assert seen["hardware_spend_since"] == seen["count_since"]


async def test_an_unmetered_account_reports_no_hardware_ceiling(scope, monkeypatch):
    result, _ = await _usage(
        scope,
        monkeypatch,
        executed=0,
        oldest=[],
        hardware_spend_usd=1234.5,
        plan="developer",
    )

    assert result.hardware_spend.limit_usd is None
    assert result.hardware_spend.remaining_usd is None
    assert result.hardware_spend.exhausted is False
    assert result.hardware_spend.used_usd == pytest.approx(1234.5)


@pytest.mark.parametrize(
    ("spent", "exhausted", "remaining"),
    [
        (0.0, True, 0.0),  # free's ceiling IS 0.0, so it starts exhausted
        (12.0, False, 13.0),
        (25.0, True, 0.0),  # exactly at the ceiling: nothing priced still fits
        (30.0, True, 0.0),  # never negative
    ],
)
async def test_remaining_and_exhausted_track_the_ceiling_without_going_negative(
    scope, monkeypatch, spent, exhausted, remaining
):
    """`exhausted` is `>=` where the reservation is `>`, and that is deliberate.

    The reservation asks whether ONE named estimate fits, so at exactly the limit
    it still admits a $0 free-queue submission. This flag answers the different
    question a client renders — can anything priced still be submitted — and at
    exactly the ceiling the answer is no. A free-queue submission is unaffected
    because that path returns before any comparison, not because of this flag.
    """
    plan = None if spent == 0.0 else "team"
    result, _ = await _usage(
        scope, monkeypatch, executed=0, oldest=[], hardware_spend_usd=spent, plan=plan
    )

    assert result.hardware_spend.exhausted is exhausted
    assert result.hardware_spend.remaining_usd == pytest.approx(remaining)
    assert result.hardware_spend.remaining_usd >= 0.0
