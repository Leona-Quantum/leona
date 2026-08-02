"""GET /v1/usage — what this account has spent, and when it gets some back.

Until now every surface in the product showed the tier's *ceilings*: the account
page says "5 verified runs per week", the sidebar says "Free". Neither says how
many are left. The only place the real number ever appeared was inside the 429
body of a submission that had already been refused, which means a user found out
they were out of runs by running out of runs.

Two things worth stating, because both shape the response:

**The window rolls.** There is no Monday on which the allowance returns. A run
is spent for seven days from the moment it was submitted and then comes back by
itself, so the honest sentence is "one more run frees up on the 3rd", not
"resets weekly". `next_slot_at` is that moment, and it is null when nothing is
spent (nothing is pending) or when the tier is unlimited (nothing to wait for).

**These numbers are read from the same rows the gates refuse on**, not
recomputed alongside them. Runs share `_spends_the_weekly_allowance` with the
gate in `routes/runs`; kept artifacts come from
`artifacts.count_kept_against_quota`, the function `reserve_artifact_slot`
compares against; owned workspaces come from `system.count_owned_workspaces`,
which is what `create_workspace` raises on; shared projects come from
`shares.count_shared_projects`, which is what `grant_share` reserves against. A
screen that says two runs remain and a submission that refuses are the worst
possible disagreement here — worse than showing nothing, because the number is
why the user believed they could run.

The artifact line moved off `get_overview` on 2026-08-02 and that was the point
of the change, not a refactor: `get_overview` counts every filed row (what the
Vault lists) and the cap counts every filed row OUTSIDE a shared project. They
were the same integer until shared projects stopped spending the allowance, and
the day they diverged this file would have started reporting a limit nothing
enforces.

**And one block that is not an allowance at all.** `spend` reports the model
tokens this workspace burned in the same window. It refuses nothing and gates
nothing — chat is unmetered on every tier — but the ledger it reads has been
written on every execute run for months and on every chat turn since the last
release, and until now no endpoint and no screen added the rows up. "What did
chat cost last week" had no answer anywhere in the product, on the one surface
with no allowance, no submission backstop, and thousands of tokens of history
per turn. It is reported beside the allowances rather than on a page of its own
because it answers the same question a person came to this page with.

The response models are route-local on purpose. They cross the BFF boundary but
not the contracts one: nothing outside this service constructs them, and keeping
them here avoids a `CONTRACTS_VERSION` bump for a read-only projection whose
shape is this route's own business.
"""

import datetime as dt
from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Depends
from majorana_contracts.enums import CHAT_USAGE_ROLE
from pydantic import BaseModel

from ..auth.deps import CurrentIdentity, CurrentScope, DbSession, get_settings
from ..repos import artifacts as artifacts_repo
from ..repos import qpu_runs as qpu_runs_repo
from ..repos import runs as runs_repo
from ..repos import shares as shares_repo
from ..repos import system
from ..repos import usage as usage_repo
from ..settings import Settings
from ..tiers import TIER_WINDOW, TOKENS_PER_RUN_EQUIVALENT, limits_for, tier_of

router = APIRouter()


class Allowance(BaseModel):
    """One metered quantity. `limit`/`remaining` are null when unlimited."""

    used: int
    limit: int | None
    remaining: int | None
    exhausted: bool


class RunAllowance(Allowance):
    #: Length of the rolling window, in days — so the client can word the
    #: sentence without hardcoding a seven it might later disagree with.
    window_days: int
    #: When `used` next drops by one, i.e. the oldest spent run's submission
    #: plus the window. Null when nothing is spent or the tier is unlimited.
    next_slot_at: dt.datetime | None


class TokenAllowance(Allowance):
    """The account's weekly token allowance — the meter a submission is refused on.

    Per ACCOUNT, across every workspace, exactly like `RunAllowance` above and
    for the same reason. Sits BESIDE the run count rather than replacing it in
    this response: the run figure is still true and still what a customer
    understands, it simply no longer gates. A client that shows one bar should
    show this one.
    """

    #: Length of the rolling window in days, so the client words the sentence
    #: without hardcoding a seven it might later disagree with.
    window_days: int
    #: When enough of the window's spend ages out to bring `used` back under
    #: `limit`. Null when nothing is spent, the tier is unlimited, or the whole
    #: window does not hold enough to clear the overage — see
    #: `usage_repo.tokens_free_at`, which will not invent a timestamp.
    next_slot_at: dt.datetime | None
    #: The run count this allowance was derived from, i.e. what the plan is sold
    #: as. Sent so the client can write "about 5 runs" without a second table
    #: that could disagree with the server's.
    runs_equivalent: int | None
    #: Tokens one advertised run is worth. Sent for the same reason: the
    #: derivation is the server's, and a client dividing by its own constant is
    #: how the two come to say different things.
    tokens_per_run: int


class TokenSpend(BaseModel):
    """Model tokens, and the number of provider calls that spent them.

    No money. Nothing in this deployment prices a token — payments are hard-off
    — so a currency figure here would be this route inventing a rate card.
    `calls` is what makes the number legible without one: 40,000 tokens over 2
    calls and over 200 are different facts about a workspace.

    Distinct from `TokenAllowance` above, and the difference matters: this is
    the WORKSPACE's spend, broken down by who spent it, and it includes chat.
    That one is the ACCOUNT's allowance. The two legitimately differ on any
    account with more than one workspace.
    """

    tokens: int
    calls: int


class ModelSpend(TokenSpend):
    #: Provider model id exactly as the response reported it, never a label.
    model: str


class SpendReport(BaseModel):
    """What this WORKSPACE spent on model tokens inside the same rolling window.

    Not an allowance. Chat has no ceiling on any tier and this is not a step
    toward giving it one — it is the answer to "what did chat cost last week",
    which until now was written to the ledger and read by nothing.

    `chat` and `runs` partition `total`: every event is one or the other, so the
    two always add up and a reader can trust the split without checking.
    """

    window_days: int
    total: TokenSpend
    #: Chat turns — the surface with no allowance and no submission backstop.
    chat: TokenSpend
    #: Every other role, i.e. the stages of execute runs.
    runs: TokenSpend
    #: Descending by tokens. Empty when nothing was spent.
    by_model: list[ModelSpend]


class HardwareSpendAllowance(BaseModel):
    """Weekly hardware spend, in DOLLARS, per ACCOUNT.

    A report rather than an allowance as of 2026-08-02: no tier sets a ceiling,
    so `limit_usd` and `remaining_usd` are null on every account and `exhausted`
    is always false. The owner ruled the ceiling an individual user's decision —
    `tiers.TierLimits.qpu_spend_usd_per_week` carries the ruling and the
    condition under which a number comes back.

    Reporting it is the part that was never optional. `POST /v1/qpu/submissions`
    once accepted $96,006.30 from a free account across twenty-one requests, and
    what made that possible was that the amount existed nowhere a person could
    look. It is on this response so the spend is visible whether or not anything
    bounds it — and so that a budget the user sets for themselves has a screen to
    live on.

    Money, not a count, because the submissions are not fungible: the rate card
    spans $0.000425 to $0.08 per shot, so a submission count would bound IonQ
    Forte and Rigetti Cepheus 188x differently.

    `used_usd` is the sum the reservation compares against —
    `authorized_spend_since`, the same function, over the same `TIER_WINDOW`. Not
    a second sum written to look like the first: a tally computed twice drifts,
    and a refusal is one number away from being on the other end of this one
    again. A free-queue submission estimates `None` and counts as `0.0`, so it
    never appears in `used_usd`.
    """

    used_usd: float
    limit_usd: float | None
    remaining_usd: float | None
    exhausted: bool
    window_days: int


class UsageResponse(BaseModel):
    tier: str
    #: Execute runs this account started in the window. Reported, no longer
    #: enforced — `tokens` below is the meter since 2026-08-03. Kept because it
    #: is the figure /pricing states and the one a customer reasons in.
    runs: RunAllowance
    #: The enforced weekly allowance. Additive in 2026-08: a client built before
    #: it exists keeps rendering the allowances it already knows.
    tokens: TokenAllowance
    #: Kept artifacts, per WORKSPACE — this one is about the active workspace,
    #: not the account, and the client must not label it "your artifacts".
    #:
    #: Excludes artifacts sitting in a SHARED project (2026-08-02), because that
    #: is what the refusal excludes. It is therefore smaller than the number of
    #: rows the Vault lists whenever this workspace shares anything, and that
    #: difference is the feature rather than a discrepancy to reconcile.
    artifacts: Allowance
    workspaces: Allowance
    #: Shared projects this ACCOUNT is in — owned-and-shared plus received —
    #: against `TierLimits.shared_projects`. Per account, like `runs` and unlike
    #: `artifacts`. Additive in 2026-08: a client built before it exists must
    #: keep rendering the allowances it already knows.
    shared_projects: Allowance
    #: Per WORKSPACE, like `artifacts` and unlike `runs`. Additive in 2026-08:
    #: a client built before it exists must keep rendering the allowances.
    spend: SpendReport
    #: Per ACCOUNT, like `runs` and `shared_projects` and unlike `artifacts` —
    #: the reservation locks the user row, so the workspace is not the unit.
    #: Additive in 2026-08: a client built before it exists keeps rendering.
    hardware_spend: HardwareSpendAllowance


def _allowance(used: int, limit: int | None) -> Allowance:
    return Allowance(
        used=used,
        limit=limit,
        remaining=None if limit is None else max(limit - used, 0),
        exhausted=limit is not None and used >= limit,
    )


def _fold_spend(rows: Sequence[usage_repo.TokenSpendRow], *, window_days: int) -> SpendReport:
    """Grouped ledger rows → the three totals and the per-model list.

    Pure arithmetic, deliberately: this is the part with a wrong answer that
    looks right, and keeping it out of the query means every case below is a
    plain function call in `test_usage_endpoint` rather than rows in a database.

    The bucketing rule is one comparison — `role == CHAT_USAGE_ROLE` — and
    everything else is a run. Written this way round on purpose. Listing the
    agent's stage names instead would mean a new stage silently counted as chat,
    and the roles come from `request.schema_name`, which changes whenever the
    pipeline does.

    `by_model` covers every event, including any whose meta carried no model at
    all: its entry keeps the empty string rather than being dropped. A list that
    quietly did not add up to `total` is the failure this shape avoids — the
    client can render "unattributed" for it, and no tokens go missing on the way
    to the screen.
    """
    chat_tokens = chat_calls = run_tokens = run_calls = 0
    per_model: dict[str, list[int]] = {}
    for row in rows:
        if row.role == CHAT_USAGE_ROLE:
            chat_tokens += row.tokens
            chat_calls += row.calls
        else:
            run_tokens += row.tokens
            run_calls += row.calls
        totals = per_model.setdefault(row.model, [0, 0])
        totals[0] += row.tokens
        totals[1] += row.calls

    by_model = sorted(
        (
            ModelSpend(model=model, tokens=tokens, calls=calls)
            for model, (tokens, calls) in per_model.items()
        ),
        # Model id as the tiebreak so an equal-token pair does not reorder
        # between two requests that read the same rows.
        key=lambda entry: (-entry.tokens, entry.model),
    )
    return SpendReport(
        window_days=window_days,
        total=TokenSpend(tokens=chat_tokens + run_tokens, calls=chat_calls + run_calls),
        chat=TokenSpend(tokens=chat_tokens, calls=chat_calls),
        runs=TokenSpend(tokens=run_tokens, calls=run_calls),
        by_model=by_model,
    )


def _runs_still_to_expire(used: int, limit: int | None) -> int:
    """How many spent runs must age out before `used < limit` again.

    One, in the ordinary case — you have spent some of your five and the next
    one returns when your oldest does. More than one only when `used` is over
    the limit, which is reachable without a bug: an account that spent five as a
    developer and was then metered down to free is at 5/5 and needs one to
    expire; an account whose limit was lowered further needs several. Returning
    a `next_slot_at` that still leaves them refused would be a wrong promise, so
    the arithmetic is done rather than assumed.
    """
    if limit is None:
        return 0
    return max(used - limit + 1, 1)


@router.get("/usage", response_model=UsageResponse)
async def usage(
    identity: CurrentIdentity,
    scope: CurrentScope,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> UsageResponse:
    user, _workspace = identity
    tier = tier_of(user, settings)
    limits = limits_for(tier)

    since = dt.datetime.now(dt.timezone.utc) - TIER_WINDOW
    runs_used = await runs_repo.count_execute_runs_since(scope, session, since)
    runs = _allowance(runs_used, limits.agent_runs_per_week)

    next_slot_at: dt.datetime | None = None
    if limits.agent_runs_per_week is not None and runs_used > 0:
        needed = _runs_still_to_expire(runs_used, limits.agent_runs_per_week)
        # Same `since`, so these are the same rows the count above saw. Reading
        # the window twice from a fresh `now()` could return a run the count
        # did not include and put `next_slot_at` on the wrong row.
        oldest = await runs_repo.oldest_allowance_runs_since(scope, session, since, count=needed)
        if len(oldest) >= needed:
            next_slot_at = oldest[needed - 1] + TIER_WINDOW

    # The enforced meter. The same `since` as everything above it, so the number
    # the bar fills to and the number the gate refuses on are the same window.
    tokens_used = await usage_repo.account_tokens_since(scope, session, since)
    tokens_free_at: dt.datetime | None = None
    if limits.agent_tokens_per_week is not None:
        # How far over the line, plus one token: the same "what has to expire
        # before the next submission is admitted" question `_runs_still_to_expire`
        # answers, asked in the unit the gate compares. `reserve_execute_run_slot`
        # refuses on `used >= limit`, so clearing exactly the overage still
        # refuses — the `+ 1` is that boundary, not a rounding cushion.
        surplus = tokens_used - limits.agent_tokens_per_week + 1
        tokens_free_at = await usage_repo.tokens_free_at(
            scope, session, since, window=TIER_WINDOW, surplus=surplus
        )

    # The QUOTA count, not `get_overview`'s Vault total. An allowance reports
    # what a refusal will be measured against, and since 2026-08-02 artifacts in
    # a shared project are outside that measurement — reporting the total here
    # would show "150 of 150" to an account the API would happily accept another
    # artifact from.
    kept = await artifacts_repo.count_kept_against_quota(scope, session)
    owned = await system.count_owned_workspaces(session, user_id=user.id)
    shared_projects = await shares_repo.count_shared_projects(session, user.id)
    # The same `since` again: a window that started at a second `now()` would
    # report spend from a period the runs figure beside it did not cover, and
    # the two are read as one sentence about one week.
    spend_rows = await usage_repo.token_spend_since(scope, session, since)
    # The reservation's own sum, not a second one shaped like it. `since` is the
    # same instant again: reporting a ceiling against a window the refusal does
    # not use is worse than reporting nothing, because it looks authoritative.
    hardware_used = await qpu_runs_repo.authorized_spend_since(scope, session, since)
    hardware_limit = limits.qpu_spend_usd_per_week

    return UsageResponse(
        tier=tier,
        runs=RunAllowance(
            **runs.model_dump(),
            window_days=TIER_WINDOW.days,
            next_slot_at=next_slot_at,
        ),
        tokens=TokenAllowance(
            **_allowance(tokens_used, limits.agent_tokens_per_week).model_dump(),
            window_days=TIER_WINDOW.days,
            next_slot_at=tokens_free_at,
            runs_equivalent=limits.agent_runs_per_week,
            tokens_per_run=TOKENS_PER_RUN_EQUIVALENT,
        ),
        artifacts=_allowance(kept, limits.private_artifacts),
        workspaces=_allowance(owned, limits.owned_workspaces),
        shared_projects=_allowance(shared_projects, limits.shared_projects),
        spend=_fold_spend(spend_rows, window_days=TIER_WINDOW.days),
        hardware_spend=HardwareSpendAllowance(
            used_usd=hardware_used,
            limit_usd=hardware_limit,
            remaining_usd=(
                None if hardware_limit is None else max(hardware_limit - hardware_used, 0.0)
            ),
            # False for everyone while no tier sets a ceiling, and written out
            # rather than hardcoded because the ceiling's absence is conditional.
            #
            # `>=`, not the reservation's `>`: this answers "can anything more be
            # submitted", and at exactly the limit the answer is no for every
            # priced device. The reservation asks a different question — whether
            # ONE named estimate fits — and a free-queue estimate of 0.0 still
            # fits an exhausted allowance, which is why that path returns before
            # any comparison rather than depending on this flag.
            exhausted=hardware_limit is not None and hardware_used >= hardware_limit,
            window_days=TIER_WINDOW.days,
        ),
    )
