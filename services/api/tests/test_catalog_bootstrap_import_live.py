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
import datetime as dt
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
from majorana_api.repos import catalog, catalog_import, system

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
async def test_a_second_import_under_the_production_key_is_a_no_op(env):
    """The re-import path production actually takes, which nothing else covered.

    The full-manifest test above uses a fresh uuid key, with the comment "so a
    rerun doesn't resume a *prior* run's batch". `catalog_admin bootstrap-import`
    does the opposite: it passes `source.idempotency_key`, derived from the
    manifest checksum, so a second run with an unchanged manifest RESUMES the
    first run's batch. Nothing exercised that, which is how the word "idempotent"
    in the other test's name came to be about job *creation* rather than about
    re-importing.

    **What this does NOT do: reproduce the 2026-08-12 JST deploy failure**
    (2026-08-11 UTC — the incident is dated in the project's working timezone)
    (`IllegalImportItemTransition: staged -> retry_wait`). It was written trying
    to, and it passes — which is a result worth keeping rather than a test worth
    deleting, because it eliminates the obvious explanation. `process_import_batch`
    selects only QUEUED items, so a STAGED item is never re-processed by a plain
    re-run; the production failure therefore needs an item that failed
    transiently FIRST, was returned to QUEUED by `_resolve_retry_wait_items`,
    reached STAGED on the retry, and then threw again. What it threw is not
    recoverable from the deploy log — the assert replaces it — which is what the
    logging added alongside this exists to fix.
    """
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
        first_id = first.id
    assert (
        await _drain_batch(scope, factory, first_id, authority=authority, source=source)
    ).status == ImportJobStatus.COMPLETED

    # What the finished batch looks like before the second deploy touches it.
    # Captured per item rather than counted: a re-stage that swapped in a fresh
    # version would leave every count identical and change the ids, so a count is
    # not able to see the failure this test exists to rule out. The expected size
    # is read from the manifest for the reason argued above — a literal here would
    # be a second place the corpus size has to be updated.
    expected = json.loads(default_manifest_path().read_text(encoding="utf-8"))["item_count"]

    async def _batch_state():
        async with factory() as session:
            items = (
                (
                    await session.execute(
                        select(ImportItem).where(ImportItem.import_job_id == first_id)
                    )
                )
                .scalars()
                .all()
            )
            return {
                i.upstream_identity: (i.state, i.resulting_artifact_id, i.resulting_version_id)
                for i in items
            }

    before = await _batch_state()
    assert len(before) == expected
    assert {state for state, _, _ in before.values()} == {ImportItemState.STAGED}

    # Second deploy. Same key, so this resumes rather than creating a new batch.
    async with factory() as session:
        second = await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            source=source,
            idempotency_key=source.idempotency_key,
        )
        await session.commit()
        second_id = second.id
    # The claim in this test's name. Without it the test still passes against a
    # second, parallel batch — which is precisely the outcome it is here to rule
    # out, and the one the fresh-uuid test above deliberately produces instead.
    assert second_id == first_id

    final = await _drain_batch(scope, factory, second_id, authority=authority, source=source)
    # `!= RUNNING` also accepts FAILED and DEAD. A re-import that dies is the
    # thing being ruled out, not a passing result.
    assert final.status == ImportJobStatus.COMPLETED
    assert await _batch_state() == before  # nothing re-staged, nothing re-versioned


@requires_db
async def test_a_withdrawn_record_is_revived_by_the_next_import_not_rejected(env):
    """Retirement must not be a one-way door.

    `retire-bootstrap` soft-deletes, and `find_staged_artifact_by_upstream_identity`
    filters `deleted_at IS NULL`, so a withdrawn identity reads as ABSENT and the
    import takes the create path — which collides with the withdrawn row's own
    version on the table-wide unique `normalized_source_hash` and comes back as
    `duplicate_source`: the record rejected for being itself.

    Found in production on 2026-08-16, not in a test. The Bell-pair ladder's floor
    moved 2q -> 4q; `-4q` had been withdrawn an hour earlier as one of 90, and the
    deploy failed with `accepted=278 rejected=1`. A corpus its owner intends to
    restructure wholesale cannot have a delete that cannot be undone.
    """
    authority, factory = env
    scope = authority.importer_scope()
    source = BootstrapManifestSource()

    # Import once so there is something to withdraw.
    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            source=source,
            idempotency_key=f"revive-seed-{uuid.uuid4()}",
        )
        await session.commit()
        job_id = job.id
    await _drain_batch(scope, factory, job_id, authority=authority, source=source)

    identity = sorted(source.identities())[0]
    async with factory() as session:
        found = await catalog.find_staged_artifact_by_upstream_identity(
            scope, session, authority=authority, upstream_identity=identity
        )
        assert found is not None, "the seed import did not stage the record under test"
        artifact_id = found[0].id
        # Withdraw it exactly the way `retire-bootstrap` does.
        found[0].deleted_at = dt.datetime.now(dt.timezone.utc)
        await session.commit()

    # The resolver must now report it absent — this is the precondition that made
    # the create path fire, and asserting it keeps the test honest if the filter
    # ever changes.
    async with factory() as session:
        assert (
            await catalog.find_staged_artifact_by_upstream_identity(
                scope, session, authority=authority, upstream_identity=identity
            )
            is None
        )

    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            source=source,
            idempotency_key=f"revive-run-{uuid.uuid4()}",
        )
        await session.commit()
        job_id = job.id
    final = await _drain_batch(scope, factory, job_id, authority=authority, source=source)

    # The whole manifest lands. Before the revive branch this run came back
    # `completed_with_rejections` with exactly one `duplicate_source`.
    assert final.rejected_count == 0, "a withdrawn record was rejected instead of revived"
    assert final.accepted_count == len(source.identities())

    async with factory() as session:
        revived = await catalog.find_staged_artifact_by_upstream_identity(
            scope, session, authority=authority, upstream_identity=identity
        )
        assert revived is not None, "the withdrawn record was not brought back"
        assert revived[0].id == artifact_id, (
            "revival created a SECOND artifact for one upstream identity rather than "
            "adopting the withdrawn one — the history and the stars are on the first"
        )
        assert revived[0].deleted_at is None
