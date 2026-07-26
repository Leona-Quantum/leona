import assert from "node:assert/strict";
import { test } from "node:test";

import { frameworkCodeOptions } from "./framework-code-options.ts";

// Verbatim from the artifact saved by production run
// 019f9ea8-5c2a-7ddc-81b5-7f832abea271 ("Build a 3-qubit GHZ state…"). The
// Python is what the model wrote; the QASM is what the sandbox epilogue emitted.
const RUN_CODE = `from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator

seed = 1234
shots = 1024
circuit = QuantumCircuit(3)
circuit.h(0)
circuit.cx(0, 1)
circuit.cx(1, 2)
circuit.measure_all()
simulator = AerSimulator(seed_simulator=seed)
compiled = transpile(circuit, simulator, seed_transpiler=seed)
counts = simulator.run(compiled, shots=shots).result().get_counts()

FINAL_CIRCUIT = compiled
RESULT = {"counts": {str(key): int(value) for key, value in counts.items()}}`;

const RUN_QASM = `OPENQASM 3.0;
include "stdgates.inc";
bit[3] meas;
qubit[3] q;
h q[0];
cx q[0], q[1];
cx q[1], q[2];
barrier q[0], q[1], q[2];
meas[0] = measure q[0];
meas[1] = measure q[1];
meas[2] = measure q[2];`;

test("a real run's artifact offers every framework, converting through its QASM", () => {
  const options = frameworkCodeOptions({
    framework: "qiskit",
    code: RUN_CODE,
    qasm: RUN_QASM,
  });

  const keys = options.map((option) => option.key);
  for (const expected of ["qiskit", "pennylane", "cirq", "openqasm3"]) {
    assert.ok(keys.includes(expected), `missing ${expected}`);
  }
  assert.ok(options.length >= 4);
});

test("stored code is offered verbatim and carries no loss disclaimer", () => {
  const options = frameworkCodeOptions({
    framework: "qiskit",
    code: RUN_CODE,
    qasm: RUN_QASM,
  });

  const qiskit = options.find((option) => option.key === "qiskit");
  assert.equal(qiskit?.code, RUN_CODE);
  assert.equal(qiskit?.native, true);
  assert.equal(qiskit?.note, undefined);

  const qasm = options.find((option) => option.key === "openqasm3");
  assert.equal(qasm?.code, RUN_QASM);
  assert.equal(qasm?.native, true);
  assert.equal(qasm?.note, undefined);
});

test("a decomposed conversion states the possibility of loss", () => {
  const options = frameworkCodeOptions({
    framework: "qiskit",
    code: RUN_CODE,
    qasm: RUN_QASM,
  });

  const cirq = options.find((option) => option.key === "cirq");
  assert.equal(cirq?.native, false);
  assert.match(cirq?.code ?? "", /import cirq/);
  assert.match(cirq?.note ?? "", /up to global phase/);
});

test("without stored QASM, unparsable run code converts to nothing rather than guessing", () => {
  // The bounded parser cannot read `transpile`/`AerSimulator`, and inventing a
  // Cirq program from code it did not understand would be worse than no tab.
  const options = frameworkCodeOptions({ framework: "qiskit", code: RUN_CODE, qasm: null });

  assert.deepEqual(options.map((option) => option.key), ["qiskit"]);
  assert.equal(options[0].native, true);
});

test("an explicitly stored variant wins over a conversion for that framework", () => {
  const options = frameworkCodeOptions({
    framework: "qiskit",
    code: RUN_CODE,
    qasm: RUN_QASM,
    frameworkVariants: { cirq: "# hand-written cirq" },
  });

  const cirq = options.find((option) => option.key === "cirq");
  assert.equal(cirq?.code, "# hand-written cirq");
  assert.equal(cirq?.native, true);
  assert.equal(cirq?.note, undefined);
});

test("an artifact with no code and no QASM offers nothing", () => {
  assert.deepEqual(frameworkCodeOptions({ framework: "qiskit", code: "", qasm: null }), []);
});
