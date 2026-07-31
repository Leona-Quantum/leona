"""Live Postgres proof for Phase 7 S4 durable GitHub snapshot persistence.

Skipped without DATABASE_URL. The fixture contains no network response and no
third-party source code; it proves atomic persistence, request idempotency,
immutable-source deduplication, and crash-resumable reconstruction.
"""

import asyncio
import dataclasses
import hashlib
import json
import os
import uuid

import pytest

from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.db import engine_from_env, session_factory
from majorana_api.github_coordinates import GITHUB_API_VERSION
from majorana_api.github_snapshot import GitHubMetadataFile, GitHubRepositorySnapshot
from majorana_api.repos import github_import, system, vqe_source_staging

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="GitHub snapshot persistence needs DATABASE_URL",
)

_STABLE_NAMESPACE = uuid.UUID("6f6f9f7e-9c6a-4b0a-8b8a-8f2e6c9b5a11")


def _canonical_sha(value) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def _git_blob_sha(content: bytes) -> str:
    payload = f"blob {len(content)}\0".encode() + content
    return hashlib.sha1(payload).hexdigest()


def _snapshot(
    *,
    full_name: str | None = None,
    canonical_repository_url: str | None = None,
) -> GitHubRepositorySnapshot:
    marker = uuid.uuid4().hex
    content = f"[project]\nname = 'phase7-{marker}'\n".encode()
    content_sha = hashlib.sha256(content).hexdigest()
    metadata_file = GitHubMetadataFile(
        path="pyproject.toml",
        mode="100644",
        blob_sha=_git_blob_sha(content),
        size=len(content),
        content_sha256=content_sha,
        content=content,
    )
    manifest = [
        {
            "path": metadata_file.path,
            "mode": metadata_file.mode,
            "blob_sha": metadata_file.blob_sha,
            "size": metadata_file.size,
            "content_sha256": metadata_file.content_sha256,
        }
    ]
    repository_id = int(marker[:15], 16)
    commit_sha = hashlib.sha1(f"commit:{marker}".encode()).hexdigest()
    tree_sha = hashlib.sha1(f"tree:{marker}".encode()).hexdigest()
    return GitHubRepositorySnapshot(
        api_version=GITHUB_API_VERSION,
        repository_id=repository_id,
        repository_node_id=f"R_{marker}",
        full_name=full_name or f"atlas-test/phase7-{marker}",
        canonical_repository_url=(
            canonical_repository_url or f"https://github.com/atlas-test/phase7-{marker}"
        ),
        requested_ref="main",
        default_branch="main",
        archived=False,
        disabled=False,
        commit_sha=commit_sha,
        tree_sha=tree_sha,
        tree_entry_count=1,
        tree_manifest_sha256=hashlib.sha256(f"tree-manifest:{marker}".encode()).hexdigest(),
        selected_metadata_bytes=len(content),
        skipped_oversized_paths=(),
        metadata_files=(metadata_file,),
        metadata_manifest_sha256=_canonical_sha(manifest),
    )


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


@requires_db
async def test_snapshot_is_durable_reconstructable_and_request_idempotent(env):
    authority, factory = env
    scope = authority.importer_scope()
    snapshot = _snapshot()
    key = f"phase7-{uuid.uuid4()}"

    async with factory() as session:
        first = await github_import.persist_github_snapshot(
            scope,
            session,
            authority=authority,
            snapshot=snapshot,
            importer_policy_version="github-metadata-v1",
            idempotency_key=key,
        )
        await session.commit()

    async with factory() as session:
        replay = await github_import.persist_github_snapshot(
            scope,
            session,
            authority=authority,
            snapshot=snapshot,
            importer_policy_version="github-metadata-v1",
            idempotency_key=key,
        )
        loaded = await github_import.load_github_snapshot(
            scope,
            session,
            first.snapshot_id,
            authority=authority,
        )

    assert replay.replayed_request is True
    assert replay.snapshot_id == first.snapshot_id
    assert replay.request_id == first.request_id
    assert loaded.audit_manifest() == snapshot.audit_manifest()
    assert loaded.metadata_files[0].content == snapshot.metadata_files[0].content


@requires_db
async def test_same_source_deduplicates_but_different_request_key_is_recorded(env):
    authority, factory = env
    scope = authority.importer_scope()
    snapshot = _snapshot()

    async with factory() as session:
        first = await github_import.persist_github_snapshot(
            scope,
            session,
            authority=authority,
            snapshot=snapshot,
            importer_policy_version="github-metadata-v1",
            idempotency_key=f"phase7-{uuid.uuid4()}",
        )
        await session.commit()
    async with factory() as session:
        second = await github_import.persist_github_snapshot(
            scope,
            session,
            authority=authority,
            snapshot=snapshot,
            importer_policy_version="github-metadata-v1",
            idempotency_key=f"phase7-{uuid.uuid4()}",
        )
        await session.commit()

    assert second.snapshot_id == first.snapshot_id
    assert second.request_id != first.request_id
    assert second.replayed_request is False


@requires_db
async def test_reused_request_key_for_different_descriptor_fails_closed(env):
    authority, factory = env
    scope = authority.importer_scope()
    snapshot = _snapshot()
    key = f"phase7-{uuid.uuid4()}"

    async with factory() as session:
        await github_import.persist_github_snapshot(
            scope,
            session,
            authority=authority,
            snapshot=snapshot,
            importer_policy_version="github-metadata-v1",
            idempotency_key=key,
        )
        await session.commit()

    changed_request = dataclasses.replace(snapshot, requested_ref="paper/revision")
    async with factory() as session:
        with pytest.raises(github_import.GitHubSnapshotIdempotencyConflictError):
            await github_import.persist_github_snapshot(
                scope,
                session,
                authority=authority,
                snapshot=changed_request,
                importer_policy_version="github-metadata-v1",
                idempotency_key=key,
            )


@requires_db
async def test_standard_source_evidence_stages_without_publication(env):
    authority, factory = env
    scope = authority.importer_scope()
    snapshot = _snapshot(
        full_name="qiskit-community/qiskit-nature",
        canonical_repository_url="https://github.com/qiskit-community/qiskit-nature",
    )

    async with factory() as session:
        persisted = await github_import.persist_github_snapshot(
            scope,
            session,
            authority=authority,
            snapshot=snapshot,
            importer_policy_version="github-metadata-v1",
            idempotency_key=f"phase7-source-{uuid.uuid4()}",
        )
        first = await vqe_source_staging.stage_standard_vqe_source_evidence(
            scope,
            session,
            persisted.snapshot_id,
            authority=authority,
            source_key="qiskit-nature",
        )
        await session.commit()

    async with factory() as session:
        replay = await vqe_source_staging.stage_standard_vqe_source_evidence(
            scope,
            session,
            persisted.snapshot_id,
            authority=authority,
            source_key="qiskit-nature",
        )

    assert len(first.assertion_ids) == 5
    assert replay.assertion_ids == first.assertion_ids
    assert replay.candidate_id == first.candidate_id
    assert replay.replayed_assertions == 5
    assert replay.replayed_candidate is True
