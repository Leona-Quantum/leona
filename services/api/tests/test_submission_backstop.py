"""The per-ACCOUNT, tier-aware submission backstop (ai-ops 86, 2026-08-14).

Until this ruling, `SUBMISSION_BACKSTOP_LIMIT` was a flat 1000, counted PER
WORKSPACE. The free tier sells `owned_workspaces=3` (`tiers.TIER_LIMITS`), so
one free signup could spread submissions across three workspaces and clear
three times the intended ceiling — about 3,000 model turns a week — and the
constant was tier-blind besides, checked identically against every tier
regardless of what it had actually been sold.

The owner's ruling fixes both: "Ten times the tier's weekly allowance, per
user — Free 50, Plus 750, Professional 2,500, Enterprise alert-only." This
file pins that table, that the counter is the ACCOUNT's across every workspace
it acts in (not one workspace's), and that Enterprise/developer is never
refused. `EXECUTE_BACKSTOP_LIMIT` — the other, untouched ceiling — has its own
file, `test_run_execute_backstop.py`. The account-vs-workspace query shape is
pinned DB-free in `test_repo_scoping.py`; the live cross-workspace and
concurrency proofs are in `test_submission_backstop_race_live.py`.

AUTO throughout, deliberately: it is what ordinary chat arrives as (the
default mode on `CreateRunRequest`), it is the traffic this ruling exists to
bound, and taking this path skips the EXECUTE-only tier-token reservation
entirely, so these tests are about the submission backstop alone.
"""

import datetime as dt

import pytest
from fastapi import HTTPException
from majorana_contracts.enums import Framework, RunMode

from repo_test_helpers import LockOnlySession

from majorana_api.orm import User, Workspace
from majorana_api.routes import runs
from majorana_api.settings import Settings
from majorana_api.tiers import TIER_LIMITS


def _settings(**allowlists: frozenset[str]) -> Settings:
    return Settings(
        workos_client_id="test",
        workos_jwt_issuer="https://issuer.invalid",
        workos_jwks_url="https://jwks.invalid",
        web_origin="https://web.invalid",
        **allowlists,
    )


def _identity(email: str = "someone@example.com", plan: str | None = None):
    return User(email=email, plan=plan), Workspace()


def _request(mode: RunMode = RunMode.AUTO) -> runs.CreateRunRequest:
    return runs.CreateRunRequest(task_prompt="hello", framework=Framework.QISKIT, mode=mode)


@pytest.fixture(autouse=True)
def _no_execute_backstop(monkeypatch):
    """Keep the untouched, per-workspace EXECUTE ceiling out of the way.

    Every test in this file submits AUTO, so `executed` is read but never
    compared against `EXECUTE_BACKSTOP_LIMIT`. This exists only so
    `count_runs_by_mode_since` — still called unconditionally at the top of
    `_enforce_execute_backstop` — does not reach a real session.
    """

    async def count_runs_by_mode_since(_scope, _session, _since):
        return {}

    monkeypatch.setattr(runs.runs_repo, "count_runs_by_mode_since", count_runs_by_mode_since)


def _submitted(monkeypatch, count: int, captured: dict | None = None):
    async def count_submitted_runs_for_account_since(_scope, _session, since):
        if captured is not None:
            captured["since"] = since
        return count

    monkeypatch.setattr(
        runs.runs_repo,
        "count_submitted_runs_for_account_since",
        count_submitted_runs_for_account_since,
    )


# --- the table itself, and that it is derived rather than restated ---------


def test_the_limit_is_ten_times_each_tier_s_advertised_weekly_runs():
    """Pins the owner's table (ai-ops 86): Free 50, Plus 750, Professional
    2,500, Enterprise (developer) no ceiling."""
    assert runs.submission_backstop_limit(TIER_LIMITS["free"]) == 50
    assert runs.submission_backstop_limit(TIER_LIMITS["pro"]) == 750
    assert runs.submission_backstop_limit(TIER_LIMITS["team"]) == 2500
    assert runs.submission_backstop_limit(TIER_LIMITS["developer"]) is None


def test_the_limit_is_derived_not_a_second_set_of_constants():
    """The multiplier must apply to WHATEVER `agent_runs_per_week` is, for
    every tier, so the two numbers cannot drift apart the way a hardcoded
    second table could — the same failure mode
    `test_the_token_allowance_is_derived_from_the_advertised_run_count` in
    `test_run_tier_allowance.py` exists to catch for the tier gate itself."""
    for tier, limits in TIER_LIMITS.items():
        expected = (
            None
            if limits.agent_runs_per_week is None
            else limits.agent_runs_per_week * runs.SUBMISSION_BACKSTOP_MULTIPLIER
        )
        assert runs.submission_backstop_limit(limits) == expected, tier


# --- each paid tier's ceiling -----------------------------------------------


@pytest.mark.parametrize(("tier", "limit"), [("free", 50), ("pro", 750), ("team", 2500)])
async def test_a_metered_tier_is_admitted_one_below_its_ceiling(tier, limit, scope, monkeypatch):
    _submitted(monkeypatch, limit - 1)
    email = f"{tier}@example.com"
    allowlist = {} if tier == "free" else {f"{tier}_emails": frozenset({email})}
    await runs._enforce_execute_backstop(
        _request(), scope, LockOnlySession(), _identity(email), _settings(**allowlist)
    )


@pytest.mark.parametrize(("tier", "limit"), [("free", 50), ("pro", 750), ("team", 2500)])
async def test_a_metered_tier_is_refused_at_its_ceiling(tier, limit, scope, monkeypatch):
    _submitted(monkeypatch, limit)
    email = f"{tier}@example.com"
    allowlist = {} if tier == "free" else {f"{tier}_emails": frozenset({email})}

    with pytest.raises(HTTPException) as caught:
        await runs._enforce_execute_backstop(
            _request(), scope, LockOnlySession(), _identity(email), _settings(**allowlist)
        )

    assert caught.value.status_code == 429
    detail = caught.value.detail
    assert detail["reason"] == "submission_backstop_exhausted"
    assert detail["limit"] == limit
    assert detail["used"] == limit
    # Must not read as the plan allowance itself: a Plus subscriber refused
    # here has not run out of the runs they were sold; they have hit the abuse
    # backstop sitting above that allowance.
    assert "abuse backstop" in detail["error"]
    assert "plan includes" not in detail["error"]
    # And must name the right noun — this ceiling is the ACCOUNT's, unlike the
    # workspace-scoped EXECUTE_BACKSTOP_LIMIT.
    assert "account" in detail["error"]


async def test_the_default_omitted_mode_still_hits_the_submission_backstop(scope, monkeypatch):
    """Regression: AUTO is the DEFAULT mode on CreateRunRequest, and a caller
    that simply omits `mode` must not be able to submit without bound."""
    defaulted = runs.CreateRunRequest(task_prompt="anything", framework=Framework.QISKIT)
    assert defaulted.mode is RunMode.AUTO

    _submitted(monkeypatch, 50)
    with pytest.raises(HTTPException) as caught:
        await runs._enforce_execute_backstop(
            defaulted, scope, LockOnlySession(), _identity("free@example.com"), _settings()
        )
    assert caught.value.detail["reason"] == "submission_backstop_exhausted"


async def test_the_window_matches_the_execute_backstop_window(scope, monkeypatch):
    captured: dict = {}
    _submitted(monkeypatch, 0, captured)

    before = dt.datetime.now(dt.timezone.utc)
    await runs._enforce_execute_backstop(
        _request(), scope, LockOnlySession(), _identity("free@example.com"), _settings()
    )
    after = dt.datetime.now(dt.timezone.utc)

    since = captured["since"]
    assert since.tzinfo is not None
    assert before - runs.EXECUTE_BACKSTOP_WINDOW <= since <= after - runs.EXECUTE_BACKSTOP_WINDOW


# --- Enterprise / developer: never refused, but observable ------------------


async def test_enterprise_is_never_refused_at_any_volume(scope, monkeypatch):
    """ai-ops 86: "Enterprise alert-only" — there is no number this tier hits."""
    _submitted(monkeypatch, 10_000_000)
    await runs._enforce_execute_backstop(
        _request(), scope, LockOnlySession(), _identity("local-dev@majorana.test"), _settings()
    )


async def test_a_developer_tier_account_by_allowlist_is_also_never_refused(scope, monkeypatch):
    """Not just the synthetic operator identities — any account resolved to
    developer tier by `LEONA_DEVELOPER_EMAILS` or the `users.plan` column is
    equally unmetered, the way a real Enterprise seat would be."""
    _submitted(monkeypatch, 10_000_000)
    await runs._enforce_execute_backstop(
        _request(),
        scope,
        LockOnlySession(),
        _identity("enterprise-customer@example.com"),
        _settings(developer_emails=frozenset({"enterprise-customer@example.com"})),
    )


async def test_enterprise_takes_no_lock(scope, monkeypatch):
    """`limit is None` must skip the row lock entirely — the same rule
    `system.reserve_owned_workspace_slot` already follows. Queueing every
    developer-tier submission behind a row lock would be a cost with no
    purchase, since nothing on this path is ever refused."""
    session = LockOnlySession()
    _submitted(monkeypatch, 999)
    await runs._enforce_execute_backstop(
        _request(), scope, session, _identity("local-dev@majorana.test"), _settings()
    )
    assert session.statements == []


async def test_enterprise_submissions_are_logged_for_the_alert(scope, monkeypatch, caplog):
    """Never refused is not the same as invisible. ai-ops 86 asks for an alert
    or a log in place of the refusal, so usage stays observable even though
    nothing here decides what "too much" is for a tier sold as unlimited."""
    _submitted(monkeypatch, 12_345)
    with caplog.at_level("INFO", logger=runs.logger.name):
        await runs._enforce_execute_backstop(
            _request(), scope, LockOnlySession(), _identity("local-dev@majorana.test"), _settings()
        )
    assert any("12345" in record.getMessage() for record in caplog.records), caplog.records


async def test_a_metered_tier_is_not_logged_at_all(scope, monkeypatch, caplog):
    """The alert path is specific to the unmetered tier — a metered account
    admitted normally must not add log noise on every ordinary submission."""
    _submitted(monkeypatch, 1)
    with caplog.at_level("INFO", logger=runs.logger.name):
        await runs._enforce_execute_backstop(
            _request(), scope, LockOnlySession(), _identity("free@example.com"), _settings()
        )
    assert caplog.records == []
