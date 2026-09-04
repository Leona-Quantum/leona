"""An example test that proves the environment: build a Bell circuit with
the V2 `StatevectorSampler` and check the outcomes it produces. If this
fails, the Qiskit install (not your notebook) is the problem."""

from __future__ import annotations

from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler

from shared.results import probabilities


def _bell_circuit() -> QuantumCircuit:
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    qc.measure_all()
    return qc


def test_bell_circuit_only_produces_correlated_outcomes() -> None:
    qc = _bell_circuit()
    sampler = StatevectorSampler(seed=42)
    result = sampler.run([qc], shots=2000).result()
    counts = result[0].data.meas.get_counts()

    # A Bell state only ever measures both qubits equal: "00" or "11".
    assert set(counts.keys()) <= {"00", "11"}
    assert sum(counts.values()) == 2000


def test_bell_circuit_outcomes_are_roughly_balanced() -> None:
    qc = _bell_circuit()
    sampler = StatevectorSampler(seed=7)
    result = sampler.run([qc], shots=2000).result()
    counts = result[0].data.meas.get_counts()
    probs = probabilities(counts, shots=2000)

    # Each branch is ideally 50%; sampling noise gets a generous band here
    # because this test only needs to prove the environment works, not
    # teach statistics.
    assert 0.4 <= probs.get("00", 0.0) <= 0.6
    assert 0.4 <= probs.get("11", 0.0) <= 0.6
