// What is left of the process map's own test file, now that the map is gone.
//
// This file used to pin the crossing-free process-map engine — "there must be
// no overlapping lines or states anywhere" (owner, session-91 inbox) — against
// fixtures and against the real `LAYER_GRAPH`, in both locales, opened and
// shut. That map was `?view=map` on `/repository/layers`, retired this session
// with the other two non-converge views in favour of `ConvergeCanvas`
// everywhere, and `layoutProcessMap`, `layoutProcessZoom`, `columnRanks`,
// `mapHref`, `slotHref`, `zoomHref`, `resolveZoom`, `MAP_ZOOMS` and
// `PROCESS_METRICS` were deleted from `process-layout.ts` with it — checked by
// grep against every symbol the module exported, not assumed from what the map
// used to need.
//
// Two things in `process-layout.ts` outlived the engine, because
// `converge-layout.ts` still imports them: `estimateTextWidth` and `fitLabel`
// (text measurement without a DOM — the map's problem, but not specific to it)
// and `stateHref` (a state's address, unrelated to which canvas draws it). Their
// coverage is below, trimmed to just them.
//
// `routeOf` is not one of this module's exports — it lives in `layers.ts` and
// is exercised elsewhere too (`repository-converge-layout.test.ts`,
// `repository-state-graph.test.ts`) — but its coverage here predates both of
// those and asserts a case neither repeats: the feed/spine split a route reads
// off `steps`, which is what the process map's lanes were built from. It stays,
// per the standing rule that a test's subject surviving is what decides whether
// the test does, not which file it happens to live in.
import assert from "node:assert/strict";
import test from "node:test";
import { estimateTextWidth, fitLabel, stateHref } from "./repository/process-layout.ts";
import { routeOf, type LayerCapability, type LayerGraph, type LayerMethod } from "./repository/layers.ts";
import type { LayerState, StateVocabulary } from "./repository/states.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function state(id: string, extra: Partial<LayerState> = {}): LayerState {
  return { id, label: id, labelJa: id, summary: "", summaryJa: "", ...extra };
}

function vocabulary(...states: LayerState[]): StateVocabulary {
  return { states };
}

function capability(
  id: string,
  from: string,
  to: string,
  extra: Partial<LayerCapability> = {},
): LayerCapability {
  return {
    kind: "capability",
    id,
    label: id,
    labelJa: id,
    summary: "",
    summaryJa: "",
    contract: { from, to, takes: "x", takesJa: "x", returns: "y", returnsJa: "y" },
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

// ---------------------------------------------------------------------------
// Text measurement — the one part that cannot use a DOM
// ---------------------------------------------------------------------------

test("a CJK string is measured wider than the same number of Latin characters", () => {
  // The Japanese surface is the one a low estimate breaks.
  assert.ok(estimateTextWidth("量子線形方程式", 12) > estimateTextWidth("abcdefg", 12));
});

test("fitLabel never exceeds its budget, and the full text always survives the cut", () => {
  const long = "Solve a linear system of ordinary differential equations to a stated error";
  const fitted = fitLabel(long, 12, 120);
  assert.equal(fitted.truncated, true);
  assert.ok(estimateTextWidth(fitted.text, 12) <= 120);
  assert.ok(fitted.text.endsWith("…"));

  const short = fitLabel("Short", 12, 400);
  assert.deepEqual(short, { text: "Short", truncated: false });
});

// ---------------------------------------------------------------------------
// Where a state links to
// ---------------------------------------------------------------------------

test("a state links to its own page under /repository/layers/", () => {
  assert.equal(stateHref("linear-generator"), "/repository/layers/linear-generator");
});

// ---------------------------------------------------------------------------
// routeOf — a method read as a path
// ---------------------------------------------------------------------------

const ROUTE_STATES = vocabulary(
  state("alpha"),
  state("beta"),
  state("gamma"),
  state("delta"),
  state("epsilon"),
  state("beta-hermitian", { specializes: ["beta"] }),
);

test("a method with no steps is one segment, and that segment is the method itself", () => {
  // Not a gap. `direct-sampling-readout` delegates nothing and then samples, and
  // the sampling is the whole method — a real process with a page. The first
  // draft of `routeOf` reported this shape as twenty-three missing conversions.
  const graph: LayerGraph = {
    nodes: [capability("top", "alpha", "gamma"), method("only-way", "top", { atomic: true })],
  };
  const route = routeOf(graph, ROUTE_STATES, graph.nodes[1] as LayerMethod);
  assert.deepEqual(route.states, ["alpha", "gamma"]);
  assert.deepEqual(route.segments, [{ capabilityId: null, methodId: "only-way", narrowed: false }]);
  assert.deepEqual(route.feeds, []);
  assert.equal(route.coverage, "all-own");
  // The shape the diagram depends on everywhere: one more state than segments.
  assert.equal(route.states.length, route.segments.length + 1);
});

test("a step whose input the route is not holding is an ingredient, not a stage", () => {
  // Authored order is deliberately wrong here — the ingredient is listed first —
  // because `steps` was authored as "what this route needs" and reading it as a
  // path is what produced the feed/spine split. A route that took the list in
  // order would open at `delta`, which it has never held.
  const graph: LayerGraph = {
    nodes: [
      capability("top", "alpha", "gamma"),
      method("way", "top", { steps: ["ingredient", "hop"] }),
      capability("ingredient", "delta", "epsilon"),
      capability("hop", "alpha", "beta"),
    ],
  };
  const route = routeOf(graph, ROUTE_STATES, graph.nodes[1] as LayerMethod);
  assert.deepEqual(route.feeds, ["ingredient"]);
  assert.deepEqual(route.states, ["alpha", "beta", "gamma"]);
  assert.deepEqual(
    route.segments.map((segment) => segment.capabilityId ?? `own:${segment.methodId}`),
    ["hop", "own:way"],
  );
  // One delegated hop and one the method closes itself: neither "delegated" nor
  // "all-own", and a reader deciding what to reuse needs to see which it is.
  assert.equal(route.coverage, "partly-own");
});

test("a route whose steps span the whole slot delegates all of it", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("top", "alpha", "gamma"),
      method("way", "top", { steps: ["first", "second"] }),
      capability("first", "alpha", "beta"),
      capability("second", "beta", "gamma"),
    ],
  };
  const route = routeOf(graph, ROUTE_STATES, graph.nodes[1] as LayerMethod);
  assert.deepEqual(route.states, ["alpha", "beta", "gamma"]);
  assert.equal(route.segments.length, 2);
  assert.equal(route.coverage, "delegated");
});

test("`through` narrows a junction, and a `through` that would broaden it is ignored", () => {
  // The asymmetry is the whole value of the composition check. A route may hand
  // on something narrower than the next process requires; handing on something
  // broader is a conversion nobody wrote down, and `through` must not be usable
  // to wish one away.
  const base: LayerGraph = {
    nodes: [
      capability("top", "alpha", "gamma"),
      method("way", "top", { steps: ["hop"] }),
      capability("hop", "alpha", "beta"),
    ],
  };
  const plain = routeOf(base, ROUTE_STATES, base.nodes[1] as LayerMethod);
  assert.deepEqual(plain.states, ["alpha", "beta", "gamma"]);
  assert.equal(plain.segments[0]!.narrowed, false);

  const narrowed: LayerGraph = {
    nodes: [
      base.nodes[0]!,
      method("way", "top", { steps: ["hop"], through: { hop: "beta-hermitian" } }),
      base.nodes[2]!,
    ],
  };
  const narrowRoute = routeOf(narrowed, ROUTE_STATES, narrowed.nodes[1] as LayerMethod);
  assert.deepEqual(narrowRoute.states, ["alpha", "beta-hermitian", "gamma"]);
  assert.equal(narrowRoute.segments[0]!.narrowed, true);

  // `epsilon` is not a kind of `beta`, so this is a replacement wearing the word
  // "narrower". It is dropped and the route is exactly the un-narrowed one.
  const bogus: LayerGraph = {
    nodes: [
      base.nodes[0]!,
      method("way", "top", { steps: ["hop"], through: { hop: "epsilon" } }),
      base.nodes[2]!,
    ],
  };
  assert.deepEqual(routeOf(bogus, ROUTE_STATES, bogus.nodes[1] as LayerMethod), plain);
});
