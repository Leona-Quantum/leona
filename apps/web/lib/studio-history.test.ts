import assert from "node:assert/strict";
import test from "node:test";

import { popStudioHistory, pushStudioHistory, type StudioHistorySnapshot } from "./studio-history.ts";

function snap(n: number): StudioHistorySnapshot {
  return { qubitCount: n, steps: [{ id: `s${n}`, gate: "H", qubits: [0] }], customGates: [] };
}

test("pop on an empty stack returns null", () => {
  assert.equal(popStudioHistory([]), null);
});

test("push then pop round-trips the same snapshot and shrinks the stack", () => {
  const past = pushStudioHistory([], snap(1));
  const popped = popStudioHistory(past);
  assert.ok(popped);
  assert.deepEqual(popped.snapshot, snap(1));
  assert.deepEqual(popped.past, []);
});

test("pop is LIFO across several pushes", () => {
  let past = pushStudioHistory([], snap(1));
  past = pushStudioHistory(past, snap(2));
  past = pushStudioHistory(past, snap(3));

  const first = popStudioHistory(past);
  assert.ok(first);
  assert.deepEqual(first.snapshot, snap(3));

  const second = popStudioHistory(first.past);
  assert.ok(second);
  assert.deepEqual(second.snapshot, snap(2));

  const third = popStudioHistory(second.past);
  assert.ok(third);
  assert.deepEqual(third.snapshot, snap(1));
  assert.deepEqual(third.past, []);
});

test("push never mutates the array it was given", () => {
  const original: StudioHistorySnapshot[] = [];
  const next = pushStudioHistory(original, snap(1));
  assert.deepEqual(original, []);
  assert.equal(next.length, 1);
});

test("pushing past the limit drops the oldest entries, keeping the most recent", () => {
  let past: StudioHistorySnapshot[] = [];
  for (let i = 1; i <= 5; i += 1) past = pushStudioHistory(past, snap(i), 3);
  assert.equal(past.length, 3);
  assert.deepEqual(past.map((entry) => entry.qubitCount), [3, 4, 5]);
});
