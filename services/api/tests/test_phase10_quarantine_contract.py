from __future__ import annotations

import base64
import copy
import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from majorana_api.phase10_acquisition_contract import (
    Phase10AcquisitionAuthorization,
    build_phase10_acquisition_request,
)
from majorana_api.phase10_acquisition_result import build_phase10_acquisition_result
from majorana_api.phase10_destination_policy import validate_phase10_destination_answers
from majorana_api.phase10_github_request_plan import build_phase10_github_request_plan
from majorana_api.phase10_github_response import validate_phase10_github_content_response
from majorana_api.phase10_quarantine_contract import (
    QUARANTINE_KEY_PREFIX,
    QUARANTINE_LOCATOR_PREFIX,
    Phase10QuarantineContractError,
    Phase10QuarantinePlan,
    build_phase10_quarantine_plan,
)

COMMIT = "a" * 40
REQUESTED_AT = datetime(2026, 8, 3, 12, 0, 0, tzinfo=UTC)
WORKSPACE_ID = uuid.UUID("019fa990-657d-7c92-a548-5cc1dda7e894")
OTHER_WORKSPACE_ID = uuid.UUID("019fa990-657d-7c92-a548-5cc1dda7e895")
CONTENT = b"print('safe')\n"


def _acquisition_result():
    request = build_phase10_acquisition_request(
        repository_id=123,
        full_name="quantumlib/OpenFermion",
        immutable_ref=COMMIT,
        selected_paths=("src/example.py",),
        requested_at=REQUESTED_AT,
    )
    destination = validate_phase10_destination_answers(
        host="api.github.com",
        port=443,
        answers=("93.184.216.34",),
        resolved_at=REQUESTED_AT + timedelta(seconds=1),
    )
    plan = build_phase10_github_request_plan(
        Phase10AcquisitionAuthorization(request=request, destination=destination)
    )
    git_payload = f"blob {len(CONTENT)}\0".encode() + CONTENT
    payload = {
        "type": "file",
        "encoding": "base64",
        "size": len(CONTENT),
        "name": "example.py",
        "path": "src/example.py",
        "content": base64.b64encode(CONTENT).decode(),
        "sha": hashlib.sha1(git_payload).hexdigest(),
        "url": None,
        "git_url": None,
        "html_url": None,
        "download_url": None,
        "_links": {"git": None, "html": None, "self": None},
    }
    body = json.dumps(payload).encode()
    validated = validate_phase10_github_content_response(
        plan=plan,
        selected_path="src/example.py",
        status_code=200,
        headers=(("Content-Type", "application/json"),),
        body=body,
    )
    return build_phase10_acquisition_result(
        request_plan=plan,
        fetched_at=REQUESTED_AT + timedelta(seconds=2),
        validated_files=(validated,),
    )


def _plan() -> Phase10QuarantinePlan:
    return build_phase10_quarantine_plan(
        workspace_id=WORKSPACE_ID,
        acquisition_result=_acquisition_result(),
    )


def _rehash(payload: dict) -> None:
    body = {key: value for key, value in payload.items() if key != "plan_sha256"}
    payload["plan_sha256"] = hashlib.sha256(
        json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def test_quarantine_plan_is_content_addressed_opaque_and_contains_no_bytes():
    plan = _plan()
    item = plan.objects[0]

    assert item.opaque_locator == f"{QUARANTINE_LOCATOR_PREFIX}{item.sha256}"
    assert item.internal_object_key == (
        f"{QUARANTINE_KEY_PREFIX}/{item.sha256[:2]}/{item.sha256[2:]}"
    )
    assert "http" not in item.opaque_locator
    assert "bucket" not in item.opaque_locator
    assert "print('safe')" not in json.dumps(plan.to_plan())
    assert Phase10QuarantinePlan.from_plan(plan.to_plan()).to_plan() == plan.to_plan()


def test_workspace_scope_is_required_and_cross_workspace_access_is_denied():
    plan = _plan()
    plan.require_workspace(WORKSPACE_ID)

    with pytest.raises(
        Phase10QuarantineContractError,
        match="quarantine_cross_workspace_denied",
    ):
        plan.require_workspace(OTHER_WORKSPACE_ID)


def test_already_read_storage_bytes_must_round_trip_exactly():
    plan = _plan()
    plan.verify_readback(selected_path="src/example.py", content=CONTENT)

    with pytest.raises(
        Phase10QuarantineContractError,
        match="quarantine_readback_length_mismatch",
    ):
        plan.verify_readback(selected_path="src/example.py", content=CONTENT + b"x")
    with pytest.raises(
        Phase10QuarantineContractError,
        match="quarantine_readback_digest_mismatch",
    ):
        plan.verify_readback(selected_path="src/example.py", content=b"x" * len(CONTENT))
    with pytest.raises(
        Phase10QuarantineContractError,
        match="quarantine_path_not_in_plan",
    ):
        plan.verify_readback(selected_path="src/other.py", content=CONTENT)


def test_locator_or_outer_digest_tampering_is_rejected():
    payload = _plan().to_plan()
    payload["objects"][0]["opaque_locator"] = "qobj:v1:sha256:" + ("c" * 64)
    _rehash(payload)
    with pytest.raises(
        Phase10QuarantineContractError,
        match="noncanonical_quarantine_object_identity",
    ):
        Phase10QuarantinePlan.from_plan(payload)

    payload = _plan().to_plan()
    payload["workspace_id"] = str(OTHER_WORKSPACE_ID)
    with pytest.raises(
        Phase10QuarantineContractError,
        match="quarantine_plan_digest_mismatch",
    ):
        Phase10QuarantinePlan.from_plan(payload)


def test_unknown_fields_versions_and_noncanonical_workspace_fail_closed():
    payload = _plan().to_plan()
    with_unknown = copy.deepcopy(payload)
    with_unknown["public_url"] = "https://example.invalid"
    with pytest.raises(Phase10QuarantineContractError, match="invalid_quarantine_plan"):
        Phase10QuarantinePlan.from_plan(with_unknown)

    payload["contract_version"] = "phase10-s3-quarantine-preflight/2"
    _rehash(payload)
    with pytest.raises(
        Phase10QuarantineContractError,
        match="unsupported_quarantine_contract",
    ):
        Phase10QuarantinePlan.from_plan(payload)

    with pytest.raises(
        Phase10QuarantineContractError,
        match="invalid_quarantine_workspace",
    ):
        build_phase10_quarantine_plan(
            workspace_id=uuid.UUID(int=0),
            acquisition_result=_acquisition_result(),
        )


@pytest.mark.parametrize(
    ("field", "value", "failure"),
    [
        ("selected_path", "../secret", "invalid_retrieval_path"),
        ("media_type", "application/octet-stream", "invalid_quarantine_object"),
        ("length", 256 * 1024 + 1, "invalid_quarantine_object"),
    ],
)
def test_self_consistent_unsafe_object_changes_are_rejected(field, value, failure):
    payload = _plan().to_plan()
    payload["objects"][0][field] = value
    _rehash(payload)

    with pytest.raises(Phase10QuarantineContractError, match=failure):
        Phase10QuarantinePlan.from_plan(payload)
