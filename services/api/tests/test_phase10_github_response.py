from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta

import pytest

from majorana_api.phase10_acquisition_contract import (
    Phase10AcquisitionAuthorization,
    build_phase10_acquisition_request,
)
from majorana_api.phase10_destination_policy import validate_phase10_destination_answers
from majorana_api.phase10_github_request_plan import (
    MAX_GITHUB_CONTENT_RESPONSE_BYTES,
    build_phase10_github_request_plan,
)
from majorana_api.phase10_github_response import (
    GITHUB_CONTENT_RESPONSE_POLICY_VERSION,
    Phase10GitHubResponseError,
    validate_phase10_github_content_response,
)
from majorana_api.phase10_retrieval_manifest import MAX_SELECTED_FILE_BYTES

COMMIT = "a" * 40
REQUESTED_AT = datetime(2026, 8, 3, 12, 0, 0, tzinfo=UTC)
CONTENT = b"print('safe')\n"


def _plan():
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
    return build_phase10_github_request_plan(
        Phase10AcquisitionAuthorization(request=request, destination=destination)
    )


def _payload(
    *,
    content: bytes = CONTENT,
    path: str = "src/example.py",
    kind: str = "file",
    encoding: str = "base64",
) -> dict:
    return {
        "type": kind,
        "encoding": encoding,
        "size": len(content),
        "name": path.rsplit("/", 1)[-1],
        "path": path,
        "content": base64.b64encode(content).decode("ascii"),
        "sha": "b" * 40,
        "url": "https://api.github.com/untrusted",
        "git_url": "https://api.github.com/untrusted-git",
        "html_url": "https://github.com/untrusted-html",
        "download_url": "https://raw.githubusercontent.com/untrusted",
        "_links": {
            "git": "https://api.github.com/untrusted-git",
            "html": "https://github.com/untrusted-html",
            "self": "https://api.github.com/untrusted",
        },
    }


def _body(payload: object | None = None) -> bytes:
    return json.dumps(_payload() if payload is None else payload).encode()


def _headers(body: bytes) -> tuple[tuple[str, str], ...]:
    return (
        ("Content-Type", "application/json; charset=utf-8"),
        ("Content-Encoding", "identity"),
        ("Content-Length", str(len(body))),
    )


def _validate(*, body: bytes | None = None, **overrides):
    response_body = _body() if body is None else body
    arguments = {
        "plan": _plan(),
        "selected_path": "src/example.py",
        "status_code": 200,
        "headers": _headers(response_body),
        "body": response_body,
    }
    arguments.update(overrides)
    return validate_phase10_github_content_response(**arguments)


def test_valid_file_becomes_bound_utf8_evidence_without_following_links():
    result = _validate()

    assert result.selected_path == "src/example.py"
    assert result.content == CONTENT
    assert result.file_evidence.selected_path == "src/example.py"
    assert result.file_evidence.media_type == "text/x-python"
    assert result.file_evidence.length == len(CONTENT)
    assert result.github_blob_sha == "b" * 40
    assert result.request_plan_sha256 == _plan().plan_sha256
    assert result.response_policy_version == GITHUB_CONTENT_RESPONSE_POLICY_VERSION


@pytest.mark.parametrize("status_code", [201, 404, 500])
def test_non_success_statuses_are_rejected(status_code: int):
    with pytest.raises(Phase10GitHubResponseError, match="github_response_status_rejected"):
        _validate(status_code=status_code)


def test_redirects_are_rejected_even_when_the_body_looks_valid():
    with pytest.raises(Phase10GitHubResponseError, match="github_response_redirect_rejected"):
        _validate(status_code=302)


@pytest.mark.parametrize(
    ("headers", "failure"),
    [
        ((("Content-Type", "text/plain"),), "unsupported_github_response_media_type"),
        (
            (
                ("Content-Type", "application/json"),
                ("Content-Encoding", "gzip"),
            ),
            "github_response_content_encoding_rejected",
        ),
        (
            (
                ("Content-Type", "application/json"),
                ("Content-Type", "application/vnd.github+json"),
            ),
            "duplicate_github_response_content-type",
        ),
    ],
)
def test_ambiguous_or_encoded_http_envelopes_are_rejected(headers, failure):
    with pytest.raises(Phase10GitHubResponseError, match=failure):
        _validate(headers=headers)


def test_content_length_and_body_limits_are_enforced():
    with pytest.raises(
        Phase10GitHubResponseError,
        match="github_response_content_length_mismatch",
    ):
        _validate(headers=(("Content-Type", "application/json"), ("Content-Length", "1")))

    oversized = b"{" + (b" " * MAX_GITHUB_CONTENT_RESPONSE_BYTES) + b"}"
    with pytest.raises(
        Phase10GitHubResponseError,
        match="github_response_body_limit_exceeded",
    ):
        _validate(body=oversized, headers=(("Content-Type", "application/json"),))


def test_directory_symlink_submodule_and_wrong_path_are_rejected():
    for kind in ("dir", "symlink", "submodule"):
        body = _body(_payload(kind=kind))
        with pytest.raises(
            Phase10GitHubResponseError,
            match="github_response_not_regular_file",
        ):
            _validate(body=body)

    body = _body(_payload(path="src/other.py"))
    with pytest.raises(Phase10GitHubResponseError, match="github_response_path_mismatch"):
        _validate(body=body)


def test_invalid_base64_size_and_binary_content_are_rejected():
    invalid_base64 = _payload()
    invalid_base64["content"] = "%%%"
    with pytest.raises(Phase10GitHubResponseError, match="invalid_github_content_base64"):
        _validate(body=_body(invalid_base64))

    wrong_size = _payload()
    wrong_size["size"] += 1
    with pytest.raises(Phase10GitHubResponseError, match="github_content_size_mismatch"):
        _validate(body=_body(wrong_size))

    binary = _payload(content=b"a\x00b")
    with pytest.raises(Phase10GitHubResponseError, match="binary_retrieval_content_rejected"):
        _validate(body=_body(binary))

    too_large = _payload(content=b"a")
    too_large["size"] = MAX_SELECTED_FILE_BYTES + 1
    with pytest.raises(Phase10GitHubResponseError, match="invalid_github_content_size"):
        _validate(body=_body(too_large))


def test_duplicate_json_keys_arrays_unknown_fields_and_bom_fail_closed():
    duplicate = b'{"type":"file","type":"symlink"}'
    with pytest.raises(
        Phase10GitHubResponseError,
        match="duplicate_github_response_json_key",
    ):
        _validate(body=duplicate)

    with pytest.raises(Phase10GitHubResponseError, match="github_response_not_file_object"):
        _validate(body=b"[]")

    unknown = _payload()
    unknown["attacker"] = "value"
    with pytest.raises(Phase10GitHubResponseError, match="invalid_github_file_object_shape"):
        _validate(body=_body(unknown))

    with pytest.raises(Phase10GitHubResponseError, match="github_response_bom_rejected"):
        _validate(body=b"\xef\xbb\xbf" + _body())


def test_selected_path_must_be_exactly_one_operation_in_the_plan():
    with pytest.raises(Phase10GitHubResponseError, match="github_response_path_not_in_plan"):
        _validate(selected_path="src/not-selected.py")
