import type { LibraryArtifact } from "./library-data";

export function artifactExportManifest(
  artifact: LibraryArtifact,
  source: { framework: string; code: string },
): Record<string, unknown> {
  const decision = artifact.verificationSummary?.decision ?? null;
  return {
    schema_version: "majorana.artifact-export.v1",
    artifact_id: artifact.id,
    title: artifact.title,
    framework: source.framework,
    source_code: source.code,
    openqasm3: artifact.qasm,
    verification_state: artifact.status,
    verification_summary: artifact.verificationSummary ?? null,
    verification_warning:
      artifact.status === "stale"
        ? "Verification is stale because the source changed."
        : decision === "inconclusive"
        ? "Verification unavailable — correctness has not been confirmed."
        : decision === null
          ? "No typed verification evidence is available. Do not treat this export as Verified."
          : null,
  };
}
