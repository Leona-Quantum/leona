import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHardwareSweepBindings,
  HARDWARE_SWEEP_MAX_BINDINGS,
  HARDWARE_SWEEP_MIN_BINDINGS,
} from "./studio-hardware-sweep.ts";
import type { ParsedBuilderCircuit } from "./studio-parse.ts";

const ry: ParsedBuilderCircuit = { qubitCount: 1, steps: [
  { id: "turn", gate: "RY", qubits: [0], param: "pi/4" },
  { id: "m0", gate: "M", qubits: [0] },
] };

test("a hardware sweep builds one real OpenQASM 3 program per point, using the angle Studio's own emitter would", () => {
  const bindings = buildHardwareSweepBindings({
    circuit: ry, stepId: "turn", startDegrees: 0, endDegrees: 180, points: 3,
  });
  assert.ok(Array.isArray(bindings));
  if (!Array.isArray(bindings)) return;
  assert.equal(bindings.length, 3);
  assert.deepEqual(bindings.map((b) => b.angleDegrees), [0, 90, 180]);
  assert.equal(bindings[0].label, "0.00°");
  assert.equal(bindings[1].label, "90.00°");
  // Every program is real, parseable OpenQASM 3, and the swept angle's value
  // (in radians) actually appears in the program that carries its label —
  // otherwise every point would silently submit the same circuit.
  for (const binding of bindings) {
    assert.match(binding.qasm, /^OPENQASM 3\.0;/);
    assert.match(binding.qasm, /ry\(/);
  }
  assert.notEqual(bindings[0].qasm, bindings[1].qasm);
  assert.ok(bindings[1].qasm.includes(String(Math.PI / 2)));
  // The source circuit is never mutated by building bindings for it.
  assert.equal(ry.steps[0].param, "pi/4");
});

test("the original circuit's own angle never leaks into a binding that overrides it", () => {
  const bindings = buildHardwareSweepBindings({
    circuit: ry, stepId: "turn", startDegrees: 0, endDegrees: 90, points: 2,
  });
  assert.ok(Array.isArray(bindings));
  if (!Array.isArray(bindings)) return;
  for (const binding of bindings) assert.ok(!binding.qasm.includes("pi/4"));
});

test("refuses the same circuit shapes the local ideal sweep refuses", () => {
  const custom: ParsedBuilderCircuit = { qubitCount: 1, steps: [
    { id: "c", gate: "CUSTOM", qubits: [0], customGateId: "x" },
  ] };
  assert.equal(
    buildHardwareSweepBindings({ circuit: custom, stepId: "c", startDegrees: 0, endDegrees: 90, points: 2 }),
    "custom",
  );
});

test("refuses a point count outside the hardware batch's own bounds, even where the local sweep would allow it", () => {
  assert.equal(HARDWARE_SWEEP_MIN_BINDINGS, 2);
  assert.equal(HARDWARE_SWEEP_MAX_BINDINGS, 20);
  assert.equal(
    buildHardwareSweepBindings({ circuit: ry, stepId: "turn", startDegrees: 0, endDegrees: 90, points: 1 }),
    "points",
  );
  assert.equal(
    buildHardwareSweepBindings({ circuit: ry, stepId: "turn", startDegrees: 0, endDegrees: 360, points: 21 }),
    "points",
  );
  const atMax = buildHardwareSweepBindings({
    circuit: ry, stepId: "turn", startDegrees: 0, endDegrees: 360, points: HARDWARE_SWEEP_MAX_BINDINGS,
  });
  assert.ok(Array.isArray(atMax));
  if (Array.isArray(atMax)) assert.equal(atMax.length, HARDWARE_SWEEP_MAX_BINDINGS);
});

test("an unknown step id is refused rather than falling back to the first angle gate", () => {
  assert.equal(
    buildHardwareSweepBindings({ circuit: ry, stepId: "not-a-real-step", startDegrees: 0, endDegrees: 90, points: 2 }),
    "invalid",
  );
});
