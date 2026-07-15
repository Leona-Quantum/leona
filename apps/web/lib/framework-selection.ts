import type { ComposerFramework } from "../components/run-composer";

export function frameworkValue(value: string): ComposerFramework | null {
  const normalized = value.toLowerCase();
  if (normalized === "qiskit" || normalized === "cirq" || normalized === "pennylane") {
    return normalized;
  }
  return null;
}

export function hydrateArtifactFramework(
  current: ComposerFramework,
  selectorTouched: boolean,
  artifactFramework: string,
): { framework: ComposerFramework; error: string | null } {
  const parsed = frameworkValue(artifactFramework);
  if (parsed === null) {
    return {
      framework: current,
      error: `Unsupported artifact framework: ${artifactFramework}`,
    };
  }
  return { framework: selectorTouched ? current : parsed, error: null };
}
