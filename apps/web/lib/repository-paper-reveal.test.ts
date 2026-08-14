import assert from "node:assert/strict";
import test from "node:test";
import { paperRevealFor } from "./repository/paper-reveal.ts";
import { layoutConverge, drawableSlots, CONVERGE_OPEN_MAX } from "./repository/converge-layout.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { layerNode, isCapability, isMethod } from "./repository/layers.ts";
import { paperTraces } from "./repository/paper-traces.ts";
import { paperSlug } from "./repository/papers.ts";
import { STATE_VOCABULARY } from "./repository/state-vocabulary.ts";

/**
 * `?paper=` — the reveal that turns a paper's citations into a drawn pipeline
 * (W20). Tested against the real graph and the real register, over EVERY
 * map-citing paper: a fixture paper would be the fixture supplying the answer,
 * and the population is the point — the owner's spec is about any paper a
 * reader clicks, not about one that happens to work.
 */

const traces = paperTraces(LAYER_GRAPH, STATE_VOCABULARY);

function drawnAddresses(
  focusId: string,
  open: readonly string[],
  // W22: a reveal that re-expands a W17 fold names addresses that exist ONLY
  // under that unfold, so the re-draw has to be given it. Passed from
  // `reveal.unfold`, exactly as the surface passes it — a checker that redrew
  // without it would be measuring a different figure from the one shipped.
  unfold?: string,
): Set<string> {
  const focus = layerNode(LAYER_GRAPH, focusId);
  assert.ok(focus && isCapability(focus), `${focusId} is a drawable capability`);
  const diagram = layoutConverge({
    graph: LAYER_GRAPH,
    vocabulary: STATE_VOCABULARY,
    focus,
    locale: "en",
    open: new Set(open),
    unfold,
  });
  const addresses = new Set<string>();
  for (const lane of diagram.lanes) addresses.add(lane.address);
  return addresses;
}

/**
 * The test's OWN saturation index, built through the public API and not the
 * module's internals — the independent measurement that keeps "this paper
 * reveals nowhere" a verified fact rather than the module agreeing with
 * itself. A node with no occurrence here and no drawable figure of its own is
 * genuinely undrawn on today's map (the W17 fold produces exactly these:
 * methods folded into a parent card draw no lane of their own).
 */
function saturatedIndex(): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const slot of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const focus = layerNode(LAYER_GRAPH, slot.id);
    assert.ok(focus && isCapability(focus));
    const open = new Set<string>();
    let diagram = layoutConverge({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, focus, locale: "en" });
    for (let round = 0; round < 16; round++) {
      let grew = false;
      for (const lane of diagram.lanes) {
        if (lane.openHref === null || open.has(lane.address)) continue;
        open.add(lane.address);
        grew = true;
      }
      if (!grew) break;
      diagram = layoutConverge({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, focus, locale: "en", open });
    }
    const note = (nodeId: string | null) => {
      if (nodeId === null || nodeId === "") return;
      const set = index.get(nodeId) ?? new Set<string>();
      set.add(slot.id);
      index.set(nodeId, set);
    };
    // `draws`, as the module does: a leaf method's lane has `id: null` and its
    // subject in `draws` — the same measurement recorded in `paper-reveal.ts`.
    for (const lane of diagram.lanes) note(lane.draws ?? lane.nodeId);
  }
  return index;
}

test("every map-citing paper reveals — or is verifiably undrawn, never silently skipped", () => {
  assert.ok(traces.length >= 80, `only ${traces.length} traces — the register has gone quiet`);
  const drawableIds = new Set(drawableSlots(LAYER_GRAPH, STATE_VOCABULARY).map((slot) => slot.id));
  let index: Map<string, Set<string>> | null = null;
  let revealed = 0;
  const unrevealed: string[] = [];
  let drawnTotal = 0;
  let foldedTotal = 0;
  let elsewhereTotal = 0;
  let undrawnTotal = 0;
  for (const trace of traces) {
    const reveal = paperRevealFor(LAYER_GRAPH, STATE_VOCABULARY, paperSlug(trace.paper));
    if (reveal === null) {
      // Null must MEAN undrawable, per the independent index — a paper whose
      // nodes draw somewhere and still got null is a focus-choice bug.
      index = index ?? saturatedIndex();
      for (const nodeId of trace.nodes) {
        assert.ok(
          !index.has(nodeId) && !drawableIds.has(nodeId),
          `${trace.paper}: ${nodeId} draws somewhere, yet the reveal came back null`,
        );
      }
      unrevealed.push(trace.paper);
      continue;
    }
    revealed += 1;
    drawnTotal += reveal.drawn.length;
    foldedTotal += reveal.folded.length;
    elsewhereTotal += reveal.elsewhere.length;
    undrawnTotal += reveal.undrawn.length;

    // The claim, checked by re-drawing with ONLY the reveal set: every
    // occurrence the reveal names must actually draw under it — a folded
    // node's HOST occurrence exactly as a drawn node's own.
    const addresses = drawnAddresses(reveal.focusId, reveal.open, reveal.unfold ?? undefined);
    for (const node of reveal.drawn) {
      assert.ok(
        addresses.has(node.address),
        `${trace.paper}: ${node.nodeId} claimed at ${node.address}, not drawn under the reveal set`,
      );
    }
    for (const fold of reveal.folded) {
      assert.ok(
        addresses.has(fold.hostAddress),
        `${trace.paper}: ${fold.nodeId}'s host ${fold.hostId} claimed at ${fold.hostAddress}, not drawn under the reveal set`,
      );
      // The fold bucket's own honesty: the folded node genuinely draws NO
      // lane of its own anywhere — otherwise it belongs in drawn/elsewhere,
      // and "folded into a lane drawn here" would be covering for a miss.
      index = index ?? saturatedIndex();
      assert.ok(
        !index.has(fold.nodeId) && !drawableIds.has(fold.nodeId),
        `${trace.paper}: ${fold.nodeId} is bucketed as folded but draws its own lane somewhere`,
      );
    }

    // The accounting: every cited node is drawn here, folded into a drawn
    // host, elsewhere, undrawn-anywhere, or IS the focus — no node silently
    // vanishes from the ledger.
    const focusCited = trace.nodes.includes(reveal.focusId) && !reveal.drawn.some((n) => n.nodeId === reveal.focusId) ? 1 : 0;
    assert.equal(
      reveal.drawn.length +
        reveal.folded.length +
        reveal.elsewhere.length +
        reveal.undrawn.length +
        focusCited,
      trace.nodes.length,
      `${trace.paper}: drawn + folded + elsewhere + undrawn + focus does not account for every cited node`,
    );

    // The honesty claim behind the panel's "sits elsewhere on the map" (the
    // v2 fix): every `elsewhere` node really is drawn on some other figure —
    // itself, or (folded) through its host. Before the folded bucket existed
    // this was false for every folded node the chosen figure didn't host.
    index = reveal.elsewhere.length > 0 ? (index ?? saturatedIndex()) : index;
    for (const nodeId of reveal.elsewhere) {
      const hereOrSomewhere: boolean =
        (index!.has(nodeId) || drawableIds.has(nodeId)) ||
        (() => {
          const node = layerNode(LAYER_GRAPH, nodeId);
          const host =
            node && isMethod(node) && node.sameInternalsAsParent === true
              ? (node.refines ?? null)
              : null;
          return host !== null && (index!.has(host) || drawableIds.has(host));
        })();
      assert.ok(
        hereOrSomewhere,
        `${trace.paper}: ${nodeId} is bucketed "elsewhere" but draws nowhere on the map — the panel would state a falsehood`,
      );
    }
    // And the mirror: an `undrawn` node really draws nowhere — its own lane,
    // its own figure, or its fold host's lane would each disqualify it.
    index = reveal.undrawn.length > 0 ? (index ?? saturatedIndex()) : index;
    for (const nodeId of reveal.undrawn) {
      assert.ok(
        !index!.has(nodeId) && !drawableIds.has(nodeId),
        `${trace.paper}: ${nodeId} is bucketed "undrawn" yet draws somewhere — the coverage gap is overstated`,
      );
      const node = layerNode(LAYER_GRAPH, nodeId);
      const host =
        node && isMethod(node) && node.sameInternalsAsParent === true ? (node.refines ?? null) : null;
      assert.ok(
        host === null || (!index!.has(host) && !drawableIds.has(host)),
        `${trace.paper}: ${nodeId} is "undrawn" but its fold host ${host} draws — it belongs in folded or elsewhere`,
      );
    }

    // The entry: when the figure draws anything — a cited lane or a fold
    // host — the camera has somewhere to land.
    if (reveal.drawn.length > 0) {
      assert.ok(reveal.sel !== null, `${trace.paper}: drawn nodes but no entry for the camera`);
      assert.ok(
        reveal.drawn.some((node) => node.address === reveal.sel),
        `${trace.paper}: sel ${reveal.sel} is not one of the revealed occurrences`,
      );
    } else if (reveal.folded.length > 0) {
      assert.ok(
        reveal.folded.some((fold) => fold.hostAddress === reveal.sel),
        `${trace.paper}: only fold hosts draw, yet sel ${reveal.sel} is not one of their occurrences`,
      );
    }

    assert.ok(reveal.open.length <= CONVERGE_OPEN_MAX, `${trace.paper}: reveal exceeds the open cap`);
    assert.equal(reveal.dropped, 0, `${trace.paper}: the cap guard fired on today's corpus`);
  }
  // The floor keeps the feature real: if a structure change folds half the
  // corpus out of the drawing, this number is the alarm, not a silent shrink.
  assert.ok(revealed >= 75, `only ${revealed} of ${traces.length} papers reveal — the map has stopped drawing the corpus`);
  // The v2 floor: the fold bucket must stay real. 5 papers carried a folded
  // citation when this was written; a structure change may move the number,
  // but zero means the bucket has silently died while its panel copy ships.
  assert.ok(foldedTotal >= 1, "no reveal carries a folded citation — the fold bucket has gone dark");
  console.log(
    `paper reveals: ${revealed}/${traces.length} papers; occurrences drawn ${drawnTotal}, folded into hosts ${foldedTotal}, cited elsewhere ${elsewhereTotal}, drawn nowhere ${undrawnTotal}; verifiably undrawn papers: ${unrevealed.join(", ") || "none"}`,
  );
});

test("the reveal is minimal: removing any single address hides a claimed occurrence", () => {
  // Gating makes every ancestor load-bearing, and this is the assertion that
  // keeps "expands only branches needed" (the owner's words) true rather than
  // approximately true. Bounded to reveals of ≤6 addresses so the sweep stays
  // proportionate; the bound is a floor on coverage, printed, not a silent cap.
  let checked = 0;
  let removals = 0;
  for (const trace of traces) {
    const reveal = paperRevealFor(LAYER_GRAPH, STATE_VOCABULARY, paperSlug(trace.paper));
    if (reveal === null) continue; // verifiably undrawn — the population test owns that claim
    if (reveal.open.length === 0 || reveal.open.length > 6) continue;
    checked += 1;
    for (const removed of reveal.open) {
      removals += 1;
      const smaller = reveal.open.filter((address) => address !== removed);
      const addresses = drawnAddresses(reveal.focusId, smaller, reveal.unfold ?? undefined);
      // Fold-host occurrences are reveal targets exactly as drawn ones (v2):
      // an address whose only job is drawing a host is load-bearing, not dead.
      const stillAllDrawn: boolean =
        reveal.drawn.every((node) => addresses.has(node.address)) &&
        reveal.folded.every((fold) => addresses.has(fold.hostAddress));
      assert.ok(
        !stillAllDrawn,
        `${trace.paper}: ${removed} is dead weight — every occurrence still draws without it`,
      );
    }
  }
  assert.ok(checked >= 10, `only ${checked} papers had a removable reveal — the sweep has gone quiet`);
  console.log(`minimality: ${checked} papers, ${removals} single-address removals, all load-bearing`);
});

test("an unknown slug, a junk value, and an uncited paper all reveal nothing — and throw nothing", () => {
  assert.equal(paperRevealFor(LAYER_GRAPH, STATE_VOCABULARY, "no-such-paper"), null);
  assert.equal(paperRevealFor(LAYER_GRAPH, STATE_VOCABULARY, ""), null);
  assert.equal(paperRevealFor(LAYER_GRAPH, STATE_VOCABULARY, "arxiv-0000.00000"), null);
});

test("the reveal is deterministic: two calls agree byte for byte", () => {
  const first = traces[0]!;
  const a = paperRevealFor(LAYER_GRAPH, STATE_VOCABULARY, paperSlug(first.paper));
  const b = paperRevealFor(LAYER_GRAPH, STATE_VOCABULARY, paperSlug(first.paper));
  assert.deepEqual(a, b);
});

/**
 * `?unfold=` — OWNER RULING 06de05, W22: *"yes, but not duplicate paths unless
 * the paper has several different pipelines."*
 *
 * The ruling's own words are the assertion: **no folded-method lane drawn
 * beside its host**. It is deliberately NOT written as "no node id at two
 * addresses" — the map already draws 14 nodes at more than one address across
 * 3 of its 22 saturated figures, correctly, because one method is genuinely
 * used by two pipelines. Read that way the ruling would condemn the map as it
 * stands. So the measurement is a DELTA: unfolding must introduce no duplicate
 * that the same figure did not already have.
 *
 * This check earns its keep by having failed: before the suppression in
 * `planForMethod`, `lchs-improved-kernel` drew `lchs-kernel-identity` at both
 * `linear-ode-solve:0.3.0` (the host's own segment) and `:0.3.3.0` (inside the
 * variant) — one new duplicate, exactly what the ruling forbids.
 */
test("unfolding a paper's fold draws its lane and adds no duplicate path (RULING 06de05)", () => {
  /** Lanes that genuinely DRAW: not a shut W15 pointer, not a nameless twin. */
  const drawnTwice = (focusId: string, unfold?: string): Map<string, string[]> => {
    const focus = layerNode(LAYER_GRAPH, focusId);
    assert.ok(focus && isCapability(focus));
    const open = new Set<string>();
    let diagram = layoutConverge({
      graph: LAYER_GRAPH,
      vocabulary: STATE_VOCABULARY,
      focus,
      locale: "en",
      unfold,
    });
    for (let round = 0; round < 16; round++) {
      let grew = false;
      for (const lane of diagram.lanes) {
        if (lane.openHref === null || open.has(lane.address)) continue;
        open.add(lane.address);
        grew = true;
      }
      if (!grew) break;
      diagram = layoutConverge({
        graph: LAYER_GRAPH,
        vocabulary: STATE_VOCABULARY,
        focus,
        locale: "en",
        open,
        unfold,
      });
    }
    const byNode = new Map<string, string[]>();
    for (const lane of diagram.lanes) {
      if (lane.draws === null || lane.sharedWith !== null || lane.nameless) continue;
      byNode.set(lane.draws, [...(byNode.get(lane.draws) ?? []), lane.address]);
    }
    return new Map([...byNode].filter(([, at]) => at.length > 1));
  };

  let unfolding = 0;
  let bothKept = 0;
  for (const trace of traces) {
    const reveal = paperRevealFor(LAYER_GRAPH, STATE_VOCABULARY, paperSlug(trace.paper));
    if (reveal === null || reveal.unfold === null) continue;
    unfolding += 1;

    // 1. The unfold is not decorative: the folded method draws its OWN lane.
    //    Without this the duplicate check below could pass by drawing nothing.
    assert.ok(
      reveal.drawn.some((node) => node.nodeId === reveal.unfold),
      `${trace.paper}: unfold=${reveal.unfold} is claimed but the method draws no lane of its own`,
    );

    // 2. And it is no longer described as folded — the bucket it came from.
    assert.ok(
      !reveal.folded.some((fold) => fold.nodeId === reveal.unfold),
      `${trace.paper}: ${reveal.unfold} is drawn AND still reported folded — the panel would say both`,
    );

    // 3. The ruling itself, as a delta against the same figure unfolded away.
    const before = drawnTwice(reveal.focusId);
    const after = drawnTwice(reveal.focusId, reveal.unfold);
    for (const [nodeId, at] of after) {
      const had = before.get(nodeId)?.length ?? 0;
      assert.ok(
        at.length <= had,
        `${trace.paper}: unfolding ${reveal.unfold} draws ${nodeId} ${at.length}x (was ${had}x) at ${at.join(" | ")} — a duplicate path the ruling forbids`,
      );
    }

    // 4. Control arm — "several lanes ONLY when the paper genuinely has
    //    several different pipelines". A host whose drawing DIFFERS from its
    //    refinement's must still be drawn: a suppression that fired on every
    //    pair would pass check 3 by deleting the map.
    const host = reveal.folded.find((fold) => fold.nodeId === reveal.unfold)?.hostId;
    assert.equal(host, undefined, "unfolded node must have left the folded bucket");
    const hostDrawn = reveal.drawn.filter((node) => node.nodeId !== reveal.unfold);
    if (hostDrawn.length > 0) bothKept += 1;
  }

  // The denominator, printed rather than implied — a sweep that silently went
  // to zero would otherwise read exactly like a sweep that passed.
  console.log(`unfold: ${unfolding} papers re-expand a fold; ${bothKept} keep other lanes beside it`);
  assert.ok(unfolding >= 4, `only ${unfolding} papers unfold — the fold population has gone quiet`);
  assert.ok(bothKept >= 3, `only ${bothKept} unfolding papers still draw another lane — suppression may be over-firing`);
});
