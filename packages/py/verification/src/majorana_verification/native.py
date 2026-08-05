"""Framework-native verification evidence, judged on arrays.

plans/archive/framework-native-verification.md (archived 2026-08-04 as shipped — this
module is the implementation it names): the selected framework's own SDK — inside
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
evidence about the pipeline, and the verifier fails closed on it. The one
exception is an empty measurement map on the native statevector snapshot: an
artifact whose measurement_policy is `none` (VQE/QAOA-style — the published
FINAL_CIRCUIT is deliberately the unmeasured ansatz) legitimately has zero
measurements on the circuit this evidence was captured from, even when RESULT
separately reports `counts` sampled from a different, explicitly measured
circuit variant the plan allows for reporting purposes. That is not malformed
evidence about the pipeline; it is evidence that this particular check cannot
apply to a circuit that was never measured. See NoNativeMeasurementEvidence.
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
    simulate_statevector_matching_width,
)

# Mirrors the observers' _MAJORANA_NATIVE_SV_QUBITS; packages/py/frameworks tests
# pin the two against drift. 12 leaves headroom over the exporters' 10 so a limit
# bump there fails the pin test rather than silently rejecting valid evidence.
NATIVE_STATEVECTOR_MAX_QUBITS = 12
ENTANGLED_STATE_TOLERANCE = 1e-9

_ENDIANNESS = ("q0_lsb", "q0_msb")


class NoNativeMeasurementEvidence(ValueError):
    """The native statevector snapshot has zero measurements to compare against.

    Distinct from other malformed-evidence ValueErrors here (still a FAIL): this
    one fires exactly when the circuit this evidence was captured from was never
    measured at all, which is the correct, intended shape for a measurement_policy
    `none` artifact (see module docstring). The caller should read this as
    SKIPPED/UNAVAILABLE — a capability gap, not a candidate defect — never FAIL.
    """


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
        raise ValueError(f"native statevector amplitudes must be {expected_length} finite floats")
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


def entangled_state_property(
    payload: Any,
    *,
    state_name: str,
    expected_qubits: int,
    relative_phase_radians: float = 0.0,
) -> EquivalenceReport:
    """Check an explicitly accepted Bell/GHZ phase target and readout ordering.

    This fixed-policy check proves more than computational-basis counts: it
    compares the full framework-native statevector with
    ``(|0...0> + exp(i*phi)|1...1>) / sqrt(2)`` up to one global phase. The
    caller obtains ``phi`` from a typed Plan claim that semantic review accepted;
    this function never infers it from a broad algorithm label.

    When measurements are present, the classical-to-quantum mapping must be the
    canonical identity mapping. With no measurements the state-preparation claim
    remains judgeable; result/count correctness is a separate statistical claim.
    """
    if state_name not in {"bell", "ghz"}:
        raise ValueError(f"unsupported entangled state property: {state_name!r}")
    if not math.isfinite(relative_phase_radians):
        raise ValueError("entangled state relative phase must be finite")
    statevector, mapping, qubits, clbits = statevector_from_evidence(payload)
    expected_mapping = {index: index for index in range(expected_qubits)}
    mapping_ok = (clbits == 0 and not mapping) or (
        clbits == expected_qubits and mapping == expected_mapping
    )
    width_ok = qubits == expected_qubits

    distance: float | None = None
    relative_phase: float | None = None
    endpoint_populations: dict[str, float] = {}
    if width_ok:
        target = np.zeros(1 << expected_qubits, dtype=complex)
        target[0] = 1 / math.sqrt(2)
        target[-1] = np.exp(1j * relative_phase_radians) / math.sqrt(2)
        vector = np.asarray(statevector.data)
        distance = _phase_align_distance(vector, target)
        endpoint_populations = {
            "zero": float(abs(vector[0]) ** 2),
            "one": float(abs(vector[-1]) ** 2),
            "outside": float(np.sum(np.abs(vector[1:-1]) ** 2)),
        }
        if abs(vector[0]) > ENTANGLED_STATE_TOLERANCE and abs(vector[-1]) > 0:
            relative_phase = float(np.angle(vector[-1] / vector[0]))

    protocol = {
        "name": f"{state_name}_state_property",
        "target": "typed_relative_phase_cat_state",
        "relative_phase_radians": relative_phase_radians,
        "tolerance": ENTANGLED_STATE_TOLERANCE,
        "expected_qubits": expected_qubits,
        "measurement_binding": "identity_when_present",
    }
    scores = {
        "max_abs_distance": distance,
        "relative_phase_radians": relative_phase,
        "endpoint_populations": endpoint_populations,
        "observed_qubits": qubits,
        "measurement_map": {str(key): value for key, value in mapping.items()},
        "measurement_order_ok": mapping_ok,
    }
    vector_payload = [
        [float(value.real), float(value.imag)] for value in np.asarray(statevector.data)
    ]
    fingerprint_payload = {
        "statevector": vector_payload,
        "measurement_map": scores["measurement_map"],
        "protocol": protocol,
    }
    return EquivalenceReport(
        fingerprint_type="exact_unitary",
        protocol=protocol,
        fingerprint_hash=hashlib.sha256(
            json.dumps(fingerprint_payload, sort_keys=True).encode()
        ).hexdigest(),
        passed=bool(
            width_ok
            and mapping_ok
            and distance is not None
            and distance <= ENTANGLED_STATE_TOLERANCE
        ),
        scores=scores,
    )


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
        raise NoNativeMeasurementEvidence(
            "native statevector evidence records no measurements to compare"
        )
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
    candidate, _mapping, qubits, _clbits = statevector_from_evidence(payload)
    # Provably idle reference wires are removed to meet the candidate's width —
    # cirq's `all_qubits` holds only touched qubits, so a correct candidate can be
    # narrower than the reference the planner declared (run 019f7ead-ead6). The
    # guard lives in statevector.py and is shared with the OpenQASM `exact` path.
    reference, removed_idle = simulate_statevector_matching_width(reference_qasm, qubits)
    candidate_vector = np.asarray(candidate.data)
    scores: dict
    if len(reference) != len(candidate_vector):
        # JSON-safe (same rule as exact_equivalence): a non-finite float in the
        # evidence dead-letters the job at the JSONB boundary. A width mismatch
        # is a plain FAIL with its reason.
        distance = None
        passed = False
        scores = {"max_abs_distance": None, "qubit_count_mismatch": True}
    else:
        distance = _phase_align_distance(reference, candidate_vector)
        passed = distance <= tolerance
        scores = {"max_abs_distance": distance}
        if removed_idle:
            scores["reference_idle_qubits_removed"] = removed_idle
    protocol = {
        "name": "exact_statevector",
        "tolerance": tolerance,
        "qubits": qubits,
        "scope": "action on the all-zero state, not full unitary equivalence",
    }
    payload_hash = {
        "reference": reference_qasm,
        "protocol": protocol,
        "distance": distance,
    }
    return EquivalenceReport(
        fingerprint_type="exact_unitary",
        protocol=protocol,
        fingerprint_hash=hashlib.sha256(
            json.dumps(payload_hash, sort_keys=True).encode()
        ).hexdigest(),
        passed=passed,
        scores=scores,
    )


# How many outcomes a failure diagnostic may carry into the repair evidence. The
# check itself allows 256; the whole point of the diagnostic is to be READ.
_DIAGNOSTIC_OUTCOMES = 16


def _largest_outcomes(distribution: dict[str, float]) -> dict[str, float]:
    """The heaviest outcomes, keyed for a human (and a model) to read."""
    ranked = sorted(distribution.items(), key=lambda item: (-item[1], item[0]))
    return {key: value for key, value in ranked[:_DIAGNOSTIC_OUTCOMES]}


def _sampled_registers(payload: dict, sampled_width: int) -> list[tuple[str, int]]:
    """The (name, width) registers of the trusted sample, in key-reading order.

    Qiskit's ``get_counts`` separates classical registers with spaces and prints
    the last-declared register first, so the exported list reads left to right the
    way the key does. Anything malformed — not a list, wrong shape, widths that do
    not tile the sampled key — returns empty, which leaves the caller's width
    mismatch a plain FAIL. Frameworks with no register concept export no list.
    """
    raw = payload.get("registers")
    if not isinstance(raw, list) or not raw:
        return []
    registers: list[tuple[str, int]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            return []
        name = entry.get("name")
        width = entry.get("width")
        if not isinstance(name, str) or not name or type(width) is not int or width <= 0:
            return []
        registers.append((name, width))
    if sum(width for _name, width in registers) != sampled_width:
        return []
    return registers


def _marginalize_onto_register(
    counts: dict[str, int], registers: list[tuple[str, int]], index: int
) -> dict[str, int]:
    """Sum the trusted counts over every bit outside register ``index``."""
    start = sum(width for _name, width in registers[:index])
    stop = start + registers[index][1]
    marginal: dict[str, int] = {}
    for key, count in counts.items():
        bits = key[start:stop]
        marginal[bits] = marginal.get(bits, 0) + count
    return marginal


def _register_clbits(registers: list[tuple[str, int]], index: int) -> list[int]:
    """The clbit indices register ``index`` owns.

    The exported list reads left to right the way the counts key does, which is
    Qiskit's LAST-declared register first — and clbit 0 belongs to the FIRST
    declared. So the offsets accumulate from the end of the list backwards.
    """
    offset = sum(width for _name, width in registers[index + 1 :])
    return list(range(offset, offset + registers[index][1]))


def _unwritten_register(payload: dict, registers: list[tuple[str, int]], index: int) -> dict | None:
    """Name the register no measurement writes to, when that is what went wrong.

    Returns None unless the observer reported which clbits its measurements write
    AND the matched register owns none of them. Accusing wrongly is worse than
    staying quiet: it would send the repair loop after a bug that is not there,
    so absent or malformed evidence produces silence, not a guess.
    """
    measured = payload.get("measured_clbits")
    if not isinstance(measured, list) or not all(type(value) is int for value in measured):
        return None
    clbits = _register_clbits(registers, index)
    if set(clbits) & set(measured):
        return None
    name = registers[index][0]
    return {
        "register": name,
        "clbits": clbits,
        "measured_clbits": sorted(measured),
        "diagnosis": (
            f"the reported counts were matched to register '{name}' (clbits "
            f"{clbits}), but no measurement writes to it — every measurement in "
            f"the circuit writes to clbits {sorted(measured)}. A measurement "
            f"intended for '{name}' is landing in a different register: pass the "
            f"register's own bit (e.g. measure(qubit, {name}[0])) rather than a "
            f"bare clbit index."
        ),
    }


def _slice_owner(registers: list[tuple[str, int]], width: int, start: int, stop: int) -> int | None:
    """The register index a key slice lies wholly inside, or None if it straddles.

    Slices are positions in the counts key (leftmost character first); clbits run
    the other way, so clbit index = width - 1 - position.
    """
    for index in range(len(registers)):
        clbits = _register_clbits(registers, index)
        positions = {width - 1 - clbit for clbit in clbits}
        if set(range(start, stop)) <= positions:
            return index
    return None


def _report_matches_another_register(
    counts: dict[str, int],
    registers: list[tuple[str, int]],
    used_index: int,
    reported: dict[str, float],
    width: int,
    reported_width: int,
    threshold: float,
) -> dict | None:
    """Name the register the reported counts ACTUALLY match, when one does.

    Scans the key's contiguous slices for an EXPLANATION, never for a verdict —
    the check has already failed and this cannot change that. Scanning for a
    passing interpretation is what the register marginalization deliberately
    refuses to do; scanning for the reason it failed is free.

    Silent unless every matching slice sits inside ONE register that is not the
    one the width matched. Matches spread over several registers, or none at all,
    mean there is nothing confident to say.
    """
    owners: set[int] = set()
    clbits: set[int] = set()
    for start in range(0, width - reported_width + 1):
        owner = _slice_owner(registers, width, start, start + reported_width)
        if owner is None or owner == used_index:
            continue
        marginal: dict[str, int] = {}
        for key, count in counts.items():
            bits = key[start : start + reported_width]
            marginal[bits] = marginal.get(bits, 0) + count
        shots = sum(marginal.values())
        distribution = {key: count / shots for key, count in marginal.items() if count > 0}
        best = min(
            _total_variation(distribution, reported),
            _total_variation(distribution, {key[::-1]: value for key, value in reported.items()}),
        )
        if best <= threshold:
            owners.add(owner)
            clbits.update(width - 1 - position for position in range(start, start + reported_width))
    if len(owners) != 1:
        return None
    name = registers[owners.pop()][0]
    return {
        "register": name,
        "clbits": sorted(clbits),
        "diagnosis": (
            f"the reported counts do not match the register they were width-matched "
            f"to, but they DO match register '{name}' (clbits {sorted(clbits)}). The "
            f"measurement is in the right place and the readout is not: check which "
            f"characters of the counts key you slice — Qiskit separates registers "
            f"with a space and prints the last-declared register first, so the "
            f"last character is the FIRST-declared register's low bit."
        ),
    }


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
    An explicit Plan threshold may tighten the fixed bound but never loosen it.
    """
    if not isinstance(sampled_payload, dict):
        raise ValueError("native sampled evidence is not a mapping")
    sampled_counts = sampled_payload.get("counts")
    if not isinstance(sampled_counts, dict) or not sampled_counts:
        raise ValueError("native sampled evidence carries no counts")
    normalized_reported, reported_width = normalize_reported_counts(reported)
    normalized_sampled, sampled_width = normalize_reported_counts(sampled_counts)
    register_used: tuple[str, int] | None = None
    unwritten_register: dict | None = None
    full_width_sampled: tuple[dict[str, int], list[tuple[str, int]], int, int] | None = None
    if reported_width != sampled_width:
        # Register-guided marginalization, never subset-scanning: reporting a
        # marginal over one classical register is a legitimate convention (the
        # task asks for "the counts of the teleported qubit"), so when the
        # reported width matches exactly ONE register the trusted counts are
        # marginalized onto it. Zero or several matches stay a FAIL — ambiguity
        # must not become absolution, and scanning bit subsets for one that
        # agrees would manufacture passes.
        registers = _sampled_registers(sampled_payload, sampled_width)
        matches = [index for index, (_n, width) in enumerate(registers) if width == reported_width]
        if len(matches) != 1:
            detail = f"; it matches {len(matches)} registers" if len(matches) > 1 else ""
            raise ValueError(
                f"reported counts have {reported_width}-bit keys; the trusted execution "
                f"sampled {sampled_width}-bit keys{detail}"
            )
        index = matches[0]
        register_used = registers[index]
        unwritten_register = _unwritten_register(sampled_payload, registers, index)
        full_width_sampled = (normalized_sampled, registers, index, sampled_width)
        normalized_sampled = _marginalize_onto_register(normalized_sampled, registers, index)
    reported_shots = sum(normalized_reported.values())
    sampled_shots = sum(normalized_sampled.values())
    sampled_distribution = {
        key: count / sampled_shots for key, count in normalized_sampled.items() if count > 0
    }
    tvds: dict[str, float] = {}
    bins_by_orientation: dict[str, int] = {}
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
        bins_by_orientation[orientation] = len(support)
        tvds[orientation] = _total_variation(sampled_distribution, observed)
    orientation_used = min(tvds, key=tvds.get)  # type: ignore[arg-type]
    tvd = tvds[orientation_used]
    # Same rule as compare_counts_to_ideal: the bound uses the SELECTED
    # orientation's support size, not whichever the loop saw last.
    bins = bins_by_orientation[orientation_used]

    def bound(shots: int) -> float:
        return math.sqrt((bins * math.log(2) + math.log(1 / delta)) / (2 * shots))

    policy_threshold = bound(reported_shots) + bound(sampled_shots)
    declared_threshold = threshold
    threshold = (
        policy_threshold
        if declared_threshold is None
        else min(policy_threshold, declared_threshold)
    )
    threshold_source = (
        "plan_tightened"
        if declared_threshold is not None and declared_threshold < policy_threshold
        else "two_sample_shot_noise_bound"
    )
    protocol = {
        "name": "native_sampled_counts",
        "reported_shots": reported_shots,
        "sampled_shots": sampled_shots,
        "sampled_seed": sampled_payload.get("seed"),
        "threshold": threshold,
        "threshold_source": threshold_source,
        "declared_threshold": declared_threshold,
        "policy_threshold": policy_threshold,
        "delta": delta,
        "bins": bins,
        "orientation_used": orientation_used,
    }
    if register_used is not None:
        # Only present when marginalization actually happened, so the fingerprint
        # of a full-width comparison is unchanged by this fix.
        protocol["register_used"] = register_used[0]
        protocol["register_width"] = register_used[1]
    payload = {"protocol": protocol, "tvd": tvd, "sampled": sorted(normalized_sampled.items())}
    passed = tvd <= threshold
    scores: dict = {"total_variation_distance": tvd, "both_orientations": tvds}
    if not passed:
        # A number cannot teach. Production run 019f7ecf-a56c: the model wrote
        # `measure(2, 0)`, putting Bob's qubit into Alice's register, so `c_bob`
        # was never written — and all this check said was "TVD 0.1255 > 0.0900".
        # Three candidates repeated the mistake and the budget was gone. The two
        # distributions name it: `c_bob` stuck at 0 against a reported 0.88/0.12.
        # Only on failure, and bounded, so passing evidence stays lean and the
        # repair payload cannot balloon to the check's 256-outcome ceiling.
        reported_distribution = {
            key: count / reported_shots for key, count in normalized_reported.items() if count > 0
        }
        scores["trusted_distribution"] = _largest_outcomes(sampled_distribution)
        scores["reported_distribution"] = _largest_outcomes(reported_distribution)
        if max(len(sampled_distribution), len(reported_distribution)) > _DIAGNOSTIC_OUTCOMES:
            scores["distributions_truncated"] = True
        if unwritten_register is not None:
            # Two prompt-level attempts is this codebase's limit; after that,
            # mechanism. Seven candidates across runs 019f7ea0-8017,
            # 019f7ecf-a56c and 019f7ed9-ac0c wrote `measure(2, 0)` into the
            # wrong register — four of them AFTER the distributions above were
            # added to the evidence. A distribution shows the symptom; this
            # names the cause.
            scores["register_never_measured"] = unwritten_register
        if full_width_sampled is not None:
            # Run 019f7ee3-6e7c candidate 3: the model took #117's advice, moved
            # its measurement into `c_bob` — and then failed anyway, because the
            # paired readout bug slices `bitstring[-1]`, which is c_alice's low
            # bit. The measurement was in the right place and the readout was
            # not, and only naming the register the report DOES match says so.
            counts, registers_seen, used, width = full_width_sampled
            matched = _report_matches_another_register(
                counts,
                registers_seen,
                used,
                reported_distribution,
                width,
                reported_width,
                threshold,
            )
            if matched is not None:
                scores["report_matches_another_register"] = matched
    return EquivalenceReport(
        fingerprint_type="statistical_distribution",
        protocol=protocol,
        fingerprint_hash=hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest(),
        passed=passed,
        scores=scores,
    )
