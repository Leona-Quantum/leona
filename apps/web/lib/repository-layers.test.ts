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
  advancingStepCount,
  alternativesTo,
  bypassersOf,
  capabilityOutlook,
  conjoinedCompositeNames,
  containersOf,
  entriesFor,
  foldedAgainst,
  indexLayerGraph,
  isCapability,
  isMethod,
  routeOf,
  methodsRealizing,
  layerCensus,
  layerDepths,
  layerNode,
  nodesForEntry,
  refinementsOf,
  repeatedSteps,
  repetitionOf,
  rootCapabilities,
  siblingsOf,
  stateCompositionCensus,
  stateTraffic,
  stepsOutlook,
  validateLayerGraph,
  COMPOSITE_NAME_DISPOSITIONS,
  type CompositeNameDisposition,
  type CompositionStanding,
  type LayerCapability,
  type LayerContract,
  type LayerGraph,
  type LayerMethod,
  type StepRepetition,
} from "./repository/layers.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import type { StateVocabulary } from "./repository/states.ts";
import { STATE_VOCABULARY } from "./repository/state-vocabulary.ts";
// Read-only, and from the module that imports *this* one: `state-graph.ts` is
// where `pathStanding` lives, and the census below cannot import it (that would
// be a cycle), so the judge is injected here exactly as the lint script injects
// it. Both callers therefore exercise the same join.
import { pathStanding } from "./repository/state-graph.ts";

const CITE = [{ title: "A paper", authors: "Someone", year: "2020", url: "https://example.org/a" }];

/**
 * A fixture carries no name dispositions, and says so rather than inheriting the
 * authored register — whose two rows name nodes no fixture has, and would be
 * reported as unknown ids on every call.
 */
const NO_DISPOSITIONS: readonly CompositeNameDisposition[] = [];

/**
 * The fixture's own state vocabulary, on the same rule as the graph above it:
 * a test that names the authored states asserts today's content.
 *
 * Three states in a chain is the smallest thing that makes `encode` a real step
 * of `direct` — a process that carries the route part of the way and leaves the
 * rest to the method itself. The ids are deliberately unlike any node id in this
 * file, because `validateLayerGraph` rejects a state and a node answering to one
 * name and that rule has to stay assertable rather than tripped by the fixture.
 */
const FIXTURE_STATES: StateVocabulary = {
  states: [
    { id: "alpha", label: "alpha", labelJa: "alpha", summary: "s", summaryJa: "s" },
    { id: "beta", label: "beta", labelJa: "beta", summary: "s", summaryJa: "s" },
    { id: "gamma", label: "gamma", labelJa: "gamma", summary: "s", summaryJa: "s" },
  ],
};

/** A contract between two of the fixture states; the prose is never read. */
function contract(from: string, to: string): LayerContract {
  return { from, to, takes: "t", takesJa: "t", returns: "r", returnsJa: "r" };
}

function capability(id: string, extra: Partial<LayerCapability> = {}): LayerCapability {
  return {
    kind: "capability",
    id,
    label: id,
    labelJa: id,
    summary: "s",
    summaryJa: "s",
    contract: contract("alpha", "beta"),
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
    contract: contract("alpha", "beta"),
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
 *
 * As a path: `solve` runs `alpha → gamma` and `encode` runs `alpha → beta`, so
 * `direct` delegates the first hop and closes the rest itself — the shape most
 * authored routes are in.
 */
const FIXTURE: LayerGraph = {
  nodes: [
    capability("solve", { contract: contract("alpha", "gamma") }),
    capability("encode"),
    method("direct", "solve", {
      contract: contract("alpha", "gamma"),
      steps: ["encode"],
      atomic: undefined,
    }),
    method("fast", "solve", {
      contract: contract("alpha", "gamma"),
      refines: "direct",
      refinesMark: "direct",
      refinesMarkJa: "direct",
    }),
    method("other", "solve", { contract: contract("alpha", "gamma"), bypasses: ["encode"] }),
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
  const census = layerCensus(FIXTURE, new Set(["real-slug"]), FIXTURE_STATES);
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
  const census = layerCensus(FIXTURE, new Set<string>(), FIXTURE_STATES);
  assert.equal(census.anchored, 0);
  assert.equal(census.unresolvedEntries, 1);
});

/**
 * A fixture in the shape the owner described: one route that runs `encode` once
 * per turn, one that declares nothing about it.
 *
 * `direct` is the backward-Euler shape — it needs `encode` and pays for it every
 * step. `folder` is the all-at-once shape and records **no** multiplicity, which
 * is a different statement from "records one". Nothing below asserts that it
 * meets the slot once, because the graph does not say so.
 */
const LOOP_FIXTURE: LayerGraph = {
  nodes: [
    capability("solve", { contract: contract("alpha", "gamma") }),
    capability("encode"),
    method("direct", "solve", {
      contract: contract("alpha", "gamma"),
      steps: ["encode"],
      atomic: undefined,
      repeats: {
        encode: {
          count: "once per time step",
          countJa: "各ステップにつき 1 回",
          closure: "coherent",
          note: "n",
          noteJa: "n",
          mark: "×steps",
          markJa: "×steps",
        },
      },
    }),
    method("folder", "solve", {
      contract: contract("alpha", "gamma"),
      steps: ["encode", "plain"],
      atomic: undefined,
    }),
    method("encode-a", "encode"),
    // A slot two routes step into and **neither** repeats. Without it, the
    // "nothing to compare" case could only be asked of a slot nothing steps into
    // at all, where the answer is empty for the wrong reason — which is exactly
    // what happened: removing the guard in `foldedAgainst` left every test green.
    capability("plain"),
    method("plain-a", "plain"),
  ],
};

test("a repeated hop is counted as a hop, and the denominator is carried with it", () => {
  const census = layerCensus(LOOP_FIXTURE, new Set<string>(), FIXTURE_STATES);
  // Three hops across two methods, one of which declares a multiplicity. The
  // denominator is the point: without it, "1 loop" reads as "1 of 1".
  assert.equal(census.stepInstances, 3);
  assert.equal(census.iteratedSteps, 1);
  assert.equal(census.coherentLoops, 1);
  assert.equal(census.measuredLoops, 0);
  assert.equal(census.contrastedSlots, 1);
});

test("a slot nothing repeats draws no contrast at all", () => {
  // `plain` is a real hop — `folder` steps into it — and no route repeats it. The
  // empty pair is what stops the capability page printing "no multiplicity
  // recorded" as a list of shortcomings on a slot nobody is competing over.
  // Asking this of a slot nothing steps into would answer empty for the wrong
  // reason and let the guard be deleted with every test still green.
  assert.ok(containersOf(LOOP_FIXTURE, "plain").length > 0);
  const { unpinned, repeated } = foldedAgainst(LOOP_FIXTURE, "plain");
  assert.deepEqual(unpinned, []);
  assert.deepEqual(repeated, []);
});

test("the routes that declare no multiplicity are never called folded", () => {
  const { unpinned, repeated } = foldedAgainst(LOOP_FIXTURE, "encode");
  assert.deepEqual(
    repeated.map((r) => r.method.id),
    ["direct"],
  );
  // `folder` appears here because it takes the hop and records nothing about how
  // often — not because the graph says it takes it once. The name of the field is
  // the assertion; if it is ever renamed to `folded`, this test is the reason not
  // to.
  assert.deepEqual(
    unpinned.map((m) => m.id),
    ["folder"],
  );
  assert.equal(repetitionOf(unpinned[0]!, "encode"), null);
});

test("repeatedSteps follows the order a reader meets the steps in, not object order", () => {
  const two = method("two", "solve", {
    contract: contract("alpha", "gamma"),
    steps: ["encode", "second"],
    atomic: undefined,
    // Written second-then-first on purpose: `Object.entries` would hand these
    // back in insertion order and the page numbers its steps from `steps`.
    repeats: {
      second: { count: "n", countJa: "n", closure: "measured", note: "n", noteJa: "n", mark: "×n", markJa: "×n" },
      encode: { count: "m", countJa: "m", closure: "coherent", note: "n", noteJa: "n", mark: "×m", markJa: "×m" },
    },
  });
  assert.deepEqual(
    repeatedSteps(two).map((r) => r.stepId),
    ["encode", "second"],
  );
});

test("validation rejects a repetition the route cannot honestly be making", () => {
  const corpus = new Set<string>();
  const bad = (extra: Partial<LayerMethod>) =>
    validateLayerGraph(
      {
        nodes: [
          capability("solve", { contract: contract("alpha", "gamma") }),
          capability("encode"),
          method("m", "solve", {
            contract: contract("alpha", "gamma"),
            steps: ["encode"],
            atomic: undefined,
            ...extra,
          }),
          method("encode-a", "encode"),
        ],
      },
      corpus,
      FIXTURE_STATES,
      NO_DISPOSITIONS,
    );
  const rep = (over: Partial<StepRepetition> = {}): StepRepetition => ({
    count: "once per step",
    countJa: "各ステップにつき 1 回",
    closure: "coherent",
    mark: "×steps",
    markJa: "×steps",
    note: "n",
    noteJa: "n",
    ...over,
  });

  assert.equal(bad({ repeats: { encode: rep() } }).length, 0);

  // A hop this route does not take. The whole value of the annotation is that it
  // is attached to a hop, so one attached to nothing is worse than absent.
  assert.match(bad({ repeats: { solve: rep() } }).join("\n"), /not one of its steps/);

  assert.match(bad({ repeats: {} }).join("\n"), /repeats records nothing/);

  // The rule that is not a typo-catcher: skipping a layer and running it once per
  // turn are the two opposite answers to one question. LCHS removes the
  // linear-solve span; backward Euler pays it every step. A node asserting both
  // renders as a route that avoids the cost it is charged for.
  assert.match(
    bad({ steps: ["encode"], bypasses: ["encode"], repeats: { encode: rep() } }).join("\n"),
    /cannot skip a layer it runs once per turn/,
  );

  // A loop that turns once is not a loop — and recording it as one would put the
  // badge on exactly the folded encodings that exist to avoid looping.
  assert.match(bad({ repeats: { encode: rep({ count: "1" }) } }).join("\n"), /is "1"/);
  assert.match(bad({ repeats: { encode: rep({ countJa: " 1 " }) } }).join("\n"), /is "1"/);

  assert.match(bad({ repeats: { encode: rep({ count: "  " }) } }).join("\n"), /count is empty/);
  assert.match(bad({ repeats: { encode: rep({ noteJa: "" }) } }).join("\n"), /noteJa is empty/);
  assert.match(
    bad({ repeats: { encode: rep({ closure: "sometimes" as never }) } }).join("\n"),
    /closure is "sometimes"/,
  );
});

test("every authored repetition names a step its own method takes, in both locales", () => {
  // The authored graph, not the fixture. This is the rule most likely to rot as
  // steps are re-cut underneath an annotation nobody re-reads.
  for (const node of LAYER_GRAPH.nodes) {
    if (!isMethod(node) || node.repeats === undefined) continue;
    for (const [stepId, repetition] of Object.entries(node.repeats)) {
      assert.ok(node.steps.includes(stepId), `${node.id}: repeats ${stepId}, which is not a step`);
      assert.ok(repetition.count.trim().length > 0);
      assert.ok(repetition.countJa.trim().length > 0);
      assert.ok(repetition.note.trim().length > 0);
      assert.ok(repetition.noteJa.trim().length > 0);
      // Every note is a paragraph of Japanese, not an English string copied
      // across — the failure `:lang(ja)` cannot show and a screenshot cannot
      // catch, because the page renders whatever is in the field.
      assert.notEqual(repetition.note, repetition.noteJa, `${node.id}.${stepId}: Ja note is the En one`);
      assert.match(repetition.noteJa, /[぀-ヿ一-龯]/, `${node.id}.${stepId}: noteJa has no Japanese`);
      assert.match(repetition.countJa, /[぀-ヿ一-龯]/, `${node.id}.${stepId}: countJa has no Japanese`);
    }
  }
});

test("validation rejects the edges that would make a reading dishonest", () => {
  const corpus = new Set(["real-slug"]);
  const bad = (nodes: LayerGraph["nodes"]) =>
    validateLayerGraph({ nodes }, corpus, FIXTURE_STATES, NO_DISPOSITIONS);

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
  // **The refinement mark is a hand-copied name, so it is gated against the
  // name it copies.** The canvas draws `LightSABRE ⊂ SABRE`; the corpus holds
  // only `SABRE`, and the one way that string goes wrong is the parent being
  // renamed underneath it — which is silent, on the drawing, and looks perfectly
  // deliberate. Requiring it to occur inside the parent's own name means it can
  // be shorter than that name and can never be a different one.
  assert.ok(
    bad([
      capability("a"),
      method("m", "a"),
      method("n", "a", { refines: "m", refinesMark: "m", refinesMarkJa: "m" }),
    ]).length === 0,
    "a mark that is the parent's own name was rejected",
  );
  assert.ok(
    bad([capability("a"), method("m", "a"), method("n", "a", { refines: "m" })]).some((e) =>
      e.includes("refinesMark is empty"),
    ),
  );
  assert.ok(
    bad([
      capability("a"),
      method("m", "a"),
      method("n", "a", { refines: "m", refinesMark: "elsewhere", refinesMarkJa: "m" }),
    ]).some((e) => e.includes("does not occur in m's own name")),
  );
  assert.ok(
    bad([
      capability("a"),
      method("m", "a"),
      method("n", "a", {
        refines: "m",
        refinesMark: "mmmmmmmmmmmm",
        refinesMarkJa: "m",
      }),
    ]).some((e) => e.includes("a refinement mark may be at most")),
  );
  assert.ok(
    bad([capability("a"), method("m", "a", { refinesMark: "x", refinesMarkJa: "x" })]).some((e) =>
      e.includes("refinesMark is set and refines is not"),
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

/**
 * What a state page lists, and the two things it must not do.
 *
 * It must not count a method that merely inherits its slot's contract — that is
 * the same process drawn finer, and listing both tells a reader two things
 * arrive here when one does. And it must not miss a `through`: a route can
 * record an arrival no contract states, which is exactly why
 * `hermitian-generator` exists.
 */
test("a state's traffic counts own contracts and narrowings, never an inherited one", () => {
  const narrowing: StateVocabulary = {
    states: [
      ...FIXTURE_STATES.states,
      {
        id: "beta-sharp",
        label: "beta-sharp",
        labelJa: "beta-sharp",
        summary: "s",
        summaryJa: "s",
        specializes: ["beta"],
      },
    ],
  };
  const graph: LayerGraph = {
    nodes: [
      capability("span", { contract: contract("alpha", "gamma") }),
      capability("encode"),
      // Inherits `encode`'s contract rather than restating it, so it is the same
      // arrival at beta and must not be listed twice.
      method("plain", "encode", { contract: undefined }),
      method("narrower", "span", {
        contract: contract("alpha", "gamma"),
        steps: ["encode"],
        atomic: undefined,
        through: { encode: "beta-sharp" },
      }),
    ],
  };
  assert.deepEqual(
    validateLayerGraph(graph, new Set(["real-slug"]), narrowing, NO_DISPOSITIONS),
    [],
  );

  const beta = stateTraffic(graph, narrowing, "beta");
  assert.deepEqual(
    beta.arriving.map((n) => n.id),
    ["encode"],
  );
  assert.deepEqual(beta.narrowedInto, []);
  // beta is the broad one. Nothing narrower than itself accepts *it*.
  assert.deepEqual(beta.acceptedBy, []);

  const sharp = stateTraffic(graph, narrowing, "beta-sharp");
  assert.deepEqual(sharp.arriving, []);
  assert.deepEqual(
    sharp.narrowedInto.map((n) => n.id),
    ["narrower"],
  );

  const alpha = stateTraffic(graph, narrowing, "alpha");
  assert.deepEqual(
    alpha.leaving.map((n) => n.id),
    ["span", "encode", "narrower"],
  );
});

/**
 * The direction of `specializes`, rendered rather than left to be inferred.
 *
 * A page that lists only exact `from` matches tells a reader that nothing leaves
 * from a state whose entire reason for existing is that a broader process takes
 * it as it stands — which is what `hermitian-generator` said before this existed.
 * And the asymmetry has to hold: broader must never be listed as accepted where
 * narrower is asked for.
 */
test("a narrower state is accepted where a broader one is asked for, and never the reverse", () => {
  const vocabulary: StateVocabulary = {
    states: [
      { id: "broad", label: "broad", labelJa: "broad", summary: "s", summaryJa: "s" },
      {
        id: "narrow",
        label: "narrow",
        labelJa: "narrow",
        summary: "s",
        summaryJa: "s",
        specializes: ["broad"],
      },
      { id: "end", label: "end", labelJa: "end", summary: "s", summaryJa: "s" },
    ],
  };
  const graph: LayerGraph = {
    nodes: [capability("consume", { contract: contract("broad", "end") })],
  };

  // `consume` asks for broad. Holding narrow, you can hand it straight over.
  const narrow = stateTraffic(graph, vocabulary, "narrow");
  assert.deepEqual(narrow.leaving, []);
  assert.deepEqual(
    narrow.acceptedBy.map((n) => n.id),
    ["consume"],
  );

  // Holding broad, `consume` is an exact match — and it is listed once, as an
  // exact one, never doubled into the accepted list.
  const broad = stateTraffic(graph, vocabulary, "broad");
  assert.deepEqual(
    broad.leaving.map((n) => n.id),
    ["consume"],
  );
  assert.deepEqual(broad.acceptedBy, []);

  // The reverse never composes: nothing asks for narrow, so holding broad opens
  // nothing extra.
  const reversed: LayerGraph = {
    nodes: [capability("wants-narrow", { contract: contract("narrow", "end") })],
  };
  assert.deepEqual(stateTraffic(reversed, vocabulary, "broad").acceptedBy, []);
});

/**
 * `through` is the one edge whose whole value is that it cannot be silenced.
 *
 * A narrowing that is not actually a narrowing erases a real gap — it lets a
 * route claim it hands on a Hermitian generator when the step it delegates to
 * promises only a linear one, and the composition check then reads the chain as
 * closing. So each of the five rejections is asserted here rather than reviewed;
 * every one of them was live and untested until session 93.
 */
test("validation rejects a `through` that is not a narrowing", () => {
  const corpus = new Set(["real-slug"]);
  // A vocabulary of its own rather than a `specializes` edge added to
  // FIXTURE_STATES: those three states are deliberately mutually unrelated, and
  // giving one of them a parent would quietly change what every other assertion
  // in this file is measured against.
  const narrowing: StateVocabulary = {
    states: [
      ...FIXTURE_STATES.states,
      {
        id: "beta-sharp",
        label: "beta-sharp",
        labelJa: "beta-sharp",
        summary: "s",
        summaryJa: "s",
        specializes: ["beta"],
      },
    ],
  };
  // `a` spans alpha → gamma and delegates its first hop to `b`, which returns
  // beta. So beta is what a `through` on step `b` has to narrow.
  const graph = (through: LayerMethod["through"]): LayerGraph["nodes"] => [
    capability("a", { contract: contract("alpha", "gamma") }),
    capability("b"),
    method("m", "a", {
      contract: contract("alpha", "gamma"),
      steps: ["b"],
      atomic: undefined,
      through,
    }),
  ];
  const errorsFor = (through: LayerMethod["through"]) =>
    validateLayerGraph({ nodes: graph(through) }, corpus, narrowing, NO_DISPOSITIONS);

  assert.ok(errorsFor({}).some((e) => e.includes("through narrows nothing")));
  assert.ok(
    errorsFor({ nope: "beta-sharp" }).some((e) =>
      e.includes("through names nope, which is not one of its steps"),
    ),
  );
  assert.ok(
    errorsFor({ b: "no-such-state" }).some((e) =>
      e.includes("through[b] names an unknown state"),
    ),
  );
  // gamma is a real state and is not a kind of beta — a replacement wearing the
  // word "narrower", which is the case that would erase a gap.
  assert.ok(
    errorsFor({ b: "gamma" }).some((e) => e.includes("is not a kind of beta")),
  );
  assert.ok(
    errorsFor({ b: "beta" }).some((e) => e.includes("repeats what b already returns")),
  );
  // And the honest one passes: beta-sharp is a kind of beta, so the step really
  // does land somewhere narrower than it promised.
  assert.deepEqual(
    errorsFor({ b: "beta-sharp" }).filter((e) => e.includes("through")),
    [],
  );
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
  assert.deepEqual(
    validateLayerGraph(
      LAYER_GRAPH,
      SELF_DECLARED_SLUGS,
      STATE_VOCABULARY,
      COMPOSITE_NAME_DISPOSITIONS,
    ),
    [],
  );
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

test("every slot in the authored graph has at least two ways through it", () => {
  // `whyALayer`'s own doctrine, asserted rather than reviewed: *"if there is no
  // honest sentence saying which genuinely different methods compete for this
  // slot, it is not a layer, it is a step in one method's write-up."*
  //
  // This is the single rule that decides whether the map stays a lattice as the
  // corpus grows. A slot with one filler is indistinguishable from a stage in
  // somebody's preferred pipeline, and at a thousand papers a map made of those
  // is a thousand pipelines drawn on top of each other. Measured today: 18
  // slots, minimum 2 methods, maximum 7, and 84 papers produced all 18 — slots
  // saturate where methods and citations do not, and that is the scaling claim.
  //
  // A genuinely one-method slot is possible (the literature may have published
  // exactly one way). If one arrives, amend this test with the reason rather
  // than deleting it — an unasserted design rule is a design rule that has
  // already been broken somewhere nobody looked.
  const thin = LAYER_GRAPH.nodes
    .filter(isCapability)
    .map((node) => ({ id: node.id, ways: methodsRealizing(LAYER_GRAPH, node.id).length }))
    .filter((slot) => slot.ways < 2);
  assert.deepEqual(thin, []);
});

// ---------------------------------------------------------------------------
// Coined composite names
//
// The owner's rule — *"don't invent composite processes… integrator+qls should
// not be one composite process"* — applied to a node label. The hard part is not
// finding a `+`; it is refusing the coined ones **without** refusing `Clifford+T`,
// which is a real gate set, so every case below is a discrimination rather than a
// detection.

/**
 * A method that inherits its slot's contract, which is what every method on the
 * authored graph does — all fifty-eight of them. `method()` above gives its
 * fixtures a contract of their own, which is right for the rules that read one
 * and wrong here, where the whole subject is what a slot asserts on a method's
 * behalf.
 */
function filler(id: string, realizes: string, extra: Partial<LayerMethod> = {}): LayerMethod {
  return method(id, realizes, { contract: undefined, ...extra });
}

/** A three-state chain, so a route can have two genuinely advancing hops. */
const CHAIN: StateVocabulary = {
  states: [
    { id: "alpha", label: "alpha", labelJa: "alpha", summary: "s", summaryJa: "s" },
    { id: "beta", label: "beta", labelJa: "beta", summary: "s", summaryJa: "s" },
    { id: "gamma", label: "gamma", labelJa: "gamma", summary: "s", summaryJa: "s" },
  ],
};

/**
 * `route` delegates `lift` (alpha → beta) then `solve` (beta → gamma), so it is a
 * composite by hop count and its name is allowed to be judged.
 */
function composite(label: string, labelJa = label): LayerGraph {
  return {
    nodes: [
      capability("whole", { contract: contract("alpha", "gamma") }),
      capability("lift", { contract: contract("alpha", "beta") }),
      capability("solve", { contract: contract("beta", "gamma") }),
      // Unused by the route, and present for one reason: its name begins with the
      // letter a gate-set name ends with. Without it nothing in this fixture can
      // tell a single-letter fragment apart from a concept, and the floor that
      // does the telling would be untested.
      capability("transform", { contract: contract("beta", "gamma") }),
      filler("route", "whole", { label, labelJa, steps: ["lift", "solve"], atomic: undefined }),
      filler("lift-a", "lift"),
      filler("solve-a", "solve"),
    ],
  };
}

test("a coined composite is refused and a gate-set name is not", () => {
  const conjoins = (label: string, labelJa?: string) =>
    conjoinedCompositeNames(composite(label, labelJa)
      , CHAIN).map((entry) => entry.node);

  // The owner's own example. Both halves already name nodes of this graph, so
  // the label is the chain the `steps` edges already draw, written out.
  assert.deepEqual(conjoins("Lift + solve"), ["route"]);

  // …and the reason is reported, not just the verdict — a human has to be told
  // which fragments are the problem before "rename it" means anything.
  const [found] = conjoinedCompositeNames(composite("Lift + solve"), CHAIN);
  assert.deepEqual(
    found?.relisted.map((entry) => entry.concept),
    ["lift", "solve"],
  );
  assert.equal(found?.advancing, 2);

  // A term of art on the very same composite. `Clifford+T` is one gate set, it is
  // written closed up, and neither fragment names anything on this map. A blanket
  // ban on `+` would take this with it, which is the whole design constraint.
  assert.deepEqual(conjoins("Fault-tolerant compilation (Clifford+T pipeline)"), []);

  // The arm that stops the obvious evasion: close the spaces up and the fragments
  // still name two nodes, so it is still a relisting.
  assert.deepEqual(conjoins("Lift+solve"), ["route"]);

  // The `Clifford+T` shape, reduced: a word that does name a node, closed up with a
  // single letter that names a gate. `T` prefixes `transform` and would prefix
  // `time-discretization`, `taylor-…` and `trapezoidal-…` on the authored graph, so
  // without the four-character floor on prefix matching every `X+T` gate set reads
  // as a two-step chain. One letter is never evidence that a label relists a route.
  assert.deepEqual(conjoins("Lift+T"), []);

  // One concept plus a word that names nothing is a **name**, not a list — this is
  // the owner's `lindbladians` case, and the reason the bar is two fragments that
  // each land on something the map already draws.
  assert.deepEqual(conjoins("Lift+Lindbladians"), []);

  // …and a fragment has to land **whole**. `solver-free` shares a word with
  // `solve` and means its opposite; a rule that matched on any one token would
  // read a shared adjective as a step and start refusing names for mentioning
  // the neighbourhood they live in.
  assert.deepEqual(conjoins("Lift+solver-free shortcut"), []);
});

test("a coined composite is refused in the short form too, where it is likeliest", () => {
  // A `shortLabel` is a name a human wrote **for the canvas**, so it is the one
  // string on the node that is under pressure to become "Carleman + Euler + QLS":
  // the pressure that coins a composite is the pressure to fit a lane. Reading
  // only `label` would leave the rule refusing the long name while the short one
  // — the name actually on screen — went unchecked.
  const withShort = (short: string, shortJa = short): LayerGraph => {
    const base = composite("A perfectly innocent route name");
    return {
      nodes: base.nodes.map((node) =>
        node.id === "route" ? { ...node, shortLabel: short, shortLabelJa: shortJa } : node,
      ),
    };
  };

  // The long name is clean; the short one relists the chain. Caught.
  assert.deepEqual(
    conjoinedCompositeNames(withShort("Lift + solve"), CHAIN).map((e) => e.node),
    ["route"],
  );
  // The closed-up evasion, in the short field.
  assert.deepEqual(
    conjoinedCompositeNames(withShort("Lift+solve"), CHAIN).map((e) => e.node),
    ["route"],
  );
  // A short form that is a genuine term of art is still fine — the rule has to
  // stay usable, or the field it guards goes unused.
  assert.deepEqual(conjoinedCompositeNames(withShort("Clifford+T pipeline"), CHAIN), []);
  // Japanese only. The spaced-joiner arm reads whichever locale carries it, and a
  // coinage authored in one locale is a coinage.
  assert.deepEqual(
    conjoinedCompositeNames(withShort("Short name", "Lift + solve"), CHAIN)
      .flatMap((e) => e.locales),
    ["ja"],
  );
});

// --- the hollow twins -------------------------------------------------------
//
// The owner, mid-session 114: *"still seeing things like LCHS identity and Koopman-von-newman
// lift and discretize time or the propagator that have strange repeats within larger
// processes… Feels like there are hollow ones that have different labels on top but the same
// internals — which doesn't structurally make sense since different labels should mean their
// internals are actually different. so i am worried it's a structural issue that these things
// are allowed."*
//
// **He is right, and it is allowed.** `scripts/check-layer-graph.mjs`'s R13 gate fails two
// routes that *decompose* identically — but a leaf method does not decompose at all, so the
// gate has never had an opinion about them, and 34 of the 63 methods are leaves. A leaf draws
// exactly one segment and that segment is its slot's own contract, so every leaf under a slot
// necessarily draws the same picture. The labels differ because the methods differ; the
// interiors match because nothing inside has been written down.
//
// This is the scoreboard for fixing that, and it exists before any of the corpus work so the
// work is measurable. See `plans/atlas-revamp/W10-hollow-twins.md` for the three shapes of fix
// and which group wants which.

test("the hollow twins are counted, and the count may only fall", () => {
  const methods = LAYER_GRAPH.nodes.filter(isMethod);
  const chainOf = (method: LayerMethod): string => {
    const route = routeOf(LAYER_GRAPH, STATE_VOCABULARY, method);
    return route.segments
      .map((segment, index) => {
        // Read what the lane *draws*, which is `via` where a route pins one and the slot
        // otherwise — not the step list. Two routes that pin different methods through one slot
        // draw different pictures and are not twins, and grouping on `steps` would call them
        // twins anyway.
        const via =
          segment.capabilityId === null
            ? "«own»"
            : (method.via?.[segment.capabilityId] ?? segment.capabilityId);
        return `${route.states[index]}>${via}>${route.states[index + 1]}`;
      })
      .join("|");
  };

  const groups = new Map<string, LayerMethod[]>();
  for (const method of methods) {
    // Keyed by slot as well as chain. Cross-slot recurrence is a different fact — two ways of
    // reaching two different goals that happen to have no recorded interior — and measured
    // today there is none of it anyway.
    const key = `${method.realizes}::${chainOf(method)}`;
    groups.set(key, [...(groups.get(key) ?? []), method]);
  }

  const rows: Array<{ slot: string; ids: string[] }> = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ids = new Set(members.map((member) => member.id));
    // **A declared refinement is not a hollow twin.** `lchs-improved-kernel` draws
    // `lchs-route`'s chain on purpose — what changed is the kernel inside the identity, a
    // parameter rather than a construction — and since session 114 the card says so under the
    // lede. Dropping the members that declare `refines` at another member of the same group is
    // what leaves the residual that has explained nothing.
    const residual = members.filter(
      (member) => !(member.refines !== undefined && ids.has(member.refines)),
    );
    if (residual.length < 2) continue;
    rows.push({ slot: members[0]!.realizes, ids: residual.map((member) => member.id) });
  }
  const counted = rows.reduce((total, row) => total + row.ids.length, 0);

  console.log(`[hollow twins] ${counted}/${methods.length} methods in ${rows.length} groups`);
  for (const row of [...rows].sort((a, b) => b.ids.length - a.ids.length)) {
    console.log(`  ${row.ids.length}  ${row.slot}: ${row.ids.join(", ")}`);
  }

  // **A ceiling, not a pin, and the direction is the whole point.** 46 of 63 today, in 17
  // groups. Every group is a corpus job — decompose the method, narrow the state, or say why
  // three ways to one place have no recorded interior — and each one lands makes this fall.
  // Going *up* means a method was authored with nothing inside it beside siblings that already
  // had nothing, which is the thing he asked to have eliminated.
  assert.ok(
    counted <= 46,
    `${counted} methods draw a sibling's chain with nothing declaring why — was 46. ` +
      `A new one means a method was authored with no recorded interior beside siblings that ` +
      `already had none. See plans/atlas-revamp/W10-hollow-twins.md`,
  );
  // And the groups he named by sight are the big ones, pinned so that "the owner's examples"
  // stays a checkable claim rather than a recollection.
  const bySlot = (slot: string) => rows.find((row) => row.slot === slot)?.ids.length ?? 0;
  assert.ok(bySlot("time-discretization") >= 2, "the time-discretisation group stopped colliding");
  assert.ok(
    bySlot("nonlinear-linear-embedding") >= 2,
    "the embedding group — his Koopman-von Neumann lift — stopped colliding",
  );
  assert.ok(
    bySlot("hamiltonian-recasting") >= 2,
    "the recasting group — his LCHS identity — stopped colliding",
  );
});

// --- the three the card had nowhere to put ----------------------------------
//
// `OWNER_TODO` §2, answered in full in session 114: the mathematics of a hop with what
// it approximates and assumes beside it, a worked example with pseudocode, and the
// implementations tree. All three were `no-field-yet` on every card in the graph until
// these fields existed. What follows pins the rules that keep a populated one honest,
// because the failure mode of a brand-new optional field is that nothing ever checks it
// and the first record to use it wrongly is the one a reader sees.

test("a hop note is filed against a hop the reader can actually see", () => {
  const errors = (hops: Record<string, unknown>): string[] =>
    validateLayerGraph(
      {
        nodes: [
          capability("slot"),
          capability("step-a"),
          method("route", "slot", { steps: ["step-a"], atomic: undefined, hops: hops as never }),
          method("other", "slot"),
        ],
      },
      new Set<string>(),
      FIXTURE_STATES,
      NO_DISPOSITIONS,
    ).filter((error) => error.startsWith("route:"));

  // A step of this route: fine.
  assert.deepEqual(errors({ "step-a": { theory: "t", theoryJa: "t" } }), []);
  // The method's own id: also fine, and it is the key for the stretch a method closes
  // itself — 57 of the 63 methods carry one, and it is the hop the owner was looking at
  // when he asked about the blanks after Hamiltonian simulation.
  assert.deepEqual(errors({ route: { theory: "t", theoryJa: "t" } }), []);
  // **Anything else annotates a hop nothing draws.** A note filed against a capability
  // this route does not walk is a note that can never be wrong, because it is never read
  // — which is the same shape as a test that scans nothing.
  assert.deepEqual(errors({ "step-b": { theory: "t", theoryJa: "t" } }), [
    "route: hops names step-b, which is neither one of its steps nor the method itself",
  ]);
  assert.deepEqual(errors({ other: { theory: "t", theoryJa: "t" } }), [
    "route: hops names other, which is neither one of its steps nor the method itself",
  ]);

  // A pair or neither. One locale alone renders as a hole for half the readers, which is
  // the rule every prose field on this type already holds to — and it is easier to break
  // one level down, because nothing about a nested object makes a missing twin visible.
  //
  // `approximations` and `assumptions` were two more fields checked here until session 115.
  // The owner moved both inside the mathematics as marks, so what used to be a missing twin
  // is now a missing highlight — checked below, against the pair, rather than here.
  assert.deepEqual(errors({ "step-a": { theoryJa: "t" } }), [
    "route: hops[step-a].theory is present in one locale only",
  ]);
  assert.deepEqual(errors({ "step-a": { theory: "", theoryJa: "t" } }), [
    "route: hops[step-a].theory is present but empty — omit it instead",
  ]);
  // A key with no fact behind it draws a disclosure a reader opens onto nothing.
  // `repeats` rejects the same shape for the same reason.
  assert.deepEqual(errors({ "step-a": {} }), [
    "route: hops[step-a] records nothing — omit it instead",
  ]);

  // **A well-formed pair of marks passes**, so the checks below are failing on the defect
  // and not on the syntax itself.
  assert.deepEqual(
    errors({
      "step-a": {
        theory: "It solves [[approximation: a first-order step]] each time.",
        theoryJa: "毎回 [[approximation: 一次精度の刻み]] を解きます。",
      },
    }),
    [],
  );
  // A malformed mark reaches a reader as literal brackets in the prose, which reads as a
  // rendering bug and is a data one. The parser skips it silently by design — a renderer
  // that threw would take a page down over a typo — so this is where it has to be caught.
  assert.deepEqual(
    errors({ "step-a": { theory: "x [[approximaton: y]]", theoryJa: "x [[approximaton: y]]" } }),
    [
      "route: hops[step-a].theory: [[approximaton: …]] is not a mark — the kinds are approximation, assumption",
      "route: hops[step-a].theoryJa: [[approximaton: …]] is not a mark — the kinds are approximation, assumption",
    ],
  );
  assert.deepEqual(errors({ "step-a": { theory: "x [[assumption: y", theoryJa: "x" } }), [
    "route: hops[step-a].theory: 1 '[[' left open — a mark is unclosed",
  ]);
  // **The two locales must mark the same clauses.** A translation that drops the highlight
  // is not a styling difference between two translations; it is half the readers never being
  // told the step makes an approximation. Nothing else in the graph would catch it: both
  // strings are present, both are non-empty, and both render.
  assert.deepEqual(
    errors({ "step-a": { theory: "x [[assumption: y]]", theoryJa: "エックス" } }),
    [
      "route: hops[step-a]: the two locales mark different things — en marks [assumption] and " +
        "ja marks []. A highlight in one language only is a fact half the readers are not shown.",
    ],
  );
});

test("an example holds prose, pseudocode or both — never a name with neither", () => {
  const errors = (example: unknown): string[] =>
    validateLayerGraph(
      { nodes: [capability("slot"), method("route", "slot", { example: example as never }), method("b", "slot")] },
      new Set<string>(),
      FIXTURE_STATES,
      NO_DISPOSITIONS,
    ).filter((error) => error.startsWith("route:"));

  // The owner's "first pass": pseudocode alone, with no prose describing a run somebody
  // did. That has to be legal or the easy half is unshippable until the hard half exists.
  assert.deepEqual(errors({ pseudocode: "for k …" }), []);
  assert.deepEqual(errors({ text: "t", textJa: "t" }), []);
  assert.deepEqual(errors({ text: "t", textJa: "t", pseudocode: "for k …" }), []);
  assert.deepEqual(errors({ text: "t" }), ["route: example.text is present in one locale only"]);
  assert.deepEqual(errors({ pseudocode: "  " }), [
    "route: example.pseudocode is present but empty — omit it instead",
  ]);
  assert.deepEqual(errors({}), ["route: example records nothing — omit it instead"]);
});

test("an implementation is named, uniquely, and its papers look like papers", () => {
  const errors = (implementations: unknown): string[] =>
    validateLayerGraph(
      {
        nodes: [
          capability("slot"),
          method("route", "slot", { implementations: implementations as never }),
          method("b", "slot"),
        ],
      },
      new Set<string>(),
      FIXTURE_STATES,
      NO_DISPOSITIONS,
    ).filter((error) => error.startsWith("route:"));

  const entry = { id: "qiskit-run", label: "A", labelJa: "A" };
  // A name and nothing else is a real entry: it says an implementation exists and nobody
  // has written it up, which is a different fact from silence.
  assert.deepEqual(errors([entry]), []);
  // **Zero papers is a real value**, not an omission — the owner's "other implementations
  // that aren't papers but proven to be run". Nothing here may require one.
  assert.deepEqual(errors([{ ...entry, papers: [] }]), []);
  assert.deepEqual(errors([{ ...entry, about: "a", aboutJa: "a" }]), []);

  assert.deepEqual(errors([{ ...entry, id: "Qiskit Run" }]), [
    "route: implementation id is not kebab-case — Qiskit Run",
  ]);
  // Unique within the method, not globally: two methods may honestly both have a "qiskit"
  // one, and forcing global uniqueness would push the method's name into every id.
  assert.deepEqual(errors([entry, { ...entry, label: "B", labelJa: "B" }]), [
    "route: two implementations share the id qiskit-run",
  ]);
  assert.deepEqual(errors([{ ...entry, label: " " }]), [
    "route: implementation qiskit-run has an empty name",
  ]);
  assert.deepEqual(errors([{ ...entry, results: "r" }]), [
    "route: implementations[qiskit-run].results is present in one locale only",
  ]);
  assert.deepEqual(
    errors([{ ...entry, papers: [{ title: "T", authors: "A", year: "2024", url: "http://x.test" }] }]),
    ["route: implementation qiskit-run cites a non-https url — http://x.test"],
  );
  assert.deepEqual(
    errors([{ ...entry, papers: [{ title: "T", authors: "A", year: "24", url: "https://x.test" }] }]),
    ["route: implementation qiskit-run cites a paper with a year of 24"],
  );
});

test("a short form must be shorter, in both locales, and measured in pixels", () => {
  const withShort = (fields: Record<string, unknown>): string[] => {
    const base = composite("Lift then solve");
    return validateLayerGraph(
      { nodes: base.nodes.map((n) => (n.id === "route" ? { ...n, ...fields } : n)) },
      new Set<string>(),
      CHAIN,
      NO_DISPOSITIONS,
    ).filter((error) => error.startsWith("route:"));
  };

  // Both locales or neither. A short EN form with no JA twin draws two different
  // pictures in the two locales — different column widths, different geometry —
  // and the locale nobody checks is the one left long.
  assert.deepEqual(withShort({ shortLabel: "Lift" }), [
    "route: shortLabel is set and shortLabelJa is not — a short form must be authored in both locales or neither",
  ]);
  assert.deepEqual(withShort({ shortLabelJa: "Lift" }), [
    "route: shortLabelJa is set and shortLabel is not — a short form must be authored in both locales or neither",
  ]);

  // A copy is not a short form; it is a second place for one string to drift.
  assert.deepEqual(withShort({ shortLabel: "Lift then solve", shortLabelJa: "Lift" }), [
    "route: shortLabel is a copy of the full label — that is a second place for one string to drift, not a short form",
  ]);

  // Empty is refused rather than treated as absent — the ambiguous middle
  // between "no short form" and "an empty one" is exactly what `conditions`
  // already refuses on this node type.
  assert.deepEqual(withShort({ shortLabel: "", shortLabelJa: "Lift" }), [
    'route: shortLabel is empty — omit the field rather than setting it to ""',
  ]);

  // **Pixels, not characters, and this is the case that makes the difference.**
  // Nine CJK code points are 108px at the lane font; the fifteen Latin
  // characters of "Lift then solve" are 95.4px. So this "short" form has fewer
  // than two thirds the characters and is still wider on the canvas — a
  // character-counting check would wave it through.
  const jaWider = withShort({ shortLabel: "Lift", shortLabelJa: "持ち上げて解く手法" });
  assert.equal(jaWider.length, 1);
  assert.match(jaWider[0]!, /^route: shortLabelJa is not narrower than the full label when drawn/);
  assert.match(jaWider[0]!, /108\.0px vs 95\.4px/);

  // The honest case passes clean.
  assert.deepEqual(withShort({ shortLabel: "Lift", shortLabelJa: "持ち上げ" }), []);
});

test("only a composite can invent a composite", () => {
  // An atomic method may carry a compound name — there is no chain to relist,
  // because there is no chain. `ross-selinger-synthesis` is exactly this shape.
  const atomic: LayerGraph = {
    nodes: [
      capability("whole", { contract: contract("alpha", "gamma") }),
      method("route", "whole", { label: "Lift + solve", labelJa: "Lift + solve" }),
    ],
  };
  assert.deepEqual(conjoinedCompositeNames(atomic, CHAIN), []);

  // And a capability is never judged at all: it has no steps, so it cannot be
  // relisting them. This is what keeps `du/dt = A(t)u + b(t)` on the map.
  const equation: LayerGraph = {
    nodes: [capability("whole", { label: "Solve du/dt = A(t)u + b(t)" })],
  };
  assert.deepEqual(conjoinedCompositeNames(equation, CHAIN), []);
});

test("a rename that only happened in one locale is still a coined name", () => {
  // The failure a screenshot cannot catch. English reads as a single concept and
  // Japanese is still a plus list, so the node is reported with `ja` alone and a
  // reader in that locale still meets the invented composite.
  const [found] = conjoinedCompositeNames(composite("Lindbladians", "Lift + solve"), CHAIN);
  assert.deepEqual(found?.locales, ["ja"]);
  assert.equal(found?.node, "route");

  // English-only fires too, and both locales together report both.
  assert.deepEqual(
    conjoinedCompositeNames(composite("Lift + solve", "Lift + solve"), CHAIN)[0]?.locales,
    ["en", "ja"],
  );
});

test("a coined name must be disposed of, and the disposition cannot be a sentence", () => {
  const graph = composite("Lift + solve");
  const corpus = new Set<string>();
  const errors = (dispositions: readonly CompositeNameDisposition[]) =>
    validateLayerGraph(graph, corpus, CHAIN, dispositions).join("\n");

  // Fail-closed: nothing recorded about it is an error, and the message names the
  // two things a human may do about it.
  const unhandled = errors([]);
  assert.match(unhandled, /its label joins separate concepts/);
  assert.match(unhandled, /"Lift" is lift/);
  assert.match(unhandled, /source-framing|awaiting-owner-rename/);

  // The owner's queue clears it, and carries no citation — a name nobody has
  // ruled on is not a source's framing and may not borrow one.
  assert.equal(errors([{ node: "route", disposition: "awaiting-owner-rename", reason: "r" }]), "");
  assert.match(
    errors([
      { node: "route", disposition: "awaiting-owner-rename", reason: "r", citedAs: CITE[0]!.url },
    ]),
    /awaiting-owner-rename carries a citation/,
  );

  // The other disposition is reachable, and it is checkable rather than asserted:
  // the url has to be a citation the node already carries, so "the paper calls it
  // this" cannot be typed by somebody who has not cited the paper.
  assert.equal(
    errors([
      { node: "route", disposition: "source-framing", reason: "r", citedAs: CITE[0]!.url, phrase: "Lift + solve" },
    ]),
    "",
  );
  assert.match(
    errors([
      { node: "route", disposition: "source-framing", reason: "r", citedAs: "https://example.org/z", phrase: "p" },
    ]),
    /not one of this node's citations/,
  );
  assert.match(
    errors([{ node: "route", disposition: "source-framing", reason: "r", citedAs: CITE[0]!.url }]),
    /must quote the phrase/,
  );

  // A row that outlives the name it excuses. This is the failure the whole
  // mechanism exists to avoid: a queue nobody empties reads exactly like an empty
  // queue, so the row has to die with the rename rather than after it.
  assert.match(
    validateLayerGraph(composite("Lindbladians"), corpus, CHAIN, [
      { node: "route", disposition: "awaiting-owner-rename", reason: "r" },
    ]).join("\n"),
    /no longer joins concepts — delete the COMPOSITE_NAME_DISPOSITIONS row/,
  );
  assert.match(
    validateLayerGraph(graph, corpus, CHAIN, [
      { node: "ghost", disposition: "awaiting-owner-rename", reason: "r" },
    ]).join("\n"),
    /names an id the graph does not carry/,
  );
});

test("the authored graph's honest plus signs are not refused, and nothing else is", () => {
  const conjoined = conjoinedCompositeNames(LAYER_GRAPH, STATE_VOCABULARY).map((e) => e.node);

  // **The graph is clean now**, which is the state the owner's ruling was for:
  // both coined composites were renamed to the names their own papers use
  // ("Quantum Carleman linearization algorithm", Liu et al. Theorem 1;
  // "Quantum simulation of the KvN representation", Joseph §VI).
  // Spread rather than passed directly: `assert.deepEqual` carries an `asserts`
  // signature, so comparing the variable against `[]` narrows it to `never[]`
  // for the rest of the function and the `includes` checks below stop
  // type-checking against anything.
  assert.deepEqual([...conjoined], []);

  // …and that empty result is exactly what makes the next assertion the load-
  // bearing one. `assert.ok(!conjoined.includes(id))` against an empty array
  // passes for every id in the world, including ids that do not exist — a scan
  // that scans nothing, reported as a clean bill of health. So the honest names
  // are re-anchored: each must still CARRY a joiner (or the rule is not being
  // asked anything) and still not be refused.
  const named = new Map(LAYER_GRAPH.nodes.map((node) => [node.id, node]));
  for (const id of ["fault-tolerant-compilation", "ross-selinger-synthesis"]) {
    const node = named.get(id);
    assert.ok(node, `${id} has left the graph — this guard has lost its subject`);
    assert.match(
      node.label,
      /\+/,
      `${id} no longer carries a "+", so it can no longer show that the rule is not a ban on "+"`,
    );
    assert.ok(!conjoined.includes(id), `${id} is a real name (a gate set), not a coined composite`);
  }

  // `linear-ode-solve` used to sit in that list and never belonged: its label is
  // an equation, `du/dt = A(t)u + b(t)`, but it is a **capability**, and the rule
  // returns before any name test for anything that is not a method with two
  // advancing hops. It was passing for the wrong reason. Asserted here as what it
  // actually is, so the distinction stays visible.
  const equation = named.get("linear-ode-solve");
  assert.ok(equation && equation.kind === "capability");
  assert.match(equation.label, /\+/);

  // The register empties with the rename. A row whose node has stopped
  // conjoining is an error by the register's own rule, so the rename and the row
  // removal are one change, not two.
  assert.deepEqual(COMPOSITE_NAME_DISPOSITIONS, []);

  // The rule itself is still live — proven against a fixture rather than against
  // the authored graph, because the authored graph no longer offends. Without
  // this, every assertion above would keep passing if `conjoinedCompositeNames`
  // were replaced by `() => []`.
  assert.deepEqual(
    conjoinedCompositeNames(composite("Lift + solve"), CHAIN).map((e) => e.node),
    ["route"],
  );
});

test("advancing hops are counted off the route, not off the step list", () => {
  // `steps` is a set of what a route needs; only some of them move the object
  // along. A method whose second step is an ingredient is not a two-hop
  // composite, and judging its name would be judging a chain it does not have.
  const graph: LayerGraph = {
    nodes: [
      capability("whole", { contract: contract("alpha", "gamma") }),
      capability("lift", { contract: contract("alpha", "beta") }),
      // Takes gamma, which the route never holds before this point — a feed.
      capability("side", { contract: contract("gamma", "beta") }),
      filler("route", "whole", {
        label: "Lift + side",
        labelJa: "Lift + side",
        steps: ["lift", "side"],
        atomic: undefined,
      }),
      filler("lift-a", "lift"),
      filler("side-a", "side"),
    ],
  };
  const route = graph.nodes.find((node) => node.id === "route")!;
  assert.ok(isMethod(route));
  assert.equal(advancingStepCount(graph, CHAIN, route), 1, "the feed is not a hop");
  assert.deepEqual(conjoinedCompositeNames(graph, CHAIN), []);
});

// ---------------------------------------------------------------------------
// The compositions the graph asserts by putting two contracts on one state name
//
// > *"we just have to make sure that the state it resides in actually matches
// > the processes that can go in and out of it… i just want to make sure these
// > kind of checks are in place when we add more to the map!"*
// > — owner
//
// The check the owner is asking for is not expressible — see the block above
// `RouteSegment`: it needs a *restriction* relation and `specializes` only
// widens. So what is asserted here is the honest substitute: the size of the
// unchecked surface is derived rather than remembered, the pairs handed to the
// judge are the ones a reader can actually click, and the edge keys are the ones
// `pathStanding` walks.

/** `beta-sharp` is a kind of `beta`, so a route may land on it and compose on. */
const NARROWING: StateVocabulary = {
  states: [
    ...CHAIN.states,
    {
      id: "beta-sharp",
      label: "beta-sharp",
      labelJa: "beta-sharp",
      summary: "s",
      summaryJa: "s",
      specializes: ["beta"],
    },
  ],
};

/** Records what the census asks about, so the keys can be asserted directly. */
function recordingJudge(seen: string[]): (a: { method: string; edgeKey: string }, b: { method: string; edgeKey: string }) => CompositionStanding {
  return (arrival, departure) => {
    seen.push(`${arrival.edgeKey}/${arrival.method} > ${departure.edgeKey}/${departure.method}`);
    return "unpublished";
  };
}

test("a state's asserted compositions are every arrival against every departure", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("whole", { contract: contract("alpha", "gamma") }),
      capability("lift", { contract: contract("alpha", "beta") }),
      capability("solve", { contract: contract("beta", "gamma") }),
      filler("route", "whole", { steps: ["lift", "solve"], atomic: undefined }),
      filler("lift-a", "lift"),
      filler("lift-b", "lift"),
      filler("solve-a", "solve"),
    ],
  };
  const seen: string[] = [];
  const census = stateCompositionCensus(graph, CHAIN, recordingJudge(seen));
  const beta = census.states.find((state) => state.state === "beta")!;

  // Two lifts arrive because both inherit the slot's contract — which is the
  // finding, not a fixture quirk: no method in the authored graph carries a
  // contract of its own, so every arrival on the map is asserted by a slot.
  assert.deepEqual(beta.arrivals.map((end) => end.method), ["lift-a", "lift-b"]);
  assert.deepEqual(beta.departures.map((end) => end.method), ["solve-a"]);
  assert.equal(beta.asserted, 2);
  assert.equal(beta.unpublished, 2);
  assert.deepEqual(seen, ["lift/lift-a > solve/solve-a", "lift/lift-b > solve/solve-a"]);

  // The totals are sums over the states, and the "several arrivals" count is the
  // one that says where a shared name is doing the joining rather than a source.
  assert.equal(census.asserted, census.states.reduce((total, s) => total + s.asserted, 0));
  // `beta` and `gamma`. It counts states **more than one method arrives at**, not
  // states that assert a composition — `gamma` has two arrivals and no exit, so it
  // offers nothing to cross and still belongs in the count: two processes claiming
  // one name is the condition, and whether anything leaves is a separate fact the
  // `asserted` column carries.
  assert.equal(census.statesWithSeveralArrivals, 2);
  assert.equal(census.states.find((state) => state.state === "gamma")?.asserted, 0);
});

test("a departure is anything that accepts the state, not only what names it", () => {
  // `stateSatisfies` says a narrower object is taken where a broader one is
  // asked for. So a solver asking for `beta` is a way *out of* `beta-sharp`, and
  // a census reading `contract.from` literally would report a dead end on the one
  // state the graph reaches by narrowing.
  const graph: LayerGraph = {
    nodes: [
      capability("whole", { contract: contract("alpha", "gamma") }),
      capability("lift", { contract: contract("alpha", "beta") }),
      capability("solve", { contract: contract("beta", "gamma") }),
      filler("route", "whole", {
        steps: ["lift", "solve"],
        atomic: undefined,
        through: { lift: "beta-sharp" },
        via: { lift: "lift-b" },
      }),
      filler("lift-a", "lift"),
      filler("lift-b", "lift"),
      filler("solve-a", "solve"),
    ],
  };
  const census = stateCompositionCensus(graph, NARROWING, () => "unpublished");
  const sharp = census.states.find((state) => state.state === "beta-sharp")!;

  // The process that lands on `beta-sharp` is the **filler**, not the route that
  // recorded the narrowing. `kvn-simulation-route` writes the narrowing down;
  // `koopman-von-neumann-lift` is the thing that arrives. Reading the route as
  // the arrival would put a whole top-level route on a circle it passes through.
  assert.deepEqual(sharp.arrivals, [{ method: "lift-b", edgeKey: "lift@lift-b" }]);
  assert.deepEqual(sharp.departures.map((end) => end.method), ["solve-a"]);
  assert.equal(sharp.asserted, 1);
});

test("the census hands pathStanding keys it can actually match", () => {
  // The end-to-end join, and the only thing that proves it. The census builds
  // edge keys and `pathStanding` matches on them; get the shape wrong and every
  // composition comes back `unpublished`, which is indistinguishable from a
  // record in which nobody has published anything. One `recorded` is the
  // evidence, and it is the pair Liu et al. actually wrote down —
  // Carleman, then forward Euler.
  const standings = new Map<string, CompositionStanding>();
  const census = stateCompositionCensus(LAYER_GRAPH, STATE_VOCABULARY, (arrival, departure) => {
    const standing = pathStanding(LAYER_GRAPH, STATE_VOCABULARY, [
      { edgeKey: arrival.edgeKey, filler: arrival.method },
      { edgeKey: departure.edgeKey, filler: departure.method },
    ]);
    standings.set(`${arrival.method}>${departure.method}`, standing);
    return standing;
  });

  // The one composition anybody published, by name. `carleman-euler-qls-route`
  // pins both hops with `via`, so this pair is a route a source walked and named.
  assert.equal(standings.get("carleman-linearization>forward-euler"), "recorded");

  // …and the pair that is *not* it, which is the assertion with teeth. The same
  // route walks the same two slots and pins **forward** Euler on the second, so it
  // is not a witness for backward Euler — it took the other one. Drop the
  // departing method from the question and this flips to "recorded", printing a
  // source's blessing on a combination no source takes. If either method ever
  // leaves the graph, replace this pair with another conflicting one rather than
  // deleting the case.
  assert.equal(standings.get("carleman-linearization>backward-euler"), "unpublished");

  // Three-valued, and every value reachable on the authored graph. A standing
  // nothing can produce is a check that has stopped asking — the same rule
  // `PathStanding`'s own doc comment states.
  assert.ok(census.recorded > 0, "no composition is recorded — the edge keys do not join");
  assert.ok(census.unpinned > 0, "the middle value is unreachable");
  assert.ok(census.unpublished > 0);
  assert.equal(census.recorded + census.unpinned + census.unpublished, census.asserted);

  // Not a pinned total — `arrivals × departures` grows with any correct new
  // method, and pinning it would block tomorrow's content. What is pinned is the
  // shape: the map asserts far more compositions than it can support, and the
  // states with several arrivals are where that happens.
  assert.ok(census.unpublished > census.recorded);
  assert.ok(census.statesWithSeveralArrivals > 0);
  assert.ok(census.statesWithSeveralArrivals < STATE_VOCABULARY.states.length);
});

test("a process that reaches a circle two ways is one process arriving", () => {
  // `lift-b` narrows the slot's contract itself *and* is the filler a route pins
  // on a `through` naming the same state. Both are true and both are recorded, so
  // reading the ways in rather than the processes counts one method twice and
  // squares the composition total for that circle — measured on the real graph
  // before `crossingsAt` grew the same guard, `linear-ivp` reported 40 crossings
  // and listed one of them twice.
  const graph: LayerGraph = {
    nodes: [
      capability("whole", { contract: contract("alpha", "gamma") }),
      capability("lift", { contract: contract("alpha", "beta") }),
      capability("solve", { contract: contract("beta", "gamma") }),
      filler("route", "whole", {
        steps: ["lift", "solve"],
        atomic: undefined,
        through: { lift: "beta-sharp" },
        via: { lift: "lift-b" },
      }),
      method("lift-b", "lift", { contract: contract("alpha", "beta-sharp") }),
      filler("solve-a", "solve"),
    ],
  };
  assert.deepEqual(validateLayerGraph(graph, new Set<string>(), NARROWING, NO_DISPOSITIONS), []);

  const census = stateCompositionCensus(graph, NARROWING, () => "unpublished");
  const sharp = census.states.find((state) => state.state === "beta-sharp")!;
  assert.deepEqual(sharp.arrivals, [{ method: "lift-b", edgeKey: "lift" }]);
  assert.equal(sharp.asserted, sharp.departures.length);
});
