import assert from "node:assert/strict";
import test from "node:test";

import { reviseFollowState, type ReviseWireEvent } from "./studio-revise-follow.ts";

test("no events yet: running, no stages reached, nothing saved", () => {
  const state = reviseFollowState([]);
  assert.deepEqual(state, { status: "running", reachedStages: [], artifactId: null, errorMessage: null });
});

test("stages accumulate in order as their events arrive, status stays running", () => {
  const events: ReviseWireEvent[] = [
    { type: "plan.produced" },
    { type: "code.generated" },
  ];
  const state = reviseFollowState(events);
  assert.equal(state.status, "running");
  assert.deepEqual(state.reachedStages, ["planned", "coded"]);
  assert.equal(state.artifactId, null);
});

test("artifact.saved reports the artifact id; run.finished succeeded reports success", () => {
  const events: ReviseWireEvent[] = [
    { type: "plan.produced" },
    { type: "code.generated" },
    { type: "sandbox.result" },
    { type: "verification.semantic_review" },
    { type: "artifact.saved", artifact_id: "art-123" },
    { type: "run.finished", status: "succeeded" },
  ];
  const state = reviseFollowState(events);
  assert.equal(state.status, "succeeded");
  assert.deepEqual(state.reachedStages, ["planned", "coded", "sandboxed", "verified", "saved"]);
  assert.equal(state.artifactId, "art-123");
  assert.equal(state.errorMessage, null);
});

test("a chat.error marks the run failed even before run.finished arrives", () => {
  const events: ReviseWireEvent[] = [
    { type: "plan.produced" },
    { type: "chat.error", message: "The circuit could not be revised." },
  ];
  const state = reviseFollowState(events);
  assert.equal(state.status, "failed");
  assert.equal(state.errorMessage, "The circuit could not be revised.");
});

test("run.finished with a non-succeeded status is failed, using its own message when there was no separate error event", () => {
  const events: ReviseWireEvent[] = [{ type: "run.finished", status: "failed", message: "Run allowance exhausted." }];
  const state = reviseFollowState(events);
  assert.equal(state.status, "failed");
  assert.equal(state.errorMessage, "Run allowance exhausted.");
});

test("an error event takes precedence over a contradictory later succeeded status", () => {
  const events: ReviseWireEvent[] = [
    { type: "run.error", message: "Something went wrong mid-run." },
    { type: "run.finished", status: "succeeded" },
  ];
  const state = reviseFollowState(events);
  assert.equal(state.status, "failed");
  assert.equal(state.errorMessage, "Something went wrong mid-run.");
});

test("errorMessage is only ever set once the run has actually failed", () => {
  const running = reviseFollowState([{ type: "plan.produced" }]);
  assert.equal(running.errorMessage, null);
});
