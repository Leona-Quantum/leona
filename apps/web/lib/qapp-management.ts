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
