"""Build an immutable, bounded metadata snapshot from GitHub REST responses."""

from __future__ import annotations

import base64
import binascii
import dataclasses
import hashlib
import json
import re
from typing import Any

from .github_client import GitHubRestClient
from .github_coordinates import (
    GITHUB_API_VERSION,
    GitHubManifestError,
    GitHubRepositoryCoordinate,
    GitHubTreeEntry,
    select_metadata_entries,
)


class GitHubSnapshotError(RuntimeError):
    """GitHub returned an internally inconsistent or unsupported snapshot."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = False


@dataclasses.dataclass(frozen=True)
class GitHubMetadataFile:
    path: str
    mode: str
    blob_sha: str
    size: int
    content_sha256: str
    content: bytes = dataclasses.field(repr=False)


@dataclasses.dataclass(frozen=True)
class GitHubRepositorySnapshot:
    api_version: str
    repository_id: int
    repository_node_id: str
    full_name: str
    canonical_repository_url: str
    requested_ref: str | None
    default_branch: str
    archived: bool
    disabled: bool
    commit_sha: str
    tree_sha: str
    tree_entry_count: int
    tree_manifest_sha256: str
    selected_metadata_bytes: int
    skipped_oversized_paths: tuple[str, ...]
    metadata_files: tuple[GitHubMetadataFile, ...]
    metadata_manifest_sha256: str

    def audit_manifest(self) -> dict[str, Any]:
        """Serializable evidence without embedding raw third-party file bytes."""

        return {
            "api_version": self.api_version,
            "repository_id": self.repository_id,
            "repository_node_id": self.repository_node_id,
            "full_name": self.full_name,
            "canonical_repository_url": self.canonical_repository_url,
            "requested_ref": self.requested_ref,
            "default_branch": self.default_branch,
            "archived": self.archived,
            "disabled": self.disabled,
            "commit_sha": self.commit_sha,
            "tree_sha": self.tree_sha,
            "tree_entry_count": self.tree_entry_count,
            "tree_manifest_sha256": self.tree_manifest_sha256,
            "selected_metadata_bytes": self.selected_metadata_bytes,
            "skipped_oversized_paths": list(self.skipped_oversized_paths),
            "metadata_files": [
                {
                    "path": item.path,
                    "mode": item.mode,
                    "blob_sha": item.blob_sha,
                    "size": item.size,
                    "content_sha256": item.content_sha256,
                }
                for item in self.metadata_files
            ],
            "metadata_manifest_sha256": self.metadata_manifest_sha256,
        }


async def build_github_metadata_snapshot(
    client: GitHubRestClient,
    coordinate: GitHubRepositoryCoordinate,
) -> GitHubRepositorySnapshot:
    repository = (await client.get_repository(coordinate)).body
    identity = _repository_identity(repository, coordinate)

    commit = (await client.get_commit(coordinate)).body
    commit_sha = _required_digest(commit, "sha")
    commit_data = _required_object(commit, "commit")
    tree_data = _required_object(commit_data, "tree")
    tree_sha = _required_digest(tree_data, "sha")

    tree_response = (await client.get_tree(coordinate, tree_sha)).body
    if _required_digest(tree_response, "sha") != tree_sha:
        raise GitHubSnapshotError("tree_identity_mismatch")
    tree_entries = _tree_entries(tree_response)
    try:
        selection = select_metadata_entries(
            tree_entries,
            tree_truncated=_required_bool(tree_response, "truncated"),
        )
    except GitHubManifestError as exc:
        raise GitHubSnapshotError("invalid_or_unbounded_tree") from exc
    tree_manifest_sha256 = _tree_manifest_digest(tree_entries)

    metadata_files = []
    for entry in selection.entries:
        blob = (await client.get_blob(coordinate, entry.sha)).body
        metadata_files.append(_metadata_file(entry, blob))
    files = tuple(metadata_files)

    metadata_manifest_sha256 = _canonical_sha256(
        [
            {
                "path": item.path,
                "mode": item.mode,
                "blob_sha": item.blob_sha,
                "size": item.size,
                "content_sha256": item.content_sha256,
            }
            for item in files
        ]
    )

    return GitHubRepositorySnapshot(
        api_version=GITHUB_API_VERSION,
        repository_id=identity["repository_id"],
        repository_node_id=identity["repository_node_id"],
        full_name=identity["full_name"],
        canonical_repository_url=identity["canonical_repository_url"],
        requested_ref=coordinate.requested_ref,
        default_branch=identity["default_branch"],
        archived=identity["archived"],
        disabled=identity["disabled"],
        commit_sha=commit_sha,
        tree_sha=tree_sha,
        tree_entry_count=len(tree_entries),
        tree_manifest_sha256=tree_manifest_sha256,
        selected_metadata_bytes=selection.selected_bytes,
        skipped_oversized_paths=selection.skipped_oversized_paths,
        metadata_files=files,
        metadata_manifest_sha256=metadata_manifest_sha256,
    )


def _repository_identity(
    body: dict[str, Any],
    coordinate: GitHubRepositoryCoordinate,
) -> dict[str, Any]:
    if _required_bool(body, "private"):
        raise GitHubSnapshotError("private_repository")
    repository_id = _required_positive_int(body, "id")
    node_id = _required_nonempty_string(body, "node_id")
    full_name = _required_nonempty_string(body, "full_name")
    expected_name = f"{coordinate.owner}/{coordinate.repository}"
    if full_name.casefold() != expected_name.casefold():
        raise GitHubSnapshotError("repository_identity_mismatch")
    html_url = _required_nonempty_string(body, "html_url")
    if html_url.rstrip("/").removesuffix(".git").casefold() != coordinate.canonical_url.casefold():
        raise GitHubSnapshotError("repository_url_mismatch")
    return {
        "repository_id": repository_id,
        "repository_node_id": node_id,
        "full_name": full_name,
        "canonical_repository_url": f"https://github.com/{full_name}",
        "default_branch": _required_nonempty_string(body, "default_branch"),
        "archived": _required_bool(body, "archived"),
        "disabled": _required_bool(body, "disabled"),
    }


def _tree_entries(body: dict[str, Any]) -> tuple[GitHubTreeEntry, ...]:
    raw_entries = body.get("tree")
    if not isinstance(raw_entries, list):
        raise GitHubSnapshotError("invalid_tree_response")
    entries = []
    for raw in raw_entries:
        if not isinstance(raw, dict):
            raise GitHubSnapshotError("invalid_tree_response")
        size = raw.get("size")
        if size is not None and (not isinstance(size, int) or isinstance(size, bool)):
            raise GitHubSnapshotError("invalid_tree_response")
        entries.append(
            GitHubTreeEntry(
                path=_required_nonempty_string(raw, "path"),
                mode=_required_nonempty_string(raw, "mode"),
                object_type=_required_nonempty_string(raw, "type"),
                size=size,
                sha=_required_digest(raw, "sha"),
            )
        )
    return tuple(entries)


def _metadata_file(entry: GitHubTreeEntry, body: dict[str, Any]) -> GitHubMetadataFile:
    if _required_digest(body, "sha") != entry.sha:
        raise GitHubSnapshotError("blob_identity_mismatch")
    if _required_nonempty_string(body, "encoding") != "base64":
        raise GitHubSnapshotError("unsupported_blob_encoding")
    content = _required_nonempty_string(body, "content")
    try:
        compact = "".join(content.split()).encode("ascii")
        decoded = base64.b64decode(compact, validate=True)
    except (UnicodeEncodeError, binascii.Error) as exc:
        raise GitHubSnapshotError("malformed_blob_content") from exc

    reported_size = _required_nonnegative_int(body, "size")
    if reported_size != len(decoded) or entry.size != len(decoded):
        raise GitHubSnapshotError("blob_size_mismatch")
    if _git_object_digest(decoded, entry.sha) != entry.sha:
        raise GitHubSnapshotError("blob_content_digest_mismatch")
    return GitHubMetadataFile(
        path=entry.path,
        mode=entry.mode,
        blob_sha=entry.sha,
        size=len(decoded),
        content_sha256=hashlib.sha256(decoded).hexdigest(),
        content=decoded,
    )


def _tree_manifest_digest(entries: tuple[GitHubTreeEntry, ...]) -> str:
    return _canonical_sha256(
        [
            {
                "path": entry.path,
                "mode": entry.mode,
                "type": entry.object_type,
                "size": entry.size,
                "sha": entry.sha,
            }
            for entry in sorted(entries, key=lambda item: item.path)
        ]
    )


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _git_object_digest(content: bytes, expected: str) -> str:
    payload = f"blob {len(content)}\0".encode() + content
    algorithm = "sha1" if len(expected) == 40 else "sha256"
    return hashlib.new(algorithm, payload).hexdigest()


def _required_object(body: dict[str, Any], key: str) -> dict[str, Any]:
    value = body.get(key)
    if not isinstance(value, dict):
        raise GitHubSnapshotError("invalid_upstream_response")
    return value


def _required_nonempty_string(body: dict[str, Any], key: str) -> str:
    value = body.get(key)
    if not isinstance(value, str) or not value:
        raise GitHubSnapshotError("invalid_upstream_response")
    return value


def _required_bool(body: dict[str, Any], key: str) -> bool:
    value = body.get(key)
    if not isinstance(value, bool):
        raise GitHubSnapshotError("invalid_upstream_response")
    return value


def _required_positive_int(body: dict[str, Any], key: str) -> int:
    value = body.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise GitHubSnapshotError("invalid_upstream_response")
    return value


def _required_nonnegative_int(body: dict[str, Any], key: str) -> int:
    value = body.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise GitHubSnapshotError("invalid_upstream_response")
    return value


def _required_digest(body: dict[str, Any], key: str) -> str:
    value = _required_nonempty_string(body, key)
    if not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", value):
        raise GitHubSnapshotError("invalid_upstream_digest")
    return value
