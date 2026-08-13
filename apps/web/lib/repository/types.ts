import type { VerificationMethodId } from "./verification";
import type { TopicId } from "./topics";
import type { PortableCircuit } from "../circuit-frameworks";

/**
 * The four kinds of record, as a runtime tuple.
 *
 * The type is derived from this rather than written beside it, on the same
 * terms as `PUBLIC_REPOSITORY_FRAMEWORKS` below, and for a reason that had
 * already come true twice by the time this was reified: `from-catalog.ts` kept
 * its own hand-written copy because there was no exported list to import, and
 * `?category=` needed a third. A vocabulary written out once per consumer is a
 * vocabulary that drifts silently — nothing fails when a copy is short, the
 * records in the missing category are simply rejected, or hidden, or not
 * addressable, depending on which copy it was.
 *
 * **Not `PUBLIC_REPOSITORY_CATEGORIES`**, which is the browse control's option
 * list and carries an `"all"` sentinel that is not a category. A validator
 * following a UI control would turn hiding a filter into rejecting every record
 * behind it.
 */
export const PUBLIC_REPOSITORY_CATEGORY_IDS = ["gates", "algorithms", "operators", "states"] as const;
export type PublicRepositoryCategory = (typeof PUBLIC_REPOSITORY_CATEGORY_IDS)[number];

export function isPublicRepositoryCategory(value: unknown): value is PublicRepositoryCategory {
  return (
    typeof value === "string" && (PUBLIC_REPOSITORY_CATEGORY_IDS as readonly string[]).includes(value)
  );
}
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

/**
 * What the SOURCE documents, on each of three independent axes — roadmap §3.6,
 * owner direction 2026-08-06.
 *
 * Three-valued on purpose, and the middle value is the whole point:
 *
 * - `reported` — the source documents this axis.
 * - `absent`   — someone read the source and it is not there. A positive claim.
 * - `unknown`  — nobody has checked. The honest default, and NOT the same thing.
 *
 * Collapsing `absent` into `unknown` is the exact failure §3.6 names: the corpus
 * could not distinguish "this paper reports no hardware run" from "nobody looked
 * at whether it does", and both rendered as silence.
 *
 * **This is not `verificationMethods` and must never be derived from it.** That
 * vocabulary says how *Leona* checked a record; this says what the *source*
 * reports. Keeping them apart is the whole value, because the difference between
 * them is the reproduction record (§1.3) — the gap Leona's own runs are meant to
 * close. A derivation from `verificationMethods` would manufacture a claim about
 * a paper out of a claim about us, which is the guess-in-the-hole §3.6 forbids.
 */
export type SourceCoverageStatus = "reported" | "absent" | "unknown";

export const SOURCE_COVERAGE_STATUSES = ["reported", "absent", "unknown"] as const;
export const SOURCE_COVERAGE_AXES = ["theory", "simulation", "hardware"] as const;
export type SourceCoverageAxis = (typeof SOURCE_COVERAGE_AXES)[number];

export type SourceCoverage = Record<SourceCoverageAxis, SourceCoverageStatus>;

/**
 * The six roles a block can play — roadmap §3.1. A gap names the one that is
 * missing, which is what makes the silences countable rather than merely absent.
 */
export const BLOCK_ROLES = [
  "problem",
  "input",
  "input_mapping",
  "algorithm",
  "readout",
  "output",
] as const;
export type BlockRole = (typeof BLOCK_ROLES)[number];

/**
 * Why a role is missing — §3.6's four reasons. The last two are **permanent**
 * and must render as permanent: they are properties of the field or of the
 * paper, not of how much work Leona has done yet.
 */
export const KNOWN_GAP_REASONS = [
  /** The source simply does not specify it. Closable by another source, maybe. */
  "not_stated_in_source",
  /** The source cites a work that does specify it — a `cited` fill is in scope. */
  "closable_from_bibliography",
  /** Permanent: the field genuinely disagrees, and picking one would be editorial. */
  "field_disagrees",
  /** Permanent: the implementation is NISQ-specific to that paper's device. */
  "nisq_specific",
] as const;
export type KnownGapReason = (typeof KNOWN_GAP_REASONS)[number];

/**
 * A declared hole. §3.6's rule, which is the reason this type exists:
 *
 * > **A block may ship with a hole. It may never ship with a guess in the hole.**
 *
 * `citations` carries the work a fill came from, or the work that would close
 * the gap — **that other work's identity**, never the paper being described.
 */
export interface PublicRepositoryKnownGap {
  role: BlockRole;
  reason: KnownGapReason;
  /** One sentence, sourced. An unsourced detail is not a gap, it is a guess. */
  detail: string;
  detailJa: string;
  citations?: PublicRepositoryCitation[];
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
   * carry hand-written labels that a repopulation discards.
   */
  topics?: TopicId[];
  /**
   * What the source documents on each of three axes (§3.6). Optional in raw
   * data and filled to all-`unknown` by the barrel, so every published record
   * carries an explicit object rather than an absent key — `canonicalize`
   * drops undefined-valued keys, and a record with no key would be forever
   * indistinguishable from one that predates the field.
   *
   * Never derived. See the SourceCoverage doc comment for why.
   */
  sourceCoverage?: SourceCoverage;
  /**
   * Declared holes (§3.6). **Deliberately NOT filled in by the barrel**, and
   * this is a correctness decision rather than an oversight — the three states
   * must stay distinguishable:
   *
   * - a non-empty array — this record declares these specific gaps;
   * - `[]` — somebody reviewed this record and found none;
   * - **absent — nobody has looked.**
   *
   * Defaulting to `[]` would collapse the third into the second and make every
   * record assert "reviewed, no gaps" — a false statement in the one field
   * whose entire purpose is honest disclosure. Renderers must distinguish all
   * three; `renderableKnownGaps` in ./coverage exists so they cannot forget.
   */
  knownGaps?: PublicRepositoryKnownGap[];
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
 * and every visitor refetched every record. Projected to these fields the
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
  // Three enum values per record, ~70 bytes — small, fixed-size, and the browse
  // list is where "which axes does the source cover" is worth seeing across the
  // corpus at once.
  "sourceCoverage",
  // Added when the `declared-hole` stance shipped, reversing the call made when
  // this field was introduced one session earlier ("a declared hole is
  // something you read on the entry rather than scan the list for"). That was
  // right about reading and wrong about deriving: `deriveInterface` reads
  // `knownGaps[].role` to decide the stance, the browse control's interface
  // filter is built from those stances, and a field the list does not carry
  // would make every declared hole render as `undeclared` in the one place a
  // reader goes to *find* them — silently, and only in production against a
  // healthy API, which is the failure mode `topics` and this whole allowlist
  // exist because of.
  //
  // The objection it overrides was that this field is unbounded per record, and
  // that objection is real. It is answered with a measurement rather than a
  // judgement: +1,037 bytes over the then-283-record corpus (one record
  // carries gaps, measured 2026-07), and ~290 KB if every record carried one of that size,
  // against 770,397 bytes projected and a 2 MB ceiling. The ceiling is now
  // asserted over the real corpus in
  // scripts/catalog-bootstrap/from-catalog-validator.test.mjs, so growth here
  // fails a test rather than a page.
  "knownGaps",
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
