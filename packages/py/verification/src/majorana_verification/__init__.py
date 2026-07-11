"""majorana-verification — the verify stage's toolbox.

Statevector simulation + exact/statistical circuit equivalence (ported from the
quepo engine, pure numpy over the majorana IR), plus return-contract, QASM-parse,
exact-diagonalization, and brute-force checks. Every primitive maps to the
contracts VerificationMethod/VerificationResultKind taxonomy and fails rather than
fabricates when it cannot run (plans/rebuild/08-phases.md §Phase 2 step 4)."""

from majorana_verification.methods import (
    VerificationOutcome,
    extract_counts,
    verify_brute_force,
    verify_exact,
    verify_exact_diag,
    verify_qasm_parse,
    verify_return_contract,
    verify_statistical,
    verify_statistical_counts,
)
from majorana_verification.statevector import (
    EquivalenceReport,
    counts_vs_ideal,
    exact_equivalence,
    ideal_distribution,
    simulate_statevector,
    statistical_equivalence,
    unitary,
)

__all__ = [
    "VerificationOutcome",
    "extract_counts",
    "verify_exact",
    "verify_statistical",
    "verify_statistical_counts",
    "verify_return_contract",
    "verify_qasm_parse",
    "verify_exact_diag",
    "verify_brute_force",
    "EquivalenceReport",
    "counts_vs_ideal",
    "exact_equivalence",
    "ideal_distribution",
    "statistical_equivalence",
    "simulate_statevector",
    "unitary",
]
