"""Pure aggregate evidence for one complete Phase 10 selected-file acquisition.

The aggregate is created only when every operation in one request plan has one
validated response and the resulting retrieval manifest remains inside the
authorization's destination window.  It retains hashes and metadata, never
source bytes, and performs no I/O or execution.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
from datetime import datetime
from typing import Any

from majorana_api.phase10_acquisition_contract import Phase10AcquisitionContractError
from majorana_api.phase10_github_request_plan import (
    Phase10GitHubRequestPlan,
    Phase10GitHubRequestPlanError,
)
from majorana_api.phase10_github_response import (
    GITHUB_CONTENT_RESPONSE_POLICY_VERSION,
    ValidatedGitHubContent,
)
from majorana_api.phase10_retrieval_manifest import (
    Phase10RetrievalManifest,
    Phase10RetrievalManifestError,
    build_phase10_retrieval_manifest,
)

ACQUISITION_RESULT_SCHEMA_VERSION = 1
ACQUISITION_RESULT_POLICY_VERSION = "phase10-s2-acquisition-result/1"
_SHA256_RE = re.compile(r"[0-9a-f]{64}")
_BLOB_SHA_RE = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")


class Phase10AcquisitionResultError(ValueError):
    """Complete acquisition evidence is missing, inconsistent, or altered."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = False


@dataclasses.dataclass(frozen=True)
class GitHubResponseEvidence:
    """Non-content evidence from one already validated GitHub response."""

    selected_path: str
    github_blob_sha: str
    response_body_sha256: str
    file_sha256: str

    def descriptor(self) -> dict[str, str]:
        return dataclasses.asdict(self)


@dataclasses.dataclass(frozen=True)
class Phase10AcquisitionResult:
    """Digest-bound, complete evidence for one selected-file request plan."""

    request_plan: Phase10GitHubRequestPlan
    retrieval_manifest: Phase10RetrievalManifest
    responses: tuple[GitHubResponseEvidence, ...]
    response_policy_version: str = GITHUB_CONTENT_RESPONSE_POLICY_VERSION
    result_policy_version: str = ACQUISITION_RESULT_POLICY_VERSION

    def __post_init__(self) -> None:
        _validate_result(self)

    def body(self) -> dict[str, Any]:
        return {
            "result_schema_version": ACQUISITION_RESULT_SCHEMA_VERSION,
            "result_policy_version": self.result_policy_version,
            "response_policy_version": self.response_policy_version,
            "request_plan": self.request_plan.to_plan(),
            "retrieval_manifest": self.retrieval_manifest.to_manifest(),
            "responses": [response.descriptor() for response in self.responses],
        }

    @property
    def result_sha256(self) -> str:
        return _canonical_sha256(self.body())

    def to_result(self) -> dict[str, Any]:
        return {**self.body(), "result_sha256": self.result_sha256}

    @classmethod
    def from_result(cls, payload: dict[str, Any]) -> Phase10AcquisitionResult:
        if not isinstance(payload, dict) or set(payload) != {
            "result_schema_version",
            "result_policy_version",
            "response_policy_version",
            "request_plan",
            "retrieval_manifest",
            "responses",
            "result_sha256",
        }:
            raise Phase10AcquisitionResultError("invalid_acquisition_result")
        if payload["result_schema_version"] != ACQUISITION_RESULT_SCHEMA_VERSION:
            raise Phase10AcquisitionResultError("unsupported_acquisition_result_schema")
        try:
            request_plan = Phase10GitHubRequestPlan.from_plan(payload["request_plan"])
            retrieval_manifest = Phase10RetrievalManifest.from_manifest(
                payload["retrieval_manifest"]
            )
        except (Phase10GitHubRequestPlanError, Phase10RetrievalManifestError) as exc:
            raise Phase10AcquisitionResultError("invalid_acquisition_result_evidence") from exc
        raw_responses = payload["responses"]
        if not isinstance(raw_responses, list):
            raise Phase10AcquisitionResultError("invalid_acquisition_result_responses")
        responses = tuple(_response_from_descriptor(item) for item in raw_responses)
        result = cls(
            request_plan=request_plan,
            retrieval_manifest=retrieval_manifest,
            responses=responses,
            response_policy_version=payload["response_policy_version"],
            result_policy_version=payload["result_policy_version"],
        )
        claimed_digest = payload["result_sha256"]
        if not _is_sha256(claimed_digest):
            raise Phase10AcquisitionResultError("invalid_acquisition_result_digest")
        if claimed_digest != result.result_sha256:
            raise Phase10AcquisitionResultError("acquisition_result_digest_mismatch")
        return result


def build_phase10_acquisition_result(
    *,
    request_plan: Phase10GitHubRequestPlan,
    fetched_at: datetime,
    validated_files: tuple[ValidatedGitHubContent, ...],
) -> Phase10AcquisitionResult:
    """Build complete evidence only after every selected response is validated."""

    if not isinstance(request_plan, Phase10GitHubRequestPlan):
        raise Phase10AcquisitionResultError("invalid_acquisition_result_plan")
    if not isinstance(validated_files, tuple):
        raise Phase10AcquisitionResultError("invalid_acquisition_result_files")
    expected_paths = tuple(operation.selected_path for operation in request_plan.operations)
    actual_paths = tuple(item.selected_path for item in validated_files)
    if actual_paths != expected_paths:
        raise Phase10AcquisitionResultError("incomplete_or_noncanonical_acquisition_result")
    if any(
        not isinstance(item, ValidatedGitHubContent)
        or item.request_plan_sha256 != request_plan.plan_sha256
        or item.response_policy_version != GITHUB_CONTENT_RESPONSE_POLICY_VERSION
        for item in validated_files
    ):
        raise Phase10AcquisitionResultError("acquisition_result_response_binding_mismatch")

    request = request_plan.authorization.request
    try:
        manifest = build_phase10_retrieval_manifest(
            repository_id=request.repository_id,
            full_name=request.full_name,
            immutable_ref=request.immutable_ref,
            fetched_at=fetched_at,
            files=tuple(item.file_evidence for item in validated_files),
        )
        request_plan.authorization.validate_manifest(manifest)
    except (Phase10RetrievalManifestError, Phase10AcquisitionContractError) as exc:
        failure_code = getattr(exc, "failure_code", "invalid_acquisition_result_manifest")
        raise Phase10AcquisitionResultError(failure_code) from exc

    responses = tuple(
        GitHubResponseEvidence(
            selected_path=item.selected_path,
            github_blob_sha=item.github_blob_sha,
            response_body_sha256=item.response_body_sha256,
            file_sha256=item.file_evidence.sha256,
        )
        for item in validated_files
    )
    return Phase10AcquisitionResult(
        request_plan=request_plan,
        retrieval_manifest=manifest,
        responses=responses,
    )


def _validate_result(result: Phase10AcquisitionResult) -> None:
    if not isinstance(result.request_plan, Phase10GitHubRequestPlan):
        raise Phase10AcquisitionResultError("invalid_acquisition_result_plan")
    if not isinstance(result.retrieval_manifest, Phase10RetrievalManifest):
        raise Phase10AcquisitionResultError("invalid_acquisition_result_manifest")
    if result.result_policy_version != ACQUISITION_RESULT_POLICY_VERSION:
        raise Phase10AcquisitionResultError("unsupported_acquisition_result_policy")
    if result.response_policy_version != GITHUB_CONTENT_RESPONSE_POLICY_VERSION:
        raise Phase10AcquisitionResultError("unsupported_acquisition_response_policy")
    if not isinstance(result.responses, tuple):
        raise Phase10AcquisitionResultError("invalid_acquisition_result_responses")
    try:
        result.request_plan.authorization.validate_manifest(result.retrieval_manifest)
    except Phase10AcquisitionContractError as exc:
        raise Phase10AcquisitionResultError(exc.failure_code) from exc

    expected_paths = tuple(operation.selected_path for operation in result.request_plan.operations)
    response_paths = tuple(response.selected_path for response in result.responses)
    manifest_paths = tuple(file.selected_path for file in result.retrieval_manifest.files)
    if response_paths != expected_paths or manifest_paths != expected_paths:
        raise Phase10AcquisitionResultError("incomplete_or_noncanonical_acquisition_result")
    manifest_by_path = {item.selected_path: item for item in result.retrieval_manifest.files}
    for response in result.responses:
        _validate_response_evidence(response)
        if response.file_sha256 != manifest_by_path[response.selected_path].sha256:
            raise Phase10AcquisitionResultError("acquisition_result_file_digest_mismatch")


def _response_from_descriptor(value: Any) -> GitHubResponseEvidence:
    if not isinstance(value, dict) or set(value) != {
        "selected_path",
        "github_blob_sha",
        "response_body_sha256",
        "file_sha256",
    }:
        raise Phase10AcquisitionResultError("invalid_acquisition_response_evidence")
    response = GitHubResponseEvidence(
        selected_path=value["selected_path"],
        github_blob_sha=value["github_blob_sha"],
        response_body_sha256=value["response_body_sha256"],
        file_sha256=value["file_sha256"],
    )
    _validate_response_evidence(response)
    return response


def _validate_response_evidence(response: GitHubResponseEvidence) -> None:
    if not isinstance(response.selected_path, str):
        raise Phase10AcquisitionResultError("invalid_acquisition_response_path")
    if not isinstance(response.github_blob_sha, str) or not _BLOB_SHA_RE.fullmatch(
        response.github_blob_sha
    ):
        raise Phase10AcquisitionResultError("invalid_acquisition_response_blob_sha")
    for digest in (response.response_body_sha256, response.file_sha256):
        if not _is_sha256(digest):
            raise Phase10AcquisitionResultError("invalid_acquisition_response_digest")


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
