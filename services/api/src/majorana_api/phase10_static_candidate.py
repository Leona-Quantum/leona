"""Static, structured-only Phase 10 execution-candidate contract.

Candidate source never chooses a command, package install, runtime digest, or
policy limit.  This module only binds reviewed metadata to an S5 normalized
manifest and a fixed Atlas mapping.  Every candidate remains structured-only
until later independent review and S7+ runtime qualification exist.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
from typing import Any

from majorana_api.phase10_quarantine_contract import QUARANTINE_LOCATOR_PREFIX
from majorana_api.phase10_retrieval_manifest import (
    ALLOWED_TEXT_MEDIA_TYPES,
    MAX_SELECTED_FILE_BYTES,
    Phase10RetrievalManifestError,
    validate_phase10_selected_paths,
)
from majorana_api.phase10_source_normalizer import (
    Phase10NormalizedSourceManifest,
)

STATIC_CANDIDATE_SCHEMA_VERSION = 1
STATIC_CANDIDATE_CONTRACT_VERSION = "phase10-s6-static-candidate/1"
STATIC_CANDIDATE_DISPOSITION = "structured_only"
FIXED_LAUNCHER_ID = "atlas.phase10.python.vqe-json-launcher/1"
INPUT_SCHEMA_ID = "atlas.phase10.vqe-input/1"
OUTPUT_SCHEMA_ID = "atlas.phase10.vqe-result/1"

_SHA256_RE = re.compile(r"[0-9a-f]{64}")
_FRAMEWORK_PROFILES = {
    "pennylane": "phase10-python-pennylane-0.45.1-candidate-v1",
    "qiskit": "phase10-python-qiskit-1.4.6-candidate-v1",
}
_LICENSE_STATUSES = frozenset(
    {
        "verified_compatible",
        "unknown",
        "review_required",
        "conflicting",
        "nonredistributable",
    }
)
_PROVENANCE_STATUSES = frozenset({"verified", "unverified", "conflicting"})
_BASE_BLOCKING_REASONS = (
    "external_runtime_policy_unqualified",
    "static_entrypoint_review_pending",
)


class Phase10StaticCandidateError(ValueError):
    """Candidate metadata is unsupported, ambiguous, or privilege-bearing."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = False


@dataclasses.dataclass(frozen=True)
class StaticCandidateSourceFile:
    selected_path: str
    media_type: str
    length: int
    sha256: str
    opaque_locator: str

    def descriptor(self) -> dict[str, str | int]:
        return dataclasses.asdict(self)


@dataclasses.dataclass(frozen=True)
class Phase10StaticExecutionCandidate:
    normalized_source_manifest_sha256: str
    source_files: tuple[StaticCandidateSourceFile, ...]
    language: str
    framework: str
    framework_evidence_paths: tuple[str, ...]
    package_evidence_paths: tuple[str, ...]
    requested_entrypoint_path: str
    proposed_runtime_profile: str
    license_status: str
    provenance_status: str
    blocking_reasons: tuple[str, ...]
    disposition: str = STATIC_CANDIDATE_DISPOSITION
    launcher_id: str = FIXED_LAUNCHER_ID
    input_schema_id: str = INPUT_SCHEMA_ID
    output_schema_id: str = OUTPUT_SCHEMA_ID
    contract_version: str = STATIC_CANDIDATE_CONTRACT_VERSION

    def __post_init__(self) -> None:
        _validate_candidate(self)

    def body(self) -> dict[str, Any]:
        return {
            "candidate_schema_version": STATIC_CANDIDATE_SCHEMA_VERSION,
            "contract_version": self.contract_version,
            "disposition": self.disposition,
            "normalized_source_manifest_sha256": self.normalized_source_manifest_sha256,
            "source_files": [item.descriptor() for item in self.source_files],
            "language": self.language,
            "framework": self.framework,
            "framework_evidence_paths": list(self.framework_evidence_paths),
            "package_evidence_paths": list(self.package_evidence_paths),
            "requested_entrypoint_path": self.requested_entrypoint_path,
            "proposed_runtime_profile": self.proposed_runtime_profile,
            "launcher_id": self.launcher_id,
            "input_schema_id": self.input_schema_id,
            "output_schema_id": self.output_schema_id,
            "license_status": self.license_status,
            "provenance_status": self.provenance_status,
            "blocking_reasons": list(self.blocking_reasons),
        }

    @property
    def candidate_sha256(self) -> str:
        return _canonical_sha256(self.body())

    def to_candidate(self) -> dict[str, Any]:
        return {**self.body(), "candidate_sha256": self.candidate_sha256}

    @classmethod
    def from_candidate(cls, payload: dict[str, Any]) -> Phase10StaticExecutionCandidate:
        if not isinstance(payload, dict) or set(payload) != {
            "candidate_schema_version",
            "contract_version",
            "disposition",
            "normalized_source_manifest_sha256",
            "source_files",
            "language",
            "framework",
            "framework_evidence_paths",
            "package_evidence_paths",
            "requested_entrypoint_path",
            "proposed_runtime_profile",
            "launcher_id",
            "input_schema_id",
            "output_schema_id",
            "license_status",
            "provenance_status",
            "blocking_reasons",
            "candidate_sha256",
        }:
            raise Phase10StaticCandidateError("invalid_static_candidate")
        if payload["candidate_schema_version"] != STATIC_CANDIDATE_SCHEMA_VERSION:
            raise Phase10StaticCandidateError("unsupported_static_candidate_schema")
        list_fields = (
            "source_files",
            "framework_evidence_paths",
            "package_evidence_paths",
            "blocking_reasons",
        )
        if any(not isinstance(payload[field], list) for field in list_fields):
            raise Phase10StaticCandidateError("invalid_static_candidate")
        candidate = cls(
            normalized_source_manifest_sha256=payload["normalized_source_manifest_sha256"],
            source_files=tuple(
                _source_file_from_descriptor(value) for value in payload["source_files"]
            ),
            language=payload["language"],
            framework=payload["framework"],
            framework_evidence_paths=tuple(payload["framework_evidence_paths"]),
            package_evidence_paths=tuple(payload["package_evidence_paths"]),
            requested_entrypoint_path=payload["requested_entrypoint_path"],
            proposed_runtime_profile=payload["proposed_runtime_profile"],
            license_status=payload["license_status"],
            provenance_status=payload["provenance_status"],
            blocking_reasons=tuple(payload["blocking_reasons"]),
            disposition=payload["disposition"],
            launcher_id=payload["launcher_id"],
            input_schema_id=payload["input_schema_id"],
            output_schema_id=payload["output_schema_id"],
            contract_version=payload["contract_version"],
        )
        claimed_digest = payload["candidate_sha256"]
        if not _is_sha256(claimed_digest):
            raise Phase10StaticCandidateError("invalid_static_candidate_digest")
        if claimed_digest != candidate.candidate_sha256:
            raise Phase10StaticCandidateError("static_candidate_digest_mismatch")
        return candidate


def build_phase10_static_execution_candidate(
    *,
    normalized_source: Phase10NormalizedSourceManifest,
    framework: str,
    framework_evidence_paths: tuple[str, ...],
    package_evidence_paths: tuple[str, ...],
    requested_entrypoint_path: str,
    license_status: str,
    provenance_status: str,
) -> Phase10StaticExecutionCandidate:
    if not isinstance(normalized_source, Phase10NormalizedSourceManifest):
        raise Phase10StaticCandidateError("invalid_normalized_source_parent")
    if framework not in _FRAMEWORK_PROFILES:
        raise Phase10StaticCandidateError("unsupported_candidate_framework")
    source_files = tuple(
        StaticCandidateSourceFile(
            selected_path=item.selected_path,
            media_type=item.media_type,
            length=item.length,
            sha256=item.sha256,
            opaque_locator=item.opaque_locator,
        )
        for item in normalized_source.files
    )
    blocking_reasons = list(_BASE_BLOCKING_REASONS)
    if license_status != "verified_compatible":
        blocking_reasons.append("license_review_incomplete")
    if provenance_status != "verified":
        blocking_reasons.append("provenance_review_incomplete")
    return Phase10StaticExecutionCandidate(
        normalized_source_manifest_sha256=normalized_source.manifest_sha256,
        source_files=source_files,
        language="python",
        framework=framework,
        framework_evidence_paths=framework_evidence_paths,
        package_evidence_paths=package_evidence_paths,
        requested_entrypoint_path=requested_entrypoint_path,
        proposed_runtime_profile=_FRAMEWORK_PROFILES[framework],
        license_status=license_status,
        provenance_status=provenance_status,
        blocking_reasons=tuple(blocking_reasons),
    )


def _validate_candidate(candidate: Phase10StaticExecutionCandidate) -> None:
    if candidate.contract_version != STATIC_CANDIDATE_CONTRACT_VERSION:
        raise Phase10StaticCandidateError("unsupported_static_candidate_contract")
    if candidate.disposition != STATIC_CANDIDATE_DISPOSITION:
        raise Phase10StaticCandidateError("candidate_execution_not_qualified")
    if not _is_sha256(candidate.normalized_source_manifest_sha256):
        raise Phase10StaticCandidateError("invalid_normalized_source_parent_digest")
    if candidate.language != "python" or candidate.framework not in _FRAMEWORK_PROFILES:
        raise Phase10StaticCandidateError("unsupported_candidate_framework")
    if candidate.proposed_runtime_profile != _FRAMEWORK_PROFILES[candidate.framework]:
        raise Phase10StaticCandidateError("unapproved_candidate_runtime_mapping")
    if (
        candidate.launcher_id != FIXED_LAUNCHER_ID
        or candidate.input_schema_id != INPUT_SCHEMA_ID
        or candidate.output_schema_id != OUTPUT_SCHEMA_ID
    ):
        raise Phase10StaticCandidateError("unapproved_candidate_protocol")
    if candidate.license_status not in _LICENSE_STATUSES:
        raise Phase10StaticCandidateError("invalid_candidate_license_status")
    if candidate.provenance_status not in _PROVENANCE_STATUSES:
        raise Phase10StaticCandidateError("invalid_candidate_provenance_status")
    _validate_source_files(candidate.source_files)
    source_paths = tuple(item.selected_path for item in candidate.source_files)
    _validate_evidence_paths(candidate.framework_evidence_paths, source_paths)
    _validate_evidence_paths(candidate.package_evidence_paths, source_paths)
    if (
        candidate.requested_entrypoint_path not in source_paths
        or not candidate.requested_entrypoint_path.casefold().endswith(".py")
    ):
        raise Phase10StaticCandidateError("unsupported_candidate_entrypoint")
    expected_reasons = list(_BASE_BLOCKING_REASONS)
    if candidate.license_status != "verified_compatible":
        expected_reasons.append("license_review_incomplete")
    if candidate.provenance_status != "verified":
        expected_reasons.append("provenance_review_incomplete")
    if candidate.blocking_reasons != tuple(expected_reasons):
        raise Phase10StaticCandidateError("invalid_candidate_blocking_reasons")


def _validate_source_files(files: tuple[StaticCandidateSourceFile, ...]) -> None:
    if (
        not isinstance(files, tuple)
        or not files
        or any(not isinstance(item, StaticCandidateSourceFile) for item in files)
    ):
        raise Phase10StaticCandidateError("invalid_candidate_source_files")
    paths = tuple(item.selected_path for item in files)
    try:
        validate_phase10_selected_paths(paths)
    except Phase10RetrievalManifestError as exc:
        raise Phase10StaticCandidateError(exc.failure_code) from exc
    for item in files:
        if (
            not isinstance(item.media_type, str)
            or item.media_type not in ALLOWED_TEXT_MEDIA_TYPES
            or not isinstance(item.length, int)
            or isinstance(item.length, bool)
            or item.length < 0
            or item.length > MAX_SELECTED_FILE_BYTES
            or not _is_sha256(item.sha256)
            or item.opaque_locator != f"{QUARANTINE_LOCATOR_PREFIX}{item.sha256}"
        ):
            raise Phase10StaticCandidateError("invalid_candidate_source_file")


def _validate_evidence_paths(paths: tuple[str, ...], source_paths: tuple[str, ...]) -> None:
    if not isinstance(paths, tuple) or not paths:
        raise Phase10StaticCandidateError("missing_candidate_evidence")
    try:
        validate_phase10_selected_paths(paths)
    except Phase10RetrievalManifestError as exc:
        raise Phase10StaticCandidateError(exc.failure_code) from exc
    if not set(paths).issubset(source_paths):
        raise Phase10StaticCandidateError("candidate_evidence_not_in_source")


def _source_file_from_descriptor(value: Any) -> StaticCandidateSourceFile:
    if not isinstance(value, dict) or set(value) != {
        "selected_path",
        "media_type",
        "length",
        "sha256",
        "opaque_locator",
    }:
        raise Phase10StaticCandidateError("invalid_candidate_source_file")
    return StaticCandidateSourceFile(
        selected_path=value["selected_path"],
        media_type=value["media_type"],
        length=value["length"],
        sha256=value["sha256"],
        opaque_locator=value["opaque_locator"],
    )


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
