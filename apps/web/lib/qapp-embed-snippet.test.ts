import assert from "node:assert/strict";
import test from "node:test";
import { qappEmbedSnippet } from "./qapp-embed-snippet.ts";

test("builds an iframe pointing at the embed route for the given origin and slug", () => {
  const snippet = qappEmbedSnippet("https://leonaqt.com", "bell-explorer-01a0ab5c");
  assert.equal(
    snippet,
    '<iframe src="https://leonaqt.com/embed/q/bell-explorer-01a0ab5c" style="width:100%;height:480px;border:0" loading="lazy" title="Qapp"></iframe>',
  );
});

test("carries no sandbox attribute", () => {
  // Deliberate — see the function's own docstring for why. Pinned as a test
  // so a future edit that adds one back has to make that decision on purpose.
  assert.doesNotMatch(qappEmbedSnippet("https://leonaqt.com", "x"), /sandbox/);
});

test("a local origin round-trips too, so a local build hands out a working snippet", () => {
  const snippet = qappEmbedSnippet("http://localhost:3115", "x");
  assert.match(snippet, /^<iframe src="http:\/\/localhost:3115\/embed\/q\/x"/);
});

test("the slug is percent-encoded", () => {
  const snippet = qappEmbedSnippet("https://leonaqt.com", "has a space/and a slash");
  assert.match(snippet, /src="https:\/\/leonaqt\.com\/embed\/q\/has%20a%20space%2Fand%20a%20slash"/);
});
