import hashlib

from majorana_api.github_snapshot import GitHubMetadataFile, GitHubRepositorySnapshot
from majorana_api.vqe_extraction_evaluation import (
    ExpectedDeclaredFact,
    evaluate_declared_facts,
)
from majorana_api.vqe_metadata_assertions import extract_metadata_assertions
from majorana_api.vqe_standard_sources import get_standard_source

CITATION = b"cff-version: 1.2.0\ntitle: Qiskit Nature\nversion: 0.8.0\n"
PYPROJECT = b"""[project]\nname = "qiskit-nature"\nversion = "0.8.0"\ndependencies = ["qiskit>=1.0", "numpy"]\n"""
REQUIREMENTS = b"qiskit==1.4.6\nnumpy>=1.26\n"
DOCKERFILE = b'FROM python:3.12-slim\nENTRYPOINT ["python", "-m", "app"]\n'
WORKFLOW = b"name: CI\non: [push, workflow_dispatch]\n"
UV_LOCK = b"""version = 1
[[package]]
name = "numpy"
version = "2.1.0"
"""


def _file(path: str, content: bytes) -> GitHubMetadataFile:
    return GitHubMetadataFile(
        path=path,
        mode="100644",
        blob_sha="a" * 40,
        size=len(content),
        content_sha256=hashlib.sha256(content).hexdigest(),
        content=content,
    )


def _snapshot() -> GitHubRepositorySnapshot:
    files = (
        _file("CITATION.cff", CITATION),
        _file("pyproject.toml", PYPROJECT),
        _file("requirements.txt", REQUIREMENTS),
        _file("Dockerfile", DOCKERFILE),
        _file(".github/workflows/ci.yml", WORKFLOW),
        _file("uv.lock", UV_LOCK),
    )
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
        metadata_files=files,
        metadata_manifest_sha256="e" * 64,
    )


def _expected() -> tuple[ExpectedDeclaredFact, ...]:
    citation_digest = hashlib.sha256(CITATION).hexdigest()
    pyproject_digest = hashlib.sha256(PYPROJECT).hexdigest()
    requirements_digest = hashlib.sha256(REQUIREMENTS).hexdigest()
    dockerfile_digest = hashlib.sha256(DOCKERFILE).hexdigest()
    workflow_digest = hashlib.sha256(WORKFLOW).hexdigest()
    uv_lock_digest = hashlib.sha256(UV_LOCK).hexdigest()
    return (
        ExpectedDeclaredFact(
            "citation.cff-version", "1.2.0", "CITATION.cff", "/cff-version", citation_digest
        ),
        ExpectedDeclaredFact(
            "citation.title", "Qiskit Nature", "CITATION.cff", "/title", citation_digest
        ),
        ExpectedDeclaredFact(
            "citation.version", "0.8.0", "CITATION.cff", "/version", citation_digest
        ),
        ExpectedDeclaredFact(
            "project.name", "qiskit-nature", "pyproject.toml", "/project/name", pyproject_digest
        ),
        ExpectedDeclaredFact(
            "project.version", "0.8.0", "pyproject.toml", "/project/version", pyproject_digest
        ),
        ExpectedDeclaredFact(
            "project.dependencies",
            ("qiskit>=1.0", "numpy"),
            "pyproject.toml",
            "/project/dependencies",
            pyproject_digest,
        ),
        ExpectedDeclaredFact(
            "requirements.declaration",
            "qiskit==1.4.6",
            "requirements.txt",
            "/lines/1",
            requirements_digest,
        ),
        ExpectedDeclaredFact(
            "requirements.declaration",
            "numpy>=1.26",
            "requirements.txt",
            "/lines/2",
            requirements_digest,
        ),
        ExpectedDeclaredFact(
            "dockerfile.from",
            "python:3.12-slim",
            "Dockerfile",
            "/lines/1",
            dockerfile_digest,
        ),
        ExpectedDeclaredFact(
            "dockerfile.entrypoint",
            '["python", "-m", "app"]',
            "Dockerfile",
            "/lines/2",
            dockerfile_digest,
        ),
        ExpectedDeclaredFact(
            "github-actions.name",
            "CI",
            ".github/workflows/ci.yml",
            "/name",
            workflow_digest,
        ),
        ExpectedDeclaredFact(
            "github-actions.triggers",
            ("push", "workflow_dispatch"),
            ".github/workflows/ci.yml",
            "/on",
            workflow_digest,
        ),
        ExpectedDeclaredFact(
            "uv-lock.package.name",
            "numpy",
            "uv.lock",
            "/package/0/name",
            uv_lock_digest,
        ),
        ExpectedDeclaredFact(
            "uv-lock.package.version",
            "2.1.0",
            "uv.lock",
            "/package/0/version",
            uv_lock_digest,
        ),
    )


def test_synthetic_golden_baseline_has_exact_fact_and_locator_scores():
    assertions = extract_metadata_assertions(get_standard_source("qiskit-nature"), _snapshot())
    metrics = evaluate_declared_facts(assertions, _expected())

    assert metrics.as_dict() == {
        "expected_facts": 14,
        "extracted_facts": 14,
        "true_positive_facts": 14,
        "precision": 1.0,
        "recall": 1.0,
        "evidence_locator_accuracy": 1.0,
    }


def test_locator_accuracy_is_not_conflated_with_fact_recall():
    assertions = extract_metadata_assertions(get_standard_source("qiskit-nature"), _snapshot())
    expected = list(_expected())
    expected[0] = ExpectedDeclaredFact(
        field=expected[0].field,
        value=expected[0].value,
        path=expected[0].path,
        pointer="/wrong",
        content_sha256=expected[0].content_sha256,
    )
    metrics = evaluate_declared_facts(assertions, tuple(expected))

    assert metrics.precision == 1.0
    assert metrics.recall == 1.0
    assert metrics.evidence_locator_accuracy == 13 / 14
