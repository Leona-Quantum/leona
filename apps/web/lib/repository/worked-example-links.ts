/**
 * Record -> worked-example links (stage 1 of the Atlas worked-example figure).
 *
 * Stage 2 (a sibling branch) adds `apps/web/lib/worked-examples.ts`, exporting
 * `WORKED_EXAMPLES`, and a record page will draw the linked example instead of
 * the hero circuit. This file only carries the verified link data and the
 * lookup — nothing here draws anything yet.
 *
 * The data below is the verified map at
 * `~/Developer/ai-ops/desk/leona/plans/studio-atlas-usefulness-20260915/atlas-example-map.json`,
 * copied in unchanged (99 links over 84 records). Each `evidence` string is a
 * verbatim substring of `record[field]` — `scripts/check-worked-example-links.mjs`
 * asserts that against the live corpus, so this file is data, not a claim: the
 * claim is checked, not trusted. `field` supports one level of nesting with a
 * dot (`"verificationDetails.caveat"`), and a `tags` field is checked against
 * the array's own entries rather than a joined string.
 *
 * The method that produced this map, and its traps (gate cards naming an
 * algorithm in the wrong direction, `shor-code-error-correction` not being
 * Shor's algorithm, `search-with-wildcards` negating the phrases it contains)
 * are in `atlas-example-map.md` beside the JSON. Records affected by those
 * traps are already excluded from the map below.
 */

export type WorkedExampleRelation = "instance" | "component";

export interface WorkedExampleLink {
  readonly exampleId: string;
  readonly relation: WorkedExampleRelation;
  /** A record field name, or a dotted one-level path (e.g. `"verificationDetails.caveat"`). */
  readonly field: string;
  /** A verbatim substring of the named field on the record this key names. */
  readonly evidence: string;
}

/**
 * Exported (not module-private) so `scripts/check-worked-example-links.mjs`
 * can walk every key — including one that does not name a real record, which
 * `workedExampleLinks()` below would otherwise swallow into an empty array.
 */
export const WORKED_EXAMPLE_LINKS: Readonly<Record<string, readonly WorkedExampleLink[]>> =
{
 "abelian-hidden-subgroup": [
  {
   "exampleId": "shor-order-finding-15",
   "relation": "component",
   "field": "description",
   "evidence": "order finding"
  },
  {
   "exampleId": "simon-2",
   "relation": "component",
   "field": "description",
   "evidence": "Simon's problem"
  }
 ],
 "adapt-qaoa": [
  {
   "exampleId": "qaoa-maxcut-4-cycle",
   "relation": "instance",
   "field": "title",
   "evidence": "QAOA"
  }
 ],
 "amplitude-amplification": [
  {
   "exampleId": "grover-3q-101",
   "relation": "instance",
   "field": "algorithmFamily",
   "evidence": "Generalized Grover / amplitude amplification"
  }
 ],
 "amplitude-estimation": [
  {
   "exampleId": "amplitude-estimation-3",
   "relation": "instance",
   "field": "title",
   "evidence": "amplitude estimation"
  },
  {
   "exampleId": "qpe-3-exact",
   "relation": "component",
   "field": "explanation",
   "evidence": "phase estimation"
  }
 ],
 "asian-option-pricing-karhunen-loeve": [
  {
   "exampleId": "amplitude-estimation-3",
   "relation": "instance",
   "field": "algorithmFamily",
   "evidence": "Amplitude estimation"
  }
 ],
 "backtracking-quantum-walk-speedup": [
  {
   "exampleId": "quantum-walk-cycle-4",
   "relation": "instance",
   "field": "title",
   "evidence": "Quantum walk"
  }
 ],
 "bell-state-qiskit": [
  {
   "exampleId": "bell-pair",
   "relation": "instance",
   "field": "title",
   "evidence": "Bell state"
  }
 ],
 "benchmark-bell-pair-ladder-16q": [
  {
   "exampleId": "bell-pair",
   "relation": "instance",
   "field": "tags",
   "evidence": "Bell pair"
  }
 ],
 "benchmark-bell-pair-ladder-4q": [
  {
   "exampleId": "bell-pair",
   "relation": "instance",
   "field": "tags",
   "evidence": "Bell pair"
  }
 ],
 "benchmark-bernstein-vazirani-16q": [
  {
   "exampleId": "bernstein-vazirani-1011",
   "relation": "instance",
   "field": "title",
   "evidence": "Bernstein–Vazirani"
  }
 ],
 "benchmark-bernstein-vazirani-3q": [
  {
   "exampleId": "bernstein-vazirani-1011",
   "relation": "instance",
   "field": "title",
   "evidence": "Bernstein–Vazirani"
  }
 ],
 "benchmark-ghz-chain-16q": [
  {
   "exampleId": "ghz-4",
   "relation": "instance",
   "field": "title",
   "evidence": "GHZ"
  }
 ],
 "benchmark-ghz-chain-3q": [
  {
   "exampleId": "ghz-4",
   "relation": "instance",
   "field": "title",
   "evidence": "GHZ"
  }
 ],
 "benchmark-ising-trotter-16q": [
  {
   "exampleId": "ising-trotter-4",
   "relation": "instance",
   "field": "title",
   "evidence": "Trotter"
  }
 ],
 "benchmark-ising-trotter-3q": [
  {
   "exampleId": "ising-trotter-4",
   "relation": "instance",
   "field": "title",
   "evidence": "Trotter"
  }
 ],
 "benchmark-parity-oracle-16q": [
  {
   "exampleId": "deutsch-jozsa-3",
   "relation": "instance",
   "field": "tags",
   "evidence": "Deutsch–Jozsa"
  }
 ],
 "benchmark-parity-oracle-3q": [
  {
   "exampleId": "deutsch-jozsa-3",
   "relation": "instance",
   "field": "tags",
   "evidence": "Deutsch–Jozsa"
  }
 ],
 "benchmark-qaoa-ring-16q": [
  {
   "exampleId": "qaoa-maxcut-4-cycle",
   "relation": "instance",
   "field": "algorithmFamily",
   "evidence": "QAOA / MaxCut"
  }
 ],
 "benchmark-qaoa-ring-3q": [
  {
   "exampleId": "qaoa-maxcut-4-cycle",
   "relation": "instance",
   "field": "algorithmFamily",
   "evidence": "QAOA / MaxCut"
  }
 ],
 "bernstein-vazirani-qiskit": [
  {
   "exampleId": "bernstein-vazirani-1011",
   "relation": "instance",
   "field": "title",
   "evidence": "Bernstein–Vazirani"
  }
 ],
 "cooling-systems-optimization": [
  {
   "exampleId": "qaoa-maxcut-4-cycle",
   "relation": "instance",
   "field": "algorithmFamily",
   "evidence": "QAOA"
  }
 ],
 "counterfeit-coin-problem": [
  {
   "exampleId": "bernstein-vazirani-1011",
   "relation": "component",
   "field": "introduction",
   "evidence": "Bernstein-Vazirani algorithm"
  },
  {
   "exampleId": "grover-3q-101",
   "relation": "component",
   "field": "introduction",
   "evidence": "amplitude amplification"
  }
 ],
 "decoded-quantum-interferometry": [
  {
   "exampleId": "qft-4q-roundtrip",
   "relation": "component",
   "field": "introduction",
   "evidence": "quantum Fourier transform"
  }
 ],
 "derivative-pricing-resource-threshold": [
  {
   "exampleId": "amplitude-estimation-3",
   "relation": "instance",
   "field": "algorithmFamily",
   "evidence": "Amplitude estimation"
  }
 ],
 "deutsch-jozsa-cirq": [
  {
   "exampleId": "deutsch-jozsa-3",
   "relation": "instance",
   "field": "title",
   "evidence": "Deutsch–Jozsa"
  }
 ],
 "discrete-logarithm": [
  {
   "exampleId": "shor-order-finding-15",
   "relation": "instance",
   "field": "introduction",
   "evidence": "Shor's paper gives efficient randomized quantum algorithms"
  }
 ],
 "electrical-resistance": [
  {
   "exampleId": "quantum-walk-cycle-4",
   "relation": "component",
   "field": "introduction",
   "evidence": "quantum walk"
  },
  {
   "exampleId": "qpe-3-exact",
   "relation": "component",
   "field": "introduction",
   "evidence": "phase estimation"
  }
 ],
 "element-distinctness": [
  {
   "exampleId": "quantum-walk-cycle-4",
   "relation": "instance",
   "field": "title",
   "evidence": "quantum walk"
  },
  {
   "exampleId": "grover-3q-101",
   "relation": "component",
   "field": "introduction",
   "evidence": "Grover's search"
  }
 ],
 "elliptic-curve-discrete-log-resources": [
  {
   "exampleId": "shor-order-finding-15",
   "relation": "instance",
   "field": "description",
   "evidence": "Shor's discrete-logarithm algorithm"
  }
 ],
 "environment-assisted-quantum-walk": [
  {
   "exampleId": "quantum-walk-cycle-4",
   "relation": "instance",
   "field": "title",
   "evidence": "quantum walks"
  }
 ],
 "exponential-congruences": [
  {
   "exampleId": "shor-order-finding-15",
   "relation": "component",
   "field": "introduction",
   "evidence": "Shor's algorithm"
  },
  {
   "exampleId": "grover-3q-101",
   "relation": "component",
   "field": "introduction",
   "evidence": "Grover search"
  }
 ],
 "gauss-sum-estimation": [
  {
   "exampleId": "shor-order-finding-15",
   "relation": "component",
   "field": "introduction",
   "evidence": "Shor's discrete-logarithm algorithm"
  },
  {
   "exampleId": "grover-3q-101",
   "relation": "component",
   "field": "introduction",
   "evidence": "amplitude amplification"
  }
 ],
 "ghz-state-pennylane": [
  {
   "exampleId": "ghz-4",
   "relation": "instance",
   "field": "title",
   "evidence": "GHZ state"
  },
  {
   "exampleId": "bell-pair",
   "relation": "component",
   "field": "introduction",
   "evidence": "Bell-state"
  }
 ],
 "graph-collision": [
  {
   "exampleId": "quantum-walk-cycle-4",
   "relation": "component",
   "field": "introduction",
   "evidence": "Ambainis's quantum walk"
  }
 ],
 "group-order-and-membership": [
  {
   "exampleId": "shor-order-finding-15",
   "relation": "component",
   "field": "verificationDetails.caveat",
   "evidence": "quantum algorithms for discrete log"
  }
 ],
 "grover-unstructured-search": [
  {
   "exampleId": "grover-3q-101",
   "relation": "instance",
   "field": "title",
   "evidence": "Grover"
  }
 ],
 "hamiltonian-simulation-ising": [
  {
   "exampleId": "ising-trotter-4",
   "relation": "instance",
   "field": "algorithmFamily",
   "evidence": "product formula"
  }
 ],
 "heat-equation-solver": [
  {
   "exampleId": "amplitude-estimation-3",
   "relation": "component",
   "field": "introduction",
   "evidence": "amplitude estimation"
  }
 ],
 "hhl-linear-systems": [
  {
   "exampleId": "qpe-3-exact",
   "relation": "component",
   "field": "explanationMd",
   "evidence": "quantum phase estimation"
  }
 ],
 "hidden-nonlinear-structures": [
  {
   "exampleId": "qft-4q-roundtrip",
   "relation": "component",
   "field": "introduction",
   "evidence": "Fourier transform"
  }
 ],
 "hidden-shift-problem": [
  {
   "exampleId": "hidden-shift-4",
   "relation": "instance",
   "field": "title",
   "evidence": "Hidden shift"
  }
 ],
 "hybrid-hhl-portfolio-optimization": [
  {
   "exampleId": "qpe-3-exact",
   "relation": "component",
   "field": "explanation",
   "evidence": "phase estimation"
  }
 ],
 "hypercube-dynamic-programming": [
  {
   "exampleId": "grover-3q-101",
   "relation": "component",
   "field": "introduction",
   "evidence": "Grover's search"
  }
 ],
 "irreducible-representation-matrix-elements": [
  {
   "exampleId": "qft-4q-roundtrip",
   "relation": "instance",
   "field": "algorithmFamily",
   "evidence": "Quantum Fourier transform"
  }
 ],
 "iterative-phase-estimation": [
  {
   "exampleId": "qpe-3-exact",
   "relation": "instance",
   "field": "title",
   "evidence": "Iterative phase estimation"
  }
 ],
 "low-autocorrelation-binary-sequences-problem": [
  {
   "exampleId": "qaoa-maxcut-4-cycle",
   "relation": "instance",
   "field": "title",
   "evidence": "QAOA"
  }
 ],
 "matrix-commutativity-testing": [
  {
   "exampleId": "quantum-walk-cycle-4",
   "relation": "instance",
   "field": "title",
   "evidence": "quantum walk"
  }
 ],
 "matrix-product-verification": [
  {
   "exampleId": "quantum-walk-cycle-4",
   "relation": "instance",
   "field": "title",
   "evidence": "quantum walk"
  }
 ],
 "molecular-energy-phase-estimation": [
  {
   "exampleId": "qpe-3-exact",
   "relation": "instance",
   "field": "title",
   "evidence": "phase estimation"
  }
 ],
 "nand-tree-evaluation": [
  {
   "exampleId": "quantum-walk-cycle-4",
   "relation": "component",
   "field": "introduction",
   "evidence": "continuous-time quantum walk"
  }
 ],
 "operator-trotter-product": [
  {
   "exampleId": "ising-trotter-4",
   "relation": "instance",
   "field": "title",
   "evidence": "Trotter product"
  }
 ],
 "option-pricing-amplitude-estimation": [
  {
   "exampleId": "amplitude-estimation-3",
   "relation": "instance",
   "field": "title",
   "evidence": "amplitude estimation"
  }
 ],
 "pell-equation-regulator": [
  {
   "exampleId": "shor-order-finding-15",
   "relation": "instance",
   "field": "introduction",
   "evidence": "period finding"
  }
 ],
 "principal-ideal-problem": [
  {
   "exampleId": "shor-order-finding-15",
   "relation": "instance",
   "field": "introduction",
   "evidence": "Shor's discrete-logarithm algorithm"
  }
 ],
 "protein-folding-quantum-walk": [
  {
   "exampleId": "quantum-walk-cycle-4",
   "relation": "instance",
   "field": "title",
   "evidence": "quantum walk"
  }
 ],
 "qaoa-combinatorial-optimization": [
  {
   "exampleId": "qaoa-maxcut-4-cycle",
   "relation": "instance",
   "field": "algorithmFamily",
   "evidence": "QAOA"
  }
 ],
 "qaoa-in-qaoa": [
  {
   "exampleId": "qaoa-maxcut-4-cycle",
   "relation": "instance",
   "field": "title",
   "evidence": "QAOA"
  }
 ],
 "qaoa-maxcut-ring": [
  {
   "exampleId": "qaoa-maxcut-4-cycle",
   "relation": "instance",
   "field": "title",
   "evidence": "QAOA"
  }
 ],
 "qft-resource-screen": [
  {
   "exampleId": "qft-4q-roundtrip",
   "relation": "instance",
   "field": "title",
   "evidence": "QFT"
  }
 ],
 "quantum-counting": [
  {
   "exampleId": "grover-3q-101",
   "relation": "component",
   "field": "introduction",
   "evidence": "Grover's amplitude amplification"
  },
  {
   "exampleId": "qpe-3-exact",
   "relation": "component",
   "field": "introduction",
   "evidence": "phase estimation"
  }
 ],
 "quantum-fourier-transform": [
  {
   "exampleId": "qft-4q-roundtrip",
   "relation": "instance",
   "field": "title",
   "evidence": "Quantum Fourier Transform"
  }
 ],
 "quantum-phase-estimation": [
  {
   "exampleId": "qpe-3-exact",
   "relation": "instance",
   "field": "title",
   "evidence": "Quantum phase estimation"
  },
  {
   "exampleId": "qft-4q-roundtrip",
   "relation": "component",
   "field": "introduction",
   "evidence": "inverse QFT"
  }
 ],
 "quantum-primality-test-order-finding": [
  {
   "exampleId": "shor-order-finding-15",
   "relation": "instance",
   "field": "title",
   "evidence": "order finding"
  }
 ],
 "quantum-simulated-annealing": [
  {
   "exampleId": "quantum-walk-cycle-4",
   "relation": "component",
   "field": "introduction",
   "evidence": "quantum walks"
  }
 ],
 "quantum-teleportation": [
  {
   "exampleId": "teleportation-deferred",
   "relation": "instance",
   "field": "title",
   "evidence": "Quantum teleportation"
  },
  {
   "exampleId": "bell-pair",
   "relation": "component",
   "field": "introduction",
   "evidence": "Bell pair"
  }
 ],
 "quantum-walk-line": [
  {
   "exampleId": "quantum-walk-cycle-4",
   "relation": "instance",
   "field": "title",
   "evidence": "quantum walk"
  }
 ],
 "rainbow-options-amplitude-loading": [
  {
   "exampleId": "amplitude-estimation-3",
   "relation": "instance",
   "field": "algorithmFamily",
   "evidence": "Amplitude estimation"
  }
 ],
 "risk-analysis-amplitude-estimation": [
  {
   "exampleId": "amplitude-estimation-3",
   "relation": "instance",
   "field": "title",
   "evidence": "amplitude estimation"
  }
 ],
 "semidefinite-programming": [
  {
   "exampleId": "grover-3q-101",
   "relation": "component",
   "field": "introduction",
   "evidence": "Grover search"
  },
  {
   "exampleId": "amplitude-estimation-3",
   "relation": "component",
   "field": "introduction",
   "evidence": "amplitude estimation"
  }
 ],
 "shor-period-finding": [
  {
   "exampleId": "shor-order-finding-15",
   "relation": "instance",
   "field": "title",
   "evidence": "Shor period finding"
  },
  {
   "exampleId": "qpe-3-exact",
   "relation": "component",
   "field": "explanation",
   "evidence": "Quantum phase estimation"
  }
 ],
 "sparse-matrix-power-diagonal-entries": [
  {
   "exampleId": "qpe-3-exact",
   "relation": "component",
   "field": "introduction",
   "evidence": "phase estimation"
  }
 ],
 "spectral-sum-estimation": [
  {
   "exampleId": "qpe-3-exact",
   "relation": "component",
   "field": "introduction",
   "evidence": "phase estimation"
  }
 ],
 "string-pattern-matching": [
  {
   "exampleId": "grover-3q-101",
   "relation": "component",
   "field": "introduction",
   "evidence": "Grover's algorithm used together with"
  }
 ],
 "subset-finding-quantum-walk": [
  {
   "exampleId": "quantum-walk-cycle-4",
   "relation": "instance",
   "field": "title",
   "evidence": "quantum walk"
  },
  {
   "exampleId": "grover-3q-101",
   "relation": "component",
   "field": "introduction",
   "evidence": "Grover diffusion operators"
  }
 ],
 "subset-sum-quantum-walk": [
  {
   "exampleId": "quantum-walk-cycle-4",
   "relation": "instance",
   "field": "title",
   "evidence": "quantum walk"
  }
 ],
 "superdense-coding-circuit": [
  {
   "exampleId": "superdense-coding",
   "relation": "instance",
   "field": "title",
   "evidence": "Superdense coding"
  },
  {
   "exampleId": "bell-pair",
   "relation": "component",
   "field": "explanation",
   "evidence": "Bell pair"
  }
 ],
 "tensor-hypercontraction-block-encoding": [
  {
   "exampleId": "qpe-3-exact",
   "relation": "component",
   "field": "introduction",
   "evidence": "phase estimation"
  }
 ],
 "tensor-principal-component-analysis": [
  {
   "exampleId": "grover-3q-101",
   "relation": "component",
   "field": "introduction",
   "evidence": "amplitude amplification"
  }
 ],
 "top-eigenvector-estimation": [
  {
   "exampleId": "qpe-3-exact",
   "relation": "instance",
   "field": "introduction",
   "evidence": "Gaussian phase estimation"
  }
 ],
 "trotter-suzuki-simulation": [
  {
   "exampleId": "ising-trotter-4",
   "relation": "instance",
   "field": "title",
   "evidence": "Trotter"
  }
 ],
 "viterbi-decoding-convolutional-codes": [
  {
   "exampleId": "grover-3q-101",
   "relation": "instance",
   "field": "algorithmFamily",
   "evidence": "Generalized Grover / amplitude amplification"
  }
 ],
 "w-state": [
  {
   "exampleId": "w-state-3",
   "relation": "instance",
   "field": "title",
   "evidence": "W state"
  }
 ],
 "welded-tree-traversal": [
  {
   "exampleId": "quantum-walk-cycle-4",
   "relation": "instance",
   "field": "title",
   "evidence": "quantum walk"
  }
 ],
 "zeta-function-of-a-curve": [
  {
   "exampleId": "shor-order-finding-15",
   "relation": "component",
   "field": "introduction",
   "evidence": "Shor-type Fourier-sampling method"
  }
 ]
};

export function workedExampleLinks(slug: string): readonly WorkedExampleLink[] {
  return WORKED_EXAMPLE_LINKS[slug] ?? [];
}
