"""`Client`'s Qapp calls: `start_qapp_execution`, `wait_for_qapp_execution` and
`run_qapp` — ai-ops 349 option 2's "call it as an API" endpoint.

Offline, with the same recording fake transport `test_client_runs.py` uses; these
methods call the SAME `POST /v1/qapps/{slug}/executions` /
`GET /v1/qapps/executions/{id}` routes `test_client_runs.py`'s `/runs` methods call,
so the fake API here is a fake of that route pair, not a new execution path.
"""

from __future__ import annotations

import json

import pytest

from leona_client.client import Client, LeonaClientError

_TOKEN = "lq_pat_test_token_never_leaves_this_file"  # noqa: S105 - a fixture value
_EXECUTION_ID = "55555555-5555-5555-5555-555555555555"
_QAPP_ID = "66666666-6666-6666-6666-666666666666"
_VERSION_ID = "77777777-7777-7777-7777-777777777777"


def _execution_json(*, status="queued", result=None, error_code=None):
    return {
        "id": _EXECUTION_ID,
        "qapp_id": _QAPP_ID,
        "qapp_version_id": _VERSION_ID,
        "status": status,
        "inputs": {"state": "phi_plus", "basis": "Z", "shots": 256},
        "result": result,
        "error_code": error_code,
        "created_at": "2026-09-23T00:00:00Z",
    }


class Recording:
    def __init__(self, responses: list[tuple[int, dict | list]]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str, dict, dict | list | None]] = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, dict(headers), json.loads(body) if body else None))
        status, payload = self.responses.pop(0)
        return status, json.dumps(payload).encode()


def _client(responses, *, token=_TOKEN):
    transport = Recording(responses)
    return Client(api_url="https://api.test", token=token, transport=transport), transport


def test_start_qapp_execution_posts_inputs_to_the_same_route_the_page_calls():
    client, transport = _client([(202, _execution_json(status="queued"))])
    execution = client.start_qapp_execution(
        "bell-pair-abc123", {"state": "phi_plus", "basis": "Z", "shots": 256}
    )
    assert execution.status == "queued"
    assert str(execution.id) == _EXECUTION_ID
    method, url, headers, body = transport.calls[0]
    assert method == "POST"
    assert url == "https://api.test/v1/qapps/bell-pair-abc123/executions"
    assert headers["Authorization"] == f"Bearer {_TOKEN}"
    assert body == {"inputs": {"state": "phi_plus", "basis": "Z", "shots": 256}}


def test_start_qapp_execution_defaults_to_empty_inputs():
    client, transport = _client([(202, _execution_json())])
    client.start_qapp_execution("bell-pair-abc123")
    assert transport.calls[0][3] == {"inputs": {}}


def test_get_qapp_execution_reads_it_back():
    client, transport = _client([(200, _execution_json(status="running"))])
    execution = client.get_qapp_execution(_EXECUTION_ID)
    assert execution.status == "running"
    assert transport.calls[0][1] == f"https://api.test/v1/qapps/executions/{_EXECUTION_ID}"


def test_wait_for_qapp_execution_polls_until_terminal_and_returns_that_state():
    client, transport = _client(
        [
            (200, _execution_json(status="queued")),
            (200, _execution_json(status="running")),
            (200, _execution_json(status="succeeded", result={"correlation": 1.0})),
        ]
    )
    ticks: list[float] = []
    execution = client.wait_for_qapp_execution(
        _EXECUTION_ID, wait_s=60, poll_s=0.0, sleep=ticks.append
    )
    assert execution.status == "succeeded"
    assert execution.result == {"correlation": 1.0}
    assert len(transport.calls) == 3
    assert ticks == [0.0, 0.0]  # slept between polls 1->2 and 2->3, not after the terminal read


def test_wait_for_qapp_execution_returns_a_failed_execution_rather_than_raising():
    client, _ = _client([(200, _execution_json(status="failed", error_code="sandbox_timeout"))])
    execution = client.wait_for_qapp_execution(_EXECUTION_ID, wait_s=60, poll_s=0.0)
    assert execution.status == "failed"
    assert execution.error_code == "sandbox_timeout"


def test_wait_for_qapp_execution_times_out_with_a_clear_message_and_no_endless_wait(monkeypatch):
    import leona_client.client as client_module

    client, _ = _client([(200, _execution_json(status="running"))] * 50)
    clock = iter([1000.0] + [1000.0 + 10_000.0] * 50)
    monkeypatch.setattr(client_module.time, "monotonic", lambda: next(clock))
    with pytest.raises(LeonaClientError, match="did not reach a terminal state"):
        client.wait_for_qapp_execution(_EXECUTION_ID, wait_s=1, poll_s=0.0, sleep=lambda _s: None)


def test_run_qapp_starts_then_waits_and_returns_the_terminal_execution():
    client, transport = _client(
        [
            (202, _execution_json(status="queued")),
            (200, _execution_json(status="succeeded", result={"correlation": 1.0})),
        ]
    )
    execution = client.run_qapp(
        "bell-pair-abc123",
        {"state": "phi_plus", "basis": "Z", "shots": 256},
        wait_s=60,
        poll_s=0.0,
    )
    assert execution.status == "succeeded"
    assert execution.result == {"correlation": 1.0}
    assert transport.calls[0][0] == "POST"
    assert transport.calls[1][0] == "GET"


def test_run_qapp_refuses_with_no_token_before_any_http_call():
    client = Client(api_url="https://api.test", token=None, transport=Recording([]))
    for call in (
        lambda: client.run_qapp("bell-pair-abc123", {}),
        lambda: client.start_qapp_execution("bell-pair-abc123"),
        lambda: client.get_qapp_execution(_EXECUTION_ID),
    ):
        with pytest.raises(LeonaClientError, match="LEONA_API_TOKEN"):
            call()


def test_a_read_only_token_is_refused_with_the_apis_own_reason():
    # The real wire shape (checked live in
    # test_qapp_run_api_token_access_live.py): RFC 7807 Problem+JSON, the message
    # `token_access.check` wrote under "title", "reason" at the top level.
    client, _ = _client(
        [
            (
                403,
                {
                    "type": "about:blank",
                    "title": "this token can read but not start runs; mint one with the run scope",
                    "status": 403,
                    "code": "http_error",
                    "reason": "token_scope_insufficient",
                },
            )
        ]
    )
    with pytest.raises(LeonaClientError, match="run scope"):
        client.start_qapp_execution("bell-pair-abc123")


def test_an_unpublished_or_missing_qapp_surfaces_as_not_found_not_a_crash():
    client, _ = _client([(404, {"type": "about:blank", "title": "qapp not found", "status": 404})])
    with pytest.raises(LeonaClientError, match="qapp not found"):
        client.start_qapp_execution("private-or-missing-slug")


def test_the_token_value_never_appears_in_any_raised_message():
    client, _ = _client([(401, {"type": "about:blank", "title": "invalid token", "status": 401})])
    with pytest.raises(LeonaClientError) as excinfo:
        client.get_qapp_execution(_EXECUTION_ID)
    assert _TOKEN not in str(excinfo.value)
