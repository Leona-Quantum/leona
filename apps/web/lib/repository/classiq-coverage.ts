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
// First measured at the pinned commit: 26 of 103 covered — and the shape of the 77
// was the finding, not the count. Leona was deep on gates, operators and textbook
// algorithms and held almost nothing in the *applied* half: finance, logistics,
// chemistry at scale, CFD, telecom, cybersecurity. An independent token-overlap
// measurement in 2026-08 put 51 of Classiq's then-102 entries as sharing no
// vocabulary with any Leona slug, which is the same finding arrived at a cruder way.
// Two intakes have since worked that half — 8 records, then 19 records and the nine
// declarations at the foot of this file — and `check-classiq-parity.mjs` prints
// where it stands now. Do not read a count out of this comment; run the gauge.

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

  // ---- Applied half, declared 2026-08-12 ----------------------------------
  // Nine demonstrations whose algorithm this catalog already carries as a record.
  // Nothing was written for these; the work was reading each demonstration's own
  // problem statement and deciding whether the record answers it. Where it does
  // not, the entry stays MISSING — `classiq_chemistry_application` (a tour of a
  // platform module, not an algorithm), `second_quantized_hamiltonian` (a title
  // and nothing else) and `max_k_vertex_cover` (a k-bounded maximisation, not the
  // vertex cover Lucas formulates) were all looked at here and left alone.

  // Three VQE demonstrations of one algorithm. `molecule_eigensolver` states its
  // own subject as finding ground states and energies of H2, H2O and LiH by VQE;
  // `molecular_energy_curve` runs the same solver across internuclear distances
  // and plots the result, which is a use of the algorithm rather than a different
  // one. The second slug on the eigensolver is the ansatz the demonstration needs
  // and this catalog holds separately.
  "applications/chemistry/molecule_eigensolver": [
    "vqe-ground-state-energy",
    "vqe-hardware-efficient-ansatz",
  ],
  "applications/chemistry/molecular_energy_curve": ["vqe-ground-state-energy"],
  // The Lanchester demonstration discretizes a linear model into a linear system
  // and solves it with HHL; HHL is the algorithm it demonstrates.
  "applications/physical_systems/hhl_lanchester": ["hhl-linear-systems"],

  // Six problems whose Ising formulation is in Lucas, arXiv:1302.5843, the source
  // of `ising-formulations-np-problems`.
  //
  // **The basis for these six is a full-text read, not the abstract**, and that
  // distinction matters because the record itself says so: its caveat declines to
  // claim on the *abstract's* authority that any individually named problem is
  // among the ones the paper treats, because the abstract names them only as a
  // class ("all of Karp's 21 NP-complete problems"). The paper's own section
  // titles settle it, and they were read for this declaration — Number
  // Partitioning, Cliques, Vertex Cover, Set Cover and Graph Coloring each have
  // one, and the Set Packing section states that the problem of the maximal
  // number of vertices no two of which are adjacent "is exactly equivalent to the
  // set packing problem described above. This version is called the maximal
  // independent set (MIS) problem." Each mapping below pairs one of those
  // sections with a demonstration whose own problem statement is that problem:
  // `set_partition`'s notebook is titled for the Number Partition Problem, and
  // `link_monitoring` states its subject as the Minimum Vertex Cover problem, so
  // neither is being matched on its directory name.
  "applications/optimization/set_partition": ["ising-formulations-np-problems"],
  "applications/optimization/max_clique": ["ising-formulations-np-problems"],
  "applications/optimization/max_independent_set": ["ising-formulations-np-problems"],
  "applications/optimization/set_cover": ["ising-formulations-np-problems"],
  "applications/optimization/min_graph_coloring": ["ising-formulations-np-problems"],
  "applications/cybersecurity/link_monitoring": ["ising-formulations-np-problems"],
};

/** Index path → why this catalog does not carry it. Empty by design; see ./zoo-coverage.ts. */
export const CLASSIQ_NOT_APPLICABLE: Readonly<Record<string, string>> = {};
