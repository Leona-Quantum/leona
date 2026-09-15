import assert from "node:assert/strict";
import test from "node:test";

import { circuitChangeSummary } from "./circuit-change-summary.ts";
import type { BuilderStep } from "./studio-builder.ts";

function step(gate: BuilderStep["gate"], qubits: number[], id = "s"): BuilderStep {
  return { id, gate, qubits };
}

test("identical circuits report unchanged with no added or removed gates", () => {
  const steps: BuilderStep[] = [step("H", [0]), step("CX", [0, 1])];
  const summary = circuitChangeSummary(steps, steps);
  assert.equal(summary.unchanged, true);
  assert.deepEqual(summary.added, []);
  assert.deepEqual(summary.removed, []);
});

test("a gate added and a gate removed are both reported, counted and sorted by name", () => {
  const before: BuilderStep[] = [step("H", [0]), step("CX", [0, 1]), step("M", [0])];
  const after: BuilderStep[] = [step("H", [0]), step("H", [1]), step("CZ", [0, 1]), step("M", [0])];
  const summary = circuitChangeSummary(before, after);
  assert.equal(summary.unchanged, false);
  assert.deepEqual(summary.added, [{ gate: "CZ", count: 1 }, { gate: "H", count: 1 }]);
  assert.deepEqual(summary.removed, [{ gate: "CX", count: 1 }]);
});

test("counts, not identity — swapping which qubit two identical gates sit on reports no change", () => {
  const before: BuilderStep[] = [step("H", [0], "a"), step("H", [1], "b")];
  const after: BuilderStep[] = [step("H", [1], "c"), step("H", [0], "d")];
  const summary = circuitChangeSummary(before, after);
  assert.equal(summary.unchanged, true);
});

test("an empty circuit compared to itself is unchanged, and compared to gates is fully added", () => {
  assert.equal(circuitChangeSummary([], []).unchanged, true);
  const summary = circuitChangeSummary([], [step("H", [0]), step("H", [0])]);
  assert.deepEqual(summary.added, [{ gate: "H", count: 2 }]);
  assert.deepEqual(summary.removed, []);
});

test("removing everything reports every gate as removed and nothing added", () => {
  const before: BuilderStep[] = [step("H", [0]), step("CX", [0, 1])];
  const summary = circuitChangeSummary(before, []);
  assert.deepEqual(summary.added, []);
  assert.deepEqual(summary.removed, [{ gate: "CX", count: 1 }, { gate: "H", count: 1 }]);
});
