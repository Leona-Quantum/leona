import assert from "node:assert/strict";
import test from "node:test";

import { blockViewMoments, expandOpenBlocks, viewColumnForTopLevelMoment } from "./circuit-block-view.ts";
import type { BuilderStep, CustomGateDefinition } from "./studio-builder.ts";

const bellSteps: BuilderStep[] = [
  { id: "s1", gate: "H", qubits: [0] },
  { id: "s2", gate: "CUSTOM", customGateId: "g1", qubits: [0, 1] },
  { id: "s3", gate: "M", qubits: [0] },
  { id: "s4", gate: "M", qubits: [1] },
];

const bellGate: CustomGateDefinition = {
  id: "g1",
  name: "Bell",
  qubitCount: 2,
  steps: [
    { id: "d1", gate: "H", qubits: [0] },
    { id: "d2", gate: "CX", qubits: [0, 1] },
  ],
};

test("a closed block draws exactly the top-level steps, unchanged", () => {
  const view = expandOpenBlocks(bellSteps, [bellGate], new Set());
  assert.deepEqual(view.displaySteps.map((display) => display.viewId), ["s1", "s2", "s3", "s4"]);
  assert.deepEqual(view.displaySteps.map((display) => display.depth), [0, 0, 0, 0]);
  assert.deepEqual(view.displaySteps.map((display) => display.topLevelStepId), ["s1", "s2", "s3", "s4"]);
  assert.equal(view.brackets.length, 0);
  // The step object itself is untouched — same gate, same qubits — closed is
  // a rendering choice, not a rewrite.
  assert.deepEqual(view.displaySteps[1].step, bellSteps[1]);
});

test("opening a block draws its children inline, remapped to global qubits, inside one bracket", () => {
  const view = expandOpenBlocks(bellSteps, [bellGate], new Set(["s2"]));
  assert.deepEqual(view.displaySteps.map((display) => display.viewId), ["s1", "s2::d1", "s2::d2", "s3", "s4"]);
  assert.deepEqual(view.displaySteps.map((display) => display.depth), [0, 1, 1, 0, 0]);
  assert.deepEqual(view.displaySteps.map((display) => display.topLevelStepId), ["s1", "s2", "s2", "s3", "s4"]);
  assert.deepEqual(view.displaySteps[1].step, { id: "d1", gate: "H", qubits: [0] });
  assert.deepEqual(view.displaySteps[2].step, { id: "d2", gate: "CX", qubits: [0, 1] });
  assert.equal(view.displaySteps[1].bracketId, "s2");
  assert.equal(view.displaySteps[2].bracketId, "s2");
  assert.deepEqual(view.brackets, [{ bracketId: "s2", parentBracketId: undefined, topLevelStepId: "s2", name: "Bell", qubits: [0, 1], depth: 0 }]);
});

test("a block's own qubit mapping carries into its children even when it is not the identity", () => {
  // The instance is placed on global qubits [2, 0] — d1 (local qubit 0) lands
  // on global 2, and d2's CX(local 0, local 1) lands on CX(global 2, global 0).
  const remapped: BuilderStep[] = [{ id: "s1", gate: "CUSTOM", customGateId: "g1", qubits: [2, 0] }];
  const view = expandOpenBlocks(remapped, [bellGate], new Set(["s1"]));
  assert.deepEqual(view.displaySteps.map((display) => display.step.qubits), [[2], [2, 0]]);
});

test("opening the outer block does not open a nested block — one level at a time", () => {
  const flipGate: CustomGateDefinition = { id: "g2", name: "Flip", qubitCount: 1, steps: [{ id: "e1", gate: "X", qubits: [0] }] };
  const outerGate: CustomGateDefinition = {
    id: "g1",
    name: "Bell",
    qubitCount: 2,
    steps: [
      { id: "d1", gate: "H", qubits: [0] },
      { id: "d2", gate: "CUSTOM", customGateId: "g2", qubits: [1] },
    ],
  };
  const steps: BuilderStep[] = [{ id: "s1", gate: "CUSTOM", customGateId: "g1", qubits: [0, 1] }];

  const outerOnly = expandOpenBlocks(steps, [outerGate, flipGate], new Set(["s1"]));
  assert.deepEqual(outerOnly.displaySteps.map((display) => display.viewId), ["s1::d1", "s1::d2"]);
  // d2 is itself a CUSTOM step; it stays sealed (its own `step.gate` is still "CUSTOM").
  assert.equal(outerOnly.displaySteps[1].step.gate, "CUSTOM");
  assert.equal(outerOnly.brackets.length, 1);

  const bothOpen = expandOpenBlocks(steps, [outerGate, flipGate], new Set(["s1", "s1::d2"]));
  assert.deepEqual(bothOpen.displaySteps.map((display) => display.viewId), ["s1::d1", "s1::d2::e1"]);
  assert.deepEqual(bothOpen.displaySteps[1].step, { id: "e1", gate: "X", qubits: [1] });
  assert.equal(bothOpen.displaySteps[1].depth, 2);
  assert.equal(bothOpen.displaySteps[1].bracketId, "s1::d2");
  assert.equal(bothOpen.displaySteps[1].topLevelStepId, "s1");
  assert.deepEqual(bothOpen.brackets.map((bracket) => bracket.bracketId), ["s1", "s1::d2"]);
  assert.equal(bothOpen.brackets[1].parentBracketId, "s1");
});

test("two occurrences of the same block definition open independently", () => {
  const steps: BuilderStep[] = [
    { id: "s1", gate: "CUSTOM", customGateId: "g1", qubits: [0, 1] },
    { id: "s2", gate: "CUSTOM", customGateId: "g1", qubits: [2, 3] },
  ];
  const view = expandOpenBlocks(steps, [bellGate], new Set(["s1"]));
  assert.deepEqual(view.displaySteps.map((display) => display.viewId), ["s1::d1", "s1::d2", "s2"]);
  assert.equal(view.brackets.length, 1);
});

test("an opaque block never opens, even if its id is in the open set", () => {
  const opaqueGate: CustomGateDefinition = { id: "g3", name: "SDK op", qubitCount: 1, steps: [{ id: "d1", gate: "X", qubits: [0] }], opaque: true };
  const steps: BuilderStep[] = [{ id: "s1", gate: "CUSTOM", customGateId: "g3", qubits: [0] }];
  const view = expandOpenBlocks(steps, [opaqueGate], new Set(["s1"]));
  assert.deepEqual(view.displaySteps.map((display) => display.viewId), ["s1"]);
  assert.equal(view.brackets.length, 0);
});

test("a definition that recurses into itself (a corrupted draft predating the cycle guard) draws sealed instead of looping", () => {
  const cyclic: CustomGateDefinition = { id: "gc", name: "Loop", qubitCount: 1, steps: [{ id: "x1", gate: "CUSTOM", customGateId: "gc", qubits: [0] }] };
  const steps: BuilderStep[] = [{ id: "s1", gate: "CUSTOM", customGateId: "gc", qubits: [0] }];
  const view = expandOpenBlocks(steps, [cyclic], new Set(["s1", "s1::x1", "s1::x1::x1", "s1::x1::x1::x1"]));
  assert.deepEqual(view.displaySteps.map((display) => display.viewId), ["s1::x1"]);
  assert.equal(view.displaySteps[0].step.gate, "CUSTOM");
  assert.equal(view.brackets.length, 1);
});

test("blockViewMoments gives each bracket the column span its children actually occupy", () => {
  const view = expandOpenBlocks(bellSteps, [bellGate], new Set(["s2"]));
  const { moments, brackets } = blockViewMoments(2, view);
  // s1@col0, s2::d1@col1, s2::d2@col2, s3@col3, s4@col3
  assert.deepEqual(moments.columns, [0, 1, 2, 3, 3]);
  assert.equal(moments.count, 4);
  assert.deepEqual(brackets, [{ bracketId: "s2", parentBracketId: undefined, topLevelStepId: "s2", name: "Bell", qubits: [0, 1], depth: 0, columnStart: 1, columnEnd: 2 }]);
});

test("viewColumnForTopLevelMoment keeps the playhead boundary correct as blocks open", () => {
  const topLevelMoments = { columns: [0, 1, 2, 2], count: 3 };
  const view = expandOpenBlocks(bellSteps, [bellGate], new Set(["s2"]));
  const viewColumns = blockViewMoments(2, view).moments.columns;
  assert.deepEqual(viewColumns, [0, 1, 2, 3, 3]);

  assert.equal(viewColumnForTopLevelMoment(bellSteps, topLevelMoments.columns, view, viewColumns, 0), 0);
  assert.equal(viewColumnForTopLevelMoment(bellSteps, topLevelMoments.columns, view, viewColumns, 1), 1);
  assert.equal(viewColumnForTopLevelMoment(bellSteps, topLevelMoments.columns, view, viewColumns, 2), 3);
  assert.equal(viewColumnForTopLevelMoment(bellSteps, topLevelMoments.columns, view, viewColumns, 3), 4);

  // With everything closed, the view and top-level column spaces coincide.
  const closed = expandOpenBlocks(bellSteps, [bellGate], new Set());
  const closedColumns = blockViewMoments(2, closed).moments.columns;
  for (let moment = 0; moment <= topLevelMoments.count; moment += 1) {
    assert.equal(viewColumnForTopLevelMoment(bellSteps, topLevelMoments.columns, closed, closedColumns, moment), moment);
  }
});
