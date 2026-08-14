"""`list_run_events_for_runs` — the batched read behind conversation replay.

`/v1/runs/{id}/conversation` used to fetch events one run at a time, so a 50-turn
conversation cost 51 sequential round trips and held one of the API instance's
ten pool connections for all of them. The batched read is two queries. What has
to survive the change is everything the per-run read guaranteed, and none of it
can be checked without a real database: the grouping, the `seq` order *within*
each group, and the workspace predicate — which for run_events is not a column
but a join, and is therefore exactly the kind of thing a mocked session cannot
get wrong on your behalf.

The last test is the important one. run_events carries no `workspace_id`, so
batching by `run_id IN (...)` is only private because of the join to Run under
scope. Widen the query and this suite is what notices.
"""

import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role, RunMode

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="batched event grouping needs DATABASE_URL"
)

pytestmark = requires_db


@pytest.fixture
async def factory():
    engine = engine_from_env()
    try:
        yield session_factory(engine)
    finally:
        await engine.dispose()


async def _owner(factory, tag: str) -> Scope:
    async with factory() as session:
        owner, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"batch-{tag}",
            email=f"batch-{tag}@conversation.test",
        )
        await session.commit()
        return Scope(user_id=owner.id, workspace_id=workspace.id, role=Role.OWNER)


@pytest.fixture
async def scope(factory):
    return await _owner(factory, uuid.uuid4().hex[:12])


async def _run_with_events(scope, factory, *, events: int, conversation_id=None):
    async with factory() as session:
        run = await runs_repo.create_run(
            scope,
            session,
            task_prompt="turn",
            mode=RunMode.CHAT,
            framework=Framework.QISKIT,
            conversation_id=conversation_id,
        )
        for n in range(events):
            await runs_repo.append_run_event(
                scope, session, run.id, type="chat.delta", payload={"n": n}
            )
        await session.commit()
        return run


async def test_every_run_gets_its_own_events_and_nobody_elses(scope, factory):
    first = await _run_with_events(scope, factory, events=3)
    second = await _run_with_events(scope, factory, events=2, conversation_id=first.conversation_id)

    async with factory() as session:
        grouped = await runs_repo.list_run_events_for_runs(scope, session, [first.id, second.id])

    assert set(grouped) == {first.id, second.id}
    assert [e.payload["n"] for e in grouped[first.id]] == [0, 1, 2]
    assert [e.payload["n"] for e in grouped[second.id]] == [0, 1]
    assert all(e.run_id == first.id for e in grouped[first.id])


async def test_events_stay_in_seq_order_within_each_run(scope, factory):
    """Ordering by (run_id, seq) must not reorder within a run.

    The per-run read ordered by `seq` alone. Grouping across runs needs run_id
    to lead, and a replayed conversation is unreadable if that costs the order
    of the events inside a turn.
    """
    run = await _run_with_events(scope, factory, events=12)

    async with factory() as session:
        grouped = await runs_repo.list_run_events_for_runs(scope, session, [run.id])

    seqs = [event.seq for event in grouped[run.id]]
    assert seqs == sorted(seqs)
    assert [e.payload["n"] for e in grouped[run.id]] == list(range(12))


async def test_a_run_with_no_events_is_absent_rather_than_empty(scope, factory):
    """Documented behaviour, and the reason callers use `.get(run_id, [])`.

    A turn that has been created but has not emitted yet still has to render.
    """
    quiet = await _run_with_events(scope, factory, events=0)
    noisy = await _run_with_events(scope, factory, events=1)

    async with factory() as session:
        grouped = await runs_repo.list_run_events_for_runs(scope, session, [quiet.id, noisy.id])

    assert quiet.id not in grouped
    assert grouped.get(quiet.id, []) == []
    assert len(grouped[noisy.id]) == 1


async def test_no_run_ids_asks_the_database_nothing(scope, factory):
    async with factory() as session:
        assert await runs_repo.list_run_events_for_runs(scope, session, []) == {}


async def test_another_workspace_reads_none_of_the_events(scope, factory):
    """The join to Run is the whole privacy story for run_events."""
    mine = await _run_with_events(scope, factory, events=3)
    other = await _owner(factory, uuid.uuid4().hex[:12])

    async with factory() as session:
        grouped = await runs_repo.list_run_events_for_runs(other, session, [mine.id])

    assert grouped == {}, (
        "run_events has no workspace_id column; if this returns rows the batched "
        "read has dropped the join that scopes it"
    )


async def test_the_batch_agrees_with_the_per_run_read_it_replaced(scope, factory):
    """The regression guard: same rows, same order, one query instead of N."""
    runs = [await _run_with_events(scope, factory, events=n) for n in (1, 4, 2)]

    async with factory() as session:
        grouped = await runs_repo.list_run_events_for_runs(scope, session, [r.id for r in runs])
        for run in runs:
            one_at_a_time = await runs_repo.list_run_events(scope, session, run.id)
            assert [e.id for e in grouped.get(run.id, [])] == [e.id for e in one_at_a_time]
