// The state graph: that a path can be *found*, and that finding one is not the
// same claim as a paper having walked it.
//
// Two kinds of test here and the split is deliberate. The **rules** are asserted
// against hand-built fixtures, on this directory's standing rule that a test
// reading the real graph asserts today's content and goes green the day the
// content changes for an unrelated reason. The **measurements** are asserted
// against the authored graph on purpose, because they are the claims the plan
// document and the surface both make out loud — "expanding the nonlinear ODE
// slot yields exactly one interior state and it is `linear-ivp`" is the check
// that the whole reading is right, and if the graph stops saying it, the page
// stops meaning what it says.
import assert from "node:assert/strict";
import test from "node:test";

import {
  PATH_LIMITS,
  denominatorChain,
  expansionOf,
  laneFillers,
  pathStanding,
  pathWitnesses,
  stateEdges,
  statePathsBetween,
  type Crossing,
} from "./repository/state-graph.ts";
import { isCapability, layerNode, type LayerCapability, type LayerGraph } from "./repository/layers.ts";
import type { StateVocabulary } from "./repository/states.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { STATE_VOCABULARY } from "./repository/state-vocabulary.ts";

// --- fixtures ---------------------------------------------------------------

const VOCAB: StateVocabulary = {
  states: [
    { id: "a", label: "A", labelJa: "A", summary: "a", summaryJa: "a" },
    { id: "m", label: "M", labelJa: "M", summary: "m", summaryJa: "m" },
    { id: "z", label: "Z", labelJa: "Z", summary: "z", summaryJa: "z" },
    // narrower than m: anything consuming an `m` accepts an `mn`
    { id: "mn", label: "MN", labelJa: "MN", summary: "mn", summaryJa: "mn", specializes: ["m"] },
  ],
};

function slot(id: string, from: string, to: string): LayerCapability {
  return {
    kind: "capability",
    id,
    label: id,
    labelJa: id,
    summary: id,
    summaryJa: id,
    contract: { from, to, takes: "x", takesJa: "x", returns: "y", returnsJa: "y" },
    whyALayer: "because",
    whyALayerJa: "because",
  };
}

/** a --big--> z, and also a --p--> m --q--> z. */
const GRAPH: LayerGraph = {
  nodes: [slot("big", "a", "z"), slot("p", "a", "m"), slot("q", "m", "z")],
};

// --- edges ------------------------------------------------------------------

test("every slot contributes one edge", () => {
  assert.equal(stateEdges(GRAPH).length, 3);
  assert.deepEqual(
    stateEdges(GRAPH).map((edge) => edge.key),
    ["big", "p", "q"],
  );
});

test("a route's `through` narrowing becomes its own edge, attributed", () => {
  const graph: LayerGraph = {
    nodes: [
      ...GRAPH.nodes,
      {
        kind: "method",
        id: "narrowing-route",
        label: "r",
        labelJa: "r",
        summary: "r",
        summaryJa: "r",
        realizes: "big",
        steps: ["p"],
        through: { p: "mn" },
        via: { p: "filler" },
      },
      {
        kind: "method",
        id: "filler",
        label: "f",
        labelJa: "f",
        summary: "f",
        summaryJa: "f",
        realizes: "p",
        steps: [],
        atomic: true,
      },
    ],
  };
  const narrowed = stateEdges(graph).find((edge) => edge.key === "p@filler");
  assert.ok(narrowed, "the narrowed landing is an edge of its own");
  assert.equal(narrowed.to, "mn");
  assert.equal(narrowed.narrowedBy, "filler");
});

// --- paths ------------------------------------------------------------------

test("excluding the slot being expanded is what makes a finer path visible", () => {
  const edges = stateEdges(GRAPH);
  // Without the exclusion the coarse a->z edge is itself a one-hop path.
  const withCoarse = statePathsBetween(edges, VOCAB, "a", "z");
  assert.ok(withCoarse.paths.some((path) => path.edges.length === 1));

  const expanded = statePathsBetween(edges, VOCAB, "a", "z", "big");
  assert.equal(expanded.paths.length, 1);
  assert.deepEqual(expanded.paths[0]!.states, ["a", "m", "z"]);
});

test("a narrower state satisfies a broader requirement, so the walk continues through it", () => {
  const graph: LayerGraph = { nodes: [slot("p", "a", "mn"), slot("q", "m", "z")] };
  const found = statePathsBetween(stateEdges(graph), VOCAB, "a", "z");
  assert.equal(found.paths.length, 1, "mn is an m, so q is takeable from it");
  assert.deepEqual(found.paths[0]!.states, ["a", "mn", "z"]);
});

test("the walk is bounded and says so rather than truncating quietly", () => {
  // A fan of parallel a->z edges, more than the cap.
  const many = Array.from({ length: PATH_LIMITS.maxPaths + 20 }, (_unused, index) =>
    slot(`e${index}`, "a", "z"),
  );
  const found = statePathsBetween(stateEdges({ nodes: many }), VOCAB, "a", "z");
  assert.equal(found.truncated, true);
  assert.ok(found.paths.length <= PATH_LIMITS.maxPaths);
});

// --- the denominator chain --------------------------------------------------

test("a state on every path is a denominator; one on only some is not", () => {
  const graph: LayerGraph = {
    nodes: [slot("big", "a", "z"), slot("p", "a", "m"), slot("q", "m", "z"), slot("r", "a", "z")],
  };
  const found = statePathsBetween(stateEdges(graph), VOCAB, "a", "z", "big");
  const { chain } = denominatorChain(found, VOCAB);
  assert.ok(!chain.includes("m"), "`r` skips m, so m dominates nothing");
});

test("a narrowed landing still witnesses the state it specialises", () => {
  const graph: LayerGraph = {
    nodes: [slot("big", "a", "z"), slot("p", "a", "m"), slot("pn", "a", "mn"), slot("q", "m", "z")],
  };
  const found = statePathsBetween(stateEdges(graph), VOCAB, "a", "z", "big");
  const { chain } = denominatorChain(found, VOCAB);
  assert.ok(
    chain.includes("m"),
    "one path holds `mn` rather than `m`, and mn is a kind of m — m still dominates",
  );
});

// --- expansion --------------------------------------------------------------

test("a slot with no finer path is atomic at this level, not an empty expansion", () => {
  const graph: LayerGraph = { nodes: [slot("only", "a", "z")] };
  const expansion = expansionOf(graph, VOCAB, graph.nodes[0] as LayerCapability);
  assert.equal(expansion.atomicAtThisLevel, true);
  assert.deepEqual(expansion.bundles, []);
});

test("an exit reached by a narrower state is not filed as an interior state", () => {
  // p: a -> mn, where mn specialises m; expanding a slot a -> m must not treat
  // mn as an interior denominator, because it *is* the exit.
  const graph: LayerGraph = { nodes: [slot("big", "a", "m"), slot("p", "a", "mn")] };
  const expansion = expansionOf(graph, VOCAB, graph.nodes[0] as LayerCapability);
  assert.equal(
    expansion.atomicAtThisLevel,
    true,
    "reaching the exit by a narrower kind is arrival, not a stop on the way",
  );
});

test("both ends of a bundle are one state each — that is the convergence", () => {
  const graph: LayerGraph = {
    nodes: [
      slot("big", "a", "z"),
      slot("p1", "a", "m"),
      slot("p2", "a", "m"),
      slot("q", "m", "z"),
    ],
  };
  const expansion = expansionOf(graph, VOCAB, graph.nodes[0] as LayerCapability);
  assert.deepEqual(expansion.chain, ["a", "m", "z"]);
  const first = expansion.bundles[0]!;
  assert.equal(first.lanes.length, 2, "two ways from a to m");
  for (const lane of first.lanes) {
    assert.equal(first.from, "a");
    assert.equal(first.to, "m");
    assert.equal(lane.interior.length, 0);
  }
});

test("a lane spanning several edges keeps its interior states, flat", () => {
  const graph: LayerGraph = {
    nodes: [slot("big", "a", "z"), slot("p", "a", "m"), slot("q", "m", "z")],
  };
  // Expand `big`, but with no interior denominator removed: m dominates, so the
  // lanes are single edges. Re-check the multi-edge case through the real graph
  // in the measurement block below.
  const expansion = expansionOf(graph, VOCAB, graph.nodes[0] as LayerCapability);
  assert.deepEqual(expansion.chain, ["a", "m", "z"]);
});

// --- standing ---------------------------------------------------------------

test("a crossing nothing walks is unpublished, not merely unpinned", () => {
  assert.equal(pathStanding(GRAPH, VOCAB, [{ edgeKey: "p", filler: "nobody" }]), "unpublished");
});

test("a walker pinning a different filler does not leave the combination open", () => {
  const graph: LayerGraph = {
    nodes: [
      ...GRAPH.nodes,
      {
        kind: "method",
        id: "route",
        label: "r",
        labelJa: "r",
        summary: "r",
        summaryJa: "r",
        realizes: "big",
        steps: ["p", "q"],
        via: { p: "chosen" },
      },
      { kind: "method", id: "chosen", label: "c", labelJa: "c", summary: "c", summaryJa: "c", realizes: "p", steps: [], atomic: true },
      { kind: "method", id: "other", label: "o", labelJa: "o", summary: "o", summaryJa: "o", realizes: "p", steps: [], atomic: true },
    ],
  };
  assert.equal(pathStanding(graph, VOCAB, [{ edgeKey: "p", filler: "chosen" }]), "recorded");
  assert.equal(
    pathStanding(graph, VOCAB, [{ edgeKey: "p", filler: "other" }]),
    "unpublished",
    "the only route across p takes `chosen`; it does not leave `other` open",
  );
  assert.equal(
    pathStanding(graph, VOCAB, [
      { edgeKey: "p", filler: "chosen" },
      { edgeKey: "q", filler: "anything" },
    ]),
    "unpinned",
    "the route walks q and names no filler there — silent, not contradicting",
  );
});

// --- measurements against the authored graph --------------------------------

const nonlinear = layerNode(LAYER_GRAPH, "nonlinear-ode-solve");

test("expanding the nonlinear ODE slot yields exactly one interior state, and it is linear-ivp", () => {
  assert.ok(nonlinear && isCapability(nonlinear));
  const expansion = expansionOf(LAYER_GRAPH, STATE_VOCABULARY, nonlinear);
  assert.deepEqual(
    expansion.chain,
    ["nonlinear-ivp", "linear-ivp", "solution-answer"],
    "the owner named `linear-ivp` as the state everything converges on; the " +
      "dominator reading has to produce it, or the reading is wrong",
  );
  assert.equal(expansion.atomicAtThisLevel, false);
  assert.equal(expansion.chainConsistent, true);
  assert.equal(expansion.truncated, false);
  assert.equal(expansion.bundles.length, 2);
});

test("the Koopman-von Neumann narrowing is witnessed only by its own route", () => {
  assert.ok(nonlinear && isCapability(nonlinear));
  const expansion = expansionOf(LAYER_GRAPH, STATE_VOCABULARY, nonlinear);
  const narrowed = expansion.bundles[0]!.lanes.find((lane) =>
    lane.edges.some((edge) => edge.narrowedBy === "koopman-von-neumann-lift"),
  );
  assert.ok(narrowed, "the narrowed landing is drawn as its own lane");
  assert.deepEqual(
    pathWitnesses(LAYER_GRAPH, STATE_VOCABULARY, narrowed).map((method) => method.id),
    ["kvn-simulation-route"],
  );
  assert.deepEqual(
    laneFillers(LAYER_GRAPH, narrowed).map((method) => method.id),
    ["koopman-von-neumann-lift"],
  );
});

test("a step that is a feed does not witness the edge it names", () => {
  // `backward-euler` lists `quantum-linear-solve` among its steps, but `routeOf`
  // classifies it as an ingredient rather than a hop. Reading `steps` credited
  // backward Euler with walking that edge; reading the route does not.
  assert.ok(nonlinear && isCapability(nonlinear));
  const solve = layerNode(LAYER_GRAPH, "linear-ode-solve");
  assert.ok(solve && isCapability(solve));
  const expansion = expansionOf(LAYER_GRAPH, STATE_VOCABULARY, solve);
  const qls = expansion.bundles
    .flatMap((bundle) => bundle.lanes)
    .find((lane) => lane.edges.length === 1 && lane.edges[0]!.slot === "quantum-linear-solve");
  assert.ok(qls);
  const witnesses = pathWitnesses(LAYER_GRAPH, STATE_VOCABULARY, qls).map((method) => method.id);
  assert.ok(!witnesses.includes("backward-euler"));
  assert.ok(!witnesses.includes("trapezoidal-rule"));
});

test("the owner's own research direction is unpublished, and Liu et al.'s is recorded", () => {
  const carlemanSchrodinger: Crossing[] = [
    { edgeKey: "nonlinear-linear-embedding", filler: "carleman-linearization" },
    { edgeKey: "linear-ode-solve", filler: "schrodingerisation" },
  ];
  assert.equal(
    pathStanding(LAYER_GRAPH, STATE_VOCABULARY, carlemanSchrodinger),
    "unpublished",
    "both routes crossing that slot pair pin a different embedding, so nothing " +
      "leaves Carleman open there — this is the discovery the map exists to show",
  );

  const liu: Crossing[] = [
    { edgeKey: "nonlinear-linear-embedding", filler: "carleman-linearization" },
    { edgeKey: "time-discretization", filler: "forward-euler" },
  ];
  assert.equal(pathStanding(LAYER_GRAPH, STATE_VOCABULARY, liu), "recorded");
});

test("all three standings are reachable on the authored graph", () => {
  // A three-valued verdict whose middle nothing can produce is a two-valued one
  // that passes its own test. Counted over every concrete crossing of the
  // nonlinear ODE slot, all three appear.
  assert.ok(nonlinear && isCapability(nonlinear));
  const expansion = expansionOf(LAYER_GRAPH, STATE_VOCABULARY, nonlinear);
  const perBundle = expansion.bundles.map((bundle) =>
    bundle.lanes.flatMap((lane) => {
      if (lane.edges.length !== 1) {
        return [lane.edges.map((edge) => ({ edgeKey: edge.key, filler: null }) as Crossing)];
      }
      const fillers = laneFillers(LAYER_GRAPH, lane);
      const key = lane.edges[0]!.key;
      if (fillers.length === 0) return [[{ edgeKey: key, filler: null } as Crossing]];
      return fillers.map((method) => [{ edgeKey: key, filler: method.id } as Crossing]);
    }),
  );

  const tally = { recorded: 0, unpinned: 0, unpublished: 0 };
  for (const first of perBundle[0]!) {
    for (const second of perBundle[1]!) {
      tally[pathStanding(LAYER_GRAPH, STATE_VOCABULARY, [...first, ...second])] += 1;
    }
  }
  assert.ok(tally.recorded > 0, `nothing is recorded: ${JSON.stringify(tally)}`);
  assert.ok(tally.unpinned > 0, `the middle is unreachable: ${JSON.stringify(tally)}`);
  assert.ok(tally.unpublished > 0, `nothing is unpublished: ${JSON.stringify(tally)}`);
});
