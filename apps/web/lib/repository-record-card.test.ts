import assert from "node:assert/strict";
import test from "node:test";

import { cardFor, cardSections } from "./repository/card-content.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { STATE_VOCABULARY } from "./repository/state-vocabulary.ts";
import { PAPER_REGISTER } from "./repository/paper-register.ts";
import { isMethod } from "./repository/layers.ts";
import { makeReferenceEntry } from "./repository/factory.ts";
import {
  RECORD_SECTION_ORDER,
  parseRecordSection,
  recordSectionHref,
  recordSections,
  type RecordCardInput,
} from "./repository/record-card.ts";

const WORDS = { unreviewed: "Nobody has reviewed this record for gaps yet.", notCircuit: "This record is not a concrete circuit." };

function fixture(overrides: Partial<Parameters<typeof makeReferenceEntry>[0]> = {}) {
  return makeReferenceEntry({
    slug: "fixture-gate",
    title: "Fixture gate",
    titleJa: "テスト用ゲート",
    category: "gates",
    categoryLabel: "Gates",
    categoryLabelJa: "ゲート",
    algorithmFamily: "Single-qubit gate",
    framework: "Qiskit",
    verification: "Unitary equivalence",
    method: "Compared the matrix.",
    result: "Pass.",
    exportStatus: "native",
    provenance: "Curated reference",
    updatedAt: "2026-09-10",
    description: "A fixture.",
    descriptionJa: "テスト用。",
    introduction: "Use it when a test needs one record.",
    introductionJa: "テストに一件必要なときに。",
    explanation: "It applies a matrix.",
    explanationJa: "行列を作用させます。",
    tags: ["fixture"],
    resources: [{ label: "Qubits", value: "1" }],
    metadata: [],
    sourceTitle: "Fixture source",
    sourceUrl: "https://example.test/fixture",
    wires: ["q0"],
    operations: [{ label: "X", qubits: [0], tone: "accent" }],
    outcomes: [{ label: "1", probability: 1 }],
    code: "x q[0];",
    filename: "fixture.qasm",
    language: "openqasm",
    relatedSlugs: [],
    ...overrides,
  });
}

function input(overrides: Partial<RecordCardInput> = {}): RecordCardInput {
  return {
    entry: fixture(),
    locale: "en",
    hasProfile: false,
    hasEstimate: false,
    hasLayers: false,
    relatedCount: 0,
    words: WORDS,
    ...overrides,
  };
}

test("the record page's sections are the card's, in the card's order", () => {
  // Read off the card itself, not off a copy of its order: a reorder there must
  // fail here, because "match exactly" is the whole point of the list.
  const method = LAYER_GRAPH.nodes.find(isMethod)!;
  const card = cardFor({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, corpus: [], locale: "en", register: PAPER_REGISTER }, method.id)!;
  const cardOrder = cardSections(card).map((section) => section.id);
  let cursor = 0;
  for (const id of RECORD_SECTION_ORDER) {
    const at = cardOrder.indexOf(id, cursor);
    assert.ok(at >= 0, `${id} is not on the card after position ${cursor}`);
    cursor = at + 1;
  }
  assert.deepEqual(
    recordSections(input()).map((section) => section.id),
    RECORD_SECTION_ORDER,
  );
});

test("a record never drops a field it holds, and never claims one it lacks", () => {
  // Reviewed and found no gaps is a statement the section holds; a record
  // nobody has reviewed is the gap case, tested below.
  const full = recordSections(
    input({
      entry: { ...fixture({ relatedSlugs: ["other"] }), knownGaps: [] },
      hasLayers: true,
      relatedCount: 1,
    }),
  );
  for (const section of full) assert.ok(section.held, `${section.id} is a gap on a full record`);

  const bare = recordSections(
    input({
      entry: fixture({
        introduction: "",
        introductionJa: "",
        explanation: "",
        explanationJa: "",
        resources: [],
        metadata: [],
        wires: [],
        operations: [],
        outcomes: [],
        code: "",
      }),
    }),
  );
  const state = Object.fromEntries(bare.map((section) => [section.id, section]));
  assert.equal(state["when-it-applies"].held, false);
  assert.equal(state.theory.held, false);
  assert.equal(state.requires.held, false);
  assert.equal(state.example.held, false);
  assert.equal(state.records.held, false);
  // The interface piece and the comparison always answer.
  assert.equal(state.input.held, true);
  assert.equal(state.output.held, true);
  assert.equal(state.performance.held, true);
  // A record with no code of its own says so in its own words.
  assert.equal(state.implementations.held, false);
  assert.equal(state.implementations.reason, WORDS.notCircuit);
  for (const section of bare) if (!section.held) assert.equal(section.gap, "none-recorded");
});

test("declared gaps are held, and an unreviewed record says nobody has looked", () => {
  const reviewed = recordSections(input({ entry: { ...fixture(), knownGaps: [] } }));
  assert.equal(reviewed.find((section) => section.id === "contested")!.held, true);
  const unreviewed = recordSections(input({ entry: { ...fixture(), knownGaps: undefined } }));
  const contested = unreviewed.find((section) => section.id === "contested")!;
  assert.equal(contested.held, false);
  assert.equal(contested.reason, WORDS.unreviewed);
  const declared = recordSections(
    input({
      entry: {
        ...fixture(),
        knownGaps: [{ role: "input", reason: "not_stated_in_source", detail: "The input encoding is not given.", detailJa: "入力の符号化が示されていません。" }],
      },
    }),
  );
  assert.equal(declared.find((section) => section.id === "contested")!.held, true);
});

test("a stock placeholder diagram is a gap in Example, with the record's own reason", () => {
  // The exact Zoo-parity/Classiq-parity signature (entries-zoo-parity.ts /
  // entries-classiq-parity.ts), reproduced by wires and op labels alone — the
  // qubits and tones below are incidental to the match, not part of it.
  const placeholder = recordSections(
    input({
      entry: fixture({
        wires: ["problem", "algorithm", "readout"],
        operations: [
          { label: "encode", qubits: [0], tone: "neutral" },
          { label: "transform", qubits: [0, 1], tone: "accent" },
          { label: "measure", qubits: [1, 2], tone: "warn" },
        ],
        outcomes: [],
      }),
    }),
  );
  const example = placeholder.find((section) => section.id === "example")!;
  assert.equal(example.held, false);
  assert.equal(example.reason, WORDS.notCircuit);

  // The fixture's own real circuit (one wire, one gate, a real outcome) still
  // holds — a placeholder match is exact, and this is not one.
  const real = recordSections(input());
  assert.equal(real.find((section) => section.id === "example")!.held, true);
});

test("the record page reads and writes the card's section parameter", () => {
  assert.equal(parseRecordSection("theory"), "theory");
  assert.equal(parseRecordSection("refinements"), null, "a card-only section is not a record section");
  assert.equal(parseRecordSection(undefined), null);
  assert.equal(recordSectionHref("/repository/x", "example"), "/repository/x?sec=example");
});
