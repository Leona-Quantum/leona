"""Live-DB test in the authz-suite mold: skipped without DATABASE_URL.

Proves Step 5a's durable import pipeline end-to-end against real Postgres,
using only the controlled local/file fixture provider (no network): valid
fixtures stage cleanly and stay non-public, the duplicate-content pair
collides on the Step 3 global hash constraint, adversarial fixtures
(oversized/empty/malformed) fail safely, retrying a batch creates no
duplicate version, and a crashed import resumes from durable item state.
"""

import asyncio
import os
import uuid
from pathlib import Path

import pytest
from majorana_contracts.enums import ImportItemState, ImportJobStatus, ImportProvider
from sqlalchemy import func, select

from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import Artifact, ArtifactVersion, ImportItem
from majorana_api.repos import catalog_import, system

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="catalog import needs DATABASE_URL"
)

_STABLE_NAMESPACE = uuid.UUID("6f6f9f7e-9c6a-4b0a-8b8a-8f2e6c9b5a11")
FIXTURES_ROOT = Path(__file__).parent / "fixtures" / "catalog_import"


def _unique_copy(source_dir: Path, dest_dir: Path) -> Path:
    """Copy a fixture set with a per-run unique marker appended to each file.

    Tests that stage real content need distinct normalized_source_hash
    values run-to-run, or they'd collide with a *previous test run's*
    already-committed version on Step 3's global duplicate constraint (not
    a bug — the constraint is working correctly; the fixture set is just
    reused across independent test invocations).
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    marker = f"\n# test-run-marker: {uuid.uuid4()}\n".encode()
    for path in source_dir.iterdir():
        if path.is_file():
            (dest_dir / path.name).write_bytes(path.read_bytes() + marker)
    return dest_dir


@pytest.fixture(scope="module")
def authority():
    """Same singleton-authority rationale as test_catalog_staging_live.py."""
    configured = CatalogAuthority(
        enabled=True,
        workspace_id=uuid.uuid5(_STABLE_NAMESPACE, "workspace"),
        importer_user_id=uuid.uuid5(_STABLE_NAMESPACE, "importer"),
        public_reader_user_id=uuid.uuid5(_STABLE_NAMESPACE, "public-reader"),
    )

    async def _provision():
        engine = engine_from_env()
        factory = session_factory(engine)
        async with factory() as session:
            await system.ensure_system_catalog_authority(
                session,
                workspace_id=configured.workspace_id,
                importer_user_id=configured.importer_user_id,
                public_reader_user_id=configured.public_reader_user_id,
            )
            await session.commit()
        await engine.dispose()

    asyncio.run(_provision())
    return configured


@pytest.fixture
async def env(authority):
    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        yield authority, factory
    finally:
        await engine.dispose()


async def _items_by_identity(session, import_job_id) -> dict[str, ImportItem]:
    rows = (
        (await session.execute(select(ImportItem).where(ImportItem.import_job_id == import_job_id)))
        .scalars()
        .all()
    )
    return {row.upstream_identity: row for row in rows}


@requires_db
async def test_create_import_job_is_idempotent(env):
    authority, factory = env
    scope = authority.importer_scope()
    key = f"idem-{uuid.uuid4()}"
    async with factory() as session:
        first = await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            provider=ImportProvider.LOCAL_FIXTURE,
            upstream_ref="valid_set",
            idempotency_key=key,
            fixtures_dir=FIXTURES_ROOT / "valid_set",
        )
        await session.commit()

    async with factory() as session:
        second = await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            provider=ImportProvider.LOCAL_FIXTURE,
            upstream_ref="valid_set",
            idempotency_key=key,
            fixtures_dir=FIXTURES_ROOT / "valid_set",
        )
        await session.commit()

    assert first.id == second.id
    assert first.item_count == second.item_count == 2


@requires_db
async def test_valid_fixtures_all_staged_and_stay_non_public(env, tmp_path):
    authority, factory = env
    scope = authority.importer_scope()
    key = f"idem-{uuid.uuid4()}"
    fixtures_dir = _unique_copy(FIXTURES_ROOT / "valid_set", tmp_path)
    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            provider=ImportProvider.LOCAL_FIXTURE,
            upstream_ref="valid_set",
            idempotency_key=key,
            fixtures_dir=fixtures_dir,
        )
        await session.commit()
        finished = await catalog_import.process_import_batch(
            scope, session, job.id, authority=authority, fixtures_dir=fixtures_dir
        )

    assert finished.status == ImportJobStatus.COMPLETED
    assert finished.accepted_count == 2
    assert finished.rejected_count == 0

    async with factory() as session:
        items = await _items_by_identity(session, job.id)
        assert {i.state for i in items.values()} == {ImportItemState.STAGED}
        for item in items.values():
            artifact = await session.get(Artifact, item.resulting_artifact_id)
            assert artifact.review_state == "draft"
            assert artifact.publication_state == "private"
            assert artifact.visibility == "private"


@requires_db
async def test_duplicate_pair_one_staged_one_rejected(env, tmp_path):
    authority, factory = env
    scope = authority.importer_scope()
    key = f"idem-{uuid.uuid4()}"
    fixtures_dir = _unique_copy(FIXTURES_ROOT / "duplicate_pair", tmp_path)
    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            provider=ImportProvider.LOCAL_FIXTURE,
            upstream_ref="duplicate_pair",
            idempotency_key=key,
            fixtures_dir=fixtures_dir,
        )
        await session.commit()
        finished = await catalog_import.process_import_batch(
            scope, session, job.id, authority=authority, fixtures_dir=fixtures_dir
        )

    assert finished.status == ImportJobStatus.COMPLETED_WITH_REJECTIONS
    assert finished.accepted_count == 1
    assert finished.rejected_count == 1

    async with factory() as session:
        items = await _items_by_identity(session, job.id)
        states = {name: item.state for name, item in items.items()}
        assert sorted(states.values()) == [ImportItemState.REJECTED, ImportItemState.STAGED]
        rejected = next(i for i in items.values() if i.state == ImportItemState.REJECTED)
        assert rejected.failure_code == "duplicate_source"
        assert rejected.resulting_artifact_id is None


@requires_db
async def test_adversarial_fixtures_fail_safely(env):
    authority, factory = env
    scope = authority.importer_scope()
    key = f"idem-{uuid.uuid4()}"
    fixtures_dir = FIXTURES_ROOT / "adversarial_set"
    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            provider=ImportProvider.LOCAL_FIXTURE,
            upstream_ref="adversarial_set",
            idempotency_key=key,
            fixtures_dir=fixtures_dir,
        )
        await session.commit()
        finished = await catalog_import.process_import_batch(
            scope, session, job.id, authority=authority, fixtures_dir=fixtures_dir
        )

    assert finished.status == ImportJobStatus.COMPLETED_WITH_REJECTIONS
    assert finished.accepted_count == 0
    assert finished.rejected_count == 3

    async with factory() as session:
        items = await _items_by_identity(session, job.id)
        assert items["oversized.py"].state == ImportItemState.REJECTED
        assert items["oversized.py"].failure_code == "oversized"
        assert items["empty.py"].state == ImportItemState.REJECTED
        assert items["empty.py"].failure_code == "empty_content"
        assert items["malformed_binary.dat"].state == ImportItemState.REJECTED
        assert items["malformed_binary.dat"].failure_code == "malformed_encoding"
        for item in items.values():
            assert item.resulting_artifact_id is None


@requires_db
async def test_retry_creates_no_duplicate_version(env, tmp_path):
    authority, factory = env
    scope = authority.importer_scope()
    key = f"idem-{uuid.uuid4()}"
    fixtures_dir = _unique_copy(FIXTURES_ROOT / "valid_set", tmp_path)
    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            provider=ImportProvider.LOCAL_FIXTURE,
            upstream_ref="valid_set",
            idempotency_key=key,
            fixtures_dir=fixtures_dir,
        )
        await session.commit()
        await catalog_import.process_import_batch(
            scope, session, job.id, authority=authority, fixtures_dir=fixtures_dir
        )

    async with factory() as session:
        before = await _items_by_identity(session, job.id)
        version_ids_before = {i.resulting_version_id for i in before.values()}
        version_count_before = (
            await session.execute(
                select(func.count(ArtifactVersion.id)).where(
                    ArtifactVersion.id.in_(version_ids_before)
                )
            )
        ).scalar_one()

    # Simulate a retry of the same batch (e.g. the worker re-claims the job).
    async with factory() as session:
        again = await catalog_import.process_import_batch(
            scope, session, job.id, authority=authority, fixtures_dir=fixtures_dir
        )
    assert again.status == ImportJobStatus.COMPLETED
    assert again.accepted_count == 2

    async with factory() as session:
        after = await _items_by_identity(session, job.id)
        version_ids_after = {i.resulting_version_id for i in after.values()}
        version_count_after = (
            await session.execute(
                select(func.count(ArtifactVersion.id)).where(
                    ArtifactVersion.id.in_(version_ids_after)
                )
            )
        ).scalar_one()

    assert version_ids_after == version_ids_before  # unchanged, not re-staged
    assert version_count_after == version_count_before == 2


@requires_db
async def test_crashed_import_resumes_from_durable_item_state(env, tmp_path):
    """Simulates a crash mid-batch: one item is already terminal (as if a
    prior process died right after committing it), the rest are still
    queued. A fresh process_import_batch call must only touch the
    non-terminal ones and leave the already-staged item untouched.
    """
    authority, factory = env
    scope = authority.importer_scope()
    key = f"idem-{uuid.uuid4()}"
    fixtures_dir = _unique_copy(FIXTURES_ROOT / "valid_set", tmp_path)
    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            provider=ImportProvider.LOCAL_FIXTURE,
            upstream_ref="valid_set",
            idempotency_key=key,
            fixtures_dir=fixtures_dir,
        )
        await session.commit()

    # Simulate "a prior worker process already finished one item and then
    # crashed" by processing just that single item through the same code
    # path, independent of the batch loop.
    async with factory() as session:
        items = await _items_by_identity(session, job.id)
        first_identity = sorted(items)[0]
        await catalog_import._advance_item(
            scope,
            session,
            items[first_identity],
            authority=authority,
            fixtures_dir=fixtures_dir,
            staging=catalog_import.LocalFixtureStagingDefaults(),
            slug_prefix=f"import-{job.id.hex[:12]}-resume-test",
        )
        await session.commit()

    async with factory() as session:
        mid_state = await _items_by_identity(session, job.id)
        assert mid_state[first_identity].state == ImportItemState.STAGED
        staged_version_id = mid_state[first_identity].resulting_version_id
        other_identity = next(name for name in mid_state if name != first_identity)
        assert mid_state[other_identity].state == ImportItemState.QUEUED

    # "Resume" the crashed import with a normal batch call.
    async with factory() as session:
        finished = await catalog_import.process_import_batch(
            scope, session, job.id, authority=authority, fixtures_dir=fixtures_dir
        )
    assert finished.status == ImportJobStatus.COMPLETED
    assert finished.accepted_count == 2

    async with factory() as session:
        final_state = await _items_by_identity(session, job.id)
        assert final_state[first_identity].state == ImportItemState.STAGED
        assert final_state[first_identity].resulting_version_id == staged_version_id
        assert final_state[other_identity].state == ImportItemState.STAGED
