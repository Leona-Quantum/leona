import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PRESENCE_AVATARS,
  type PresenceViewer,
  PresenceRequestError,
  fetchViewers,
  isPresenceTrackableId,
  sendHeartbeat,
  splitForDisplay,
  viewerName,
} from "./presence.ts";

function viewer(overrides: Partial<PresenceViewer> = {}): PresenceViewer {
  return {
    user_id: "0190a4f0-0000-7000-8000-000000000001",
    display_name: "Sam Okafor",
    handle: "sam.okafor",
    ...overrides,
  };
}

test("a saved run, notebook or circuit id is trackable; an example id and junk are not", () => {
  assert.equal(isPresenceTrackableId("0190a4f0-0000-7000-8000-000000000001"), true);
  assert.equal(isPresenceTrackableId("bell-pair-example"), false);
  assert.equal(isPresenceTrackableId(null), false);
  assert.equal(isPresenceTrackableId(undefined), false);
});

test("a viewer's name falls back to their handle when there is no display name", () => {
  assert.equal(viewerName(viewer()), "Sam Okafor");
  assert.equal(viewerName(viewer({ display_name: null })), "sam.okafor");
});

test("the first MAX_PRESENCE_AVATARS are shown, and the rest are the overflow", () => {
  const viewers = Array.from({ length: MAX_PRESENCE_AVATARS + 2 }, (_, i) =>
    viewer({ user_id: `0190a4f0-0000-7000-8000-${String(i).padStart(12, "0")}` }),
  );
  const { shown, overflow } = splitForDisplay(viewers);
  assert.equal(shown.length, MAX_PRESENCE_AVATARS);
  assert.equal(overflow.length, 2);
  assert.deepEqual(shown, viewers.slice(0, MAX_PRESENCE_AVATARS));
});

test("fewer viewers than the limit means no overflow at all", () => {
  const { shown, overflow } = splitForDisplay([viewer()]);
  assert.equal(shown.length, 1);
  assert.equal(overflow.length, 0);
});

test("a heartbeat posts the target and never throws for a well-formed response", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher = async (input: string, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(null, { status: 204 });
  };
  await sendHeartbeat(fetcher, "run", "0190a4f0-0000-7000-8000-000000000001");
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.input, "/api/presence/heartbeat");
  assert.equal(call.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(call.init?.body)), {
    target_type: "run",
    target_id: "0190a4f0-0000-7000-8000-000000000001",
  });
});

test("reading the roster asks for the right target and returns only well-formed viewers", async () => {
  let seenUrl: string | null = null;
  const fetcher = async (input: string) => {
    seenUrl = input;
    return new Response(JSON.stringify({ viewers: [viewer(), { garbage: true }, null] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const viewers = await fetchViewers(fetcher, "notebook", "0190a4f0-0000-7000-8000-000000000002");
  assert.equal(seenUrl, "/api/presence?target_type=notebook&target_id=0190a4f0-0000-7000-8000-000000000002");
  assert.deepEqual(viewers, [viewer()]);
});

test("a refused read throws PresenceRequestError with the status, never a half-read object", async () => {
  const fetcher = async () => new Response("not found", { status: 404 });
  await assert.rejects(
    () => fetchViewers(fetcher, "run", "0190a4f0-0000-7000-8000-000000000001"),
    (error: unknown) => error instanceof PresenceRequestError && error.status === 404,
  );
});

test("a response with no viewers array reads as nobody else being here", async () => {
  const fetcher = async () =>
    new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
  const viewers = await fetchViewers(fetcher, "run", "0190a4f0-0000-7000-8000-000000000001");
  assert.deepEqual(viewers, []);
});
