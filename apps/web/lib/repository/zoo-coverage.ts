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
