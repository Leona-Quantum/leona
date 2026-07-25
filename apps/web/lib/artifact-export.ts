// Explicit .ts: this is a value import, so unlike the type-only import below it
// is not erased and must resolve under `node --experimental-strip-types`.
import { circuitFramework } from "./circuit-frameworks.ts";
import type { LibraryArtifact } from "./library-data";

/** Filename for a raw source export, e.g. `bell-state.qiskit.py`.
 *
 * The framework is in the name on purpose: a researcher who exports the same
 * circuit as Qiskit and as Cirq to compare them would otherwise get two files
 * called the same thing, and the second would silently overwrite the first in
 * the downloads folder. */
export function artifactExportFilename(artifact: LibraryArtifact, framework: string): string {
  const stem = artifact.slug || artifact.id || "circuit";
  const resolved = circuitFramework(framework);
  return `${stem}.${resolved.key}.${resolved.extension}`;
}

/** A provenance header prepended to raw source exports.
 *
 * A bare downloaded .py is anonymous the moment it leaves the browser — nothing
 * in it says which artifact it came from, whether anything verified it, or
 * when. That is exactly the context a researcher needs months later and the
 * thing they cannot reconstruct. The header is comment-only in the target
 * language, so the file still runs as-is.
 *
 * It states the verification status in the same words the UI uses, including
 * when that status is "nothing verified this". An export that quietly omitted a
 * failed or absent verdict would be the more dangerous artifact of the two. */
export function artifactExportHeader(
  artifact: LibraryArtifact,
  framework: string,
  now: Date = new Date(),
): string {
  const comment = circuitFramework(framework).language === "openqasm" ? "//" : "#";
  const decision = artifact.verificationSummary?.decision ?? null;
  const verdict =
    artifact.status === "stale"
      ? "STALE — the source changed after this was verified; correctness not confirmed"
      : decision === "inconclusive"
        ? "INCONCLUSIVE — verification could not be completed; correctness not confirmed"
        : decision === null
          ? "NONE — no typed verification evidence; do not treat this as verified"
          : `${String(decision).toUpperCase()} (evidence: ${artifact.verificationSummary?.evidence_strength ?? "unstated"})`;

  return [
    `${comment} ${artifact.title}`,
    `${comment} Exported from Leona Quantum on ${now.toISOString()}`,
    `${comment} Artifact: ${artifact.id}`,
    `${comment} Framework: ${circuitFramework(framework).label}`,
    `${comment} Verification: ${verdict}`,
  ].join("\n");
}

/** Raw, runnable source with its provenance header. */
export function artifactExportSource(
  artifact: LibraryArtifact,
  source: { framework: string; code: string },
  now: Date = new Date(),
): string {
  return `${artifactExportHeader(artifact, source.framework, now)}\n\n${source.code}\n`;
}

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
