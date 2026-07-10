"""majorana-baselines — deterministic classical baselines for optimization tasks.

Trusted control-plane solvers (brute-force / exact diagonalization), size-capped,
no untrusted code and no sandbox round-trip. Ported from nameko classical-baseline
(plans/rebuild/08-phases.md §Phase 2 step 4)."""

from majorana_baselines.solvers import (
    BRUTE_FORCE_MAX_N,
    COMPARISON_TOLERANCE,
    HAMILTONIAN_MAX_DIM,
    MAXCUT_MAX_EDGES,
    BaselineInstance,
    BaselineSolution,
    CapError,
    HamiltonianInstance,
    MaxCutInstance,
    PortfolioInstance,
    QuantumGap,
    QuboInstance,
    check_caps,
    compute_quantum_gap,
    solve,
)

__all__ = [
    "BRUTE_FORCE_MAX_N",
    "HAMILTONIAN_MAX_DIM",
    "MAXCUT_MAX_EDGES",
    "COMPARISON_TOLERANCE",
    "BaselineInstance",
    "MaxCutInstance",
    "QuboInstance",
    "PortfolioInstance",
    "HamiltonianInstance",
    "BaselineSolution",
    "QuantumGap",
    "CapError",
    "check_caps",
    "solve",
    "compute_quantum_gap",
]
