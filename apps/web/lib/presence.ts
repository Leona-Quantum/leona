import type { components } from "@majorana/contracts-gen";

/**
 * Presence's data and its pure rules (proposal 9, second slice): who else in
 * the workspace is looking at the same run, notebook or saved circuit right
 * now.
 *
 * Pure and fetch-injected so `node --test` can check it; `components/presence-bar.tsx`
 * is the only caller.
 */

export type PresenceViewer = components["schemas"]["PresenceViewer"];
export type PresenceList = components["schemas"]["PresenceList"];
export type PresenceTargetType = components["schemas"]["PresenceTargetType"];

/** How often a visible tab heartbeats. Three of these missed in a row is the
 * server's own TTL (`PRESENCE_TTL_S` in `repos/presence.py`) — see that
 * constant's docstring for why three, not one. */
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 15_000;

/** Most avatars shown before the rest collapse into a "+N" badge. Kept small:
 * this is meant to be glanceable, not a roster. */
export const MAX_PRESENCE_AVATARS = 4;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same rule as `comments.ts::isCommentableId`, and for the same reason: a
 * circuit that lives only in this browser, or a built-in example run, has no
 * row on the server for anyone else to be present on. */
export function isPresenceTrackableId(id: string | null | undefined): id is string {
  return typeof id === "string" && UUID_PATTERN.test(id);
}

/** What to show for a viewer with no `display_name` (an email-only signup):
 * their bare handle, unlike `comments.ts`'s author label (`@handle`) — presence
 * has no @-mention concept, and the bare form is what `accountInitials` (used
 * for the avatar letters) expects: a name, not a mention token. */
export function viewerName(viewer: PresenceViewer): string {
  return viewer.display_name || viewer.handle;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class PresenceRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`presence request failed with ${status}`);
    this.status = status;
  }
}

/** "I am still looking at this." Never throws for a rate limit — the caller
 * treats a missed heartbeat as harmless, so only a genuine transport failure
 * is worth distinguishing, and `fetch` itself already throws for that. */
export async function sendHeartbeat(
  fetcher: Fetch,
  targetType: PresenceTargetType,
  targetId: string,
): Promise<void> {
  await fetcher("/api/presence/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_type: targetType, target_id: targetId }),
  });
}

/** Who else is here, right now. Never includes the caller — the server
 * already leaves them out. */
export async function fetchViewers(
  fetcher: Fetch,
  targetType: PresenceTargetType,
  targetId: string,
): Promise<PresenceViewer[]> {
  const params = new URLSearchParams({ target_type: targetType, target_id: targetId });
  const response = await fetcher(`/api/presence?${params}`, { cache: "no-store" });
  if (!response.ok) throw new PresenceRequestError(response.status);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PresenceRequestError(response.status);
  }
  const viewers = (payload as { viewers?: unknown })?.viewers;
  if (!Array.isArray(viewers)) return [];
  return viewers.filter(
    (item): item is PresenceViewer =>
      Boolean(item) && typeof item === "object" && typeof (item as PresenceViewer).user_id === "string",
  );
}

/** The first `MAX_PRESENCE_AVATARS` viewers, and how many more are not shown. */
export function splitForDisplay(
  viewers: readonly PresenceViewer[],
  limit = MAX_PRESENCE_AVATARS,
): { shown: PresenceViewer[]; overflow: PresenceViewer[] } {
  return { shown: viewers.slice(0, limit), overflow: viewers.slice(limit) };
}
