"""`Client`'s control-plane calls: runs, estimates, and the token guard.

Offline, with a recording fake transport — the same `(method, url, headers, body)
-> (status, bytes)` shape `leona_notebooks`'s tests already used before this
package existed, so nothing about how `Client` is tested changed in the move.
"""

from __future__ import annotations

import json

import pytest

from leona_client.client import Client, LeonaClientError

_TOKEN = "lq_pat_test_token_never_leaves_this_file"  # noqa: S105 - a fixture value
_RUN_ID = "11111111-1111-1111-1111-111111111111"


def _run_json(*, status="succeeded", verifier_decision=None, verification_summary=None):
    return {
        "id": _RUN_ID,
        "conversation_id": "22222222-2222-2222-2222-222222222222",
        "workspace_id": "33333333-3333-3333-3333-333333333333",
        "user_id": "44444444-4444-4444-4444-444444444444",
        "task_prompt": "Build a GHZ state",
        "mode": "execute",
        "status": status,
        "framework": "qiskit",
        "created_at": "2026-09-23T00:00:00Z",
        "verifier_decision": verifier_decision,
        "verification_summary": verification_summary,
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


def test_start_run_posts_the_prompt_and_returns_a_typed_run():
    client, transport = _client([(201, _run_json(status="queued"))])
    run = client.start_run("Build a Bell pair", seed=7, shots=None, framework="cirq")
    assert run.status == "queued"
    method, url, headers, body = transport.calls[0]
    assert method == "POST"
    assert url == "https://api.test/v1/runs"
    assert headers["Authorization"] == f"Bearer {_TOKEN}"
    # shots=None is dropped; seed and framework are not.
    assert body == {"task_prompt": "Build a Bell pair", "seed": 7, "framework": "cirq"}


def test_get_run_and_cancel_run():
    client, transport = _client(
        [(200, _run_json(status="running")), (200, _run_json(status="cancelled"))]
    )
    run = client.get_run(_RUN_ID)
    assert run.status == "running"
    cancelled = client.cancel_run(_RUN_ID)
    assert cancelled.status == "cancelled"
    assert transport.calls[0][1].endswith(f"/runs/{_RUN_ID}")
    assert transport.calls[1] == (
        "POST",
        f"https://api.test/v1/runs/{_RUN_ID}/cancel",
        transport.calls[1][2],
        None,
    )


def test_list_runs_builds_the_query_and_returns_typed_rows():
    client, transport = _client([(200, [_run_json(status="succeeded"), _run_json(status="failed")])])
    runs = client.list_runs(status="failed", limit=10)
    assert [run.status for run in runs] == ["succeeded", "failed"]
    assert transport.calls[0][1] == "https://api.test/v1/runs?limit=10&status=failed"


def test_wait_for_run_polls_until_terminal_and_returns_that_state():
    client, transport = _client(
        [
            (200, _run_json(status="queued")),
            (200, _run_json(status="running")),
            (200, _run_json(status="succeeded", verifier_decision="pass")),
        ]
    )
    ticks: list[float] = []
    run = client.wait_for_run(_RUN_ID, wait_s=60, poll_s=0.0, sleep=ticks.append)
    assert run.status == "succeeded"
    assert run.verifier_decision == "pass"
    assert len(transport.calls) == 3
    assert ticks == [0.0, 0.0]  # slept between polls 1->2 and 2->3, not after the terminal read


def test_wait_for_run_returns_a_failed_run_rather_than_raising():
    client, _ = _client([(200, _run_json(status="failed"))])
    run = client.wait_for_run(_RUN_ID, wait_s=60, poll_s=0.0)
    assert run.status == "failed"


def test_wait_for_run_times_out_with_a_clear_message_and_no_endless_wait(monkeypatch):
    import leona_client.client as client_module

    client, _ = _client([(200, _run_json(status="running"))] * 50)
    clock = iter([1000.0] + [1000.0 + 10_000.0] * 50)
    monkeypatch.setattr(client_module.time, "monotonic", lambda: next(clock))
    with pytest.raises(LeonaClientError, match="did not reach a terminal state"):
        client.wait_for_run(_RUN_ID, wait_s=1, poll_s=0.0, sleep=lambda _s: None)


def test_estimate_resources_sends_points_and_assumptions():
    response = {"assumptions": {}, "points": [], "citations": {}}
    client, transport = _client([(200, response)])
    result = client.estimate_resources(
        [{"label": "x", "logical_qubits": 4, "toffoli_count": 100}], assumptions="gidney-2025@v2"
    )
    assert result == response
    assert transport.calls[0][3] == {
        "points": [{"label": "x", "logical_qubits": 4, "toffoli_count": 100}],
        "assumptions": "gidney-2025@v2",
    }


def test_every_authenticated_method_refuses_with_no_token_before_any_http_call():
    client = Client(api_url="https://api.test", token=None, transport=Recording([]))
    for call in (
        lambda: client.get_run(_RUN_ID),
        lambda: client.start_run("x"),
        lambda: client.list_runs(),
        lambda: client.cancel_run(_RUN_ID),
        lambda: client.estimate_resources([{"label": "x", "logical_qubits": 1}]),
        lambda: client.notebook("nb1"),
    ):
        with pytest.raises(LeonaClientError, match="LEONA_API_TOKEN"):
            call()


def test_a_refused_token_surfaces_the_apis_own_reason_not_a_raw_exception():
    # The real wire shape (checked live against `create_app()`): the API's error
    # middleware answers RFC 7807 Problem+JSON — the message `token_access.check`
    # wrote is under "title", "reason" sits at the top level, and there is no
    # "detail" key at all.
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
        client.start_run("x")


def test_the_token_value_never_appears_in_any_raised_message():
    client, _ = _client([(401, {"type": "about:blank", "title": "invalid token", "status": 401})])
    with pytest.raises(LeonaClientError) as excinfo:
        client.get_run(_RUN_ID)
    assert _TOKEN not in str(excinfo.value)
    # And the no-token guard's own message, which names the header it needs but
    # never a value, real or otherwise.
    no_token = Client(api_url="https://api.test", token=None, transport=Recording([]))
    try:
        no_token.get_run(_RUN_ID)
    except LeonaClientError as exc:
        assert _TOKEN not in str(exc)


def test_from_env_reads_both_variables_and_needs_no_token_for_construction(monkeypatch):
    monkeypatch.setenv("LEONA_API_URL", "https://custom.example")
    monkeypatch.setenv("LEONA_API_TOKEN", _TOKEN)
    client = Client.from_env()
    assert client.api_url == "https://custom.example"
    assert client.token == _TOKEN

    monkeypatch.delenv("LEONA_API_TOKEN", raising=False)
    anonymous = Client.from_env()
    assert anonymous.token is None
