import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { render, screen, waitFor } from "@testing-library/react";
import { PresenceBar } from "../../components/presence-bar.tsx";
import { stubFetch } from "./dom-env.ts";

const RUN_ID = "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3a40";
const AIKO = { user_id: "0199a7c2-0000-7000-8000-000000000001", display_name: "Aiko Tanaka", handle: "aiko" };
const SAM = { user_id: "0199a7c2-0000-7000-8000-000000000002", display_name: null, handle: "sam.okafor" };

test("nobody else here renders nothing, not an empty bar", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "POST") return { status: 204 };
    return { status: 200, body: { viewers: [] } };
  });
  try {
    render(<PresenceBar targetType="run" targetId={RUN_ID} locale="en" />);
    await waitFor(() => assert.ok(fetchStub.calls.some((c) => c.method === "POST")));
    assert.equal(document.querySelector(".mj-presence"), null);
  } finally {
    fetchStub.restore();
  }
});

test("a heartbeat is sent for the right target, and the roster it reads back is shown", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "POST") return { status: 204 };
    return { status: 200, body: { viewers: [AIKO, SAM] } };
  });
  try {
    render(<PresenceBar targetType="notebook" targetId={RUN_ID} locale="en" />);
    const group = await screen.findByRole("group");
    assert.equal(group.getAttribute("aria-label"), "Also here: Aiko Tanaka, sam.okafor");
    assert.equal(document.querySelectorAll(".mj-presence-avatar").length, 2);
    assert.ok(screen.getByText("AT"), "initials for a display name");
    assert.ok(screen.getByText("SO"), "initials from a dotted handle when there is no display name");

    const beat = fetchStub.calls.find((c) => c.method === "POST");
    assert.ok(beat);
    assert.equal(beat!.url, "/api/presence/heartbeat");
    assert.deepEqual(beat!.body, { target_type: "notebook", target_id: RUN_ID });

    const readUrl = fetchStub.calls.map((c) => c.url).find((url) => url.startsWith("/api/presence?"));
    assert.equal(readUrl, `/api/presence?target_type=notebook&target_id=${RUN_ID}`);
  } finally {
    fetchStub.restore();
  }
});

test("more than four viewers collapses the rest into a +N badge", async () => {
  const many = Array.from({ length: 6 }, (_, i) => ({
    user_id: `0199a7c2-0000-7000-8000-00000000000${i}`,
    display_name: `Person ${i}`,
    handle: `person${i}`,
  }));
  const fetchStub = stubFetch((request) => {
    if (request.method === "POST") return { status: 204 };
    return { status: 200, body: { viewers: many } };
  });
  try {
    render(<PresenceBar targetType="artifact" targetId={RUN_ID} locale="en" />);
    await screen.findByRole("group");
    assert.equal(document.querySelectorAll(".mj-presence-avatar").length, 5, "four shown plus one overflow badge");
    const overflow = document.querySelector(".mj-presence-overflow");
    assert.equal(overflow?.textContent, "+2");
    assert.ok(overflow?.getAttribute("title")?.includes("Person 4"));
    assert.ok(overflow?.getAttribute("title")?.includes("Person 5"));
  } finally {
    fetchStub.restore();
  }
});

test("Japanese copy reads correctly and never breaks the aria-label", async () => {
  const fetchStub = stubFetch((request) => {
    if (request.method === "POST") return { status: 204 };
    return { status: 200, body: { viewers: [AIKO] } };
  });
  try {
    render(<PresenceBar targetType="run" targetId={RUN_ID} locale="ja" />);
    const group = await screen.findByRole("group");
    assert.equal(group.getAttribute("aria-label"), "Aiko Tanakaさんも見ています");
  } finally {
    fetchStub.restore();
  }
});

test("a fixture `initial` list renders without ever calling fetch", async () => {
  const fetchStub = stubFetch(() => {
    throw new Error("the harness must not hit the network");
  });
  try {
    render(<PresenceBar targetType="run" targetId={RUN_ID} locale="en" initial={[AIKO]} />);
    await screen.findByRole("group");
    assert.equal(fetchStub.calls.length, 0);
  } finally {
    fetchStub.restore();
  }
});
