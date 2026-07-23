/**
 * Client for the control plane's stateless QPU surface. Estimates come from
 * the provider's published rate card with their source and confirmation date
 * attached; the submission gate reports why hardware submission is blocked in
 * this deployment. Nothing here fabricates availability: a failed fetch is an
 * unavailable catalog, never a default one.
 */

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
