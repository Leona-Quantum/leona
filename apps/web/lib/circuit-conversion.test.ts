import assert from "node:assert/strict";
import test from "node:test";

import { CIRCUIT_FRAMEWORKS } from "./circuit-frameworks.ts";
import {
  allCircuitConversionResults,
  convertCircuitSource,
  generatePortableCircuitCode,
} from "./circuit-conversion.ts";

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
