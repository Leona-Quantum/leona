import assert from "node:assert/strict";
import test from "node:test";
import { readPublicQappPage, readQappExamples } from "./qapp-management.ts";

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

const example = {
  key: "bell_pair",
  title: "Bell pair",
  description: "Entangle two qubits.",
  framework: "qiskit",
  qubits_estimate: 2,
};

test("reads the example list the API returns", () => {
  assert.deepEqual(readQappExamples([example]), [example]);
  assert.deepEqual(readQappExamples([]), []);
});

test("an example list with one malformed row is refused whole, not trimmed", () => {
  assert.equal(readQappExamples([example, { ...example, key: "" }]), null);
  assert.equal(readQappExamples([example, { ...example, qubits_estimate: "2" }]), null);
});

test("an older API's refusal of the examples path reads as no list", () => {
  for (const payload of [{ detail: [{ msg: "Input should be a valid UUID" }] }, { detail: "Not Found" }, null, "x"]) {
    assert.equal(readQappExamples(payload), null, JSON.stringify(payload));
  }
});
