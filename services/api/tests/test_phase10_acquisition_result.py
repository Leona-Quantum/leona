from __future__ import annotations

import base64
import dataclasses
import hashlib
import json
from datetime import UTC, datetime, timedelta

import pytest

from majorana_api.phase10_acquisition_contract import (
    Phase10AcquisitionAuthorization,
    build_phase10_acquisition_request,
)
from majorana_api.phase10_acquisition_result import (
    Phase10AcquisitionResult,
    Phase10AcquisitionResultError,
    build_phase10_acquisition_result,
)
from majorana_api.phase10_destination_policy import validate_phase10_destination_answers
from majorana_api.phase10_github_request_plan import build_phase10_github_request_plan
from majorana_api.phase10_github_response import validate_phase10_github_content_response

COMMIT = "a" * 40
REQUESTED_AT = datetime(2026, 8, 3, 12, 0, 0, tzinfo=UTC)


def _plan():
    request = build_phase10_acquisition_request(
        repository_id=123,
        full_name="quantumlib/OpenFermion",
        immutable_ref=COMMIT,
        selected_paths=("README.md", "src/example.py"),
        requested_at=REQUESTED_AT,
    )
    destination = validate_phase10_destination_answers(
        host="api.github.com",
        port=443,
        answers=("93.184.216.34",),
        resolved_at=REQUESTED_AT + timedelta(seconds=1),
    )
    return build_phase10_github_request_plan(
        Phase10AcquisitionAuthorization(request=request, destination=destination)
    )


def _validated(plan, path: str, content: bytes):
    git_payload = f"blob {len(content)}\0".encode() + content
    payload = {
        "type": "file",
        "encoding": "base64",
        "size": len(content),
        "name": path.rsplit("/", 1)[-1],
        "path": path,
        "content": base64.b64encode(content).decode(),
        "sha": hashlib.sha1(git_payload).hexdigest(),
        "url": None,
        "git_url": None,
        "html_url": None,
        "download_url": None,
        "_links": {"git": None, "html": None, "self": None},
    }
    body = json.dumps(payload).encode()
    return validate_phase10_github_content_response(
        plan=plan,
        selected_path=path,
        status_code=200,
        headers=(("Content-Type", "application/json"),),
        body=body,
    )


def _files(plan):
    return (
        _validated(plan, "README.md", b"# OpenFermion\n"),
        _validated(plan, "src/example.py", b"print('safe')\n"),
    )


def _result():
    plan = _plan()
    return build_phase10_acquisition_result(
        request_plan=plan,
        fetched_at=REQUESTED_AT + timedelta(seconds=2),
        validated_files=_files(plan),
    )


def _rehash(payload: dict) -> None:
    body = {key: value for key, value in payload.items() if key != "result_sha256"}
    payload["result_sha256"] = hashlib.sha256(
        json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def test_complete_result_round_trips_without_source_bytes():
    result = _result()
    payload = result.to_result()

    assert Phase10AcquisitionResult.from_result(payload).to_result() == payload
    assert [item.selected_path for item in result.responses] == [
        "README.md",
        "src/example.py",
    ]
    assert [item.selected_path for item in result.retrieval_manifest.files] == [
        "README.md",
        "src/example.py",
    ]
    serialized = json.dumps(payload)
    assert "# OpenFermion" not in serialized
    assert "print('safe')" not in serialized


@pytest.mark.parametrize("selection", [slice(1, None), slice(None, 1), slice(None, None, -1)])
def test_missing_or_noncanonical_responses_cannot_be_aggregated(selection):
    plan = _plan()
    with pytest.raises(
        Phase10AcquisitionResultError,
        match="incomplete_or_noncanonical_acquisition_result",
    ):
        build_phase10_acquisition_result(
            request_plan=plan,
            fetched_at=REQUESTED_AT + timedelta(seconds=2),
            validated_files=_files(plan)[selection],
        )


def test_response_from_another_plan_is_rejected():
    plan = _plan()
    foreign = dataclasses.replace(_files(plan)[0], request_plan_sha256="c" * 64)

    with pytest.raises(
        Phase10AcquisitionResultError,
        match="acquisition_result_response_binding_mismatch",
    ):
        build_phase10_acquisition_result(
            request_plan=plan,
            fetched_at=REQUESTED_AT + timedelta(seconds=2),
            validated_files=(foreign, _files(plan)[1]),
        )


def test_fetch_time_must_be_inside_the_authorized_destination_window():
    plan = _plan()
    with pytest.raises(
        Phase10AcquisitionResultError,
        match="acquisition_outside_destination_window",
    ):
        build_phase10_acquisition_result(
            request_plan=plan,
            fetched_at=REQUESTED_AT + timedelta(hours=1),
            validated_files=_files(plan),
        )


def test_outer_digest_and_inner_file_binding_detect_tampering():
    payload = _result().to_result()
    payload["responses"][0]["response_body_sha256"] = "c" * 64
    with pytest.raises(
        Phase10AcquisitionResultError,
        match="acquisition_result_digest_mismatch",
    ):
        Phase10AcquisitionResult.from_result(payload)

    payload = _result().to_result()
    payload["responses"][0]["file_sha256"] = "c" * 64
    _rehash(payload)
    with pytest.raises(
        Phase10AcquisitionResultError,
        match="acquisition_result_file_digest_mismatch",
    ):
        Phase10AcquisitionResult.from_result(payload)


def test_unknown_fields_and_versions_fail_closed():
    payload = _result().to_result()
    payload["unexpected"] = True
    with pytest.raises(Phase10AcquisitionResultError, match="invalid_acquisition_result"):
        Phase10AcquisitionResult.from_result(payload)

    payload = _result().to_result()
    payload["result_policy_version"] = "phase10-s2-acquisition-result/2"
    _rehash(payload)
    with pytest.raises(
        Phase10AcquisitionResultError,
        match="unsupported_acquisition_result_policy",
    ):
        Phase10AcquisitionResult.from_result(payload)
