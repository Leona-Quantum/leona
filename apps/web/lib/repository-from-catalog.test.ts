import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalogListRecord, parseCatalogRecord } from "./repository/from-catalog.ts";
import { PUBLIC_REPOSITORY_FRAMEWORKS } from "./repository/types.ts";

/**
 * A catalog `record` blob that passes every check parseCatalogRecord makes,
 * parameterised only on the field under test.
 *
 * Built as a plain object rather than borrowed from the static corpus on
 * purpose: the corpus is what the fallback serves, and a fixture taken from it
 * would pass whether or not the validator agrees with the API's schema.
 */
function fullRecord(framework: string): Record<string, unknown> {
  return {
    slug: "test-entry",
    title: "Test entry",
    titleJa: "テストエントリ",
    category: "gates",
    categoryLabel: "Gates",
    categoryLabelJa: "ゲート",
    algorithmFamily: "Single-qubit gates",
    framework,
    status: "verified",
    verification: "Statevector comparison",
    verificationDetails: { method: "statevector", result: "match" },
    exportStatus: "Exportable",
    provenance: "Curated reference",
    updatedAt: "2026-08-04",
    description: "A record used only by this test.",
    descriptionJa: "テスト専用のレコード。",
    introduction: "Introduction.",
    introductionJa: "はじめに。",
    explanation: "Explanation.",
    explanationJa: "説明。",
    tags: ["test"],
    resources: [{ label: "Qubits", value: "1" }],
    metadata: [{ label: "Depth", value: "1" }],
    source: {
      kind: "curated_reference",
      title: "Test source",
      url: "https://example.test/entry",
      license: "CC BY 4.0-compatible reference metadata",
    },
    visualization: {
      wires: ["q0"],
      operations: [{ label: "H", qubits: [0], tone: "accent" }],
      outcomes: [{ label: "0", probability: 0.5 }],
    },
    codeVariants: [],
    relatedSlugs: [],
  };
}

/** The `?view=list` projection: the full record minus the detail-only fields. */
function listRecord(framework: string): Record<string, unknown> {
  const {
    introduction: _introduction,
    introductionJa: _introductionJa,
    explanation: _explanation,
    explanationJa: _explanationJa,
    verificationDetails: _verificationDetails,
    source: _source,
    relatedSlugs: _relatedSlugs,
    ...rest
  } = fullRecord(framework);
  return rest;
}

/**
 * The regression this file exists for.
 *
 * from-catalog.ts used to keep its own copy of the framework vocabulary, and the
 * copy was a member short — "Qmod" was in the type and in
 * PUBLIC_REPOSITORY_FRAMEWORKS but not in the validator's list. A record whose
 * primary framework was Qmod would therefore have been refused as a schema
 * mismatch and dropped from the API-backed catalog. No published record uses it
 * as a primary framework today, so nothing failed; the copy was simply wrong and
 * waiting.
 *
 * The assertion is driven off PUBLIC_REPOSITORY_FRAMEWORKS itself. Writing the
 * eight names out here would be the same defect one layer up — a fourth copy,
 * green while the vocabulary grew past it.
 */
test("every framework in the published vocabulary is accepted by the catalog validator", () => {
  assert.ok(PUBLIC_REPOSITORY_FRAMEWORKS.length > 0, "the framework vocabulary is empty");

  const refused = PUBLIC_REPOSITORY_FRAMEWORKS.filter((framework) => parseCatalogRecord(fullRecord(framework)) === null);
  assert.deepEqual(refused, [], `catalog validator refuses published framework(s): ${refused.join(", ")}`);

  const refusedInList = PUBLIC_REPOSITORY_FRAMEWORKS
    .filter((framework) => parseCatalogListRecord(listRecord(framework)) === null);
  assert.deepEqual(refusedInList, [], `list validator refuses published framework(s): ${refusedInList.join(", ")}`);
});

test("a framework outside the vocabulary is still refused, by both parsers", () => {
  // The fix widened WHICH values are known, not what happens to an unknown one.
  // An unrecognised framework means the API and this build disagree about the
  // schema, and the record must not render half-formed.
  for (const unknown of ["Q#", "qiskit", "OpenQASM 2.0", "", "Classiq"]) {
    assert.equal(parseCatalogRecord(fullRecord(unknown)), null, `full parser accepted ${JSON.stringify(unknown)}`);
    assert.equal(parseCatalogListRecord(listRecord(unknown)), null, `list parser accepted ${JSON.stringify(unknown)}`);
  }
  for (const unknown of [undefined, null, 7, ["Qiskit"]]) {
    assert.equal(parseCatalogRecord({ ...fullRecord("Qiskit"), framework: unknown }), null);
    assert.equal(parseCatalogListRecord({ ...listRecord("Qiskit"), framework: unknown }), null);
  }
});

test("the fixtures are otherwise valid, so a refusal above means the framework", () => {
  // Positive control. Without it, a fixture broken in some unrelated field would
  // make the vocabulary test fail for every framework and read as drift.
  const parsed = parseCatalogRecord(fullRecord("Qiskit"));
  assert.ok(parsed, "the full fixture is not a valid record");
  assert.equal(parsed.framework, "Qiskit");

  const listParsed = parseCatalogListRecord(listRecord("Qiskit"));
  assert.ok(listParsed, "the list fixture is not a valid list record");
  assert.equal(listParsed.framework, "Qiskit");

  // And the list fixture really is the narrower shape — if it still carried the
  // detail-only fields, the list parser would prove nothing about the
  // projection the API actually sends.
  assert.equal("introduction" in listRecord("Qiskit"), false);
  assert.equal("source" in listRecord("Qiskit"), false);
});
