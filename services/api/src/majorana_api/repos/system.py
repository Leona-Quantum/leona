"""System repository — the ONLY unscoped surface, by design.

Two callers, both pre-/extra-tenant:
1. Identity bootstrap: WorkOS first-login provisioning runs before any Scope
   exists (it *creates* the personal workspace a Scope would point at).
2. Worker job loop: jobs are control-plane internal rows with no workspace_id.

Nothing else may import this module from request-handling code. Tenant data
stays behind the scoped repositories.
"""

import datetime as dt
from typing import Any

from majorana_contracts.enums import Role
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Job, Membership, User, Workspace


async def get_or_provision_user(
    session: AsyncSession,
    *,
    workos_user_id: str,
    email: str,
    display_name: str | None = None,
) -> tuple[User, Workspace]:
    """First login: create user + personal workspace + owner membership (04 §1)."""
    user = (
        (await session.execute(select(User).where(User.workos_user_id == workos_user_id)))
        .scalars()
        .first()
    )
    if user is not None:
        ws = (
            (
                await session.execute(
                    select(Workspace)
                    .join(Membership, Membership.workspace_id == Workspace.id)
                    .where(
                        Membership.user_id == user.id,
                        Workspace.kind == "personal",
                        Workspace.deleted_at.is_(None),
                    )
                )
            )
            .scalars()
            .first()
        )
        if ws is None:
            raise RuntimeError(f"user {user.id} has no personal workspace")
        return user, ws

    user = User(id=uuid7(), workos_user_id=workos_user_id, email=email, display_name=display_name)
    session.add(user)
    await session.flush()
    ws = Workspace(id=uuid7(), kind="personal", name=email, owner_user_id=user.id)
    session.add(ws)
    await session.flush()
    session.add(Membership(workspace_id=ws.id, user_id=user.id, role=Role.OWNER))
    await session.flush()
    return user, ws


async def enqueue_job(
    session: AsyncSession,
    *,
    kind: str,
    payload: dict[str, Any],
    run_id: Any | None = None,
    run_after: dt.datetime | None = None,
) -> Job:
    job = Job(id=uuid7(), kind=kind, payload=payload, run_id=run_id)
    if run_after is not None:
        job.run_after = run_after
    session.add(job)
    await session.flush()
    return job


async def claim_job(session: AsyncSession, *, worker_id: str) -> Job | None:
    """FOR UPDATE SKIP LOCKED claim (AD-7); polls run_after — no LISTEN/NOTIFY."""
    stmt = (
        select(Job)
        .where(Job.status == "queued", Job.run_after <= func.now())
        .order_by(Job.run_after)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    job = (await session.execute(stmt)).scalars().first()
    if job is None:
        return None
    await session.execute(
        update(Job)
        .where(Job.id == job.id)
        .values(
            status="running",
            locked_by=worker_id,
            locked_at=func.now(),
            attempts=Job.attempts + 1,
            updated_at=func.now(),
        )
    )
    return job


async def finish_job(
    session: AsyncSession, *, job_id: Any, status: str, last_error: str | None = None
) -> None:
    if status not in ("done", "failed", "dead"):
        raise ValueError(f"not a terminal job status: {status}")
    await session.execute(
        update(Job)
        .where(Job.id == job_id)
        .values(status=status, last_error=last_error, updated_at=func.now())
    )
