import type { components } from "@majorana/contracts-gen";

/**
 * The comments panel's data and its pure rules: threads, paging, the
 * "@" autocomplete, and where each thing a comment is on lives in the app.
 *
 * Pure and fetch-injected so `node --test` can check it; the panel
 * (`components/comments-panel.tsx`) is the only caller.
 */

export type Comment = components["schemas"]["Comment"];
export type CommentList = components["schemas"]["CommentList"];
export type CommentPerson = components["schemas"]["CommentPerson"];
export type CommentTargetType = components["schemas"]["CommentTargetType"];

/** The API's own ceiling (`MAX_COMMENT_CHARS`); checked here only to say so before posting. */
export const MAX_COMMENT_CHARS = 4000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether an id can be commented on at all. Studio also opens circuits that
 * exist only in this browser, and the run page renders built-in example runs;
 * neither has a row on the server, so neither gets a panel that could only
 * ever answer 404.
 */
export function isCommentableId(id: string | null | undefined): id is string {
  return typeof id === "string" && UUID_PATTERN.test(id);
}

export type Thread = { comment: Comment; replies: Comment[] };

/**
 * Top-level comments in order, each with its replies in order.
 *
 * The API pages oldest first across the whole target, so a reply always
 * arrives after its parent. A reply whose parent is not in `items` (a page
 * boundary that has not been crossed yet) is held back rather than promoted to
 * the top level, where it would read as a comment on the thing itself.
 */
export function threadsOf(items: readonly Comment[]): Thread[] {
  const threads: Thread[] = [];
  const byId = new Map<string, Thread>();
  for (const item of items) {
    if (!item.parent_id) {
      const thread = { comment: item, replies: [] };
      threads.push(thread);
      byId.set(item.id, thread);
    }
  }
  for (const item of items) {
    if (item.parent_id) byId.get(item.parent_id)?.replies.push(item);
  }
  return threads;
}

/** Merge a page (or one posted/edited comment) into what is already shown, by id. */
export function mergeComments(current: readonly Comment[], incoming: readonly Comment[]): Comment[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The partial handle being typed at the caret, if the caret sits right after
 * `@` plus handle characters that start a word. Mirrors the server's token
 * rule closely enough that a suggestion is only offered where it would resolve.
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[^A-Za-z0-9._+\-@/])@([A-Za-z0-9._+-]*)$/.exec(before);
  if (!match) return null;
  const query = match[2];
  return { start: caret - query.length - 1, query: query.toLowerCase() };
}

/** Members whose handle or name starts with, then contains, the query. At most `limit`. */
export function mentionSuggestions(
  people: readonly CommentPerson[],
  query: string,
  limit = 5,
): CommentPerson[] {
  const q = query.toLowerCase();
  const scored = people
    .filter((person) => person.current_member !== false && person.handle)
    .map((person) => {
      const handle = person.handle.toLowerCase();
      const name = (person.display_name ?? "").toLowerCase();
      const rank = handle.startsWith(q) ? 0 : name.startsWith(q) ? 1 : handle.includes(q) || name.includes(q) ? 2 : 3;
      return { person, rank };
    })
    .filter(({ rank }) => rank < 3);
  scored.sort((a, b) => a.rank - b.rank || a.person.handle.localeCompare(b.person.handle));
  return scored.slice(0, limit).map(({ person }) => person);
}

/** Replace the `@partial` at the caret with `@handle `, returning the new text and caret. */
export function insertMention(
  text: string,
  caret: number,
  handle: string,
): { text: string; caret: number } {
  const found = mentionQuery(text, caret);
  if (!found) return { text, caret };
  // One space after the handle, whether it was already there or not, and the
  // caret after that space so the next word can be typed straight away.
  const spaced = /^\s/.test(text.slice(caret));
  const inserted = spaced ? `@${handle}` : `@${handle} `;
  const next = text.slice(0, found.start) + inserted + text.slice(caret);
  return { text: next, caret: found.start + inserted.length + (spaced ? 1 : 0) };
}

/** The fragment every comments panel answers to, so a Mentions link lands on the thread. */
export const COMMENTS_ANCHOR = "#comments";

/** Where the thing a comment is on lives, for the Mentions list, opened at its comments. */
export function targetHref(targetType: CommentTargetType, targetId: string): string {
  const id = encodeURIComponent(targetId);
  if (targetType === "run") return `/run/${id}${COMMENTS_ANCHOR}`;
  if (targetType === "notebook") return `/notebooks/${id}${COMMENTS_ANCHOR}`;
  return `/studio?artifact=${id}${COMMENTS_ANCHOR}`;
}

/** The refusal reason a failed request carried, if it carried one. */
export async function refusalReason(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as { reason?: unknown };
    return typeof payload.reason === "string" ? payload.reason : null;
  } catch {
    return null;
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * A page, or a thrown `CommentRequestError` — never a half-read object.
 *
 * The panel sits inside pages that matter more than it does (a notebook, a run,
 * Studio). A 200 that is not a comment list — an older control plane, a proxy
 * error page, a test double answering every URL with the notebook — used to
 * reach `threadsOf` as `items: undefined`, throw during render, and take the
 * whole notebook page down with it. Refused here, it becomes the panel's own
 * "could not load" state and nothing else on the page notices.
 */
async function readList(response: Response): Promise<CommentList> {
  if (!response.ok) throw new CommentRequestError(response.status, await refusalReason(response));
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CommentRequestError(response.status, "unreadable_response");
  }
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { items?: unknown }).items)) {
    throw new CommentRequestError(response.status, "unexpected_response");
  }
  const list = payload as CommentList;
  return {
    ...list,
    items: list.items.filter((item) => Boolean(item) && typeof item === "object" && typeof item.id === "string"),
    next_cursor: typeof list.next_cursor === "string" ? list.next_cursor : null,
  };
}

export async function fetchThread(
  fetcher: Fetch,
  targetType: CommentTargetType,
  targetId: string,
  cursor?: string | null,
): Promise<CommentList> {
  const params = new URLSearchParams({ target_type: targetType, target_id: targetId });
  if (cursor) params.set("cursor", cursor);
  return readList(await fetcher(`/api/comments?${params}`, { cache: "no-store" }));
}

export async function fetchMentions(fetcher: Fetch, cursor?: string | null): Promise<CommentList> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return readList(await fetcher(`/api/comments/mentions${query ? `?${query}` : ""}`, { cache: "no-store" }));
}

export class CommentRequestError extends Error {
  readonly status: number;
  readonly reason: string | null;

  constructor(status: number, reason: string | null) {
    super(`comment request failed with ${status}`);
    this.status = status;
    this.reason = reason;
  }
}
