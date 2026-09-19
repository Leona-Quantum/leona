import assert from "node:assert/strict";
import test from "node:test";

import { generateBuilderCode, type BuilderStep } from "./studio-builder.ts";
import { parseBuilderCircuit } from "./studio-parse.ts";
import { circuitSignature } from "./studio-sync.ts";

const steps: BuilderStep[] = [
  { id: "s1", gate: "H", qubits: [0] },
  { id: "s2", gate: "CX", qubits: [0, 1] },
  { id: "s3", gate: "RZ", qubits: [1], param: "pi/2" },
  { id: "s4", gate: "SWAP", qubits: [1, 2] },
  { id: "s8", gate: "SDG", qubits: [0] },
  { id: "s9", gate: "TDG", qubits: [1] },
  { id: "s10", gate: "P", qubits: [2], param: "pi/4" },
  { id: "s11", gate: "CP", qubits: [0, 1], param: "pi/3" },
  { id: "s12", gate: "RZZ", qubits: [1, 2], param: "pi/6" },
  { id: "s13", gate: "CCX", qubits: [0, 1, 2] },
  { id: "s5", gate: "M", qubits: [0] },
  { id: "s6", gate: "M", qubits: [1] },
  { id: "s7", gate: "M", qubits: [2] },
];

function shape(parsed: readonly BuilderStep[]): Array<{ gate: string; qubits: number[]; param?: string }> {
  return parsed.map((step) => ({ gate: step.gate, qubits: step.qubits, ...(step.param ? { param: step.param } : {}) }));
}

test("builder-generated executable and interchange code round-trips through the parser", () => {
  const generated = generateBuilderCode(steps, 3);
  for (const framework of ["qiskit", "pennylane", "cirq", "openqasm3"] as const) {
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

  const customHelpers = generateBuilderCode(
    [{ id: "c", gate: "CUSTOM", customGateId: "g", qubits: [0, 1] }],
    2,
    [{ id: "g", name: "Bell", qubitCount: 2, steps: [{ id: "d", gate: "H", qubits: [0] }] }],
  );
  assert.equal(parseBuilderCircuit(customHelpers.qiskit, "qiskit"), null);
});

test("editor parsing has no arbitrary qubit ceiling while callers can impose a budget", () => {
  const wide = "from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(1000)\nqc.h(999)";
  const parsed = parseBuilderCircuit(wide, "qiskit");
  assert.ok(parsed);
  assert.equal(parsed.qubitCount, 1000);
  assert.deepEqual(parsed.steps[0].qubits, [999]);
  assert.equal(parseBuilderCircuit(wide, "qiskit", 24), null);
});

test("malformed angle literals are rejected", () => {
  for (const angle of ["2pi", "*pi", ".pi", "1.2.3", "pi/0", "2*pi/0.0"]) {
    const code = `from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(1)\nqc.rx(${angle}, 0)`;
    assert.equal(parseBuilderCircuit(code, "qiskit"), null, angle);
  }
});

test("signed and scientific bound angles round-trip from framework observations", () => {
  const code = "from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(1)\nqc.rx(-1e-05, 0)\nqc.rz(-pi/2, 0)";
  const parsed = parseBuilderCircuit(code, "qiskit");
  assert.ok(parsed);
  assert.deepEqual(shape(parsed.steps), [
    { gate: "RX", qubits: [0], param: "-1e-05" },
    { gate: "RZ", qubits: [0], param: "-pi/2" },
  ]);
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

test("OpenQASM comments and declarations preserve the bounded parser contract", () => {
  const commented = `OPENQASM 3.0;
include "stdgates.inc";
/* prepare a Bell state
   over the two declared qubits */
qubit[2] q;
bit[2] c;
// Entangle the register.
h q[0];
cx q[0], q[1];
c = measure q;`;
  const parsed = parseBuilderCircuit(commented, "openqasm3");
  assert.ok(parsed);
  assert.equal(parsed.qubitCount, 2);
  assert.deepEqual(shape(parsed.steps), [
    { gate: "H", qubits: [0] },
    { gate: "CX", qubits: [0, 1] },
    { gate: "M", qubits: [0] },
    { gate: "M", qubits: [1] },
  ]);

  const missingBits = "OPENQASM 3.0;\nqubit[1] q;\nc = measure q;";
  const mismatchedBits = "OPENQASM 3.0;\nqubit[1] q;\nbit[0] c;\nc = measure q;";
  const outOfRange = "OPENQASM 3.0;\nqubit[1] q;\nx q[1];";
  assert.equal(parseBuilderCircuit(missingBits, "openqasm3"), null);
  assert.equal(parseBuilderCircuit(mismatchedBits, "openqasm3"), null);
  assert.equal(parseBuilderCircuit(outOfRange, "openqasm3"), null);
});

// The format most published circuits actually ship in. These are the four
// listings the brief asks for: a Bell pair, a textbook 3-qubit QFT written
// with cu1/swap, a Toffoli, and a 2-qubit Grover iteration in the H-X-CZ-X-H
// diffuser form every textbook uses.
const OPENQASM2_BELL = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q[0] -> c[0];
measure q[1] -> c[1];`;

const OPENQASM2_QFT3 = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
h q[0];
cu1(pi/2) q[1],q[0];
cu1(pi/4) q[2],q[0];
h q[1];
cu1(pi/2) q[2],q[1];
h q[2];
swap q[0],q[2];
measure q[0] -> c[0];
measure q[1] -> c[1];
measure q[2] -> c[2];`;

const OPENQASM2_TOFFOLI = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
ccx q[0],q[1],q[2];
measure q[0] -> c[0];
measure q[1] -> c[1];
measure q[2] -> c[2];`;

const OPENQASM2_GROVER2 = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
h q[1];
cz q[0],q[1];
h q[0];
h q[1];
x q[0];
x q[1];
cz q[0],q[1];
x q[0];
x q[1];
h q[0];
h q[1];
measure q[0] -> c[0];
measure q[1] -> c[1];`;

test("OpenQASM 2.0 parses the four required textbook listings", () => {
  const bell = parseBuilderCircuit(OPENQASM2_BELL, "openqasm2");
  assert.ok(bell);
  assert.equal(bell.qubitCount, 2);
  assert.deepEqual(shape(bell.steps), [
    { gate: "H", qubits: [0] },
    { gate: "CX", qubits: [0, 1] },
    { gate: "M", qubits: [0] },
    { gate: "M", qubits: [1] },
  ]);

  const qft3 = parseBuilderCircuit(OPENQASM2_QFT3, "openqasm2");
  assert.ok(qft3);
  assert.equal(qft3.qubitCount, 3);
  assert.deepEqual(shape(qft3.steps), [
    { gate: "H", qubits: [0] },
    { gate: "CP", qubits: [1, 0], param: "pi/2" },
    { gate: "CP", qubits: [2, 0], param: "pi/4" },
    { gate: "H", qubits: [1] },
    { gate: "CP", qubits: [2, 1], param: "pi/2" },
    { gate: "H", qubits: [2] },
    { gate: "SWAP", qubits: [0, 2] },
    { gate: "M", qubits: [0] },
    { gate: "M", qubits: [1] },
    { gate: "M", qubits: [2] },
  ]);

  const toffoli = parseBuilderCircuit(OPENQASM2_TOFFOLI, "openqasm2");
  assert.ok(toffoli);
  assert.equal(toffoli.qubitCount, 3);
  assert.deepEqual(shape(toffoli.steps), [
    { gate: "CCX", qubits: [0, 1, 2] },
    { gate: "M", qubits: [0] },
    { gate: "M", qubits: [1] },
    { gate: "M", qubits: [2] },
  ]);

  const grover2 = parseBuilderCircuit(OPENQASM2_GROVER2, "openqasm2");
  assert.ok(grover2);
  assert.equal(grover2.qubitCount, 2);
  assert.deepEqual(shape(grover2.steps), [
    { gate: "H", qubits: [0] },
    { gate: "H", qubits: [1] },
    { gate: "CZ", qubits: [0, 1] },
    { gate: "H", qubits: [0] },
    { gate: "H", qubits: [1] },
    { gate: "X", qubits: [0] },
    { gate: "X", qubits: [1] },
    { gate: "CZ", qubits: [0, 1] },
    { gate: "X", qubits: [0] },
    { gate: "X", qubits: [1] },
    { gate: "H", qubits: [0] },
    { gate: "H", qubits: [1] },
    { gate: "M", qubits: [0] },
    { gate: "M", qubits: [1] },
  ]);
});

test("OpenQASM 2.0 round-trips through the OpenQASM 3 emitter with the same structural signature", () => {
  for (const source of [OPENQASM2_BELL, OPENQASM2_QFT3, OPENQASM2_TOFFOLI, OPENQASM2_GROVER2]) {
    const parsed = parseBuilderCircuit(source, "openqasm2");
    assert.ok(parsed, source);
    const generated = generateBuilderCode(parsed.steps, parsed.qubitCount).openqasm3;
    const reparsed = parseBuilderCircuit(generated, "openqasm3");
    assert.ok(reparsed, generated);
    assert.equal(
      circuitSignature({ qubitCount: reparsed.qubitCount, steps: reparsed.steps }),
      circuitSignature({ qubitCount: parsed.qubitCount, steps: parsed.steps }),
      source,
    );
  }
});

test("OpenQASM 2.0 stays fail-closed on a gate definition, `if`, `reset`, u2/u3, and a second register", () => {
  const withGateDefinition = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
gate foo a { h a; }
foo q[0];`;
  assert.equal(parseBuilderCircuit(withGateDefinition, "openqasm2"), null);

  const withIf = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
creg c[1];
h q[0];
if(c==1) x q[0];`;
  assert.equal(parseBuilderCircuit(withIf, "openqasm2"), null);

  const withReset = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
h q[0];
reset q[0];`;
  assert.equal(parseBuilderCircuit(withReset, "openqasm2"), null);

  const withU3 = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
u3(pi/2, 0, pi) q[0];`;
  assert.equal(parseBuilderCircuit(withU3, "openqasm2"), null);

  const withU2 = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
u2(0, pi) q[0];`;
  assert.equal(parseBuilderCircuit(withU2, "openqasm2"), null);

  const secondQreg = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
qreg r[1];
h q[0];`;
  assert.equal(parseBuilderCircuit(secondQreg, "openqasm2"), null);

  const partialMeasurement = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
h q[1];
measure q[0] -> c[0];`;
  assert.equal(parseBuilderCircuit(partialMeasurement, "openqasm2"), null);
});
