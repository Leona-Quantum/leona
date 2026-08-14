// Which Quantum Algorithm Zoo entries this catalog already covered before the
// Zoo-parity intake, and which it deliberately does not.
//
// The intake's own records declare their coverage from their own data
// (`ZOO_PARITY_COVERAGE` in ./entries-zoo-parity.ts), so that half cannot drift.
// This file carries the half that has to be stated by hand: records written long
// before anyone diffed the catalog against the Zoo, and entries a future unit
// decides are out of scope.
//
// **Both maps are checked, not trusted.** `scripts/check-zoo-parity.mjs` fails if
// a slug named here is not in the corpus, or if a Zoo entry named here is not in
// the pinned index — the two ways a hand-written list rots silently. What it does
// NOT do is fail on the coverage *number*: a gauge that fails the build invites
// the cheapest way to green it, and the cheapest way here is to declare the
// remainder not-applicable.
//
// A `notApplicable` entry must give a reason a reader can disagree with. The list
// is empty on purpose today: at the first reading, 8 of the Zoo's 60 entries were
// covered and 52 were missing, and calling any of those 52 out of scope before a
// unit has looked at it would be scoring the gauge rather than reading it.

/** Zoo entry name (verbatim from the pinned index) → slugs that already cover it. */
export const ZOO_LEGACY_COVERAGE: Readonly<Record<string, readonly string[]>> = {
  "Factoring": ["shor-period-finding"],
  // A record may cover a strand of a heading as well as its own row, and Shor is
  // one of the 23 papers "Quantum Cryptanalysis" cites. majorana PR 503 said so in prose —
  // "carried by the existing shor-period-finding and discrete-logarithm records" —
  // but did not declare it, so the strand join saw one strand where the argument
  // claimed three. Prose that the gauge cannot read is prose the next session
  // inherits without the number.
  "Quantum Cryptanalysis": ["shor-period-finding", "discrete-logarithm"],
  "Searching": ["grover-unstructured-search", "amplitude-amplification"],
  "Bernstein-Vazirani": ["bernstein-vazirani-qiskit"],
  "Deutsch-Jozsa": ["deutsch-jozsa-cirq"],
  "Simulating Quantum Hamiltonian Dynamics": [
    "trotter-suzuki-simulation",
    "hamiltonian-simulation-ising",
    "linear-combination-unitaries",
  ],
  "Quantum Approximate Optimization": ["qaoa-maxcut-ring"],
  "Linear Systems": ["hhl-linear-systems", "quantum-singular-value-transformation"],
  "Preparing Eigenstates and Thermal States": ["qite-imaginary-time", "vqe-ground-state-energy"],
};

/** Zoo entry name → why this catalog does not carry it. Empty by design; see the header. */
export const ZOO_NOT_APPLICABLE: Readonly<Record<string, string>> = {};

/**
 * What KIND of thing a Zoo row is — and therefore what covering it would mean.
 *
 * ## The defect this exists to remove
 *
 * `check-zoo-parity.mjs` used to mark a row covered when one or more records
 * named it. For a row that is one result that is exactly right. But 35 of the
 * Zoo's 74 rows are **subject headings**: "Quantum Cryptanalysis" cites 23
 * papers across isogeny, lattice, multivariate, Grover and superposition-query
 * attacks, and "Machine Learning" cites 56. One record covering one strand made
 * the whole heading read as closed, so `n/74` meant a different thing on every
 * row and rose fastest exactly where coverage was thinnest.
 *
 * Nothing was mis-stated when that was the arithmetic — majorana PR 503 declared its two
 * headings as unions in prose, which is the right doctrine (ADR-0026). Prose is
 * not a denominator, though, and the next session inherits the number rather than
 * the paragraph.
 *
 * ## Why the shape is declared and the strands are derived
 *
 * A row's shape is a judgement about the Zoo's own text, so it is **declared**,
 * with a reason a later reader can disagree with. How much of a heading this
 * repository actually carries is a fact about our citations, so it is
 * **derived**: the checker joins each row's references against the papers our
 * covering records cite, and prints the fraction. A declared strand count would
 * be a second thing to keep true; a derived one cannot drift from the corpus.
 *
 * A `union` row is therefore never "closed" by this gauge. It reports as
 * **partial** with its derived fraction, and closing one takes an argument
 * somebody has to write down, not a record somebody has to add.
 *
 * ## `unreviewed` is a state, not a gap
 *
 * Leaving a row out is not available: `check-zoo-parity.mjs` fails on any row of
 * the pinned index with no entry here. A row nobody has judged says
 * `unreviewed`, which never counts as closed, so the cheapest way to raise the
 * headline is to read the Zoo entry rather than to stay quiet.
 *
 * ## How these 74 were judged, and where that is weakest
 *
 * Each row was read from the Zoo's own description text against one criterion:
 * *would a reader seeing a single catalog record for this row be misled about
 * what the row contains?* Two independent passes ran over the 60 rows the old
 * (broken) parse produced and agreed on 58. **The two they split on are
 * `unreviewed` here, with both readings recorded** — a contested judgement is
 * not a decided one. The 14 rows the old parse never produced had one pass only.
 */
export type ZooRowShape =
  /** One problem, one algorithm. A record cited to its primary reference covers it. */
  | { kind: "result"; reason: string }
  /** A subject heading over distinct results. Coverage is a union and reports as partial. */
  | { kind: "union"; reason: string }
  /** Nobody has judged this row, or two passes disagreed. Never counts as closed. */
  | { kind: "unreviewed"; contested?: string };

/** Zoo entry name (verbatim from the pinned index) → what kind of row it is. */
export const ZOO_ROW_SHAPE: Readonly<Record<string, ZooRowShape>> = {
  "Factoring": { kind: "unreviewed", contested: "one pass read Shor as the entry's single result; the other split GLFB15's semiprime-only algorithm and post-quantum RSA's Grover-accelerated ECM as separate algorithms for the same problem" },
  "Discrete-log": { kind: "result", reason: "elliptic curves arrive \"by similar techniques\" and semigroups as an \"extension\" — Shor's algorithm over other groups, not other algorithms" },
  "Pell's Equation": { kind: "result", reason: "Hallgren's algorithm is the only one; the factoring reduction and the Buchmann-Williams break are consequences of it" },
  "Principal Ideal": { kind: "result", reason: "Schmidt uses fewer qubits and Biasse-Song extends Hallgren to arbitrary degree — both refine the same principal-ideal algorithm" },
  "Unit Group": { kind: "result", reason: "Schmidt-Vollmer is an independent discovery of Hallgren's result; EHKS14 and Biasse-Song only improve its scaling in the degree" },
  "Class Group": { kind: "result", reason: "one task, generators of the class group; Biasse-Song only makes Hallgren's runtime polynomial in the degree" },
  "Gauss Sums": { kind: "union", reason: "Geraci's Potts-model partition functions are a different problem with their own reference, not a faster Gauss-sum method" },
  "Primality Proving": { kind: "result", reason: "Donis-Vela and Garcia-Escartin is named the fastest and explicitly supersedes the earlier factoring-based quantum method" },
  "Solving Exponential Congruences": { kind: "result", reason: "van Dam and Shparlinski is the only algorithm; discrete log and search are subroutines inside it" },
  "Matrix Elements and Multiplicity Coefficients of Group Representations": { kind: "union", reason: "the title's conjunction is real: irrep matrix elements and Kronecker-coefficient approximation are different problems by different authors" },
  "Verifying Matrix Products": { kind: "result", reason: "Buhrman-Spalek only improves Ambainis's exponent for the same AB=C decision; Szegedy supplies the walk framework" },
  "Subset-sum": { kind: "result", reason: "Bernstein, Jeffery, Lange and Meurer is the sole quantum algorithm; element distinctness is its subroutine and Becker-Coron-Joux the classical baseline" },
  "Decoding": { kind: "union", reason: "convolutional codes and simplex codes are two code families with two algorithms, neither derived from the other" },
  "Quantum Cryptanalysis": { kind: "union", reason: "the entry says attacks \"fall into three categories\", then enumerates isogeny, lattice, multivariate, Grover and superposition-query attacks separately" },
  "Searching": { kind: "union", reason: "spatial search on graphs and Durr-Hoyer minimum finding are separate problems, not refinements of Grover's unstructured search" },
  "Abelian Hidden Subgroup": { kind: "result", reason: "one algorithm; Simon, Beaudrap, Hales-Hallgren and SW07 are special cases or relaxed-oracle variants of it" },
  "Non-Abelian Hidden Subgroup": { kind: "union", reason: "Kuperberg's subexponential dihedral sieve is a distinct algorithm from the query-efficient but computationally inefficient general solution" },
  "Bernstein-Vazirani": { kind: "result", reason: "recursive Fourier sampling is a recursion on the same problem from the same paper; the correlation-detection papers are introduced as related work" },
  "Deutsch-Jozsa": { kind: "result", reason: "Deutsch-Jozsa generalises Deutsch's n=1 case on the same promise problem; G14 is explicitly a pedagogical example" },
  "Formula Evaluation": { kind: "unreviewed", contested: "one pass read the span-program line as one culminating result; the other split non-Boolean formulas and formulas with repeated inputs as separate problems" },
  "Hidden Shift": { kind: "union", reason: "multiplicative characters, nonlinear Boolean functions and hidden multiple shift are separate problems with unrelated algorithms" },
  "Polynomial interpolation": { kind: "union", reason: "univariate, multivariate, quadratic-character and e-th-power interpolation are separate oracle problems, each with its own algorithm" },
  "Pattern matching": { kind: "union", reason: "worst-case Grover matching, average-case sieve matching and the written-out qubit input model are three algorithms in different models" },
  "Ordered Search": { kind: "result", reason: "every reference attacks the same ordered-search problem and only shaves the constant on log N" },
  "Graph Properties in the Adjacency Matrix Model": { kind: "union", reason: "spanning trees, bipartiteness, tree minors, triangle finding and hypergraph subgraphs are separate problems with separate algorithms" },
  "Graph Properties in the Adjacency List Model": { kind: "union", reason: "Ambainis-Childs-Liu's property testing and Durr's spanning-tree and shortest-path results are unrelated" },
  "Welded Tree": { kind: "result", reason: "Childs et al.'s traversal is the entry's only algorithm; the rest is problem setup for that one graph family" },
  "Collision Finding and Element Distinctness": { kind: "union", reason: "collision, element distinctness, k-distinctness, claw finding and frequency moments are separate problems each with its own references" },
  "Graph Collision": { kind: "result", reason: "every cited bound solves the same graph-collision problem; the later papers only sharpen it for special graph classes" },
  "Matrix Commutativity": { kind: "result", reason: "Itakura's algorithm is the entry's sole result; the classical lower bound is a baseline" },
  "Group Commutativity": { kind: "result", reason: "Magniez and Nayak's bound is the only quantum result; Pak's classical algorithm is the baseline" },
  "Hidden Nonlinear Structures": { kind: "union", reason: "Childs's polynomial-defined hidden subsets and Decker et al.'s \"related problems\" are separate results, neither derived from the other" },
  "Center of Radial Function": { kind: "result", reason: "Liu's curvelet-transform algorithm is the only one; the classical lower bound is context" },
  "Group Order and Membership": { kind: "union", reason: "Babai's matrix-group algorithm works in a non-oracular model, distinct from the Mosca and Watrous hidden-subgroup reductions" },
  "Group Isomorphism": { kind: "union", reason: "Zatloukal's group-extension equivalence is a different problem, not a wider group class like Le Gall's extension of Cheung-Mosca" },
  "Statistical Difference": { kind: "result", reason: "only Bravyi's L1-distance algorithm carries a reference; uniformity and orthogonality share it and M15b improves the same task" },
  "Finite Rings and Ideals": { kind: "union", reason: "additive decomposition, ideal generators and polynomial identity testing over a black-box ring are three separately cited problems" },
  "Counterfeit Coins": { kind: "result", reason: "Iwama et al.'s algorithm builds on Terhal and Smolin; no second problem appears" },
  "Matrix Rank": { kind: "result", reason: "Belovs's algorithm is the only one; the determinant is its special case and Dorn only lower-bounds it" },
  "Matrix Multiplication over Semirings": { kind: "union", reason: "the Grover schoolbook product covers all semirings, but the output-sparse Boolean product is a separate problem and algorithm" },
  "Subset finding": { kind: "result", reason: "Childs and Eisenberg generalise element distinctness; Belovs-Spalek only supplies a matching lower bound" },
  "Search with Wildcards": { kind: "result", reason: "the Pretty Good Measurement bound is the only algorithm here; the group-testing speedup is explicitly handed to another entry" },
  "Network flows": { kind: "union", reason: "maximum flow and maximal matching are different problems with different runtimes, given together in one paper" },
  "Electrical Resistance": { kind: "result", reason: "Wang's two techniques and the span-program bounds all target the same resistance estimation, differing only in method and query model" },
  "Junta Testing and Group Testing": { kind: "union", reason: "junta testing and gapped group testing are separate problems with separate prior-work chains" },
  "Simulating Quantum Hamiltonian Dynamics": { kind: "union", reason: "sparse, LCU, time-dependent, lattice-local, chemistry, open-system and field-theory simulation are distinct algorithms, not refinements of one" },
  "Preparing Eigenstates and Thermal States": { kind: "union", reason: "ground states, thermal states, master-equation equilibria and tensor-network states are four targets with disjoint reference sets" },
  "Knot Invariants": { kind: "union", reason: "Jones and HOMFLY approximation, Betti numbers, Khovanov homology, the planar Tutte polynomial and quantum-double invariants are distinct" },
  "Three-manifold Invariants": { kind: "union", reason: "Garnerone's WRT algorithm takes a surgery presentation and predates the Turaev-Viro completeness result; neither derives from the other" },
  "Partition Functions": { kind: "union", reason: "Tutte-polynomial approximation, thermalization-based estimation and the quantum-walk speedup are separate algorithms, not improvements of one" },
  "Zeta Functions": { kind: "result", reason: "Kedlaya's curve algorithm is the only algorithm; van Dam contributes a conjecture, not a second result" },
  "Weight Enumerators": { kind: "result", reason: "the QWGT sign problem's BQP-completeness is the sole result; the Ising and Potts references only note a relation" },
  "Simulated Annealing": { kind: "result", reason: "Somma et al.'s sampling result is the algorithm; M15b adds further quantum-walk methods for the same MCMC task" },
  "String Rewriting": { kind: "union", reason: "the graph-path and random-walk completeness results are different problems from string rewriting, with their own reference" },
  "Matrix Powers": { kind: "result", reason: "one result, the PromiseBQP-completeness of approximating a matrix power's entry, with the off-diagonal case in the same paper" },
  "Probabilistic Sampling": { kind: "union", reason: "the polynomial-speedup sampling algorithms with practical applications are a separate result from the hardness-based supremacy sampling" },
  "Polynomial Quantum Speedups for Constraint Satisfaction Problems": { kind: "union", reason: "3-SAT, QUBO via semidefinite programming and the backtracking speedup are unrelated algorithms for different problems" },
  "Adiabatic Algorithms": { kind: "union", reason: "beyond the general framework it lists distinct algorithms for PageRank, Hadamard matrices, linear systems and graph problems, each separately cited" },
  "Quantum Approximate Optimization": { kind: "result", reason: "QAOA is the only algorithm; the classical baseline beating it and the power analyses are all about QAOA" },
  "Gradient Estimation and Learning Polynomials": { kind: "union", reason: "single-query gradient estimation and extracting all the matrix elements of a quadratic form are different problems with separate references" },
  "Semidefinite Programming": { kind: "result", reason: "one SDP solver, improved twice; Gibbs sampling is an ingredient and the dequantization a limit, not separate results" },
  "Convex Optimization": { kind: "union", reason: "volume estimation, finite-field polynomial extraction, linear programming and Hamming-basin minima are four unrelated algorithms" },
  "Optimization by Decoded Quantum Interferometry": { kind: "result", reason: "DQI is the single algorithm; the later papers extend it and the two non-DQI results are named only as related work" },
  "Linear Systems": { kind: "union", reason: "the O(log n)-qubit matrix inversion optimises space rather than extending HHL's runtime result, and the applications carry their own papers" },
  "Estimating Determinants and Other Spectral Sums": { kind: "result", reason: "phase estimation on the maximally mixed state is the only method; the second reference gives further exposition and analysis" },
  "Machine Learning": { kind: "union", reason: "adiabatic classifier training, persistent-homology data analysis, Boltzmann-machine training and noisy-oracle learning are unrelated algorithms" },
  "Tensor Principal Component Analysis": { kind: "result", reason: "one reference and one algorithm; spiked-tensor recovery is the single stated problem" },
  "Solving Linear Differential Equations": { kind: "union", reason: "the entry states outright that the two wave-equation algorithms solve non-equivalent problems, and coupled oscillators are a separate result" },
  "Solving Nonlinear Differential Equations": { kind: "union", reason: "the Vlasov equation and the finance and fluid-dynamics Monte Carlo replacements solve different problems from Carleman linearization" },
  "Quantum Dynamic Programming for path-in-the-hypercube": { kind: "result", reason: "one primitive from one paper; the travelling-salesman, bandwidth and set-cover timings are that paper's applications of it" },
  "Computing the Principal Eigenvector": { kind: "result", reason: "a single paper and a single problem, with only a classical runtime for comparison" },
  "Approximating Nash Equilibria": { kind: "result", reason: "one problem; the earlier quantum result is the one this improves on" },
  "Lattice Problems by Filtering": { kind: "result", reason: "one filtering algorithm; Regev and Aharonov-Ta-Shma supply the reduction it is built on" },
  "Double-bracket quantum algorithms": { kind: "union", reason: "diagonalization, ground-state preparation and unitary synthesis are different tasks sharing only the double-bracket framework" },
};
