from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
from types import ModuleType

import pytest
from majorana_api.github_snapshot import GitHubMetadataFile, GitHubRepositorySnapshot
from majorana_llm.client import LLMRequest, LLMResponse

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "run-phase9-private-deepseek-dry-run.py"


def _load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("phase9_private_deepseek_dry_run", SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def dry_run() -> ModuleType:
    return _load_script()


def _snapshot() -> GitHubRepositorySnapshot:
    content = b"""[project]\nname = "qiskit-nature"\nrequires-python = ">=3.10"\n"""
    digest = hashlib.sha256(content).hexdigest()
    metadata_file = GitHubMetadataFile(
        path="pyproject.toml",
        mode="100644",
        blob_sha="1" * 40,
        size=len(content),
        content_sha256=digest,
        content=content,
    )
    return GitHubRepositorySnapshot(
        api_version="2026-03-10",
        repository_id=123,
        repository_node_id="R_test",
        full_name="qiskit-community/qiskit-nature",
        canonical_repository_url="https://github.com/qiskit-community/qiskit-nature",
        requested_ref="4" * 40,
        default_branch="main",
        archived=False,
        disabled=False,
        commit_sha="4" * 40,
        tree_sha="5" * 40,
        tree_entry_count=1,
        tree_manifest_sha256="6" * 64,
        selected_metadata_bytes=len(content),
        skipped_oversized_paths=(),
        metadata_files=(metadata_file,),
        metadata_manifest_sha256="7" * 64,
    )


class _CountingLLM:
    def __init__(self) -> None:
        self.calls = 0

    async def complete(self, request: LLMRequest, *, on_delta=None) -> LLMResponse:
        del on_delta
        self.calls += 1
        evidence_id = json.loads(request.user)["evidence_bundle"]["items"][0]["evidence_id"]
        return LLMResponse(
            model="deepseek-v4-flash",
            input_tokens=101,
            output_tokens=37,
            text=json.dumps(
                {
                    "schema_version": "atlas.research-candidate-response.v1",
                    "candidates": [
                        {
                            "local_id": "candidate_qiskit_nature",
                            "candidate_type": "implementation",
                            "fields": [
                                {
                                    "field": "name",
                                    "value": "SENSITIVE_CANDIDATE_VALUE",
                                    "evidence_ids": [evidence_id],
                                }
                            ],
                            "unknowns": [],
                            "conflicts": [],
                        }
                    ],
                }
            ),
        )


@pytest.mark.asyncio
async def test_generation_calls_provider_once_and_audit_omits_candidate_values(dry_run) -> None:
    llm = _CountingLLM()

    envelope = await dry_run.generate_once(snapshot=_snapshot(), llm=llm)
    audit = dry_run.build_redacted_success_audit(envelope)

    assert llm.calls == 1
    assert audit["provider_request_count"] == 1
    assert audit["retry_count"] == 0
    assert audit["candidate_count"] == 1
    encoded = json.dumps(audit)
    assert "SENSITIVE_CANDIDATE_VALUE" not in encoded
    assert "candidates" not in audit
    assert audit["publication_eligible"] is False
    assert audit["materialization_eligible"] is False


def test_stale_phase8_identity_is_rejected_before_provider(dry_run) -> None:
    snapshot = _snapshot()
    record = {
        "repository_url": snapshot.canonical_repository_url,
        "commit_sha": "8" * 40,
        "metadata_manifest_sha256": snapshot.metadata_manifest_sha256,
        "selected_metadata_bytes": snapshot.selected_metadata_bytes,
        "selected_metadata_files": dry_run._snapshot_file_records(snapshot),
    }

    with pytest.raises(dry_run.DryRunFailure, match="snapshot_phase8_identity_mismatch"):
        dry_run.verify_snapshot_against_phase8(record, snapshot)


def test_private_output_inside_repository_is_rejected(dry_run, tmp_path: Path) -> None:
    repository = tmp_path / "repo"
    repository.mkdir()

    with pytest.raises(dry_run.DryRunFailure, match="private_output_must_be_outside_repository"):
        dry_run.validate_private_output_path(
            repository / "candidate.json",
            repository_root=repository,
        )


def test_private_envelope_file_is_created_exclusively_with_mode_0600(
    dry_run,
    tmp_path: Path,
) -> None:
    output = tmp_path / "private" / "candidate.json"
    dry_run._write_json_exclusive(output, {"private": True}, mode=0o600)

    assert os.stat(output).st_mode & 0o777 == 0o600
    with pytest.raises(FileExistsError):
        dry_run._write_json_exclusive(output, {"private": True}, mode=0o600)


@pytest.mark.asyncio
async def test_existing_private_output_fails_before_snapshot_or_provider(
    dry_run,
    tmp_path: Path,
) -> None:
    private_output = tmp_path / "already-there.json"
    private_output.write_text("do not overwrite")
    snapshot_calls = 0

    async def snapshot_builder(*_args):
        nonlocal snapshot_calls
        snapshot_calls += 1
        return _snapshot()

    llm = _CountingLLM()
    with pytest.raises(dry_run.DryRunFailure, match="private_output_already_exists"):
        await dry_run.execute(
            phase8_report=tmp_path / "not-read.json",
            private_output=private_output,
            model=dry_run.MODEL,
            llm=llm,
            snapshot_builder=snapshot_builder,
        )

    assert snapshot_calls == 0
    assert llm.calls == 0
    assert private_output.read_text() == "do not overwrite"


def test_failure_audit_is_sanitized(dry_run) -> None:
    failure = dry_run.DryRunFailure(
        "provider_rate_limit",
        provider_call_performed=True,
        provider_request_count=1,
    )

    audit = dry_run.build_redacted_failure_audit(failure, model="deepseek-v4-flash")

    assert audit["failure_code"] == "provider_rate_limit"
    assert audit["provider_request_count"] == 1
    assert "response" not in audit
    assert "private_output" not in audit
