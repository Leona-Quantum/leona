"""`Client.check_circuit`: POST /v1/checks/circuit, offline, with a recording transport.

The same `(method, url, headers, body) -> (status, bytes)` fake the run and Qapp tests
use. What the route itself does is `services/api/tests/test_check_circuit_route.py`.
"""

from __future__ import annotations

import json

import pytest
from majorana_contracts import CheckProperty, CheckVerdict

from leona_client.client import Client, LeonaClientError

_TOKEN = "lq_pat_test_token_never_leaves_this_file"  # noqa: S105 - a fixture value
_BELL = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nh q[0];\ncx q[0], q[1];\n'

_PASS = {
    "verdict": {
        "status": "pass",
        "basis": "circuit",
        "checked_against": "the Bell state (|00⟩ + |11⟩)/√2, up to global phase",
        "measure": "fidelity 1.0000000 (needs ≥ 0.9999990)",
        "detail": "",
        "qubits": 2,
        "subject_fingerprint": "0" * 64,
        "subject_qasm": _BELL,
        "teeth": {
            "status": "measured",
            "reason": "",
            "mutants": 3,
            "equivalent": 1,
            "caught": 3,
            "survivors": [],
        },
    }
}


class Recording:
    def __init__(self, responses: list[tuple[int, dict]]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str, dict, dict | None]] = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, dict(headers), json.loads(body) if body else None))
        status, payload = self.responses.pop(0)
        return status, json.dumps(payload).encode()


def _client(responses, *, token=_TOKEN):
    transport = Recording(responses)
    return Client(api_url="https://api.test", token=token, transport=transport), transport


def test_check_circuit_posts_the_circuit_and_property_and_returns_a_typed_verdict():
    client, transport = _client([(200, _PASS)])
    verdict = client.check_circuit(_BELL, {"kind": "state", "reference": "bell"})

    assert isinstance(verdict, CheckVerdict)
    assert verdict.status == "pass"
    assert verdict.teeth is not None and verdict.teeth.caught == 3
    method, url, headers, body = transport.calls[0]
    assert (method, url) == ("POST", "https://api.test/v1/checks/circuit")
    assert headers["Authorization"] == f"Bearer {_TOKEN}"
    assert body["qasm"] == _BELL
    # `subject` filled with the convention, the kind's default tolerance stated, and the
    # authorship fields — which the verdict never depends on — not sent at all.
    assert body["property"] == {
        "kind": "state",
        "subject": "circuit",
        "reference": "bell",
        "tolerance": 1e-6,
        "statement": "",
    }


def test_check_circuit_takes_a_checkproperty_too():
    client, transport = _client([(200, _PASS)])
    prop = CheckProperty(kind="unitary", subject="qft", reference="qft(3)", tolerance=1e-9)
    client.check_circuit(_BELL, prop)
    sent = transport.calls[0][3]["property"]
    assert sent["kind"] == "unitary"
    assert sent["subject"] == "qft"  # a caller's own subject is passed through untouched
    assert sent["tolerance"] == 1e-9


def test_a_malformed_property_is_refused_here_with_the_contracts_words_and_nothing_is_sent():
    client, transport = _client([])
    with pytest.raises(LeonaClientError, match="exactly one of"):
        client.check_circuit(_BELL, {"kind": "state", "reference": "bell", "amplitudes": {"00": 1}})
    assert transport.calls == []


def test_a_circuit_that_does_not_parse_surfaces_the_apis_400():
    problem = {
        "type": "about:blank",
        "title": "The circuit's OpenQASM 3 does not parse: L1:C31: unexpected end of input",
        "status": 400,
        "code": "http_error",
        "reason": "qasm_unreadable",
    }
    client, _ = _client([(400, problem)])
    with pytest.raises(LeonaClientError, match="does not parse") as raised:
        client.check_circuit(
            "OPENQASM 3.0; qubit[2] q; h q[0", {"kind": "state", "reference": "bell"}
        )
    assert raised.value.reason == "qasm_unreadable"


def test_a_read_only_token_is_told_it_needs_the_run_scope():
    problem = {
        "type": "about:blank",
        "title": "this token can read but not start runs; mint one with the run scope",
        "status": 403,
        "code": "http_error",
        "reason": "token_scope_insufficient",
    }
    client, _ = _client([(403, problem)])
    with pytest.raises(LeonaClientError, match="run scope") as raised:
        client.check_circuit(_BELL, {"kind": "state", "reference": "bell"})
    assert raised.value.reason == "token_scope_insufficient"


def test_check_circuit_needs_a_token_before_anything_is_sent():
    client, transport = _client([], token=None)
    with pytest.raises(LeonaClientError, match="LEONA_API_TOKEN"):
        client.check_circuit(_BELL, {"kind": "state", "reference": "bell"})
    assert transport.calls == []
