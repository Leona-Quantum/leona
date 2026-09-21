import assert from "node:assert/strict";
import test from "node:test";
import { readPublicQappPage } from "./qapp-management.ts";

const item = {
  slug: "bell",
  title: "Bell pair",
  description: "Two entangled qubits.",
  framework: "qiskit",
  qubits_estimate: 2,
  version: 1,
  published_at: "2026-09-21T00:00:00Z",
};

test("reads the paged shape the API returns since proposal 6", () => {
  assert.deepEqual(readPublicQappPage({ items: [item], next_cursor: "abc" }), { items: [item], next_cursor: "abc" });
  assert.deepEqual(readPublicQappPage({ items: [], next_cursor: null }), { items: [], next_cursor: null });
});

test("reads the bare array an API from before the change still returns during a deploy", () => {
  assert.deepEqual(readPublicQappPage([item]), { items: [item], next_cursor: null });
});

test("anything else is null, never a page with undefined items", () => {
  for (const payload of [null, undefined, "x", 3, {}, { items: "nope" }, { detail: "refused" }]) {
    assert.equal(readPublicQappPage(payload), null, JSON.stringify(payload) ?? String(payload));
  }
});

test("a non-string cursor is dropped rather than passed on", () => {
  assert.deepEqual(readPublicQappPage({ items: [item], next_cursor: 7 }), { items: [item], next_cursor: null });
});
