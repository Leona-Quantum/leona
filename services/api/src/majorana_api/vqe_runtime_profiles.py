"""Server-owned Phase 5/6 H2 runtime support matrix.

Clients can choose only a framework preference; image identity, versions,
architecture, and isolation policy are resolved here. Changing any value is a
reviewed scientific/runtime profile change.
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
    # Commit containing the exact Dockerfile, lock, entrypoint, and canonical
    # scientific fixtures used to build this local candidate image. This is
    # deliberately not the qualification-tool or branch-audit commit.
    runtime_payload_source_commit: str | None = None
    sbom_sha256: str | None = None
    build_attestation_sha256: str | None = None
    entrypoint_kind: str = "frozen_h2_actual_vqe_stdout_v1"

    @property
    def provenance_complete(self) -> bool:
        return all(
            (
                self.runtime_payload_source_commit,
                self.sbom_sha256,
                self.build_attestation_sha256,
            )
        )


@dataclass(frozen=True)
class ProductionRuntimeProfile:
    """A registry-published runtime that may run only by exact OCI digest."""

    binding: ExecutionBinding
    image_reference: str
    registry_manifest_digest: str
    platform_manifest_digest: str
    attestation_manifest_digest: str
    lock_sha256: str
    dockerfile_sha256: str
    entrypoint_sha256: str
    fixture_manifest_sha256: str
    canonical_circuit_file_sha256: str
    canonical_circuit_sha256: str
    compilation_protocol_sha256: str
    common_basis_operation_sequence_sha256: str
    qualification_script_sha256: str
    runtime_payload_source_commit: str
    entrypoint_kind: str = "frozen_h2_actual_vqe_stdout_v1"

    @property
    def provenance_complete(self) -> bool:
        return bool(
            self.runtime_payload_source_commit
            and self.registry_manifest_digest
            and self.platform_manifest_digest
            and self.attestation_manifest_digest
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
            "7f74f0447c1747d080062839e8fa2f9d4225000c78ad9e1a8f75a556fd85b69a"
        ),
        runtime_payload_source_commit="99e95a9a2589a3ca0ac01c3e44499046fabbce89",
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
            "7f74f0447c1747d080062839e8fa2f9d4225000c78ad9e1a8f75a556fd85b69a"
        ),
        runtime_payload_source_commit="99e95a9a2589a3ca0ac01c3e44499046fabbce89",
        sbom_sha256="b11a25ac4a88ac296725b661264ce77b475d6044a440e1a53de354f6cdc1b3fb",
        build_attestation_sha256=(
            "c39ebac05684271254e4689a06da2008ce62d0c5cd0bebedcee500774df991e2"
        ),
    ),
}

_PRODUCTION_DIGESTS = {
    Framework.QISKIT: {
        "registry": "sha256:3b66b9a813346c4ebba446c2cb80119b4d379725797f90463d2068e5285d62f6",
        "platform": "sha256:e82b920d7858d69360bb2e12ca5e997b87c286adcc56ce70ab55b3ab4345fb54",
        "attestation": "sha256:f10e69154515eab0f45ae64faa82d35ae52571fb285c1c475104fe77405b910a",
    },
    Framework.PENNYLANE: {
        "registry": "sha256:205a795608b99e6901e9a03696a0aa38be718c636cdcadd530ada7492c288fd2",
        "platform": "sha256:37f41aa59b8b2a90fb968e3a5eb33dbbe183b63883743769c1a9b87a005ca0ca",
        "attestation": "sha256:115abae60d178ae59c8886884059431b500fb556c5326c0fb5ecd9896fd21318",
    },
}


def _production_profile(framework: Framework) -> ProductionRuntimeProfile:
    candidate = _PROFILES[framework]
    digests = _PRODUCTION_DIGESTS[framework]
    repository = f"ghcr.io/eshmis/majorana-vqe-{framework.value}"
    binding = ExecutionBinding(
        framework=framework,
        provider_versions=candidate.binding.provider_versions,
        runtime_profile_id=f"h2-{framework.value}-linux-x86_64-production-v1",
        adapter_release_id=candidate.binding.adapter_release_id,
        container_digest=digests["registry"],
        container_digest_kind="oci_manifest_digest",
        oci_manifest_digest=digests["registry"],
        architecture="linux-x86_64",
        production_runtime_status="qualified",
        dataset_snapshot_id=candidate.binding.dataset_snapshot_id,
        protocol_version=candidate.binding.protocol_version,
    )
    return ProductionRuntimeProfile(
        binding=binding,
        image_reference=f"{repository}@{digests['registry']}",
        registry_manifest_digest=digests["registry"],
        platform_manifest_digest=digests["platform"],
        attestation_manifest_digest=digests["attestation"],
        lock_sha256=candidate.lock_sha256,
        dockerfile_sha256=candidate.dockerfile_sha256,
        entrypoint_sha256=candidate.entrypoint_sha256,
        fixture_manifest_sha256=candidate.fixture_manifest_sha256,
        canonical_circuit_file_sha256=candidate.canonical_circuit_file_sha256,
        canonical_circuit_sha256=candidate.canonical_circuit_sha256,
        compilation_protocol_sha256=candidate.compilation_protocol_sha256,
        common_basis_operation_sequence_sha256=(candidate.common_basis_operation_sequence_sha256),
        qualification_script_sha256=candidate.qualification_script_sha256,
        runtime_payload_source_commit=candidate.runtime_payload_source_commit or "",
    )


_PRODUCTION_PROFILES = {framework: _production_profile(framework) for framework in Framework}


def candidate_runtime_profile(framework: Framework) -> CandidateRuntimeProfile:
    """Resolve a fixed candidate profile; never accept a profile from a client."""
    return _PROFILES[Framework(framework)]


def candidate_runtime_profiles() -> tuple[CandidateRuntimeProfile, ...]:
    return tuple(_PROFILES[framework] for framework in Framework)


def production_runtime_profile(framework: Framework) -> ProductionRuntimeProfile:
    """Resolve an exact digest-pinned production profile."""
    return _PRODUCTION_PROFILES[Framework(framework)]


def production_runtime_profiles() -> tuple[ProductionRuntimeProfile, ...]:
    return tuple(_PRODUCTION_PROFILES[framework] for framework in Framework)


def profile_for_binding(
    binding: ExecutionBinding,
) -> CandidateRuntimeProfile | ProductionRuntimeProfile:
    candidates = (
        _PROFILES.get(binding.framework),
        _PRODUCTION_PROFILES.get(binding.framework),
    )
    for profile in candidates:
        if profile is not None and profile.binding == binding:
            return profile
    raise ValueError("binding is not an exact server-owned VQE runtime profile")
