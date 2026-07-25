/**
 * Types for the Atlas VQE corpus (ADR-0027). These mirror
 * docs/atlas/corpus/{papers,repositories,comparisons}/*.json field-for-field
 * (snake_case, same field names) rather than adopting `PublicRepositoryEntry`'s
 * camelCase/circuit-execution shape — the two record kinds are genuinely
 * different data (literature/method records vs. executable circuits), and
 * this project's standing rule is never to synthesize a field to satisfy a
 * shape it doesn't actually have (see ADR-0027, root AGENTS.md "no invented
 * results"). `unknown`/`null`/`machine_validated` markers already present in
 * the corpus are kept as-is so the UI can render them honestly instead of as
 * blanks (plan Phase 4 acceptance: "unknown/conflictを空欄に変換しない").
 */

export interface VqeValidationState {
  state: "draft" | "machine_validated" | "validation_failed" | "conflicting";
  validator_version: string | null;
  validated_at: string | null;
  validation_errors: string[];
  validation_warnings: string[];
}

export interface VqePaperComponent {
  component_type: string;
  family_or_name: string;
  notes: string | null;
  evidence_locator: string;
}

export interface VqePaperRecord {
  paper_id: string;
  annotation_schema_version: string;
  title: string;
  authors: string[];
  year: number;
  venue: string;
  volume: string | null;
  pages_or_article_number: string | null;
  doi: string | null;
  arxiv_id: string | null;
  method_family: string[];
  problem_summary: string;
  sources_verified: string[];
  components: VqePaperComponent[];
  workflow_composition_notes: string | null;
  unknown_or_ambiguous_fields: string[];
  conflicting_fields: string[];
  negative_results_or_missing_implementation: string | null;
  /** repo_id of the associated VqeRepositoryRecord, if any. */
  implementation_ref: string | null;
  validation_state: VqeValidationState;
}

export type VqeRepositoryRelation =
  | "official"
  | "author"
  | "general_framework_library"
  | "third_party_reference_implementation";

export interface VqeRepositoryRecord {
  repo_id: string;
  annotation_schema_version: string;
  repository_url: string;
  relation: VqeRepositoryRelation;
  /** paper_ids of every VqePaperRecord this repository is associated with. */
  associated_paper_ids: string[];
  paper_associated_commit: string | null;
  license_state: string;
  environment_completeness: string;
  evidence_locators: string[];
  sources_verified: string[];
  unknown_or_ambiguous_fields: string[];
  validation_state: VqeValidationState;
}

export type VqeComparisonDimensionStatus = "fixed" | "changed" | "unknown";
export type VqeComparisonClassification = "strict" | "controlled" | "partial" | "invalid";

export interface VqeComparisonDimension {
  name: string;
  status: VqeComparisonDimensionStatus;
  detail: string | null;
  evidence_locator: string | null;
}

export interface VqeComparisonRecord {
  comparison_id: string;
  annotation_schema_version: string;
  generation_method: string;
  generator_version: string;
  /** paper_ids of the two VqePaperRecords being compared. */
  source_record_ids: string[];
  generated_at: string;
  dimensions: VqeComparisonDimension[];
  classification: VqeComparisonClassification;
  unresolved_conflicts: string[];
  validation_warnings: string[];
  is_manual_gold: boolean;
  human_validated: boolean;
}

export interface VqeCorpusBundle {
  schema_version: string;
  papers: VqePaperRecord[];
  repositories: VqeRepositoryRecord[];
  comparisons: VqeComparisonRecord[];
}

/** Bounded public browse projections. Detail-only evidence stays server-side
 * until a user opens the corresponding route. */
export type VqePaperListEntry = Pick<
  VqePaperRecord,
  | "paper_id"
  | "title"
  | "authors"
  | "year"
  | "venue"
  | "method_family"
  | "problem_summary"
  | "implementation_ref"
  | "validation_state"
>;

/**
 * A browse-only observation of a component annotated inside one paper.
 * `observation_key` is a UI key, not a canonical component identity: Phase 3
 * ArtifactVersions remain the only durable component identity.
 */
export interface VqeComponentListEntry {
  observation_key: string;
  paper_id: string;
  paper_title: string;
  component_type: string;
  family_or_name: string;
  notes: string | null;
}

export type VqeRepositoryListEntry = Pick<
  VqeRepositoryRecord,
  | "repo_id"
  | "repository_url"
  | "relation"
  | "associated_paper_ids"
  | "license_state"
  | "environment_completeness"
>;

export type VqeComparisonListEntry = Pick<
  VqeComparisonRecord,
  | "comparison_id"
  | "source_record_ids"
  | "classification"
  | "is_manual_gold"
  | "human_validated"
>;
