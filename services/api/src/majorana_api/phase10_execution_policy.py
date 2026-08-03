"""Fail-closed Phase 10 execution-policy and qualification candidates.

This module is intentionally pure and I/O-free.  It can bind an exact OCI
index digest, an exact policy proposal, and an exact S6 source candidate, but
it cannot approve any of them.  Qualification remains an owner-controlled
deployment decision supplied through a separate trusted registry.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
from collections.abc import Mapping
from typing import Any

from majorana_api.phase10_static_candidate import (
    FIXED_LAUNCHER_ID,
    INPUT_SCHEMA_ID,
    OUTPUT_SCHEMA_ID,
    Phase10StaticExecutionCandidate,
)

EXECUTION_POLICY_SCHEMA_VERSION = 1
EXECUTION_POLICY_CONTRACT_VERSION = "phase10-s7-execution-policy/1"
QUALIFICATION_IDENTITY_SCHEMA_VERSION = 1
QUALIFICATION_IDENTITY_CONTRACT_VERSION = "phase10-s7-qualification-identity/1"
QUALIFICATION_SELECTION_SCHEMA_VERSION = 1
QUALIFICATION_SELECTION_CONTRACT_VERSION = "phase10-s7-qualification-selection/1"

POLICY_STATUS = "unqualified"
QUALIFICATION_STATUS = "unqualified"
REQUIRED_PLATFORM = "linux/amd64"
NETWORK_POLICY = "deny_all"
CREDENTIAL_POLICY = "none"
RETRY_POLICY = "manual_new_attempt_identity_only"

FIXED_LAUNCHER_ARGUMENTS = (
    "--input-json",
    "/atlas/input/request.json",
    "--output-json",
    "/atlas/result/result.json",
)
FIXED_FILE_ROOTS = (
    ("/atlas/source", "read_only"),
    ("/atlas/input", "read_only"),
    ("/atlas/result", "write_only_for_source"),
    ("/atlas/scratch", "read_write_ephemeral"),
)
DETERMINISM_CONTROLS = (
    ("seed", "required_in_input_binding"),
    ("locale", "C.UTF-8"),
    ("timezone", "UTC"),
    ("python_hash_seed", "0"),
)
BINDING_REQUIREMENTS = (
    "repository_immutable_ref",
    "retrieval_manifest_sha256",
    "normalized_source_manifest_sha256",
    "static_candidate_sha256",
    "policy_sha256",
    "input_sha256",
    "result_sha256",
)
FAILURE_TAXONOMY = (
    "policy_rejected",
    "runtime_digest_mismatch",
    "platform_mismatch",
    "source_binding_mismatch",
    "input_binding_mismatch",
    "network_policy_violation",
    "credential_policy_violation",
    "resource_limit_exceeded",
    "wall_time_exceeded",
    "output_limit_exceeded",
    "launcher_failed",
    "result_schema_invalid",
    "transient_infrastructure_failure",
)
POLICY_BLOCKING_REASONS = (
    "owner_security_decision_pending",
    "runtime_digest_not_live_verified",
    "sandbox_class_not_live_qualified",
)

_OCI_INDEX_DIGEST_RE = re.compile(r"sha256:[0-9a-f]{64}")
_SHA256_RE = re.compile(r"[0-9a-f]{64}")
_COMMIT_RE = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
_FULL_NAME_RE = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?/[A-Za-z0-9_.-]+")
_IDENTIFIER_RE = re.compile(r"[a-z0-9][a-z0-9._/-]{0,127}")
_QUALIFICATION_ID_RE = re.compile(r"phase10-qic:[0-9a-f]{64}")
_SUPPORTED_RUNTIME_PROFILES = frozenset(
    {
        "phase10-python-pennylane-0.45.1-candidate-v1",
        "phase10-python-qiskit-1.4.6-candidate-v1",
    }
)


class Phase10ExecutionPolicyError(ValueError):
    """An S7 policy or qualification value is invalid or unapproved."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = False


@dataclasses.dataclass(frozen=True)
class Phase10ExecutionLimits:
    """Proposed exact limits; this object does not certify their safety."""

    cpu_millis: int
    memory_bytes: int
    pids: int
    scratch_bytes: int
    total_file_bytes: int
    file_count: int
    wall_time_ms: int
    stdout_bytes: int
    stderr_bytes: int
    result_bytes: int

    def __post_init__(self) -> None:
        for value in dataclasses.asdict(self).values():
            if (
                not isinstance(value, int)
                or isinstance(value, bool)
                or value <= 0
                or value > (2**63 - 1)
            ):
                raise Phase10ExecutionPolicyError("invalid_execution_limit")

    def descriptor(self) -> dict[str, int]:
        return dataclasses.asdict(self)

    @classmethod
    def from_descriptor(cls, value: Any) -> Phase10ExecutionLimits:
        expected = {field.name for field in dataclasses.fields(cls)}
        if not isinstance(value, dict) or set(value) != expected:
            raise Phase10ExecutionPolicyError("invalid_execution_limits")
        return cls(**value)


@dataclasses.dataclass(frozen=True)
class Phase10ExecutionPolicyCandidate:
    """Canonical but explicitly unqualified execution-policy proposal."""

    runtime_profile: str
    runtime_oci_index_digest: str
    sandbox_class: str
    limits: Phase10ExecutionLimits
    status: str = POLICY_STATUS
    platform: str = REQUIRED_PLATFORM
    launcher_id: str = FIXED_LAUNCHER_ID
    launcher_arguments: tuple[str, ...] = FIXED_LAUNCHER_ARGUMENTS
    file_roots: tuple[tuple[str, str], ...] = FIXED_FILE_ROOTS
    network_policy: str = NETWORK_POLICY
    credential_policy: str = CREDENTIAL_POLICY
    determinism_controls: tuple[tuple[str, str], ...] = DETERMINISM_CONTROLS
    binding_requirements: tuple[str, ...] = BINDING_REQUIREMENTS
    failure_taxonomy: tuple[str, ...] = FAILURE_TAXONOMY
    retry_policy: str = RETRY_POLICY
    input_schema_id: str = INPUT_SCHEMA_ID
    output_schema_id: str = OUTPUT_SCHEMA_ID
    blocking_reasons: tuple[str, ...] = POLICY_BLOCKING_REASONS
    contract_version: str = EXECUTION_POLICY_CONTRACT_VERSION

    def __post_init__(self) -> None:
        _validate_policy(self)

    def body(self) -> dict[str, Any]:
        return {
            "policy_schema_version": EXECUTION_POLICY_SCHEMA_VERSION,
            "contract_version": self.contract_version,
            "status": self.status,
            "runtime_profile": self.runtime_profile,
            "runtime_oci_index_digest": self.runtime_oci_index_digest,
            "platform": self.platform,
            "sandbox_class": self.sandbox_class,
            "launcher_id": self.launcher_id,
            "launcher_arguments": list(self.launcher_arguments),
            "file_roots": [{"path": path, "access": access} for path, access in self.file_roots],
            "limits": self.limits.descriptor(),
            "network_policy": self.network_policy,
            "credential_policy": self.credential_policy,
            "determinism_controls": {key: value for key, value in self.determinism_controls},
            "binding_requirements": list(self.binding_requirements),
            "failure_taxonomy": list(self.failure_taxonomy),
            "retry_policy": self.retry_policy,
            "input_schema_id": self.input_schema_id,
            "output_schema_id": self.output_schema_id,
            "blocking_reasons": list(self.blocking_reasons),
        }

    @property
    def policy_sha256(self) -> str:
        return _canonical_sha256(self.body())

    def to_candidate(self) -> dict[str, Any]:
        return {**self.body(), "policy_sha256": self.policy_sha256}

    @classmethod
    def from_candidate(cls, payload: dict[str, Any]) -> Phase10ExecutionPolicyCandidate:
        expected = {
            "policy_schema_version",
            "contract_version",
            "status",
            "runtime_profile",
            "runtime_oci_index_digest",
            "platform",
            "sandbox_class",
            "launcher_id",
            "launcher_arguments",
            "file_roots",
            "limits",
            "network_policy",
            "credential_policy",
            "determinism_controls",
            "binding_requirements",
            "failure_taxonomy",
            "retry_policy",
            "input_schema_id",
            "output_schema_id",
            "blocking_reasons",
            "policy_sha256",
        }
        if not isinstance(payload, dict) or set(payload) != expected:
            raise Phase10ExecutionPolicyError("invalid_execution_policy")
        if payload["policy_schema_version"] != EXECUTION_POLICY_SCHEMA_VERSION:
            raise Phase10ExecutionPolicyError("unsupported_execution_policy_schema")
        list_fields = (
            "launcher_arguments",
            "file_roots",
            "binding_requirements",
            "failure_taxonomy",
            "blocking_reasons",
        )
        if any(not isinstance(payload[field], list) for field in list_fields):
            raise Phase10ExecutionPolicyError("invalid_execution_policy")
        determinism = payload["determinism_controls"]
        determinism_keys = tuple(key for key, _ in DETERMINISM_CONTROLS)
        if not isinstance(determinism, dict) or set(determinism) != set(determinism_keys):
            raise Phase10ExecutionPolicyError("invalid_execution_policy")
        policy = cls(
            runtime_profile=payload["runtime_profile"],
            runtime_oci_index_digest=payload["runtime_oci_index_digest"],
            sandbox_class=payload["sandbox_class"],
            limits=Phase10ExecutionLimits.from_descriptor(payload["limits"]),
            status=payload["status"],
            platform=payload["platform"],
            launcher_id=payload["launcher_id"],
            launcher_arguments=tuple(payload["launcher_arguments"]),
            file_roots=_file_roots_from_descriptors(payload["file_roots"]),
            network_policy=payload["network_policy"],
            credential_policy=payload["credential_policy"],
            determinism_controls=tuple((key, determinism[key]) for key in determinism_keys),
            binding_requirements=tuple(payload["binding_requirements"]),
            failure_taxonomy=tuple(payload["failure_taxonomy"]),
            retry_policy=payload["retry_policy"],
            input_schema_id=payload["input_schema_id"],
            output_schema_id=payload["output_schema_id"],
            blocking_reasons=tuple(payload["blocking_reasons"]),
            contract_version=payload["contract_version"],
        )
        claimed = payload["policy_sha256"]
        if not _is_sha256(claimed):
            raise Phase10ExecutionPolicyError("invalid_execution_policy_digest")
        if claimed != policy.policy_sha256:
            raise Phase10ExecutionPolicyError("execution_policy_digest_mismatch")
        return policy


@dataclasses.dataclass(frozen=True)
class Phase10QualificationIdentityCandidate:
    """Exact source × runtime × policy binding, still not an approval."""

    repository_id: int
    full_name: str
    immutable_ref: str
    retrieval_manifest_sha256: str
    normalized_source_manifest_sha256: str
    static_candidate_sha256: str
    policy_sha256: str
    runtime_oci_index_digest: str
    platform: str
    status: str = QUALIFICATION_STATUS
    blocking_reasons: tuple[str, ...] = POLICY_BLOCKING_REASONS
    contract_version: str = QUALIFICATION_IDENTITY_CONTRACT_VERSION

    def __post_init__(self) -> None:
        _validate_qualification_identity(self)

    def body(self) -> dict[str, Any]:
        return {
            "qualification_identity_schema_version": (QUALIFICATION_IDENTITY_SCHEMA_VERSION),
            "contract_version": self.contract_version,
            "status": self.status,
            "repository_id": self.repository_id,
            "full_name": self.full_name,
            "immutable_ref": self.immutable_ref,
            "retrieval_manifest_sha256": self.retrieval_manifest_sha256,
            "normalized_source_manifest_sha256": (self.normalized_source_manifest_sha256),
            "static_candidate_sha256": self.static_candidate_sha256,
            "policy_sha256": self.policy_sha256,
            "runtime_oci_index_digest": self.runtime_oci_index_digest,
            "platform": self.platform,
            "blocking_reasons": list(self.blocking_reasons),
        }

    @property
    def identity_sha256(self) -> str:
        return _canonical_sha256(self.body())

    @property
    def candidate_qualification_identity(self) -> str:
        return f"phase10-qic:{self.identity_sha256}"

    def to_candidate(self) -> dict[str, Any]:
        return {
            **self.body(),
            "identity_sha256": self.identity_sha256,
            "candidate_qualification_identity": self.candidate_qualification_identity,
        }

    @classmethod
    def from_candidate(cls, payload: dict[str, Any]) -> Phase10QualificationIdentityCandidate:
        expected = {
            "qualification_identity_schema_version",
            "contract_version",
            "status",
            "repository_id",
            "full_name",
            "immutable_ref",
            "retrieval_manifest_sha256",
            "normalized_source_manifest_sha256",
            "static_candidate_sha256",
            "policy_sha256",
            "runtime_oci_index_digest",
            "platform",
            "blocking_reasons",
            "identity_sha256",
            "candidate_qualification_identity",
        }
        if not isinstance(payload, dict) or set(payload) != expected:
            raise Phase10ExecutionPolicyError("invalid_qualification_identity")
        if (
            payload["qualification_identity_schema_version"]
            != QUALIFICATION_IDENTITY_SCHEMA_VERSION
        ):
            raise Phase10ExecutionPolicyError("unsupported_qualification_identity_schema")
        if not isinstance(payload["blocking_reasons"], list):
            raise Phase10ExecutionPolicyError("invalid_qualification_identity")
        identity = cls(
            repository_id=payload["repository_id"],
            full_name=payload["full_name"],
            immutable_ref=payload["immutable_ref"],
            retrieval_manifest_sha256=payload["retrieval_manifest_sha256"],
            normalized_source_manifest_sha256=payload["normalized_source_manifest_sha256"],
            static_candidate_sha256=payload["static_candidate_sha256"],
            policy_sha256=payload["policy_sha256"],
            runtime_oci_index_digest=payload["runtime_oci_index_digest"],
            platform=payload["platform"],
            status=payload["status"],
            blocking_reasons=tuple(payload["blocking_reasons"]),
            contract_version=payload["contract_version"],
        )
        claimed_digest = payload["identity_sha256"]
        if not _is_sha256(claimed_digest):
            raise Phase10ExecutionPolicyError("invalid_qualification_identity_digest")
        if claimed_digest != identity.identity_sha256:
            raise Phase10ExecutionPolicyError("qualification_identity_digest_mismatch")
        if payload["candidate_qualification_identity"] != identity.candidate_qualification_identity:
            raise Phase10ExecutionPolicyError("qualification_identity_name_mismatch")
        return identity


@dataclasses.dataclass(frozen=True)
class Phase10QualificationSelection:
    """The entire client-selectable surface: one approved opaque identity."""

    qualification_identity: str
    expected_policy_sha256: str
    contract_version: str = QUALIFICATION_SELECTION_CONTRACT_VERSION

    def __post_init__(self) -> None:
        if (
            self.contract_version != QUALIFICATION_SELECTION_CONTRACT_VERSION
            or not isinstance(self.qualification_identity, str)
            or _QUALIFICATION_ID_RE.fullmatch(self.qualification_identity) is None
            or not _is_sha256(self.expected_policy_sha256)
        ):
            raise Phase10ExecutionPolicyError("invalid_qualification_selection")

    def to_selection(self) -> dict[str, str | int]:
        return {
            "selection_schema_version": QUALIFICATION_SELECTION_SCHEMA_VERSION,
            "contract_version": self.contract_version,
            "qualification_identity": self.qualification_identity,
            "expected_policy_sha256": self.expected_policy_sha256,
        }

    @classmethod
    def from_selection(cls, payload: dict[str, Any]) -> Phase10QualificationSelection:
        if not isinstance(payload, dict) or set(payload) != {
            "selection_schema_version",
            "contract_version",
            "qualification_identity",
            "expected_policy_sha256",
        }:
            raise Phase10ExecutionPolicyError("invalid_qualification_selection")
        if payload["selection_schema_version"] != QUALIFICATION_SELECTION_SCHEMA_VERSION:
            raise Phase10ExecutionPolicyError("unsupported_qualification_selection_schema")
        return cls(
            qualification_identity=payload["qualification_identity"],
            expected_policy_sha256=payload["expected_policy_sha256"],
            contract_version=payload["contract_version"],
        )


def build_phase10_execution_policy_candidate(
    *,
    runtime_profile: str,
    runtime_oci_index_digest: str,
    sandbox_class: str,
    limits: Phase10ExecutionLimits,
) -> Phase10ExecutionPolicyCandidate:
    """Build an unqualified policy proposal without choosing safety values."""

    return Phase10ExecutionPolicyCandidate(
        runtime_profile=runtime_profile,
        runtime_oci_index_digest=runtime_oci_index_digest,
        sandbox_class=sandbox_class,
        limits=limits,
    )


def build_phase10_qualification_identity_candidate(
    *,
    repository_id: int,
    full_name: str,
    immutable_ref: str,
    retrieval_manifest_sha256: str,
    static_candidate: Phase10StaticExecutionCandidate,
    policy: Phase10ExecutionPolicyCandidate,
) -> Phase10QualificationIdentityCandidate:
    if not isinstance(static_candidate, Phase10StaticExecutionCandidate):
        raise Phase10ExecutionPolicyError("invalid_static_candidate_parent")
    if not isinstance(policy, Phase10ExecutionPolicyCandidate):
        raise Phase10ExecutionPolicyError("invalid_execution_policy_parent")
    if static_candidate.proposed_runtime_profile != policy.runtime_profile:
        raise Phase10ExecutionPolicyError("candidate_policy_runtime_mismatch")
    reasons = tuple(dict.fromkeys((*policy.blocking_reasons, *static_candidate.blocking_reasons)))
    return Phase10QualificationIdentityCandidate(
        repository_id=repository_id,
        full_name=full_name,
        immutable_ref=immutable_ref,
        retrieval_manifest_sha256=retrieval_manifest_sha256,
        normalized_source_manifest_sha256=(static_candidate.normalized_source_manifest_sha256),
        static_candidate_sha256=static_candidate.candidate_sha256,
        policy_sha256=policy.policy_sha256,
        runtime_oci_index_digest=policy.runtime_oci_index_digest,
        platform=policy.platform,
        blocking_reasons=reasons,
    )


def resolve_approved_qualification_selection(
    *,
    selection: Phase10QualificationSelection,
    approved_identity_policy_digests: Mapping[str, str],
) -> str:
    """Resolve only an exact identity from a deployment-owned trusted registry.

    This function cannot create approvals.  The caller is responsible for
    loading the mapping from a reviewed, access-controlled configuration.
    """

    if not isinstance(selection, Phase10QualificationSelection):
        raise Phase10ExecutionPolicyError("invalid_qualification_selection")
    if not isinstance(approved_identity_policy_digests, Mapping):
        raise Phase10ExecutionPolicyError("invalid_qualification_registry")
    approved_digest = approved_identity_policy_digests.get(selection.qualification_identity)
    if approved_digest is None:
        raise Phase10ExecutionPolicyError("qualification_identity_not_approved")
    if not _is_sha256(approved_digest):
        raise Phase10ExecutionPolicyError("invalid_qualification_registry")
    if approved_digest != selection.expected_policy_sha256:
        raise Phase10ExecutionPolicyError("qualification_policy_digest_mismatch")
    return selection.qualification_identity


def _validate_policy(policy: Phase10ExecutionPolicyCandidate) -> None:
    if policy.contract_version != EXECUTION_POLICY_CONTRACT_VERSION:
        raise Phase10ExecutionPolicyError("unsupported_execution_policy_contract")
    if policy.status != POLICY_STATUS:
        raise Phase10ExecutionPolicyError("execution_policy_not_owner_qualified")
    if policy.runtime_profile not in _SUPPORTED_RUNTIME_PROFILES:
        raise Phase10ExecutionPolicyError("unsupported_execution_runtime_profile")
    if (
        not isinstance(policy.runtime_oci_index_digest, str)
        or _OCI_INDEX_DIGEST_RE.fullmatch(policy.runtime_oci_index_digest) is None
    ):
        raise Phase10ExecutionPolicyError("invalid_runtime_oci_index_digest")
    if policy.platform != REQUIRED_PLATFORM:
        raise Phase10ExecutionPolicyError("unsupported_execution_platform")
    if (
        not isinstance(policy.sandbox_class, str)
        or _IDENTIFIER_RE.fullmatch(policy.sandbox_class) is None
    ):
        raise Phase10ExecutionPolicyError("invalid_sandbox_class")
    if not isinstance(policy.limits, Phase10ExecutionLimits):
        raise Phase10ExecutionPolicyError("invalid_execution_limits")
    if (
        policy.launcher_id != FIXED_LAUNCHER_ID
        or policy.launcher_arguments != FIXED_LAUNCHER_ARGUMENTS
        or policy.file_roots != FIXED_FILE_ROOTS
        or policy.network_policy != NETWORK_POLICY
        or policy.credential_policy != CREDENTIAL_POLICY
        or policy.determinism_controls != DETERMINISM_CONTROLS
        or policy.binding_requirements != BINDING_REQUIREMENTS
        or policy.failure_taxonomy != FAILURE_TAXONOMY
        or policy.retry_policy != RETRY_POLICY
        or policy.input_schema_id != INPUT_SCHEMA_ID
        or policy.output_schema_id != OUTPUT_SCHEMA_ID
    ):
        raise Phase10ExecutionPolicyError("unapproved_execution_policy_surface")
    if policy.blocking_reasons != POLICY_BLOCKING_REASONS:
        raise Phase10ExecutionPolicyError("invalid_execution_policy_blockers")


def _validate_qualification_identity(
    identity: Phase10QualificationIdentityCandidate,
) -> None:
    if identity.contract_version != QUALIFICATION_IDENTITY_CONTRACT_VERSION:
        raise Phase10ExecutionPolicyError("unsupported_qualification_identity_contract")
    if identity.status != QUALIFICATION_STATUS:
        raise Phase10ExecutionPolicyError("qualification_identity_not_approved")
    if (
        not isinstance(identity.repository_id, int)
        or isinstance(identity.repository_id, bool)
        or identity.repository_id <= 0
        or not isinstance(identity.full_name, str)
        or _FULL_NAME_RE.fullmatch(identity.full_name) is None
        or not isinstance(identity.immutable_ref, str)
        or _COMMIT_RE.fullmatch(identity.immutable_ref) is None
    ):
        raise Phase10ExecutionPolicyError("invalid_qualification_source_identity")
    digests = (
        identity.retrieval_manifest_sha256,
        identity.normalized_source_manifest_sha256,
        identity.static_candidate_sha256,
        identity.policy_sha256,
    )
    if any(not _is_sha256(value) for value in digests):
        raise Phase10ExecutionPolicyError("invalid_qualification_binding_digest")
    if (
        _OCI_INDEX_DIGEST_RE.fullmatch(identity.runtime_oci_index_digest) is None
        or identity.platform != REQUIRED_PLATFORM
    ):
        raise Phase10ExecutionPolicyError("invalid_qualification_runtime_identity")
    if (
        not isinstance(identity.blocking_reasons, tuple)
        or not identity.blocking_reasons
        or identity.blocking_reasons[: len(POLICY_BLOCKING_REASONS)] != POLICY_BLOCKING_REASONS
        or len(set(identity.blocking_reasons)) != len(identity.blocking_reasons)
        or any(
            not isinstance(reason, str) or _IDENTIFIER_RE.fullmatch(reason) is None
            for reason in identity.blocking_reasons
        )
    ):
        raise Phase10ExecutionPolicyError("invalid_qualification_blockers")


def _file_roots_from_descriptors(value: list[Any]) -> tuple[tuple[str, str], ...]:
    roots: list[tuple[str, str]] = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {"path", "access"}:
            raise Phase10ExecutionPolicyError("invalid_execution_policy")
        roots.append((item["path"], item["access"]))
    return tuple(roots)


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
