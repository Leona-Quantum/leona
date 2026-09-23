/**
 * Types for the route-local Qapp response shapes (version history, rollback,
 * activity, usage) that never reach `packages/py/contracts` — same reasoning
 * as `lib/artifact-versions.ts`: these are one endpoint's own presentation of
 * data the shared contracts already describe elsewhere, so putting them in
 * majorana_contracts would mean a CONTRACTS_VERSION bump for a shape nothing
 * outside these routes consumes. `packages/ts/contracts-gen` is generated
 * from `openapi.json`'s exported model list only, so these are hand-typed
 * here rather than imported from `@majorana/contracts-gen`.
 */

export type QappRangeSmoke = {
  status: "ok" | "warn" | "not_applicable" | "unreachable" | "failed";
  detail: string;
  duration_ms: number | null;
};

export type QappVersionSummary = {
  id: string;
  seq: number;
  is_current: boolean;
  framework: string;
  qubits_estimate: number;
  fingerprint: string;
  created_at: string;
  range_smoke: QappRangeSmoke | null;
};

export type QappVersionPage = {
  versions: QappVersionSummary[];
  current_version_id: string | null;
  next_before_seq: number | null;
};

export type QappActivityEntry = {
  action: string;
  actor_user_id: string;
  created_at: string;
  meta: Record<string, unknown> | null;
};

export type QappVersionUsage = {
  qapp_version_id: string;
  total: number;
  succeeded: number;
  failed: number;
  queued: number;
  running: number;
  last_execution_at: string | null;
  last_execution_status: string | null;
};

export type PublicQappGalleryItem = {
  slug: string;
  title: string;
  description: string;
  framework: string;
  qubits_estimate: number;
  version: number;
  published_at: string;
};

export type PublicQappPage = {
  items: PublicQappGalleryItem[];
  next_cursor: string | null;
};

/**
 * Read `GET /v1/qapps/public` in either shape: `{ items, next_cursor }`
 * (proposal 6) or the bare array the API returned before it. The API and the
 * website deploy separately (`deploy.yml`, `deploy-web.yml`), so for a few
 * minutes after the change ships either side can be talking to the other's
 * old version; this keeps the gallery rendering through that window instead
 * of throwing on `items` being undefined. Returns null for anything else.
 */
export function readPublicQappPage(payload: unknown): PublicQappPage | null {
  if (Array.isArray(payload)) return { items: payload as PublicQappGalleryItem[], next_cursor: null };
  if (payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)) {
    const page = payload as { items: PublicQappGalleryItem[]; next_cursor?: unknown };
    return { items: page.items, next_cursor: typeof page.next_cursor === "string" ? page.next_cursor : null };
  }
  return null;
}

/** One of Leona's example Qapps (ai-ops 363), as `GET /v1/qapps/examples` lists it. */
export type QappExampleSummary = {
  key: string;
  title: string;
  description: string;
  framework: string;
  qubits_estimate: number;
};

function isQappExampleSummary(value: unknown): value is QappExampleSummary {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.key === "string" && row.key.length > 0
    && typeof row.title === "string"
    && typeof row.description === "string"
    && typeof row.framework === "string"
    && typeof row.qubits_estimate === "number";
}

/**
 * Read `GET /v1/qapps/examples`. Null for anything that is not a list of
 * well-formed rows, never a partial list. That includes the answer an API from
 * before the examples shipped gives for this path (it reads "examples" as a
 * Qapp id and refuses it), which is what the website sees for the minutes when
 * the two deploys are out of step.
 */
export function readQappExamples(payload: unknown): QappExampleSummary[] | null {
  if (!Array.isArray(payload)) return null;
  return payload.every(isQappExampleSummary) ? payload : null;
}
