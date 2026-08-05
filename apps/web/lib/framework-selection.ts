export const COMPOSER_FRAMEWORKS = [
  { key: "qiskit", label: "Qiskit" },
  { key: "cirq", label: "Cirq" },
  { key: "pennylane", label: "PennyLane" },
  { key: "braket", label: "Amazon Braket" },
  { key: "qibo", label: "Qibo" },
  { key: "qulacs", label: "Qulacs" },
] as const;

export type ComposerFramework = (typeof COMPOSER_FRAMEWORKS)[number]["key"];

export type ArtifactFrameworkHydration = "checking" | "idle" | "loading" | "ready" | "error";

export function canSubmitAfterArtifactHydration(state: ArtifactFrameworkHydration): boolean {
  return state === "idle" || state === "ready";
}

export function frameworkValue(value: string): ComposerFramework | null {
  const normalized = value.trim().toLowerCase().replaceAll(/[\s._-]+/g, "");
  return COMPOSER_FRAMEWORKS.find((framework) => (
    framework.key.replaceAll(/[._-]+/g, "") === normalized
    || framework.label.toLowerCase().replaceAll(/[\s._-]+/g, "") === normalized
  ))?.key ?? null;
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

export function hydrateConversationFramework(
  current: ComposerFramework,
  selectorTouched: boolean,
  persistedFramework: string | null | undefined,
): ComposerFramework {
  const parsed = persistedFramework ? frameworkValue(persistedFramework) : null;
  return !selectorTouched && parsed ? parsed : current;
}
