import assert from "node:assert/strict";
import test from "node:test";

import {
  chunkReloadStorageKey,
  isChunkLoadFailureMessage,
  shouldReloadForChunkFailure,
} from "./chunk-error-recovery.ts";

test("isChunkLoadFailureMessage matches webpack's own ChunkLoadError text", () => {
  assert.equal(
    isChunkLoadFailureMessage("Loading chunk 42 failed.\n(error: https://leonaqt.com/_next/static/chunks/42.abcd.js)"),
    true,
  );
  assert.equal(isChunkLoadFailureMessage("Uncaught ChunkLoadError: Loading chunk app/layout failed."), true);
});

test("isChunkLoadFailureMessage matches Chrome/Turbopack's native dynamic import() failure text", () => {
  assert.equal(
    isChunkLoadFailureMessage("Failed to fetch dynamically imported module: https://leonaqt.com/_next/static/chunks/123.js"),
    true,
  );
});

test("isChunkLoadFailureMessage matches Firefox's phrasing", () => {
  assert.equal(
    isChunkLoadFailureMessage("error loading dynamically imported module: https://leonaqt.com/_next/static/chunks/123.js"),
    true,
  );
});

test("isChunkLoadFailureMessage matches Safari's phrasing", () => {
  assert.equal(isChunkLoadFailureMessage("Importing a module script failed"), true);
});

test("isChunkLoadFailureMessage is case-insensitive", () => {
  assert.equal(isChunkLoadFailureMessage("FAILED TO FETCH DYNAMICALLY IMPORTED MODULE"), true);
});

test("isChunkLoadFailureMessage does not match an unrelated error", () => {
  assert.equal(isChunkLoadFailureMessage("TypeError: Cannot read properties of undefined (reading 'map')"), false);
});

test("isChunkLoadFailureMessage does not match null, undefined or empty", () => {
  assert.equal(isChunkLoadFailureMessage(null), false);
  assert.equal(isChunkLoadFailureMessage(undefined), false);
  assert.equal(isChunkLoadFailureMessage(""), false);
});

test("chunkReloadStorageKey is namespaced and distinct per build id", () => {
  assert.equal(chunkReloadStorageKey("abc1234"), "leona.chunk-reload.abc1234");
  assert.notEqual(chunkReloadStorageKey("abc1234"), chunkReloadStorageKey("def5678"));
});

test("shouldReloadForChunkFailure: a chunk failure not yet retried should reload", () => {
  assert.equal(shouldReloadForChunkFailure("Loading chunk 3 failed.", false), true);
});

test("shouldReloadForChunkFailure: the loop guard — already reloaded once for this build, do not reload again", () => {
  // This is the property that matters most: remove the `!alreadyReloaded`
  // check and a build that is broken in a way no reload can fix would loop
  // forever instead of failing once, visibly, the ordinary way.
  assert.equal(shouldReloadForChunkFailure("Loading chunk 3 failed.", true), false);
});

test("shouldReloadForChunkFailure: an unrelated error never reloads, tried or not", () => {
  assert.equal(shouldReloadForChunkFailure("Network request failed", false), false);
  assert.equal(shouldReloadForChunkFailure("Network request failed", true), false);
});
