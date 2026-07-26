import { BUILDER_GATES, ROTATION_GATES, TWO_QUBIT_GATES, type BuilderStep, type CustomGateDefinition } from "./studio-builder.ts";
import { scopedStorage } from "./user-storage.ts";

export interface StoredStudioCircuit {
  artifactIdentity: string;
  qubitCount: number;
  steps: BuilderStep[];
  customGates: CustomGateDefinition[];
  updatedAt: string;
}

const STORAGE_KEY = "majorana.studio-circuits.v2";
const MAX_STORED_CIRCUITS = 60;
const MAX_STORED_QUBITS = 6;

// Per-account storage (lib/user-storage.ts): a stored circuit is the user's work.
function canUseStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return scopedStorage.available();
  } catch {
    return false;
  }
}

function loadAll(): Record<string, StoredStudioCircuit> {
  if (!canUseStorage()) return {};
  try {
    const parsed = JSON.parse(scopedStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([id, value]) =>
        isStoredCircuit(value) ? [[id, value] as const] : [],
      ),
    );
  } catch {
    return {};
  }
}

export function loadStoredCircuit(artifactId: string): StoredStudioCircuit | null {
  return loadAll()[artifactId] ?? null;
}

export function saveStoredCircuit(artifactId: string, circuit: Omit<StoredStudioCircuit, "updatedAt">): boolean {
  if (!canUseStorage()) return false;
  try {
    const all = loadAll();
    all[artifactId] = { ...circuit, updatedAt: new Date().toISOString() };
    const entries = Object.entries(all)
      .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
      .slice(0, MAX_STORED_CIRCUITS);
    // The wrapper reports whether the write landed; a quota failure must not
    // read to the caller as a saved circuit.
    return scopedStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    return false;
  }
}

export function removeStoredCircuit(artifactId: string): boolean {
  if (!canUseStorage()) return false;
  try {
    const all = loadAll();
    if (!(artifactId in all)) return true;
    delete all[artifactId];
    return scopedStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    return false;
  }
}

function isStoredCircuit(value: unknown): value is StoredStudioCircuit {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<StoredStudioCircuit>;
  if (
    !isNonEmptyString(candidate.artifactIdentity) ||
    !isBoundedInteger(candidate.qubitCount, 1, MAX_STORED_QUBITS) ||
    typeof candidate.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.updatedAt)) ||
    !Array.isArray(candidate.steps) ||
    !Array.isArray(candidate.customGates)
  ) return false;

  const steps = candidate.steps as BuilderStep[];
  const customGateDefinitions = candidate.customGates as CustomGateDefinition[];
  if (!hasUniqueIds(customGateDefinitions) || !customGateDefinitions.every(isCustomGate)) return false;
  const customGates = new Map(customGateDefinitions.map((gate) => [gate.id, gate]));
  return hasUniqueIds(steps) && steps.every((step) => isBuilderStep(step, candidate.qubitCount as number, customGates));
}

function isBuilderStep(value: unknown, qubitCount: number, customGates: Map<string, CustomGateDefinition>, allowMeasurement = true): value is BuilderStep {
  if (!isRecord(value) || !isNonEmptyString(value.id) || typeof value.gate !== "string" || !Array.isArray(value.qubits)) return false;
  const step = value as Partial<BuilderStep>;
  const gate = step.gate;
  if (gate === "CUSTOM") {
    if (!isNonEmptyString(step.customGateId) || step.param !== undefined) return false;
    const custom = customGates.get(step.customGateId as string);
    return custom ? hasQubits(step.qubits, qubitCount, custom.qubitCount) : false;
  }
  if (typeof gate !== "string" || !(BUILDER_GATES as string[]).includes(gate)) return false;
  if (gate === "M" && !allowMeasurement) return false;
  const expectedQubits = TWO_QUBIT_GATES.includes(gate as (typeof TWO_QUBIT_GATES)[number]) ? 2 : 1;
  if (!hasQubits(step.qubits, qubitCount, expectedQubits)) return false;
  if (ROTATION_GATES.includes(gate as (typeof ROTATION_GATES)[number])) return isAngleParameter(step.param);
  return step.param === undefined && step.customGateId === undefined;
}

function isCustomGate(value: unknown): value is CustomGateDefinition {
  if (!isRecord(value)) return false;
  const gate = value as Partial<CustomGateDefinition>;
  const qubitCount = gate.qubitCount;
  if (
    !isNonEmptyString(gate.id) ||
    !isNonEmptyString(gate.name) ||
    !isBoundedInteger(qubitCount, 1, MAX_STORED_QUBITS) ||
    !Array.isArray(gate.steps) ||
    !hasUniqueIds(gate.steps)
  ) return false;
  const noCustomGates = new Map<string, CustomGateDefinition>();
  return (gate.steps as BuilderStep[]).every((step) => isBuilderStep(step, qubitCount, noCustomGates, false));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function hasUniqueIds(values: unknown[]): boolean {
  const ids = values.map((value) => isRecord(value) && typeof value.id === "string" ? value.id : null);
  return ids.every((id) => id !== null) && new Set(ids).size === ids.length;
}

function hasQubits(value: unknown, limit: number, expectedLength: number): value is number[] {
  if (!Array.isArray(value) || value.length !== expectedLength) return false;
  const qubits = value as unknown[];
  return qubits.every((qubit) => isBoundedInteger(qubit, 0, limit - 1)) && new Set(qubits).size === qubits.length;
}

function isAngleParameter(value: unknown): value is string {
  return typeof value === "string" && /^(?:(?:\d+(?:\.\d+)?\*)?pi(?:\/\d+(?:\.\d+)?)?|\d+(?:\.\d+)?)$/.test(value.trim());
}
