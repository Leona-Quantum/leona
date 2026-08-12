// The repository's folder navigation — category, then algorithm family, then topic.
//
// The corpus is not imported here, for the reason `repository-topics.test.ts` states:
// `node --test` resolves paths literally and `public-repository.ts` reaches its entry
// modules extensionlessly. The rules are pinned against fixtures here;
// `scripts/check-repository-data.mjs` runs the same functions over the real corpus and
// prints its denominators, so the two cannot drift.
//
// **Every failure mode below is driven, not asserted about.** A tree builder that
// returned an empty refusal list unconditionally would pass a suite that only ever
// looked at a healthy corpus, and the healthy corpus is the one it will be run against
// every day. So each refusal kind gets a fixture that produces it.
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFolderTree,
  folderSegment,
  resolveFolderPath,
  type FolderNode,
  type FolderRecord,
} from "./repository/folder-tree.ts";

function record(over: Partial<FolderRecord> & Pick<FolderRecord, "slug">): FolderRecord {
  return {
    title: over.slug,
    titleJa: over.slug,
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Quantum walk",
    topics: ["algorithm-reference", "quantum-walk"],
    ...over,
  };
}

const CORPUS: readonly FolderRecord[] = [
  record({ slug: "quantum-walk-line" }),
  record({ slug: "element-distinctness" }),
  record({
    slug: "grover-unstructured-search",
    algorithmFamily: "Quantum query algorithm",
    topics: ["algorithm-reference", "oracle-query", "amplitude-amplification"],
  }),
  record({
    slug: "hadamard-gate",
    category: "gates",
    categoryLabel: "Gates",
    categoryLabelJa: "ゲート",
    algorithmFamily: "Single-qubit gate",
    topics: ["gate-primitive"],
  }),
  record({
    slug: "cnot-gate",
    category: "gates",
    categoryLabel: "Gates",
    categoryLabelJa: "ゲート",
    algorithmFamily: "Two-qubit gate",
    topics: ["gate-primitive", "routing"],
  }),
];

test("the tree is category, then family, then topic — the shape the owner picked", () => {
  const tree = buildFolderTree(CORPUS);
  assert.deepEqual(tree.refused, []);
  assert.deepEqual(tree.unreachable, []);
  assert.equal(tree.placed, CORPUS.length);

  assert.deepEqual(
    tree.root.map((node) => [node.segment, node.records]),
    [
      // Biggest first: three algorithms, two gates.
      ["algorithms", 3],
      ["gates", 2],
    ],
  );
  const algorithms = tree.root[0]!;
  assert.deepEqual(
    algorithms.children.map((node) => [node.segment, node.records]),
    [
      ["quantum-walk", 2],
      ["quantum-query-algorithm", 1],
    ],
  );
  // The third level, and it is the topic vocabulary rather than free text — the label
  // and the one-line definition both come from `topics.ts`.
  const walk = algorithms.children[0]!;
  assert.deepEqual(
    walk.children.map((node) => [node.segment, node.records]),
    [
      ["algorithm-reference", 2],
      ["quantum-walk", 2],
    ],
  );
  assert.ok((walk.children[0]!.note ?? "").length > 0, "a topic folder carries its definition");
  assert.ok(
    (walk.children[0]!.noteJa ?? "").length > 0,
    "…in both locales, or a Japanese reader gets an English sentence",
  );
});

test("the order is fixed by the data, not by corpus order", () => {
  // Same records, shuffled. Two renders of one corpus must be one page.
  const forwards = buildFolderTree(CORPUS);
  const backwards = buildFolderTree([...CORPUS].reverse());
  assert.deepEqual(
    backwards.root.map((n) => [n.segment, n.children.map((c) => c.segment)]),
    forwards.root.map((n) => [n.segment, n.children.map((c) => c.segment)]),
  );
});

test("a topic count may exceed its family's, and the family's own number is the honest one", () => {
  // The property the surface has to be able to state. `grover-unstructured-search`
  // carries three topics, so its family's three topic folders each hold it: the
  // children sum to 3 while the family holds 1. That is a fact about a facet, not a
  // miscount, and a reader who adds the children up must not be contradicted by the
  // parent.
  const tree = buildFolderTree(CORPUS);
  const query = tree.root[0]!.children.find((node) => node.segment === "quantum-query-algorithm")!;
  assert.equal(query.records, 1);
  assert.equal(
    query.children.reduce((total, node) => total + node.records, 0),
    3,
  );
});

test("two families that slug the same are refused, not silently merged", () => {
  // The failure this is here to catch is invisible on the page: the folder renders,
  // its count is plausible, and one of the two families is simply not in the list.
  const colliding = [
    record({ slug: "a", algorithmFamily: "Block encoding · LCU" }),
    record({ slug: "b", algorithmFamily: "Block encoding / LCU" }),
  ];
  const tree = buildFolderTree(colliding);
  assert.equal(tree.refused.length, 1);
  assert.equal(tree.refused[0]!.kind, "slug-collision");
  assert.equal(tree.refused[0]!.subject, "block-encoding-lcu");
  assert.deepEqual(tree.refused[0]!.detail, ["Block encoding · LCU", "Block encoding / LCU"]);
  // And the records it could not place are named, so the count and the reading list
  // agree about who is missing.
  assert.deepEqual(tree.unreachable, ["b"]);
  assert.equal(tree.placed, 1);
});

test("one family name under two categories is two folders, not a collision", () => {
  // `Pauli operator` is a family under both `gates` and `operators` in the real
  // corpus. Claiming segments globally would report that as a collision and drop one
  // of them — a false positive that costs a whole folder.
  const tree = buildFolderTree([
    record({ slug: "pauli-x", category: "gates", categoryLabel: "Gates", categoryLabelJa: "ゲート", algorithmFamily: "Pauli operator", topics: ["gate-primitive"] }),
    record({ slug: "pauli-string", category: "operators", categoryLabel: "Operators", categoryLabelJa: "演算子", algorithmFamily: "Pauli operator", topics: ["operator"] }),
  ]);
  assert.deepEqual(tree.refused, []);
  assert.deepEqual(
    tree.root.map((node) => [node.segment, node.children.map((child) => child.segment)]),
    [
      ["gates", ["pauli-operator"]],
      ["operators", ["pauli-operator"]],
    ],
  );
});

test("a record with no family, or no topic in the vocabulary, is reported rather than lost", () => {
  const tree = buildFolderTree([
    record({ slug: "homeless", algorithmFamily: "   " }),
    record({ slug: "untagged", topics: [] }),
    record({ slug: "off-vocabulary", topics: ["not-a-topic-id"] }),
    record({ slug: "fine" }),
  ]);
  assert.deepEqual(
    tree.refused.map((refusal) => [refusal.kind, refusal.subject]),
    [
      ["no-family", "homeless"],
      ["no-topic", "untagged"],
      ["no-topic", "off-vocabulary"],
    ],
  );
  assert.deepEqual(tree.unreachable, ["homeless", "off-vocabulary", "untagged"]);
  assert.equal(tree.placed, 1);
});

test("a folder offered is a folder that holds something", () => {
  // An empty folder is a click that goes nowhere, and the renderer for it is the one
  // nobody exercises. Swept over every node rather than spot-checked.
  const tree = buildFolderTree(CORPUS);
  let swept = 0;
  const walk = (nodes: readonly FolderNode[], trail: string[]): void => {
    for (const node of nodes) {
      swept += 1;
      assert.ok(node.records > 0, `${[...trail, node.segment].join("/")} is an empty folder`);
      walk(node.children, [...trail, node.segment]);
    }
  };
  walk(tree.root, []);
  assert.ok(swept >= 9, `only ${swept} folders swept — the sweep has gone quiet`);
});

test("a path resolves through the built index, and an unknown segment is a 404", () => {
  const tree = buildFolderTree(CORPUS);
  const at = (path: string[]) => resolveFolderPath(tree, CORPUS, path);

  assert.equal(at([])!.level, "root");
  assert.deepEqual(at([])!.records, []);

  const category = at(["algorithms"])!;
  assert.equal(category.level, "category");
  assert.deepEqual(category.trail.map((node) => node.segment), ["algorithms"]);
  // A category lists folders, not records: it holds hundreds in the real corpus and
  // the list would bury the navigation it is there to offer.
  assert.deepEqual(category.records, []);

  const family = at(["algorithms", "quantum-walk"])!;
  assert.equal(family.level, "family");
  assert.deepEqual(family.records.map((entry) => entry.slug), ["quantum-walk-line", "element-distinctness"]);

  const topic = at(["algorithms", "quantum-query-algorithm", "oracle-query"])!;
  assert.equal(topic.level, "topic");
  assert.deepEqual(topic.records.map((entry) => entry.slug), ["grover-unstructured-search"]);

  // **Not a filter.** `browse-params.ts` resolves an unrecognised `?topic=` to no
  // filter, on purpose. A path segment is an identity, and answering a made-up folder
  // with its parent's contents tells the reader a folder exists that does not.
  assert.equal(at(["made-up"]), null);
  assert.equal(at(["algorithms", "made-up"]), null);
  assert.equal(at(["algorithms", "quantum-walk", "chemistry"]), null, "a topic no record here carries");
  assert.equal(at(["algorithms", "quantum-walk", "quantum-walk", "deeper"]), null, "the tree is three deep");
  // Case and separators are normalised on the way IN to a segment, never on the way
  // out of a URL: the lookup is an exact match against what the tree built.
  assert.equal(at(["Algorithms"]), null);
});

test("folderSegment is lossy in the ways the collision check assumes", () => {
  // Pinned because the collision rule above is only worth anything if this really can
  // collapse two different names onto one segment.
  assert.equal(folderSegment("QAOA / MaxCut"), "qaoa-maxcut");
  assert.equal(folderSegment("Quantum differential equations · linear"), "quantum-differential-equations-linear");
  assert.equal(folderSegment("Quantum counting (QPE + Grover)"), "quantum-counting-qpe-grover");
  assert.equal(folderSegment("  Hamiltonian simulation  "), "hamiltonian-simulation");
  assert.equal(folderSegment("Schrödinger"), "schrodinger", "a combining mark loses the mark, not the letter");
  // The two the collision test relies on, spelled out here so that test cannot pass
  // for the wrong reason.
  assert.equal(folderSegment("Block encoding · LCU"), folderSegment("Block encoding / LCU"));
});
