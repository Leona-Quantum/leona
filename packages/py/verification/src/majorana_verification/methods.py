"""Verification primitives mapped to the contracts taxonomy
(VerificationMethod × VerificationResultKind). Each returns a VerificationOutcome
that a verify-stage handler turns into a verification.result event and a
VerificationRecord row. None of these fabricate: a check that cannot run returns
FAIL with the reason, never a silent PASS."""

from __future__ import annotations

import math
from typing import Any

from majorana_contracts.enums import VerificationMethod, VerificationResultKind
from majorana_openqasm import OpenQASMError, normalize, resource_metrics
from pydantic import BaseModel, Field

from majorana_baselines import (
    BaselineInstance,
    CapError,
    compute_quantum_gap,
    solve,
)
from majorana_verification.statevector import (
    EquivalenceReport,
    counts_vs_ideal,
    exact_equivalence,
    statistical_equivalence,
)

PASS = VerificationResultKind.PASS
FAIL = VerificationResultKind.FAIL


class VerificationOutcome(BaseModel):
    method: VerificationMethod
    result: VerificationResultKind
    details: dict[str, Any] = Field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return self.result is PASS


def _from_report(method: VerificationMethod, report: EquivalenceReport) -> VerificationOutcome:
    return VerificationOutcome(
        method=method,
        result=PASS if report.passed else FAIL,
        details={
            "protocol": report.protocol,
            "fingerprint_hash": report.fingerprint_hash,
            "scores": report.scores,
        },
    )


def verify_exact(
    reference: str, candidate: str, tolerance: float = 1e-9, max_qubits: int = 6
) -> VerificationOutcome:
    """Exact unitary equivalence (phase-aligned) for small circuits."""
    try:
        report = exact_equivalence(reference, candidate, tolerance=tolerance, max_qubits=max_qubits)
    except ValueError as exc:
        return VerificationOutcome(
            method=VerificationMethod.EXACT, result=FAIL, details={"error": str(exc)}
        )
    return _from_report(VerificationMethod.EXACT, report)


def verify_statistical(
    reference: str,
    candidate: str,
    shots: int = 4096,
    seed: int = 1234,
    threshold: float = 0.05,
) -> VerificationOutcome:
    """Seeded sampled-distribution equivalence (total-variation distance)."""
    try:
        report = statistical_equivalence(
            reference, candidate, shots=shots, seed=seed, threshold=threshold
        )
    except (OpenQASMError, ValueError) as exc:
        return VerificationOutcome(
            method=VerificationMethod.STATISTICAL, result=FAIL, details={"error": str(exc)}
        )
    return _from_report(VerificationMethod.STATISTICAL, report)


def verify_statistical_counts(
    qasm: str,
    counts: dict[str, int],
    threshold: float | None = None,
    bit_order: str = "auto",
) -> VerificationOutcome:
    """Statistical verification without a reference circuit: the emitted circuit
    is simulated through an independent statevector path and the run's reported counts
    are tested against the exact Born distribution (TVD vs a finite-shot
    concentration bound — see statevector.counts_vs_ideal). This is the headless
    `statistical` path: direct-simulation evidence, not circuit-vs-circuit
    equivalence."""
    try:
        report = counts_vs_ideal(qasm, counts, threshold=threshold, bit_order=bit_order)  # type: ignore[arg-type]
    except ValueError as exc:
        return VerificationOutcome(
            method=VerificationMethod.STATISTICAL, result=FAIL, details={"error": str(exc)}
        )
    outcome = _from_report(VerificationMethod.STATISTICAL, report)
    outcome.details["evidence"] = "direct_simulation_vs_reported_counts"
    return outcome


def verify_statistical_counts_pair(
    first: dict[str, int],
    second: dict[str, int],
    threshold: float | None = None,
) -> VerificationOutcome:
    """Compare two native executions of the selected-framework program.

    This check intentionally does not reconstruct the circuit through OpenQASM.  It
    measures reproducibility of the framework code that will be returned to the user.
    Problem-specific correctness still comes from exact-diagonalization, brute-force,
    return-contract, and other independent checks selected by the plan.
    """
    first_total = sum(first.values())
    second_total = sum(second.values())
    if first_total <= 0 or second_total <= 0:
        return VerificationOutcome(
            method=VerificationMethod.STATISTICAL,
            result=FAIL,
            details={"error": "both executions must contain at least one shot"},
        )
    keys = set(first) | set(second)
    tvd = 0.5 * sum(
        abs(first.get(key, 0) / first_total - second.get(key, 0) / second_total) for key in keys
    )
    limit = 0.05 if threshold is None else threshold
    return VerificationOutcome(
        method=VerificationMethod.STATISTICAL,
        result=PASS if tvd <= limit else FAIL,
        details={
            "evidence": "selected_framework_reexecution",
            "total_variation_distance": tvd,
            "threshold": limit,
            "first_shots": first_total,
            "second_shots": second_total,
        },
    )


_COUNTS_FALLBACK_KEYS = ("counts", "measurement_counts", "results", "samples")


def extract_counts(
    result: dict[str, Any], preferred_keys: list[str] | None = None
) -> dict[str, int] | None:
    """Find a measurement-counts dict in the run's result: plan-promised keys
    first, then conventional names, then any top-level value shaped like
    {bitstring: count}. Returns None when the result carries no counts."""

    def _counts_shaped(value: Any) -> bool:
        if not isinstance(value, dict) or not value:
            return False
        for key, count in value.items():
            bits = str(key).replace(" ", "")
            if not bits or set(bits) - {"0", "1"}:
                return False
            # Integral values only (5.0 ok, 1.9/NaN/negatives are not counts) —
            # truncating would verify different data than the run reported.
            if (
                isinstance(count, bool)
                or not isinstance(count, int | float)
                or not math.isfinite(count)
                or count != int(count)
                or count < 0
            ):
                return False
        return True

    for key in [*(preferred_keys or []), *_COUNTS_FALLBACK_KEYS]:
        if _counts_shaped(result.get(key)):
            return {k: int(v) for k, v in result[key].items()}
    for value in result.values():
        if _counts_shaped(value):
            return {k: int(v) for k, v in value.items()}
    return None


def verify_return_contract(
    result: dict[str, Any],
    expected_keys: list[str],
    expected_return_type: str | None = None,
) -> VerificationOutcome:
    """Structural check of the executed code's result dict against the plan's
    artifact contract — the keys it promised to print, and (optionally) the
    top-level return type. No numeric claim is trusted here; that's the other
    methods' job."""
    missing = [key for key in expected_keys if key not in result]
    details: dict[str, Any] = {"expected_keys": expected_keys, "missing_keys": missing}
    if expected_return_type:
        actual = type(result).__name__
        details["expected_return_type"] = expected_return_type
        details["actual_return_type"] = actual
    ok = not missing
    return VerificationOutcome(
        method=VerificationMethod.RETURN_CONTRACT,
        result=PASS if ok else FAIL,
        details=details,
    )


def verify_qasm_parse(qasm: str) -> VerificationOutcome:
    """Parse and normalize an emitted OpenQASM 2/3 program."""
    try:
        canonical = normalize(qasm)
        metrics = resource_metrics(canonical)
    except OpenQASMError as exc:
        return VerificationOutcome(
            method=VerificationMethod.QASM_PARSE, result=FAIL, details={"parse_error": str(exc)}
        )
    return VerificationOutcome(
        method=VerificationMethod.QASM_PARSE,
        result=PASS,
        details={
            "qasm_version": "3.0",
            "qubits": metrics.qubits,
            "operations": (metrics.gate_count or 0) + (metrics.measurement_count or 0),
            "normalized_bytes": len(canonical.encode("utf-8")),
        },
    )


def verify_exact_diag(
    instance: BaselineInstance,
    claimed_energy: float,
    tolerance: float = 1.6e-3,
) -> VerificationOutcome:
    """Exact-diagonalization reference for a claimed ground-state energy (VQE).
    Default tolerance is chemical accuracy (1.6e-3 Ha, JC-4)."""
    try:
        solution = solve(instance)
    except CapError as exc:
        return VerificationOutcome(
            method=VerificationMethod.EXACT_DIAG, result=FAIL, details={"error": str(exc)}
        )
    error = abs(claimed_energy - solution.baseline_value)
    return VerificationOutcome(
        method=VerificationMethod.EXACT_DIAG,
        result=PASS if error <= tolerance else FAIL,
        details={
            "reference_energy": solution.baseline_value,
            "claimed_energy": claimed_energy,
            "absolute_error": error,
            "tolerance": tolerance,
        },
    )


def verify_brute_force(
    instance: BaselineInstance,
    claimed_value: float,
    tolerance: float = 1e-9,
) -> VerificationOutcome:
    """Brute-force optimum for a claimed optimization value. Passes when the
    claimed value matches the classical optimum (within tolerance) and does not
    beat it in the wrong direction."""
    try:
        solution = solve(instance)
    except CapError as exc:
        return VerificationOutcome(
            method=VerificationMethod.BRUTE_FORCE, result=FAIL, details={"error": str(exc)}
        )
    gap = compute_quantum_gap(instance.kind, solution.baseline_value, claimed_value)
    # A claimed value that "beats" the exact optimum is impossible → fabricated.
    matches = abs(gap.gap_vs_quantum) <= tolerance
    impossible = (
        gap.gap_vs_quantum > tolerance
        if instance.kind == "maxcut"
        else (gap.gap_vs_quantum < -tolerance)
    )
    ok = matches and not impossible
    return VerificationOutcome(
        method=VerificationMethod.BRUTE_FORCE,
        result=PASS if ok else FAIL,
        details={
            "optimum": solution.baseline_value,
            "claimed_value": claimed_value,
            "gap_vs_quantum": gap.gap_vs_quantum,
            "relative_gap": gap.relative_gap,
            "beats_exact_optimum": impossible,
        },
    )
