"""Readout correction and zero-noise extrapolation, written natively.

Proposal 5, increment 4. The owner's ruling on ai-ops 361 (option 1): *"Write
both techniques directly, and use Mitiq only in tests to check that our numbers
match its numbers."* So nothing in this module imports Mitiq, and nothing that
the worker or the API imports may either — `tests/test_no_runtime_mitiq.py`
enforces that, and `scripts/mitiq_parity.py` is the only place Mitiq runs.

## What runs where

- **At submit, in the worker** (`ibm.py`): `fold_compiled` builds the 3x and 5x
  circuits for zero-noise extrapolation from the compiled circuit,
  `two_qubit_gate_count` records how many two-qubit gates each one sends, and
  `readout_calibration` snapshots the backend's reported readout errors for the
  qubits the counts will be read from. Only the first changes what is sent to
  IBM; the other two are reads.
- **At display, in the browser** (`apps/web/lib/qpu-mitigation.ts`): the
  correction and the extrapolation themselves, computed from the stored raw
  counts and the stored snapshot, the same way the measured-against-ideal reading
  is (`qpu-ideal.ts`). Mitigation is post-processing, so it never replaces
  `raw_counts`: a reader always has the unmitigated numbers beside it.
- **The Python twins below** (`readout_corrected_quasi`,
  `closest_probability_distribution`, `richardson_zero_noise`,
  `linear_zero_noise`, `extrapolate_distribution`) exist so the numbers can be
  checked against Mitiq's, which only runs in Python. They are pure Python with
  no numpy, so this module imports anywhere `majorana_qpu` does. The web copy is
  held to the same fixture (`tests/fixtures/mitigation-parity.json`), which is
  how a TypeScript number ends up compared with a Mitiq one.

Qiskit is imported lazily inside the functions that need it, like the rest of
this package: the control plane can import `majorana_qpu` without the `ibm`
extra.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

#: The noise scale factors a ZNE submission runs at, in PUB order. Scale 1 is the
#: circuit exactly as submitted; its counts are the run's `raw_counts`, unchanged
#: from a run without ZNE. 3 and 5 are the smallest odd factors global folding
#: reaches exactly (G -> G G+ G, G -> G G+ G G+ G); three points is the fewest
#: that let a quadratic Richardson fit and a linear fit disagree visibly, which
#: is how a reader can tell the extrapolation is doing real work.
ZNE_SCALE_FACTORS: tuple[int, ...] = (1, 3, 5)

#: Version of the `qpu_runs.mitigation` JSON shape (migration 0066). Bumped when a
#: reader would misread an older document; the web refuses a version it does not
#: know rather than guessing at it.
MITIGATION_RECORD_VERSION = 1


class ZneUnsupported(ValueError):
    """The circuit cannot be folded, with a reason a user can act on."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def requested_zne_record() -> dict[str, Any]:
    """The `mitigation` document a ZNE submission starts with, written by the API.

    The request is stored on the row, not in the job payload, because the worker
    reads every attested value from the row (`QpuRunJobPayload`'s docstring) and
    because the payload is `extra="forbid"`: a new payload field would be refused
    by a worker one deploy older than the API that sent it.
    """
    return {
        "version": MITIGATION_RECORD_VERSION,
        "zne": {"scale_factors": list(ZNE_SCALE_FACTORS), "folding": "global"},
    }


def zne_requested(mitigation: Mapping[str, Any] | None) -> bool:
    return isinstance(mitigation, Mapping) and isinstance(mitigation.get("zne"), Mapping)


def merged_after_submit(
    stored: Mapping[str, Any] | None, reported: Mapping[str, Any] | None
) -> dict[str, Any] | None:
    """The row's document with what submit reported added to it.

    Two sources, one per section: the user's request (`zne.scale_factors`,
    `zne.folding`) came from the API, and the calibration and gate counts came
    from the adapter. The `zne` section is merged key by key so neither erases
    the other. None when neither side has anything, so a run without mitigation
    leaves the column NULL instead of writing an empty object.
    """
    if not stored and not reported:
        return None
    merged: dict[str, Any] = {"version": MITIGATION_RECORD_VERSION}
    merged.update(dict(stored or {}))
    for key, value in dict(reported or {}).items():
        if key == "zne" and isinstance(value, Mapping):
            merged["zne"] = {**dict(merged.get("zne") or {}), **dict(value)}
        else:
            merged[key] = value
    return merged


def with_folded_counts(
    stored: Mapping[str, Any], pub_counts: Sequence[Mapping[str, int] | None] | None
) -> dict[str, Any]:
    """The document with the folded circuits' counts, or the reason they are missing.

    PUB order is ZNE_SCALE_FACTORS order, so PUB 1 is the 3x fold and PUB 2 the
    5x one. PUB 0 is not copied here: it is `raw_counts`, and keeping it in one
    place is what makes "the raw counts" mean one thing. A job that came back
    with fewer PUBs than it was sent keeps its raw counts and says the
    extrapolation could not be made, rather than extrapolating from what
    arrived.
    """
    document = {**dict(stored), "zne": dict(stored.get("zne") or {})}
    folded_scales = ZNE_SCALE_FACTORS[1:]
    folded = list(pub_counts or [])[1 : 1 + len(folded_scales)]
    # A PUB whose counts total zero is no distribution either; storing it would
    # hand every reader a division by zero (Greptile P2 on PR 970, reader side).
    if len(folded) == len(folded_scales) and all(
        counts and sum(counts.values()) > 0 for counts in folded
    ):
        document["zne"]["counts"] = {
            str(scale): dict(counts)  # type: ignore[arg-type]
            for scale, counts in zip(folded_scales, folded, strict=True)
        }
    else:
        document["zne"]["error"] = "the provider returned no counts for the folded circuits"
    return document


# ---------------------------------------------------------------------------
# Folding (runtime: changes what is sent to IBM)
# ---------------------------------------------------------------------------


def _split_terminal_measurements(circuit: Any) -> tuple[Any, list[Any]]:
    """The unitary body of `circuit` and its measurements, or ZneUnsupported.

    Global folding repeats the circuit's UNITARY, so every measurement has to be
    terminal: nothing may act on a qubit after it is measured. Such measurements
    commute to the end, which is why pulling them out and re-appending them after
    the folds leaves the circuit's meaning unchanged. Mitiq's `fold_global` makes
    the same demand for the same reason.

    Refuses rather than approximates. Resets, mid-circuit measurements, classical
    control flow and unbound parameters all mean G+ is not the inverse of what
    ran, and a fold built from a wrong inverse is a ZNE reading of a different
    circuit — which would still extrapolate to a confident number.
    """
    from qiskit.circuit import Gate

    if circuit.parameters:
        raise ZneUnsupported(
            "unbound_parameters",
            "the circuit has parameters with no value, so it cannot be repeated and undone",
        )
    body = circuit.copy_empty_like()
    measurements: list[Any] = []
    measured: set[Any] = set()
    written_bits: set[Any] = set()
    for instruction in circuit.data:
        operation = instruction.operation
        name = operation.name
        if name == "measure":
            if any(bit in written_bits for bit in instruction.clbits):
                raise ZneUnsupported(
                    "bit_measured_twice",
                    "a classical bit is measured more than once",
                )
            measured.update(instruction.qubits)
            written_bits.update(instruction.clbits)
            measurements.append(instruction)
            continue
        if name == "barrier":
            # A barrier after a qubit's measurement orders nothing that matters
            # for the fold; one before it is kept, since the submitted circuit
            # asked for it.
            if not any(qubit in measured for qubit in instruction.qubits):
                body.append(instruction)
            continue
        if not isinstance(operation, Gate):
            raise ZneUnsupported(
                "non_unitary_operation",
                f"the circuit uses '{name}', which cannot be undone by running it backwards",
            )
        if any(qubit in measured for qubit in instruction.qubits):
            raise ZneUnsupported(
                "mid_circuit_measurement",
                "a qubit is used again after it is measured; every measurement must come last",
            )
        body.append(instruction)
    if not measurements:
        raise ZneUnsupported("no_measurement", "the circuit measures nothing")
    return body, measurements


def fold_global(circuit: Any, scale_factor: int) -> Any:
    """Global unitary folding: G -> G (G+ G)^k with k = (scale_factor - 1) / 2.

    The circuit-level operation, the same one Mitiq's `fold_global` performs,
    which `scripts/mitiq_parity.py` checks on logical and on compiled circuits.
    The adapter applies it to the COMPILED circuit, through `fold_compiled`; see
    that function for why. Only odd integer factors are accepted: they are the
    ones global folding reaches exactly, and ZNE_SCALE_FACTORS uses no other kind.

    ## Why the barriers

    A barrier separates each G from the G+ next to it, so no optimiser can undo
    the fold. G G+ is by construction a run of gates that cancels to nothing, and
    `InverseCancellation` and `Optimize1qGatesDecomposition` (optimization level
    1), and commutation-aware cancellation and block re-synthesis (levels 2 and
    3), all work on runs of adjacent gates. Every one of those passes treats a
    barrier as the end of a run. The adapter runs no optimiser after folding, but
    the barriers mean that stays true if one ever does run. `tests/test_mitigation.py`
    has the control: the same fold without barriers, put through level 1,
    collapses back to the original gate count.
    """
    if not isinstance(scale_factor, int) or scale_factor < 1 or scale_factor % 2 == 0:
        raise ValueError(f"global folding needs an odd scale factor >= 1, got {scale_factor!r}")
    body, measurements = _split_terminal_measurements(circuit)
    folded = body.copy()
    inverse = body.inverse()
    for _ in range((scale_factor - 1) // 2):
        folded.barrier()
        folded.compose(inverse, inplace=True)
        folded.barrier()
        folded.compose(body, inplace=True)
    for instruction in measurements:
        folded.append(instruction)
    return folded


def fold_compiled(isa_circuit: Any, scale_factor: int, target: Any) -> Any:
    """The compiled (ISA) circuit folded to `scale_factor`, still in the
    backend's instruction set.

    ## Why fold after compilation

    Zero-noise extrapolation assumes the three circuits differ only in how many
    times the same gates run. Folding the logical circuit and compiling each copy
    breaks that as soon as the circuit needs routing. Pinning the scale-1
    layout fixes only where the qubits START. The router then inserts SWAPs into
    each longer copy independently, so their two-qubit gates can land on other
    physical pairs, with other error rates, and the "noise scale" mixes in
    pair-specific noise. Measured on FakeManilaV2 with a three-qubit triangle of
    CXs, which a line cannot embed: the logical 3x fold, compiled with the pinned
    layout, ran 5 CXs on pair (3, 2) where 3 x the scale-1 circuit's 1 would be 3,
    and the 5x fold ran 9 where it should run 5.

    Folding the compiled circuit makes that impossible by construction. G is the
    compiled circuit's unitary part, so G+ acts on exactly the same physical
    qubits, pair for pair (a CX, CZ or ECR is its own inverse on the same pair),
    and every scale runs each physical pair's gates exactly 1, 3 or 5 times as
    often. The measurements come after the folds, on the same physical qubits, so
    all three circuits are read through the same calibration too.

    ## Back into the backend's instruction set

    G+ can contain inverses the backend does not run natively (sx+ on IBM's
    machines). They are rewritten by basis translation ALONE: no layout, no
    routing, no optimisation. Translation rewrites one gate at a time on the
    qubits that gate already has, so it cannot move a gate to another pair or
    merge anything across a barrier.
    """
    from qiskit.circuit.equivalence_library import SessionEquivalenceLibrary
    from qiskit.transpiler import PassManager
    from qiskit.transpiler.passes import BasisTranslator

    folded = fold_global(isa_circuit, scale_factor)
    translate = PassManager(
        [BasisTranslator(SessionEquivalenceLibrary, target_basis=None, target=target)]
    )
    return translate.run(folded)


def ensure_foldable(circuit: Any) -> None:
    """Raise ZneUnsupported if `circuit` cannot be folded; return otherwise."""
    _split_terminal_measurements(circuit)


def zne_refusal(qasm: str) -> ZneUnsupported | None:
    """Why this OpenQASM 3 program cannot be folded, or None if it can.

    The worker asks this BEFORE it claims the submission attempt, so a circuit
    ZNE cannot handle closes its record with "nothing was sent" instead of
    spending the one attempt the record gets on a submit that was going to fail.
    """
    from qiskit import qasm3

    try:
        circuit = qasm3.loads(qasm)
    except Exception:  # noqa: BLE001 — the submit would fail on the same parse
        return ZneUnsupported("unparsable", "the circuit could not be read")
    try:
        _split_terminal_measurements(circuit)
    except ZneUnsupported as refusal:
        return refusal
    return None


def two_qubit_gate_count(circuit: Any) -> int:
    """Two-qubit gates in `circuit`, not counting barriers.

    A barrier spanning two qubits reports `num_qubits == 2`, and the folds add
    them, so counting it would inflate exactly the ratio this number exists to
    check.
    """
    return sum(
        1
        for instruction in circuit.data
        if instruction.operation.num_qubits == 2 and instruction.operation.name != "barrier"
    )


# ---------------------------------------------------------------------------
# Readout calibration snapshot (runtime: a read, taken at submit)
# ---------------------------------------------------------------------------


def _probability(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) and 0.0 <= number <= 1.0 else None


def _qubit_readout(backend: Any, properties: Any, qubit: int) -> dict[str, Any] | None:
    """One qubit's reported readout errors, asymmetric when IBM reports both.

    `prob_meas1_prep0` is P(read 1 | prepared 0) and `prob_meas0_prep1` is
    P(read 0 | prepared 1). IBM's backend properties carry both for most
    machines; when they do not, the target's single `measure` error is used for
    both directions, and `source` says which, because a symmetric figure is a
    weaker correction and a reader deserves to know which one they got.
    """
    if properties is not None:
        try:
            # `qubit_property` answers (value, date) for a named property.
            meas1_prep0 = _probability(properties.qubit_property(qubit, "prob_meas1_prep0")[0])
            meas0_prep1 = _probability(properties.qubit_property(qubit, "prob_meas0_prep1")[0])
            if meas1_prep0 is not None and meas0_prep1 is not None:
                return {
                    "prob_meas1_prep0": meas1_prep0,
                    "prob_meas0_prep1": meas0_prep1,
                    "source": "backend_properties",
                }
        except Exception:  # noqa: BLE001 — fall through to the target's figure
            pass
    try:
        symmetric = _probability(backend.target["measure"][(qubit,)].error)
    except Exception:  # noqa: BLE001
        symmetric = None
    if symmetric is None:
        return None
    return {
        "prob_meas1_prep0": symmetric,
        "prob_meas0_prep1": symmetric,
        "source": "target_measure_error",
    }


def readout_calibration(isa_circuit: Any, backend: Any) -> dict[str, Any] | None:
    """For each bit of the counted register: the physical qubit it was read from,
    and that qubit's reported readout errors at submit time. None if any part of
    that cannot be established.

    **Never raises.** It runs on the submit path before the job is sent, and a
    calibration read that failed must cost the reader a correction, never cost
    the user their submission. Every failure, including a backend that reports
    nothing, is None, and the web then says the correction is unavailable.

    ## Which register

    The counted register is the circuit's first classical register, because that
    is the one `ibm._register_counts` reads: SamplerV2's DataBin lists registers
    in the circuit's order and the adapter takes the first. Every bit of it must
    be written by exactly one measurement; a bit never measured has no qubit to
    correct for, and a bit measured twice has two.

    ## Why the ISA circuit

    The transpiled circuit is the only place the logical-to-physical mapping is
    final: layout and routing both move qubits, so the qubit a bit was read from
    is only known after them. A calibration keyed on logical qubit indices would
    correct each bit with some other qubit's error rate.
    """
    try:
        if not isa_circuit.cregs:
            return None
        register = isa_circuit.cregs[0]
        qubit_for_bit: dict[int, int] = {}
        for instruction in isa_circuit.data:
            if instruction.operation.name != "measure":
                continue
            qubit = isa_circuit.find_bit(instruction.qubits[0]).index
            for owner, index in isa_circuit.find_bit(instruction.clbits[0]).registers:
                if owner != register:
                    continue
                if index in qubit_for_bit:
                    return None
                qubit_for_bit[index] = qubit
        if sorted(qubit_for_bit) != list(range(register.size)):
            return None
        try:
            properties = backend.properties()
        except Exception:  # noqa: BLE001 — the target still has a figure
            properties = None
        bits = []
        for clbit in range(register.size):
            qubit = qubit_for_bit[clbit]
            readout = _qubit_readout(backend, properties, qubit)
            if readout is None:
                return None
            bits.append({"clbit": clbit, "qubit": qubit, **readout})
        calibrated_at = None
        if properties is not None:
            stamp = getattr(properties, "last_update_date", None)
            calibrated_at = stamp.isoformat() if hasattr(stamp, "isoformat") else None
        return {"register": str(register.name), "calibrated_at": calibrated_at, "bits": bits}
    except Exception:  # noqa: BLE001 — a snapshot is optional; the submission is not
        return None


# ---------------------------------------------------------------------------
# Post-processing twins (checked against Mitiq; the web computes these for display)
# ---------------------------------------------------------------------------


def _inverse_confusion(meas1_prep0: float, meas0_prep1: float) -> tuple[float, float, float, float]:
    """Inverse of one qubit's confusion matrix A, as (m00, m01, m10, m11).

    A's columns are the prepared state and its rows the reading:
    A = [[1 - p(1|0), p(0|1)], [p(1|0), 1 - p(0|1)]]. Its inverse exists whenever
    p(1|0) + p(0|1) != 1; both are required below 0.5, since a qubit that reads
    wrong more often than right has no correction worth applying.
    """
    if not (0.0 <= meas1_prep0 < 0.5 and 0.0 <= meas0_prep1 < 0.5):
        raise ValueError("readout error rates must be in [0, 0.5)")
    det = 1.0 - meas1_prep0 - meas0_prep1
    return (
        (1.0 - meas0_prep1) / det,
        -meas0_prep1 / det,
        -meas1_prep0 / det,
        (1.0 - meas1_prep0) / det,
    )


def _dense_distribution(counts: Mapping[str, int], width: int) -> list[float]:
    shots = sum(counts.values())
    if shots <= 0:
        raise ValueError("counts are empty")
    vector = [0.0] * (1 << width)
    for key, count in counts.items():
        if len(key) != width or any(char not in "01" for char in key):
            raise ValueError(f"counts key {key!r} is not a {width}-bit string")
        vector[int(key, 2)] += count / shots
    return vector


def readout_corrected_quasi(
    counts: Mapping[str, int], bits: Sequence[Mapping[str, Any]]
) -> list[float]:
    """The measured distribution with the tensor product of per-qubit inverse
    confusion matrices applied: a quasi-distribution, indexed like Qiskit's
    counts keys read as binary (classical bit 0 is the least significant bit).

    Applied one bit at a time rather than by building the 2^n x 2^n matrix. The
    inverse of a tensor product is the tensor product of the inverses, so the
    two are the same map; the per-bit form costs n * 2^n instead of 4^n and is
    what the browser has to do anyway.

    Entries can be negative, and it still sums to 1 (each inverse has columns
    that sum to 1). `closest_probability_distribution` turns it into
    probabilities.
    """
    width = len(bits)
    vector = _dense_distribution(counts, width)
    for bit in bits:
        clbit = int(bit["clbit"])
        m00, m01, m10, m11 = _inverse_confusion(
            float(bit["prob_meas1_prep0"]), float(bit["prob_meas0_prep1"])
        )
        stride = 1 << clbit
        for index in range(len(vector)):
            if index & stride:
                continue
            zero, one = vector[index], vector[index | stride]
            vector[index] = m00 * zero + m01 * one
            vector[index | stride] = m10 * zero + m11 * one
    return vector


def closest_probability_distribution(quasi: Sequence[float]) -> list[float]:
    """The probability distribution nearest to `quasi` in Euclidean distance.

    Smolin, Gambetta and Smith, "Efficient method for computing the
    maximum-likelihood quantum state from measurements with additive Gaussian
    noise", Phys. Rev. Lett. 108, 070502 (2012), the algorithm in their Fig. 1:
    sort descending, then walk up from the smallest entry, zeroing each one whose
    value plus its share of the mass removed so far is still negative, and
    spread that removed mass equally over the entries that remain. For an input
    that sums to 1 this is the exact Euclidean projection onto the probability
    simplex, found in one sort.

    Mitiq's `closest_positive_distribution` minimises the same Euclidean
    distance numerically (scipy SLSQP), so the two agree to the optimiser's
    tolerance; `scripts/mitiq_parity.py` measures by how much.
    """
    size = len(quasi)
    order = sorted(range(size), key=lambda index: quasi[index], reverse=True)
    result = [0.0] * size
    removed = 0.0
    remaining = size
    while remaining > 0 and quasi[order[remaining - 1]] + removed / remaining < 0:
        removed += quasi[order[remaining - 1]]
        remaining -= 1
    for position in range(remaining):
        result[order[position]] = quasi[order[position]] + removed / remaining
    return result


def richardson_zero_noise(scales: Sequence[float], values: Sequence[float]) -> float:
    """Richardson extrapolation to scale 0: the polynomial of degree len-1 through
    every point, evaluated at zero, in its Lagrange form. For scales 1, 3, 5 the
    weights are 15/8, -5/4 and 3/8. They sum to 1, and the large alternating
    weights are why it can overshoot: noise in the scale-1 value is multiplied by
    nearly two."""
    if len(scales) != len(values) or len(scales) < 2:
        raise ValueError("richardson needs matching scales and values, at least two")
    total = 0.0
    for i, (scale_i, value_i) in enumerate(zip(scales, values, strict=True)):
        weight = 1.0
        for j, scale_j in enumerate(scales):
            if j != i:
                weight *= scale_j / (scale_j - scale_i)
        total += weight * value_i
    return total


def linear_zero_noise(scales: Sequence[float], values: Sequence[float]) -> float:
    """The intercept of the least-squares straight line through the points."""
    if len(scales) != len(values) or len(scales) < 2:
        raise ValueError("a linear fit needs matching scales and values, at least two")
    count = len(scales)
    mean_scale = sum(scales) / count
    mean_value = sum(values) / count
    spread = sum((scale - mean_scale) ** 2 for scale in scales)
    slope = (
        sum(
            (scale - mean_scale) * (value - mean_value)
            for scale, value in zip(scales, values, strict=True)
        )
        / spread
    )
    return mean_value - slope * mean_scale


def extrapolate_distribution(
    counts_by_scale: Sequence[tuple[float, Mapping[str, int]]],
    method: str,
) -> dict[str, Any]:
    """Each outcome's probability extrapolated to zero noise, then clipped at 0
    and renormalised.

    Returns the distribution and `clipped_mass`, the total probability the
    extrapolation put below zero before clipping. A nonzero value is the
    extrapolation overshooting, and the UI says so rather than hiding it inside
    a renormalised number.
    """
    extrapolate = {"richardson": richardson_zero_noise, "linear": linear_zero_noise}[method]
    scales = [scale for scale, _ in counts_by_scale]
    shares: list[dict[str, float]] = []
    for _, counts in counts_by_scale:
        shots = sum(counts.values())
        if shots <= 0:
            raise ValueError("a scale has no counts")
        shares.append({key: count / shots for key, count in counts.items()})
    outcomes = sorted({key for share in shares for key in share})
    raw = {key: extrapolate(scales, [share.get(key, 0.0) for share in shares]) for key in outcomes}
    clipped_mass = -sum(value for value in raw.values() if value < 0)
    kept = {key: max(value, 0.0) for key, value in raw.items()}
    total = sum(kept.values())
    if total <= 0:
        raise ValueError("the extrapolation left no probability to renormalise")
    return {
        "distribution": {key: value / total for key, value in kept.items()},
        "clipped_mass": clipped_mass,
    }
