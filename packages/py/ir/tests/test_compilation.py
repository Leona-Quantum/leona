from majorana_ir import Circuit, Operation, compile_circuit, resource_metrics


def _circuit(*gates: str) -> Circuit:
    return Circuit(
        qubits=1,
        classical_bits=0,
        operations=[Operation(gate=gate, qubits=[0]) for gate in gates],
    )


def test_resource_metrics_are_deterministic():
    metrics = resource_metrics(_circuit("h", "x"))
    assert metrics.qubits == 1
    assert metrics.depth == 2
    assert metrics.gate_count == 2


def test_compilation_accepts_safe_pair_cancellation():
    outcome = compile_circuit(_circuit("h", "h", "x"))
    assert outcome.accepted
    assert outcome.mode == "compressed"
    assert outcome.selected.operations[0].gate == "x"


def test_compilation_keeps_original_when_no_safe_rewrite_exists():
    outcome = compile_circuit(_circuit("h", "x"))
    assert not outcome.accepted
    assert outcome.mode == "unchanged"
    assert outcome.selected.operations == outcome.source.operations


def test_resource_blowup_rejects_candidate_and_keeps_source():
    source = _circuit("h")
    expanded = _circuit("h", "x")

    outcome = compile_circuit(source, candidate=expanded)

    assert outcome.mode == "rejected"
    assert outcome.accepted is False
    assert outcome.selected == source
    assert "increased circuit complexity" in (outcome.reason or "")
