"""Artifact version history against a real Postgres.

Every claim here is about a database constraint or a pointer the mocked session
cannot enforce:

  * `uq_artifact_versions_fingerprint` — UNIQUE(artifact_id, fingerprint), from
    migration 0001. Only a real INSERT can prove that returning to a source the
    artifact has held before does not raise IntegrityError.
  * `artifacts.current_version_id` — a restore moves this pointer, so `seq`
    ordering and "which one is current" stop agreeing. Only real rows show that.
  * the workspace predicate on the version list, which has to be proved by a
    second workspace actually failing to read the first one's versions.
"""

import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import ExportStatus, Framework, Role, RunMode
from sqlalchemy import select

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import Artifact
from majorana_api.repos import NotFoundError, artifacts, system
from majorana_api.routes.runs import CreateRunRequest, _create_stale_source_draft

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="artifact version history needs DATABASE_URL"
)

pytestmark = requires_db


@pytest.fixture
async def factory():
    engine = engine_from_env()
    try:
        yield session_factory(engine)
    finally:
        await engine.dispose()


async def _provision(factory, tag_prefix: str) -> Scope:
    """A freshly provisioned workspace, through the real first-login path.

    Not a raw Workspace insert: `workspaces.owner_user_id` is NOT NULL and going
    around the repo would also skip the owner membership every write checks.
    """
    tag = uuid.uuid4().hex[:12]
    async with factory() as session:
        owner, workspace = await system.get_or_provision_user(
            session,
            workos_user_id=f"{tag_prefix}-{tag}",
            email=f"{tag_prefix}-{tag}@versions.test",
        )
        await session.commit()
        return Scope(user_id=owner.id, workspace_id=workspace.id, role=Role.OWNER)


@pytest.fixture
async def scope(factory):
    return await _provision(factory, "versions")


@pytest.fixture
async def other_scope(factory):
    return await _provision(factory, "versions-other")


async def _artifact(scope, factory) -> uuid.UUID:
    async with factory() as session:
        artifact = await artifacts.create_artifact(
            scope,
            session,
            slug=f"versions-{uuid.uuid4().hex[:10]}",
            title="Version history probe",
            family="Bell",
            framework="qiskit",
        )
        await session.commit()
        return artifact.id


async def _version(scope, factory, artifact_id, *, code, fingerprint, **overrides):
    async with factory() as session:
        version = await artifacts.create_version(
            scope,
            session,
            artifact_id,
            qasm_version=overrides.pop("qasm_version", None),
            qasm=overrides.pop("qasm", None),
            code=code,
            code_lang="qiskit",
            fingerprint=fingerprint,
            export_status=overrides.pop("export_status", ExportStatus.UNSUPPORTED),
            **overrides,
        )
        await session.commit()
        return version.id, version.seq


async def _current_version_id(scope, factory, artifact_id) -> uuid.UUID | None:
    async with factory() as session:
        return (
            await session.execute(
                select(Artifact.current_version_id).where(Artifact.id == artifact_id)
            )
        ).scalar_one()


# --- the UNIQUE(artifact_id, fingerprint) trap -------------------------------


async def test_returning_to_an_earlier_source_repoints_instead_of_raising(scope, factory):
    """A → B → A on one artifact used to raise IntegrityError (HTTP 500).

    `create_version` computed max(seq)+1 and inserted unconditionally.
    `uq_artifact_versions_fingerprint` then rejected the third write, because the
    artifact already held a row for source A. No handler existed, so the caller
    got a 500 for doing something entirely ordinary: undoing an edit.
    """
    artifact_id = await _artifact(scope, factory)
    version_a, seq_a = await _version(scope, factory, artifact_id, code="A", fingerprint="fp-a")
    version_b, seq_b = await _version(scope, factory, artifact_id, code="B", fingerprint="fp-b")

    async with factory() as session:
        returned = await artifacts.create_version(
            scope,
            session,
            artifact_id,
            qasm_version=None,
            qasm=None,
            code="A",
            code_lang="qiskit",
            fingerprint="fp-a",
            export_status=ExportStatus.UNSUPPORTED,
        )
        await session.commit()
        # The existing row, not a new one: same id, same seq, no third version.
        assert returned.id == version_a
        assert returned.seq == seq_a

    assert await _current_version_id(scope, factory, artifact_id) == version_a
    async with factory() as session:
        rows = await artifacts.list_versions(scope, session, artifact_id)
    assert [row.id for row in rows] == [version_b, version_a]
    assert [row.seq for row in rows] == [seq_b, seq_a]


async def test_studio_edit_cycle_survives_returning_to_a_previous_draft(scope, factory):
    """The same trap through the product path that actually hits it.

    Studio persists an edited source as a draft version (`_create_stale_source_draft`).
    Its guard only compares against the base version the request names, so
    edit→A', edit→B, edit back→A' walks straight into the constraint.
    """
    artifact_id = await _artifact(scope, factory)
    base_id, _ = await _version(scope, factory, artifact_id, code="base", fingerprint="fp-base")

    async def edit(base_version_id: uuid.UUID, source: str) -> uuid.UUID:
        async with factory() as session:
            body = CreateRunRequest(
                task_prompt="rerun this",
                framework=Framework.QISKIT,
                artifact_version_id=base_version_id,
                source_code=source,
            )
            drafted = await _create_stale_source_draft(body, scope, session)
            await session.commit()
            return drafted

    first = await edit(base_id, "print('A')")
    second = await edit(first, "print('B')")
    third = await edit(second, "print('A')")

    assert first != second
    # Back to a source this artifact already holds: the same row, reinstated.
    assert third == first
    assert await _current_version_id(scope, factory, artifact_id) == first


async def test_recreating_the_current_version_is_a_no_op(scope, factory):
    """Re-saving the version that is already current must change nothing.

    Not merely cheaper: `create_version` demotes a PUBLIC artifact to PRIVATE
    because a new current version has no verification standing yet. Doing that
    for a write that did not move the pointer would silently unpublish an
    artifact whose content never changed.
    """
    artifact_id = await _artifact(scope, factory)
    version_a, _ = await _version(scope, factory, artifact_id, code="A", fingerprint="fp-a")

    async with factory() as session:
        artifact = await artifacts.get_artifact(scope, session, artifact_id)
        before = artifact.updated_at
        returned = await artifacts.create_version(
            scope,
            session,
            artifact_id,
            qasm_version=None,
            qasm=None,
            code="A",
            code_lang="qiskit",
            fingerprint="fp-a",
            export_status=ExportStatus.UNSUPPORTED,
        )
        await session.commit()
    assert returned.id == version_a
    async with factory() as session:
        artifact = await artifacts.get_artifact(scope, session, artifact_id)
        assert artifact.updated_at == before


# --- listing -----------------------------------------------------------------


async def test_versions_list_newest_first_and_pages_by_seq(scope, factory):
    artifact_id = await _artifact(scope, factory)
    made = []
    for index in range(5):
        made.append(
            await _version(scope, factory, artifact_id, code=f"v{index}", fingerprint=f"fp-{index}")
        )

    async with factory() as session:
        page = await artifacts.list_versions(scope, session, artifact_id, limit=2)
        assert [row.seq for row in page] == [5, 4]
        rest = await artifacts.list_versions(scope, session, artifact_id, limit=2, before_seq=4)
        assert [row.seq for row in rest] == [3, 2]


async def test_another_workspace_cannot_list_or_restore_these_versions(scope, other_scope, factory):
    """The version list joins through the artifact, which is the only place a
    workspace id exists — `artifact_versions` has no workspace column."""
    artifact_id = await _artifact(scope, factory)
    version_id, _ = await _version(scope, factory, artifact_id, code="A", fingerprint="fp-a")

    async with factory() as session:
        with pytest.raises(NotFoundError):
            await artifacts.list_versions(other_scope, session, artifact_id)
        with pytest.raises(NotFoundError):
            await artifacts.restore_version(other_scope, session, artifact_id, version_id)


# --- restore -----------------------------------------------------------------


async def test_restore_moves_the_pointer_and_never_copies_a_row(scope, factory):
    """Restore re-points `current_version_id`; it does not mint a copy.

    A copy would have to carry the restored row's `verification_summary` and
    `source_fingerprint` into a second row — the evidence-copying ADR-0022
    forbids — and would collide with UNIQUE(artifact_id, fingerprint) anyway.
    """
    artifact_id = await _artifact(scope, factory)
    version_a, seq_a = await _version(
        scope,
        factory,
        artifact_id,
        code="A",
        fingerprint="fp-a",
        qasm="OPENQASM 3.0;",
        qasm_version="3.0",
        export_status=ExportStatus.LOSSLESS,
    )
    version_b, _ = await _version(scope, factory, artifact_id, code="B", fingerprint="fp-b")
    assert await _current_version_id(scope, factory, artifact_id) == version_b

    async with factory() as session:
        restored = await artifacts.restore_version(scope, session, artifact_id, version_a)
        await session.commit()
    assert restored.id == version_a
    assert restored.seq == seq_a
    assert await _current_version_id(scope, factory, artifact_id) == version_a

    async with factory() as session:
        rows = await artifacts.list_versions(scope, session, artifact_id)
    # No new row: history still has exactly the two versions that were authored.
    assert [row.id for row in rows] == [version_b, version_a]


async def test_restore_refuses_a_version_from_another_artifact(scope, factory):
    """`{artifact_id}` in the path is not decoration: without binding it, any
    in-workspace version id would restore onto any artifact."""
    first = await _artifact(scope, factory)
    second = await _artifact(scope, factory)
    stray, _ = await _version(scope, factory, second, code="A", fingerprint="fp-a")

    async with factory() as session:
        with pytest.raises(NotFoundError):
            await artifacts.restore_version(scope, session, first, stray)


async def test_restore_demotes_a_public_artifact(scope, factory):
    """A PUBLIC artifact's badge is earned by its CURRENT version's evidence
    (`set_visibility` requires metadata.source_fingerprint == version.fingerprint).
    Moving the pointer therefore has to drop it back to PRIVATE, or the artifact
    would advertise a verdict for content it no longer serves."""
    artifact_id = await _artifact(scope, factory)
    version_a, _ = await _version(scope, factory, artifact_id, code="A", fingerprint="fp-a")
    await _version(scope, factory, artifact_id, code="B", fingerprint="fp-b")

    async with factory() as session:
        artifact = await artifacts.get_artifact(scope, session, artifact_id)
        artifact.visibility = "public"
        await session.commit()

    async with factory() as session:
        await artifacts.restore_version(scope, session, artifact_id, version_a)
        await session.commit()

    async with factory() as session:
        artifact = await artifacts.get_artifact(scope, session, artifact_id)
        assert artifact.visibility == "private"


async def test_a_run_that_reproduces_an_existing_source_reuses_that_version(scope, factory):
    """The worker hits the same constraint, by design rather than by accident.

    `RepoReviewArtifactSaver` only adds a version to the parent artifact when the
    candidate fingerprint EQUALS the parent version's — every other case forks a
    new artifact. So the one branch that writes a second version of an existing
    artifact is precisely the branch whose fingerprint is already taken.
    """
    artifact_id = await _artifact(scope, factory)
    version_a, _ = await _version(scope, factory, artifact_id, code="A", fingerprint="fp-a")

    async with factory() as session:
        again = await artifacts.create_version(
            scope,
            session,
            artifact_id,
            qasm_version="3.0",
            qasm="OPENQASM 3.0;",
            metadata={"source": "simple_pipeline_candidate"},
            code="A",
            code_lang="qiskit",
            fingerprint="fp-a",
            export_status=ExportStatus.LOSSLESS,
        )
        await session.commit()
    assert again.id == version_a


async def test_run_admission_still_reuses_the_named_base_when_the_source_is_unchanged(
    scope, factory
):
    """Unchanged source must not create a draft at all — the guard that already
    existed. Kept here so the fingerprint fix cannot quietly replace it."""
    artifact_id = await _artifact(scope, factory)
    base_id, _ = await _version(scope, factory, artifact_id, code="same", fingerprint="fp-same")

    async with factory() as session:
        body = CreateRunRequest(
            task_prompt="rerun",
            framework=Framework.QISKIT,
            mode=RunMode.EXECUTE,
            artifact_version_id=base_id,
            source_code="same",
        )
        assert await _create_stale_source_draft(body, scope, session) == base_id
