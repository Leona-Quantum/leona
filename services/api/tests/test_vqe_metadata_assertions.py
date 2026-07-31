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


def test_extractor_records_allowlisted_declared_facts_with_exact_locators():
    citation = b"""cff-version: 1.2.0\ntitle: Qiskit Nature\nversion: 0.8.0\nauthors:\n  - name: Not extracted\n"""
    pyproject = b"""[project]\nname = "qiskit-nature"\nversion = "0.8.0"\nrequires-python = ">=3.9"\ndependencies = ["qiskit>=1.0", "numpy"]\n\n[build-system]\nrequires = ["setuptools"]\nbuild-backend = "setuptools.build_meta"\n"""
    assertions = extract_metadata_assertions(
        get_standard_source("qiskit-nature"),
        _snapshot(_file("CITATION.cff", citation), _file("pyproject.toml", pyproject)),
    )
    by_predicate = {item.predicate: item for item in assertions}
    citation_facts = {
        item.field: item
        for item in by_predicate[MetadataPredicate.CITATION_FILE_PRESENT].declared_facts
    }
    dependency_facts = {
        item.field: item
        for item in by_predicate[MetadataPredicate.DEPENDENCY_DECLARATION_PRESENT].declared_facts
    }

    assert citation_facts["citation.title"].value == "Qiskit Nature"
    assert citation_facts["citation.title"].locator.pointer == "/title"
    assert (
        citation_facts["citation.title"].locator.content_sha256
        == hashlib.sha256(citation).hexdigest()
    )
    assert "citation.authors" not in citation_facts
    assert dependency_facts["project.dependencies"].value == ("qiskit>=1.0", "numpy")
    assert dependency_facts["project.dependencies"].locator.pointer == "/project/dependencies"
    assert dependency_facts["build-system.build-backend"].value == "setuptools.build_meta"


@pytest.mark.parametrize(
    ("path", "content", "predicate", "issue_code"),
    [
        (
            "CITATION.cff",
            b"title: &title unsafe\nmessage: *title\n",
            MetadataPredicate.CITATION_FILE_PRESENT,
            "yaml_alias_rejected",
        ),
        (
            "CITATION.cff",
            b"title: first\ntitle: second\n",
            MetadataPredicate.CITATION_FILE_PRESENT,
            "duplicate_mapping_key",
        ),
        (
            "pyproject.toml",
            b"[project\nname = 'broken'\n",
            MetadataPredicate.DEPENDENCY_DECLARATION_PRESENT,
            "invalid_toml",
        ),
    ],
)
def test_structured_extractor_fails_closed_with_bounded_issue(path, content, predicate, issue_code):
    assertions = extract_metadata_assertions(
        get_standard_source("qiskit-nature"), _snapshot(_file(path, content))
    )
    assertion = next(item for item in assertions if item.predicate is predicate)
    assert assertion.declared_facts == ()
    assert [item.code for item in assertion.extraction_issues] == [issue_code]
    assert content.decode(errors="ignore") not in str(assertion.as_dict())


def test_structured_extractor_records_out_of_bounds_declared_value_as_unknown_issue():
    content = b"[project]\ndependencies = [1, 2]\n"
    assertions = extract_metadata_assertions(
        get_standard_source("qiskit-nature"), _snapshot(_file("pyproject.toml", content))
    )
    assertion = next(
        item
        for item in assertions
        if item.predicate is MetadataPredicate.DEPENDENCY_DECLARATION_PRESENT
    )

    assert assertion.declared_facts == ()
    assert [item.code for item in assertion.extraction_issues] == [
        "field_not_bounded_string_list:project.dependencies"
    ]


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
    assert serialized["declared_facts"] == []
