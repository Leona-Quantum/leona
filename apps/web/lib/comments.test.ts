import assert from "node:assert/strict";
import test from "node:test";

import {
  type Comment,
  type CommentPerson,
  insertMention,
  isCommentableId,
  mentionQuery,
  mentionSuggestions,
  mergeComments,
  targetHref,
  threadsOf,
} from "./comments.ts";

let counter = 0;
function comment(overrides: Partial<Comment> = {}): Comment {
  counter += 1;
  return {
    id: `0190a4f0-0000-7000-8000-${String(counter).padStart(12, "0")}`,
    workspace_id: "0190a4f0-0000-7000-8000-00000000ffff",
    target_type: "run",
    target_id: "0190a4f0-0000-7000-8000-00000000eeee",
    parent_id: null,
    author: { user_id: "u", display_name: "Sam", handle: "sam", current_member: true },
    body: "hello",
    mentions: [],
    created_at: "2026-09-22T10:00:00Z",
    edited_at: null,
    deleted_at: null,
    can_edit: false,
    can_delete: false,
    ...overrides,
  };
}

test("replies sit under their parent, in order, and an orphan reply is held back", () => {
  const top = comment();
  const other = comment();
  const reply = comment({ parent_id: top.id });
  const later = comment({ parent_id: top.id });
  const orphan = comment({ parent_id: "0190a4f0-0000-7000-8000-00000000dddd" });
  const threads = threadsOf([top, other, reply, later, orphan]);
  assert.deepEqual(
    threads.map((t) => [t.comment.id, t.replies.map((r) => r.id)]),
    [
      [top.id, [reply.id, later.id]],
      [other.id, []],
    ],
  );
});

test("merging a page or an edit keeps one copy of each comment, oldest first", () => {
  const a = comment();
  const b = comment();
  const edited = { ...a, body: "changed" };
  const merged = mergeComments([b, a], [edited]);
  assert.deepEqual(merged.map((c) => [c.id, c.body]), [
    [a.id, "changed"],
    [b.id, "hello"],
  ]);
});

test("a mention query opens only where the server would read a mention", () => {
  assert.deepEqual(mentionQuery("hi @sa", 6), { start: 3, query: "sa" });
  assert.deepEqual(mentionQuery("@", 1), { start: 0, query: "" });
  assert.equal(mentionQuery("me@lab", 6), null, "an address is not a mention");
  assert.equal(mentionQuery("see https://x.org/@sa", 21), null);
  assert.equal(mentionQuery("hi @sam there", 13), null, "the caret has moved past it");
  assert.deepEqual(mentionQuery("確認@Sa", 5), { start: 2, query: "sa" });
});

const PEOPLE: CommentPerson[] = [
  { user_id: "1", display_name: "Sam Ito", handle: "sam", current_member: true },
  { user_id: "2", display_name: "Alex Kim", handle: "alex.kim", current_member: true },
  { user_id: "3", display_name: "Samira Diaz", handle: "sdiaz", current_member: true },
];

test("suggestions rank handle prefix, then name prefix, then anywhere", () => {
  assert.deepEqual(mentionSuggestions(PEOPLE, "sa").map((p) => p.handle), ["sam", "sdiaz"]);
  assert.deepEqual(mentionSuggestions(PEOPLE, "kim").map((p) => p.handle), ["alex.kim"]);
  assert.deepEqual(mentionSuggestions(PEOPLE, "").map((p) => p.handle), ["alex.kim", "sam", "sdiaz"]);
  assert.deepEqual(mentionSuggestions(PEOPLE, "zzz"), []);
});

test("choosing a suggestion replaces the partial handle and moves the caret after it", () => {
  assert.deepEqual(insertMention("thanks @sa for this", 10, "sam"), {
    text: "thanks @sam for this",
    caret: 12,
  });
  assert.deepEqual(insertMention("cc @al", 6, "alex.kim"), { text: "cc @alex.kim ", caret: 13 });
  assert.deepEqual(insertMention("no mention here", 4, "sam"), { text: "no mention here", caret: 4 });
});

test("only a server id gets a panel", () => {
  assert.equal(isCommentableId("0190a4f0-0000-7000-8000-000000000001"), true);
  assert.equal(isCommentableId("local-draft-3"), false);
  assert.equal(isCommentableId("bell-example"), false);
  assert.equal(isCommentableId(undefined), false);
});

test("each kind of thing links to the page it is opened on", () => {
  assert.equal(targetHref("run", "abc"), "/run/abc#comments");
  assert.equal(targetHref("notebook", "abc"), "/notebooks/abc#comments");
  assert.equal(targetHref("artifact", "a b"), "/studio?artifact=a%20b#comments");
});
