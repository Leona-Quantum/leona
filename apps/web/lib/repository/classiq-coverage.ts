// Which Classiq library entries this catalog covers, and which it deliberately does not.
//
// The sibling of ./zoo-coverage.ts, with one structural difference: the Zoo's
// entries are *algorithms*, so a record can cover one. Classiq publishes
// **demonstrations** — a notebook plus a pinned Qmod model — and roughly half of
// them are applications (portfolio optimisation, protein folding, option pricing)
// rather than algorithms. "Covered" here therefore means *this catalog carries the
// algorithm the demo is a demonstration of*, not *this catalog reproduces the demo*.
// Nothing in Leona runs Qmod, and a coverage claim that implied otherwise would be
// the kind of claim `scripts/check-repository-data.mjs` exists to refuse.
//
// **The declaration is conservative on purpose.** Every mapping below is one a
// reader can check by opening both, and where the subject is adjacent rather than
// the same — `qpe_with_qubitization` against our phase-estimation record,
// `qsvt_fixed_point_amplitude_amplification` against plain amplitude amplification
// — the entry is left MISSING rather than claimed. Over-declaring is the cheapest
// way to move this number, which is exactly why `check-classiq-parity.mjs` reports
// it instead of gating on it.
//
// Measured at the pinned commit: 26 of 103 covered — and the shape of the 77 is the
// finding, not the count. Leona is deep on gates, operators and textbook algorithms
// and holds almost nothing in the *applied* half: finance, logistics, chemistry at
// scale, CFD, telecom, cybersecurity. An independent token-overlap measurement in
// 2026-08 put 51 of Classiq's then-102 entries as sharing no vocabulary with any
// Leona slug, which is the same finding arrived at a cruder way.

/** Index path (verbatim from the pinned snapshot) → slugs that cover it. */
export const CLASSIQ_COVERAGE: Readonly<Record<string, readonly string[]>> = {
  "algorithms/QML/qsvm": ["quantum-kernel-svm"],
  "algorithms/amplitude_amplification_and_estimation/oblivious_amplitude_amplification": [
    "amplitude-amplification",
  ],
  "algorithms/amplitude_amplification_and_estimation/qmc_user_defined": ["amplitude-estimation"],
  "algorithms/amplitude_amplification_and_estimation/quantum_counting": ["quantum-counting"],
  "algorithms/foundational/bernstein_vazirani": ["bernstein-vazirani-qiskit"],
  "algorithms/foundational/deutsch_jozsa": ["deutsch-jozsa-cirq"],
  "algorithms/foundational/quantum_teleportation": ["quantum-teleportation"],
  "algorithms/hamiltonian_simulation/hamiltonian_simulation_guide": [
    "trotter-suzuki-simulation",
    "hamiltonian-simulation-ising",
  ],
  "algorithms/hamiltonian_simulation/hamiltonian_simulation_with_block_encoding": [
    "linear-combination-unitaries",
    "quantum-singular-value-transformation",
  ],
  "algorithms/number_theory_and_cryptography/discrete_log": ["discrete-logarithm"],
  // The elliptic-curve demo maps to the same record because that record's own
  // literature carries Roetteler, Naehrig, Svore and Lauter's elliptic-curve
  // discrete-log resource estimates — the ECDLP is inside the record, not adjacent
  // to it.
  "algorithms/number_theory_and_cryptography/elliptic_curves": ["discrete-logarithm"],
  "algorithms/number_theory_and_cryptography/hidden_shift": ["hidden-shift-problem"],
  "algorithms/number_theory_and_cryptography/shor": ["shor-period-finding"],
  "algorithms/quantum_differential_equations_solvers/lchs": ["linear-differential-equations"],
  "algorithms/quantum_differential_equations_solvers/time_marching": [
    "linear-differential-equations",
  ],
  "algorithms/quantum_linear_solvers/hhl": ["hhl-linear-systems"],
  "algorithms/quantum_linear_solvers/qsvt_matrix_inversion": [
    "quantum-singular-value-transformation",
  ],
  "algorithms/quantum_phase_estimation/qpe_for_matrix": ["quantum-phase-estimation"],
  "algorithms/quantum_state_preparation/adapt_vqe": ["vqe-adapt"],
  "algorithms/quantum_state_preparation/gibbs": ["gibbs-state-sampling"],
  // Classiq's "glued trees" is the welded-tree problem — same graph, same oracle,
  // same Childs et al. construction, two names for it in the literature.
  "algorithms/quantum_walks/glued_trees": ["welded-tree-traversal"],
  "algorithms/search_and_optimization/QAOA": ["qaoa-maxcut-ring"],
  "algorithms/search_and_optimization/dqi": ["decoded-quantum-interferometry"],
  "algorithms/search_and_optimization/grover": ["grover-unstructured-search"],
  "applications/optimization/variational_quantum_imaginary_time_evolution": [
    "vqe-imaginary-time",
    "qite-imaginary-time",
  ],
  "applications/physical_systems/ising_model": ["hamiltonian-simulation-ising"],
};

/** Index path → why this catalog does not carry it. Empty by design; see ./zoo-coverage.ts. */
export const CLASSIQ_NOT_APPLICABLE: Readonly<Record<string, string>> = {};
