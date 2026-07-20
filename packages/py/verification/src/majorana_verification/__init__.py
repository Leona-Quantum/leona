"""majorana-verification — the verify stage's toolbox.

Framework-native re-execution checks plus optional OpenQASM conversion checks and
return-contract checks. Every primitive maps to the
contracts VerificationMethod/VerificationResultKind taxonomy and fails rather than
fabricates when it cannot run (plans/rebuild/08-phases.md §Phase 2 step 4)."""

from majorana_verification.methods import (
    VerificationOutcome,
    extract_counts,
    verify_exact,
    verify_exact_native,
    verify_native_sampled_counts,
    verify_native_statistical_counts,
    verify_qasm_parse,
    verify_return_contract,
    verify_statistical,
    verify_statistical_counts,
    verify_statistical_counts_pair,
)
from majorana_verification.native import (
    NATIVE_STATEVECTOR_MAX_QUBITS,
    native_counts_vs_ideal,
    sampled_counts_comparison,
    statevector_from_evidence,
)
from majorana_verification.statevector import (
    EquivalenceReport,
    StatevectorIncapable,
    counts_vs_ideal,
    exact_equivalence,
    ideal_distribution,
    simulate_statevector,
    statistical_equivalence,
    unitary,
)

__all__ = [
    "NATIVE_STATEVECTOR_MAX_QUBITS",
    "StatevectorIncapable",
    "VerificationOutcome",
    "extract_counts",
    "native_counts_vs_ideal",
    "sampled_counts_comparison",
    "statevector_from_evidence",
    "verify_exact",
    "verify_exact_native",
    "verify_native_sampled_counts",
    "verify_native_statistical_counts",
    "verify_statistical",
    "verify_statistical_counts",
    "verify_statistical_counts_pair",
    "verify_return_contract",
    "verify_qasm_parse",
    "EquivalenceReport",
    "counts_vs_ideal",
    "exact_equivalence",
    "ideal_distribution",
    "statistical_equivalence",
    "simulate_statevector",
    "unitary",
]
