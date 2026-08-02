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

The two paid tiers below developer get the same two signals — a `users.plan`
value and an allowlist — for the same reason: nothing writes `users.plan` yet,
so an allowlist is the only way an operator can put somebody on a plan without
hand-editing SQL. The three variables are named once, in `TIER_ALLOWLIST_ENV`,
because a fourth read spelled out at a call site is how one of them goes missing.
"""

import datetime as dt
from dataclasses import dataclass
from typing import Literal, Protocol

AccountTier = Literal["free", "pro", "team", "developer"]

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
ACCOUNT_TIERS: tuple[AccountTier, ...] = ("free", "pro", "team", "developer")


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
    #: SHARED projects this account may be in at once, counted per PERSON from
    #: both directions: projects it owns that carry a live grant, plus projects
    #: granted to it. `shares.count_shared_projects` is the one definition.
    #:
    #: **Unshared projects are unlimited on every tier and are not counted
    #: here.** That is the owner's rule, given in two parts:
    #:
    #:   "a person has only access to 4 projects total, whether they started it
    #:   themselves or it was shared by another person"
    #:
    #:   "unlimited non-shared projects can be created"
    #:
    #: Session 52 shipped the first half only as grants RECEIVED, which made
    #: this a ceiling an account could never reach by sharing its own work —
    #: measured at `0` for somebody who had shared six of their own projects.
    #: The other reading available at the time, capping a paying account's own
    #: private projects at four, is the one the owner ruled out.
    #:
    #: Together with the per-project artifact limit this is the whole bound on
    #: the shared bucket: `shared_projects` × `project_artifact_limit(project)`.
    #: There is deliberately no third number counting shared artifacts, because
    #: a third number is a third thing to drift.
    #:
    #: `0` for a tier that cannot share at all: a tier whose `project_sharing`
    #: is later flipped true must not silently acquire an unbounded allowance,
    #: and `test_a_tier_that_cannot_share_has_no_membership_allowance` pins it.
    #: Free stays `0` and needs no other number — its unshared projects, which
    #: are all of them, are unlimited like everyone's.
    shared_projects: int | None
    #: US dollars of ESTIMATED on-demand hardware spend this account may
    #: authorize in a trailing seven days. Per USER, like the run allowance and
    #: for the same reason: a bill follows the account, not the tenant.
    #:
    #: **`None` on every tier the product ships (2026-08-02).** The owner ruled
    #: it: "hardware spend shouldn't have a limit, since this is an individual
    #: user decision." A researcher deciding to spend $400 of their own money on
    #: a device-hour is not a thing this product refuses.
    #:
    #: ## The condition the removal depends on
    #:
    #: It is safe to remove ONLY because a companion change in the same session
    #: (branch `feature/byo-ibm-credentials`) moves hardware submission onto the
    #: submitting user's OWN provider credential. The dollars authorized are
    #: then the user's own, and a ceiling on them is the operator deciding how
    #: much of somebody else's money they may spend.
    #:
    #: **The inverse is the rule, not a caveat: if a shared operator-owned
    #: provider token is ever reintroduced for customer submissions, this
    #: ceiling has to come back.** At that moment every submission spends the
    #: operator's money again, and the field is still here, still enforced by
    #: `qpu_runs.reserve_qpu_spend_slot`, precisely so that reinstating it is
    #: setting a number rather than rebuilding a gate.
    #:
    #: ## Why the ledger and the reservation stay
    #:
    #: Because the measurement that produced them was never about a preference.
    #: `POST /v1/qpu/submissions` once compared the estimate it computes to
    #: nothing at all: driven over real HTTP by a FREE account with the
    #: deployment gate open, twenty-one requests were accepted for
    #: **$96,006.30** of authorized IonQ Forte time — one of them a single
    #: 1,000,000-shot job at $80,000.30 — while that same account was refused
    #: its sixth simulator run of the week. That is why the spend is recorded
    #: and reported (`GET /v1/usage` → `hardware_spend`); it is no longer why it
    #: is refused. An amount nobody can see is an amount nobody can decide about,
    #: and the obvious next feature is a budget the user sets for themselves —
    #: which is this field with a per-user value in front of it.
    #:
    #: A dollar figure rather than a submission count, for when a number returns
    #: here: the submissions are not fungible. The rate card spans $0.000425 to
    #: $0.08 per shot, so a count that bounded IonQ Forte sensibly would bound
    #: Rigetti Cepheus at 1/188th of the spend, and a count that bounded Cepheus
    #: sensibly would not bound Forte at all.
    #:
    #: **Free-queue devices cost `0.0` and were never refused here even when a
    #: ceiling existed.** IBM's Open Plan is an included allowance, not per-shot
    #: billing, so its estimate carries no total to charge — inventing one to
    #: meter it would be inventing a number the vendor did not publish. What
    #: bounds it is the provider's own 10-minutes-per-28-days allowance.
    qpu_spend_usd_per_week: float | None


#: Mirrors apps/web/lib/account-tier.ts for the limits with a server-side cost.
#: If these ever disagree, the smaller one wins in practice and the user sees the
#: server's refusal — which is the correct direction for a divergence.
#:
#: **Every number below is the owner's, given as a table on 2026-08-02.** Nothing
#: here was chosen or interpolated, which is a change from how this table read
#: before: `pro`'s allowances used to be described as sitting "strictly between
#: the two neighbours it is sold between", and that derivation is no longer what
#: produced them. Free 5/10/3, Plus 75/75/5, Professional 250/250/20 —
#: runs per week, private artifacts, owned workspaces.
#:
#: Two of them went DOWN: free's artifacts (25 -> 10). An account already over a
#: lowered cap keeps everything it has; the cap refuses the next file rather than
#: deleting anything, which is the same behaviour a shared project expiring back
#: into the private count already produces.
#:
#: `shared_projects` is not in the owner's table and keeps its value. It is the
#: one allowance here the owner set separately and did not revisit.
#:
#: Plus still gets NO capability Professional has: `project_sharing` stays False
#: because sharing is what Professional is, and `shared_projects` is `0` rather
#: than `None` for the reason the field documents — a tier whose
#: `project_sharing` is later flipped true must not silently acquire an
#: unbounded allowance.
#:
#: **These become token-usage limits, not run counts.** The owner's direction on
#: the same day: "We will later make the plus/professional/enterprise tiers be
#: limited by token usage rather than runs/week." `agent_runs_per_week` is what
#: enforces today; when that lands it is a different field with a different
#: window, not this one with a bigger number.
#:
#: `qpu_spend_usd_per_week` is `None` on all four, and that is not a tier
#: decision at all — see the field, which carries the ruling, the companion
#: change it depends on, and the condition under which a number comes back.
TIER_LIMITS: dict[AccountTier, TierLimits] = {
    "free": TierLimits(
        agent_runs_per_week=5,
        private_artifacts=10,
        owned_workspaces=3,
        project_sharing=False,
        shared_projects=0,
        qpu_spend_usd_per_week=None,
    ),
    "pro": TierLimits(
        agent_runs_per_week=75,
        private_artifacts=75,
        owned_workspaces=5,
        project_sharing=False,
        shared_projects=0,
        qpu_spend_usd_per_week=None,
    ),
    "team": TierLimits(
        agent_runs_per_week=250,
        private_artifacts=250,
        owned_workspaces=20,
        project_sharing=True,
        shared_projects=4,
        qpu_spend_usd_per_week=None,
    ),
    "developer": TierLimits(
        agent_runs_per_week=None,
        private_artifacts=None,
        owned_workspaces=None,
        project_sharing=True,
        shared_projects=None,
        qpu_spend_usd_per_week=None,
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
PRO_PLAN = "pro"

#: The plan strings the PRODUCT NAMES spell. The tier ids stayed `pro`/`team`
#: when the cards were renamed Plus/Professional — deliberately, because the
#: owner had been told for five sessions to set `LEONA_TEAM_EMAILS` and renaming
#: would have invalidated that instruction silently. The owner then wrote the
#: tier ids as `plus` and `professional` when restating the ladder on
#: 2026-08-02, which is the natural thing to write and, until now, the thing
#: that granted nothing.
#:
#: So both spellings resolve, rather than one of them being right. `update users
#: set plan = 'professional'` and `= 'team'` do the same thing. Nothing has to
#: be migrated, no stored value stops working, and the SQL somebody types from
#: the pricing page does what it looks like it does.
PLUS_PLAN = "plus"
PROFESSIONAL_PLAN = "professional"

#: `users.plan` values that name a tier, lowest first. A plan string that names
#: none of them resolves to `free`, which is the safe direction: an unrecognised
#: value must not grant anything.
#:
#: `pro` was exactly that unrecognised value until 2026-08-02, and the safe
#: direction was the wrong answer for it: the pricing page sold the plan, the
#: seed data carries an account on it, and every one of them was metered as
#: free with nothing anywhere reporting a mismatch. `plus` and `professional`
#: were the same trap one rename later — the strings a person reads off the
#: pricing page — and are here for that reason, not for symmetry.
#:
#: **Billing writes this column.** Whatever Stripe is configured to send as the
#: plan has to be a key here or the customer pays and is metered as free. Two
#: spellings per tier is the cheap direction for that.
PLAN_TIERS: dict[str, AccountTier] = {
    PRO_PLAN: "pro",
    PLUS_PLAN: "pro",
    TEAM_PLAN: "team",
    PROFESSIONAL_PLAN: "team",
    DEVELOPER_PLAN: "developer",
}

#: Allowlist field -> environment variable. ONE table, read by both things that
#: turn an environment into a tier decision: `Settings.from_env` for the API and
#: `EnvTierSources.from_env` for the worker.
#:
#: It exists because the alternative is spelling each variable out at each of
#: two call sites, and the failure that produces is silent in the worst
#: direction — a paid account resolved as free, refused at limits it does not
#: have, with nothing raising. `EnvTierSources` has no defaults on its fields
#: and is CONSTRUCTED from this mapping, so a fourth allowlist added to the
#: dataclass without an entry here raises TypeError the first time the worker
#: resolves a tier, instead of reading as an empty list forever.
TIER_ALLOWLIST_ENV: dict[str, str] = {
    "developer_emails": "LEONA_DEVELOPER_EMAILS",
    "team_emails": "LEONA_TEAM_EMAILS",
    "pro_emails": "LEONA_PRO_EMAILS",
}


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
    pro_emails: frozenset[str] = frozenset(),
) -> AccountTier:
    """The account's tier, from the strongest signal that names one.

    Order is highest-tier-first and that is deliberate: an address on two
    allowlists, or a `pro` plan row belonging to a collaborator, resolves to the
    more capable tier rather than to whichever check happened to run first. An
    unrecognised `plan` value grants nothing.
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
    if plan_tier == "pro":
        return "pro"
    if normalized and normalized in pro_emails:
        return "pro"
    return "free"


class TierSources(Protocol):
    """The deployment-level half of a tier decision: who is on which allowlist.

    One attribute per entry in `TIER_ALLOWLIST_ENV`, and `tier_of` passes every
    one of them — a source object carrying two of the three would resolve the
    third tier's accounts as free.
    """

    developer_emails: frozenset[str]
    team_emails: frozenset[str]
    pro_emails: frozenset[str]


@dataclass(frozen=True)
class EnvTierSources:
    """`TierSources` read straight from the environment, for the worker.

    `Settings` is the normal way to get these and the API uses it. The worker
    cannot: constructing `Settings` in the job loop raised RuntimeError on every
    AUTO run that resolved to EXECUTE in production, because the worker's
    environment carries none of the web-facing values `Settings` validates —
    which turned an allowance check into an outage.

    So the worker reads the allowlist variables and nothing else. This class
    exists so it reads ALL of them: the version of that code which named one
    variable inline was one edit away from resolving every team account as free,
    in the one service where that failure would refuse a run rather than merely
    display a wrong number.

    A third variable is that same hazard again, so the reading is no longer
    written out here at all. The fields carry no defaults and `from_env` builds
    the instance from `TIER_ALLOWLIST_ENV`, which makes the failure impossible
    rather than unlikely: a field this mapping does not name is a missing
    required argument — a TypeError on the first resolution — and never a
    silently empty allowlist.
    """

    developer_emails: frozenset[str]
    team_emails: frozenset[str]
    pro_emails: frozenset[str]

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> "EnvTierSources":
        import os

        source = os.environ if environ is None else environ
        return cls(
            **{
                field: parse_developer_emails(source.get(variable))
                for field, variable in TIER_ALLOWLIST_ENV.items()
            }
        )


class Account(Protocol):
    """The account half. Satisfied by the ORM `User` and by the worker's row."""

    email: str | None
    plan: str | None


def tier_of(account: Account, sources: TierSources) -> AccountTier:
    """The tier of an account, given the deployment's allowlists.

    **Prefer this to calling `resolve_tier` directly.** `resolve_tier` takes the
    allowlists as separate defaulted keyword arguments, so a caller that passes
    two of the three gets a tier that is wrong in the quiet direction — a paid
    account metered as free, refused at a limit it does not have, with nothing
    failing anywhere. That is not hypothetical arithmetic: adding the team list
    gave seven existing call sites the chance to make exactly that mistake, and
    `test_tier_resolution_goes_through_one_helper` is what stops an eighth from
    being written. `test_tier_of_reads_every_allowlist` is what stops this
    function from quietly dropping one.

    `resolve_tier` stays public and defaulted because the tests that pin the
    resolution rules need to vary one input at a time.
    """
    return resolve_tier(
        account.email,
        plan=account.plan,
        developer_emails=sources.developer_emails,
        team_emails=sources.team_emails,
        pro_emails=sources.pro_emails,
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
