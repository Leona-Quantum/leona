from __future__ import annotations

import copy
import hashlib
import json

import pytest

from majorana_api.phase10_execution_policy import (
    FIXED_LAUNCHER_ARGUMENTS,
    NETWORK_POLICY,
    POLICY_BLOCKING_REASONS,
    REQUIRED_PLATFORM,
    Phase10ExecutionLimits,
    Phase10ExecutionPolicyCandidate,
    Phase10ExecutionPolicyError,
    Phase10QualificationIdentityCandidate,
    Phase10QualificationSelection,
    build_phase10_execution_policy_candidate,
    build_phase10_qualification_identity_candidate,
    resolve_approved_qualification_selection,
)
from majorana_api.phase10_source_normalizer import (
    Phase10NormalizedSourceManifest,
    NormalizedSourceFile,
)
from majorana_api.phase10_static_candidate import (
    build_phase10_static_execution_candidate,
)


def _canonical_digest(value: dict) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _rehash_policy(payload: dict) -> None:
    body = {key: value for key, value in payload.items() if key != "policy_sha256"}
    payload["policy_sha256"] = _canonical_digest(body)


def _rehash_identity(payload: dict) -> None:
    body = {
        key: value
        for key, value in payload.items()
        if key not in {"identity_sha256", "candidate_qualification_identity"}
    }
    digest = _canonical_digest(body)
    payload["identity_sha256"] = digest
    payload["candidate_qualification_identity"] = f"phase10-qic:{digest}"


def _limits() -> Phase10ExecutionLimits:
    # Illustrative test values only; the contract never promotes them to approved.
    return Phase10ExecutionLimits(
        cpu_millis=1000,
        memory_bytes=1024 * 1024 * 1024,
        pids=64,
        scratch_bytes=512 * 1024 * 1024,
        total_file_bytes=16 * 1024 * 1024,
        file_count=1024,
        wall_time_ms=300_000,
        stdout_bytes=1024 * 1024,
        stderr_bytes=1024 * 1024,
        result_bytes=256 * 1024,
    )


def _policy(
    *, runtime_profile: str = "phase10-python-qiskit-1.4.6-candidate-v1"
) -> Phase10ExecutionPolicyCandidate:
    return build_phase10_execution_policy_candidate(
        runtime_profile=runtime_profile,
        runtime_oci_index_digest=f"sha256:{'a' * 64}",
        sandbox_class="candidate.gvisor-v1",
        limits=_limits(),
    )


def _source() -> Phase10NormalizedSourceManifest:
    content = b"print('metadata only')\n"
    digest = hashlib.sha256(content).hexdigest()
    return Phase10NormalizedSourceManifest(
        workspace_id="019fa990-657d-7c92-a548-5cc1dda7e894",
        acquisition_result_sha256="b" * 64,
        quarantine_plan_sha256="c" * 64,
        files=(
            NormalizedSourceFile(
                selected_path="entry.py",
                media_type="text/x-python",
                length=len(content),
                sha256=digest,
                opaque_locator=f"qobj:v1:sha256:{digest}",
            ),
            NormalizedSourceFile(
                selected_path="pyproject.toml",
                media_type="application/toml",
                length=20,
                sha256="d" * 64,
                opaque_locator=f"qobj:v1:sha256:{'d' * 64}",
            ),
            NormalizedSourceFile(
                selected_path="readme.md",
                media_type="text/markdown",
                length=20,
                sha256="e" * 64,
                opaque_locator=f"qobj:v1:sha256:{'e' * 64}",
            ),
        ),
    )


def _static_candidate(framework: str = "qiskit"):
    return build_phase10_static_execution_candidate(
        normalized_source=_source(),
        framework=framework,
        framework_evidence_paths=("readme.md",),
        package_evidence_paths=("pyproject.toml",),
        requested_entrypoint_path="entry.py",
        license_status="verified_compatible",
        provenance_status="verified",
    )


def _identity() -> Phase10QualificationIdentityCandidate:
    return build_phase10_qualification_identity_candidate(
        repository_id=1234,
        full_name="example/vqe-source",
        immutable_ref="f" * 40,
        retrieval_manifest_sha256="1" * 64,
        static_candidate=_static_candidate(),
        policy=_policy(),
    )


def test_policy_is_canonical_digest_pinned_and_explicitly_unqualified():
    policy = _policy()
    payload = policy.to_candidate()

    assert policy.status == "unqualified"
    assert policy.platform == REQUIRED_PLATFORM
    assert policy.network_policy == NETWORK_POLICY == "deny_all"
    assert policy.credential_policy == "none"
    assert policy.launcher_arguments == FIXED_LAUNCHER_ARGUMENTS
    assert policy.blocking_reasons == POLICY_BLOCKING_REASONS
    assert Phase10ExecutionPolicyCandidate.from_candidate(payload).to_candidate() == payload
    assert "secret" not in json.dumps(payload).casefold()


@pytest.mark.parametrize("value", [0, -1, True, 2**63])
def test_limits_reject_non_positive_boolean_or_unbounded_integer(value):
    kwargs = _limits().descriptor()
    kwargs["pids"] = value
    with pytest.raises(Phase10ExecutionPolicyError, match="invalid_execution_limit"):
        Phase10ExecutionLimits(**kwargs)


@pytest.mark.parametrize(
    ("field", "value", "failure"),
    [
        ("status", "qualified", "execution_policy_not_owner_qualified"),
        ("platform", "linux/arm64", "unsupported_execution_platform"),
        ("runtime_oci_index_digest", "runtime:latest", "invalid_runtime_oci_index_digest"),
        ("network_policy", "allow", "unapproved_execution_policy_surface"),
        ("launcher_arguments", ["-c", "source code"], "unapproved_execution_policy_surface"),
        ("blocking_reasons", [], "invalid_execution_policy_blockers"),
    ],
)
def test_self_consistent_policy_escalation_or_surface_change_fails_closed(field, value, failure):
    payload = _policy().to_candidate()
    payload[field] = value
    _rehash_policy(payload)
    with pytest.raises(Phase10ExecutionPolicyError, match=failure):
        Phase10ExecutionPolicyCandidate.from_candidate(payload)


def test_unknown_policy_field_and_digest_tampering_fail_closed():
    payload = _policy().to_candidate()
    unknown = copy.deepcopy(payload)
    unknown["environment"] = {"TOKEN": "x"}
    with pytest.raises(Phase10ExecutionPolicyError, match="invalid_execution_policy"):
        Phase10ExecutionPolicyCandidate.from_candidate(unknown)

    payload["limits"]["pids"] = 65
    with pytest.raises(Phase10ExecutionPolicyError, match="execution_policy_digest_mismatch"):
        Phase10ExecutionPolicyCandidate.from_candidate(payload)


def test_qualification_identity_binds_exact_source_runtime_and_policy():
    identity = _identity()
    payload = identity.to_candidate()

    assert identity.status == "unqualified"
    assert identity.immutable_ref == "f" * 40
    assert identity.runtime_oci_index_digest == f"sha256:{'a' * 64}"
    assert identity.policy_sha256 == _policy().policy_sha256
    assert "external_runtime_policy_unqualified" in identity.blocking_reasons
    assert Phase10QualificationIdentityCandidate.from_candidate(payload).to_candidate() == payload


def test_candidate_and_policy_runtime_profiles_must_match():
    with pytest.raises(Phase10ExecutionPolicyError, match="candidate_policy_runtime_mismatch"):
        build_phase10_qualification_identity_candidate(
            repository_id=1234,
            full_name="example/vqe-source",
            immutable_ref="f" * 40,
            retrieval_manifest_sha256="1" * 64,
            static_candidate=_static_candidate("pennylane"),
            policy=_policy(),
        )


def test_qualification_identity_tampering_or_approval_claim_fails_closed():
    payload = _identity().to_candidate()
    payload["immutable_ref"] = "0" * 40
    with pytest.raises(Phase10ExecutionPolicyError, match="qualification_identity_digest_mismatch"):
        Phase10QualificationIdentityCandidate.from_candidate(payload)

    payload = _identity().to_candidate()
    payload["status"] = "qualified"
    _rehash_identity(payload)
    with pytest.raises(Phase10ExecutionPolicyError, match="qualification_identity_not_approved"):
        Phase10QualificationIdentityCandidate.from_candidate(payload)


def test_client_selection_has_no_individual_policy_override_surface():
    identity = _identity()
    selection = Phase10QualificationSelection(
        qualification_identity=identity.candidate_qualification_identity,
        expected_policy_sha256=identity.policy_sha256,
    )
    payload = selection.to_selection()

    assert Phase10QualificationSelection.from_selection(payload) == selection
    payload["memory_bytes"] = 999999999
    with pytest.raises(Phase10ExecutionPolicyError, match="invalid_qualification_selection"):
        Phase10QualificationSelection.from_selection(payload)


def test_only_deployment_owned_exact_registry_entry_can_resolve_selection():
    identity = _identity()
    selection = Phase10QualificationSelection(
        qualification_identity=identity.candidate_qualification_identity,
        expected_policy_sha256=identity.policy_sha256,
    )

    with pytest.raises(Phase10ExecutionPolicyError, match="qualification_identity_not_approved"):
        resolve_approved_qualification_selection(
            selection=selection,
            approved_identity_policy_digests={},
        )

    with pytest.raises(Phase10ExecutionPolicyError, match="qualification_policy_digest_mismatch"):
        resolve_approved_qualification_selection(
            selection=selection,
            approved_identity_policy_digests={selection.qualification_identity: "9" * 64},
        )

    assert (
        resolve_approved_qualification_selection(
            selection=selection,
            approved_identity_policy_digests={
                selection.qualification_identity: selection.expected_policy_sha256
            },
        )
        == selection.qualification_identity
    )
