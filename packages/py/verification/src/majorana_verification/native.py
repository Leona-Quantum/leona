"""Framework-native verification evidence, judged on arrays.

plans/framework-native-verification.md: the selected framework's own SDK — inside
the trusted observer — computes the statevector and the sampled counts this module
verifies against. No OpenQASM conversion sits in the trust path: three of the four
defects in the conversion family were conversion defects, and the interchange
layer has the worst track record of anything in the correctness claim's chain.

Two kinds of evidence:

- ``native_statevector`` — the final state, for circuits that are unitary up to
  their final measurements. Verified with the same keyed-marginal + orientation
  logic as the OpenQASM path (shared helpers in statevector.py), so partial
  measurement and bit order cannot diverge between the two paths.
- ``native_sampled`` — counts from a trusted re-execution of the actual circuit
  object with a fixed seed, through the framework's own sampler. This is the
  mid-circuit-capable evidence: a feed-forward circuit has no statevector, but it
  samples fine, and comparing the run's reported counts against a trusted
  execution of the same circuit object catches fabricated counts and
  result-assembly defects the reproducibility pair cannot.

Malformed evidence is a FAIL, never a skip: the observer writes an error key
instead of a malformed payload, so a payload that does not validate here is
evidence about the pipeline, and the verifier fails closed on it.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

import numpy as np
from qiskit.quantum_info import Statevector

from majorana_verification.statevector import (
    EquivalenceReport,
    _keyed_marginal_distribution,
    _phase_align_distance,
    _total_variation,
    compare_counts_to_ideal,
    normalize_reported_counts,
    simulate_statevector,
)

# Mirrors the observers' _MAJORANA_NATIVE_SV_QUBITS; packages/py/frameworks tests
# pin the two against drift. 12 leaves headroom over the exporters' 10 so a limit
# bump there fails the pin test rather than silently rejecting valid evidence.
NATIVE_STATEVECTOR_MAX_QUBITS = 12

_ENDIANNESS = ("q0_lsb", "q0_msb")


def statevector_from_evidence(payload: Any) -> tuple[Statevector, dict[int, int], int, int]:
    """Validate a native_statevector payload; return (statevector, mapping, qubits, clbits).

    The returned statevector is normalized to Qiskit's q0-least-significant
    layout regardless of which framework produced it, so every downstream
    comparison shares one convention.
    """
    if not isinstance(payload, dict):
        raise ValueError("native statevector evidence is not a mapping")
    qubits = payload.get("qubits")
    if type(qubits) is not int or not 1 <= qubits <= NATIVE_STATEVECTOR_MAX_QUBITS:
        raise ValueError(f"native statevector qubit count is invalid: {qubits!r}")
    endianness = payload.get("endianness")
    if endianness not in _ENDIANNESS:
        raise ValueError(f"native statevector endianness is invalid: {endianness!r}")
    amplitudes = payload.get("amplitudes")
    expected_length = 2 * (1 << qubits)
    if (
        not isinstance(amplitudes, list)
        or len(amplitudes) != expected_length
        or not all(isinstance(value, int | float) and math.isfinite(value) for value in amplitudes)
    ):
        raise ValueError(
            f"native statevector amplitudes must be {expected_length} finite floats"
        )
    flat = np.asarray(amplitudes, dtype=float)
    vector = flat[0::2] + 1j * flat[1::2]
    norm = float(np.linalg.norm(vector))
    if not math.isclose(norm, 1.0, abs_tol=1e-6):
        raise ValueError(f"native statevector is not normalized (norm {norm:.6f})")
    if endianness == "q0_msb":
        # The producing framework put its first canonical qubit in the most
        # significant bit; transpose to Qiskit's q0-LSB layout.
        vector = vector.reshape([2] * qubits).transpose(*reversed(range(qubits))).reshape(-1)
    clbits = payload.get("clbits")
    if type(clbits) is not int or clbits < 0:
        raise ValueError(f"native statevector clbits is invalid: {clbits!r}")
    raw_map = payload.get("measurement_map")
    if not isinstance(raw_map, dict):
        raise ValueError("native statevector measurement_map is missing")
    mapping: dict[int, int] = {}
    for key, value in raw_map.items():
        try:
            clbit = int(key)
        except (TypeError, ValueError):
            raise ValueError(f"measurement_map key {key!r} is not a clbit index") from None
        if type(value) is not int or not 0 <= value < qubits or not 0 <= clbit < max(clbits, 1):
            raise ValueError(f"measurement_map entry {key!r}: {value!r} is out of range")
        mapping[clbit] = value
    return Statevector(vector), mapping, qubits, clbits


def native_counts_vs_ideal(
    payload: Any,
    counts: dict[str, int],
    threshold: float | None = None,
    delta: float = 1e-3,
    max_bins: int = 256,
) -> EquivalenceReport:
    """Reported counts against the Born distribution of the framework-native state."""
    statevector, mapping, qubits, clbits = statevector_from_evidence(payload)
    normalized_counts, observed_width = normalize_reported_counts(counts)
    if not mapping:
        raise ValueError("native statevector evidence records no measurements to compare")
    ideal, measurement = _keyed_marginal_distribution(
        statevector,
        mapping,
        num_qubits=qubits,
        num_clbits=clbits,
        width=observed_width,
    )
    if observed_width != measurement["width"]:
        raise ValueError(
            f"counts keys have {observed_width} bits; the circuit reports "
            f"{measurement['width']} ({measurement['keyed_by']})"
        )
    return compare_counts_to_ideal(
        ideal,
        measurement,
        normalized_counts,
        threshold=threshold,
        delta=delta,
        max_bins=max_bins,
        bit_order="auto",
        protocol_name="native_statevector_counts",
        fingerprint_payload="native_statevector",
    )


def native_statevector_vs_reference(
    reference_qasm: str,
    payload: Any,
    tolerance: float = 1e-9,
) -> EquivalenceReport:
    """Phase-aligned statevector distance between the plan's reference circuit and
    the framework-native final state.

    The fallback `exact` comparison for candidates whose OpenQASM export failed:
    the reference stays declarative QASM (data we parse, never code we run) and is
    simulated in Qiskit; the candidate side is the state the selected framework's
    own simulator computed. Weaker than unitary equivalence — it checks the action
    on |0…0⟩ only — which the evidence records explicitly.

    Raises StatevectorIncapable when the REFERENCE has no statevector (the
    caller's skip case) and ValueError for everything else.
    """
    reference = simulate_statevector(reference_qasm)
    candidate, _mapping, qubits, _clbits = statevector_from_evidence(payload)
    candidate_vector = np.asarray(candidate.data)
    if len(reference) != len(candidate_vector):
        distance = float("inf")
        passed = False
    else:
        distance = _phase_align_distance(reference, candidate_vector)
        passed = distance <= tolerance
    protocol = {
        "name": "exact_statevector",
        "tolerance": tolerance,
        "qubits": qubits,
        "scope": "action on the all-zero state, not full unitary equivalence",
    }
    payload_hash = {
        "reference": reference_qasm,
        "protocol": protocol,
        "distance": distance if math.isfinite(distance) else "inf",
    }
    return EquivalenceReport(
        fingerprint_type="exact_unitary",
        protocol=protocol,
        fingerprint_hash=hashlib.sha256(
            json.dumps(payload_hash, sort_keys=True).encode()
        ).hexdigest(),
        passed=passed,
        scores={"max_abs_distance": distance},
    )


def sampled_counts_comparison(
    reported: dict[str, int],
    sampled_payload: Any,
    threshold: float | None = None,
    delta: float = 1e-3,
    max_bins: int = 256,
) -> EquivalenceReport:
    """Reported counts against a trusted re-execution of the same circuit object.

    Two finite samples of (claimed) one distribution: the pass bound is the sum of
    each sample's concentration bound, so more shots on either side tighten it.
    An explicit plan threshold overrides the bound, same as every other check.
    """
    if not isinstance(sampled_payload, dict):
        raise ValueError("native sampled evidence is not a mapping")
    sampled_counts = sampled_payload.get("counts")
    if not isinstance(sampled_counts, dict) or not sampled_counts:
        raise ValueError("native sampled evidence carries no counts")
    normalized_reported, reported_width = normalize_reported_counts(reported)
    normalized_sampled, sampled_width = normalize_reported_counts(sampled_counts)
    if reported_width != sampled_width:
        raise ValueError(
            f"reported counts have {reported_width}-bit keys; the trusted execution "
            f"sampled {sampled_width}-bit keys"
        )
    reported_shots = sum(normalized_reported.values())
    sampled_shots = sum(normalized_sampled.values())
    sampled_distribution = {
        key: count / sampled_shots for key, count in normalized_sampled.items() if count > 0
    }
    tvds: dict[str, float] = {}
    bins = 0
    for orientation in ("as_is", "reversed"):
        observed = {
            (key if orientation == "as_is" else key[::-1]): count / reported_shots
            for key, count in normalized_reported.items()
            if count > 0
        }
        support = set(sampled_distribution) | set(observed)
        if len(support) > max_bins:
            raise ValueError(
                f"statistical counts check supports at most {max_bins} nonzero outcomes"
            )
        bins = len(support)
        tvds[orientation] = _total_variation(sampled_distribution, observed)
    orientation_used = min(tvds, key=tvds.get)  # type: ignore[arg-type]
    tvd = tvds[orientation_used]
    threshold_source = "plan" if threshold is not None else "two_sample_shot_noise_bound"
    if threshold is None:

        def bound(shots: int) -> float:
            return math.sqrt((bins * math.log(2) + math.log(1 / delta)) / (2 * shots))

        threshold = bound(reported_shots) + bound(sampled_shots)
    protocol = {
        "name": "native_sampled_counts",
        "reported_shots": reported_shots,
        "sampled_shots": sampled_shots,
        "sampled_seed": sampled_payload.get("seed"),
        "threshold": threshold,
        "threshold_source": threshold_source,
        "delta": delta,
        "bins": bins,
        "orientation_used": orientation_used,
    }
    payload = {"protocol": protocol, "tvd": tvd, "sampled": sorted(normalized_sampled.items())}
    return EquivalenceReport(
        fingerprint_type="statistical_distribution",
        protocol=protocol,
        fingerprint_hash=hashlib.sha256(
            json.dumps(payload, sort_keys=True).encode()
        ).hexdigest(),
        passed=tvd <= threshold,
        scores={"total_variation_distance": tvd, "both_orientations": tvds},
    )
