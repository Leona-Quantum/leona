import type {
  VqeComparisonRecord,
  VqeCorpusBundle,
  VqePaperRecord,
  VqeRepositoryRecord,
  VqeRepositoryRelation,
  VqeValidationState,
} from "./types";

const RELATIONS = new Set<VqeRepositoryRelation>([
  "official",
  "author",
  "general_framework_library",
  "third_party_reference_implementation",
]);
const VALIDATION_STATES = new Set<VqeValidationState["state"]>([
  "draft",
  "machine_validated",
  "validation_failed",
  "conflicting",
]);
const DIMENSION_STATUSES = new Set([
  "fixed",
  "changed",
  "unknown",
  "not_applicable",
]);
const CLASSIFICATIONS = new Set(["strict", "controlled", "partial", "invalid"]);

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return string(value, path);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function array<T>(
  value: unknown,
  path: string,
  parse: (item: unknown, itemPath: string) => T,
): T[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((item, index) => parse(item, `${path}[${index}]`));
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path, string);
}

function validationState(value: unknown, path: string): VqeValidationState {
  const item = record(value, path);
  const state = string(item.state, `${path}.state`) as VqeValidationState["state"];
  if (!VALIDATION_STATES.has(state)) throw new Error(`${path}.state is not recognized`);
  return {
    state,
    validator_version: nullableString(item.validator_version, `${path}.validator_version`),
    validated_at: nullableString(item.validated_at, `${path}.validated_at`),
    validation_errors: stringArray(item.validation_errors, `${path}.validation_errors`),
    validation_warnings: stringArray(item.validation_warnings, `${path}.validation_warnings`),
  };
}

function paper(value: unknown, path: string): VqePaperRecord {
  const item = record(value, path);
  return {
    paper_id: string(item.paper_id, `${path}.paper_id`),
    annotation_schema_version: string(
      item.annotation_schema_version,
      `${path}.annotation_schema_version`,
    ),
    title: string(item.title, `${path}.title`),
    authors: stringArray(item.authors, `${path}.authors`),
    year: number(item.year, `${path}.year`),
    venue: string(item.venue, `${path}.venue`),
    volume: nullableString(item.volume, `${path}.volume`),
    pages_or_article_number: nullableString(
      item.pages_or_article_number,
      `${path}.pages_or_article_number`,
    ),
    doi: nullableString(item.doi, `${path}.doi`),
    arxiv_id: nullableString(item.arxiv_id, `${path}.arxiv_id`),
    method_family: stringArray(item.method_family, `${path}.method_family`),
    problem_summary: string(item.problem_summary, `${path}.problem_summary`),
    sources_verified: stringArray(item.sources_verified, `${path}.sources_verified`),
    components: array(item.components, `${path}.components`, (component, componentPath) => {
      const parsed = record(component, componentPath);
      return {
        component_type: string(parsed.component_type, `${componentPath}.component_type`),
        family_or_name: string(parsed.family_or_name, `${componentPath}.family_or_name`),
        notes: nullableString(parsed.notes, `${componentPath}.notes`),
        evidence_locator: string(parsed.evidence_locator, `${componentPath}.evidence_locator`),
      };
    }),
    workflow_composition_notes: nullableString(
      item.workflow_composition_notes,
      `${path}.workflow_composition_notes`,
    ),
    unknown_or_ambiguous_fields: stringArray(
      item.unknown_or_ambiguous_fields,
      `${path}.unknown_or_ambiguous_fields`,
    ),
    conflicting_fields: stringArray(item.conflicting_fields, `${path}.conflicting_fields`),
    negative_results_or_missing_implementation: nullableString(
      item.negative_results_or_missing_implementation,
      `${path}.negative_results_or_missing_implementation`,
    ),
    implementation_ref: nullableString(item.implementation_ref, `${path}.implementation_ref`),
    validation_state: validationState(item.validation_state, `${path}.validation_state`),
  };
}

function repository(value: unknown, path: string): VqeRepositoryRecord {
  const item = record(value, path);
  const relation = string(item.relation, `${path}.relation`) as VqeRepositoryRelation;
  if (!RELATIONS.has(relation)) throw new Error(`${path}.relation is not recognized`);
  return {
    repo_id: string(item.repo_id, `${path}.repo_id`),
    annotation_schema_version: string(
      item.annotation_schema_version,
      `${path}.annotation_schema_version`,
    ),
    repository_url: string(item.repository_url, `${path}.repository_url`),
    relation,
    associated_paper_ids: stringArray(
      item.associated_paper_ids,
      `${path}.associated_paper_ids`,
    ),
    paper_associated_commit: nullableString(
      item.paper_associated_commit,
      `${path}.paper_associated_commit`,
    ),
    license_state: string(item.license_state, `${path}.license_state`),
    environment_completeness: string(
      item.environment_completeness,
      `${path}.environment_completeness`,
    ),
    evidence_locators: stringArray(item.evidence_locators, `${path}.evidence_locators`),
    sources_verified: stringArray(item.sources_verified, `${path}.sources_verified`),
    unknown_or_ambiguous_fields: stringArray(
      item.unknown_or_ambiguous_fields,
      `${path}.unknown_or_ambiguous_fields`,
    ),
    validation_state: validationState(item.validation_state, `${path}.validation_state`),
  };
}

function comparison(value: unknown, path: string): VqeComparisonRecord {
  const item = record(value, path);
  const classification = string(
    item.classification,
    `${path}.classification`,
  ) as VqeComparisonRecord["classification"];
  if (!CLASSIFICATIONS.has(classification)) {
    throw new Error(`${path}.classification is not recognized`);
  }
  return {
    comparison_id: string(item.comparison_id, `${path}.comparison_id`),
    annotation_schema_version: string(
      item.annotation_schema_version,
      `${path}.annotation_schema_version`,
    ),
    generation_method: string(item.generation_method, `${path}.generation_method`),
    generator_version: string(item.generator_version, `${path}.generator_version`),
    source_record_ids: stringArray(item.source_record_ids, `${path}.source_record_ids`),
    generated_at: string(item.generated_at, `${path}.generated_at`),
    dimensions: array(item.dimensions, `${path}.dimensions`, (dimension, dimensionPath) => {
      const parsed = record(dimension, dimensionPath);
      const status = string(
        parsed.status,
        `${dimensionPath}.status`,
      ) as VqeComparisonRecord["dimensions"][number]["status"];
      if (!DIMENSION_STATUSES.has(status)) {
        throw new Error(`${dimensionPath}.status is not recognized`);
      }
      return {
        name: string(parsed.name, `${dimensionPath}.name`),
        status,
        detail: nullableString(parsed.detail, `${dimensionPath}.detail`),
        evidence_locator: nullableString(
          parsed.evidence_locator,
          `${dimensionPath}.evidence_locator`,
        ),
      };
    }),
    classification,
    unresolved_conflicts: stringArray(
      item.unresolved_conflicts,
      `${path}.unresolved_conflicts`,
    ),
    validation_warnings: stringArray(item.validation_warnings, `${path}.validation_warnings`),
    is_manual_gold: boolean(item.is_manual_gold, `${path}.is_manual_gold`),
    human_validated: boolean(item.human_validated, `${path}.human_validated`),
  };
}

export function validateVqeCorpusBundle(value: unknown): VqeCorpusBundle {
  const bundle = record(value, "corpus");
  return {
    schema_version: string(bundle.schema_version, "corpus.schema_version"),
    papers: array(bundle.papers, "corpus.papers", paper),
    repositories: array(bundle.repositories, "corpus.repositories", repository),
    comparisons: array(bundle.comparisons, "corpus.comparisons", comparison),
  };
}
