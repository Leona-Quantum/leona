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

from dataclasses import dataclass
from typing import Literal

AccountTier = Literal["free", "developer"]

#: The web app also has a "demo" tier. It never reaches here: the demo surface is
#: signed out, serves fixtures, and never presents a token.
ACCOUNT_TIERS: tuple[AccountTier, ...] = ("free", "developer")


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


#: Mirrors apps/web/lib/account-tier.ts for the limits with a server-side cost.
#: If these ever disagree, the smaller one wins in practice and the user sees the
#: server's refusal — which is the correct direction for a divergence.
TIER_LIMITS: dict[AccountTier, TierLimits] = {
    "free": TierLimits(agent_runs_per_week=5, private_artifacts=25, owned_workspaces=3),
    "developer": TierLimits(
        agent_runs_per_week=None, private_artifacts=None, owned_workspaces=None
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
) -> AccountTier:
    normalized = normalize_email(email)
    if normalized in OPERATOR_IDENTITIES:
        return "developer"
    if (plan or "").strip().lower() == DEVELOPER_PLAN:
        return "developer"
    if normalized and normalized in developer_emails:
        return "developer"
    return "free"


def limits_for(tier: AccountTier) -> TierLimits:
    return TIER_LIMITS[tier]
