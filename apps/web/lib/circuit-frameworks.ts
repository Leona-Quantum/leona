export const CIRCUIT_FRAMEWORKS = [
  { key: "qiskit", label: "Qiskit", qbraidTarget: "qiskit", language: "python", extension: "py", executable: true },
  { key: "pennylane", label: "PennyLane", qbraidTarget: "pennylane", language: "python", extension: "py", executable: true },
  { key: "cirq", label: "Cirq", qbraidTarget: "cirq", language: "python", extension: "py", executable: true },
  { key: "cudaq", label: "CUDA-Q", qbraidTarget: "cudaq", language: "python", extension: "py", executable: false },
  { key: "braket", label: "Amazon Braket", qbraidTarget: "braket", language: "python", extension: "py", executable: false },
  { key: "openqasm3", label: "OpenQASM 3.0", qbraidTarget: "qasm3", language: "openqasm", extension: "qasm", executable: false },
  { key: "pyquil", label: "PyQuil", qbraidTarget: "pyquil", language: "python", extension: "py", executable: false },
] as const;

export type CircuitFramework = (typeof CIRCUIT_FRAMEWORKS)[number];
export type CircuitFrameworkKey = CircuitFramework["key"];
export type CircuitFrameworkLabel = CircuitFramework["label"];
export type ExecutableCircuitFrameworkKey = Extract<CircuitFramework, { executable: true }>["key"];
export type PortableCircuitGate = "H" | "X" | "Y" | "Z" | "S" | "T" | "RX" | "RY" | "RZ" | "CX" | "CZ" | "SWAP";

export interface PortableCircuit {
  qubitCount: number;
  steps: Array<{
    gate: PortableCircuitGate;
    qubits: number[];
    param?: string;
  }>;
  measure?: boolean;
}

export const CIRCUIT_FRAMEWORK_KEYS = CIRCUIT_FRAMEWORKS.map((framework) => framework.key);
export const EXECUTABLE_CIRCUIT_FRAMEWORK_KEYS = CIRCUIT_FRAMEWORKS
  .filter((framework) => framework.executable)
  .map((framework) => framework.key) as ExecutableCircuitFrameworkKey[];

export function circuitFrameworkOrNull(value: string | null | undefined): CircuitFramework | null {
  const normalized = value?.trim().toLowerCase().replaceAll(/[\s._-]+/g, "");
  if (!normalized) return null;
  if (normalized === "openqasm30" || normalized === "openqasm3" || normalized === "qasm3") {
    return CIRCUIT_FRAMEWORKS.find((framework) => framework.key === "openqasm3")!;
  }
  return CIRCUIT_FRAMEWORKS.find((framework) => (
    framework.key.replaceAll(/[._-]+/g, "") === normalized
    || framework.label.toLowerCase().replaceAll(/[\s._-]+/g, "") === normalized
  )) ?? null;
}

export function circuitFramework(value: CircuitFrameworkKey | CircuitFrameworkLabel | string): CircuitFramework {
  return circuitFrameworkOrNull(value) ?? CIRCUIT_FRAMEWORKS[0];
}

export function isExecutableCircuitFramework(value: CircuitFrameworkKey): value is ExecutableCircuitFrameworkKey {
  return EXECUTABLE_CIRCUIT_FRAMEWORK_KEYS.includes(value as ExecutableCircuitFrameworkKey);
}

const QBRAID_INSTALLS: Partial<Record<CircuitFrameworkKey, string>> = {
  qiskit: 'pip install "qbraid[qiskit]>=0.12.2"',
  cirq: 'pip install "qbraid[cirq]>=0.12.2"',
  cudaq: 'pip install "qbraid[cudaq]>=0.12.2"',
  braket: 'pip install "qbraid[braket]>=0.12.2"',
  pyquil: 'pip install --pre "qbraid[pyquil]>=0.12.2"',
};

/**
 * Produce an explicit import/transpilation recipe for arbitrary OpenQASM 3
 * outside the deterministic, gate-bounded converter. The target object stays
 * inspectable and no recipe claims source-level or hardware-level equivalence.
 */
export function interchangeConversionRecipe(qasm: string, target: CircuitFrameworkKey): string {
  const framework = circuitFramework(target);
  if (target === "openqasm3") return qasm;
  if (target === "pennylane") {
    return [
      '# Install with: pip install pennylane "openqasm3[parser]"',
      "# Review control flow, measurements, and device compatibility after import.",
      "import pennylane as qml",
      "",
      `OPENQASM_SOURCE = ${JSON.stringify(qasm)}`,
      '# PennyLane 0.45 resolves standard gates without the include directive.',
      'OPENQASM_SOURCE = OPENQASM_SOURCE.replace(\'include "stdgates.inc";\', "")',
      "quantum_function = qml.from_qasm3(OPENQASM_SOURCE)",
      "print(qml.draw(quantum_function)())",
    ].join("\n");
  }

  const converter = target === "cudaq"
    ? "from qbraid.transpiler.conversions.openqasm3 import openqasm3_to_cudaq"
    : target === "pyquil"
      ? "from qbraid.transpiler.conversions.openqasm3 import openqasm3_to_pyquil"
      : "from qbraid import transpile";
  const conversion = target === "cudaq"
    ? "circuit = openqasm3_to_cudaq(OPENQASM_SOURCE)"
    : target === "pyquil"
      ? "circuit = openqasm3_to_pyquil(OPENQASM_SOURCE)"
      : `circuit = transpile(OPENQASM_SOURCE, "${framework.qbraidTarget}")`;

  return [
    `# Install with: ${QBRAID_INSTALLS[target]}`,
    "# Review decompositions, control flow, noise, and measurement semantics after conversion.",
    converter,
    "",
    `OPENQASM_SOURCE = ${JSON.stringify(qasm)}`,
    conversion,
    "print(circuit)",
  ].join("\n");
}
