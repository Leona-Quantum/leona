"""Which turns `/conversation` returns, against a real Postgres.

The claim is about `LIMIT` interacting with `ORDER BY`, which no mocked session
can make: with an ascending order the cap keeps a conversation's OLDEST turns,
so past the cap the newest messages are simply absent from the screen — and the
client, which reads the last turn to learn which run is still generating, is
left tailing a run that finished long ago. Proving that needs more rows than the
cap, actually inserted, actually ordered by the database.
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
    "DATABASE_URL" not in os.environ, reason="conversation turn ordering needs DATABASE_URL"
)

pytestmark = requires_db


@pytest.fixture
async def factory():
    engine = engine_from_env()
    try:
        yield session_factory(engine)
    finally:
        await engine.dispose()


@pytest.fixture
async def scope(factory):
    tag = uuid.uuid4().hex[:12]
    async with factory() as session:
        owner, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"turns-{tag}",
            email=f"turns-{tag}@conversation.test",
        )
        await session.commit()
        return Scope(user_id=owner.id, workspace_id=workspace.id, role=Role.OWNER)


async def _conversation(scope, factory, *, turns: int) -> tuple[uuid.UUID, list[uuid.UUID]]:
    """`turns` runs sharing one conversation, created oldest-first."""
    conversation_id: uuid.UUID | None = None
    created: list[uuid.UUID] = []
    for index in range(turns):
        async with factory() as session:
            run = await runs_repo.create_run(
                scope,
                session,
                task_prompt=f"turn {index}",
                mode=RunMode.CHAT,
                framework=Framework.QISKIT,
                conversation_id=conversation_id,
            )
            await session.commit()
            conversation_id = run.conversation_id
            created.append(run.id)
    assert conversation_id is not None
    return conversation_id, created


async def test_the_cap_keeps_the_newest_turns_not_the_oldest(scope, factory):
    conversation_id, created = await _conversation(scope, factory, turns=6)

    async with factory() as session:
        rows = await runs_repo.list_conversation_runs(
            scope, session, conversation_id, limit=4
        )

    assert [row.id for row in rows] == created[-4:], (
        "the cap must fall on the oldest turns; keeping the first N leaves the "
        "newest messages off the screen entirely"
    )


async def test_turns_are_returned_oldest_first(scope, factory):
    conversation_id, created = await _conversation(scope, factory, turns=4)

    async with factory() as session:
        rows = await runs_repo.list_conversation_runs(scope, session, conversation_id)

    assert [row.id for row in rows] == created, "a conversation renders in the order it happened"
    assert rows[-1].id == created[-1], (
        "the last element is what the client reads to learn which run is still "
        "generating; if it is not the newest turn the page follows a finished run"
    )


async def test_a_second_workspace_reads_none_of_it(scope, factory):
    conversation_id, _ = await _conversation(scope, factory, turns=2)
    tag = uuid.uuid4().hex[:12]
    async with factory() as session:
        other_owner, other_workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"turns-other-{tag}",
            email=f"turns-other-{tag}@conversation.test",
        )
        await session.commit()
    other = Scope(
        user_id=other_owner.id, workspace_id=other_workspace.id, role=Role.OWNER
    )

    async with factory() as session:
        rows = await runs_repo.list_conversation_runs(other, session, conversation_id)

    assert rows == [], "the workspace predicate is what makes this list private"
