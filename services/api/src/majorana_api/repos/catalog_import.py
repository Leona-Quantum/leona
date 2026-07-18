"""Durable catalog import pipeline (Step 5a): batch/item orchestration over
the existing Job lease infrastructure (repos/system.py) and Step 3 staging
(repos/catalog.py). Only the local/file fixture provider is wired here — a
real network adapter is a separate, later slice (see
catalog_import_fixtures.py's module docstring).

Each item commits independently: a failure in one item's stage attempt
rolls back only that item's own uncommitted work, never a sibling item's
already-committed outcome (plan §5.3: "one bad input cannot roll back or
publish an entire batch"). This is why item processing issues its own
commit/rollback per item instead of sharing one transaction for the batch.
"""

import dataclasses
import uuid
from pathlib import Path

from majorana_contracts import Scope, assert_import_item_transition
from majorana_contracts.enums import (
    Algorithm,
    ArtifactKind,
    ExecutionState,
    Framework,
    ImportItemState,
    ImportJobStatus,
    ImportProvider,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..catalog_authority import CatalogAuthority
from ..catalog_hashing import hash_source_blob
from ..catalog_import_fixtures import (
    FixtureTooLargeError,
    list_fixture_identities,
    read_fixture_bytes,
)
from ..ids import uuid7
from ..jobs import CATALOG_IMPORT_JOB_KIND
from ..orm import ImportItem, ImportJob, Job
from . import catalog, system
from ._base import NotFoundError, RepoError

TERMINAL_ITEM_STATES = frozenset(
    {ImportItemState.STAGED, ImportItemState.REJECTED, ImportItemState.DEAD}
)


class _ItemRejected(Exception):
    """Deterministic, non-retryable rejection with a stable failure code."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code


class IdempotencyConflictError(RepoError):
    """The idempotency key was reused for a materially different request.

    Silently returning the earlier batch would make the caller believe their
    (different) request was accepted; failing loudly forces them to pick a
    fresh key or reconcile the difference.
    """


@dataclasses.dataclass(frozen=True)
class LocalFixtureStagingDefaults:
    """How a staged fixture is classified.

    execution_state stays template_only: this slice validates content
    structurally, it does not execute or framework-parse it (don't overstate
    framework support). authoritative_framework_version is an honest
    'unknown', not a guessed real version number.
    """

    family: Algorithm = Algorithm.OTHER
    framework: Framework = Framework.QISKIT
    artifact_kind: ArtifactKind = ArtifactKind.CIRCUIT
    execution_state: ExecutionState = ExecutionState.TEMPLATE_ONLY
    code_lang: str = "python"
    authoritative_framework: Framework = Framework.QISKIT
    authoritative_framework_version: str = "unknown"
    source_language: str = "python"
    metadata_schema_version: str = "1"


async def _find_import_job(session: AsyncSession, idempotency_key: str) -> ImportJob | None:
    return (
        (
            await session.execute(
                select(ImportJob).where(ImportJob.idempotency_key == idempotency_key)
            )
        )
        .scalars()
        .first()
    )


async def _assert_request_equivalent(
    session: AsyncSession,
    existing: ImportJob,
    *,
    provider: ImportProvider,
    upstream_ref: str,
    fixtures_dir: Path,
) -> None:
    """A reused idempotency key must describe the same request it named before."""
    queue_job = await session.get(Job, existing.job_id)
    recorded_fixtures_dir = queue_job.payload.get("fixtures_dir") if queue_job is not None else None
    if (
        ImportProvider(existing.provider) != provider
        or existing.upstream_ref != upstream_ref
        or recorded_fixtures_dir != str(fixtures_dir)
    ):
        raise IdempotencyConflictError(
            f"idempotency key {existing.idempotency_key!r} was already used "
            "for a different import request"
        )


async def create_import_job(
    scope: Scope,
    session: AsyncSession,
    *,
    authority: CatalogAuthority,
    provider: ImportProvider,
    upstream_ref: str,
    idempotency_key: str,
    fixtures_dir: Path,
) -> ImportJob:
    """Idempotently create a batch and its items from a fixture directory.

    Re-running with the same idempotency_key and the same request returns the
    existing batch unchanged, so a crashed/retried import-creation request is
    safe. Reusing a key for a *different* request (provider/upstream_ref/
    fixtures_dir mismatch) raises IdempotencyConflictError instead of silently
    returning the wrong batch. Two concurrent creators racing the same key are
    serialized by the unique constraint: the loser rolls back this session's
    uncommitted work (like stage_artifact_version's duplicate handling) and
    returns the winner's batch.
    """
    await catalog.get_importer_workspace(scope, session, authority=authority)

    existing = await _find_import_job(session, idempotency_key)
    if existing is not None:
        await _assert_request_equivalent(
            session,
            existing,
            provider=provider,
            upstream_ref=upstream_ref,
            fixtures_dir=fixtures_dir,
        )
        return existing

    identities = list_fixture_identities(fixtures_dir)

    job = await system.enqueue_job(
        session,
        kind=CATALOG_IMPORT_JOB_KIND,
        payload={"idempotency_key": idempotency_key, "fixtures_dir": str(fixtures_dir)},
    )
    import_job = ImportJob(
        id=uuid7(),
        job_id=job.id,
        provider=provider,
        upstream_ref=upstream_ref,
        idempotency_key=idempotency_key,
        status=ImportJobStatus.QUEUED,
        item_count=len(identities),
    )
    session.add(import_job)
    try:
        await session.flush()
    except IntegrityError:
        # A concurrent creator committed the same key between our lookup and
        # this flush. rollback() discards this session's uncommitted work and
        # expires its ORM objects, so everything below re-reads from the DB.
        await session.rollback()
        winner = await _find_import_job(session, idempotency_key)
        if winner is None:
            raise
        await _assert_request_equivalent(
            session,
            winner,
            provider=provider,
            upstream_ref=upstream_ref,
            fixtures_dir=fixtures_dir,
        )
        return winner

    for identity in identities:
        session.add(
            ImportItem(
                id=uuid7(),
                import_job_id=import_job.id,
                upstream_identity=identity.upstream_identity,
                state=ImportItemState.QUEUED,
            )
        )
    await session.flush()
    return import_job


async def get_import_job_by_idempotency_key(
    session: AsyncSession, idempotency_key: str
) -> ImportJob:
    job = (
        (
            await session.execute(
                select(ImportJob).where(ImportJob.idempotency_key == idempotency_key)
            )
        )
        .scalars()
        .first()
    )
    if job is None:
        raise NotFoundError("import job")
    return job


async def _get_import_job(session: AsyncSession, import_job_id: uuid.UUID) -> ImportJob:
    job = await session.get(ImportJob, import_job_id)
    if job is None:
        raise NotFoundError("import job")
    return job


async def _resolve_retry_wait_items(session: AsyncSession, *, import_job_id: uuid.UUID) -> None:
    stmt = select(ImportItem).where(
        ImportItem.import_job_id == import_job_id,
        ImportItem.state == ImportItemState.RETRY_WAIT,
    )
    for item in (await session.execute(stmt)).scalars().all():
        current = ImportItemState(item.state)
        target = (
            ImportItemState.DEAD if item.attempts >= item.max_attempts else ImportItemState.QUEUED
        )
        assert_import_item_transition(current, target)
        item.state = target
    await session.flush()


async def _advance_item(
    scope: Scope,
    session: AsyncSession,
    item: ImportItem,
    *,
    authority: CatalogAuthority,
    fixtures_dir: Path,
    staging: LocalFixtureStagingDefaults,
    slug_prefix: str,
) -> None:
    # `reached` mirrors item.state in a plain local variable, never re-read off
    # the ORM object once set. catalog.stage_artifact_version rolls back its own
    # session on a duplicate-hash conflict, which expires every object in this
    # shared session (including `item`) before its DuplicateSourceError even
    # propagates here -- so by the time an exception is caught, item.state may
    # already be an expired attribute that can't be lazily reloaded outside an
    # awaited call. Tagging the exception with `reached` lets the caller learn
    # how far this attempt got without ever touching that attribute again.
    reached = ImportItemState(item.state)
    try:
        assert_import_item_transition(reached, ImportItemState.FETCHING)
        item.state = reached = ImportItemState.FETCHING
        await session.flush()

        try:
            raw = read_fixture_bytes(fixtures_dir / item.upstream_identity)
        except FixtureTooLargeError:
            raise _ItemRejected("oversized") from None
        except (FileNotFoundError, OSError):
            raise _ItemRejected("unreadable") from None

        item.source_blob_sha256 = hash_source_blob(raw)
        assert_import_item_transition(reached, ImportItemState.QUARANTINED)
        item.state = reached = ImportItemState.QUARANTINED
        await session.flush()

        assert_import_item_transition(reached, ImportItemState.PARSING)
        item.state = reached = ImportItemState.PARSING
        await session.flush()

        try:
            normalized = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise _ItemRejected("malformed_encoding") from None
        if not normalized.strip():
            raise _ItemRejected("empty_content") from None

        try:
            artifact = await catalog.stage_artifact(
                scope,
                session,
                authority=authority,
                slug=f"{slug_prefix}-{item.id.hex}",
                title=item.upstream_identity,
                family=staging.family,
                framework=staging.framework,
                artifact_kind=staging.artifact_kind,
                execution_state=staging.execution_state,
            )
            version = await catalog.stage_artifact_version(
                scope,
                session,
                artifact.id,
                authority=authority,
                raw_source=raw,
                normalized_source=normalized,
                code=normalized,
                code_lang=staging.code_lang,
                authoritative_framework=staging.authoritative_framework,
                authoritative_framework_version=staging.authoritative_framework_version,
                source_language=staging.source_language,
                metadata_schema_version=staging.metadata_schema_version,
            )
        except catalog.DuplicateSourceError:
            raise _ItemRejected("duplicate_source") from None

        assert_import_item_transition(reached, ImportItemState.STAGED)
        item.state = ImportItemState.STAGED
        item.resulting_artifact_id = artifact.id
        item.resulting_version_id = version.id
        await session.flush()
    except Exception as exc:
        exc.reached_state = reached
        raise


async def process_import_batch(
    scope: Scope,
    session: AsyncSession,
    import_job_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
    fixtures_dir: Path,
    staging: LocalFixtureStagingDefaults | None = None,
) -> ImportJob:
    """Advance every non-terminal item of one batch by one attempt.

    Safe to call repeatedly, including after a crash mid-batch: items
    already at a terminal state (staged/rejected/dead) are left untouched,
    and each item's outcome is committed independently of its siblings.
    """
    staging = staging or LocalFixtureStagingDefaults()
    await catalog.get_importer_workspace(scope, session, authority=authority)
    await _get_import_job(session, import_job_id)  # raises NotFoundError if missing

    await _resolve_retry_wait_items(session, import_job_id=import_job_id)
    await session.commit()

    item_ids = (
        (
            await session.execute(
                select(ImportItem.id).where(
                    ImportItem.import_job_id == import_job_id,
                    ImportItem.state == ImportItemState.QUEUED,
                )
            )
        )
        .scalars()
        .all()
    )

    # import_job_id (the plain UUID parameter) is used below instead of
    # import_job.id: a sibling item's rejection mid-loop rolls back and expires
    # every ORM object in the session, including import_job, so re-reading its
    # attribute later in the loop would hit the same expired-attribute trap.
    for item_id in item_ids:
        # Re-fetched fresh on every iteration, not reused from a batch query taken
        # before the loop: a sibling item's rejection mid-loop rolls back and
        # expires every ORM object in the session, and touching an expired
        # attribute outside an awaited call isn't legal on an async session.
        item = await session.get(ImportItem, item_id)
        try:
            await _advance_item(
                scope,
                session,
                item,
                authority=authority,
                fixtures_dir=fixtures_dir,
                staging=staging,
                slug_prefix=f"import-{import_job_id.hex[:12]}",
            )
            await session.commit()
        except _ItemRejected as exc:
            # reached_state (tagged by _advance_item) reflects how far this attempt
            # got before raising. rollback discards that flush-only progress from
            # the DB (it was never committed), regressing the row to its last
            # durable checkpoint (QUEUED) -- and may have already expired `item`
            # even before we get here, if catalog.stage_artifact_version rolled
            # back internally on a duplicate-hash conflict. The transition must be
            # validated against the *attempted* state, not the post-rollback one,
            # or a legitimate FETCHING/PARSING -> REJECTED rejection looks like an
            # illegal QUEUED -> REJECTED jump.
            attempted_state = exc.reached_state
            await session.rollback()
            reloaded = await session.get(ImportItem, item_id)
            assert_import_item_transition(attempted_state, ImportItemState.REJECTED)
            reloaded.state = ImportItemState.REJECTED
            reloaded.failure_code = exc.failure_code
            await session.commit()
        except Exception as exc:  # transient: bounded item-level retry, never a batch rollback
            attempted_state = getattr(exc, "reached_state", ImportItemState.FETCHING)
            await session.rollback()
            reloaded = await session.get(ImportItem, item_id)
            reloaded.attempts += 1
            target = (
                ImportItemState.DEAD
                if reloaded.attempts >= reloaded.max_attempts
                else ImportItemState.RETRY_WAIT
            )
            assert_import_item_transition(attempted_state, target)
            reloaded.state = target
            reloaded.failure_code = "transient_error"
            await session.commit()

    return await _finalize_import_job(session, import_job_id)


async def _finalize_import_job(session: AsyncSession, import_job_id: uuid.UUID) -> ImportJob:
    import_job = await _get_import_job(session, import_job_id)
    rows = (
        (
            await session.execute(
                select(ImportItem.state).where(ImportItem.import_job_id == import_job_id)
            )
        )
        .scalars()
        .all()
    )

    staged = sum(1 for state in rows if state == ImportItemState.STAGED)
    rejected = sum(1 for state in rows if state == ImportItemState.REJECTED)
    dead = sum(1 for state in rows if state == ImportItemState.DEAD)
    non_terminal = sum(1 for state in rows if state not in TERMINAL_ITEM_STATES)

    import_job.accepted_count = staged
    import_job.rejected_count = rejected
    import_job.dead_count = dead
    if non_terminal:
        import_job.status = ImportJobStatus.RUNNING
    elif rejected or dead:
        import_job.status = ImportJobStatus.COMPLETED_WITH_REJECTIONS
    else:
        import_job.status = ImportJobStatus.COMPLETED
    await session.commit()
    return import_job
