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
import re
from pathlib import Path

import pytest
from fastapi import HTTPException
from majorana_contracts.enums import Framework, RunMode

from repo_test_helpers import LockOnlySession

from majorana_api.orm import User, Workspace
from majorana_api.routes import runs
from majorana_api.settings import Settings
from majorana_api.tiers import (
    TIER_LIMITS,
    TOKENS_PER_RUN_EQUIVALENT,
    limits_for,
    resolve_tier,
)

#: The ENFORCED figure since 2026-08-03. `agent_runs_per_week` is still what
#: the plan is sold as, and this file used to meter on it — left there, every
#: assertion below would have gone on passing about a number the gate no
#: longer reads.
FREE_TOKENS = TIER_LIMITS["free"].agent_tokens_per_week
FREE_RUNS = TIER_LIMITS["free"].agent_runs_per_week
assert FREE_TOKENS is not None and FREE_RUNS is not None


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


def _spent(monkeypatch, tokens: int, *, in_flight: int = 0, captured: dict | None = None):
    """Stand in for both halves of the token reservation.

    Two doubles rather than one because the gate compares a SUM: recorded spend
    plus a charge for every admitted-but-unfinished run. A double for the sum
    alone would let the in-flight reservation be deleted with this file still
    green, and that reservation is the whole reason a burst of concurrent
    submissions cannot spend the week twice.
    """

    async def account_tokens_since(_scope, _session, since):
        if captured is not None:
            captured["since"] = since
        return tokens

    async def count_in_flight_execute_runs(_scope, _session):
        return in_flight

    monkeypatch.setattr(runs.runs_repo.usage_repo, "account_tokens_since", account_tokens_since)
    monkeypatch.setattr(
        runs.runs_repo, "count_in_flight_execute_runs", count_in_flight_execute_runs
    )


async def test_a_free_account_is_refused_at_its_weekly_limit(scope, monkeypatch):
    _spent(monkeypatch, FREE_TOKENS)

    with pytest.raises(HTTPException) as caught:
        await runs._enforce_execute_backstop(
            _request(), scope, LockOnlySession(), _identity("someone@example.com"), _settings()
        )

    assert caught.value.status_code == 429
    detail = caught.value.detail
    assert detail["reason"] == "run_allowance_exhausted"
    assert detail["limit"] == FREE_TOKENS
    # This one IS the plan allowance. Telling a user who used their five runs
    # that they hit "an abuse backstop" would send them to support for something
    # support cannot fix.
    assert "abuse backstop" not in detail["error"]
    assert "plan includes" in detail["error"]


async def test_one_run_below_the_limit_is_admitted(scope, monkeypatch):
    _spent(monkeypatch, FREE_TOKENS - 1)
    await runs._enforce_execute_backstop(
        _request(), scope, LockOnlySession(), _identity("someone@example.com"), _settings()
    )


async def test_chat_traffic_is_never_metered_against_the_plan(scope, monkeypatch):
    """A free account's conversation is unmetered by policy (PR #146).

    The counter sits far above the limit: if AUTO consulted the tier gate, this
    would raise, and a free user's fifth execute run would silently cost them
    the ability to ask a follow-up question.
    """
    _spent(monkeypatch, FREE_TOKENS * 100)
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
    _spent(monkeypatch, FREE_TOKENS * 100)
    for email in ("local-dev@majorana.test", "deploy-probe@leonaquantum.com"):
        await runs._enforce_execute_backstop(
            _request(), scope, LockOnlySession(), _identity(email), _settings()
        )


async def test_a_developer_by_allowlist_or_by_plan_column_is_unmetered(scope, monkeypatch):
    _spent(monkeypatch, FREE_TOKENS * 100)
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
    _spent(monkeypatch, 0, captured=captured)

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
    _spent(monkeypatch, FREE_TOKENS)

    async def at_ceiling(*_args, **_kwargs):
        return {RunMode.EXECUTE.value: runs.EXECUTE_BACKSTOP_LIMIT}

    monkeypatch.setattr(runs.runs_repo, "count_runs_by_mode_since", at_ceiling)

    with pytest.raises(HTTPException) as caught:
        await runs._enforce_execute_backstop(
            _request(), scope, LockOnlySession(), _identity("someone@example.com"), _settings()
        )
    assert caught.value.detail["reason"] == "run_allowance_exhausted"


#: `apps/web/lib/account-tier.ts` -> `majorana_api.tiers`. Only the fields both
#: tables carry; the web table also holds browser-lane ceilings this service does
#: not enforce, and this service holds `owned_workspaces`, which the web does not.
_MIRRORED_FIELDS = {
    "agentRunsPerWeek": "agent_runs_per_week",
    "agentTokensPerWeek": "agent_tokens_per_week",
    "privateArtifacts": "private_artifacts",
    "projectSharing": "project_sharing",
    "sharedProjects": "shared_projects",
}


def _web_tier_limits() -> dict[str, dict[str, object]]:
    """The web app's tier table, read out of its source.

    Parsed rather than duplicated. `tiers.py` says "Mirrors
    apps/web/lib/account-tier.ts" in three places and nothing has ever checked
    it, so the mirror held only for as long as somebody remembered both files —
    and the numbers are what a bill and a refusal depend on.
    """
    source = (
        Path(__file__).resolve().parents[3] / "apps" / "web" / "lib" / "account-tier.ts"
    ).read_text()
    table = re.search(
        r"export const TIER_LIMITS: Record<AccountTier, TierLimits> = \{(.*?)\n\};",
        source,
        re.DOTALL,
    )
    assert table is not None, "the web tier table moved — this comparison is now vacuous"

    def value(raw: str) -> object:
        if raw == "null":
            return None
        if raw in ("true", "false"):
            return raw == "true"
        return int(raw.replace("_", ""))

    limits: dict[str, dict[str, object]] = {}
    for tier, body in re.findall(r"\n  (\w+): \{(.*?)\n  \},", table.group(1), re.DOTALL):
        limits[tier] = {
            snake: value(found.group(1))
            for camel, snake in _MIRRORED_FIELDS.items()
            if (found := re.search(rf"\b{camel}: ([\w.]+),", body))
        }
    assert limits, "no tiers parsed out of the web table"
    return limits


def test_the_server_side_numbers_match_the_published_plan():
    """The two tier tables must agree, and this reads one to check the other.

    A silent divergence meters people differently from what they were told,
    which is worse than either number being wrong on its own. The previous
    version of this test asserted the numbers by hand, which made it a THIRD
    copy: it failed when the server table moved and the hardcoded pair did not,
    rather than when the two tables disagreed with each other.

    `preview` is web-only — a signed-out walkthrough that presents no token and
    never reaches this service — so it has no server row to compare.
    """
    web = _web_tier_limits()
    assert set(web) == {"preview", "free", "pro", "team", "developer"}, (
        "a tier was added or removed on the web side"
    )
    for tier, expected in web.items():
        if tier == "preview":
            continue
        server = limits_for(tier)
        assert set(expected) == set(_MIRRORED_FIELDS.values()), (
            f"{tier}: a mirrored field is missing from the web table"
        )
        for field, number in expected.items():
            assert getattr(server, field) == number, (
                f"{tier}.{field}: web says {number}, this service enforces {getattr(server, field)}"
            )


def test_the_unlimited_tier_stays_unlimited():
    """Separate from the mirror: `None` is the one value that must not be a number."""
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


# --- the token meter itself -------------------------------------------------


def test_the_token_allowance_is_derived_from_the_advertised_run_count():
    """The two numbers in the tier table must not drift apart.

    `agent_runs_per_week` is what /pricing states and what the refusal says;
    `agent_tokens_per_week` is what refuses. Nothing enforces the first, so
    without this it can be edited to any value and the product will go on
    advertising it — the same shape as the four sessions a paying account was
    metered as free because a plan string nothing recognised resolved that way.
    """
    for tier, limits in TIER_LIMITS.items():
        if limits.agent_runs_per_week is None:
            assert limits.agent_tokens_per_week is None, (
                f"{tier} sells unlimited runs but meters tokens"
            )
            continue
        assert limits.agent_tokens_per_week == (
            limits.agent_runs_per_week * TOKENS_PER_RUN_EQUIVALENT
        ), f"{tier}'s token allowance no longer matches the run count it is sold as"


async def test_runs_already_in_flight_are_charged_before_they_have_spent_anything(
    scope, monkeypatch
):
    """The burst the lock exists to stop, reopened by metering a lagging signal.

    A token row lands only when a provider call returns, so an account one run
    below its limit could submit many at once and every one of them would read
    the same recorded spend. Charging admitted-but-unfinished runs at the
    run-equivalent rate is what bounds that.
    """
    # Recorded spend leaves room for exactly one more run...
    just_under = FREE_TOKENS - TOKENS_PER_RUN_EQUIVALENT
    _spent(monkeypatch, just_under, in_flight=0)
    await runs._enforce_execute_backstop(
        _request(), scope, LockOnlySession(), _identity("someone@example.com"), _settings()
    )

    # ...and that one run, still running and still having spent nothing, is what
    # makes the next submission a refusal instead of a second free pass.
    _spent(monkeypatch, just_under, in_flight=1)
    with pytest.raises(HTTPException) as caught:
        await runs._enforce_execute_backstop(
            _request(), scope, LockOnlySession(), _identity("someone@example.com"), _settings()
        )
    assert caught.value.detail["reason"] == "run_allowance_exhausted"


async def test_the_refusal_names_runs_and_tokens_rather_than_150000_runs(scope, monkeypatch):
    """The enforced figure is not a sentence a user can read on its own."""

    _spent(monkeypatch, FREE_TOKENS)
    with pytest.raises(HTTPException) as caught:
        await runs._enforce_execute_backstop(
            _request(), scope, LockOnlySession(), _identity("someone@example.com"), _settings()
        )

    error = caught.value.detail["error"]
    assert f"about {FREE_RUNS} verified runs a week" in error
    assert f"{FREE_TOKENS:,} tokens" in error
    assert f"{FREE_TOKENS} verified runs" not in error
