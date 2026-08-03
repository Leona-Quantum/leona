"""Pure, fail-closed evidence contract for Phase 10 selected-file retrieval.

This module performs no network, database, filesystem, parsing, import, or
execution operation. It only turns already retrieved UTF-8 source bytes into a
bounded, content-addressed manifest and verifies later bytes against it. Live
Phase 10 acquisition remains disabled until separate controls are qualified.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
import unicodedata
from datetime import UTC, datetime
from typing import Any

RETRIEVAL_MANIFEST_SCHEMA_VERSION = 1
RETRIEVAL_SOURCE_KIND = "github_selected_files"
RETRIEVAL_SOURCE_HOST = "api.github.com"
RETRIEVAL_FETCHER_VERSION = "phase10-acquisition-contract/1"
RETRIEVAL_POLICY_VERSION = "phase10-s2-selected-text/1"

MAX_SELECTED_FILES = 64
MAX_SELECTED_PATH_LENGTH = 512
MAX_SELECTED_FILE_BYTES = 256 * 1024
MAX_SELECTED_TOTAL_BYTES = 2 * 1024 * 1024
MAX_REPOSITORY_OWNER_LENGTH = 39
MAX_REPOSITORY_NAME_LENGTH = 100

_COMMIT_RE = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
_SHA256_RE = re.compile(r"[0-9a-f]{64}")
_FULL_NAME_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?/[A-Za-z0-9_.-]+")
_VERSION_RE = re.compile(r"[a-z0-9][a-z0-9._/-]{0,127}")
_MEDIA_TYPE_RE = re.compile(r"(?:application|text)/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")

ALLOWED_TEXT_MEDIA_TYPES = frozenset(
    {
        "application/json",
        "application/toml",
        "application/x-yaml",
        "application/xml",
        "application/yaml",
        "text/javascript",
        "text/markdown",
        "text/plain",
        "text/typescript",
        "text/x-c",
        "text/x-c++",
        "text/x-java-source",
        "text/x-python",
        "text/x-rst",
    }
)


class Phase10RetrievalManifestError(ValueError):
    """A retrieval record is unsafe, unsupported, or integrity-invalid."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = False


@dataclasses.dataclass(frozen=True)
class RetrievedFileEvidence:
    """Integrity evidence for one selected file, without retaining its bytes."""

    selected_path: str
    media_type: str
    length: int
    sha256: str

    @classmethod
    def from_bytes(
        cls,
        *,
        selected_path: str,
        media_type: str,
        content: bytes,
    ) -> RetrievedFileEvidence:
        _validate_selected_path(selected_path)
        _validate_media_type(media_type)
        _validate_source_bytes(content)
        return cls(
            selected_path=selected_path,
            media_type=media_type,
            length=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
        )

    def verify_bytes(self, content: bytes) -> None:
        """Fail closed if later quarantine bytes differ from fetched bytes."""

        _validate_file_evidence(self)
        _validate_source_bytes(content)
        if len(content) != self.length:
            raise Phase10RetrievalManifestError("retrieval_length_mismatch")
        if hashlib.sha256(content).hexdigest() != self.sha256:
            raise Phase10RetrievalManifestError("retrieval_digest_mismatch")

    def descriptor(self) -> dict[str, str | int]:
        return {
            "selected_path": self.selected_path,
            "media_type": self.media_type,
            "length": self.length,
            "sha256": self.sha256,
        }


@dataclasses.dataclass(frozen=True)
class Phase10RetrievalManifest:
    """Canonical evidence for one immutable, bounded selected-file retrieval."""

    repository_id: int
    full_name: str
    immutable_ref: str
    fetched_at: str
    files: tuple[RetrievedFileEvidence, ...]
    fetcher_version: str = RETRIEVAL_FETCHER_VERSION
    policy_version: str = RETRIEVAL_POLICY_VERSION

    def __post_init__(self) -> None:
        _validate_manifest_fields(self)

    @property
    def selected_total_bytes(self) -> int:
        return sum(item.length for item in self.files)

    def body(self) -> dict[str, Any]:
        return {
            "manifest_schema_version": RETRIEVAL_MANIFEST_SCHEMA_VERSION,
            "source_kind": RETRIEVAL_SOURCE_KIND,
            "source_host": RETRIEVAL_SOURCE_HOST,
            "repository_id": self.repository_id,
            "full_name": self.full_name,
            "immutable_ref": self.immutable_ref,
            "fetched_at": self.fetched_at,
            "fetcher_version": self.fetcher_version,
            "policy_version": self.policy_version,
            "selected_file_count": len(self.files),
            "selected_total_bytes": self.selected_total_bytes,
            "files": [item.descriptor() for item in self.files],
        }

    @property
    def manifest_sha256(self) -> str:
        return _canonical_sha256(self.body())

    def to_manifest(self) -> dict[str, Any]:
        return {**self.body(), "manifest_sha256": self.manifest_sha256}

    def file(self, selected_path: str) -> RetrievedFileEvidence:
        for item in self.files:
            if item.selected_path == selected_path:
                return item
        raise Phase10RetrievalManifestError("retrieval_path_not_in_manifest")

    @classmethod
    def from_manifest(cls, payload: dict[str, Any]) -> Phase10RetrievalManifest:
        if not isinstance(payload, dict):
            raise Phase10RetrievalManifestError("invalid_retrieval_manifest")
        expected_keys = {
            "manifest_schema_version",
            "source_kind",
            "source_host",
            "repository_id",
            "full_name",
            "immutable_ref",
            "fetched_at",
            "fetcher_version",
            "policy_version",
            "selected_file_count",
            "selected_total_bytes",
            "files",
            "manifest_sha256",
        }
        if set(payload) != expected_keys:
            raise Phase10RetrievalManifestError("invalid_retrieval_manifest")
        if payload["manifest_schema_version"] != RETRIEVAL_MANIFEST_SCHEMA_VERSION:
            raise Phase10RetrievalManifestError("unsupported_retrieval_manifest_version")
        if payload["source_kind"] != RETRIEVAL_SOURCE_KIND:
            raise Phase10RetrievalManifestError("unsupported_retrieval_source_kind")
        if payload["source_host"] != RETRIEVAL_SOURCE_HOST:
            raise Phase10RetrievalManifestError("retrieval_source_host_mismatch")
        raw_files = payload["files"]
        if not isinstance(raw_files, list):
            raise Phase10RetrievalManifestError("invalid_retrieval_manifest")
        files = tuple(_file_from_descriptor(item) for item in raw_files)
        manifest = cls(
            repository_id=payload["repository_id"],
            full_name=payload["full_name"],
            immutable_ref=payload["immutable_ref"],
            fetched_at=payload["fetched_at"],
            files=files,
            fetcher_version=payload["fetcher_version"],
            policy_version=payload["policy_version"],
        )
        if payload["selected_file_count"] != len(files):
            raise Phase10RetrievalManifestError("retrieval_file_count_mismatch")
        if payload["selected_total_bytes"] != manifest.selected_total_bytes:
            raise Phase10RetrievalManifestError("retrieval_total_bytes_mismatch")
        claimed_digest = payload["manifest_sha256"]
        if not isinstance(claimed_digest, str) or not _SHA256_RE.fullmatch(claimed_digest):
            raise Phase10RetrievalManifestError("invalid_retrieval_manifest_digest")
        if claimed_digest != manifest.manifest_sha256:
            raise Phase10RetrievalManifestError("retrieval_manifest_digest_mismatch")
        return manifest


def build_phase10_retrieval_manifest(
    *,
    repository_id: int,
    full_name: str,
    immutable_ref: str,
    fetched_at: datetime,
    files: tuple[RetrievedFileEvidence, ...],
) -> Phase10RetrievalManifest:
    """Build a canonical manifest from evidence produced by a future fetcher."""

    return Phase10RetrievalManifest(
        repository_id=repository_id,
        full_name=full_name,
        immutable_ref=immutable_ref,
        fetched_at=_canonical_timestamp(fetched_at),
        files=tuple(sorted(files, key=lambda item: item.selected_path)),
    )


def _file_from_descriptor(value: Any) -> RetrievedFileEvidence:
    if not isinstance(value, dict) or set(value) != {
        "selected_path",
        "media_type",
        "length",
        "sha256",
    }:
        raise Phase10RetrievalManifestError("invalid_retrieval_file_descriptor")
    item = RetrievedFileEvidence(
        selected_path=value["selected_path"],
        media_type=value["media_type"],
        length=value["length"],
        sha256=value["sha256"],
    )
    _validate_file_evidence(item)
    return item


def _validate_manifest_fields(manifest: Phase10RetrievalManifest) -> None:
    validate_phase10_repository_coordinate(
        repository_id=manifest.repository_id,
        full_name=manifest.full_name,
        immutable_ref=manifest.immutable_ref,
    )
    _parse_canonical_timestamp(manifest.fetched_at)
    if manifest.fetcher_version != RETRIEVAL_FETCHER_VERSION:
        raise Phase10RetrievalManifestError("unsupported_retrieval_fetcher_version")
    if manifest.policy_version != RETRIEVAL_POLICY_VERSION:
        raise Phase10RetrievalManifestError("unsupported_retrieval_policy_version")
    if not _VERSION_RE.fullmatch(manifest.fetcher_version) or not _VERSION_RE.fullmatch(
        manifest.policy_version
    ):
        raise Phase10RetrievalManifestError("invalid_retrieval_version")
    if not manifest.files:
        raise Phase10RetrievalManifestError("empty_retrieval_manifest")
    if len(manifest.files) > MAX_SELECTED_FILES:
        raise Phase10RetrievalManifestError("retrieval_file_count_exceeded")
    paths = tuple(item.selected_path for item in manifest.files)
    validate_phase10_selected_paths(paths)
    for item in manifest.files:
        _validate_file_evidence(item)
    if manifest.selected_total_bytes > MAX_SELECTED_TOTAL_BYTES:
        raise Phase10RetrievalManifestError("retrieval_total_bytes_exceeded")


def validate_phase10_repository_coordinate(
    *,
    repository_id: int,
    full_name: str,
    immutable_ref: str,
) -> None:
    """Validate the immutable repository identity shared by request/evidence."""

    if not isinstance(repository_id, int) or isinstance(repository_id, bool) or repository_id <= 0:
        raise Phase10RetrievalManifestError("invalid_retrieval_repository_id")
    if not isinstance(full_name, str) or not _FULL_NAME_RE.fullmatch(full_name):
        raise Phase10RetrievalManifestError("invalid_retrieval_repository_name")
    owner, repository = full_name.split("/", 1)
    if (
        len(owner) > MAX_REPOSITORY_OWNER_LENGTH
        or len(repository) > MAX_REPOSITORY_NAME_LENGTH
        or "--" in owner
        or repository in {".", ".."}
    ):
        raise Phase10RetrievalManifestError("invalid_retrieval_repository_name")
    if not isinstance(immutable_ref, str) or not _COMMIT_RE.fullmatch(immutable_ref):
        raise Phase10RetrievalManifestError("mutable_or_invalid_retrieval_ref")


def validate_phase10_selected_paths(paths: tuple[str, ...]) -> None:
    """Validate a non-empty, canonical selected-path set without source bytes."""

    if not isinstance(paths, tuple):
        raise Phase10RetrievalManifestError("invalid_retrieval_paths")
    if not paths:
        raise Phase10RetrievalManifestError("empty_retrieval_manifest")
    if len(paths) > MAX_SELECTED_FILES:
        raise Phase10RetrievalManifestError("retrieval_file_count_exceeded")
    for path in paths:
        _validate_selected_path(path)
    if paths != tuple(sorted(paths)):
        raise Phase10RetrievalManifestError("noncanonical_retrieval_file_order")
    if len(paths) != len(set(paths)):
        raise Phase10RetrievalManifestError("duplicate_retrieval_path")


def _validate_file_evidence(item: RetrievedFileEvidence) -> None:
    _validate_selected_path(item.selected_path)
    _validate_media_type(item.media_type)
    if (
        not isinstance(item.length, int)
        or isinstance(item.length, bool)
        or item.length < 0
        or item.length > MAX_SELECTED_FILE_BYTES
    ):
        raise Phase10RetrievalManifestError("invalid_retrieval_length")
    if not isinstance(item.sha256, str) or not _SHA256_RE.fullmatch(item.sha256):
        raise Phase10RetrievalManifestError("invalid_retrieval_file_digest")


def _validate_selected_path(path: str) -> None:
    if (
        not isinstance(path, str)
        or not path
        or len(path) > MAX_SELECTED_PATH_LENGTH
        or path.startswith("/")
        or path.endswith("/")
        or "\\" in path
        or _CONTROL_RE.search(path)
        or unicodedata.normalize("NFC", path) != path
        or any(segment in {"", ".", ".."} for segment in path.split("/"))
    ):
        raise Phase10RetrievalManifestError("invalid_retrieval_path")


def _validate_media_type(media_type: str) -> None:
    if (
        not isinstance(media_type, str)
        or not _MEDIA_TYPE_RE.fullmatch(media_type)
        or media_type not in ALLOWED_TEXT_MEDIA_TYPES
    ):
        raise Phase10RetrievalManifestError("unsupported_retrieval_media_type")


def _validate_source_bytes(content: bytes) -> None:
    if not isinstance(content, bytes):
        raise Phase10RetrievalManifestError("invalid_retrieval_content")
    if len(content) > MAX_SELECTED_FILE_BYTES:
        raise Phase10RetrievalManifestError("retrieval_file_bytes_exceeded")
    if b"\x00" in content:
        raise Phase10RetrievalManifestError("binary_retrieval_content_rejected")
    try:
        content.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise Phase10RetrievalManifestError("non_utf8_retrieval_content_rejected") from exc


def _canonical_timestamp(value: datetime) -> str:
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise Phase10RetrievalManifestError("invalid_retrieval_timestamp")
    normalized = value.astimezone(UTC).replace(microsecond=0)
    return normalized.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_canonical_timestamp(value: str) -> datetime:
    if not isinstance(value, str):
        raise Phase10RetrievalManifestError("invalid_retrieval_timestamp")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except ValueError as exc:
        raise Phase10RetrievalManifestError("invalid_retrieval_timestamp") from exc
    if parsed.strftime("%Y-%m-%dT%H:%M:%SZ") != value:
        raise Phase10RetrievalManifestError("invalid_retrieval_timestamp")
    return parsed


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
