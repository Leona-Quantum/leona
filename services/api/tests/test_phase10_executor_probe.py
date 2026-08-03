from __future__ import annotations

import copy
import hashlib
import json
import uuid
from datetime import UTC, datetime

import pytest

from majorana_api.phase10_execution_policy import (
    POLICY_BLOCKING_REASONS,
    Phase10QualificationIdentityCandidate,
)
from majorana_api.phase10_executor_probe import (
    EXECUTOR_BLOCKING_REASONS,
    REQUIRED_EXECUTOR_PROBES,
    Phase10ExecutorProbeError,
    Phase10ExecutorProbeObservation,
    Phase10ExecutorProbeResult,
    build_phase10_executor_probe_observation,
)


def _identity() -> Phase10QualificationIdentityCandidate:
    return Phase10QualificationIdentityCandidate(
        repository_id=1234,
        full_name="example/vqe-source",
        immutable_ref="a" * 40,
        retrieval_manifest_sha256="b" * 64,
        normalized_source_manifest_sha256="c" * 64,
        static_candidate_sha256="d" * 64,
        policy_sha256="e" * 64,
        runtime_oci_index_digest=f"sha256:{'f' * 64}",
        platform="linux/amd64",
        blocking_reasons=POLICY_BLOCKING_REASONS,
    )


def _probe(probe_id: str, *, passed: bool = True) -> Phase10ExecutorProbeResult:
    failure_codes = {
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
    return Phase10ExecutorProbeResult(
        probe_id=probe_id,
        passed=passed,
        evidence_sha256=hashlib.sha256(probe_id.encode()).hexdigest(),
        failure_code=None if passed else failure_codes[probe_id],
    )


def _probes(*, failed: str | None = None):
    return tuple(
        _probe(probe_id, passed=probe_id != failed) for probe_id in REQUIRED_EXECUTOR_PROBES
    )


def _observation(*, failed: str | None = None) -> Phase10ExecutorProbeObservation:
    return build_phase10_executor_probe_observation(
        identity=_identity(),
        attempt_id=uuid.UUID("019fa9a0-0000-7000-8000-000000000001"),
        observed_at=datetime(2026, 8, 3, 6, 0, tzinfo=UTC),
        deployment_class="candidate.gvisor-v1",
        probes=_probes(failed=failed),
    )


def _canonical_digest(value: dict) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _rehash(payload: dict) -> None:
    body = {key: value for key, value in payload.items() if key != "observation_sha256"}
    payload["observation_sha256"] = _canonical_digest(body)


def test_complete_passing_probe_set_remains_unqualified():
    observation = _observation()
    payload = observation.to_observation()

    assert observation.probe_outcome == "passed"
    assert observation.failed_probe_ids == ()
    assert observation.qualification_status == "unqualified"
    assert observation.blocking_reasons == EXECUTOR_BLOCKING_REASONS
    assert Phase10ExecutorProbeObservation.from_observation(payload).to_observation() == payload


def test_failed_probe_retains_stable_stage_specific_failure():
    observation = _observation(failed="network.ipv6_blocked")

    assert observation.probe_outcome == "failed"
    assert observation.failed_probe_ids == ("network.ipv6_blocked",)
    failed = next(item for item in observation.probes if not item.passed)
    assert failed.failure_code == "network_isolation_failed"


@pytest.mark.parametrize(
    ("probe_id", "failure_code"),
    [
        ("network.dns_blocked", "execution_failed"),
        ("cleanup.complete", "network_isolation_failed"),
        ("output.result_bounded", None),
    ],
)
def test_failed_probe_cannot_use_missing_or_generic_failure_code(probe_id, failure_code):
    with pytest.raises(Phase10ExecutorProbeError, match="invalid_executor_probe_failure_code"):
        Phase10ExecutorProbeResult(
            probe_id=probe_id,
            passed=False,
            evidence_sha256="a" * 64,
            failure_code=failure_code,
        )


def test_missing_duplicate_or_reordered_probe_set_fails_closed():
    base = _probes()
    for probes in (base[:-1], (*base[:-1], base[-2]), tuple(reversed(base))):
        with pytest.raises(Phase10ExecutorProbeError, match="incomplete_executor_probe_set"):
            build_phase10_executor_probe_observation(
                identity=_identity(),
                attempt_id=uuid.uuid4(),
                observed_at=datetime.now(UTC),
                deployment_class="candidate.gvisor-v1",
                probes=probes,
            )


def test_observation_binds_exact_runtime_policy_identity_and_attempt():
    observation = _observation()

    assert observation.qualification_identity == _identity().candidate_qualification_identity
    assert observation.policy_sha256 == _identity().policy_sha256
    assert observation.runtime_oci_index_digest == _identity().runtime_oci_index_digest
    assert observation.attempt_id == "019fa9a0-0000-7000-8000-000000000001"
    assert observation.observed_at == "2026-08-03T06:00:00.000000Z"


def test_unknown_fields_digest_tampering_and_qualification_escalation_fail_closed():
    payload = _observation().to_observation()
    unknown = copy.deepcopy(payload)
    unknown["runtime_stdout"] = "sensitive output"
    with pytest.raises(Phase10ExecutorProbeError, match="invalid_executor_probe_observation"):
        Phase10ExecutorProbeObservation.from_observation(unknown)

    payload["deployment_class"] = "candidate.other-v2"
    with pytest.raises(Phase10ExecutorProbeError, match="executor_observation_digest_mismatch"):
        Phase10ExecutorProbeObservation.from_observation(payload)

    payload = _observation().to_observation()
    payload["qualification_status"] = "qualified"
    _rehash(payload)
    with pytest.raises(Phase10ExecutorProbeError, match="executor_not_qualified"):
        Phase10ExecutorProbeObservation.from_observation(payload)


def test_derived_outcome_and_failed_list_cannot_be_forged():
    payload = _observation(failed="cleanup.complete").to_observation()
    payload["probe_outcome"] = "passed"
    _rehash(payload)
    with pytest.raises(Phase10ExecutorProbeError, match="executor_probe_outcome_mismatch"):
        Phase10ExecutorProbeObservation.from_observation(payload)

    payload = _observation(failed="cleanup.complete").to_observation()
    payload["failed_probe_ids"] = []
    _rehash(payload)
    with pytest.raises(Phase10ExecutorProbeError, match="executor_failed_probe_list_mismatch"):
        Phase10ExecutorProbeObservation.from_observation(payload)


def test_naive_or_noncanonical_observed_time_is_rejected():
    with pytest.raises(Phase10ExecutorProbeError, match="invalid_executor_observed_at"):
        build_phase10_executor_probe_observation(
            identity=_identity(),
            attempt_id=uuid.uuid4(),
            observed_at=datetime(2026, 8, 3, 6, 0),
            deployment_class="candidate.gvisor-v1",
            probes=_probes(),
        )

    payload = _observation().to_observation()
    payload["observed_at"] = "2026-08-03T06:00:00Z"
    _rehash(payload)
    with pytest.raises(Phase10ExecutorProbeError, match="invalid_executor_observed_at"):
        Phase10ExecutorProbeObservation.from_observation(payload)
