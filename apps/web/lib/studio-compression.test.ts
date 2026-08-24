import assert from "node:assert/strict";
import test from "node:test";

import {
  circuitCompressionMetrics,
  compressCircuit,
} from "./studio-compression.ts";
import type { BuilderStep } from "./studio-builder.ts";

test("inverse cancellation removes exact pairs across only disjoint work", () => {
  const steps: BuilderStep[] = [
    { id: "h0-a", gate: "H", qubits: [0] },
    { id: "x1", gate: "X", qubits: [1] },
    { id: "h0-b", gate: "H", qubits: [0] },
    { id: "cx-a", gate: "CX", qubits: [0, 1] },
    { id: "z2", gate: "Z", qubits: [2] },
    { id: "cx-b", gate: "CX", qubits: [0, 1] },
  ];

  const result = compressCircuit(steps, "inverse_cancellation");

  assert.deepEqual(result.steps.map((step) => step.id), ["x1", "z2"]);
  assert.equal(result.removedOperations, 4);
  assert.equal(result.changed, true);
});

test("a touching operation and an opaque custom gate block cancellation", () => {
  const steps: BuilderStep[] = [
    { id: "h-a", gate: "H", qubits: [0] },
    { id: "x", gate: "X", qubits: [0] },
    { id: "h-b", gate: "H", qubits: [0] },
    { id: "z-a", gate: "Z", qubits: [1] },
    { id: "custom", gate: "CUSTOM", customGateId: "opaque", qubits: [1] },
    { id: "z-b", gate: "Z", qubits: [1] },
  ];

  assert.deepEqual(compressCircuit(steps, "inverse_cancellation").steps, steps);
});

test("rotation folding combines like axes and removes exact zero rotations", () => {
  const steps: BuilderStep[] = [
    { id: "rx-a", gate: "RX", qubits: [0], param: "pi/4" },
    { id: "h1", gate: "H", qubits: [1] },
    { id: "rx-b", gate: "RX", qubits: [0], param: "3*pi/4" },
    { id: "rz-a", gate: "RZ", qubits: [1], param: "0.25" },
    { id: "rz-b", gate: "RZ", qubits: [1], param: "-0.25" },
    { id: "zero", gate: "RY", qubits: [2], param: "0*pi" },
  ];

  const result = compressCircuit(steps, "rotation_folding");

  assert.deepEqual(result.steps, [
    { id: "rx-a", gate: "RX", qubits: [0], param: "pi" },
    { id: "h1", gate: "H", qubits: [1] },
  ]);
});

test("pattern rewriting folds phase powers, basis sandwiches, and CX swap synthesis", () => {
  const steps: BuilderStep[] = [
    { id: "t-a", gate: "T", qubits: [2] },
    { id: "t-b", gate: "T", qubits: [2] },
    { id: "h-a", gate: "H", qubits: [0] },
    { id: "x", gate: "X", qubits: [0] },
    { id: "h-b", gate: "H", qubits: [0] },
    { id: "cx-a", gate: "CX", qubits: [0, 1] },
    { id: "cx-b", gate: "CX", qubits: [1, 0] },
    { id: "cx-c", gate: "CX", qubits: [0, 1] },
  ];

  assert.deepEqual(
    compressCircuit(steps, "pattern_rewrite").steps.map(({ gate, qubits }) => ({ gate, qubits })),
    [
      { gate: "S", qubits: [2] },
      { gate: "Z", qubits: [0] },
      { gate: "SWAP", qubits: [0, 1] },
    ],
  );
});

test("balanced compression repeats passes until new identities also disappear", () => {
  const steps: BuilderStep[] = [
    { id: "h-a", gate: "H", qubits: [0] },
    { id: "x", gate: "X", qubits: [0] },
    { id: "h-b", gate: "H", qubits: [0] },
    { id: "z", gate: "Z", qubits: [0] },
  ];

  const result = compressCircuit(steps, "balanced");

  assert.deepEqual(result.steps, []);
  assert.deepEqual(result.after, { operations: 0, depth: 0, twoQubitOperations: 0 });
});

test("metrics report parallel depth rather than mistaking gate count for depth", () => {
  const steps: BuilderStep[] = [
    { id: "h0", gate: "H", qubits: [0] },
    { id: "h1", gate: "H", qubits: [1] },
    { id: "cx", gate: "CX", qubits: [0, 1] },
    { id: "x2", gate: "X", qubits: [2] },
  ];

  assert.deepEqual(circuitCompressionMetrics(steps), {
    operations: 4,
    depth: 2,
    twoQubitOperations: 1,
  });
});
