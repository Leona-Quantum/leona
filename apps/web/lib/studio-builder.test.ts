import assert from "node:assert/strict";
import test from "node:test";

import { generateBuilderCode, type CustomGateDefinition, type BuilderStep } from "./studio-builder.ts";

const customGate: CustomGateDefinition = {
  id: "custom-abc123",
  name: "Bell pair",
  qubitCount: 2,
  steps: [
    { id: "definition-h", gate: "H", qubits: [0] },
    { id: "definition-cx", gate: "CX", qubits: [0, 1] },
  ],
};

const steps: BuilderStep[] = [
  { id: "custom-step", gate: "CUSTOM", customGateId: customGate.id, qubits: [0, 1] },
  { id: "measurement", gate: "M", qubits: [0] },
];

test("custom gates emit named helper definitions in every supported framework", () => {
  const generated = generateBuilderCode(steps, 2, [customGate]);

  assert.match(generated.qiskit, /def custom_bell_pair_abc123\(qc, qubits\):/);
  assert.match(generated.qiskit, /custom_bell_pair_abc123\(qc, \[0, 1\]\)/);
  assert.match(generated.pennylane, /def custom_bell_pair_abc123\(wires\):/);
  assert.match(generated.pennylane, /custom_bell_pair_abc123\(\[0, 1\]\)/);
  assert.match(generated.cirq, /def custom_bell_pair_abc123\(qubits\):/);
  assert.match(generated.cirq, /\*custom_bell_pair_abc123\(\[qubits\[0\], qubits\[1\]\]\)/);
});
