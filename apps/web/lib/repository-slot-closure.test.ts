import test from "node:test";
import assert from "node:assert/strict";

import {
  SLOT_CLOSURES,
  auditSlotClosure,
  auditSlotClosures,
  isAbsentMember,
  type SlotClosure,
} from "./repository/slot-closure.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { STATE_VOCABULARY } from "./repository/state-vocabulary.ts";
import { isCapability, isMethod, layerNode, type LayerGraph } from "./repository/layers.ts";
import { layoutConverge } from "./repository/converge-layout.ts";

function slotFigure(graph: LayerGraph, id: string) {
  const node = layerNode(graph, id);
  assert.ok(node && isCapability(node), `${id} is not a capability`);
  return layoutConverge({ graph, vocabulary: STATE_VOCABULARY, focus: node, locale: "en" });
}

/** The closure with one member edited, for the mutation arms below. */
function edited(closure: SlotClosure, members: SlotClosure["members"]): SlotClosure {
  return { ...closure, members };
}

test("the authored graph agrees with every closure pinned against it", () => {
  const errors = auditSlotClosures(LAYER_GRAPH);
  assert.deepEqual(errors, [], errors.join("\n"));

  // Denominators. A closure list that had gone empty, or a closure whose slot
  // nothing realizes, passes the line above while measuring nothing — which is
  // the failure mode this whole file is a response to.
  assert.ok(SLOT_CLOSURES.length >= 1, "no slot is closed, so nothing above was checked");
  for (const closure of SLOT_CLOSURES) {
    const realizing = LAYER_GRAPH.nodes.filter(
      (node) => isMethod(node) && node.realizes === closure.slot,
    );
    assert.ok(
      realizing.length >= 2,
      `${closure.slot} is pinned closed and only ${realizing.length} method realizes it`,
    );
  }
  console.log(
    `[closure] ${SLOT_CLOSURES.length} closed slot(s): ` +
      SLOT_CLOSURES.map((closure) => {
        const present = closure.members.filter((member) => !isAbsentMember(member)).length;
        const absent = closure.members.length - present;
        return `${closure.slot} — ${present} drawn, ${absent} recorded absent`;
      }).join("; "),
  );
});

test("a method added to a closed slot without a row fails the closure", () => {
  // **The check the lane exists for, made to fail before it is trusted.** The
  // eighth method is synthesised rather than authored, because the property
  // under test is that the *absence of a row* fails — not that any particular
  // paper is missing.
  const closure = SLOT_CLOSURES.find((one) => one.slot === "linear-ode-solve");
  assert.ok(closure, "linear-ode-solve is no longer a closed slot");

  const eighth = {
    kind: "method",
    id: "probe-eighth-linear-ode-route",
    label: "A route nobody wrote a closure row for",
    labelJa: "終結の行が書かれていない経路",
    summary: "probe",
    summaryJa: "probe",
    realizes: "linear-ode-solve",
    steps: ["time-discretization", "quantum-linear-solve"],
  };
  const grown = {
    ...LAYER_GRAPH,
    nodes: [...LAYER_GRAPH.nodes, eighth],
  } as unknown as LayerGraph;

  const errors = auditSlotClosure(grown, closure);
  assert.ok(
    errors.some((error) => error.includes("probe-eighth-linear-ode-route")),
    `an unrecorded eighth method passed the closure: ${JSON.stringify(errors)}`,
  );
});

test("every other closure rule fails on its own mutation", () => {
  // A gate is worth what its failures are worth, and eight rules sharing one
  // green line is eight chances for one of them to have stopped guarding. Each
  // arm below breaks exactly one rule and asserts the error names it. Run
  // against the real graph, so a rule that has quietly become unreachable on
  // this corpus shows up here rather than in the next session's surprise.
  const real = SLOT_CLOSURES.find((one) => one.slot === "linear-ode-solve");
  assert.ok(real);

  const fails = (closure: SlotClosure, needle: string, what: string) => {
    const errors = auditSlotClosure(LAYER_GRAPH, closure);
    assert.ok(
      errors.some((error) => error.includes(needle)),
      `${what}: expected an error mentioning "${needle}", got ${JSON.stringify(errors)}`,
    );
  };

  // [1] a slot that is not in the graph, and one that is not a capability.
  fails({ ...real, slot: "no-such-slot" }, "not in the graph", "an unknown slot");
  fails({ ...real, slot: "lchs-route" }, "and not a slot", "a method pinned as a slot");
  fails(
    { ...real, source: { ...real.source, url: "https://example.com/paper" } },
    "does not resolve to an arXiv abstract",
    "an unresolvable enumeration",
  );
  fails({ ...real, sourceLocus: "  " }, "is not a pin", "a source with no locus");

  // [3] a pinned id that is not a method of this slot, and one that is nothing.
  fails(
    edited(real, [...real.members, { node: "forward-euler" }]),
    "does not realize linear-ode-solve",
    "a method of another slot",
  );
  fails(
    edited(real, [...real.members, { node: "no-such-method" }]),
    "is not in the graph",
    "a pinned id that names nothing",
  );

  // [4] the same method pinned twice.
  fails(
    edited(real, [...real.members, { node: "lchs-route" }]),
    "is pinned twice",
    "a duplicate row",
  );

  // [7]/[8] the cost rules, both directions.
  fails(
    edited(
      real,
      real.members.map((member) =>
        !isAbsentMember(member) && member.node === "schrodingerisation"
          ? { node: "schrodingerisation" }
          : member,
      ),
    ),
    "carries no cost and no costSilent",
    "an unexplained absent cost",
  );
  fails(
    edited(
      real,
      real.members.map((member) =>
        !isAbsentMember(member) && member.node === "lchs-route"
          ? { node: "lchs-route", costSilent: "stale" }
          : member,
      ),
    ),
    "both a cost and a costSilent",
    "a costSilent left behind after the cost landed",
  );

  // [5] the absence rules.
  fails(
    edited(real, [
      ...real.members,
      { absent: "Something", because: "  ", citation: real.source },
    ]),
    "recorded absent with no reason",
    "an unreasoned absence",
  );
  fails(
    edited(real, [
      ...real.members,
      {
        absent: "Something",
        because: "a reason",
        citation: { ...real.source, url: "https://example.com/x" },
      },
    ]),
    "is not a measurement",
    "an uncitable absence",
  );

  // [6]/[9] the rules about the node rather than the row, so these are mutated
  // on the graph — they are what a future edit to `layer-graph.ts` would break.
  const stripped = (id: string, field: string, value: unknown) =>
    ({
      ...LAYER_GRAPH,
      nodes: LAYER_GRAPH.nodes.map((node) => (node.id === id ? { ...node, [field]: value } : node)),
    }) as unknown as LayerGraph;
  for (const [field, value] of [
    ["citations", []],
    ["conditions", ""],
    ["conditionsJa", ""],
    // [9] `time-marching-usva` is the right subject for the route arm: it is
    // the one member whose route is a single step plus a `bypasses`, so
    // emptying `steps` alone must NOT fail — it still says what it goes
    // around. Both are asserted, one below the other.
    ["steps", []],
  ] as const) {
    const errors = auditSlotClosure(stripped("time-marching-usva", field, value), real);
    const named = errors.some((error) => error.includes("time-marching-usva"));
    if (field === "steps") {
      assert.ok(
        !named,
        `emptying steps on a method that declares bypasses should still be a route: ${JSON.stringify(errors)}`,
      );
      continue;
    }
    assert.ok(named, `stripping ${field} passed the closure: ${JSON.stringify(errors)}`);
  }
  // …and a member with neither steps, nor bypasses, nor `atomic` does fail.
  const routeless = auditSlotClosure(
    stripped("taylor-all-at-once", "steps", []),
    real,
  );
  assert.ok(
    routeless.some((error) => error.includes("declares no route")),
    `a member with no route passed the closure: ${JSON.stringify(routeless)}`,
  );
});

test("every method a closure pins is drawn on its own slot's figure, and links to itself", () => {
  // The reachability half, and it is a different claim from the fan gate in
  // `repository-converge-layout.test.ts`. That one asks whether the figure
  // draws every method the graph *has* — which a fan derived from
  // `methodsRealizing` satisfies by construction, so it can never fail on a new
  // method. This one asks whether the figure draws every method the population
  // *should* have, and the population is a written record the drawing cannot
  // derive itself.
  let checked = 0;
  for (const closure of SLOT_CLOSURES) {
    const figure = slotFigure(LAYER_GRAPH, closure.slot);
    assert.equal(
      figure.empty,
      false,
      `${closure.slot} is pinned closed and its own figure draws nothing`,
    );
    const lanes = new Map(
      figure.lanes.filter((lane) => lane.draws !== null).map((lane) => [lane.draws!, lane]),
    );
    for (const member of closure.members) {
      if (isAbsentMember(member)) continue;
      checked += 1;
      const lane = lanes.get(member.node);
      assert.ok(lane, `${closure.slot}'s own figure does not draw ${member.node}`);
      // Drawn is not the same as reachable: a lane a reader cannot click leads
      // to a method page nothing on the map links to.
      assert.ok(
        lane.href.includes(member.node),
        `${closure.slot}: the lane drawing ${member.node} links to ${lane.href} instead`,
      );
    }
  }
  assert.ok(checked >= 7, `only ${checked} pinned methods were checked against a figure`);
});
