from __future__ import annotations

import copy
import hashlib
import json
from datetime import UTC, datetime, timedelta

import pytest

from majorana_api.github_coordinates import GITHUB_API_VERSION
from majorana_api.phase10_acquisition_contract import (
    Phase10AcquisitionAuthorization,
    build_phase10_acquisition_request,
)
from majorana_api.phase10_destination_policy import validate_phase10_destination_answers
from majorana_api.phase10_github_request_plan import (
    GITHUB_CONTENT_ACCEPT,
    GITHUB_REQUEST_PLAN_VERSION,
    MAX_GITHUB_CONTENT_RESPONSE_BYTES,
    Phase10GitHubRequestPlan,
    Phase10GitHubRequestPlanError,
    build_phase10_github_request_plan,
)

COMMIT = "a" * 40
REQUESTED_AT = datetime(2026, 8, 3, 12, 0, 0, tzinfo=UTC)


def _authorization(
    *, selected_paths: tuple[str, ...] = ("README.md", "src/a file#?.py")
) -> Phase10AcquisitionAuthorization:
    request = build_phase10_acquisition_request(
        repository_id=123,
        full_name="quantumlib/OpenFermion",
        immutable_ref=COMMIT,
        selected_paths=selected_paths,
        requested_at=REQUESTED_AT,
    )
    destination = validate_phase10_destination_answers(
        host="api.github.com",
        port=443,
        answers=("93.184.216.34",),
        resolved_at=REQUESTED_AT + timedelta(seconds=1),
    )
    return Phase10AcquisitionAuthorization(request=request, destination=destination)


def _plan() -> Phase10GitHubRequestPlan:
    return build_phase10_github_request_plan(_authorization())


def _rehash(payload: dict) -> None:
    body = {key: value for key, value in payload.items() if key != "plan_sha256"}
    payload["plan_sha256"] = hashlib.sha256(
        json.dumps(
            body,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


def test_plan_compiles_only_fixed_gets_at_the_exact_commit():
    plan = _plan()

    assert plan.plan_version == GITHUB_REQUEST_PLAN_VERSION
    assert [operation.selected_path for operation in plan.operations] == [
        "README.md",
        "src/a file#?.py",
    ]
    for operation in plan.operations:
        assert operation.method == "GET"
        assert operation.query == (("ref", COMMIT),)
        assert operation.follow_redirects is False
        assert operation.max_response_bytes == MAX_GITHUB_CONTENT_RESPONSE_BYTES
        assert ("Accept", GITHUB_CONTENT_ACCEPT) in operation.headers
        assert ("Accept-Encoding", "identity") in operation.headers
        assert ("X-GitHub-Api-Version", GITHUB_API_VERSION) in operation.headers
        assert not any(name.casefold() == "authorization" for name, _ in operation.headers)


def test_selected_path_is_percent_encoded_without_changing_path_segments():
    operation = _plan().operations[1]

    assert operation.request_path == (
        "/repos/quantumlib/OpenFermion/contents/src/a%20file%23%3F.py"
    )
    assert "?" not in operation.request_path
    assert "#" not in operation.request_path


def test_plan_round_trip_is_canonical_and_digest_bound():
    payload = _plan().to_plan()

    assert Phase10GitHubRequestPlan.from_plan(payload).to_plan() == payload

    altered = copy.deepcopy(payload)
    altered["operations"][0]["request_path"] = "/repos/attacker/repo/contents/a"
    with pytest.raises(
        Phase10GitHubRequestPlanError,
        match="noncanonical_github_request_operations",
    ):
        Phase10GitHubRequestPlan.from_plan(altered)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("method", "POST"),
        ("query", [["ref", "main"]]),
        ("follow_redirects", True),
        ("max_response_bytes", 10_000_000),
        ("headers", [["Accept", "*/*"]]),
    ],
)
def test_self_consistent_transport_policy_changes_are_rejected(field: str, value: object):
    payload = _plan().to_plan()
    payload["operations"][0][field] = value
    _rehash(payload)

    with pytest.raises(
        Phase10GitHubRequestPlanError,
        match="noncanonical_github_request_operations",
    ):
        Phase10GitHubRequestPlan.from_plan(payload)


def test_unknown_transport_fields_and_operation_names_are_rejected():
    payload = _plan().to_plan()
    payload["operations"][0]["url"] = "https://attacker.invalid"
    with pytest.raises(
        Phase10GitHubRequestPlanError,
        match="invalid_github_request_operation",
    ):
        Phase10GitHubRequestPlan.from_plan(payload)

    payload = _plan().to_plan()
    payload["operations"][0]["operation"] = "download_archive"
    with pytest.raises(
        Phase10GitHubRequestPlanError,
        match="github_operation_not_allowed",
    ):
        Phase10GitHubRequestPlan.from_plan(payload)


def test_plan_does_not_accept_transport_options_at_builder_boundary():
    with pytest.raises(TypeError):
        build_phase10_github_request_plan(  # type: ignore[call-arg]
            _authorization(),
            url="https://attacker.invalid",
        )
