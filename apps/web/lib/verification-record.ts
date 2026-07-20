import type { VerificationCheck } from "./library-data";

/** What the verifier recorded on a saved artifact version.
 *
 * The control plane has always stored this under
 * `metadata.verification_summary`, and the Vault's audit surface never read it:
 * "What was checked" rendered one fixed paragraph, so a run that proved unitary
 * equivalence against an independently verified parent circuit and a run that only
 * confirmed the result dict's keys looked identical to a customer. Parsing is
 * defensive because the field is free-form JSON written by the worker, and a
 * malformed record must degrade to "nothing recorded" rather than throw inside the
 * detail page's render. */
export interface VerificationRecord {
  checks?: VerificationCheck[];
  criticSummary?: string;
}

export function verificationFromMetadata(value: unknown): VerificationRecord {
  if (!value || typeof value !== "object") return {};
  const summary = (value as { verification_summary?: unknown }).verification_summary;
  if (!summary || typeof summary !== "object") return {};
  const record = summary as Record<string, unknown>;
  const raw = Array.isArray(record.deterministic_checks) ? record.deterministic_checks : [];
  const checks = raw.flatMap((entry): VerificationCheck[] => {
    if (!entry || typeof entry !== "object") return [];
    const { method, result } = entry as Record<string, unknown>;
    if (typeof method !== "string" || typeof result !== "string") return [];
    return [{ method, result }];
  });
  const critic = record.critic;
  const criticSummary =
    critic && typeof critic === "object" && typeof (critic as Record<string, unknown>).summary === "string"
      ? ((critic as Record<string, unknown>).summary as string)
      : undefined;
  return { checks: checks.length ? checks : undefined, criticSummary };
}
