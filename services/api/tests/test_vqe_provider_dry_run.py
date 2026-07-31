import hashlib
import json

from majorana_api.github_snapshot import GitHubMetadataFile, GitHubRepositorySnapshot
from majorana_api.vqe_provider_dry_run import build_redacted_source_report
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
        skipped_oversized_paths=("uv.lock",),
        metadata_files=tuple(files),
        metadata_manifest_sha256="e" * 64,
    )


def test_redacted_report_keeps_locators_and_omits_source_bytes_and_fact_values():
    secret_literal = "private-example-value-must-not-leak"
    snapshot = _snapshot(
        _file("pyproject.toml", f'[project]\nname = "{secret_literal}"\n'.encode()),
    )

    report = build_redacted_source_report(get_standard_source("qiskit-nature"), snapshot)
    serialized = json.dumps(report, sort_keys=True)

    assert report["deterministic_replay"] is True
    assert report["publication_eligible"] is False
    assert report["declared_fact_count"] == 1
    assert report["declared_field_counts"] == {"project.name": 1}
    assert report["skipped_oversized_paths"] == ["uv.lock"]
    assert secret_literal not in serialized


def test_redacted_report_records_bounded_parser_issue_identity_without_exception_text():
    content = b"name: broken\ndefault:\t''\n"
    report = build_redacted_source_report(
        get_standard_source("qiskit-nature"),
        _snapshot(_file(".github/workflows/broken.yml", content)),
    )

    assert report["issue_count"] == 1
    assert report["issue_code_counts"] == {"github-actions:invalid_yaml": 1}
    assert report["extraction_issues"] == [
        {
            "path": ".github/workflows/broken.yml",
            "parser": "github-actions",
            "code": "invalid_yaml",
            "content_sha256": hashlib.sha256(content).hexdigest(),
        }
    ]
    assert "ScannerError" not in json.dumps(report)
