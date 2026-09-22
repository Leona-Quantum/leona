/**
 * The Atlas method finder's matching logic (proposal 2, owner-approved
 * 2026-09-20): filter and rank the corpus against what each record ACTUALLY
 * states, and never fabricate a cost or regime a record does not carry.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FINDER_LIMITS,
  buildFinderRecord,
  estimatesBySlug,
  findMethods,
  finderProblemOptions,
  statedCost,
  statedRegime,
  type FinderLimits,
  type FinderRecord,
} from "./repository/finder.ts";
import type { PublicRepositoryListEntry } from "./repository/types";
import type { RepositoryEstimateList } from "./repository/estimate.ts";

function record(overrides: Partial<FinderRecord> = {}): FinderRecord {
  return {
    slug: "grover-3q-101",
    title: "Grover unstructured search",
    titleJa: "グローバー探索",
    description: "Amplitude amplification over an unstructured database.",
    descriptionJa: "非構造データベースに対する振幅増幅。",
    algorithmFamily: "Amplitude amplification",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    provenance: "Grover 1996",
    framework: "Qiskit",
    tags: ["search", "oracle"],
    topics: ["algorithm-reference", "amplitude-amplification", "optimization"],
    resources: [
      { label: "Qubits", value: "5" },
      { label: "Depth", value: "14 gates" },
    ],
    portableCircuitQubits: 5,
    studioExampleId: "grover-3q-101",
    estimate: null,
    ...overrides,
  };
}

function limits(overrides: Partial<FinderLimits> = {}): FinderLimits {
  return { ...DEFAULT_FINDER_LIMITS, ...overrides };
}

// --- statedCost -------------------------------------------------------------

test("statedCost reads the authored 'Reported cost' row first", () => {
  const r = record({ resources: [{ label: "Reported cost", value: "O(N^(2/3)) queries" }] });
  const cost = statedCost(r);
  assert.equal(cost.stated, true);
  assert.equal(cost.value, "O(N^(2/3)) queries");
});

test("statedCost falls back to Qubits/Depth when there is no authored cost row", () => {
  const r = record({ resources: [{ label: "Qubits", value: "5" }, { label: "Depth", value: "14 gates" }] });
  const cost = statedCost(r);
  assert.equal(cost.stated, true);
  assert.equal(cost.value, "5 qubits, 14 gates");
});

test("statedCost reports not-stated for a record with neither field — never a fabricated number", () => {
  const r = record({ resources: [{ label: "Input", value: "Sparse A, |b⟩" }] });
  const cost = statedCost(r);
  assert.equal(cost.stated, false);
  assert.equal(cost.value, null);
});

test("statedCost gives the Japanese finder its own unit, not the English word", () => {
  const r = record({ resources: [{ label: "Qubits", value: "16" }] });
  const cost = statedCost(r);
  assert.equal(cost.value, "16 qubits");
  assert.equal(cost.valueJa, "16 量子ビット");
  assert.doesNotMatch(cost.valueJa ?? "", /qubits/);
});

test("statedCost treats a 'Reported cost' row saying nothing is stated as not stated", () => {
  // The Classiq-parity intake writes this sentence for a blank complexity.
  const r = record({ resources: [{ label: "Reported cost", value: "Not stated by the sources read" }] });
  assert.deepEqual(statedCost(r), { stated: false, value: null, valueJa: null });
});

test("statedCost still falls back to Qubits when the reported cost says nothing is stated", () => {
  const r = record({
    resources: [
      { label: "Reported cost", value: "Not stated by the sources read" },
      { label: "Qubits", value: "3" },
    ],
  });
  assert.equal(statedCost(r).value, "3 qubits");
});

// --- statedRegime -------------------------------------------------------------

test("statedRegime marks a speedup class checked against the primary paper", () => {
  const r = record({
    resources: [
      { label: "Speedup class (secondary source)", value: "Superpolynomial" },
      { label: "Primary source on the speedup", value: "Confirmed by section 4 of the primary paper" },
    ],
  });
  const regime = statedRegime(r);
  assert.equal(regime.stated, true);
  assert.match(regime.value ?? "", /checked against the record's own primary paper/);
  assert.doesNotMatch(regime.value ?? "", /not yet checked/);
});

test("statedRegime marks a speedup class NOT yet checked against the primary paper", () => {
  const r = record({
    resources: [
      { label: "Speedup class (secondary source)", value: "Superpolynomial" },
      { label: "Primary source on the speedup", value: "Not checked against the primary source yet" },
    ],
  });
  const regime = statedRegime(r);
  assert.equal(regime.stated, true);
  assert.match(regime.value ?? "", /not yet checked against the record's own primary paper/);
  assert.match(regime.valueJa ?? "", /まだ照合していません/);
  assert.doesNotMatch(regime.valueJa ?? "", /secondary index/);
});

test("statedRegime falls back to a stated Readiness row", () => {
  const r = record({ resources: [{ label: "Readiness", value: "FTQC required" }] });
  assert.deepEqual(statedRegime(r), { stated: true, value: "FTQC required", valueJa: "FTQC required" });
});

test("statedRegime reports not-stated for a record with neither field", () => {
  const r = record({ resources: [{ label: "Qubits", value: "5" }] });
  assert.deepEqual(statedRegime(r), { stated: false, value: null, valueJa: null });
});

// --- qubits / depth limits ----------------------------------------------------

test("a record missing the Qubits field is 'not stated', never excluded, when a qubit limit is set", () => {
  const r = record({ resources: [{ label: "Depth", value: "14 gates" }] });
  const outcome = findMethods([r], limits({ maxQubits: 10 }), true);
  assert.equal(outcome.matches.length, 1);
  const criterion = outcome.matches[0].criteria.find((c) => c.key === "qubits");
  assert.equal(criterion?.verdict, "not-stated");
  assert.match(criterion?.detail ?? "", /not stated in the source/);
});

test("a stated but non-numeric Qubits value is 'not stated', never guessed at", () => {
  const r = record({ resources: [{ label: "Qubits", value: "Problem mapped" }] });
  const outcome = findMethods([r], limits({ maxQubits: 10 }), true);
  assert.equal(outcome.matches.length, 1);
  const criterion = outcome.matches[0].criteria.find((c) => c.key === "qubits");
  assert.equal(criterion?.verdict, "not-stated");
  assert.match(criterion?.detail ?? "", /not a single number/);
});

test("a qubit count within the limit is satisfied and included", () => {
  const r = record({ resources: [{ label: "Qubits", value: "5" }] });
  const outcome = findMethods([r], limits({ maxQubits: 8 }), true);
  assert.equal(outcome.matches.length, 1);
  const criterion = outcome.matches[0].criteria.find((c) => c.key === "qubits");
  assert.equal(criterion?.verdict, "satisfied");
});

test("a qubit count over the limit excludes the record", () => {
  const r = record({ resources: [{ label: "Qubits", value: "16" }] });
  const outcome = findMethods([r], limits({ maxQubits: 8 }), true);
  assert.equal(outcome.matches.length, 0);
});

test("depth follows the same rule as qubits (satisfied / violated / not-stated)", () => {
  const within = record({ slug: "a", resources: [{ label: "Depth", value: "10 gates" }] });
  const over = record({ slug: "b", resources: [{ label: "Depth", value: "40 gates" }] });
  const absent = record({ slug: "c", resources: [] });
  const outcome = findMethods([within, over, absent], limits({ maxDepth: 20 }), true);
  const slugs = outcome.matches.map((m) => m.record.slug).sort();
  assert.deepEqual(slugs, ["a", "c"]);
  const absentMatch = outcome.matches.find((m) => m.record.slug === "c");
  assert.equal(absentMatch?.criteria.find((c) => c.key === "depth")?.verdict, "not-stated");
});

test("no qubit or depth limit set means every record passes those criteria (no criterion row at all)", () => {
  const r = record({ resources: [{ label: "Qubits", value: "999" }] });
  const outcome = findMethods([r], limits(), true);
  assert.equal(outcome.matches.length, 1);
  assert.equal(outcome.matches[0].criteria.some((c) => c.key === "qubits"), false);
});

// --- problem area + free text --------------------------------------------------

test("the problem filter is a hard filter against the domain-facet topics", () => {
  const chem = record({ slug: "a", topics: ["algorithm-reference", "chemistry"] });
  const opt = record({ slug: "b", topics: ["algorithm-reference", "optimization"] });
  const outcome = findMethods([chem, opt], limits({ problem: "chemistry" }), true);
  assert.deepEqual(outcome.matches.map((m) => m.record.slug), ["a"]);
});

test("free text matches title, description, family, framework and tags", () => {
  const r = record({ title: "Shor period finding", tags: ["factoring"] });
  const other = record({ slug: "unrelated", title: "Bell pair", tags: [] });
  const outcome = findMethods([r, other], limits({ query: "shor" }), true);
  assert.deepEqual(outcome.matches.map((m) => m.record.slug), ["grover-3q-101"]);
});

// --- data size (n) — always informational -------------------------------------

test("a data-size limit never excludes anything and always reads 'not stated'", () => {
  const r = record();
  const withoutLimit = findMethods([r], limits(), true);
  const withLimit = findMethods([r], limits({ dataSizeN: 50 }), true);
  assert.equal(withoutLimit.matches.length, 1);
  assert.equal(withLimit.matches.length, 1);
  const criterion = withLimit.matches[0].criteria.find((c) => c.key === "dataSize");
  assert.equal(criterion?.verdict, "not-stated");
  assert.match(criterion?.detail ?? "", /No record in this catalog carries/);
});

// --- hardware era ---------------------------------------------------------------

test("NISQ-era: a record with a runnable circuit is satisfied", () => {
  const r = record({ portableCircuitQubits: 4 });
  const outcome = findMethods([r], limits({ hardwareEra: "nisq" }), true);
  assert.equal(outcome.matches.length, 1);
  assert.equal(outcome.matches[0].criteria.find((c) => c.key === "hardwareEra")?.verdict, "satisfied");
});

test("NISQ-era: a record with no published circuit is excluded", () => {
  const r = record({ portableCircuitQubits: null });
  const outcome = findMethods([r], limits({ hardwareEra: "nisq" }), true);
  assert.equal(outcome.matches.length, 0);
});

test("fault-tolerant: a record with a priced estimate is satisfied", () => {
  const r = record({ estimate: { basis: "exact", totalPhysicalQubits: 12000, seconds: 3.2 } });
  const outcome = findMethods([r], limits({ hardwareEra: "fault-tolerant" }), true);
  assert.equal(outcome.matches.length, 1);
  const c = outcome.matches[0].criteria.find((k) => k.key === "hardwareEra");
  assert.equal(c?.verdict, "satisfied");
  assert.match(c?.detail ?? "", /12,000 physical qubits/);
});

test("fault-tolerant: a record stating 'FTQC required' is satisfied even with no estimate", () => {
  const r = record({ estimate: null, resources: [{ label: "Readiness", value: "FTQC required" }] });
  const outcome = findMethods([r], limits({ hardwareEra: "fault-tolerant" }), true);
  assert.equal(outcome.matches.length, 1);
  assert.equal(outcome.matches[0].criteria.find((c) => c.key === "hardwareEra")?.verdict, "satisfied");
});

test("fault-tolerant: when the estimator is unavailable, nothing is excluded on this basis and the reason says so", () => {
  const r = record({ estimate: null, resources: [] });
  const outcome = findMethods([r], limits({ hardwareEra: "fault-tolerant" }), false);
  assert.equal(outcome.matches.length, 1);
  const c = outcome.matches[0].criteria.find((k) => k.key === "hardwareEra");
  assert.equal(c?.verdict, "not-stated");
  assert.match(c?.detail ?? "", /estimator is not wired/);
});

test("fault-tolerant: when the estimator IS available and states nothing for this record, it is excluded", () => {
  const r = record({ estimate: null, resources: [] });
  const outcome = findMethods([r], limits({ hardwareEra: "fault-tolerant" }), true);
  assert.equal(outcome.matches.length, 0);
});

test("an estimate that exists but was refused does not satisfy fault-tolerant", () => {
  const r = record({ estimate: { basis: "refused", totalPhysicalQubits: null, seconds: null } });
  const outcome = findMethods([r], limits({ hardwareEra: "fault-tolerant" }), true);
  assert.equal(outcome.matches.length, 0);
});

// --- a limit that excludes everything → empty, and says why -------------------

test("a limit that excludes every record returns an empty match list", () => {
  const r = record({ resources: [{ label: "Qubits", value: "50" }] });
  const outcome = findMethods([r], limits({ maxQubits: 1 }), true);
  assert.equal(outcome.matches.length, 0);
});

test("excludedByOnly names which single limit is doing the excluding", () => {
  const a = record({ slug: "a", resources: [{ label: "Qubits", value: "50" }] }); // fails qubits only
  const b = record({ slug: "b", topics: ["algorithm-reference", "finance"] }); // fails problem only
  const outcome = findMethods(
    [a, b],
    limits({ maxQubits: 8, problem: "optimization" }),
    true,
  );
  assert.equal(outcome.matches.length, 0);
  // `a` fails qubits alone (its topics include "optimization"); `b` fails problem alone.
  assert.equal(outcome.excludedByOnly.qubits, 1);
  assert.equal(outcome.excludedByOnly.problem, 1);
});

// --- ranking --------------------------------------------------------------------

test("records with more satisfied limits rank first", () => {
  const strong = record({ slug: "strong", resources: [{ label: "Qubits", value: "5" }, { label: "Depth", value: "10 gates" }] });
  const weak = record({ slug: "weak", resources: [{ label: "Qubits", value: "5" }] });
  const outcome = findMethods(
    [weak, strong],
    limits({ maxQubits: 8, maxDepth: 20 }),
    true,
  );
  assert.deepEqual(outcome.matches.map((m) => m.record.slug), ["strong", "weak"]);
});

test("a runnable worked example breaks a tie between equally-evidenced records", () => {
  const withExample = record({ slug: "b-has-example", title: "B method", studioExampleId: "some-example" });
  const withoutExample = record({ slug: "a-no-example", title: "A method", studioExampleId: null });
  const outcome = findMethods([withoutExample, withExample], limits(), true);
  assert.deepEqual(outcome.matches.map((m) => m.record.slug), ["b-has-example", "a-no-example"]);
});

// --- finderProblemOptions --------------------------------------------------------

test("finderProblemOptions counts only domain topics actually present, and omits zero-count ones", () => {
  const a = record({ slug: "a", topics: ["algorithm-reference", "chemistry"] });
  const b = record({ slug: "b", topics: ["algorithm-reference", "chemistry"] });
  const c = record({ slug: "c", topics: ["algorithm-reference", "finance"] });
  const options = finderProblemOptions([a, b, c]);
  const chemistry = options.find((o) => o.id === "chemistry");
  const finance = options.find((o) => o.id === "finance");
  assert.equal(chemistry?.count, 2);
  assert.equal(finance?.count, 1);
  assert.equal(options.some((o) => o.id === "cryptography"), false);
});

test("finderProblemOptions returns nothing when no record carries a domain topic", () => {
  const a = record({ topics: ["algorithm-reference"] });
  assert.deepEqual(finderProblemOptions([a]), []);
});

// --- buildFinderRecord / estimatesBySlug (the join the server page performs) ----

function listEntry(overrides: Partial<PublicRepositoryListEntry> = {}): PublicRepositoryListEntry {
  return {
    slug: "grover-3q-101",
    title: "Grover unstructured search",
    titleJa: "グローバー探索",
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Amplitude amplification",
    framework: "Qiskit",
    status: "verified",
    verification: "Simulated",
    exportStatus: "exportable",
    provenance: "Grover 1996",
    updatedAt: "2026-01-01",
    description: "Amplitude amplification over an unstructured database.",
    descriptionJa: "非構造データベースに対する振幅増幅。",
    tags: ["search"],
    topics: ["algorithm-reference", "amplitude-amplification"],
    resources: [{ label: "Qubits", value: "3" }],
    visualization: { wires: [], operations: [], outcomes: [] },
    codeVariants: [],
    ...overrides,
  } as PublicRepositoryListEntry;
}

test("buildFinderRecord reads portableCircuit.qubitCount off the list projection", () => {
  const entry = listEntry({ portableCircuit: { qubitCount: 3, measure: true } });
  const built = buildFinderRecord(entry, null, null);
  assert.equal(built.portableCircuitQubits, 3);
});

test("buildFinderRecord reports null qubits for a record with no portableCircuit — never a guessed width", () => {
  const built = buildFinderRecord(listEntry(), null, null);
  assert.equal(built.portableCircuitQubits, null);
});

test("buildFinderRecord defaults topics to an empty array when the list row carries none", () => {
  const built = buildFinderRecord(listEntry({ topics: undefined }), null, "x");
  assert.deepEqual(built.topics, []);
  assert.equal(built.studioExampleId, "x");
});

test("estimatesBySlug is empty when the estimate list is null (the estimator not wired)", () => {
  assert.equal(estimatesBySlug(null).size, 0);
});

test("estimatesBySlug indexes each row by slug", () => {
  const list: RepositoryEstimateList = {
    assumptions: {
      identity: "gidney-2025@v2", name: "Gidney 2025", version: 2, citation: "c",
      rotationSynthesisEpsilon: 1e-6, tPerRotation: 1, tPerToffoli: 4,
      physicalErrorRate: 1e-3, cycleTimeS: 1e-6, reactionTimeS: 1e-6,
    },
    estimates: [
      { slug: "a", basis: "exact", totalPhysicalQubits: 100, smallestMachineQubits: null, magicStates: 1, logicalQubits: 5, codeDistance: 3, seconds: 1 },
    ],
  };
  const map = estimatesBySlug(list);
  assert.equal(map.size, 1);
  assert.deepEqual(map.get("a"), { basis: "exact", totalPhysicalQubits: 100, seconds: 1 });
  assert.equal(map.get("nonexistent"), undefined);
});
