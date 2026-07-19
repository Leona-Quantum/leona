// Validation boundary between the API's public catalog and the typed corpus the
// /repository UI renders.
//
// `PublicCatalogEntry.record` is an untyped blob by contract — the API stores the
// canonical JSON of a PublicRepositoryEntry and hands it back verbatim, but it is
// declared `dict[str, Any] | None` and is explicitly allowed to be null (absent,
// oversized, or unparseable server-side). Nothing downstream should trust it, so
// every field the UI actually reads is checked here and a record that fails is
// dropped rather than rendered half-formed.
//
// The manifest is generated from the fully-processed PUBLIC_REPOSITORY_ENTRIES
// (scripts/generate-catalog-bootstrap-manifest.mjs bundles the barrel, not the
// raw entries-* modules), so records arrive with the text normalization and
// derived verificationMethods already applied. Do not re-run that pipeline here.
import type {
  PublicRepositoryCategory,
  PublicRepositoryEntry,
  PublicRepositoryFramework,
  PublicRepositoryListEntry,
  PublicRepositoryStatus,
} from "./types";

const CATEGORIES: readonly PublicRepositoryCategory[] = ["gates", "algorithms", "operators", "states"];
const STATUSES: readonly PublicRepositoryStatus[] = ["verified", "verified_caveats", "community_review"];
const FRAMEWORKS: readonly PublicRepositoryFramework[] = [
  "Qiskit",
  "PennyLane",
  "Cirq",
  "CUDA-Q",
  "Amazon Braket",
  "OpenQASM 3.0",
  "PyQuil",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Narrow one catalog `record` blob to a PublicRepositoryEntry, or return null.
 *
 * Checks the fields the /repository routes and their client components read
 * without a guard — the ones whose absence would throw or render blank rather
 * than degrade. Optional fields (literature, classicalComparison, decomposition,
 * portableCircuit, industryUseCases) are left to the component-level optional
 * chaining that already handles them in the static path.
 */
export function parseCatalogRecord(record: unknown): PublicRepositoryEntry | null {
  if (!isRecord(record)) return null;

  // Identity and routing.
  if (!isNonEmptyString(record.slug)) return null;
  if (!isNonEmptyString(record.title) || !isNonEmptyString(record.titleJa)) return null;

  // Closed vocabularies — an unknown value here means the API and this build
  // disagree about the schema, which is exactly when rendering should stop.
  if (!CATEGORIES.includes(record.category as PublicRepositoryCategory)) return null;
  if (!STATUSES.includes(record.status as PublicRepositoryStatus)) return null;
  if (!FRAMEWORKS.includes(record.framework as PublicRepositoryFramework)) return null;

  // Prose the detail and list views render directly.
  for (const key of [
    "categoryLabel",
    "categoryLabelJa",
    "algorithmFamily",
    "verification",
    "exportStatus",
    "provenance",
    "updatedAt",
    "description",
    "descriptionJa",
    "introduction",
    "introductionJa",
    "explanation",
    "explanationJa",
  ]) {
    if (typeof record[key] !== "string") return null;
  }

  if (!isRecord(record.verificationDetails)) return null;
  if (typeof record.verificationDetails.method !== "string") return null;
  if (typeof record.verificationDetails.result !== "string") return null;

  if (!isRecord(record.source)) return null;
  if (!isNonEmptyString(record.source.license)) return null;

  // Structures iterated without a null check.
  if (!isStringArray(record.tags)) return null;
  if (!isStringArray(record.relatedSlugs)) return null;
  if (!Array.isArray(record.resources) || !Array.isArray(record.metadata)) return null;
  if (!Array.isArray(record.codeVariants)) return null;

  if (!isRecord(record.visualization)) return null;
  const { wires, operations, outcomes } = record.visualization;
  if (!isStringArray(wires) || !Array.isArray(operations) || !Array.isArray(outcomes)) return null;

  // verificationMethods is optional on the type but is derived for every entry
  // by the barrel before the manifest is generated, so an array is expected —
  // an absent one is tolerated (the badge components already handle undefined),
  // a malformed one is not.
  if (record.verificationMethods !== undefined && !isStringArray(record.verificationMethods)) return null;

  return record as unknown as PublicRepositoryEntry;
}

/**
 * Narrow one `?view=list` record blob to a PublicRepositoryListEntry, or null.
 *
 * Deliberately a separate function from parseCatalogRecord rather than a
 * relaxation of it: the list projection omits introduction/explanation/
 * verificationDetails/source by design, and parseCatalogRecord REQUIRES those
 * (they are what the detail page renders). Reusing it would reject all 283
 * records and silently drop the site onto the static corpus. Keeping the two
 * boundaries separate means each validates exactly what its own view reads.
 */
export function parseCatalogListRecord(record: unknown): PublicRepositoryListEntry | null {
  if (!isRecord(record)) return null;

  // Identity and routing.
  if (!isNonEmptyString(record.slug)) return null;
  if (!isNonEmptyString(record.title) || !isNonEmptyString(record.titleJa)) return null;

  // Closed vocabularies — same reasoning as the full parse: a value this build
  // does not know about means the API and the web disagree about the schema.
  if (!CATEGORIES.includes(record.category as PublicRepositoryCategory)) return null;
  if (!STATUSES.includes(record.status as PublicRepositoryStatus)) return null;
  if (!FRAMEWORKS.includes(record.framework as PublicRepositoryFramework)) return null;

  // Prose and labels the cards render directly.
  for (const key of [
    "categoryLabel",
    "categoryLabelJa",
    "algorithmFamily",
    "verification",
    "exportStatus",
    "provenance",
    "updatedAt",
    "description",
    "descriptionJa",
  ]) {
    if (typeof record[key] !== "string") return null;
  }

  // Structures iterated without a null check.
  if (!isStringArray(record.tags)) return null;
  if (!Array.isArray(record.resources) || !Array.isArray(record.metadata)) return null;
  if (!Array.isArray(record.codeVariants)) return null;

  if (!isRecord(record.visualization)) return null;
  const { wires, operations, outcomes } = record.visualization;
  if (!isStringArray(wires) || !Array.isArray(operations) || !Array.isArray(outcomes)) return null;

  if (record.verificationMethods !== undefined && !isStringArray(record.verificationMethods)) return null;

  return record as unknown as PublicRepositoryListEntry;
}

export interface CatalogParseResult {
  entries: PublicRepositoryEntry[];
  /** Slugs (or positional markers) that failed validation, for logging. */
  rejected: string[];
}

export interface CatalogListParseResult {
  entries: PublicRepositoryListEntry[];
  /** Slugs (or positional markers) that failed validation, for logging. */
  rejected: string[];
}

/**
 * Map a `/v1/catalog/entries` payload to typed entries, keeping the rejects so
 * the caller can decide whether a partial corpus is acceptable.
 */
export function parseCatalogEntries(payload: unknown): CatalogParseResult {
  if (!Array.isArray(payload)) return { entries: [], rejected: [] };
  const entries: PublicRepositoryEntry[] = [];
  const rejected: string[] = [];
  payload.forEach((row, index) => {
    const slug = isRecord(row) && isNonEmptyString(row.slug) ? row.slug : `index:${index}`;
    const parsed = parseCatalogRecord(isRecord(row) ? row.record : null);
    if (parsed) entries.push(parsed);
    else rejected.push(slug);
  });
  return { entries, rejected };
}

/**
 * Map a `/v1/catalog/entries?view=list` payload to typed list entries, keeping
 * the rejects so the caller can decide whether a partial corpus is acceptable.
 */
export function parseCatalogListEntries(payload: unknown): CatalogListParseResult {
  if (!Array.isArray(payload)) return { entries: [], rejected: [] };
  const entries: PublicRepositoryListEntry[] = [];
  const rejected: string[] = [];
  payload.forEach((row, index) => {
    const slug = isRecord(row) && isNonEmptyString(row.slug) ? row.slug : `index:${index}`;
    const parsed = parseCatalogListRecord(isRecord(row) ? row.record : null);
    if (parsed) entries.push(parsed);
    else rejected.push(slug);
  });
  return { entries, rejected };
}
