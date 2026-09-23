import assert from "node:assert/strict";
import test from "node:test";

import {
  type Notification,
  NotificationRequestError,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  mergeNotifications,
  notificationHref,
  withAllRead,
  withRead,
} from "./notifications.ts";

let counter = 0;
function notification(overrides: Partial<Notification> = {}): Notification {
  counter += 1;
  return {
    id: `0190a4f0-0000-7000-9000-${String(counter).padStart(12, "0")}`,
    kind: "qpu_run_terminal",
    summary: "Your hardware run on IBM Quantum · Open Plan queue finished.",
    data: { qpu_run_id: "run-1", device_id: "ibm.open_plan", status: "done" },
    created_at: "2026-09-22T10:00:00Z",
    read_at: null,
    ...overrides,
  };
}

test("merging a page or a re-read notification keeps one copy, newest first", () => {
  const older = notification();
  const newer = notification();
  const updated = { ...older, read_at: "2026-09-22T10:05:00Z" };
  const merged = mergeNotifications([older, newer], [updated]);
  assert.deepEqual(merged.map((item) => item.id), [newer.id, older.id]);
  assert.equal(merged.find((item) => item.id === older.id)?.read_at, updated.read_at);
});

test("withRead marks only the named, still-unread notification", () => {
  const a = notification();
  const b = notification({ read_at: "2026-09-22T09:00:00Z" });
  const marked = withRead([a, b], a.id, "2026-09-22T10:10:00Z");
  assert.equal(marked.find((item) => item.id === a.id)?.read_at, "2026-09-22T10:10:00Z");
  // Already-read stays exactly as it was, not bumped to the new timestamp.
  assert.equal(marked.find((item) => item.id === b.id)?.read_at, "2026-09-22T09:00:00Z");
});

test("withAllRead marks every unread notification and leaves read ones untouched", () => {
  const a = notification();
  const b = notification({ read_at: "2026-09-22T09:00:00Z" });
  const marked = withAllRead([a, b], "2026-09-22T10:10:00Z");
  assert.equal(marked.find((item) => item.id === a.id)?.read_at, "2026-09-22T10:10:00Z");
  assert.equal(marked.find((item) => item.id === b.id)?.read_at, "2026-09-22T09:00:00Z");
});

test("a hardware-job notification links to the hardware history page", () => {
  const item = notification();
  assert.equal(notificationHref(item), "/studio/hardware");
});

test("a mention notification links to its target's comment thread", () => {
  const run = notification({
    kind: "mention",
    data: { comment_id: "c1", target_type: "run", target_id: "r1" },
  });
  const notebook = notification({
    kind: "mention",
    data: { comment_id: "c2", target_type: "notebook", target_id: "n1" },
  });
  const artifact = notification({
    kind: "mention",
    data: { comment_id: "c3", target_type: "artifact", target_id: "a1" },
  });
  assert.equal(notificationHref(run), "/run/r1#comments");
  assert.equal(notificationHref(notebook), "/notebooks/n1#comments");
  assert.equal(notificationHref(artifact), "/studio?artifact=a1#comments");
});

test("an unrecognised kind or a missing target links nowhere, rather than a guess", () => {
  assert.equal(notificationHref({ kind: "mention", data: {} }), null);
  assert.equal(
    notificationHref({ kind: "something-new" as Notification["kind"], data: { x: 1 } }),
    null,
  );
});

function fakeFetch(handlers: Record<string, () => Response>) {
  return async (input: string) => {
    const path = input.split("?")[0];
    const handler = handlers[path];
    if (!handler) throw new Error(`unexpected request: ${input}`);
    return handler();
  };
}

test("fetchNotifications refuses a 200 body that is not a notification list", async () => {
  const fetcher = fakeFetch({
    "/api/notifications": () => new Response(JSON.stringify({ items: "not-an-array" }), { status: 200 }),
  });
  await assert.rejects(fetchNotifications(fetcher), NotificationRequestError);
});

test("fetchNotifications drops a malformed item rather than passing it through", async () => {
  const fetcher = fakeFetch({
    "/api/notifications": () =>
      new Response(
        JSON.stringify({ items: [notification(), { no: "id" }], next_cursor: null, unread_count: 1 }),
        { status: 200 },
      ),
  });
  const list = await fetchNotifications(fetcher);
  assert.equal(list.items.length, 1);
  assert.equal(list.unread_count, 1);
});

test("markNotificationRead and markAllNotificationsRead throw on a non-2xx response", async () => {
  const refusing = fakeFetch({
    "/api/notifications/abc/read": () => new Response(null, { status: 404 }),
    "/api/notifications/read-all": () => new Response(null, { status: 403 }),
  });
  await assert.rejects(markNotificationRead(refusing, "abc"), NotificationRequestError);
  await assert.rejects(markAllNotificationsRead(refusing), NotificationRequestError);
});
