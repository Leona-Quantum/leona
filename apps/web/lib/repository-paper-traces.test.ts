// Is a paper a line on the map, or a scatter of points? The measurement that
// had to come before the surface.
//
// The fixtures here are hand-built graphs rather than the real one, for the
// reason `repository-topics.test.ts` gives. `scripts/check-layer-graph.mjs`
// runs the same functions over the real 76-node graph and prints the census.
import assert from "node:assert/strict";
import test from "node:test";

import type { LayerGraph } from "./repository/layers.ts";
import {
  layerAdjacency,
  paperTraces,
  papersByNode,
  traceCensus,
  traceFor,
  traceNodes,
} from "./repository/paper-traces.ts";

const contract = {
  from: "a-state",
  to: "b-state",
  takes: "x",
  takesJa: "x",
  returns: "y",
  returnsJa: "y",
};

const capability = (id: string, citations: string[] = []) =>
  ({
    kind: "capability",
    id,
    label: id,
    labelJa: id,
    summary: "s",
    summaryJa: "s",
    contract,
    whyALayer: "w",
    whyALayerJa: "w",
    citations: citations.map((url) => ({ title: "t", authors: "a", year: "2020", url })),
  }) as const;

const method = (
  id: string,
  realizes: string,
  steps: string[] = [],
  citations: string[] = [],
  extra: Record<string, unknown> = {},
) =>
  ({
    kind: "method",
    id,
    label: id,
    labelJa: id,
    summary: "s",
    summaryJa: "s",
    realizes,
    steps,
    citations: citations.map((url) => ({ title: "t", authors: "a", year: "2020", url })),
    ...extra,
  }) as const;

const paper = (n: number) => `https://arxiv.org/abs/${n}`;

test("a paper cited once is a point, and a point is not a line", () => {
  // 60 of the real map's 84 papers land here. Reporting them as traces would
  // promise a line for every one and draw nothing, which is why `point` is its
  // own shape rather than a zero-length `contiguous`.
  const graph: LayerGraph = {
    nodes: [capability("slot"), method("m", "slot", [], [paper(1)])],
  };
  const [trace] = paperTraces(graph);
  assert.equal(trace.shape, "point");
  assert.deepEqual(trace.nodes, ["m"]);
  assert.deepEqual(trace.bridgeUpperBound, []);
});

test("a method and the slot it fills are adjacent, so citing both is contiguous", () => {
  const graph: LayerGraph = {
    nodes: [capability("slot", [paper(1)]), method("m", "slot", [], [paper(1)])],
  };
  const [trace] = paperTraces(graph);
  assert.equal(trace.shape, "contiguous");
  assert.equal(trace.components.length, 1);
  assert.deepEqual(trace.bridgeUpperBound, []);
});

test("two siblings citing one paper are joinable through the slot they compete for", () => {
  // The commonest real shape: a paper cited by two competing methods. There IS
  // a line, but it runs through a node the paper does not cite, and calling
  // that `contiguous` would claim the paper is cited somewhere it is not.
  const graph: LayerGraph = {
    nodes: [
      capability("slot"),
      method("m1", "slot", [], [paper(1)]),
      method("m2", "slot", [], [paper(1)]),
    ],
  };
  const [trace] = paperTraces(graph);
  assert.equal(trace.shape, "joinable");
  assert.equal(trace.components.length, 2);
  assert.deepEqual(trace.bridgeUpperBound, ["slot"]);
  assert.deepEqual(
    traceNodes(graph, trace).map((node) => node.id),
    ["slot", "m1", "m2"],
  );
});

test("citations in two different components of the map are scattered, and carry no bridge", () => {
  // `scattered` must not carry a partial bridge: a list of nodes there would
  // read as "these join it", and nothing joins it. Absent and empty mean
  // different things, which is the same doctrine as `repeats`.
  const graph: LayerGraph = {
    nodes: [
      capability("slot-a"),
      method("m1", "slot-a", [], [paper(1)]),
      capability("slot-b"),
      method("m2", "slot-b", [], [paper(1)]),
    ],
  };
  const [trace] = paperTraces(graph);
  assert.equal(trace.shape, "scattered");
  assert.equal(trace.components.length, 2);
  assert.equal(trace.bridgeUpperBound, undefined);
});

test("a bypass does not join a trace", () => {
  // The load-bearing claim in this module. `bypasses` records that a route does
  // NOT enter a layer; joining two citations through one would draw a line
  // through a node the cited route explicitly avoids — the strongest negative
  // claim on the surface, read backwards.
  //
  // This graph is scattered ONLY because the bypass is not an edge. The
  // assertion below pins that: flip `bypasses` to `steps` in paper-traces.ts
  // and this becomes `joinable`, which is the mutation this test exists for.
  const graph: LayerGraph = {
    nodes: [
      capability("skipped"),
      capability("slot-a"),
      method("m1", "slot-a", [], [paper(1)], { bypasses: ["skipped"] }),
      capability("slot-b"),
      method("m2", "slot-b", ["skipped"], [paper(1)]),
    ],
  };
  const [trace] = paperTraces(graph);
  assert.equal(trace.shape, "scattered");
  // …and the adjacency itself never carries the bypass edge.
  assert.equal(layerAdjacency(graph).get("m1")?.has("skipped"), false);
  // The other direction, so the test cannot pass because `skipped` is missing
  // from the graph entirely: m2's `steps` edge to it IS present.
  assert.equal(layerAdjacency(graph).get("m2")?.has("skipped"), true);
});

test("a refinement is an edge — a narrower version of a method sits next to it", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("slot"),
      method("broad", "slot", [], [paper(1)]),
      method("narrow", "slot", [], [paper(1)], { refines: "broad" }),
    ],
  };
  assert.equal(paperTraces(graph)[0].shape, "contiguous");
});

test("the bridge is an upper bound and the greedy walk never reports a node twice", () => {
  // Three citations round one slot: joining them costs the slot once, not once
  // per component. A bridge that grew with the number of pieces would make
  // every multi-cited paper look further apart than it is.
  const graph: LayerGraph = {
    nodes: [
      capability("slot"),
      method("m1", "slot", [], [paper(1)]),
      method("m2", "slot", [], [paper(1)]),
      method("m3", "slot", [], [paper(1)]),
    ],
  };
  const [trace] = paperTraces(graph);
  assert.equal(trace.components.length, 3);
  assert.deepEqual(trace.bridgeUpperBound, ["slot"]);
});

test("an unparseable citation url is skipped rather than thrown on", () => {
  // `check-paper-register.mjs` already fails the build on one of these. This
  // measurement has to stay runnable on a broken tree, which is when you most
  // want to run it.
  const graph: LayerGraph = {
    nodes: [capability("slot"), method("m", "slot", [], ["https://example.org/not-a-paper"])],
  };
  assert.deepEqual(paperTraces(graph), []);
  assert.equal(papersByNode(graph).size, 0);
});

test("the census sums to the number of papers, so no shape can go uncounted", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("slot", [paper(3)]),
      method("m1", "slot", [], [paper(1), paper(3)]),
      method("m2", "slot", [], [paper(1)]),
      capability("far"),
      method("m3", "far", [], [paper(2)]),
      method("m4", "far", [], [paper(4)]),
    ],
  };
  const traces = paperTraces(graph);
  const census = traceCensus(traces);
  assert.equal(census.papers, traces.length);
  assert.equal(census.point + census.contiguous + census.joinable + census.scattered, census.papers);
  // `drawable` is `contiguous` and must not quietly absorb `joinable` — the
  // difference is whether the line passes through a node the paper cites.
  assert.equal(census.drawable, census.contiguous);
  assert.equal(census.widest, Math.max(...traces.map((trace) => trace.nodes.length)));
  assert.equal(traceFor(traces, "arxiv:nothing"), null);
  assert.equal(traceFor(traces, "arxiv:1")?.paper, "arxiv:1");
});
