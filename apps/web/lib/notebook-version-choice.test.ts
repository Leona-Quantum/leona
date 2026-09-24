import assert from "node:assert/strict";
import test from "node:test";
import { defaultVersionSeq } from "./notebook-version-choice.ts";

test("the current version wins when there is one", () => {
  assert.equal(
    defaultVersionSeq({ currentSeq: 2, versions: [{ seq: 2, status: "ready" }, { seq: 3, status: "failed" }] }),
    2,
  );
});

test("a notebook whose only build failed opens on that build", () => {
  // The 2026-09-24 production notebook: one version, failed, with 36 cells in it.
  assert.equal(defaultVersionSeq({ currentSeq: null, versions: [{ seq: 1, status: "failed" }] }), 1);
});

test("the newest failed build is chosen, whatever order the list arrives in", () => {
  assert.equal(
    defaultVersionSeq({
      currentSeq: null,
      versions: [{ seq: 2, status: "failed" }, { seq: 1, status: "failed" }],
    }),
    2,
  );
});

test("a first build still running opens on nothing, so the progress rail shows", () => {
  assert.equal(defaultVersionSeq({ currentSeq: null, versions: [{ seq: 1, status: "running" }] }), null);
  assert.equal(defaultVersionSeq({ currentSeq: null, versions: [{ seq: 1, status: "queued" }] }), null);
  assert.equal(defaultVersionSeq({ currentSeq: undefined, versions: [] }), null);
});
