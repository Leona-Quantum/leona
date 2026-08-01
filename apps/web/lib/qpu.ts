/**
 * Client for the control plane's stateless QPU surface. Estimates come from
 * the provider's published rate card with their source and confirmation date
 * attached; the submission gate reports why hardware submission is blocked in
 * this deployment. Nothing here fabricates availability: a failed fetch is an
 * unavailable catalog, never a default one.
 */

// The problem+json readers, imported rather than re-written, for the reason
// `artifact-projects.ts` states: a second parser for the same document is a
// second thing to disagree about which field holds the sentence.
import { refusalReason, refusalSentence } from "./project-shares.ts";

export type QpuAccess = "free_queue" | "on_demand";

export type QpuBackendInfo = {
  provider: "ibm" | "braket";
  device_id: string;
  display_name: string;
  vendor: string;
  technology: "superconducting" | "trapped_ion" | "neutral_atom";
  access: QpuAccess;
  qubit_count: number | null;
  per_task_usd: number | null;
  per_shot_usd: number | null;
  allowance_note: string | null;
  rate_source: string;
  rate_confirmed_on: string;
};

export type QpuCostEstimate = {
  device_id: string;
  shots: number;
  basis: "vendor_rate_card" | "free_tier_allowance";
  currency: "USD";
  task_fee_usd: number | null;
  shot_fees_usd: number | null;
  total_usd: number | null;
  allowance_note: string | null;
  rate_source: string;
  rate_confirmed_on: string;
  disclaimer: string;
};

export type QpuSubmissionGate = {
  submission_available: boolean;
  blocked_reason:
    | "submission_disabled"
    | "credentials_unconfigured"
    | "provider_dependency_missing"
    | "unknown_device"
    | null;
};

export async function fetchQpuBackends(): Promise<QpuBackendInfo[]> {
  const response = await fetch("/api/qpu/backends", { cache: "no-store" });
  if (!response.ok) throw new Error(`qpu backends unavailable (${response.status})`);
  const payload = (await response.json()) as { backends?: unknown };
  if (!Array.isArray(payload.backends)) throw new Error("qpu backends payload malformed");
  return payload.backends as QpuBackendInfo[];
}

export async function fetchQpuEstimate(deviceKey: string, shots: number): Promise<QpuCostEstimate> {
  const response = await fetch("/api/qpu/estimates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceKey, shots }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`qpu estimate unavailable (${response.status})`);
  return (await response.json()) as QpuCostEstimate;
}

export async function fetchQpuSubmissionGate(): Promise<QpuSubmissionGate> {
  const response = await fetch("/api/qpu/submission-gate", { cache: "no-store" });
  if (!response.ok) throw new Error(`qpu submission gate unavailable (${response.status})`);
  return (await response.json()) as QpuSubmissionGate;
}

export function formatUsd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 4 : 2 });
}

export type QpuRunRecord = {
  id: string;
  provider: "ibm" | "braket";
  device_id: string;
  provider_job_id: string | null;
  shots: number;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  source_fingerprint: string;
  estimated_total_usd: number | null;
  rate_source: string;
  rate_confirmed_on: string;
  raw_counts: Record<string, number> | null;
  error: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
};

/**
 * A submission the control plane refused, carrying the machine-readable reason.
 *
 * `reason` rather than only the sentence, for the reason `refusalReason` gives:
 * `title` is English prose written by the API and this app renders Japanese, so
 * the code is the only part of a refusal a locale can translate.
 *
 * The numbers ride along for `qpu_spend_exhausted`, because a budget refusal
 * that does not say how much is left is a refusal nobody can act on.
 */
export class QpuSubmissionRefused extends Error {
  readonly reason: string | null;
  readonly spentUsd: number | null;
  readonly limitUsd: number | null;
  readonly estimateUsd: number | null;

  constructor(
    message: string,
    reason: string | null,
    amounts: { spent?: unknown; limit?: unknown; estimate?: unknown } = {},
  ) {
    super(message);
    this.name = "QpuSubmissionRefused";
    this.reason = reason;
    this.spentUsd = typeof amounts.spent === "number" ? amounts.spent : null;
    this.limitUsd = typeof amounts.limit === "number" ? amounts.limit : null;
    this.estimateUsd = typeof amounts.estimate === "number" ? amounts.estimate : null;
  }
}

export async function submitQpuRun(request: {
  device_id: string;
  shots: number;
  qasm: string;
  source_fingerprint: string;
}): Promise<QpuRunRecord> {
  const response = await fetch("/api/qpu/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    cache: "no-store",
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    // Read through the shared problem+json helpers rather than a parser of this
    // module's own. The one that was here read `payload.detail.blocked_reason`
    // — FastAPI's default shape, not this API's: `app._problem` flattens every
    // refusal to `{type, title, status, code, ...extensions}`, so `detail` was
    // always undefined and EVERY refusal this endpoint has ever sent fell
    // through to "qpu submission failed (409)". The gate's carefully worded
    // reason, the 404 for an unknown device, and the spend refusal below all
    // reached the user as a status code. `project-shares.ts` documents having
    // made and found exactly this mistake; importing from it is what stops a
    // third copy disagreeing about which field holds the sentence.
    const amounts = (payload ?? {}) as Record<string, unknown>;
    throw new QpuSubmissionRefused(
      refusalSentence(payload) ?? `qpu submission failed (${response.status})`,
      refusalReason(payload) ?? (typeof amounts.blocked_reason === "string" ? amounts.blocked_reason : null),
      { spent: amounts.spent_usd, limit: amounts.limit_usd, estimate: amounts.estimate_usd },
    );
  }
  return payload as QpuRunRecord;
}

export async function fetchQpuRun(recordId: string): Promise<QpuRunRecord> {
  const response = await fetch(`/api/qpu/runs/${recordId}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`qpu run unavailable (${response.status})`);
  return (await response.json()) as QpuRunRecord;
}
