"""Reattaching accounts after a WorkOS environment switch. One-off, operator-run.

The app recognises a person by `users.workos_user_id`, which is the JWT `sub`.
A new WorkOS environment mints a new `sub` for the same human, so on the day
production moves off the staging environment, every existing account signs in,
fails the `workos_user_id` lookup, and gets a brand-new row with a brand-new
personal workspace. Their work is not lost — it is attached to an identity that
no longer signs in — but their Vault looks empty, which is indistinguishable
from lost to the person looking at it.

**Why this is a script and not a branch in `get_or_provision_user`.** Matching a
presented identity to an existing account by email address is an account
takeover primitive: whoever can get a WorkOS identity issued for your address
inherits everything you have. As a login-time behaviour that is a vulnerability
with no mitigation. As a one-off operator action over a known list of accounts,
run once, with a dry run first and a written record of what moved, it is a
migration. The difference is entirely in who decides and how often, so the code
has to live somewhere a request cannot reach it.

**Nothing is deleted.** Freeing the new `sub` so the original row can take it
needs the duplicate to give it up, and the obvious way to do that is to delete
the duplicate and the empty personal workspace and starter artifact that came
with it — a cascade across five tables to reclaim rows nobody will look at. The
duplicate's identity is retired to a tombstone value instead. It frees the
unique `sub`, keeps every foreign key intact, and makes the whole operation a
two-field swap that an operator can reverse by swapping them back.
"""

import datetime as dt
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..orm import Artifact, Membership, Run, User, Workspace
from .system import STARTER_BELL_SLUG_PREFIX

#: Prefix for a retired duplicate's `workos_user_id`. No WorkOS token can ever
#: present a `sub` shaped like this, so a retired row can never sign in again.
RETIRED_PREFIX = "retired-workos-env"


def retired_identity(new_sub: str, *, at: dt.datetime) -> str:
    return f"{RETIRED_PREFIX}:{at.strftime('%Y%m%dT%H%M%SZ')}:{new_sub}"


@dataclass
class AccountMatch:
    """One email address, and what the database has under it."""

    email: str
    new_sub: str
    #: The row that holds the history — matched by email, keyed on the OLD sub.
    original_user_id: object | None = None
    original_sub: str | None = None
    #: The row the new environment's first sign-in created, if they have signed
    #: in yet. Absent is the easy case: nothing to retire, just re-key.
    duplicate_user_id: object | None = None
    artifacts: int = 0
    runs: int = 0
    #: Work done under the NEW identity. Any at all blocks the merge.
    duplicate_artifacts: int = 0
    duplicate_runs: int = 0
    #: Memberships the OLD row holds in workspaces it does NOT own — shared
    #: workspaces it was invited into, and any system workspace it administers.
    #: Re-keying carries these across with the row; being BLOCKED strands them,
    #: and nothing else in this plan can show that. See `plan_reattachment`.
    original_foreign_memberships: int = 0
    action: str = "none"
    reason: str = ""


@dataclass
class ReattachPlan:
    matches: list[AccountMatch] = field(default_factory=list)

    @property
    def actionable(self) -> list[AccountMatch]:
        return [m for m in self.matches if m.action in {"rekey", "retire_and_rekey"}]

    @property
    def blocked(self) -> list[AccountMatch]:
        return [m for m in self.matches if m.action == "blocked"]


async def _content_counts(session: AsyncSession, user_id) -> tuple[int, int]:
    """Artifacts and runs in the workspaces this user OWNS.

    Owned rather than "is a member of": a guest's view of somebody else's
    workspace is not their content, and counting it would make an empty new
    account look busy the moment anyone invited them anywhere.

    The starter Bell artifact is excluded. Every provisioned account gets one
    without asking, so counting it would make every freshly created duplicate
    look like it held work and block every merge this exists to perform.
    """
    owned = select(Workspace.id).where(
        Workspace.owner_user_id == user_id, Workspace.deleted_at.is_(None)
    )
    artifacts = int(
        (
            await session.execute(
                select(func.count(Artifact.id)).where(
                    Artifact.workspace_id.in_(owned),
                    Artifact.deleted_at.is_(None),
                    ~Artifact.slug.startswith(STARTER_BELL_SLUG_PREFIX),
                )
            )
        ).scalar_one()
    )
    runs = int(
        (
            await session.execute(select(func.count(Run.id)).where(Run.workspace_id.in_(owned)))
        ).scalar_one()
    )
    return artifacts, runs


async def plan_reattachment(session: AsyncSession, *, identities: dict[str, str]) -> ReattachPlan:
    """Work out what each address needs, touching nothing.

    `identities` maps a normalized email to the `sub` that address has in the NEW
    WorkOS environment — pulled from the WorkOS API, which is the only
    authoritative source for that pairing. Anything derived from a token the app
    has already accepted would be circular.
    """
    plan = ReattachPlan()
    for raw_email, new_sub in sorted(identities.items()):
        email = raw_email.strip().lower()
        match = AccountMatch(email=email, new_sub=new_sub)
        rows = list(
            (
                await session.execute(
                    select(User)
                    .where(
                        func.lower(User.email) == email,
                        # A row this script has already retired is not a
                        # candidate for anything. Without this the second run
                        # INVERTS the first: the original now holds `new_sub`,
                        # so it is read as the duplicate, and the retired row is
                        # read as the history worth keeping — and applying that
                        # retires the real account. Caught by the idempotency
                        # test, which is the only place it could have been
                        # caught, because a single run is correct either way.
                        ~User.workos_user_id.startswith(f"{RETIRED_PREFIX}:"),
                    )
                    .order_by(User.created_at, User.id)
                )
            )
            .scalars()
            .all()
        )
        if not rows:
            match.action = "none"
            match.reason = "no account on this deployment uses that address"
            plan.matches.append(match)
            continue

        duplicate = next((r for r in rows if r.workos_user_id == new_sub), None)
        originals = [r for r in rows if r.workos_user_id != new_sub]

        if duplicate is not None:
            match.duplicate_user_id = duplicate.id
            match.duplicate_artifacts, match.duplicate_runs = await _content_counts(
                session, duplicate.id
            )

        if not originals:
            # Only the new row exists: either already reattached, or a person who
            # never had an account before the switch. Both are finished.
            match.action = "none"
            match.reason = "already keyed to the new identity"
            plan.matches.append(match)
            continue

        if len(originals) > 1:
            # `users.email` has no unique constraint, so this is representable.
            # Refusing is the only safe reading: picking one would silently
            # decide which of two histories the person keeps.
            match.action = "blocked"
            match.reason = f"{len(originals)} existing accounts share this address"
            plan.matches.append(match)
            continue

        original = originals[0]
        match.original_user_id = original.id
        match.original_sub = original.workos_user_id
        match.artifacts, match.runs = await _content_counts(session, original.id)
        match.original_foreign_memberships = await count_foreign_memberships(session, original.id)

        if duplicate is None:
            match.action = "rekey"
            match.reason = "has not signed in under the new environment yet"
        elif match.duplicate_artifacts or match.duplicate_runs:
            # They signed in and did real work before this ran. Re-keying now
            # would strand that work under the retired row — the exact harm this
            # whole script exists to prevent, pointed the other way.
            match.action = "blocked"
            match.reason = (
                f"the new account already holds {match.duplicate_artifacts} artifacts "
                f"and {match.duplicate_runs} runs; merge by hand"
            )
        else:
            match.action = "retire_and_rekey"
            match.reason = "new account is empty"
        plan.matches.append(match)
    return plan


async def apply_reattachment(
    session: AsyncSession, *, plan: ReattachPlan, at: dt.datetime | None = None
) -> list[AccountMatch]:
    """Carry out the actionable half of a plan. Blocked rows are left alone.

    Order matters within each account and is the whole correctness argument:
    the duplicate gives up the `sub` before the original takes it, because
    `users.workos_user_id` is unique and the other order fails the constraint
    rather than doing half the work.
    """
    stamp = at or dt.datetime.now(dt.timezone.utc)
    applied: list[AccountMatch] = []
    for match in plan.actionable:
        if match.duplicate_user_id is not None:
            duplicate = (
                await session.execute(select(User).where(User.id == match.duplicate_user_id))
            ).scalar_one()
            duplicate.workos_user_id = retired_identity(match.new_sub, at=stamp)
            await session.flush()
        original = (
            await session.execute(select(User).where(User.id == match.original_user_id))
        ).scalar_one()
        original.workos_user_id = match.new_sub
        await session.flush()
        applied.append(match)
    return applied


async def count_memberships(session: AsyncSession, user_id) -> int:
    """Used by the report only — a retired row keeps its memberships, and an
    operator reading the output should be able to see that nothing was cut."""
    return int(
        (
            await session.execute(
                select(func.count()).select_from(Membership).where(Membership.user_id == user_id)
            )
        ).scalar_one()
    )


async def count_foreign_memberships(session: AsyncSession, user_id) -> int:
    """Memberships in workspaces this user does NOT own.

    The number an operator needs and could not previously see. `_content_counts`
    answers "what work would this person get back", and it counts only workspaces
    the row OWNS — correct for that question, because a guest's view of somebody
    else's workspace is not their content.

    But a re-key moves the *row*, so it carries every membership with it, while a
    BLOCKED account keeps them on an identity that can no longer sign in. Nothing
    in the rendered plan showed that, and the case is not hypothetical: after the
    2026-07-30 production reattachment, `emistry@berkeley.edu` was blocked with
    "0 artifacts, 0 runs" — a row that looked completely empty and safe to leave
    alone. It also held admin on the public catalog workspace and collaborator
    access to the owner's Vault, both of which the new identity did not have. The
    dry run reported neither, because neither is content in a workspace that row
    owned.
    """
    owned = select(Workspace.id).where(Workspace.owner_user_id == user_id)
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(Membership)
                .where(Membership.user_id == user_id, Membership.workspace_id.not_in(owned))
            )
        ).scalar_one()
    )
