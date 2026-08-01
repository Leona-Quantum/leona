"""Studio project arrangement against a real Postgres (migration 0041).

The folder suite's twin, plus the three claims that are only true of projects:
`artifacts.project_id` is the foreign key, an artifact can be soft-deleted while
still filed, and `create_project` is idempotent because the web replays a
browser's local project list into it on first sign-in.

These run against the database because every claim here is about SQL the mocked
session cannot execute — the `order by position, created_at, id` tiebreak, the
case-insensitive unique index the rename has to check BEFORE it fires, and the
`artifacts.project_id` foreign key that makes deleting a project with artifacts
in it an error rather than a no-op.
"""

import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy import select

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import Project
from majorana_api.repos import NotFoundError, artifacts, projects, system

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="project ordering needs DATABASE_URL"
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

    Every assertion below counts or orders ALL the projects in a workspace, so a
    shared one would make each test depend on what ran before it. Provisioned
    through the real first-login path rather than by inserting a Workspace row:
    `workspaces.owner_user_id` is NOT NULL, and going around the repo would also
    skip the owner membership every write here checks.
    """
    tag = uuid.uuid4().hex[:12]
    async with factory() as session:
        owner, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"project-order-{tag}",
            email=f"project-order-{tag}@projects.test",
        )
        await session.commit()
        return Scope(user_id=owner.id, workspace_id=workspace.id, role=Role.OWNER)


async def _names(scope, factory) -> list[str]:
    async with factory() as session:
        return [project.name for project in await projects.list_projects(scope, session)]


async def _make(scope, factory, *names) -> dict[str, uuid.UUID]:
    made = {}
    async with factory() as session:
        for name in names:
            project = await projects.create_project(scope, session, name=name)
            made[name] = project.id
        await session.commit()
    return made


async def _artifact(scope, factory) -> uuid.UUID:
    async with factory() as session:
        artifact = await artifacts.create_artifact(
            scope,
            session,
            slug=f"proj-live-{uuid.uuid4().hex[:12]}",
            title="filed work",
            family="Bell",
            framework="qiskit",
        )
        await session.commit()
        return artifact.id


async def test_new_projects_land_at_the_end(scope, factory):
    await _make(scope, factory, "alpha", "beta", "gamma")
    assert await _names(scope, factory) == ["alpha", "beta", "gamma"]


async def test_creating_a_name_that_already_exists_returns_the_same_row(scope, factory):
    """Idempotent on the name, and this is load-bearing.

    The web adopts a browser's local project list on first sign-in after 0041,
    and a second device replays the same names against a server that already has
    them. Anything but "return the row that holds this name" gives that person a
    duplicate project per device — or an IntegrityError from
    `uq_projects_workspace_name_lower`, which is not a sentence anybody can act
    on. Case and surrounding whitespace are normalized the same way the index is.
    """
    made = await _make(scope, factory, "Bell states")
    async with factory() as session:
        again = await projects.create_project(scope, session, name="  bell   STATES ")
        await session.commit()
    assert again.id == made["Bell states"]
    assert await _names(scope, factory) == ["Bell states"], (
        "the original name is kept, not rewritten"
    )


async def test_reorder_rewrites_the_whole_arrangement(scope, factory):
    made = await _make(scope, factory, "alpha", "beta", "gamma")
    async with factory() as session:
        await projects.reorder_projects(
            scope, session, [made["gamma"], made["alpha"], made["beta"]]
        )
        await session.commit()
    assert await _names(scope, factory) == ["gamma", "alpha", "beta"]


async def test_a_partial_reorder_appends_the_omitted_projects_rather_than_interleaving(
    scope, factory
):
    """The stale-tab case, and the reason omitted ids are renumbered explicitly.

    The arrangement sent has to be SHORTER than the workspace's project list for
    this to bite. Reordering every project but the newest one is benign — the
    newest already sorts last — so this omits two from the MIDDLE of the position
    range instead.

    Without the renumbering: delta->0 and gamma->1, while alpha and beta keep the
    0 and 1 they already had. Four projects, two positions, and the `(created_at,
    id)` tiebreak then puts alpha ahead of delta — the opposite of the drag.
    """
    made = await _make(scope, factory, "alpha", "beta", "gamma", "delta")
    async with factory() as session:
        await projects.reorder_projects(scope, session, [made["delta"], made["gamma"]])
        await session.commit()

    assert await _names(scope, factory) == ["delta", "gamma", "alpha", "beta"]
    async with factory() as session:
        positions = dict(
            (
                await session.execute(
                    select(Project.name, Project.position).where(
                        Project.workspace_id == scope.workspace_id
                    )
                )
            ).all()
        )
    assert positions == {"delta": 0, "gamma": 1, "alpha": 2, "beta": 3}, (
        "omitted projects must be renumbered past the arrangement, not left on "
        "positions the arrangement just reused"
    )


async def test_reorder_refuses_a_project_from_another_workspace(scope, factory):
    """Refused, not ignored: silently dropping an unknown id would let a stale
    tab reorder a subset and push everything it did not know about to the end."""
    made = await _make(scope, factory, "alpha")
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await projects.reorder_projects(scope, session, [made["alpha"], uuid.uuid4()])


async def test_reorder_refuses_a_repeated_project(scope, factory):
    made = await _make(scope, factory, "alpha", "beta")
    async with factory() as session:
        with pytest.raises(ValueError, match="same project twice"):
            await projects.reorder_projects(
                scope, session, [made["alpha"], made["beta"], made["alpha"]]
            )


async def test_rename_refuses_a_name_another_project_holds_in_any_case(scope, factory):
    """`uq_projects_workspace_name_lower` is case-insensitive, so the check has to
    be too — otherwise this surfaces as an IntegrityError on flush with nothing a
    user could act on."""
    made = await _make(scope, factory, "alpha", "beta")
    async with factory() as session:
        with pytest.raises(ValueError, match="already exists"):
            await projects.rename_project(scope, session, made["beta"], name="ALPHA")


async def test_rename_to_a_different_case_of_its_own_name_is_allowed(scope, factory):
    """Capitalising your own project must not collide with itself."""
    made = await _make(scope, factory, "alpha")
    async with factory() as session:
        renamed = await projects.rename_project(scope, session, made["alpha"], name="Alpha")
        await session.commit()
    assert renamed.name == "Alpha"


async def test_rename_keeps_the_projects_place_in_the_order(scope, factory):
    made = await _make(scope, factory, "alpha", "beta", "gamma")
    async with factory() as session:
        await projects.rename_project(scope, session, made["beta"], name="renamed")
        await session.commit()
    assert await _names(scope, factory) == ["alpha", "renamed", "gamma"]


async def test_filing_an_artifact_and_taking_it_back_out(scope, factory):
    made = await _make(scope, factory, "alpha")
    artifact_id = await _artifact(scope, factory)

    async with factory() as session:
        filed = await projects.set_artifact_project(scope, session, artifact_id, made["alpha"])
        await session.commit()
    assert filed.project_id == made["alpha"]

    async with factory() as session:
        assert (await artifacts.get_artifact(scope, session, artifact_id)).project_id == made[
            "alpha"
        ], "the filing must survive the session that made it"

    async with factory() as session:
        unfiled = await projects.set_artifact_project(scope, session, artifact_id, None)
        await session.commit()
    assert unfiled.project_id is None


async def test_filing_under_a_project_from_another_workspace_is_not_found(scope, factory):
    artifact_id = await _artifact(scope, factory)
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await projects.set_artifact_project(scope, session, artifact_id, uuid.uuid4())
    async with factory() as session:
        assert (await artifacts.get_artifact(scope, session, artifact_id)).project_id is None


async def test_deleting_a_project_keeps_its_artifacts(scope, factory):
    """A project is an arrangement; the artifacts in it are the user's work.

    This is also the test that fails loudly if the FK NULLing is ever dropped —
    `artifacts.project_id` references `projects` with no cascade, so the DELETE
    raises rather than orphaning anything.
    """
    made = await _make(scope, factory, "alpha")
    artifact_id = await _artifact(scope, factory)
    async with factory() as session:
        await projects.set_artifact_project(scope, session, artifact_id, made["alpha"])
        await session.commit()
    async with factory() as session:
        await projects.delete_project(scope, session, made["alpha"])
        await session.commit()

    assert await _names(scope, factory) == []
    async with factory() as session:
        survivor = await artifacts.get_artifact(scope, session, artifact_id)
        assert survivor.project_id is None


async def test_deleting_a_project_unfiles_its_soft_deleted_artifacts_too(scope, factory):
    """The case the read paths cannot see.

    `deleted_at` hides an artifact from every list, but the foreign key does not
    read `deleted_at`. An unfiling that reuses the read path's "not deleted"
    predicate leaves those rows pointing at the project and the DELETE raises —
    a project that cannot be deleted, for a reason nothing on screen explains.
    """
    made = await _make(scope, factory, "alpha")
    artifact_id = await _artifact(scope, factory)
    async with factory() as session:
        await projects.set_artifact_project(scope, session, artifact_id, made["alpha"])
        await session.commit()
    async with factory() as session:
        await artifacts.soft_delete_artifact(scope, session, artifact_id)
        await session.commit()

    async with factory() as session:
        await projects.delete_project(scope, session, made["alpha"])
        await session.commit()
    assert await _names(scope, factory) == []


async def test_deleting_a_project_from_another_workspace_is_not_found(scope, factory):
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await projects.delete_project(scope, session, uuid.uuid4())


async def test_a_shared_position_falls_back_to_the_old_order(scope, factory):
    """`position` carries no unique constraint on purpose (0041, following 0040).

    When two projects do share one — a half-applied reorder, a hand-written row —
    the result must be the stable `(created_at, id)` order everybody already saw,
    not whatever Postgres happens to return. This writes the collision directly
    because no code path produces it.
    """
    made = await _make(scope, factory, "alpha", "beta", "gamma")
    async with factory() as session:
        for name in ("alpha", "beta", "gamma"):
            project = await session.get(Project, made[name])
            project.position = 0
        await session.commit()
    assert await _names(scope, factory) == ["alpha", "beta", "gamma"]
