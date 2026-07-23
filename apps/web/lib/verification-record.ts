import type { components } from "@majorana/contracts-gen";

type Schemas = components["schemas"];

export type VerificationSummary = Schemas["VerificationSummary"];
export type VerificationCheck = Schemas["VerificationCheckSummary"];

const DECISIONS = new Set(["pass", "fail", "inconclusive"]);
const RESULTS = new Set(["pass", "fail", "skipped", "unavailable", "error"]);
const STRENGTHS = new Set(["physical", "structural"]);
const FAILURE_CLASSES = new Set([
  "candidate_defect",
  "plan_defect",
  "evidence_gap",
  "capability_limit",
  "verifier_failure",
  "evidence_conflict",
]);
const RETRY_TARGETS = new Set(["code_generation", "planning", "simulation", "verification", "none"]);
const SEMANTIC_DECISIONS = new Set(["ready", "code_repair", "replan", "inconclusive"]);

/**
 * Runtime boundary for the generated VerificationSummary DTO.
 *
 * TypeScript protects callers at compile time, but API responses and historical
 * localStorage values still cross an untyped JSON boundary. A partial or malformed
 * object is absence, never evidence that can be promoted to PASS.
 */
export function verificationSummaryFromValue(value: unknown): VerificationSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!DECISIONS.has(String(record.decision))) return null;
  if (typeof record.reason_code !== "string" || !record.reason_code.trim()) return null;
  if (typeof record.candidate_defect_observed !== "boolean") return null;
  if (!RETRY_TARGETS.has(String(record.retry_target))) return null;
  if (record.semantic_review_decision !== null && record.semantic_review_decision !== undefined && !SEMANTIC_DECISIONS.has(String(record.semantic_review_decision))) return null;
  if (record.evidence_strength !== null && record.evidence_strength !== undefined && !STRENGTHS.has(String(record.evidence_strength))) return null;
  if (record.failure_class !== null && record.failure_class !== undefined && !FAILURE_CLASSES.has(String(record.failure_class))) return null;
  if (record.decision === "inconclusive" && record.candidate_defect_observed) return null;

  const checks = Array.isArray(record.checks)
    ? record.checks.flatMap((entry): VerificationCheck[] => {
        if (!entry || typeof entry !== "object") return [];
        const check = entry as Record<string, unknown>;
        if (typeof check.method !== "string" || !RESULTS.has(String(check.result))) return [];
        return [{ method: check.method as VerificationCheck["method"], result: check.result as VerificationCheck["result"] }];
      }).slice(0, 50)
    : [];
  const unverifiedClaims = Array.isArray(record.unverified_claims)
    ? record.unverified_claims.filter((claim): claim is string => typeof claim === "string").slice(0, 50)
    : [];

  return {
    decision: record.decision as VerificationSummary["decision"],
    evidence_strength: (record.evidence_strength ?? null) as VerificationSummary["evidence_strength"],
    reason_code: record.reason_code,
    candidate_defect_observed: record.candidate_defect_observed,
    failure_class: (record.failure_class ?? null) as VerificationSummary["failure_class"],
    retry_target: record.retry_target as VerificationSummary["retry_target"],
    semantic_review_decision: (record.semantic_review_decision ?? null) as VerificationSummary["semantic_review_decision"],
    checks,
    unverified_claims: unverifiedClaims,
  };
}

export function verificationFromResource(value: unknown): VerificationSummary | null {
  if (!value || typeof value !== "object") return null;
  return verificationSummaryFromValue((value as { verification_summary?: unknown }).verification_summary);
}

/** Read the typed projection first and the pre-v2 metadata shape only for display.
 * Legacy metadata is deliberately not upgraded to a final decision. */
export function verificationFromMetadata(value: unknown): {
  summary: VerificationSummary | null;
  checks?: VerificationCheck[];
  criticSummary?: string;
  evidenceStrength?: "physical" | "structural";
} {
  if (!value || typeof value !== "object") return { summary: null };
  const rawSummary = (value as { verification_summary?: unknown }).verification_summary;
  const summary = verificationSummaryFromValue(rawSummary);
  if (summary) {
    return {
      summary,
      checks: summary.checks?.length ? summary.checks : undefined,
      evidenceStrength: summary.evidence_strength ?? undefined,
    };
  }
  if (!rawSummary || typeof rawSummary !== "object") return { summary: null };
  const record = rawSummary as Record<string, unknown>;
  const rawChecks = Array.isArray(record.deterministic_checks) ? record.deterministic_checks : [];
  const checks = rawChecks.flatMap((entry): VerificationCheck[] => {
    if (!entry || typeof entry !== "object") return [];
    const { method, result } = entry as Record<string, unknown>;
    if (typeof method !== "string" || !RESULTS.has(String(result))) return [];
    return [{ method: method as VerificationCheck["method"], result: result as VerificationCheck["result"] }];
  });
  const critic = record.critic;
  const criticSummary = critic && typeof critic === "object" && typeof (critic as Record<string, unknown>).summary === "string"
    ? String((critic as Record<string, unknown>).summary)
    : undefined;
  const strength = record.evidence_strength;
  const evidenceStrength = strength === "physical" || strength === "structural" ? strength : undefined;
  return { summary: null, checks: checks.length ? checks : undefined, criticSummary, evidenceStrength };
}

export function recommendedVerificationAction(summary: VerificationSummary): string {
  switch (summary.retry_target) {
    case "code_generation": return "Repair the candidate source and run verification again.";
    case "planning": return "Review the request and plan before generating another candidate.";
    case "simulation": return "Collect the missing execution evidence with the same candidate revision.";
    case "verification": return "Retry verification with the same candidate revision.";
    case "none": return summary.decision === "pass" ? "No verification action is required." : "Review the unavailable claims before relying on this artifact.";
  }
}
