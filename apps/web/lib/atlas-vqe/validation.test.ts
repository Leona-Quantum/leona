import assert from "node:assert/strict";
import test from "node:test";
import { validateVqeCorpusBundle } from "./validation.ts";

const state = {
  state: "machine_validated",
  validator_version: "0.1.0",
  validated_at: "2026-07-24T00:00:00Z",
  validation_errors: [],
  validation_warnings: [],
};

test("nullable corpus fields remain explicit null values", () => {
  const bundle = validateVqeCorpusBundle({
    schema_version: "0.2.0",
    papers: [
      {
        paper_id: "paper",
        annotation_schema_version: "0.2.0",
        title: "Paper",
        authors: ["Author"],
        year: 2026,
        venue: "Venue",
        volume: null,
        pages_or_article_number: null,
        doi: null,
        arxiv_id: null,
        method_family: ["VQE"],
        problem_summary: "H2",
        sources_verified: ["https://example.test/paper"],
        components: [
          {
            component_type: "ansatz",
            family_or_name: "UCCSD",
            notes: null,
            evidence_locator: "abstract",
          },
        ],
        workflow_composition_notes: null,
        unknown_or_ambiguous_fields: [],
        conflicting_fields: [],
        negative_results_or_missing_implementation: null,
        implementation_ref: null,
        validation_state: state,
      },
    ],
    repositories: [],
    comparisons: [],
  });
  assert.equal(bundle.papers[0]?.components[0]?.notes, null);
  assert.equal(bundle.papers[0]?.volume, null);
});

test("malformed scientific corpus fails closed with a field path", () => {
  assert.throws(
    () =>
      validateVqeCorpusBundle({
        schema_version: "0.2.0",
        papers: [{ paper_id: "paper" }],
        repositories: [],
        comparisons: [],
      }),
    /corpus\.papers\[0\]\.annotation_schema_version/,
  );
});

test("non-finite numeric metadata is rejected", () => {
  assert.throws(
    () =>
      validateVqeCorpusBundle({
        schema_version: "0.2.0",
        papers: [
          {
            paper_id: "paper",
            annotation_schema_version: "0.2.0",
            title: "Paper",
            authors: [],
            year: Number.NaN,
          },
        ],
        repositories: [],
        comparisons: [],
      }),
    /year must be a finite number/,
  );
});
