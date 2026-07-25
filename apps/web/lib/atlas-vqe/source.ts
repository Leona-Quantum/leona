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
  VqeComparisonListEntry,
  VqeComponentListEntry,
  VqeCorpusBundle,
  VqePaperListEntry,
  VqePaperRecord,
  VqeRepositoryListEntry,
  VqeRepositoryRecord,
  VqeRepositoryRelation,
} from "./types";
import { validateVqeCorpusBundle } from "./validation";

// The bundle is a committed, CI-validated build artifact. Fail closed if its
// runtime shape drifts: silently returning an empty corpus would make
// scientific evidence look absent rather than corrupted.
const BUNDLE: VqeCorpusBundle = validateVqeCorpusBundle(corpusBundleJson);
const PUBLIC_LIST_LIMIT = 100;

function requireBoundedList(recordType: string, count: number): void {
  if (count > PUBLIC_LIST_LIMIT) {
    throw new Error(
      `[atlas-vqe/source] ${recordType} count ${count} exceeds the static public list ` +
        `limit ${PUBLIC_LIST_LIMIT}; move this collection to server-side pagination`,
    );
  }
}

export function getVqePaperListEntries(): VqePaperListEntry[] {
  requireBoundedList("paper", BUNDLE.papers.length);
  return BUNDLE.papers.map((paper) => ({
    paper_id: paper.paper_id,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    venue: paper.venue,
    method_family: paper.method_family,
    problem_summary: paper.problem_summary,
    implementation_ref: paper.implementation_ref,
    validation_state: paper.validation_state,
  }));
}

export function getVqeComponentListEntries(): VqeComponentListEntry[] {
  const count = BUNDLE.papers.reduce((total, paper) => total + paper.components.length, 0);
  requireBoundedList("paper component observation", count);
  return BUNDLE.papers.flatMap((paper) =>
    paper.components.map((component, index) => ({
      observation_key: `${paper.paper_id}:${index}`,
      paper_id: paper.paper_id,
      paper_title: paper.title,
      component_type: component.component_type,
      family_or_name: component.family_or_name,
      notes: component.notes,
    })),
  );
}

export function getVqeRepositoryListEntries(): VqeRepositoryListEntry[] {
  requireBoundedList("repository", BUNDLE.repositories.length);
  return BUNDLE.repositories.map((repository) => ({
    repo_id: repository.repo_id,
    repository_url: repository.repository_url,
    relation: repository.relation,
    associated_paper_ids: repository.associated_paper_ids,
    license_state: repository.license_state,
    environment_completeness: repository.environment_completeness,
  }));
}

export function getVqeComparisonListEntries(): VqeComparisonListEntry[] {
  requireBoundedList("comparison", BUNDLE.comparisons.length);
  return BUNDLE.comparisons.map((comparison) => ({
    comparison_id: comparison.comparison_id,
    source_record_ids: comparison.source_record_ids,
    classification: comparison.classification,
    is_manual_gold: comparison.is_manual_gold,
    human_validated: comparison.human_validated,
  }));
}

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
