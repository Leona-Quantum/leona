import type { VqeFramework } from "./vqe-proof";

export type RegistryWorkflowIdentity = {
  artifact_version_id: string;
  semantic_key: string;
};

export function resolveInitialWorkflowId(
  workflows: RegistryWorkflowIdentity[],
  requested: { artifactVersionId?: string; semanticKey?: string },
): string | null {
  if (requested.artifactVersionId && requested.semanticKey) return null;
  const selected = requested.artifactVersionId
    ? workflows.find(
        (workflow) =>
          workflow.artifact_version_id === requested.artifactVersionId,
      )
    : requested.semanticKey
      ? workflows.find((workflow) => workflow.semantic_key === requested.semanticKey)
      : workflows[0];
  return selected?.artifact_version_id ?? null;
}

export function parseVqeFramework(value: string | undefined): VqeFramework {
  return value === "pennylane" ? "pennylane" : "qiskit";
}
