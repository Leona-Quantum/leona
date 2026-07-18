import assert from "node:assert/strict";
import test from "node:test";

import { CIRCUIT_FRAMEWORKS } from "./circuit-frameworks.ts";
import { convertCircuitSource, generatePortableCircuitCode } from "./circuit-conversion.ts";

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

test("arbitrary OpenQASM receives target-specific recipes outside the bounded subset", () => {
  const qasm = `OPENQASM 3.0;
include "stdgates.inc";
qubit[2] q;
ctrl @ x q[0], q[1];`;
  const cudaq = convertCircuitSource(qasm, "openqasm3", "cudaq", qasm);
  const pennylane = convertCircuitSource(qasm, "openqasm3", "pennylane", qasm);
  const pyquil = convertCircuitSource(qasm, "openqasm3", "pyquil", qasm);

  assert.ok(cudaq);
  assert.equal(cudaq.fidelity, "interchange_recipe");
  assert.match(cudaq.code, /openqasm3_to_cudaq/);
  assert.match(cudaq.code, /qbraid\[cudaq\]/);
  assert.ok(pennylane);
  assert.match(pennylane.code, /qml\.from_qasm3/);
  assert.doesNotMatch(pennylane.code, /from qbraid/);
  assert.ok(pyquil);
  assert.match(pyquil.code, /openqasm3_to_pyquil/);
  assert.match(pyquil.code, /pip install --pre/);
});
