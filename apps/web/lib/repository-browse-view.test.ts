import assert from "node:assert/strict";
import test from "node:test";

import { buildRepositoryBrowseView } from "./repository/browse-view.ts";
import type { ResolvedBrowseParams } from "./repository/browse-params.ts";
import type { RepositoryEstimateList, RepositoryEstimateSummary } from "./repository/estimate.ts";
import type { RepositoryProfileList } from "./repository/profile.ts";
import type { PublicRepositoryListEntry } from "./repository/types.ts";

/**
 * ai-ops 105 wiring tests.
 *
 * This file does NOT re-prove the ingredients — `matchesRepositoryQuery`,
 * `filterByTopic`, `filterByStance`, `orderEntries`, `foldRows`, `capRows` and
 * `deriveWidthFamilies` all have their own suites, and re-asserting their
 * internals here would be a second copy that could drift from the first. What
 * this file is the only place that can check is the WIRING: that
 * `buildRepositoryBrowseView` calls them in the right order, on the right
 * inputs, and — the reason ai-ops 105 exists — that what it returns is bounded
 * to what a request is actually about to draw rather than the whole corpus
 * `entries` arrived with.
 */

function entry(slug: string, overrides: Partial<PublicRepositoryListEntry> = {}): PublicRepositoryListEntry {
  return {
    slug,
    title: slug,
    titleJa: slug,
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Test family",
    framework: "Qiskit",
    status: "verified",
    verificationMethods: ["exact_simulation"],
    verification: "Simulated",
    exportStatus: "Seven-framework export",
    provenance: "Generated",
    updatedAt: "2026-01-01",
    description: "A test entry.",
    descriptionJa: "テストエントリ。",
    tags: [],
    topics: [],
    resources: [],
    visualization: { wires: ["q0"], operations: [], outcomes: [] },
    codeVariants: [],
    ...overrides,
  };
}

function params(overrides: Partial<ResolvedBrowseParams> = {}): ResolvedBrowseParams {
  return {
    topic: "",
    stance: "",
    category: "all",
    gate: null,
    query: "",
    order: "catalog",
    circuitOnly: false,
    rows: "all",
    ...overrides,
  };
}

function estimateRow(
  slug: string,
  overrides: Partial<RepositoryEstimateSummary> = {},
): RepositoryEstimateSummary {
  return {
    slug,
    basis: "exact",
    totalPhysicalQubits: 100,
    smallestMachineQubits: null,
    magicStates: null,
    logicalQubits: null,
    codeDistance: null,
    seconds: null,
    ...overrides,
  };
}

function estimateList(rows: RepositoryEstimateSummary[]): RepositoryEstimateList {
  return {
    assumptions: {
      identity: "test-basis@v1",
      name: "Test basis",
      version: 1,
      citation: "n/a",
      rotationSynthesisEpsilon: null,
      tPerRotation: null,
      tPerToffoli: 1,
      physicalErrorRate: 1e-3,
      cycleTimeS: 1e-6,
      reactionTimeS: 1e-6,
    },
    estimates: rows,
  };
}

// ---------------------------------------------------------------------------
// The core bound: a response never carries more than it is about to draw.
// ---------------------------------------------------------------------------

test("an unfiltered default view sends only the capped rows, not the whole corpus", () => {
  const corpus = Array.from({ length: 50 }, (_, index) => entry(`entry-${index}`));
  const view = buildRepositoryBrowseView(corpus, null, null, params({ rows: 5 }), "en");
  assert.equal(view.shownListRows.length, 5);
  assert.equal(view.facets.totalEntries, 50, "the facet total is still the whole corpus");
  assert.equal(view.cappableRowsLength, 50);
  assert.equal(view.nextRowLimit, 10, "doubling from 5");
});

test("search, category, topic and stance filter before the cap is ever applied", () => {
  const corpus = [
    entry("grover-search", { title: "Grover search", category: "algorithms", topics: ["algorithm-reference"] }),
    entry("hadamard-gate", { title: "Hadamard gate", category: "gates", topics: ["gate-primitive"] }),
    entry("bell-state", { title: "Bell state", category: "states", topics: ["state"] }),
  ];
  const view = buildRepositoryBrowseView(corpus, null, null, params({ query: "grover" }), "en");
  assert.equal(view.structureFilteredCount, 1);
  assert.equal(view.shownListRows.length, 1);
  assert.equal(view.shownListRows[0].kind === "single" ? view.shownListRows[0].entry.slug : null, "grover-search");

  const gatesView = buildRepositoryBrowseView(corpus, null, null, params({ category: "gates" }), "en");
  assert.equal(gatesView.gateEntries.length, 1);
  assert.equal(gatesView.gateEntries[0].slug, "hadamard-gate");

  const topicView = buildRepositoryBrowseView(corpus, null, null, params({ topic: "state" }), "en");
  assert.equal(topicView.structureFilteredCount, 1);

  // A gate primitive's derived stance is "transform" (interface.ts). Filtering
  // by stance alone, with the ACTIVE category still "all", must still route
  // the match through the plain list view — `gateEntries` only populates when
  // the category control itself is set to "gates", which is a different
  // selection from "this matched entry happens to be a gate".
  const stanceView = buildRepositoryBrowseView(corpus, null, null, params({ stance: "transform" }), "en");
  assert.equal(stanceView.structureFilteredCount, 1);
  assert.equal(stanceView.shownListRows.length, 1);
  assert.equal(stanceView.gateEntries.length, 0);
});

test("facet counts are corpus-wide and do not move when a filter narrows the rows sent", () => {
  const corpus = [
    entry("a", { topics: ["chemistry"] }),
    entry("b", { topics: ["chemistry"] }),
    entry("c", { topics: [] }),
  ];
  const unfiltered = buildRepositoryBrowseView(corpus, null, null, params(), "en");
  const filtered = buildRepositoryBrowseView(corpus, null, null, params({ topic: "chemistry" }), "en");
  assert.equal(unfiltered.facets.totalEntries, 3);
  assert.equal(filtered.facets.totalEntries, 3, "facet total ignores the active filter");
  assert.deepEqual(unfiltered.facets.topicGroups, filtered.facets.topicGroups);
  assert.equal(unfiltered.facets.entriesWithDomain, 2);
  assert.equal(filtered.facets.entriesWithDomain, 2, "a count that moved while filtering would be a hint, not a count");
  // The narrower view still only SENDS the matching rows.
  assert.equal(filtered.structureFilteredCount, 2);
});

// ---------------------------------------------------------------------------
// Ordering, the unranked split, and the estimate listing it draws from.
// ---------------------------------------------------------------------------

test("cost ordering ranks priced entries and holds unpriced ones out, and estimates are trimmed to what is sent", () => {
  const corpus = [
    entry("cheap", {}),
    entry("expensive", {}),
    entry("unpriced", {}),
  ];
  const estimates = estimateList([
    estimateRow("cheap", { totalPhysicalQubits: 10 }),
    estimateRow("expensive", { totalPhysicalQubits: 1000 }),
    estimateRow("unpriced", { basis: "no_circuit", totalPhysicalQubits: null }),
  ]);
  const view = buildRepositoryBrowseView(corpus, estimates, null, params({ order: "cost-asc" }), "en");
  assert.equal(view.canOrderByCost, true);
  assert.equal(view.orderAvailable, true);
  const rankedSlugs = view.shownListRows.map((row) => (row.kind === "single" ? row.entry.slug : null));
  assert.deepEqual(rankedSlugs, ["cheap", "expensive"]);
  assert.equal(view.unrankedCount, 1);
  assert.equal(view.shownUnrankedRows.length, 1);

  // Trimmed: three rows went in, but the response only ever draws three cards
  // total (all of them, here), so nothing is dropped in THIS case — the
  // meaningful assertion is in the next test, where one candidate is filtered
  // out entirely and its estimate row must not survive the trim either.
  assert.equal(view.estimates?.estimates.length, 3);
  assert.equal(view.estimates?.assumptions.identity, "test-basis@v1");
});

test("an estimate row for a filtered-out entry does not cross the wire", () => {
  const corpus = [
    entry("kept", { category: "algorithms" }),
    entry("dropped", { category: "gates" }),
  ];
  const estimates = estimateList([estimateRow("kept"), estimateRow("dropped")]);
  const view = buildRepositoryBrowseView(corpus, estimates, null, params({ category: "algorithms" }), "en");
  assert.deepEqual(
    view.estimates?.estimates.map((row) => row.slug),
    ["kept"],
  );
  // The assumption set is kept even though only one row survives — the "Costed
  // under" note needs it independent of how many rows are unranked or absent.
  assert.equal(view.estimates?.assumptions.identity, "test-basis@v1");
});

test("circuit-only keeps only entries whose profile is present, and only when a profile listing exists", () => {
  const corpus = [entry("with-circuit"), entry("without-circuit")];
  const profiles: RepositoryProfileList = {
    profiles: [
      {
        slug: "with-circuit",
        present: true,
        reason: null,
        qubits: 2,
        depth: 3,
        gateCount: 4,
        twoQubitGateCount: 1,
        measurementCount: 2,
      },
      { slug: "without-circuit", present: false, reason: "no circuit", qubits: null, depth: null, gateCount: null, twoQubitGateCount: null, measurementCount: null },
    ],
  };
  const view = buildRepositoryBrowseView(corpus, null, profiles, params({ circuitOnly: true }), "en");
  assert.equal(view.canOrderByStructure, true);
  assert.equal(view.structureFilteredCount, 1);

  // With no profile listing at all, circuit-only is a no-op (matches the
  // client's old `canOrderByStructure` gate on the filter).
  const noProfiles = buildRepositoryBrowseView(corpus, null, null, params({ circuitOnly: true }), "en");
  assert.equal(noProfiles.structureFilteredCount, 2);
});

// ---------------------------------------------------------------------------
// Folding: width families and the curated clusters, both over the whole
// corpus, both only sending the members that survive into the response.
// ---------------------------------------------------------------------------

test("a width family folds into one row, and a filtered-out member drops out of it rather than blocking the fold", () => {
  const widths = [2, 4, 6];
  const corpus = widths.map((width) =>
    entry(`bench-${width}q`, {
      title: `Bench chain · ${width} qubits`,
      titleJa: `Bench chain · ${width} qubits`,
    }),
  );
  const unfiltered = buildRepositoryBrowseView(corpus, null, null, params(), "en");
  assert.equal(unfiltered.shownListRows.length, 1, "three widths fold into one row");
  const row = unfiltered.shownListRows[0];
  assert.equal(row.kind, "group");
  if (row.kind === "group") assert.equal(row.members.length, 3);

  // Search narrows to one member. `foldRows`'s rule: a cluster reduced to one
  // survivor renders as a plain single row, and the OTHER two widths must not
  // appear anywhere in the response.
  const filtered = buildRepositoryBrowseView(corpus, null, null, params({ query: "2 qubits" }), "en");
  assert.equal(filtered.shownListRows.length, 1);
  assert.equal(filtered.shownListRows[0].kind, "single");
});

test("the curated QFT cluster folds its two slugs into one row when both are present", () => {
  const corpus = [
    entry("quantum-fourier-transform", { title: "Quantum Fourier transform" }),
    entry("qft-resource-screen", { title: "QFT resource screen" }),
    entry("unrelated", {}),
  ];
  const view = buildRepositoryBrowseView(corpus, null, null, params(), "en");
  const groupRow = view.shownListRows.find((row) => row.kind === "group");
  assert.ok(groupRow, "the curated cluster should have folded");
  if (groupRow?.kind === "group") {
    assert.equal(groupRow.group.key, "qft");
    assert.deepEqual(
      groupRow.members.map((member) => member.slug).sort(),
      ["qft-resource-screen", "quantum-fourier-transform"],
    );
  }
});

// ---------------------------------------------------------------------------
// The cap exemption for the gates and algorithms views (browse-page.ts's
// documented rule: neither ever paginates its main body).
// ---------------------------------------------------------------------------

test("gates and algorithms views are sent in full regardless of ?rows=, matching the pre-existing UX", () => {
  const gates = Array.from({ length: 8 }, (_, index) =>
    entry(`gate-${index}`, { category: "gates", topics: ["gate-primitive"] }),
  );
  const gatesView = buildRepositoryBrowseView(gates, null, null, params({ category: "gates", rows: 1 }), "en");
  assert.equal(gatesView.gateEntries.length, 8);
  assert.equal(gatesView.shownListRows.length, 0);

  const algorithms = Array.from({ length: 8 }, (_, index) =>
    entry(`algo-${index}`, { category: "algorithms", algorithmFamily: "Family A" }),
  );
  const algorithmsView = buildRepositoryBrowseView(
    algorithms,
    null,
    null,
    params({ category: "algorithms", rows: 1 }),
    "en",
  );
  const totalAlgoRows = algorithmsView.algorithmGroups.reduce((sum, group) => sum + group.rows.length, 0);
  assert.equal(totalAlgoRows, 8);
});

test("an empty match reports zero rather than throwing, and offers nothing more", () => {
  const corpus = [entry("only-entry")];
  const view = buildRepositoryBrowseView(corpus, null, null, params({ query: "nothing matches this" }), "en");
  assert.equal(view.structureFilteredCount, 0);
  assert.equal(view.shownListRows.length, 0);
  assert.equal(view.shownUnrankedRows.length, 0);
  assert.equal(view.nextRowLimit, null);
});
