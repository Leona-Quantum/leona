import uuid
from types import SimpleNamespace

import pytest
from majorana_contracts.enums import RunStatus
from majorana_sandbox import SandboxResult
from majorana_worker import handlers, synthesis_handlers


def test_circuit_synthesis_job_is_registered_with_run_dead_letter_recovery():
    assert handlers.HANDLERS["circuit.synthesize"] is handlers.handle_circuit_synthesize
    assert handlers.DEAD_LETTER_HANDLERS["circuit.synthesize"] is handlers.handle_run_dead_letter


# --- resolve_connectivity: device -> connectivity resolution ------------------


def test_resolve_connectivity_uses_the_generic_target_verbatim():
    from majorana_contracts.enums import SynthesisConnectivity

    connectivity, note = synthesis_handlers.resolve_connectivity(None, SynthesisConnectivity.GRID)

    assert connectivity is SynthesisConnectivity.GRID
    assert "grid" in note


def test_resolve_connectivity_treats_an_ibm_device_as_heavy_hex():
    from majorana_contracts.enums import SynthesisConnectivity

    connectivity, note = synthesis_handlers.resolve_connectivity("ibm.open_plan", None)

    assert connectivity is SynthesisConnectivity.HEAVY_HEX
    assert "IBM" in note


def test_resolve_connectivity_treats_a_trapped_ion_device_as_all_to_all():
    from majorana_contracts.enums import SynthesisConnectivity

    connectivity, note = synthesis_handlers.resolve_connectivity("braket.ionq.forte", None)

    assert connectivity is SynthesisConnectivity.ALL_TO_ALL
    assert "trapped ion" in note


def test_resolve_connectivity_approximates_a_non_ibm_superconducting_device_as_grid():
    from majorana_contracts.enums import SynthesisConnectivity

    connectivity, note = synthesis_handlers.resolve_connectivity("braket.rigetti.cepheus", None)

    assert connectivity is SynthesisConnectivity.GRID
    assert "approximated" in note


def test_resolve_connectivity_refuses_an_unknown_device():
    from majorana_frameworks.optimizers import CircuitOptimizationError

    with pytest.raises(CircuitOptimizationError) as raised:
        synthesis_handlers.resolve_connectivity("not.a.real.device", None)

    assert raised.value.code == "target_unknown_device"


# --- _best_candidate: only proven-equivalent candidates ever win ---------------


def _candidate(compiler, *, status="succeeded", metric_value=None, equivalent=None, checked=True):
    from majorana_contracts import ResourceMetrics, SynthesisCandidate, SynthesisEquivalence

    if status != "succeeded":
        return SynthesisCandidate(compiler=compiler, status=status, reason="x")
    equivalence = None
    if equivalent is not None or not checked:
        equivalence = SynthesisEquivalence(
            checked=checked,
            equivalent=equivalent if checked else None,
            width_limit=12,
            detail="detail",
        )
    return SynthesisCandidate(
        compiler=compiler,
        status="succeeded",
        compiler_version="1.0",
        operations=[],
        before=ResourceMetrics(qubits=2, depth=5, gate_count=5, two_qubit_gate_count=5, t_count=5),
        after=ResourceMetrics(
            qubits=2,
            depth=metric_value,
            gate_count=metric_value,
            two_qubit_gate_count=metric_value,
            t_count=metric_value,
        ),
        equivalence=equivalence,
    )


def test_best_candidate_picks_the_lowest_objective_metric_among_equivalent_candidates():
    from majorana_contracts.enums import CircuitCompiler, SynthesisObjective

    candidates = [
        _candidate(CircuitCompiler.QISKIT, metric_value=3, equivalent=True),
        _candidate(CircuitCompiler.CIRQ, metric_value=1, equivalent=True),
        _candidate(CircuitCompiler.PYTKET, metric_value=2, equivalent=True),
    ]

    best = synthesis_handlers._best_candidate(candidates, SynthesisObjective.DEPTH)

    assert best is CircuitCompiler.CIRQ


def test_best_candidate_never_picks_a_candidate_that_failed_equivalence():
    from majorana_contracts.enums import CircuitCompiler, SynthesisObjective

    candidates = [
        _candidate(CircuitCompiler.QISKIT, metric_value=1, equivalent=False),  # smallest, but WRONG
        _candidate(CircuitCompiler.CIRQ, metric_value=5, equivalent=True),
    ]

    best = synthesis_handlers._best_candidate(candidates, SynthesisObjective.DEPTH)

    assert best is CircuitCompiler.CIRQ


def test_best_candidate_never_picks_an_unchecked_candidate():
    from majorana_contracts.enums import CircuitCompiler, SynthesisObjective

    candidates = [
        _candidate(CircuitCompiler.QISKIT, metric_value=1, checked=False),  # too wide to check
        _candidate(CircuitCompiler.CIRQ, metric_value=5, equivalent=True),
    ]

    best = synthesis_handlers._best_candidate(candidates, SynthesisObjective.DEPTH)

    assert best is CircuitCompiler.CIRQ


def test_best_candidate_is_none_when_nothing_qualifies():
    from majorana_contracts.enums import CircuitCompiler, SynthesisObjective

    candidates = [_candidate(CircuitCompiler.QISKIT, status="failed")]

    assert synthesis_handlers._best_candidate(candidates, SynthesisObjective.DEPTH) is None


# --- End-to-end: the handler, with a scripted (fake) sandbox result -----------


class _Store:
    def __init__(self):
        self.status = RunStatus.QUEUED
        self.finished = None

    async def set_status(self, status, **_fields):
        self.status = status

    async def current_status(self):
        return self.status

    async def finish(self, status, payload, **fields):
        self.status = status
        self.finished = (payload, fields)
        return status


class _Sink:
    def __init__(self):
        self.emitted: list[tuple[str, dict]] = []

    async def emit(self, event_type, payload, **_kwargs):
        self.emitted.append((event_type, payload))


def _fake_sandbox_result(protected_result):
    return SandboxResult(
        ok=True,
        exit_code=0,
        duration_ms=12,
        stdout="",
        stderr="",
        provider="local",
        protected_result=protected_result,
    )


async def _run_handler(
    monkeypatch, store, sink, kernel_result, *, target=None, objective="two_qubit_count"
):
    run_id = uuid.uuid4()

    async def get_run(*_args):
        return SimpleNamespace(status="queued", timeout_s=30)

    async def fake_run_trusted(_sandbox, **kwargs):
        assert kwargs["entrypoint"] == "_main_synthesize"
        return _fake_sandbox_result(kernel_result)

    monkeypatch.setattr(handlers.runs_repo, "get_run", get_run)
    monkeypatch.setattr(handlers, "RepoRunStateStore", lambda *_args: store)
    monkeypatch.setattr(handlers, "RepoEventSink", lambda *_args: sink)
    monkeypatch.setattr(synthesis_handlers, "run_trusted", fake_run_trusted)

    payload = {
        "run_id": str(run_id),
        "user_id": str(uuid.uuid4()),
        "workspace_id": str(uuid.uuid4()),
        "circuit_synthesis": {
            "qubit_count": 2,
            "operations": [
                {"gate": "H", "qubits": [0]},
                {"gate": "CX", "qubits": [0, 1]},
            ],
            "target": target or {"connectivity": "all_to_all"},
            "objective": objective,
        },
    }
    await handlers.handle_circuit_synthesize(object(), payload, sandbox=object())
    return run_id


async def test_circuit_synthesis_checks_every_candidate_and_picks_the_best(monkeypatch):
    store, sink = _Store(), _Sink()
    kernel_result = {
        "ok": True,
        "results": {
            "qiskit": {
                "ok": True,
                "version": "2.5.2",
                "operations": [
                    {"gate": "H", "qubits": [0], "angle_radians": None},
                    {"gate": "CX", "qubits": [0, 1], "angle_radians": None},
                ],
            },
            "cirq": {"ok": False, "code": "compiler_unavailable", "message": "not installed"},
        },
    }

    run_id = await _run_handler(monkeypatch, store, sink, kernel_result)

    result_event = next(payload for event, payload in sink.emitted if event == "synthesis.result")
    assert result_event["accepted"] is True
    result = result_event["result"]
    by_compiler = {c["compiler"]: c for c in result["candidates"]}
    assert by_compiler["qiskit"]["status"] == "succeeded"
    assert by_compiler["qiskit"]["equivalence"]["checked"] is True
    assert by_compiler["qiskit"]["equivalence"]["equivalent"] is True
    assert by_compiler["cirq"]["status"] == "unsupported"
    assert result["best_candidate_compiler"] == "qiskit"
    assert store.status is RunStatus.SUCCEEDED
    for event_type, payload in sink.emitted:
        handlers._validated_event_payload(run_id, event_type, payload)  # wire-format check


async def test_circuit_synthesis_negative_control_catches_a_dropped_gate(monkeypatch):
    """The negative control the task requires: a "compiler" that drops a gate
    (here, the CX) must be reported NOT equivalent and excluded from
    best_candidate_compiler even though its gate count looks best."""

    store, sink = _Store(), _Sink()
    kernel_result = {
        "ok": True,
        "results": {
            "qiskit": {  # honest: unchanged, still equivalent
                "ok": True,
                "version": "2.5.2",
                "operations": [
                    {"gate": "H", "qubits": [0], "angle_radians": None},
                    {"gate": "CX", "qubits": [0, 1], "angle_radians": None},
                ],
            },
            "cirq": {  # dropped the CX -- smallest gate count, WRONG circuit
                "ok": True,
                "version": "1.6.1",
                "operations": [{"gate": "H", "qubits": [0], "angle_radians": None}],
            },
        },
    }

    await _run_handler(monkeypatch, store, sink, kernel_result, objective="two_qubit_count")

    result_event = next(payload for event, payload in sink.emitted if event == "synthesis.result")
    by_compiler = {c["compiler"]: c for c in result_event["result"]["candidates"]}
    assert by_compiler["cirq"]["equivalence"]["checked"] is True
    assert by_compiler["cirq"]["equivalence"]["equivalent"] is False
    assert any("NOT equivalent" in warning for warning in by_compiler["cirq"]["warnings"])
    assert any("cannot be applied" in warning for warning in by_compiler["cirq"]["warnings"])
    # cirq has fewer two-qubit gates (0 vs 1) but is WRONG, so qiskit must win.
    assert result_event["result"]["best_candidate_compiler"] == "qiskit"


async def test_circuit_synthesis_request_level_refusal_closes_the_run(monkeypatch):
    store, sink = _Store(), _Sink()

    await _run_handler(
        monkeypatch, store, sink, {"ok": True, "results": {}}, target={"device_id": "nope"}
    )

    result_event = next(payload for event, payload in sink.emitted if event == "synthesis.result")
    assert result_event["accepted"] is False
    assert result_event["result"] is None
    assert store.status is RunStatus.FAILED
    assert store.finished[0]["reason_code"] == "target_unknown_device"


async def test_circuit_synthesis_never_treats_a_whole_batch_failure_as_zero_candidates(monkeypatch):
    """A kernel-level refusal (malformed request) is a run failure, never a
    synthesis.result with an empty, accepted candidate list."""

    store, sink = _Store(), _Sink()
    kernel_result = {"ok": False, "code": "compiler_internal_error", "message": "boom"}

    await _run_handler(monkeypatch, store, sink, kernel_result)

    result_event = next(payload for event, payload in sink.emitted if event == "synthesis.result")
    assert result_event["accepted"] is False
    assert store.status is RunStatus.FAILED
