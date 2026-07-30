import assert from "node:assert/strict";
import test from "node:test";
import { ARTIFACT_PANELS, DEFAULT_STUDIO_PANEL, STUDIO_PANELS } from "./studio-panels.ts";

test("the Studio tabs are in the owner-specified order", () => {
  // Asserted as a sequence, not as a set: every wrong order in the world
  // satisfies "contains these four tabs".
  assert.deepEqual([...STUDIO_PANELS], ["code", "simulation", "visual", "summary"]);
});

test("Studio opens on Code", () => {
  assert.equal(DEFAULT_STUDIO_PANEL, "code");
  assert.equal(STUDIO_PANELS[0], DEFAULT_STUDIO_PANEL);
});

test("the tab named for the circuit drawing is Visual, not Circuit", () => {
  assert.ok(!STUDIO_PANELS.includes("circuit" as never));
  assert.equal(STUDIO_PANELS[2], "visual");
});

test("versions are folded into Summary rather than standing alone", () => {
  assert.ok(!STUDIO_PANELS.includes("versions" as never));
  assert.ok(STUDIO_PANELS.includes("summary"));
});

test("the Vault artifact view uses the same tabs in the same order as Studio", () => {
  assert.deepEqual([...ARTIFACT_PANELS], [...STUDIO_PANELS]);
});
