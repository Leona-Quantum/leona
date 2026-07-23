"""Verification primitives mapped to the contracts taxonomy
(VerificationMethod × VerificationResultKind). Each returns a VerificationOutcome
that a verify-stage handler turns into a verification.result event and a
VerificationRecord row. None of these fabricate: a check whose evidence is
missing or malformed returns FAIL with the reason, never a silent PASS. The one
narrow exception is SKIPPED — the check was structurally incapable of judging
this circuit at all (see StatevectorIncapable), which is a fact about the check,
not the code, and is graded as no evidence rather than contrary evidence."""

from __future__ import annotations

import math
from typing import Any

from majorana_contracts.enums import VerificationMethod, VerificationResultKind
from majorana_openqasm import OpenQASMError, normalize, resource_metrics
from pydantic import BaseModel, Field

from majorana_verification.baseline import (
    BaselineProblemError,
    objective_comparison,
)
from majorana_verification.hamiltonian import (
    HamiltonianError,
    energy_tolerance,
    ground_state_comparison,
)
from majorana_verification.native import (
    native_counts_vs_ideal,
    native_statevector_vs_reference,
    sampled_counts_comparison,
)
from majorana_verification.statevector import (
    EquivalenceReport,
    MethodCeilingExceeded,
    StatevectorIncapable,
    counts_vs_ideal,
    exact_equivalence,
    statistical_equivalence,
)

PASS = VerificationResultKind.PASS
FAIL = VerificationResultKind.FAIL
SKIPPED = VerificationResultKind.SKIPPED


def _skipped(method: VerificationMethod, exc: StatevectorIncapable) -> VerificationOutcome:
    """The check could not evaluate this circuit; that is not a verdict.

    Reported as its own result kind because the two readings it replaces were both
    lies: FAIL rejected correct code identically on every candidate (the repair
    loop can never satisfy a criticism about the checker), and PASS would claim
    physics that was never checked. Downstream, evidence_strength_of counts only
    passes, so a run whose physical checks all skipped grades `structural`.
    """
    details: dict[str, Any] = {"skip_reason": "statevector_incapable", "error": str(exc)}
    if isinstance(exc, MethodCeilingExceeded):
        # A distinct reason, not a shade of the same one: "this circuit has no
        # statevector" and "this circuit has one but it is bigger than I can
        # hold" need different words in the UI, and the two numbers are what
        # make the second actionable.
        details |= {
            "skip_reason": "method_ceiling_exceeded",
            "qubits": exc.qubits,
            "max_qubits": exc.max_qubits,
            "ceiling_of": exc.method,
        }
    return VerificationOutcome(method=method, result=SKIPPED, details=details)


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
    except StatevectorIncapable as exc:
        return _skipped(VerificationMethod.EXACT, exc)
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
    except StatevectorIncapable as exc:
        # Had to precede the ValueError arm, which it subclasses. This check
        # samples the Born distribution of a statevector, so it inherits both
        # incapacities of that path — a feed-forward circuit that has no
        # statevector, and one too wide to hold — and neither is evidence about
        # the candidate. Without this arm `statistical` repeated the exact same
        # mistake `exact` was already fixed for.
        return _skipped(VerificationMethod.STATISTICAL, exc)
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
    except StatevectorIncapable as exc:
        return _skipped(VerificationMethod.STATISTICAL, exc)
    except ValueError as exc:
        return VerificationOutcome(
            method=VerificationMethod.STATISTICAL, result=FAIL, details={"error": str(exc)}
        )
    outcome = _from_report(VerificationMethod.STATISTICAL, report)
    outcome.details["evidence"] = "direct_simulation_vs_reported_counts"
    return outcome


def verify_exact_native(
    reference_qasm: str,
    payload: Any,
    tolerance: float = 1e-9,
) -> VerificationOutcome:
    """The `exact` check when the candidate's OpenQASM export is unavailable:
    the plan's declarative reference, simulated in Qiskit, against the state the
    selected framework's own simulator computed. Statevector-only — the evidence
    says so — and skipped when the REFERENCE itself has no statevector."""
    try:
        report = native_statevector_vs_reference(reference_qasm, payload, tolerance=tolerance)
    except StatevectorIncapable as exc:
        return _skipped(VerificationMethod.EXACT, exc)
    except ValueError as exc:
        return VerificationOutcome(
            method=VerificationMethod.EXACT, result=FAIL, details={"error": str(exc)}
        )
    outcome = _from_report(VerificationMethod.EXACT, report)
    outcome.details["evidence"] = "native_statevector_vs_reference_qasm"
    return outcome


def verify_native_statistical_counts(
    payload: Any,
    counts: dict[str, int],
    threshold: float | None = None,
) -> VerificationOutcome:
    """The `statistical` check on framework-native evidence: the run's reported
    counts against the Born distribution of the statevector the selected
    framework's OWN simulator computed inside the trusted observer. Same claim
    as verify_statistical_counts, minus the OpenQASM conversion in the trust
    path. Malformed evidence fails — the observer records incapacity as an error
    key, so a payload that does not validate is a pipeline defect, not a limit."""
    try:
        report = native_counts_vs_ideal(payload, counts, threshold=threshold)
    except ValueError as exc:
        return VerificationOutcome(
            method=VerificationMethod.STATISTICAL, result=FAIL, details={"error": str(exc)}
        )
    outcome = _from_report(VerificationMethod.STATISTICAL, report)
    outcome.details["evidence"] = "native_statevector_vs_reported_counts"
    return outcome


def verify_native_sampled_counts(
    reported: dict[str, int],
    sampled_payload: Any,
    threshold: float | None = None,
) -> VerificationOutcome:
    """The mid-circuit-capable physical check: reported counts against a trusted
    re-execution of the actual circuit object through the framework's own sampler
    with a fixed seed. Works for feed-forward circuits (teleportation) that have
    no statevector. Stronger than statistical_reproducibility — the trusted side
    executes the circuit the observer held, not the user's result-assembly code —
    and weaker than the exact Born comparison, which is why it is a separate
    method with its own name rather than an alias of `statistical`."""
    try:
        report = sampled_counts_comparison(reported, sampled_payload, threshold=threshold)
    except ValueError as exc:
        return VerificationOutcome(
            method=VerificationMethod.STATISTICAL_NATIVE,
            result=FAIL,
            details={"error": str(exc)},
        )
    outcome = _from_report(VerificationMethod.STATISTICAL_NATIVE, report)
    outcome.details["evidence"] = "native_trusted_reexecution_vs_reported_counts"
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
    if any(
        type(count) is not int or count < 0
        for counts in (first, second)
        for count in counts.values()
    ):
        return VerificationOutcome(
            method=VerificationMethod.STATISTICAL,
            result=FAIL,
            details={"error": "counts must be non-negative integers"},
        )
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


def _base_type_name(declared: str) -> str:
    """`dict[str, int]` -> `dict`; `qiskit.QuantumCircuit` -> `quantumcircuit`."""
    return declared.split("[", 1)[0].strip().rsplit(".", 1)[-1].lower()


# Names a planner uses when it is describing the RESULT mapping itself rather
# than the entry point's return value.
_RESULT_MAPPING_TYPES = frozenset({"dict", "mapping", "json", "object"})


def verify_return_contract(
    result: dict[str, Any],
    expected_keys: list[str],
    expected_return_type: str | None = None,
) -> VerificationOutcome:
    """Structural check of the executed code's result dict against the plan's
    artifact contract: the keys it promised to publish.

    `expected_return_type` is deliberately NOT part of the verdict when it names
    something other than a mapping. The only object this function receives is
    RESULT, which the execution contract already forces to be a dict — so
    comparing `type(result).__name__` against a promise like `QuantumCircuit`
    compares the wrong object and can never fail. The plan means the *entry
    point's* return value there, and nothing observes that today. Rather than
    report a comparison that did not happen, the outcome records the scope in
    `return_type_scope` and leaves it unjudged.
    """
    missing = [key for key in expected_keys if key not in result]
    details: dict[str, Any] = {"expected_keys": expected_keys, "missing_keys": missing}
    type_ok = True
    if expected_return_type:
        details["expected_return_type"] = expected_return_type
        if _base_type_name(expected_return_type) in _RESULT_MAPPING_TYPES:
            details["actual_return_type"] = type(result).__name__
            details["return_type_scope"] = "result_mapping"
            type_ok = isinstance(result, dict)
        else:
            details["return_type_scope"] = "entry_point_return_not_observed"
    return VerificationOutcome(
        method=VerificationMethod.RETURN_CONTRACT,
        result=PASS if (not missing and type_ok) else FAIL,
        details=details,
    )


def verify_exact_diag(
    terms: list[tuple[float, str]],
    reported_energy: Any,
    *,
    shots: int | None = None,
    declared_tolerance: float | None = None,
) -> VerificationOutcome:
    """Reported energy against the exact ground state of a declared Hamiltonian.

    The plan may TIGHTEN the tolerance and may not loosen it. That asymmetry is
    the whole reason this accepts a declared value at all: a caller-supplied
    number that *relaxes* a verification bound can manufacture a physical grade.
    The `Run.tolerances` field was the general-purpose version of that idea and
    was deleted in 2026-07 for exactly this reason — it had no safe consumer.
    `min()` keeps the useful direction and closes the dangerous one, and
    `tolerance_source` records which one won.
    """
    if not isinstance(reported_energy, int | float) or isinstance(reported_energy, bool):
        return VerificationOutcome(
            method=VerificationMethod.EXACT_DIAG,
            result=FAIL,
            details={
                "error": "required evidence unavailable",
                "reason": (
                    "the plan's primary_metric is not a real number in the result; "
                    "exact diagonalization has nothing to compare against"
                ),
                "reported_energy": reported_energy,
            },
        )
    try:
        computed = energy_tolerance(terms, shots)
        tolerance, source = computed, "shot_noise_and_optimizer_allowance"
        if declared_tolerance is not None and declared_tolerance > 0:
            tolerance = min(computed, declared_tolerance)
            source = "plan" if tolerance == declared_tolerance else source
        passed, details = ground_state_comparison(
            terms,
            float(reported_energy),
            tolerance=tolerance,
            tolerance_source=source,
        )
    except HamiltonianError as exc:
        # A malformed reference is a defect in the PLAN, not in the candidate. The
        # plan contract rejects the shapes it can see before a candidate is ever
        # written; anything arriving here is a claim about the reference, so the
        # evidence says so rather than letting the model rewrite correct code.
        return VerificationOutcome(
            method=VerificationMethod.EXACT_DIAG,
            result=FAIL,
            details={
                "error": "reference_hamiltonian is not diagonalizable as declared",
                "reason": str(exc),
                "fault": "plan",
            },
        )
    return VerificationOutcome(
        method=VerificationMethod.EXACT_DIAG,
        result=PASS if passed else FAIL,
        details=details,
    )


def verify_brute_force(
    kind: str,
    num_variables: int,
    terms: list[tuple[int, int, float]],
    reported_value: Any,
) -> VerificationOutcome:
    """Reported objective value against the enumerated optimum of a declared instance.

    The combinatorial sibling of `verify_exact_diag`: the check that speaks a cut
    metric's own units, which an energy check structurally cannot (production run
    019f7f81-4a61 declared a cut-weight range that could never contain the Ising
    ground energy, and four correct candidates burned the budget).

    Deliberately NO plan-declared tolerance, not even a tightening one: the bound
    is floating-point headroom only, because a specific assignment's objective
    value is exact — there is no shot-noise budget for a plan to honestly spend,
    and a loosened bound would let a run that never solved the instance buy a
    physical grade.
    """
    if not isinstance(reported_value, int | float) or isinstance(reported_value, bool):
        return VerificationOutcome(
            method=VerificationMethod.BRUTE_FORCE,
            result=FAIL,
            details={
                "error": "required evidence unavailable",
                "reason": (
                    "the plan's primary_metric is not a real number in the result; "
                    "brute-force enumeration has nothing to compare against"
                ),
                "reported_value": reported_value,
            },
        )
    try:
        passed, details = objective_comparison(
            kind,  # type: ignore[arg-type]  # non-member kinds raise BaselineProblemError
            num_variables,
            terms,
            float(reported_value),
        )
    except BaselineProblemError as exc:
        # A malformed instance is a defect in the PLAN, not in the candidate. The
        # plan contract rejects the shapes it can see before a candidate is ever
        # written; anything arriving here is a claim about the reference, so the
        # evidence says so rather than letting the model rewrite correct code.
        return VerificationOutcome(
            method=VerificationMethod.BRUTE_FORCE,
            result=FAIL,
            details={
                "error": "reference_problem is not enumerable as declared",
                "reason": str(exc),
                "fault": "plan",
            },
        )
    return VerificationOutcome(
        method=VerificationMethod.BRUTE_FORCE,
        result=PASS if passed else FAIL,
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
