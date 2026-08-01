"""The per-tier artifact cap across two connections, against real Postgres.

`test_artifact_keep.py` proves the cap refuses the 26th artifact when the 26th
request arrives after the 25th has committed. That is the only order one
session can stage, and it is not the order that matters: the API autoscales, so
two filing requests at the boundary are two processes on two connections.

**A burst inside one process proves nothing here.** An earlier version of this
file fired eight concurrent `POST /keep` requests through one ASGI app and
passed against the unlocked code — the requests did not interleave, because a
single event loop runs each request's read and write to completion before the
next one's. Recorded because that shape reads like a race test and is not one.

So this drives two independent sessions and pins the interleaving explicitly
rather than hoping for it: A holds its transaction open across the check, B has
to be behind it, and B must see A's row when it gets through. What that proves
is that the comparison and the write happen under one lock — the property the
cap depends on and the one a second connection can actually break.

Committing, and therefore responsible for its own teardown — see
`delete_committed_tenants`.
"""

import asyncio
import os
import uuid

import pytest
from repo_test_helpers import delete_committed_tenants
from majorana_contracts import Scope
from majorana_contracts.enums import Role

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import system
from majorana_api.repos import workspaces as workspaces_repo
from majorana_api.tiers import limits_for

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="the cap race needs DATABASE_URL"
)

pytestmark = requires_db

#: Free tier's cap, read from the table rather than written as a literal, so
#: this suite follows the product decision instead of pinning a second copy.
FREE_ARTIFACT_CAP = limits_for("free").private_artifacts

#: How long B is given to prove it is blocked. Long enough that a machine under
#: load does not report a lock that is not there; short enough to stay a test.
BLOCKED_FOR_S = 1.5


async def _materialize(session, scope: Scope, count: int, tag: str) -> list[uuid.UUID]:
    """Create `count` artifacts that are NOT yet filed.

    `kept=False` is the whole fixture. `create_artifact` files by default, so a
    version of this helper without it produces artifacts that are already kept —
    and then `keep_artifact` takes its idempotent early return, never reaches the
    cap, and succeeds however full the workspace is. That reads exactly like a
    cap that does not work, which is why the argument is spelled out here rather
    than left to the default.
    """
    ids: list[uuid.UUID] = []
    for index in range(count):
        artifact = await artifacts_repo.create_artifact(
            scope,
            session,
            slug=f"{tag}-{index}-{uuid.uuid4().hex[:8]}",
            title=f"Cap race {index}",
            family="Bell",
            framework="qiskit",
            kept=False,
        )
        ids.append(artifact.id)
    return ids


@pytest.mark.asyncio
async def test_the_last_slot_cannot_be_filled_twice_by_two_connections():
    engine = engine_from_env()
    factory = session_factory(engine)

    async with factory() as session:
        user, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"caprace-{uuid.uuid4()}",
            email=f"caprace-{uuid.uuid4().hex[:8]}@caprace.test",
            display_name="Cap Race",
        )
        scope = Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER)

        # A freshly provisioned workspace is not empty, so the gap to the cap is
        # measured rather than assumed.
        _ws, _m, already_kept, _r = await workspaces_repo.get_overview(scope, session)
        assert already_kept < FREE_ARTIFACT_CAP, (
            f"a new workspace already holds {already_kept} of {FREE_ARTIFACT_CAP}; "
            "this fixture cannot stage the boundary"
        )
        filled = await _materialize(session, scope, FREE_ARTIFACT_CAP - already_kept - 1, "fill")
        for artifact_id in filled:
            await artifacts_repo.keep_artifact(
                scope, session, artifact_id, workspace_artifact_limit=None
            )
        first, second = await _materialize(session, scope, 2, "contend")
        await session.commit()

        _ws, _m, staged, _r = await workspaces_repo.get_overview(scope, session)
        assert staged == FREE_ARTIFACT_CAP - 1, (
            f"staged {staged} kept artifacts, not {FREE_ARTIFACT_CAP - 1}: the two "
            "callers below would not be racing for the last slot"
        )

    a_has_the_slot = asyncio.Event()
    b_outcome: list[object] = []

    async def caller_a() -> None:
        """Takes the last slot and holds its transaction open."""
        async with factory() as session:
            await artifacts_repo.keep_artifact(
                scope, session, first, workspace_artifact_limit=FREE_ARTIFACT_CAP
            )
            a_has_the_slot.set()
            # Held deliberately: this is the window in which the unlocked code
            # let B read a count that A had already spent.
            await asyncio.sleep(BLOCKED_FOR_S * 2)
            await session.commit()

    async def caller_b() -> None:
        await a_has_the_slot.wait()
        async with factory() as session:
            try:
                await artifacts_repo.keep_artifact(
                    scope, session, second, workspace_artifact_limit=FREE_ARTIFACT_CAP
                )
                await session.commit()
                b_outcome.append("filed")
            except artifacts_repo.ArtifactCapReached as full:
                await session.rollback()
                b_outcome.append(full)

    a_task = asyncio.create_task(caller_a())
    b_task = asyncio.create_task(caller_b())

    try:
        # B must still be waiting on A's lock. Without it, B reads the same
        # pre-cap count A read and the cap is spent twice.
        await a_has_the_slot.wait()
        done, _pending = await asyncio.wait({b_task}, timeout=BLOCKED_FOR_S)
        assert not done, (
            "the second caller completed while the first still held its "
            f"transaction open: {b_outcome} — the cap was compared against a "
            "count nothing was holding"
        )

        await asyncio.wait_for(asyncio.gather(a_task, b_task), timeout=30)

        assert b_outcome and isinstance(b_outcome[0], artifacts_repo.ArtifactCapReached), (
            f"the second caller was not refused: {b_outcome}"
        )

        async with factory() as session:
            _ws, _m, kept, _r = await workspaces_repo.get_overview(scope, session)
        assert kept == FREE_ARTIFACT_CAP, (
            f"the workspace holds {kept} kept artifacts against a cap of {FREE_ARTIFACT_CAP}"
        )
    finally:
        # Cancelled before teardown, not merely awaited. If an assertion above
        # fails, `caller_a` is still asleep INSIDE its transaction holding the
        # workspace's FOR UPDATE lock — and `delete_committed_tenants` deletes
        # that very workspace, so it would block on the lock its own test is
        # holding and the suite would hang instead of reporting the failure.
        for task in (a_task, b_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(a_task, b_task, return_exceptions=True)
        await delete_committed_tenants(factory, [workspace.id], [user.id])
        await engine.dispose()
