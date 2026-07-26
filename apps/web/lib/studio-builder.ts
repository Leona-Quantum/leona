import type { CircuitFrameworkKey } from "./circuit-frameworks";

export type BuiltinBuilderGate = "H" | "X" | "Y" | "Z" | "S" | "T" | "RX" | "RY" | "RZ" | "CX" | "CZ" | "SWAP" | "M";
export type BuilderGate = BuiltinBuilderGate | "CUSTOM";
export type BuilderCodeVariants = Record<CircuitFrameworkKey, string>;

export type BuilderStep = {
  id: string;
  gate: BuilderGate;
  qubits: number[];
  param?: string;
  customGateId?: string;
};

export type CustomGateDefinition = {
  id: string;
  name: string;
  qubitCount: number;
  steps: BuilderStep[];
};

export const BUILDER_GATES: BuiltinBuilderGate[] = ["H", "X", "Y", "Z", "S", "T", "RX", "RY", "RZ", "CX", "CZ", "SWAP", "M"];
export const TWO_QUBIT_GATES: BuiltinBuilderGate[] = ["CX", "CZ", "SWAP"];
export const ROTATION_GATES: BuiltinBuilderGate[] = ["RX", "RY", "RZ"];

export function createBuilderStepId(prefix = "step"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function customGateFunctionName(gate: CustomGateDefinition): string {
  const slug = gate.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "gate";
  const idSuffix = gate.id.replaceAll(/[^a-z0-9]/gi, "").slice(-6) || "group";
  return `custom_${slug}_${idSuffix}`;
}

export function builderStepLabel(step: BuilderStep, customGates: CustomGateDefinition[]): string {
  if (step.gate !== "CUSTOM") return step.gate;
  return customGates.find((gate) => gate.id === step.customGateId)?.name ?? "Custom gate";
}

function usedCustomGates(steps: BuilderStep[], customGates: CustomGateDefinition[]): CustomGateDefinition[] {
  const byId = new Map(customGates.map((gate) => [gate.id, gate]));
  const usedIds = new Set<string>();
  const visit = (id: string, ancestors: ReadonlySet<string>) => {
    if (ancestors.has(id) || usedIds.has(id)) return;
    const gate = byId.get(id);
    if (!gate) return;
    usedIds.add(id);
    const nextAncestors = new Set(ancestors).add(id);
    for (const step of gate.steps) {
      if (step.gate === "CUSTOM" && step.customGateId) visit(step.customGateId, nextAncestors);
    }
  };
  for (const step of steps) {
    if (step.gate === "CUSTOM" && step.customGateId) visit(step.customGateId, new Set());
  }
  return customGates.filter((gate) => usedIds.has(gate.id));
}

type QubitReference = (qubit: number) => string;

function qiskitOperation(step: BuilderStep, resolve: QubitReference, customGates: CustomGateDefinition[]): string {
  const [a, b] = step.qubits;
  switch (step.gate) {
    case "H": return `qc.h(${resolve(a)})`;
    case "X": return `qc.x(${resolve(a)})`;
    case "Y": return `qc.y(${resolve(a)})`;
    case "Z": return `qc.z(${resolve(a)})`;
    case "S": return `qc.s(${resolve(a)})`;
    case "T": return `qc.t(${resolve(a)})`;
    case "RX": return `qc.rx(${step.param}, ${resolve(a)})`;
    case "RY": return `qc.ry(${step.param}, ${resolve(a)})`;
    case "RZ": return `qc.rz(${step.param}, ${resolve(a)})`;
    case "CX": return `qc.cx(${resolve(a)}, ${resolve(b)})`;
    case "CZ": return `qc.cz(${resolve(a)}, ${resolve(b)})`;
    case "SWAP": return `qc.swap(${resolve(a)}, ${resolve(b)})`;
    case "CUSTOM": {
      const custom = customGates.find((gate) => gate.id === step.customGateId);
      return custom
        ? `${customGateFunctionName(custom)}(qc, [${step.qubits.map(resolve).join(", ")}])`
        : "# missing custom gate";
    }
    case "M": return "";
  }
}

function pennylaneOperation(step: BuilderStep, resolve: QubitReference, customGates: CustomGateDefinition[]): string {
  const [a, b] = step.qubits;
  switch (step.gate) {
    case "H": return `qml.Hadamard(wires=${resolve(a)})`;
    case "X": return `qml.PauliX(wires=${resolve(a)})`;
    case "Y": return `qml.PauliY(wires=${resolve(a)})`;
    case "Z": return `qml.PauliZ(wires=${resolve(a)})`;
    case "S": return `qml.S(wires=${resolve(a)})`;
    case "T": return `qml.T(wires=${resolve(a)})`;
    case "RX": return `qml.RX(${step.param}, wires=${resolve(a)})`;
    case "RY": return `qml.RY(${step.param}, wires=${resolve(a)})`;
    case "RZ": return `qml.RZ(${step.param}, wires=${resolve(a)})`;
    case "CX": return `qml.CNOT(wires=[${resolve(a)}, ${resolve(b)}])`;
    case "CZ": return `qml.CZ(wires=[${resolve(a)}, ${resolve(b)}])`;
    case "SWAP": return `qml.SWAP(wires=[${resolve(a)}, ${resolve(b)}])`;
    case "CUSTOM": {
      const custom = customGates.find((gate) => gate.id === step.customGateId);
      return custom
        ? `${customGateFunctionName(custom)}([${step.qubits.map(resolve).join(", ")}])`
        : "# missing custom gate";
    }
    case "M": return "";
  }
}

function cirqOperation(step: BuilderStep, resolve: QubitReference, customGates: CustomGateDefinition[]): string {
  const [a, b] = step.qubits;
  switch (step.gate) {
    case "H": return `cirq.H(${resolve(a)})`;
    case "X": return `cirq.X(${resolve(a)})`;
    case "Y": return `cirq.Y(${resolve(a)})`;
    case "Z": return `cirq.Z(${resolve(a)})`;
    case "S": return `cirq.S(${resolve(a)})`;
    case "T": return `cirq.T(${resolve(a)})`;
    case "RX": return `cirq.rx(${step.param}).on(${resolve(a)})`;
    case "RY": return `cirq.ry(${step.param}).on(${resolve(a)})`;
    case "RZ": return `cirq.rz(${step.param}).on(${resolve(a)})`;
    case "CX": return `cirq.CNOT(${resolve(a)}, ${resolve(b)})`;
    case "CZ": return `cirq.CZ(${resolve(a)}, ${resolve(b)})`;
    case "SWAP": return `cirq.SWAP(${resolve(a)}, ${resolve(b)})`;
    case "CUSTOM": {
      const custom = customGates.find((gate) => gate.id === step.customGateId);
      return custom
        ? `*${customGateFunctionName(custom)}([${step.qubits.map(resolve).join(", ")}])`
        : "# missing custom gate";
    }
    case "M": return "";
  }
}

function qiskitDefinition(gate: CustomGateDefinition, customGates: CustomGateDefinition[]): string[] {
  const operations = gate.steps.map((step) => qiskitOperation(step, (qubit) => `qubits[${qubit}]`, customGates)).filter(Boolean);
  return [`def ${customGateFunctionName(gate)}(qc, qubits):`, ...(operations.length ? operations.map((line) => `    ${line}`) : ["    pass"])];
}

function pennylaneDefinition(gate: CustomGateDefinition, customGates: CustomGateDefinition[]): string[] {
  const operations = gate.steps.map((step) => pennylaneOperation(step, (qubit) => `wires[${qubit}]`, customGates)).filter(Boolean);
  return [`def ${customGateFunctionName(gate)}(wires):`, ...(operations.length ? operations.map((line) => `    ${line}`) : ["    pass"])];
}

function cirqDefinition(gate: CustomGateDefinition, customGates: CustomGateDefinition[]): string[] {
  const operations = gate.steps.map((step) => cirqOperation(step, (qubit) => `qubits[${qubit}]`, customGates)).filter(Boolean);
  return [
    `def ${customGateFunctionName(gate)}(qubits):`,
    "    return [",
    ...(operations.length ? operations.map((line) => `        ${line},`) : ["        # empty custom gate"]),
    "    ]",
  ];
}

export function flattenBuilderSteps(
  steps: BuilderStep[],
  customGates: CustomGateDefinition[],
): BuilderStep[] {
  const byId = new Map(customGates.map((gate) => [gate.id, gate]));
  const flatten = (step: BuilderStep, ancestors: ReadonlySet<string>): BuilderStep[] => {
    if (step.gate !== "CUSTOM") return [step];
    if (!step.customGateId || ancestors.has(step.customGateId)) return [];
    const custom = byId.get(step.customGateId);
    if (!custom) return [];
    const nextAncestors = new Set(ancestors).add(custom.id);
    return custom.steps.flatMap((definitionStep) => {
      const qubits = definitionStep.qubits.map((qubit) => step.qubits[qubit]).filter((qubit) => qubit !== undefined);
      if (qubits.length !== definitionStep.qubits.length) return [];
      return flatten({ ...definitionStep, id: `${step.id}-${definitionStep.id}`, qubits }, nextAncestors);
    });
  };
  return steps.flatMap((step) => flatten(step, new Set()));
}

function cudaqOperation(step: BuilderStep): string {
  const [a, b] = step.qubits;
  switch (step.gate) {
    case "H": return `h(q[${a}])`;
    case "X": return `x(q[${a}])`;
    case "Y": return `y(q[${a}])`;
    case "Z": return `z(q[${a}])`;
    case "S": return `s(q[${a}])`;
    case "T": return `t(q[${a}])`;
    case "RX": return `rx(${step.param}, q[${a}])`;
    case "RY": return `ry(${step.param}, q[${a}])`;
    case "RZ": return `rz(${step.param}, q[${a}])`;
    case "CX": return `x.ctrl(q[${a}], q[${b}])`;
    case "CZ": return `z.ctrl(q[${a}], q[${b}])`;
    case "SWAP": return `swap(q[${a}], q[${b}])`;
    case "M": return "";
    case "CUSTOM": return "";
  }
}

function braketOperation(step: BuilderStep): string {
  const [a, b] = step.qubits;
  switch (step.gate) {
    case "H": return `circuit.h(${a})`;
    case "X": return `circuit.x(${a})`;
    case "Y": return `circuit.y(${a})`;
    case "Z": return `circuit.z(${a})`;
    case "S": return `circuit.s(${a})`;
    case "T": return `circuit.t(${a})`;
    case "RX": return `circuit.rx(${a}, ${step.param})`;
    case "RY": return `circuit.ry(${a}, ${step.param})`;
    case "RZ": return `circuit.rz(${a}, ${step.param})`;
    case "CX": return `circuit.cnot(${a}, ${b})`;
    case "CZ": return `circuit.cz(${a}, ${b})`;
    case "SWAP": return `circuit.swap(${a}, ${b})`;
    case "M": return "";
    case "CUSTOM": return "";
  }
}

function openqasmOperation(step: BuilderStep): string {
  const [a, b] = step.qubits;
  switch (step.gate) {
    case "H": return `h q[${a}];`;
    case "X": return `x q[${a}];`;
    case "Y": return `y q[${a}];`;
    case "Z": return `z q[${a}];`;
    case "S": return `s q[${a}];`;
    case "T": return `t q[${a}];`;
    case "RX": return `rx(${step.param}) q[${a}];`;
    case "RY": return `ry(${step.param}) q[${a}];`;
    case "RZ": return `rz(${step.param}) q[${a}];`;
    case "CX": return `cx q[${a}], q[${b}];`;
    case "CZ": return `cz q[${a}], q[${b}];`;
    case "SWAP": return `swap q[${a}], q[${b}];`;
    case "M": return "";
    case "CUSTOM": return "";
  }
}

function pyquilOperation(step: BuilderStep): string {
  const [a, b] = step.qubits;
  switch (step.gate) {
    case "H": return `program += H(${a})`;
    case "X": return `program += X(${a})`;
    case "Y": return `program += Y(${a})`;
    case "Z": return `program += Z(${a})`;
    case "S": return `program += S(${a})`;
    case "T": return `program += T(${a})`;
    case "RX": return `program += RX(${step.param}, ${a})`;
    case "RY": return `program += RY(${step.param}, ${a})`;
    case "RZ": return `program += RZ(${step.param}, ${a})`;
    case "CX": return `program += CNOT(${a}, ${b})`;
    case "CZ": return `program += CZ(${a}, ${b})`;
    case "SWAP": return `program += SWAP(${a}, ${b})`;
    case "M": return "";
    case "CUSTOM": return "";
  }
}

/**
 * Classiq's Qmod, in its Python-embedded form. Gate names and argument order are
 * taken from Classiq's own standard-gate reference: single-qubit gates take a
 * target, `RX`/`RY`/`RZ` take `(theta, target)`, `CX`/`CZ` take
 * `(control, target)`, and `SWAP` takes `(qbit0, qbit1)`.
 *
 * There is deliberately no measurement operation. A Qmod model does not place
 * measure gates; the qubits it exposes as `Output` are what an execution
 * samples, so measurement is expressed by executing the synthesized program.
 * `generateBuilderCode` appends that call instead.
 */
function qmodOperation(step: BuilderStep): string {
  const [a, b] = step.qubits;
  switch (step.gate) {
    case "H": return `H(q[${a}])`;
    case "X": return `X(q[${a}])`;
    case "Y": return `Y(q[${a}])`;
    case "Z": return `Z(q[${a}])`;
    case "S": return `S(q[${a}])`;
    case "T": return `T(q[${a}])`;
    case "RX": return `RX(${step.param}, q[${a}])`;
    case "RY": return `RY(${step.param}, q[${a}])`;
    case "RZ": return `RZ(${step.param}, q[${a}])`;
    case "CX": return `CX(q[${a}], q[${b}])`;
    case "CZ": return `CZ(q[${a}], q[${b}])`;
    case "SWAP": return `SWAP(q[${a}], q[${b}])`;
    case "M": return "";
    case "CUSTOM": return "";
  }
}

export function generateBuilderCode(
  steps: BuilderStep[],
  qubitCount: number,
  customGates: CustomGateDefinition[] = [],
): BuilderCodeVariants {
  const ordered = steps.filter((step) => step.gate !== "M");
  const measured = steps.some((step) => step.gate === "M");
  const activeCustomGates = usedCustomGates(steps, customGates);
  const usesAngle = steps.some((step) => Boolean(step.param)) || activeCustomGates.some((gate) => gate.steps.some((step) => Boolean(step.param)));

  const qiskitLines = ordered.map((step) => qiskitOperation(step, (qubit) => String(qubit), customGates)).filter(Boolean);
  const qiskit = [
    "from qiskit import QuantumCircuit",
    ...(usesAngle ? ["from numpy import pi"] : []),
    "",
    ...activeCustomGates.flatMap((gate) => [...qiskitDefinition(gate, customGates), ""]),
    `qc = QuantumCircuit(${qubitCount})`,
    ...qiskitLines,
    ...(measured ? ["qc.measure_all()"] : []),
  ].join("\n");

  const pennylaneLines = ordered.map((step) => pennylaneOperation(step, (qubit) => String(qubit), customGates)).filter(Boolean);
  const pennylane = [
    "import pennylane as qml",
    ...(usesAngle ? ["from numpy import pi"] : []),
    "",
    ...activeCustomGates.flatMap((gate) => [...pennylaneDefinition(gate, customGates), ""]),
    `dev = qml.device("default.qubit", wires=${qubitCount})`,
    "",
    measured ? "@qml.qnode(dev, shots=1000)" : "@qml.qnode(dev)",
    "def circuit():",
    ...(pennylaneLines.length ? pennylaneLines.map((line) => `    ${line}`) : ["    pass"]),
    measured ? "    return qml.sample()" : "    return qml.state()",
  ].join("\n");

  const cirqLines = ordered.map((step) => cirqOperation(step, (qubit) => `qubits[${qubit}]`, customGates)).filter(Boolean);
  const cirq = [
    "import cirq",
    ...(usesAngle ? ["from numpy import pi"] : []),
    "",
    ...activeCustomGates.flatMap((gate) => [...cirqDefinition(gate, customGates), ""]),
    `qubits = cirq.LineQubit.range(${qubitCount})`,
    "circuit = cirq.Circuit(",
    ...cirqLines.map((line) => `    ${line},`),
    ...(measured ? ["    cirq.measure(*qubits, key=\"result\"),"] : []),
    ")",
  ].join("\n");

  const flattened = flattenBuilderSteps(steps, customGates);
  const flattenedOperations = flattened.filter((step) => step.gate !== "M");

  const cudaqLines = flattenedOperations.map(cudaqOperation).filter(Boolean);
  const cudaq = [
    "import cudaq",
    ...(usesAngle ? ["from math import pi"] : []),
    "",
    "@cudaq.kernel",
    "def circuit():",
    `    q = cudaq.qvector(${qubitCount})`,
    ...(cudaqLines.length ? cudaqLines.map((line) => `    ${line}`) : ["    pass"]),
    ...(measured ? ["    mz(q)"] : []),
  ].join("\n");

  const braketLines = flattenedOperations.map(braketOperation).filter(Boolean);
  const braket = [
    "from braket.circuits import Circuit",
    ...(usesAngle ? ["from math import pi"] : []),
    "",
    "circuit = Circuit()",
    ...braketLines,
    ...(measured ? [`circuit.measure(range(${qubitCount}))`] : []),
  ].join("\n");

  const openqasmLines = flattenedOperations.map(openqasmOperation).filter(Boolean);
  const openqasm3 = [
    "OPENQASM 3.0;",
    'include "stdgates.inc";',
    `qubit[${qubitCount}] q;`,
    ...(measured ? [`bit[${qubitCount}] c;`] : []),
    "",
    ...openqasmLines,
    ...(measured ? ["c = measure q;"] : []),
  ].join("\n");

  const pyquilLines = flattenedOperations.map(pyquilOperation).filter(Boolean);
  const pyquil = [
    "from pyquil import Program",
    `from pyquil.gates import ${["H", "X", "Y", "Z", "S", "T", "RX", "RY", "RZ", "CNOT", "CZ", "SWAP", ...(measured ? ["MEASURE"] : [])].join(", ")}`,
    ...(usesAngle ? ["from math import pi"] : []),
    "",
    "program = Program()",
    ...(measured ? [`ro = program.declare("ro", "BIT", ${qubitCount})`] : []),
    ...pyquilLines,
    ...(measured ? Array.from({ length: qubitCount }, (_, qubit) => `program += MEASURE(${qubit}, ro[${qubit}])`) : []),
  ].join("\n");

  const qmodLines = flattenedOperations.map(qmodOperation).filter(Boolean);
  const qmod = [
    "from classiq import *",
    ...(usesAngle ? ["from classiq.qmod.symbolic import pi"] : []),
    "",
    "@qfunc",
    "def main(q: Output[QArray[QBit]]) -> None:",
    `    allocate(${qubitCount}, q)`,
    ...qmodLines.map((line) => `    ${line}`),
    "",
    "qprog = synthesize(create_model(main))",
    ...(measured
      ? [
        "",
        "# Qmod has no measure gate: executing the model samples its Output qubits.",
        "print(execute(qprog).result_value().counts)",
      ]
      : []),
  ].join("\n");

  return { qiskit, pennylane, cirq, cudaq, braket, openqasm3, pyquil, qmod };
}
