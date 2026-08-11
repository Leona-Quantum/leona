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
from majorana_contracts.enums import ImportItemState, ImportJobStatus
from sqlalchemy import func, select

from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.catalog_import_fixtures import LocalFixtureSource
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import Artifact, ArtifactVersion, ImportItem
from majorana_api.repos import catalog_import, system


def _fixture_source(fixtures_dir, upstream_ref: str) -> LocalFixtureSource:
    return LocalFixtureSource(fixtures_dir, upstream_ref=upstream_ref)


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
    source = _fixture_source(FIXTURES_ROOT / "valid_set", "valid_set")
    async with factory() as session:
        first = await catalog_import.create_import_job(
            scope, session, authority=authority, source=source, idempotency_key=key
        )
        await session.commit()

    async with factory() as session:
        second = await catalog_import.create_import_job(
            scope, session, authority=authority, source=source, idempotency_key=key
        )
        await session.commit()

    assert first.id == second.id
    assert first.item_count == second.item_count == 2


@requires_db
async def test_reused_key_with_different_request_is_rejected(env):
    """A reused idempotency key naming a different request must fail loudly,
    not silently return the earlier batch."""
    authority, factory = env
    scope = authority.importer_scope()
    key = f"idem-{uuid.uuid4()}"
    async with factory() as session:
        await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            source=_fixture_source(FIXTURES_ROOT / "valid_set", "valid_set"),
            idempotency_key=key,
        )
        await session.commit()

    async with factory() as session:
        with pytest.raises(catalog_import.IdempotencyConflictError):
            await catalog_import.create_import_job(
                scope,
                session,
                authority=authority,
                # different request (provider dir + ref), same key
                source=_fixture_source(FIXTURES_ROOT / "duplicate_pair", "duplicate_pair"),
                idempotency_key=key,
            )


@requires_db
async def test_concurrent_create_with_same_key_returns_winner(env, monkeypatch):
    """Simulates losing the create race: the pre-insert lookup misses (as it
    would when a concurrent creator commits between lookup and flush), the
    unique constraint fires, and the loser recovers the winner's batch."""
    authority, factory = env
    scope = authority.importer_scope()
    key = f"idem-{uuid.uuid4()}"
    source = _fixture_source(FIXTURES_ROOT / "valid_set", "valid_set")
    async with factory() as session:
        winner = await catalog_import.create_import_job(
            scope, session, authority=authority, source=source, idempotency_key=key
        )
        await session.commit()
        winner_id = winner.id

    real_find = catalog_import._find_import_job
    calls = {"n": 0}

    async def racing_find(session, idempotency_key):
        calls["n"] += 1
        if calls["n"] == 1:
            return None  # concurrent creator hasn't been observed yet
        return await real_find(session, idempotency_key)

    monkeypatch.setattr(catalog_import, "_find_import_job", racing_find)

    async with factory() as session:
        recovered = await catalog_import.create_import_job(
            scope, session, authority=authority, source=source, idempotency_key=key
        )
    assert recovered.id == winner_id
    assert calls["n"] == 2  # the recovery path actually ran


@requires_db
async def test_valid_fixtures_all_staged_and_stay_non_public(env, tmp_path):
    authority, factory = env
    scope = authority.importer_scope()
    key = f"idem-{uuid.uuid4()}"
    fixtures_dir = _unique_copy(FIXTURES_ROOT / "valid_set", tmp_path)
    source = _fixture_source(fixtures_dir, "valid_set")
    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope, session, authority=authority, source=source, idempotency_key=key
        )
        await session.commit()
        finished = await catalog_import.process_import_batch(
            scope, session, job.id, authority=authority, source=source
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
    source = _fixture_source(fixtures_dir, "duplicate_pair")
    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope, session, authority=authority, source=source, idempotency_key=key
        )
        await session.commit()
        finished = await catalog_import.process_import_batch(
            scope, session, job.id, authority=authority, source=source
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
    source = _fixture_source(fixtures_dir, "adversarial_set")
    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope, session, authority=authority, source=source, idempotency_key=key
        )
        await session.commit()
        finished = await catalog_import.process_import_batch(
            scope, session, job.id, authority=authority, source=source
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
    source = _fixture_source(fixtures_dir, "valid_set")
    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope, session, authority=authority, source=source, idempotency_key=key
        )
        await session.commit()
        await catalog_import.process_import_batch(
            scope, session, job.id, authority=authority, source=source
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
            scope, session, job.id, authority=authority, source=source
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


def _unique_corpus(source_dir: Path, dest_dir: Path) -> Path:
    """Like _unique_copy, but the file *names* are unique per run too.

    _unique_copy only varies content. That was enough while every import created
    a fresh artifact, but upstream identity is now a durable key: the file name
    is the identity, and reconciliation deliberately resolves it across import
    jobs. Reusing `valid_set/a.json` run-to-run would therefore resolve onto the
    artifact left behind by the *previous* test run and count its versions —
    which is the reconciler working correctly and the test lying about what it
    measured.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    run = uuid.uuid4().hex
    marker = f"\n# test-run-marker: {run}\n".encode()
    for path in sorted(p for p in source_dir.iterdir() if p.is_file()):
        (dest_dir / f"{path.stem}-{run}{path.suffix}").write_bytes(path.read_bytes() + marker)
    return dest_dir


async def _import_once(factory, authority, source) -> tuple[uuid.UUID, object]:
    """One complete import batch under a fresh idempotency key.

    A fresh key is what makes this a *second import* rather than a retry: the
    same key resumes the existing job (test_retry_creates_no_duplicate_version
    covers that), a new one creates a new job with a new set of ImportItems —
    which is what the operator does after regenerating the manifest.
    """
    scope = authority.importer_scope()
    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope,
            session,
            authority=authority,
            source=source,
            idempotency_key=f"idem-{uuid.uuid4()}",
        )
        await session.commit()
        finished = await catalog_import.process_import_batch(
            scope, session, job.id, authority=authority, source=source
        )
    return job.id, finished


@requires_db
async def test_reimporting_unchanged_content_reuses_the_record(env, tmp_path):
    """A second import of a corpus that has not changed writes nothing.

    Before reconciliation this was the importer rejecting a record for being
    itself: the second run staged a *new* artifact holding the same bytes, hit
    the table-wide unique constraint on normalized_source_hash, and reported
    `duplicate_source`. And because stage_artifact_version rolls its session
    back before raising, the artifact INSERT from moments earlier was discarded
    too — leaving a rejected ledger row pointing at nothing.
    """
    authority, factory = env
    fixtures_dir = _unique_corpus(FIXTURES_ROOT / "valid_set", tmp_path)
    source = _fixture_source(fixtures_dir, "valid_set")

    first_job, first = await _import_once(factory, authority, source)
    assert first.status == ImportJobStatus.COMPLETED
    assert first.accepted_count == 2

    async with factory() as session:
        before = await _items_by_identity(session, first_job)
        artifacts_before = {name: i.resulting_artifact_id for name, i in before.items()}
        versions_before = {name: i.resulting_version_id for name, i in before.items()}

    second_job, second = await _import_once(factory, authority, source)
    # The record is accepted, not rejected as a duplicate of itself.
    assert second.status == ImportJobStatus.COMPLETED
    assert second.accepted_count == 2
    assert second.rejected_count == 0

    async with factory() as session:
        after = await _items_by_identity(session, second_job)
        assert {i.state for i in after.values()} == {ImportItemState.STAGED}
        # Same artifacts, same versions: the second import created no rows.
        assert {n: i.resulting_artifact_id for n, i in after.items()} == artifacts_before
        assert {n: i.resulting_version_id for n, i in after.items()} == versions_before

        for identity, artifact_id in artifacts_before.items():
            artifact = await session.get(Artifact, artifact_id)
            assert artifact.upstream_identity == identity
            version_count = (
                await session.execute(
                    select(func.count(ArtifactVersion.id)).where(
                        ArtifactVersion.artifact_id == artifact_id
                    )
                )
            ).scalar_one()
            assert version_count == 1


@requires_db
async def test_reimporting_changed_content_revises_the_same_record(env, tmp_path):
    """Edited content becomes a new version of the record that already exists,
    under the same public identity — which is the entire point of R0: the owner
    can change an entry and have the change reach a visitor.

    The identity is what has to survive. A second artifact would take the same
    manifest slug and the public listing would then serve two records under one
    URL, which is what the partial unique index in migration 0046 forbids.
    """
    authority, factory = env
    fixtures_dir = _unique_corpus(FIXTURES_ROOT / "valid_set", tmp_path)
    source = _fixture_source(fixtures_dir, "valid_set")

    first_job, first = await _import_once(factory, authority, source)
    assert first.accepted_count == 2

    async with factory() as session:
        before = await _items_by_identity(session, first_job)
        artifacts_before = {name: i.resulting_artifact_id for name, i in before.items()}

    # The owner fixes one record's content and regenerates the manifest.
    edited = sorted(p for p in fixtures_dir.iterdir() if p.is_file())[0]
    edited.write_bytes(edited.read_bytes() + f"\n# corrected: {uuid.uuid4()}\n".encode())

    second_job, second = await _import_once(factory, authority, source)
    assert second.status == ImportJobStatus.COMPLETED
    assert second.accepted_count == 2
    assert second.rejected_count == 0

    async with factory() as session:
        after = await _items_by_identity(session, second_job)
        # Same artifacts throughout — the edit revised a record, it did not
        # create a rival one.
        assert {n: i.resulting_artifact_id for n, i in after.items()} == artifacts_before

        changed_id = artifacts_before[edited.name]
        changed = await session.get(Artifact, changed_id)
        assert changed.upstream_identity == edited.name
        assert changed.current_version_id == after[edited.name].resulting_version_id
        assert changed.current_version_id != before[edited.name].resulting_version_id

        seqs = (
            (
                await session.execute(
                    select(ArtifactVersion.seq)
                    .where(ArtifactVersion.artifact_id == changed_id)
                    .order_by(ArtifactVersion.seq)
                )
            )
            .scalars()
            .all()
        )
        assert list(seqs) == [1, 2]

        # The untouched record gained no version.
        untouched_id = next(a for n, a in artifacts_before.items() if n != edited.name)
        untouched_versions = (
            await session.execute(
                select(func.count(ArtifactVersion.id)).where(
                    ArtifactVersion.artifact_id == untouched_id
                )
            )
        ).scalar_one()
        assert untouched_versions == 1


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
    source = _fixture_source(fixtures_dir, "valid_set")
    async with factory() as session:
        job = await catalog_import.create_import_job(
            scope, session, authority=authority, source=source, idempotency_key=key
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
            source=source,
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
            scope, session, job.id, authority=authority, source=source
        )
    assert finished.status == ImportJobStatus.COMPLETED
    assert finished.accepted_count == 2

    async with factory() as session:
        final_state = await _items_by_identity(session, job.id)
        assert final_state[first_identity].state == ImportItemState.STAGED
        assert final_state[first_identity].resulting_version_id == staged_version_id
        assert final_state[other_identity].state == ImportItemState.STAGED


@requires_db
async def test_an_item_taken_by_another_processor_mid_batch_is_skipped(env, tmp_path, monkeypatch):
    """The race that killed the production catalog sync on 2026-08-12.

    `process_import_batch` SELECTs the QUEUED item ids, then re-fetches each one
    inside the loop. That select is a snapshot, and this batch is not the only
    processor: `catalog_admin bootstrap-import` creates the job — which enqueues
    a durable `catalog.import` job the deployed **worker** also handles — and
    then drains the batch itself. So the worker can take an item *after* the
    select and *before* the loop reaches it.

    In production that surfaced nine seconds in as
    ``illegal import item transition staged -> fetching``, and then again as
    ``staged -> retry_wait`` when the transient handler tried to requeue the
    already-staged item. The batch died and the corpus stayed unsynced.

    **The interleaving is the whole test.** An earlier version of this staged the
    item *before* calling `process_import_batch` — which the select then filtered
    out, so it passed with the fix reverted and proved nothing. The other
    processor has to win *between* the two steps, so it is simulated from inside
    the first item's `_advance_item` call.
    """
    authority, factory = env
    scope = authority.importer_scope()
    source = _fixture_source(_unique_copy(FIXTURES_ROOT / "valid_set", tmp_path / "raced"), "raced")

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

    taken: dict[str, str] = {}
    original = catalog_import._advance_item

    async def racing_advance(scope_, session_, item_, **kwargs):
        # First item only: another processor commits a sibling as STAGED, which
        # is exactly what the worker does to a row this loop has already selected.
        if not taken:
            async with factory() as other:
                for identity, row in (await _items_by_identity(other, job_id)).items():
                    if row.id != item_.id:
                        row.state = ImportItemState.STAGED
                        taken[identity] = identity
                await other.commit()
        return await original(scope_, session_, item_, **kwargs)

    monkeypatch.setattr(catalog_import, "_advance_item", racing_advance)

    # Must not raise. With the re-check removed this dies on `staged -> fetching`.
    async with factory() as session:
        final = await catalog_import.process_import_batch(
            scope, session, job_id, authority=authority, source=source
        )
    assert taken, "the race never fired — the test would prove nothing"
    # `==`, not `is`: these columns come back as plain strings, so an identity
    # comparison against the enum is vacuously true and asserts nothing.
    assert final.status == ImportJobStatus.COMPLETED

    async with factory() as session:
        after = await _items_by_identity(session, job_id)
    # The raced item is left as the other processor left it — not re-advanced,
    # and above all not forced to RETRY_WAIT or DEAD.
    for identity in after:
        assert after[identity].state == ImportItemState.STAGED
