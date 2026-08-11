import assert from "node:assert/strict";
import test from "node:test";
import { carrySelection, resolveSelection, SEL_PARAM } from "./repository/canvas-selection.ts";
import { layoutConverge } from "./repository/converge-layout.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { layerNode, isCapability } from "./repository/layers.ts";
import { STATE_VOCABULARY } from "./repository/state-vocabulary.ts";

/**
 * `?sel=` — which drawn thing the reader is on (W16, the Prezi move).
 *
 * Two halves, two failure modes. `carrySelection` runs in the click
 * interceptor: a wrong rule there writes a selection the reader did not make,
 * or silently drops the one they did, on every intercepted click. It is pure
 * URL arithmetic, so every rule is pinned here without a DOM.
 * `resolveSelection` runs on the server against what actually drew, and is
 * tested against the real graph rather than a hand-shaped diagram — a fixture
 * chosen to match the matcher would be the fixture supplying the answer.
 */

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

test("opening a lane selects it: the address added to ?open= becomes ?sel=", () => {
  const next = params("focus=linear-ode-solve&open=1.0.3");
  carrySelection(params("focus=linear-ode-solve"), next);
  assert.equal(next.get(SEL_PARAM), "1.0.3");

  // With other lanes already open, only the ADDED one is the click's meaning.
  const second = params("focus=x&open=a&open=b");
  carrySelection(params("focus=x&open=a"), second);
  assert.equal(second.get(SEL_PARAM), "b");
});

test("shutting the selected lane deselects it; shutting another lane does not", () => {
  const shutSelected = params("focus=x");
  carrySelection(params("focus=x&open=a&sel=a"), shutSelected);
  assert.equal(shutSelected.get(SEL_PARAM), null);

  const shutOther = params("focus=x&open=a");
  carrySelection(params("focus=x&open=a&open=b&sel=a"), shutOther);
  assert.equal(shutOther.get(SEL_PARAM), "a");
});

test("opening or switching a card selects its node; closing one keeps the selection", () => {
  const opened = params("card=quantum-linear-solve");
  carrySelection(params(""), opened);
  assert.equal(opened.get(SEL_PARAM), "quantum-linear-solve");

  const switched = params("card=q");
  carrySelection(params("card=p&sel=p"), switched);
  assert.equal(switched.get(SEL_PARAM), "q");

  // The reader finished reading; they did not leave the thing.
  const closed = params("open=a");
  carrySelection(params("open=a&card=p&sel=p"), closed);
  assert.equal(closed.get(SEL_PARAM), "p");
});

test("a W15 jump's ?at=<address> becomes ?sel=, and the live viewport is carried under it", () => {
  // The demoted-lane control writes the HOST's lane address into `at`, which
  // `parseViewport` would swallow into IDENTITY — the jump shipped as a camera
  // reset. Rewritten, it means what it said: select the host, keep standing
  // where the reader stands, and let the camera fly there.
  const jump = params("focus=x&open=a&at=linear-ode-solve%3A0.0.1.1.0");
  carrySelection(params("focus=x&open=a&at=5,6,1.5"), jump);
  assert.equal(jump.get(SEL_PARAM), "linear-ode-solve:0.0.1.1.0");
  assert.equal(jump.get("at"), "5,6,1.5");

  // No live viewport to carry: `at` simply goes, rather than surviving as a
  // string the parser will silently reject on arrival.
  const fresh = params("focus=x&at=1.0.3");
  carrySelection(params("focus=x"), fresh);
  assert.equal(fresh.get(SEL_PARAM), "1.0.3");
  assert.equal(fresh.get("at"), null);
});

test("a genuine viewport in ?at= — a size rung — is not a jump, and the selection rides along", () => {
  const rung = params("focus=x&at=0,0,1.5");
  carrySelection(params("focus=x&sel=a&at=2,3,1"), rung);
  assert.equal(rung.get("at"), "0,0,1.5");
  assert.equal(rung.get(SEL_PARAM), "a");
});

test("with nothing to say, carrySelection carries — and invents nothing", () => {
  const carried = params("focus=x&about=reading");
  carrySelection(params("focus=x&sel=a"), carried);
  assert.equal(carried.get(SEL_PARAM), "a");

  const silent = params("focus=x&about=reading");
  carrySelection(params("focus=x"), silent);
  assert.equal(silent.get(SEL_PARAM), null);
});

// --- resolveSelection, against the real graph ------------------------------

function diagramFor(id: string) {
  const node = layerNode(LAYER_GRAPH, id);
  assert.ok(node && isCapability(node), `${id} is a capability`);
  return layoutConverge({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, focus: node, locale: "en" });
}

test("resolveSelection: a lane address names its own occurrence, a state id its circle", () => {
  const diagram = diagramFor("linear-ode-solve");
  const lane = diagram.lanes[0];
  assert.ok(lane, "the real figure draws at least one lane");
  const byAddress = resolveSelection(lane.address, [diagram]);
  assert.deepEqual(byAddress, { figure: 0, laneAddress: lane.address, stateKey: null, feedKey: null });

  const state = diagram.states[0];
  assert.ok(state, "the real figure draws at least one state");
  const byState = resolveSelection(state.stateId, [diagram]);
  assert.deepEqual(byState, { figure: 0, laneAddress: null, stateKey: state.key, feedKey: null });
});

test("resolveSelection: an ingredient's FEED address matches its stub — the control that put it into ?open= lives there", () => {
  const node = layerNode(LAYER_GRAPH, "linear-ode-solve");
  assert.ok(node && isCapability(node));
  // Open outward from the top until a stub exists: which depth first hangs an
  // ingredient is the layout's business, and hard-coding an open set that
  // happens to produce one today is the fixture drifting from the figure.
  const open = new Set<string>();
  let diagram = layoutConverge({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, focus: node, locale: "en" });
  for (let round = 0; round < 8 && diagram.feeds.length === 0; round++) {
    let grew = false;
    for (const lane of diagram.lanes) {
      if (lane.openHref === null || open.has(lane.address)) continue;
      open.add(lane.address);
      grew = true;
    }
    assert.ok(grew, "the walk keeps finding openable lanes until a stub appears");
    diagram = layoutConverge({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, focus: node, locale: "en", open });
  }
  const feed = diagram.feeds[0];
  assert.ok(feed, "the saturation walk reaches at least one ingredient stub");
  const resolved = resolveSelection(feed.address, [diagram]);
  assert.deepEqual(resolved, { figure: 0, laneAddress: null, stateKey: null, feedKey: feed.key });
});

test("resolveSelection: a node id falls to the first lane drawing it; the first figure wins; junk resolves to null", () => {
  const diagram = diagramFor("linear-ode-solve");
  const withNode = diagram.lanes.find((lane) => lane.nodeId !== null);
  assert.ok(withNode, "the real figure draws at least one lane with a node id");
  const byNode = resolveSelection(withNode.nodeId, [diagram]);
  assert.ok(byNode);
  assert.equal(byNode.figure, 0);
  assert.equal(byNode.laneAddress !== null || byNode.stateKey !== null, true);

  // Two copies of the same figure: an address is only unambiguous within one,
  // so the first drawn figure takes it — the same first-wins the overview needs.
  const twice = resolveSelection(withNode.nodeId, [diagram, diagram]);
  assert.equal(twice?.figure, 0);

  assert.equal(resolveSelection("no-such-thing-at-all", [diagram]), null);
  assert.equal(resolveSelection(null, [diagram]), null);
});
