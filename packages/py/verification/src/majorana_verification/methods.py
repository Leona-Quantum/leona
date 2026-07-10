"""Verification primitives mapped to the contracts taxonomy
(VerificationMethod × VerificationResultKind). Each returns a VerificationOutcome
that a verify-stage handler turns into a verification.result event and a
VerificationRecord row. None of these fabricate: a check that cannot run returns
FAIL with the reason, never a silent PASS."""

from __future__ import annotations

from typing import Any

from majorana_contracts.enums import VerificationMethod, VerificationResultKind
from majorana_ir import Circuit, validate_circuit
from majorana_ir.connectors import OpenQASMError, from_openqasm
from pydantic import BaseModel, Field

from majorana_baselines import (
    BaselineInstance,
    CapError,
    compute_quantum_gap,
    solve,
)
from majorana_verification.statevector import (
    EquivalenceReport,
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
    reference: Circuit, candidate: Circuit, tolerance: float = 1e-9, max_qubits: int = 6
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
    reference: Circuit,
    candidate: Circuit,
    shots: int = 4096,
    seed: int = 1234,
    threshold: float = 0.05,
) -> VerificationOutcome:
    """Seeded sampled-distribution equivalence (total-variation distance)."""
    report = statistical_equivalence(
        reference, candidate, shots=shots, seed=seed, threshold=threshold
    )
    return _from_report(VerificationMethod.STATISTICAL, report)


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
    """Parse emitted OpenQASM into the canonical IR and validate it. A circuit
    that won't parse or violates the IR limits fails here rather than silently
    proceeding to export."""
    try:
        circuit = from_openqasm(qasm)
    except OpenQASMError as exc:
        return VerificationOutcome(
            method=VerificationMethod.QASM_PARSE, result=FAIL, details={"parse_error": str(exc)}
        )
    validation = validate_circuit(circuit)
    return VerificationOutcome(
        method=VerificationMethod.QASM_PARSE,
        result=PASS if validation.passed else FAIL,
        details={
            "qubits": circuit.qubits,
            "operations": len(circuit.operations),
            "errors": validation.errors,
            "warnings": validation.warnings,
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
