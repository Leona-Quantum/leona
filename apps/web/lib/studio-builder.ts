export type BuiltinBuilderGate = "H" | "X" | "Y" | "Z" | "S" | "T" | "RX" | "RY" | "RZ" | "CX" | "CZ" | "SWAP" | "M";
export type BuilderGate = BuiltinBuilderGate | "CUSTOM";

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
  const usedIds = new Set(steps.flatMap((step) => step.gate === "CUSTOM" && step.customGateId ? [step.customGateId] : []));
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

function qiskitDefinition(gate: CustomGateDefinition): string[] {
  const operations = gate.steps.map((step) => qiskitOperation(step, (qubit) => `qubits[${qubit}]`, [])).filter(Boolean);
  return [`def ${customGateFunctionName(gate)}(qc, qubits):`, ...(operations.length ? operations.map((line) => `    ${line}`) : ["    pass"])];
}

function pennylaneDefinition(gate: CustomGateDefinition): string[] {
  const operations = gate.steps.map((step) => pennylaneOperation(step, (qubit) => `wires[${qubit}]`, [])).filter(Boolean);
  return [`def ${customGateFunctionName(gate)}(wires):`, ...(operations.length ? operations.map((line) => `    ${line}`) : ["    pass"])];
}

function cirqDefinition(gate: CustomGateDefinition): string[] {
  const operations = gate.steps.map((step) => cirqOperation(step, (qubit) => `qubits[${qubit}]`, [])).filter(Boolean);
  return [
    `def ${customGateFunctionName(gate)}(qubits):`,
    "    return [",
    ...(operations.length ? operations.map((line) => `        ${line},`) : ["        # empty custom gate"]),
    "    ]",
  ];
}

export function generateBuilderCode(
  steps: BuilderStep[],
  qubitCount: number,
  customGates: CustomGateDefinition[] = [],
): Record<"qiskit" | "pennylane" | "cirq", string> {
  const ordered = steps.filter((step) => step.gate !== "M");
  const measured = steps.some((step) => step.gate === "M");
  const activeCustomGates = usedCustomGates(steps, customGates);
  const usesAngle = steps.some((step) => Boolean(step.param)) || activeCustomGates.some((gate) => gate.steps.some((step) => Boolean(step.param)));

  const qiskitLines = ordered.map((step) => qiskitOperation(step, (qubit) => String(qubit), customGates)).filter(Boolean);
  const qiskit = [
    "from qiskit import QuantumCircuit",
    ...(usesAngle ? ["from numpy import pi"] : []),
    "",
    ...activeCustomGates.flatMap((gate) => [...qiskitDefinition(gate), ""]),
    `qc = QuantumCircuit(${qubitCount})`,
    ...qiskitLines,
    ...(measured ? ["qc.measure_all()"] : []),
  ].join("\n");

  const pennylaneLines = ordered.map((step) => pennylaneOperation(step, (qubit) => String(qubit), customGates)).filter(Boolean);
  const pennylane = [
    "import pennylane as qml",
    ...(usesAngle ? ["from numpy import pi"] : []),
    "",
    ...activeCustomGates.flatMap((gate) => [...pennylaneDefinition(gate), ""]),
    `dev = qml.device("default.qubit", wires=${qubitCount}${measured ? ", shots=1000" : ""})`,
    "",
    "@qml.qnode(dev)",
    "def circuit():",
    ...(pennylaneLines.length ? pennylaneLines.map((line) => `    ${line}`) : ["    pass"]),
    measured ? "    return qml.sample()" : "    return qml.state()",
  ].join("\n");

  const cirqLines = ordered.map((step) => cirqOperation(step, (qubit) => `qubits[${qubit}]`, customGates)).filter(Boolean);
  const cirq = [
    "import cirq",
    ...(usesAngle ? ["from numpy import pi"] : []),
    "",
    ...activeCustomGates.flatMap((gate) => [...cirqDefinition(gate), ""]),
    `qubits = cirq.LineQubit.range(${qubitCount})`,
    "circuit = cirq.Circuit(",
    ...cirqLines.map((line) => `    ${line},`),
    ...(measured ? ["    cirq.measure(*qubits, key=\"result\"),"] : []),
    ")",
  ].join("\n");

  return { qiskit, pennylane, cirq };
}
