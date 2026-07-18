import type { VerificationMethodId } from "./verification";
import type { PortableCircuit } from "../circuit-frameworks";

export type PublicRepositoryCategory = "gates" | "algorithms" | "operators" | "states";
export type PublicRepositoryStatus = "verified" | "verified_caveats" | "community_review";
export type PublicRepositoryFramework =
  | "Qiskit"
  | "PennyLane"
  | "Cirq"
  | "CUDA-Q"
  | "Amazon Braket"
  | "OpenQASM 3.0"
  | "PyQuil";
export type PublicRepositoryVariantStatus = "native" | "conversion" | "unsupported";

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

export interface PublicRepositoryClassicalComparison {
  baseline: string;
  baselineJa: string;
  quantumClaim: string;
  quantumClaimJa: string;
  practicalRead: string;
  practicalReadJa: string;
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
  tags: string[];
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

export const PUBLIC_REPOSITORY_FRAMEWORKS: PublicRepositoryFramework[] = [
  "Qiskit",
  "PennyLane",
  "Cirq",
  "CUDA-Q",
  "Amazon Braket",
  "OpenQASM 3.0",
  "PyQuil",
];
