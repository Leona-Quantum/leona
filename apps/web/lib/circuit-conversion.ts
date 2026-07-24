import {
  CIRCUIT_FRAMEWORKS,
  circuitFramework,
  type CircuitFrameworkKey,
  type PortableCircuit,
} from "./circuit-frameworks.ts";
import {
  generateBuilderCode,
  type BuilderCodeVariants,
  type BuilderStep,
} from "./studio-builder.ts";
import { MAX_BUILDER_QUBITS, MAX_VIEWABLE_QUBITS, MAX_VIEWABLE_STEPS, parseBuilderCircuit, type ParsedBuilderCircuit } from "./studio-parse.ts";

export type CircuitConversionFidelity = "deterministic_subset" | "standard_gate_decomposition";

export interface CircuitConversion {
  code: string;
  fidelity: CircuitConversionFidelity;
  note: string;
}

export function portableCircuitToBuilder(portable: PortableCircuit): ParsedBuilderCircuit {
  const steps: BuilderStep[] = portable.steps.map((step, index) => ({
    id: `portable-${index}`,
    ...step,
  }));
  if (portable.measure) {
    steps.push(...Array.from({ length: portable.qubitCount }, (_, qubit) => ({
      id: `portable-measure-${qubit}`,
      gate: "M" as const,
      qubits: [qubit],
    })));
  }
  return { qubitCount: portable.qubitCount, steps };
}

export function generatePortableCircuitCode(portable: PortableCircuit): BuilderCodeVariants {
  const circuit = portableCircuitToBuilder(portable);
  return generateBuilderCode(circuit.steps, circuit.qubitCount);
}

/**
 * Defaults to the canvas's width, NOT the parser's, so every existing caller
 * (canvas sync, artifact detail, corpus rendering) keeps drawing only what the
 * six-wire grid can honestly show. The simulation lane passes its own, wider
 * limit — executing a circuit and drawing it are different capabilities.
 */
export function parseCircuitSource(
  code: string,
  framework: CircuitFrameworkKey | string,
  maxQubits: number = MAX_BUILDER_QUBITS,
): ParsedBuilderCircuit | null {
  const key = circuitFramework(framework).key;
  if (key !== "qiskit" && key !== "pennylane" && key !== "cirq" && key !== "openqasm3") return null;
  return parseBuilderCircuit(code, key, maxQubits);
}

export function convertCircuitSource(
  code: string,
  sourceFramework: CircuitFrameworkKey | string,
  targetFramework: CircuitFrameworkKey,
  qasm?: string | null,
): CircuitConversion | null {
  const parsed = parseCircuitSource(code, sourceFramework)
    ?? (qasm && looksLikeOpenQasm3(qasm) ? parseCircuitSource(qasm, "openqasm3") : null);
  if (parsed) {
    return {
      code: generateBuilderCode(parsed.steps, parsed.qubitCount)[targetFramework],
      fidelity: "deterministic_subset",
      note: "Generated deterministically from Leona Quantum's bounded gate model. Gate order, parameters, qubit indices, and terminal all-qubit measurement are preserved.",
    };
  }

  const interchangeSource = qasm && looksLikeOpenQasm3(qasm)
    ? qasm
    : circuitFramework(sourceFramework).key === "openqasm3" && looksLikeOpenQasm3(code)
      ? code
      : null;
  const interchange = interchangeSource ? parseOpenQasm3StandardGates(interchangeSource) : null;
  if (!interchange) return null;

  return {
    code: generateBuilderCode(interchange.circuit.steps, interchange.circuit.qubitCount)[targetFramework],
    fidelity: interchange.usedDecomposition ? "standard_gate_decomposition" : "deterministic_subset",
    note: interchange.usedDecomposition
      ? "Direct target source generated from OpenQASM 3 with standard-gate decompositions. It preserves the circuit unitary up to global phase where SDK gate conventions differ; review and run it in the target SDK before hardware use."
      : "Direct target source generated from stored OpenQASM 3. Gate order, parameters, qubit indices, and terminal all-qubit measurement are preserved.",
  };
}

export function allCircuitConversionResults(
  code: string,
  sourceFramework: CircuitFrameworkKey | string,
  qasm?: string | null,
): Partial<Record<CircuitFrameworkKey, CircuitConversion>> {
  return Object.fromEntries(
    CIRCUIT_FRAMEWORKS.flatMap(({ key }) => {
      const conversion = convertCircuitSource(code, sourceFramework, key, qasm);
      return conversion ? [[key, conversion]] : [];
    }),
  ) as Partial<Record<CircuitFrameworkKey, CircuitConversion>>;
}

export function allCircuitConversions(
  code: string,
  sourceFramework: CircuitFrameworkKey | string,
  qasm?: string | null,
): Partial<BuilderCodeVariants> {
  return Object.fromEntries(
    Object.entries(allCircuitConversionResults(code, sourceFramework, qasm))
      .map(([key, conversion]) => [key, conversion.code]),
  ) as Partial<BuilderCodeVariants>;
}

export function looksLikeOpenQasm3(value: string): boolean {
  return /^\s*OPENQASM\s+3(?:\.0)?\s*;/i.test(value);
}

type StandardGate = Exclude<BuilderStep["gate"], "CUSTOM" | "M">;

type StandardQasmParse = {
  circuit: ParsedBuilderCircuit;
  usedDecomposition: boolean;
};

type QasmRegister = {
  name: string;
  size: number;
};

const DIRECT_STANDARD_GATES: Record<string, StandardGate> = {
  h: "H",
  x: "X",
  y: "Y",
  z: "Z",
  s: "S",
  t: "T",
  rx: "RX",
  ry: "RY",
  rz: "RZ",
  cx: "CX",
  cz: "CZ",
  swap: "SWAP",
};

const SINGLE_QUBIT_STANDARD_GATES = new Set(["h", "x", "y", "z", "s", "t", "rx", "ry", "rz", "p", "u", "u3", "sx", "id", "sdg", "tdg"]);
const TWO_QUBIT_STANDARD_GATES = new Set(["cx", "cz", "swap", "cp", "ch", "iswap", "cy", "crz", "rzz", "rxx", "ecr"]);
const THREE_QUBIT_STANDARD_GATES = new Set(["ccx", "cswap", "ccz"]);
const ANGLE = /^-?(?:(?:\d+(?:\.\d+)?\*)?pi(?:\/\d+(?:\.\d+)?)?|\d+(?:\.\d+)?)$/i;

/**
 * Translate the static OpenQASM 3 standard-gate subset into the Studio's
 * seven target emitters. This deliberately excludes control flow, custom gate
 * bodies, multiple named registers, and symbolic expressions: emitting a
 * target-language-looking approximation for those would be less honest than
 * leaving the original source visible.
 */
function parseOpenQasm3StandardGates(code: string): StandardQasmParse | null {
  const lines = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter(Boolean);
  const steps: BuilderStep[] = [];
  let qubitRegister: QasmRegister | null = null;
  let bitRegister: QasmRegister | null = null;
  let headerSeen = false;
  let measured = false;
  const measuredQubits = new Set<number>();
  let operationSeen = false;
  let usedDecomposition = false;
  let stepIndex = 0;

  const emit = (gate: StandardGate, qubits: number[], param?: string) => {
    steps.push({ id: `interchange-${stepIndex++}`, gate, qubits, ...(param ? { param } : {}) });
  };

  for (const line of lines) {
    if (/^OPENQASM\s+3(?:\.0)?\s*;$/i.test(line)) {
      headerSeen = true;
      continue;
    }
    if (/^include\s+["']stdgates\.inc["']\s*;$/i.test(line)) continue;

    const register = /^qubit\[(\d+)\]\s+([A-Za-z_]\w*)\s*;$/.exec(line);
    if (register) {
      if (Number(register[1]) < 1 || qubitRegister !== null) return null;
      qubitRegister = { name: register[2], size: Number(register[1]) };
      continue;
    }
    const scalarRegister = /^qubit\s+([A-Za-z_]\w*)\s*;$/.exec(line);
    if (scalarRegister) {
      if (qubitRegister !== null) return null;
      qubitRegister = { name: scalarRegister[1], size: 1 };
      continue;
    }
    const bits = /^bit\[(\d+)\]\s+([A-Za-z_]\w*)\s*;$/.exec(line);
    if (bits) {
      if (Number(bits[1]) < 1 || bitRegister !== null) return null;
      bitRegister = { name: bits[2], size: Number(bits[1]) };
      continue;
    }
    const scalarBits = /^bit\s+([A-Za-z_]\w*)\s*;$/.exec(line);
    if (scalarBits) {
      if (bitRegister !== null) return null;
      bitRegister = { name: scalarBits[1], size: 1 };
      continue;
    }
    if (/^barrier\b.*;$/.test(line)) {
      usedDecomposition = true;
      continue;
    }
    // Qiskit's qasm3 exporter (how every LLM-run artifact's interchange QASM is
    // produced) writes per-qubit measurement — `meas[0] = measure q[0];`, often
    // with the classical register named `meas` and the wire order permuted — not
    // the whole-register `c = measure q;` the builder emits. Accept every form
    // and collect the measured qubits; a diagram shows M on the measured wires
    // regardless of which classical bit each result lands in.
    const measurement = parseQasmMeasurement(line);
    if (measurement) {
      if (!qubitRegister || !bitRegister || measurement.qubit !== qubitRegister.name || measurement.bit !== bitRegister.name) return null;
      if (measurement.kind === "whole") {
        if (bitRegister.size !== qubitRegister.size) return null;
        for (let qubit = 0; qubit < qubitRegister.size; qubit += 1) measuredQubits.add(qubit);
      } else {
        if (measurement.qubitIndex >= qubitRegister.size || measurement.bitIndex >= bitRegister.size) return null;
        measuredQubits.add(measurement.qubitIndex);
      }
      measured = true;
      continue;
    }
    const activeQubitRegister = qubitRegister;
    if (measured || !activeQubitRegister) return null;

    const control = /^ctrl\s*@\s*(.+)$/.exec(line);
    const invocation = parseQasmInvocation(control?.[1] ?? line);
    if (!invocation) return null;
    const gateName = control ? controlledGateName(invocation.name) : invocation.name;
    if (!gateName) return null;
    const operands = invocation.operands.map((operand) => resolveQasmOperand(operand, activeQubitRegister));
    if (operands.some((operand) => !operand)) return null;
    const applications = broadcastQasmOperands(operands as number[][]);
    if (!applications) return null;
    const expectedArity = gateArity(gateName);
    if (!expectedArity || applications.some((application) => application.length !== expectedArity)) return null;

    for (const application of applications) {
      const result = appendStandardGate(gateName, invocation.params, application, emit);
      if (result === null) return null;
      operationSeen = true;
      usedDecomposition ||= result;
    }
  }

  if (!headerSeen || !qubitRegister || !operationSeen) return null;
  if (measured && measuredQubits.size) {
    steps.push(...[...measuredQubits].sort((a, b) => a - b).map((qubit) => ({
      id: `interchange-measure-${qubit}`,
      gate: "M" as const,
      qubits: [qubit],
    })));
  }
  return { circuit: { qubitCount: qubitRegister.size, steps }, usedDecomposition };
}

type QasmMeasurement =
  | { kind: "whole"; bit: string; qubit: string }
  | { kind: "indexed"; bit: string; bitIndex: number; qubit: string; qubitIndex: number };

/**
 * Recognize the measurement forms an OpenQASM 3 exporter can emit:
 *   - assignment, whole register:  `c = measure q;`
 *   - assignment, per bit/qubit:   `meas[0] = measure q[2];`
 *   - legacy arrow, whole:         `measure q -> c;`
 *   - legacy arrow, per bit/qubit: `measure q[2] -> meas[0];`
 * A form that indexes one side but not the other is malformed and rejected.
 */
function parseQasmMeasurement(line: string): QasmMeasurement | null {
  const assign = /^([A-Za-z_]\w*)(?:\[(\d+)\])?\s*=\s*measure\s+([A-Za-z_]\w*)(?:\[(\d+)\])?\s*;$/i.exec(line);
  if (assign) return buildQasmMeasurement(assign[1], assign[2], assign[3], assign[4]);
  const arrow = /^measure\s+([A-Za-z_]\w*)(?:\[(\d+)\])?\s*->\s*([A-Za-z_]\w*)(?:\[(\d+)\])?\s*;$/i.exec(line);
  if (arrow) return buildQasmMeasurement(arrow[3], arrow[4], arrow[1], arrow[2]);
  return null;
}

function buildQasmMeasurement(bit: string, bitIndex: string | undefined, qubit: string, qubitIndex: string | undefined): QasmMeasurement | null {
  if (bitIndex === undefined && qubitIndex === undefined) return { kind: "whole", bit, qubit };
  if (bitIndex !== undefined && qubitIndex !== undefined) {
    return { kind: "indexed", bit, bitIndex: Number(bitIndex), qubit, qubitIndex: Number(qubitIndex) };
  }
  return null;
}

/**
 * Reconstruct a circuit from stored OpenQASM 3 interchange for *display*, using
 * the permissive standard-gate reader rather than the editable builder's strict
 * parser. This is the seam that lets a diagram open for an LLM-run artifact: the
 * Qiskit exporter that produces the stored QASM uses registers, gate names, and
 * per-qubit measurement the editable parser deliberately rejects.
 *
 * The width ceiling is the *viewer's* (`MAX_VIEWABLE_QUBITS`), not the editable
 * builder's or the simulator's: circuits wider than the six-wire editable grid
 * still reconstruct here so the Studio can show them read-only, and the viewing
 * ceiling is deliberately higher than the 24-qubit simulation ceiling because
 * looking at a diagram costs only SVG. Above the qubit ceiling, or past the
 * step-count guard (a decomposed gate set that would draw a pathological
 * diagram), it reports `too_large`; on malformed input or anything outside the
 * standard-gate subset it reports `unparsable`. The caller turns those into an
 * honest message instead of a circuit that lies.
 */
export type InterchangeReconstruction =
  | { kind: "ok"; circuit: ParsedBuilderCircuit }
  | { kind: "too_large"; qubitCount: number; stepCount: number }
  | { kind: "unparsable" };

export function reconstructInterchangeCircuit(
  qasm: string,
  { maxQubits = MAX_VIEWABLE_QUBITS, maxSteps = MAX_VIEWABLE_STEPS }: { maxQubits?: number; maxSteps?: number } = {},
): InterchangeReconstruction {
  if (!looksLikeOpenQasm3(qasm)) return { kind: "unparsable" };
  const parsed = parseOpenQasm3StandardGates(qasm);
  if (!parsed) return { kind: "unparsable" };
  const { qubitCount, steps } = parsed.circuit;
  if (qubitCount > maxQubits || steps.length > maxSteps) {
    return { kind: "too_large", qubitCount, stepCount: steps.length };
  }
  return { kind: "ok", circuit: parsed.circuit };
}

/**
 * Thin boolean-shaped wrapper over `reconstructInterchangeCircuit` for callers
 * (and tests) that only want the circuit or null. An explicit `maxQubits` still
 * overrides the viewing ceiling — the seed passes none and gets the default.
 */
export function parseInterchangeCircuit(
  qasm: string,
  maxQubits: number = MAX_VIEWABLE_QUBITS,
): ParsedBuilderCircuit | null {
  const result = reconstructInterchangeCircuit(qasm, { maxQubits });
  return result.kind === "ok" ? result.circuit : null;
}

function parseQasmInvocation(line: string): { name: string; params: string[]; operands: string[] } | null {
  const match = /^([A-Za-z_]\w*)(?:\(([^()]*)\))?\s+(.+)\s*;$/.exec(line);
  if (!match) return null;
  const params = match[2] === undefined ? [] : splitQasmList(match[2]);
  const operands = splitQasmList(match[3]);
  if (!params || !operands?.length) return null;
  return { name: match[1].toLowerCase(), params, operands };
}

function splitQasmList(value: string): string[] | null {
  const entries = value.split(",").map((entry) => entry.trim());
  return entries.every(Boolean) ? entries : null;
}

function controlledGateName(name: string): string | null {
  return ({ x: "cx", y: "cy", z: "cz", h: "ch", p: "cp", rz: "crz" } as Record<string, string | undefined>)[name] ?? null;
}

function resolveQasmOperand(operand: string, qubitRegister: QasmRegister): number[] | null {
  if (operand === qubitRegister.name) {
    return Array.from({ length: qubitRegister.size }, (_, qubit) => qubit);
  }
  const indexed = /^([A-Za-z_]\w*)\[(\d+)\]$/.exec(operand);
  if (!indexed || indexed[1] !== qubitRegister.name) return null;
  const qubit = Number(indexed[2]);
  return qubit >= 0 && qubit < qubitRegister.size ? [qubit] : null;
}

function broadcastQasmOperands(operands: number[][]): number[][] | null {
  const width = Math.max(...operands.map((operand) => operand.length));
  if (operands.some((operand) => operand.length !== 1 && operand.length !== width)) return null;
  return Array.from({ length: width }, (_, index) => operands.map((operand) => operand[operand.length === 1 ? 0 : index]));
}

function gateArity(gate: string): number | null {
  if (SINGLE_QUBIT_STANDARD_GATES.has(gate)) return 1;
  if (TWO_QUBIT_STANDARD_GATES.has(gate)) return 2;
  if (THREE_QUBIT_STANDARD_GATES.has(gate)) return 3;
  return null;
}

function appendStandardGate(
  gate: string,
  params: string[],
  qubits: number[],
  emit: (gate: StandardGate, qubits: number[], param?: string) => void,
): boolean | null {
  const direct = DIRECT_STANDARD_GATES[gate];
  if (direct) {
    const requiresAngle = direct === "RX" || direct === "RY" || direct === "RZ";
    if (!validParameters(params, requiresAngle ? 1 : 0)) return null;
    emit(direct, qubits, params[0]);
    return false;
  }
  const [a, b, c] = qubits;
  const [theta, phi, lambda] = params;
  switch (gate) {
    case "p":
      if (!validParameters(params, 1)) return null;
      emit("RZ", [a], theta);
      return true;
    case "u":
    case "u3":
      if (!validParameters(params, 3)) return null;
      emit("RZ", [a], lambda);
      emit("RY", [a], theta);
      emit("RZ", [a], phi);
      return true;
    case "sx":
      if (!validParameters(params, 0)) return null;
      emit("RX", [a], "pi/2");
      return true;
    case "id":
      return validParameters(params, 0) ? true : null;
    case "sdg":
      if (!validParameters(params, 0)) return null;
      emit("RZ", [a], "-pi/2");
      return true;
    case "tdg":
      if (!validParameters(params, 0)) return null;
      emit("RZ", [a], "-pi/4");
      return true;
    case "cp":
      if (!validParameters(params, 1)) return null;
      appendControlledPhase(a, b, theta, emit);
      return true;
    case "ch":
      if (!validParameters(params, 0)) return null;
      appendControlledHadamard(a, b, emit);
      return true;
    case "ccx":
      if (!validParameters(params, 0)) return null;
      appendToffoli(a, b, c, emit);
      return true;
    case "cswap":
      if (!validParameters(params, 0)) return null;
      emit("CX", [b, c]);
      appendToffoli(a, c, b, emit);
      emit("CX", [b, c]);
      return true;
    case "iswap":
      if (!validParameters(params, 0)) return null;
      emit("S", [a]);
      emit("S", [b]);
      emit("H", [a]);
      emit("CX", [a, b]);
      emit("CX", [b, a]);
      emit("H", [b]);
      return true;
    case "cy":
      if (!validParameters(params, 0)) return null;
      emit("RZ", [b], "-pi/2");
      emit("CX", [a, b]);
      emit("RZ", [b], "pi/2");
      return true;
    case "crz":
      if (!validParameters(params, 1)) return null;
      emit("RZ", [b], half(theta));
      emit("CX", [a, b]);
      emit("RZ", [b], negate(half(theta)));
      emit("CX", [a, b]);
      return true;
    case "rzz":
      if (!validParameters(params, 1)) return null;
      appendRzz(a, b, theta, emit);
      return true;
    case "rxx":
      if (!validParameters(params, 1)) return null;
      emit("H", [a]);
      emit("H", [b]);
      appendRzz(a, b, theta, emit);
      emit("H", [a]);
      emit("H", [b]);
      return true;
    case "ecr":
      if (!validParameters(params, 0)) return null;
      // Standard ECR: S(control), sqrt-X(target), CX(control, target), X(control).
      // RX(pi/2) is sqrt-X up to global phase.
      emit("S", [a]);
      emit("RX", [b], "pi/2");
      emit("CX", [a, b]);
      emit("X", [a]);
      return true;
    case "ccz":
      if (!validParameters(params, 0)) return null;
      emit("H", [c]);
      appendToffoli(a, b, c, emit);
      emit("H", [c]);
      return true;
    default:
      return null;
  }
}

function validParameters(params: string[], count: number): boolean {
  return params.length === count && params.every((param) => ANGLE.test(param.replaceAll(/\s+/g, "")));
}

function half(value: string): string {
  return `(${value})/2`;
}

function negate(value: string): string {
  return `-(${value})`;
}

function appendControlledPhase(
  control: number,
  target: number,
  theta: string,
  emit: (gate: StandardGate, qubits: number[], param?: string) => void,
) {
  emit("RZ", [control], half(theta));
  emit("CX", [control, target]);
  emit("RZ", [target], negate(half(theta)));
  emit("CX", [control, target]);
  emit("RZ", [target], half(theta));
}

function appendControlledHadamard(
  control: number,
  target: number,
  emit: (gate: StandardGate, qubits: number[], param?: string) => void,
) {
  emit("S", [target]);
  emit("H", [target]);
  emit("T", [target]);
  emit("CX", [control, target]);
  emit("RZ", [target], "-pi/4");
  emit("H", [target]);
  emit("RZ", [target], "-pi/2");
}

function appendToffoli(
  firstControl: number,
  secondControl: number,
  target: number,
  emit: (gate: StandardGate, qubits: number[], param?: string) => void,
) {
  emit("H", [target]);
  emit("CX", [secondControl, target]);
  emit("RZ", [target], "-pi/4");
  emit("CX", [firstControl, target]);
  emit("T", [target]);
  emit("CX", [secondControl, target]);
  emit("RZ", [target], "-pi/4");
  emit("CX", [firstControl, target]);
  emit("T", [secondControl]);
  emit("T", [target]);
  emit("H", [target]);
  emit("CX", [firstControl, secondControl]);
  emit("T", [firstControl]);
  emit("RZ", [secondControl], "-pi/4");
  emit("CX", [firstControl, secondControl]);
}

function appendRzz(
  first: number,
  second: number,
  theta: string,
  emit: (gate: StandardGate, qubits: number[], param?: string) => void,
) {
  emit("CX", [first, second]);
  emit("RZ", [second], theta);
  emit("CX", [first, second]);
}
