// The strand layout's geometry, pinned rather than looked at.
//
// A diagram is the one kind of output where "it looked right" is the most
// tempting evidence and the least reliable: a child drawn 3px outside its
// parent, two lanes 1px apart, a bypass bundle over the lane below it, or a
// recursion that terminates only because today's graph happens to be shallow —
// none of those are visible in a screenshot of a canvas with 134 shapes on it,
// and every one of them ships silently the next time a node is added.
//
// So the invariants are asserted twice: once against fixtures built in-file, on
// this directory's standing rule that a test reading the authored graph asserts
// today's content and goes green when that content changes for an unrelated
// reason — and once against the real `LAYER_GRAPH`, asserting *only* that the
// same structural invariants hold, never a count or a name. The second pass is
// what catches "the layout is fine in the abstract and breaks on the one node
// with seven methods".
import assert from "node:assert/strict";
import test from "node:test";
import {
  ancestorPath,
  estimateTextWidth,
  fitLabel,
  layoutFocus,
  layoutOverview,
  pinchRunFor,
  siblingCapabilities,
  STRAND_METRICS,
  type StrandDiagram,
  type StrandFascicle,
  type StrandFiber,
} from "./repository/strand-layout.ts";
import {
  rootCapabilities,
  type LayerCapability,
  type LayerGraph,
  type LayerMethod,
} from "./repository/layers.ts";
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

/** Room a fascicle's bypass bundle takes below its outline, or zero. */
function bypassRoom(node: StrandFascicle): number {
  return node.bypasses.length
    ? STRAND_METRICS.bypassArcBase + node.bypasses.length * STRAND_METRICS.bypassArcStep
    : 0;
}

/**
 * Everything a fascicle actually occupies: its outline, its name above it, and
 * the strands routed under it.
 */
function fascicleExtent(node: StrandFascicle): [number, number] {
  return [
    node.y - node.halfHeight - STRAND_METRICS.fascicleLabelBand,
    node.y + node.halfHeight + bypassRoom(node),
  ];
}

/**
 * Everything a fiber occupies — and this is the measurement that matters.
 *
 * Comparing lane *centres* was the first version of the sibling check and it is
 * far too weak: two lanes 30px apart with 30px-tall content have centres 30
 * apart and content that touches. Deleting the lane gap from the placement
 * cursor survived that check completely. What has to be compared is the bands,
 * label bands included, because that is what a reader sees collide.
 */
function fiberExtent(fiber: StrandFiber): [number, number] {
  if (fiber.steps.length === 0) {
    return [
      fiber.laneY - STRAND_METRICS.leafHeight / 2,
      fiber.laneY + STRAND_METRICS.leafHeight / 2,
    ];
  }
  // The label band sits above the chain; the ascent of an 11.5px face is ~11.
  let top = fiber.labelY - 11;
  let bottom = fiber.labelY;
  for (const step of fiber.steps) {
    const [stepTop, stepBottom] = fascicleExtent(step);
    top = Math.min(top, stepTop);
    bottom = Math.max(bottom, stepBottom);
  }
  return [top, bottom];
}

/**
 * Every invariant that must hold of any diagram, collected rather than thrown.
 *
 * Collected so a failure names *all* of what broke: fixing one violation and
 * re-running to find the next is how a layout change takes six rounds.
 */
function violations(diagram: StrandDiagram): string[] {
  const found: string[] = [];

  function walkFascicle(node: StrandFascicle, parent: StrandFiber | null): void {
    if (node.state === "open" && node.fibers.length === 0) {
      found.push(`${node.id}: state "open" with no fibers — should be "empty"`);
    }
    if (node.state !== "open" && node.fibers.length > 0) {
      found.push(`${node.id}: state "${node.state}" but ${node.fibers.length} fibers drawn`);
    }
    if (!node.href) found.push(`${node.id}: no href`);
    if (node.width <= 0 || node.halfHeight <= 0) {
      found.push(`${node.id}: non-positive box ${node.width}x${node.halfHeight * 2}`);
    }

    // Inside the canvas, label band above and bypass bundle below included.
    const top = node.y - node.halfHeight - STRAND_METRICS.fascicleLabelBand;
    const bottom =
      node.y +
      node.halfHeight +
      (node.bypasses.length
        ? STRAND_METRICS.bypassArcBase + node.bypasses.length * STRAND_METRICS.bypassArcStep
        : 0);
    if (top < -0.5) found.push(`${node.id}: label band above the canvas (${top})`);
    if (bottom > diagram.height + 0.5) {
      found.push(`${node.id}: bypass bundle below the canvas (${bottom} > ${diagram.height})`);
    }
    if (node.x < -0.5 || node.x + node.width > diagram.width + 0.5) {
      found.push(`${node.id}: horizontally outside the canvas`);
    }

    // Inside the parent fiber's lane — the containment the whole picture claims.
    if (parent) {
      if (node.x < parent.laneX0 - 0.5 || node.x + node.width > parent.laneX1 + 0.5) {
        found.push(
          `${node.id}: escapes the lane of ${parent.id} ` +
            `[${node.x}..${node.x + node.width}] vs [${parent.laneX0}..${parent.laneX1}]`,
        );
      }
    }

    const lanes: StrandFiber[] = [];
    for (const fiber of node.fibers) {
      // Both ends of every fiber meet the fascicle's two pinches. This is the
      // claim the shape makes — "these are alternatives, not stages" — and it is
      // false the moment a fiber starts or ends anywhere else.
      if (Math.abs(fiber.entryX - node.x) > 0.5) {
        found.push(`${fiber.id}: entry ${fiber.entryX} is not ${node.id}'s pinch ${node.x}`);
      }
      if (Math.abs(fiber.exitX - (node.x + node.width)) > 0.5) {
        found.push(`${fiber.id}: exit ${fiber.exitX} is not ${node.id}'s exit pinch`);
      }
      if (Math.abs(fiber.pinchY - node.y) > 0.5) {
        found.push(`${fiber.id}: pinch line ${fiber.pinchY} is not ${node.id}'s centre ${node.y}`);
      }
      // The lane run stays between the two tapers, where the lens is widest.
      if (
        fiber.laneX0 < node.x + node.pinchRun - 0.5 ||
        fiber.laneX1 > node.x + node.width - node.pinchRun + 0.5
      ) {
        found.push(`${fiber.id}: lane run leaves ${node.id}'s taper`);
      }
      if (fiber.laneY < node.y - node.halfHeight - 0.5 || fiber.laneY > node.y + node.halfHeight + 0.5) {
        found.push(`${fiber.id}: lane ${fiber.laneY} outside ${node.id}'s outline`);
      }
      if (!fiber.href) found.push(`${fiber.id}: no href`);
      if ((fiber.outlook === "decomposed") !== fiber.steps.length > 0) {
        found.push(`${fiber.id}: outlook "${fiber.outlook}" disagrees with ${fiber.steps.length} steps`);
      }
      // A sub-fascicle's name must clear the name of the fiber carrying it.
      // Without this, dropping the child's own `liftTop` from the placement
      // draws the two labels through each other and nothing else notices.
      for (const step of fiber.steps) {
        const [stepTop] = fascicleExtent(step);
        if (stepTop < fiber.labelY - 0.5) {
          found.push(
            `${step.id}: its name band (${stepTop}) runs into ${fiber.id}'s name (${fiber.labelY})`,
          );
        }
      }

      lanes.push(fiber);
      for (const step of fiber.steps) walkFascicle(step, fiber);
    }

    // Sibling fibers are separated by at least `laneGap` — measured between the
    // bands they occupy, not between their centre lines.
    const sorted = [...lanes].sort((a, b) => a.laneY - b.laneY);
    for (let i = 1; i < sorted.length; i += 1) {
      const [, previousBottom] = fiberExtent(sorted[i - 1]!);
      const [thisTop] = fiberExtent(sorted[i]!);
      if (thisTop - previousBottom < STRAND_METRICS.laneGap - 0.5) {
        found.push(
          `${node.id}: ${sorted[i - 1]!.id} ends at ${previousBottom} and ` +
            `${sorted[i]!.id} starts at ${thisTop} — under the ${STRAND_METRICS.laneGap} lane gap`,
        );
      }
    }
  }

  for (const root of diagram.roots) walkFascicle(root, null);
  return found;
}

function countFascicles(diagram: StrandDiagram): number {
  let total = 0;
  const walk = (node: StrandFascicle): void => {
    total += 1;
    for (const fiber of node.fibers) for (const step of fiber.steps) walk(step);
  };
  for (const root of diagram.roots) walk(root);
  return total;
}

// ---------------------------------------------------------------------------
// Text measurement — the one part that cannot use a DOM.
// ---------------------------------------------------------------------------

test("a CJK string is measured wider than the same number of Latin characters", () => {
  // The Japanese surface is the one a low estimate breaks, and it is the one
  // that has historically shipped unlooked-at.
  assert.ok(estimateTextWidth("量子線形方程式", 13) > estimateTextWidth("abcdefg", 13));
});

test("fitLabel never returns something wider than the budget, and says when it cut", () => {
  const long = "Choose a time discretization or propagator approximation";
  const fitted = fitLabel(long, 13, 120);
  assert.equal(fitted.truncated, true);
  assert.ok(estimateTextWidth(fitted.text, 13) <= 120);
  assert.ok(fitted.text.endsWith("…"));

  const short = fitLabel("Short", 13, 400);
  assert.equal(short.truncated, false);
  assert.equal(short.text, "Short");
});

test("a taper grows with height and is clamped at both ends", () => {
  assert.equal(pinchRunFor(0), STRAND_METRICS.pinchRun);
  assert.equal(pinchRunFor(100_000), STRAND_METRICS.pinchRunMax);
  assert.ok(pinchRunFor(600) > pinchRunFor(200));
});

// ---------------------------------------------------------------------------
// The states, which must never be confused for one another.
// ---------------------------------------------------------------------------

test("a slot nothing realises is empty, and a slot past the cap is closed", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("root"),
      method("only-way", "root", { steps: ["deep", "unfilled"] }),
      capability("deep"),
      method("inner", "deep", { atomic: true }),
      capability("unfilled"), // nothing realises this one
    ],
  };

  const shallow = layoutFocus(graph, "root", "en", 1);
  const inner = shallow.roots[0]!.fibers[0]!.steps;
  const deep = inner.find((node) => node.id === "deep")!;
  const unfilled = inner.find((node) => node.id === "unfilled")!;

  // `deep` has a method and was cut off by the cap: "there is more here".
  assert.equal(deep.state, "closed");
  assert.equal(deep.methodCount, 1);
  // `unfilled` has none at any depth: "there is nothing here". Different claim.
  assert.equal(unfilled.state, "empty");
  assert.equal(unfilled.methodCount, 0);

  // Raising the cap opens the first and leaves the second exactly as it was.
  const deeper = layoutFocus(graph, "root", "en", 2);
  const opened = deeper.roots[0]!.fibers[0]!.steps.find((node) => node.id === "deep")!;
  const still = deeper.roots[0]!.fibers[0]!.steps.find((node) => node.id === "unfilled")!;
  assert.equal(opened.state, "open");
  assert.equal(still.state, "empty");
});

test("closedCount is the number actually drawn shut, so the page cannot overstate coverage", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("root"),
      method("way", "root", { steps: ["a", "b"] }),
      capability("a"),
      method("a-way", "a", { atomic: true }),
      capability("b"),
      method("b-way", "b", { atomic: true }),
    ],
  };
  assert.equal(layoutFocus(graph, "root", "en", 1).closedCount, 2);
  assert.equal(layoutFocus(graph, "root", "en", 2).closedCount, 0);
});

test("an atomic method and an undecomposed one are different fibers", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("root"),
      method("primitive", "root", { atomic: true }),
      method("nobody-looked", "root"),
    ],
  };
  const fibers = layoutFocus(graph, "root", "en", 1).roots[0]!.fibers;
  assert.deepEqual(
    fibers.map((fiber) => fiber.outlook),
    ["atomic", "undecomposed"],
  );
});

// ---------------------------------------------------------------------------
// Termination, on input the validator is supposed to reject but the route may see.
// ---------------------------------------------------------------------------

test("a cycle in steps terminates and is drawn shut rather than followed", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("a"),
      method("a-way", "a", { steps: ["b"] }),
      capability("b"),
      method("b-way", "b", { steps: ["a"] }), // back to the top
    ],
  };
  // The assertion is that this returns at all — a layout that trusted the graph
  // would recurse until the stack gave out.
  const diagram = layoutFocus(graph, "a", "en", 6);
  assert.deepEqual(violations(diagram), []);
  const repeat = diagram.roots[0]!.fibers[0]!.steps[0]!.fibers[0]!.steps[0]!;
  assert.equal(repeat.id, "a");
  assert.equal(repeat.state, "closed");
});

test("a step naming a node that is not a capability does not throw", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("root"),
      method("way", "root", { steps: ["a-method", "missing"] }),
      method("a-method", "root"),
    ],
  };
  const diagram = layoutFocus(graph, "root", "en", 2);
  assert.equal(diagram.roots.length, 1);
  for (const step of diagram.roots[0]!.fibers[0]!.steps) assert.equal(step.state, "empty");
});

// ---------------------------------------------------------------------------
// The geometry itself.
// ---------------------------------------------------------------------------

test("a wide fan-out keeps every lane separated and inside the outline", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("root"),
      ...Array.from({ length: 7 }, (_, index) =>
        method(`way-${index}`, "root", { atomic: true }),
      ),
    ],
  };
  const diagram = layoutFocus(graph, "root", "en", 1);
  assert.deepEqual(violations(diagram), []);
  assert.equal(diagram.roots[0]!.fibers.length, 7);
});

test("a bypassed slot reserves room below itself for the bundle", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("root"),
      method("through", "root", { steps: ["skipped"] }),
      capability("skipped"),
      method("filler", "skipped", { atomic: true }),
      method("around-1", "root", { atomic: true, bypasses: ["skipped"] }),
      method("around-2", "root", { atomic: true, bypasses: ["skipped"] }),
    ],
  };
  const diagram = layoutFocus(graph, "root", "en", 1);
  assert.deepEqual(violations(diagram), []);
  const skipped = diagram.roots[0]!.fibers[0]!.steps[0]!;
  assert.equal(skipped.bypasses.length, 2);
  // Each arc rides lower than the last, so two routes read as two.
  assert.ok(skipped.bypasses[1]!.lift > skipped.bypasses[0]!.lift);
});

test("an open slot widens to fit its name; only a capped shut one is cut", () => {
  // The two halves of the truncation contract, and they are deliberately
  // different. An open fascicle is sized by its contents, so it can afford to
  // grow to its own name and does. A shut one is capped at `closedMaxWidth` —
  // otherwise one long name on a nested step would set the width of the whole
  // canvas — so that is the only place a label is ever cut.
  const long = "A capability whose authored name is far longer than any oval can hold";
  const graph: LayerGraph = {
    nodes: [
      capability("root"),
      method("way", "root", { steps: ["wordy"] }),
      capability("wordy", { label: long, labelJa: long }),
      method("filler", "wordy", { atomic: true }),
    ],
  };

  const open = layoutFocus(graph, "wordy", "en", 1).roots[0]!;
  assert.equal(open.state, "open");
  assert.equal(open.labelTruncated, false, "an open slot should show its whole name");
  assert.equal(open.label, long);
  assert.ok(open.width >= estimateTextWidth(long, STRAND_METRICS.fascicleFont));

  const shut = layoutFocus(graph, "root", "en", 1).roots[0]!.fibers[0]!.steps[0]!;
  assert.equal(shut.state, "closed");
  assert.equal(shut.labelTruncated, true);
  assert.ok(shut.label.length < long.length);
  assert.ok(shut.label.endsWith("…"));
  // Cut in the shape, never lost: the renderer puts this in the `<title>`.
  assert.equal(shut.fullLabel, long);
  assert.ok(shut.width <= STRAND_METRICS.closedMaxWidth);
});

// ---------------------------------------------------------------------------
// Where you are, and what is beside you.
// ---------------------------------------------------------------------------

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

test("siblingCapabilities excludes the node itself and does not repeat", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("top"),
      method("one", "top", { steps: ["a", "target"] }),
      method("two", "top", { steps: ["a", "target", "b"] }),
      capability("a"),
      capability("b"),
      capability("target"),
    ],
  };
  const siblings = siblingCapabilities(graph, "target").map((node) => node.id);
  assert.deepEqual([...siblings].sort(), ["a", "b"]);
  assert.equal(new Set(siblings).size, siblings.length);
});

// ---------------------------------------------------------------------------
// The real graph. Structure only — never a count, never a name.
// ---------------------------------------------------------------------------

test("the authored graph lays out cleanly at every depth, in both locales", () => {
  const roots = rootCapabilities(LAYER_GRAPH);
  assert.ok(roots.length > 0, "the graph has no roots to draw");

  for (const locale of ["en", "ja"] as const) {
    for (const depth of [1, 2, 3] as const) {
      const overview = layoutOverview(LAYER_GRAPH, roots, locale, depth);
      assert.deepEqual(
        violations(overview),
        [],
        `overview ${locale} depth ${depth}`,
      );
      assert.ok(overview.width > 0 && overview.height > 0);
    }
  }
});

test("every capability in the authored graph can be focused without violating anything", () => {
  for (const node of LAYER_GRAPH.nodes) {
    if (node.kind !== "capability") continue;
    for (const locale of ["en", "ja"] as const) {
      const diagram = layoutFocus(LAYER_GRAPH, node.id, locale, 2);
      assert.deepEqual(violations(diagram), [], `focus ${node.id} (${locale})`);
      // Its own path is walkable and ends where it started.
      const path = ancestorPath(LAYER_GRAPH, node.id);
      assert.equal(path.at(-1)?.id, node.id, `path for ${node.id} does not end at it`);
    }
  }
});

test("raising the depth never draws fewer shapes than the depth below it", () => {
  // Monotonicity is the property that makes the depth control mean what it says.
  // It broke once already, when the cap was compared before the ancestor check.
  const roots = rootCapabilities(LAYER_GRAPH);
  let previous = 0;
  for (const depth of [1, 2, 3] as const) {
    const total = countFascicles(layoutOverview(LAYER_GRAPH, roots, "en", depth));
    assert.ok(total >= previous, `depth ${depth} drew ${total}, below ${previous}`);
    previous = total;
  }
});
