import type { components } from "@majorana/contracts-gen";

/**
 * The notifications inbox (ai-ops 349, option 2, "Job-finished notifications"):
 * a hardware run of yours finished, or someone mentioned you in a comment.
 *
 * Pure and fetch-injected, the pattern `comments.ts` and `access-tokens.ts`
 * already follow in this directory, so the bell and the inbox panel can be
 * tested without React.
 */

export type Notification = components["schemas"]["Notification"];
export type NotificationKind = components["schemas"]["NotificationKind"];
export type NotificationList = components["schemas"]["NotificationList"];

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * A page, or a thrown `NotificationRequestError` — never a half-read object.
 * Mirrors `comments.ts::readList`'s reasoning: a 200 that is not a
 * notification list must not reach a bell badge as `undefined.length`.
 */
async function readList(response: Response): Promise<NotificationList> {
  if (!response.ok) throw new NotificationRequestError(response.status);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new NotificationRequestError(response.status);
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { items?: unknown }).items) ||
    typeof (payload as { unread_count?: unknown }).unread_count !== "number"
  ) {
    throw new NotificationRequestError(response.status);
  }
  const list = payload as NotificationList;
  return {
    ...list,
    items: list.items.filter(
      (item) => Boolean(item) && typeof item === "object" && typeof item.id === "string",
    ),
    next_cursor: typeof list.next_cursor === "string" ? list.next_cursor : null,
  };
}

export async function fetchNotifications(
  fetcher: Fetch,
  cursor?: string | null,
): Promise<NotificationList> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return readList(await fetcher(`/api/notifications${query ? `?${query}` : ""}`, { cache: "no-store" }));
}

export async function markNotificationRead(fetcher: Fetch, id: string): Promise<void> {
  const response = await fetcher(`/api/notifications/${encodeURIComponent(id)}/read`, {
    method: "POST",
  });
  if (!response.ok) throw new NotificationRequestError(response.status);
}

export async function markAllNotificationsRead(fetcher: Fetch): Promise<void> {
  const response = await fetcher("/api/notifications/read-all", { method: "POST" });
  if (!response.ok) throw new NotificationRequestError(response.status);
}

export class NotificationRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`notification request failed with ${status}`);
    this.status = status;
  }
}

/** Merge a page (or a just-read notification) into what is already shown, by id. */
export function mergeNotifications(
  current: readonly Notification[],
  incoming: readonly Notification[],
): Notification[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  // Newest first: ids are uuid7, so a plain string comparison sorts by
  // creation time, the same rule `comments.ts::mergeComments` uses in the
  // other order for its oldest-first thread.
  return [...byId.values()].sort((a, b) => (a.id > b.id ? -1 : a.id < b.id ? 1 : 0));
}

/** Locally mark one notification read, for the optimistic click before the
 * network call answers. */
export function withRead(items: readonly Notification[], id: string, readAt: string): Notification[] {
  return items.map((item) => (item.id === id && !item.read_at ? { ...item, read_at: readAt } : item));
}

/** Locally mark every notification read, for "mark all read"'s optimistic click. */
export function withAllRead(items: readonly Notification[], readAt: string): Notification[] {
  return items.map((item) => (item.read_at ? item : { ...item, read_at: readAt }));
}

/** Where a notification's own link goes, from its `data` snapshot. `null` for
 * a kind or shape this build does not recognise — a link that goes nowhere
 * definite is worse than no link. */
export function notificationHref(notification: Pick<Notification, "kind" | "data">): string | null {
  const data = notification.data as Record<string, unknown> | null | undefined;
  if (!data) return null;
  if (notification.kind === "qpu_run_terminal") {
    return "/studio/hardware";
  }
  if (notification.kind === "mention") {
    const targetType = data.target_type;
    const targetId = data.target_id;
    if (typeof targetId !== "string") return null;
    const id = encodeURIComponent(targetId);
    if (targetType === "run") return `/run/${id}#comments`;
    if (targetType === "notebook") return `/notebooks/${id}#comments`;
    if (targetType === "artifact") return `/studio?artifact=${id}#comments`;
  }
  return null;
}
