"""Live-DB reconciliation test for the bootstrap-manifest import (ADR-0019, Slice B).

Skipped without DATABASE_URL, in the authz-suite mold. Proves the whole pinned
manifest imports end-to-end through the durable importer against real
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
async def test_full_manifest_reconciles_and_is_idempotent(env):
    authority, factory = env
    scope = authority.importer_scope()
    source = BootstrapManifestSource()

    manifest = json.loads(default_manifest_path().read_text(encoding="utf-8"))
    recorded_hash = {it["upstream_identity"]: it["source_blob_sha256"] for it in manifest["items"]}
    expected = len(recorded_hash)
    # The count is read from the manifest, never written here. This assertion used
    # to be `== 283`, and what it was really guarding is one line below it: two
    # items sharing an `upstream_identity` collapse in that dict and the import
    # silently reconciles fewer records than the manifest claims. A literal cannot
    # see that once the corpus grows — it just fails on the growth instead, which is
    # how the number came to be updated by whoever was blocked rather than by whoever
    # decided the corpus size.
    assert expected == manifest["item_count"] == len(manifest["items"])

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
    manifest_count = json.loads(default_manifest_path().read_text(encoding="utf-8"))["item_count"]
    assert first.item_count == second.item_count == manifest_count


@requires_db
async def test_an_item_staged_by_a_concurrent_pass_is_skipped_not_re_advanced(env):
    """The 2026-08-12 deploy failure, reproduced deterministically.

    `process_import_batch` takes its work list once, filtered to QUEUED, and then
    fetches each row inside the loop. Between those two moments another pass over
    the *same job* can stage the row — `_bootstrap_import` drains a job in up to
    ten passes and two deploys can be inside one job at once, with nothing
    serialising them.

    Before the guard, the already-STAGED row was handed to `_advance_item`, whose
    first act is to assert a transition out of `item.state`. STAGED has no legal
    successors, so it raised `IllegalImportItemTransition(staged -> fetching)`;
    that exception carried `reached_state = STAGED` into the transient handler,
    which asserted STAGED -> RETRY_WAIT and raised a *second* lifecycle error —
    the one production actually reported, naming a transition nobody attempted
    and hiding the one that failed.

    The race is simulated rather than run: `session.get` is wrapped so that the
    first row the loop fetches is staged, by a separate committed session, in the
    instant before it is returned. That is exactly the interleaving above, made
    deterministic — a timing-based version of this test would pass by luck.
    """
    authority, factory = env
    scope = authority.importer_scope()
    source = BootstrapManifestSource()

    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            source=source,
            idempotency_key=f"race-{uuid.uuid4()}",
        )
        await session.commit()
        job_id = job.id

    # Race the FIRST pass, while every item is still QUEUED. An earlier draft
    # ran one pass and then looked for a leftover QUEUED row; the batch drains
    # in a single pass, so there was never one and the test SKIPPED — passing
    # for the one reason a regression test must never pass.
    async with factory() as session:
        victim_id = (
            await session.execute(
                select(ImportItem.id).where(
                    ImportItem.import_job_id == job_id,
                    ImportItem.state == ImportItemState.QUEUED,
                )
            )
        ).scalars().first()
    assert victim_id is not None, "the fixture job produced no QUEUED items to race"

    async with factory() as session:
        original_get = session.get
        raced = {"done": False}

        async def get_racing_the_select(entity, ident, *args, **kwargs):
            row = await original_get(entity, ident, *args, **kwargs)
            if not raced["done"] and entity is ImportItem and ident == victim_id:
                raced["done"] = True
                # A concurrent pass finishes this item and commits, after our
                # SELECT chose it and before this fetch hands it to the loop.
                async with factory() as other:
                    staged = await other.get(ImportItem, victim_id)
                    staged.state = ImportItemState.STAGED
                    await other.commit()
                await session.refresh(row)
            return row

        session.get = get_racing_the_select  # type: ignore[method-assign]
        # Before the guard this raised IllegalImportItemTransition(staged -> retry_wait).
        await catalog_import.process_import_batch(
            scope, session, job_id, authority=authority, source=source
        )

    async with factory() as session:
        assert (await session.get(ImportItem, victim_id)).state == ImportItemState.STAGED
