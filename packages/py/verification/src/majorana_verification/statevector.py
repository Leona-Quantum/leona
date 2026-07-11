"""Statevector simulation + exact/statistical circuit equivalence. Ported from the
quepo `qhte.verification.protocols` engine; operates on the majorana IR directly,
so it needs no quantum SDK — pure numpy. This is the independent reference the
verify stage uses to catch fabricated results."""

from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from typing import Literal

import numpy as np
from majorana_ir import Circuit, canonical_json, canonicalize_circuit
from pydantic import BaseModel, Field


class EquivalenceReport(BaseModel):
    fingerprint_type: Literal["exact_unitary", "statistical_distribution"]
    protocol: dict
    fingerprint_hash: str
    passed: bool
    scores: dict = Field(default_factory=dict)


def _single_gate_matrix(gate: str, params: list[float | str]) -> np.ndarray:
    if gate == "x":
        return np.array([[0, 1], [1, 0]], dtype=complex)
    if gate == "y":
        return np.array([[0, -1j], [1j, 0]], dtype=complex)
    if gate == "z":
        return np.array([[1, 0], [0, -1]], dtype=complex)
    if gate == "h":
        return np.array([[1, 1], [1, -1]], dtype=complex) / math.sqrt(2)
    if gate == "s":
        return np.array([[1, 0], [0, 1j]], dtype=complex)
    if gate == "t":
        return np.array([[1, 0], [0, np.exp(1j * math.pi / 4)]], dtype=complex)
    theta = float(params[0])
    if gate == "rx":
        c, s = math.cos(theta / 2), math.sin(theta / 2)
        return np.array([[c, -1j * s], [-1j * s, c]], dtype=complex)
    if gate == "ry":
        c, s = math.cos(theta / 2), math.sin(theta / 2)
        return np.array([[c, -s], [s, c]], dtype=complex)
    if gate == "rz":
        return np.array(
            [[np.exp(-1j * theta / 2), 0], [0, np.exp(1j * theta / 2)]],
            dtype=complex,
        )
    if gate == "u":
        theta = float(params[0])
        phi = float(params[1])
        lam = float(params[2])
        return np.array(
            [
                [math.cos(theta / 2), -np.exp(1j * lam) * math.sin(theta / 2)],
                [
                    np.exp(1j * phi) * math.sin(theta / 2),
                    np.exp(1j * (phi + lam)) * math.cos(theta / 2),
                ],
            ],
            dtype=complex,
        )
    raise ValueError(f"unsupported single-qubit gate '{gate}'")


def _apply_single(state: np.ndarray, qubits: int, target: int, matrix: np.ndarray) -> np.ndarray:
    tensor = state.reshape([2] * qubits)
    tensor = np.moveaxis(tensor, target, 0)
    tensor = np.tensordot(matrix, tensor, axes=([1], [0]))
    tensor = np.moveaxis(tensor, 0, target)
    return tensor.reshape(-1)


def _apply_two_permutation(
    state: np.ndarray, qubits: int, q0: int, q1: int, gate: str
) -> np.ndarray:
    out = np.zeros_like(state)
    for index, amplitude in enumerate(state):
        bits = list(format(index, f"0{qubits}b"))
        b0, b1 = bits[q0], bits[q1]
        if gate == "cx" and b0 == "1":
            bits[q1] = "0" if b1 == "1" else "1"
        elif gate == "cz" and b0 == "1" and b1 == "1":
            out[index] += -amplitude
            continue
        elif gate == "swap":
            bits[q0], bits[q1] = bits[q1], bits[q0]
        out[int("".join(bits), 2)] += amplitude
    return out


def _apply_controlled_phase(
    state: np.ndarray, qubits: int, control: int, target: int, theta: float
) -> np.ndarray:
    out = np.array(state, copy=True)
    phase = np.exp(1j * theta)
    for index, amplitude in enumerate(state):
        bits = format(index, f"0{qubits}b")
        if bits[control] == "1" and bits[target] == "1":
            out[index] = amplitude * phase
    return out


def _apply_three_permutation(
    state: np.ndarray, qubits: int, q0: int, q1: int, q2: int, gate: str
) -> np.ndarray:
    out = np.zeros_like(state)
    for index, amplitude in enumerate(state):
        bits = list(format(index, f"0{qubits}b"))
        if gate == "ccx" and bits[q0] == "1" and bits[q1] == "1":
            bits[q2] = "0" if bits[q2] == "1" else "1"
        elif gate == "cswap" and bits[q0] == "1":
            bits[q1], bits[q2] = bits[q2], bits[q1]
        out[int("".join(bits), 2)] += amplitude
    return out


def _evolve(circuit: Circuit, state: np.ndarray) -> np.ndarray:
    for operation in circuit.operations:
        if operation.gate in {"measure", "barrier"}:
            continue
        if operation.gate == "reset":
            raise ValueError(
                "reset is non-unitary and is not supported by the statevector verifier"
            )
        if len(operation.qubits) == 1:
            state = _apply_single(
                state,
                circuit.qubits,
                operation.qubits[0],
                _single_gate_matrix(operation.gate, operation.params),
            )
        elif operation.gate == "cp":
            state = _apply_controlled_phase(
                state,
                circuit.qubits,
                operation.qubits[0],
                operation.qubits[1],
                float(operation.params[0]),
            )
        elif len(operation.qubits) == 2:
            state = _apply_two_permutation(
                state, circuit.qubits, operation.qubits[0], operation.qubits[1], operation.gate
            )
        else:
            state = _apply_three_permutation(
                state,
                circuit.qubits,
                operation.qubits[0],
                operation.qubits[1],
                operation.qubits[2],
                operation.gate,
            )
    return state


def simulate_statevector(circuit: Circuit) -> np.ndarray:
    circuit = canonicalize_circuit(circuit)
    state = np.zeros(2**circuit.qubits, dtype=complex)
    state[0] = 1
    return _evolve(circuit, state)


def unitary(circuit: Circuit) -> np.ndarray:
    circuit = canonicalize_circuit(circuit)
    dimension = 2**circuit.qubits
    columns = []
    for basis_index in range(dimension):
        state = np.zeros(dimension, dtype=complex)
        state[basis_index] = 1
        columns.append(_evolve(circuit, state))
    return np.column_stack(columns)


def _phase_align_distance(left: np.ndarray, right: np.ndarray) -> float:
    inner = np.vdot(right.reshape(-1), left.reshape(-1))
    phase = inner / abs(inner) if abs(inner) > 0 else 1
    return float(np.max(np.abs(left - phase * right)))


def exact_equivalence(
    reference: Circuit,
    candidate: Circuit,
    tolerance: float = 1e-9,
    max_qubits: int = 6,
) -> EquivalenceReport:
    if reference.qubits != candidate.qubits:
        distance = float("inf")
        passed = False
    elif reference.qubits > max_qubits:
        raise ValueError(f"exact protocol supports at most {max_qubits} qubits")
    else:
        distance = _phase_align_distance(unitary(reference), unitary(candidate))
        passed = distance <= tolerance

    protocol = {"name": "exact", "tolerance": tolerance, "max_qubits": max_qubits}
    payload = {
        "reference": canonical_json(reference),
        "candidate": canonical_json(candidate),
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


def _distribution(circuit: Circuit, shots: int, seed: int) -> dict[str, float]:
    state = simulate_statevector(circuit)
    probabilities = np.abs(state) ** 2
    rng = np.random.default_rng(seed)
    samples = rng.choice(len(probabilities), size=shots, p=probabilities)
    counts = Counter(format(int(sample), f"0{circuit.qubits}b") for sample in samples)
    return {key: count / shots for key, count in sorted(counts.items())}


def _total_variation(left: dict[str, float], right: dict[str, float]) -> float:
    keys = set(left) | set(right)
    return 0.5 * sum(abs(left.get(key, 0.0) - right.get(key, 0.0)) for key in keys)


def ideal_distribution(circuit: Circuit) -> dict[str, float]:
    """Exact Born probabilities of the circuit on |0...0>, keyed by big-endian
    bitstrings (qubit 0 leftmost — the engine's convention)."""
    state = simulate_statevector(circuit)
    probabilities = np.abs(state) ** 2
    return {
        format(index, f"0{circuit.qubits}b"): float(p)
        for index, p in enumerate(probabilities)
        if p > 0.0
    }


def _coarsen(
    ideal: dict[str, float], observed: dict[str, float], max_bins: int
) -> tuple[dict[str, float], dict[str, float], int]:
    """Bin both distributions onto the ideal distribution's highest-probability
    outcomes plus one TAIL bin. Coarsening is a projection, so the coarse TVD
    lower-bounds the full TVD (data-processing inequality) — passing the coarse
    test is a necessary condition, and keeping d_eff small keeps the
    finite-shot threshold below useless."""
    kept = [k for k, _ in sorted(ideal.items(), key=lambda kv: -kv[1])[:max_bins]]
    kept_set = set(kept)
    coarse_ideal = {k: ideal[k] for k in kept}
    coarse_ideal["__TAIL__"] = max(0.0, 1.0 - sum(coarse_ideal.values()))
    coarse_observed = {k: observed.get(k, 0.0) for k in kept}
    coarse_observed["__TAIL__"] = sum(v for k, v in observed.items() if k not in kept_set)
    return coarse_ideal, coarse_observed, len(kept) + 1


def counts_vs_ideal(
    circuit: Circuit,
    counts: dict[str, int],
    threshold: float | None = None,
    delta: float = 1e-3,
    max_bins: int = 256,
    max_qubits: int = 20,
) -> EquivalenceReport:
    """Check reported measurement counts against a direct statevector simulation
    of the circuit (the headless statistical verification: no reference circuit
    needed — the emitted circuit itself is simulated independently).

    Statistical test: total-variation distance between the empirical distribution
    and the exact Born distribution, both coarsened to <= max_bins+1 bins. With no
    explicit threshold, the pass bound is the Weissman et al. L1 concentration
    inequality — P(||p_hat - p||_1 >= eps) <= 2^d exp(-N eps^2 / 2) — solved at
    confidence delta: TVD_max = sqrt((d ln2 + ln(1/delta)) / (2N)). Correct code
    sampling from the true distribution exceeds this with probability <= delta.

    Counts bitstring convention: Qiskit reports counts little-endian (qubit 0
    rightmost); the engine is big-endian. Both orientations are tried and the
    better one is recorded — bit order is representation, not correctness.
    """
    if circuit.qubits > max_qubits:
        raise ValueError(f"statistical counts check supports at most {max_qubits} qubits")
    normalized: dict[str, int] = {}
    for key, value in counts.items():
        bits = str(key).replace(" ", "")
        if not bits or set(bits) - {"0", "1"}:
            raise ValueError(f"counts key {key!r} is not a bitstring")
        if len(bits) != circuit.qubits:
            raise ValueError(
                f"counts key {key!r} has {len(bits)} bits; circuit has {circuit.qubits} qubits"
            )
        normalized[bits] = normalized.get(bits, 0) + int(value)
    shots = sum(normalized.values())
    if shots <= 0:
        raise ValueError("counts are empty")

    ideal = ideal_distribution(circuit)
    tvds: dict[str, float] = {}
    coarse_bins = 0
    for orientation in ("as_is", "reversed"):
        observed = {
            (key if orientation == "as_is" else key[::-1]): count / shots
            for key, count in normalized.items()
        }
        coarse_ideal, coarse_observed, coarse_bins = _coarsen(ideal, observed, max_bins)
        tvds[orientation] = _total_variation(coarse_ideal, coarse_observed)
    bit_order = min(tvds, key=tvds.get)  # type: ignore[arg-type]
    tvd = tvds[bit_order]

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
    }
    payload = {"candidate": canonical_json(circuit), "protocol": protocol, "tvd": tvd}
    return EquivalenceReport(
        fingerprint_type="statistical_distribution",
        protocol=protocol,
        fingerprint_hash=hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest(),
        passed=tvd <= threshold,
        scores={"total_variation_distance": tvd, "both_orientations": tvds},
    )


def statistical_equivalence(
    reference: Circuit,
    candidate: Circuit,
    shots: int = 4096,
    seed: int = 1234,
    threshold: float = 0.05,
) -> EquivalenceReport:
    left = _distribution(reference, shots=shots, seed=seed)
    right = _distribution(candidate, shots=shots, seed=seed)
    tvd = _total_variation(left, right)
    protocol = {"name": "statistical", "shots": shots, "seed": seed, "threshold": threshold}
    payload = {
        "reference": canonical_json(reference),
        "candidate": canonical_json(candidate),
        "protocol": protocol,
        "total_variation_distance": tvd,
    }
    return EquivalenceReport(
        fingerprint_type="statistical_distribution",
        protocol=protocol,
        fingerprint_hash=hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest(),
        passed=tvd <= threshold,
        scores={
            "total_variation_distance": tvd,
            "reference_distribution": left,
            "candidate_distribution": right,
        },
    )
