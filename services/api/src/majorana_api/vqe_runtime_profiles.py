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
    image_config_digest: str
    sbom_sha256: str
    provenance_sha256: str
    github_attestation_id: str
    github_attestation_url: str
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
            and self.image_config_digest
            and self.sbom_sha256
            and self.provenance_sha256
            and self.github_attestation_id
            and self.github_attestation_url
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

_PRODUCTION_DIGESTS_V1 = {
    Framework.QISKIT: {
        "registry": "sha256:f2d19903e323da3f60039ac81627ed466f36055b7e157959ed1afe6168e4d992",
        "platform": "sha256:3461b33911b58018dc30c742e9dceb0f230b33fbe53266097020276f1273cc02",
        "attestation": "sha256:0fecaefdab93bf11b134fd4e64531c12ee1fe46d57342715439e41b0ae553165",
        "config": "sha256:468347cd3afad741615aaed5b06558d27de9a01d53574987f3a3d1c70b59e425",
        "sbom": "2767b23bc23a3e6c4eb6294e1249e34ca2c38107f8793e404897b90444e777c3",
        "provenance": "45f66c5337c2d0fb57ebc802a12ac33ee5f85769f9434fcd54610fe6914694eb",
        "github_attestation_id": "37460770",
        "github_attestation_url": "https://github.com/EshMis/majorana/attestations/37460770",
        "source_commit": "fae2d2f4d6310a6cbc29cc0fe5ebab20b361ae07",
        "dockerfile": "1c292a4e33cf09c03ceba899d855c16e7b22005fef87af4722099e99e70029aa",
        "entrypoint": "03619d9e561c3358b7b264b64174fce834aac14a9ae4c2fe9d00de8603b1821a",
    },
    Framework.PENNYLANE: {
        "registry": "sha256:da0e2caa3ac106c6627a1f9f166f9b4213ce7fef8b3145263904e3df7b399c69",
        "platform": "sha256:c141ef55a2104fa76f5688481983611fda8f9e2029b52b8ad755bff594aa81d8",
        "attestation": "sha256:355ed7d6340d3085b60bdb79b55153faba9a0ffbe8a9ea68f9a9f300811bac0c",
        "config": "sha256:a5da57b8fcfa21124322649dcbbb613327ee59c15938a15ff90161d217679e19",
        "sbom": "521c82dde8f8f76fbf9449669cb21ad3df91aced8f984abb470b328507dbb868",
        "provenance": "e87d29092001816d5710a6ae0102faedbe062e99dd5ae18ff6ce09e0872c2dc8",
        "github_attestation_id": "37460757",
        "github_attestation_url": "https://github.com/EshMis/majorana/attestations/37460757",
        "source_commit": "fae2d2f4d6310a6cbc29cc0fe5ebab20b361ae07",
        "dockerfile": "1c292a4e33cf09c03ceba899d855c16e7b22005fef87af4722099e99e70029aa",
        "entrypoint": "65ae875dca65d77f1f0ae5f556a5ce17e4621d8fff6b068e81b994c131cdd05a",
    },
}


_PRODUCTION_DIGESTS = {
    Framework.QISKIT: {
        "registry": "sha256:17a1ee0690ce768a076c370ee17c36de5f536ff4b61d8ebe4ae43b961a277b76",
        "platform": "sha256:e45c84d49ba168eb88424c3707fd4c8bbd7e9934d397866ab838e4199a04b911",
        "attestation": "sha256:d507ed6ce24f36212f1fd8443b21c3a7756617071ee33fe0d77a12d5368bbc69",
        "config": "sha256:f186b8fb15d07b56111eb956124102abbf642276f137aeab7e2a0a215a7957c1",
        "sbom": "63449e1f16821b0be46a7d188c326edcc5605da60cdc28da735fb2233f9dc393",
        "provenance": "287a69296c77a241373e5436f6b8916899c18cc4f27410f979a67c88c358314d",
        "github_attestation_id": "37673517",
        "github_attestation_url": "https://github.com/EshMis/majorana/attestations/37673517",
        "source_commit": "a4c11cf5be8d5235901f1c1399f483e381833d4a",
        "dockerfile": "1c292a4e33cf09c03ceba899d855c16e7b22005fef87af4722099e99e70029aa",
        "entrypoint": "dce23e808e3b038c51fe7d0a8141edb8330246c6350c302b42be0b0040a6d92d",
    },
    Framework.PENNYLANE: {
        "registry": "sha256:e29149db8efb338c4dd82879909ad8dd4928174309bc0b9fc1b7db0ef2a21930",
        "platform": "sha256:0de23bc6318644b83732bbe02f24ebf7834756d3d9f023a8685f6e11cb994cf1",
        "attestation": "sha256:6ae37d53c2c749f2555bcb05a694fd589f0bbd332f4b6d59251c8f9f0986360a",
        "config": "sha256:7c146e505e446c01832fd708fea2dfa6942c9682a8b7f5694339ee1c3106592f",
        "sbom": "b4d1f654f30fe6f7ca6d83f1d4d2fa4a0c91ce42088353a3d85b672cbc4b7932",
        "provenance": "9c5bdc7fd486b425f710d3ccad6b51d02eb53eeadd142ae724272d2c688dd22d",
        "github_attestation_id": "37673489",
        "github_attestation_url": "https://github.com/EshMis/majorana/attestations/37673489",
        "source_commit": "a4c11cf5be8d5235901f1c1399f483e381833d4a",
        "dockerfile": "1c292a4e33cf09c03ceba899d855c16e7b22005fef87af4722099e99e70029aa",
        "entrypoint": "9d771abbefc369ac8f5c7e868bd00d551f637171dcbe158b70507b590890e671",
    },
}


def _production_profile(
    framework: Framework,
    *,
    digests_by_framework: dict[Framework, dict[str, str]],
    profile_version: int,
    adapter_version: str,
) -> ProductionRuntimeProfile:
    candidate = _PROFILES[framework]
    digests = digests_by_framework[framework]
    repository = f"ghcr.io/eshmis/majorana-vqe-{framework.value}"
    binding = ExecutionBinding(
        framework=framework,
        provider_versions=candidate.binding.provider_versions,
        runtime_profile_id=(
            f"h2-{framework.value}-linux-x86_64-production-v{profile_version}"
        ),
        adapter_release_id=(
            f"majorana-h2-{framework.value}-adapter-{adapter_version}"
        ),
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
        image_config_digest=digests["config"],
        sbom_sha256=digests["sbom"],
        provenance_sha256=digests["provenance"],
        github_attestation_id=digests["github_attestation_id"],
        github_attestation_url=digests["github_attestation_url"],
        lock_sha256=candidate.lock_sha256,
        dockerfile_sha256=digests["dockerfile"],
        entrypoint_sha256=digests["entrypoint"],
        fixture_manifest_sha256=candidate.fixture_manifest_sha256,
        canonical_circuit_file_sha256=candidate.canonical_circuit_file_sha256,
        canonical_circuit_sha256=candidate.canonical_circuit_sha256,
        compilation_protocol_sha256=candidate.compilation_protocol_sha256,
        common_basis_operation_sequence_sha256=(candidate.common_basis_operation_sequence_sha256),
        qualification_script_sha256=candidate.qualification_script_sha256,
        runtime_payload_source_commit=digests["source_commit"],
    )


_LEGACY_PRODUCTION_PROFILES = {
    framework: _production_profile(
        framework,
        digests_by_framework=_PRODUCTION_DIGESTS_V1,
        profile_version=1,
        adapter_version="0.2.0",
    )
    for framework in Framework
}
_PRODUCTION_PROFILES = {
    framework: _production_profile(
        framework,
        digests_by_framework=_PRODUCTION_DIGESTS,
        profile_version=2,
        adapter_version="0.3.0",
    )
    for framework in Framework
}


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
        _LEGACY_PRODUCTION_PROFILES.get(binding.framework),
    )
    for profile in candidates:
        if profile is not None and profile.binding == binding:
            return profile
    raise ValueError("binding is not an exact server-owned VQE runtime profile")
