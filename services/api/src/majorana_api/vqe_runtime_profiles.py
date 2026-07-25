"""Server-owned Phase 5 H2 runtime support matrix.

These profiles are candidates, not production qualifications.  Clients can
choose only a framework preference; image identity, versions, architecture,
and isolation policy are resolved here.  Changing any value is a reviewed
scientific/runtime profile change.
"""

from __future__ import annotations

from dataclasses import dataclass

from majorana_vqe.models import ExecutionBinding, Framework


@dataclass(frozen=True)
class CandidateRuntimeProfile:
    binding: ExecutionBinding
    local_image_tag: str
    # This is a local Docker image ID, not an OCI registry manifest digest.
    local_image_digest: str
    lock_sha256: str
    dockerfile_sha256: str
    entrypoint_sha256: str
    fixture_manifest_sha256: str
    canonical_circuit_file_sha256: str
    canonical_circuit_sha256: str
    compilation_protocol_sha256: str
    common_basis_operation_sequence_sha256: str
    qualification_script_sha256: str
    source_git_commit: str | None = None
    sbom_sha256: str | None = None
    build_attestation_sha256: str | None = None
    entrypoint_kind: str = "frozen_h2_actual_vqe_stdout_v1"

    @property
    def provenance_complete(self) -> bool:
        return all(
            (
                self.source_git_commit,
                self.sbom_sha256,
                self.build_attestation_sha256,
            )
        )


_DATASET_SNAPSHOT_ID = (
    "h2-sto3g-fixture-6424713c69c2b734172db47329b7deb62b67a743c80fd792f48173fdaa4e3edc"
)

_PROFILES = {
    Framework.QISKIT: CandidateRuntimeProfile(
        binding=ExecutionBinding(
            framework=Framework.QISKIT,
            provider_versions={
                "numpy": "2.5.1",
                "qiskit": "1.4.6",
                "scipy": "1.18.0",
            },
            runtime_profile_id="h2-qiskit-linux-x86_64-candidate-v1",
            adapter_release_id="majorana-h2-qiskit-adapter-0.2.0",
            container_digest=(
                "sha256:820b4fb9c9fa59160abb37062b6f71d43fedcb0a9a955bfcabe1c294889cfd6c"
            ),
            architecture="linux-x86_64",
            production_runtime_status="unqualified",
            dataset_snapshot_id=_DATASET_SNAPSHOT_ID,
            protocol_version="0.2.0",
        ),
        local_image_tag="majorana-vqe-qiskit:phase5-candidate",
        local_image_digest=(
            "sha256:820b4fb9c9fa59160abb37062b6f71d43fedcb0a9a955bfcabe1c294889cfd6c"
        ),
        lock_sha256="51c8ed79eacab8292464ff5adccc95899fe7c428ce1568a8c068758d4a7b3159",
        dockerfile_sha256="de36d90803e3b252fe60412d3bc07f9d018e6665da7ccc5b858a6fec55547774",
        entrypoint_sha256="f770cb9fdd07684ad95e4e835337f1031c1287f180530c324df2f821112c8613",
        fixture_manifest_sha256=(
            "6424713c69c2b734172db47329b7deb62b67a743c80fd792f48173fdaa4e3edc"
        ),
        canonical_circuit_file_sha256=(
            "dc5970b66b3bb5da2467bdacfd5166373b2341f293c74486383bf2a0397cf43a"
        ),
        canonical_circuit_sha256=(
            "f4fdb1ac3f041185fff63f6a7acb9d3ab1e9742131ed5bd3bb9ba2d99081a58c"
        ),
        compilation_protocol_sha256=(
            "778fe0c7f3d361c54e9c41a0240ef31cc7926dacbe8fbc33ff96a57ee104393c"
        ),
        common_basis_operation_sequence_sha256=(
            "e0eaae576a3570dde47dcc5d5489dd758ee1311f911d0686cc87d5e2bd3f4cbd"
        ),
        qualification_script_sha256=(
            "f23dad6356e71bc3a3b34ac3a4d2229e60e7c35317033ea3faca881251d1578b"
        ),
        source_git_commit="61101676ab8aa79cb351ed2331fab8a91c7a9d47",
        sbom_sha256="337a9d45772b37f2b48dd52b55b95326480e55e0e29b7eaf801a8da6724a6b64",
        build_attestation_sha256=(
            "df9fe2ac62e2719003a900fdb62717028aace09c636b29e9a79978407291474f"
        ),
    ),
    Framework.PENNYLANE: CandidateRuntimeProfile(
        binding=ExecutionBinding(
            framework=Framework.PENNYLANE,
            provider_versions={
                "numpy": "2.5.1",
                "pennylane": "0.45.1",
                "scipy": "1.18.0",
            },
            runtime_profile_id="h2-pennylane-linux-x86_64-candidate-v1",
            adapter_release_id="majorana-h2-pennylane-adapter-0.2.0",
            container_digest=(
                "sha256:82d5cc74bd8f5083b64541cf5b7b30633c5c19b9340127b5c02aea41cfebf7a4"
            ),
            architecture="linux-x86_64",
            production_runtime_status="unqualified",
            dataset_snapshot_id=_DATASET_SNAPSHOT_ID,
            protocol_version="0.2.0",
        ),
        local_image_tag="majorana-vqe-pennylane:phase5-candidate",
        local_image_digest=(
            "sha256:82d5cc74bd8f5083b64541cf5b7b30633c5c19b9340127b5c02aea41cfebf7a4"
        ),
        lock_sha256="00d97ccffef518385623b5943788db063de43cf6af3c9e144f0f66a8023fe8ac",
        dockerfile_sha256="de36d90803e3b252fe60412d3bc07f9d018e6665da7ccc5b858a6fec55547774",
        entrypoint_sha256="9a960a6a29e0d6a70dcfd83a2a829999808168f3b5a4f02609b45f25f184c1dd",
        fixture_manifest_sha256=(
            "6424713c69c2b734172db47329b7deb62b67a743c80fd792f48173fdaa4e3edc"
        ),
        canonical_circuit_file_sha256=(
            "dc5970b66b3bb5da2467bdacfd5166373b2341f293c74486383bf2a0397cf43a"
        ),
        canonical_circuit_sha256=(
            "f4fdb1ac3f041185fff63f6a7acb9d3ab1e9742131ed5bd3bb9ba2d99081a58c"
        ),
        compilation_protocol_sha256=(
            "778fe0c7f3d361c54e9c41a0240ef31cc7926dacbe8fbc33ff96a57ee104393c"
        ),
        common_basis_operation_sequence_sha256=(
            "e0eaae576a3570dde47dcc5d5489dd758ee1311f911d0686cc87d5e2bd3f4cbd"
        ),
        qualification_script_sha256=(
            "f23dad6356e71bc3a3b34ac3a4d2229e60e7c35317033ea3faca881251d1578b"
        ),
        source_git_commit="61101676ab8aa79cb351ed2331fab8a91c7a9d47",
        sbom_sha256="b11a25ac4a88ac296725b661264ce77b475d6044a440e1a53de354f6cdc1b3fb",
        build_attestation_sha256=(
            "c39ebac05684271254e4689a06da2008ce62d0c5cd0bebedcee500774df991e2"
        ),
    ),
}


def candidate_runtime_profile(framework: Framework) -> CandidateRuntimeProfile:
    """Resolve a fixed candidate profile; never accept a profile from a client."""
    return _PROFILES[Framework(framework)]


def candidate_runtime_profiles() -> tuple[CandidateRuntimeProfile, ...]:
    return tuple(_PROFILES[framework] for framework in Framework)


def profile_for_binding(binding: ExecutionBinding) -> CandidateRuntimeProfile:
    profile = _PROFILES.get(binding.framework)
    if profile is None or profile.binding != binding:
        raise ValueError("binding is not an exact server-owned Phase 5 candidate profile")
    return profile
