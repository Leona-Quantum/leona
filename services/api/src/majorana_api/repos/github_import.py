"""Durable private persistence for Phase 7 bounded GitHub snapshots.

This repository module stores source evidence only.  It cannot create or
publish an Artifact, Component Definition, implementation badge, or scientific
claim.  Request replay identity and immutable source identity are deliberately
separate, following the same boundary used by VQE experiments.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
import uuid
from typing import Any

from majorana_contracts import Scope
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..catalog_authority import CatalogAuthority
from ..github_coordinates import (
    MAX_METADATA_FILES,
    MAX_METADATA_FILE_BYTES,
    MAX_METADATA_TOTAL_BYTES,
)
from ..github_snapshot import (
    GitHubMetadataFile,
    GitHubRepositorySnapshot,
)
from ..ids import uuid7
from ..orm import (
    GitHubRepositorySnapshotFileRow,
    GitHubRepositorySnapshotRow,
    GitHubSnapshotImportRequestRow,
)
from . import catalog
from ._base import NotFoundError, RepoError

_POLICY_VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


class GitHubSnapshotPersistenceError(RepoError):
    """The supplied snapshot is malformed or conflicts with durable evidence."""


class GitHubSnapshotIdempotencyConflictError(RepoError):
    """One request key was reused for a different immutable source request."""


@dataclasses.dataclass(frozen=True)
class PersistedGitHubSnapshot:
    snapshot_id: uuid.UUID
    request_id: uuid.UUID
    source_identity: str
    replayed_request: bool


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value)).hexdigest()


def _metadata_manifest(files: tuple[GitHubMetadataFile, ...]) -> list[dict[str, Any]]:
    return [
        {
            "path": item.path,
            "mode": item.mode,
            "blob_sha": item.blob_sha,
            "size": item.size,
            "content_sha256": item.content_sha256,
        }
        for item in files
    ]


def _validate_snapshot(snapshot: GitHubRepositorySnapshot) -> None:
    """Re-check persistence invariants instead of trusting a constructed dataclass."""

    files = snapshot.metadata_files
    if len(files) > MAX_METADATA_FILES:
        raise GitHubSnapshotPersistenceError("metadata_file_count_exceeded")
    if snapshot.selected_metadata_bytes > MAX_METADATA_TOTAL_BYTES:
        raise GitHubSnapshotPersistenceError("metadata_total_bytes_exceeded")

    seen_paths: set[str] = set()
    total = 0
    for item in files:
        if item.path in seen_paths:
            raise GitHubSnapshotPersistenceError("duplicate_metadata_path")
        seen_paths.add(item.path)
        if item.mode not in {"100644", "100755"}:
            raise GitHubSnapshotPersistenceError("unsupported_metadata_mode")
        if item.size != len(item.content):
            raise GitHubSnapshotPersistenceError("metadata_size_mismatch")
        if item.size > MAX_METADATA_FILE_BYTES:
            raise GitHubSnapshotPersistenceError("metadata_file_bytes_exceeded")
        if hashlib.sha256(item.content).hexdigest() != item.content_sha256:
            raise GitHubSnapshotPersistenceError("metadata_content_digest_mismatch")
        total += item.size

    if total != snapshot.selected_metadata_bytes:
        raise GitHubSnapshotPersistenceError("metadata_total_mismatch")
    if _sha256_json(_metadata_manifest(files)) != snapshot.metadata_manifest_sha256:
        raise GitHubSnapshotPersistenceError("metadata_manifest_digest_mismatch")


def _request_descriptor(
    snapshot: GitHubRepositorySnapshot,
    *,
    importer_policy_version: str,
) -> dict[str, Any]:
    return {
        "provider": "github_metadata",
        "api_version": snapshot.api_version,
        "repository_id": snapshot.repository_id,
        "repository_url": snapshot.canonical_repository_url,
        "requested_ref": snapshot.requested_ref,
        "resolved_commit_sha": snapshot.commit_sha,
        "importer_policy_version": importer_policy_version,
        "metadata_manifest_sha256": snapshot.metadata_manifest_sha256,
    }


def _source_identity(
    snapshot: GitHubRepositorySnapshot,
    *,
    importer_policy_version: str,
) -> str:
    return f"github:{snapshot.repository_id}:{snapshot.commit_sha}:{importer_policy_version}"


async def _find_snapshot(
    session: AsyncSession,
    *,
    repository_id: int,
    commit_sha: str,
    importer_policy_version: str,
) -> GitHubRepositorySnapshotRow | None:
    return (
        (
            await session.execute(
                select(GitHubRepositorySnapshotRow).where(
                    GitHubRepositorySnapshotRow.repository_id == repository_id,
                    GitHubRepositorySnapshotRow.commit_sha == commit_sha,
                    GitHubRepositorySnapshotRow.importer_policy_version == importer_policy_version,
                )
            )
        )
        .scalars()
        .first()
    )


async def _find_request(
    session: AsyncSession,
    *,
    idempotency_key: str,
) -> GitHubSnapshotImportRequestRow | None:
    return (
        (
            await session.execute(
                select(GitHubSnapshotImportRequestRow).where(
                    GitHubSnapshotImportRequestRow.idempotency_key == idempotency_key
                )
            )
        )
        .scalars()
        .first()
    )


def _assert_existing_snapshot_matches(
    existing: GitHubRepositorySnapshotRow,
    snapshot: GitHubRepositorySnapshot,
) -> None:
    """Same immutable source identity must not resolve to different content."""

    expected = {
        "repository_node_id": snapshot.repository_node_id,
        "tree_sha": snapshot.tree_sha,
        "tree_entry_count": snapshot.tree_entry_count,
        "tree_manifest_sha256": snapshot.tree_manifest_sha256,
        "selected_metadata_bytes": snapshot.selected_metadata_bytes,
        "metadata_manifest_sha256": snapshot.metadata_manifest_sha256,
        "api_version": snapshot.api_version,
    }
    observed = {key: getattr(existing, key) for key in expected}
    if observed != expected:
        raise GitHubSnapshotPersistenceError("immutable_snapshot_identity_conflict")


async def persist_github_snapshot(
    scope: Scope,
    session: AsyncSession,
    *,
    authority: CatalogAuthority,
    snapshot: GitHubRepositorySnapshot,
    importer_policy_version: str,
    idempotency_key: str,
) -> PersistedGitHubSnapshot:
    """Persist one bounded snapshot and one immutable request binding.

    The caller owns commit/rollback. PostgreSQL ``ON CONFLICT`` handles races
    without rolling back unrelated work in the session. Replays return the
    original request/snapshot pair only when the complete descriptor matches.
    """

    await catalog.get_importer_workspace(scope, session, authority=authority)
    if not _POLICY_VERSION_RE.fullmatch(importer_policy_version):
        raise GitHubSnapshotPersistenceError("invalid_importer_policy_version")
    if not 1 <= len(idempotency_key) <= 255:
        raise GitHubSnapshotPersistenceError("invalid_idempotency_key")
    _validate_snapshot(snapshot)

    descriptor = _request_descriptor(
        snapshot,
        importer_policy_version=importer_policy_version,
    )
    descriptor_sha256 = _sha256_json(descriptor)
    existing_request = await _find_request(session, idempotency_key=idempotency_key)
    if existing_request is not None:
        if (
            existing_request.request_descriptor_sha256 != descriptor_sha256
            or existing_request.request_descriptor_json != descriptor
        ):
            raise GitHubSnapshotIdempotencyConflictError(
                "idempotency key was already used for a different GitHub snapshot request"
            )
        return PersistedGitHubSnapshot(
            snapshot_id=existing_request.snapshot_id,
            request_id=existing_request.id,
            source_identity=_source_identity(
                snapshot,
                importer_policy_version=importer_policy_version,
            ),
            replayed_request=True,
        )

    candidate_snapshot_id = uuid7()
    await session.execute(
        pg_insert(GitHubRepositorySnapshotRow)
        .values(
            id=candidate_snapshot_id,
            repository_id=snapshot.repository_id,
            repository_node_id=snapshot.repository_node_id,
            full_name=snapshot.full_name,
            canonical_repository_url=snapshot.canonical_repository_url,
            requested_ref=snapshot.requested_ref,
            default_branch=snapshot.default_branch,
            archived=snapshot.archived,
            disabled=snapshot.disabled,
            api_version=snapshot.api_version,
            commit_sha=snapshot.commit_sha,
            tree_sha=snapshot.tree_sha,
            tree_entry_count=snapshot.tree_entry_count,
            tree_manifest_sha256=snapshot.tree_manifest_sha256,
            selected_metadata_bytes=snapshot.selected_metadata_bytes,
            metadata_manifest_sha256=snapshot.metadata_manifest_sha256,
            skipped_oversized_paths=list(snapshot.skipped_oversized_paths),
            importer_policy_version=importer_policy_version,
            audit_manifest_json=snapshot.audit_manifest(),
        )
        .on_conflict_do_nothing(
            index_elements=["repository_id", "commit_sha", "importer_policy_version"]
        )
    )
    persisted_snapshot = await _find_snapshot(
        session,
        repository_id=snapshot.repository_id,
        commit_sha=snapshot.commit_sha,
        importer_policy_version=importer_policy_version,
    )
    if persisted_snapshot is None:
        raise GitHubSnapshotPersistenceError("snapshot_insert_not_observable")
    _assert_existing_snapshot_matches(persisted_snapshot, snapshot)

    for item in snapshot.metadata_files:
        await session.execute(
            pg_insert(GitHubRepositorySnapshotFileRow)
            .values(
                id=uuid7(),
                snapshot_id=persisted_snapshot.id,
                path=item.path,
                mode=item.mode,
                blob_sha=item.blob_sha,
                size=item.size,
                content_sha256=item.content_sha256,
                content=item.content,
            )
            .on_conflict_do_nothing(index_elements=["snapshot_id", "path"])
        )

    persisted_files = (
        (
            await session.execute(
                select(GitHubRepositorySnapshotFileRow).where(
                    GitHubRepositorySnapshotFileRow.snapshot_id == persisted_snapshot.id
                )
            )
        )
        .scalars()
        .all()
    )
    by_path = {item.path: item for item in persisted_files}
    if set(by_path) != {item.path for item in snapshot.metadata_files}:
        raise GitHubSnapshotPersistenceError("persisted_metadata_file_set_mismatch")
    for item in snapshot.metadata_files:
        stored = by_path[item.path]
        if (
            stored.mode != item.mode
            or stored.blob_sha != item.blob_sha
            or stored.size != item.size
            or stored.content_sha256 != item.content_sha256
            or stored.content != item.content
        ):
            raise GitHubSnapshotPersistenceError("persisted_metadata_file_conflict")

    request_id = uuid7()
    await session.execute(
        pg_insert(GitHubSnapshotImportRequestRow)
        .values(
            id=request_id,
            idempotency_key=idempotency_key,
            snapshot_id=persisted_snapshot.id,
            request_descriptor_json=descriptor,
            request_descriptor_sha256=descriptor_sha256,
        )
        .on_conflict_do_nothing(index_elements=["idempotency_key"])
    )
    persisted_request = await _find_request(session, idempotency_key=idempotency_key)
    if persisted_request is None:
        raise GitHubSnapshotPersistenceError("request_insert_not_observable")
    if (
        persisted_request.snapshot_id != persisted_snapshot.id
        or persisted_request.request_descriptor_sha256 != descriptor_sha256
        or persisted_request.request_descriptor_json != descriptor
    ):
        raise GitHubSnapshotIdempotencyConflictError(
            "idempotency key raced with a different GitHub snapshot request"
        )

    return PersistedGitHubSnapshot(
        snapshot_id=persisted_snapshot.id,
        request_id=persisted_request.id,
        source_identity=_source_identity(
            snapshot,
            importer_policy_version=importer_policy_version,
        ),
        replayed_request=persisted_request.id != request_id,
    )


async def load_github_snapshot(
    scope: Scope,
    session: AsyncSession,
    snapshot_id: uuid.UUID,
    *,
    authority: CatalogAuthority,
) -> GitHubRepositorySnapshot:
    """Reconstruct verified source input for a crash-resumed later slice."""

    await catalog.get_importer_workspace(scope, session, authority=authority)
    row = await session.get(GitHubRepositorySnapshotRow, snapshot_id)
    if row is None:
        raise NotFoundError("GitHub repository snapshot")
    file_rows = (
        (
            await session.execute(
                select(GitHubRepositorySnapshotFileRow)
                .where(GitHubRepositorySnapshotFileRow.snapshot_id == snapshot_id)
                .order_by(GitHubRepositorySnapshotFileRow.path)
            )
        )
        .scalars()
        .all()
    )
    snapshot = GitHubRepositorySnapshot(
        api_version=row.api_version,
        repository_id=row.repository_id,
        repository_node_id=row.repository_node_id,
        full_name=row.full_name,
        canonical_repository_url=row.canonical_repository_url,
        requested_ref=row.requested_ref,
        default_branch=row.default_branch,
        archived=row.archived,
        disabled=row.disabled,
        commit_sha=row.commit_sha,
        tree_sha=row.tree_sha,
        tree_entry_count=row.tree_entry_count,
        tree_manifest_sha256=row.tree_manifest_sha256,
        selected_metadata_bytes=row.selected_metadata_bytes,
        skipped_oversized_paths=tuple(row.skipped_oversized_paths),
        metadata_files=tuple(
            GitHubMetadataFile(
                path=item.path,
                mode=item.mode,
                blob_sha=item.blob_sha,
                size=item.size,
                content_sha256=item.content_sha256,
                content=item.content,
            )
            for item in file_rows
        ),
        metadata_manifest_sha256=row.metadata_manifest_sha256,
    )
    _validate_snapshot(snapshot)
    if snapshot.audit_manifest() != row.audit_manifest_json:
        raise GitHubSnapshotPersistenceError("persisted_audit_manifest_mismatch")
    return snapshot
