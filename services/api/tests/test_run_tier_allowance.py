"""The per-tier weekly run allowance, enforced by the control plane itself.

Until now this decision lived only in the web BFF, which is a different server:
anyone holding a valid access token could call POST /v1/runs directly and never
meet it. NEXT.md §2 called that out as a precondition for multi-user sign-up —
"a BFF gate is not a gate".

The flat abuse backstop is a separate thing and has its own file. What these
tests pin is that the number a *user* recognises is enforced here, that chat
stays unmetered, and that no missing configuration can throttle the operator.
"""

import datetime as dt

import pytest
from fastapi import HTTPException
from majorana_contracts.enums import Framework, RunMode

from repo_test_helpers import LockOnlySession

from majorana_api.orm import User, Workspace
from majorana_api.routes import runs
from majorana_api.settings import Settings
from majorana_api.tiers import TIER_LIMITS, limits_for, resolve_tier

FREE_WEEKLY = TIER_LIMITS["free"].agent_runs_per_week
assert FREE_WEEKLY is not None


def _settings(developer_emails: frozenset[str] = frozenset()) -> Settings:
    return Settings(
        workos_client_id="test",
        workos_jwt_issuer="https://issuer.invalid",
        workos_jwks_url="https://jwks.invalid",
        web_origin="https://web.invalid",
        developer_emails=developer_emails,
    )


def _identity(email: str, plan: str | None = None):
    return User(email=email, plan=plan), Workspace()


def _request(mode: RunMode = RunMode.EXECUTE) -> runs.CreateRunRequest:
    return runs.CreateRunRequest(
        task_prompt="Build a Bell pair", framework=Framework.QISKIT, mode=mode
    )


@pytest.fixture(autouse=True)
def _no_backstop(monkeypatch):
    """Keep the flat ceiling out of the way; it has its own tests."""

    async def none(*_args, **_kwargs):
        return {}

    monkeypatch.setattr(runs.runs_repo, "count_runs_by_mode_since", none)


def _executed(count: int, captured: dict | None = None):
    async def count_execute_runs_since(_scope, _session, since):
        if captured is not None:
            captured["since"] = since
        return count

    return count_execute_runs_since


async def test_a_free_account_is_refused_at_its_weekly_limit(scope, monkeypatch):
    monkeypatch.setattr(runs.runs_repo, "count_execute_runs_since", _executed(FREE_WEEKLY))

    with pytest.raises(HTTPException) as caught:
        await runs._enforce_execute_backstop(
            _request(), scope, LockOnlySession(), _identity("someone@example.com"), _settings()
        )

    assert caught.value.status_code == 429
    detail = caught.value.detail
    assert detail["reason"] == "run_allowance_exhausted"
    assert detail["limit"] == FREE_WEEKLY
    # This one IS the plan allowance. Telling a user who used their five runs
    # that they hit "an abuse backstop" would send them to support for something
    # support cannot fix.
    assert "abuse backstop" not in detail["error"]
    assert "plan includes" in detail["error"]


async def test_one_run_below_the_limit_is_admitted(scope, monkeypatch):
    monkeypatch.setattr(runs.runs_repo, "count_execute_runs_since", _executed(FREE_WEEKLY - 1))
    await runs._enforce_execute_backstop(
        _request(), scope, LockOnlySession(), _identity("someone@example.com"), _settings()
    )


async def test_chat_traffic_is_never_metered_against_the_plan(scope, monkeypatch):
    """A free account's conversation is unmetered by policy (PR #146).

    The counter sits far above the limit: if AUTO consulted the tier gate, this
    would raise, and a free user's fifth execute run would silently cost them
    the ability to ask a follow-up question.
    """
    monkeypatch.setattr(runs.runs_repo, "count_execute_runs_since", _executed(FREE_WEEKLY * 100))
    await runs._enforce_execute_backstop(
        _request(RunMode.AUTO),
        scope,
        LockOnlySession(),
        _identity("someone@example.com"),
        _settings(),
    )


async def test_the_operator_is_never_throttled_by_a_missing_env_var(scope, monkeypatch):
    """The failure mode that kept this server-side gate from being written.

    Every synthetic identity resolves to developer with an EMPTY allowlist, so a
    Cloud Run service missing LEONA_DEVELOPER_EMAILS cannot cut the operator — or
    the deploy gate, which is not a customer either — down to five runs a week.
    """
    monkeypatch.setattr(runs.runs_repo, "count_execute_runs_since", _executed(FREE_WEEKLY * 100))
    for email in ("local-dev@majorana.test", "deploy-probe@leonaquantum.com"):
        await runs._enforce_execute_backstop(
            _request(), scope, LockOnlySession(), _identity(email), _settings()
        )


async def test_a_developer_by_allowlist_or_by_plan_column_is_unmetered(scope, monkeypatch):
    monkeypatch.setattr(runs.runs_repo, "count_execute_runs_since", _executed(FREE_WEEKLY * 100))
    await runs._enforce_execute_backstop(
        _request(),
        scope,
        LockOnlySession(),
        _identity("collaborator@example.com"),
        _settings(frozenset({"collaborator@example.com"})),
    )
    # The database column is the escape hatch that needs no redeploy.
    await runs._enforce_execute_backstop(
        _request(),
        scope,
        LockOnlySession(),
        _identity("collaborator@example.com", plan="developer"),
        _settings(),
    )


async def test_the_window_matches_the_one_the_bff_measures(scope, monkeypatch):
    captured: dict = {}
    monkeypatch.setattr(runs.runs_repo, "count_execute_runs_since", _executed(0, captured))

    before = dt.datetime.now(dt.timezone.utc)
    await runs._enforce_execute_backstop(
        _request(), scope, LockOnlySession(), _identity("someone@example.com"), _settings()
    )
    after = dt.datetime.now(dt.timezone.utc)

    since = captured["since"]
    assert since.tzinfo is not None
    assert before - runs.TIER_WINDOW <= since <= after - runs.TIER_WINDOW
    # Seven days, the same trailing window run-allowance.ts uses. A user must not
    # see two different "used" numbers depending on which service refused them.
    assert runs.TIER_WINDOW == dt.timedelta(days=7)


async def test_the_tier_gate_is_checked_before_the_flat_backstop(scope, monkeypatch):
    """Both exhausted: the user must be told about their plan, not the ceiling."""
    monkeypatch.setattr(runs.runs_repo, "count_execute_runs_since", _executed(FREE_WEEKLY))

    async def at_ceiling(*_args, **_kwargs):
        return {RunMode.EXECUTE.value: runs.EXECUTE_BACKSTOP_LIMIT}

    monkeypatch.setattr(runs.runs_repo, "count_runs_by_mode_since", at_ceiling)

    with pytest.raises(HTTPException) as caught:
        await runs._enforce_execute_backstop(
            _request(), scope, LockOnlySession(), _identity("someone@example.com"), _settings()
        )
    assert caught.value.detail["reason"] == "run_allowance_exhausted"


def test_the_server_side_numbers_match_the_published_plan():
    """These are the numbers OWNER_TODO §8 tells the owner are the policy.

    A silent divergence here would meter people differently from what they were
    told, which is worse than either number being wrong on its own.
    """
    assert limits_for("free").agent_runs_per_week == 5
    assert limits_for("free").private_artifacts == 25
    assert limits_for("developer").agent_runs_per_week is None
    assert limits_for("developer").private_artifacts is None


def test_an_unknown_account_is_free_rather_than_unlimited():
    """Fail closed: an identity nothing recognises gets the metered tier."""
    assert resolve_tier(None) == "free"
    assert resolve_tier("") == "free"
    assert resolve_tier("stranger@example.com") == "free"
    assert resolve_tier("stranger@example.com", plan="free") == "free"
    # Case and padding must not be a way past the allowlist or into it.
    assert resolve_tier("  Local-Dev@Majorana.TEST ") == "developer"
