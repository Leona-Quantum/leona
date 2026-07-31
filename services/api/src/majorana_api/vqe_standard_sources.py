"""Owner-approved source registry for the component-first VQE MVP.

The registry is deliberately small and explicit.  A source appearing here is
eligible for bounded metadata acquisition; it is not automatically a verified
component implementation.  Capability, version, and execution status require
separate evidence and review.
"""

from __future__ import annotations

import dataclasses
from enum import Enum


class StandardSourceKind(str, Enum):
    GITHUB_REPOSITORY = "github_repository"
    DATASET = "dataset"


class StandardSourceRole(str, Enum):
    FRAMEWORK = "framework"
    ALGORITHM_LIBRARY = "algorithm_library"
    OPERATOR_LIBRARY = "operator_library"
    PROBLEM_DATASET = "problem_dataset"
    DATASET_HELPER = "dataset_helper"


class MaintenanceState(str, Enum):
    MAINTAINED = "maintained"
    UNSUPPORTED_BY_ORIGINAL_VENDOR = "unsupported_by_original_vendor"
    DATASET_RELEASE = "dataset_release"
    UNKNOWN = "unknown"


@dataclasses.dataclass(frozen=True)
class StandardSource:
    source_key: str
    display_name: str
    source_kind: StandardSourceKind
    role: StandardSourceRole
    canonical_locator: str
    provider_key: str
    maintenance_state: MaintenanceState
    acquisition_enabled: bool
    qualification_note: str


STANDARD_VQE_SOURCES: tuple[StandardSource, ...] = (
    StandardSource(
        source_key="qiskit",
        display_name="Qiskit",
        source_kind=StandardSourceKind.GITHUB_REPOSITORY,
        role=StandardSourceRole.FRAMEWORK,
        canonical_locator="https://github.com/Qiskit/qiskit",
        provider_key="qiskit",
        maintenance_state=MaintenanceState.MAINTAINED,
        acquisition_enabled=True,
        qualification_note=(
            "Official public Qiskit SDK source. Repository identity and declared "
            "metadata do not establish a VQE capability or runtime compatibility."
        ),
    ),
    StandardSource(
        source_key="qiskit-nature",
        display_name="Qiskit Nature",
        source_kind=StandardSourceKind.GITHUB_REPOSITORY,
        role=StandardSourceRole.FRAMEWORK,
        canonical_locator="https://github.com/qiskit-community/qiskit-nature",
        provider_key="qiskit",
        maintenance_state=MaintenanceState.MAINTAINED,
        acquisition_enabled=True,
        qualification_note=(
            "Official public source. Metadata acquisition does not establish "
            "component capability or runtime compatibility."
        ),
    ),
    StandardSource(
        source_key="qiskit-algorithms",
        display_name="Qiskit Algorithms",
        source_kind=StandardSourceKind.GITHUB_REPOSITORY,
        role=StandardSourceRole.ALGORITHM_LIBRARY,
        canonical_locator="https://github.com/qiskit-community/qiskit-algorithms",
        provider_key="qiskit",
        maintenance_state=MaintenanceState.UNSUPPORTED_BY_ORIGINAL_VENDOR,
        acquisition_enabled=True,
        qualification_note=(
            "Pinned source may support historical reproduction, but the repository "
            "states that IBM no longer officially supports it. Never label current "
            "compatibility from source presence alone."
        ),
    ),
    StandardSource(
        source_key="pennylane",
        display_name="PennyLane",
        source_kind=StandardSourceKind.GITHUB_REPOSITORY,
        role=StandardSourceRole.FRAMEWORK,
        canonical_locator="https://github.com/PennyLaneAI/pennylane",
        provider_key="pennylane",
        maintenance_state=MaintenanceState.MAINTAINED,
        acquisition_enabled=True,
        qualification_note=(
            "Official public source. Executable bindings remain version- and runtime-specific."
        ),
    ),
    StandardSource(
        source_key="openfermion",
        display_name="OpenFermion",
        source_kind=StandardSourceKind.GITHUB_REPOSITORY,
        role=StandardSourceRole.OPERATOR_LIBRARY,
        canonical_locator="https://github.com/quantumlib/OpenFermion",
        provider_key="openfermion",
        maintenance_state=MaintenanceState.MAINTAINED,
        acquisition_enabled=True,
        qualification_note=(
            "Official public source for fermionic/qubit operator representation "
            "and transformations; not a complete VQE workflow provider."
        ),
    ),
    StandardSource(
        source_key="hamlib-dataset",
        display_name="HamLib dataset",
        source_kind=StandardSourceKind.DATASET,
        role=StandardSourceRole.PROBLEM_DATASET,
        canonical_locator="https://portal.nersc.gov/cfs/m888/dcamps/hamlib/",
        provider_key="hamlib",
        maintenance_state=MaintenanceState.DATASET_RELEASE,
        acquisition_enabled=False,
        qualification_note=(
            "Authoritative dataset distribution is not a GitHub repository and "
            "must use a separate bounded dataset provider."
        ),
    ),
    StandardSource(
        source_key="hamlib-functions",
        display_name="HamLib helper functions",
        source_kind=StandardSourceKind.GITHUB_REPOSITORY,
        role=StandardSourceRole.DATASET_HELPER,
        canonical_locator="https://github.com/Azulene-Labs/hamlib_functions",
        provider_key="hamlib",
        maintenance_state=MaintenanceState.UNKNOWN,
        acquisition_enabled=True,
        qualification_note=(
            "Paper-linked helper code only. It must not be represented as the "
            "HamLib dataset or as an algorithm provider."
        ),
    ),
)


def get_standard_source(source_key: str) -> StandardSource:
    for source in STANDARD_VQE_SOURCES:
        if source.source_key == source_key:
            return source
    raise KeyError(source_key)


def github_acquisition_allowlist() -> frozenset[str]:
    return frozenset(
        source.canonical_locator
        for source in STANDARD_VQE_SOURCES
        if source.source_kind is StandardSourceKind.GITHUB_REPOSITORY and source.acquisition_enabled
    )


def require_approved_github_source(repository_url: str) -> StandardSource:
    normalized = repository_url.rstrip("/").removesuffix(".git").casefold()
    for source in STANDARD_VQE_SOURCES:
        if (
            source.source_kind is StandardSourceKind.GITHUB_REPOSITORY
            and source.acquisition_enabled
            and source.canonical_locator.casefold() == normalized
        ):
            return source
    raise ValueError("repository is not approved for the standard-component MVP")
