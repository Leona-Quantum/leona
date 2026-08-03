from __future__ import annotations

import copy
import hashlib
import json

import pytest

from majorana_api.phase10_source_normalizer import (
    Phase10NormalizedSourceManifest,
    NormalizedSourceFile,
)
from majorana_api.phase10_static_candidate import (
    STATIC_CANDIDATE_DISPOSITION,
    Phase10StaticCandidateError,
    Phase10StaticExecutionCandidate,
    build_phase10_static_execution_candidate,
)


def _file(path: str, media_type: str, content: bytes) -> NormalizedSourceFile:
    digest = hashlib.sha256(content).hexdigest()
    return NormalizedSourceFile(
        selected_path=path,
        media_type=media_type,
        length=len(content),
        sha256=digest,
        opaque_locator=f"qobj:v1:sha256:{digest}",
    )


def _source() -> Phase10NormalizedSourceManifest:
    return Phase10NormalizedSourceManifest(
        workspace_id="019fa990-657d-7c92-a548-5cc1dda7e894",
        acquisition_result_sha256="a" * 64,
        quarantine_plan_sha256="b" * 64,
        files=(
            _file("entry.py", "text/x-python", b"print('not executed')\n"),
            _file("pyproject.toml", "application/toml", b"[project]\nname='demo'\n"),
            _file("readme.md", "text/markdown", b"Qiskit example\n"),
        ),
    )


def _candidate(
    *,
    framework: str = "qiskit",
    license_status: str = "verified_compatible",
    provenance_status: str = "verified",
) -> Phase10StaticExecutionCandidate:
    return build_phase10_static_execution_candidate(
        normalized_source=_source(),
        framework=framework,
        framework_evidence_paths=("readme.md",),
        package_evidence_paths=("pyproject.toml",),
        requested_entrypoint_path="entry.py",
        license_status=license_status,
        provenance_status=provenance_status,
    )


def _rehash(payload: dict) -> None:
    body = {key: value for key, value in payload.items() if key != "candidate_sha256"}
    payload["candidate_sha256"] = hashlib.sha256(
        json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


@pytest.mark.parametrize(
    ("framework", "profile"),
    [
        ("qiskit", "phase10-python-qiskit-1.4.6-candidate-v1"),
        ("pennylane", "phase10-python-pennylane-0.45.1-candidate-v1"),
    ],
)
def test_supported_framework_maps_to_fixed_structured_only_candidate(framework, profile):
    candidate = _candidate(framework=framework)
    payload = candidate.to_candidate()
    serialized = json.dumps(payload)

    assert candidate.disposition == STATIC_CANDIDATE_DISPOSITION
    assert candidate.proposed_runtime_profile == profile
    assert candidate.blocking_reasons == (
        "external_runtime_policy_unqualified",
        "static_entrypoint_review_pending",
    )
    assert "print('not executed')" not in serialized
    assert "command" not in serialized
    assert "arguments" not in serialized
    assert Phase10StaticExecutionCandidate.from_candidate(payload).to_candidate() == payload


def test_rights_and_provenance_uncertainty_add_blocking_reasons():
    candidate = _candidate(license_status="unknown", provenance_status="unverified")

    assert candidate.blocking_reasons[-2:] == (
        "license_review_incomplete",
        "provenance_review_incomplete",
    )
    assert candidate.disposition == "structured_only"


def test_unsupported_framework_entrypoint_or_unselected_evidence_fails_closed():
    with pytest.raises(
        Phase10StaticCandidateError,
        match="unsupported_candidate_framework",
    ):
        _candidate(framework="custom-vqe")

    kwargs = {
        "normalized_source": _source(),
        "framework": "qiskit",
        "framework_evidence_paths": ("missing.md",),
        "package_evidence_paths": ("pyproject.toml",),
        "requested_entrypoint_path": "entry.py",
        "license_status": "verified_compatible",
        "provenance_status": "verified",
    }
    with pytest.raises(
        Phase10StaticCandidateError,
        match="candidate_evidence_not_in_source",
    ):
        build_phase10_static_execution_candidate(**kwargs)

    kwargs["framework_evidence_paths"] = ("readme.md",)
    kwargs["requested_entrypoint_path"] = "readme.md"
    with pytest.raises(
        Phase10StaticCandidateError,
        match="unsupported_candidate_entrypoint",
    ):
        build_phase10_static_execution_candidate(**kwargs)


@pytest.mark.parametrize(
    ("field", "value", "failure"),
    [
        ("disposition", "executable", "candidate_execution_not_qualified"),
        ("launcher_id", "python -m entry", "unapproved_candidate_protocol"),
        (
            "proposed_runtime_profile",
            "caller-selected-latest",
            "unapproved_candidate_runtime_mapping",
        ),
        (
            "blocking_reasons",
            [],
            "invalid_candidate_blocking_reasons",
        ),
    ],
)
def test_self_consistent_execution_escalation_or_mapping_change_is_denied(field, value, failure):
    payload = _candidate().to_candidate()
    payload[field] = value
    _rehash(payload)

    with pytest.raises(Phase10StaticCandidateError, match=failure):
        Phase10StaticExecutionCandidate.from_candidate(payload)


def test_unknown_fields_and_outer_digest_tampering_fail_closed():
    payload = _candidate().to_candidate()
    with_unknown = copy.deepcopy(payload)
    with_unknown["shell_command"] = "python entry.py"
    with pytest.raises(Phase10StaticCandidateError, match="invalid_static_candidate"):
        Phase10StaticExecutionCandidate.from_candidate(with_unknown)

    payload["normalized_source_manifest_sha256"] = "f" * 64
    with pytest.raises(
        Phase10StaticCandidateError,
        match="static_candidate_digest_mismatch",
    ):
        Phase10StaticExecutionCandidate.from_candidate(payload)


def test_self_consistent_invalid_source_descriptor_is_rejected():
    payload = _candidate().to_candidate()
    payload["source_files"][0]["media_type"] = "application/octet-stream"
    _rehash(payload)

    with pytest.raises(
        Phase10StaticCandidateError,
        match="invalid_candidate_source_file",
    ):
        Phase10StaticExecutionCandidate.from_candidate(payload)
