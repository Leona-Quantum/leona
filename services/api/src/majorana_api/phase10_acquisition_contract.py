"""Pure authorization contract for a future Phase 10 GitHub connector.

No request in this module can carry a URL, header, credential, proxy, port,
redirect, command, or entrypoint.  It binds a known repository identity, an
immutable commit, and a bounded canonical path set to short-lived destination
evidence.  Network transport and replay prevention remain separate mandatory
controls; this module performs no I/O and does not enable acquisition.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from majorana_api.phase10_destination_policy import (
    ALLOWED_SOURCE_HOST,
    ALLOWED_SOURCE_PORT,
    DESTINATION_POLICY_VERSION,
    Phase10DestinationEvidence,
)
from majorana_api.phase10_retrieval_manifest import (
    Phase10RetrievalManifest,
    Phase10RetrievalManifestError,
    validate_phase10_repository_coordinate,
    validate_phase10_selected_paths,
)

ACQUISITION_REQUEST_SCHEMA_VERSION = 1
ACQUISITION_AUTHORIZATION_SCHEMA_VERSION = 1
ACQUISITION_CONNECTOR = "github_rest_selected_files"
ACQUISITION_OPERATION = "github_rest_repository_content_at_commit"
ACQUISITION_POLICY_VERSION = "phase10-s2-acquisition-request/1"


class Phase10AcquisitionContractError(ValueError):
    """An acquisition request, authorization, or result binding is invalid."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = False


@dataclasses.dataclass(frozen=True)
class Phase10AcquisitionRequest:
    """Canonical intent for selected files at one immutable GitHub commit."""

    repository_id: int
    full_name: str
    immutable_ref: str
    selected_paths: tuple[str, ...]
    requested_at: str
    connector: str = ACQUISITION_CONNECTOR
    policy_version: str = ACQUISITION_POLICY_VERSION

    def __post_init__(self) -> None:
        _validate_request(self)

    def body(self) -> dict[str, Any]:
        return {
            "request_schema_version": ACQUISITION_REQUEST_SCHEMA_VERSION,
            "connector": self.connector,
            "source_host": ALLOWED_SOURCE_HOST,
            "source_port": ALLOWED_SOURCE_PORT,
            "operation": ACQUISITION_OPERATION,
            "repository_id": self.repository_id,
            "full_name": self.full_name,
            "immutable_ref": self.immutable_ref,
            "selected_paths": list(self.selected_paths),
            "requested_at": self.requested_at,
            "policy_version": self.policy_version,
        }

    @property
    def request_sha256(self) -> str:
        return _canonical_sha256(self.body())

    def to_request(self) -> dict[str, Any]:
        return {**self.body(), "request_sha256": self.request_sha256}

    @classmethod
    def from_request(cls, payload: dict[str, Any]) -> Phase10AcquisitionRequest:
        if not isinstance(payload, dict) or set(payload) != {
            "request_schema_version",
            "connector",
            "source_host",
            "source_port",
            "operation",
            "repository_id",
            "full_name",
            "immutable_ref",
            "selected_paths",
            "requested_at",
            "policy_version",
            "request_sha256",
        }:
            raise Phase10AcquisitionContractError("invalid_acquisition_request")
        if payload["request_schema_version"] != ACQUISITION_REQUEST_SCHEMA_VERSION:
            raise Phase10AcquisitionContractError("unsupported_acquisition_request_version")
        if payload["source_host"] != ALLOWED_SOURCE_HOST:
            raise Phase10AcquisitionContractError("acquisition_source_host_mismatch")
        if payload["source_port"] != ALLOWED_SOURCE_PORT:
            raise Phase10AcquisitionContractError("acquisition_source_port_mismatch")
        if payload["operation"] != ACQUISITION_OPERATION:
            raise Phase10AcquisitionContractError("acquisition_operation_not_allowed")
        raw_paths = payload["selected_paths"]
        if not isinstance(raw_paths, list) or not all(isinstance(path, str) for path in raw_paths):
            raise Phase10AcquisitionContractError("invalid_acquisition_paths")
        request = cls(
            repository_id=payload["repository_id"],
            full_name=payload["full_name"],
            immutable_ref=payload["immutable_ref"],
            selected_paths=tuple(raw_paths),
            requested_at=payload["requested_at"],
            connector=payload["connector"],
            policy_version=payload["policy_version"],
        )
        claimed_digest = payload["request_sha256"]
        if not _is_sha256(claimed_digest):
            raise Phase10AcquisitionContractError("invalid_acquisition_request_digest")
        if claimed_digest != request.request_sha256:
            raise Phase10AcquisitionContractError("acquisition_request_digest_mismatch")
        return request


@dataclasses.dataclass(frozen=True)
class Phase10AcquisitionAuthorization:
    """Short-lived binding of acquisition intent to validated DNS evidence."""

    request: Phase10AcquisitionRequest
    destination: Phase10DestinationEvidence

    def __post_init__(self) -> None:
        _validate_authorization(self)

    def body(self) -> dict[str, Any]:
        return {
            "authorization_schema_version": ACQUISITION_AUTHORIZATION_SCHEMA_VERSION,
            "request": self.request.to_request(),
            "destination": self.destination.descriptor(),
        }

    @property
    def authorization_sha256(self) -> str:
        return _canonical_sha256(self.body())

    def to_authorization(self) -> dict[str, Any]:
        return {**self.body(), "authorization_sha256": self.authorization_sha256}

    def validate_manifest(self, manifest: Phase10RetrievalManifest) -> None:
        """Bind retrieved evidence to this exact request and DNS window."""

        if not isinstance(manifest, Phase10RetrievalManifest):
            raise Phase10AcquisitionContractError("invalid_acquisition_manifest")
        if (
            manifest.repository_id != self.request.repository_id
            or manifest.full_name != self.request.full_name
            or manifest.immutable_ref != self.request.immutable_ref
        ):
            raise Phase10AcquisitionContractError("acquisition_repository_binding_mismatch")
        manifest_paths = tuple(item.selected_path for item in manifest.files)
        if manifest_paths != self.request.selected_paths:
            raise Phase10AcquisitionContractError("acquisition_path_binding_mismatch")
        fetched_at = _parse_timestamp(manifest.fetched_at)
        requested_at = _parse_timestamp(self.request.requested_at)
        resolved_at = _parse_timestamp(self.destination.resolved_at)
        valid_until = _parse_timestamp(self.destination.valid_until)
        if fetched_at < requested_at:
            raise Phase10AcquisitionContractError("acquisition_fetched_before_request")
        if fetched_at < resolved_at or fetched_at > valid_until:
            raise Phase10AcquisitionContractError("acquisition_outside_destination_window")

    @classmethod
    def from_authorization(cls, payload: dict[str, Any]) -> Phase10AcquisitionAuthorization:
        if not isinstance(payload, dict) or set(payload) != {
            "authorization_schema_version",
            "request",
            "destination",
            "authorization_sha256",
        }:
            raise Phase10AcquisitionContractError("invalid_acquisition_authorization")
        if payload["authorization_schema_version"] != ACQUISITION_AUTHORIZATION_SCHEMA_VERSION:
            raise Phase10AcquisitionContractError("unsupported_acquisition_authorization_version")
        request = Phase10AcquisitionRequest.from_request(payload["request"])
        destination_payload = payload["destination"]
        if not isinstance(destination_payload, dict) or set(destination_payload) != {
            "host",
            "port",
            "addresses",
            "resolved_at",
            "valid_until",
            "policy_version",
        }:
            raise Phase10AcquisitionContractError("invalid_acquisition_destination")
        addresses = destination_payload["addresses"]
        if not isinstance(addresses, list) or not all(
            isinstance(address, str) for address in addresses
        ):
            raise Phase10AcquisitionContractError("invalid_acquisition_destination")
        try:
            destination = Phase10DestinationEvidence(
                host=destination_payload["host"],
                port=destination_payload["port"],
                addresses=tuple(addresses),
                resolved_at=destination_payload["resolved_at"],
                valid_until=destination_payload["valid_until"],
                policy_version=destination_payload["policy_version"],
            )
        except (TypeError, ValueError) as exc:
            raise Phase10AcquisitionContractError("invalid_acquisition_destination") from exc
        authorization = cls(request=request, destination=destination)
        claimed_digest = payload["authorization_sha256"]
        if not _is_sha256(claimed_digest):
            raise Phase10AcquisitionContractError("invalid_acquisition_authorization_digest")
        if claimed_digest != authorization.authorization_sha256:
            raise Phase10AcquisitionContractError("acquisition_authorization_digest_mismatch")
        return authorization


def build_phase10_acquisition_request(
    *,
    repository_id: int,
    full_name: str,
    immutable_ref: str,
    selected_paths: tuple[str, ...],
    requested_at: datetime,
) -> Phase10AcquisitionRequest:
    """Build canonical intent; no URL or transport options are accepted."""

    return Phase10AcquisitionRequest(
        repository_id=repository_id,
        full_name=full_name,
        immutable_ref=immutable_ref,
        selected_paths=tuple(sorted(selected_paths)),
        requested_at=_canonical_timestamp(requested_at),
    )


def _validate_request(request: Phase10AcquisitionRequest) -> None:
    if request.connector != ACQUISITION_CONNECTOR:
        raise Phase10AcquisitionContractError("acquisition_connector_not_allowed")
    if request.policy_version != ACQUISITION_POLICY_VERSION:
        raise Phase10AcquisitionContractError("unsupported_acquisition_policy")
    try:
        validate_phase10_repository_coordinate(
            repository_id=request.repository_id,
            full_name=request.full_name,
            immutable_ref=request.immutable_ref,
        )
        validate_phase10_selected_paths(request.selected_paths)
    except Phase10RetrievalManifestError as exc:
        raise Phase10AcquisitionContractError(exc.failure_code) from exc
    _parse_timestamp(request.requested_at)


def _validate_authorization(authorization: Phase10AcquisitionAuthorization) -> None:
    if not isinstance(authorization.request, Phase10AcquisitionRequest):
        raise Phase10AcquisitionContractError("invalid_acquisition_request")
    if not isinstance(authorization.destination, Phase10DestinationEvidence):
        raise Phase10AcquisitionContractError("invalid_acquisition_destination")
    if authorization.destination.host != ALLOWED_SOURCE_HOST:
        raise Phase10AcquisitionContractError("acquisition_source_host_mismatch")
    if authorization.destination.port != ALLOWED_SOURCE_PORT:
        raise Phase10AcquisitionContractError("acquisition_source_port_mismatch")
    if authorization.destination.policy_version != DESTINATION_POLICY_VERSION:
        raise Phase10AcquisitionContractError("unsupported_acquisition_destination_policy")
    requested_at = _parse_timestamp(authorization.request.requested_at)
    resolved_at = _parse_timestamp(authorization.destination.resolved_at)
    if resolved_at < requested_at:
        raise Phase10AcquisitionContractError("acquisition_resolution_before_request")


def _canonical_timestamp(value: datetime) -> str:
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise Phase10AcquisitionContractError("invalid_acquisition_timestamp")
    normalized = value.astimezone(UTC).replace(microsecond=0)
    return normalized.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_timestamp(value: str) -> datetime:
    if not isinstance(value, str):
        raise Phase10AcquisitionContractError("invalid_acquisition_timestamp")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except ValueError as exc:
        raise Phase10AcquisitionContractError("invalid_acquisition_timestamp") from exc
    if parsed.strftime("%Y-%m-%dT%H:%M:%SZ") != value:
        raise Phase10AcquisitionContractError("invalid_acquisition_timestamp")
    return parsed


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _is_sha256(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )
