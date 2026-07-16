import { BUILDER_GATES, type BuilderStep, type CustomGateDefinition } from "./studio-builder.ts";

export interface StoredStudioCircuit {
  qubitCount: number;
  steps: BuilderStep[];
  customGates: CustomGateDefinition[];
  updatedAt: string;
}

const STORAGE_KEY = "majorana.studio-circuits.v1";
const MAX_STORED_CIRCUITS = 60;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadAll(): Record<string, StoredStudioCircuit> {
  if (!canUseStorage()) return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
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

export function saveStoredCircuit(artifactId: string, circuit: Omit<StoredStudioCircuit, "updatedAt">): void {
  if (!canUseStorage()) return;
  const all = loadAll();
  all[artifactId] = { ...circuit, updatedAt: new Date().toISOString() };
  const entries = Object.entries(all).sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt)).slice(0, MAX_STORED_CIRCUITS);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

export function removeStoredCircuit(artifactId: string): void {
  if (!canUseStorage()) return;
  const all = loadAll();
  if (!(artifactId in all)) return;
  delete all[artifactId];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function isStoredCircuit(value: unknown): value is StoredStudioCircuit {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredStudioCircuit>;
  return (
    typeof candidate.qubitCount === "number" &&
    candidate.qubitCount >= 1 &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.steps) &&
    candidate.steps.every(isBuilderStep) &&
    Array.isArray(candidate.customGates) &&
    candidate.customGates.every(isCustomGate)
  );
}

function isBuilderStep(value: unknown): value is BuilderStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Partial<BuilderStep>;
  return (
    typeof step.id === "string" &&
    typeof step.gate === "string" &&
    (step.gate === "CUSTOM" || (BUILDER_GATES as string[]).includes(step.gate)) &&
    Array.isArray(step.qubits) &&
    step.qubits.every((qubit) => typeof qubit === "number" && qubit >= 0)
  );
}

function isCustomGate(value: unknown): value is CustomGateDefinition {
  if (!value || typeof value !== "object") return false;
  const gate = value as Partial<CustomGateDefinition>;
  return (
    typeof gate.id === "string" &&
    typeof gate.name === "string" &&
    typeof gate.qubitCount === "number" &&
    Array.isArray(gate.steps) &&
    gate.steps.every(isBuilderStep)
  );
}
