import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { paneForHash } from "./account-pane-selection.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

// The rail's ids, in the order account-content.tsx declares them.
const PANES = ["preferences", "identity", "archived", "usage", "qpu", "billing"] as const;

describe("which settings pane a fragment asks for", () => {
  it("resolves the two entry points that existed before the rail did", () => {
    // These are not arbitrary examples. /account#usage is what the profile menu
    // links to and /account#archived is what the archive banner links to; both
    // predate ai-ops 134, and both would silently show the WRONG section if this
    // mapping were wrong — 200, a settings page, no error anywhere.
    assert.equal(paneForHash(PANES, "#usage"), "usage");
    assert.equal(paneForHash(PANES, "#archived"), "archived");
  });

  it("accepts a fragment with or without its hash", () => {
    // `location.hash` carries the `#`; an id read from anywhere else does not.
    assert.equal(paneForHash(PANES, "#billing"), "billing");
    assert.equal(paneForHash(PANES, "billing"), "billing");
  });

  it("returns null for no fragment, so the caller keeps its default pane", () => {
    assert.equal(paneForHash(PANES, ""), null);
    assert.equal(paneForHash(PANES, "#"), null);
  });

  it("returns null for an unknown fragment rather than blanking the panel", () => {
    // A stale bookmark or a mistyped anchor was a harmless no-op scroll before
    // the rail existed. It has to stay harmless: null means "keep the default",
    // and anything else here is a reader looking at an empty detail pane.
    assert.equal(paneForHash(PANES, "#does-not-exist"), null);
    assert.equal(paneForHash(PANES, "#USAGE"), null, "fragment matching is case-sensitive, as ids are");
  });

  it("is not fooled by a fragment that merely contains a pane id", () => {
    assert.equal(paneForHash(PANES, "#usage-heading"), null);
    assert.equal(paneForHash(PANES, "#not-usage"), null);
  });

  // A positive control on the list above. The test file carries its own copy of
  // the pane ids, so it would keep passing after someone renamed a pane in
  // account-content.tsx and every deep link in the product broke. This reads the
  // real declaration and fails when the two disagree.
  it("checks the ids it asserts on against the ones the page actually declares", () => {
    const source = readFileSync(join(HERE, "..", "app", "(app)", "account", "account-content.tsx"), "utf8");
    const declared = [...source.matchAll(/^\s{6}id: "([a-z-]+)",$/gm)].map((match) => match[1]);
    assert.deepEqual(
      declared,
      [...PANES],
      "account-content.tsx's pane ids drifted from the ones this file asserts on — a deep link is now broken",
    );
  });
});
