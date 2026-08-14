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

/**
 * The four heavy fields, and why absence must not be a rejection.
 *
 * `resources`, `metadata`, `codeVariants` and `visualization` are 63% of the
 * list payload and a browse card renders almost none of them. Trimming them out
 * of the API's projection is the point of that work — and `null` from
 * `parseCatalogListRecord` is not a degraded record, it is NO record, so a
 * required guard would drop all 369 at once the moment the API stopped sending
 * one of them.
 *
 * It would not even show an empty page: `repository-source.ts` reads a
 * zero-length parse as a failed fetch and falls back to the bundled static
 * corpus, so the site keeps rendering from a snapshot, silently. That is the
 * 362-of-369 shape.
 *
 * The two deploy pipelines are independent, so there is no merge order that
 * avoids a window in which one side has changed and the other has not. These
 * tests are what makes the window survivable.
 */
const TRIMMABLE = ["resources", "metadata", "codeVariants", "visualization"] as const;

test("the list parse survives every heavy field being projected away", () => {
  for (const field of TRIMMABLE) {
    const record = listRecord("Qiskit");
    delete record[field];
    const parsed = parseCatalogListRecord(record);
    assert.ok(parsed, `dropping ${field} rejected the whole record`);
  }
  // And all four at once, which is what the projection will actually do.
  const stripped = listRecord("Qiskit");
  for (const field of TRIMMABLE) delete stripped[field];
  assert.ok(parseCatalogListRecord(stripped), "dropping all four rejected the record");
});

test("an absent heavy field arrives as an empty structure, not undefined", () => {
  // Consumers iterate these without guards — `families.ts` maps `codeVariants`
  // with no `?? []` and would throw, and the gate sidebar reads
  // `visualization.wires` directly. Filling here means no consumer has to learn
  // a new shape.
  const record = listRecord("Qiskit");
  for (const field of TRIMMABLE) delete record[field];
  const parsed = parseCatalogListRecord(record) as unknown as Record<string, unknown>;
  assert.deepEqual(parsed.resources, []);
  assert.deepEqual(parsed.metadata, []);
  assert.deepEqual(parsed.codeVariants, []);
  assert.deepEqual(parsed.visualization, { wires: [], operations: [], outcomes: [] });
});

test("MALFORMED is still refused, which is the half that must not be lost", () => {
  // Tolerating absence is deliberate; tolerating a schema disagreement is not.
  // A string where an array belongs means the API and this build disagree, and
  // rendering should stop rather than guess.
  for (const [field, bad] of [
    ["resources", "not-an-array"],
    ["metadata", 42],
    ["codeVariants", { framework: "Qiskit" }],
    ["visualization", "not-a-record"],
  ] as const) {
    const record = listRecord("Qiskit");
    record[field] = bad;
    assert.equal(parseCatalogListRecord(record), null, `a malformed ${field} was accepted`);
  }
  // A visualization that is a record but whose wires are not strings is the
  // subtle one — the shape is right one level down and wrong two levels down.
  const record = listRecord("Qiskit");
  record.visualization = { wires: [1, 2], operations: [], outcomes: [] };
  assert.equal(parseCatalogListRecord(record), null, "visualization.wires was not shape-checked");
});

/**
 * The same two terms one level INSIDE `visualization`, which is where its cost is.
 *
 * `visualization` is 16.0% of the list payload and `operations` is 138,156 of
 * its 171,410 bytes, measured against the live 369-record listing. `outcomes` is
 * read by nothing in the browse view. So the projection that pays trims inside
 * the field rather than removing it — and the outer tolerance above does not
 * cover that at all: `{ wires: [...] }` alone passes `!== undefined` and
 * `isRecord`, then used to die on `!Array.isArray(undefined)` and take all 369
 * records with it.
 */
test("the list parse survives visualization being trimmed a level down", () => {
  for (const key of ["operations", "outcomes", "wires"] as const) {
    const record = listRecord("Qiskit");
    delete (record.visualization as Record<string, unknown>)[key];
    assert.ok(parseCatalogListRecord(record), `dropping visualization.${key} rejected the record`);
  }
  // What the projection actually sends for a non-gate record: wires only.
  const wiresOnly = listRecord("Qiskit");
  wiresOnly.visualization = { wires: ["q0", "q1"] };
  const parsed = parseCatalogListRecord(wiresOnly) as unknown as Record<string, unknown>;
  assert.ok(parsed, "a wires-only visualization was rejected");
  // Filled, because `repository-browser.tsx:1562` reads `.operations` with no
  // `?? []` — a partial object reaching a consumer is the throw this prevents.
  assert.deepEqual(parsed.visualization, { wires: ["q0", "q1"], operations: [], outcomes: [] });
});

test("a malformed visualization key is still refused a level down", () => {
  for (const [key, bad] of [
    ["wires", [1, 2]],
    ["operations", "not-an-array"],
    ["outcomes", 42],
  ] as const) {
    const record = listRecord("Qiskit");
    (record.visualization as Record<string, unknown>)[key] = bad;
    assert.equal(
      parseCatalogListRecord(record),
      null,
      `a malformed visualization.${key} was accepted`,
    );
  }
});

test("the FULL parse keeps requiring them, because its payload is not shrinking", () => {
  // Only the list projection gets smaller. The detail page fetches one record
  // and needs all of it, so weakening that guard would buy nothing and cost the
  // schema check.
  for (const field of TRIMMABLE) {
    const record = fullRecord("Qiskit");
    delete record[field];
    assert.equal(parseCatalogRecord(record), null, `the full parse tolerated a missing ${field}`);
  }
  // Including one level down: the detail page renders `visualization.outcomes`
  // (`repository-entry-view.tsx:414`) and destructures `{ wires, operations }`
  // (`:750`), so the full record is exactly where those keys are required.
  for (const key of ["wires", "operations", "outcomes"] as const) {
    const record = fullRecord("Qiskit");
    delete (record.visualization as Record<string, unknown>)[key];
    assert.equal(
      parseCatalogRecord(record),
      null,
      `the full parse tolerated a missing visualization.${key}`,
    );
  }
});
