// The layer graph's derivations, and the one property three sessions of
// shipped bugs say has to be pinned rather than reviewed.
//
// Fixtures are built in-file rather than read off the authored graph, on this
// directory's standing rule: a test that reads the real corpus asserts today's
// content and goes green the day the content changes for an unrelated reason.
//
// **The records are not imported here**, for the reason
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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  DECLARABLE_ABSENCES,
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
  regionClosure,
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
import type { SourceCoverage } from "./repository/types.ts";
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

test("card depth is counted as three numbers, and a blank field is not one of them", () => {
  // The three are kept apart because they are three different kinds of gap:
  // pseudocode is transcribable from the record, `text` needs a run somebody
  // did, and an implementation needs somebody to read a source. A single
  // "cards filled" figure would let the first stand in for the other two.
  //
  // **The case this pins is the whitespace-only one.** `validateLayerGraph`
  // already rejects a pseudocode field that trims to nothing ("present but
  // empty — omit it instead"), so the census must agree with it: if the census
  // counted a blank, a field authored and then emptied would report as depth
  // the card cannot draw, and the two halves of the codebase would disagree
  // about whether that method has pseudocode. Counted with `.trim()` on both
  // sides so they cannot drift apart.
  const graph: LayerGraph = {
    nodes: [
      capability("solve", { contract: contract("alpha", "gamma") }),
      method("written", "solve", { example: { pseudocode: "return u" } }),
      method("blank", "solve", { example: { pseudocode: "   \n  " } }),
      method("ran-it", "solve", { example: { text: "a run", textJa: "実行" } }),
      method("built-it", "solve", {
        implementations: [{ id: "impl", label: "One", labelJa: "ひとつ" }],
      }),
      method("nothing", "solve", {}),
    ],
  };
  const census = layerCensus(graph, new Set<string>(), FIXTURE_STATES);
  assert.equal(census.methods, 5);
  assert.equal(census.withPseudocode, 1);
  assert.equal(census.withExampleText, 1);
  assert.equal(census.withImplementations, 1);
});

/**
 * The region gauge, pinned on the four things that would make it flatter a
 * region rather than measure one.
 *
 * A gauge that reports a region as healthier than it is fails silently and in
 * the direction nobody checks — the whole reason `regionClosure` exists is that
 * "linear ODE is closed" was previously a sentence in a session note.
 */
const REGION_REPORTS = new Map<string, SourceCoverage>([
  ["https://example.org/ran-it", { theory: "reported", simulation: "reported", hardware: "absent" }],
  ["https://example.org/skimmed", { theory: "reported", simulation: "unknown", hardware: "absent" }],
  ["https://example.org/pure", { theory: "reported", simulation: "absent", hardware: "absent" }],
]);

function citing(url: string) {
  return [{ title: "A paper", authors: "Someone", year: "2020", url }];
}

test("a region is the slots named plus the methods filling them, and a typo is reported", () => {
  const region = regionClosure(FIXTURE, FIXTURE_STATES, ["solve", "encode", "no-such-slot"], new Map());
  assert.deepEqual(region.capabilities, ["solve", "encode"]);
  // Reported rather than dropped. A mistyped slot silently measures a SMALLER
  // region, and a smaller region reads as a healthier one — the worst direction
  // for a gauge to be wrong in.
  assert.deepEqual(region.unknown, ["no-such-slot"]);
  assert.deepEqual(region.methods, ["direct", "fast", "other", "encode-a"]);
  // A method id passed where a capability belongs names nothing to realise, so
  // it cannot quietly pull that one method in as its own region.
  const notASlot = regionClosure(FIXTURE, FIXTURE_STATES, ["direct"], new Map());
  assert.deepEqual(notASlot.capabilities, []);
  assert.deepEqual(notASlot.unknown, ["direct"]);
  assert.deepEqual(notASlot.methods, []);
  // A repeated id is one slot. Counting it twice inflates the slot count beside
  // the fractions, which reads as a bigger region than was measured — and
  // `methods` is already immune because it filters on a Set, so the two halves
  // of the same report would disagree. First-seen order is kept.
  const repeated = regionClosure(
    FIXTURE,
    FIXTURE_STATES,
    ["encode", "solve", "encode", "no-such-slot", "no-such-slot"],
    new Map(),
  );
  assert.deepEqual(repeated.capabilities, ["encode", "solve"]);
  assert.deepEqual(repeated.unknown, ["no-such-slot"]);
  assert.deepEqual(repeated.methods, ["direct", "fast", "other", "encode-a"]);
});

test("a route that delegates every hop has no own stretch, so it is not counted as a gap", () => {
  // The mutation this is here to catch: taking the stretch list from the key
  // rule `validateLayerGraph` enforces — steps plus the method's own id, legal
  // on every method — instead of from `routeOf`. That version puts an own
  // stretch on `whole`, whose delegated step already reaches the slot's output,
  // so a note keyed there would render nowhere. It would show as one more gap
  // on a route that has none, permanently, on a worklist nobody could close.
  const graph: LayerGraph = {
    nodes: [
      capability("solve", { contract: contract("alpha", "gamma") }),
      capability("whole-step", { contract: contract("alpha", "gamma") }),
      capability("part-step"),
      method("whole", "solve", {
        contract: contract("alpha", "gamma"),
        steps: ["whole-step"],
        atomic: undefined,
      }),
      method("part", "solve", {
        contract: contract("alpha", "gamma"),
        steps: ["part-step"],
        atomic: undefined,
      }),
      method("whole-a", "whole-step", { contract: contract("alpha", "gamma") }),
      method("part-a", "part-step"),
    ],
  };
  const region = regionClosure(graph, FIXTURE_STATES, ["solve"], new Map());
  // `whole` contributes one stretch (its delegated step); `part` contributes
  // two (its step, then the stretch it closes itself).
  assert.equal(region.hopStretches, 3);
  assert.deepEqual(region.unauthoredHops, [
    { method: "whole", key: "whole-step" },
    { method: "part", key: "part-step" },
    { method: "part", key: "part" },
  ]);
  // And an atomic method is one stretch, its own — the same rule, not a case.
  const atomicRegion = regionClosure(graph, FIXTURE_STATES, ["part-step"], new Map());
  assert.equal(atomicRegion.hopStretches, 1);
  assert.deepEqual(atomicRegion.unauthoredHops, [{ method: "part-a", key: "part-a" }]);
});

test("an authored hop counts once and only where it is drawn", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("solve", { contract: contract("alpha", "gamma") }),
      capability("encode"),
      method("direct", "solve", {
        contract: contract("alpha", "gamma"),
        steps: ["encode"],
        atomic: undefined,
        hops: { encode: { theory: "the mathematics", theoryJa: "数学" } },
      }),
      method("encode-a", "encode"),
    ],
  };
  const region = regionClosure(graph, FIXTURE_STATES, ["solve"], new Map());
  assert.equal(region.hopStretches, 2);
  assert.equal(region.hopStretchesAuthored, 1);
  assert.deepEqual(region.unauthoredHops, [{ method: "direct", key: "direct" }]);
});

test("why a worked run is missing is three-valued, and the middle value is the common one", () => {
  // `accounted` is a finished answer, `outstanding` is work, and `unread` is a
  // paper to read — three different next actions. Two values would collapse the
  // last two into "nothing to write up", which is exactly wrong: `papers.ts`
  // forces `simulation` to `unknown` on an abstract read *because* numerics hide
  // below the abstract, so a two-valued gauge would report a region of skimmed
  // sources as complete.
  const graph: LayerGraph = {
    nodes: [
      capability("solve", { contract: contract("alpha", "gamma") }),
      method("has-a-run", "solve", { citations: citing("https://example.org/ran-it") }),
      method("skimmed", "solve", { citations: citing("https://example.org/skimmed") }),
      method("theory-only", "solve", { citations: citing("https://example.org/pure") }),
      method("off-register", "solve", { citations: citing("https://example.org/not-in-register") }),
      method("uncited", "solve", { citations: [] }),
    ],
  };
  const region = regionClosure(graph, FIXTURE_STATES, ["solve"], REGION_REPORTS);
  assert.deepEqual(region.runEvidence.get("has-a-run"), {
    verdict: "outstanding",
    paper: "https://example.org/ran-it",
  });
  assert.deepEqual(region.runEvidence.get("skimmed"), {
    verdict: "unread",
    paper: "https://example.org/skimmed",
  });
  // `accounted` carries no paper, and that is the honest shape: the verdict is
  // about every citation at once rather than about any particular one.
  assert.deepEqual(region.runEvidence.get("theory-only"), { verdict: "accounted" });
  // A citation the register does not carry is `unread`, not `accounted`: an
  // absence of evidence is not evidence of absence, and the register is the only
  // place that could say otherwise.
  assert.deepEqual(region.runEvidence.get("off-register"), {
    verdict: "unread",
    paper: "https://example.org/not-in-register",
  });
  // Nor does a method with no sources at all get to claim there is nothing to
  // write up. No paper either — there is none to name.
  assert.deepEqual(region.runEvidence.get("uncited"), { verdict: "unread" });
});

test("an outstanding verdict names the paper that produced it, because it is a lead and not a promise", () => {
  // **Seven for seven, measured.** The register is keyed by PAPER and a method
  // cites several, so "some cited paper reports numerics" cannot mean "there is a
  // run of THIS method to write up". Every one of the linear-ODE region's seven
  // `outstanding` methods was read on 2026-08-12 and every one turned out to be
  // numerics about a neighbouring method. Printing the deciding url turns a
  // reader's next step from "read three papers" into "look at this section", and
  // stops the gauge implying a promise it cannot keep.
  //
  // Pinned on the FIRST reporting citation rather than any of them, because a
  // method citing two reporting papers would otherwise report a different one
  // between runs and the gauge's output would stop being diffable.
  const graph: LayerGraph = {
    nodes: [
      capability("solve", { contract: contract("alpha", "gamma") }),
      method("two-leads", "solve", {
        citations: [
          { title: "A paper", authors: "Someone", year: "2020", url: "https://example.org/pure" },
          { title: "A paper", authors: "Someone", year: "2020", url: "https://example.org/ran-it" },
          { title: "A paper", authors: "Someone", year: "2020", url: "https://example.org/skimmed" },
        ],
      }),
    ],
  };
  const region = regionClosure(graph, FIXTURE_STATES, ["solve"], REGION_REPORTS);
  assert.deepEqual(region.runEvidence.get("two-leads"), {
    verdict: "outstanding",
    paper: "https://example.org/ran-it",
  });
});

test("a declared absence is checked every way it can be false except the one that matters", () => {
  // **What this replaces is a `//` comment.** This graph already carries careful
  // accounts of honest absences — `backward-euler`'s `cost` says so in the field,
  // `koopman-linearization`'s says so in a comment above it — and no machine could
  // tell either from a field nobody had looked at. So a region could only be
  // declared closed by a human reading the file.
  //
  // Three of the four rules are enforceable and are enforced here. The fourth —
  // that the reason names what was READ — is review's, and it is the one that
  // matters most: "not stated" is the absent field with extra words.
  const graph: LayerGraph = {
    nodes: [
      capability("solve", { contract: contract("alpha", "gamma") }),
      method("accounted", "solve", {
        absences: { cost: { reason: "the source proves it only for k >= 3", reasonJa: "出典は k >= 3 の場合しか示していません" } },
      }),
      method("explains-a-filled-field", "solve", {
        cost: "$O(n)$",
        costJa: "$O(n)$",
        absences: { cost: { reason: "r", reasonJa: "r" } },
      }),
      method("not-declarable", "solve", {
        absences: { entries: { reason: "r", reasonJa: "r" } },
      }),
      method("half-translated", "solve", {
        absences: { conditions: { reason: "r", reasonJa: "  " } },
      }),
    ],
  };
  const errors = validateLayerGraph(graph, new Set<string>(), NARROWING, NO_DISPOSITIONS);
  // A reason beside a FILLED field is the second copy that drifts the first time
  // either is edited.
  assert.ok(
    errors.some((e) => e.includes("explains-a-filled-field") && e.includes("not empty")),
    `expected a filled-field error, got ${JSON.stringify(errors)}`,
  );
  // A field a source could never supply is not a field an absence can account
  // for — `entries` is about the corpus, not about any paper.
  assert.ok(errors.some((e) => e.includes("not-declarable") && e.includes("absences names entries")));
  // Half the readers cannot read half a reason.
  assert.ok(errors.some((e) => e.includes("half-translated") && e.includes("empty reason")));
  // And the honest one passes.
  assert.ok(!errors.some((e) => e.includes("accounted:")), `the valid declaration was rejected: ${JSON.stringify(errors)}`);
});

test("a field whose every gap is declared is CLOSED, and one open gap is enough to reopen it", () => {
  // The verdict the gauge could not reach before. Per FIELD rather than one
  // boolean, because the fields are not the same kind of gap — "the region is
  // closed" is a claim about each of them separately, and collapsing them is the
  // same substitution the no-percentage rule above refuses.
  const graph: LayerGraph = {
    nodes: [
      capability("solve", { contract: contract("alpha", "gamma") }),
      method("filled", "solve", { cost: "$O(n)$", costJa: "$O(n)$", conditions: "c", conditionsJa: "c" }),
      method("declared", "solve", {
        conditions: "c",
        conditionsJa: "c",
        absences: { cost: { reason: "no source states one", reasonJa: "出典にありません" } },
      }),
      method("open", "solve", { cost: "$O(n)$", costJa: "$O(n)$" }),
    ],
  };
  const region = regionClosure(graph, FIXTURE_STATES, ["solve"], new Map());
  assert.deepEqual(region.declaredAbsences.get("cost"), ["declared"]);
  // `cost` is closed: one method carries it, one declares why it does not.
  assert.ok(region.closedFields.includes("cost"));
  // `conditions` is NOT: `open` neither carries it nor accounts for it.
  assert.ok(!region.closedFields.includes("conditions"));
});

test("a region's fields are counted apart, and a blank one is not counted at all", () => {
  // Per field, never averaged. `MethodExample`'s own doc comment draws the line
  // this refuses to cross: pseudocode is transcribable from the record and a
  // worked run needs a laboratory, so one figure over both would let the cheap
  // half stand in for the half nobody at this desk can close.
  const graph: LayerGraph = {
    nodes: [
      capability("solve", { contract: contract("alpha", "gamma") }),
      method("full", "solve", {
        conditions: "when it applies",
        conditionsJa: "適用条件",
        cost: "$O(n)$",
        costJa: "$O(n)$",
        example: { pseudocode: "return u" },
      }),
      method("blank", "solve", { example: { pseudocode: "  \n " } }),
    ],
  };
  const region = regionClosure(graph, FIXTURE_STATES, ["solve"], new Map());
  const field = (name: string) => region.fields.find((entry) => entry.field === name);
  assert.deepEqual(field("cost"), { field: "cost", present: 1, total: 2, missing: ["blank"] });
  // Whitespace is not authorship, and `validateLayerGraph` already refuses a
  // pseudocode field that trims to nothing — the gauge has to agree with it or
  // the two halves of the codebase disagree about what is written.
  assert.deepEqual(field("example.pseudocode"), {
    field: "example.pseudocode",
    present: 1,
    total: 2,
    missing: ["blank"],
  });
  assert.equal(field("example.text")?.present, 0);
  // No combined number exists to be quoted, by construction.
  assert.equal(
    Object.keys(region).some((key) => key.toLowerCase().includes("percent")),
    false,
  );
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
  // linear-solve span; `time-marching-usva` pays its discretization every step
  // and bypasses the solve outright. A node asserting both
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
 * Passing this as the corpus satisfies the one rule that needs the real corpus —
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

/**
 * The hollow-twin census, one line per slot that holds any. See the long comment inside
 * the test below for what this replaced and why it is an exact census rather than a
 * ceiling; the short version is that a slot ABSENT from this table is declared to hold
 * ZERO, so a new region cannot open quietly and a slot that gets fixed cannot leave slack
 * behind for later rot to fill.
 */
const HOLLOW_BY_SLOT: ReadonlyMap<string, number> = new Map([
  // A region opening, in the gate's own words, rather than rot. The PDE
  // discretization slots arrived in session 15 with two methods each and no
  // recorded interior, for the same reason the discretization slots above are
  // hollow: what a discretization produces is a system of rows, and assembling
  // rows is not a capability this graph decomposes.
  //
  // **`spatial-discretization` is deliberately NOT here, and it was, for an
  // hour.** Recording that the graph-Laplacian route lands on a Hermitian
  // generator rather than a bare linear one — which its paper states outright,
  // and which is what lets it reach a simulator directly — made the two methods
  // draw different chains, and the census dropped to 0 on its own. The gate then
  // asked for the row to be deleted rather than left as silent room. That is the
  // better outcome than declaring the twins: the narrowing was true, sourced,
  // and the exception stopped being needed.
  ["full-discretization", 2],
  // The three the owner named by sight. Each is a corpus job, not a gate problem.
  // 5 → 6 in session 130, and declared rather than absorbed: the sixth is
  // `chebyshev-pseudospectral-collocation`, authored from arXiv:1901.00961 §2 so
  // that `childs-liu-spectral` had something sourced to pin its first hop to.
  // It is hollow for the same reason the five beside it are — what a
  // discretization produces is a system of rows, and assembling rows is not a
  // capability this graph decomposes — so this is a region widening by one
  // known member, not a new kind of gap.
  ["time-discretization", 6],
  ["nonlinear-linear-embedding", 4],
  ["hamiltonian-recasting", 2],
  // Four phase-factor routines that differ in their numerics and in nothing this graph
  // has recorded yet.
  ["qsp-phase-factors", 4],
  ["state-preparation", 3],
  // 4 since B5 unit 3: `measurement-grouped-readout` is a fourth readout consuming a
  // prepared state and nothing else. The chain is one hop long, so there is no second hop
  // to tell any of them apart by — what this one changes is which TERMS share one set of
  // shots, and a term grouping is not a step.
  ["observable-estimation", 4],
  // 4 since B5's leaf anchors: `symmetry-verification` is a fourth mitigation consuming a
  // prepared state and nothing else. What separates it from its siblings is WHICH quantity
  // it checks and what it does with a violation, and neither is a step this graph draws.
  ["error-mitigation", 4],
  // The `quantum-linear-solve` row is gone: 2 → 0. `discrete-adiabatic-inversion` and
  // `eigenstate-filtering-inversion` were the pair, and they are now pinned to the two
  // methods that realise `matrix-function` — the box the owner named in ai-ops#51 as
  // where the difference actually lives. Each pin is the record's own summary: one
  // applies its filter "as a linear combination of walk operators rather than by quantum
  // signal processing", the other "through quantum signal processing".
  // 2 since session 129 authored `berry-multistep`. It and `krovi-linear-ode` draw the same
  // "discretize → solve", and the shared picture is the finding rather than the defect: neither
  // hop can be pinned, for OPPOSITE reasons. Krovi's paper chooses no discretization — it
  // re-analyses the Taylor propagator Berry, Childs, Ostrander and Wang already chose. Berry's
  // defines one, but only as a family (Definition 2, any A(α)-stable k-step method of order
  // p = k) and never instantiates it. Authoring that family as a sixth `time-discretization`
  // node was tried in the same session and backed out: forward Euler, backward Euler and the
  // trapezoidal rule ARE linear multistep methods, so the family would have been drawn beside
  // three of its own instances. The full argument is the KNOWN_TWINS row in
  // `scripts/check-layer-graph.mjs`; this line is its count.
  ["linear-ode-solve", 2],
  ["polynomial-approximation", 2],
  // 4 since session 15, and the +2 for ONE new method is the summing rule working rather
  // than two methods rotting. `thc-block-encoding` does not join the existing pair — it
  // forms a SECOND group with `pauli-lcu-block-encoding`, because both draw one own hop
  // with a `state-preparation` stub, and a group of one is not a group. So the slot goes
  // from one group of two to two groups of two. What separates the new pair is what the
  // LCU sum runs over — Pauli strings against tensor-hypercontraction factors — and a
  // decomposition is not a step this graph draws, the same shape as the objective and
  // readout rows below. Their reason is written out in `KNOWN_TWINS`
  // (`scripts/check-layer-graph.mjs`), which is the gate that fails the build.
  ["block-encode-matrix", 4],
  ["qubit-routing", 2],
  ["gate-synthesis", 2],
  ["error-correction", 2],
  // W21's region, opened in PR 400: three fixed ansatz families that construct a circuit
  // family in one step, plus the adaptive pair that each hang one `observable-estimation`
  // stub. `qubit-adapt-ansatz` is dropped by the `refines` rule in the test, as designed —
  // a declared refinement is not a hollow twin.
  // 8 since B5's leaf anchors: `particle-hole-ansatz` and `orbital-optimized-ansatz` join
  // `symmetry-preserving-ansatz` (PR 441), so five fixed families now. Each constructs its
  // circuit family in one step and has no recorded interior yet — the honest state of a
  // family nobody has decomposed — and each is authored as a LEAF rather than given a stub
  // it was never described as having, which would be inventing structure to escape this
  // line.
  // 9 since session 15, and it moves by ONE although two ansätze were authored — which is
  // the `refines` rule doing exactly what it was written for. `generalized-excitation-ansatz`
  // is a sixth fixed family, a leaf with no recorded interior, so it counts.
  // `batched-adapt-ansatz` declares `refines: adapt-ansatz` and is dropped, the same way
  // `qubit-adapt-ansatz` is: a declared refinement has already said why it looks like its
  // sibling, which is the whole question this census asks.
  ["ansatz-construction", 9],
  // **W21-E's region, and this line is the thing a global ceiling could not say.** Six of
  // the seven excited-state methods draw a sibling's picture, in two groups: four take
  // VQE's three hops and differ only in the objective handed to the optimiser, and two
  // take the ground state as given and differ only in which operators their matrix
  // elements run over. Under the old global count this arrived as 41 → 47 with no way to
  // tell a region being opened from six methods rotting, and the only available answer was
  // to raise the number again. Declared here instead, with the two groups and their
  // reasons written out in `KNOWN_TWINS` (`scripts/check-layer-graph.mjs`), which is the
  // gate that fails the build rather than the scoreboard.
  //
  // It is a worklist, not a settlement: `folded-spectrum-excited-state` leaves the first
  // group as soon as `vqe-variance-objective` has a node to pin `via`, and this number
  // becomes 5 — at which point this test fails until someone edits it, which is the
  // census working rather than breaking.
  // **5, and the census called this shot.** The note above ends "leaves the first group
  // as soon as `vqe-variance-objective` has a node to pin `via`, and this number becomes
  // 5 — at which point this test fails until someone edits it, which is the census
  // working rather than breaking." That is exactly what happened: the node existed, the
  // pin was written and sourced to Cadi Tazi and Thom's own words, and the only thing
  // holding it was a size argument measured against a figure seven times the size of the
  // one that exists now. The pin costs this figure 0.76px.
  ["excited-state-energy", 5],
  // 2 since B5 unit 3, and this slot is new to the census rather than newly rotten:
  // `variance-objective` joins `cvar-objective` as a second objective filling the slot in
  // one hop, with no second hop to separate them. What separates them is the objective
  // itself, which is not a step this graph draws — the same shape as the readout row
  // above, and the same fix (an objective needs a state before a `via` can pin it).
  // 3 since B5 unit 4: `natural-gradient-optimization` is a third one-hop filler.
  // The three differ in the objective (`cvar-objective`, `variance-objective`) or in the
  // metric the step is taken against (this one), and neither is a step this graph draws.
  // 4 since session 15: `spsa-optimization` is a fourth one-hop filler. It differs from the
  // other three in neither the objective nor the metric but in HOW THE GRADIENT IS
  // ESTIMATED — two objective evaluations in one random direction instead of one pair per
  // parameter — and an estimator is not a step this graph draws either. Three different
  // kinds of difference now sit in one undrawable group, which is the argument for giving
  // the objective a state rather than for raising this number again.
  ["parameter-optimization", 4],
  // **New in session 15 unit 2, and this row is a slot OPENING rather than rot** — the
  // distinction this census exists to let us state. `phase-estimation` was authored with
  // exactly two methods and neither has a recorded interior yet, which is the honest
  // starting state of a slot nobody has decomposed. What separates them is not a step
  // but a resource choice — m ancillas read out together against one ancilla reused
  // across m rounds with classical feedback — and Dobsicek et al. state that trade in
  // their own words, so the difference is sourced even though the drawing cannot show
  // it.
  //
  // **Note this row has NO matching `KNOWN_TWINS` entry, unlike every other row here,
  // and that is not an omission.** That gate only inspects methods whose route opens
  // into something; these two open into nothing at all, so it never sees them. The two
  // instruments therefore disagree about what a look-alike is, and this census is the
  // stricter of the two — which is worth knowing before trusting a green
  // `check-layer-graph` as evidence that a new slot's methods are distinguishable.
  ["phase-estimation", 2],
  // **Session 15 unit 3, and the largest opening row this census has ever carried** —
  // all three methods of a brand-new subject region, none of them decomposed. What
  // separates them is not a step but WHAT KIND OF THING THE PERIOD IS: an integer in a
  // finite cyclic group, an irrational real, a lattice of rank r. That is a difference
  // in what is possible rather than in cost, and Hallgren states it against Shor in his
  // own words — an irrational period "prevents direct application of Shor's
  // algorithms". So this row is as far from rot as a row here can be: the distinction
  // is sourced to a primary paper, it is written into the slot's `whyALayer`, and the
  // drawing simply has no vocabulary for the type of a period. If a `via` ever becomes
  // pinnable here it will be because the group type got a state, not because these
  // three were decomposed.
  ["hidden-period-finding", 3],
  // Unit 4's region, and a slot opening again rather than rot. What separates quantum
  // volume from randomized benchmarking is WHAT THE NUMBER IS ABOUT — a whole machine
  // against a gate set in isolation — and "what a measurement is about" is not a step,
  // so the drawing cannot show it. Unusually well sourced for a hollow row: one of the
  // two papers argues explicitly against the other's category, which is a stronger
  // distinction than most slots have and still undrawable.
  ["device-characterization", 2],
]);

/**
 * Every way the census and the graph disagree, as messages — empty when they agree.
 *
 * A function rather than assertions inline in the test, for one reason: a gate that has
 * only ever been observed passing is a gate nobody has seen work. Pure and total, it can
 * be handed synthetic rows, which is what the test below it does — it drives all three
 * failure directions (a slot rising, a slot falling, an undeclared slot appearing) and
 * asserts each one produces a message. That check fails if the gate ever stops failing.
 */
function hollowCensusFailures(
  rows: ReadonlyArray<{ slot: string; ids: string[] }>,
  table: ReadonlyMap<string, number>,
): string[] {
  const slots = new Set<string>([...table.keys(), ...rows.map((row) => row.slot)]);
  const failures: string[] = [];
  for (const slot of [...slots].sort()) {
    const actual = bySlotIn(rows, slot);
    const pinned = table.get(slot) ?? 0;
    if (actual === pinned) continue;
    // The line to write, spelled out: a gate that reports a number without saying what to
    // do with it gets satisfied by whatever edit makes the red go away.
    const line = actual === 0 ? `delete the "${slot}" row` : `["${slot}", ${actual}]`;
    failures.push(
      actual > pinned
        ? `${slot}: ${actual} methods draw a sibling's picture with nothing declaring why — ` +
            `was ${pinned}. A new one means a method was authored with no recorded interior ` +
            `beside siblings that already had none. Decompose it, narrow the state, or say ` +
            `why. If this is a region opening rather than rot, declare it: ${line}. ` +
            `See plans/atlas-revamp/W10-hollow-twins.md`
        : `${slot}: ${actual}, down from ${pinned} — corpus work landed and the census has ` +
            `not been told. Record the win: ${line}. A stale-high number is silent room for ` +
            `the rot this gate exists to catch.`,
    );
  }
  return failures;
}

/** How many hollow twins a slot holds, summed across its groups.
 *
 * Summed, not `find`: one slot **may** hold more than one group — `ansatz-construction`
 * holds two — and `find` would answer with whichever came first, which is a number that
 * depends on corpus order. Shared by the per-slot census and by the owner's named-group
 * assertions below so that the census and the examples cannot disagree about what a
 * slot's count is. */
function bySlotIn(rows: ReadonlyArray<{ slot: string; ids: string[] }>, slot: string): number {
  return rows
    .filter((row) => row.slot === slot)
    .reduce((total, row) => total + row.ids.length, 0);
}

test("the hollow twins are counted per slot, and every slot's count is declared", () => {
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
  // **And the ingredients, because a stub is drawn.** `routeOf` splits a method's
  // recorded interior two ways: hops that advance the chain become segments, and
  // steps that do not fit between the contract's two ends become **feeds**, drawn
  // as stubs off the belly. Keying on segments alone therefore calls two methods
  // twins whose figures do not look alike.
  //
  // Measured, not argued. `layoutConvergeForMethod` gives `hhl-qpe-inversion`
  // three stubs — `state-preparation` carrying `×O(κ)`, `hamiltonian-simulation`
  // and `success-amplification` — where `discrete-adiabatic-inversion` hangs one.
  // Those are different pictures, and the owner's complaint is about what he
  // *sees*:
  // *"different labels on top but the same internals"*. A method whose internals
  // are an ingredient has internals.
  const drawnBy = (method: LayerMethod): string => {
    const route = routeOf(LAYER_GRAPH, STATE_VOCABULARY, method);
    // `via` again, for the same reason it is read on a segment: a stub draws the
    // method a route pins through the slot, where one is pinned.
    const feeds = [...route.feeds]
      .map((slot) => String(method.via?.[slot] ?? slot))
      .sort()
      .join("+");
    return `${chainOf(method)}##${feeds}`;
  };

  const groups = new Map<string, LayerMethod[]>();
  for (const method of methods) {
    // Keyed by slot as well as chain. Cross-slot recurrence is a different fact — two ways of
    // reaching two different goals that happen to have no recorded interior — and measured
    // today there is none of it anyway.
    const key = `${method.realizes}::${drawnBy(method)}`;
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

  // **A ceiling, not a pin, and the direction is the whole point.** 36 of 63 today, in 13
  // groups. Every group is a corpus job — decompose the method, narrow the state, or say why
  // three ways to one place have no recorded interior — and each one lands makes this fall.
  // Going *up* means a method was authored with nothing inside it beside siblings that already
  // had nothing, which is the thing he asked to have eliminated.
  //
  // **It was 46, and the ten that left did not leave because corpus work landed.**
  // They left because this was keyed on the spine and the figure draws stubs too;
  // see `drawnBy`. Recording that here rather than only in a commit message,
  // because a ceiling that falls is exactly what a gate being quietly relaxed
  // looks like, and the two are told apart by the reason and by nothing else.
  // The ten were real: a stub is a drawn difference, and it was one in
  // `quantum-linear-solve`, `matrix-function`, `hamiltonian-simulation`,
  // `state-preparation` and `qubit-routing`.
  //
  // **14 groups until session 118, and the group that went is a picture the map
  // stopped telling.** `backward-euler` and `trapezoidal-rule` were a group of
  // their own because they hung a `quantum-linear-solve` stub the other three
  // time-discretisations did not — and the owner ruled that stub off the map
  // (*"this is not how i want an iterator to be visualized"*). All five now draw
  // the same one hop, so the slot holds **one group of five** instead of a three
  // and a two. **`counted` did not move**, which is the point worth noticing: the
  // corpus gap is exactly the size it was, and the scoreboard has stopped
  // splitting it into two rows one of which was an artefact of the drawing.
  //
  // **The job is unchanged in kind.** 36 methods in 13 groups still draw a
  // sibling's picture with nothing declaring why, and the largest is still the
  // embedding group he named.
  // **41 since W21, and the raise needs its reason because a ceiling that rises is
  // exactly what a gate being abandoned looks like.**
  //
  // The five are two groups, both in the newly opened `ansatz-construction` slot:
  // three fixed families (`uccsd-ansatz`, `hardware-efficient-ansatz`,
  // `k-upccgsd-ansatz`) that each construct a circuit family in one step and have no
  // recorded interior, and the residual adaptive pair (`adapt-ansatz`, `qcc-ansatz`)
  // that each hang one `observable-estimation` stub. `qubit-adapt-ansatz` is dropped
  // by the `refines` rule above, as designed.
  //
  // **The structural point, which is worth more than the number: this ceiling is a
  // GLOBAL count, so it cannot tell a slot rotting from a region opening.** Every
  // method of a brand-new capability starts undecomposed — that is the honest state of
  // a slot nobody has taken apart yet, not a method "authored with no recorded interior
  // beside siblings that already had none". So under a global ceiling, opening any new
  // region is unconditionally a failure, and the only way past it is the raise this
  // comment is attached to. That makes the gate weaker every time it is used, which is
  // the opposite of what it is for.
  //
  // **The fix is a per-slot ceiling** — pin each slot's hollow count, let a new slot
  // declare its own, and then a rise anywhere is unambiguous rot. Not done here because
  // it changes a gate rather than the content this PR is about, and a gate rewritten in
  // the same change that first trips it is a gate nobody reviewed. Filed as the next
  // W10 item.
  //
  // **DONE — this is that per-slot ceiling (B5, session 134).** It is deliberately its
  // own change, landing BEFORE the W21-E region that first needs it, which is what the
  // paragraph above asked for: the gate and the content that trips it are reviewed
  // separately. `counted` stays printed above because the total is still the scoreboard
  // the owner asked for; what it no longer is, is the assertion.
  //
  // ## Why a census (`===`) and not a ceiling (`<=`)
  //
  // A ceiling per slot fixes the region-opening problem on its own. It does not fix the
  // other half: a slot whose hollow count FALLS leaves its ceiling standing above the
  // real number, and that slack is silent room for exactly the rot this gate exists to
  // catch. `time-discretization` at 5 with a ceiling of 5 is pinned; the same slot fixed
  // down to 3 with the ceiling still at 5 can take two new hollow methods without a word.
  // That is the `guard-stopped-guarding` shape, arriving by improvement rather than by
  // neglect, which is the hard kind to notice.
  //
  // So the table is an exact census and a fall fails too — with a message that says which
  // direction moved and hands over the line to write. The cost is real and worth naming:
  // any lane whose corpus work decomposes a method now edits one number in this file and
  // its diff records the win. That is the trade, taken deliberately.
  //
  // **The owner was asked to settle it, because it is a taste question about strictness
  // versus speed and it reverses in one line.** He was given both sides — exact means
  // nothing shrinks unnoticed at the cost of one extra edit on every legitimate map change;
  // a ceiling means fewer interruptions when several sessions edit the map at once, but a
  // number left too high hides real losses. He chose the exact census
  // (github.com/EshMis/ai-ops/issues/21, 2026-08-12). So the friction below is not an
  // agent's preference to be traded away by the next session that finds it inconvenient:
  // softening this back to `<=` needs him, not a rebase.
  //
  // **Absent from the table means zero.** A brand-new slot therefore cannot arrive
  // quietly — opening a region forces a line here, with the count and the reason, which
  // is the whole difference between "a region opened" and "a slot rotted" that the global
  // count could not express.
  assert.deepEqual(hollowCensusFailures(rows, HOLLOW_BY_SLOT), []);
  // And the groups he named by sight are the big ones, pinned so that "the owner's examples"
  // stays a checkable claim rather than a recollection.
  //
  // Summed, not `find`. One slot **may** hold more than one group — and `find`
  // would answer with whichever came first, which is a number that depends on
  // corpus order. `time-discretization` held a three and a two until session 118
  // and holds a five now; the sum is what this asks about either way, which is
  // why the consolidation did not have to be edited in here.
  const bySlot = (slot: string) => bySlotIn(rows, slot);
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

test("the per-slot census fails in all three directions, and says which one moved", () => {
  // Synthetic rows, because the point is to watch the gate FAIL, and the real graph is
  // (correctly) passing. The three directions are the whole reason the census replaced a
  // global ceiling, so each gets driven here rather than asserted about in a comment.
  const table: ReadonlyMap<string, number> = new Map([
    ["settled-slot", 2],
    ["fixed-slot", 3],
  ]);
  const row = (slot: string, n: number) => ({
    slot,
    ids: Array.from({ length: n }, (_, index) => `${slot}-${index}`),
  });

  // Agreement is silence. Without this the other three could pass by the function simply
  // always returning something.
  assert.deepEqual(
    hollowCensusFailures([row("settled-slot", 2), row("fixed-slot", 3)], table),
    [],
  );

  // 1. A declared slot ROSE — the original gate's job, kept.
  const rose = hollowCensusFailures([row("settled-slot", 3), row("fixed-slot", 3)], table);
  assert.equal(rose.length, 1);
  assert.match(rose[0]!, /^settled-slot: 3 methods draw a sibling's picture/);
  assert.match(rose[0]!, /was 2\./);
  assert.match(rose[0]!, /\["settled-slot", 3\]/);

  // 2. A declared slot FELL — the half a ceiling cannot see. The message asks for the win
  //    to be recorded, and a slot emptied entirely asks for its row to go rather than for
  //    a zero to be written, since absent already means zero.
  const fell = hollowCensusFailures([row("settled-slot", 2), row("fixed-slot", 2)], table);
  assert.equal(fell.length, 1);
  assert.match(fell[0]!, /^fixed-slot: 2, down from 3/);
  assert.match(fell[0]!, /\["fixed-slot", 2\]/);
  const emptied = hollowCensusFailures([row("settled-slot", 2)], table);
  assert.equal(emptied.length, 1);
  assert.match(emptied[0]!, /delete the "fixed-slot" row/);

  // 3. An UNDECLARED slot appeared — a new region opening, which under the old global
  //    ceiling was indistinguishable from rot and could only be answered by weakening the
  //    gate. Here it is answered by declaring the slot, and the message says so.
  const opened = hollowCensusFailures(
    [row("settled-slot", 2), row("fixed-slot", 3), row("brand-new-slot", 4)],
    table,
  );
  assert.equal(opened.length, 1);
  assert.match(opened[0]!, /^brand-new-slot: 4 methods/);
  assert.match(opened[0]!, /was 0\./);
  assert.match(opened[0]!, /region opening rather than rot, declare it: \["brand-new-slot", 4\]/);

  // And more than one disagreement is more than one message — a gate that reported only
  // the first would let the second land silently in the same change.
  assert.equal(
    hollowCensusFailures([row("settled-slot", 9), row("brand-new-slot", 4)], table).length,
    3,
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
  // `route` runs alpha -> gamma and its one step runs alpha -> beta, so the
  // step does not reach the exit and the method closes `beta -> gamma` itself.
  // That is the shape most authored routes are in, and it is the shape that has
  // an own stretch to annotate — see the fully-delegated fixture below, which
  // deliberately does not.
  const errors = (hops: Record<string, unknown>): string[] =>
    validateLayerGraph(
      {
        nodes: [
          capability("slot", { contract: contract("alpha", "gamma") }),
          capability("step-a"),
          method("route", "slot", {
            contract: contract("alpha", "gamma"),
            steps: ["step-a"],
            atomic: undefined,
            hops: hops as never,
          }),
          method("other", "slot", { contract: contract("alpha", "gamma") }),
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

  // --- `name`, the phrase the map draws where "the method itself" used to sit ---
  //
  // Authored on the own stretch with mathematics already on the record: the one
  // legal shape, checked first so the three refusals below are failing on their
  // own defect and not on the field being unusable.
  assert.deepEqual(
    errors({ route: { theory: "t", theoryJa: "t", name: "amplify the flagged branch", nameJa: "成功枝を増幅する" } }),
    [],
  );
  // The pair rule reaches it too. A phrase in one locale is half the readers
  // reading what the hop does and half still reading "the method itself".
  assert.deepEqual(errors({ route: { theory: "t", theoryJa: "t", name: "x" } }), [
    "route: hops[route].name is present in one locale only",
  ]);
  // **A delegated hop's name is its slot's label.** A second one here is one
  // fact with two writers, and the two drift — which is the failure this file
  // spends most of its length preventing.
  assert.deepEqual(errors({ "step-a": { theory: "t", theoryJa: "t", name: "x", nameJa: "x" } }), [
    "route: hops[step-a].name names a delegated hop, whose name is its slot's label",
  ]);
  // **And a phrase may not outrun its mathematics.** This is the gate that makes
  // the field safe to draw on the canvas: a five-word phrase is far cheaper to
  // invent than a paragraph with its assumptions marked and its paper in the
  // register, so the cheap field is only reachable behind the expensive one.
  assert.deepEqual(errors({ route: { name: "x", nameJa: "x" } }), [
    "route: hops[route].name is authored with no theory behind it — record the mathematics first",
  ]);

  // **And the own key needs an own stretch to exist at all.** A route whose
  // named steps already reach the exit closes nothing itself, so `ownStepCard`
  // returns null and no lane is drawn — a note here annotates a hop that is not
  // there. Caught by CodeRabbit on PR 725 against `name`; it was already true
  // of `theory`, so the check is on the key and covers both.
  const delegated = (hops: Record<string, unknown>): string[] =>
    validateLayerGraph(
      {
        nodes: [
          capability("slot"),
          capability("step-a"),
          method("route", "slot", { steps: ["step-a"], atomic: undefined, hops: hops as never }),
        ],
      },
      new Set<string>(),
      FIXTURE_STATES,
      NO_DISPOSITIONS,
    ).filter((error) => error.startsWith("route:"));
  // The step alone runs alpha -> beta, which is the whole contract.
  assert.deepEqual(delegated({ "step-a": { theory: "t", theoryJa: "t" } }), []);
  assert.deepEqual(delegated({ route: { theory: "t", theoryJa: "t" } }), [
    "route: hops names the method itself, but its steps reach the exit — there is no own stretch to annotate",
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
  assert.deepEqual(errors({ text: "t" }), [
    "route: example.text is present in one locale only",
    ...errors({ text: "t", textJa: "t" }),
  ]);
  assert.deepEqual(errors({ pseudocode: "  " }), [
    "route: example.pseudocode is present but empty — omit it instead",
  ]);
  assert.deepEqual(errors({}), ["route: example records nothing — omit it instead"]);
});

test("example prose has to name the run it describes, which is what makes a negative account unwritable", () => {
  // **The rule this replaces was a paragraph in a doc comment**, and it had already
  // produced the outcome it was written to prevent: twelve of the fifteen filled
  // examples said "the source reports no run", which reads as a claim about the method
  // rather than about one paper. The owner ruled the field runs-only
  // (github.com/EshMis/ai-ops/issues/19), and a ruling with no guard is one refactor
  // from gone — so the shape enforces it. A negative account has no paper reporting the
  // run, so it cannot supply `run`, so it cannot be written at all.
  const CITED = "https://arxiv.org/abs/1910.14596";
  const cite = { title: "T", authors: "A", year: "2019", url: CITED };
  const errors = (example: unknown): string[] =>
    validateLayerGraph(
      {
        nodes: [
          capability("slot"),
          method("route", "slot", { example: example as never, citations: [cite] as never }),
          method("b", "slot"),
        ],
      },
      new Set<string>(),
      FIXTURE_STATES,
      NO_DISPOSITIONS,
    ).filter((error) => error.startsWith("route:"));

  const run = { paper: CITED, at: "§4.3, Fig. 2", kind: "simulation" } as const;

  // Agreement is silence — without this, everything below could pass by the validator
  // simply always complaining.
  assert.deepEqual(errors({ text: "t", textJa: "t", run }), []);
  assert.deepEqual(errors({ text: "t", textJa: "t", run, pseudocode: "for k …" }), []);

  // 1. Prose with no run. The whole ruling, in one assertion.
  assert.deepEqual(errors({ text: "t", textJa: "t" }).map((e) => e.split(" — ")[0]), [
    "route: example.text without example.run",
  ]);

  // 2. A run with no prose is a citation describing nothing.
  assert.deepEqual(errors({ run, pseudocode: "for k …" }), [
    "route: example.run with no example.text — a citation describing nothing",
  ]);

  // 3. A whole paper is not a place. "It is in there somewhere" is the shape a negative
  //    account would take once it learned it needed a `run`.
  assert.deepEqual(errors({ text: "t", textJa: "t", run: { ...run, at: "  " } }), [
    `route: example.run names no place in ${CITED} — a whole paper is not a run`,
  ]);

  // 4. The paper has to be one the method already cites. A run sourced from somewhere
  //    the rest of the record has never heard of is a claim nothing else supports, and
  //    it would pass a plain "is this a url" check.
  assert.deepEqual(errors({ text: "t", textJa: "t", run: { ...run, paper: "https://arxiv.org/abs/0000.00000" } }), [
    "route: example.run cites https://arxiv.org/abs/0000.00000, which is not one of this method's citations",
  ]);
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

/**
 * The linear-ODE region's closed half stays closed.
 *
 * **A ratchet, not a pin.** Every assertion below is `>=`, so authoring more can
 * never fail it and dropping something always does. That asymmetry is the whole
 * design: the owner's ask was that this region be *"completely closed… so it can
 * be scaled"*, and a region that closes on Tuesday and quietly opens on
 * Wednesday was never closed — it was measured once.
 *
 * **Why it is asserted here and not left to `--closure`.** The gauge prints; it
 * does not fail. `check-layer-graph.mjs` runs in `lint` but its region report is
 * only computed when a caller names the slots, and nothing in CI names them. A
 * number nobody asserts is a number that moves.
 *
 * The two evidence-bound fields are deliberately **not** ratcheted. `example.text`
 * and `implementations` depend on what sources report, and a later editor who
 * correctly removes a worked example — because a closer read showed the paper's
 * numerics were not a run of this method after all — must not be fighting a
 * test. `regionClosure`'s `runEvidence` is where those two are watched, and it
 * watches the register rather than the prose.
 */
test("the linear-ODE region does not go backwards on the half that is closed", () => {
  const SLOTS = [
    "linear-ode-solve",
    "hamiltonian-recasting",
    "time-discretization",
    "quantum-linear-solve",
  ];
  const region = regionClosure(LAYER_GRAPH, STATE_VOCABULARY, SLOTS, new Map());
  // The region itself, so a slot renamed out from under this test fails loudly
  // rather than shrinking the thing being measured. `--closure` reports an
  // unrecognised id; here it must be an error.
  assert.deepEqual(region.unknown, [], "a slot id in this test names no capability");
  assert.ok(
    region.methods.length >= 19,
    `the region has ${region.methods.length} methods, fewer than the 19 it was closed over`,
  );
  const field = (name: string) => region.fields.find((entry) => entry.field === name)!;
  for (const name of ["summary", "conditions", "cost", "citations", "example.pseudocode"]) {
    const entry = field(name);
    assert.equal(
      entry.missing.length,
      0,
      `${name} is missing on ${entry.missing.join(", ")} — the region was closed on this field`,
    );
  }
  // Stretches, not methods: a method with one authored hop of five reads as
  // "has hops" on any per-method count, and that is exactly the region that
  // looks finished and is not.
  assert.equal(
    region.hopStretchesAuthored,
    region.hopStretches,
    `hop theory covers ${region.hopStretchesAuthored} of ${region.hopStretches} drawn route stretches — ` +
      `unauthored: ${region.unauthoredHops.map((hop) => `${hop.method}/${hop.key}`).join(", ")}`,
  );
  // A floor under the denominator too. Without it, deleting a route would make
  // the equality above pass on a smaller region — the same "measure less, look
  // healthier" failure `unknown` guards at the slot level.
  assert.ok(
    region.hopStretches >= 45,
    `${region.hopStretches} drawn stretches, fewer than the 45 the region was closed over`,
  );
});


/**
 * The reader-facing modules that may render a declared absence.
 *
 * A source scan rather than a render assertion, deliberately: jsdom does no
 * layout, and these are two different surfaces in two different files, so the
 * honest form of the question is "does any reader-facing module read this key".
 * It is a floor — a key can be read and still be rendered wrongly — but it is
 * the floor that was missing.
 */
function absenceSurfaces(): string {
  const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  return [
    join(webRoot, "lib", "repository", "card-content.ts"),
    join(webRoot, "components", "repository-layers.tsx"),
    join(webRoot, "components", "map-card-panel.tsx"),
  ]
    .map((file) => withoutComments(readFileSync(file, "utf8")))
    .join("\n");
}

/**
 * Source with `//` and block comments removed.
 *
 * Without this the guards below are the very bug they exist to catch: a surface
 * that stops rendering a declared reason but keeps the comment explaining why it
 * used to still counts as rendering it, and this PR's own fix adds exactly such
 * comments. Raised by Sourcery on leona 748.
 *
 * Crude on purpose — it does not parse strings, so a `//` inside a string
 * literal truncates that line. That is safe HERE and only here: the guards ask
 * whether a call expression appears, and losing the tail of a string literal
 * cannot manufacture one. It must not be reused as a general comment stripper.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

const absenceIsRendered = (source: string, field: string) =>
  source.includes(`absenceOf(method, "${field}"`) || source.includes(`absenceOf(node, "${field}"`);

/**
 * Declarable keys that no surface renders yet, and which nothing has declared.
 *
 * NOT a permanent exemption — it is the list the test below refuses to let grow,
 * and the list the test above it refuses to let anyone *use*. Wiring one of
 * these up is a one-line deletion here.
 */
const ABSENCE_KEYS_NOT_WIRED_UP = ["cost", "conditions", "example.pseudocode"];

test("no absence anyone has actually declared is rendered by nothing", () => {
  // The check that fires at the moment it matters: an author writes a reason,
  // and it reaches a reader. Data-driven off the authored graph, because the
  // failure is a *declared* key nothing reads — a declarable one nobody has used
  // harms no reader yet.
  //
  // That is not hypothetical. `implementations` was read by `card-content.ts`
  // and NOT by `components/repository-layers.tsx`, so for all three methods that
  // declare one the map card drew the researched sentence and the method page
  // drew `implementationsNone` — *"Nobody has written one up yet. That is a gap
  // in this record"* — the precise opposite of a record saying the cited sources
  // report none. Measured on production 2026-08-24 on `backward-euler`,
  // `trapezoidal-rule` and `chebyshev-pseudospectral-collocation`, all three the
  // same way round. An omission on one surface is a gap; two surfaces
  // disagreeing tells the reader the Atlas does not know what it says.
  //
  // **What this one does NOT catch, stated so it is not over-trusted:** it asks
  // whether ANY surface reads the key, so it stays green while one of two does —
  // which is exactly the state that shipped. Reverting the method-page fix leaves
  // this test passing. The test below it is the one that fails, and it is the one
  // that holds the two surfaces together.
  const source = absenceSurfaces();
  const declared = new Set(
    LAYER_GRAPH.nodes.flatMap((node) => Object.keys((node as { absences?: object }).absences ?? {})),
  );
  assert.ok(declared.size > 0, "no absence is declared anywhere — this test is asserting nothing");

  const unrendered = [...declared].filter((field) => !absenceIsRendered(source, field)).sort();
  assert.deepEqual(
    unrendered,
    [],
    `declared on the graph and rendered by no surface: ${unrendered.join(", ")}`,
  );
});

test("the set of declarable-but-unrendered absence keys does not grow", () => {
  // The other half. A sixth key added to DECLARABLE_ABSENCES and wired to
  // nothing is the same bug one step earlier — the validator would accept it,
  // the gauge would count the field closed, and the first author to use it would
  // ship research no reader meets. This fails on that addition rather than on
  // its first use.
  const source = absenceSurfaces();
  const unwired = DECLARABLE_ABSENCES.filter((field) => !absenceIsRendered(source, field)).sort();
  assert.deepEqual(
    unwired,
    [...ABSENCE_KEYS_NOT_WIRED_UP].sort(),
    "a declarable absence key is rendered by nothing — wire it to a surface, or add it to ABSENCE_KEYS_NOT_WIRED_UP with a reason",
  );
});

test("the two surfaces agree about a declared implementations absence", () => {
  // The specific contradiction the check above generalises. Both files must read
  // the key, and the method page must prefer it over its generic note — asserted
  // by ORDER, because a branch that renders the generic note first and the reason
  // never is exactly what shipped.
  const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  // Comments stripped here too — this PR's own fix adds a comment naming the
  // very call it must assert, so a raw scan would pass on the comment alone.
  const page = withoutComments(
    readFileSync(join(webRoot, "components", "repository-layers.tsx"), "utf8"),
  );
  const card = withoutComments(
    readFileSync(join(webRoot, "lib", "repository", "card-content.ts"), "utf8"),
  );

  assert.ok(
    card.includes('absenceOf(method, "implementations"'),
    "card-content.ts stopped reading the implementations absence",
  );
  const reasonAt = page.indexOf('absenceOf(node, "implementations"');
  const genericAt = page.indexOf("copy.implementationsNone");
  assert.ok(reasonAt >= 0, "the method page does not read the implementations absence");
  assert.ok(genericAt >= 0, "the method page's generic implementations note is gone");
  assert.ok(
    reasonAt < genericAt,
    "the method page falls back to its generic note before checking for a declared reason",
  );
});
