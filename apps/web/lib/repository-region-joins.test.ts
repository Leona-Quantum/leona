// Where one region hands work to another, and the declaration that keeps the
// answer from going stale.
//
// Fixtures first, then the real graph. The fixtures exist because the authored
// graph exercises each supply class only in one arrangement, and because the
// audit's three failure directions — undeclared, stale, misclassified — are all
// states the repository is required never to be in, so none of them can be
// reached from real data. `scripts/check-region-joins.mjs` runs the same
// functions over the real graph and prints the census.
import assert from "node:assert/strict";
import test from "node:test";

import type { LayerGraph } from "./repository/layers.ts";
import type { StateVocabulary } from "./repository/states.ts";
import {
  DECLARED_SLOT_ENTRIES,
  auditSlotEntries,
  joinSurface,
  joinWorklist,
  producedStates,
  regionsOf,
  slotEntries,
} from "./repository/region-joins.ts";
import { layerAdjacency, walkableAdjacency } from "./repository/paper-traces.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { STATE_VOCABULARY } from "./repository/state-vocabulary.ts";

const prose = { takes: "x", takesJa: "x", returns: "y", returnsJa: "y" };

const capability = (id: string, from: string, to: string) =>
  ({
    kind: "capability",
    id,
    label: id,
    labelJa: id,
    summary: "s",
    summaryJa: "s",
    contract: { from, to, ...prose },
    whyALayer: "w",
    whyALayerJa: "w",
  }) as const;

const method = (
  id: string,
  realizes: string,
  extra: Record<string, unknown> = {},
) =>
  ({
    kind: "method",
    id,
    label: id,
    labelJa: id,
    summary: "s",
    summaryJa: "s",
    steps: [],
    ...extra,
    realizes,
  }) as const;

const vocabulary = (
  ...states: (string | [string, string[]])[]
): StateVocabulary => ({
  states: states.map((state) => {
    const [id, specializes] = typeof state === "string" ? [state, undefined] : state;
    return {
      id,
      label: id,
      labelJa: id,
      summary: "s",
      summaryJa: "s",
      ...(specializes ? { specializes } : {}),
    };
  }),
});

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

test("a region is a connected component under realizes, steps and refines", () => {
  const graph = {
    nodes: [
      capability("alpha", "a", "b"),
      method("alpha-one", "alpha"),
      method("alpha-two", "alpha"),
      capability("beta", "c", "d"),
      method("beta-one", "beta"),
    ],
  } as unknown as LayerGraph;

  const regions = regionsOf(graph);
  assert.equal(regions.length, 2);
  assert.deepEqual(regions[0].nodes, ["alpha", "alpha-one", "alpha-two"]);
  assert.deepEqual(regions[0].capabilities, ["alpha"]);
  assert.deepEqual(regions[1].nodes, ["beta", "beta-one"]);
});

test("regions are numbered largest first, so the numbering does not depend on walk order", () => {
  const graph = {
    nodes: [
      capability("small", "a", "b"),
      method("small-one", "small"),
      capability("big", "c", "d"),
      method("big-one", "big"),
      method("big-two", "big"),
      method("big-three", "big"),
    ],
  } as unknown as LayerGraph;

  const regions = regionsOf(graph);
  assert.equal(regions[0].nodes.length, 4);
  assert.deepEqual(regions[0].capabilities, ["big"]);
  assert.equal(regions[1].nodes.length, 2);
});

// ---------------------------------------------------------------------------
// What the graph produces
// ---------------------------------------------------------------------------

test("a `through` landing counts as produced, even when no contract names the state", () => {
  // The `leona-every-state-is-reachable` case: `runnable-evolution` is named by
  // no contract at all and is reached only through a narrowing. Reading
  // contracts alone reports it as produced by nothing, which is how a state that
  // IS reachable gets written off as dead.
  const graph = {
    nodes: [
      capability("wide", "in", "broad"),
      method("narrows", "wide", { steps: ["wide"], through: { wide: "narrow" } }),
    ],
  } as unknown as LayerGraph;

  const produced = producedStates(graph);
  assert.ok(produced.has("broad"));
  assert.ok(produced.has("narrow"), "a narrowing's landing is produced");
});

// ---------------------------------------------------------------------------
// The supply classification
// ---------------------------------------------------------------------------

test("a slot whose entry a narrower produced state satisfies is joined, not open", () => {
  // Direction is the whole check: `narrow` satisfies `broad`, so a process
  // producing the narrow thing supplies a slot asking for the broad one.
  const vocab = vocabulary("start", ["narrow", ["broad"]], "broad", "end");
  const graph = {
    nodes: [
      capability("makes", "start", "narrow"),
      method("makes-one", "makes"),
      capability("takes", "broad", "end"),
      method("takes-one", "takes"),
    ],
  } as unknown as LayerGraph;

  const entries = slotEntries(graph, vocab);
  const takes = entries.find((entry) => entry.slot === "takes")!;
  assert.equal(takes.supply, "joined");
  assert.deepEqual(takes.suppliers, ["narrow"]);
});

test("producing something broader than a slot requires does not supply it", () => {
  // The asymmetry `stateSatisfies` exists for. A general linear generator is not
  // a Hamiltonian, and a slot fed one has an unrecorded conversion in front of it.
  const vocab = vocabulary("start", ["narrow", ["broad"]], "broad", "end");
  const graph = {
    nodes: [
      capability("makes", "start", "broad"),
      method("makes-one", "makes"),
      capability("takes", "narrow", "end"),
      method("takes-one", "takes"),
    ],
  } as unknown as LayerGraph;

  const takes = slotEntries(graph, vocab).find((entry) => entry.slot === "takes")!;
  assert.notEqual(takes.supply, "joined");
  assert.deepEqual(takes.suppliers, []);
});

test("a slot nothing steps into is a front door", () => {
  const vocab = vocabulary("a", "b");
  const graph = {
    nodes: [capability("door", "a", "b"), method("door-one", "door")],
  } as unknown as LayerGraph;

  const door = slotEntries(graph, vocab).find((entry) => entry.slot === "door")!;
  assert.equal(door.supply, "front-door");
  assert.equal(door.root, true);
});

test("a slot the reader can enter holding is root-supplied, however its output is used", () => {
  const vocab = vocabulary("a", "b", "c");
  const graph = {
    nodes: [
      capability("door", "a", "c"),
      method("door-one", "door", { steps: ["inner"] }),
      method("door-two", "door"),
      capability("inner", "a", "b"),
      method("inner-one", "inner"),
    ],
  } as unknown as LayerGraph;

  const inner = slotEntries(graph, vocab).find((entry) => entry.slot === "inner")!;
  assert.equal(inner.supply, "root-supplied");
  assert.equal(inner.root, false);
});

test("ingredient is decided by the spine, not by whether anything ever feeds it", () => {
  // The case that would have made the whole gate vacuous. `walked` is filed as a
  // feed once AND walked on a spine; reading "is a feed anywhere" as ingredient
  // classifies it as one and leaves nothing to find. Only `stub`, which no route
  // advances through, is an ingredient.
  const vocab = vocabulary("a", "b", "c", "d");
  const graph = {
    nodes: [
      capability("top", "a", "c"),
      method("top-one", "top", { steps: ["walked", "stub"] }),
      method("top-two", "top"),
      capability("walked", "a", "b"),
      method("walked-one", "walked"),
      capability("stub", "d", "d2"),
      method("stub-one", "stub"),
    ],
  } as unknown as LayerGraph;

  const entries = slotEntries({ ...graph, nodes: graph.nodes } as LayerGraph, {
    states: [...vocab.states, { id: "d2", label: "d2", labelJa: "d2", summary: "s", summaryJa: "s" }],
  });
  const stub = entries.find((entry) => entry.slot === "stub")!;
  assert.equal(stub.onSpine, 0, "nothing advances through it");
  assert.equal(stub.supply, "ingredient");
});

test("a step nothing can supply is never walked on a spine — the reason there is no fifth class", () => {
  // A fifth class, `orphan` — walked on a spine and suppliable by nothing — was
  // written and removed. This is the argument, as a test rather than a comment:
  // `routeOf` advances through a step only when what the route holds satisfies
  // it, so an unsuppliable step is filed as a feed and `onSpine` stays 0. The
  // classification is total in four classes, and a branch nothing can reach
  // would have read as coverage the checker does not have.
  const vocab = vocabulary("door", "unreachable", "mid", "end");
  const graph = {
    nodes: [
      capability("top", "door", "end"),
      method("top-one", "top", { steps: ["lost"] }),
      method("top-two", "top"),
      capability("lost", "unreachable", "mid"),
      method("lost-one", "lost"),
    ],
  } as unknown as LayerGraph;

  const lost = slotEntries(graph, vocab).find((entry) => entry.slot === "lost")!;
  assert.deepEqual(lost.suppliers, [], "nothing produces what it consumes");
  assert.equal(lost.onSpine, 0, "and so no route advances through it");
  assert.equal(lost.asFeed, 1, "it is filed as an ingredient instead");
  assert.equal(lost.supply, "ingredient");
});

// ---------------------------------------------------------------------------
// The join surface
// ---------------------------------------------------------------------------

test("a shared state asserts every arrival against every departure, and the split is by region", () => {
  const vocab = vocabulary("a", "shared", "z");
  const graph = {
    nodes: [
      capability("makes", "a", "shared"),
      method("makes-one", "makes"),
      method("makes-two", "makes"),
      // A second region: nothing joins it to `makes` by realizes/steps/refines,
      // and the two are connected only by both naming `shared`.
      capability("takes", "shared", "z"),
      method("takes-one", "takes"),
      method("takes-two", "takes"),
      method("takes-three", "takes"),
    ],
  } as unknown as LayerGraph;

  assert.equal(regionsOf(graph).length, 2, "the containment edges do not join them");
  const surface = joinSurface(graph, vocab);
  assert.equal(surface.crosses, 6, "2 arrivals × 3 departures, all of them crossing");
  assert.equal(surface.within, 0);
  const shared = surface.states.find((state) => state.state === "shared")!;
  assert.equal(shared.asserted, 6);
  assert.equal(shared.arrivals, 2);
  assert.equal(shared.departures, 3);
});

test("compositions inside one region are counted and are not crossings", () => {
  const vocab = vocabulary("a", "shared", "z");
  const graph = {
    nodes: [
      capability("top", "a", "z"),
      method("top-one", "top", { steps: ["makes", "takes"] }),
      method("top-two", "top"),
      capability("makes", "a", "shared"),
      method("makes-one", "makes"),
      capability("takes", "shared", "z"),
      method("takes-one", "takes"),
    ],
  } as unknown as LayerGraph;

  assert.equal(regionsOf(graph).length, 1);
  assert.equal(joinSurface(graph, vocab).crosses, 0);
  assert.ok(joinSurface(graph, vocab).within > 0);
});

// ---------------------------------------------------------------------------
// The audit, in all three directions
// ---------------------------------------------------------------------------

const openEntry = (slot: string, supply: "front-door" | "ingredient" | "root-supplied") =>
  ({ slot, from: "x", region: 1, suppliers: [], supply, onSpine: 0, asFeed: 0, root: true }) as const;

test("a slot with an unproduced entry and no row is reported", () => {
  const audit = auditSlotEntries([openEntry("lonely", "front-door")], {});
  assert.equal(audit.undeclared.length, 1);
  assert.equal(audit.undeclared[0].slot, "lonely");
  assert.deepEqual(audit.stale, []);
  assert.deepEqual(audit.misclassified, []);
});

test("a row clears the slot only when it carries a reason", () => {
  for (const reason of ["", "   "]) {
    const audit = auditSlotEntries([openEntry("lonely", "front-door")], {
      lonely: { supply: "front-door", intent: "settled", reason },
    });
    assert.equal(audit.undeclared.length, 1, `an empty reason is not a declaration: ${JSON.stringify(reason)}`);
  }
  const cleared = auditSlotEntries([openEntry("lonely", "front-door")], {
    lonely: { supply: "front-door", intent: "settled", reason: "because" },
  });
  assert.deepEqual(cleared.undeclared, []);
});

test("a row for a slot that has since gained a supplier fails as stale", () => {
  const audit = auditSlotEntries([], { gone: { supply: "front-door", intent: "settled", reason: "why" } });
  assert.deepEqual(audit.stale, ["gone"]);
});

test("a row whose supply no longer matches the graph fails as misclassified", () => {
  // The direction that catches a join made by accident: one `specializes` line
  // can re-type every contract naming the parent, and the slot's class moves
  // without anybody editing the slot.
  const audit = auditSlotEntries([openEntry("moved", "ingredient")], {
    moved: { supply: "front-door", intent: "settled", reason: "why" },
  });
  assert.equal(audit.misclassified.length, 1);
  assert.deepEqual(audit.misclassified[0], {
    slot: "moved",
    declared: "front-door",
    actual: "ingredient",
  });
});

test("the worklist is the rows a human marked, not a shape the graph can see", () => {
  const entries = [openEntry("settled-one", "front-door"), openEntry("wanted-one", "ingredient")];
  const worklist = joinWorklist(entries, {
    "settled-one": { supply: "front-door", intent: "settled", reason: "the front door" },
    "wanted-one": { supply: "ingredient", intent: "join-wanted", reason: "nothing feeds it" },
  });
  assert.deepEqual(
    worklist.map((entry) => entry.slot),
    ["wanted-one"],
  );
});

// ---------------------------------------------------------------------------
// The authored graph
// ---------------------------------------------------------------------------

test("the authored graph's slot entries are all declared, and no row has gone stale", () => {
  const audit = auditSlotEntries(slotEntries(LAYER_GRAPH, STATE_VOCABULARY), DECLARED_SLOT_ENTRIES);
  assert.deepEqual(audit.undeclared.map((entry) => entry.slot), []);
  assert.deepEqual(audit.stale, []);
  assert.deepEqual(audit.misclassified, []);
});

test("the map is three regions, and ten of its twenty-three slots consume something nothing produces", () => {
  const regions = regionsOf(LAYER_GRAPH);
  // **[104, 13, 5] since session 15's anchoring pass, and the SHAPE did not change** —
  // which is the thing this assertion is actually watching. Five new methods landed,
  // all five inside the algorithms region, so region 1 grew and the other two did not
  // move. Nothing joined and nothing split: there are still three regions, compilation
  // is still reached only from the algorithms side, and error mitigation is still
  // reached by nothing. A region count that stayed at three while a region grew by five
  // is the honest reading — new methods on existing slots cannot join anything, because
  // joining is a property of states and these introduced none.
  assert.deepEqual(
    regions.map((region) => region.nodes.length),
    [104, 13, 5],
    "the region shape changed; re-read what joined or split before updating this",
  );

  const entries = slotEntries(LAYER_GRAPH, STATE_VOCABULARY);
  assert.equal(entries.length, 23);
  const open = entries.filter((entry) => entry.supply !== "joined");
  assert.equal(open.length, 10);

  const bySupply = (supply: string) => open.filter((entry) => entry.supply === supply).length;
  assert.equal(bySupply("front-door"), 3);
  assert.equal(bySupply("root-supplied"), 2);
  assert.equal(bySupply("ingredient"), 5);
  assert.equal(bySupply("joined"), 0, "by construction — `open` already excludes them");
});

test("the cross-region join surface is 119 compositions at three states", () => {
  // **The figure this file exists to pin.** A join's blast radius is a product,
  // and the commonest way to move it is one `specializes` line in
  // `state-vocabulary.ts` — which changes no contract, touches no node, and
  // re-types every slot naming the parent. Nothing else would notice.
  //
  // Measured 2026-08-13 at commit 45395f9e: 491 method-to-method compositions on
  // the join surface, 386 of them inside one region and 105 across one. All 105
  // land on the same seven compilation methods, which is what "connect the
  // compilation region" is worth today.
  //
  // **552 / 119 since session 15's anchoring pass, and the delta is arithmetic rather
  // than a new join.** Two of the five new methods — `generalized-excitation-ansatz`
  // and `batched-adapt-ansatz` — realize `ansatz-construction`, whose exit is
  // `parameterized-circuit`. That state's crossings are a PRODUCT: arrivals times the
  // seven compilation departures. Arrivals went 11 -> 13, so 11x7 = 77 became 13x7 =
  // 91, and the total moved 105 -> 119 with the other two states untouched. This is
  // exactly the blast radius the comment above warns about, arriving from the
  // direction it did not name: not a `specializes` line, but two ordinary methods on
  // an existing slot. **Adding one method to a slot whose exit already crosses a
  // region costs seven crossings, not one** — worth knowing before authoring on
  // `ansatz-construction` again, and the reason a per-state breakdown is pinned
  // beside the total rather than the total alone.
  const surface = joinSurface(LAYER_GRAPH, STATE_VOCABULARY);
  assert.equal(surface.within + surface.crosses, 552);
  assert.equal(surface.crosses, 119, "the cross-region surface moved — say why in the PR");

  const crossing = surface.states.filter((state) => state.crosses > 0);
  assert.deepEqual(
    crossing.map((state) => [state.state, state.crosses]),
    [
      ["parameterized-circuit", 91],
      ["evolution-circuit", 21],
      ["runnable-evolution", 7],
    ],
  );
});

test("every crossing on the authored graph leaves the algorithms region for compilation", () => {
  // Not a coincidence worth leaving unstated: the map has three regions and only
  // one of the two joins exists. Error mitigation is reached by nothing, which
  // is the finding ai-ops#64 is about, and this asserts it rather than trusting
  // a sentence in a session note.
  const regions = regionsOf(LAYER_GRAPH);
  const region = new Map<string, number>();
  for (const one of regions) for (const id of one.nodes) region.set(id, one.index);

  const surface = joinSurface(LAYER_GRAPH, STATE_VOCABULARY);
  const crossings = surface.crossings.filter((crossing) => crossing.crosses);
  assert.equal(crossings.length, 119);
  for (const crossing of crossings) {
    assert.equal(region.get(crossing.arrival), 1, `${crossing.arrival} leaves region 1`);
    assert.equal(region.get(crossing.departure), 2, `${crossing.departure} arrives in region 2`);
  }
  assert.equal(
    new Set(crossings.map((crossing) => crossing.departure)).size,
    7,
    "all 119 land on the same seven compilation methods",
  );
});

test("three slots want a join nobody has recorded, and they are the ones ai-ops#64 names", () => {
  const worklist = joinWorklist(slotEntries(LAYER_GRAPH, STATE_VOCABULARY), DECLARED_SLOT_ENTRIES);
  assert.deepEqual(
    worklist.map((entry) => entry.slot).sort(),
    ["error-correction", "error-mitigation", "ground-state-energy"],
  );
  // Each carries a real sentence, not a placeholder — the same bar
  // `check-repository-data.mjs` holds a knownGap detail to.
  for (const entry of worklist) {
    assert.ok(DECLARED_SLOT_ENTRIES[entry.slot].reason.length > 80);
  }
});

test("the map is three regions under containment and two under what a trace walks", () => {
  // ADR-0027's split, asserted on the real graph so it cannot quietly become
  // one relation again. `regionsOf` must stay on containment: if it adopted the
  // walkable set, compilation and algorithms would be one region and the 105
  // crossings above would count themselves away.
  //
  // Measured 2026-08-13: the state relation contributes 23 undirected
  // capability edges and merges the 99-node algorithms region with the 13-node
  // compilation one. Error mitigation stays out, because nothing produces
  // `noisy-estimate` — which is the finding, not a limitation of the walk.
  const componentsUnder = (adjacency: ReadonlyMap<string, ReadonlySet<string>>) => {
    const seen = new Set<string>();
    const sizes: number[] = [];
    for (const node of LAYER_GRAPH.nodes) {
      if (seen.has(node.id)) continue;
      let size = 0;
      const queue = [node.id];
      seen.add(node.id);
      while (queue.length > 0) {
        const here = queue.shift()!;
        size += 1;
        for (const neighbour of adjacency.get(here) ?? []) {
          if (seen.has(neighbour)) continue;
          seen.add(neighbour);
          queue.push(neighbour);
        }
      }
      sizes.push(size);
    }
    return sizes.sort((a, b) => b - a);
  };

  assert.deepEqual(componentsUnder(layerAdjacency(LAYER_GRAPH)), [104, 13, 5]);
  // [117, 5] since session 15's five new methods, and the point ADR-0027 is making
  // survives the change intact: the merged component grew by exactly the five that
  // landed in the algorithms region (99 + 13 = 112 became 104 + 13 = 117), while error
  // mitigation stayed at 5 under BOTH relations. Adding methods moves the sizes and
  // never the split, which is what makes these two numbers worth asserting side by
  // side — the day one of them changes shape rather than size, something joined.
  assert.deepEqual(componentsUnder(walkableAdjacency(LAYER_GRAPH, STATE_VOCABULARY)), [117, 5]);
});
