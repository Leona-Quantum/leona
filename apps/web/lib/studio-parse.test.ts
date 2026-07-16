import assert from "node:assert/strict";
import test from "node:test";

import { generateBuilderCode, type BuilderStep } from "./studio-builder.ts";
import { parseBuilderCircuit } from "./studio-parse.ts";

const steps: BuilderStep[] = [
  { id: "s1", gate: "H", qubits: [0] },
  { id: "s2", gate: "CX", qubits: [0, 1] },
  { id: "s3", gate: "RZ", qubits: [1], param: "pi/2" },
  { id: "s4", gate: "SWAP", qubits: [1, 2] },
  { id: "s5", gate: "M", qubits: [0] },
  { id: "s6", gate: "M", qubits: [1] },
  { id: "s7", gate: "M", qubits: [2] },
];

function shape(parsed: readonly BuilderStep[]): Array<{ gate: string; qubits: number[]; param?: string }> {
  return parsed.map((step) => ({ gate: step.gate, qubits: step.qubits, ...(step.param ? { param: step.param } : {}) }));
}

test("builder-generated code round-trips through the parser in every framework", () => {
  const generated = generateBuilderCode(steps, 3);
  for (const framework of ["qiskit", "pennylane", "cirq"] as const) {
    const parsed = parseBuilderCircuit(generated[framework], framework);
    assert.ok(parsed, `${framework} code should parse`);
    assert.equal(parsed.qubitCount, 3, framework);
    assert.deepEqual(shape(parsed.steps), shape(steps), framework);
  }
});

test("simple hand-written artifact code parses", () => {
  const bell = "from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(2)\nqc.h(0)\nqc.cx(0, 1)\nqc.measure_all()";
  const parsed = parseBuilderCircuit(bell, "qiskit");
  assert.ok(parsed);
  assert.equal(parsed.qubitCount, 2);
  assert.deepEqual(shape(parsed.steps), [
    { gate: "H", qubits: [0] },
    { gate: "CX", qubits: [0, 1] },
    { gate: "M", qubits: [0] },
    { gate: "M", qubits: [1] },
  ]);

  const ghz = "import pennylane as qml\n\n@qml.qnode(qml.device('default.qubit', wires=3))\ndef ghz():\n    qml.Hadamard(0)\n    qml.CNOT(wires=[0,1])\n    qml.CNOT(wires=[1,2])\n    return qml.state()";
  const parsedGhz = parseBuilderCircuit(ghz, "pennylane");
  assert.ok(parsedGhz);
  assert.equal(parsedGhz.qubitCount, 3);
  assert.deepEqual(shape(parsedGhz.steps), [
    { gate: "H", qubits: [0] },
    { gate: "CX", qubits: [0, 1] },
    { gate: "CX", qubits: [1, 2] },
  ]);
});

test("code outside the builder subset refuses to parse instead of guessing", () => {
  const looped = "from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(5)\nqc.h(range(5))\nfor a, b in [(0, 1)]:\n    qc.cx(a, b)";
  assert.equal(parseBuilderCircuit(looped, "qiskit"), null);

  const tooWide = "from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(9)\nqc.h(0)";
  assert.equal(parseBuilderCircuit(tooWide, "qiskit"), null);

  const customHelpers = generateBuilderCode(
    [{ id: "c", gate: "CUSTOM", customGateId: "g", qubits: [0, 1] }],
    2,
    [{ id: "g", name: "Bell", qubitCount: 2, steps: [{ id: "d", gate: "H", qubits: [0] }] }],
  );
  assert.equal(parseBuilderCircuit(customHelpers.qiskit, "qiskit"), null);
});

test("malformed angle literals are rejected", () => {
  for (const angle of ["2pi", "*pi", ".pi", "1.2.3", "pi/0", "2*pi/0.0"]) {
    const code = `from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(1)\nqc.rx(${angle}, 0)`;
    assert.equal(parseBuilderCircuit(code, "qiskit"), null, angle);
  }
});

test("PennyLane returns must be fully supported before reconstruction", () => {
  const unsupported = "import pennylane as qml\n\ndev = qml.device('default.qubit', wires=2)\n@qml.qnode(dev)\ndef circuit():\n    qml.Hadamard(wires=0)\n    return qml.probs(wires=[0])";
  assert.equal(parseBuilderCircuit(unsupported, "pennylane"), null);

  const subsetSample = "import pennylane as qml\n\ndev = qml.device('default.qubit', wires=2)\n@qml.qnode(dev)\ndef circuit():\n    qml.Hadamard(wires=0)\n    return qml.sample(wires=[0])";
  assert.equal(parseBuilderCircuit(subsetSample, "pennylane"), null);

  const malformed = "import pennylane as qml\n\ndev = qml.device('default.qubit', wires=1)\n@qml.qnode(dev)\ndef circuit():\n    return qml.sample() trailing";
  assert.equal(parseBuilderCircuit(malformed, "pennylane"), null);
});

test("measurement and return operations are terminal", () => {
  const qiskit = "from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(1)\nqc.measure_all()\nqc.h(0)";
  assert.equal(parseBuilderCircuit(qiskit, "qiskit"), null);

  const pennylane = "import pennylane as qml\n\ndev = qml.device('default.qubit', wires=1)\n@qml.qnode(dev)\ndef circuit():\n    return qml.sample()\n    qml.Hadamard(wires=0)";
  assert.equal(parseBuilderCircuit(pennylane, "pennylane"), null);

  const cirq = "import cirq\n\nqubits = cirq.LineQubit.range(1)\ncircuit = cirq.Circuit(\n    cirq.measure(*qubits, key='result'),\n    cirq.H(qubits[0]),\n)";
  assert.equal(parseBuilderCircuit(cirq, "cirq"), null);

  const closedCirq = "import cirq\n\nqubits = cirq.LineQubit.range(1)\ncircuit = cirq.Circuit()\ncirq.H(qubits[0])";
  assert.equal(parseBuilderCircuit(closedCirq, "cirq"), null);
});
