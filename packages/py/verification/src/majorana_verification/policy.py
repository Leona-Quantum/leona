"""Fixed, non-LLM evidence sufficiency for final verification decisions."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from majorana_contracts.enums import Algorithm, VerificationMethod


@dataclass(frozen=True)
class EvidenceSufficiency:
    """Whether every supported physical claim has trusted passing evidence."""

    sufficient: bool
    required_claims: tuple[str, ...]
    satisfied_claims: tuple[str, ...]
    missing_claims: tuple[str, ...]
    capability_supported: bool


def assess_evidence_sufficiency(
    algorithm: Algorithm,
    checks: Sequence[Mapping[str, Any]],
    *,
    reported_counts: bool,
) -> EvidenceSufficiency:
    """Apply the fixed evidence policy; Plan/LLM output cannot loosen it.

    Bell and GHZ require their phase-aware native-state property. VQE and QAOA
    require independent bounded classical ground truth. Algorithms without a
    dedicated property verifier (for example Grover and QFT) may still pass the
    standard gate when their reported counts agree with trusted framework-native
    evidence. Missing a specialised verifier is a limitation to disclose, not a
    candidate defect. If counts are reported, they additionally have to agree
    with trusted framework-native evidence; reproducibility alone never suffices.
    """
    results: dict[str, set[str]] = {}
    for check in checks:
        method = check.get("method")
        result = check.get("result")
        if isinstance(method, str) and isinstance(result, str):
            results.setdefault(method, set()).add(result)

    required: list[tuple[str, frozenset[str]]] = []
    if algorithm is Algorithm.BELL:
        required.append(
            (
                "accepted Bell relative-phase state target",
                frozenset({VerificationMethod.BELL_STATE_PROPERTY.value}),
            )
        )
    elif algorithm is Algorithm.GHZ:
        required.append(
            (
                "accepted GHZ relative-phase state target",
                frozenset({VerificationMethod.GHZ_STATE_PROPERTY.value}),
            )
        )
    elif algorithm is Algorithm.VQE:
        required.append(("bounded Hamiltonian ground-state objective", frozenset({"exact_diag"})))
    elif algorithm is Algorithm.QAOA:
        required.append(("bounded combinatorial objective", frozenset({"brute_force"})))

    # A dedicated property verifier gives us an algorithm-specific claim.  For
    # algorithms that do not have one yet, a successful trusted count comparison
    # is still affirmative evidence about the executed circuit.  Treating every
    # such algorithm as unsupported made correct Grover/QFT runs permanently
    # INCONCLUSIVE despite structural, contract, semantic, statistical, and
    # trusted re-execution checks all passing.
    capability_supported = bool(required) or reported_counts
    if reported_counts:
        required.append(
            (
                "reported counts agree with trusted circuit evidence",
                frozenset(
                    {
                        VerificationMethod.STATISTICAL.value,
                        VerificationMethod.STATISTICAL_NATIVE.value,
                    }
                ),
            )
        )

    satisfied: list[str] = []
    missing: list[str] = []
    for claim, methods in required:
        if any("pass" in results.get(method, set()) for method in methods):
            satisfied.append(claim)
        else:
            missing.append(claim)
    if not capability_supported:
        missing.insert(
            0,
            (
                f"no dedicated property verifier or trusted count evidence for "
                f"{algorithm.value}"
            ),
        )

    return EvidenceSufficiency(
        sufficient=capability_supported and not missing,
        required_claims=tuple(claim for claim, _ in required),
        satisfied_claims=tuple(satisfied),
        missing_claims=tuple(missing),
        capability_supported=capability_supported,
    )
