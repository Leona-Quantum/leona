"""`leona_notebooks.leona`: the `Leona` script API and the LOCAL half of
`leona_submit` (Bridge lane, ai-ops 362, 2026-09-23).

`leona_submit` never submits anything — these tests are all about what it prints
and returns, never about a job reaching a sandbox or a provider.
"""

from __future__ import annotations

import json
import sys

import pytest
from qiskit import QuantumCircuit

from leona_client.client import LeonaClientError
from leona_notebooks.jupyter import set_linked_notebook
from leona_notebooks.leona import (
    DEFAULT_ESTIMATE_DEVICE_ID,
    HardwareSubmission,
    Leona,
    leona_submit,
)


@pytest.fixture(autouse=True)
def _reset_link():
    set_linked_notebook(None)
    yield
    set_linked_notebook(None)


class Recording:
    def __init__(self, responses: list[tuple[int, dict]]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, str, dict | None]] = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url, json.loads(body) if body else None))
        status, payload = self.responses.pop(0)
        return status, json.dumps(payload).encode()


def _leona(responses):
    transport = Recording(responses)
    return Leona(api_url="https://api.test", token="tok", transport=transport), transport


# ---------------------------------------------------------------------------- Leona


def test_devices_unwraps_the_backend_list():
    lq, _ = _leona([(200, {"backends": [{"device_id": "ibm.open_plan"}]})])
    assert lq.devices() == [{"device_id": "ibm.open_plan"}]


def test_estimate_adds_num_qubits_from_the_circuit_without_changing_the_price():
    lq, transport = _leona([(200, {"device_id": "ibm.open_plan", "shots": 10, "basis": "x"})])
    qc = QuantumCircuit(3, 3)
    qc.h(0)
    result = lq.estimate(qc, shots=10)
    assert result["num_qubits"] == 3
    assert result["basis"] == "x"
    assert transport.calls[0][2] == {
        "device_id": DEFAULT_ESTIMATE_DEVICE_ID,
        "shots": 10,
        "zne": False,
    }


def test_estimate_uses_the_given_device_over_the_default():
    lq, transport = _leona([(200, {"device_id": "ibm.kyiv", "shots": 10})])
    lq.estimate("OPENQASM 3;\nqubit[1] q;\n", device="ibm.kyiv", shots=10)
    assert transport.calls[0][2]["device_id"] == "ibm.kyiv"


def test_ask_uses_the_given_notebook_over_the_link():
    set_linked_notebook("linked-nb")
    lq, transport = _leona(
        [
            (200, {"turn": {"seq": 1}, "run_id": "r"}),
            (200, {"items": [{"role": "nala", "seq": 2, "content": "answer"}]}),
        ]
    )
    reply = lq.ask("why?", "explicit-nb")
    assert reply == "answer"
    assert transport.calls[0][1] == "https://api.test/v1/notebooks/explicit-nb/turns"


def test_ask_falls_back_to_the_link_when_no_notebook_given():
    set_linked_notebook("linked-nb")
    lq, transport = _leona(
        [
            (200, {"turn": {"seq": 1}, "run_id": "r"}),
            (200, {"items": [{"role": "nala", "seq": 2, "content": "answer"}]}),
        ]
    )
    lq.ask("why?")
    assert transport.calls[0][1] == "https://api.test/v1/notebooks/linked-nb/turns"


def test_ask_with_no_notebook_and_no_link_is_a_clear_error():
    lq, _ = _leona([])
    with pytest.raises(LeonaClientError, match="no notebook given and none linked"):
        lq.ask("why?")


def test_run_starts_and_waits_for_the_run():
    lq, transport = _leona(
        [
            (
                201,
                {
                    "id": "55555555-5555-5555-5555-555555555555",
                    "conversation_id": "22222222-2222-2222-2222-222222222222",
                    "workspace_id": "33333333-3333-3333-3333-333333333333",
                    "user_id": "44444444-4444-4444-4444-444444444444",
                    "task_prompt": "Build a Bell pair",
                    "mode": "execute",
                    "status": "queued",
                    "framework": "qiskit",
                    "created_at": "2026-09-23T00:00:00Z",
                },
            ),
            (
                200,
                {
                    "id": "55555555-5555-5555-5555-555555555555",
                    "conversation_id": "22222222-2222-2222-2222-222222222222",
                    "workspace_id": "33333333-3333-3333-3333-333333333333",
                    "user_id": "44444444-4444-4444-4444-444444444444",
                    "task_prompt": "Build a Bell pair",
                    "mode": "execute",
                    "status": "succeeded",
                    "framework": "qiskit",
                    "created_at": "2026-09-23T00:00:00Z",
                },
            ),
        ]
    )
    run = lq.run("Build a Bell pair")
    assert run.status == "succeeded"
    assert transport.calls[0][2] == {"task_prompt": "Build a Bell pair", "framework": "qiskit"}


# ------------------------------------------------------------------------ leona_submit


def test_leona_submit_with_a_circuit_returns_qasm_and_num_qubits(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("LEONA_API_TOKEN", raising=False)
    qc = QuantumCircuit(2, 2)
    qc.h(0)
    qc.cx(0, 1)
    qc.measure([0, 1], [0, 1])
    result = leona_submit(qc, shots=256, label="bell")
    assert isinstance(result, HardwareSubmission)
    assert result.num_qubits == 2
    assert result.shots == 256
    assert result.label == "bell"
    assert "OPENQASM 3" in result.qasm
    out = capsys.readouterr().out
    assert "Set LEONA_API_TOKEN" in out
    assert "This ran locally only" in out
    # The sandbox's own leona_submit says "2 qubits, 256 shots"; the local one matches it.
    assert out.startswith("2 qubits, 256 shots. ")
    assert "qubit(s)" not in out


def test_leona_submit_with_a_qasm_string_does_not_need_qiskit_for_parsing_the_input_type(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("LEONA_API_TOKEN", raising=False)
    qasm = 'OPENQASM 3;\ninclude "stdgates.inc";\nqubit[1] q;\nh q[0];\n'
    result = leona_submit(qasm, shots=10)
    assert result.num_qubits == 1
    assert result.qasm == qasm
    assert capsys.readouterr().out.startswith("1 qubit, 10 shots. ")


def test_leona_submit_refuses_openqasm_2_with_a_clear_message() -> None:
    with pytest.raises(LeonaClientError, match="OpenQASM 2 is not accepted"):
        leona_submit("OPENQASM 2.0;\nqreg q[1];\n", shots=10)


def test_leona_submit_degrades_when_qiskit_is_absent(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """`qiskit` is a hard dependency of this package, so this simulates its absence
    rather than uninstalling it — the point under test is that `leona_submit`
    prints and returns `None` rather than raising when the import itself fails,
    which is the branch a real "qiskit not installed" environment would hit."""
    monkeypatch.setitem(sys.modules, "qiskit", None)
    qc_like = object()  # never reached — the ImportError fires before any attribute access
    result = leona_submit(qc_like, shots=10)
    assert result is None
    assert "qiskit is not installed" in capsys.readouterr().out


def test_leona_submit_rejects_bad_shots() -> None:
    with pytest.raises(ValueError, match="shots must be a positive int"):
        leona_submit("OPENQASM 3;\nqubit[1] q;\n", shots=0)
    with pytest.raises(ValueError, match="shots must be a positive int"):
        leona_submit("OPENQASM 3;\nqubit[1] q;\n", shots=True)  # bool is not an int here


def test_leona_submit_rejects_a_non_string_label() -> None:
    with pytest.raises(TypeError, match="label must be a str or None"):
        leona_submit("OPENQASM 3;\nqubit[1] q;\n", shots=10, label=123)


def test_leona_submit_prints_the_linked_notebooks_url_when_one_is_linked(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("LEONA_API_TOKEN", raising=False)
    set_linked_notebook("nb42")
    leona_submit("OPENQASM 3;\nqubit[1] q;\n", shots=10)
    out = capsys.readouterr().out
    assert "https://leonaqt.com/notebooks/nb42" in out


def test_leona_submit_fetches_a_price_estimate_when_a_token_is_set(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("LEONA_API_TOKEN", "tok")
    monkeypatch.setenv("LEONA_API_URL", "https://api.test")
    responses = [
        (200, {"device_id": DEFAULT_ESTIMATE_DEVICE_ID, "shots": 10, "basis": "free_queue"})
    ]
    transport = Recording(responses)
    monkeypatch.setattr(
        "leona_notebooks.leona.Leona.from_env",
        classmethod(
            lambda cls, transport=transport: Leona(
                api_url="https://api.test", token="tok", transport=transport
            )
        ),
    )
    leona_submit("OPENQASM 3;\nqubit[1] q;\n", shots=10)
    out = capsys.readouterr().out
    assert "free_queue" in out
    assert "nothing was submitted" in out
    assert transport.calls[0][2] == {
        "device_id": DEFAULT_ESTIMATE_DEVICE_ID,
        "shots": 10,
        "zne": False,
    }


def test_leona_submit_never_raises_when_the_estimate_call_itself_fails(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("LEONA_API_TOKEN", "tok")

    class _Boom(Leona):
        def estimate(self, *args, **kwargs):  # noqa: D401 - test double
            raise LeonaClientError("network is down")

    monkeypatch.setattr(
        "leona_notebooks.leona.Leona.from_env",
        classmethod(lambda cls: _Boom(api_url="x", token="tok")),
    )
    result = leona_submit("OPENQASM 3;\nqubit[1] q;\n", shots=10)
    assert isinstance(result, HardwareSubmission)
    assert "could not fetch a price estimate" in capsys.readouterr().out
