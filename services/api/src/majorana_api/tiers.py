"""Per-tier product allowances, owned by the control plane.

Until now the tier decision lived only in the web BFF (`apps/web/lib/
account-tier.ts` + `run-allowance.ts`). That binds callers who go through the
BFF; it does not bind anyone holding a valid access token, because the control
plane is a different service. The comment on `_enforce_execute_backstop` said so
plainly: real per-tier enforcement has to move server-side before multi-user
sign-up ships.

This is that copy of the decision. It is deliberately a **copy**, not a shared
module — the two services deploy separately, and a web deploy must not be able
to widen a server-side limit. The numbers here are the ones a bill or a disk
depends on; the BFF keeps the rest (browser-lane pacing, qubit ceilings) because
those bound the user's own hardware and cost nothing to be generous with.

## How the tier is resolved, and why it is resolved three ways

The failure mode to avoid is throttling a legitimate user because a deployment
knob was not set — worse than the leak it prevents, and the reason the previous
session declined to mirror the tier table here. So developer status is granted
by any of three independent signals, and the two that need no configuration come
first:

1. `OPERATOR_IDENTITIES` — the synthetic identities that ARE the operator. No
   environment variable, so the single-operator deployment cannot be throttled
   by a missing one.
2. `users.plan` — a database column that already exists. The escape hatch that
   needs no redeploy.
3. `LEONA_DEVELOPER_EMAILS` — the same variable name the web app reads, with the
   same parsing, so one value is set in two places rather than two values in
   two places.

A missing allowlist therefore degrades to "collaborators are metered like free
accounts", which is visible and recoverable, not to "the owner is locked out".
"""

import datetime as dt
from dataclasses import dataclass
from typing import Literal, Protocol

AccountTier = Literal["free", "team", "developer"]

#: The allowance window. It ROLLS — it is a trailing seven days, not a calendar
#: week, so there is no Monday on which everyone's allowance returns at once.
#: Runs come back one at a time, each seven days after it was spent.
#:
#: It lives here rather than beside the gate that refuses on it because two
#: surfaces in this service now read it: `routes/runs` enforces it, and
#: `routes/usage` reports the moment the next run frees up. A second copy of the
#: number would let one of them say "in two days" while the other refused for
#: three. The worker keeps its own copy on purpose (`handlers._TIER_WINDOW`) —
#: that is a separate deploy unit, and the same reasoning the tier table gives
#: for not sharing a module across services applies to it.
TIER_WINDOW = dt.timedelta(days=7)

#: The web app also has a signed-out "preview" tier. It never reaches here: that
#: surface serves fixtures and never presents a token.
#:
#: Ordered from least to most capable, and read that way — `at_least` below is
#: the only place a tier is compared to another tier, so a capability is a
#: position in this tuple rather than a set of names each caller writes out.
ACCOUNT_TIERS: tuple[AccountTier, ...] = ("free", "team", "developer")


@dataclass(frozen=True)
class TierLimits:
    """The allowances this service enforces. `None` means unlimited."""

    #: Runs whose resolved mode is EXECUTE, in a trailing seven days. Counted
    #: per USER, not per workspace — see repos/runs.count_execute_runs_since.
    agent_runs_per_week: int | None
    #: Artifacts filed in the Vault (`kept_at` set, not deleted). Per WORKSPACE,
    #: which is what `owned_workspaces` below exists to bound.
    private_artifacts: int | None
    #: Workspaces the account may own. This is not a product feature limit; it
    #: is what stops the Vault cap from being trivially bypassed. That cap is
    #: per workspace by design (it bounds one tenant's disk), so an account able
    #: to mint tenants without bound has no artifact cap at all.
    owned_workspaces: int | None
    #: Whether this tier may share a project with somebody outside the workspace
    #: that owns it. A capability, not an allowance — it refuses an operation
    #: outright rather than counting one, which is why it is a bool here and has
    #: no "used/limit" anywhere.
    #:
    #: Both ends are checked: the account granting and the account being granted
    #: to. See `routes/shares.grant_project_share`.
    project_sharing: bool


#: Mirrors apps/web/lib/account-tier.ts for the limits with a server-side cost.
#: If these ever disagree, the smaller one wins in practice and the user sees the
#: server's refusal — which is the correct direction for a divergence.
#:
#: `team` is the plan the pricing page has advertised since before it existed
#: ("Team workspaces and roles"). Its numbers other than the artifact allowance
#: were chosen, not derived — the owner set 250 artifacts and left the rest to
#: judgement, and they are recorded in OWNER_TODO so they stay a decision rather
#: than a default nobody revisits.
TIER_LIMITS: dict[AccountTier, TierLimits] = {
    "free": TierLimits(
        agent_runs_per_week=5,
        private_artifacts=25,
        owned_workspaces=3,
        project_sharing=False,
    ),
    "team": TierLimits(
        agent_runs_per_week=50,
        private_artifacts=250,
        owned_workspaces=10,
        project_sharing=True,
    ),
    "developer": TierLimits(
        agent_runs_per_week=None,
        private_artifacts=None,
        owned_workspaces=None,
        project_sharing=True,
    ),
}

#: Identities minted by a non-WorkOS auth mode — the operator, or the operator's
#: own infrastructure. None of them is a customer, so none of them is metered.
#: Kept in step with OPERATOR_IDENTITIES in apps/web/lib/account-tier.ts.
#:
#: The deploy probe is here rather than in LEONA_DEVELOPER_EMAILS deliberately.
#: A gate that stops working when an environment variable is mistyped is not a
#: gate — and that exact variable was found set-but-empty on Vercel one session
#: ago. Metering the probe would not fail the deploy honestly; it would start
#: failing it on the sixth deploy of a week, which reads as a product outage.
OPERATOR_IDENTITIES = frozenset(
    {
        "local-dev@majorana.test",  # MAJORANA_LOCAL_DEV_AUTH
        "deploy-probe@leonaquantum.com",  # DEPLOY_PROBE_TOKEN (post-deploy gate)
    }
)

DEVELOPER_PLAN = "developer"
TEAM_PLAN = "team"

#: `users.plan` values that name a tier, lowest first. A plan string that names
#: none of them resolves to `free`, which is the safe direction: an unrecognised
#: value must not grant anything.
PLAN_TIERS: dict[str, AccountTier] = {TEAM_PLAN: "team", DEVELOPER_PLAN: "developer"}


def normalize_email(email: str | None) -> str:
    return (email or "").strip().lower()


def parse_developer_emails(raw: str | None) -> frozenset[str]:
    """Comma- or whitespace-separated allowlist; empty by default.

    Same shape as the web app's `developerEmails()`, including the `@` filter,
    so one LEONA_DEVELOPER_EMAILS value behaves identically in both services.
    This repository is public — the list is never hardcoded.
    """
    entries = (normalize_email(part) for part in (raw or "").replace(",", " ").split())
    return frozenset(entry for entry in entries if "@" in entry)


def resolve_tier(
    email: str | None,
    *,
    plan: str | None = None,
    developer_emails: frozenset[str] = frozenset(),
    team_emails: frozenset[str] = frozenset(),
) -> AccountTier:
    """The account's tier, from the strongest signal that names one.

    Order is highest-tier-first and that is deliberate: an address on both
    allowlists, or a `team` plan row belonging to a collaborator, resolves to
    the more capable tier rather than to whichever check happened to run first.
    An unrecognised `plan` value grants nothing.
    """
    normalized = normalize_email(email)
    if normalized in OPERATOR_IDENTITIES:
        return "developer"
    plan_tier = PLAN_TIERS.get((plan or "").strip().lower())
    if plan_tier == "developer":
        return "developer"
    if normalized and normalized in developer_emails:
        return "developer"
    if plan_tier == "team":
        return "team"
    if normalized and normalized in team_emails:
        return "team"
    return "free"


class TierSources(Protocol):
    """The deployment-level half of a tier decision: who is on which allowlist."""

    developer_emails: frozenset[str]
    team_emails: frozenset[str]


@dataclass(frozen=True)
class EnvTierSources:
    """`TierSources` read straight from the environment, for the worker.

    `Settings` is the normal way to get these and the API uses it. The worker
    cannot: constructing `Settings` in the job loop raised RuntimeError on every
    AUTO run that resolved to EXECUTE in production, because the worker's
    environment carries none of the web-facing values `Settings` validates —
    which turned an allowance check into an outage.

    So the worker reads the two variables and nothing else. This class exists so
    it reads BOTH of them: the version of that code which named one variable
    inline was one edit away from resolving every team account as free, in the
    one service where that failure would refuse a run rather than merely display
    a wrong number.
    """

    developer_emails: frozenset[str]
    team_emails: frozenset[str]

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> "EnvTierSources":
        import os

        source = os.environ if environ is None else environ
        return cls(
            developer_emails=parse_developer_emails(source.get("LEONA_DEVELOPER_EMAILS")),
            team_emails=parse_developer_emails(source.get("LEONA_TEAM_EMAILS")),
        )


class Account(Protocol):
    """The account half. Satisfied by the ORM `User` and by the worker's row."""

    email: str | None
    plan: str | None


def tier_of(account: Account, sources: TierSources) -> AccountTier:
    """The tier of an account, given the deployment's allowlists.

    **Prefer this to calling `resolve_tier` directly.** `resolve_tier` takes the
    allowlists as separate defaulted keyword arguments, so a caller that passes
    one and forgets the other gets a tier that is wrong in the quiet direction —
    a team account metered as free, refused at a limit it does not have, with
    nothing failing anywhere. That is not hypothetical arithmetic: adding the
    team list gave seven existing call sites the chance to make exactly that
    mistake, and `test_tier_resolution_goes_through_one_helper` is what stops an
    eighth from being written.

    `resolve_tier` stays public and defaulted because the tests that pin the
    resolution rules need to vary one input at a time.
    """
    return resolve_tier(
        account.email,
        plan=account.plan,
        developer_emails=sources.developer_emails,
        team_emails=sources.team_emails,
    )


def limits_for(tier: AccountTier) -> TierLimits:
    return TIER_LIMITS[tier]


def at_least(tier: AccountTier, floor: AccountTier) -> bool:
    """Whether `tier` sits at or above `floor` in ACCOUNT_TIERS.

    The one place tiers are ordered. Every other check asks a capability by name
    (`limits_for(tier).project_sharing`) rather than comparing tier strings,
    because a comparison written at a call site is a comparison that has to be
    revisited every time a tier is added between two others.
    """
    return ACCOUNT_TIERS.index(tier) >= ACCOUNT_TIERS.index(floor)
