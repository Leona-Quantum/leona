import assert from "node:assert/strict";
import test from "node:test";

import { CIRCUIT_FRAMEWORKS } from "./circuit-frameworks.ts";
import {
  allCircuitConversionResults,
  convertCircuitSource,
  generatePortableCircuitCode,
  parseInterchangeCircuit,
  reconstructInterchangeCircuit,
} from "./circuit-conversion.ts";
import { MAX_VIEWABLE_QUBITS, MAX_VIEWABLE_STEPS } from "./studio-parse.ts";

test("portable circuits emit non-empty source for all seven framework targets", () => {
  const generated = generatePortableCircuitCode({
    qubitCount: 2,
    steps: [
      { gate: "H", qubits: [0] },
      { gate: "CX", qubits: [0, 1] },
      { gate: "RZ", qubits: [1], param: "pi/4" },
    ],
    measure: true,
  });

  for (const framework of CIRCUIT_FRAMEWORKS) {
    assert.ok(generated[framework.key].trim(), framework.label);
  }
  assert.match(generated.cudaq, /x\.ctrl/);
  assert.match(generated.braket, /circuit\.cnot/);
  assert.match(generated.openqasm3, /c = measure q;/);
  assert.match(generated.pyquil, /MEASURE/);
});

test("OpenQASM standard gates emit direct target source instead of a runtime recipe", () => {
  const qasm = `OPENQASM 3.0;
include "stdgates.inc";
qubit[3] q;
p(pi/4) q[0];
U(pi/2, 0, pi) q[1];
sx q[2];
cp(pi/2) q[0], q[1];
ch q[0], q[1];
ccx q[0], q[1], q[2];
cswap q[0], q[1], q[2];
iswap q[0], q[1];
id q[0];
sdg q[1];
tdg q[2];
cy q[0], q[1];
crz(pi/2) q[0], q[1];
rzz(pi/2) q[0], q[1];
rxx(pi/2) q[0], q[1];
ecr q[0], q[1];
ccz q[0], q[1], q[2];
ctrl @ x q[0], q[1];`;
  const conversions = allCircuitConversionResults(qasm, "openqasm3", qasm);

  for (const framework of CIRCUIT_FRAMEWORKS) {
    const conversion = conversions[framework.key];
    assert.ok(conversion, framework.label);
    assert.equal(conversion.fidelity, "standard_gate_decomposition", framework.label);
    assert.doesNotMatch(conversion.code, /print\(circuit\)|qbraid|from_qasm3/i, framework.label);
  }
  assert.match(conversions.qiskit!.code, /qc\.rz/);
  assert.match(conversions.pennylane!.code, /qml\.RZ/);
  assert.match(conversions.cirq!.code, /cirq\.rz/);
  assert.match(conversions.openqasm3!.code, /OPENQASM 3\.0/);
});

test("OpenQASM outside the standard-gate subset is not presented as a converted circuit", () => {
  const qasm = `OPENQASM 3.0;
include "stdgates.inc";
qubit[2] data;
for uint i in [0:1] {
  h data[i];
}`;
  assert.equal(convertCircuitSource(qasm, "openqasm3", "cirq", qasm), null);
});

test("generated scalar OpenQASM registers convert through the bounded standard-gate path", () => {
  const qasm = `OPENQASM 3.0;
include "stdgates.inc";
qubit _qubit0;
p(pi/4) _qubit0;
bit _bit0;
_bit0 = measure _qubit0;`;

  const conversion = convertCircuitSource("qc.p(np.pi / 4, 0)", "qiskit", "qiskit", qasm);

  assert.ok(conversion);
  assert.equal(conversion.fidelity, "standard_gate_decomposition");
  assert.match(conversion.code, /qc\.rz/);
  assert.match(conversion.code, /qc\.measure_all\(\)/);
  assert.match(conversion.note, /global phase/i);
});

test("interchange reconstruction reads the Qiskit qasm3 measure_all shape (meas register, per-qubit measure)", () => {
  // This is what qiskit.qasm3.dumps emits for a QuantumCircuit built with
  // measure_all(): a classical register literally named `meas` and per-qubit
  // measurement with a barrier — the exact shape every LLM-run artifact stores
  // and the strict editable parser rejects.
  const qasm = `OPENQASM 3.0;
include "stdgates.inc";
bit[2] meas;
qubit[2] q;
h q[0];
cx q[0], q[1];
barrier q[0], q[1];
meas[0] = measure q[0];
meas[1] = measure q[1];`;
  const circuit = parseInterchangeCircuit(qasm);
  assert.ok(circuit, "a Bell pair from qiskit.qasm3.dumps must reconstruct");
  assert.equal(circuit.qubitCount, 2);
  assert.deepEqual(circuit.steps.map((step) => step.gate), ["H", "CX", "M", "M"]);
  assert.deepEqual(circuit.steps.filter((step) => step.gate === "M").flatMap((step) => step.qubits), [0, 1]);
});

test("interchange reconstruction accepts permuted per-qubit measurement and the arrow form", () => {
  const assignPermuted = `OPENQASM 3.0;
include "stdgates.inc";
bit[2] c;
qubit[3] q;
h q[0];
cx q[0], q[2];
c[0] = measure q[2];
c[1] = measure q[0];`;
  const assigned = parseInterchangeCircuit(assignPermuted);
  assert.ok(assigned);
  assert.equal(assigned.qubitCount, 3);
  // Measured wires are q0 and q2 regardless of which classical bit they land in.
  assert.deepEqual(assigned.steps.filter((s) => s.gate === "M").flatMap((s) => s.qubits), [0, 2]);

  const arrow = `OPENQASM 3.0;
include "stdgates.inc";
bit[2] c;
qubit[2] q;
h q[0];
cx q[0], q[1];
measure q[0] -> c[0];
measure q[1] -> c[1];`;
  const arrowed = parseInterchangeCircuit(arrow);
  assert.ok(arrowed);
  assert.deepEqual(arrowed.steps.filter((s) => s.gate === "M").flatMap((s) => s.qubits), [0, 1]);
});

test("interchange reconstruction reaches beyond the six-wire editable builder", () => {
  const wires = 10;
  const lines = [
    "OPENQASM 3.0;",
    "include \"stdgates.inc\";",
    `bit[${wires}] meas;`,
    `qubit[${wires}] q;`,
    "h q[0];",
    ...Array.from({ length: wires - 1 }, (_, i) => `cx q[${i}], q[${i + 1}];`),
    ...Array.from({ length: wires }, (_, i) => `meas[${i}] = measure q[${i}];`),
  ];
  const circuit = parseInterchangeCircuit(lines.join("\n"));
  assert.ok(circuit, "a 10-qubit GHZ must reconstruct for read-only display");
  assert.equal(circuit.qubitCount, 10);

  // Above the parser ceiling it fails closed rather than drawing a partial circuit.
  assert.equal(parseInterchangeCircuit(lines.join("\n"), 8), null);
});

test("interchange reconstruction rejects non-OpenQASM and malformed measurement", () => {
  assert.equal(parseInterchangeCircuit("qc = QuantumCircuit(2)"), null);
  const mixedIndex = `OPENQASM 3.0;
include "stdgates.inc";
bit[2] c;
qubit[2] q;
h q[0];
c[0] = measure q;`;
  assert.equal(parseInterchangeCircuit(mixedIndex), null);
});

function ghzQasm(wires: number): string {
  return [
    "OPENQASM 3.0;",
    "include \"stdgates.inc\";",
    `bit[${wires}] meas;`,
    `qubit[${wires}] q;`,
    "h q[0];",
    ...Array.from({ length: wires - 1 }, (_, i) => `cx q[${i}], q[${i + 1}];`),
    ...Array.from({ length: wires }, (_, i) => `meas[${i}] = measure q[${i}];`),
  ].join("\n");
}

test("a 26-qubit GHZ reconstructs read-only past the 24-qubit simulation ceiling", () => {
  // 26q GHZ is the canonical "fails honestly for execution but should be
  // viewable" circuit — the viewing ceiling is higher than the sim ceiling.
  const result = reconstructInterchangeCircuit(ghzQasm(26));
  assert.equal(result.kind, "ok");
  assert.ok(result.kind === "ok");
  assert.equal(result.circuit.qubitCount, 26);
  // parseInterchangeCircuit is the thin wrapper: it draws it too.
  assert.ok(parseInterchangeCircuit(ghzQasm(26)));
});

test("a circuit wider than the viewing ceiling reports too_large, not a partial draw", () => {
  const wide = ghzQasm(MAX_VIEWABLE_QUBITS + 1);
  const result = reconstructInterchangeCircuit(wide);
  assert.equal(result.kind, "too_large");
  assert.ok(result.kind === "too_large");
  assert.equal(result.qubitCount, MAX_VIEWABLE_QUBITS + 1);
  // The boolean wrapper still fails closed above the ceiling.
  assert.equal(parseInterchangeCircuit(wide), null);
});

test("a decomposed gate set past the step guard reports too_large even when narrow", () => {
  // Each ccx decomposes into ~15 primitive columns; enough of them exceed the
  // step guard on only three wires — the guard is about draw cost, not width.
  const toffoliCount = 40;
  const deep = [
    "OPENQASM 3.0;",
    "include \"stdgates.inc\";",
    "qubit[3] q;",
    ...Array.from({ length: toffoliCount }, () => "ccx q[0], q[1], q[2];"),
  ].join("\n");
  const result = reconstructInterchangeCircuit(deep);
  assert.equal(result.kind, "too_large");
  assert.ok(result.kind === "too_large");
  assert.ok(result.stepCount > MAX_VIEWABLE_STEPS, `expected > ${MAX_VIEWABLE_STEPS} steps, got ${result.stepCount}`);
  assert.equal(parseInterchangeCircuit(deep), null);
});

test("an explicit maxQubits override still narrows the viewer below the default ceiling", () => {
  // The seed passes no override and gets the wide default; a caller that wants
  // the old 24-wire behavior can still ask for it.
  assert.equal(reconstructInterchangeCircuit(ghzQasm(26), { maxQubits: 24 }).kind, "too_large");
  assert.equal(parseInterchangeCircuit(ghzQasm(26), 24), null);
});
