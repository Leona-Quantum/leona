/**
 * Server-side source of the /repository page's Atlas VQE section (ADR-0027).
 *
 * Reads the committed, generated corpus bundle (a static JSON import, so both
 * `next dev` and a Vercel build bundle it correctly) rather than fetching the
 * authenticated Phase 3 `/v1/atlas/*` API or reading docs/atlas/corpus/ off
 * disk at request time. Regenerate the bundle with
 * `node scripts/generate-atlas-vqe-corpus.mjs` whenever docs/atlas/corpus/
 * changes; CI checks it is current with `--check` the same way the catalog
 * bootstrap manifest is.
 */
import corpusBundleJson from "./corpus-data.generated.json";
import type {
  VqeComparisonRecord,
  VqeCorpusBundle,
  VqePaperRecord,
  VqeRepositoryRecord,
  VqeRepositoryRelation,
} from "./types";

/**
 * Structural sanity check on the imported bundle, logged loudly rather than
 * thrown — a malformed bundle should degrade the VQE section to empty, not
 * crash the whole /repository page the existing 283 circuit records still
 * need to render on.
 */
function validateBundle(value: unknown): VqeCorpusBundle {
  const empty: VqeCorpusBundle = { schema_version: "unknown", papers: [], repositories: [], comparisons: [] };
  if (typeof value !== "object" || value === null) {
    console.error("[atlas-vqe/source] corpus-data.generated.json is not an object");
    return empty;
  }
  const bundle = value as Partial<VqeCorpusBundle>;
  if (!Array.isArray(bundle.papers) || !Array.isArray(bundle.repositories) || !Array.isArray(bundle.comparisons)) {
    console.error("[atlas-vqe/source] corpus-data.generated.json is missing papers/repositories/comparisons arrays");
    return empty;
  }
  return {
    schema_version: typeof bundle.schema_version === "string" ? bundle.schema_version : "unknown",
    papers: bundle.papers as VqePaperRecord[],
    repositories: bundle.repositories as VqeRepositoryRecord[],
    comparisons: bundle.comparisons as VqeComparisonRecord[],
  };
}

const BUNDLE = validateBundle(corpusBundleJson);

export function getVqePapers(): VqePaperRecord[] {
  return BUNDLE.papers;
}

export function getVqePaper(paperId: string): VqePaperRecord | undefined {
  return BUNDLE.papers.find((paper) => paper.paper_id === paperId);
}

export function getVqeRepositories(): VqeRepositoryRecord[] {
  return BUNDLE.repositories;
}

export function getVqeRepository(repoId: string): VqeRepositoryRecord | undefined {
  return BUNDLE.repositories.find((repo) => repo.repo_id === repoId);
}

export function getVqeComparisons(): VqeComparisonRecord[] {
  return BUNDLE.comparisons;
}

export function getVqeComparison(comparisonId: string): VqeComparisonRecord | undefined {
  return BUNDLE.comparisons.find((comparison) => comparison.comparison_id === comparisonId);
}

/** Every repository this paper is directly linked from (via its own
 * implementation_ref, plus any repository that lists it in
 * associated_paper_ids — the corpus records this relation from both sides
 * and they are not always symmetric, so both are checked). */
export function getRepositoriesForPaper(paperId: string): VqeRepositoryRecord[] {
  const paper = getVqePaper(paperId);
  const seen = new Set<string>();
  const results: VqeRepositoryRecord[] = [];
  const add = (repo: VqeRepositoryRecord | undefined) => {
    if (repo && !seen.has(repo.repo_id)) {
      seen.add(repo.repo_id);
      results.push(repo);
    }
  };
  if (paper?.implementation_ref) add(getVqeRepository(paper.implementation_ref));
  for (const repo of BUNDLE.repositories) {
    if (repo.associated_paper_ids.includes(paperId)) add(repo);
  }
  return results;
}

/** Every comparison report that involves this paper. */
export function getComparisonsForPaper(paperId: string): VqeComparisonRecord[] {
  return BUNDLE.comparisons.filter((comparison) => comparison.source_record_ids.includes(paperId));
}

/**
 * Counts by relation, in the fixed 4-way order the corpus's own acceptance
 * criterion requires always showing together (plan Phase 2 acceptance:
 * "verified implementation repositories >= 15 (内訳を常に併記)") — never just
 * a single "official/author" total that could hide a miscount the way an
 * earlier pass of this corpus once did (docs/atlas/PHASE2_PROGRESS.md §0).
 */
export function getRepositoryRelationBreakdown(): Record<VqeRepositoryRelation, number> {
  const breakdown: Record<VqeRepositoryRelation, number> = {
    official: 0,
    author: 0,
    general_framework_library: 0,
    third_party_reference_implementation: 0,
  };
  for (const repo of BUNDLE.repositories) {
    breakdown[repo.relation] += 1;
  }
  return breakdown;
}

export function getVqeCorpusSchemaVersion(): string {
  return BUNDLE.schema_version;
}
