// Where every number the workflow planner prints comes from.
//
// ## The rule this file exists to hold
//
// A cost line names a paper in the Atlas paper register (`../repository/
// paper-register.ts`) and the place in that paper the formula sits — an
// equation, a theorem, a table, the abstract. The register is the only place a
// paper's title, authors and link are written; this file stores the id and the
// locator, never a second copy of the metadata, so the two cannot disagree the
// way the corpus and the map once did (see `scripts/check-paper-register.mjs`).
//
// Every entry below was read in the paper's own text on 2026-09-22 before it
// was written here, and six of the fourteen formulas first drafted for this
// module were WRONG when checked: the qubitized phase-estimation count is
// √2·π·λ/ΔE (Babbush et al. 2018, Eq. 26), not π·λ/2ε; Low and Chuang's own
// bound has no log-log term; the counting-register size is Cleve et al.'s
// n + ⌈log₂(1/2ε + 1/2)⌉, not the textbook form; Gidney 2025's logical counts
// are in Table 5, not the abstract. So a formula added here is added the same
// way — from the paper, with its locator — or it is not added.
//
// `quote` is the shortest fragment that pins the formula. It is shown beside
// the number so a reader can find the passage without trusting this file.

export type SourceKey =
  | "bbht-iterations"
  | "bbht-unknown-count"
  | "grover-unique"
  | "cemm-counting-register"
  | "ge2021-logical"
  | "ge2021-headline"
  | "gidney2025-table5"
  | "gidney2025-headline"
  | "roetteler-ecdlp"
  | "babbush2018-queries"
  | "babbush2018-tcount"
  | "babbush2018-ancilla"
  | "babbush2018-chemical-accuracy"
  | "wecker-measurements"
  | "brassard-estimation"
  | "hhl-runtime"
  | "costa-optimal"
  | "costa-constant"
  | "lowchuang-queries"
  | "farhi-qaoa"
  | "babbush2021-quadratic";

export interface PlannerSource {
  /** A row of `PAPER_REGISTER` — asserted by `workflow-planner.test.ts`. */
  paperId: string;
  /** Where in the paper, in the paper's own numbering. */
  locator: string;
  locatorJa: string;
  /** The shortest verbatim fragment that pins the formula. */
  quote: string;
}

export const PLANNER_SOURCES: Record<SourceKey, PlannerSource> = {
  "bbht-iterations": {
    paperId: "arxiv:quant-ph/9605034",
    locator: "Eq. (3) and the iteration count after it",
    locatorJa: "式 (3) とその後の反復回数",
    quote: "the probability of failure after exactly m iterations is … cos²((2m+1)θ) ≤ sin²θ = t/N",
  },
  "bbht-unknown-count": {
    paperId: "arxiv:quant-ph/9605034",
    locator: "Theorem 3 and its proof",
    locatorJa: "定理 3 とその証明",
    quote: "m₀ = 1/sin(2θ) … upper-bounded by 9/2 m₀ … provided 0 < t ≤ 3N/4",
  },
  "grover-unique": {
    paperId: "arxiv:quant-ph/9605043",
    locator: "problem statement",
    locatorJa: "問題設定",
    quote: "let there be a unique state, say S_ν, that satisfies the condition C(S_ν) = 1",
  },
  "cemm-counting-register": {
    paperId: "arxiv:quant-ph/9708016",
    locator: "Appendix C",
    locatorJa: "付録 C",
    quote: "it suffices to use this technique with m = n + ⌈log₂(1/(2ε) + 1/2)⌉ bits",
  },
  "ge2021-logical": {
    paperId: "arxiv:1905.09749",
    locator: "abstract",
    locatorJa: "要旨",
    quote: "uses 3n + 0.002n lg n logical qubits, 0.3n³ + 0.0005n³ lg n Toffolis",
  },
  "ge2021-headline": {
    paperId: "arxiv:1905.09749",
    locator: "title and abstract",
    locatorJa: "表題と要旨",
    quote: "gate error rate of 10⁻³, a surface code cycle time of 1 microsecond, and a reaction time of 10 microseconds",
  },
  "gidney2025-table5": {
    paperId: "arxiv:2505.15917",
    locator: "Table 5",
    locatorJa: "表 5",
    quote: "The Toffolis column is expected Toffolis per factoring (not per shot)",
  },
  "gidney2025-headline": {
    paperId: "arxiv:2505.15917",
    locator: "abstract",
    locatorJa: "要旨",
    quote: "factored in less than a week by a quantum computer with less than a million noisy qubits",
  },
  "roetteler-ecdlp": {
    paperId: "arxiv:1706.06752",
    locator: "abstract",
    locatorJa: "要旨",
    quote: "at most 9n + 2⌈log₂(n)⌉ + 10 qubits … at most 448n³ log₂(n) + 4090n³ Toffoli gates",
  },
  "babbush2018-queries": {
    paperId: "arxiv:1805.03662",
    locator: "Eqs. (24) and (26)",
    locatorJa: "式 (24) と (26)",
    quote: "we will need at most 2^m < √2πλ/ΔE queries to the select oracle",
  },
  "babbush2018-tcount": {
    paperId: "arxiv:1805.03662",
    locator: "Theorem 1",
    locatorJa: "定理 1",
    quote: "a number of T gates scaling as 24√2πNλ/ε + O((λ/ε) log(N/ε))",
  },
  "babbush2018-ancilla": {
    paperId: "arxiv:1805.03662",
    locator: "Eq. (55)",
    locatorJa: "式 (55)",
    quote: "the total ancillae required are … log(4√2πλ³N⁵/ΔE³) + O(1)",
  },
  "babbush2018-chemical-accuracy": {
    paperId: "arxiv:1805.03662",
    locator: "Table VI caption",
    locatorJa: "表 VI の説明文",
    quote: "chemical accuracy which is defined as ΔE = 0.0016 Hartree",
  },
  "wecker-measurements": {
    paperId: "arxiv:1507.08969",
    locator: "Section IV.B, Eq. (15)",
    locatorJa: "IV.B 節、式 (15)",
    quote: "M ≈ (Σᵢ|hᵢ|)² / ε²",
  },
  "brassard-estimation": {
    paperId: "arxiv:quant-ph/0005055",
    locator: "Theorem 12",
    locatorJa: "定理 12",
    quote: "|ã − a| ≤ 2πk√(a(1−a))/M + k²π²/M² with probability at least 8/π² when k=1",
  },
  "hhl-runtime": {
    paperId: "arxiv:0811.3171",
    locator: "Section II",
    locatorJa: "II 節",
    quote: "we obtain the stated runtime of Õ(log(N)s²κ²/ε)",
  },
  "costa-optimal": {
    paperId: "arxiv:2111.08152",
    locator: "Theorem 19",
    locatorJa: "定理 19",
    quote: "produces the normalized state |A⁻¹b⟩ to within error ε using a number O(κ log(1/ε)) of oracle calls",
  },
  "costa-constant": {
    paperId: "arxiv:2111.08152",
    locator: "Section V, after the proof of Theorem 19",
    locatorJa: "V 節、定理 19 の証明の後",
    quote: "one would need about 834κ steps of the adiabatic evolution",
  },
  "lowchuang-queries": {
    paperId: "arxiv:1610.06546",
    locator: "Corollary 16",
    locatorJa: "系 16",
    quote: "can be simulated for time t and error ε with O(αt + log(1/ε)) queries",
  },
  "farhi-qaoa": {
    paperId: "arxiv:1411.4028",
    locator: "Eqs. (2), (6) and (11)",
    locatorJa: "式 (2)、(6)、(11)",
    quote: "|γ, β⟩ = U(B, β_p) U(C, γ_p) ··· U(B, β₁) U(C, γ₁) |s⟩",
  },
  "babbush2021-quadratic": {
    paperId: "arxiv:2011.04149",
    locator: "abstract",
    locatorJa: "要旨",
    quote: "quadratic speedups will not enable quantum advantage on early generations of such fault-tolerant devices",
  },
};

/** Every register id this module cites, for the page to resolve and the test to check. */
export function plannerPaperIds(): string[] {
  return [...new Set(Object.values(PLANNER_SOURCES).map((source) => source.paperId))].sort();
}
