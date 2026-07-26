import { circuitFramework, isExecutableCircuitFramework, type CircuitFrameworkKey, type ExecutableCircuitFrameworkKey } from "./circuit-frameworks.ts";
import { allCircuitConversionResults, parseCircuitSource } from "./circuit-conversion.ts";
import { MAX_PARSABLE_QUBITS, type ParsedBuilderCircuit } from "./studio-parse.ts";
import { TIER_LIMITS, type TierLimits } from "./account-tier.ts";
import { scopedStorage } from "./user-storage.ts";

/**
 * A deliberately small, in-browser execution lane for Studio. It never runs
 * arbitrary source: the existing bounded parser has to reconstruct the circuit
 * first, then this statevector interpreter executes that reconstructed model.
 *
 * This is intentionally distinct from the server-side Run / verification
 * pipeline. A record says exactly what was sampled in this browser; it is not
 * a verification verdict, a sandbox run, or a hardware job.
 */
/**
 * Baseline ceilings, which are the FREE tier's. A caller that knows the viewer's
 * tier passes its own limits instead (see CpuSimulationLimits below).
 *
 * The qubit ceiling used to be a flat 6 for everyone. That was not a measurement
 * — a sweep of this file's own kernel at ~1,000 gates runs 16 qubits in 78 ms
 * and 20 in 1.2 s — and it meant no circuit at researcher scale could execute
 * anywhere in the product. The numbers now live in account-tier.ts next to the
 * measurements that justify them.
 */
export const MAX_CPU_QUBITS = TIER_LIMITS.free.cpuSimQubits;
export const MAX_CPU_SHOTS = TIER_LIMITS.developer.cpuSimShots;
export const MAX_CPU_OPERATIONS = TIER_LIMITS.free.cpuSimOperations;
export const MAX_CPU_SOURCE_CHARS = 200_000;
export const MAX_CPU_SEED = 2_147_483_647;

const STORAGE_KEY = "majorana.studio-simulations.v1";
const MAX_RECORDS_PER_ARTIFACT = 24;
const MAX_STORED_ARTIFACTS = 60;
const SIMULATOR_LABEL = "Leona bounded browser statevector";

export type CpuSimulationIneligibility =
  | "artifact_required"
  | "framework_unavailable"
  | "source_unavailable"
  | "source_limit"
  | "qubit_limit"
  | "operation_limit";

export type CpuSimulationModel = "direct_source" | "openqasm_standard_decomposition";

export type CpuSimulationEligibility = {
  eligible: true;
  sourceFingerprint: string;
  interchangeFingerprint: string | null;
  model: CpuSimulationModel;
  circuit: ParsedBuilderCircuit;
} | {
  eligible: false;
  sourceFingerprint: string;
  reason: CpuSimulationIneligibility;
};

export type CpuSimulationRecord = {
  id: string;
  artifactId: string;
  artifactVersionId: string | null;
  createdAt: string;
  sourceFingerprint: string;
  interchangeFingerprint: string | null;
  framework: ExecutableCircuitFrameworkKey;
  model: CpuSimulationModel;
  simulator: typeof SIMULATOR_LABEL;
  qubitCount: number;
  operationCount: number;
  measured: boolean;
  shots: number;
  seed: number;
  counts: Record<string, number>;
};

export type CpuSimulationRequest = {
  artifactId: string;
  artifactVersionId?: string | null;
  code: string;
  framework: CircuitFrameworkKey;
  /** Stored interchange only; it is never used for an edited draft. */
  qasm?: string | null;
  shots: number;
  seed?: number;
  /** Injectable only for deterministic unit tests. */
  now?: Date;
  /** Injectable only for deterministic unit tests. */
  id?: string;
};

type ComplexMatrix = readonly [number, number, number, number, number, number, number, number];

export function sourceFingerprint(source: string): string {
  // FNV-1a is not a security primitive. It is a compact, stable provenance
  // marker for telling a user which exact draft a local result belongs to.
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** The subset of a tier's allowance this lane enforces. */
export type CpuSimulationLimits = Pick<
  TierLimits,
  "cpuSimQubits" | "cpuSimOperations" | "cpuSimShots" | "cpuSimRunsPer10Min"
>;

const PACE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Simulations started in the trailing ten minutes, across every artifact in
 * this browser. Stored records are trimmed per artifact, so a burst can be
 * undercounted — the pacing limit is a product boundary, not a security one,
 * and erring toward allowing a run is the right direction for it.
 */
export function recentSimulationCount(now: Date): number {
  const windowStart = now.getTime() - PACE_WINDOW_MS;
  return Object.values(loadAllRecords())
    .flat()
    .filter((record) => {
      const at = Date.parse(record.createdAt);
      return Number.isFinite(at) && at > windowStart && at <= now.getTime();
    }).length;
}

export function cpuSimulationEligibility(
  { artifactId, code, framework, qasm }: Pick<CpuSimulationRequest, "artifactId" | "code" | "framework" | "qasm">,
  limits: CpuSimulationLimits = TIER_LIMITS.free,
): CpuSimulationEligibility {
  const fingerprint = sourceFingerprint(code);
  if (!artifactId.trim()) return { eligible: false, sourceFingerprint: fingerprint, reason: "artifact_required" };
  if (!isExecutableCircuitFramework(framework)) return { eligible: false, sourceFingerprint: fingerprint, reason: "framework_unavailable" };
  if (code.length > MAX_CPU_SOURCE_CHARS) return { eligible: false, sourceFingerprint: fingerprint, reason: "source_limit" };
  // Parse up to the PARSER's width, not the tier's, so that a circuit the
  // parser understands but the tier may not run reaches the explicit
  // `qubit_limit` check below. Parsing at the tier width instead made an
  // over-width circuit fail as `source_unavailable` — "I could not read this",
  // when the truth was "I read it fine and your plan does not cover it".
  const direct = parseCircuitSource(code, framework, MAX_PARSABLE_QUBITS);
  const qasmSource = typeof qasm === "string" && qasm.trim() ? qasm : null;
  const decomposed = qasmSource
    ? allCircuitConversionResults(code, framework, qasmSource).qiskit
    : null;
  const circuit = direct ?? (decomposed ? parseCircuitSource(decomposed.code, "qiskit", MAX_PARSABLE_QUBITS) : null);
  if (!circuit) return { eligible: false, sourceFingerprint: fingerprint, reason: "source_unavailable" };
  if (circuit.qubitCount > limits.cpuSimQubits) return { eligible: false, sourceFingerprint: fingerprint, reason: "qubit_limit" };
  if (circuit.steps.length > limits.cpuSimOperations) return { eligible: false, sourceFingerprint: fingerprint, reason: "operation_limit" };
  return {
    eligible: true,
    sourceFingerprint: fingerprint,
    interchangeFingerprint: direct ? null : sourceFingerprint(qasmSource!),
    model: direct ? "direct_source" : "openqasm_standard_decomposition",
    circuit,
  };
}

export function runCpuSimulation(
  request: CpuSimulationRequest,
  limits: CpuSimulationLimits = TIER_LIMITS.free,
): CpuSimulationRecord {
  const eligibility = cpuSimulationEligibility(request, limits);
  if (!eligibility.eligible) throw new Error(`CPU simulation is unavailable: ${eligibility.reason}`);
  if (!Number.isInteger(request.shots) || request.shots < 1 || request.shots > limits.cpuSimShots) {
    throw new Error(`Shots must be a whole number between 1 and ${limits.cpuSimShots.toLocaleString("en-US")}.`);
  }
  if (recentSimulationCount(request.now ?? new Date()) >= limits.cpuSimRunsPer10Min) {
    throw new Error(
      `Your plan paces browser simulation at ${limits.cpuSimRunsPer10Min} runs per 10 minutes. ` +
        "Give it a few minutes and run again — nothing is lost.",
    );
  }
  const seed = request.seed ?? browserSeed();
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_CPU_SEED) {
    throw new Error(`Seed must be a whole number between 0 and ${MAX_CPU_SEED.toLocaleString("en-US")}.`);
  }

  const framework = circuitFramework(request.framework).key;
  if (!isExecutableCircuitFramework(framework)) throw new Error("CPU simulation requires Qiskit, PennyLane, or Cirq source.");
  const state = executeCircuit(eligibility.circuit);
  const counts = sampleCounts(state, eligibility.circuit.qubitCount, request.shots, seed);
  const now = request.now ?? new Date();
  return {
    id: request.id ?? simulationId(now),
    artifactId: request.artifactId,
    artifactVersionId: request.artifactVersionId ?? null,
    createdAt: now.toISOString(),
    sourceFingerprint: eligibility.sourceFingerprint,
    interchangeFingerprint: eligibility.interchangeFingerprint,
    framework,
    model: eligibility.model,
    simulator: SIMULATOR_LABEL,
    qubitCount: eligibility.circuit.qubitCount,
    operationCount: eligibility.circuit.steps.filter((step) => step.gate !== "M").length,
    measured: eligibility.circuit.steps.some((step) => step.gate === "M"),
    shots: request.shots,
    seed,
    counts,
  };
}

export function loadCpuSimulationRecords(artifactId: string): CpuSimulationRecord[] {
  return loadAllRecords()[artifactId] ?? [];
}

export function saveCpuSimulationRecord(record: CpuSimulationRecord): boolean {
  const storage = scopedStoreOrNull();
  if (!storage) return false;
  try {
    const all = loadAllRecords();
    const existing = all[record.artifactId] ?? [];
    const next = [record, ...existing.filter((item) => item.id !== record.id)]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_RECORDS_PER_ARTIFACT);
    const entries = Object.entries({ ...all, [record.artifactId]: next })
      .sort(([, left], [, right]) => (right[0]?.createdAt ?? "").localeCompare(left[0]?.createdAt ?? ""))
      .slice(0, MAX_STORED_ARTIFACTS);
    // Reports whether the write landed, so a full quota is not presented as a
    // saved simulation record.
    return storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    return false;
  }
}

function executeCircuit(circuit: ParsedBuilderCircuit): { real: Float64Array; imaginary: Float64Array } {
  const dimension = 1 << circuit.qubitCount;
  const real = new Float64Array(dimension);
  const imaginary = new Float64Array(dimension);
  real[0] = 1;

  for (const step of circuit.steps) {
    const [first, second] = step.qubits;
    switch (step.gate) {
      case "H": applySingleQubit(real, imaginary, first, HADAMARD); break;
      case "X": applySingleQubit(real, imaginary, first, PAULI_X); break;
      case "Y": applySingleQubit(real, imaginary, first, PAULI_Y); break;
      case "Z": applySingleQubit(real, imaginary, first, PAULI_Z); break;
      case "S": applySingleQubit(real, imaginary, first, PHASE_S); break;
      case "T": applySingleQubit(real, imaginary, first, PHASE_T); break;
      case "RX": applySingleQubit(real, imaginary, first, rotationX(angle(step.param))); break;
      case "RY": applySingleQubit(real, imaginary, first, rotationY(angle(step.param))); break;
      case "RZ": applySingleQubit(real, imaginary, first, rotationZ(angle(step.param))); break;
      case "CX": applyControlledX(real, imaginary, first, second); break;
      case "CZ": applyControlledZ(real, imaginary, first, second); break;
      case "SWAP": applySwap(real, imaginary, first, second); break;
      // Builder parsers only emit terminal measurements. Sampling happens after
      // the unitary evolution, so measurement is represented in the record.
      case "M": break;
      case "CUSTOM": throw new Error("Custom gates are not eligible for the bounded CPU simulator.");
    }
  }
  return { real, imaginary };
}

function applySingleQubit(real: Float64Array, imaginary: Float64Array, qubit: number, matrix: ComplexMatrix) {
  const mask = 1 << qubit;
  for (let low = 0; low < real.length; low += mask << 1) {
    for (let offset = 0; offset < mask; offset += 1) {
      const zero = low + offset;
      const one = zero + mask;
      const zeroReal = real[zero];
      const zeroImaginary = imaginary[zero];
      const oneReal = real[one];
      const oneImaginary = imaginary[one];
      real[zero] = matrix[0] * zeroReal - matrix[1] * zeroImaginary + matrix[2] * oneReal - matrix[3] * oneImaginary;
      imaginary[zero] = matrix[0] * zeroImaginary + matrix[1] * zeroReal + matrix[2] * oneImaginary + matrix[3] * oneReal;
      real[one] = matrix[4] * zeroReal - matrix[5] * zeroImaginary + matrix[6] * oneReal - matrix[7] * oneImaginary;
      imaginary[one] = matrix[4] * zeroImaginary + matrix[5] * zeroReal + matrix[6] * oneImaginary + matrix[7] * oneReal;
    }
  }
}

function applyControlledX(real: Float64Array, imaginary: Float64Array, control: number, target: number) {
  const controlMask = 1 << control;
  const targetMask = 1 << target;
  for (let index = 0; index < real.length; index += 1) {
    if ((index & controlMask) === 0 || (index & targetMask) !== 0) continue;
    const paired = index | targetMask;
    swapAmplitude(real, imaginary, index, paired);
  }
}

function applyControlledZ(real: Float64Array, imaginary: Float64Array, control: number, target: number) {
  const mask = (1 << control) | (1 << target);
  for (let index = 0; index < real.length; index += 1) {
    if ((index & mask) === mask) {
      real[index] = -real[index];
      imaginary[index] = -imaginary[index];
    }
  }
}

function applySwap(real: Float64Array, imaginary: Float64Array, first: number, second: number) {
  const firstMask = 1 << first;
  const secondMask = 1 << second;
  for (let index = 0; index < real.length; index += 1) {
    const firstBit = index & firstMask;
    const secondBit = index & secondMask;
    if (Boolean(firstBit) === Boolean(secondBit)) continue;
    const paired = index ^ firstMask ^ secondMask;
    if (index < paired) swapAmplitude(real, imaginary, index, paired);
  }
}

function swapAmplitude(real: Float64Array, imaginary: Float64Array, first: number, second: number) {
  [real[first], real[second]] = [real[second], real[first]];
  [imaginary[first], imaginary[second]] = [imaginary[second], imaginary[first]];
}

function sampleCounts(state: { real: Float64Array; imaginary: Float64Array }, qubitCount: number, shots: number, seed: number): Record<string, number> {
  const cumulative = new Float64Array(state.real.length);
  let total = 0;
  for (let index = 0; index < state.real.length; index += 1) {
    total += state.real[index] ** 2 + state.imaginary[index] ** 2;
    cumulative[index] = total;
  }
  if (!Number.isFinite(total) || total <= 0) throw new Error("The CPU simulator produced an invalid statevector.");
  const random = mulberry32(seed);
  const counts: Record<string, number> = {};
  for (let shot = 0; shot < shots; shot += 1) {
    const target = random() * total;
    let index = 0;
    // `<=` skips leading zero-probability amplitudes when the PRNG happens to
    // produce exactly zero; a zero-probability bitstring must never be sampled.
    while (index < cumulative.length - 1 && cumulative[index] <= target) index += 1;
    const bitstring = bitstringFor(index, qubitCount);
    counts[bitstring] = (counts[bitstring] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function bitstringFor(index: number, qubitCount: number): string {
  let result = "";
  for (let qubit = qubitCount - 1; qubit >= 0; qubit -= 1) result += (index & (1 << qubit)) === 0 ? "0" : "1";
  return result;
}

function angle(raw: string | undefined): number {
  if (!raw) throw new Error("Rotation gate is missing its angle.");
  const value = raw.trim().replaceAll(/\s+/g, "");
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const match = /^(?:(\d+(?:\.\d+)?)\*)?pi(?:\/(\d+(?:\.\d+)?))?$/.exec(value);
  if (!match) throw new Error("Rotation angle is outside the bounded simulation syntax.");
  return (match[1] ? Number(match[1]) : 1) * Math.PI / (match[2] ? Number(match[2]) : 1);
}

function rotationX(theta: number): ComplexMatrix {
  const cosine = Math.cos(theta / 2);
  const sine = Math.sin(theta / 2);
  return [cosine, 0, 0, -sine, 0, -sine, cosine, 0];
}

function rotationY(theta: number): ComplexMatrix {
  const cosine = Math.cos(theta / 2);
  const sine = Math.sin(theta / 2);
  return [cosine, 0, -sine, 0, sine, 0, cosine, 0];
}

function rotationZ(theta: number): ComplexMatrix {
  const cosine = Math.cos(theta / 2);
  const sine = Math.sin(theta / 2);
  return [cosine, -sine, 0, 0, 0, 0, cosine, sine];
}

const HADAMARD: ComplexMatrix = [Math.SQRT1_2, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 0, -Math.SQRT1_2, 0];
const PAULI_X: ComplexMatrix = [0, 0, 1, 0, 1, 0, 0, 0];
const PAULI_Y: ComplexMatrix = [0, 0, 0, -1, 0, 1, 0, 0];
const PAULI_Z: ComplexMatrix = [1, 0, 0, 0, 0, 0, -1, 0];
const PHASE_S: ComplexMatrix = [1, 0, 0, 0, 0, 0, 0, 1];
const PHASE_T: ComplexMatrix = [1, 0, 0, 0, 0, 0, Math.SQRT1_2, Math.SQRT1_2];

function browserSeed(): number {
  return Math.floor(Math.random() * (MAX_CPU_SEED + 1));
}

function simulationId(now: Date): string {
  return `sim-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Per-account storage (lib/user-storage.ts): a saved run records what this
// person sampled, keyed by their own artifact ids.
function scopedStoreOrNull(): Pick<typeof scopedStorage, "getItem" | "setItem"> | null {
  return scopedStorage.available() ? scopedStorage : null;
}

function loadAllRecords(): Record<string, CpuSimulationRecord[]> {
  const storage = scopedStoreOrNull();
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([artifactId, records]) => {
        if (!Array.isArray(records)) return [];
        const valid = records
          .filter(isCpuSimulationRecord)
          .filter((record) => record.artifactId === artifactId)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        return [[artifactId, valid] as const];
      }),
    );
  } catch {
    return {};
  }
}

function isCpuSimulationRecord(value: unknown): value is CpuSimulationRecord {
  if (!isRecord(value)) return false;
  const record = value as Partial<CpuSimulationRecord>;
  if (
    !isNonEmptyString(record.id)
    || !isNonEmptyString(record.artifactId)
    || (record.artifactVersionId !== null && !isNonEmptyString(record.artifactVersionId))
    || !isNonEmptyString(record.createdAt)
    || !Number.isFinite(Date.parse(record.createdAt))
    || !isNonEmptyString(record.sourceFingerprint)
    || (record.interchangeFingerprint !== null && !isNonEmptyString(record.interchangeFingerprint))
    || typeof record.framework !== "string"
    || !isExecutableCircuitFramework(record.framework as CircuitFrameworkKey)
    || (record.model !== "direct_source" && record.model !== "openqasm_standard_decomposition")
    || record.simulator !== SIMULATOR_LABEL
    || !isBoundedInteger(record.qubitCount, 1, MAX_CPU_QUBITS)
    || !isBoundedInteger(record.operationCount, 0, MAX_CPU_OPERATIONS)
    || typeof record.measured !== "boolean"
    || !isBoundedInteger(record.shots, 1, MAX_CPU_SHOTS)
    || !isBoundedInteger(record.seed, 0, MAX_CPU_SEED)
    || !isRecord(record.counts)
  ) return false;
  const entries = Object.entries(record.counts);
  return entries.length > 0
    && entries.every(([bitstring, count]) => new RegExp(`^[01]{${record.qubitCount}}$`).test(bitstring) && isBoundedInteger(count, 1, record.shots as number))
    && entries.reduce((sum, [, count]) => sum + (count as number), 0) === record.shots;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}
