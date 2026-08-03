"""Pure evidence contract for Phase 10 hardened-executor probes.

No probe is executed here.  The module only validates bounded observations
produced by a future independent harness.  Even a complete passing observation
remains unqualified until the external owner/security review is recorded.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from majorana_api.phase10_execution_policy import (
    REQUIRED_PLATFORM,
    Phase10QualificationIdentityCandidate,
)

EXECUTOR_PROBE_SCHEMA_VERSION = 1
EXECUTOR_PROBE_CONTRACT_VERSION = "phase10-s8-executor-probe/1"
EXECUTOR_QUALIFICATION_STATUS = "unqualified"
EXECUTOR_BLOCKING_REASONS = (
    "live_executor_owner_review_pending",
    "hostile_corpus_qualification_pending",
    "independent_runtime_attestation_pending",
)

REQUIRED_EXECUTOR_PROBES = (
    "runtime.index_digest_verified",
    "runtime.platform_verified",
    "runtime.image_prepulled",
    "network.ipv4_blocked",
    "network.ipv6_blocked",
    "network.dns_blocked",
    "network.unix_socket_blocked",
    "network.metadata_blocked",
    "identity.non_root_uid",
    "identity.non_root_gid",
    "filesystem.root_read_only",
    "privilege.capabilities_dropped",
    "privilege.no_new_privileges",
    "mounts.host_none",
    "mounts.daemon_socket_none",
    "environment.exact_allowlist",
    "scratch.bounded",
    "timeout.graceful_then_forced",
    "cleanup.complete",
    "output.stdout_bounded",
    "output.stderr_bounded",
    "output.result_bounded",
)

_EXPECTED_FAILURE_CODES = {
    "runtime.index_digest_verified": "runtime_digest_mismatch",
    "runtime.platform_verified": "platform_mismatch",
    "runtime.image_prepulled": "runtime_pull_during_execution",
    "network.ipv4_blocked": "network_isolation_failed",
    "network.ipv6_blocked": "network_isolation_failed",
    "network.dns_blocked": "network_isolation_failed",
    "network.unix_socket_blocked": "network_isolation_failed",
    "network.metadata_blocked": "network_isolation_failed",
    "identity.non_root_uid": "runtime_identity_isolation_failed",
    "identity.non_root_gid": "runtime_identity_isolation_failed",
    "filesystem.root_read_only": "filesystem_isolation_failed",
    "privilege.capabilities_dropped": "runtime_privilege_isolation_failed",
    "privilege.no_new_privileges": "runtime_privilege_isolation_failed",
    "mounts.host_none": "runtime_mount_isolation_failed",
    "mounts.daemon_socket_none": "runtime_mount_isolation_failed",
    "environment.exact_allowlist": "credential_isolation_failed",
    "scratch.bounded": "resource_limit_exceeded",
    "timeout.graceful_then_forced": "execution_timeout",
    "cleanup.complete": "cleanup_failed",
    "output.stdout_bounded": "output_limit_exceeded",
    "output.stderr_bounded": "output_limit_exceeded",
    "output.result_bounded": "output_limit_exceeded",
}

_SHA256_RE = re.compile(r"[0-9a-f]{64}")
_OCI_INDEX_DIGEST_RE = re.compile(r"sha256:[0-9a-f]{64}")
_QUALIFICATION_ID_RE = re.compile(r"phase10-qic:[0-9a-f]{64}")
_DEPLOYMENT_CLASS_RE = re.compile(r"[a-z0-9][a-z0-9._/-]{0,127}")


class Phase10ExecutorProbeError(ValueError):
    """An executor probe observation is incomplete, ambiguous, or unsafe."""

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = False


@dataclasses.dataclass(frozen=True)
class Phase10ExecutorProbeResult:
    probe_id: str
    passed: bool
    evidence_sha256: str
    failure_code: str | None

    def __post_init__(self) -> None:
        if self.probe_id not in _EXPECTED_FAILURE_CODES:
            raise Phase10ExecutorProbeError("unknown_executor_probe")
        if not isinstance(self.passed, bool) or not _is_sha256(self.evidence_sha256):
            raise Phase10ExecutorProbeError("invalid_executor_probe_result")
        expected_failure = None if self.passed else _EXPECTED_FAILURE_CODES[self.probe_id]
        if self.failure_code != expected_failure:
            raise Phase10ExecutorProbeError("invalid_executor_probe_failure_code")

    def descriptor(self) -> dict[str, str | bool | None]:
        return dataclasses.asdict(self)

    @classmethod
    def from_descriptor(cls, value: Any) -> Phase10ExecutorProbeResult:
        if not isinstance(value, dict) or set(value) != {
            "probe_id",
            "passed",
            "evidence_sha256",
            "failure_code",
        }:
            raise Phase10ExecutorProbeError("invalid_executor_probe_result")
        return cls(**value)


@dataclasses.dataclass(frozen=True)
class Phase10ExecutorProbeObservation:
    """One exact deployment-class observation; never an approval assertion."""

    attempt_id: str
    observed_at: str
    deployment_class: str
    qualification_identity: str
    policy_sha256: str
    runtime_oci_index_digest: str
    platform: str
    probes: tuple[Phase10ExecutorProbeResult, ...]
    qualification_status: str = EXECUTOR_QUALIFICATION_STATUS
    blocking_reasons: tuple[str, ...] = EXECUTOR_BLOCKING_REASONS
    contract_version: str = EXECUTOR_PROBE_CONTRACT_VERSION

    def __post_init__(self) -> None:
        _validate_observation(self)

    @property
    def probe_outcome(self) -> str:
        return "passed" if all(item.passed for item in self.probes) else "failed"

    @property
    def failed_probe_ids(self) -> tuple[str, ...]:
        return tuple(item.probe_id for item in self.probes if not item.passed)

    def body(self) -> dict[str, Any]:
        return {
            "executor_probe_schema_version": EXECUTOR_PROBE_SCHEMA_VERSION,
            "contract_version": self.contract_version,
            "qualification_status": self.qualification_status,
            "attempt_id": self.attempt_id,
            "observed_at": self.observed_at,
            "deployment_class": self.deployment_class,
            "qualification_identity": self.qualification_identity,
            "policy_sha256": self.policy_sha256,
            "runtime_oci_index_digest": self.runtime_oci_index_digest,
            "platform": self.platform,
            "probe_outcome": self.probe_outcome,
            "failed_probe_ids": list(self.failed_probe_ids),
            "probes": [item.descriptor() for item in self.probes],
            "blocking_reasons": list(self.blocking_reasons),
        }

    @property
    def observation_sha256(self) -> str:
        return _canonical_sha256(self.body())

    def to_observation(self) -> dict[str, Any]:
        return {**self.body(), "observation_sha256": self.observation_sha256}

    @classmethod
    def from_observation(cls, payload: dict[str, Any]) -> Phase10ExecutorProbeObservation:
        expected = {
            "executor_probe_schema_version",
            "contract_version",
            "qualification_status",
            "attempt_id",
            "observed_at",
            "deployment_class",
            "qualification_identity",
            "policy_sha256",
            "runtime_oci_index_digest",
            "platform",
            "probe_outcome",
            "failed_probe_ids",
            "probes",
            "blocking_reasons",
            "observation_sha256",
        }
        if not isinstance(payload, dict) or set(payload) != expected:
            raise Phase10ExecutorProbeError("invalid_executor_probe_observation")
        if payload["executor_probe_schema_version"] != EXECUTOR_PROBE_SCHEMA_VERSION:
            raise Phase10ExecutorProbeError("unsupported_executor_probe_observation_schema")
        if not isinstance(payload["probes"], list) or not isinstance(
            payload["blocking_reasons"], list
        ):
            raise Phase10ExecutorProbeError("invalid_executor_probe_observation")
        observation = cls(
            attempt_id=payload["attempt_id"],
            observed_at=payload["observed_at"],
            deployment_class=payload["deployment_class"],
            qualification_identity=payload["qualification_identity"],
            policy_sha256=payload["policy_sha256"],
            runtime_oci_index_digest=payload["runtime_oci_index_digest"],
            platform=payload["platform"],
            probes=tuple(
                Phase10ExecutorProbeResult.from_descriptor(item) for item in payload["probes"]
            ),
            qualification_status=payload["qualification_status"],
            blocking_reasons=tuple(payload["blocking_reasons"]),
            contract_version=payload["contract_version"],
        )
        if payload["probe_outcome"] != observation.probe_outcome:
            raise Phase10ExecutorProbeError("executor_probe_outcome_mismatch")
        if payload["failed_probe_ids"] != list(observation.failed_probe_ids):
            raise Phase10ExecutorProbeError("executor_failed_probe_list_mismatch")
        claimed = payload["observation_sha256"]
        if not _is_sha256(claimed):
            raise Phase10ExecutorProbeError("invalid_executor_observation_digest")
        if claimed != observation.observation_sha256:
            raise Phase10ExecutorProbeError("executor_observation_digest_mismatch")
        return observation


def build_phase10_executor_probe_observation(
    *,
    identity: Phase10QualificationIdentityCandidate,
    attempt_id: uuid.UUID,
    observed_at: datetime,
    deployment_class: str,
    probes: tuple[Phase10ExecutorProbeResult, ...],
) -> Phase10ExecutorProbeObservation:
    if not isinstance(identity, Phase10QualificationIdentityCandidate):
        raise Phase10ExecutorProbeError("invalid_qualification_identity_parent")
    if not isinstance(attempt_id, uuid.UUID):
        raise Phase10ExecutorProbeError("invalid_executor_attempt_id")
    return Phase10ExecutorProbeObservation(
        attempt_id=str(attempt_id),
        observed_at=_canonical_timestamp(observed_at),
        deployment_class=deployment_class,
        qualification_identity=identity.candidate_qualification_identity,
        policy_sha256=identity.policy_sha256,
        runtime_oci_index_digest=identity.runtime_oci_index_digest,
        platform=identity.platform,
        probes=probes,
    )


def _validate_observation(observation: Phase10ExecutorProbeObservation) -> None:
    if observation.contract_version != EXECUTOR_PROBE_CONTRACT_VERSION:
        raise Phase10ExecutorProbeError("unsupported_executor_probe_contract")
    if observation.qualification_status != EXECUTOR_QUALIFICATION_STATUS:
        raise Phase10ExecutorProbeError("executor_not_qualified")
    try:
        parsed_attempt = uuid.UUID(observation.attempt_id)
    except (TypeError, ValueError) as exc:
        raise Phase10ExecutorProbeError("invalid_executor_attempt_id") from exc
    if str(parsed_attempt) != observation.attempt_id:
        raise Phase10ExecutorProbeError("invalid_executor_attempt_id")
    _parse_canonical_timestamp(observation.observed_at)
    if (
        not isinstance(observation.deployment_class, str)
        or _DEPLOYMENT_CLASS_RE.fullmatch(observation.deployment_class) is None
    ):
        raise Phase10ExecutorProbeError("invalid_executor_deployment_class")
    if (
        not isinstance(observation.qualification_identity, str)
        or _QUALIFICATION_ID_RE.fullmatch(observation.qualification_identity) is None
        or not _is_sha256(observation.policy_sha256)
        or not isinstance(observation.runtime_oci_index_digest, str)
        or _OCI_INDEX_DIGEST_RE.fullmatch(observation.runtime_oci_index_digest) is None
        or observation.platform != REQUIRED_PLATFORM
    ):
        raise Phase10ExecutorProbeError("invalid_executor_qualification_binding")
    if (
        not isinstance(observation.probes, tuple)
        or any(not isinstance(item, Phase10ExecutorProbeResult) for item in observation.probes)
        or tuple(item.probe_id for item in observation.probes) != REQUIRED_EXECUTOR_PROBES
    ):
        raise Phase10ExecutorProbeError("incomplete_executor_probe_set")
    if observation.blocking_reasons != EXECUTOR_BLOCKING_REASONS:
        raise Phase10ExecutorProbeError("invalid_executor_qualification_blockers")


def _canonical_timestamp(value: datetime) -> str:
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise Phase10ExecutorProbeError("invalid_executor_observed_at")
    return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _parse_canonical_timestamp(value: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise Phase10ExecutorProbeError("invalid_executor_observed_at")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise Phase10ExecutorProbeError("invalid_executor_observed_at") from exc
    if _canonical_timestamp(parsed) != value:
        raise Phase10ExecutorProbeError("invalid_executor_observed_at")
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
