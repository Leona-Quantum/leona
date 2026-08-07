// The layer graph's derivations, and the one property three sessions of
// shipped bugs say has to be pinned rather than reviewed.
//
// Fixtures are built in-file rather than read off the authored graph, on this
// directory's standing rule: a test that reads the real corpus asserts today's
// content and goes green the day the content changes for an unrelated reason.
//
// **The 283 records are not imported here**, for the reason
// `repository-interface.test.ts` and `repository-topics.test.ts` both state:
// `public-repository.ts` reaches its entry modules with extensionless
// specifiers and `node --test` resolves paths literally. So the split is —
// everything *internal* to the graph is asserted below against the authored
// nodes, and the one rule that needs the corpus (`entries` names a slug that
// exists) is asserted by `scripts/check-layer-graph.mjs`, which bundles with
// esbuild and runs in `lint`. Both callers run the **same**
// `validateLayerGraph`, so the rules cannot drift apart.
import assert from "node:assert/strict";
import test from "node:test";

import {
  alternativesTo,
  bypassersOf,
  capabilityOutlook,
  containersOf,
  entriesFor,
  indexLayerGraph,
  isMethod,
  layerCensus,
  layerDepths,
  layerNode,
  nodesForEntry,
  refinementsOf,
  rootCapabilities,
  siblingsOf,
  stepsOutlook,
  validateLayerGraph,
  type LayerCapability,
  type LayerGraph,
  type LayerMethod,
} from "./repository/layers.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";

const CITE = [{ title: "A paper", authors: "Someone", year: "2020", url: "https://example.org/a" }];

function capability(id: string, extra: Partial<LayerCapability> = {}): LayerCapability {
  return {
    kind: "capability",
    id,
    label: id,
    labelJa: id,
    summary: "s",
    summaryJa: "s",
    contract: { takes: "t", takesJa: "t", returns: "r", returnsJa: "r" },
    whyALayer: "w",
    whyALayerJa: "w",
    ...extra,
  };
}

function method(id: string, realizes: string, extra: Partial<LayerMethod> = {}): LayerMethod {
  return {
    kind: "method",
    id,
    label: id,
    labelJa: id,
    summary: "s",
    summaryJa: "s",
    contract: { takes: "t", takesJa: "t", returns: "r", returnsJa: "r" },
    realizes,
    steps: [],
    atomic: true,
    citations: CITE,
    ...extra,
  };
}

/**
 * The shape the derivations are read against.
 *
 * `solve` is filled three ways; `fast` is a narrower version of `direct`, and
 * `other` is an unrelated approach. `via-steps` needs `encode`, and `around`
 * skips it — the two edges the whole surface exists to show.
 */
const FIXTURE: LayerGraph = {
  nodes: [
    capability("solve"),
    capability("encode"),
    method("direct", "solve", { steps: ["encode"], atomic: undefined }),
    method("fast", "solve", { refines: "direct" }),
    method("other", "solve", { bypasses: ["encode"] }),
    method("encode-a", "encode", { entries: ["real-slug"] }),
  ],
};

test("a capability's methods are found by the slot they fill, not by order", () => {
  assert.deepEqual(
    containersOf(FIXTURE, "encode").map((m) => m.id),
    ["direct"],
  );
  assert.deepEqual(
    bypassersOf(FIXTURE, "encode").map((m) => m.id),
    ["other"],
  );
});

test("alternatives and refinements partition the siblings, and either may be empty", () => {
  const direct = layerNode(FIXTURE, "direct");
  assert.ok(direct && isMethod(direct));
  const siblings = siblingsOf(FIXTURE, direct).map((m) => m.id).sort();
  const alternatives = alternativesTo(FIXTURE, direct).map((m) => m.id).sort();
  const refinements = refinementsOf(FIXTURE, direct).map((m) => m.id).sort();

  // Disjoint, and the union is the whole sibling set. This is the property, and
  // it is pinned rather than the wording, because the wording is what shipped
  // false three sessions running: 「ほか N 件」 and "N more" both presuppose a
  // preceding set, and the record that motivated the panel had zero in it.
  assert.deepEqual([...alternatives, ...refinements].sort(), siblings);
  for (const id of refinements) assert.ok(!alternatives.includes(id));

  // Either side may be zero, and neither zero is an error.
  const other = layerNode(FIXTURE, "other");
  assert.ok(other && isMethod(other));
  assert.deepEqual(refinementsOf(FIXTURE, other), []);
  assert.equal(alternativesTo(FIXTURE, other).length, 2);
});

test("a method that refines a sibling is still an alternative to the other siblings", () => {
  // `fast` refines `direct`. To `other` it is a competing approach, and
  // flattening it away would hide a real option.
  const other = layerNode(FIXTURE, "other");
  assert.ok(other && isMethod(other));
  assert.ok(alternativesTo(FIXTURE, other).some((m) => m.id === "fast"));
});

test("no steps means two different things and they are not collapsed", () => {
  const direct = layerNode(FIXTURE, "direct");
  const fast = layerNode(FIXTURE, "fast");
  assert.ok(direct && isMethod(direct) && fast && isMethod(fast));
  assert.equal(stepsOutlook(direct), "decomposed");
  assert.equal(stepsOutlook(fast), "atomic");
  assert.equal(
    stepsOutlook({ ...fast, atomic: undefined }),
    "undecomposed",
    "a method nobody has decomposed must not read as one that bottoms out on purpose",
  );
});

test("a slot nothing fills is its own state, not an empty list", () => {
  assert.equal(capabilityOutlook(FIXTURE, "solve"), "realized");
  const orphan: LayerGraph = { nodes: [capability("nobody-does-this")] };
  assert.equal(capabilityOutlook(orphan, "nobody-does-this"), "open");
});

test("depth is the shortest path from a root, and roots are slots nothing steps into", () => {
  assert.deepEqual(
    rootCapabilities(FIXTURE).map((c) => c.id),
    ["solve"],
  );
  const depths = layerDepths(FIXTURE);
  assert.equal(depths.get("solve"), 0);
  assert.equal(depths.get("encode"), 1);
});

test("a corpus slug that does not resolve is dropped rather than linked into a 404", () => {
  const corpus = new Set(["real-slug"]);
  const encodeA = layerNode(FIXTURE, "encode-a");
  assert.ok(encodeA);
  assert.deepEqual(entriesFor(encodeA, corpus), ["real-slug"]);
  assert.deepEqual(entriesFor(encodeA, new Set<string>()), []);
  assert.deepEqual(
    nodesForEntry(FIXTURE, "real-slug").map((n) => n.id),
    ["encode-a"],
  );
});

test("the census counts what is there, including what is not", () => {
  const census = layerCensus(FIXTURE, new Set(["real-slug"]));
  assert.equal(census.nodes, 6);
  assert.equal(census.capabilities, 2);
  assert.equal(census.methods, 4);
  assert.equal(census.anchored, 1);
  assert.equal(census.openCapabilities, 0);
  assert.equal(census.distinctEntries, 1);
  assert.equal(census.unresolvedEntries, 0);
});

test("a corpus that does not carry a declared slug is counted, not silently absorbed", () => {
  // The lint script proves every cross-link resolves against the corpus in the
  // repo. Nothing proves it against the corpus the API serves at read time, and
  // `anchored` would simply come out lower — a number about our own coverage,
  // quietly wrong. The shortfall is counted so the page can say it.
  const census = layerCensus(FIXTURE, new Set<string>());
  assert.equal(census.anchored, 0);
  assert.equal(census.unresolvedEntries, 1);
});

test("validation rejects the edges that would make a reading dishonest", () => {
  const corpus = new Set(["real-slug"]);
  const bad = (nodes: LayerGraph["nodes"]) => validateLayerGraph({ nodes }, corpus);

  assert.ok(
    bad([capability("a"), method("m", "missing")]).some((e) => e.includes("realizes an unknown id")),
  );
  assert.ok(
    bad([capability("a"), method("m", "a", { steps: ["m"], atomic: undefined })]).some((e) =>
      e.includes("steps names m, which is a method"),
    ),
  );
  assert.ok(
    bad([
      capability("a"),
      capability("b"),
      method("m", "a", { steps: ["b"], atomic: undefined, bypasses: ["b"] }),
    ]).some((e) => e.includes("both needs and bypasses")),
  );
  assert.ok(
    bad([capability("a"), capability("b"), method("m", "a"), method("n", "b", { refines: "m" })]).some(
      (e) => e.includes("fills a different slot"),
    ),
  );
  assert.ok(
    bad([capability("a"), method("m", "a", { conditions: "x", conditionsJa: undefined })]).some((e) =>
      e.includes("present in one locale only"),
    ),
  );
  assert.ok(
    bad([capability("a"), method("m", "a", { conditions: "  ", conditionsJa: "  " })]).some((e) =>
      e.includes("present but empty"),
    ),
  );
  assert.ok(
    bad([capability("a"), method("m", "a", { entries: ["no-such-slug"] })]).some((e) =>
      e.includes("the corpus does not carry"),
    ),
  );
  assert.ok(
    bad([capability("a"), method("m", "a", { citations: [] })]).some((e) =>
      e.includes("at least one citation"),
    ),
  );
  // A cycle in containment: solving needs encoding, and encoding is solved by
  // something that needs solving.
  assert.ok(
    bad([
      capability("a"),
      capability("b"),
      method("m", "a", { steps: ["b"], atomic: undefined }),
      method("n", "b", { steps: ["a"], atomic: undefined }),
    ]).some((e) => e.includes("cycle")),
  );
  assert.deepEqual(bad(FIXTURE.nodes), []);
});

// --- the authored graph ----------------------------------------------------

/**
 * Every slug the graph itself names.
 *
 * Passing this as the corpus satisfies the one rule that needs the real 283 —
 * "`entries` names a slug the corpus carries" — trivially, so what the
 * assertion below actually pins is every *other* rule: ids, both locales,
 * citations, edge resolution, the refines contract, and the two acyclicity
 * checks. `scripts/check-layer-graph.mjs` runs the identical function against
 * the bundled corpus and is what catches a cross-link into a 404.
 */
const SELF_DECLARED_SLUGS = new Set(LAYER_GRAPH.nodes.flatMap((node) => node.entries ?? []));

test("the authored layer graph satisfies every rule that does not need the corpus", () => {
  assert.deepEqual(validateLayerGraph(LAYER_GRAPH, SELF_DECLARED_SLUGS), []);
});

test("every authored node is reachable from a root", () => {
  // An unreachable node renders on no page and is invisible to a reader: it is
  // authored content that ships and is never seen, which is the failure mode a
  // count of nodes hides.
  const depths = layerDepths(LAYER_GRAPH);
  const index = indexLayerGraph(LAYER_GRAPH);
  const unreachable: string[] = [];
  for (const node of LAYER_GRAPH.nodes) {
    if (node.kind === "capability" && !depths.has(node.id)) unreachable.push(node.id);
    if (node.kind === "method" && !index.has(node.realizes)) unreachable.push(node.id);
  }
  assert.deepEqual(unreachable, []);
});

test("the authored graph's own sibling sets partition, on every slot that has one", () => {
  // The fixture proves the function partitions. This proves the *content* does
  // not contain the one shape that would make a page sentence false: a slot
  // where the two lists overlap.
  for (const node of LAYER_GRAPH.nodes) {
    if (!isMethod(node)) continue;
    const alternatives = new Set(alternativesTo(LAYER_GRAPH, node).map((m) => m.id));
    const refinements = refinementsOf(LAYER_GRAPH, node).map((m) => m.id);
    const siblings = siblingsOf(LAYER_GRAPH, node).length;
    for (const id of refinements) {
      assert.ok(!alternatives.has(id), `${node.id}: ${id} is in both lists`);
    }
    assert.equal(alternatives.size + refinements.length, siblings, node.id);
  }
});
