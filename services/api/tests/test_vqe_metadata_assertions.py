import dataclasses
import hashlib

import pytest

from majorana_api.github_snapshot import GitHubMetadataFile, GitHubRepositorySnapshot
from majorana_api.vqe_metadata_assertions import (
    EXTRACTOR_VERSION,
    MetadataPredicate,
    extract_metadata_assertions,
)
from majorana_api.vqe_standard_sources import get_standard_source


def _file(path: str, content: bytes) -> GitHubMetadataFile:
    return GitHubMetadataFile(
        path=path,
        mode="100644",
        blob_sha="a" * 40,
        size=len(content),
        content_sha256=hashlib.sha256(content).hexdigest(),
        content=content,
    )


def _snapshot(*files: GitHubMetadataFile) -> GitHubRepositorySnapshot:
    return GitHubRepositorySnapshot(
        api_version="2026-03-10",
        repository_id=123,
        repository_node_id="R_123",
        full_name="qiskit-community/qiskit-nature",
        canonical_repository_url="https://github.com/qiskit-community/qiskit-nature",
        requested_ref="v0.8.0",
        default_branch="main",
        archived=False,
        disabled=False,
        commit_sha="b" * 40,
        tree_sha="c" * 40,
        tree_entry_count=len(files),
        tree_manifest_sha256="d" * 64,
        selected_metadata_bytes=sum(item.size for item in files),
        skipped_oversized_paths=(),
        metadata_files=tuple(files),
        metadata_manifest_sha256="e" * 64,
    )


def test_extractor_records_presence_only_with_content_evidence():
    snapshot = _snapshot(
        _file("LICENSE.txt", b"license bytes"),
        _file("pyproject.toml", b"[project]"),
        _file(".github/workflows/test.yml", b"name: test"),
    )
    assertions = extract_metadata_assertions(get_standard_source("qiskit-nature"), snapshot)
    by_predicate = {item.predicate: item for item in assertions}

    assert len(assertions) == 4
    assert by_predicate[MetadataPredicate.LICENSE_FILE_PRESENT].observed is True
    assert by_predicate[MetadataPredicate.CITATION_FILE_PRESENT].observed is False
    assert by_predicate[MetadataPredicate.DEPENDENCY_DECLARATION_PRESENT].evidence_paths == (
        "pyproject.toml",
    )
    assert by_predicate[MetadataPredicate.CI_WORKFLOW_PRESENT].evidence_content_sha256 == (
        hashlib.sha256(b"name: test").hexdigest(),
    )
    assert all(item.extractor_version == EXTRACTOR_VERSION for item in assertions)


def test_extractor_is_deterministic_and_rejects_wrong_repository():
    snapshot = _snapshot(_file("CITATION.cff", b"cff-version: 1.2.0"))
    first = extract_metadata_assertions(get_standard_source("qiskit-nature"), snapshot)
    second = extract_metadata_assertions(get_standard_source("qiskit-nature"), snapshot)
    assert first == second

    wrong = dataclasses.replace(
        snapshot,
        canonical_repository_url="https://github.com/PennyLaneAI/pennylane",
    )
    with pytest.raises(ValueError, match="does not match"):
        extract_metadata_assertions(get_standard_source("qiskit-nature"), wrong)


def test_filename_does_not_become_license_or_capability_claim():
    assertion = extract_metadata_assertions(
        get_standard_source("qiskit-nature"),
        _snapshot(_file("LICENSE", b"not parsed")),
    )[0]
    serialized = assertion.as_dict()
    assert serialized["predicate"] == "license_file_present"
    assert "spdx" not in serialized
    assert "capability" not in serialized
