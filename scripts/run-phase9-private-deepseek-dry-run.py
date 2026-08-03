#!/usr/bin/env python3
"""Run one private, fail-closed Phase 9 DeepSeek extraction candidate.

The full candidate envelope is written outside the repository with mode 0600.
Only a redacted operational audit record is eligible for a repository path.
This command never retries the provider request and never materializes or
publishes a candidate.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Protocol

from majorana_api.github_client import GitHubClientError, GitHubNetworkMode, GitHubRestClient
from majorana_api.github_coordinates import parse_public_github_repository
from majorana_api.github_snapshot import (
    GitHubRepositorySnapshot,
    GitHubSnapshotError,
    build_github_metadata_snapshot,
)
from majorana_api.vqe_metadata_assertions import EXTRACTOR_VERSION, extract_metadata_assertions
from majorana_api.vqe_standard_sources import get_standard_source
from majorana_llm.client import LLMClient, LLMProviderError, OpenAICompatibleLLM
from majorana_llm.research_extraction import (
    DeclaredEvidenceInput,
    ResearchCandidateEnvelope,
    ResearchInputRejected,
    ResearchResponseRejected,
    assemble_research_evidence_bundle,
    build_research_candidate_envelope,
    build_research_extraction_request,
)

MODEL = "deepseek-v4-flash"
PROVIDER = "deepseek"
SOURCE_KEY = "qiskit-nature"
AUDIT_SCHEMA_VERSION = "atlas.phase9.private-live-dry-run-audit.v1"
PHASE8_REPORT = (
    Path(__file__).resolve().parents[1]
    / "docs/atlas/evidence/phase8/official_provider_dry_run_2026-07-31.json"
)
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


class _SnapshotBuilder(Protocol):
    async def __call__(
        self,
        client: GitHubRestClient,
        coordinate: Any,
    ) -> GitHubRepositorySnapshot: ...


class DryRunFailure(RuntimeError):
    """Stable failure without provider text, source bytes, or credentials."""

    def __init__(
        self,
        code: str,
        *,
        provider_call_performed: bool = False,
        provider_request_count: int = 0,
    ) -> None:
        self.code = code
        self.provider_call_performed = provider_call_performed
        self.provider_request_count = provider_request_count
        super().__init__(code)


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private-output", type=Path, required=True)
    parser.add_argument("--audit-output", type=Path, required=True)
    parser.add_argument("--phase8-report", type=Path, default=PHASE8_REPORT)
    parser.add_argument("--model", default=MODEL, choices=(MODEL,))
    return parser.parse_args()


def _canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _canonical_sha256(value: object) -> str:
    return hashlib.sha256(_canonical_json_bytes(value)).hexdigest()


def _read_phase8_source_record(path: Path) -> dict[str, Any]:
    try:
        report = json.loads(path.read_text())
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise DryRunFailure("phase8_report_unreadable") from exc
    if not isinstance(report, dict):
        raise DryRunFailure("phase8_report_invalid")
    if report.get("extractor_version") != EXTRACTOR_VERSION:
        raise DryRunFailure("phase8_extractor_version_mismatch")
    if report.get("failures") != [] or report.get("publication_eligible") is not False:
        raise DryRunFailure("phase8_report_not_eligible_for_private_dry_run")
    sources = report.get("sources")
    if not isinstance(sources, list):
        raise DryRunFailure("phase8_report_invalid")
    matches = [
        item for item in sources if isinstance(item, dict) and item.get("source_key") == SOURCE_KEY
    ]
    if len(matches) != 1:
        raise DryRunFailure("phase8_source_identity_ambiguous")
    return matches[0]


def _snapshot_file_records(snapshot: GitHubRepositorySnapshot) -> list[dict[str, object]]:
    return [
        {
            "path": item.path,
            "size": item.size,
            "content_sha256": item.content_sha256,
        }
        for item in snapshot.metadata_files
    ]


def verify_snapshot_against_phase8(
    source_record: dict[str, Any],
    snapshot: GitHubRepositorySnapshot,
) -> None:
    """Fail before provider contact if any pinned Phase 8 identity changed."""

    source = get_standard_source(SOURCE_KEY)
    expected = {
        "repository_url": source_record.get("repository_url"),
        "commit_sha": source_record.get("commit_sha"),
        "metadata_manifest_sha256": source_record.get("metadata_manifest_sha256"),
        "selected_metadata_bytes": source_record.get("selected_metadata_bytes"),
        "selected_metadata_files": source_record.get("selected_metadata_files"),
    }
    observed = {
        "repository_url": snapshot.canonical_repository_url,
        "commit_sha": snapshot.commit_sha,
        "metadata_manifest_sha256": snapshot.metadata_manifest_sha256,
        "selected_metadata_bytes": snapshot.selected_metadata_bytes,
        "selected_metadata_files": _snapshot_file_records(snapshot),
    }
    if source.canonical_locator.casefold() != snapshot.canonical_repository_url.casefold():
        raise DryRunFailure("snapshot_repository_mismatch")
    if expected != observed:
        raise DryRunFailure("snapshot_phase8_identity_mismatch")


def _declared_evidence(snapshot: GitHubRepositorySnapshot) -> tuple[DeclaredEvidenceInput, ...]:
    source = get_standard_source(SOURCE_KEY)
    assertions = extract_metadata_assertions(source, snapshot)
    if assertions != extract_metadata_assertions(source, snapshot):
        raise DryRunFailure("phase8_extraction_non_deterministic")

    unique: dict[bytes, DeclaredEvidenceInput] = {}
    for assertion in assertions:
        for fact in assertion.declared_facts:
            value: object = list(fact.value) if isinstance(fact.value, tuple) else fact.value
            evidence = DeclaredEvidenceInput(
                field=fact.field,
                value=value,
                path=fact.locator.path,
                pointer=fact.locator.pointer,
                source_sha256=fact.locator.content_sha256,
            )
            unique[_canonical_json_bytes(evidence.model_dump(mode="json"))] = evidence
    return tuple(unique[key] for key in sorted(unique))


def _build_bundle(snapshot: GitHubRepositorySnapshot):
    snapshot_sha256 = _canonical_sha256(snapshot.audit_manifest())
    return assemble_research_evidence_bundle(
        repository_id=snapshot.repository_id,
        commit_sha=snapshot.commit_sha,
        snapshot_sha256=snapshot_sha256,
        phase8_extractor_version=EXTRACTOR_VERSION,
        declared_facts=_declared_evidence(snapshot),
    )


async def generate_once(
    *,
    snapshot: GitHubRepositorySnapshot,
    llm: LLMClient,
    model: str = MODEL,
) -> ResearchCandidateEnvelope:
    """Make exactly one provider call; the caller owns all retry policy (none)."""

    bundle = _build_bundle(snapshot)
    request = build_research_extraction_request(bundle, model=model)
    try:
        response = await llm.complete(request)
        return build_research_candidate_envelope(
            provider=PROVIDER,
            bundle=bundle,
            request=request,
            provider_response=response,
        )
    except LLMProviderError as exc:
        raise DryRunFailure(
            f"provider_{exc.code}",
            provider_call_performed=True,
            provider_request_count=1,
        ) from exc
    except ResearchResponseRejected as exc:
        raise DryRunFailure(
            f"response_{exc.code}",
            provider_call_performed=True,
            provider_request_count=1,
        ) from exc


def build_redacted_success_audit(
    envelope: ResearchCandidateEnvelope,
) -> dict[str, object]:
    candidates = envelope.response.candidates
    return {
        "schema_version": AUDIT_SCHEMA_VERSION,
        "status": "succeeded",
        "scope": "single_private_official-provider_metadata_candidate",
        "source_key": SOURCE_KEY,
        "repository_id": envelope.repository_id,
        "commit_sha": envelope.commit_sha,
        "snapshot_sha256": envelope.snapshot_sha256,
        "input_bundle_sha256": envelope.input_bundle_sha256,
        "response_sha256": envelope.response_sha256,
        "envelope_sha256": envelope.deterministic_digest,
        "provider": envelope.provider,
        "requested_model": envelope.requested_model,
        "served_model": envelope.served_model,
        "input_tokens": envelope.input_tokens,
        "output_tokens": envelope.output_tokens,
        "provider_call_performed": True,
        "provider_request_count": 1,
        "retry_count": 0,
        "candidate_count": len(candidates),
        "field_proposal_count": sum(len(item.fields) for item in candidates),
        "unknown_count": sum(len(item.unknowns) for item in candidates),
        "conflict_count": sum(len(item.conflicts) for item in candidates),
        "machine_validation_state": envelope.machine_validation_state,
        "human_review_state": envelope.human_review_state,
        "private_envelope_written": True,
        "candidate_values_in_audit": False,
        "raw_provider_response_persisted": False,
        "scientific_correctness": "not_measured",
        "extraction_precision_recall": "not_measured_without_independent_gold_labels",
        "publication_eligible": False,
        "materialization_eligible": False,
        "limitations": [
            "One model response does not establish model quality or scientific correctness",
            "Declared package metadata does not establish VQE capability or compatibility",
            "Candidate values remain private and unreviewed",
            "No target repository code was cloned, imported, installed, or executed",
        ],
    }


def build_redacted_failure_audit(failure: DryRunFailure, *, model: str) -> dict[str, object]:
    return {
        "schema_version": AUDIT_SCHEMA_VERSION,
        "status": "failed",
        "scope": "single_private_official-provider_metadata_candidate",
        "source_key": SOURCE_KEY,
        "failure_code": failure.code,
        "provider": PROVIDER,
        "requested_model": model,
        "provider_call_performed": failure.provider_call_performed,
        "provider_request_count": failure.provider_request_count,
        "retry_count": 0,
        "private_envelope_written": False,
        "candidate_values_in_audit": False,
        "raw_provider_response_persisted": False,
        "scientific_correctness": "not_measured",
        "publication_eligible": False,
        "materialization_eligible": False,
    }


def _resolved(path: Path) -> Path:
    return path.expanduser().resolve(strict=False)


def validate_private_output_path(path: Path, *, repository_root: Path = REPOSITORY_ROOT) -> Path:
    resolved = _resolved(path)
    if resolved.is_relative_to(_resolved(repository_root)):
        raise DryRunFailure("private_output_must_be_outside_repository")
    return resolved


def _write_json_exclusive(path: Path, value: object, *, mode: int) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2)
            handle.write("\n")
    except BaseException:
        path.unlink(missing_ok=True)
        raise


async def execute(
    *,
    phase8_report: Path,
    private_output: Path,
    model: str,
    llm: LLMClient | None = None,
    snapshot_builder: _SnapshotBuilder = build_github_metadata_snapshot,
) -> tuple[ResearchCandidateEnvelope, dict[str, object]]:
    private_path = validate_private_output_path(private_output)
    if private_path.exists():
        raise DryRunFailure("private_output_already_exists")
    source_record = _read_phase8_source_record(phase8_report)
    pinned_commit = source_record.get("commit_sha")
    if not isinstance(pinned_commit, str):
        raise DryRunFailure("phase8_commit_missing")
    source = get_standard_source(SOURCE_KEY)
    coordinate = parse_public_github_repository(
        source.canonical_locator,
        requested_ref=pinned_commit,
    )
    token = os.environ.get("GITHUB_TOKEN") or None
    try:
        async with GitHubRestClient(
            token=token,
            network_mode=GitHubNetworkMode.LIVE_OFFICIAL_PROVIDER_METADATA,
        ) as github:
            snapshot = await snapshot_builder(github, coordinate)
    except (GitHubClientError, GitHubSnapshotError) as exc:
        code = getattr(exc, "failure_code", "snapshot_retrieval_failed")
        raise DryRunFailure(f"github_{code}") from exc
    verify_snapshot_against_phase8(source_record, snapshot)
    try:
        envelope = await generate_once(
            snapshot=snapshot,
            llm=llm or OpenAICompatibleLLM(),
            model=model,
        )
    except ResearchInputRejected as exc:
        raise DryRunFailure(f"input_{exc.code}") from exc
    try:
        _write_json_exclusive(private_path, envelope.model_dump(mode="json"), mode=0o600)
    except OSError as exc:
        raise DryRunFailure(
            "private_output_write_failed",
            provider_call_performed=True,
            provider_request_count=1,
        ) from exc
    return envelope, build_redacted_success_audit(envelope)


def main() -> int:
    args = _arguments()
    try:
        _, audit = asyncio.run(
            execute(
                phase8_report=args.phase8_report,
                private_output=args.private_output,
                model=args.model,
            )
        )
    except DryRunFailure as exc:
        audit = build_redacted_failure_audit(exc, model=args.model)
        try:
            _write_json_exclusive(_resolved(args.audit_output), audit, mode=0o644)
        except OSError:
            print("phase9_private_dry_run_failed:audit_write_failed")
            return 1
        print(f"phase9_private_dry_run_failed:{exc.code}")
        return 1
    except (OSError, ValueError):
        print("phase9_private_dry_run_failed:unexpected_failure")
        return 1

    try:
        _write_json_exclusive(_resolved(args.audit_output), audit, mode=0o644)
    except OSError:
        _resolved(args.private_output).unlink(missing_ok=True)
        print("phase9_private_dry_run_failed:audit_write_failed")
        return 1
    print("phase9_private_dry_run_succeeded")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
