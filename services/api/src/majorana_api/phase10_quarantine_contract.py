"""Provider-neutral, I/O-free Phase 10 quarantine object contract.

The contract derives opaque content-addressed identities from a complete
acquisition result.  It does not choose a cloud provider, create a bucket,
grant access, upload, download, persist, parse, import, publish, or execute.
Future storage code must remain workspace scoped and may record a receipt only
after byte-for-byte readback verification through this contract.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
import uuid
from typing import Any

from majorana_api.phase10_acquisition_result import Phase10AcquisitionResult
from majorana_api.phase10_retrieval_manifest import (
    ALLOWED_TEXT_MEDIA_TYPES,
    MAX_SELECTED_FILE_BYTES,
    Phase10RetrievalManifestError,
    validate_phase10_selected_paths,
)

QUARANTINE_PLAN_SCHEMA_VERSION = 1
QUARANTINE_CONTRACT_VERSION = "phase10-s3-quarantine-preflight/1"
QUARANTINE_OBJECT_CLASS = "private_external_source_quarantine"
QUARANTINE_LOCATOR_PREFIX = "qobj:v1:sha256:"
QUARANTINE_KEY_PREFIX = "phase10/sha256"

_SHA256_RE = re.compile(r"[0-9a-f]{64}")


class Phase10QuarantineContractError(ValueError):
    """A quarantine plan or readback is unscoped, altered, or inconsistent."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = False


@dataclasses.dataclass(frozen=True)
class QuarantineObjectPlan:
    """Opaque storage identity for one selected source file."""

    selected_path: str
    media_type: str
    length: int
    sha256: str
    opaque_locator: str
    internal_object_key: str

    def descriptor(self) -> dict[str, str | int]:
        return dataclasses.asdict(self)


@dataclasses.dataclass(frozen=True)
class Phase10QuarantinePlan:
    """Workspace-scoped content-addressed plan with no storage credentials."""

    workspace_id: str
    acquisition_result_sha256: str
    objects: tuple[QuarantineObjectPlan, ...]
    object_class: str = QUARANTINE_OBJECT_CLASS
    contract_version: str = QUARANTINE_CONTRACT_VERSION

    def __post_init__(self) -> None:
        _validate_plan(self)

    def body(self) -> dict[str, Any]:
        return {
            "plan_schema_version": QUARANTINE_PLAN_SCHEMA_VERSION,
            "contract_version": self.contract_version,
            "object_class": self.object_class,
            "workspace_id": self.workspace_id,
            "acquisition_result_sha256": self.acquisition_result_sha256,
            "objects": [item.descriptor() for item in self.objects],
        }

    @property
    def plan_sha256(self) -> str:
        return _canonical_sha256(self.body())

    def to_plan(self) -> dict[str, Any]:
        return {**self.body(), "plan_sha256": self.plan_sha256}

    def require_workspace(self, workspace_id: uuid.UUID) -> None:
        """Reject attempts to reuse an opaque locator from another workspace."""

        canonical = _canonical_workspace_id(workspace_id)
        if canonical != self.workspace_id:
            raise Phase10QuarantineContractError("quarantine_cross_workspace_denied")

    def object(self, selected_path: str) -> QuarantineObjectPlan:
        matches = tuple(item for item in self.objects if item.selected_path == selected_path)
        if len(matches) != 1:
            raise Phase10QuarantineContractError("quarantine_path_not_in_plan")
        return matches[0]

    def verify_readback(self, *, selected_path: str, content: bytes) -> None:
        """Verify already-read storage bytes without performing storage I/O."""

        item = self.object(selected_path)
        if not isinstance(content, bytes):
            raise Phase10QuarantineContractError("invalid_quarantine_readback")
        if len(content) != item.length:
            raise Phase10QuarantineContractError("quarantine_readback_length_mismatch")
        if hashlib.sha256(content).hexdigest() != item.sha256:
            raise Phase10QuarantineContractError("quarantine_readback_digest_mismatch")

    @classmethod
    def from_plan(cls, payload: dict[str, Any]) -> Phase10QuarantinePlan:
        if not isinstance(payload, dict) or set(payload) != {
            "plan_schema_version",
            "contract_version",
            "object_class",
            "workspace_id",
            "acquisition_result_sha256",
            "objects",
            "plan_sha256",
        }:
            raise Phase10QuarantineContractError("invalid_quarantine_plan")
        if payload["plan_schema_version"] != QUARANTINE_PLAN_SCHEMA_VERSION:
            raise Phase10QuarantineContractError("unsupported_quarantine_plan_schema")
        raw_objects = payload["objects"]
        if not isinstance(raw_objects, list):
            raise Phase10QuarantineContractError("invalid_quarantine_objects")
        plan = cls(
            workspace_id=payload["workspace_id"],
            acquisition_result_sha256=payload["acquisition_result_sha256"],
            objects=tuple(_object_from_descriptor(item) for item in raw_objects),
            object_class=payload["object_class"],
            contract_version=payload["contract_version"],
        )
        claimed_digest = payload["plan_sha256"]
        if not _is_sha256(claimed_digest):
            raise Phase10QuarantineContractError("invalid_quarantine_plan_digest")
        if claimed_digest != plan.plan_sha256:
            raise Phase10QuarantineContractError("quarantine_plan_digest_mismatch")
        return plan


def build_phase10_quarantine_plan(
    *,
    workspace_id: uuid.UUID,
    acquisition_result: Phase10AcquisitionResult,
) -> Phase10QuarantinePlan:
    """Derive storage identities from complete evidence without source bytes."""

    if not isinstance(acquisition_result, Phase10AcquisitionResult):
        raise Phase10QuarantineContractError("invalid_quarantine_acquisition_result")
    return Phase10QuarantinePlan(
        workspace_id=_canonical_workspace_id(workspace_id),
        acquisition_result_sha256=acquisition_result.result_sha256,
        objects=tuple(
            _object_plan(
                selected_path=item.selected_path,
                media_type=item.media_type,
                length=item.length,
                sha256=item.sha256,
            )
            for item in acquisition_result.retrieval_manifest.files
        ),
    )


def _object_plan(
    *,
    selected_path: str,
    media_type: str,
    length: int,
    sha256: str,
) -> QuarantineObjectPlan:
    return QuarantineObjectPlan(
        selected_path=selected_path,
        media_type=media_type,
        length=length,
        sha256=sha256,
        opaque_locator=f"{QUARANTINE_LOCATOR_PREFIX}{sha256}",
        internal_object_key=f"{QUARANTINE_KEY_PREFIX}/{sha256[:2]}/{sha256[2:]}",
    )


def _object_from_descriptor(value: Any) -> QuarantineObjectPlan:
    if not isinstance(value, dict) or set(value) != {
        "selected_path",
        "media_type",
        "length",
        "sha256",
        "opaque_locator",
        "internal_object_key",
    }:
        raise Phase10QuarantineContractError("invalid_quarantine_object")
    item = QuarantineObjectPlan(
        selected_path=value["selected_path"],
        media_type=value["media_type"],
        length=value["length"],
        sha256=value["sha256"],
        opaque_locator=value["opaque_locator"],
        internal_object_key=value["internal_object_key"],
    )
    _validate_object(item)
    return item


def _validate_plan(plan: Phase10QuarantinePlan) -> None:
    _parse_workspace_id(plan.workspace_id)
    if not _is_sha256(plan.acquisition_result_sha256):
        raise Phase10QuarantineContractError("invalid_quarantine_result_digest")
    if plan.object_class != QUARANTINE_OBJECT_CLASS:
        raise Phase10QuarantineContractError("unsupported_quarantine_object_class")
    if plan.contract_version != QUARANTINE_CONTRACT_VERSION:
        raise Phase10QuarantineContractError("unsupported_quarantine_contract")
    if not isinstance(plan.objects, tuple) or not plan.objects:
        raise Phase10QuarantineContractError("empty_quarantine_plan")
    paths = tuple(item.selected_path for item in plan.objects)
    try:
        validate_phase10_selected_paths(paths)
    except Phase10RetrievalManifestError as exc:
        raise Phase10QuarantineContractError(exc.failure_code) from exc
    for item in plan.objects:
        _validate_object(item)


def _validate_object(item: QuarantineObjectPlan) -> None:
    if (
        not isinstance(item.selected_path, str)
        or not item.selected_path
        or not isinstance(item.media_type, str)
        or item.media_type not in ALLOWED_TEXT_MEDIA_TYPES
        or not isinstance(item.length, int)
        or isinstance(item.length, bool)
        or item.length < 0
        or item.length > MAX_SELECTED_FILE_BYTES
        or not _is_sha256(item.sha256)
    ):
        raise Phase10QuarantineContractError("invalid_quarantine_object")
    expected = _object_plan(
        selected_path=item.selected_path,
        media_type=item.media_type,
        length=item.length,
        sha256=item.sha256,
    )
    if item != expected:
        raise Phase10QuarantineContractError("noncanonical_quarantine_object_identity")


def _canonical_workspace_id(value: uuid.UUID) -> str:
    if not isinstance(value, uuid.UUID) or value.int == 0:
        raise Phase10QuarantineContractError("invalid_quarantine_workspace")
    return str(value)


def _parse_workspace_id(value: str) -> uuid.UUID:
    if not isinstance(value, str):
        raise Phase10QuarantineContractError("invalid_quarantine_workspace")
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError) as exc:
        raise Phase10QuarantineContractError("invalid_quarantine_workspace") from exc
    if parsed.int == 0 or str(parsed) != value:
        raise Phase10QuarantineContractError("invalid_quarantine_workspace")
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
    return isinstance(value, str) and _SHA256_RE.fullmatch(value) is not None
