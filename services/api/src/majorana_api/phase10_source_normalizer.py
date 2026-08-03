"""Deterministic, non-executing normalizer for Phase 10 selected text files.

The initial normalizer accepts only exact bytes already represented by an S3
quarantine plan.  It rejects archives and common credential-file shapes,
performs no extraction or parsing, writes no filesystem object, and serializes
no source bytes.  Its output is a read-only manifest of opaque quarantine
locators for later static review.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
import unicodedata
import uuid
from collections.abc import Mapping
from pathlib import PurePosixPath
from typing import Any

from majorana_api.phase10_quarantine_contract import (
    QUARANTINE_LOCATOR_PREFIX,
    Phase10QuarantineContractError,
    Phase10QuarantinePlan,
)
from majorana_api.phase10_retrieval_manifest import (
    ALLOWED_TEXT_MEDIA_TYPES,
    MAX_SELECTED_FILE_BYTES,
    MAX_SELECTED_TOTAL_BYTES,
    Phase10RetrievalManifestError,
    validate_phase10_selected_paths,
)

NORMALIZED_SOURCE_SCHEMA_VERSION = 1
NORMALIZER_CONTRACT_VERSION = "phase10-s5-selected-text-normalizer/1"
NORMALIZED_SOURCE_CLASS = "canonical_read_only_selected_text"
NORMALIZED_TEXT_ENCODING = "utf-8"

_SHA256_RE = re.compile(r"[0-9a-f]{64}")
_ARCHIVE_SUFFIXES = frozenset(
    {
        ".7z",
        ".bz2",
        ".deb",
        ".dmg",
        ".egg",
        ".gem",
        ".gz",
        ".iso",
        ".jar",
        ".rar",
        ".rpm",
        ".tar",
        ".tgz",
        ".txz",
        ".whl",
        ".xz",
        ".zip",
    }
)
_EXACT_SENSITIVE_BASENAMES = frozenset(
    {
        ".env",
        ".netrc",
        ".npmrc",
        ".pypirc",
        "credentials",
        "id_dsa",
        "id_ed25519",
        "id_ecdsa",
        "id_rsa",
    }
)
_LFS_POINTER_PREFIXES = (
    b"version https://git-lfs.github.com/spec/v1\n",
    b"version https://git-lfs.github.com/spec/v1\r\n",
)


class Phase10SourceNormalizerError(ValueError):
    """Selected source is unsupported, altered, or not safely normalizable."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = False


@dataclasses.dataclass(frozen=True)
class NormalizedSourceFile:
    """Read-only reference to one verified quarantine object."""

    selected_path: str
    media_type: str
    length: int
    sha256: str
    opaque_locator: str
    text_encoding: str = NORMALIZED_TEXT_ENCODING

    def descriptor(self) -> dict[str, str | int]:
        return dataclasses.asdict(self)


@dataclasses.dataclass(frozen=True)
class Phase10NormalizedSourceManifest:
    """Canonical source-shape evidence containing no source text."""

    workspace_id: str
    acquisition_result_sha256: str
    quarantine_plan_sha256: str
    files: tuple[NormalizedSourceFile, ...]
    source_class: str = NORMALIZED_SOURCE_CLASS
    normalizer_version: str = NORMALIZER_CONTRACT_VERSION

    def __post_init__(self) -> None:
        _validate_manifest(self)

    @property
    def selected_total_bytes(self) -> int:
        return sum(item.length for item in self.files)

    def body(self) -> dict[str, Any]:
        return {
            "manifest_schema_version": NORMALIZED_SOURCE_SCHEMA_VERSION,
            "normalizer_version": self.normalizer_version,
            "source_class": self.source_class,
            "workspace_id": self.workspace_id,
            "acquisition_result_sha256": self.acquisition_result_sha256,
            "quarantine_plan_sha256": self.quarantine_plan_sha256,
            "selected_file_count": len(self.files),
            "selected_total_bytes": self.selected_total_bytes,
            "files": [item.descriptor() for item in self.files],
        }

    @property
    def manifest_sha256(self) -> str:
        return _canonical_sha256(self.body())

    def to_manifest(self) -> dict[str, Any]:
        return {**self.body(), "manifest_sha256": self.manifest_sha256}

    @classmethod
    def from_manifest(cls, payload: dict[str, Any]) -> Phase10NormalizedSourceManifest:
        if not isinstance(payload, dict) or set(payload) != {
            "manifest_schema_version",
            "normalizer_version",
            "source_class",
            "workspace_id",
            "acquisition_result_sha256",
            "quarantine_plan_sha256",
            "selected_file_count",
            "selected_total_bytes",
            "files",
            "manifest_sha256",
        }:
            raise Phase10SourceNormalizerError("invalid_normalized_source_manifest")
        if payload["manifest_schema_version"] != NORMALIZED_SOURCE_SCHEMA_VERSION:
            raise Phase10SourceNormalizerError("unsupported_normalized_source_manifest_schema")
        raw_files = payload["files"]
        if not isinstance(raw_files, list):
            raise Phase10SourceNormalizerError("invalid_normalized_source_manifest")
        files = tuple(_file_from_descriptor(value) for value in raw_files)
        manifest = cls(
            workspace_id=payload["workspace_id"],
            acquisition_result_sha256=payload["acquisition_result_sha256"],
            quarantine_plan_sha256=payload["quarantine_plan_sha256"],
            files=files,
            source_class=payload["source_class"],
            normalizer_version=payload["normalizer_version"],
        )
        if payload["selected_file_count"] != len(files):
            raise Phase10SourceNormalizerError("normalized_source_file_count_mismatch")
        if payload["selected_total_bytes"] != manifest.selected_total_bytes:
            raise Phase10SourceNormalizerError("normalized_source_total_bytes_mismatch")
        claimed_digest = payload["manifest_sha256"]
        if not _is_sha256(claimed_digest):
            raise Phase10SourceNormalizerError("invalid_normalized_source_digest")
        if claimed_digest != manifest.manifest_sha256:
            raise Phase10SourceNormalizerError("normalized_source_manifest_digest_mismatch")
        return manifest


def build_phase10_normalized_source_manifest(
    *,
    workspace_id: uuid.UUID,
    quarantine_plan: Phase10QuarantinePlan,
    source_bytes: Mapping[str, bytes],
) -> Phase10NormalizedSourceManifest:
    """Verify exact quarantine bytes and emit only content-addressed metadata."""

    if not isinstance(quarantine_plan, Phase10QuarantinePlan):
        raise Phase10SourceNormalizerError("invalid_normalizer_quarantine_plan")
    if not isinstance(source_bytes, Mapping) or any(
        not isinstance(path, str) for path in source_bytes
    ):
        raise Phase10SourceNormalizerError("invalid_normalizer_source_bytes")
    try:
        quarantine_plan.require_workspace(workspace_id)
    except Phase10QuarantineContractError as exc:
        raise Phase10SourceNormalizerError(exc.failure_code) from exc
    expected_paths = tuple(item.selected_path for item in quarantine_plan.objects)
    if set(source_bytes) != set(expected_paths) or len(source_bytes) != len(expected_paths):
        raise Phase10SourceNormalizerError("normalized_source_path_set_mismatch")

    normalized_files: list[NormalizedSourceFile] = []
    for item in quarantine_plan.objects:
        content = source_bytes[item.selected_path]
        try:
            quarantine_plan.verify_readback(
                selected_path=item.selected_path,
                content=content,
            )
        except Phase10QuarantineContractError as exc:
            raise Phase10SourceNormalizerError(exc.failure_code) from exc
        _validate_selected_source_shape(item.selected_path, content)
        normalized_files.append(
            NormalizedSourceFile(
                selected_path=item.selected_path,
                media_type=item.media_type,
                length=item.length,
                sha256=item.sha256,
                opaque_locator=item.opaque_locator,
            )
        )

    return Phase10NormalizedSourceManifest(
        workspace_id=str(workspace_id),
        acquisition_result_sha256=quarantine_plan.acquisition_result_sha256,
        quarantine_plan_sha256=quarantine_plan.plan_sha256,
        files=tuple(normalized_files),
    )


def _file_from_descriptor(value: Any) -> NormalizedSourceFile:
    if not isinstance(value, dict) or set(value) != {
        "selected_path",
        "media_type",
        "length",
        "sha256",
        "opaque_locator",
        "text_encoding",
    }:
        raise Phase10SourceNormalizerError("invalid_normalized_source_file")
    return NormalizedSourceFile(
        selected_path=value["selected_path"],
        media_type=value["media_type"],
        length=value["length"],
        sha256=value["sha256"],
        opaque_locator=value["opaque_locator"],
        text_encoding=value["text_encoding"],
    )


def _validate_manifest(manifest: Phase10NormalizedSourceManifest) -> None:
    _validate_workspace_id(manifest.workspace_id)
    if not _is_sha256(manifest.acquisition_result_sha256) or not _is_sha256(
        manifest.quarantine_plan_sha256
    ):
        raise Phase10SourceNormalizerError("invalid_normalized_source_parent_digest")
    if manifest.source_class != NORMALIZED_SOURCE_CLASS:
        raise Phase10SourceNormalizerError("unsupported_normalized_source_class")
    if manifest.normalizer_version != NORMALIZER_CONTRACT_VERSION:
        raise Phase10SourceNormalizerError("unsupported_source_normalizer")
    if not isinstance(manifest.files, tuple) or not manifest.files:
        raise Phase10SourceNormalizerError("empty_normalized_source_manifest")
    if any(not isinstance(item, NormalizedSourceFile) for item in manifest.files):
        raise Phase10SourceNormalizerError("invalid_normalized_source_file")
    paths = tuple(item.selected_path for item in manifest.files)
    try:
        validate_phase10_selected_paths(paths)
    except Phase10RetrievalManifestError as exc:
        raise Phase10SourceNormalizerError(exc.failure_code) from exc
    for item in manifest.files:
        _validate_normalized_file(item)
    if manifest.selected_total_bytes > MAX_SELECTED_TOTAL_BYTES:
        raise Phase10SourceNormalizerError("normalized_source_total_bytes_exceeded")


def _validate_normalized_file(item: NormalizedSourceFile) -> None:
    _validate_source_path(item.selected_path)
    if (
        not isinstance(item.media_type, str)
        or item.media_type not in ALLOWED_TEXT_MEDIA_TYPES
        or not isinstance(item.length, int)
        or isinstance(item.length, bool)
        or item.length < 0
        or item.length > MAX_SELECTED_FILE_BYTES
        or not _is_sha256(item.sha256)
        or item.opaque_locator != f"{QUARANTINE_LOCATOR_PREFIX}{item.sha256}"
        or item.text_encoding != NORMALIZED_TEXT_ENCODING
    ):
        raise Phase10SourceNormalizerError("invalid_normalized_source_file")


def _validate_selected_source_shape(selected_path: str, content: bytes) -> None:
    _validate_source_path(selected_path)
    if not isinstance(content, bytes):
        raise Phase10SourceNormalizerError("invalid_normalizer_source_bytes")
    if content.startswith(b"\xef\xbb\xbf"):
        raise Phase10SourceNormalizerError("utf8_bom_rejected")
    if content.startswith(_LFS_POINTER_PREFIXES):
        raise Phase10SourceNormalizerError("git_lfs_pointer_rejected")
    if _looks_like_archive(content):
        raise Phase10SourceNormalizerError("source_shape_rejected")
    try:
        text = content.decode(NORMALIZED_TEXT_ENCODING, errors="strict")
    except UnicodeDecodeError as exc:
        raise Phase10SourceNormalizerError("non_utf8_source_rejected") from exc
    if any(
        unicodedata.category(character) == "Cc" and character not in "\t\n\r" for character in text
    ):
        raise Phase10SourceNormalizerError("source_control_character_rejected")


def _validate_source_path(selected_path: str) -> None:
    try:
        validate_phase10_selected_paths((selected_path,))
    except Phase10RetrievalManifestError as exc:
        raise Phase10SourceNormalizerError(exc.failure_code) from exc
    path = PurePosixPath(selected_path)
    basename = path.name.casefold()
    if (
        any(suffix.casefold() in _ARCHIVE_SUFFIXES for suffix in path.suffixes)
        or basename in _EXACT_SENSITIVE_BASENAMES
        or basename.startswith(".env.")
    ):
        raise Phase10SourceNormalizerError("source_shape_rejected")


def _looks_like_archive(content: bytes) -> bool:
    prefixes = (
        b"PK\x03\x04",
        b"PK\x05\x06",
        b"PK\x07\x08",
        b"\x1f\x8b",
        b"BZh",
        b"\xfd7zXZ\x00",
        b"7z\xbc\xaf'\x1c",
        b"Rar!\x1a\x07",
    )
    return content.startswith(prefixes) or (len(content) >= 262 and content[257:262] == b"ustar")


def _validate_workspace_id(value: str) -> None:
    if not isinstance(value, str):
        raise Phase10SourceNormalizerError("invalid_normalized_source_workspace")
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError) as exc:
        raise Phase10SourceNormalizerError("invalid_normalized_source_workspace") from exc
    if parsed.int == 0 or str(parsed) != value:
        raise Phase10SourceNormalizerError("invalid_normalized_source_workspace")


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _is_sha256(value: object) -> bool:
    return isinstance(value, str) and _SHA256_RE.fullmatch(value) is not None
