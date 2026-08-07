import type { VqeFramework } from "./vqe-proof";

export type RegistryWorkflowIdentity = {
  artifact_version_id: string;
  semantic_key: string;
  registry_semantic_key?: string;
  experiment_creation?: {
    decision: "eligible" | "draft_required" | "blocked";
  };
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
      ? (() => {
          const matches = workflows.filter(
            (workflow) =>
              workflow.semantic_key === requested.semanticKey
              || workflow.registry_semantic_key === requested.semanticKey,
          );
          if (matches.length === 1) return matches[0];
          // One authored alias may refer to an immutable seed and its derived
          // executable Registry artifact. Prefer the only direct launchable
          // match; never select arbitrarily when truth is still ambiguous.
          const eligible = matches.filter(
            (workflow) => workflow.experiment_creation?.decision === "eligible",
          );
          if (eligible.length === 1) return eligible[0];
          const drafts = matches.filter(
            (workflow) => workflow.experiment_creation?.decision === "draft_required",
          );
          return drafts.length === 1 ? drafts[0] : undefined;
        })()
      : workflows.find(
          (workflow) => workflow.experiment_creation?.decision === "eligible",
        ) ?? workflows.find(
          (workflow) => workflow.experiment_creation?.decision === "draft_required",
        ) ?? workflows[0];
  return selected?.artifact_version_id ?? null;
}

export function parseVqeFramework(value: string | undefined): VqeFramework {
  return value === "pennylane" ? "pennylane" : "qiskit";
}
