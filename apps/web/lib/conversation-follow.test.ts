import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runToFollow } from "./conversation-follow.ts";

describe("runToFollow", () => {
  it("follows the newest turn, not the one the URL names", () => {
    // The sidebar links to a conversation's FIRST run, so this is what happens
    // on every re-entry: without this the page tails `first`, which finished
    // when the second turn was created, and a generating third turn is invisible.
    assert.equal(runToFollow(["first", "second", "third"], "first"), "third");
  });

  it("stays put once it is already on the newest turn", () => {
    assert.equal(runToFollow(["first", "second"], "second"), "second");
  });

  it("does not move backwards onto a payload that predates the run being followed", () => {
    // Submitting a follow-up points the page at the new run immediately. A
    // /conversation response that was already in flight cannot contain that run,
    // and must not drag the page back onto the previous turn — which would tail
    // a finished run and lose the answer being generated.
    assert.equal(runToFollow(["first", "second"], "third"), "third");
  });

  it("keeps the current run when the conversation is empty", () => {
    assert.equal(runToFollow([], "first"), "first");
  });

  it("follows a single-turn conversation's only run", () => {
    assert.equal(runToFollow(["only"], "only"), "only");
  });
});
