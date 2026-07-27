import dataclasses

import pytest

from majorana_api.vqe_standard_sources import (
    MaintenanceState,
    STANDARD_VQE_SOURCES,
    StandardSourceKind,
    get_standard_source,
    github_acquisition_allowlist,
    require_approved_github_source,
)


def test_standard_sources_are_unique_and_immutable():
    assert len(STANDARD_VQE_SOURCES) == 6
    assert len({source.source_key for source in STANDARD_VQE_SOURCES}) == 6
    assert len({source.canonical_locator.casefold() for source in STANDARD_VQE_SOURCES}) == 6
    with pytest.raises(dataclasses.FrozenInstanceError):
        STANDARD_VQE_SOURCES[0].source_key = "changed"  # type: ignore[misc]


def test_hamlib_dataset_is_not_misrouted_through_github():
    dataset = get_standard_source("hamlib-dataset")
    helper = get_standard_source("hamlib-functions")
    assert dataset.source_kind is StandardSourceKind.DATASET
    assert dataset.acquisition_enabled is False
    assert helper.source_kind is StandardSourceKind.GITHUB_REPOSITORY
    assert helper.canonical_locator in github_acquisition_allowlist()


def test_qiskit_algorithms_maintenance_warning_is_preserved():
    source = get_standard_source("qiskit-algorithms")
    assert source.maintenance_state is MaintenanceState.UNSUPPORTED_BY_ORIGINAL_VENDOR
    assert "no longer" in source.qualification_note


def test_only_exact_approved_repository_coordinates_are_accepted():
    source = require_approved_github_source("https://github.com/qiskit-community/qiskit-nature.git")
    assert source.source_key == "qiskit-nature"
    with pytest.raises(ValueError, match="not approved"):
        require_approved_github_source("https://github.com/example/unreviewed")
