"""Independent verification over parsed OpenQASM programs using Qiskit primitives."""

from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from typing import Literal

import numpy as np
from majorana_openqasm import fingerprint, normalize
from pydantic import BaseModel, Field
from qiskit import QuantumCircuit, qasm3
from qiskit.quantum_info import Operator, Statevector


class EquivalenceReport(BaseModel):
    fingerprint_type: Literal["exact_unitary", "statistical_distribution"]
    protocol: dict
    fingerprint_hash: str
    passed: bool
    scores: dict = Field(default_factory=dict)


def _load_circuit(source: str) -> QuantumCircuit:
    """Create an ephemeral SDK circuit from the canonical string boundary."""
    return qasm3.loads(normalize(source))


def _unitary_circuit(source: str):
    circuit = _load_circuit(source)
    return circuit.remove_final_measurements(inplace=False)


def simulate_statevector(source: str) -> np.ndarray:
    try:
        return np.asarray(Statevector.from_instruction(_unitary_circuit(source)).data)
    except Exception as exc:
        raise ValueError(f"OpenQASM program is not statevector-compatible: {exc}") from exc


def unitary(source: str) -> np.ndarray:
    try:
        return np.asarray(Operator(_unitary_circuit(source)).data)
    except Exception as exc:
        raise ValueError(f"OpenQASM program is not unitary-compatible: {exc}") from exc


def _phase_align_distance(left: np.ndarray, right: np.ndarray) -> float:
    inner = np.vdot(right.reshape(-1), left.reshape(-1))
    phase = inner / abs(inner) if abs(inner) > 0 else 1
    return float(np.max(np.abs(left - phase * right)))


def exact_equivalence(
    reference: str,
    candidate: str,
    tolerance: float = 1e-9,
    max_qubits: int = 6,
) -> EquivalenceReport:
    left = _load_circuit(reference)
    right = _load_circuit(candidate)
    if left.num_qubits != right.num_qubits:
        distance = float("inf")
        passed = False
    elif left.num_qubits > max_qubits:
        raise ValueError(f"exact protocol supports at most {max_qubits} qubits")
    else:
        distance = _phase_align_distance(unitary(reference), unitary(candidate))
        passed = distance <= tolerance
    protocol = {"name": "exact", "tolerance": tolerance, "max_qubits": max_qubits}
    payload = {
        "reference": normalize(reference),
        "candidate": normalize(candidate),
        "protocol": protocol,
        "distance": distance,
    }
    return EquivalenceReport(
        fingerprint_type="exact_unitary",
        protocol=protocol,
        fingerprint_hash=hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest(),
        passed=passed,
        scores={"max_abs_distance": distance},
    )


def ideal_distribution(source: str) -> dict[str, float]:
    circuit = _load_circuit(source)
    probabilities = np.abs(simulate_statevector(source)) ** 2
    return {
        format(index, f"0{circuit.num_qubits}b"): float(value)
        for index, value in enumerate(probabilities)
        if value > 0.0
    }


def measurement_map(circuit: QuantumCircuit) -> dict[int, int]:
    """Map clbit index -> measured qubit index, read off the circuit's measure ops.

    A clbit written more than once keeps the last write, which is what the reported
    counts show. Mid-circuit measurement is not modelled here: the statevector path
    rejects it upstream, because a circuit that is not unitary up to its final
    measurements has no statevector to compare against.
    """
    mapping: dict[int, int] = {}
    for instruction in circuit.data:
        if instruction.operation.name != "measure":
            continue
        mapping[circuit.find_bit(instruction.clbits[0]).index] = circuit.find_bit(
            instruction.qubits[0]
        ).index
    return mapping


def measured_ideal_distribution(
    source: str, width: int | None = None
) -> tuple[dict[str, float], dict]:
    """Ideal distribution over the bits a run actually reports, not the whole register.

    Every ancilla algorithm measures only its answer register, so the reported counts
    are narrower than the circuit. Marginalizing the statevector over the measured
    qubits is what lets those runs be checked at all; demanding full width failed
    correct code.

    Returns the distribution plus a provenance dict describing how the counts string
    was interpreted, so the evidence can be read back later.
    """
    circuit = _load_circuit(source)
    mapping = measurement_map(circuit)
    if not mapping:
        return ideal_distribution(source), {
            "keyed_by": "qubits",
            "width": circuit.num_qubits,
            "measured_qubits": list(range(circuit.num_qubits)),
        }

    measured_clbits = sorted(mapping)
    # Frameworks report either the whole classical register (unmeasured clbits read 0)
    # or only the clbits that were written. Both are unambiguous once the width is known.
    if width is not None and width == len(measured_clbits) != circuit.num_clbits:
        positions = {clbit: index for index, clbit in enumerate(measured_clbits)}
        key_width = len(measured_clbits)
        keyed_by = "measured_clbits"
    else:
        positions = {clbit: clbit for clbit in measured_clbits}
        key_width = circuit.num_clbits
        keyed_by = "clbits"

    qargs = [mapping[clbit] for clbit in measured_clbits]
    # probabilities_dict keys put qargs[0] in the rightmost character, which is the
    # same little-endian convention the counts strings use for clbit 0.
    try:
        marginal = Statevector.from_instruction(_unitary_circuit(source)).probabilities_dict(
            qargs=qargs
        )
    except Exception as exc:  # pragma: no cover - mirrors simulate_statevector's contract
        raise ValueError(f"OpenQASM program is not statevector-compatible: {exc}") from exc

    distribution: dict[str, float] = {}
    for key, value in marginal.items():
        if value <= 0.0:
            continue
        bits = ["0"] * key_width
        for index, clbit in enumerate(measured_clbits):
            bits[key_width - 1 - positions[clbit]] = key[len(key) - 1 - index]
        full = "".join(bits)
        distribution[full] = distribution.get(full, 0.0) + float(value)
    provenance = {
        "keyed_by": keyed_by,
        "width": key_width,
        "measured_qubits": [mapping[clbit] for clbit in measured_clbits],
        "clbit_to_qubit": {str(clbit): mapping[clbit] for clbit in measured_clbits},
        "partial": len(set(qargs)) < circuit.num_qubits,
    }
    return distribution, provenance


def _sample_distribution(source: str, shots: int, seed: int) -> dict[str, float]:
    if shots < 1:
        raise ValueError("shots must be >= 1")
    circuit = _load_circuit(source)
    probabilities = np.abs(simulate_statevector(source)) ** 2
    rng = np.random.default_rng(seed)
    samples = rng.choice(len(probabilities), size=shots, p=probabilities)
    counts = Counter(format(int(sample), f"0{circuit.num_qubits}b") for sample in samples)
    return {key: count / shots for key, count in sorted(counts.items())}


def _total_variation(left: dict[str, float], right: dict[str, float]) -> float:
    keys = set(left) | set(right)
    return 0.5 * sum(abs(left.get(key, 0.0) - right.get(key, 0.0)) for key in keys)


def counts_vs_ideal(
    source: str,
    counts: dict[str, int],
    threshold: float | None = None,
    delta: float = 1e-3,
    max_bins: int = 256,
    max_qubits: int = 20,
    bit_order: Literal["big", "little", "auto"] = "auto",
) -> EquivalenceReport:
    circuit = _load_circuit(source)
    if circuit.num_qubits > max_qubits:
        raise ValueError(f"statistical counts check supports at most {max_qubits} qubits")
    if max_bins < 1:
        raise ValueError("max_bins must be >= 1")
    if not 0 < delta < 1:
        raise ValueError("delta must be in (0, 1)")
    normalized_counts: dict[str, int] = {}
    observed_width: int | None = None
    for key, value in counts.items():
        bits = str(key).replace(" ", "")
        if not bits or set(bits) - {"0", "1"}:
            raise ValueError(f"counts key {key!r} is not a bitstring")
        if observed_width is None:
            observed_width = len(bits)
        elif len(bits) != observed_width:
            raise ValueError(
                f"counts key {key!r} has {len(bits)} bits; other keys have {observed_width}"
            )
        if (
            isinstance(value, bool)
            or not isinstance(value, int | float)
            or not math.isfinite(value)
            or value != int(value)
            or value < 0
        ):
            raise ValueError(f"count for {key!r} is not a non-negative integer: {value!r}")
        normalized_counts[bits] = normalized_counts.get(bits, 0) + int(value)
    shots = sum(normalized_counts.values())
    if shots <= 0:
        raise ValueError("counts are empty")

    ideal, measurement = measured_ideal_distribution(source, width=observed_width)
    if observed_width != measurement["width"]:
        raise ValueError(
            f"counts keys have {observed_width} bits; the circuit reports "
            f"{measurement['width']} ({measurement['keyed_by']})"
        )
    orientations = {"little": ("as_is",), "big": ("reversed",), "auto": ("as_is", "reversed")}[
        bit_order
    ]
    tvds: dict[str, float] = {}
    coarse_bins = 0
    for orientation in orientations:
        observed = {
            (key if orientation == "as_is" else key[::-1]): count / shots
            for key, count in normalized_counts.items()
            if count > 0
        }
        support = set(ideal) | set(observed)
        if len(support) > max_bins:
            raise ValueError(
                f"statistical counts check supports at most {max_bins} nonzero outcomes"
            )
        coarse_bins = len(support)
        tvds[orientation] = _total_variation(ideal, observed)
    orientation_used = min(tvds, key=tvds.get)  # type: ignore[arg-type]
    tvd = tvds[orientation_used]
    threshold_source = "plan" if threshold is not None else "shot_noise_bound"
    if threshold is None:
        threshold = math.sqrt((coarse_bins * math.log(2) + math.log(1 / delta)) / (2 * shots))
    protocol = {
        "name": "statistical_counts",
        "shots": shots,
        "threshold": threshold,
        "threshold_source": threshold_source,
        "delta": delta,
        "bins": coarse_bins,
        "bit_order": bit_order,
        "orientation_used": orientation_used,
        "measurement": measurement,
    }
    payload = {"candidate": fingerprint(source), "protocol": protocol, "tvd": tvd}
    return EquivalenceReport(
        fingerprint_type="statistical_distribution",
        protocol=protocol,
        fingerprint_hash=hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest(),
        passed=tvd <= threshold,
        scores={"total_variation_distance": tvd, "both_orientations": tvds},
    )


def statistical_equivalence(
    reference: str,
    candidate: str,
    shots: int = 4096,
    seed: int = 1234,
    threshold: float = 0.05,
) -> EquivalenceReport:
    left = _sample_distribution(reference, shots=shots, seed=seed)
    right = _sample_distribution(candidate, shots=shots, seed=seed)
    tvd = _total_variation(left, right)
    protocol = {"name": "statistical", "shots": shots, "seed": seed, "threshold": threshold}
    payload = {
        "reference": fingerprint(reference),
        "candidate": fingerprint(candidate),
        "protocol": protocol,
        "tvd": tvd,
    }
    return EquivalenceReport(
        fingerprint_type="statistical_distribution",
        protocol=protocol,
        fingerprint_hash=hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest(),
        passed=tvd <= threshold,
        scores={"total_variation_distance": tvd},
    )
