import assert from "node:assert/strict";
import test from "node:test";

import { authoredPinAfterRun, type AuthoredVersion } from "./run-stream-outcome.ts";

const AUTHORED: AuthoredVersion = { runId: "run_a", seq: 5 };

test("the save's own run ending pins the version it authored", () => {
  assert.deepEqual(authoredPinAfterRun(AUTHORED, "run_a", "terminal"), {
    pin: 5,
    clear: true,
    warn: false,
  });
});

test("a pin is never applied by a run that did not author it", () => {
  // The shape of the bug: save authors seq 5 on run_a, the reader sends a chat
  // turn, run_b finishes. Pinning 5 here would show the reader a version that
  // has nothing to do with the turn they just sent, and say nothing about it.
  const decision = authoredPinAfterRun(AUTHORED, "run_b", "terminal");
  assert.equal(decision.pin, null);
  assert.equal(decision.clear, true, "the dead pin must not survive to be applied later still");
});

test("a lost stream clears the pending pin instead of applying it", () => {
  assert.deepEqual(authoredPinAfterRun(AUTHORED, "run_a", "lost"), {
    pin: null,
    clear: true,
    warn: true,
  });
});

test("a lost stream with nothing pending still warns, and clears nothing", () => {
  assert.deepEqual(authoredPinAfterRun(null, "run_a", "lost"), {
    pin: null,
    clear: false,
    warn: true,
  });
});

test("a clean run with nothing pending is entirely silent", () => {
  assert.deepEqual(authoredPinAfterRun(null, "run_a", "terminal"), {
    pin: null,
    clear: false,
    warn: false,
  });
});

test("a stream that ends while no run is followed cannot pin", () => {
  // `endedRunId` is read off state that may already have been reset to null.
  // Treating null as a match would resurrect the cross-run pin this module
  // exists to prevent, so it must be a mismatch like any other id.
  assert.equal(authoredPinAfterRun(AUTHORED, null, "terminal").pin, null);
});
