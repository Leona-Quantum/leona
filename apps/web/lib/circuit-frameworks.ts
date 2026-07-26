export const CIRCUIT_FRAMEWORKS = [
  { key: "qiskit", label: "Qiskit", language: "python", extension: "py", executable: true },
  { key: "pennylane", label: "PennyLane", language: "python", extension: "py", executable: true },
  { key: "cirq", label: "Cirq", language: "python", extension: "py", executable: true },
  { key: "cudaq", label: "CUDA-Q", language: "python", extension: "py", executable: false },
  { key: "braket", label: "Amazon Braket", language: "python", extension: "py", executable: false },
  { key: "openqasm3", label: "OpenQASM 3.0", language: "openqasm", extension: "qasm", executable: false },
  { key: "pyquil", label: "PyQuil", language: "python", extension: "py", executable: false },
  // Classiq's Qmod. The emitter targets the Python-embedded form (`from classiq
  // import *`, `@qfunc def main(...)`), not the standalone `.qmod` file syntax,
  // because that is the form Classiq's own gate reference documents and the one
  // that runs unchanged through `create_model`/`synthesize`. Hence `.py`.
  { key: "qmod", label: "Qmod", language: "python", extension: "py", executable: false },
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
  // Qmod is the language; Classiq is the vendor whose SDK carries it. Records
  // and prompts use both names interchangeably, and resolving only one of them
  // would silently drop the framework on the other spelling.
  if (normalized === "classiq" || normalized === "classiqqmod") {
    return CIRCUIT_FRAMEWORKS.find((framework) => framework.key === "qmod")!;
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
