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

test("the map is eight regions, and seventeen of its thirty slots consume something nothing produces", () => {
  const regions = regionsOf(LAYER_GRAPH);
  assert.deepEqual(
    regions.map((region) => region.nodes.length),
    // **[110, 13, 5, 4, 3, 3, 3, 3] — eight regions, and the last four arrived from
    // three different lanes that never met.** The two 3s at indices 5 and 6 are the PDE
    // discretization slots (ai-ops#64); the 3 at index 7 is `device-characterization`
    // (ai-ops#68). Ties here break on graph order, not on arrival order, so the
    // device-characterisation region sorts LAST despite its nodes being authored
    // above the number-theory block — which is why the region-pair assertion further
    // down still reads 5 and 6 and did not have to be renumbered.
    //
    // **W28's search region is the odd one, and it split across two entries rather
    // than adding one.** `quantum-walk-search` and its two methods went INTO the 107,
    // taking it to 110, because `backtracking-tree-walk-search` descends into
    // `phase-estimation` — a containment edge the paper's own algorithm supplies, not a
    // join anybody designed. `marked-item-search` and its two atomic methods are the
    // new 3 at index 8. So one region arrived joined and one arrived standing alone,
    // and the two halves share an exit state that this relation cannot see.
    [110, 13, 5, 4, 3, 3, 3, 3],
    "the region shape changed; re-read what joined or split before updating this",
  );

  const entries = slotEntries(LAYER_GRAPH, STATE_VOCABULARY);
  assert.equal(entries.length, 30);
  const open = entries.filter((entry) => entry.supply !== "joined");
  // 15 -> 17: both W28 slots are front doors. Neither is joined, and that is not a
  // failure of the region — a marking oracle is the problem stated rather than a thing
  // computed, the same reading `hidden-period-finding` carries. The search graph is the
  // one of the two that genuinely wants a producer; see its row in DECLARED_SLOT_ENTRIES
  // and the join worklist below.
  assert.equal(open.length, 17);

  const bySupply = (supply: string) => open.filter((entry) => entry.supply === supply).length;
  // **`root-supplied` moves 2 -> 3 without anyone editing `error-correction`.** Unit 4's
  // `device-characterization` is a root that also consumes `physical-qubits`, so that
  // state is now entered at a root and every slot naming it re-types. A disposition
  // changing on a slot the commit never touched is the join model earning its place.
  //
  // The three dispositions move for three unrelated reasons and it is worth keeping
  // them apart: `front-door` 4 -> 6 from the two PDE slots (ai-ops#64) and -> 7 from
  // `device-characterization` (ai-ops#68); `root-supplied` 2 -> 3 from the re-type
  // above; `ingredient` 6 -> 5 because `error-correction` LEFT this class rather than
  // because anything stopped being a feed. A total that moved by two while three
  // sub-counts moved is the reason they are asserted separately.
  // W28 moves `front-door` 7 -> 9 and touches neither of the other two: both new slots
  // are entered directly, and no existing slot re-typed, because `marking-oracle`,
  // `marked-item` and `search-graph-with-marked-set` are all new names nothing else
  // consumes.
  assert.equal(bySupply("front-door"), 9);
  assert.equal(bySupply("root-supplied"), 3);
  assert.equal(bySupply("ingredient"), 5);
  assert.equal(bySupply("joined"), 0, "by construction — `open` already excludes them");
});

test("the cross-region join surface is 105 compositions at three states", () => {
  // **The figure this file exists to pin.** A join's blast radius is a product,
  // and the commonest way to move it is one `specializes` line in
  // `state-vocabulary.ts` — which changes no contract, touches no node, and
  // re-types every slot naming the parent. Nothing else would notice.
  //
  // Measured 2026-08-13 at commit 45395f9e: 491 method-to-method compositions on
  // the join surface, 386 of them inside one region and 105 across one. All 105
  // land on the same seven compilation methods, which is what "connect the
  // compilation region" is worth today.
  const surface = joinSurface(LAYER_GRAPH, STATE_VOCABULARY);
  assert.equal(surface.within + surface.crosses, 611);
  assert.equal(surface.crosses, 178, "the cross-region surface moved — say why in the PR");

  const crossing = surface.states.filter((state) => state.crosses > 0);
  assert.deepEqual(
    crossing.map((state) => [state.state, state.crosses]),
    [
      ["parameterized-circuit", 91],
      ["hermitian-generator", 24],
      ["evolution-circuit", 21],
      ["linear-system", 18],
      ["linear-ivp", 17],
      ["runnable-evolution", 7],
    ],
  );
});

test("every crossing runs between three pairs of regions, and each pair is a different kind of join", () => {
  // **This test asserted "every crossing leaves the algorithms region for
  // compilation" until the PDE slots arrived, and that sentence is now false.**
  // It is rewritten rather than renumbered, because the claim changed and not
  // just the count: there were three regions and one join, and there are now
  // five regions and three joins of two different provenances.
  //
  // - 1 → 2 was **found**, not built: 105 crossings that were already true in
  //   the data through `abstract-circuit`, drawn by nothing until majorana PR 511.
  // - 4 → 1 and 5 → 1 were **built**, from three papers that pay measured cost
  //   for spatial discretisation. They are the first cross-region joins on this
  //   map authored deliberately rather than discovered, which is what ai-ops#64
  //   asked for, and their regions are separate for a structural reason worth
  //   keeping visible: nothing steps into them and they step into nothing, so
  //   containment isolates them and only a shared state connects them at all.
  const regions = regionsOf(LAYER_GRAPH);
  const region = new Map<string, number>();
  for (const one of regions) for (const id of one.nodes) region.set(id, one.index);

  const surface = joinSurface(LAYER_GRAPH, STATE_VOCABULARY);
  const crossings = surface.crossings.filter((crossing) => crossing.crosses);
  assert.equal(crossings.length, 178);

  const pairs = new Set(
    crossings.map((crossing) => `${region.get(crossing.arrival)}->${region.get(crossing.departure)}`),
  );
  assert.deepEqual([...pairs].sort(), ["1->2", "5->1", "6->1"]);

  // 105 when it was found, 119 now — and the 14 it gained came from neither this
  // lane nor a specializes line, but from two ordinary ansatz methods landing on
  // a slot whose exit already crossed. A crossing count is a PRODUCT, so a method
  // on such a slot costs one crossing per method on the other side, not one.
  const toCompilation = crossings.filter((crossing) => region.get(crossing.departure) === 2);
  assert.equal(toCompilation.length, 119, "the found join, grown by other lanes rather than by this one");
  assert.equal(
    new Set(toCompilation.map((crossing) => crossing.departure)).size,
    7,
    "all 105 still land on the same seven compilation methods",
  );
});

test("four slots want a join nobody has recorded, and three of the four are the ones ai-ops#64 names", () => {
  // The fourth arrived with the search region and is a different KIND of want, which
  // is why it is worth the rename rather than a bumped number. ai-ops#64's three are
  // slots the map cannot be entered at sensibly — a reader with a Hamiltonian cannot
  // reach VQE, a reader with a device cannot reach error correction. `quantum-walk-search`
  // can be entered: its two methods each build their own graph out of something the
  // reader already has. What is missing is that the CONSTRUCTION is a process the map
  // does not draw. Montanaro's is the sharp case — his tree is the one a classical
  // backtracking algorithm would have explored, so the absent producer is a step from a
  // constraint satisfaction problem to the search graph its own solver implies.
  //
  // Left open rather than invented, per this file's own standing rule: the honest
  // producer is a slot with two competing methods, and nobody has read the papers for
  // either of them.
  const worklist = joinWorklist(slotEntries(LAYER_GRAPH, STATE_VOCABULARY), DECLARED_SLOT_ENTRIES);
  assert.deepEqual(
    worklist.map((entry) => entry.slot).sort(),
    ["error-correction", "error-mitigation", "ground-state-energy", "quantum-walk-search"],
  );
  // Each carries a real sentence, not a placeholder — the same bar
  // `check-repository-data.mjs` holds a knownGap detail to.
  for (const entry of worklist) {
    assert.ok(DECLARED_SLOT_ENTRIES[entry.slot].reason.length > 80);
  }
});

test("the map is eight regions under containment and five under what a trace walks", () => {
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

  // 107 -> 110 and a new 3, on the search region landing (W28). The two are not
  // symmetric and the asymmetry is the whole content of this line: `quantum-walk-search`
  // MERGED into the algorithms component rather than standing beside it, because
  // `backtracking-tree-walk-search` descends into `phase-estimation` — a containment
  // edge, so the walk relation is not what carried it. `marked-item-search` is the new
  // 3: both its methods are atomic, so nothing contains and nothing is contained.
  //
  // That is the first time a region has arrived already joined under containment, and
  // it was not designed — the paper's detector IS phase estimation on its own walk
  // operator, and the edge fell out of reading it.
  assert.deepEqual(componentsUnder(layerAdjacency(LAYER_GRAPH)), [110, 13, 5, 4, 3, 3, 3, 3]);
  // **[126, 5, 4, 3], and the two lanes that landed here behave OPPOSITELY under the
  // walk — which is the distinction these two lines exist to make visible.** The PDE
  // regions are separate under containment and merge into the 126 under the walk:
  // nothing steps into them, but the states they produce are consumed, so a trace
  // does cross where containment says there is no edge. `device-characterization`
  // merges under neither. It produces `device-figure`, which by construction no slot
  // anywhere consumes — a number about the machine is not an input to a computation —
  // so it stays a 3 under both relations, exactly as number theory stays a 4 under
  // both. That is the stronger statement of the two: the PDE split is a join the walk
  // can see and containment cannot, while these two regions are genuinely disjoint
  // subjects a reader enters directly.
  //
  // **126 -> 129 and a new 3, and the new 3 is the finding.** The search region's two
  // halves share their EXIT — both `marked-item-search` and `quantum-walk-search`
  // produce `marked-item` — and sharing an exit is not something a trace can walk. This
  // relation is directed: it joins a slot that produces a state to a slot that consumes
  // it, and nothing on this map consumes a marked item. So `quantum-walk-search` merges
  // into the algorithms component through its containment edge into `phase-estimation`,
  // while `marked-item-search` stays a component of its own.
  //
  // That shared exit is exactly what `states.ts`'s admission rule asks for and it is
  // genuinely satisfied — two processes arrive at `marked-item`. What this line records
  // is the different, weaker fact underneath: a state with arrivals and no departures is
  // where a reader's route ENDS, and the region is joined to the rest of the map at its
  // entrance rather than at its exit. Naming a consumer would be the next real piece of
  // work here, and inventing one would be the dishonest way to make this number smaller.
  assert.deepEqual(componentsUnder(walkableAdjacency(LAYER_GRAPH, STATE_VOCABULARY)), [129, 5, 4, 3, 3]);
});
