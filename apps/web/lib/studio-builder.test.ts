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

test("custom gates emit named helpers or flattened operations in all seven frameworks", () => {
  const generated = generateBuilderCode(steps, 2, [customGate]);

  assert.match(generated.qiskit, /def custom_bell_pair_abc123\(qc, qubits\):/);
  assert.match(generated.qiskit, /custom_bell_pair_abc123\(qc, \[0, 1\]\)/);
  assert.match(generated.pennylane, /def custom_bell_pair_abc123\(wires\):/);
  assert.match(generated.pennylane, /custom_bell_pair_abc123\(\[0, 1\]\)/);
  assert.match(generated.cirq, /def custom_bell_pair_abc123\(qubits\):/);
  assert.match(generated.cirq, /\*custom_bell_pair_abc123\(\[qubits\[0\], qubits\[1\]\]\)/);
  assert.match(generated.cudaq, /h\(q\[0\]\)/);
  assert.match(generated.cudaq, /x\.ctrl\(q\[0\], q\[1\]\)/);
  assert.match(generated.braket, /circuit\.cnot\(0, 1\)/);
  assert.match(generated.openqasm3, /OPENQASM 3\.0;/);
  assert.match(generated.openqasm3, /cx q\[0\], q\[1\];/);
  assert.match(generated.pyquil, /program \+= CNOT\(0, 1\)/);
  assert.match(generated.pyquil, /program \+= MEASURE\(1, ro\[1\]\)/);
});

test("nested custom gates flatten recursively and cyclic definitions terminate safely", () => {
  const inner: CustomGateDefinition = {
    id: "inner",
    name: "Inner",
    qubitCount: 2,
    steps: [
      { id: "inner-h", gate: "H", qubits: [1] },
      { id: "inner-cx", gate: "CX", qubits: [1, 0] },
    ],
  };
  const outer: CustomGateDefinition = {
    id: "outer",
    name: "Outer",
    qubitCount: 2,
    steps: [{ id: "outer-inner", gate: "CUSTOM", customGateId: inner.id, qubits: [0, 1] }],
  };
  const cycleA: CustomGateDefinition = {
    id: "cycle-a",
    name: "Cycle A",
    qubitCount: 1,
    steps: [{ id: "a-b", gate: "CUSTOM", customGateId: "cycle-b", qubits: [0] }],
  };
  const cycleB: CustomGateDefinition = {
    id: "cycle-b",
    name: "Cycle B",
    qubitCount: 1,
    steps: [{ id: "b-a", gate: "CUSTOM", customGateId: "cycle-a", qubits: [0] }],
  };
  const generated = generateBuilderCode([
    { id: "outer-step", gate: "CUSTOM", customGateId: outer.id, qubits: [0, 1] },
    { id: "cycle-step", gate: "CUSTOM", customGateId: cycleA.id, qubits: [0] },
  ], 2, [outer, inner, cycleA, cycleB]);

  for (const source of [generated.cudaq, generated.braket, generated.openqasm3, generated.pyquil]) {
    assert.match(source, /(?:h\(q\[1\]\)|circuit\.h\(1\)|h q\[1\];|program \+= H\(1\))/);
    assert.match(source, /(?:q\[1\].*q\[0\]|1, 0|q\[1\], q\[0\]|CNOT\(1, 0\))/);
    assert.doesNotMatch(source, /cycle_a|cycle_b/i);
  }
  assert.match(generated.qiskit, /def custom_inner_inner/);
  assert.match(generated.qiskit, /custom_inner_inner\(qc, \[qubits\[0\], qubits\[1\]\]\)/);
});

test("Qmod emits Classiq's Python-embedded form with its documented gate signatures", () => {
  const generated = generateBuilderCode([
    { id: "h", gate: "H", qubits: [0] },
    { id: "cx", gate: "CX", qubits: [0, 1] },
    { id: "cz", gate: "CZ", qubits: [1, 2] },
    { id: "swap", gate: "SWAP", qubits: [0, 2] },
    { id: "rz", gate: "RZ", qubits: [2], param: "pi/4" },
    { id: "s", gate: "S", qubits: [1] },
    { id: "m0", gate: "M", qubits: [0] },
  ], 3);

  assert.match(generated.qmod, /^from classiq import \*$/m);
  // Classiq's own symbolic pi, not numpy's: the angle is a Qmod expression.
  assert.match(generated.qmod, /^from classiq\.qmod\.symbolic import pi$/m);
  assert.match(generated.qmod, /^@qfunc$/m);
  assert.match(generated.qmod, /^def main\(q: Output\[QArray\[QBit\]\]\) -> None:$/m);
  assert.match(generated.qmod, /^ {4}allocate\(3, q\)$/m);
  // Argument order per Classiq's standard-gate reference: (theta, target) for
  // rotations, (control, target) for CX/CZ, (qbit0, qbit1) for SWAP.
  assert.match(generated.qmod, /^ {4}RZ\(pi\/4, q\[2\]\)$/m);
  assert.match(generated.qmod, /^ {4}CX\(q\[0\], q\[1\]\)$/m);
  assert.match(generated.qmod, /^ {4}CZ\(q\[1\], q\[2\]\)$/m);
  assert.match(generated.qmod, /^ {4}SWAP\(q\[0\], q\[2\]\)$/m);
  assert.match(generated.qmod, /^ {4}S\(q\[1\]\)$/m);
  assert.match(generated.qmod, /^qprog = synthesize\(create_model\(main\)\)$/m);
  // A Qmod model has no measure gate; execution samples the Output qubits. The
  // pattern is anchored to a call rather than the bare word so the explanatory
  // comment in the emitted source does not satisfy its own assertion.
  assert.doesNotMatch(generated.qmod, /^\s*\S*measure\S*\(/im);
  assert.match(generated.qmod, /execute\(qprog\)\.result_value\(\)\.counts/);
});

test("an unmeasured Qmod model synthesizes without an execution call", () => {
  const generated = generateBuilderCode([{ id: "h", gate: "H", qubits: [0] }], 1);

  assert.match(generated.qmod, /^qprog = synthesize\(create_model\(main\)\)$/m);
  assert.doesNotMatch(generated.qmod, /execute\(/);
  // No angles used, so Classiq's symbolic pi is not imported.
  assert.doesNotMatch(generated.qmod, /symbolic import pi/);
});
