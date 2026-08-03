"""Pure, fail-closed validator for Phase 10 GitHub Contents responses.

This module accepts only already-read, bounded HTTP response data.  It does not
perform DNS, TLS, HTTP, filesystem, database, import, or execution operations.
Links in a GitHub response are treated as untrusted metadata and are never
followed.  A successful result proves only that one response is a bounded UTF-8
ordinary file matching one selected operation in a validated request plan.
"""

from __future__ import annotations

import base64
import binascii
import dataclasses
import hashlib
import json
import re
from pathlib import PurePosixPath
from typing import Any

from majorana_api.phase10_github_request_plan import (
    Phase10GitHubContentOperation,
    Phase10GitHubRequestPlan,
)
from majorana_api.phase10_retrieval_manifest import (
    MAX_SELECTED_FILE_BYTES,
    RetrievedFileEvidence,
)

GITHUB_CONTENT_RESPONSE_POLICY_VERSION = "phase10-s2-github-content-response/1"

_BLOB_SHA_RE = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
_CONTENT_LENGTH_RE = re.compile(r"0|[1-9][0-9]*")
_JSON_MEDIA_TYPES = frozenset({"application/json", "application/vnd.github+json"})
_REQUIRED_OBJECT_KEYS = frozenset(
    {
        "_links",
        "content",
        "download_url",
        "encoding",
        "git_url",
        "html_url",
        "name",
        "path",
        "sha",
        "size",
        "type",
        "url",
    }
)
_LINK_KEYS = frozenset({"git", "html", "self"})


class Phase10GitHubResponseError(ValueError):
    """A GitHub response is unsafe, ambiguous, unsupported, or malformed."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = False


@dataclasses.dataclass(frozen=True)
class ValidatedGitHubContent:
    """Validated selected-file bytes plus integrity and source-response evidence."""

    selected_path: str
    content: bytes
    file_evidence: RetrievedFileEvidence
    github_blob_sha: str
    response_body_sha256: str
    request_plan_sha256: str
    response_policy_version: str = GITHUB_CONTENT_RESPONSE_POLICY_VERSION


def validate_phase10_github_content_response(
    *,
    plan: Phase10GitHubRequestPlan,
    selected_path: str,
    status_code: int,
    headers: tuple[tuple[str, str], ...],
    body: bytes,
) -> ValidatedGitHubContent:
    """Validate one GitHub object response without performing transport I/O."""

    if not isinstance(plan, Phase10GitHubRequestPlan):
        raise Phase10GitHubResponseError("invalid_github_response_plan")
    operation = _operation_for_path(plan, selected_path)
    _validate_http_envelope(
        operation=operation,
        status_code=status_code,
        headers=headers,
        body=body,
    )
    payload = _load_unique_json_object(body)
    _validate_file_object_shape(payload)
    if payload["type"] != "file":
        raise Phase10GitHubResponseError("github_response_not_regular_file")
    if payload["path"] != operation.selected_path:
        raise Phase10GitHubResponseError("github_response_path_mismatch")
    if payload["name"] != PurePosixPath(operation.selected_path).name:
        raise Phase10GitHubResponseError("github_response_name_mismatch")
    if payload["encoding"] != "base64":
        raise Phase10GitHubResponseError("unsupported_github_content_encoding")

    declared_size = payload["size"]
    if (
        not isinstance(declared_size, int)
        or isinstance(declared_size, bool)
        or declared_size < 0
        or declared_size > MAX_SELECTED_FILE_BYTES
    ):
        raise Phase10GitHubResponseError("invalid_github_content_size")
    blob_sha = payload["sha"]
    if not isinstance(blob_sha, str) or not _BLOB_SHA_RE.fullmatch(blob_sha):
        raise Phase10GitHubResponseError("invalid_github_blob_sha")

    content = _decode_github_base64(payload["content"])
    if len(content) != declared_size:
        raise Phase10GitHubResponseError("github_content_size_mismatch")
    media_type = _media_type_for_path(operation.selected_path)
    try:
        file_evidence = RetrievedFileEvidence.from_bytes(
            selected_path=operation.selected_path,
            media_type=media_type,
            content=content,
        )
    except ValueError as exc:
        failure_code = getattr(exc, "failure_code", "invalid_github_file_content")
        raise Phase10GitHubResponseError(failure_code) from exc

    return ValidatedGitHubContent(
        selected_path=operation.selected_path,
        content=content,
        file_evidence=file_evidence,
        github_blob_sha=blob_sha,
        response_body_sha256=hashlib.sha256(body).hexdigest(),
        request_plan_sha256=plan.plan_sha256,
    )


def _operation_for_path(
    plan: Phase10GitHubRequestPlan,
    selected_path: str,
) -> Phase10GitHubContentOperation:
    if not isinstance(selected_path, str):
        raise Phase10GitHubResponseError("invalid_github_response_selected_path")
    matches = tuple(
        operation for operation in plan.operations if operation.selected_path == selected_path
    )
    if len(matches) != 1:
        raise Phase10GitHubResponseError("github_response_path_not_in_plan")
    return matches[0]


def _validate_http_envelope(
    *,
    operation: Phase10GitHubContentOperation,
    status_code: int,
    headers: tuple[tuple[str, str], ...],
    body: bytes,
) -> None:
    if not isinstance(status_code, int) or isinstance(status_code, bool):
        raise Phase10GitHubResponseError("invalid_github_response_status")
    if 300 <= status_code < 400:
        raise Phase10GitHubResponseError("github_response_redirect_rejected")
    if status_code != 200:
        raise Phase10GitHubResponseError("github_response_status_rejected")
    if not isinstance(body, bytes):
        raise Phase10GitHubResponseError("invalid_github_response_body")
    if len(body) > operation.max_response_bytes:
        raise Phase10GitHubResponseError("github_response_body_limit_exceeded")

    normalized = _normalize_headers(headers)
    content_type = _single_header(normalized, "content-type", required=True)
    assert content_type is not None
    media_type = content_type.split(";", 1)[0].strip().casefold()
    if media_type not in _JSON_MEDIA_TYPES:
        raise Phase10GitHubResponseError("unsupported_github_response_media_type")

    content_encoding = _single_header(normalized, "content-encoding", required=False)
    if content_encoding is not None and content_encoding.strip().casefold() != "identity":
        raise Phase10GitHubResponseError("github_response_content_encoding_rejected")

    content_length = _single_header(normalized, "content-length", required=False)
    if content_length is not None:
        if not _CONTENT_LENGTH_RE.fullmatch(content_length):
            raise Phase10GitHubResponseError("invalid_github_response_content_length")
        declared_length = int(content_length)
        if declared_length > operation.max_response_bytes:
            raise Phase10GitHubResponseError("github_response_body_limit_exceeded")
        if declared_length != len(body):
            raise Phase10GitHubResponseError("github_response_content_length_mismatch")


def _normalize_headers(
    headers: tuple[tuple[str, str], ...],
) -> dict[str, tuple[str, ...]]:
    if not isinstance(headers, tuple):
        raise Phase10GitHubResponseError("invalid_github_response_headers")
    normalized: dict[str, list[str]] = {}
    for item in headers:
        if (
            not isinstance(item, tuple)
            or len(item) != 2
            or not all(isinstance(part, str) for part in item)
        ):
            raise Phase10GitHubResponseError("invalid_github_response_headers")
        name, value = item
        canonical_name = name.strip().casefold()
        if not canonical_name or "\r" in value or "\n" in value:
            raise Phase10GitHubResponseError("invalid_github_response_headers")
        normalized.setdefault(canonical_name, []).append(value.strip())
    return {name: tuple(values) for name, values in normalized.items()}


def _single_header(
    headers: dict[str, tuple[str, ...]],
    name: str,
    *,
    required: bool,
) -> str | None:
    values = headers.get(name, ())
    if not values:
        if required:
            raise Phase10GitHubResponseError(f"missing_github_response_{name}")
        return None
    if len(values) != 1:
        raise Phase10GitHubResponseError(f"duplicate_github_response_{name}")
    return values[0]


def _load_unique_json_object(body: bytes) -> dict[str, Any]:
    try:
        text = body.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise Phase10GitHubResponseError("non_utf8_github_response") from exc
    if text.startswith("\ufeff"):
        raise Phase10GitHubResponseError("github_response_bom_rejected")

    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise Phase10GitHubResponseError("duplicate_github_response_json_key")
            result[key] = value
        return result

    try:
        payload = json.loads(text, object_pairs_hook=reject_duplicate_keys)
    except Phase10GitHubResponseError:
        raise
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise Phase10GitHubResponseError("invalid_github_response_json") from exc
    if not isinstance(payload, dict):
        raise Phase10GitHubResponseError("github_response_not_file_object")
    return payload


def _validate_file_object_shape(payload: dict[str, Any]) -> None:
    if set(payload) != _REQUIRED_OBJECT_KEYS:
        raise Phase10GitHubResponseError("invalid_github_file_object_shape")
    for key in ("content", "encoding", "name", "path", "sha", "type"):
        if not isinstance(payload[key], str):
            raise Phase10GitHubResponseError("invalid_github_file_object_shape")
    for key in ("download_url", "git_url", "html_url", "url"):
        if payload[key] is not None and not isinstance(payload[key], str):
            raise Phase10GitHubResponseError("invalid_github_file_object_shape")
    links = payload["_links"]
    if not isinstance(links, dict) or set(links) != _LINK_KEYS:
        raise Phase10GitHubResponseError("invalid_github_file_links")
    if not all(value is None or isinstance(value, str) for value in links.values()):
        raise Phase10GitHubResponseError("invalid_github_file_links")


def _decode_github_base64(value: Any) -> bytes:
    if not isinstance(value, str):
        raise Phase10GitHubResponseError("invalid_github_content_base64")
    compact = value.replace("\n", "").replace("\r", "")
    if any(character.isspace() for character in compact):
        raise Phase10GitHubResponseError("invalid_github_content_base64")
    try:
        return base64.b64decode(compact.encode("ascii"), validate=True)
    except (UnicodeEncodeError, binascii.Error, ValueError) as exc:
        raise Phase10GitHubResponseError("invalid_github_content_base64") from exc


def _media_type_for_path(selected_path: str) -> str:
    suffix = PurePosixPath(selected_path).suffix.casefold()
    return {
        ".c": "text/x-c",
        ".cc": "text/x-c++",
        ".cff": "application/yaml",
        ".cpp": "text/x-c++",
        ".cxx": "text/x-c++",
        ".h": "text/x-c",
        ".hpp": "text/x-c++",
        ".java": "text/x-java-source",
        ".js": "text/javascript",
        ".json": "application/json",
        ".md": "text/markdown",
        ".py": "text/x-python",
        ".rst": "text/x-rst",
        ".toml": "application/toml",
        ".ts": "text/typescript",
        ".xml": "application/xml",
        ".yaml": "application/yaml",
        ".yml": "application/x-yaml",
    }.get(suffix, "text/plain")
