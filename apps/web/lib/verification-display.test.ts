import assert from "node:assert/strict";
import { test } from "node:test";

import { studioVerificationDisplayState } from "./verification-display.ts";

test("Studio projects hydration into the verification panel", () => {
  assert.equal(studioVerificationDisplayState({ hydration: "loading", hasArtifact: false, stale: false }), "loading");
  assert.equal(studioVerificationDisplayState({ hydration: "error", hasArtifact: false, stale: false }), "error");
  assert.equal(studioVerificationDisplayState({ hydration: "ready", hasArtifact: false, stale: false }), "empty");
  assert.equal(studioVerificationDisplayState({ hydration: "ready", hasArtifact: true, stale: false }), undefined);
});

test("source edits replace every prior state with stale", () => {
  assert.equal(studioVerificationDisplayState({ hydration: "ready", hasArtifact: true, stale: true }), "stale");
});
