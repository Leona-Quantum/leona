"""Live-DB reconciliation test for the bootstrap-manifest import (ADR-0019, Slice B).

Skipped without DATABASE_URL, in the authz-suite mold. Proves the full 285-record
pinned manifest imports end-to-end through the durable importer against real
Postgres, with no network and no prod creds: every record stages, the bytes that
land in the DB hash to exactly the manifest's recorded per-item hash (true
content reconciliation), everything stays private/draft, and a re-run of the same
batch is an idempotent no-op (no duplicate versions).

Assumes a clean catalog DB (as CI provisions per run): the manifest blobs are the
real corpus and cannot carry a per-run uniqueness marker without breaking their
pinned hashes, so a second run against an already-populated DB would (correctly)
reject the records as duplicate content on the Step 3 global hash constraint.
"""

import asyncio
import json
import os
import uuid

import pytest
from majorana_contracts.enums import ImportItemState, ImportJobStatus
from sqlalchemy import func, select

from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.catalog_bootstrap_manifest import BootstrapManifestSource, default_manifest_path
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import Artifact, ArtifactVersion, ImportItem
from majorana_api.repos import catalog_import, system

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="catalog bootstrap import needs DATABASE_URL"
)

# Same singleton system-catalog authority as test_catalog_import_live.py, so the
# two live modules share the one authority rather than provisioning a second.
_STABLE_NAMESPACE = uuid.UUID("6f6f9f7e-9c6a-4b0a-8b8a-8f2e6c9b5a11")


@pytest.fixture(scope="module")
def authority():
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


async def _drain_batch(scope, factory, job_id, *, authority, source):
    final = None
    for _ in range(10):
        async with factory() as session:
            final = await catalog_import.process_import_batch(
                scope, session, job_id, authority=authority, source=source
            )
        if final.status != ImportJobStatus.RUNNING:
            break
    return final


@requires_db
async def test_full_285_manifest_reconciles_and_is_idempotent(env):
    authority, factory = env
    scope = authority.importer_scope()
    source = BootstrapManifestSource()

    manifest = json.loads(default_manifest_path().read_text(encoding="utf-8"))
    recorded_hash = {it["upstream_identity"]: it["source_blob_sha256"] for it in manifest["items"]}
    expected = len(recorded_hash)
    assert expected == 285

    # Fresh batch per run (uuid key), independent of the checksum-derived key, so
    # a rerun doesn't resume a *prior* run's batch — content-level duplicate
    # protection is the Step 3 hash constraint, tested separately.
    key = f"bootstrap-{uuid.uuid4()}"
    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope, session, authority=authority, source=source, idempotency_key=key
        )
        await session.commit()
        job_id = job.id
        assert job.item_count == expected

    final = await _drain_batch(scope, factory, job_id, authority=authority, source=source)
    assert final.status == ImportJobStatus.COMPLETED
    assert final.accepted_count == expected
    assert final.rejected_count == 0
    assert final.dead_count == 0

    async with factory() as session:
        items = (
            (await session.execute(select(ImportItem).where(ImportItem.import_job_id == job_id)))
            .scalars()
            .all()
        )
        assert len(items) == expected
        by_identity = {i.upstream_identity: i for i in items}
        assert set(by_identity) == set(recorded_hash)

        version_ids = set()
        for identity, item in by_identity.items():
            assert item.state == ImportItemState.STAGED
            # True reconciliation: bytes that reached the DB hash to the manifest's
            # recorded per-item hash — the pipeline preserved content exactly.
            assert item.source_blob_sha256 == recorded_hash[identity]
            artifact = await session.get(Artifact, item.resulting_artifact_id)
            assert artifact.review_state == "draft"
            assert artifact.publication_state == "private"
            assert artifact.visibility == "private"
            version_ids.add(item.resulting_version_id)
        assert len(version_ids) == expected  # one distinct staged version per record

    # Idempotent resume: re-processing the finished batch stages nothing new and
    # creates no duplicate versions (crash-safe re-claim semantics).
    again = await _drain_batch(scope, factory, job_id, authority=authority, source=source)
    assert again.status == ImportJobStatus.COMPLETED
    assert again.accepted_count == expected

    async with factory() as session:
        after_ids = (
            (
                await session.execute(
                    select(ImportItem.resulting_version_id).where(
                        ImportItem.import_job_id == job_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert set(after_ids) == version_ids  # unchanged, not re-staged
        live_versions = (
            await session.execute(
                select(func.count(ArtifactVersion.id)).where(ArtifactVersion.id.in_(version_ids))
            )
        ).scalar_one()
        assert live_versions == expected


@requires_db
async def test_bootstrap_create_is_idempotent_on_checksum_key(env):
    """The checksum-derived key makes create_import_job idempotent: two creates
    with source.idempotency_key return the same batch (no double-enqueue)."""
    authority, factory = env
    scope = authority.importer_scope()
    source = BootstrapManifestSource()

    async with factory() as session:
        first = await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            source=source,
            idempotency_key=source.idempotency_key,
        )
        await session.commit()
    async with factory() as session:
        second = await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            source=source,
            idempotency_key=source.idempotency_key,
        )
        await session.commit()
    assert first.id == second.id
    assert first.item_count == second.item_count == 285
