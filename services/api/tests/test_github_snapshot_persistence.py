"""DB-free integrity tests for the Phase 7 S4 persistence boundary."""

import dataclasses
import hashlib
import json

import pytest

from majorana_api.github_coordinates import GITHUB_API_VERSION
from majorana_api.github_snapshot import GitHubMetadataFile, GitHubRepositorySnapshot
from majorana_api.repos import github_import


def _snapshot() -> GitHubRepositorySnapshot:
    content = b"[project]\nname='atlas'\n"
    content_sha = hashlib.sha256(content).hexdigest()
    payload = f"blob {len(content)}\0".encode() + content
    metadata_file = GitHubMetadataFile(
        path="pyproject.toml",
        mode="100644",
        blob_sha=hashlib.sha1(payload).hexdigest(),
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
    manifest_sha = hashlib.sha256(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return GitHubRepositorySnapshot(
        api_version=GITHUB_API_VERSION,
        repository_id=1,
        repository_node_id="R_1",
        full_name="atlas/test",
        canonical_repository_url="https://github.com/atlas/test",
        requested_ref="main",
        default_branch="main",
        archived=False,
        disabled=False,
        commit_sha="a" * 40,
        tree_sha="b" * 40,
        tree_entry_count=1,
        tree_manifest_sha256="c" * 64,
        selected_metadata_bytes=len(content),
        skipped_oversized_paths=(),
        metadata_files=(metadata_file,),
        metadata_manifest_sha256=manifest_sha,
    )


def test_persistence_boundary_rejects_mutated_bytes() -> None:
    snapshot = _snapshot()
    corrupted_file = dataclasses.replace(
        snapshot.metadata_files[0],
        content=b"[project]\nname='tampered'\n",
    )
    corrupted = dataclasses.replace(snapshot, metadata_files=(corrupted_file,))

    with pytest.raises(
        github_import.GitHubSnapshotPersistenceError,
        match="metadata_size_mismatch|metadata_content_digest_mismatch",
    ):
        github_import._validate_snapshot(corrupted)


def test_persistence_boundary_rejects_manifest_digest_drift() -> None:
    snapshot = dataclasses.replace(_snapshot(), metadata_manifest_sha256="f" * 64)

    with pytest.raises(
        github_import.GitHubSnapshotPersistenceError,
        match="metadata_manifest_digest_mismatch",
    ):
        github_import._validate_snapshot(snapshot)


def test_source_identity_excludes_mutable_requested_ref() -> None:
    snapshot = _snapshot()
    changed_ref = dataclasses.replace(snapshot, requested_ref="paper/revision")

    assert github_import._source_identity(
        snapshot,
        importer_policy_version="github-metadata-v1",
    ) == github_import._source_identity(
        changed_ref,
        importer_policy_version="github-metadata-v1",
    )
    assert github_import._request_descriptor(
        snapshot,
        importer_policy_version="github-metadata-v1",
    ) != github_import._request_descriptor(
        changed_ref,
        importer_policy_version="github-metadata-v1",
    )
