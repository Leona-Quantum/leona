// Public repository barrel: keeps the import path stable for routes/components
// while the data itself lives in lib/repository/*. Entry content is split into
// per-batch modules so the catalog can grow without one multi-thousand-line file.

import {
  RAW_PUBLIC_REPOSITORY_ENTRIES,
  ADDITIONAL_PUBLIC_REPOSITORY_ENTRIES,
} from "./repository/entries-legacy";
import { GATE_ENTRIES } from "./repository/entries-gates";
import { ALGORITHM_ENTRIES } from "./repository/entries-algorithms";
import { STATE_OPERATOR_ENTRIES } from "./repository/entries-states-operators";
import type {
  PublicRepositoryCodeVariant,
  PublicRepositoryEntry,
  PublicRepositoryFramework,
} from "./repository/types";
import { strongestTier, type VerificationMethodId, type VerificationTier } from "./repository/verification";
import { ENTRY_ENRICHMENT } from "./repository/enrichment";

export type {
  PublicRepositoryCategory,
  PublicRepositoryCitation,
  PublicRepositoryClassicalComparison,
  PublicRepositoryCodeVariant,
  PublicRepositoryEntry,
  PublicRepositoryFramework,
  PublicRepositoryStatus,
  PublicRepositoryVariantStatus,
} from "./repository/types";
export {
  PUBLIC_REPOSITORY_CATEGORIES,
  PUBLIC_REPOSITORY_FRAMEWORKS,
} from "./repository/types";
export {
  VERIFICATION_METHODS,
  VERIFICATION_TIERS,
  getVerificationMethod,
  getVerificationTierInfo,
  strongestTier,
  type VerificationMethodId,
  type VerificationMethodInfo,
  type VerificationTier,
  type VerificationTierInfo,
  type VerificationTone,
} from "./repository/verification";

function replaceLegacyBrand(value: string): string {
  return value
    .replaceAll("Majorana", "Leona Quantum")
    .replaceAll("Nameko", "Leona")
    .replaceAll("Quepo", "Library");
}

function normalizePublicRepositoryText(value: unknown): unknown {
  if (typeof value === "string") return replaceLegacyBrand(value);
  if (Array.isArray(value)) return value.map(normalizePublicRepositoryText);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizePublicRepositoryText(item)]));
  }
  return value;
}

/**
 * Deterministic classification for entries that predate explicit
 * verificationMethods. The rules key off the entry's own verification prose and
 * provenance; per-slug corrections belong in VERIFICATION_OVERRIDES, not here.
 * scripts/check-repository-data.mjs prints the resulting slug → methods table so
 * the classification stays reviewable.
 */
function deriveVerificationMethods(entry: PublicRepositoryEntry): VerificationMethodId[] {
  if (entry.verificationMethods?.length) return entry.verificationMethods;
  const override = VERIFICATION_OVERRIDES[entry.slug];
  if (override) return override;

  const text = `${entry.verification} ${entry.verificationDetails.method} ${entry.verificationDetails.result}`.toLowerCase();
  const methods = new Set<VerificationMethodId>();

  if (entry.status === "community_review" || entry.source.kind === "community_submission") {
    methods.add("community_submission");
  }
  if (/unitary|matrix/.test(text)) methods.add("unitary_equivalence");
  if (/truth[ -]table|basis[ -]state action|reversible classical/.test(text)) methods.add("truth_table");
  if (/statevector|state vector|exact state|exact simulation|exact diag|amplitudes match/.test(text)) {
    methods.add("exact_simulation");
  }
  if (/stabilizer/.test(text)) methods.add("stabilizer_simulation");
  if (/analytic|identity|closed form|derivation/.test(text)) methods.add("direct_math");
  if (/statistical|counts|tvd|shots|sampled/.test(text)) methods.add("statistical_counts");
  if (/small[ -]instance|small sizes|tractable size/.test(text)) methods.add("small_instance");
  if (/sub-block|subblock|module|oracle in isolation/.test(text)) methods.add("subblock");
  if (/echo|inverse test|uncompute/.test(text)) methods.add("echo_inverse");
  if (/invariant|contract|conservation|symmetry check|parse/.test(text)) methods.add("invariant_checks");
  if (/construction|specification|spec-aligned|reference implementation/.test(text)) methods.add("construction");
  if (entry.source.kind === "verified_run") {
    methods.add("statistical_counts");
    methods.add("invariant_checks");
  }
  if (entry.literature?.length) methods.add("research_paper");
  if (!methods.size || (methods.size === 1 && methods.has("community_submission"))) {
    // Every curated legacy record cites an official spec/vendor source.
    methods.add("textbook_citation");
  }
  return [...methods];
}

/**
 * Per-slug corrections where the keyword derivation above misreads the prose.
 * Audited against each entry's own verification text on 2026-07-16: "documented"
 * or "reviewed" records must not claim simulation-grade methods, and toy-circuit
 * checks are small-instance evidence, not exact verification.
 */
const VERIFICATION_OVERRIDES: Record<string, VerificationMethodId[]> = {
  "ghz-state-pennylane": ["exact_simulation", "invariant_checks"],
  "grover-unstructured-search": ["small_instance", "construction", "research_paper"],
  "shor-period-finding": ["community_submission", "construction", "research_paper"],
  "amplitude-estimation": ["small_instance", "construction", "research_paper"],
  "vqe-ground-state-energy": ["small_instance", "invariant_checks", "research_paper"],
  "quantum-phase-estimation": ["small_instance", "construction", "research_paper"],
  "hhl-linear-systems": ["community_submission", "construction", "research_paper"],
  "quantum-kernel-svm": ["community_submission", "small_instance", "invariant_checks", "research_paper"],
  "quantum-teleportation": ["construction", "research_paper"],
  "shor-code-error-correction": ["construction", "research_paper"],
  "surface-code-memory": ["community_submission", "construction", "research_paper"],
  "swap-gate": ["truth_table", "textbook_citation"],
  "deutsch-jozsa-cirq": ["construction", "textbook_citation"],
  "bernstein-vazirani-qiskit": ["construction", "textbook_citation"],
  "simon-query-circuit": ["community_submission", "construction", "textbook_citation"],
  "superdense-coding-circuit": ["construction", "textbook_citation"],
};

const ALL_RAW_ENTRIES: PublicRepositoryEntry[] = [
  ...RAW_PUBLIC_REPOSITORY_ENTRIES,
  ...ADDITIONAL_PUBLIC_REPOSITORY_ENTRIES,
  ...GATE_ENTRIES,
  ...ALGORITHM_ENTRIES,
  ...STATE_OPERATOR_ENTRIES,
];

export const PUBLIC_REPOSITORY_ENTRIES: PublicRepositoryEntry[] = ALL_RAW_ENTRIES.map((raw) => {
  const enriched = { ...raw, ...(ENTRY_ENRICHMENT[raw.slug] ?? {}) };
  const entry = normalizePublicRepositoryText(enriched) as PublicRepositoryEntry;
  return { ...entry, verificationMethods: deriveVerificationMethods(entry) };
});

export function entryVerificationMethods(entry: PublicRepositoryEntry): VerificationMethodId[] {
  return entry.verificationMethods ?? deriveVerificationMethods(entry);
}

export function entryVerificationTier(entry: PublicRepositoryEntry): VerificationTier {
  return strongestTier(entryVerificationMethods(entry));
}

export function getPublicRepositoryEntry(slug: string): PublicRepositoryEntry | undefined {
  return PUBLIC_REPOSITORY_ENTRIES.find((entry) => entry.slug === slug);
}

export function getPublicRepositoryVariant(
  entry: PublicRepositoryEntry,
  framework: PublicRepositoryFramework,
): PublicRepositoryCodeVariant {
  const nativeVariant = entry.codeVariants.find((variant) => variant.framework === framework);
  if (nativeVariant) return nativeVariant;

  return {
    framework,
    status: "conversion",
    language: framework === "OpenQASM 3.0" ? "openqasm" : "python",
    filename: `${entry.slug}-conversion-request.txt`,
    code: "",
    note: `A ${framework} variant is not published for this record yet. The catalog keeps the requested framework visible so conversion work can be reviewed rather than implied.`,
  };
}

const PERSONAL_LIBRARY_FRAMEWORKS: PublicRepositoryFramework[] = ["Qiskit", "PennyLane", "Cirq"];

/**
 * Select the first published framework variant that the personal Library can
 * store today. OpenQASM and future framework-only records remain visible in
 * the catalog, but are not mislabeled as executable Library imports.
 */
export function getPublicRepositoryLibraryVariant(
  entry: PublicRepositoryEntry,
): PublicRepositoryCodeVariant | undefined {
  const candidates = [entry.framework, ...PERSONAL_LIBRARY_FRAMEWORKS];
  return candidates
    .map((framework) => getPublicRepositoryVariant(entry, framework))
    .find((variant) => PERSONAL_LIBRARY_FRAMEWORKS.includes(variant.framework) && variant.status === "native" && Boolean(variant.code));
}
