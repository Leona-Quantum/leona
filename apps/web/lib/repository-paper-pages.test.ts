// What one paper's page shows, and the counts the index prints beside it.
//
// The corpus is a fixture here, for the reason `repository-topics.test.ts`
// gives. What this pins is the arithmetic and the distinctions — which of them
// a renderer could quietly collapse, and what a reader would be told if it did.
import assert from "node:assert/strict";
import test from "node:test";

import type { LayerGraph } from "./repository/layers.ts";
import type { PaperRegister } from "./repository/papers.ts";
import {
  paperIndexCensus,
  paperPageFor,
  paperPages,
  type PaperCorpusEntry,
} from "./repository/paper-pages.ts";

const contract = { from: "a", to: "b", takes: "x", takesJa: "x", returns: "y", returnsJa: "y" };
const cite = (n: string) => ({ title: "t", authors: "a", year: "2020", url: `https://arxiv.org/abs/${n}` });

const GRAPH: LayerGraph = {
  nodes: [
    {
      kind: "capability",
      id: "slot",
      label: "Slot",
      labelJa: "枠",
      summary: "s",
      summaryJa: "s",
      contract,
      whyALayer: "w",
      whyALayerJa: "w",
      citations: [cite("1")],
    },
    {
      kind: "method",
      id: "m1",
      label: "Method one",
      labelJa: "手法一",
      summary: "s",
      summaryJa: "s",
      realizes: "slot",
      steps: [],
      // The same paper twice on one node. One citing node, not two.
      citations: [cite("1"), cite("1")],
    },
    {
      kind: "method",
      id: "m2",
      label: "Method two",
      labelJa: "手法二",
      summary: "s",
      summaryJa: "s",
      realizes: "slot",
      steps: [],
      citations: [cite("2")],
    },
  ],
};

const REGISTER: PaperRegister = {
  papers: [
    {
      id: "arxiv:1",
      title: "One",
      authors: "A",
      year: "2020",
      url: "https://arxiv.org/abs/1",
      reports: { theory: "reported", simulation: "unknown", hardware: "absent" },
      reportsBasis: "abstract",
    },
    { id: "arxiv:2", title: "Two", authors: "B", year: "2021", url: "https://arxiv.org/abs/2" },
    { id: "arxiv:3", title: "Three", authors: "C", year: "2022", url: "https://arxiv.org/abs/3" },
  ],
};

const CORPUS: PaperCorpusEntry[] = [
  { slug: "record-a", title: "Record A", literature: [{ url: "https://arxiv.org/abs/1" }] },
  { slug: "record-b", title: "Record B", literature: [{ url: "https://arxiv.org/abs/1" }] },
];

test("every registered paper gets a page, including the ones nothing cites", () => {
  // A registered paper the map has not placed is the normal state of an
  // ingestion queue. Giving it an address is what makes the queue readable
  // rather than merely counted — dropping it would make the register's own
  // index disagree with the register.
  const pages = paperPages(REGISTER, GRAPH, CORPUS);
  assert.deepEqual(
    pages.map((page) => page.paper.id),
    ["arxiv:1", "arxiv:2", "arxiv:3"],
  );
  const three = paperPageFor(pages, "arxiv:3");
  assert.deepEqual(three?.nodes, []);
  assert.deepEqual(three?.records, []);
  // …and its trace is `null`, not `point`. The map does not cite it at all,
  // which is a different fact from citing it once, and a page that printed
  // "one node cites this" here would be simply false.
  assert.equal(three?.trace, null);
});

test("a node citing one paper twice is one citing node", () => {
  const page = paperPageFor(paperPages(REGISTER, GRAPH, CORPUS), "arxiv:1");
  assert.deepEqual(
    page?.nodes.map((site) => site.href),
    ["/repository/layers/slot", "/repository/layers/m1"],
  );
});

test("a slot and a method are labelled as different kinds of citing thing", () => {
  // Merging them would report "cited in 2 places" for a paper cited by a method
  // and by the slot it fills — which is one claim seen from two levels, not two
  // independent ones.
  const page = paperPageFor(paperPages(REGISTER, GRAPH, CORPUS), "arxiv:1");
  assert.deepEqual(
    page?.nodes.map((site) => site.kind),
    ["slot", "method"],
  );
  assert.deepEqual(
    page?.records.map((site) => [site.href, site.kind]),
    [
      ["/repository/record-a", "record"],
      ["/repository/record-b", "record"],
    ],
  );
});

test("a page with no Japanese record title falls back to the English one rather than blanking", () => {
  // A missing `titleJa` renders as an empty link on the Japanese page — a real
  // control with no label, which is worse than an untranslated one.
  const page = paperPageFor(paperPages(REGISTER, GRAPH, CORPUS), "arxiv:1");
  assert.equal(page?.records[0]?.labelJa, "Record A");
});

test("the index census counts overlapping facts against one total, and does not partition them", () => {
  const pages = paperPages(REGISTER, GRAPH, CORPUS);
  const census = paperIndexCensus(pages);
  assert.deepEqual(census, {
    papers: 3,
    read: 1,
    onMap: 2,
    inAtlas: 1,
    both: 1,
    queued: 1,
    spanning: 1,
  });
  // Deliberately NOT a partition: `arxiv:1` is counted in `onMap`, `inAtlas`,
  // `both`, `read` and `spanning` at once. Stated as inclusion–exclusion, which
  // is the identity a pie chart would break — cited-by-either plus cited-by-
  // neither is the whole register, and `both` is the term that has to be
  // subtracted exactly once.
  assert.equal(census.onMap + census.inAtlas - census.both + census.queued, census.papers);
  // …and the fixture genuinely exercises the overlap, so the identity above is
  // not satisfied trivially by `both === 0`.
  assert.ok(census.both > 0);
});

test("the bridge carries labels, never the ids it is computed from", () => {
  // `polynomial-approximation` printed in a reader-facing list is the data
  // model leaking onto the page. The trace's own field is ids by design; this
  // is where they stop being ids.
  const graph: LayerGraph = {
    nodes: [
      GRAPH.nodes[0],
      { ...GRAPH.nodes[1], citations: [cite("2")] },
      { ...GRAPH.nodes[2], citations: [cite("2")] },
    ],
  };
  const page = paperPageFor(paperPages(REGISTER, graph, []), "arxiv:2");
  assert.equal(page?.trace?.shape, "joinable");
  assert.deepEqual(page?.trace?.bridgeUpperBound, ["slot"]);
  assert.deepEqual(page?.bridge, [
    { href: "/repository/layers/slot", label: "Slot", labelJa: "枠", kind: "slot" },
  ]);
});

test("a trace with no bridge carries an empty one, on every shape", () => {
  // `point` and `contiguous` must not inherit a stale bridge from the previous
  // paper, and `scattered` has no walk at all — the field is empty in all
  // three, which is what lets a renderer test `bridge.length` alone.
  const pages = paperPages(REGISTER, GRAPH, CORPUS);
  for (const page of pages) {
    if (page.trace?.shape === "joinable") continue;
    assert.deepEqual(page.bridge, [], page.paper.id);
  }
});

test("the trace on a page is the same object the map census counted", () => {
  // Two surfaces read this; a page that recomputed the shape with its own rule
  // is how the index and the detail page start disagreeing about one paper.
  const pages = paperPages(REGISTER, GRAPH, CORPUS);
  assert.equal(paperPageFor(pages, "arxiv:1")?.trace?.shape, "contiguous");
  assert.equal(paperPageFor(pages, "arxiv:2")?.trace?.shape, "point");
});
