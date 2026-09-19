import assert from "node:assert/strict";
import test from "node:test";

import {
  customGateDefinitionHasCycle,
  customGateUsageCount,
  generateBuilderCode,
  ungroupCustomGateStep,
  type CustomGateDefinition,
  type BuilderStep,
} from "./studio-builder.ts";

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

test("custom gates emit named helpers or flattened operations in every framework target", () => {
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
  assert.match(generated.qibo, /circuit\.add\(gates\.CNOT\(0, 1\)\)/);
  assert.match(generated.qibo, /circuit\.add\(gates\.M\(\*range\(2\), register_name="ro"\)\)/);
  assert.match(generated.qulacs, /circuit\.add_gate\(CNOT\(0, 1\)\)/);
  assert.match(generated.qulacs, /circuit\.add_gate\(Measurement\(1, 1\)\)/);
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

  for (const source of [generated.cudaq, generated.braket, generated.openqasm3, generated.pyquil, generated.qibo, generated.qulacs]) {
    assert.match(source, /(?:h\(q\[1\]\)|circuit\.h\(1\)|h q\[1\];|program \+= H\(1\)|gates\.H\(1\)|H\(1\))/);
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
  // The file says what it is. A drawn circuit is a gate list, and Qmod's whole
  // point is the layer above gates — qnum arithmetic, within/apply, reusable
  // qfuncs — so shipping a transliteration under the name "Qmod" with nothing
  // said overstates it. Asserted rather than left to the doc comment, because a
  // comment above the function is not what a reader of the export sees.
  assert.match(generated.qmod, /^# A gate-level rendering of this circuit as a Qmod model\./m);
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

test("every executable variant names what it built, so the canvas is not UNKNOWN", () => {
  // `roles.classify_source` reads what source BINDS. Source binding only `qc`
  // is UNKNOWN — "something this product cannot execute" — so before this,
  // every drawn circuit failed its execution contract and was handed to a model
  // to be rewritten. The round-trip tests cannot catch a regression here: the
  // parser skips this line, so they pass whether or not it is emitted.
  const steps: BuilderStep[] = [
    { id: "a", gate: "H", qubits: [0] },
    { id: "b", gate: "CX", qubits: [0, 1] },
    { id: "c", gate: "M", qubits: [0] },
  ];
  const code = generateBuilderCode(steps, 2);

  assert.match(code.qiskit, /^FINAL_CIRCUIT = qc$/m, "qiskit must bind FINAL_CIRCUIT");
  assert.match(code.cirq, /^FINAL_CIRCUIT = circuit$/m, "cirq must bind FINAL_CIRCUIT");
  assert.match(code.pennylane, /^FINAL_CIRCUIT = circuit$/m, "pennylane must bind FINAL_CIRCUIT");
  assert.match(code.braket, /^FINAL_CIRCUIT = circuit$/m, "braket must bind FINAL_CIRCUIT");
  assert.match(code.pyquil, /^FINAL_CIRCUIT = program$/m, "pyquil must bind FINAL_CIRCUIT");
  assert.match(code.qibo, /^FINAL_CIRCUIT = circuit$/m, "qibo must bind FINAL_CIRCUIT");
  assert.match(code.qulacs, /^FINAL_CIRCUIT = circuit$/m, "qulacs must bind FINAL_CIRCUIT");
});

test("SDG, TDG, P, CP, RZZ and CCX emit the documented syntax in every framework", () => {
  const gateSteps: BuilderStep[] = [
    { id: "sdg", gate: "SDG", qubits: [0] },
    { id: "tdg", gate: "TDG", qubits: [1] },
    { id: "p", gate: "P", qubits: [2], param: "pi/4" },
    { id: "cp", gate: "CP", qubits: [0, 1], param: "pi/3" },
    { id: "rzz", gate: "RZZ", qubits: [1, 2], param: "pi/6" },
    { id: "ccx", gate: "CCX", qubits: [0, 1, 2] },
  ];
  const generated = generateBuilderCode(gateSteps, 3);

  assert.match(generated.qiskit, /^qc\.sdg\(0\)$/m);
  assert.match(generated.qiskit, /^qc\.tdg\(1\)$/m);
  assert.match(generated.qiskit, /^qc\.p\(pi\/4, 2\)$/m);
  assert.match(generated.qiskit, /^qc\.cp\(pi\/3, 0, 1\)$/m);
  assert.match(generated.qiskit, /^qc\.rzz\(pi\/6, 1, 2\)$/m);
  assert.match(generated.qiskit, /^qc\.ccx\(0, 1, 2\)$/m);

  assert.match(generated.pennylane, /^ {4}qml\.adjoint\(qml\.S\)\(wires=0\)$/m);
  assert.match(generated.pennylane, /^ {4}qml\.adjoint\(qml\.T\)\(wires=1\)$/m);
  assert.match(generated.pennylane, /^ {4}qml\.PhaseShift\(pi\/4, wires=2\)$/m);
  assert.match(generated.pennylane, /^ {4}qml\.ControlledPhaseShift\(pi\/3, wires=\[0, 1\]\)$/m);
  assert.match(generated.pennylane, /^ {4}qml\.IsingZZ\(pi\/6, wires=\[1, 2\]\)$/m);
  assert.match(generated.pennylane, /^ {4}qml\.Toffoli\(wires=\[0, 1, 2\]\)$/m);

  assert.match(generated.cirq, /^ {4}\(cirq\.S\*\*-1\)\(qubits\[0\]\),$/m);
  assert.match(generated.cirq, /^ {4}\(cirq\.T\*\*-1\)\(qubits\[1\]\),$/m);
  assert.match(generated.cirq, /^ {4}cirq\.ZPowGate\(exponent=\(pi\/4\)\/pi\)\.on\(qubits\[2\]\),$/m);
  assert.match(generated.cirq, /^ {4}cirq\.CZPowGate\(exponent=\(pi\/3\)\/pi\)\.on\(qubits\[0\], qubits\[1\]\),$/m);
  assert.match(generated.cirq, /^ {4}cirq\.rzz\(pi\/6\)\.on\(qubits\[1\], qubits\[2\]\),$/m);
  assert.match(generated.cirq, /^ {4}cirq\.CCX\(qubits\[0\], qubits\[1\], qubits\[2\]\),$/m);

  // OpenQASM 3: stdgates.inc has sdg/tdg/p/cp/ccx natively but not rzz, so a
  // circuit using RZZ prefixes a `gate rzz(theta) a, b {...}` definition.
  assert.match(generated.openqasm3, /^sdg q\[0\];$/m);
  assert.match(generated.openqasm3, /^tdg q\[1\];$/m);
  assert.match(generated.openqasm3, /^p\(pi\/4\) q\[2\];$/m);
  assert.match(generated.openqasm3, /^cp\(pi\/3\) q\[0\], q\[1\];$/m);
  assert.match(generated.openqasm3, /^rzz\(pi\/6\) q\[1\], q\[2\];$/m);
  assert.match(generated.openqasm3, /^ccx q\[0\], q\[1\], q\[2\];$/m);
  assert.match(generated.openqasm3, /^gate rzz\(theta\) a, b \{$/m);
  assert.match(generated.openqasm3, /^ {4}cx a, b;$/m);
  assert.match(generated.openqasm3, /^ {4}rz\(theta\) b;$/m);

  // A circuit with no RZZ step must not carry the definition at all.
  const withoutRzz = generateBuilderCode([{ id: "h", gate: "H", qubits: [0] }], 1);
  assert.doesNotMatch(withoutRzz.openqasm3, /gate rzz/);

  assert.match(generated.cudaq, /^ {4}s\.adj\(q\[0\]\)$/m);
  assert.match(generated.cudaq, /^ {4}t\.adj\(q\[1\]\)$/m);
  assert.match(generated.cudaq, /^ {4}r1\(pi\/4, q\[2\]\)$/m);
  assert.match(generated.cudaq, /^ {4}x\.ctrl\(\[q\[0\], q\[1\]\], q\[2\]\)$/m);
  // CP and RZZ are decomposed from confirmed-native r1/rz/x.ctrl primitives —
  // CUDA-Q documents no controlled-phase or RZZ convenience call.
  assert.match(generated.cudaq, /r1\(\(pi\/3\)\/2, q\[0\]\)/);
  assert.match(generated.cudaq, /x\.ctrl\(q\[1\], q\[2\]\)\n {4}rz\(pi\/6, q\[2\]\)/);

  assert.match(generated.braket, /^circuit\.si\(0\)$/m);
  assert.match(generated.braket, /^circuit\.ti\(1\)$/m);
  assert.match(generated.braket, /^circuit\.phaseshift\(2, pi\/4\)$/m);
  assert.match(generated.braket, /^circuit\.cphaseshift\(0, 1, pi\/3\)$/m);
  assert.match(generated.braket, /^circuit\.zz\(1, 2, pi\/6\)$/m);
  assert.match(generated.braket, /^circuit\.ccnot\(0, 1, 2\)$/m);

  assert.match(generated.pyquil, /^program \+= PHASE\(-pi\/2, 0\)$/m);
  assert.match(generated.pyquil, /^program \+= PHASE\(-pi\/4, 1\)$/m);
  assert.match(generated.pyquil, /^program \+= PHASE\(pi\/4, 2\)$/m);
  assert.match(generated.pyquil, /^program \+= CPHASE\(pi\/3, 0, 1\)$/m);
  assert.match(generated.pyquil, /^program \+= CNOT\(1, 2\)\nprogram \+= RZ\(pi\/6, 2\)\nprogram \+= CNOT\(1, 2\)$/m);
  assert.match(generated.pyquil, /^program \+= CCNOT\(0, 1, 2\)$/m);

  // Qibo's controlled phase is CU1, not CPHASE, and its phase gate is U1.
  assert.match(generated.qibo, /^circuit\.add\(gates\.SDG\(0\)\)$/m);
  assert.match(generated.qibo, /^circuit\.add\(gates\.TDG\(1\)\)$/m);
  assert.match(generated.qibo, /^circuit\.add\(gates\.U1\(2, pi\/4\)\)$/m);
  assert.match(generated.qibo, /^circuit\.add\(gates\.CU1\(0, 1, pi\/3\)\)$/m);
  assert.match(generated.qibo, /^circuit\.add\(gates\.RZZ\(1, 2, pi\/6\)\)$/m);
  assert.match(generated.qibo, /^circuit\.add\(gates\.TOFFOLI\(0, 1, 2\)\)$/m);

  // Qulacs has native Sdag/Tdag/TOFFOLI/U1 but no controlled-phase (its `CP`
  // export is an unrelated Kraus-map helper) or RZZ; both are decomposed.
  assert.match(generated.qulacs, /^circuit\.add_gate\(Sdag\(0\)\)$/m);
  assert.match(generated.qulacs, /^circuit\.add_gate\(Tdag\(1\)\)$/m);
  assert.match(generated.qulacs, /^circuit\.add_gate\(U1\(2, pi\/4\)\)$/m);
  assert.match(generated.qulacs, /^circuit\.add_gate\(TOFFOLI\(0, 1, 2\)\)$/m);
  assert.match(generated.qulacs, /^circuit\.add_gate\(U1\(0, \(pi\/3\)\/2\)\)$/m);
  assert.match(generated.qulacs, /^circuit\.add_gate\(RZ\(2, -\(pi\/6\)\)\)$/m);

  // Classiq's controlled phase is `CPhase`, not `CPHASE`; SDG/TDG are not in
  // its standard_gates reference, so both decompose through the documented
  // PHASE function; RZZ/CCX take their multi-qubit operand as one QArray.
  assert.match(generated.qmod, /^ {4}PHASE\(-pi\/2, q\[0\]\)$/m);
  assert.match(generated.qmod, /^ {4}PHASE\(-pi\/4, q\[1\]\)$/m);
  assert.match(generated.qmod, /^ {4}PHASE\(pi\/4, q\[2\]\)$/m);
  assert.match(generated.qmod, /^ {4}CPhase\(pi\/3, q\[0\], q\[1\]\)$/m);
  assert.match(generated.qmod, /^ {4}RZZ\(pi\/6, \[q\[1\], q\[2\]\]\)$/m);
  assert.match(generated.qmod, /^ {4}CCX\(\[q\[0\], q\[1\]\], q\[2\]\)$/m);
});

test("an unmeasured circuit binds FINAL_CIRCUIT too", () => {
  // A circuit with no measurement is a legitimate thing to publish, and it is
  // the case that most needs the binding: it cannot be sampled, so its only
  // route to a result is the statevector the sandbox reads off FINAL_CIRCUIT.
  const code = generateBuilderCode([{ id: "a", gate: "H", qubits: [0] }], 1);

  assert.match(code.qiskit, /^FINAL_CIRCUIT = qc$/m);
  assert.match(code.cirq, /^FINAL_CIRCUIT = circuit$/m);
  assert.match(code.pennylane, /^FINAL_CIRCUIT = circuit$/m);
  assert.match(code.braket, /^FINAL_CIRCUIT = circuit$/m);
  assert.match(code.pyquil, /^FINAL_CIRCUIT = program$/m);
  assert.match(code.qibo, /^FINAL_CIRCUIT = circuit$/m);
  assert.match(code.qulacs, /^FINAL_CIRCUIT = circuit$/m);
});

test("a block cannot be saved to contain itself, directly or through another block", () => {
  assert.equal(customGateDefinitionHasCycle("g1", [{ id: "a", gate: "H", qubits: [0] }], []), false);
  // Direct: g1's proposed body calls g1.
  assert.equal(
    customGateDefinitionHasCycle("g1", [{ id: "a", gate: "CUSTOM", customGateId: "g1", qubits: [0] }], []),
    true,
  );
  // Indirect: g1's proposed body calls g2, whose saved body calls g1.
  const g2: CustomGateDefinition = { id: "g2", name: "g2", qubitCount: 1, steps: [{ id: "b", gate: "CUSTOM", customGateId: "g1", qubits: [0] }] };
  assert.equal(
    customGateDefinitionHasCycle("g1", [{ id: "a", gate: "CUSTOM", customGateId: "g2", qubits: [0] }], [g2]),
    true,
  );
  // Unrelated: g1's proposed body calls g2, which does not call back into g1.
  const g3: CustomGateDefinition = { id: "g3", name: "g3", qubitCount: 1, steps: [{ id: "c", gate: "X", qubits: [0] }] };
  assert.equal(
    customGateDefinitionHasCycle("g1", [{ id: "a", gate: "CUSTOM", customGateId: "g3", qubits: [0] }], [g3]),
    false,
  );
});

test("customGateUsageCount counts the canvas and every other definition's own steps", () => {
  const inner: CustomGateDefinition = { id: "inner", name: "Inner", qubitCount: 1, steps: [{ id: "x", gate: "X", qubits: [0] }] };
  const outer: CustomGateDefinition = {
    id: "outer",
    name: "Outer",
    qubitCount: 1,
    steps: [
      { id: "a", gate: "CUSTOM", customGateId: "inner", qubits: [0] },
      { id: "b", gate: "CUSTOM", customGateId: "inner", qubits: [0] },
    ],
  };
  const canvas: BuilderStep[] = [{ id: "c1", gate: "CUSTOM", customGateId: "inner", qubits: [0] }];
  assert.equal(customGateUsageCount("inner", canvas, [inner, outer]), 3);
  assert.equal(customGateUsageCount("outer", canvas, [inner, outer]), 0);
  assert.equal(customGateUsageCount("missing", canvas, [inner, outer]), 0);
});

test("ungrouping replaces one instance with its own definition's steps, remapped, one level only", () => {
  const nested: CustomGateDefinition = { id: "inner", name: "Inner", qubitCount: 1, steps: [{ id: "x", gate: "X", qubits: [0] }] };
  const outer: CustomGateDefinition = {
    id: "outer",
    name: "Outer",
    qubitCount: 2,
    steps: [
      { id: "a", gate: "H", qubits: [0] },
      { id: "b", gate: "CUSTOM", customGateId: "inner", qubits: [1] },
    ],
  };
  const canvas: BuilderStep[] = [
    { id: "before", gate: "H", qubits: [2] },
    { id: "target", gate: "CUSTOM", customGateId: "outer", qubits: [3, 4] },
    { id: "after", gate: "M", qubits: [3] },
  ];
  const ungrouped = ungroupCustomGateStep(canvas, "target", [outer, nested]);
  assert.ok(ungrouped);
  assert.equal(ungrouped.length, 4);
  assert.equal(ungrouped[0].id, "before");
  // outer's local qubit 0 -> global 3, local 1 -> global 4.
  assert.deepEqual({ gate: ungrouped[1].gate, qubits: ungrouped[1].qubits }, { gate: "H", qubits: [3] });
  // The nested block stays a CUSTOM step — ungroup is one level, not a full flatten.
  assert.deepEqual({ gate: ungrouped[2].gate, qubits: ungrouped[2].qubits, customGateId: ungrouped[2].customGateId }, { gate: "CUSTOM", qubits: [4], customGateId: "inner" });
  assert.equal(ungrouped[3].id, "after");
  // Replacement steps get fresh ids, distinct from both the original definition's and each other's.
  assert.notEqual(ungrouped[1].id, "a");
  assert.notEqual(ungrouped[1].id, ungrouped[2].id);

  assert.equal(ungroupCustomGateStep(canvas, "missing", [outer, nested]), null);
  assert.equal(ungroupCustomGateStep(canvas, "before", [outer, nested]), null); // not a CUSTOM step
  const opaqueCanvas: BuilderStep[] = [{ id: "op", gate: "CUSTOM", customGateId: "opaque-gate", qubits: [0] }];
  const opaqueGate: CustomGateDefinition = { id: "opaque-gate", name: "SDK op", qubitCount: 1, steps: [{ id: "z", gate: "X", qubits: [0] }], opaque: true };
  assert.equal(ungroupCustomGateStep(opaqueCanvas, "op", [opaqueGate]), null);
});
