import assert from "node:assert/strict";
import test from "node:test";

import { generateBuilderCode, type BuilderStep, type CustomGateDefinition } from "./studio-builder.ts";
import { parseBuilderCircuit } from "./studio-parse.ts";
import { circuitSignature, circuitSyncState } from "./studio-sync.ts";

const bell: BuilderStep[] = [
  { id: "s1", gate: "H", qubits: [0] },
  { id: "s2", gate: "CX", qubits: [0, 1] },
  { id: "s3", gate: "M", qubits: [0] },
  { id: "s4", gate: "M", qubits: [1] },
];

test("a circuit round-tripped through generated code stays in sync", () => {
  const code = generateBuilderCode(bell, 2)["qiskit"];
  const parsed = parseBuilderCircuit(code, "qiskit");
  assert.ok(parsed);
  assert.deepEqual(circuitSyncState(parsed, { qubitCount: 2, steps: bell }), { kind: "in_sync" });
});

test("editing the code away from the diagram reports divergence", () => {
  const parsed = parseBuilderCircuit(
    "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nqc.h(0)\nqc.x(1)\n",
    "qiskit",
  );
  assert.ok(parsed);
  assert.deepEqual(circuitSyncState(parsed, { qubitCount: 2, steps: bell }), { kind: "diverged" });
});

test("source outside the builder subset is unrepresentable, not diverged", () => {
  const parsed = parseBuilderCircuit(
    "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\nfor i in range(2):\n    qc.h(i)\n",
    "qiskit",
  );
  assert.equal(parsed, null);
  assert.deepEqual(circuitSyncState(parsed, { qubitCount: 2, steps: bell }), { kind: "unrepresentable" });
});

test("an empty canvas against real code is diverged, not in sync", () => {
  // The defect this module exists for: the canvas said "0 ops" while the Code
  // tab held a Bell pair, and nothing on screen admitted the mismatch.
  const parsed = parseBuilderCircuit(generateBuilderCode(bell, 2)["qiskit"], "qiskit");
  assert.ok(parsed);
  assert.deepEqual(circuitSyncState(parsed, { qubitCount: 2, steps: [] }), { kind: "diverged" });
});

test("partial measurement does not by itself report divergence", () => {
  // generateBuilderCode emits one whole-register measure_all() however many M
  // steps are drawn, so re-parsing widens q0-only measurement to both wires.
  // That is a generator limitation; it must not masquerade as a stale canvas.
  const measureFirstOnly: BuilderStep[] = [
    { id: "s1", gate: "H", qubits: [0] },
    { id: "s2", gate: "CX", qubits: [0, 1] },
    { id: "s3", gate: "M", qubits: [0] },
  ];
  const parsed = parseBuilderCircuit(generateBuilderCode(measureFirstOnly, 2)["qiskit"], "qiskit");
  assert.ok(parsed);
  assert.deepEqual(circuitSyncState(parsed, { qubitCount: 2, steps: measureFirstOnly }), { kind: "in_sync" });
});

test("measurement position is preserved — measuring before a gate is not measuring after it", () => {
  // Only a *trailing* measurement run normalizes. Collapsing every M into one
  // flag would call these two circuits identical, and they give different
  // results. The builder cannot express mid-circuit measurement at all, so the
  // diagram genuinely disagrees with any code generated from it.
  const measureThenX: BuilderStep[] = [
    { id: "a", gate: "M", qubits: [0] },
    { id: "b", gate: "X", qubits: [0] },
  ];
  const xThenMeasure: BuilderStep[] = [
    { id: "c", gate: "X", qubits: [0] },
    { id: "d", gate: "M", qubits: [0] },
  ];
  assert.notEqual(
    circuitSignature({ qubitCount: 1, steps: measureThenX }),
    circuitSignature({ qubitCount: 1, steps: xThenMeasure }),
  );
});

test("a measured circuit and an unmeasured one are not in sync", () => {
  const unmeasured = bell.filter((step) => step.gate !== "M");
  const parsed = parseBuilderCircuit(generateBuilderCode(unmeasured, 2)["qiskit"], "qiskit");
  assert.ok(parsed);
  assert.deepEqual(circuitSyncState(parsed, { qubitCount: 2, steps: bell }), { kind: "diverged" });
});

test("custom gates are compared by what they expand to", () => {
  const definition: CustomGateDefinition = {
    id: "custom-1",
    name: "Bell prep",
    qubitCount: 2,
    steps: [
      { id: "d1", gate: "H", qubits: [0] },
      { id: "d2", gate: "CX", qubits: [0, 1] },
    ],
  };
  const grouped: BuilderStep[] = [{ id: "g1", gate: "CUSTOM", customGateId: "custom-1", qubits: [0, 1] }];
  assert.equal(
    circuitSignature({ qubitCount: 2, steps: grouped, customGates: [definition] }),
    circuitSignature({ qubitCount: 2, steps: bell.filter((step) => step.gate !== "M") }),
  );
});

test("equivalent angle spellings are not a divergence", () => {
  const a: BuilderStep[] = [{ id: "a", gate: "RZ", qubits: [0], param: "1*pi/2" }];
  const b: BuilderStep[] = [{ id: "b", gate: "RZ", qubits: [0], param: "pi/2" }];
  assert.equal(circuitSignature({ qubitCount: 1, steps: a }), circuitSignature({ qubitCount: 1, steps: b }));
});

test("qubit width is part of the signature", () => {
  assert.notEqual(
    circuitSignature({ qubitCount: 2, steps: [{ id: "a", gate: "H", qubits: [0] }] }),
    circuitSignature({ qubitCount: 3, steps: [{ id: "a", gate: "H", qubits: [0] }] }),
  );
});
