"""Folder arrangement against a real Postgres: order, rename, delete, reorder.

These run against the database because every claim here is about SQL the mocked
session cannot execute — the `order by position, created_at, id` tiebreak, the
case-insensitive unique index that the rename has to check BEFORE it fires, and
the `runs.folder_id` foreign key that makes deleting a folder with runs in it an
error rather than a no-op.
"""

import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role, RunMode
from sqlalchemy import select

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import WorkspaceFolder
from majorana_api.repos import NotFoundError, folders, runs, system

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="folder ordering needs DATABASE_URL"
)

pytestmark = requires_db


@pytest.fixture
async def factory():
    engine = engine_from_env()
    made = session_factory(engine)
    try:
        yield made
    finally:
        await engine.dispose()


@pytest.fixture
async def scope(factory):
    """A freshly provisioned workspace per test.

    Every assertion below counts or orders ALL the folders in a workspace, so a
    shared one would make each test depend on what ran before it. Provisioned
    through the real first-login path rather than by inserting a Workspace row:
    `workspaces.owner_user_id` is NOT NULL, and going around the repo would also
    skip the owner membership every write here checks.
    """
    tag = uuid.uuid4().hex[:12]
    async with factory() as session:
        owner, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"folder-order-{tag}",
            email=f"folder-order-{tag}@folders.test",
        )
        await session.commit()
        return Scope(user_id=owner.id, workspace_id=workspace.id, role=Role.OWNER)


async def _names(scope, factory) -> list[str]:
    async with factory() as session:
        return [folder.name for folder in await folders.list_folders(scope, session)]


async def _make(scope, factory, *names) -> dict[str, uuid.UUID]:
    made = {}
    async with factory() as session:
        for name in names:
            folder = await folders.create_folder(scope, session, name=name)
            made[name] = folder.id
        await session.commit()
    return made


async def test_new_folders_land_at_the_end(scope, factory):
    await _make(scope, factory, "alpha", "beta", "gamma")
    assert await _names(scope, factory) == ["alpha", "beta", "gamma"]


async def test_reorder_rewrites_the_whole_arrangement(scope, factory):
    made = await _make(scope, factory, "alpha", "beta", "gamma")
    async with factory() as session:
        await folders.reorder_folders(scope, session, [made["gamma"], made["alpha"], made["beta"]])
        await session.commit()
    assert await _names(scope, factory) == ["gamma", "alpha", "beta"]


async def test_a_partial_reorder_appends_the_omitted_folders_rather_than_interleaving(
    scope, factory
):
    """The stale-tab case, and the reason omitted ids are renumbered explicitly.

    The arrangement sent has to be SHORTER than the workspace's folder list for
    this to bite, which is the whole subtlety. Reordering every folder but the
    newest one is benign — the newest already sorts last — so this omits two
    folders from the MIDDLE of the position range instead.

    Without the renumbering: delta->0 and gamma->1, while alpha and beta keep the
    0 and 1 they already had. Four folders, two positions, and the `(created_at,
    id)` tiebreak then puts alpha ahead of delta — the opposite of what the user
    just dragged.
    """
    made = await _make(scope, factory, "alpha", "beta", "gamma", "delta")
    async with factory() as session:
        await folders.reorder_folders(scope, session, [made["delta"], made["gamma"]])
        await session.commit()

    assert await _names(scope, factory) == ["delta", "gamma", "alpha", "beta"]
    async with factory() as session:
        positions = dict(
            (
                await session.execute(
                    select(WorkspaceFolder.name, WorkspaceFolder.position).where(
                        WorkspaceFolder.workspace_id == scope.workspace_id
                    )
                )
            ).all()
        )
    assert positions == {"delta": 0, "gamma": 1, "alpha": 2, "beta": 3}, (
        "omitted folders must be renumbered past the arrangement, not left on "
        "positions the arrangement just reused"
    )


async def test_reorder_refuses_a_folder_from_another_workspace(scope, factory):
    """Refused, not ignored: silently dropping an unknown id would let a stale
    tab reorder a subset and push everything it did not know about to the end."""
    made = await _make(scope, factory, "alpha")
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await folders.reorder_folders(scope, session, [made["alpha"], uuid.uuid4()])


async def test_reorder_refuses_a_repeated_folder(scope, factory):
    made = await _make(scope, factory, "alpha", "beta")
    async with factory() as session:
        with pytest.raises(ValueError, match="same folder twice"):
            await folders.reorder_folders(
                scope, session, [made["alpha"], made["beta"], made["alpha"]]
            )


async def test_rename_refuses_a_name_another_folder_holds_in_any_case(scope, factory):
    """`uq_workspace_folders_workspace_name_lower` is case-insensitive, so the
    check has to be too — otherwise this surfaces as an IntegrityError on flush
    with nothing a user could act on."""
    made = await _make(scope, factory, "alpha", "beta")
    async with factory() as session:
        with pytest.raises(ValueError, match="already exists"):
            await folders.rename_folder(scope, session, made["beta"], name="ALPHA")


async def test_rename_to_a_different_case_of_its_own_name_is_allowed(scope, factory):
    """Capitalising your own folder must not collide with itself."""
    made = await _make(scope, factory, "alpha")
    async with factory() as session:
        renamed = await folders.rename_folder(scope, session, made["alpha"], name="Alpha")
        await session.commit()
    assert renamed.name == "Alpha"


async def test_rename_keeps_the_folders_place_in_the_order(scope, factory):
    made = await _make(scope, factory, "alpha", "beta", "gamma")
    async with factory() as session:
        await folders.rename_folder(scope, session, made["beta"], name="renamed")
        await session.commit()
    assert await _names(scope, factory) == ["alpha", "renamed", "gamma"]


async def test_deleting_a_folder_keeps_its_runs(scope, factory):
    """A folder is an arrangement; the runs in it are the user's actual work.

    This is also the test that fails loudly if the FK NULLing is ever dropped —
    `runs.folder_id` references `workspace_folders` with no cascade, so the
    DELETE raises rather than orphaning anything.
    """
    made = await _make(scope, factory, "alpha")
    async with factory() as session:
        run = await runs.create_run(
            scope, session, task_prompt="p", mode=RunMode.CHAT, framework="qiskit"
        )
        await session.commit()
        run_id = run.id
    async with factory() as session:
        await folders.set_run_folder(scope, session, run_id, made["alpha"])
        await session.commit()
    async with factory() as session:
        await folders.delete_folder(scope, session, made["alpha"])
        await session.commit()

    assert await _names(scope, factory) == []
    async with factory() as session:
        survivor = await runs.get_run(scope, session, run_id)
        assert survivor.folder_id is None


async def test_deleting_a_folder_from_another_workspace_is_not_found(scope, factory):
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await folders.delete_folder(scope, session, uuid.uuid4())


async def test_a_shared_position_falls_back_to_the_old_order(scope, factory):
    """`position` carries no unique constraint on purpose (migration 0040).

    When two folders do share one — a half-applied reorder, a hand-written row —
    the result must be the stable `(created_at, id)` order everybody already saw,
    not whatever Postgres happens to return. This writes the collision directly
    because no code path produces it.
    """
    made = await _make(scope, factory, "alpha", "beta", "gamma")
    async with factory() as session:
        for name in ("alpha", "beta", "gamma"):
            folder = await session.get(WorkspaceFolder, made[name])
            folder.position = 0
        await session.commit()
    assert await _names(scope, factory) == ["alpha", "beta", "gamma"]


async def test_a_rename_moves_the_folders_updated_at(scope, factory):
    """`updated_at` carries only a `server_default`, so an attribute assignment
    and a flush leave it at the INSERT value and the row reports a stale time.

    Live rather than mocked because that is the whole claim: the stamp has to
    survive the round trip to Postgres and come back on a re-read, and a session
    double returns whatever the instance happens to be holding.
    """
    made = await _make(scope, factory, "alpha")
    async with factory() as session:
        before = (await folders.get_folder(scope, session, made["alpha"])).updated_at

    async with factory() as session:
        await folders.rename_folder(scope, session, made["alpha"], name="renamed")
        await session.commit()

    async with factory() as session:
        after = (await folders.get_folder(scope, session, made["alpha"])).updated_at
    assert after > before, "a rename that does not move updated_at is invisible to any client"


async def test_a_reorder_stamps_only_the_folders_that_moved(scope, factory):
    """Stamping every folder would make a drag of two look like an edit to all.

    `gamma` keeps position 2 in this arrangement, so its row must be untouched
    while the two that swapped are stamped.
    """
    made = await _make(scope, factory, "alpha", "beta", "gamma")
    async with factory() as session:
        before = {
            folder.name: folder.updated_at for folder in await folders.list_folders(scope, session)
        }

    async with factory() as session:
        await folders.reorder_folders(scope, session, [made["beta"], made["alpha"], made["gamma"]])
        await session.commit()

    async with factory() as session:
        after = {
            folder.name: folder.updated_at for folder in await folders.list_folders(scope, session)
        }
    assert after["alpha"] > before["alpha"]
    assert after["beta"] > before["beta"]
    assert after["gamma"] == before["gamma"], "an unmoved folder must not report an edit"
