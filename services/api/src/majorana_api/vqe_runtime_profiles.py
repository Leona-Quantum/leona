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
    local_image_digest: str
    lock_sha256: str
    entrypoint_kind: str = "frozen_h2_actual_vqe_stdout_v1"


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
                "sha256:1e6552f240a6a79555ee84da0460934900bfa62086467b5866954b96b871ea1c"
            ),
            architecture="linux-x86_64",
            production_runtime_status="unqualified",
            dataset_snapshot_id=_DATASET_SNAPSHOT_ID,
            protocol_version="0.2.0",
        ),
        local_image_tag="majorana-vqe-qiskit:phase5-candidate",
        local_image_digest=(
            "sha256:1e6552f240a6a79555ee84da0460934900bfa62086467b5866954b96b871ea1c"
        ),
        lock_sha256="b7b33fde49f1250cf78141cc6fe1042b4e78620f5cce124a84316465a0296007",
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
                "sha256:34214c9f8ed7ea581a324eb6ebb464f001b75e00570da86e190876e57fe34e59"
            ),
            architecture="linux-x86_64",
            production_runtime_status="unqualified",
            dataset_snapshot_id=_DATASET_SNAPSHOT_ID,
            protocol_version="0.2.0",
        ),
        local_image_tag="majorana-vqe-pennylane:phase5-candidate",
        local_image_digest=(
            "sha256:34214c9f8ed7ea581a324eb6ebb464f001b75e00570da86e190876e57fe34e59"
        ),
        lock_sha256="2e6f0baa2f04f87973f18f0fe3bc21ed9020c8cdde5cbddd3b728f68272f8f00",
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
