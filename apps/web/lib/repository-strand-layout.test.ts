// `ancestorPath` — the one piece of `strand-layout.ts` still drawn on a page.
//
// The rest of this file used to pin the strand canvas's geometry: fascicles as
// pinched ovals, fibers branching off and converging back, every invariant
// asserted on in-file fixtures and then again on the real `LAYER_GRAPH`. That
// canvas was `?view=strands` on `/repository/layers`, retired this session with
// the other two non-converge views, and `layoutFocus`, `layoutOverview`,
// `siblingCapabilities`, `estimateTextWidth`, `fitLabel`, `pinchRunFor` and
// `STRAND_METRICS` went with it — deleted from `strand-layout.ts` because
// nothing draws them any more.
//
// `ancestorPath` outlived the canvas: `repository-converge-view.tsx`'s rail
// climbs the same shortest-path-to-a-root chain the strand rail did, and that
// climb is graph structure rather than strand geometry. What is left below is
// its coverage, on a fixture and on the real graph — trimmed to that one
// function rather than deleted with the file, per the standing rule that a
// test's subject surviving is what decides whether the test does.
import assert from "node:assert/strict";
import test from "node:test";
import { ancestorPath } from "./repository/strand-layout.ts";
import type { LayerCapability, LayerGraph, LayerMethod } from "./repository/layers.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";

function capability(id: string, extra: Partial<LayerCapability> = {}): LayerCapability {
  return {
    kind: "capability",
    id,
    label: id,
    labelJa: id,
    summary: "",
    summaryJa: "",
    contract: { from: "alpha", to: "beta", takes: "a", takesJa: "a", returns: "b", returnsJa: "b" },
    whyALayer: "",
    whyALayerJa: "",
    ...extra,
  };
}

function method(id: string, realizes: string, extra: Partial<LayerMethod> = {}): LayerMethod {
  return {
    kind: "method",
    id,
    label: id,
    labelJa: id,
    summary: "",
    summaryJa: "",
    realizes,
    steps: [],
    ...extra,
  };
}

test("ancestorPath takes the shortest way up and always starts at a root", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("top"),
      method("long-way", "top", { steps: ["middle"] }),
      method("short-way", "top", { steps: ["target"] }),
      capability("middle"),
      method("middle-way", "middle", { steps: ["target"] }),
      capability("target"),
      method("leaf", "target", { atomic: true }),
    ],
  };
  assert.deepEqual(
    ancestorPath(graph, "target").map((node) => node.id),
    ["top", "target"],
  );
  // A root is its own path, not an empty one.
  assert.deepEqual(
    ancestorPath(graph, "top").map((node) => node.id),
    ["top"],
  );
  // An id that resolves to nothing gets nothing, never a partial path.
  assert.deepEqual(ancestorPath(graph, "no-such-node"), []);
});

test("ancestorPath resolves for every capability in the authored graph and ends at it", () => {
  for (const node of LAYER_GRAPH.nodes) {
    if (node.kind !== "capability") continue;
    const path = ancestorPath(LAYER_GRAPH, node.id);
    assert.equal(path.at(-1)?.id, node.id, `path for ${node.id} does not end at it`);
    assert.ok(path.length > 0, `${node.id}: empty path for a node that resolved`);
  }
});
