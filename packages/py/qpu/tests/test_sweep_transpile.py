"""`_transpile_pubs(..., bindings=...)` — the PUBs a hardware parameter sweep
sends, against a fake IBM backend.

Same shape of check `test_mitigation.py` runs for ZNE's folds
(`test_every_scale_runs_the_same_physical_pairs_exactly_one_three_and_five_times`):
a joint reading across several PUBs is only meaningful if every PUB ran on the
same physical qubits. ZNE gets that by construction (folding the COMPILED
circuit). A sweep's bindings are independently-parsed, independently-compiled
circuits — the same gates, only one angle's numeric value differs — so this
file checks that fixing `seed_transpiler` is enough to make the compiler
choose the SAME layout and routing for all of them on a circuit that actually
needs routing (so a test that never routes could not tell "same seed, same
result" apart from "nothing about compilation could have differed").
"""

from __future__ import annotations

import pytest

from majorana_qpu.ibm import _transpile_pubs


def _loads(qasm: str):
    from qiskit import qasm3

    return qasm3.loads(qasm)


def _fake_backend():
    from qiskit_ibm_runtime.fake_provider import FakeManilaV2

    return FakeManilaV2()


def _physical_pairs(circuit):
    from collections import Counter

    return Counter(
        tuple(circuit.find_bit(qubit).index for qubit in instruction.qubits)
        for instruction in circuit.data
        if instruction.operation.num_qubits == 2 and instruction.operation.name != "barrier"
    )


def _measured_qubits(circuit):
    return [
        (
            circuit.find_bit(instruction.qubits[0]).index,
            circuit.find_bit(instruction.clbits[0]).index,
        )
        for instruction in circuit.data
        if instruction.operation.name == "measure"
    ]


def _triangle(angle: float) -> str:
    # Same routed-triangle shape `test_mitigation.py` uses (no line of qubits
    # embeds three mutual CX pairs, so FakeManilaV2 must route it with SWAPs),
    # with the swept value in the one place a Studio angle sweep would vary.
    return (
        'OPENQASM 3.0; include "stdgates.inc"; qubit[3] q; bit[3] c; '
        f"h q[0]; cx q[0], q[1]; cx q[1], q[2]; cx q[0], q[2]; rz({angle}) q[2]; c = measure q;"
    )


BINDING_ANGLES = (0.0, 0.7853981633974483, 3.141592653589793, -1.5707963267948966)


class _Binding:
    def __init__(self, label: str, qasm: str) -> None:
        self.label = label
        self.qasm = qasm


def _bindings():
    return tuple(_Binding(f"{a} rad", _triangle(a)) for a in BINDING_ANGLES)


def test_a_sweep_builds_one_pub_per_binding():
    backend = _fake_backend()
    bindings = _bindings()
    pubs, mitigation, sweep = _transpile_pubs(
        _loads(bindings[0].qasm), backend, zne=False, bindings=bindings
    )
    assert len(pubs) == len(bindings)
    assert sweep is not None
    assert len(sweep["two_qubit_gate_counts"]) == len(bindings)


def test_every_binding_lands_on_the_same_physical_pairs():
    """The property this file exists to check: four circuits that differ only
    in one rz angle, on a shape that needs routing, all compile to the same
    physical-pair multiset under a fixed transpiler seed."""
    backend = _fake_backend()
    bindings = _bindings()
    pubs, _mitigation, _sweep = _transpile_pubs(
        _loads(bindings[0].qasm), backend, zne=False, bindings=bindings
    )
    base = _physical_pairs(pubs[0])
    assert base, "the triangle must actually use two-qubit gates"
    for pub in pubs[1:]:
        assert _physical_pairs(pub) == base
    measured = _measured_qubits(pubs[0])
    for pub in pubs[1:]:
        assert _measured_qubits(pub) == measured


def test_the_triangle_bindings_really_are_routed():
    """Without this, the test above could pass on a shape that needed no
    SWAPs, which is the case where independent compilation is harmless."""
    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

    isa = generate_preset_pass_manager(
        backend=_fake_backend(), optimization_level=1, seed_transpiler=0
    ).run(_loads(_triangle(0.0)))
    assert sum(_physical_pairs(isa).values()) > 3


def test_the_two_qubit_gate_counts_agree_with_the_physical_pairs():
    backend = _fake_backend()
    bindings = _bindings()
    pubs, _mitigation, sweep = _transpile_pubs(
        _loads(bindings[0].qasm), backend, zne=False, bindings=bindings
    )
    expected = [sum(_physical_pairs(pub).values()) for pub in pubs]
    assert sweep["two_qubit_gate_counts"] == expected


def test_zne_and_a_sweep_cannot_both_be_requested():
    """`submit()` asserts this; the route and the worker both refuse it
    earlier, so this is defense in depth rather than a reachable path — kept
    as a test because a defense that is never exercised is unverified."""
    from majorana_qpu.ibm import IbmRuntimeProvider
    from majorana_qpu.models import QpuJobRequest

    provider = IbmRuntimeProvider("fake-token", environ={"MAJORANA_QPU_SUBMIT_ENABLED": "true"})
    request = QpuJobRequest(
        device_id="ibm.open_plan",
        shots=10,
        qasm=_triangle(0.0),
        source_fingerprint="fnv1a-deadbeef",
        zne=True,
        bindings=tuple({"label": b.label, "qasm": b.qasm} for b in _bindings()),  # type: ignore[arg-type]
    )
    with pytest.raises(AssertionError):
        provider.submit(request)
