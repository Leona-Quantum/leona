import assert from "node:assert/strict";
import test from "node:test";
import { COMPOSER_MODES, isComposerMode } from "./run-mode.ts";
import { isQappExecuteMessage, qappFrameDocument, QAPP_FRAME_CSP } from "./qapp-frame.ts";

test("the composer exposes auto and every deliberate user-selectable mode", () => {
  assert.deepEqual(COMPOSER_MODES, ["auto", "execute", "qapp", "ideate", "explain"]);
});

test("Qapp documents receive the network-blocking policy before generated head content", () => {
  const document = qappFrameDocument("<!doctype html><html><head><title>X</title></head><body></body></html>", "c1");
  assert.ok(document.indexOf("Content-Security-Policy") < document.indexOf("<title>"));
  assert.match(QAPP_FRAME_CSP, /connect-src 'none'/);
  assert.match(document, /window\.qapp=Object\.freeze/);
});

test("the Qapp parent bridge accepts only bounded messages for its own channel", () => {
  assert.equal(isQappExecuteMessage({ channel: "c", type: "qapp.execute", requestId: "1", inputs: { n: 2 } }, "c"), true);
  assert.equal(isQappExecuteMessage({ channel: "other", type: "qapp.execute", requestId: "1", inputs: {} }, "c"), false);
  assert.equal(isQappExecuteMessage({ channel: "c", type: "qapp.execute", requestId: "1", inputs: "x" }, "c"), false);
  assert.equal(isQappExecuteMessage({ channel: "c", type: "qapp.execute", requestId: "1", inputs: { value: "x".repeat(20_000) } }, "c"), false);
});

test("run mode parsing rejects server-only and unknown values", () => {
  for (const mode of COMPOSER_MODES) assert.equal(isComposerMode(mode), true);
  assert.equal(isComposerMode("chat"), false);
  assert.equal(isComposerMode("unknown"), false);
});
