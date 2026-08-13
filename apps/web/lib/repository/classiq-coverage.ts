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
// ## Declarations are not all the same strength — see `CLASSIQ_COVERAGE_BASIS`
//
// A row here is one slug against one path, and that shape cannot say *why*. Two
// rows can look identical and rest on completely different evidence: one because
// a paper read for the record formulates that exact problem, another because the
// demonstration merely runs the method the record documents. After the owner's
// ai-ops#42 ruling the map holds nineteen rows of those two kinds side by side.
// `CLASSIQ_COVERAGE_BASIS` at the foot of this file records which is which, the
// gauge prints the split, and a declared path with no basis fails the build.
//
// First measured at the pinned commit: 26 of 103 covered — and the shape of the 77
// was the finding, not the count. Leona was deep on gates, operators and textbook
// algorithms and held almost nothing in the *applied* half: finance, logistics,
// chemistry at scale, CFD, telecom, cybersecurity. An independent token-overlap
// measurement in 2026-08 put 51 of Classiq's then-102 entries as sharing no
// vocabulary with any Leona slug, which is the same finding arrived at a cruder way.
// Three intakes have since worked that half — 8 records, then 19, then 4, plus the ten
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
  // Ten demonstrations whose algorithm this catalog already carries as a record.
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
  // The fuzzing demonstration says in its own first line that it "uses the quantum
  // Grover algorithm to boost the process of whitebox fuzzing", and its references
  // are Grover 1997 plus a software-engineering paper about whitebox fuzz testing.
  // Grover over the program's input space is the algorithm; the application is the
  // choice of search space.
  "applications/cybersecurity/whitebox_fuzzing": ["grover-unstructured-search"],

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

  // ---- The QAOA/QUBO cluster, declared 2026-08-13 (owner ruling ai-ops#42) ----
  //
  // Thirteen demonstrations of one method. The owner's ruling, verbatim: "These
  // are kind of structured like 13 different implementations of the same method,
  // which is kind of where we want to be for everything once we get through all
  // the literature! (b) Write ONE general QAOA record, cited to Farhi, and
  // declare all 13 demonstrations against it."
  //
  // The record is `qaoa-combinatorial-optimization` in ./entries-algorithms.ts,
  // cited to Farhi, Goldstone and Gutmann, arXiv:1411.4028.
  //
  // **Every one of these is basis `method-instance`, and that is the whole point
  // of the basis map below.** Farhi formulates MaxCut. He does not formulate
  // portfolio allocation, vehicle routing, kidney exchange or any of the other
  // eleven. What each declaration claims is narrower than it looks: *this
  // demonstration solves its problem with the algorithm that record documents*.
  // It does not claim the record's source contains the problem. Writing a record
  // per problem "cited to Farhi" is precisely what ai-ops#12 forbids, which is
  // why these are declarations and not records.
  //
  // Each was read first-hand at the pinned commit ac61dccb, notebook by notebook,
  // and the note beside it says what the demonstration says about itself and what
  // its own reference list does and does not contain. Four things that read
  // needs recording, because they bear on how much weight a demo's bibliography
  // can carry:
  //
  //   * **Only five of the thirteen cite Farhi's paper at all** —
  //     `portfolio_optimization`, `integer_linear_programming`,
  //     `max_induced_k_color_subgraph`, `max_k_vertex_cover` and
  //     `minimum_dominating_set`.
  //   * **Six have no `## References` cell at all**: `facility_location`,
  //     `vehicle_routing_problem`, `rectangles_packing`,
  //     `network_traffic_optimization`, `radio_access_network` and
  //     `resiliency_planning`.
  //   * **`kidney_exchange` cites Barkoutsos et al., arXiv:1907.04769, and
  //     nothing else.** That is *Improving Variational Quantum Optimization using
  //     CVaR* — a different paper by different authors about a different
  //     objective function. It is not Farhi's paper and is not an alternative
  //     citation for QAOA. Six of the thirteen carry that id; in five of them it
  //     sits alongside Farhi, where it is the CVaR objective some Classiq demos
  //     substitute for the expectation value. Nothing here rests on it.
  //   * **Three print a citation marker against an anchor that does not exist**:
  //     `facility_location` (`#QAOA` and `#cvar`, in a notebook with no
  //     references cell at all), `electric_grid_optimization` (`#OpPwer` against
  //     `id='OpPower'`, plus `#cvar`) and `integer_linear_programming` (`#ILP`
  //     against `id='MVC'`). A fourth link is not broken but wrong:
  //     `minimum_dominating_set`'s [1] is labelled "Dominating Set (Wikipedia)"
  //     and points at the article for the *partition* problem.
  //
  // Those counts are from a script over the notebooks at the pinned commit, not
  // from reading and tallying by hand; an earlier draft of this comment said five,
  // eight and two and was wrong on all three.
  //
  // So none of these declarations is made on the strength of a demonstration's
  // bibliography. Each is made on what the notebook's own prose and code say the
  // demonstration does.
  //
  // ## All thirteen were then re-read at code-cell level. Nothing moved, and that
  // ## is the result.
  //
  // The first pass read prose. Because reading only prose is exactly what had
  // left three other rows wrongly in MISSING (see the CFD and chemistry rows
  // below), all 13 were re-read through their **code** — 14 notebooks, since
  // `resiliency_planning` has two. The question being asked was whether any of
  // them carries a component that is separately extractable under ai-ops#51 and
  // formulated in a paper this catalog holds, which would move that row from
  // `method-instance` to `source-formulates-problem` **without changing the
  // headline number**. The answer is no, for all thirteen, and the two near
  // misses are worth recording because both look like a yes from a distance.
  //
  // **They are not one implementation shape but three:**
  //
  //   * **Eight go Pyomo model → `CombinatorialProblem`** (`portfolio_optimization`,
  //     `facility_location`, `electric_grid_optimization`,
  //     `integer_linear_programming`, `kidney_exchange`,
  //     `max_induced_k_color_subgraph`, `max_k_vertex_cover`,
  //     `minimum_dominating_set`). Classiq generates the QAOA circuit from the
  //     model; `num_layers` is p and `penalty_factor` weights the constraint term.
  //   * **Two go Pyomo → `QAOAConfig` + `OptimizerConfig`** — `rectangles_packing`
  //     (`num_layers=10, penalty_energy=100`) and `radio_access_network`
  //     (`num_layers=4, penalty_energy=3.0`).
  //   * **Three build the ansatz by hand in Qmod** — `vehicle_routing_problem`
  //     (`NUM_LAYERS=12`), `network_traffic_optimization` (`NUM_LAYERS=5`) and
  //     `resiliency_planning`. Each is `allocate` → `hadamard_transform` → a loop
  //     of `phase(cost(x), γ)` then a mixer of `RX(β)` applied to every qubit.
  //     That is Farhi's construction written out: the uniform superposition, the
  //     cost operator, and the transverse-field mixer, alternating p times.
  //     **These three are the strongest evidence in the batch** — and they are
  //     three of the six notebooks with no references cell at all.
  //
  // **The CVaR near miss, which is the reason this re-read was worth doing.**
  // Six of the thirteen cite Barkoutsos et al. on CVaR. **None of them uses a CVaR
  // objective.** Only two expose the parameter at all, and both set it to the
  // degenerate value: `OptimizerConfig(max_iteration=60, alpha_cvar=1)` in
  // `rectangles_packing` and `alpha_cvar=1.0` in `radio_access_network`. CVaR at
  // α = 1 *is* the expectation value, so the objective being optimised is plain
  // QAOA's in every one of the thirteen. Six citations, zero uses — a count of
  // citations would have said the opposite.
  //
  // **The `alpha` trap.** A grep for `alpha` hits eight of these notebooks and is
  // a CVaR signal in none of them: it is matplotlib's plot transparency in
  // `optimization_result["cost"].plot(..., alpha=0.6)`. The token that looks like
  // evidence is the same failure as the bibliography that looks like a source.
  //
  // **Penalties are the platform's, not a paper's.** `penalty_factor` and
  // `penalty_energy` are a scalar weight Classiq applies to the constraint term.
  // No notebook derives a penalty weight from a formulation, and none uses Lucas's
  // per-problem penalty constructions, so no row moves to
  // `source-formulates-problem` on that basis either.

  // Title: "Portfolio Optimization with the Quantum Approximate Optimization
  // Algorithm (QAOA)". States its own subject as allocating a portfolio of
  // financial assets to maximise return against risk, expressed as a
  // combinatorial optimization problem, and says it "shows how to employ the
  // Quantum Approximate Optimization Algorithm (QAOA) [...] to solve the problem
  // of portfolio optimization". Cites Farhi directly as its reference [2]. Its
  // problem reference [1] is a Wikipedia article, not a paper — which is why the
  // problem gets no record of its own.
  //
  // Not to be confused with `applications/finance/portfolio_optimization_hhl`,
  // a different directory already covered by `quantum-portfolio-optimization`
  // (Rebentrost and Lloyd). Same words, different demonstration, different method.
  "applications/finance/portfolio_optimization": ["qaoa-combinatorial-optimization"],

  // "Facility Location Problem (P-Median)". States the problem in full — M
  // customers, N candidate sites, open exactly P facilities, minimise total
  // transport cost, every customer served by one facility — and gives the binary
  // program. Its solver text says the Pyomo model is translated "to a quantum
  // model of the QAOA algorithm [[1](#QAOA)]". **There is no references cell in
  // the notebook**, so that marker points at nothing; the method is named in the
  // prose, and that is what this declaration rests on.
  "applications/logistics/facility_location": ["qaoa-combinatorial-optimization"],

  // "Vehicle Routing Problem (VRP)". Its own words: "The tutorial showcases how
  // to solve the problem using the Quantum Approximate Optimization Algorithm
  // (QAOA)." It states the problem is NP-hard and gives the depot/city/position
  // formulation. No references cell.
  "applications/logistics/vehicle_routing_problem": ["qaoa-combinatorial-optimization"],

  // "Electric Grid Optimization Using QAOA" — the method is in the title. The
  // problem is a transport program over N power plants and M consumers with one
  // equality and one inequality constraint. Its single reference is Shemelova et
  // al., *Solving optimization problems when designing power supply circuits*
  // (E3S Web of Conferences 124, 04011, 2019), which the notebook says its model
  // is "a minor variation of" — a classical power-engineering paper containing no
  // quantum algorithm, so it sources the problem and could not source a record
  // here. (Its citation marker reads `#OpPwer` against an anchor spelled
  // `id='OpPower'`, so the link is broken in the published notebook.)
  "applications/optimization/electric_grid_optimization": ["qaoa-combinatorial-optimization"],

  // "Integer Linear Programming". Gives the standard ILP: maximise c·x subject to
  // Ax <= b, x >= 0, **x integer**, and says it solves it "with the Classiq
  // platform, using QAOA [[2](#QAOA)]". Cites Farhi directly as [2].
  //
  // **Deliberately not declared against `ising-formulations-np-problems`.**
  // Lucas has an integer-linear-programming section, but his variables are
  // binary; this demonstration's are general integers, and the binary expansion
  // that closes the gap — with its qubit cost — is not in Lucas. Lucas would be a
  // stronger claim (basis `source-formulates-problem`) and it is not available
  // here, so this row takes the weaker, true one. (Its problem reference [1] is
  // cited as `#ILP` while the anchor is actually `id='MVC'` — copy-paste residue
  // from the max_k_vertex_cover notebook — and resolves to a Wikipedia article.)
  "applications/optimization/integer_linear_programming": ["qaoa-combinatorial-optimization"],

  // "Kidney Exchange QAOA Example". States the problem as maximising total
  // donor-recipient compatibility subject to each donor donating once and each
  // patient receiving once, and calls it "an NP-Hard combinatorial optimization
  // problem".
  //
  // **Its only reference is Barkoutsos et al., arXiv:1907.04769 — the CVaR paper,
  // not Farhi.** This declaration therefore rests entirely on the notebook naming
  // QAOA in its own title and prose, and not at all on its bibliography, which
  // contains no QAOA reference.
  "applications/optimization/kidney_exchange": ["qaoa-combinatorial-optimization"],

  // "Max Colorable Induced Subgraph Problem": given a graph and K colours, find
  // the largest induced subgraph that can be legally coloured with up to K
  // colours. Cites Farhi directly as its reference [1] and says the Pyomo model
  // is translated "to a quantum model of the QAOA algorithm [[1](#QAOA)]".
  //
  // Not declared against Lucas despite the neighbouring Graph Colouring section
  // there: Lucas formulates K-colouring a whole graph, while this maximises the
  // size of a colourable induced subgraph. Different objective, different feasible
  // set.
  "applications/optimization/max_induced_k_color_subgraph": ["qaoa-combinatorial-optimization"],

  // "Max K-Vertex Cover": choose exactly k vertices maximising covered edges.
  // Cites Farhi directly as its reference [2].
  //
  // **This row has a real per-problem source and still cannot use it.** Its
  // reference [1] is Manurangsi, *A Note on Max k-Vertex Cover*, arXiv:1810.03792,
  // whose abstract defines exactly this problem: "In Maximum $k$-Vertex Cover
  // (Max $k$-VC), the input is an edge-weighted graph $G$ and an integer $k$, and
  // the goal is to find a subset $S$ of $k$ vertices that maximizes the total
  // weight of edges covered by $S$." But that paper is entirely classical — an
  // FPT approximation scheme, an approximate kernelization, and an SDP-based
  // 0.92-approximation — and contains no quantum algorithm. So the problem is in
  // one paper and the method in another, and neither contains the pair. The
  // demonstration is a QAOA demonstration, so this is the row it gets.
  //
  // Also not Lucas: his Vertex Cover section minimises cover size subject to
  // covering every edge, which is a different problem from maximising coverage
  // under a budget of k.
  "applications/optimization/max_k_vertex_cover": ["qaoa-combinatorial-optimization"],

  // "Minimum Dominating Set (MDS) Problem": smallest vertex subset such that
  // every vertex is in it or adjacent to it, stated with the constraint and
  // objective in full. Cites Farhi directly as its reference [2] and says it
  // solves the problem "using QAOA algorithm [[2](#QAOA)]". (Its problem
  // reference [1] is labelled "Dominating Set (Wikipedia)" but its URL points at
  // the Wikipedia article for the *partition* problem — a wrong link in the
  // published notebook, and another reason no record is written from a demo's
  // bibliography.)
  "applications/optimization/minimum_dominating_set": ["qaoa-combinatorial-optimization"],

  // "Solving the Rectangles Packing Problem with Classiq", with a section headed
  // "The Quantum Approximate Optimization Algorithm (QAOA) for Rectangles
  // Packing". Places N rectangles in a fixed grid without overlap, maximising the
  // number placed. No references cell.
  //
  // **One thing in this notebook is deliberately not carried across.** It asserts
  // that "QAOA offers a potential exponential speedup". Farhi's abstract claims
  // no speedup of any kind and states no running time; the record declared here
  // says so in its caveat, and this declaration does not import the demo's claim.
  "applications/optimization/rectangles_packing": ["qaoa-combinatorial-optimization"],

  // "Network Traffic Optimization with QAOA". States input (weighted directed
  // graph plus demands), goal (satisfy demands, minimise latency) and its two
  // constraints (unit capacity per edge, flow conservation), and says it
  // "demonstrates a solution to the network traffic optimization problem,
  // applying the QAOA algorithm". No references cell.
  "applications/telecom/network_traffic_optimization": ["qaoa-combinatorial-optimization"],

  // "Radio Access Network": place a limited number of antennas over a region of
  // spread-out consumers. Its solver section is headed "Define QAOA Parameters
  // and Synthesize" and configures `QAOAConfig` with `num_layers` and
  // `penalty_energy`. No references cell.
  "applications/telecom/radio_access_network": ["qaoa-combinatorial-optimization"],

  // "Quantum-Based Resiliency Planning": "This notebook implements the
  // quantum-based resiliency planning using QAOA." The directory holds two
  // notebooks, the second (`resiliency_planning_AMD.ipynb`) being the same
  // algorithm run on an AMD-GPU build of Qiskit Aer instead of the Classiq
  // simulator — a change of simulator backend, not of algorithm, which is why one
  // declaration covers the directory. No references cell in either.
  "applications/telecom/resiliency_planning": ["qaoa-combinatorial-optimization"],

  // ---- Three rows released by reading the code, 2026-08-13 ------------------
  //
  // These three sat in MISSING under judgements recorded above and in earlier
  // sessions — "a title and nothing else", "no references at all", "a
  // polynomial-approximation primitive". **Each of those judgements came from
  // reading a notebook's markdown.** All 37 files of the four remaining
  // application directories were fetched from the pinned commit ac61dccb and read
  // through, code cells included, and three of the four turned out to state their
  // algorithm plainly in Python while saying little or nothing in prose. A
  // notebook is a program; reading only its prose measures the wrong thing.

  // Its markdown is one cell — `# Second Quantized Hamiltonian` — which is what
  // "a title and nothing else" was based on. Its seven code cells build a
  // fermionic Hamiltonian as an OpenFermion `FermionOperator`, wrap it in
  // `FermionHamiltonianProblem` with `n_particles=(1, 1)`, map it to qubits with
  // `FermionToQubitMapper`, build a `full_hea` hardware-efficient ansatz out of X,
  // RY and CX at three repetitions, and call
  // `es.minimize(cost_function=vqe_hamiltonian, ...)`. That is VQE with a
  // hardware-efficient ansatz — the same pair of slugs already declared for
  // `molecule_eigensolver`, which is exactly what the platform tour in
  // `classiq_chemistry_application` says: there are two ways to define an
  // electronic structure problem, and "for the direct definition see this
  // example", linking here.
  //
  // Basis `same-subject` rather than `method-instance`: the demonstration
  // variationally minimises the expectation value of a Hamiltonian, which is the
  // subject of the record's source, not an application of it to some further
  // problem. Unlike `molecule_eigensolver` the evidence is the code rather than a
  // written problem statement, because the notebook does not contain one.
  "applications/chemistry/second_quantized_hamiltonian": [
    "vqe-ground-state-energy",
    "vqe-hardware-efficient-ansatz",
  ],

  // "Quantum Double Slit Experiment", and the reason it was left missing is that
  // it carries no bibliography at all. That was never the right test: what a
  // record cites is our problem, not the demo's. The notebook discretizes a wave
  // equation on a 2D grid with slits as boundary conditions, states in its own
  // learning objectives that it covers "the principles of Quantum Signal
  // Processing (QSP) and Quantum Singular Value Transformation (QSVT) for quantum
  // linear algebra", and says the problem is "mapped to a quantum circuit, and
  // QSP/QSVT is used to approximate the matrix inverse". Its code imports
  // `qsvt_phases` from `classiq.applications.qsp`. Solving a linear system by
  // QSVT matrix inversion is the same claim already declared for
  // `algorithms/quantum_linear_solvers/qsvt_matrix_inversion`.
  //
  // `method-instance`: Gilyén et al. give the QSVT framework and do not formulate
  // a slitted wave equation.
  "applications/CFD/double_slit_experiment": ["quantum-singular-value-transformation"],

  // Left missing as "a polynomial-approximation primitive", which is true of one
  // of the directory's four notebooks — `chebyshev_approximation.ipynb`, which
  // approximates 1/x on a spectral interval and cites Childs, Kothari and Somma
  // for the trimmed variant. The other three are the solver itself:
  // `qls_qsvt.ipynb` is titled "Quantum Linear Solver Based on QSVT" and imports
  // `qsvt_phases` and `poly_inversion`; `qls_chebyshev_lcu.ipynb` is titled
  // "Quantum Linear Solver with LCU of Chebyshev Polynomials"; and
  // `verify_block_encoding.ipynb` checks the Pauli-decomposition and
  // banded-diagonal block encodings the other two consume. Both notebooks say the
  // solver can stand in for a classical `spsolve` call inside a CFD solver.
  //
  // So the directory demonstrates matrix inversion by QSVT and by an LCU of
  // Chebyshev polynomials over a block-encoded matrix — the same pairing of slugs
  // already declared for
  // `algorithms/hamiltonian_simulation/hamiltonian_simulation_with_block_encoding`.
  // `method-instance`: neither record's source formulates a CFD problem.
  "applications/CFD/QLS_for_hybrid_solvers": [
    "quantum-singular-value-transformation",
    "linear-combination-unitaries",
  ],

  // `applications/chemistry/classiq_chemistry_application` is the fourth of that
  // group and is deliberately NOT declared here. It demonstrates VQE — UCC
  // ansatz, Hartree-Fock reference state, Z2 symmetry tapering — but its own first
  // line states its subject as "the functionality of Classiq's Chemistry
  // application module", a vendor software module rather than an algorithm.
  // Declaring it covered would be the first time this catalog claimed coverage of
  // something whose stated subject is software, which is a precedent rather than
  // a finding. Raised for the owner rather than settled between agents — and he
  // ruled. See `CLASSIQ_NOT_APPLICABLE` below: it is declined, not missing.
};

/**
 * What kind of claim a declaration in `CLASSIQ_COVERAGE` is making.
 *
 * This exists because option (b) of ai-ops#42 flattens a distinction that was
 * real. Six rows above are covered by `ising-formulations-np-problems` because
 * Lucas, arXiv:1302.5843, has a **section formulating that exact problem** — a
 * full-text read, argued where those six are declared. Thirteen more are now
 * covered by `qaoa-combinatorial-optimization` because the demonstration *runs
 * that algorithm*, while Farhi formulates only MaxCut. From outside, after the
 * ruling, those nineteen rows look identical: same map, same headline, one
 * slug each. They are not the same strength of claim.
 *
 * The owner accepted that cost knowingly. This field is how the repository keeps
 * the difference on the record anyway, so the gauge can be read honestly later
 * and so a future session does not have to re-derive nineteen judgements from
 * comments. It changes no number: `check-classiq-parity.mjs` computes coverage
 * from `CLASSIQ_COVERAGE` exactly as before, prints this split beside the
 * headline, and **fails if a declared path has no basis here** — which is the
 * only thing that stops the distinction rotting the way a comment would.
 */
export type ClassiqClaimBasis =
  /** The demonstration's subject and the covering record's subject are the same named thing. */
  | "same-subject"
  /** A source read for the covering record formulates *this demonstration's* problem. */
  | "source-formulates-problem"
  /**
   * The demonstration applies the general method the covering record documents,
   * and no source read for that record formulates this demonstration's problem.
   */
  | "method-instance"
  /**
   * Declared before this field existed and not re-derived when it was added.
   * Honest placeholder, not a fourth strength: it says "nobody has checked this
   * pairing against the taxonomy", and burning these down is a later session's
   * work. Do not add new rows with this value.
   */
  | "not-re-derived";

/** Every key of `CLASSIQ_COVERAGE` must appear here; the gauge fails otherwise. */
export const CLASSIQ_COVERAGE_BASIS: Readonly<Record<string, ClassiqClaimBasis>> = {
  // The 2026-07/08 algorithm block. Each pairs a Classiq `algorithms/` directory
  // with a record for the algorithm of the same name, so the pairing is checkable
  // by opening both — but the pairings were made before this taxonomy existed and
  // were not re-read when it was added, and two of them (`oblivious_amplitude_
  // amplification` against plain amplitude amplification, `qmc_user_defined`
  // against amplitude estimation) are variant-versus-general pairs that may well
  // be `method-instance` on a proper read. Marking them honestly rather than
  // asserting 26 judgements nobody made in this pass.
  "algorithms/QML/qsvm": "not-re-derived",
  "algorithms/amplitude_amplification_and_estimation/oblivious_amplitude_amplification": "not-re-derived",
  "algorithms/amplitude_amplification_and_estimation/qmc_user_defined": "not-re-derived",
  "algorithms/amplitude_amplification_and_estimation/quantum_counting": "not-re-derived",
  "algorithms/foundational/bernstein_vazirani": "not-re-derived",
  "algorithms/foundational/deutsch_jozsa": "not-re-derived",
  "algorithms/foundational/quantum_teleportation": "not-re-derived",
  "algorithms/hamiltonian_simulation/hamiltonian_simulation_guide": "not-re-derived",
  "algorithms/hamiltonian_simulation/hamiltonian_simulation_with_block_encoding": "not-re-derived",
  "algorithms/number_theory_and_cryptography/discrete_log": "not-re-derived",
  // Argued where it is declared: the ECDLP resource estimates are inside the
  // record's own literature, which is a same-subject argument already written.
  "algorithms/number_theory_and_cryptography/elliptic_curves": "same-subject",
  "algorithms/number_theory_and_cryptography/hidden_shift": "not-re-derived",
  "algorithms/number_theory_and_cryptography/shor": "not-re-derived",
  "algorithms/quantum_differential_equations_solvers/lchs": "not-re-derived",
  "algorithms/quantum_differential_equations_solvers/time_marching": "not-re-derived",
  "algorithms/quantum_linear_solvers/hhl": "not-re-derived",
  "algorithms/quantum_linear_solvers/qsvt_matrix_inversion": "not-re-derived",
  "algorithms/quantum_phase_estimation/qpe_for_matrix": "not-re-derived",
  "algorithms/quantum_state_preparation/adapt_vqe": "not-re-derived",
  "algorithms/quantum_state_preparation/gibbs": "not-re-derived",
  // Argued where it is declared: same graph, same oracle, same Childs et al.
  // construction, two names in the literature for one problem.
  "algorithms/quantum_walks/glued_trees": "same-subject",
  "algorithms/search_and_optimization/QAOA": "not-re-derived",
  "algorithms/search_and_optimization/dqi": "not-re-derived",
  "algorithms/search_and_optimization/grover": "not-re-derived",
  "applications/optimization/variational_quantum_imaginary_time_evolution": "not-re-derived",
  "applications/physical_systems/ising_model": "not-re-derived",

  // The applied block declared 2026-08-12. These ten were each read, and their
  // arguments are written above them in `CLASSIQ_COVERAGE`, so they get real
  // values here.
  //
  // `molecule_eigensolver` states its own subject as finding ground states and
  // energies by VQE, which is the subject of the record's source.
  "applications/chemistry/molecule_eigensolver": "same-subject",
  // Its own declaration calls it "a use of the algorithm rather than a different
  // one": the energy curve is VQE run across internuclear distances, a problem
  // the record's source does not pose.
  "applications/chemistry/molecular_energy_curve": "method-instance",
  // The Lanchester combat model is not in the HHL paper; the demonstration
  // discretizes it into a linear system and solves that with HHL.
  "applications/physical_systems/hhl_lanchester": "method-instance",
  // Grover's paper is unstructured search. Whitebox fuzzing is a choice of search
  // space, not a problem Grover formulates.
  "applications/cybersecurity/whitebox_fuzzing": "method-instance",

  // The six Lucas rows — **the strong ones, and the reason this map exists.**
  // Each pairs a section of arXiv:1302.5843 that formulates that exact problem
  // with a demonstration whose own problem statement is that problem. Read in the
  // paper's full text, not its abstract, which names the problems only as a class.
  "applications/optimization/set_partition": "source-formulates-problem",
  "applications/optimization/max_clique": "source-formulates-problem",
  "applications/optimization/max_independent_set": "source-formulates-problem",
  "applications/optimization/set_cover": "source-formulates-problem",
  "applications/optimization/min_graph_coloring": "source-formulates-problem",
  "applications/cybersecurity/link_monitoring": "source-formulates-problem",

  // The thirteen QAOA rows — **the weak ones.** Farhi formulates MaxCut and none
  // of these thirteen problems. Every one of them is the demonstration running
  // the method the record documents, and nothing more.
  "applications/finance/portfolio_optimization": "method-instance",
  "applications/logistics/facility_location": "method-instance",
  "applications/logistics/vehicle_routing_problem": "method-instance",
  "applications/optimization/electric_grid_optimization": "method-instance",
  "applications/optimization/integer_linear_programming": "method-instance",
  "applications/optimization/kidney_exchange": "method-instance",
  "applications/optimization/max_induced_k_color_subgraph": "method-instance",
  "applications/optimization/max_k_vertex_cover": "method-instance",
  "applications/optimization/minimum_dominating_set": "method-instance",
  "applications/optimization/rectangles_packing": "method-instance",
  "applications/telecom/network_traffic_optimization": "method-instance",
  "applications/telecom/radio_access_network": "method-instance",
  "applications/telecom/resiliency_planning": "method-instance",

  // The three released by reading the code. Arguments where they are declared.
  "applications/chemistry/second_quantized_hamiltonian": "same-subject",
  "applications/CFD/double_slit_experiment": "method-instance",
  "applications/CFD/QLS_for_hybrid_solvers": "method-instance",
};

/**
 * A demonstration this catalog will not carry, why, and who decided.
 *
 * ## Why a decline needs a URL and not just a sentence
 *
 * A gauge that sits one short forever invites every session to re-open the same
 * question, and the cheapest answer each time is to add the record. The reason a
 * row is out has to travel with the row, and it has to be attributable — a
 * sentence an agent wrote and a ruling the owner made read identically once
 * they are both comments.
 *
 * So `ruling` is required and `check-classiq-parity.mjs` fails without it. A
 * decline is the one declaration that makes a gauge look better, which is
 * exactly why it is the one that must name someone outside this repository.
 */
export interface ClassiqDecline {
  /** What the entry is, and why it is not an algorithm this catalog can hold. */
  reason: string;
  /** Where the owner ruled. Required; the check refuses a decline without it. */
  ruling: string;
}

/**
 * Index path → the decline.
 *
 * One row, and it is the last of the 61 `applications/`. The other 60 are
 * covered, so this file's headline is "60 of 61, one declined", not "60 of 61,
 * one missing" — a permanent one-short fraction with no reason attached is how a
 * settled decision gets re-litigated.
 */
export const CLASSIQ_NOT_APPLICABLE: Readonly<Record<string, ClassiqDecline>> = {
  "applications/chemistry/classiq_chemistry_application": {
    reason:
      "The demonstration's own first line states its subject as \"the functionality of Classiq's"
      + " Chemistry application module\" — a vendor software module, not an algorithm. It does run VQE"
      + " with a UCC ansatz, a Hartree-Fock reference state and Z2 symmetry tapering, all of which this"
      + " catalog holds records for; what it does not have is an algorithmic subject of its own. Covering"
      + " it would make this the first row claimed on the strength of a software tour.",
    ruling: "https://github.com/EshMis/ai-ops/issues/61",
  },
};
