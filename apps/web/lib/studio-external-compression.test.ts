import assert from "node:assert/strict";
import test from "node:test";

import {
  angleRadians,
  builderStepsFromExternalResult,
  circuitOptimizationRequest,
  externalOptimizationResultFromEvent,
} from "./studio-external-compression.ts";

test("Studio serializes only bound built-in operations for the Worker compiler lane", () => {
  const request = circuitOptimizationRequest("pytket", 2, [
    { id: "h", gate: "H", qubits: [0] },
    { id: "rz", gate: "RZ", qubits: [1], param: "-3*pi/4" },
    { id: "cx", gate: "CX", qubits: [0, 1] },
  ], 3);

  assert.equal(request.compiler, "pytket");
  assert.equal(request.operations[1].angle_radians, -3 * Math.PI / 4);
  assert.equal(request.optimization_level, 3);
});

test("Studio refuses custom gates and unbound angles before queueing a compiler job", () => {
  assert.throws(
    () => circuitOptimizationRequest("qiskit", 1, [
      { id: "custom", gate: "CUSTOM", customGateId: "opaque", qubits: [0] },
    ]),
    /custom gates/,
  );
  assert.throws(
    () => circuitOptimizationRequest("qiskit", 1, [
      { id: "rotation", gate: "RX", param: "theta", qubits: [0] },
    ]),
    /bound numeric angle/,
  );
});

test("angle conversion accepts signed radians and pi fractions", () => {
  assert.equal(angleRadians("-0.25"), -0.25);
  assert.equal(angleRadians("pi/2"), Math.PI / 2);
  assert.equal(angleRadians("-2*pi/3"), -2 * Math.PI / 3);
  assert.equal(angleRadians("pi/0"), null);
});

test("Studio accepts only typed successful compilation events and rebuilds editable steps", () => {
  const result = externalOptimizationResultFromEvent({
    type: "compilation.result",
    accepted: true,
    compatibility: {
      circuit_optimization: {
        compiler: "pyzx",
        compiler_version: "0.10.5",
        optimization_level: 2,
        operations: [{ gate: "RZ", qubits: [1], angle_radians: Math.PI / 2 }],
        before: { qubits: 2, depth: 4, gate_count: 6, two_qubit_gate_count: 2, measurement_count: 0, estimated_runtime_ms: null },
        after: { qubits: 2, depth: 1, gate_count: 1, two_qubit_gate_count: 0, measurement_count: 0, estimated_runtime_ms: null },
        input_fingerprint: "a".repeat(64),
        output_fingerprint: "b".repeat(64),
        equivalence: "unitary_up_to_global_phase",
        warnings: ["Unverified compiler output."],
      },
    },
  });

  assert.ok(result);
  const steps = builderStepsFromExternalResult(result);
  assert.equal(steps[0].gate, "RZ");
  assert.equal(steps[0].param, String(Number((Math.PI / 2).toPrecision(12))));
  assert.equal(externalOptimizationResultFromEvent({ type: "compilation.result", accepted: false }), null);
});
