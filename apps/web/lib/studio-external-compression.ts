import type { components } from "@majorana/contracts-gen";
import { CIRCUIT_COMPILER_VALUES, CIRCUIT_OPTIMIZATION_GATE_VALUES } from "@majorana/contracts-gen/enums";
import { createBuilderStepId, type BuilderStep } from "./studio-builder.ts";

type Schemas = components["schemas"];
export type ExternalCircuitCompiler = Schemas["CircuitCompiler"];
export type CircuitOptimizationRequest = Schemas["CircuitOptimizationRequest"];
export type CircuitOptimizationResult = Schemas["CircuitOptimizationResult"];

export const EXTERNAL_CIRCUIT_COMPILERS = CIRCUIT_COMPILER_VALUES;
export const EXTERNAL_COMPILER_MAX_QUBITS = 64;
export const EXTERNAL_COMPILER_MAX_OPERATIONS = 1024;

export class ExternalCompressionInputError extends Error {
  readonly code: "empty" | "custom_gate" | "angle" | "budget";

  constructor(code: "empty" | "custom_gate" | "angle" | "budget", message: string) {
    super(message);
    this.code = code;
  }
}

export function circuitOptimizationRequest(
  compiler: ExternalCircuitCompiler,
  qubitCount: number,
  steps: BuilderStep[],
  optimizationLevel: number = 2,
): CircuitOptimizationRequest {
  if (!steps.length) throw new ExternalCompressionInputError("empty", "The circuit is empty.");
  if (qubitCount > EXTERNAL_COMPILER_MAX_QUBITS || steps.length > EXTERNAL_COMPILER_MAX_OPERATIONS) {
    throw new ExternalCompressionInputError(
      "budget",
      `External compilation is limited to ${EXTERNAL_COMPILER_MAX_QUBITS} qubits and ${EXTERNAL_COMPILER_MAX_OPERATIONS} operations.`,
    );
  }
  return {
    compiler,
    qubit_count: qubitCount,
    optimization_level: optimizationLevel,
    operations: steps.map((step) => {
      if (step.gate === "CUSTOM") {
        throw new ExternalCompressionInputError(
          "custom_gate",
          "External compilers cannot accept Studio custom gates until they are expanded.",
        );
      }
      const rotation = step.gate === "RX" || step.gate === "RY" || step.gate === "RZ";
      const angle = rotation ? angleRadians(step.param) : null;
      if (rotation && angle === null) {
        throw new ExternalCompressionInputError(
          "angle",
          `External compilers require a bound numeric angle for ${step.gate}.`,
        );
      }
      return { gate: step.gate, qubits: step.qubits, angle_radians: angle };
    }),
  };
}

export function externalOptimizationResultFromEvent(value: unknown): CircuitOptimizationResult | null {
  if (!record(value) || value.type !== "compilation.result" || value.accepted !== true) return null;
  if (!record(value.compatibility)) return null;
  const result = value.compatibility.circuit_optimization;
  if (!record(result)) return null;
  if (!isCompiler(result.compiler) || typeof result.compiler_version !== "string") return null;
  if (!Number.isInteger(result.optimization_level)) return null;
  if (!Array.isArray(result.operations) || !result.operations.every(isOperation)) return null;
  if (!isMetrics(result.before) || !isMetrics(result.after)) return null;
  if (typeof result.input_fingerprint !== "string" || typeof result.output_fingerprint !== "string") return null;
  if (result.equivalence !== "unitary_up_to_global_phase") return null;
  if (!Array.isArray(result.warnings) || !result.warnings.every((warning) => typeof warning === "string")) return null;
  return result as unknown as CircuitOptimizationResult;
}

export function builderStepsFromExternalResult(result: CircuitOptimizationResult): BuilderStep[] {
  return (result.operations ?? []).map((operation) => ({
    id: createBuilderStepId("compiled"),
    gate: operation.gate,
    qubits: operation.qubits,
    ...(operation.angle_radians === null
      ? {}
      : { param: String(Number(operation.angle_radians.toPrecision(12))) }),
  }));
}

export function angleRadians(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = raw.trim().replaceAll(/\s+/g, "").toLowerCase();
  if (!value.includes("pi")) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const match = /^(-?)(?:(\d+(?:\.\d+)?)\*)?pi(?:\/(\d+(?:\.\d+)?))?$/.exec(value);
  if (!match) return null;
  const denominator = match[3] ? Number(match[3]) : 1;
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  const coefficient = match[2] ? Number(match[2]) : 1;
  const sign = match[1] === "-" ? -1 : 1;
  const angle = sign * coefficient * Math.PI / denominator;
  return Number.isFinite(angle) ? angle : null;
}

function isCompiler(value: unknown): value is ExternalCircuitCompiler {
  return typeof value === "string" && (EXTERNAL_CIRCUIT_COMPILERS as readonly string[]).includes(value);
}

/**
 * The returned operation, checked as strictly as the request that asked for it.
 *
 * The REQUEST side is already tight — `CircuitOptimizationRequest` is a closed
 * 13-value gate enum with a qubit-range validator, a terminal-measurement
 * validator and an explicit refusal of `source_code`. This is the other
 * direction, and it used to accept `typeof value.gate === "string"`: any string
 * at all, any number of qubits, the same qubit twice, and an angle on a gate
 * that takes none.
 *
 * That matters because of where the value goes next. `builderStepsFromExternalResult`
 * turns each of these into a `BuilderStep` and hands it to Studio's builder, so a
 * malformed operation does not fail here — it lands in the reader's circuit as a
 * step the builder's own contract says cannot exist. The compiler is our own
 * worker rather than a visitor, which is why this is a contract check and not a
 * trust boundary; but a compiler bug, a version skew, or a half-written SSE frame
 * all produce the same shape, and this is the last place any of them can be seen.
 *
 * `CIRCUIT_OPTIMIZATION_GATE_VALUES` is the generated enum — the same 13 members
 * the request validator uses — so the two directions cannot drift apart when a
 * gate is added.
 */
function isOperation(value: unknown): boolean {
  if (!record(value)) return false;
  if (typeof value.gate !== "string") return false;
  if (!(CIRCUIT_OPTIMIZATION_GATE_VALUES as readonly string[]).includes(value.gate)) return false;
  if (!Array.isArray(value.qubits)) return false;
  if (!value.qubits.every((qubit) => Number.isInteger(qubit) && qubit >= 0)) return false;
  // One or two, and never the same wire twice — a two-qubit gate on (3, 3) is
  // not a circuit, and `SWAP`/`CX`/`CZ` on one wire is the same claim.
  const arity = TWO_QUBIT_GATES.has(value.gate) ? 2 : 1;
  if (value.qubits.length !== arity) return false;
  if (new Set(value.qubits).size !== value.qubits.length) return false;
  // An angle belongs to exactly the three rotations and to nothing else. A
  // non-rotation carrying one would be silently dropped by
  // `builderStepsFromExternalResult`, which reads `param` only where the builder
  // expects it — so the operation would render as a DIFFERENT gate than the
  // compiler returned.
  const rotation = ROTATION_GATES.has(value.gate);
  if (rotation) return typeof value.angle_radians === "number" && Number.isFinite(value.angle_radians);
  return value.angle_radians === null || value.angle_radians === undefined;
}

const TWO_QUBIT_GATES: ReadonlySet<string> = new Set(["CX", "CZ", "SWAP"]);
const ROTATION_GATES: ReadonlySet<string> = new Set(["RX", "RY", "RZ"]);

function isMetrics(value: unknown): boolean {
  return record(value)
    && Number.isInteger(value.qubits)
    && nullableNonNegativeInteger(value.depth)
    && nullableNonNegativeInteger(value.gate_count)
    && nullableNonNegativeInteger(value.two_qubit_gate_count)
    && nullableNonNegativeInteger(value.measurement_count);
}

function nullableNonNegativeInteger(value: unknown): boolean {
  return value === null || (Number.isInteger(value) && (value as number) >= 0);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
