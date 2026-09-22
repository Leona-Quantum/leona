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
  /**
   * Whether Leona can send a job to this device, or only price it. Only IBM has
   * a submit route today. Absent from an API that predates the field, which
   * never refused on it, so read it as `isPricedOnly` does: only an explicit
   * `false` means priced-only.
   */
  submittable?: boolean;
};

/** A device on the rate card that Leona can estimate but not submit to. */
export function isPricedOnly(backend: Pick<QpuBackendInfo, "submittable">): boolean {
  return backend.submittable === false;
}

export type QpuCostEstimate = {
  device_id: string;
  /** Per circuit, as asked for. */
  shots: number;
  /**
   * Circuits the submission sends: 1, or 3 with zero-noise extrapolation.
   * Optional because an API older than the field sends nothing, and it only
   * ever priced one circuit.
   */
  circuits?: number;
  /** Shots the provider runs in total, `shots * circuits`. */
  total_shots?: number | null;
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
    | "provider_not_supported"
    | null;
};

export async function fetchQpuBackends(): Promise<QpuBackendInfo[]> {
  const response = await fetch("/api/qpu/backends", { cache: "no-store" });
  if (!response.ok) throw new Error(`qpu backends unavailable (${response.status})`);
  const payload = (await response.json()) as { backends?: unknown };
  if (!Array.isArray(payload.backends)) throw new Error("qpu backends payload malformed");
  return payload.backends as QpuBackendInfo[];
}

export async function fetchQpuEstimate(deviceKey: string, shots: number, options: { zne?: boolean } = {}): Promise<QpuCostEstimate> {
  // `zne` is sent only when asked for, so an API older than the field (which is
  // `extra="forbid"`) never sees a key it would refuse.
  const response = await fetch("/api/qpu/estimates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options.zne ? { device_id: deviceKey, shots, zne: true } : { device_id: deviceKey, shots }),
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
  /**
   * The physical machine the provider ran the job on (`ibm_brisbane`), as the
   * provider named it. `device_id` is Leona's catalog entry, and IBM picks the
   * machine itself, so this is the only field that says which processor the
   * counts came from. Null when nothing was reported, which includes every run
   * recorded before the field existed; optional because an API older than it
   * sends nothing at all. Read it through `backendNameOf`.
   */
  backend_name?: string | null;
  shots: number;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  source_fingerprint: string;
  estimated_total_usd: number | null;
  rate_source: string;
  rate_confirmed_on: string;
  raw_counts: Record<string, number> | null;
  /**
   * What mitigation needs (migration 0066): the zero-noise-extrapolation opt-in,
   * the readout calibration recorded at submit, and the folded circuits' counts.
   * Read it only through `readMitigation` (qpu-mitigation.ts), which refuses a
   * version it does not know. Optional because an older API sends nothing.
   */
  mitigation?: unknown;
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
  /** Opt in to zero-noise extrapolation. Omitted from the body unless true. */
  zne?: boolean;
}): Promise<QpuRunRecord> {
  const { zne, ...rest } = request;
  const response = await fetch("/api/qpu/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(zne ? { ...rest, zne: true } : rest),
    cache: "no-store",
  });
  // Parsed defensively, because the body is not always this API's. A proxy
  // answering 502 with an HTML error page, or a gateway with an empty body,
  // makes `response.json()` throw a raw SyntaxError — which escapes before any
  // of the fallback below runs, so the person sees a parser's complaint instead
  // of the sentence written for them. `null` here lets every reader treat it as
  // "no readable body" rather than as a thrown parse error.
  const payload: unknown = await response.json().catch(() => null);
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
  if (payload === null) {
    // A 2xx whose body did not parse. Returning it as a record would put
    // `undefined` in the status field and poll forever on `undefined` — say so
    // instead, since a submission may well have been accepted.
    throw new QpuSubmissionRefused(`qpu submission returned an unreadable body (${response.status})`, null);
  }
  return payload as QpuRunRecord;
}

export async function fetchQpuRun(recordId: string): Promise<QpuRunRecord> {
  const response = await fetch(`/api/qpu/runs/${recordId}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`qpu run unavailable (${response.status})`);
  return (await response.json()) as QpuRunRecord;
}

/** The machine a run went to, or null when none was recorded. Never a guess. */
export function backendNameOf(record: Pick<QpuRunRecord, "backend_name">): string | null {
  const name = record.backend_name;
  return typeof name === "string" && name.trim() ? name : null;
}

/** One run in the workspace history: the record plus the program that was submitted. */
export type QpuRunHistoryItem = QpuRunRecord & { qasm: string };

export type QpuRunPage = {
  items: QpuRunHistoryItem[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  next_cursor: string | null;
};

/**
 * One page of `GET /v1/qpu/runs`, newest first. `sourceFingerprint` narrows it
 * to one circuit, which is how Studio finds the last run of what is on screen.
 *
 * A body without an `items` array is refused rather than read as an empty
 * history: "no runs yet" is a sentence the page shows, and it must not be shown
 * for a response that simply failed to parse.
 */
export async function fetchQpuRunHistory(
  options: { cursor?: string | null; limit?: number; sourceFingerprint?: string } = {},
): Promise<QpuRunPage> {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.sourceFingerprint) params.set("source_fingerprint", options.sourceFingerprint);
  const query = params.toString();
  const response = await fetch(`/api/qpu/runs${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`qpu run history unavailable (${response.status})`);
  const payload = (await response.json().catch(() => null)) as { items?: unknown; next_cursor?: unknown } | null;
  if (!payload || !Array.isArray(payload.items)) throw new Error("qpu run history payload malformed");
  return {
    items: payload.items as QpuRunHistoryItem[],
    next_cursor: typeof payload.next_cursor === "string" ? payload.next_cursor : null,
  };
}

/** The most recent run of one circuit in this workspace, or null if it never ran. */
export async function fetchLatestQpuRunFor(sourceFingerprint: string): Promise<QpuRunHistoryItem | null> {
  const page = await fetchQpuRunHistory({ sourceFingerprint, limit: 1 });
  return page.items[0] ?? null;
}
