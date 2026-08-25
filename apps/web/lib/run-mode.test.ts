import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { COMPOSER_MODES, isComposerMode } from "./run-mode.ts";
import { isQappExecuteMessage, qappFrameDocument, QAPP_FRAME_CSP } from "./qapp-frame.ts";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(webRoot));

test("the composer exposes auto and every deliberate user-selectable mode", () => {
  assert.deepEqual(COMPOSER_MODES, ["auto", "execute", "qapp", "ideate", "explain"]);
});

test("Qapp documents receive the network-blocking policy before generated head content", () => {
  const document = qappFrameDocument("<!doctype html><html><head><title>X</title></head><body></body></html>", "c1");
  assert.ok(document.indexOf("Content-Security-Policy") < document.indexOf("<title>"));
  assert.match(QAPP_FRAME_CSP, /connect-src 'none'/);
  assert.match(document, /window\.qapp=Object\.freeze/);
});

test("no generated document can place the policy or the bridge where it cannot run", () => {
  // Each of these passed the server-side document guard and defeated the policy
  // when the frame builder spliced into the generated document's own `<head>`.
  // The controls must now precede every byte the model wrote, in all of them.
  const hostile = [
    '<!--<head>--><script>1<\/script>',
    '<script>var s="<head>";<\/script>',
    '<div data-x="<head>"><script>1<\/script></div>',
    '<script>1<\/script><head></head><body>x</body>',
  ];
  for (const ui of hostile) {
    const document = qappFrameDocument(ui, "c1");
    const policy = document.indexOf("Content-Security-Policy");
    const bridge = document.indexOf("window.qapp=Object.freeze");
    assert.ok(policy > -1, `policy missing for ${ui}`);
    assert.ok(bridge > -1, `bridge missing for ${ui}`);
    // Nothing the model wrote may be parsed before either control.
    assert.ok(policy < document.indexOf(ui), `policy follows generated markup for ${ui}`);
    assert.ok(bridge < document.indexOf(ui), `bridge follows generated markup for ${ui}`);
    // And neither control may sit inside an unterminated comment the model opened.
    const before = document.slice(0, policy);
    assert.equal((before.match(/<!--/g) ?? []).length, (before.match(/-->/g) ?? []).length,
      `policy sits inside a generated comment for ${ui}`);
  }
});

test("the Qapp parent bridge accepts only bounded messages for its own channel", () => {
  assert.equal(isQappExecuteMessage({ channel: "c", type: "qapp.execute", requestId: "1", inputs: { n: 2 } }, "c"), true);
  assert.equal(isQappExecuteMessage({ channel: "other", type: "qapp.execute", requestId: "1", inputs: {} }, "c"), false);
  assert.equal(isQappExecuteMessage({ channel: "c", type: "qapp.execute", requestId: "1", inputs: "x" }, "c"), false);
  assert.equal(isQappExecuteMessage({ channel: "c", type: "qapp.execute", requestId: "1", inputs: { value: "x".repeat(20_000) } }, "c"), false);
});

test("the Qapp call-to-action keeps button ink inside chat prose", () => {
  const styles = readFileSync(join(repoRoot, "packages", "ts", "ui", "styles.css"), "utf8");
  assert.match(
    styles,
    /\.mj-chat-message a\.mj-primary-button\s*\{[^}]*color:\s*var\(--bg-0\);[^}]*text-decoration:\s*none;/s,
  );
});

test("the authenticated Qapp surface scrolls inside the fixed workspace shell", () => {
  const styles = readFileSync(join(webRoot, "app", "globals.css"), "utf8");
  const privatePageRules = [...styles.matchAll(/(?:^|\n)\.qapp-private-page\s*\{([^}]*)\}/g)]
    .map((match) => match[1]);
  assert.ok(privatePageRules.length > 0, "globals.css has no .qapp-private-page rule");
  assert.ok(
    privatePageRules.some((body) => /height:\s*100%/.test(body) && /overflow-y:\s*auto/.test(body)),
    "the private Qapp page must own vertical scrolling inside .mj-shell--workspace",
  );
  assert.ok(
    privatePageRules.every((body) => !/min-height:\s*100vh/.test(body)),
    "100vh overflows the workspace shell but the shell clips its main region",
  );
});

test("the Qapp gallery owns its scroll region inside the fixed workspace shell", () => {
  const styles = readFileSync(join(repoRoot, "packages", "ts", "ui", "styles.css"), "utf8");
  assert.match(
    styles,
    /\.mj-qapps-scroll\s*\{[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior-y:\s*contain;/s,
  );
});

test("run mode parsing rejects server-only and unknown values", () => {
  for (const mode of COMPOSER_MODES) assert.equal(isComposerMode(mode), true);
  assert.equal(isComposerMode("chat"), false);
  assert.equal(isComposerMode("unknown"), false);
});
