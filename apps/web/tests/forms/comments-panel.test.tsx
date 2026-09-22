import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommentsPanel } from "../../components/comments-panel.tsx";
import { stubFetch, type RecordedRequest } from "./dom-env.ts";

const RUN_ID = "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3a40";
const ME = { user_id: "0199a7c2-0000-7000-8000-000000000002", display_name: "Rui Costa", handle: "rui", current_member: true };

function created(body: string, id: string) {
  return {
    id,
    workspace_id: "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3a00",
    target_type: "run",
    target_id: RUN_ID,
    parent_id: null,
    author: ME,
    body,
    mentions: [],
    created_at: "2026-09-22T09:12:00Z",
    edited_at: null,
    deleted_at: null,
    can_edit: true,
    can_delete: true,
  };
}

function posts(calls: RecordedRequest[]) {
  return calls.filter((call) => call.method === "POST");
}

test("a post whose response was lost is retried with the SAME Idempotency-Key, and lands once", async () => {
  let attempt = 0;
  const fetchStub = stubFetch((request) => {
    if (request.method === "POST") {
      attempt += 1;
      // The first attempt reaches the server and its answer never comes back.
      if (attempt === 1) throw new TypeError("network connection lost");
      return { status: 201, body: created((request.body as { body: string }).body, "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3b01") };
    }
    if (request.url.startsWith("/api/comments/people")) return { status: 200, body: { items: [] } };
    return { status: 200, body: { items: [], next_cursor: null, can_comment: true } };
  });
  try {
    render(<CommentsPanel targetType="run" targetId={RUN_ID} locale="en" />);
    const box = await screen.findByLabelText("Write a comment");
    fireEvent.change(box, { target: { value: "Was the seed fixed on this one?" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByText("Could not post that. Your text is still here.");
    assert.equal((screen.getByLabelText("Write a comment") as HTMLTextAreaElement).value, "Was the seed fixed on this one?");

    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByText("Was the seed fixed on this one?", { selector: "p.mj-comment-body" });

    const [first, second] = posts(fetchStub.calls);
    const key = first.headers["Idempotency-Key"];
    assert.ok(key && key.length >= 16, "the post carries an Idempotency-Key");
    assert.equal(second.headers["Idempotency-Key"], key, "the retry reuses the first attempt's key");
    assert.deepEqual(second.body, first.body);
    assert.equal(document.querySelectorAll("p.mj-comment-body").length, 1, "the comment is shown once");
    assert.equal((screen.getByLabelText("Write a comment") as HTMLTextAreaElement).value, "", "the draft clears once it landed");

    // A different comment is a different submission, with a key of its own.
    fireEvent.change(screen.getByLabelText("Write a comment"), { target: { value: "Thanks." } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => assert.equal(posts(fetchStub.calls).length, 3));
    assert.notEqual(posts(fetchStub.calls)[2].headers["Idempotency-Key"], key);
  } finally {
    fetchStub.restore();
  }
});

test("a viewer reads the thread and is offered no box to write in", async () => {
  const fetchStub = stubFetch(() => ({
    status: 200,
    body: { items: [{ ...created("For everyone to read.", "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3b02"), can_edit: false, can_delete: false }], next_cursor: null, can_comment: false },
  }));
  try {
    render(<CommentsPanel targetType="run" targetId={RUN_ID} locale="en" />);
    await screen.findByText("For everyone to read.");
    assert.equal(screen.queryByLabelText("Write a comment") === null, true, "no composer for a viewer");
    assert.equal(screen.queryByRole("button", { name: "Reply" }) === null, true, "no reply for a viewer");
    screen.getByText("You can read the comments here. Viewers cannot write them.");
    assert.equal(fetchStub.calls.some((call) => call.url.startsWith("/api/comments/people")), false, "a viewer does not load the people to mention");
  } finally {
    fetchStub.restore();
  }
});

test("a body carrying markup and a javascript: link reaches the DOM as text", async () => {
  const hostile = '<img src=x onerror="window.__pwned=1"> javascript:alert(1) <script>window.__pwned=2</script>';
  const fetchStub = stubFetch(() => ({
    status: 200,
    body: { items: [created(hostile, "0199a7c2-5e10-7b3c-9f2a-0c4d1e2f3b03")], next_cursor: null, can_comment: false },
  }));
  try {
    render(<CommentsPanel targetType="run" targetId={RUN_ID} locale="en" />);
    const body = await screen.findByText(hostile, { selector: "p.mj-comment-body" });
    assert.equal(body.querySelector("img, script, a") === null, true, "no element was made from the body");
    assert.equal((window as { __pwned?: number }).__pwned, undefined);
  } finally {
    fetchStub.restore();
  }
});

test("a thread the panel cannot read shows its own error, with a way to retry", async () => {
  // The notebook doubles in notebook-editor.test.tsx answer every URL with the
  // notebook; this is that shape, aimed at the panel directly.
  const fetchStub = stubFetch(() => ({ status: 200, body: { id: "nb", title: "A notebook" } }));
  try {
    render(<CommentsPanel targetType="notebook" targetId={RUN_ID} locale="en" />);
    await screen.findByText("Could not load the comments.");
    screen.getByRole("button", { name: "Try again" });
  } finally {
    fetchStub.restore();
  }
});
