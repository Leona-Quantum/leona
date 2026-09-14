import assert from "node:assert/strict";
import { test } from "node:test";

import type { BuilderStep } from "./studio-builder.ts";
import { insertBeforeTrailingMeasurements } from "./studio-placement.ts";

const op = (id: string, gate: BuilderStep["gate"], ...qubits: number[]): BuilderStep => ({ id, gate, qubits });
const ids = (steps: BuilderStep[]) => steps.map((step) => step.id);
const BELL = [op("h", "H", 0), op("cx", "CX", 0, 1), op("m0", "M", 0), op("m1", "M", 1)];

test("a gate on a measured wire goes in front of that measurement", () => {
  assert.deepEqual(ids(insertBeforeTrailingMeasurements(BELL, op("x", "X", 0))), ["h", "cx", "x", "m0", "m1"]);
  // q0's measurement is on another wire, so it keeps its place in front.
  assert.deepEqual(ids(insertBeforeTrailingMeasurements(BELL, op("z", "Z", 1))), ["h", "cx", "m0", "z", "m1"]);
});

test("a two-qubit gate goes in front of the earliest trailing measurement on either wire", () => {
  assert.deepEqual(ids(insertBeforeTrailingMeasurements(BELL, op("cz", "CZ", 1, 0))), ["h", "cx", "cz", "m0", "m1"]);
});

test("measurements, and gates on unmeasured wires, are appended", () => {
  assert.deepEqual(ids(insertBeforeTrailingMeasurements(BELL, op("m0b", "M", 0))), ["h", "cx", "m0", "m1", "m0b"]);
  const threeWires = [...BELL, op("h2", "H", 2)];
  assert.deepEqual(ids(insertBeforeTrailingMeasurements(threeWires, op("x2", "X", 2))), ["h", "cx", "m0", "m1", "h2", "x2"]);
});

test("a measurement that already has a gate after it is not trailing", () => {
  const midCircuit = [op("h", "H", 0), op("m0", "M", 0), op("x", "X", 0)];
  assert.deepEqual(ids(insertBeforeTrailingMeasurements(midCircuit, op("z", "Z", 0))), ["h", "m0", "x", "z"]);
});

test("the input list is not mutated", () => {
  const copy = [...BELL];
  insertBeforeTrailingMeasurements(BELL, op("x", "X", 0));
  assert.deepEqual(BELL, copy);
});
