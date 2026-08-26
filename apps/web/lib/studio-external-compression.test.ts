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

/**
 * The response-side contract check, one rejected shape per assertion.
 *
 * Every one of these was ACCEPTED before this test existed — `isOperation` asked
 * only that `gate` be a string and that the qubit indices be non-negative
 * integers, so a gate outside the closed 13-member enum, a two-qubit gate on one
 * wire, a `CX` on the same wire twice and a `Z` carrying a rotation angle all
 * passed and became `BuilderStep`s in the reader's circuit.
 *
 * Written as one operation per case rather than one big malformed payload,
 * because a single payload violating four rules passes a test that only checks
 * the first rule it happens to hit.
 */
test("Studio refuses a compiled operation that violates the gate contract", () => {
  const wire = (operations: unknown[]) => ({
    type: "compilation.result",
    accepted: true,
    compatibility: {
      circuit_optimization: {
        compiler: "pyzx",
        compiler_version: "0.10.5",
        optimization_level: 2,
        operations,
        before: { qubits: 2, depth: 4, gate_count: 6, two_qubit_gate_count: 2, measurement_count: 0, estimated_runtime_ms: null },
        after: { qubits: 2, depth: 1, gate_count: 1, two_qubit_gate_count: 0, measurement_count: 0, estimated_runtime_ms: null },
        input_fingerprint: "a".repeat(64),
        output_fingerprint: "b".repeat(64),
        equivalence: "unitary_up_to_global_phase",
        warnings: [],
      },
    },
  });

  // The control: a legal operation still passes, so a blanket refusal cannot
  // make every assertion below pass for the wrong reason.
  assert.ok(externalOptimizationResultFromEvent(wire([{ gate: "H", qubits: [0], angle_radians: null }])));
  assert.ok(externalOptimizationResultFromEvent(wire([{ gate: "CX", qubits: [0, 1], angle_radians: null }])));

  const refused: [string, unknown][] = [
    ["a gate outside the 13-member enum", { gate: "TOFFOLI", qubits: [0], angle_radians: null }],
    ["a lowercase member of the enum", { gate: "h", qubits: [0], angle_radians: null }],
    ["a two-qubit gate on one wire", { gate: "CX", qubits: [0], angle_radians: null }],
    ["a two-qubit gate on the same wire twice", { gate: "CZ", qubits: [1, 1], angle_radians: null }],
    ["a one-qubit gate on two wires", { gate: "H", qubits: [0, 1], angle_radians: null }],
    ["a rotation with no angle", { gate: "RZ", qubits: [0], angle_radians: null }],
    ["a rotation with a non-finite angle", { gate: "RX", qubits: [0], angle_radians: Number.NaN }],
    ["a non-rotation carrying an angle", { gate: "Z", qubits: [0], angle_radians: 1.5 }],
    ["a negative qubit index", { gate: "X", qubits: [-1], angle_radians: null }],
    ["a three-qubit operation", { gate: "SWAP", qubits: [0, 1, 2], angle_radians: null }],
  ];

  for (const [why, operation] of refused) {
    assert.equal(externalOptimizationResultFromEvent(wire([operation])), null, `accepted ${why}`);
  }
});
