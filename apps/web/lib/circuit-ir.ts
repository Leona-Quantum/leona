import { FRAMEWORK_VALUES } from "@majorana/contracts-gen/enums";
import { parseGateAngle } from "./gate-angle.ts";
import {
  type BuilderStep,
  type BuiltinBuilderGate,
  type CustomGateDefinition,
} from "./studio-builder.ts";
import { MAX_VIEWABLE_QUBITS, MAX_VIEWABLE_STEPS } from "./studio-parse.ts";

export const CIRCUIT_IR_SCHEMA = "majorana.circuit-ir";
export const CIRCUIT_IR_VERSION = 1;

/**
 * The frameworks a Circuit IR document may declare — the contract's `Framework`,
 * not a copy of it.
 *
 * This was six hand-written string comparisons, and the failure they invite is
 * one-directional and silent: a framework added to the contract but missed here
 * makes `parseCircuitIR` return null, so the canvas simply does not render for
 * a valid circuit. Nothing throws and nothing logs. PR 262 added three frameworks
 * across seven sites; two of them were TypeScript registries exactly like this
 * one, and that is what put this on the roadmap.
 */
export type CircuitIRFramework = (typeof FRAMEWORK_VALUES)[number];

export function isCircuitIRFramework(value: unknown): value is CircuitIRFramework {
  return typeof value === "string" && (FRAMEWORK_VALUES as readonly string[]).includes(value);
}

const MAX_TEXT = 160;
const MAX_PARAMETERS = 8;
const MAX_WIRE_REFERENCES = 16_384;
const MAX_CIRCUIT_IR_BYTES = 262_144;
const OPERATION_ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;

export interface CircuitIROperation {
  id: string;
  name: string;
  displayName: string;
  qubits: number[];
  clbits: number[];
  parameters: string[];
  editable: boolean;
}

export interface CircuitIR {
  schema: typeof CIRCUIT_IR_SCHEMA;
  version: typeof CIRCUIT_IR_VERSION;
  framework: CircuitIRFramework;
  qubitCount: number;
  clbitCount: number;
  operationCount: number;
  operations: CircuitIROperation[];
  truncated: boolean;
  globalPhase: string | null;
}

export type CircuitIRReadOnlyReason = "opaque_operations" | "truncated" | "global_phase";

export interface CircuitIRDiagram {
  qubitCount: number;
  steps: BuilderStep[];
  customGates: CustomGateDefinition[];
  readOnly: boolean;
  readOnlyReasons: CircuitIRReadOnlyReason[];
  operationCount: number;
}

const BUILTIN_GATES: Record<string, BuiltinBuilderGate> = {
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

const ROTATIONS = new Set(["rx", "ry", "rz"]);
const TWO_QUBIT = new Set(["cx", "cz", "swap"]);

export function parseCircuitIR(value: unknown): CircuitIR | null {
  const raw = plainRecord(value);
  if (!raw || raw.schema !== CIRCUIT_IR_SCHEMA || raw.version !== CIRCUIT_IR_VERSION) return null;
  if (!isCircuitIRFramework(raw.framework)) return null;
  const qubitCount = boundedInteger(raw.qubit_count, 0, MAX_VIEWABLE_QUBITS);
  const clbitCount = boundedInteger(raw.clbit_count, 0, MAX_VIEWABLE_QUBITS);
  const operationCount = boundedInteger(raw.operation_count, 0, 10_000_000);
  if (
    qubitCount === null
    || clbitCount === null
    || operationCount === null
    || typeof raw.truncated !== "boolean"
    || !Array.isArray(raw.operations)
    || raw.operations.length > MAX_VIEWABLE_STEPS
    || (raw.global_phase !== null && !boundedText(raw.global_phase))
  ) return null;

  const operations: CircuitIROperation[] = [];
  const ids = new Set<string>();
  let wireReferences = 0;
  for (const value of raw.operations) {
    const operation = plainRecord(value);
    if (!operation) return null;
    const id = boundedName(operation.id);
    const name = boundedName(operation.name);
    const displayName = boundedText(operation.display_name);
    if (
      !id
      || ids.has(id)
      || !name
      || !displayName
      || !Array.isArray(operation.qubits)
      || !Array.isArray(operation.clbits)
      || !Array.isArray(operation.parameters)
      || operation.parameters.length > MAX_PARAMETERS
      || typeof operation.editable !== "boolean"
    ) return null;
    const qubits = boundedIndices(operation.qubits, qubitCount);
    const clbits = boundedIndices(operation.clbits, clbitCount);
    const parameters = operation.parameters.map(boundedText);
    if (!qubits || !clbits || parameters.some((parameter) => parameter === null)) return null;
    wireReferences += qubits.length + clbits.length;
    if (wireReferences > MAX_WIRE_REFERENCES) return null;
    ids.add(id);
    operations.push({
      id,
      name,
      displayName,
      qubits,
      clbits,
      parameters: parameters as string[],
      editable: operation.editable,
    });
  }
  if (operationCount < operations.length || (!raw.truncated && operationCount !== operations.length)) return null;
  const circuit: CircuitIR = {
    schema: CIRCUIT_IR_SCHEMA,
    version: CIRCUIT_IR_VERSION,
    framework: raw.framework,
    qubitCount,
    clbitCount,
    operationCount,
    operations,
    truncated: raw.truncated,
    globalPhase: raw.global_phase as string | null,
  };
  return utf8JsonBytes(circuit) <= MAX_CIRCUIT_IR_BYTES ? circuit : null;
}

export function circuitIRFromMetadata(metadata: unknown): CircuitIR | null {
  return parseCircuitIR(plainRecord(metadata)?.circuit_ir);
}

/** Revalidate the camelCase shape restored from mutable browser storage. */
export function validateCircuitIR(value: unknown): CircuitIR | null {
  const raw = plainRecord(value);
  if (!raw || !Array.isArray(raw.operations)) return null;
  const operations = raw.operations.map((value) => {
    const operation = plainRecord(value);
    if (!operation) return value;
    return {
      id: operation.id,
      name: operation.name,
      display_name: operation.displayName,
      qubits: operation.qubits,
      clbits: operation.clbits,
      parameters: operation.parameters,
      editable: operation.editable,
    };
  });
  return parseCircuitIR({
    schema: raw.schema,
    version: raw.version,
    framework: raw.framework,
    qubit_count: raw.qubitCount,
    clbit_count: raw.clbitCount,
    operation_count: raw.operationCount,
    operations,
    truncated: raw.truncated,
    global_phase: raw.globalPhase,
  });
}

/** Convert trusted IR into the existing drawing model without pretending that
 * opaque operations can round-trip through the builder. A single opaque block
 * makes the view read-only; supported flat circuits remain fully editable. */
export function circuitIRDiagram(circuit: CircuitIR): CircuitIRDiagram {
  const steps: BuilderStep[] = [];
  const customGates: CustomGateDefinition[] = [];
  let opaqueOperations = false;

  for (const operation of circuit.operations) {
    if (operation.name === "measure") {
      const identityMap = operation.qubits.length === operation.clbits.length
        && operation.qubits.every((qubit, index) => qubit === operation.clbits[index]);
      if (!operation.editable || !identityMap) opaqueOperations = true;
      for (const [index, qubit] of operation.qubits.entries()) {
        steps.push({ id: `${operation.id}-q${index}`, gate: "M", qubits: [qubit] });
      }
      continue;
    }

    const gate = BUILTIN_GATES[operation.name];
    const expectedQubits = TWO_QUBIT.has(operation.name) ? 2 : 1;
    const angle = ROTATIONS.has(operation.name) ? parseGateAngle(operation.parameters[0]) : null;
    const losslessBuiltin = Boolean(
      operation.editable
      && gate
      && operation.qubits.length === expectedQubits
      && operation.clbits.length === 0
      && (ROTATIONS.has(operation.name) ? angle && operation.parameters.length === 1 : operation.parameters.length === 0),
    );
    if (losslessBuiltin) {
      steps.push({
        id: operation.id,
        gate,
        qubits: operation.qubits,
        ...(angle ? { param: angle } : {}),
      });
      continue;
    }

    opaqueOperations = true;
    // A zero-wire SDK instruction cannot be placed honestly on a circuit wire.
    // It still contributes to operationCount and the read-only warning, but is
    // not fabricated onto q0.
    if (!operation.qubits.length) continue;
    const customGateId = `ir-${operation.id}`;
    const parameterSuffix = operation.parameters.length ? ` · ${operation.parameters.join(", ")}` : "";
    customGates.push({
      id: customGateId,
      name: `${operation.displayName}${parameterSuffix}`.slice(0, MAX_TEXT),
      qubitCount: operation.qubits.length,
      steps: [],
      opaque: true,
    });
    steps.push({ id: operation.id, gate: "CUSTOM", customGateId, qubits: operation.qubits });
  }

  const readOnlyReasons: CircuitIRReadOnlyReason[] = [];
  if (opaqueOperations) readOnlyReasons.push("opaque_operations");
  if (circuit.truncated) readOnlyReasons.push("truncated");
  if (circuit.globalPhase !== null) readOnlyReasons.push("global_phase");
  return {
    qubitCount: Math.max(circuit.qubitCount, 1),
    steps,
    customGates,
    readOnly: readOnlyReasons.length > 0,
    readOnlyReasons,
    operationCount: circuit.operationCount,
  };
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function boundedText(value: unknown): string | null {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_TEXT
    && !/[\u0000-\u001f]/.test(value)
    ? value
    : null;
}

function boundedName(value: unknown): string | null {
  return typeof value === "string" && OPERATION_ID.test(value) ? value : null;
}

function boundedIndices(value: unknown[], count: number): number[] | null {
  const indices = value.map((item) => boundedInteger(item, 0, count - 1));
  if (indices.some((item) => item === null)) return null;
  const values = indices as number[];
  return new Set(values).size === values.length ? values : null;
}

function utf8JsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
