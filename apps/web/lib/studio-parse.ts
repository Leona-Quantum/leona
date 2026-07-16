import { BUILDER_GATES, createBuilderStepId, TWO_QUBIT_GATES, type BuilderStep, type BuiltinBuilderGate } from "./studio-builder.ts";

export interface ParsedBuilderCircuit {
  qubitCount: number;
  steps: BuilderStep[];
}

const MAX_BUILDER_QUBITS = 6;

const QISKIT_GATE_METHODS: Record<string, BuiltinBuilderGate> = {
  h: "H", x: "X", y: "Y", z: "Z", s: "S", t: "T",
  rx: "RX", ry: "RY", rz: "RZ",
  cx: "CX", cz: "CZ", swap: "SWAP",
};

const PENNYLANE_GATE_NAMES: Record<string, BuiltinBuilderGate> = {
  Hadamard: "H", PauliX: "X", PauliY: "Y", PauliZ: "Z", S: "S", T: "T",
  RX: "RX", RY: "RY", RZ: "RZ",
  CNOT: "CX", CZ: "CZ", SWAP: "SWAP",
};

const CIRQ_GATE_NAMES: Record<string, BuiltinBuilderGate> = {
  H: "H", X: "X", Y: "Y", Z: "Z", S: "S", T: "T",
  CNOT: "CX", CZ: "CZ", SWAP: "SWAP",
};

const CIRQ_ROTATIONS: Record<string, BuiltinBuilderGate> = { rx: "RX", ry: "RY", rz: "RZ" };

/**
 * Reconstruct builder steps from circuit source code. This is the bounded
 * inverse of `generateBuilderCode`: it recognizes only the flat single-file
 * shape the builder emits (plus simple hand-written equivalents). Any
 * statement outside that subset — loops, custom gate helpers, classical
 * registers — returns null so callers fall back to an empty canvas instead
 * of rendering a circuit that lies about the code.
 */
export function parseBuilderCircuit(code: string, framework: "qiskit" | "pennylane" | "cirq"): ParsedBuilderCircuit | null {
  const lines = code.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  const parsed = framework === "qiskit" ? parseQiskit(lines) : framework === "pennylane" ? parsePennylane(lines) : parseCirq(lines);
  if (!parsed) return null;
  const usedQubits = parsed.steps.flatMap((step) => step.qubits);
  const qubitCount = Math.max(parsed.qubitCount, ...usedQubits.map((qubit) => qubit + 1), 1);
  if (qubitCount > MAX_BUILDER_QUBITS) return null;
  if (usedQubits.some((qubit) => qubit < 0)) return null;
  return { qubitCount, steps: parsed.steps };
}

function measurementSteps(qubitCount: number): BuilderStep[] {
  return measurementStepsForQubits(Array.from({ length: qubitCount }, (_, qubit) => qubit));
}

function measurementStepsForQubits(qubits: number[]): BuilderStep[] {
  return qubits.map((qubit) => ({ id: createBuilderStepId(), gate: "M" as const, qubits: [qubit] }));
}

function gateStep(gate: BuiltinBuilderGate, qubits: number[], param?: string): BuilderStep | null {
  if (!(BUILDER_GATES as string[]).includes(gate)) return null;
  const expectsTwo = TWO_QUBIT_GATES.includes(gate);
  if (expectsTwo && (qubits.length !== 2 || qubits[0] === qubits[1])) return null;
  if (!expectsTwo && qubits.length !== 1) return null;
  return { id: createBuilderStepId(), gate, qubits, ...(param ? { param } : {}) };
}

function parseAngle(raw: string): string | null {
  const cleaned = raw.trim().replaceAll(/\s+/g, "");
  if (!/^(?:(?:\d+(?:\.\d+)?\*)?pi(?:\/\d+(?:\.\d+)?)?|\d+(?:\.\d+)?)$/.test(cleaned)) return null;
  const denominator = /\/(\d+(?:\.\d+)?)$/.exec(cleaned);
  return denominator && Number(denominator[1]) === 0 ? null : cleaned;
}

function parseQiskit(lines: string[]): ParsedBuilderCircuit | null {
  let qubitCount = 0;
  let measured = false;
  const steps: BuilderStep[] = [];
  for (const line of lines) {
    if (/^(from|import)\s/.test(line)) continue;
    if (measured) return null;
    const circuit = /^qc\s*=\s*QuantumCircuit\((\d+)\)$/.exec(line);
    if (circuit) { qubitCount = Number(circuit[1]); continue; }
    if (/^qc\.measure_all\(\)$/.test(line)) { measured = true; continue; }
    const call = /^qc\.([a-z]+)\((.*)\)$/.exec(line);
    if (!call) return null;
    const gate = QISKIT_GATE_METHODS[call[1]];
    if (!gate) return null;
    const args = splitArgs(call[2]);
    if (gate === "RX" || gate === "RY" || gate === "RZ") {
      if (args.length !== 2) return null;
      const angle = parseAngle(args[0]);
      const qubit = parseIndex(args[1]);
      if (angle === null || qubit === null) return null;
      const step = gateStep(gate, [qubit], angle);
      if (!step) return null;
      steps.push(step);
      continue;
    }
    const qubits = args.map(parseIndex);
    if (qubits.some((qubit) => qubit === null)) return null;
    const step = gateStep(gate, qubits as number[]);
    if (!step) return null;
    steps.push(step);
  }
  if (!qubitCount && !steps.length) return null;
  const count = Math.max(qubitCount, 1);
  return { qubitCount: count, steps: measured ? [...steps, ...measurementSteps(Math.max(qubitCount, ...steps.flatMap((step) => step.qubits.map((qubit) => qubit + 1)), 1))] : steps };
}

function parsePennylane(lines: string[]): ParsedBuilderCircuit | null {
  let qubitCount = 0;
  let measuredWires: number[] | "all" | null = null;
  let returnedSeen = false;
  const steps: BuilderStep[] = [];
  for (const line of lines) {
    if (/^(from|import)\s/.test(line)) continue;
    if (returnedSeen) return null;
    if (/^@qml\.qnode\(/.test(line) || /^def\s+\w+\(\s*\)\s*:/.test(line)) continue;
    const device = /^dev\s*=\s*qml\.device\(\s*["']default\.qubit["']\s*,\s*wires\s*=\s*(\d+)/.exec(line);
    if (device) { qubitCount = Number(device[1]); continue; }
    const returned = /^return\s+qml\.(sample|probs|state|expval)\((.*)\)$/.exec(line);
    if (returned) {
      const operation = returned[1];
      const args = returned[2].trim();
      if (operation === "sample") {
        // The builder only represents measurements across every wire. Refuse
        // subset/op-based samples instead of silently widening their meaning.
        if (args) return null;
        measuredWires = "all";
      } else if (operation !== "state" || args) {
        // probs/expval and parameterized state returns have no faithful builder
        // representation; do not reconstruct a circuit with changed semantics.
        return null;
      }
      returnedSeen = true;
      continue;
    }
    const call = /^qml\.(\w+)\((.*)\)$/.exec(line);
    if (!call) return null;
    const gate = PENNYLANE_GATE_NAMES[call[1]];
    if (!gate) return null;
    const rawArgs = call[2];
    if (gate === "RX" || gate === "RY" || gate === "RZ") {
      const rotation = /^(.+?),\s*wires\s*=\s*(\S+)$/.exec(rawArgs);
      if (!rotation) return null;
      const angle = parseAngle(rotation[1]);
      const qubit = parseIndex(rotation[2]);
      if (angle === null || qubit === null) return null;
      const step = gateStep(gate, [qubit], angle);
      if (!step) return null;
      steps.push(step);
      continue;
    }
    const wires = parseWires(rawArgs);
    if (!wires) return null;
    const step = gateStep(gate, wires);
    if (!step) return null;
    steps.push(step);
  }
  if (!qubitCount && !steps.length) return null;
  const count = Math.max(qubitCount, ...steps.flatMap((step) => step.qubits.map((qubit) => qubit + 1)), 1);
  return { qubitCount: count, steps: measuredWires === "all" ? [...steps, ...measurementSteps(count)] : steps };
}

function parseCirq(lines: string[]): ParsedBuilderCircuit | null {
  let qubitCount = 0;
  let measured = false;
  let closed = false;
  const steps: BuilderStep[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/,$/, "");
    if (/^(from|import)\s/.test(line)) continue;
    if (closed) return null;
    if (/^circuit\s*=\s*cirq\.Circuit\($/.test(line)) continue;
    if (/^circuit\s*=\s*cirq\.Circuit\(\)$/.test(line)) { closed = true; continue; }
    if (line === ")") { closed = true; continue; }
    const range = /^qubits\s*=\s*cirq\.LineQubit\.range\((\d+)\)$/.exec(line);
    if (range) { qubitCount = Number(range[1]); continue; }
    if (measured) return null;
    if (/^cirq\.measure\(\*qubits/.test(line)) { measured = true; continue; }
    const rotation = /^cirq\.(rx|ry|rz)\((.+?)\)\.on\(qubits\[(\d+)\]\)$/.exec(line);
    if (rotation) {
      const angle = parseAngle(rotation[2]);
      if (angle === null) return null;
      const step = gateStep(CIRQ_ROTATIONS[rotation[1]], [Number(rotation[3])], angle);
      if (!step) return null;
      steps.push(step);
      continue;
    }
    const call = /^cirq\.(\w+)\((.*)\)$/.exec(line);
    if (!call) return null;
    const gate = CIRQ_GATE_NAMES[call[1]];
    if (!gate) return null;
    const qubits = splitArgs(call[2]).map(parseIndex);
    if (qubits.some((qubit) => qubit === null)) return null;
    const step = gateStep(gate, qubits as number[]);
    if (!step) return null;
    steps.push(step);
  }
  if (!qubitCount && !steps.length) return null;
  const count = Math.max(qubitCount, 1);
  return { qubitCount: count, steps: measured ? [...steps, ...measurementSteps(Math.max(qubitCount, ...steps.flatMap((step) => step.qubits.map((qubit) => qubit + 1)), 1))] : steps };
}

function splitArgs(raw: string): string[] {
  const trimmed = raw.trim();
  return trimmed ? trimmed.split(",").map((item) => item.trim()) : [];
}

function parseIndex(raw: string): number | null {
  const match = /^(?:qubits\[)?(\d+)\]?$/.exec(raw.trim());
  return match ? Number(match[1]) : null;
}

function parseWires(raw: string): number[] | null {
  const list = /^(?:wires\s*=\s*)?\[(.+)\]$/.exec(raw.trim());
  if (list) {
    const wires = splitArgs(list[1]).map(parseIndex);
    return wires.some((wire) => wire === null) ? null : (wires as number[]);
  }
  const single = /^(?:wires\s*=\s*)?(\d+)$/.exec(raw.trim());
  return single ? [Number(single[1])] : null;
}
