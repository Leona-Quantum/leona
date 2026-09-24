"""`leona_notebooks.leona`: the `Leona` script API and the LOCAL half of
`leona_submit` (Bridge lane, ai-ops 362, 2026-09-23; the `hardware` token scope
that lets it submit for real is ai-ops 376, 2026-09-24).

Every HTTP call in this file goes through the `Recording` fake transport below —
never a live server, and never real hardware. A `hardware`-scoped token DOES make
`leona_submit` call `POST /qpu/submissions` for real in production; the tests
that exercise that path (`test_leona_submit_with_hardware_scope_...` and
`test_hardware_run_...`) prove the plumbing against a stubbed response, the same
way `test_leona_submit_fetches_a_price_estimate_when_a_token_is_set` always has
for the pricing call.
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
    HardwareRun,
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

#: One qubit, measured: the smallest program the sandbox's `leona_submit` accepts, so the
#: tests below reach the part they are about rather than the "measures nothing" refusal.
_MEASURED_QASM = "OPENQASM 3;\nqubit[1] q;\nbit[1] c;\nc[0] = measure q[0];\n"


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
    qasm = 'OPENQASM 3;\ninclude "stdgates.inc";\nqubit[1] q;\nbit[1] c;\nh q[0];\nc[0] = measure q[0];\n'
    result = leona_submit(qasm, shots=10)
    assert result.num_qubits == 1
    assert result.qasm == qasm
    assert capsys.readouterr().out.startswith("1 qubit, 10 shots. ")


def test_leona_submit_refuses_openqasm_2_with_a_clear_message() -> None:
    with pytest.raises(ValueError, match="This is OpenQASM 2"):
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
    with pytest.raises(ValueError, match="shots must be between 1 and"):
        leona_submit("OPENQASM 3;\nqubit[1] q;\n", shots=0)
    with pytest.raises(TypeError, match="shots must be a whole number"):
        leona_submit("OPENQASM 3;\nqubit[1] q;\n", shots=True)  # bool is not an int here


def test_leona_submit_rejects_a_non_string_label() -> None:
    with pytest.raises(TypeError, match="label must be text"):
        leona_submit("OPENQASM 3;\nqubit[1] q;\n", shots=10, label=123)


def test_leona_submit_prints_the_linked_notebooks_url_when_one_is_linked(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("LEONA_API_TOKEN", raising=False)
    set_linked_notebook("nb42")
    leona_submit(_MEASURED_QASM, shots=10)
    out = capsys.readouterr().out
    assert "https://leonaqt.com/notebooks/nb42" in out


def test_leona_submit_fetches_a_price_estimate_when_a_token_is_set(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A token with no `hardware` scope: priced, then the submission attempt is
    refused `token_scope_insufficient` and the function falls back to exactly
    today's local-only behaviour — no "could not submit" noise printed, since
    that refusal is the expected, silent case (see the dedicated hardware-scope
    tests below for the case where it DOES carry the scope)."""
    monkeypatch.setenv("LEONA_API_TOKEN", "tok")
    monkeypatch.setenv("LEONA_API_URL", "https://api.test")
    responses = [
        (200, {"device_id": DEFAULT_ESTIMATE_DEVICE_ID, "shots": 10, "basis": "free_queue"}),
        (403, {"title": "no hardware scope", "reason": "token_scope_insufficient"}),
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
    result = leona_submit(_MEASURED_QASM, shots=10)
    assert isinstance(result, HardwareSubmission)
    out = capsys.readouterr().out
    assert "free_queue" in out
    assert "nothing was submitted" in out
    assert "This ran locally only" in out
    assert "could not submit" not in out
    assert transport.calls[0][2] == {
        "device_id": DEFAULT_ESTIMATE_DEVICE_ID,
        "shots": 10,
        "zne": False,
    }
    submit_call = transport.calls[1]
    assert submit_call[0] == "POST"
    assert submit_call[1] == "https://api.test/v1/qpu/submissions"
    assert submit_call[2]["device_id"] == DEFAULT_ESTIMATE_DEVICE_ID
    assert submit_call[2]["shots"] == 10
    assert submit_call[2]["source_fingerprint"].startswith("local:none:")


def test_leona_submit_never_raises_when_the_estimate_call_itself_fails(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """The estimate call fails; the submission attempt that follows it still
    happens (the two are independent) and is refused `token_scope_insufficient`
    over a STUBBED transport — never the real `_urllib_transport` default, which
    would otherwise fire a real network call from this test."""
    monkeypatch.setenv("LEONA_API_TOKEN", "tok")
    transport = Recording(
        [(403, {"title": "no hardware scope", "reason": "token_scope_insufficient"})]
    )

    class _Boom(Leona):
        def estimate(self, *args, **kwargs):  # noqa: D401 - test double
            raise LeonaClientError("network is down")

    monkeypatch.setattr(
        "leona_notebooks.leona.Leona.from_env",
        classmethod(
            lambda cls, transport=transport: _Boom(api_url="x", token="tok", transport=transport)
        ),
    )
    result = leona_submit(_MEASURED_QASM, shots=10)
    assert isinstance(result, HardwareSubmission)
    out = capsys.readouterr().out
    assert "could not fetch a price estimate" in out
    assert "could not submit" not in out


# --------------------------------------------------------------- hardware scope


def _leona_submit_with(
    monkeypatch: pytest.MonkeyPatch, responses: list[tuple[int, dict]]
) -> Recording:
    """Point `leona_submit`'s internal `Leona.from_env()` at a `Recording`
    transport carrying `responses`, in call order: the price estimate first,
    then the submission attempt. Returns the transport for call inspection —
    never a real network call, per this package's own testing discipline."""
    monkeypatch.setenv("LEONA_API_TOKEN", "tok")
    monkeypatch.setenv("LEONA_API_URL", "https://api.test")
    transport = Recording(responses)
    monkeypatch.setattr(
        "leona_notebooks.leona.Leona.from_env",
        classmethod(
            lambda cls, transport=transport: Leona(
                api_url="https://api.test", token="tok", transport=transport
            )
        ),
    )
    return transport


def test_leona_submit_with_hardware_scope_submits_and_returns_a_hardware_run(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """The core of ai-ops 376: a token that carries `hardware` gets a real
    submission, not a printed price and a link."""
    transport = _leona_submit_with(
        monkeypatch,
        [
            (200, {"device_id": DEFAULT_ESTIMATE_DEVICE_ID, "shots": 10, "basis": "free_queue"}),
            (201, {"id": "run-abc", "status": "queued", "device_id": DEFAULT_ESTIMATE_DEVICE_ID}),
        ],
    )
    result = leona_submit(_MEASURED_QASM, shots=10)
    assert isinstance(result, HardwareRun)
    assert result.run_id == "run-abc"
    assert result.device_id == DEFAULT_ESTIMATE_DEVICE_ID
    out = capsys.readouterr().out
    assert "Submitted to" in out
    assert "run-abc" in out
    # It did NOT run locally only -- the local-only messages must not appear.
    assert "This ran locally only" not in out

    submit_call = transport.calls[1]
    assert submit_call[0] == "POST"
    assert submit_call[1] == "https://api.test/v1/qpu/submissions"
    body = submit_call[2]
    assert body == {
        "device_id": DEFAULT_ESTIMATE_DEVICE_ID,
        "shots": 10,
        "qasm": _MEASURED_QASM,
        "source_fingerprint": body["source_fingerprint"],
        "zne": False,
    }
    assert body["source_fingerprint"].startswith("local:none:")
    assert len(body["source_fingerprint"]) <= 200


def test_leona_submit_with_hardware_scope_defaults_to_the_free_queue_device(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`device` unset -> `DEFAULT_ESTIMATE_DEVICE_ID`, never a paid device chosen
    implicitly -- the brief's own requirement, checked at the SUBMISSION call
    specifically (the estimate call already defaults the same way, covered by
    `test_estimate_adds_num_qubits_from_the_circuit_without_changing_the_price`)."""
    transport = _leona_submit_with(
        monkeypatch,
        [
            (200, {"device_id": DEFAULT_ESTIMATE_DEVICE_ID, "shots": 10}),
            (
                201,
                {"id": "run-default", "status": "queued", "device_id": DEFAULT_ESTIMATE_DEVICE_ID},
            ),
        ],
    )
    leona_submit(_MEASURED_QASM, shots=10)
    assert transport.calls[1][2]["device_id"] == DEFAULT_ESTIMATE_DEVICE_ID


def test_leona_submit_with_hardware_scope_uses_the_linked_notebook_id_in_the_fingerprint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    set_linked_notebook("nb42")
    transport = _leona_submit_with(
        monkeypatch,
        [
            (200, {"device_id": DEFAULT_ESTIMATE_DEVICE_ID, "shots": 10}),
            (201, {"id": "run-xyz", "status": "queued", "device_id": DEFAULT_ESTIMATE_DEVICE_ID}),
        ],
    )
    leona_submit(_MEASURED_QASM, shots=10)
    assert transport.calls[1][2]["source_fingerprint"].startswith("local:nb42:")


def test_leona_submit_with_hardware_scope_submits_to_an_explicit_paid_device(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A paid device must be named explicitly -- `device=` on `leona_submit`
    reaches the submission call exactly as it already reaches the estimate."""
    transport = _leona_submit_with(
        monkeypatch,
        [
            (200, {"device_id": "ibm.kyiv", "shots": 10}),
            (201, {"id": "run-paid", "status": "queued", "device_id": "ibm.kyiv"}),
        ],
    )
    leona_submit(_MEASURED_QASM, shots=10, device="ibm.kyiv")
    assert transport.calls[0][2]["device_id"] == "ibm.kyiv"
    assert transport.calls[1][2]["device_id"] == "ibm.kyiv"


def test_leona_submit_reports_a_submission_failure_that_is_not_a_scope_refusal(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A token WITH hardware scope can still be refused for another reason -- no
    IBM credential connected, the deployment gate closed, the weekly allowance
    spent. Unlike the silent `token_scope_insufficient` case, this IS reported,
    and the cell still falls back to the local-only record rather than raising."""
    transport = _leona_submit_with(
        monkeypatch,
        [
            (200, {"device_id": DEFAULT_ESTIMATE_DEVICE_ID, "shots": 10}),
            (
                409,
                {
                    "title": "no hardware account connected",
                    "blocked_reason": "credentials_unconfigured",
                },
            ),
        ],
    )
    result = leona_submit(_MEASURED_QASM, shots=10)
    assert isinstance(result, HardwareSubmission)
    out = capsys.readouterr().out
    assert "could not submit to hardware" in out
    assert "This ran locally only" in out
    assert transport.calls[1][0] == "POST"


def test_hardware_run_status_reads_the_qpu_run_route() -> None:
    transport = Recording([(200, {"id": "run1", "status": "running"})])
    lq = Leona(api_url="https://api.test", token="tok", transport=transport)
    run = HardwareRun(run_id="run1", device_id="ibm.open_plan", _client=lq)
    assert run.status() == "running"
    assert transport.calls[0][:2] == ("GET", "https://api.test/v1/qpu/runs/run1")


def test_hardware_run_result_returns_counts_on_a_done_run() -> None:
    transport = Recording(
        [(200, {"id": "run1", "status": "done", "raw_counts": {"0": 500, "1": 500}})]
    )
    lq = Leona(api_url="https://api.test", token="tok", transport=transport)
    run = HardwareRun(run_id="run1", device_id="ibm.open_plan", _client=lq)
    assert run.result(timeout=10) == {"0": 500, "1": 500}


def test_hardware_run_result_raises_on_a_non_done_terminal_status() -> None:
    transport = Recording(
        [(200, {"id": "run1", "status": "error", "error": "provider rejected it"})]
    )
    lq = Leona(api_url="https://api.test", token="tok", transport=transport)
    run = HardwareRun(run_id="run1", device_id="ibm.open_plan", _client=lq)
    with pytest.raises(LeonaClientError, match="provider rejected it"):
        run.result(timeout=10)


@pytest.mark.parametrize(
    "make",
    [
        pytest.param(lambda: _unbound_circuit(), id="unbound parameter"),
        pytest.param(lambda: QuantumCircuit(2), id="measures nothing"),
        pytest.param(lambda: "OPENQASM 3;\nqubit[1] q;\nh q[0];\n", id="qasm measures nothing"),
    ],
)
def test_the_local_leona_submit_refuses_what_the_sandbox_refuses_in_the_same_words(make) -> None:
    """The local shim used to accept circuits Leona's sandbox refuses, so a cell tested
    in a reader's own Jupyter failed the moment it ran on Leona. Both now go through
    `hardware_request`; this holds them to the same exception and message."""
    from leona_notebooks.hardware import hardware_request

    with pytest.raises(Exception) as sandbox:
        hardware_request(make(), 100)
    with pytest.raises(type(sandbox.value)) as local:
        leona_submit(make(), shots=100)
    assert str(local.value) == str(sandbox.value)


def _unbound_circuit() -> QuantumCircuit:
    from qiskit.circuit import Parameter

    qc = QuantumCircuit(1)
    qc.rx(Parameter("theta"), 0)
    qc.measure_all()
    return qc
