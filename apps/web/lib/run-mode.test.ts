import assert from "node:assert/strict";
import test from "node:test";
import { COMPOSER_MODES, isComposerMode } from "./run-mode.ts";

test("the composer exposes auto and every deliberate user-selectable mode", () => {
  assert.deepEqual(COMPOSER_MODES, ["auto", "execute", "ideate", "explain"]);
});

test("run mode parsing rejects server-only and unknown values", () => {
  for (const mode of COMPOSER_MODES) assert.equal(isComposerMode(mode), true);
  assert.equal(isComposerMode("chat"), false);
  assert.equal(isComposerMode("unknown"), false);
});
