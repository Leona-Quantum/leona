/**
 * The "Run on hardware" card under a notebook cell: its fingerprints and its state
 * machine, kept free of React so both can be tested without a DOM.
 *
 * A cell asks for a QPU run by calling `leona_submit(circuit, shots=...)`. The sandbox
 * sends nothing; it records a `HardwareRequest` on the cell's result
 * (`packages/py/notebooks/src/leona_notebooks/hardware.py`). This card is the only
 * thing that ever submits one, and only after the reader has picked a device, been
 * shown the price and pressed confirm. It goes through the same BFF route and the same
 * `POST /v1/qpu/submissions` Studio uses, under the reader's own IBM credential (plan
 * rule 4, `10-notebook-ide-20260923.md`). There is no second submission path here.
 */
import type { components } from "@majorana/contracts-gen";
import {
  QpuSubmissionRefused,
  fetchQpuBackends,
  fetchQpuRunHistory,
  fetchQpuSubmissionGate,
  formatUsd,
  type QpuBackendInfo,
  type QpuCostEstimate,
  type QpuRunHistoryItem,
  type QpuRunRecord,
  type QpuSubmissionGate,
} from "./qpu.ts";
import { parseUsage, type HardwareSpend } from "./usage-summary.ts";

export type HardwareRequest = components["schemas"]["HardwareRequest"];

/** `QpuSubmissionRequest.source_fingerprint` is `max_length=200` on the route. */
export const MAX_SOURCE_FINGERPRINT_CHARS = 200;
/** How much of the program's SHA-256 the fingerprint carries. */
export const QASM_DIGEST_HEX_CHARS = 12;

/** What identifies one request's runs: whose notebook, which version and cell, which circuit. */
export type NotebookRunKey = { notebookId: string; seq: number; cellId: string; digest: string };

/**
 * The first 12 hex digits of the program's SHA-256.
 *
 * SHA-256 rather than the FNV-1a Studio uses for `sourceFingerprint`, because this
 * value decides whether a run found in the reader's history is shown as the result of
 * the circuit on screen. A 32-bit hash collides often enough across a whole workspace's
 * history to put one circuit's counts under another's cell; 48 bits of SHA-256 does not.
 */
export async function qasmDigest(qasm: string): Promise<string> {
  const bytes = new TextEncoder().encode(qasm);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, QASM_DIGEST_HEX_CHARS);
}

/**
 * `notebook:<notebookId>:v<seq>:<cellId>:<digest>` — what a submission from this card
 * sends as `source_fingerprint`, and therefore what finds its runs again after a reload.
 *
 * Throws rather than truncating past the route's 200 characters: a truncated
 * fingerprint would be accepted and then never match anything, and the reader's run
 * would silently vanish from the cell on the next load. None of the parts can contain
 * a colon (UUIDs, integers, cell ids `[a-z0-9_-]`, hex), so the string parses back.
 */
export function notebookHardwareFingerprint(key: NotebookRunKey): string {
  const fingerprint = `notebook:${key.notebookId}:v${key.seq}:${key.cellId}:${key.digest}`;
  if (fingerprint.length > MAX_SOURCE_FINGERPRINT_CHARS) {
    throw new Error(`notebook hardware fingerprint is ${fingerprint.length} characters; the route takes ${MAX_SOURCE_FINGERPRINT_CHARS}`);
  }
  if (!FINGERPRINT.test(fingerprint)) throw new Error("notebook hardware fingerprint has a malformed part");
  return fingerprint;
}

const FINGERPRINT = /^notebook:([^:\s]+):v(\d+):([a-z0-9][a-z0-9_-]{0,31}):([0-9a-f]{12})$/;

export function parseNotebookHardwareFingerprint(fingerprint: string): NotebookRunKey | null {
  const match = FINGERPRINT.exec(fingerprint);
  if (!match) return null;
  return { notebookId: match[1], seq: Number(match[2]), cellId: match[3], digest: match[4] };
}

/** Every run this notebook's cards could ever have sent starts with this. */
export function notebookFingerprintPrefix(notebookId: string): string {
  return `notebook:${notebookId}:`;
}

/**
 * Whether a run is one of THIS request's: the same notebook, the same cell, the same
 * circuit — in ANY version. The version is left out of the match on purpose. Every
 * rerun and every edit is a new version, and a circuit that did not change between
 * them is the same circuit; its counts are still its counts. The digest is what
 * stops a cell whose circuit DID change from showing the old circuit's result.
 */
export function isRunOfRequest(
  run: Pick<QpuRunRecord, "source_fingerprint">,
  key: Omit<NotebookRunKey, "seq">,
): boolean {
  if (!run.source_fingerprint.startsWith(notebookFingerprintPrefix(key.notebookId))) return false;
  const parsed = parseNotebookHardwareFingerprint(run.source_fingerprint);
  return parsed !== null && parsed.cellId === key.cellId && parsed.digest === key.digest && parsed.notebookId === key.notebookId;
}

/**
 * The newest of this request's runs in a page of history, with the version it was
 * sent from. `items` is newest first, as `GET /v1/qpu/runs` returns it.
 *
 * Client-side because the list endpoint filters on one EXACT `source_fingerprint`
 * and nothing else (`qpu_runs.list_records_stmt`), so "this cell in any version" is
 * not a query it can answer. The card asks it for the exact fingerprint first, which
 * is indexed and finds a run however old; this only widens the search to earlier
 * versions over the newest page of the reader's history.
 */
export function latestRunOfRequest<T extends Pick<QpuRunRecord, "source_fingerprint">>(
  items: readonly T[],
  key: Omit<NotebookRunKey, "seq">,
): { run: T; seq: number } | null {
  for (const item of items) {
    if (!isRunOfRequest(item, key)) continue;
    const parsed = parseNotebookHardwareFingerprint(item.source_fingerprint);
    if (parsed) return { run: item, seq: parsed.seq };
  }
  return null;
}

/** How many of the reader's newest runs the earlier-version search reads. */
export const HISTORY_SCAN_LIMIT = 50;
const HISTORY_CACHE_MS = 30_000;
let historyCache: { at: number; page: Promise<QpuRunHistoryItem[]> } | null = null;

/**
 * The newest page of the reader's hardware history, shared by every card on the page
 * for a short while. Up to eight cards can mount at once, and eight identical
 * requests for the same page would be seven wasted round trips.
 */
export function recentQpuRuns(now: number = Date.now()): Promise<QpuRunHistoryItem[]> {
  if (historyCache && now - historyCache.at < HISTORY_CACHE_MS) return historyCache.page;
  const page = fetchQpuRunHistory({ limit: HISTORY_SCAN_LIMIT }).then((result) => result.items);
  const entry = { at: now, page };
  historyCache = entry;
  // A failed read is not cached: the next card to ask gets a fresh attempt.
  page.catch(() => {
    if (historyCache === entry) historyCache = null;
  });
  return page;
}

/** For tests: forget the shared page and the shared catalog. */
export function clearRecentQpuRuns(): void {
  historyCache = null;
  catalogCache = null;
}

export type HardwareCatalog = { backends: QpuBackendInfo[]; gate: QpuSubmissionGate };
let catalogCache: Promise<HardwareCatalog> | null = null;

/**
 * The device list and the submission gate, read once per page for every card on it —
 * the same two reads Studio's hardware panel makes on mount. A failure is not kept,
 * so a card mounted after a blip tries again.
 */
export function hardwareCatalog(): Promise<HardwareCatalog> {
  if (catalogCache) return catalogCache;
  const pending = Promise.all([fetchQpuBackends(), fetchQpuSubmissionGate()]).then(([backends, gate]) => ({ backends, gate }));
  catalogCache = pending;
  pending.catch(() => {
    if (catalogCache === pending) catalogCache = null;
  });
  return pending;
}

/**
 * The account's hardware spend in the usage window, for the confirm step's allowance
 * line. Read through `parseUsage`, the same reader the account page's meters use, so
 * the two cannot disagree about what the API sent. `null` is "could not be read",
 * and the card then says nothing rather than a number it does not have.
 */
export async function fetchHardwareSpend(): Promise<HardwareSpend | null> {
  const response = await fetch("/api/usage", { cache: "no-store" });
  if (!response.ok) return null;
  const summary = parseUsage(await response.json().catch(() => null));
  return summary?.hardwareSpend ?? null;
}

/** The device a card starts on: the first one Leona can actually submit to. */
export function defaultDeviceId(backends: readonly QpuBackendInfo[]): string | null {
  const submittable = backends.find((backend) => backend.submittable !== false);
  return (submittable ?? backends[0])?.device_id ?? null;
}

// --------------------------------------------------------------------------- the card

export type HardwareCardPhase =
  | "idle"
  | "estimating"
  | "confirm"
  | "submitting"
  | "queued"
  | "running"
  | "done"
  | "error";

export type HardwareCardState = {
  phase: HardwareCardPhase;
  deviceId: string | null;
  estimate: QpuCostEstimate | null;
  run: QpuRunRecord | null;
  /** The version a restored run was sent from, when it is not the one on screen. */
  restoredFromSeq: number | null;
  error: { message: string; reason: string | null } | null;
};

export const INITIAL_HARDWARE_CARD_STATE: HardwareCardState = {
  phase: "idle",
  deviceId: null,
  estimate: null,
  run: null,
  restoredFromSeq: null,
  error: null,
};

export type HardwareCardEvent =
  | { type: "chooseDevice"; deviceId: string }
  | { type: "estimate" }
  | { type: "estimated"; deviceId: string; estimate: QpuCostEstimate }
  | { type: "estimateFailed"; deviceId: string; message: string }
  | { type: "cancel" }
  | { type: "submit" }
  | { type: "submitted"; run: QpuRunRecord }
  | { type: "submitFailed"; message: string; reason: string | null }
  | { type: "polled"; run: QpuRunRecord }
  | { type: "restored"; run: QpuRunRecord; fromSeq: number | null }
  | { type: "again" };

/** Where a run's provider status puts the card. */
export function phaseForRun(run: Pick<QpuRunRecord, "status">): "queued" | "running" | "done" | "error" {
  if (run.status === "queued") return "queued";
  if (run.status === "running") return "running";
  if (run.status === "done") return "done";
  return "error";
}

/** Phases in which a submission exists or is on its way — nothing may start another. */
const IN_FLIGHT: ReadonlySet<HardwareCardPhase> = new Set(["submitting", "queued", "running"]);

/** Back to resting: the run on show (whatever its status says), or idle with none. */
function atRest(state: HardwareCardState): HardwareCardState {
  if (state.run) return withRun({ ...state, estimate: null }, state.run, state.restoredFromSeq);
  return { ...state, phase: "idle", estimate: null, error: null };
}

function withRun(state: HardwareCardState, run: QpuRunRecord, restoredFromSeq: number | null): HardwareCardState {
  const phase = phaseForRun(run);
  return {
    ...state,
    phase,
    run,
    restoredFromSeq,
    error: phase === "error" ? { message: run.error ?? "", reason: null } : null,
  };
}

/**
 * Every transition the card makes. An event that does not apply in the current phase
 * returns the SAME state object, which is what makes a late answer harmless: an
 * estimate for a device the reader has since changed away from, a poll of a run that
 * is no longer shown, a restore that lands after the reader started a new run.
 *
 * `submit` is the one that matters most. It is accepted only from `confirm`, so a
 * second click on the confirm button — or a click that arrives while the first
 * request is still in flight — is a no-op here as well as in the component's own
 * lock. The route takes no idempotency key (`qpu_submit`), so the client is the only
 * place a double submission can be stopped, and it is stopped twice.
 */
export function hardwareCardReducer(state: HardwareCardState, event: HardwareCardEvent): HardwareCardState {
  switch (event.type) {
    case "chooseDevice":
      if (IN_FLIGHT.has(state.phase) || state.deviceId === event.deviceId) return state;
      // A price is a price for ONE device: changing device throws the old one away,
      // and an estimate still in flight for the old one is ignored when it lands.
      return atRest({ ...state, deviceId: event.deviceId });
    case "estimate":
      if (state.phase !== "idle" && state.phase !== "error" && state.phase !== "done") return state;
      if (!state.deviceId) return state;
      return { ...state, phase: "estimating", estimate: null, error: null };
    case "estimated":
      if (state.phase !== "estimating" || state.deviceId !== event.deviceId) return state;
      return { ...state, phase: "confirm", estimate: event.estimate };
    case "estimateFailed":
      if (state.phase !== "estimating" || state.deviceId !== event.deviceId) return state;
      return { ...state, phase: "error", error: { message: event.message, reason: null } };
    case "cancel":
      if (state.phase !== "confirm") return state;
      return atRest(state);
    case "submit":
      if (state.phase !== "confirm" || !state.deviceId || !state.estimate) return state;
      return { ...state, phase: "submitting", error: null };
    case "submitted":
      if (state.phase !== "submitting") return state;
      return withRun({ ...state, estimate: null }, event.run, null);
    case "submitFailed":
      if (state.phase !== "submitting") return state;
      return { ...state, phase: "error", error: { message: event.message, reason: event.reason } };
    case "polled":
      if (!state.run || state.run.id !== event.run.id) return state;
      if (state.phase !== "queued" && state.phase !== "running") return state;
      return withRun(state, event.run, state.restoredFromSeq);
    case "restored":
      // Only into an untouched card. A reader already pricing or sending a run is
      // ahead of whatever the history lookup found.
      if (state.phase !== "idle" || state.run) return state;
      return withRun(state, event.run, event.fromSeq);
    case "again":
      if (state.phase !== "done" && state.phase !== "error") return state;
      return { ...state, phase: "idle", run: null, restoredFromSeq: null, estimate: null, error: null };
  }
}

/** Whether the confirm button may send. The component also holds a ref lock. */
export function canSubmit(state: HardwareCardState, options: { credentialMissing: boolean; submittable: boolean; digestReady: boolean }): boolean {
  return (
    state.phase === "confirm" &&
    state.estimate !== null &&
    state.deviceId !== null &&
    !options.credentialMissing &&
    options.submittable &&
    options.digestReady
  );
}

/**
 * The sentence for a refused submission — the same reading Studio's hardware panel
 * gives the same refusal (`hardwareRefusalText` in studio-workspace.tsx), with the
 * Studio copy it already has for every reason code.
 */
export function refusalText(
  cause: unknown,
  copy: {
    hardwareEstimateFailed: string;
    hardwareSpendFreeTier: (estimate: string) => string;
    hardwareSpendExhausted: (estimate: string, limit: string, spent: string) => string;
    hardwareBlockedReason: (reason: string) => string;
  },
): { message: string; reason: string | null } {
  if (!(cause instanceof QpuSubmissionRefused)) {
    return { message: cause instanceof Error ? cause.message : copy.hardwareEstimateFailed, reason: null };
  }
  if (cause.reason === "qpu_spend_exhausted" && cause.estimateUsd !== null && cause.limitUsd !== null) {
    return {
      reason: cause.reason,
      message:
        cause.limitUsd === 0
          ? copy.hardwareSpendFreeTier(formatUsd(cause.estimateUsd))
          : copy.hardwareSpendExhausted(formatUsd(cause.estimateUsd), formatUsd(cause.limitUsd), formatUsd(cause.spentUsd ?? 0)),
    };
  }
  if (cause.reason) return { message: copy.hardwareBlockedReason(cause.reason), reason: cause.reason };
  return { message: cause.message, reason: null };
}
