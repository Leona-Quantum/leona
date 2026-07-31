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
gate in `routes/runs`; kept artifacts come from `get_overview`, which is the
function the Vault cap in `routes/artifacts` compares against; owned workspaces
come from `system.count_owned_workspaces`, which is what `create_workspace`
raises on. A screen that says two runs remain and a submission that refuses are
the worst possible disagreement here — worse than showing nothing, because the
number is why the user believed they could run.

The response models are route-local on purpose. They cross the BFF boundary but
not the contracts one: nothing outside this service constructs them, and keeping
them here avoids a `CONTRACTS_VERSION` bump for a read-only projection whose
shape is this route's own business.
"""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth.deps import CurrentIdentity, CurrentScope, DbSession, get_settings
from ..repos import runs as runs_repo
from ..repos import system
from ..repos import workspaces as workspaces_repo
from ..settings import Settings
from ..tiers import TIER_WINDOW, limits_for, resolve_tier

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


class UsageResponse(BaseModel):
    tier: str
    runs: RunAllowance
    #: Kept artifacts, per WORKSPACE — this one is about the active workspace,
    #: not the account, and the client must not label it "your artifacts".
    artifacts: Allowance
    workspaces: Allowance


def _allowance(used: int, limit: int | None) -> Allowance:
    return Allowance(
        used=used,
        limit=limit,
        remaining=None if limit is None else max(limit - used, 0),
        exhausted=limit is not None and used >= limit,
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
    tier = resolve_tier(user.email, plan=user.plan, developer_emails=settings.developer_emails)
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

    _workspace_row, _members, kept, _run_count = await workspaces_repo.get_overview(scope, session)
    owned = await system.count_owned_workspaces(session, user_id=user.id)

    return UsageResponse(
        tier=tier,
        runs=RunAllowance(
            **runs.model_dump(),
            window_days=TIER_WINDOW.days,
            next_slot_at=next_slot_at,
        ),
        artifacts=_allowance(kept, limits.private_artifacts),
        workspaces=_allowance(owned, limits.owned_workspaces),
    )
