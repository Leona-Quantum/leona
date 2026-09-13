import assert from "node:assert/strict";
import { test } from "node:test";

import { circuitMoments } from "./circuit-moments.ts";

const on = (...qubits: number[]) => ({ qubits });

test("one-qubit gates on different wires share a column", () => {
  const moments = circuitMoments(3, [on(0), on(1), on(2)]);
  assert.deepEqual(moments.columns, [0, 0, 0]);
  assert.equal(moments.count, 1);
  assert.deepEqual(moments.frontier, [1, 1, 1]);
});

test("a second gate on the same wire takes the next column", () => {
  const moments = circuitMoments(2, [on(0), on(0)]);
  assert.deepEqual(moments.columns, [0, 1]);
  assert.equal(moments.count, 2);
  assert.deepEqual(moments.frontier, [2, 0]);
});

test("a two-qubit gate blocks the wires its connector crosses", () => {
  // CX(q0, q2) is drawn as a line over q1, so a q1 gate cannot share its column.
  const moments = circuitMoments(3, [on(0, 2), on(1)]);
  assert.deepEqual(moments.columns, [0, 1]);
});

test("the GHZ-with-phase fixture packs into five moments, not eight", () => {
  const steps = [on(0), on(0, 1), on(2), on(1, 2), on(2), on(0), on(1), on(2)];
  const moments = circuitMoments(3, steps);
  assert.deepEqual(moments.columns, [0, 1, 0, 2, 3, 2, 3, 4]);
  assert.equal(moments.count, 5);
  // Order along every wire is the array order: columns strictly increase.
  for (let qubit = 0; qubit < 3; qubit += 1) {
    const onWire = steps.flatMap((step, index) => (step.qubits.includes(qubit) ? [moments.columns[index]] : []));
    for (let index = 1; index < onWire.length; index += 1) assert.ok(onWire[index] > onWire[index - 1], `wire q${qubit} reordered`);
  }
});

test("an empty circuit has no columns and an empty frontier", () => {
  const moments = circuitMoments(2, []);
  assert.equal(moments.count, 0);
  assert.deepEqual(moments.frontier, [0, 0]);
});
