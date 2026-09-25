"""The `check_circuit` tool over the MCP protocol, against a fake API.

The fake returns verdicts shaped exactly as `POST /v1/checks/circuit` returns them; what
the route and the engine actually decide is `services/api/tests/test_check_circuit_route.py`,
which also walks this tool end to end through the real app.
"""

from __future__ import annotations

import json

from mcp.shared.memory import create_connected_server_and_client_session

from leona_mcp.server import CHECK_CIRCUIT_DESCRIPTION, INSTRUCTIONS, build_server

_TOKEN = "lq_pat_do_not_leak_this_test_token_00000"  # noqa: S105 - a fixture value
_BELL = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nh q[0];\ncx q[0], q[1];\n'
_AGAINST = "the Bell state (|00⟩ + |11⟩)/√2, up to global phase"


def _verdict(status="pass", *, teeth=None, detail="", measure="fidelity 1.0000000"):
    return {
        "verdict": {
            "status": status,
            "basis": "circuit",
            "checked_against": _AGAINST,
            "measure": measure,
            "detail": detail,
            "qubits": 2,
            "subject_fingerprint": None,
            "subject_qasm": None,
            "teeth": teeth,
        }
    }


def _teeth(mutants, caught, *, equivalent=0, survivors=(), reason=""):
    return {
        "status": "measured",
        "reason": reason,
        "mutants": mutants,
        "equivalent": equivalent,
        "caught": caught,
        "survivors": list(survivors),
    }


class _Recording:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, dict(headers), json.loads(body) if body else None))
        status, payload = self.responses.pop(0)
        return status, json.dumps(payload).encode()


def _patch(monkeypatch, responses):
    import leona_mcp.server as server_module

    transport = _Recording(responses)
    fake = server_module.Client(api_url="https://api.example", token=_TOKEN, transport=transport)
    monkeypatch.setattr(server_module.Client, "from_env", classmethod(lambda cls: fake))
    return transport


async def _call(arguments):
    async with create_connected_server_and_client_session(build_server()) as session:
        return await session.call_tool("check_circuit", arguments)


async def test_a_pass_with_every_broken_copy_caught(monkeypatch):
    transport = _patch(monkeypatch, [(200, _verdict(teeth=_teeth(3, 3, equivalent=1)))])
    result = await _call({"qasm": _BELL, "kind": "state", "reference": "bell"})

    assert result.isError is False
    body = json.loads(result.content[0].text)
    assert body["status"] == "pass"
    assert body["passed"] is True
    assert "teeth_note" not in body
    assert body["summary"].startswith(f"Checked against {_AGAINST}: pass")
    assert "the check caught all 3" in body["summary"]
    assert "1 more broken copy behaved exactly like the original" in body["summary"]
    assert "verified" not in body["summary"].lower()
    # What went over the wire: the kind, the one expectation given, the conventional
    # subject; nothing the caller left unset.
    method, url, headers, sent = transport.calls[0]
    assert (method, url) == ("POST", "https://api.example/v1/checks/circuit")
    assert headers["Authorization"] == f"Bearer {_TOKEN}"
    assert sent == {
        "qasm": _BELL,
        "property": {
            "kind": "state",
            "subject": "circuit",
            "reference": "bell",
            "tolerance": 1e-6,
            "statement": "",
        },
    }


async def test_a_pass_that_missed_some_broken_copies_names_them(monkeypatch):
    teeth = _teeth(12, 11, survivors=["negating the rz angle on q1, gate 4"])
    _patch(monkeypatch, [(200, _verdict(teeth=teeth))])
    body = json.loads(
        (await _call({"qasm": _BELL, "kind": "state", "reference": "bell"})).content[0].text
    )
    assert "caught 11 of 12 changes that alter the output" in body["summary"]
    assert "negating the rz angle on q1, gate 4" in body["summary"]


async def test_broken_copies_the_simulator_could_not_run_are_said_not_dropped(monkeypatch):
    teeth = {**_teeth(5, 5), "could_not_run": 2}
    _patch(monkeypatch, [(200, _verdict(teeth=teeth))])
    body = json.loads(
        (await _call({"qasm": _BELL, "kind": "state", "reference": "bell"})).content[0].text
    )
    assert "the check caught all 5" in body["summary"]
    assert "2 more broken copies could not be simulated and are not counted" in body["summary"]


async def test_a_pass_that_caught_nothing_says_the_check_cannot_fail(monkeypatch):
    _patch(monkeypatch, [(200, _verdict(teeth=_teeth(4, 0)))])
    body = json.loads(
        (await _call({"qasm": _BELL, "kind": "state", "reference": "bell"})).content[0].text
    )
    assert body["passed"] is True
    assert "could not tell a broken circuit from this one" in body["summary"]


async def test_a_fail_carries_its_diagnosis_and_says_the_teeth_were_not_measured(monkeypatch):
    not_measured = {
        "status": "not_measured",
        "reason": "Broken copies are tried only on a check that passes. This one failed.",
        "mutants": 0,
        "equivalent": 0,
        "caught": 0,
        "survivors": [],
    }
    detail = "It matches with the qubit order reversed."
    _patch(monkeypatch, [(200, _verdict("fail", teeth=not_measured, detail=detail))])
    body = json.loads(
        (await _call({"qasm": _BELL, "kind": "state", "amplitudes": {"01": 1}})).content[0].text
    )
    assert body["passed"] is False
    assert detail in body["summary"]
    assert body["teeth_note"].startswith("Whether this check can catch a broken circuit was not")


async def test_an_inconclusive_is_never_a_pass(monkeypatch):
    teeth = {
        "status": "not_measured",
        "reason": "Too large.",
        "mutants": 0,
        "equivalent": 0,
        "caught": 0,
        "survivors": [],
    }
    _patch(
        monkeypatch, [(200, _verdict("inconclusive", teeth=teeth, detail="13 qubits.", measure=""))]
    )
    body = json.loads(
        (await _call({"qasm": _BELL, "kind": "state", "reference": "bell"})).content[0].text
    )
    assert body["passed"] is False
    assert body["summary"].startswith("Leona could not judge this circuit, so this is neither")
    assert "teeth_note" in body


async def test_a_malformed_property_is_an_error_result_and_nothing_is_sent(monkeypatch):
    transport = _patch(monkeypatch, [])
    result = await _call(
        {"qasm": _BELL, "kind": "state", "reference": "bell", "amplitudes": {"00": 1}}
    )
    assert result.isError is True
    assert "exactly one of" in result.content[0].text
    assert transport.calls == []


async def test_the_apis_400_reaches_the_model_as_an_error_it_can_read(monkeypatch):
    problem = {
        "type": "about:blank",
        "title": "a value check needs a value, not a circuit; check it in a notebook",
        "status": 400,
        "code": "http_error",
        "reason": "value_check_needs_a_notebook",
    }
    _patch(monkeypatch, [(400, problem)])
    result = await _call(
        {"qasm": "OPENQASM 3.0; qubit q; h q", "kind": "state", "reference": "bell"}
    )
    assert result.isError is True
    assert "400" in result.content[0].text


def test_the_description_teaches_the_conventions_a_caller_needs():
    text = CHECK_CIRCUIT_DESCRIPTION
    for phrase in (
        "LEONA_API_TOKEN",
        "run scope",
        "q0 is the RIGHTMOST character",
        "'bell:psi-'",
        "'ghz(n)'",
        "'w(n)'",
        "'uniform(n)'",
        "'qft(n)'",
        "'iqft(n)'",
        "state 1e-6",
        "energy 1e-3",
        "never 'verified'",
        "up to 12 qubits (8 for a unitary",
    ):
        assert phrase in text, phrase
    assert "check_circuit" in INSTRUCTIONS
