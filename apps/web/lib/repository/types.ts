import type { VerificationMethodId } from "./verification";
import type { TopicId } from "./topics";
import type { PortableCircuit } from "../circuit-frameworks";

export type PublicRepositoryCategory = "gates" | "algorithms" | "operators" | "states";
export type PublicRepositoryStatus = "verified" | "verified_caveats" | "community_review";
/**
 * Derived from PUBLIC_REPOSITORY_FRAMEWORKS (bottom of this file) rather than
 * written out again here. The array is the vocabulary; this is a view of it.
 * See the comment on that array for what the second copy cost.
 */
export type PublicRepositoryFramework = (typeof PUBLIC_REPOSITORY_FRAMEWORKS)[number];
export type PublicRepositoryVariantStatus = "native" | "conversion" | "source" | "unsupported";

export interface PublicRepositoryCodeVariant {
  framework: PublicRepositoryFramework;
  status: PublicRepositoryVariantStatus;
  language: "python" | "typescript" | "openqasm" | "text";
  filename: string;
  code: string;
  note?: string;
}

export interface PublicRepositoryCitation {
  title: string;
  authors: string;
  year: string;
  url: string;
  relevance: string;
  relevanceJa: string;
}

/**
 * One row of the side-by-side classical/quantum comparison table (Owner Inbox
 * 2026-07-19: comparisons should carry numbers, complexities, and impact — not
 * just a prose read). `classical` and `quantum` are short cell values (a
 * complexity like `O(N)`, a qubit/gate count, or a concrete figure).
 */
export interface PublicRepositoryComparisonMetric {
  label: string;
  labelJa: string;
  classical: string;
  quantum: string;
}

export interface PublicRepositoryClassicalComparison {
  baseline: string;
  baselineJa: string;
  quantumClaim: string;
  quantumClaimJa: string;
  practicalRead: string;
  practicalReadJa: string;
  /**
   * Optional structured metrics rendered as a classical-vs-quantum table above
   * the prose. Only populated where the figures are textbook-precise; entries
   * without it fall back to the three prose fields alone.
   */
  metrics?: PublicRepositoryComparisonMetric[];
}

/**
 * How a composite gate breaks into more basic gates. Rendered on the gates
 * browser as a per-card expanded/collapsed toggle: `visualization` is the
 * collapsed single-gate form; this is the expanded circuit of basic gates.
 * Atomic gates (single hardware-native primitives) simply omit it.
 */
export interface PublicRepositoryDecomposition {
  /** e.g. "3 × CNOT" — short summary shown beside the toggle. */
  summary: string;
  summaryJa: string;
  wires: string[];
  operations: Array<{ label: string; qubits: number[]; tone: "accent" | "ok" | "warn" | "neutral" }>;
  /** Which identity the expansion uses, one sentence. */
  note?: string;
  noteJa?: string;
}

export interface PublicRepositoryEntry {
  slug: string;
  title: string;
  titleJa: string;
  category: PublicRepositoryCategory;
  categoryLabel: string;
  categoryLabelJa: string;
  algorithmFamily: string;
  framework: PublicRepositoryFramework;
  status: PublicRepositoryStatus;
  /**
   * How the record was verified, classified against the tiered taxonomy in
   * ./verification. Optional in raw data: entries without an explicit list are
   * classified deterministically in public-repository.ts (see
   * deriveVerificationMethods) and audited by scripts/check-repository-data.mjs.
   */
  verificationMethods?: VerificationMethodId[];
  verification: string;
  verificationDetails: {
    method: string;
    result: string;
    caveat?: string;
  };
  exportStatus: string;
  provenance: string;
  updatedAt: string;
  description: string;
  descriptionJa: string;
  introduction: string;
  introductionJa: string;
  explanation: string;
  explanationJa: string;
  /**
   * Long-form explanation in Markdown with TeX math ($...$ / $$...$$), rendered
   * through the KaTeX pipeline on the detail page. Falls back to the plain
   * `explanation` string when absent.
   */
  explanationMd?: string;
  explanationMdJa?: string;
  /**
   * Free-text keywords. Kept, and no longer the thing anybody filters with —
   * 217 of the 307 distinct values here are worn by exactly one entry. See
   * ./topics for the closed vocabulary that replaced them as a filter (R2).
   */
  tags: string[];
  /**
   * The closed vocabulary this entry resolves to. Optional in raw data and
   * classified deterministically in public-repository.ts (see deriveTopics) —
   * the same arrangement `verificationMethods` has used since session 60, for
   * the same reason: a corpus the owner may repopulate wholesale should not
   * carry 283 hand-written labels that a repopulation discards.
   */
  topics?: TopicId[];
  resources: Array<{ label: string; value: string }>;
  metadata: Array<{ label: string; value: string }>;
  source: {
    kind: "curated_reference" | "verified_run" | "community_submission";
    title: string;
    url: string;
    contributor?: string;
    reviewedBy?: string;
    license: string;
  };
  visualization: {
    wires: string[];
    operations: Array<{ label: string; qubits: number[]; tone: "accent" | "ok" | "warn" | "neutral" }>;
    outcomes: Array<{ label: string; probability: number }>;
  };
  decomposition?: PublicRepositoryDecomposition;
  /**
   * Framework-neutral representation for concrete circuits in Leona Quantum's
   * bounded gate subset. Seven framework variants are generated lazily from
   * this record; literature- and operator-only entries intentionally omit it.
   */
  portableCircuit?: PortableCircuit;
  codeVariants: PublicRepositoryCodeVariant[];
  relatedSlugs: string[];
  literature?: PublicRepositoryCitation[];
  classicalComparison?: PublicRepositoryClassicalComparison;
  industryUseCases?: string[];
  industryUseCasesJa?: string[];
}

/**
 * The subset of a record the /repository browse list actually renders and
 * filters on — and therefore the only fields the API's `?view=list` projection
 * sends (Slice E).
 *
 * Why this exists: the full corpus serialises to ~2.37 MB, over Vercel's 2 MB
 * data-cache ceiling, so the 5-minute revalidate on the catalog fetch was inert
 * and every visitor refetched all 283 records. Projected to these fields the
 * same corpus is ~0.91 MB and caches. Everything omitted here (the long-form
 * explanation/introduction prose and its Markdown variants, literature,
 * verificationDetails, source, classicalComparison, industryUseCases,
 * relatedSlugs) is read only by the detail page, which fetches one full record
 * by slug.
 *
 * `PublicRepositoryEntry` is a superset, so a full entry is assignable here and
 * the static-corpus fallback keeps working unchanged. Adding a heavy field to
 * this type means adding it to the API allowlist too — and re-checking the
 * ceiling.
 *
 * This list is a VALUE first and a type second, for the same reason
 * PUBLIC_REPOSITORY_FRAMEWORKS is: a `Pick<>` union exists only at compile
 * time, and the API's `LIST_VIEW_RECORD_FIELDS` is a second copy of it written
 * in another language. A union cannot be compared to a frozenset; a tuple can.
 * `scripts/catalog-bootstrap/from-catalog-validator.test.mjs` asserts the two
 * are set-equal, which is the only thing standing between "a field was added to
 * the entry type" and "the browse list silently stops carrying it, in
 * production only".
 *
 * `as const` is what makes both the type derivation and that comparison work,
 * and it is why nothing may mutate this array in place.
 */
export const PUBLIC_REPOSITORY_LIST_FIELDS = [
  "slug",
  "title",
  "titleJa",
  "category",
  "categoryLabel",
  "categoryLabelJa",
  "algorithmFamily",
  "framework",
  "status",
  "verificationMethods",
  "verification",
  "exportStatus",
  "provenance",
  "updatedAt",
  "description",
  "descriptionJa",
  "tags",
  "topics",
  "resources",
  "metadata",
  "visualization",
  "decomposition",
  "portableCircuit",
  "codeVariants",
] as const;

export type PublicRepositoryListEntry = Pick<
  PublicRepositoryEntry,
  (typeof PUBLIC_REPOSITORY_LIST_FIELDS)[number]
>;

export const PUBLIC_REPOSITORY_CATEGORIES: Array<{
  value: "all" | PublicRepositoryCategory;
  label: string;
  labelJa: string;
}> = [
  { value: "all", label: "All categories", labelJa: "すべてのカテゴリ" },
  { value: "gates", label: "Gates", labelJa: "ゲート" },
  { value: "algorithms", label: "Algorithms", labelJa: "アルゴリズム" },
  { value: "operators", label: "Operators", labelJa: "演算子" },
  { value: "states", label: "States", labelJa: "状態" },
];

/**
 * The framework vocabulary. One list, and the source of the type above — not a
 * copy kept in step with it by hand.
 *
 * Adding a framework here adds it to `PublicRepositoryFramework` and to every
 * runtime check derived from this array, in one edit. It used to be the other
 * way round: the type was written out separately, and repository/from-catalog.ts
 * kept a third copy for validating API records. That copy fell a member behind
 * (it never gained "Qmod"), and the validator's job is to reject anything
 * outside the vocabulary — so a published record whose primary framework was
 * missing from the copy would have been dropped from the API-backed catalog
 * with only a console line to show for it. Derive; do not restate.
 *
 * `as const` is what makes the derivation work, and it is why nothing may
 * mutate this array in place.
 */
export const PUBLIC_REPOSITORY_FRAMEWORKS = [
  "Qiskit",
  "PennyLane",
  "Cirq",
  "CUDA-Q",
  "Amazon Braket",
  "OpenQASM 3.0",
  "PyQuil",
  "Qmod",
] as const;
