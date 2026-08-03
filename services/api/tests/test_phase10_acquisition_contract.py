from __future__ import annotations

import copy
import hashlib
import json
from datetime import UTC, datetime, timedelta

import pytest

from majorana_api.phase10_acquisition_contract import (
    ACQUISITION_CONNECTOR,
    ACQUISITION_OPERATION,
    Phase10AcquisitionAuthorization,
    Phase10AcquisitionContractError,
    Phase10AcquisitionRequest,
    build_phase10_acquisition_request,
)
from majorana_api.phase10_destination_policy import validate_phase10_destination_answers
from majorana_api.phase10_retrieval_manifest import (
    RetrievedFileEvidence,
    build_phase10_retrieval_manifest,
)

COMMIT = "a" * 40
REQUESTED_AT = datetime(2026, 8, 3, 12, 0, 0, tzinfo=UTC)
RESOLVED_AT = REQUESTED_AT + timedelta(seconds=10)


def _request() -> Phase10AcquisitionRequest:
    return build_phase10_acquisition_request(
        repository_id=123,
        full_name="quantumlib/OpenFermion",
        immutable_ref=COMMIT,
        selected_paths=("src/z.py", "README.md", "src/a.py"),
        requested_at=REQUESTED_AT,
    )


def _destination(resolved_at: datetime = RESOLVED_AT):
    return validate_phase10_destination_answers(
        host="api.github.com",
        port=443,
        answers=("2606:2800:220:1:248:1893:25c8:1946", "93.184.216.34"),
        resolved_at=resolved_at,
    )


def _authorization() -> Phase10AcquisitionAuthorization:
    return Phase10AcquisitionAuthorization(request=_request(), destination=_destination())


def _manifest(*, fetched_at: datetime | None = None, commit: str = COMMIT):
    files = tuple(
        RetrievedFileEvidence.from_bytes(
            selected_path=path,
            media_type="text/plain",
            content=f"content for {path}\n".encode(),
        )
        for path in _request().selected_paths
    )
    return build_phase10_retrieval_manifest(
        repository_id=123,
        full_name="quantumlib/OpenFermion",
        immutable_ref=commit,
        fetched_at=fetched_at or (RESOLVED_AT + timedelta(seconds=20)),
        files=files,
    )


def _rehash(payload: dict, digest_key: str) -> None:
    body = {key: value for key, value in payload.items() if key != digest_key}
    payload[digest_key] = hashlib.sha256(
        json.dumps(
            body,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


def test_request_is_canonical_digest_bound_and_has_no_transport_injection_surface():
    request = _request()
    payload = request.to_request()

    assert request.selected_paths == ("README.md", "src/a.py", "src/z.py")
    assert payload["connector"] == ACQUISITION_CONNECTOR
    assert payload["operation"] == ACQUISITION_OPERATION
    assert payload["source_host"] == "api.github.com"
    assert payload["source_port"] == 443
    assert not ({"url", "headers", "credential", "proxy", "command", "entrypoint"} & payload.keys())
    assert Phase10AcquisitionRequest.from_request(payload).to_request() == payload


def test_request_digest_and_unknown_fields_detect_tampering():
    payload = _request().to_request()
    payload["immutable_ref"] = "b" * 40
    with pytest.raises(
        Phase10AcquisitionContractError,
        match="acquisition_request_digest_mismatch",
    ):
        Phase10AcquisitionRequest.from_request(payload)

    payload = _request().to_request()
    payload["url"] = "https://attacker.invalid"
    with pytest.raises(Phase10AcquisitionContractError, match="invalid_acquisition_request"):
        Phase10AcquisitionRequest.from_request(payload)


@pytest.mark.parametrize(
    ("field", "value", "failure"),
    [
        ("source_host", "localhost", "acquisition_source_host_mismatch"),
        ("source_port", 80, "acquisition_source_port_mismatch"),
        ("operation", "arbitrary_get", "acquisition_operation_not_allowed"),
        ("connector", "arbitrary_url", "acquisition_connector_not_allowed"),
    ],
)
def test_fixed_connector_operation_and_destination_cannot_be_overridden(
    field: str, value: object, failure: str
):
    payload = _request().to_request()
    payload[field] = value
    _rehash(payload, "request_sha256")

    with pytest.raises(Phase10AcquisitionContractError, match=failure):
        Phase10AcquisitionRequest.from_request(payload)


def test_request_rejects_mutable_refs_unsafe_paths_duplicates_and_naive_time():
    with pytest.raises(
        Phase10AcquisitionContractError,
        match="mutable_or_invalid_retrieval_ref",
    ):
        build_phase10_acquisition_request(
            repository_id=123,
            full_name="quantumlib/OpenFermion",
            immutable_ref="main",
            selected_paths=("README.md",),
            requested_at=REQUESTED_AT,
        )
    with pytest.raises(Phase10AcquisitionContractError, match="invalid_retrieval_path"):
        build_phase10_acquisition_request(
            repository_id=123,
            full_name="quantumlib/OpenFermion",
            immutable_ref=COMMIT,
            selected_paths=("../secret",),
            requested_at=REQUESTED_AT,
        )
    with pytest.raises(Phase10AcquisitionContractError, match="duplicate_retrieval_path"):
        build_phase10_acquisition_request(
            repository_id=123,
            full_name="quantumlib/OpenFermion",
            immutable_ref=COMMIT,
            selected_paths=("README.md", "README.md"),
            requested_at=REQUESTED_AT,
        )
    with pytest.raises(Phase10AcquisitionContractError, match="invalid_acquisition_timestamp"):
        build_phase10_acquisition_request(
            repository_id=123,
            full_name="quantumlib/OpenFermion",
            immutable_ref=COMMIT,
            selected_paths=("README.md",),
            requested_at=datetime(2026, 8, 3, 12, 0, 0),
        )


def test_authorization_round_trip_binds_request_and_destination_evidence():
    authorization = _authorization()
    payload = authorization.to_authorization()

    restored = Phase10AcquisitionAuthorization.from_authorization(payload)

    assert restored.to_authorization() == payload
    restored.validate_manifest(_manifest())


def test_authorization_digest_detects_destination_tampering():
    payload = _authorization().to_authorization()
    payload["destination"]["addresses"] = ["8.8.8.8"]

    with pytest.raises(
        Phase10AcquisitionContractError,
        match="acquisition_authorization_digest_mismatch",
    ):
        Phase10AcquisitionAuthorization.from_authorization(payload)


def test_authorization_rejects_resolution_before_request():
    with pytest.raises(
        Phase10AcquisitionContractError,
        match="acquisition_resolution_before_request",
    ):
        Phase10AcquisitionAuthorization(
            request=_request(),
            destination=_destination(REQUESTED_AT - timedelta(seconds=1)),
        )


def test_manifest_must_match_exact_repository_commit_and_selected_path_set():
    authorization = _authorization()
    altered = copy.deepcopy(_manifest().to_manifest())
    altered["immutable_ref"] = "b" * 40
    _rehash(altered, "manifest_sha256")

    from majorana_api.phase10_retrieval_manifest import Phase10RetrievalManifest

    with pytest.raises(
        Phase10AcquisitionContractError,
        match="acquisition_repository_binding_mismatch",
    ):
        authorization.validate_manifest(Phase10RetrievalManifest.from_manifest(altered))

    missing_path_manifest = build_phase10_retrieval_manifest(
        repository_id=123,
        full_name="quantumlib/OpenFermion",
        immutable_ref=COMMIT,
        fetched_at=RESOLVED_AT + timedelta(seconds=20),
        files=(_manifest().files[0],),
    )
    with pytest.raises(
        Phase10AcquisitionContractError,
        match="acquisition_path_binding_mismatch",
    ):
        authorization.validate_manifest(missing_path_manifest)


def test_manifest_timestamp_must_follow_request_and_fit_destination_window():
    authorization = _authorization()

    with pytest.raises(
        Phase10AcquisitionContractError,
        match="acquisition_fetched_before_request",
    ):
        authorization.validate_manifest(_manifest(fetched_at=REQUESTED_AT - timedelta(seconds=1)))
    with pytest.raises(
        Phase10AcquisitionContractError,
        match="acquisition_outside_destination_window",
    ):
        authorization.validate_manifest(_manifest(fetched_at=RESOLVED_AT + timedelta(seconds=61)))
